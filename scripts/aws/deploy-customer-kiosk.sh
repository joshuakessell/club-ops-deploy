#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required" >&2
    exit 1
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing required tool '$1'" >&2
    exit 1
  }
}

need_cmd aws
need_cmd pnpm

aws sts get-caller-identity >/dev/null

required VITE_KIOSK_TOKEN
required CUSTOMER_BUCKET
required CUSTOMER_DISTRIBUTION_ID

VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api-demo.joshuakessell.com}"

cd "$ROOT_DIR"

if [[ "${SKIP_PNPM_INSTALL:-}" != "true" ]]; then
  pnpm install --frozen-lockfile
fi

VITE_API_BASE_URL="$VITE_API_BASE_URL" \
VITE_KIOSK_TOKEN="$VITE_KIOSK_TOKEN" \
  pnpm -C apps/customer-kiosk build

aws s3 sync apps/customer-kiosk/dist "s3://${CUSTOMER_BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "$CUSTOMER_DISTRIBUTION_ID" --paths "/*"

echo "✓ Deployed customer-kiosk"
