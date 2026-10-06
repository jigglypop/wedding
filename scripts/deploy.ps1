[CmdletBinding()]
param(
    [string]$Region = 'ap-northeast-2',
    [string]$StackName = 'wedding-planner',
    [string]$ExpectedAccount = '960243570517',
    [string]$DomainName = 'ourweddingnote.com',
    [string]$CertificateArn = 'arn:aws:acm:us-east-1:960243570517:certificate/a0d37143-a071-4ada-b50c-c68f73bed4c8',
    [string]$HostedZoneId = 'Z05498752ZRKUTRYPBQ63',
    [switch]$SkipBuild,
    [switch]$SkipWait
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deploymentDirectory = Join-Path $workspace '.deployment'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Aws {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    # Windows PowerShell 5.1 turns any native stderr line into a terminating error under 'Stop'; rely on the exit code instead.
    $ErrorActionPreference = 'Continue'
    $result = & aws @Arguments --region $Region --no-cli-pager 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI failed: $($Arguments[0]) $($Arguments[1]). $($result -join [Environment]::NewLine)"
    }
    return ($result -join [Environment]::NewLine)
}

function Read-DotEnv {
    param([string]$Path)
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            } else {
                $value = ($value -replace '\s+#.*$', '').Trim()
            }
            $values[$key] = $value
        }
    }
    return $values
}

function New-RandomSecret {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-LiveSite {
    param([string]$Url, [string]$ExpectedIndexHash, [int]$Attempts)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 20
            $liveIndexPath = Join-Path $deploymentDirectory 'live-index.html'
            $page = Invoke-WebRequest -Uri "$Url/" -UseBasicParsing -TimeoutSec 20 -OutFile $liveIndexPath -PassThru
            $liveIndexHash = (Get-FileHash -LiteralPath $liveIndexPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($page.StatusCode -eq 200 -and $liveIndexHash -eq $ExpectedIndexHash -and $health.ok -eq $true) { return $true }
        } catch { }
        Write-Host "Waiting for $Url ($attempt/$Attempts)."
        Start-Sleep -Seconds 10
    }
    return $false
}

if ($StackName -notmatch '^wedding-planner(?:-[a-z0-9-]+)?$') {
    throw 'Only a dedicated wedding-planner stack is supported.'
}
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'AWS CLI is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $workspace '.env'))) { throw 'Create .env with OPENAI_API_KEY before deploying.' }

$identity = (Invoke-Aws -Arguments @('sts', 'get-caller-identity', '--output', 'json')) | ConvertFrom-Json
if ($identity.Account -ne $ExpectedAccount) { throw "Unexpected AWS account $($identity.Account); deployment stopped." }
Write-Host "Deploying dedicated stack $StackName in account $($identity.Account), region $Region."

$environment = Read-DotEnv -Path (Join-Path $workspace '.env')
if ([string]::IsNullOrWhiteSpace($environment['OPENAI_API_KEY'])) { throw 'OPENAI_API_KEY is missing in .env.' }
$model = $environment['OPENAI_MODEL']
if ([string]::IsNullOrWhiteSpace($model)) { $model = 'gpt-6.1-sol' }

if (-not $SkipBuild) {
    Push-Location $workspace
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    } finally { Pop-Location }
}

