#!/usr/bin/env bash
set -euo pipefail

echo "== ClubOps Doctor =="
echo "PWD: $(pwd)"
echo

echo "== Tooling =="
echo -n "node: " && (node -v || echo "MISSING")
echo -n "pnpm: " && (pnpm -v || echo "MISSING")
echo

echo "== Workspace sanity =="
test -f pnpm-workspace.yaml && echo "pnpm-workspace.yaml OK" || (echo "pnpm-workspace.yaml MISSING" && exit 1)
test -f packages/shared/package.json && echo "packages/shared/package.json OK" || (echo "shared package.json missing" && exit 1)
test -f services/api/package.json && echo "services/api/package.json OK" || (echo "api package.json missing" && exit 1)
echo

echo "== Install deps (idempotent) =="
pnpm install
echo

echo "== Build shared (needed for dist exports) =="
pnpm --filter @club-ops/shared build
echo

echo "== Run shared tests =="
pnpm --filter @club-ops/shared test
echo

echo "== Run api tests =="
pnpm --filter @club-ops/api test
echo

echo "== Typecheck all =="
pnpm typecheck
echo

echo "== Lint all =="
pnpm lint
echo

echo "== Done =="
