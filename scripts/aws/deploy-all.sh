#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"$ROOT_DIR/scripts/aws/deploy-api.sh"
"$ROOT_DIR/scripts/aws/deploy-employee-register.sh"
"$ROOT_DIR/scripts/aws/deploy-customer-kiosk.sh"

