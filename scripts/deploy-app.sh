#!/usr/bin/env bash
# Publishes an already built app (Lambda bundle + website) to the existing stack.
# Used by the GitHub deploy workflow; infrastructure and secrets change only through scripts/deploy.ps1.
# The deploy role cannot read the function configuration (it holds secrets), so the new code is confirmed through /api/health.
set -euo pipefail
STACK_NAME="${STACK_NAME:-wedding-planner}"
output() { aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
site="$(output WebsiteUrl)"; cdn="$(output CloudFrontUrl)"; web="$(output WebsiteBucket)"; fn="$(output ApiFunctionName)"; distribution="$(output DistributionId)"
release="$(cat dist-server/RELEASE)"

# Absolute URLs are required for KakaoTalk and other link previews.
sed -i "s#__SITE_URL__#${site}#g" dist/index.html dist-server/index.html

# Hashed assets first: invite pages rendered by the new Lambda reference them immediately.
aws s3 sync dist/assets "s3://$web/assets/" --only-show-errors --cache-control 'public,max-age=31536000,immutable' --sse AES256
aws s3 sync dist "s3://$web/" --only-show-errors --cache-control 'public,max-age=3600' --sse AES256 --exclude 'assets/*' --exclude index.html --exclude release.json

rm -f api.zip
(cd dist-server && zip -qr ../api.zip .)
aws lambda update-function-code --function-name "$fn" --zip-file fileb://api.zip --query CodeSha256 --output text
for attempt in $(seq 1 30); do
  if curl -fsS "$cdn/api/health" | grep -q "\"version\":\"$release\""; then break; fi
  if [ "$attempt" = 30 ]; then echo "API release $release did not go live" >&2; exit 1; fi
  sleep 5
done

hash="$(sha256sum dist/index.html | cut -d' ' -f1)"
printf '{"deployedAt":"%s","stack":"%s","indexSha256":"%s","release":"%s","commit":"%s"}\n' "$(date -u +%FT%TZ)" "$STACK_NAME" "$hash" "$release" "${GITHUB_SHA:-local}" > dist/release.json
aws s3 cp dist/release.json "s3://$web/release.json" --only-show-errors --cache-control 'no-cache,max-age=0,must-revalidate' --content-type application/json --sse AES256
aws s3 cp dist/index.html "s3://$web/index.html" --only-show-errors --cache-control 'no-cache,max-age=0,must-revalidate' --content-type 'text/html; charset=utf-8' --sse AES256

invalidation="$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$invalidation"

for attempt in $(seq 1 18); do
  if [ "$(curl -fsS "$cdn/" | sha256sum | cut -d' ' -f1)" = "$hash" ]; then
    echo "Live: $site (release $release)"
    exit 0
  fi
  echo "Waiting for $cdn ($attempt/18)"
  sleep 10
done
echo 'Live verification failed' >&2
exit 1
