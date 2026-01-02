#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf "\n[%s] %s\n" "$(date +"%H:%M:%S")" "$*"; }
fail() { printf "\nERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing '$1'. $2"
}

log "OS check"
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This script is for macOS. Detected: $(uname -s)"
fi

log "Xcode Command Line Tools check"
if ! xcode-select -p >/dev/null 2>&1; then
  fail "Xcode Command Line Tools not installed. Run: xcode-select --install"
fi

log "Homebrew check"
if ! command -v brew >/dev/null 2>&1; then
  fail "Homebrew not found. Install from brew.sh, then re-run this script."
fi

log "Node + pnpm check"
require_cmd node "Install Node >= 18 (Node 20+ recommended)."
require_cmd pnpm "Install pnpm (repo pins pnpm via packageManager field)."

NODE_VERSION="$(node -v | sed 's/^v//')"
log "Node version: v$NODE_VERSION"
PNPM_VERSION="$(pnpm -v)"
log "pnpm version: $PNPM_VERSION"

log "Docker check"
require_cmd docker "Install Docker Desktop for Mac and ensure 'docker' is on PATH."
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but not running. Start Docker Desktop, then re-run."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose not available. Update Docker Desktop."
fi

log "Install dependencies"
pnpm install

log "Free dev ports (optional, but useful)"
if pnpm -w -s run kill-ports >/dev/null 2>&1; then
  pnpm -w run kill-ports
else
  log "kill-ports script not available or failed. Continuing."
fi

log "Start Postgres in Docker"
pnpm db:start

log "Run migrations"
pnpm db:migrate

log "Seed database"
pnpm db:seed

log "Repo scan (typecheck, lint, tests, build)"
# Prefer the repo doctor script if present, otherwise run the full sequence.
if pnpm -w -s run doctor >/dev/null 2>&1; then
  pnpm -w run doctor
else
  pnpm -w run typecheck
  pnpm -w run lint
  pnpm -w run test
  pnpm -w run build
fi

log "Done. Next: pnpm dev"
