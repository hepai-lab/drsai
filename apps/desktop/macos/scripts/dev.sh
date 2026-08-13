#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DrSai Desktop — Development mode
#
# Starts the API gateway and Electron in dev mode with hot reload.
#
# Usage:
#   ./apps/desktop/macos/scripts/dev.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
DESKTOP_ROOT="$REPO_ROOT/apps/desktop"
DRSAI_HOME="${DRSAI_HOME:-$HOME/.drsai-dev}"

# GUI shells and older developer machines often resolve /usr/local/bin/node
# before nvm. Release and CI use Node 22, so development must use the same
# major version instead of silently accepting a different runtime.
node_is_compatible() {
    local node_bin="$1"
    "$node_bin" -e '
      const [major] = process.versions.node.split(".").map(Number)
      process.exit(major === 22 ? 0 : 1)
    ' >/dev/null 2>&1
}

resolve_node_runtime() {
    local current_node candidate
    current_node="$(command -v node 2>/dev/null || true)"
    if [ -n "$current_node" ] && node_is_compatible "$current_node"; then
        return
    fi

    for candidate in "$HOME"/.nvm/versions/node/v22*/bin/node "$HOME/.volta/bin/node" /opt/homebrew/bin/node; do
        if [ -x "$candidate" ] && node_is_compatible "$candidate"; then
            export PATH="$(dirname "$candidate"):$PATH"
            return
        fi
    done

    echo "Node.js 22 is required to match CI and release builds." >&2
    if [ -n "$current_node" ]; then
        echo "Current runtime: $current_node ($("$current_node" -v 2>/dev/null || echo unknown))" >&2
    else
        echo "Node.js was not found on PATH." >&2
    fi
    exit 1
}

resolve_node_runtime
if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found next to the selected Node.js runtime: $(command -v node)" >&2
    exit 1
fi
if [ -n "${OPENDRSAI_DEV_RUNTIME_PYTHON:-}" ]; then
    DRSAI_DEV_PYTHON="$OPENDRSAI_DEV_RUNTIME_PYTHON"
