#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DrSai Desktop — Development mode
#
# Starts the API gateway and Electron in dev mode with hot reload.
#
# Usage:
#   ./scripts/dev.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# desktop/scripts/ → desktop/ → project root
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
DRSAI_API_PORT="${DRSAI_API_PORT:-8642}"
API_URL="http://127.0.0.1:${DRSAI_API_PORT}"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}🔧 DrSai Desktop — Development Mode${NC}"
echo ""

cleanup() {
    if [ -n "${DRSAI_API_PID:-}" ]; then
        kill "$DRSAI_API_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup INT TERM

# Start API gateway in background (with hot reload via uvicorn --reload)
echo -e "${CYAN}Starting API gateway (with hot reload)...${NC}"
PYTHONPATH="$PROJECT_DIR/python/packages/drsai/src${PYTHONPATH:+:$PYTHONPATH}" \
DRSAI_API_PORT="$DRSAI_API_PORT" \
uvicorn drsai.backend.gateway:app \
    --host 127.0.0.1 \
    --port "$DRSAI_API_PORT" \
    --reload \
    --reload-dir "$PROJECT_DIR/python/packages/drsai/src/drsai/backend" &
DRSAI_API_PID=$!

# Wait for API
echo -n "Waiting for API..."
for i in $(seq 1 30); do
    if curl -s "${API_URL}/health" > /dev/null 2>&1; then
        echo -e " ${GREEN}ready${NC}"
        break
    fi
    printf "."
    sleep 1
done

# Start Electron dev
# DRSAI_DEV_SKIP_INSTALL=1 tells the Electron app to skip the bootstrap
# (git clone → venv → pip install). The gateway is already running locally
# from this very script, so we don't want the UI re-running the installer.
echo -e "${CYAN}Starting Electron dev mode...${NC}"
cd "$PROJECT_DIR/desktop/drsai-desktop"
DRSAI_DEV_SKIP_INSTALL=1 npm run dev

cleanup
