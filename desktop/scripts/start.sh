#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DrSai Desktop — One-click start script
#
# Starts the DrSai API server first, waits for it to be healthy, then launches
# the Electron desktop app. Both processes are cleaned up on exit.
#
# Usage:
#   ./scripts/start.sh                     # default port 8642
#   DRSAI_API_PORT=18642 ./scripts/start.sh # custom port
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DRSAI_API_PORT="${DRSAI_API_PORT:-8642}"
DRSAI_API_HOST="${DRSAI_API_HOST:-127.0.0.1}"
API_URL="http://${DRSAI_API_HOST}:${DRSAI_API_PORT}"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         DrSai Desktop Launcher               ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Cleanup on exit ─────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Shutting down...${NC}"
    if [ -n "${DRSAI_API_PID:-}" ]; then
        kill "$DRSAI_API_PID" 2>/dev/null || true
        wait "$DRSAI_API_PID" 2>/dev/null || true
        echo -e "${GREEN}✅ API server stopped${NC}"
    fi
    exit 0
}
trap cleanup INT TERM EXIT

# ── Step 1: Start DrSai API Server ──────────────────────────────────────────
echo -e "${CYAN}[1/3]${NC} Starting DrSai API server on ${API_URL}..."

if [ -f "$PROJECT_DIR/drsai_api_server.py" ]; then
    API_SERVER_SCRIPT="$PROJECT_DIR/drsai_api_server.py"
else
    # Try the drsai package path as fallback
    API_SERVER_SCRIPT="$PROJECT_DIR/drsai_api_server.py"
fi

python "$API_SERVER_SCRIPT" &
DRSAI_API_PID=$!

# ── Step 2: Wait for API to be healthy ──────────────────────────────────────
echo -e "${CYAN}[2/3]${NC} Waiting for API server to be ready..."

MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s "${API_URL}/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API server is ready${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    printf "."
    sleep 1
done

if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo -e "${RED}❌ API server failed to start within ${MAX_RETRIES}s${NC}"
    exit 1
fi

# ── Step 3: Launch Electron Desktop ─────────────────────────────────────────
echo -e "${CYAN}[3/3]${NC} Launching DrSai Desktop..."

cd "$PROJECT_DIR/drsai-desktop"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

npm run dev &
ELECTRON_PID=$!

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ DrSai Desktop is running!                ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  API Server:  ${API_URL}                  ║${NC}"
echo -e "${GREEN}║  Health:      ${API_URL}/health           ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all services           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"

# Wait for Electron to exit
wait $ELECTRON_PID 2>/dev/null || true
