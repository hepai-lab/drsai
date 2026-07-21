#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DrSai Desktop — macOS Dev Setup Stub
# ==========================================
# Creates stub files in ~/.drsai so the Electron app finds DRSAI_PYTHON
# without running the full installer.  Run once, then use dev.sh / start.sh.
#
# Usage:
#   ./apps/desktop/macos/scripts/setup-dev.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Find Python ─────────────────────────────────────────────────────────────
PYTHON_PATH="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON_PATH" ]; then
    echo -e "${RED}ERROR: python not found. Activate your venv/conda first!${NC}"
    exit 1
fi
echo -e "${GREEN}Python: $PYTHON_PATH${NC}"

# ── Auto-detect project root ────────────────────────────────────────────────
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
echo -e "${GREEN}Project: $REPO_ROOT${NC}"

# ── Create stub directories ─────────────────────────────────────────────────
STUB_BIN="$HOME/.drsai/drsai-agent/venv/bin"
DOT_LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$STUB_BIN" "$DOT_LOCAL_BIN"

# ── python stub ─────────────────────────────────────────────────────────────
PYTHON_STUB="$STUB_BIN/python"
if [ ! -e "$PYTHON_STUB" ]; then
    ln -sf "$PYTHON_PATH" "$PYTHON_STUB"
    echo -e "${GREEN}python stub → $PYTHON_STUB${NC}"
else
    echo -e "${GREEN}python stub already exists${NC}"
fi

# ── drsai CLI stub ──────────────────────────────────────────────────────────
DRSAI_STUB="$DOT_LOCAL_BIN/drsai"
cat > "$DRSAI_STUB" << 'PYEOF'
#!/usr/bin/env bash
exec python3 -m drsai.backend.run_cli "$@"
PYEOF
chmod +x "$DRSAI_STUB"
echo -e "${GREEN}drsai CLI → $DRSAI_STUB${NC}"

# ── DRSAI_HOME ──────────────────────────────────────────────────────────────
export DRSAI_HOME="$HOME/.drsai"
mkdir -p "$DRSAI_HOME"

# Write to shell profile if not already there
SHELL_RC=""
case "$SHELL" in
    */zsh) SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
esac
if [ -n "$SHELL_RC" ] && ! grep -q "DRSAI_HOME" "$SHELL_RC" 2>/dev/null; then
    echo "export DRSAI_HOME=\"\$HOME/.drsai\"" >> "$SHELL_RC"
    echo -e "${CYAN}Added DRSAI_HOME to $SHELL_RC${NC}"
fi

echo ""
echo -e "${CYAN}Done! Stub install created.${NC}"
echo -e "Now run: ${GREEN}./apps/desktop/macos/scripts/dev.sh${NC} (hot reload) or ${GREEN}./apps/desktop/macos/scripts/start.sh${NC} (one-click)"
