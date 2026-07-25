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
#  1b. DETECT SYSTEM DEPENDENCIES (skip portable download if available)
# ==============================================================================
detect_system_deps() {
    section "Detecting System Dependencies"

    # Ensure INSTALL_DIR is set (may be empty if --install-dir was not passed)
    [ -z "$INSTALL_DIR" ] && INSTALL_DIR="$DEFAULT_INSTALL_DIR"

    USE_SYSTEM_PYTHON=0
    USE_SYSTEM_NODE=0

    # -- Check for system Python 3.11 ~ 3.13 in PATH --
    if command -v python3 >/dev/null 2>&1; then
        local py_ver
        py_ver=$(python3 -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>/dev/null)
        local py_major="${py_ver%%.*}"
        local py_minor="${py_ver#*.}"
        py_minor="${py_minor%%.*}"
        if [ "${py_major:-0}" -eq 3 ] && [ "${py_minor:-0}" -ge 11 ] && [ "${py_minor:-0}" -le 13 ]; then
            ok "System Python ${py_ver} found — will use it (skip portable Python)"
            USE_SYSTEM_PYTHON=1
            PYTHON_BIN="$(command -v python3)"
        else
            info "System Python ${py_ver} found but not in range [3.11, 3.13] — will download portable Python"
        fi
    else
        info "No system Python found — will download portable Python"
    fi

    # -- Check for DrSai portable Python (from previous install) --
    if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
        local drsai_py="$INSTALL_DIR/packages/python/bin/python3"
        if [ -x "$drsai_py" ]; then
            local drsai_py_ver
            drsai_py_ver=$("$drsai_py" --version 2>&1)
            ok "DrSai portable Python found at $INSTALL_DIR/packages/python — will reuse it"
            ok "  $drsai_py_ver (skip download)"
            USE_SYSTEM_PYTHON=1
            PYTHON_BIN="$drsai_py"
        fi
    fi

    # -- Check for system Node >= 20 in PATH --
    if command -v node >/dev/null 2>&1; then
        local node_ver
        node_ver=$(node --version 2>/dev/null | sed 's/^v//')
        local node_major="${node_ver%%.*}"
        if [ "${node_major:-0}" -ge 20 ]; then
            ok "System Node v${node_ver} found — will use it (skip portable Node)"
            USE_SYSTEM_NODE=1
            NODE_BIN="$(command -v node)"
            NODE_DIR="$(dirname "$NODE_BIN")"
        else
            info "System Node v${node_ver} found but < 20 — will download portable Node"
        fi
    else
        info "No system Node found — will download portable Node"
    fi

    # -- Check for DrSai portable Node (from previous install) --
    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        local drsai_node="$INSTALL_DIR/packages/node/bin/node"
        if [ -x "$drsai_node" ]; then
            local drsai_node_ver
            drsai_node_ver=$("$drsai_node" -v 2>&1)
            ok "DrSai portable Node found at $INSTALL_DIR/packages/node — will reuse it"
            ok "  $drsai_node_ver (skip download)"
            USE_SYSTEM_NODE=1
            NODE_BIN="$drsai_node"
            NODE_DIR="$INSTALL_DIR/packages/node"
        fi
    fi
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
            rm -rf "$INSTALL_DIR/bin" 2>/dev/null || true
            rm -rf "$INSTALL_DIR/packages/venv" "$INSTALL_DIR/packages/src" "$INSTALL_DIR/packages/.download" 2>/dev/null || true
            # Preserve portable Python/Node if they were detected for reuse
            if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
                rm -rf "$INSTALL_DIR/packages/python" 2>/dev/null || true
            fi
            if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
                rm -rf "$INSTALL_DIR/packages/node" 2>/dev/null || true
            fi
            ok "Old installation cleared (bin/ + venv + src; python/node preserved if reused)"
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

    if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
        info "Downloading Python 3.12.13 ($PLATFORM)..."
        curl -fsSL "$py_url" -o "$tmp_dir/python.tar.gz" || die "Python download failed"
        ok "Python: $(du -h "$tmp_dir/python.tar.gz" | cut -f1)"
    else
        ok "Skipping Python download (using system Python)"
    fi

    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        info "Downloading Node.js v22.22.3 ($PLATFORM)..."
        curl -fsSL "$node_url" -o "$tmp_dir/node.tar.xz" || die "Node download failed"
        ok "Node: $(du -h "$tmp_dir/node.tar.xz" | cut -f1)"
    else
        ok "Skipping Node download (using system Node)"
    fi

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
    if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
        info "Extracting Python..."
        rm -rf "$pkg_dir/python" 2>/dev/null || true
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
    else
        ok "Using system Python: $($PYTHON_BIN --version 2>&1)"
    fi

    # -- Node (tar.xz -> packages/node/) --
    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        info "Extracting Node..."
        rm -rf "$pkg_dir/node" 2>/dev/null || true
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
        NODE_DIR="$pkg_dir/node"
    else
        ok "Using system Node: $($NODE_BIN -v 2>&1)"
    fi

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

    if [ "$USE_SYSTEM_NODE" -eq 1 ]; then
        # Using system or DrSai portable node — find pnpm/npm
        local pnpm_bin=""
        local npm_bin=""

        # Check NODE_DIR/bin first (DrSai portable case)
        if [ -x "$NODE_DIR/bin/pnpm" ]; then
            pnpm_bin="$NODE_DIR/bin/pnpm"
        elif command -v pnpm >/dev/null 2>&1; then
            pnpm_bin="$(command -v pnpm)"
        fi

        if [ -x "$NODE_DIR/bin/npm" ]; then
            npm_bin="$NODE_DIR/bin/npm"
        elif command -v npm >/dev/null 2>&1; then
            npm_bin="$(command -v npm)"
        fi

        if [ -n "$pnpm_bin" ]; then
            ok "Using pnpm: $(pnpm -v 2>&1)"
            PNPM_BIN="$pnpm_bin"
        elif [ -n "$npm_bin" ]; then
            info "Installing pnpm via npm..."
            "$npm_bin" install -g pnpm 2>/dev/null || true
            pnpm_bin=$(command -v pnpm 2>/dev/null)
            if [ -n "$pnpm_bin" ]; then
                ok "pnpm installed: $(pnpm -v 2>&1)"
                PNPM_BIN="$pnpm_bin"
            else
                warn "pnpm install failed — will use npm to build TUI"
            fi
        else
            warn "No pnpm or npm found — will try npm to build TUI"
        fi
        return 0
    fi

    # Portable node — original logic
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

    # Set PATH for node/pnpm/npm
    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        export PATH="$NODE_DIR/bin:$PATH"
    fi

    local pnpm_bin="$NODE_DIR/bin/pnpm"
    local npm_bin="$NODE_DIR/bin/npm"

    if [ "$USE_SYSTEM_NODE" -eq 1 ]; then
        # Check NODE_DIR/bin first (DrSai portable), then system PATH
        if [ -x "$NODE_DIR/bin/pnpm" ]; then
            pnpm_bin="$NODE_DIR/bin/pnpm"
        else
            pnpm_bin="$(command -v pnpm 2>/dev/null)"
        fi
        if [ -x "$NODE_DIR/bin/npm" ]; then
            npm_bin="$NODE_DIR/bin/npm"
        else
            npm_bin="$(command -v npm 2>/dev/null)"
        fi
    fi

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

    # Only include portable node PATH if the directory exists
    # (covers both freshly extracted and reused DrSai portable node)
    local node_path_line=""
    if [ -d "$INSTALL_DIR/packages/node/bin" ]; then
        node_path_line='export PATH="$INSTALL_DIR/packages/node/bin:$PATH"'
    fi

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
${node_path_line}
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
#  9b. ADD PATH TO SHELL RC (.bashrc / .zshrc)
# ==============================================================================
add_to_shell_rc() {
    section "Configuring Shell PATH"

    local bin_dir="$INSTALL_DIR/bin"
    local marker="# OpenDrSai installer"
    local export_line="export PATH=\"$bin_dir:\$PATH\"  $marker"

    # Determine which rc file to use based on $SHELL
    local rc_file=""
    local shell_name
    shell_name="$(basename "${SHELL:-/bin/bash}")"
    case "$shell_name" in
        zsh)  rc_file="$HOME/.zshrc" ;;
        bash) rc_file="$HOME/.bashrc" ;;
        *)    rc_file="$HOME/.bashrc" ;;  # fallback to .bashrc
    esac

    # macOS default shell is zsh since Catalina
    if [ "$OS" = "macos" ] && [ "$shell_name" != "zsh" ]; then
        # Still check if .zshrc exists and user might use zsh
        if [ -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ]; then
            rc_file="$HOME/.zshrc"
        fi
    fi

    # Check if already added (idempotent)
    if [ -f "$rc_file" ] && grep -q "$marker" "$rc_file" 2>/dev/null; then
        ok "PATH already configured in $rc_file"
        RC_FILE="$rc_file"
        return 0
    fi

    # Append to rc file
    echo "" >> "$rc_file"
    echo "$export_line" >> "$rc_file"
    ok "Added PATH export to $rc_file"

    RC_FILE="$rc_file"
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
    # Show Python info (system, DrSai portable, or freshly installed)
    ok "Python: $($PYTHON_BIN --version 2>&1)"
    # Show Node info (system, DrSai portable, or freshly installed)
    ok "Node: $($NODE_BIN -v 2>&1)"
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
    detect_system_deps
    check_existing
    download_files
    extract_all
    setup_python
    setup_node
    build_tui
    create_launcher
    add_to_shell_rc
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
    printf "    PATH has been added to ${C_B}${RC_FILE:-$HOME/.bashrc}${C_RST}\n"
    printf "    Run the following to apply in this session:\n"
    printf "    ${C_B}source ${RC_FILE:-$HOME/.bashrc}${C_RST}\n"
    printf "\n"
    printf "    Then run: ${C_B}opendrsai${C_RST}\n"
    printf "    First run will trigger API key setup wizard.\n"
    printf "\n"
    printf "  ${C_GRAY}No system Python/Node modified. All environments are self-contained.${C_RST}\n"
}

main "$@"
