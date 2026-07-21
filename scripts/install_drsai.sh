#!/usr/bin/env bash
# ==============================================================================
#  OpenDrSai Installer -- Bash (Linux + macOS)
#
#  Fully self-contained: downloads portable Python 3.12 + Node.js v22 + source
#  from ihepbox cloud storage. ZERO system pollution -- no sudo, no system
#  PATH modification, no conflicts with existing Python/Node.
#
#  Usage:
#    curl -fsSL <URL>/install_drsai.sh | bash
#    bash install_drsai.sh [--install-dir /opt/drsai] [--force]
#
#  Requirements: curl, tar (both pre-installed on virtually all linux/macOS)
# ==============================================================================
set -Eeuo pipefail

# ==============================================================================
#  CONFIG -- Modify all download URLs here
# ==============================================================================
IHEPBOX="https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# Source package (full project structure, .zip format, no prebuilt dist/entry.mjs)
SRC_URL="${IHEPBOX}/hv9iGTJHvuQbRxE/download"

# Python 3.12.13 portable (python-build-standalone, .tar.gz)
# Use functions instead of associative arrays for macOS bash 3.2 compatibility
get_python_url() {
    case "$1" in
        linux-x64)    printf '%s' "${IHEPBOX}/GQtYPVjmhn3RV2X/download" ;;
        linux-arm64)  printf '%s' "${IHEPBOX}/QcqYLu2a5Nq1BD9/download" ;;
        macos-x64)    printf '%s' "${IHEPBOX}/G9kgRSzhqpLldaX/download" ;;
        macos-arm64)  printf '%s' "${IHEPBOX}/K0DCIdm9qpiBgKq/download" ;;
        *)            printf '%s' "" ;;
    esac
}

# Node.js v22.22.3 portable (official distribution)
get_node_url() {
    case "$1" in
        linux-x64)    printf '%s' "${IHEPBOX}/6pM9SJSTj2bLxZu/download" ;;
        linux-arm64)  printf '%s' "${IHEPBOX}/EmgmxX1I2XHd5oW/download" ;;
        macos-x64)    printf '%s' "${IHEPBOX}/qwrMnqbzusemhUi/download" ;;
        macos-arm64)  printf '%s' "${IHEPBOX}/70RiQ8Hzn0ZjjlO/download" ;;
        *)            printf '%s' "" ;;
    esac
}

# Install parameters
DEFAULT_INSTALL_DIR="$HOME/.drsai"
REQUIRED_SPACE_GB=2
REQUIRED_SPACE_BYTES=$((REQUIRED_SPACE_GB * 1024 * 1024 * 1024))
FORCE=0
INSTALL_DIR=""

# -- Parse args ---------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir) INSTALL_DIR="${2:?}"; shift 2 ;;
        --force)       FORCE=1; shift ;;
        -h|--help)     sed -n '2,18p' "$0" 2>/dev/null; exit 0 ;;
        *)             echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# -- Colors -------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RST='\033[0m'; C_B='\033[1m'
    C_R='\033[31m'; C_G='\033[32m'; C_Y='\033[33m'; C_C='\033[36m'; C_GRAY='\033[90m'
else
    C_RST=''; C_B=''; C_R=''; C_G=''; C_Y=''; C_C=''; C_GRAY=''
fi

# -- Logging -------------------------------------------------------------------
log()     { printf "${C_B}>${C_RST} %s\n" "$*"; }
info()    { printf "${C_C}i${C_RST}  %s\n" "$*"; }
ok()      { printf "${C_G}OK${C_RST} %s\n" "$*"; }
warn()    { printf "${C_Y}!${C_RST}  %s\n" "$*" >&2; }
err()     { printf "${C_R}X${C_RST}  %s\n" "$*" >&2; }
die()     { err "$*"; exit 1; }
section() { printf "\n${C_C}--- %s ---${C_RST}\n" "$*"; }

# -- Terminal input (works even when piped: curl | bash) ------------------------
tty_read() {
    local _var="$1"
    if [ -e /dev/tty ]; then
        read -r "$_var" < /dev/tty
    else
        read -r "$_var"
    fi
}

