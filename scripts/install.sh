#!/usr/bin/env bash
set -Eeuo pipefail

# DrSai desktop installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hepai-lab/drsai/main/scripts/install.sh | bash -s -- --skip-setup
#
# Options:
#   --skip-setup
#   --install-dir PATH
#   --drsai-home PATH
#   --repo-url URL
#   --branch NAME
#   --python PYTHON
#   --dev-source PATH

DRSAI_HOME="${DRSAI_HOME:-"$HOME/.drsai"}"
INSTALL_DIR="${DRSAI_INSTALL_DIR:-"$DRSAI_HOME/drsai-agent"}"
REPO_URL="${DRSAI_REPO_URL:-"https://github.com/hepai-lab/drsai.git"}"
BRANCH="${DRSAI_BRANCH:-"main"}"
PYTHON_BIN="${DRSAI_PYTHON:-}"
DEV_SOURCE="${DRSAI_DEV_SOURCE:-}"
SKIP_SETUP=0
INSTALL_DIR_WAS_SET="${DRSAI_INSTALL_DIR:+1}"

log() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '1,25p' "$0" 2>/dev/null || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-setup) SKIP_SETUP=1; shift ;;
    --install-dir)
      INSTALL_DIR="${2:-}"; [[ -n "$INSTALL_DIR" ]] || die "--install-dir requires a path"; INSTALL_DIR_WAS_SET=1; shift 2 ;;
    --drsai-home)
      DRSAI_HOME="${2:-}"; [[ -n "$DRSAI_HOME" ]] || die "--drsai-home requires a path"; shift 2 ;;
    --repo-url)
      REPO_URL="${2:-}"; [[ -n "$REPO_URL" ]] || die "--repo-url requires a URL"; shift 2 ;;
    --branch)
      BRANCH="${2:-}"; [[ -n "$BRANCH" ]] || die "--branch requires a branch name"; shift 2 ;;
    --python)
      PYTHON_BIN="${2:-}"; [[ -n "$PYTHON_BIN" ]] || die "--python requires a Python executable"; shift 2 ;;
    --dev-source)
      DEV_SOURCE="${2:-}"; [[ -n "$DEV_SOURCE" ]] || die "--dev-source requires a path"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [[ -z "$INSTALL_DIR_WAS_SET" ]]; then
  INSTALL_DIR="$DRSAI_HOME/drsai-agent"
fi

log "DrSai installer starting..."
log "DrSai home: $DRSAI_HOME"
log "Install dir: $INSTALL_DIR"
log "Repository: $REPO_URL"
log "Branch: $BRANCH"

mkdir -p "$DRSAI_HOME"

find_python() {
  if [[ -n "$PYTHON_BIN" ]]; then
    if command -v "$PYTHON_BIN" >/dev/null 2>&1; then command -v "$PYTHON_BIN"; return; fi
    [[ -x "$PYTHON_BIN" ]] || die "Python executable not found: $PYTHON_BIN"
    printf '%s\n' "$PYTHON_BIN"; return
  fi
  if command -v python3 >/dev/null 2>&1; then command -v python3; return; fi
  if command -v python >/dev/null 2>&1; then command -v python; return; fi
  die "Python >= 3.11 is required but was not found."
}

PYTHON_BIN="$(find_python)"
log "Python: $PYTHON_BIN"

PY_VERSION="$($PYTHON_BIN - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"

case "$PY_VERSION" in
  3.11|3.12|3.13|3.14*) ;;
  *) die "Python >= 3.11 is required, found $PY_VERSION" ;;
esac

if ! command -v git >/dev/null 2>&1; then
  die "git is required but was not found."
fi

log "Checking git..."
git --version >/dev/null

if [[ -n "$DEV_SOURCE" ]]; then
  log "Using local development source: $DEV_SOURCE"
  [[ -d "$DEV_SOURCE" ]] || die "Development source does not exist: $DEV_SOURCE"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -e "$INSTALL_DIR" && ! -L "$INSTALL_DIR" ]]; then
    warn "Install dir exists and is not a symlink: $INSTALL_DIR"
    warn "Using existing directory in place."
  else
    rm -f "$INSTALL_DIR"
    ln -s "$DEV_SOURCE" "$INSTALL_DIR"
  fi
else
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Updating existing repository..."
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || warn "git pull failed; continuing with existing checkout"
  else
    log "Cloning DrSai repository..."
    rm -rf "$INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR"
PACKAGE_DIR="$INSTALL_DIR/python/packages/drsai"
[[ -f "$PACKAGE_DIR/pyproject.toml" ]] || die "Cannot find DrSai Python package at $PACKAGE_DIR"

VENV_DIR="$INSTALL_DIR/venv"
log "Creating virtual environment..."
"$PYTHON_BIN" -m venv "$VENV_DIR"

VENV_PYTHON="$VENV_DIR/bin/python"
[[ -x "$VENV_PYTHON" ]] || die "Virtualenv Python not found: $VENV_PYTHON"

log "Upgrading pip..."
"$VENV_PYTHON" -m pip install --upgrade pip setuptools wheel

log "Installing DrSai package..."
"$VENV_PYTHON" -m pip install -e "$PACKAGE_DIR"

WRAPPER="$INSTALL_DIR/drsai"
log "Writing DrSai wrapper..."
cat > "$WRAPPER" <<WRAPPER_EOF
#!/usr/bin/env bash
set -e
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export DRSAI_HOME="\${DRSAI_HOME:-$DRSAI_HOME}"
exec "\$DIR/venv/bin/python" -m drsai.backend.run_cli "\$@"
WRAPPER_EOF
chmod +x "$WRAPPER"

if [[ ! -f "$DRSAI_HOME/.env" ]]; then
  log "Creating default .env..."
  cat > "$DRSAI_HOME/.env" <<'ENV_EOF'
# DrSai environment
# Configure in DrSai Desktop or uncomment and fill:
# HEPAI_API_KEY=
ENV_EOF
fi

if [[ ! -f "$DRSAI_HOME/config.yaml" ]]; then
  log "Creating default config.yaml..."
  cat > "$DRSAI_HOME/config.yaml" <<'CONFIG_EOF'
model:
  provider: "anthropic"
  default: "hepai/minimax-m2.7-highspeed"
  base_url: "https://aiapi.ihep.ac.cn/apiv2/anthropic"
  streaming: true
smart_model_routing:
  enabled: false
CONFIG_EOF
fi

log "Verifying DrSai installation..."
if ! "$WRAPPER" --version >/dev/null 2>&1; then
  warn "drsai --version failed. Trying Python import check..."
  "$VENV_PYTHON" - <<'PY'
import drsai
print("drsai import ok")
PY
fi

log "drsai command ready: $WRAPPER"

if [[ "$SKIP_SETUP" -eq 0 ]]; then
  log "Setup was not skipped. Configure API keys through DrSai Desktop."
fi

log "Installation complete."
