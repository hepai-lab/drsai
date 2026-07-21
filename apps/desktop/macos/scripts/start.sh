#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "start.sh supports the formal macOS desktop shell only. Use windows-desktop-dev.cmd on Windows." >&2
  exit 1
fi

cd "$REPO_ROOT/apps/desktop"
if [[ ! -d node_modules ]]; then npm ci; fi
npm run dev --workspace opendrsai-macos-desktop