prompt_yes_no() {
    printf "%s [y/N]: " "$1" >&2
    if [ -e /dev/tty ]; then
        read -r REPLY < /dev/tty
    else
        read -r REPLY
    fi
    case "$(echo "$REPLY" | tr '[:upper:]' '[:lower:]')" in
        y|yes) REPLY="y" ;;
        *)     REPLY="n" ;;
    esac
}

trap 'err "Install failed at line $LINENO (exit code: $?)"' ERR

# ==============================================================================
#  1. PLATFORM DETECTION
# ==============================================================================
detect_platform() {
    section "Platform Detection"
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *)       die "Unsupported OS: $os (only linux and macOS are supported)" ;;
    esac
    case "$arch" in
        x86_64|amd64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *)             die "Unsupported architecture: $arch" ;;
    esac

    PLATFORM="${OS}-${ARCH}"
    ok "Platform: $PLATFORM"
}

# ==============================================================================
#  2. INSTALL DIRECTORY SELECTION (>=2GB)
# ==============================================================================
select_install_dir() {
    section "Install Directory"

    if [ -z "$INSTALL_DIR" ]; then
        INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    fi
    info "Default install dir: $INSTALL_DIR"

    mkdir -p "$(dirname "$INSTALL_DIR")" 2>/dev/null || true

    local check_dir avail_bytes avail_gb
    check_dir="$(dirname "$INSTALL_DIR")"

    check_disk_space() {
        local dir="$1"
        if command -v df >/dev/null 2>&1; then
            avail_bytes=$(df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4 * 1024}')
        else
            avail_bytes=$((REQUIRED_SPACE_BYTES * 2))
        fi
        [ -z "$avail_bytes" ] 2>/dev/null && avail_bytes=$((REQUIRED_SPACE_BYTES * 2))
        avail_gb=$(awk "BEGIN {printf \"%.1f\", ${avail_bytes:-0} / 1073741824}")
    }

    check_disk_space "$check_dir"

    while [ "${avail_bytes:-0}" -lt "$REQUIRED_SPACE_BYTES" ] 2>/dev/null; do
        warn "Insufficient disk space: ${avail_gb}GB < ${REQUIRED_SPACE_GB}GB"
        printf "Enter a different install directory (or press Enter to cancel): " >&2
        tty_read user_dir
        [ -n "$user_dir" ] || die "Installation cancelled by user"
        INSTALL_DIR="$user_dir"
        mkdir -p "$INSTALL_DIR"
        check_disk_space "$INSTALL_DIR"
    done

    ok "Available space: ${avail_gb}GB (>= ${REQUIRED_SPACE_GB}GB)"
    ok "Install directory: $INSTALL_DIR"
}

# ==============================================================================
#  3. EXISTING INSTALLATION CHECK
# ==============================================================================
check_existing() {
    section "Checking Existing Installation"
    local launcher="$INSTALL_DIR/bin/opendrsai"

    if [ -e "$launcher" ]; then
        warn "Found existing opendrsai installation: $launcher"

        if [ "$FORCE" -eq 1 ]; then
            info "Using --force, overwriting"
            REPLY="y"
        else
            prompt_yes_no "Overwrite? (only bin/ and packages/ will be deleted; configs and data are preserved)"
        fi

        if [ "$REPLY" = "y" ]; then
            info "Cleaning old installation (preserving configs, workspace, logs)..."
            rm -rf "$INSTALL_DIR/bin" "$INSTALL_DIR/packages" 2>/dev/null || true
            ok "Old installation cleared (bin/ + packages/)"
        else
            die "Installation cancelled by user"
        fi
    else
        ok "No existing installation found"
    fi
}

# ==============================================================================
#  4. DOWNLOAD
# ==============================================================================
download_files() {
    section "Downloading Files"

    local py_url node_url
    py_url="$(get_python_url "$PLATFORM")"
    node_url="$(get_node_url "$PLATFORM")"

    [ -n "$py_url" ]   || die "Unsupported platform: $PLATFORM (no Python URL)"
    [ -n "$node_url" ] || die "Unsupported platform: $PLATFORM (no Node URL)"

    local tmp_dir="$INSTALL_DIR/.download"
    mkdir -p "$tmp_dir"

    info "Downloading source (drsai.zip)..."
    curl -fsSL "$SRC_URL" -o "$tmp_dir/drsai.zip" || die "Source download failed"
    ok "Source: $(du -h "$tmp_dir/drsai.zip" | cut -f1)"

    info "Downloading Python 3.12.13 ($PLATFORM)..."
    curl -fsSL "$py_url" -o "$tmp_dir/python.tar.gz" || die "Python download failed"
    ok "Python: $(du -h "$tmp_dir/python.tar.gz" | cut -f1)"

    info "Downloading Node.js v22.22.3 ($PLATFORM)..."
    curl -fsSL "$node_url" -o "$tmp_dir/node.tar.xz" || die "Node download failed"
    ok "Node: $(du -h "$tmp_dir/node.tar.xz" | cut -f1)"

    DOWNLOAD_DIR="$tmp_dir"
}