elif [ -n "${VIRTUAL_ENV:-}" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
    DRSAI_DEV_PYTHON="$VIRTUAL_ENV/bin/python"
elif [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    DRSAI_DEV_PYTHON="$REPO_ROOT/.venv/bin/python"
else
    DRSAI_DEV_PYTHON="$DRSAI_HOME/drsai-agent/venv/bin/python"
fi
DRSAI_API_PORT="${DRSAI_API_PORT:-28642}"
API_URL="http://127.0.0.1:${DRSAI_API_PORT}"

# Keep the macOS source launcher aligned with windows-desktop-dev.cmd:
# development profile, development identity, and development model routes.
PLATFORM_PORTAL_URL="https://ai-dev.ihep.ac.cn"
PLATFORM_MODEL_BASE_URL="https://ai-dev.ihep.ac.cn/apiv2/v1"
export OPENDRSAI_OIDC_ISSUER="${OPENDRSAI_OIDC_ISSUER:-$PLATFORM_PORTAL_URL/api}"
export OPENDRSAI_PLATFORM_BASE_URL="${OPENDRSAI_PLATFORM_BASE_URL:-$PLATFORM_PORTAL_URL}"
export OPENDRSAI_PLATFORM_API_BASE_URL="${OPENDRSAI_PLATFORM_API_BASE_URL:-$PLATFORM_MODEL_BASE_URL}"
export OPENDRSAI_MODEL_BASE_URL="${OPENDRSAI_MODEL_BASE_URL:-$PLATFORM_MODEL_BASE_URL}"
export DRSAI_API_PORT
export DRSAI_HOME
export OPENDRSAI_LAUNCH_HOME="${OPENDRSAI_LAUNCH_HOME:-$DRSAI_HOME}"
export OPENDRSAI_DEV_HOME="${OPENDRSAI_DEV_HOME:-$DRSAI_HOME}"
export OPENDRSAI_ELECTRON_USER_DATA="${OPENDRSAI_ELECTRON_USER_DATA:-$DRSAI_HOME/electron-user-data}"
export OPENDRSAI_DESKTOP_LAUNCH_MODE="development"
export VITE_OPENDRSAI_LAUNCH_MODE="development"
export OPENDRSAI_DESKTOP_DEV="1"
export OPENDRSAI_DESKTOP_RUNTIME="1"
export OPENDRSAI_ACTIVE_PLATFORM="development"
export OPENDRSAI_OIDC_ONLY="1"
# Source Electron cannot reliably reclaim a custom URL scheme from an installed
# legacy OA bundle on macOS. The loopback callback focuses OpenDrSai directly.
export OPENDRSAI_OIDC_AUTH_COMPLETE_AUTO_OPEN="0"
export OPENDRSAI_LAUNCH_GATEWAY_PORT="$DRSAI_API_PORT"
export OPENDRSAI_DEV_GATEWAY_PORT="$DRSAI_API_PORT"
export OPENDRSAI_GATEWAY_PORT="$DRSAI_API_PORT"
export OPENDRSAI_GATEWAY_STARTUP="external"
export OPENDRSAI_RUNTIME_PERSIST="0"
export DRSAI_GATEWAY_DEV_MANAGED="1"
export DRSAI_REPO="$REPO_ROOT"
export OPENDRSAI_RUNTIME_ROOT="$DRSAI_HOME/drsai-agent"
export OPENDRSAI_VOICE_TTS_RUNTIME="gateway-provider"
export SYSTEM_SKILLS_DIR="${SYSTEM_SKILLS_DIR:-$REPO_ROOT/skills/skills}"
unset HEPAI_API_KEY OPENAI_API_KEY OPENAI_ADMIN_KEY

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}🔧 DrSai Desktop — Development Mode${NC}"
echo ""

if [ ! -x "$DRSAI_DEV_PYTHON" ]; then
    echo "Development Runtime is missing. Run $SCRIPT_DIR/setup-dev.sh first." >&2
    exit 1
fi

if ! "$DRSAI_DEV_PYTHON" -c 'import encodings, fastapi, uvicorn' >/dev/null 2>&1; then
    echo "Development Python is incomplete: $DRSAI_DEV_PYTHON" >&2
    echo "Activate a Python 3.11+ environment with the project dependencies installed." >&2
    exit 1
fi

echo -e "${CYAN}Using Python Runtime: $DRSAI_DEV_PYTHON${NC}"
echo -e "${CYAN}Using Node Runtime: $(command -v node) ($(node -v))${NC}"

# The full Agent Runtime authenticates every Desktop-to-Gateway request with
# an installation-scoped token. Create/read it before either process starts so
# the shell health probe, Python Runtime, and Electron all share one identity.
export OPENDRSAI_GATEWAY_INSTANCE_TOKEN="$("$DRSAI_DEV_PYTHON" -c '
import os, pathlib, re, secrets
path = pathlib.Path(os.environ["DRSAI_HOME"]) / "runtime" / "instance-token"
path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
token = path.read_text(encoding="ascii").strip() if path.exists() and not path.is_symlink() else ""
if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
    token = secrets.token_urlsafe(32)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(token, encoding="ascii")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
print(token)
')"

cd "$DESKTOP_ROOT"
if [ ! -f node_modules/react/jsx-dev-runtime.js ] || \
   [ ! -f node_modules/electron/package.json ] || \
   [ ! -f node_modules/vite/package.json ]; then
    echo -e "${YELLOW}Installing desktop workspace dependencies...${NC}"
    npm install
fi

cleanup() {
    local exit_status=$?
    trap - EXIT INT TERM
    if [ -n "${DRSAI_API_PID:-}" ] && kill -0 "$DRSAI_API_PID" 2>/dev/null; then
        # Electron owns the foreground and exits first. Only then ask uvicorn
        # to drain, so renderer IPC cannot race a disappearing Gateway.
        kill -TERM "$DRSAI_API_PID" 2>/dev/null || true
        for _ in $(seq 1 50); do
            kill -0 "$DRSAI_API_PID" 2>/dev/null || break
            sleep 0.1
        done
        if kill -0 "$DRSAI_API_PID" 2>/dev/null; then
            kill -KILL "$DRSAI_API_PID" 2>/dev/null || true
        fi
        wait "$DRSAI_API_PID" 2>/dev/null || true
    fi
    return "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Start the API gateway in the background. Backend hot reload is opt-in because
# macOS privacy controls can reject recursive file watching. Electron/Vite hot
# reload remains enabled regardless.
UVICORN_ARGS=(
    drsai.backend.gateway:app
    --host 127.0.0.1
    --port "$DRSAI_API_PORT"
)
if [ "${DRSAI_GATEWAY_HOT_RELOAD:-0}" = "1" ]; then
    UVICORN_ARGS+=(
        --reload
        --reload-dir "$REPO_ROOT/cores/python/packages/drsai/src/drsai/backend"
    )
    echo -e "${CYAN}Starting API gateway (with hot reload)...${NC}"
else
    echo -e "${CYAN}Starting API gateway...${NC}"
fi
PYTHONPATH="$REPO_ROOT/cores/python/packages/drsai/src${PYTHONPATH:+:$PYTHONPATH}" \
DRSAI_API_PORT="$DRSAI_API_PORT" \
"$DRSAI_DEV_PYTHON" -m uvicorn "${UVICORN_ARGS[@]}" &
DRSAI_API_PID=$!

# Wait for API
echo -n "Waiting for API..."
API_READY=0
for i in $(seq 1 30); do
    if curl --noproxy '*' -fsS \
        -H "X-OpenDrSai-Gateway-Token: $OPENDRSAI_GATEWAY_INSTANCE_TOKEN" \
        "${API_URL}/health" >/dev/null 2>&1; then
        echo -e " ${GREEN}ready${NC}"
        API_READY=1
        break
    fi
    if ! kill -0 "$DRSAI_API_PID" 2>/dev/null; then
        echo " Gateway process exited." >&2
        break
    fi
    printf "."
    sleep 1
done

if [ "$API_READY" != "1" ] || ! kill -0 "$DRSAI_API_PID" 2>/dev/null; then
    echo "API gateway did not become healthy within 30 seconds." >&2
    exit 1
fi

# Start Electron dev
# DRSAI_DEV_SKIP_INSTALL=1 tells the Electron app to skip the bootstrap
# (git clone → venv → pip install). The gateway is already running locally
# from this very script, so we don't want the UI re-running the installer.
echo -e "${CYAN}Starting Electron dev mode...${NC}"
if [ "$(uname -s)" != "Darwin" ]; then
    echo "This launcher targets the formal macOS desktop shell. Use apps/desktop/windows-desktop-dev.cmd on Windows." >&2
    exit 1
fi
cd "$DESKTOP_ROOT/macos"
OPENDRSAI_BUILD_CHANNEL=development DRSAI_DEV_SKIP_INSTALL=1 npm run dev
