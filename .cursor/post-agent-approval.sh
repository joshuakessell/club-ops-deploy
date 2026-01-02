#!/usr/bin/env bash
set -euo pipefail

# Run this AFTER you click “Apply” on the chosen agent worktree.
# Installs deps, starts DB, runs migrations, seeds, then runs sanity checks.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Ensure pnpm is available if using Corepack
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

pnpm install --frozen-lockfile

# DB (Postgres via docker compose), then migrate + seed
pnpm --filter @club-ops/api db:start
pnpm --filter @club-ops/api db:migrate
pnpm --filter @club-ops/api seed || true

# Sanity checks
pnpm typecheck
pnpm lint

echo "✅ Post-approval setup complete"
EOF && printf '%s\n' '[worktree-setup] [1] done' && printf '%s\n' '[worktree-setup] [2] $ chmod +x "$ROOT_WORKTREE_PATH/.cursor/post-agent-approval.sh"' && chmod +x "$ROOT_WORKTREE_PATH/.cursor/post-agent-approval.sh" && printf '%s\n' '[worktree-setup] [2] done' && printf '%s\n' '[worktree-setup] [3] $ echo "✅ Post-approval script created at: $ROOT_WORKTREE_PATH/.cursor/post-agent-approval.sh"' && echo "✅ Post-approval script created at: $ROOT_WORKTREE_PATH/.cursor/post-agent-approval.sh" && printf '%s\n' '[worktree-setup] [3] done' && printf '%s\n' '[worktree-setup] [4] $ echo "Run it after you Apply the approved agent: .cursor/post-agent-approval.sh"' && echo "Run it after you Apply the approved agent: .cursor/post-agent-approval.sh" && printf '%s\n' '[worktree-setup] [4] done'