# ==============================================================================
#  5. EXTRACT
# ==============================================================================
extract_all() {
    section "Extracting Files"

    local pkg_dir="$INSTALL_DIR/packages"
    mkdir -p "$pkg_dir"

    # -- Python (tar.gz -> packages/python/) --
    info "Extracting Python..."
    local py_tmp="$pkg_dir/_py_tmp"
    mkdir -p "$py_tmp"
    tar xzf "$DOWNLOAD_DIR/python.tar.gz" -C "$py_tmp"

    local py_src_dir
    if [ -d "$py_tmp/python" ]; then
        py_src_dir="$py_tmp/python"
    else
        py_src_dir=$(find "$py_tmp" -maxdepth 1 -mindepth 1 -type d | head -1)
    fi
    [ -n "$py_src_dir" ] || die "Python extraction failed: no python directory found"

    mv "$py_src_dir" "$pkg_dir/python"
    rm -rf "$py_tmp"

    local py_bin="$pkg_dir/python/bin/python3"
    [ -x "$py_bin" ] || py_bin="$pkg_dir/python/bin/python"
    [ -x "$py_bin" ] || die "Python binary not found: $pkg_dir/python/bin/"
    ok "Python: $($py_bin --version 2>&1)"

    PYTHON_BIN="$py_bin"

    # -- Node (tar.xz -> packages/node/) --
    info "Extracting Node..."
    local node_tmp="$pkg_dir/_node_tmp"
    mkdir -p "$node_tmp"
    tar xJf "$DOWNLOAD_DIR/node.tar.xz" -C "$node_tmp" 2>/dev/null || \
    tar xf "$DOWNLOAD_DIR/node.tar.xz" -C "$node_tmp"

    local node_src_dir
    node_src_dir=$(find "$node_tmp" -maxdepth 1 -type d -name "node*" | head -1)
    [ -n "$node_src_dir" ] || die "Node extraction failed: no node directory found"

    mv "$node_src_dir" "$pkg_dir/node"
    rm -rf "$node_tmp"

    local node_bin="$pkg_dir/node/bin/node"
    [ -x "$node_bin" ] || die "Node binary not found: $pkg_dir/node/bin/"
    ok "Node: $($node_bin -v 2>&1)"

    NODE_BIN="$node_bin"

    # -- Source (zip -> packages/src/) --
    info "Extracting source..."
    mkdir -p "$pkg_dir/src"
    "$PYTHON_BIN" -c "
import zipfile, sys
zipfile.ZipFile('$DOWNLOAD_DIR/drsai.zip').extractall('$pkg_dir/src')
" || die "Source extraction failed"

    # Detect source root (may extract to drsai/ or directly to apps/ cores/)
    local src_root=""
    if [ -d "$pkg_dir/src/apps" ] && [ -d "$pkg_dir/src/cores" ]; then
        src_root="$pkg_dir/src"
    else
        for d in "$pkg_dir/src"/*/; do
            if [ -d "${d}apps" ] && [ -d "${d}cores" ]; then
                src_root="${d%/}"
                break
            fi
        done
    fi

    [ -n "$src_root" ] || die "Source extraction failed: apps/ and cores/ not found"
    ok "Source root: $src_root"

    [ -f "$src_root/apps/ui-tui/package.json" ] || die "apps/ui-tui/package.json not found"
    [ -f "$src_root/cores/python/packages/drsai/pyproject.toml" ] || die "drsai/pyproject.toml not found"
    ok "Source verification passed"

    SRC_ROOT="$src_root"

    rm -rf "$DOWNLOAD_DIR"
    ok "Temp download files cleaned"
}

# ==============================================================================
#  6. SETUP PYTHON VENV + INSTALL BACKEND
# ==============================================================================
setup_python() {
    section "Python Environment Setup"

    local venv_dir="$INSTALL_DIR/packages/venv"
    info "Creating virtual environment..."
    "$PYTHON_BIN" -m venv "$venv_dir"

    local venv_python
    venv_python="$venv_dir/bin/python"
    [ -x "$venv_python" ] || die "venv creation failed: $venv_python"

    info "Upgrading pip..."
    "$venv_python" -m pip install --upgrade pip setuptools wheel --quiet

    info "Installing DrSai backend (editable)..."
    local drsai_pkg="$SRC_ROOT/cores/python/packages/drsai"
    DRSAI_SKIP_TUI_BUILD=1 "$venv_python" -m pip install -e "$drsai_pkg" --quiet

    local version
    version=$("$venv_python" -c "from drsai.version import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "DrSai backend version: $version"

    VENV_PYTHON="$venv_python"
}

# ==============================================================================
#  7. SETUP NODE + PNPM
# ==============================================================================
setup_node() {
    section "Node.js Environment Setup"

    local node_dir="$INSTALL_DIR/packages/node"
    local npm_bin="$node_dir/bin/npm"

    [ -x "$npm_bin" ] || die "npm not found: $npm_bin"

    info "Installing pnpm..."
    "$npm_bin" install -g pnpm --prefix="$node_dir" 2>/dev/null || {
        warn "npm install pnpm failed, trying corepack..."
        "$node_dir/bin/corepack" enable 2>/dev/null || true
        "$node_dir/bin/corepack" prepare pnpm@latest --activate 2>/dev/null || true
    }

    local pnpm_bin="$node_dir/bin/pnpm"
    if [ -x "$pnpm_bin" ]; then
        ok "pnpm: $("$pnpm_bin" -v 2>&1)"
    else
        warn "pnpm install failed, will try npm to build TUI"
    fi

    NODE_DIR="$node_dir"
}

# ==============================================================================
#  8. BUILD TUI
# ==============================================================================
build_tui() {
    section "Building TUI"

    local tui_dir="$SRC_ROOT/apps/ui-tui"

    if [ -f "$tui_dir/dist/entry.mjs" ]; then
        ok "Prebuilt bundle found: dist/entry.mjs"
        return 0
    fi

    export PATH="$NODE_DIR/bin:$PATH"

    local pnpm_bin="$NODE_DIR/bin/pnpm"
    local npm_bin="$NODE_DIR/bin/npm"

    cd "$tui_dir"

    local retry=0
    while [ $retry -lt 3 ]; do
        retry=$((retry + 1))
        info "Installing TUI dependencies (attempt $retry/3)..."
        if [ -x "$pnpm_bin" ]; then
            if "$pnpm_bin" install --frozen-lockfile 2>/dev/null || "$pnpm_bin" install; then
                break
            fi
        else
            if "$npm_bin" install; then
                break
            fi
        fi
        warn "Dependency install failed, retrying..."
        [ $retry -eq 3 ] && die "TUI dependency install failed (gave up after 3 retries)"
    done

    info "Building TUI bundle..."
    if [ -x "$pnpm_bin" ]; then
        "$pnpm_bin" build || die "pnpm build failed"
    else
        "$npm_bin" run build || die "npm build failed"
    fi

    [ -f "$tui_dir/dist/entry.mjs" ] || die "TUI build failed: dist/entry.mjs not generated"
    ok "TUI build successful: $(du -h "$tui_dir/dist/entry.mjs" | cut -f1)"

    cd - >/dev/null
}

# ==============================================================================
#  9. CREATE LAUNCHER
# ==============================================================================
create_launcher() {
    section "Creating Launcher Script"

    local bin_dir="$INSTALL_DIR/bin"
    mkdir -p "$bin_dir"

    local launcher="$bin_dir/opendrsai"
    local tui_dir="$SRC_ROOT/apps/ui-tui"
    local venv_python="$INSTALL_DIR/packages/venv/bin/python"
    local src_root="$SRC_ROOT"
    cat > "$launcher" <<LAUNCHER_EOF
#!/usr/bin/env bash
set -e
# -- OpenDrSai launcher (self-contained, no system Python/Node) --
INSTALL_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export DRSAI_HOME="\${DRSAI_HOME:-\$INSTALL_DIR}"
export DRSAI_UI_TUI_DIR="$tui_dir"
# Tell TUI to use venv Python for gateway subprocess
export DRSAI_PYTHON="$venv_python"
export DRSAI_PYTHON_SRC_ROOT="$src_root/cores/python/packages/drsai/src"
export VIRTUAL_ENV="\$INSTALL_DIR/packages/venv"
export PATH="\$INSTALL_DIR/packages/node/bin:\$PATH"
# Use console script (drsai) instead of python -m to avoid runpy RuntimeWarning
if [ -x "\$INSTALL_DIR/packages/venv/bin/drsai" ]; then
    exec "\$INSTALL_DIR/packages/venv/bin/drsai" "\$@"
else
    exec "\$INSTALL_DIR/packages/venv/bin/python" -m drsai.backend.run_cli "\$@"
fi
LAUNCHER_EOF
    chmod +x "$launcher"

    ok "Launcher: $launcher"
}

# ==============================================================================
#  10. VERIFY
# ==============================================================================
verify() {
    section "Verifying Installation"

    info "Checking drsai import..."
    local r
    r=$("$VENV_PYTHON" -c "import drsai; print('ok')" 2>&1)
    [ "$r" = "ok" ] && ok "drsai import: OK" || err "Import failed: $r"

    info "Checking version..."
    local v
    v=$("$VENV_PYTHON" -W ignore -c "from drsai.version import __version__; print(__version__)" 2>&1 || echo "unknown")
    ok "drsai version: $v"

    [ -x "$INSTALL_DIR/bin/opendrsai" ] && ok "Launcher: $INSTALL_DIR/bin/opendrsai"
    [ -f "$SRC_ROOT/apps/ui-tui/dist/entry.mjs" ] && ok "TUI bundle: OK"
    [ -x "$INSTALL_DIR/packages/python/bin/python3" ] && ok "Python: $($INSTALL_DIR/packages/python/bin/python3 --version 2>&1)"
    [ -x "$INSTALL_DIR/packages/node/bin/node" ] && ok "Node: $($INSTALL_DIR/packages/node/bin/node -v 2>&1)"
}

# ==============================================================================
#  MAIN
# ==============================================================================
main() {
    printf "\n${C_C}${C_B}"
    printf "  +----------------------------------------------------------+\n"
    printf "  |           OpenDrSai Installer - Self-Contained            |\n"
    printf "  |    Portable Python + Node - Zero System Pollution         |\n"
    printf "  +----------------------------------------------------------+\n"
    printf "${C_RST}\n"

    detect_platform
    select_install_dir
    check_existing
    download_files
    extract_all
    setup_python
    setup_node
    build_tui
    create_launcher
    verify

    printf "\n${C_G}${C_B}"
    printf "  +----------------------------------------------------------+\n"
    printf "  |                    Installation Complete!                 |\n"
    printf "  +----------------------------------------------------------+\n"
    printf "${C_RST}\n"

    printf "  ${C_B}Install dir:${C_RST}  $INSTALL_DIR\n"
    printf "  ${C_B}Python:${C_RST}       $INSTALL_DIR/packages/python\n"
    printf "  ${C_B}Node:${C_RST}         $INSTALL_DIR/packages/node\n"
    printf "  ${C_B}Venv:${C_RST}        $INSTALL_DIR/packages/venv\n"
    printf "  ${C_B}Source:${C_RST}      $INSTALL_DIR/packages/src\n"
    printf "  ${C_B}Launcher:${C_RST}    $INSTALL_DIR/bin/opendrsai\n"
    printf "\n"
    printf "  ${C_Y}Next steps:${C_RST}\n"
    printf "    Add to PATH:\n"
    printf "    ${C_B}export PATH=\"$INSTALL_DIR/bin:\$PATH\"${C_RST}\n"
    printf "\n"
    printf "    Then run: ${C_B}opendrsai${C_RST}\n"
    printf "    First run will trigger API key setup wizard.\n"
    printf "\n"
    printf "  ${C_GRAY}No system Python/Node modified. All environments are self-contained.${C_RST}\n"
}

main "$@"
