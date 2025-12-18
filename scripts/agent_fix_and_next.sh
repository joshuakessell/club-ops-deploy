mkdir -p scripts
cat > scripts/agent_fix_and_next.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Agent Fix and Next =="
echo "Repo: $ROOT_DIR"
echo

fail() { echo "ERROR: $*" >&2; exit 1; }

need_file() {
  [[ -f "$1" ]] || fail "Missing file: $1"
}

echo "== 1) Basic checks =="
command -v node >/dev/null 2>&1 || fail "node not found in PATH"
command -v pnpm >/dev/null 2>&1 || fail "pnpm not found in PATH"
echo "node: $(node -v)"
echo "pnpm: $(pnpm -v)"
echo

need_file "packages/shared/package.json"
need_file "services/api/package.json"

echo "== 2) Ensure runtime enums exist (RoomStatus/RoomType) =="
mkdir -p packages/shared/src

# Write enums.ts (idempotent). This fixes the classic "RoomStatus is undefined" failure.
cat > packages/shared/src/enums.ts <<'EOT'
export enum RoomStatus {
  DIRTY = "DIRTY",
  CLEANING = "CLEANING",
  CLEAN = "CLEAN",

  OCCUPIED = "OCCUPIED",
  RESERVED = "RESERVED",
  OUT_OF_SERVICE = "OUT_OF_SERVICE",
}

export enum RoomType {
  REGULAR = "REGULAR",
  DELUXE = "DELUXE",
}
EOT

echo "Wrote packages/shared/src/enums.ts"
echo

echo "== 3) Ensure shared package entry exports enums/transitions/types =="
cat > packages/shared/src/index.ts <<'EOT'
export * from "./enums";
export * from "./transitions";
export * from "./types";
EOT
echo "Wrote packages/shared/src/index.ts"
echo

echo "== 4) Ensure shared tsconfig outputs dist/ =="
# If your tsconfig already exists, we will minimally enforce outDir/rootDir/declaration.
if [[ -f "packages/shared/tsconfig.json" ]]; then
  echo "Updating packages/shared/tsconfig.json (safe enforcement of dist output)"
else
  echo "Creating packages/shared/tsconfig.json"
fi

cat > packages/shared/tsconfig.json <<'EOT'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": false
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
EOT
echo

echo "== 5) Ensure shared builds before tests (exports point to dist) =="
# Add pretest if missing, without requiring jq.
SHARED_PKG="packages/shared/package.json"
if ! grep -q '"pretest"' "$SHARED_PKG"; then
  # Insert pretest right after dev script line if possible, else after "scripts": {
  tmp="$(mktemp)"
  awk '
    BEGIN { inserted=0 }
    /"scripts"[[:space:]]*:[[:space:]]*{/ && inserted==0 {
      print
      next
    }
    /"dev"[[:space:]]*:[[:space:]]*"tsc --watch"[[:space:]]*,/ && inserted==0 {
      print
      print "    \"pretest\": \"pnpm build\","
      inserted=1
      next
    }
    { print }
    END {
      if (inserted==0) {
        # Fallback: do nothing here; user can add manually if formatting differs
      }
    }
  ' "$SHARED_PKG" > "$tmp"

  # If awk inserted, replace. If not inserted (format differs), we will fail with instructions.
  if grep -q '"pretest": "pnpm build"' "$tmp"; then
    mv "$tmp" "$SHARED_PKG"
    echo "Added pretest to packages/shared/package.json"
  else
    rm -f "$tmp"
    echo "Could not auto-insert pretest (package.json formatting unexpected)."
    echo "Please add this line in packages/shared/package.json scripts:"
    echo "  \"pretest\": \"pnpm build\","
  fi
else
  echo "pretest already present in packages/shared/package.json"
fi
echo

echo "== 6) Install deps =="
pnpm install
echo

echo "== 7) Build shared and verify dist exists =="
pnpm --filter @club-ops/shared build

if [[ ! -f "packages/shared/dist/index.js" ]]; then
  echo "Shared build completed but dist/index.js not found."
  echo "Listing packages/shared/dist:"
  ls -la packages/shared/dist || true
  fail "Shared package did not produce dist/index.js. Check packages/shared/tsconfig.json and src/index.ts."
fi
echo "Shared dist OK"
echo

echo "== 8) Run tests (next step gate) =="
pnpm test
echo

echo "== 9) Next step: start dev servers =="
echo "Starting pnpm dev. Press Ctrl+C to stop."
pnpm dev
EOF

chmod +x scripts/agent_fix_and_next.sh