$webDirectory = Join-Path $workspace 'dist'
$serverDirectory = Join-Path $workspace 'dist-server'
$materialsDirectory = Join-Path $workspace 'data/assets'
foreach ($required in @((Join-Path $webDirectory 'index.html'), (Join-Path $webDirectory 'og-image.png'), (Join-Path $serverDirectory 'index.mjs'), (Join-Path $serverDirectory 'index.html'), (Join-Path $serverDirectory 'RELEASE'), (Join-Path $serverDirectory 'data/initial-state.json'), (Join-Path $serverDirectory 'data/materials.json'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required build output missing: $required" }
}
if (-not (Test-Path -LiteralPath $materialsDirectory -PathType Container)) { throw 'Private materials are missing: data/assets.' }

# Deployment secrets persist in .deployment/runtime-secrets.json; .env values take precedence.
[IO.Directory]::CreateDirectory($deploymentDirectory) | Out-Null
$secretsPath = Join-Path $deploymentDirectory 'runtime-secrets.json'
$secrets = @{}
if (Test-Path -LiteralPath $secretsPath) {
    $saved = [IO.File]::ReadAllText($secretsPath) | ConvertFrom-Json
    foreach ($property in $saved.PSObject.Properties) { $secrets[$property.Name] = $property.Value }
}
$secrets.Remove('WEDDING_PASSWORD')
foreach ($secretName in @('SESSION_SECRET', 'ORIGIN_VERIFY_TOKEN')) {
    if (-not [string]::IsNullOrWhiteSpace($environment[$secretName])) { $secrets[$secretName] = $environment[$secretName] }
    if ([string]::IsNullOrWhiteSpace($secrets[$secretName])) { $secrets[$secretName] = New-RandomSecret }
}
foreach ($pair in @(@('ADMIN_USERNAME', 'WEDDING_ADMIN_USERNAME'), @('ADMIN_PASSWORD', 'WEDDING_ADMIN_PASSWORD'))) {
    if (-not [string]::IsNullOrWhiteSpace($environment[$pair[1]])) { $secrets[$pair[0]] = $environment[$pair[1]] }
    if ([string]::IsNullOrWhiteSpace($secrets[$pair[0]])) { throw "Set $($pair[1]) in .env before deploying." }
}
$secrets['ADMIN_USERNAME'] = $secrets['ADMIN_USERNAME'].Trim().ToLowerInvariant()
if ($secrets['ADMIN_USERNAME'] -notmatch '^[a-z0-9][a-z0-9_]{3,19}$') { throw 'WEDDING_ADMIN_USERNAME must be 4-20 lowercase letters, numbers, or underscores.' }
if ($secrets['ADMIN_PASSWORD'].Length -lt 8) { throw 'WEDDING_ADMIN_PASSWORD must contain at least 8 characters.' }
[IO.File]::WriteAllText($secretsPath, ($secrets | ConvertTo-Json), $utf8)

# Reject server credentials in public build output before any AWS upload.
$privateValues = @($environment['OPENAI_API_KEY'], $secrets['SESSION_SECRET'], $secrets['ORIGIN_VERIFY_TOKEN'], $secrets['ADMIN_PASSWORD'])
foreach ($publicFile in Get-ChildItem -LiteralPath $webDirectory -File -Recurse) {
    if ($publicFile.Extension -in @('.html', '.js', '.json', '.css', '.map', '.txt', '.svg')) {
        $publicText = [IO.File]::ReadAllText($publicFile.FullName)
        foreach ($privateValue in $privateValues) {
            if ($publicText.Contains($privateValue)) { throw "A server credential appears in public build output: $($publicFile.Name). Deployment stopped." }
        }
    }
    if ($publicFile.Name -eq '.env') { throw 'A .env file appears in public output. Deployment stopped.' }
}

$parameterFile = Join-Path $deploymentDirectory 'parameters.tmp.json'
$zipPath = Join-Path $deploymentDirectory 'api.zip'
$parameters = @(
    "OpenAiApiKey=$($environment['OPENAI_API_KEY'])",
    "OpenAiModel=$model",
    "SessionSecret=$($secrets['SESSION_SECRET'])",
    "OriginVerifyToken=$($secrets['ORIGIN_VERIFY_TOKEN'])",
    "AdminUsername=$($secrets['ADMIN_USERNAME'])",
    "AdminPassword=$($secrets['ADMIN_PASSWORD'])",
    "DomainName=$DomainName",
    "CertificateArn=$CertificateArn",
    "HostedZoneId=$HostedZoneId"
)
[IO.File]::WriteAllText($parameterFile, (ConvertTo-Json -InputObject $parameters), $utf8)

try {
    Write-Host 'Creating or updating private storage, API, CloudFront, and DNS.'
    Invoke-Aws -Arguments @('cloudformation', 'deploy', '--stack-name', $StackName, '--template-file', (Join-Path $workspace 'infra/template.yaml'), '--parameter-overrides', "file://$parameterFile", '--capabilities', 'CAPABILITY_IAM', '--no-fail-on-empty-changeset', '--tags', 'Project=wedding-planner') | Write-Host

    $stack = (Invoke-Aws -Arguments @('cloudformation', 'describe-stacks', '--stack-name', $StackName, '--output', 'json')) | ConvertFrom-Json
    $outputs = @{}
    foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
    if ($outputs['WebsiteBucket'] -ne "$StackName-$ExpectedAccount-$Region-web") { throw 'Unexpected website bucket; stopped before uploading.' }
    if ($outputs['MaterialsBucket'] -ne "$StackName-$ExpectedAccount-$Region-materials") { throw 'Unexpected materials bucket; stopped before uploading.' }
    if ($outputs['ApiFunctionName'] -ne "$StackName-api") { throw 'Unexpected API function; stopped before publishing.' }

    # Absolute URLs are required for KakaoTalk and other link previews.
    foreach ($html in @((Join-Path $webDirectory 'index.html'), (Join-Path $serverDirectory 'index.html'))) {
        [IO.File]::WriteAllText($html, [IO.File]::ReadAllText($html).Replace('__SITE_URL__', $outputs['WebsiteUrl']), $utf8)
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
    $zipStream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
    $archive = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $serverDirectory -File -Recurse) {
            $relativePath = $file.FullName.Substring($serverDirectory.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relativePath, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose(); $zipStream.Dispose() }
    Write-Host 'Publishing private source materials and website assets.'
    Invoke-Aws -Arguments @('s3', 'sync', $materialsDirectory, "s3://$($outputs['MaterialsBucket'])/", '--only-show-errors', '--sse', 'AES256') | Out-Null
    # The GitHub deploy workflow builds with these private files instead of keeping them in the public repository.
    foreach ($dataFile in @('initial-state.json', 'materials.json')) {
        Invoke-Aws -Arguments @('s3', 'cp', (Join-Path $workspace "data/$dataFile"), "s3://$($outputs['MaterialsBucket'])/build-data/$dataFile", '--only-show-errors', '--sse', 'AES256') | Out-Null
    }
    # Hashed assets go up before the new Lambda starts serving invite pages that reference them; entry pages go last.
    if (Test-Path -LiteralPath (Join-Path $webDirectory 'assets')) {
        Invoke-Aws -Arguments @('s3', 'sync', (Join-Path $webDirectory 'assets'), "s3://$($outputs['WebsiteBucket'])/assets/", '--only-show-errors', '--cache-control', 'public,max-age=31536000,immutable', '--sse', 'AES256') | Out-Null
    }
    Invoke-Aws -Arguments @('s3', 'sync', $webDirectory, "s3://$($outputs['WebsiteBucket'])/", '--only-show-errors', '--cache-control', 'public,max-age=3600', '--sse', 'AES256', '--exclude', 'assets/*', '--exclude', 'index.html', '--exclude', 'release.json') | Out-Null

    Write-Host 'Publishing Lambda bundle.'
    Invoke-Aws -Arguments @('lambda', 'update-function-code', '--function-name', $outputs['ApiFunctionName'], '--zip-file', "fileb://$zipPath", '--query', 'CodeSha256', '--output', 'text') | Out-Null
    Invoke-Aws -Arguments @('lambda', 'wait', 'function-updated-v2', '--function-name', $outputs['ApiFunctionName']) | Out-Null

    $release = @{ deployedAt = [DateTime]::UtcNow.ToString('o'); stack = $StackName; release = ([IO.File]::ReadAllText((Join-Path $serverDirectory 'RELEASE')).Trim()); indexSha256 = (Get-FileHash -LiteralPath (Join-Path $webDirectory 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant() }
    [IO.File]::WriteAllText((Join-Path $webDirectory 'release.json'), ($release | ConvertTo-Json), $utf8)
    Write-Host 'Publishing entry pages and invalidating cached copies.'
    foreach ($entry in @('index.html', 'release.json')) {
        $contentType = if ($entry.EndsWith('.html')) { 'text/html; charset=utf-8' } else { 'application/json' }
        Invoke-Aws -Arguments @('s3', 'cp', (Join-Path $webDirectory $entry), "s3://$($outputs['WebsiteBucket'])/$entry", '--only-show-errors', '--cache-control', 'no-cache,max-age=0,must-revalidate', '--content-type', $contentType, '--sse', 'AES256') | Out-Null
    }
    $invalidation = (Invoke-Aws -Arguments @('cloudfront', 'create-invalidation', '--distribution-id', $outputs['DistributionId'], '--paths', '/*', '--output', 'json')) | ConvertFrom-Json
    [IO.File]::WriteAllText((Join-Path $deploymentDirectory 'outputs.json'), ($outputs | ConvertTo-Json), $utf8)
    [IO.File]::WriteAllText((Join-Path $deploymentDirectory 'access.txt'), "Website: $($outputs['WebsiteUrl'])`r`nCloudFront: $($outputs['CloudFrontUrl'])`r`nAdmin ID: $($secrets['ADMIN_USERNAME'])`r`nAdmin password: WEDDING_ADMIN_PASSWORD in .env`r`n", $utf8)

    if (-not $SkipWait) {
        Write-Host 'Waiting for CloudFront deployment and cache invalidation.'
        Invoke-Aws -Arguments @('cloudfront', 'wait', 'distribution-deployed', '--id', $outputs['DistributionId']) | Out-Null
        Invoke-Aws -Arguments @('cloudfront', 'wait', 'invalidation-completed', '--distribution-id', $outputs['DistributionId'], '--id', $invalidation.Invalidation.Id) | Out-Null
    }

    if (-not (Test-LiveSite -Url $outputs['CloudFrontUrl'] -ExpectedIndexHash $release.indexSha256 -Attempts 18)) { throw "Published resources exist, but live website/API verification did not pass. Inspect $deploymentDirectory/outputs.json." }
    Write-Host "Live website and API verified: $($outputs['CloudFrontUrl'])"
    if ($outputs['WebsiteUrl'] -ne $outputs['CloudFrontUrl']) {
        if (Test-LiveSite -Url $outputs['WebsiteUrl'] -ExpectedIndexHash $release.indexSha256 -Attempts 30) { Write-Host "Custom domain verified: $($outputs['WebsiteUrl'])" }
        else { Write-Warning "The custom domain is not answering yet (DNS can take a while after registration): $($outputs['WebsiteUrl'])" }
    }
    Write-Host "Access summary saved to $deploymentDirectory/access.txt."
} finally {
    if (Test-Path -LiteralPath $parameterFile) { Remove-Item -LiteralPath $parameterFile }
}
