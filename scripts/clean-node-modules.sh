#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Cleaning node_modules under:"
echo "$ROOT_DIR"
echo

find "$ROOT_DIR" \
  -type d \
  -name "node_modules" \
  -prune \
  -exec rm -rf {} +

echo
echo "All node_modules folders removed."
