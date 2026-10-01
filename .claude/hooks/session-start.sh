#!/bin/bash
# Prepares a Claude Code on the web session: dependencies, dummy local secrets,
# and the local D1 schema, so lint, typecheck, vitest and Playwright work at once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install, not npm ci: the container state is cached after this hook.
npm install --no-audit --no-fund

# Dummy secrets (SESSION_SECRET etc.); never overwrite an existing file.
if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
fi

# Idempotent: applies only migrations that are missing.
npm run db:migrate:local

# Chromium is preinstalled at PLAYWRIGHT_BROWSERS_PATH; do not download another.
