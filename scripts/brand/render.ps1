# Renders the KakaoTalk/OG share image and the home-screen icon into public/ with headless Edge or Chrome.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Microsoft Edge or Google Chrome is required.' }
$profileDir = Join-Path ([IO.Path]::GetTempPath()) "wedding-brand-render-$PID"

function Render([string]$page, [string]$output, [int]$width, [int]$height) {
    $url = ([Uri](Join-Path $PSScriptRoot $page)).AbsoluteUri
    $target = Join-Path $root $output
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
    $arguments = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--virtual-time-budget=4000', "--user-data-dir=$profileDir", "--window-size=$width,$height", "--screenshot=$target", $url)
    Start-Process -FilePath $browser -ArgumentList $arguments -Wait -NoNewWindow
    if (-not (Test-Path -LiteralPath $target)) { throw "Rendering failed: $output" }
    Write-Host "Rendered $output"
}
try {
    Render 'og-image.html' 'public/og-image.png' 1200 630
    Render 'icon.html' 'public/apple-touch-icon.png' 180 180
} finally { if (Test-Path -LiteralPath $profileDir) { Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue } }
