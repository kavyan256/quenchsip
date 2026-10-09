#!/bin/sh
# Uploads web/ to the site bucket and clears CloudFront's cache.
# Uses the same profile and region as samconfig.toml; override with AWS_PROFILE / AWS_REGION.
set -eu
PROFILE="${AWS_PROFILE:-quenchsip}"
REGION="${AWS_REGION:-ap-south-1}"
STACK="${STACK:-quench}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET=$(output WebBucketName)
DIST=$(output DistributionId)
URL=$(output WebUrl)

aws s3 sync web "s3://$BUCKET" --delete --region "$REGION" --profile "$PROFILE" --exclude "*.DS_Store"
# The service worker must always be fetched fresh, or phones keep an old copy.
aws s3 cp web/sw.js "s3://$BUCKET/sw.js" --region "$REGION" --profile "$PROFILE" \
  --content-type "text/javascript" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --profile "$PROFILE" --query "Invalidation.Id" --output text

echo "Site: $URL"
