#!/usr/bin/env bash
# Prepare a real, isolated macOS development Runtime and desktop dependency tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PACKAGE_ROOT="$REPO_ROOT/cores/python/packages/drsai"
DESKTOP_ROOT="$REPO_ROOT/apps/desktop"
DRSAI_HOME="${DRSAI_HOME:-$HOME/.drsai-dev}"
RUNTIME_ROOT="$DRSAI_HOME/drsai-agent"
VENV_ROOT="$RUNTIME_ROOT/venv"
PYTHON="$VENV_ROOT/bin/python"
DRSAI_CLI="$RUNTIME_ROOT/drsai"

resolve_node_22() {
  local current candidate
  current="$(command -v node 2>/dev/null || true)"
  if [[ -n "$current" ]] && "$current" -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)' >/dev/null 2>&1; then
    return
  fi
  for candidate in "$HOME"/.nvm/versions/node/v22*/bin/node "$HOME/.volta/bin/node" /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)' >/dev/null 2>&1; then
      export PATH="$(dirname "$candidate"):$PATH"
      return
    fi
  done
  echo "Node.js 22 is required. Run 'nvm install 22 && nvm use 22'." >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup-dev.sh supports macOS only." >&2
  exit 1
fi

resolve_node_22

SYSTEM_PYTHON="${OPENDRSAI_DEV_PYTHON:-$(command -v python3 || true)}"
if [[ -z "$SYSTEM_PYTHON" ]]; then
  echo "Python 3.11 or newer is required." >&2
  exit 1
fi

PYTHON_VERSION="$($SYSTEM_PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PYTHON_MAJOR="${PYTHON_VERSION%%.*}"
PYTHON_MINOR="${PYTHON_VERSION#*.}"
if (( PYTHON_MAJOR != 3 || PYTHON_MINOR < 11 )); then
  echo "Python 3.11 or newer is required; found $PYTHON_VERSION." >&2
  exit 1
fi

mkdir -p "$RUNTIME_ROOT"
if [[ ! -x "$PYTHON" ]]; then
  "$SYSTEM_PYTHON" -m venv "$VENV_ROOT"
fi

"$PYTHON" -m pip install --disable-pip-version-check --upgrade pip
"$PYTHON" -m pip install --disable-pip-version-check --editable "$PACKAGE_ROOT"
ln -f "$VENV_ROOT/bin/drsai" "$DRSAI_CLI"
chmod 700 "$DRSAI_CLI"

"$PYTHON" -c 'import drsai, fastapi, uvicorn; print(drsai.__file__)'
"$DRSAI_CLI" --help >/dev/null

cd "$DESKTOP_ROOT"
npm ci
npm run typecheck --workspace opendrsai-macos-desktop

echo "macOS development Runtime is ready: $RUNTIME_ROOT"
echo "Start with: $SCRIPT_DIR/dev.sh"
