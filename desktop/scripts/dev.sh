#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DrSai Desktop — Development mode
#
# Starts the API server and Electron in dev mode with hot reload.
# Best used when you're actively modifying the Electron frontend code.
#
# Usage:
#   ./scripts/dev.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
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

# Start API server in background (with hot reload via uvicorn --reload)
echo -e "${CYAN}Starting API server (with hot reload)...${NC}"
DRSAI_API_PORT="$DRSAI_API_PORT" uvicorn drsai_api_server:app \
    --host 127.0.0.1 \
    --port "$DRSAI_API_PORT" \
    --reload \
    --reload-dir "$PROJECT_DIR" &
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
echo -e "${CYAN}Starting Electron dev mode...${NC}"
cd "$PROJECT_DIR/drsai-desktop"
npm run dev

cleanup
