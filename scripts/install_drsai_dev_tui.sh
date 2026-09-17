#!/usr/bin/env bash
# ==============================================================================
#  OpenDrSai Dev Installer -- Bash (Linux + macOS)
#
#  Live-development installer: copies the LOCAL repo source (apps/ui-tui and
#  cores only — everything else is too large) into ~/.drsai so you can test
#  edits in real time. The Python venv + portable Python/Node are still
#  downloaded from ihepbox (online), exactly like install_drsai_tui.sh.
#
#  Because the backend is installed editable (pip install -e) against the
#  copied source, edits you make in the LOCAL repo can be synced to the
#  install dir with the --sync action (rsync). The TUI is rebuilt from the
#  copied source so dist/entry.mjs stays in sync too.
#
#  Usage:
#    bash install_drsai_dev_tui.sh                       # install (default ~/.drsai)
#    bash install_drsai_dev_tui.sh --install-dir /path   # custom install dir
#    bash install_drsai_dev_tui.sh --force               # overwrite existing
#    bash install_drsai_dev_tui.sh --sync                # re-copy source + rebuild TUI
#    bash install_drsai_dev_tui.sh --no-rebuild          # skip TUI rebuild on install
#
#  Requirements: curl, tar, rsync (for --sync / source copy)
# ==============================================================================
set -Eeuo pipefail

# ==============================================================================
#  CONFIG -- online deps URLs (same as install_drsai_tui.sh)
# ==============================================================================
IHEPBOX="https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

get_python_url() {
    case "$1" in
        linux-x64)    printf '%s' "${IHEPBOX}/GQtYPVjmhn3RV2X/download" ;;
        linux-arm64)  printf '%s' "${IHEPBOX}/QcqYLu2a5Nq1BD9/download" ;;
        macos-x64)    printf '%s' "${IHEPBOX}/G9kgRSzhqpLldaX/download" ;;
        macos-arm64)  printf '%s' "${IHEPBOX}/K0DCIdm9qpiBgKq/download" ;;
        *)            printf '%s' "" ;;
    esac
}

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
DO_SYNC=0
DO_REBUILD=1
INSTALL_DIR=""

# Repo root = directory containing this script's parent (the repo top level).
# Works whether invoked as ./scripts/install_drsai_dev_tui.sh or bash <path>.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# -- Parse args ---------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir) INSTALL_DIR="${2:?}"; shift 2 ;;
        --force)       FORCE=1; shift ;;
        --sync)        DO_SYNC=1; shift ;;
        --no-rebuild)  DO_REBUILD=0; shift ;;
        -h|--help)     sed -n '2,24p' "$0" 2>/dev/null; exit 0 ;;
        *)             echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

[ -z "$INSTALL_DIR" ] && INSTALL_DIR="$DEFAULT_INSTALL_DIR"

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

trap 'err "Install failed at line $LINENO (exit code: $?)"' ERR

# ==============================================================================
#  Source copy helpers (rsync apps/ui-tui + cores only)
# ==============================================================================
copy_repo_source() {
    section "Copying Local Repo Source → $1"

    command -v rsync >/dev/null 2>&1 || die "rsync is required for source copy (install it or run without --sync)"

    local dst_root="$1"
    mkdir -p "$dst_root"

    # Verify repo layout
    [ -d "$REPO_ROOT/apps/ui-tui" ] || die "Repo missing apps/ui-tui at $REPO_ROOT"
    [ -d "$REPO_ROOT/cores" ]       || die "Repo missing cores at $REPO_ROOT"

    info "Repo root: $REPO_ROOT"
    info "Copying apps/ui-tui (excluding node_modules)..."
    mkdir -p "$dst_root/apps"
    rsync -a --delete \
        --exclude='node_modules' \
        --exclude='.cache' \
        "$REPO_ROOT/apps/ui-tui/" "$dst_root/apps/ui-tui/"

    info "Copying cores..."
    rsync -a --delete \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='dist' \
        "$REPO_ROOT/cores/" "$dst_root/cores/"

    # skills/skills (pre-built skills catalog, used by opendrsai CLI at startup)
    if [ -d "$REPO_ROOT/skills/skills" ]; then
        info "Copying skills/skills..."
        mkdir -p "$dst_root/skills"
        rsync -a --delete \
            "$REPO_ROOT/skills/skills/" "$dst_root/skills/skills/"
    else
        warn "skills/skills not found in repo — skipping (skill selection will be unavailable)"
    fi

    # Verify the copied layout
    [ -f "$dst_root/apps/ui-tui/package.json" ] || die "Copy failed: apps/ui-tui/package.json missing"
    [ -f "$dst_root/cores/python/packages/drsai/pyproject.toml" ] || die "Copy failed: drsai pyproject.toml missing"

    ok "Source copied: apps/ui-tui + cores → $dst_root"
}

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
#  1b. DETECT SYSTEM DEPENDENCIES
# ==============================================================================
detect_system_deps() {
    section "Detecting System Dependencies"

    USE_SYSTEM_PYTHON=0
    USE_SYSTEM_NODE=0

    # -- System Python 3.11 ~ 3.13 --
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

    # -- DrSai portable Python (reuse from previous install) --
    if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
        local drsai_py="$INSTALL_DIR/packages/python/bin/python3"
        if [ -x "$drsai_py" ]; then
            ok "DrSai portable Python found at $INSTALL_DIR/packages/python — will reuse it"
            ok "  $($drsai_py --version 2>&1) (skip download)"
            USE_SYSTEM_PYTHON=1
            PYTHON_BIN="$drsai_py"
        fi
    fi

    # -- System Node >= 20 --
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

    # -- DrSai portable Node (reuse) --
    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        local drsai_node="$INSTALL_DIR/packages/node/bin/node"
        if [ -x "$drsai_node" ]; then
            ok "DrSai portable Node found at $INSTALL_DIR/packages/node — will reuse it"
            ok "  $($drsai_node -v 2>&1) (skip download)"
            USE_SYSTEM_NODE=1
            NODE_BIN="$drsai_node"
            NODE_DIR="$INSTALL_DIR/packages/node"
        fi
    fi
}

# ==============================================================================
#  2. INSTALL DIRECTORY SELECTION (>=2GB)
#  Checks $OPENDRSAI env var for existing installation, then lets user
#  choose default path or enter a custom one. Auto-creates directory.
#  On error (mkdir fail or insufficient space), re-prompts.
# ==============================================================================
select_install_dir() {
    section "Install Directory"

    local avail_bytes avail_gb

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

    # Step 1: Check OPENDRSAI environment variable for existing installation
    if [ -n "${OPENDRSAI:-}" ]; then
        info "Found OPENDRSAI environment variable: $OPENDRSAI"
        local existing_launcher="$OPENDRSAI/bin/opendrsai"
        if [ -e "$existing_launcher" ]; then
            warn "Found existing installation at: $OPENDRSAI"
            printf "  Remove existing installation? (bin/ and packages runtime/source directories will be refreshed; source, configs and data are preserved) [y/N]: " >&2
            read -r REPLY
            case "$(echo "$REPLY" | tr '[:upper:]' '[:lower:]')" in
                y|yes)
                    info "Removing existing installation at $OPENDRSAI..."
                    rm -rf "$OPENDRSAI/bin" 2>/dev/null || true
                    rm -rf "$OPENDRSAI/packages/venv" "$OPENDRSAI/packages/.download" 2>/dev/null || true
                    ok "Existing installation removed"
                    ;;
                *)
                    info "Keeping existing installation at $OPENDRSAI"
                    ;;
            esac
        else
            info "No existing installation found at $OPENDRSAI"
        fi
    fi

    # Step 2: Let user choose install path (or use --install-dir if provided)
    while true; do
        if [ -n "$INSTALL_DIR" ]; then
            # --install-dir was provided via command line, use it directly
            info "Install dir (from --install-dir): $INSTALL_DIR"
        else
            echo
            printf "  ${C_B}Choose install directory:${C_RST}\n"
            printf "  ${C_C}1)${C_RST} Default: %s\n" "$DEFAULT_INSTALL_DIR"
            printf "  ${C_C}2)${C_RST} Enter a custom path\n"
            printf "  Select option [1]: " >&2
            read -r choice
            [ -z "$choice" ] && choice="1"

            case "$choice" in
                1)
                    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
                    ;;
                2)
                    printf "  Enter install path: " >&2
                    read -r custom_dir
                    if [ -z "$custom_dir" ]; then
                        warn "Empty path, please try again"
                        continue
                    fi
                    INSTALL_DIR="$custom_dir"
                    ;;
                *)
                    warn "Invalid option: $choice, please try again"
                    continue
                    ;;
            esac
        fi

        # Step 3: Create directory if it doesn't exist
        if ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
            warn "Failed to create directory: $INSTALL_DIR"
            INSTALL_DIR=""
            continue
        fi

        # Step 4: Check disk space
        check_disk_space "$INSTALL_DIR"

        if [ "${avail_bytes:-0}" -lt "$REQUIRED_SPACE_BYTES" ] 2>/dev/null; then
            warn "Insufficient disk space: ${avail_gb}GB < ${REQUIRED_SPACE_GB}GB"
            # If --install-dir was provided, we still allow re-selection
            INSTALL_DIR=""
            continue
        fi

        # Success
        break
    done

    ok "Available space: ${avail_gb}GB (>= ${REQUIRED_SPACE_GB}GB)"
    ok "Install directory: $INSTALL_DIR"
}

# ==============================================================================
#  2b. CHECK FOR RUNNING DRSAI PROCESSES
# ==============================================================================
check_running() {
    section "Checking for Running DrSai Processes"

    local running_pids=""

    if command -v pgrep >/dev/null 2>&1; then
        running_pids="$(pgrep -f 'opendrsai' 2>/dev/null || true)"
        running_pids="$running_pids $(pgrep -f 'drsai\.backend' 2>/dev/null || true)"
        running_pids="$running_pids $(pgrep -f 'entry\.mjs' 2>/dev/null || true)"
    fi

    if [ -z "$(echo "$running_pids" | tr -d ' \n')" ] && command -v ps >/dev/null 2>&1; then
        running_pids="$(ps aux 2>/dev/null | grep -E 'opendrsai|drsai\.backend|entry\.mjs' | grep -v grep | awk '{print $2}' || true)"
    fi

    running_pids=$(echo "$running_pids" | tr ' ' '\n' | grep -v '^$' | grep -v "^$$\$" | sort -u 2>/dev/null || true)

    if [ -n "$running_pids" ]; then
        warn "DrSai is currently running. Please stop ALL instances before updating:"
        echo "$running_pids" | while read -r pid; do
            [ -n "$pid" ] && warn "  PID $pid: $(ps -p "$pid" -o command= 2>/dev/null | head -1 || echo 'unknown')"
        done
        die "Please close all running DrSai terminals/processes, then re-run this installer."
    else
        ok "No running DrSai processes found"
    fi
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
            printf "Overwrite? (only bin/ and packages runtime/source directories will be refreshed; source, configs and data are preserved) [y/N]: " >&2
            read -r REPLY
            case "$(echo "$REPLY" | tr '[:upper:]' '[:lower:]')" in
                y|yes) REPLY="y" ;;
                *)     REPLY="n" ;;
            esac
        fi

        if [ "$REPLY" = "y" ]; then
            info "Cleaning old installation (preserving source, configs, workspace, logs)..."
            rm -rf "$INSTALL_DIR/bin" 2>/dev/null || true
            rm -rf "$INSTALL_DIR/packages/venv" "$INSTALL_DIR/packages/.download" 2>/dev/null || true
            # Preserve portable Python/Node if they were detected for reuse
            if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
                rm -rf "$INSTALL_DIR/packages/python" 2>/dev/null || true
            fi
            if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
                rm -rf "$INSTALL_DIR/packages/node" 2>/dev/null || true
            fi
            ok "Old installation cleared (bin/ + venv; python/node preserved if reused)"
        else
            die "Installation cancelled by user"
        fi
    else
        ok "No existing installation found"
    fi
}

# ==============================================================================
#  4. DOWNLOAD (Python + Node only — source comes from local repo)
# ==============================================================================
download_files() {
    section "Downloading Runtime Dependencies"

    local py_url node_url
    py_url="$(get_python_url "$PLATFORM")"
    node_url="$(get_node_url "$PLATFORM")"

    [ -n "$py_url" ]   || die "Unsupported platform: $PLATFORM (no Python URL)"
    [ -n "$node_url" ] || die "Unsupported platform: $PLATFORM (no Node URL)"

    local tmp_dir="$INSTALL_DIR/.download"
    mkdir -p "$tmp_dir"

    if [ "$USE_SYSTEM_PYTHON" -ne 1 ]; then
        info "Downloading Python 3.12.13 ($PLATFORM)..."
        curl -fsSL "$py_url" -o "$tmp_dir/python.tar.gz" || die "Python download failed"
        ok "Python: $(du -h "$tmp_dir/python.tar.gz" | cut -f1)"
    else
        ok "Skipping Python download (using system/DrSai Python)"
    fi

    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        info "Downloading Node.js v22.22.3 ($PLATFORM)..."
        curl -fsSL "$node_url" -o "$tmp_dir/node.tar.xz" || die "Node download failed"
        ok "Node: $(du -h "$tmp_dir/node.tar.xz" | cut -f1)"
    else
        ok "Skipping Node download (using system/DrSai Node)"
    fi

    DOWNLOAD_DIR="$tmp_dir"
}

# ==============================================================================
#  5. EXTRACT Python + Node, and copy local source
# ==============================================================================
extract_all() {
    section "Extracting Runtime + Copying Source"

    local pkg_dir="$INSTALL_DIR/packages"
    mkdir -p "$pkg_dir"

    # -- Python --
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

    # -- Node --
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

    # -- Source: copy from LOCAL repo (apps/ui-tui + cores only) --
    local src_root="$pkg_dir"
    copy_repo_source "$src_root"
    SRC_ROOT="$src_root"

    [ -f "$SRC_ROOT/apps/ui-tui/package.json" ] || die "apps/ui-tui/package.json not found"
    [ -f "$SRC_ROOT/cores/python/packages/drsai/pyproject.toml" ] || die "drsai/pyproject.toml not found"
    ok "Source verification passed"

    rm -rf "$DOWNLOAD_DIR" 2>/dev/null || true
    ok "Temp download files cleaned"
}

# ==============================================================================
#  6. SETUP PYTHON VENV + INSTALL BACKEND (editable)
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

    info "Installing DrSai backend (editable, from copied source)..."
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
        local pnpm_bin=""
        local npm_bin=""

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
            ok "Using pnpm: $("$pnpm_bin" -v 2>&1)"
            PNPM_BIN="$pnpm_bin"
        elif [ -n "$npm_bin" ]; then
            info "Installing pnpm via npm..."
            "$npm_bin" install -g pnpm 2>/dev/null || true
            pnpm_bin=$(command -v pnpm 2>/dev/null)
            if [ -n "$pnpm_bin" ]; then
                ok "pnpm installed: $("$pnpm_bin" -v 2>&1)"
                PNPM_BIN="$pnpm_bin"
            else
                warn "pnpm install failed — will use npm to build TUI"
            fi
        else
            warn "No pnpm or npm found — will try npm to build TUI"
        fi
        return 0
    fi

    # Portable node
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
#  8. BUILD TUI (from copied source)
# ==============================================================================
build_tui() {
    section "Building TUI"

    local tui_dir="$SRC_ROOT/apps/ui-tui"

    # Set PATH for node/pnpm/npm
    if [ "$USE_SYSTEM_NODE" -ne 1 ]; then
        export PATH="$NODE_DIR/bin:$PATH"
    fi

    local pnpm_bin="$NODE_DIR/bin/pnpm"
    local npm_bin="$NODE_DIR/bin/npm"

    if [ "$USE_SYSTEM_NODE" -eq 1 ]; then
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

    local node_path_line=""
    if [ -d "$INSTALL_DIR/packages/node/bin" ]; then
        node_path_line='export PATH="$INSTALL_DIR/packages/node/bin:$PATH"'
    fi

    cat > "$launcher" <<LAUNCHER_EOF
#!/usr/bin/env bash
set -e
# -- OpenDrSai dev launcher (live source under packages) --
INSTALL_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export DRSAI_HOME="\${DRSAI_HOME:-\$INSTALL_DIR}"
export DRSAI_UI_TUI_DIR="$tui_dir"
export DRSAI_PYTHON="$venv_python"
export DRSAI_PYTHON_SRC_ROOT="$src_root/cores/python/packages/drsai/src"
export VIRTUAL_ENV="\$INSTALL_DIR/packages/venv"
${node_path_line}
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
#  9b. ADD PATH TO SHELL RC
# ==============================================================================
add_to_shell_rc() {
    section "Configuring Shell PATH"

    local bin_dir="$INSTALL_DIR/bin"
    local marker="# OpenDrSai dev installer"
    local export_line="export PATH=\"$bin_dir:\$PATH\"  $marker"

    local rc_file=""
    local shell_name
    shell_name="$(basename "${SHELL:-/bin/bash}")"
    case "$shell_name" in
        zsh)  rc_file="$HOME/.zshrc" ;;
        bash) rc_file="$HOME/.bashrc" ;;
        *)    rc_file="$HOME/.bashrc" ;;
    esac

    if [ "$OS" = "macos" ] && [ "$shell_name" != "zsh" ]; then
        if [ -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ]; then
            rc_file="$HOME/.zshrc"
        fi
    fi

    if [ -f "$rc_file" ] && grep -q "$marker" "$rc_file" 2>/dev/null; then
        ok "PATH already configured in $rc_file"
        RC_FILE="$rc_file"
        return 0
    fi

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
    ok "Python: $($PYTHON_BIN --version 2>&1)"
    ok "Node: $($NODE_BIN -v 2>&1)"
}

# ==============================================================================
#  SYNC ACTION -- re-copy source from local repo + rebuild TUI
# ==============================================================================
do_sync() {
    section "Syncing Local Repo → Install Dir"

    local src_root="$INSTALL_DIR/packages"
    [ -d "$src_root" ] || die "No existing install found at $INSTALL_DIR. Run without --sync first."

    # Reuse existing venv/node detection for the rebuild
    detect_platform
    detect_system_deps

    copy_repo_source "$src_root"
    SRC_ROOT="$src_root"

    if [ "$DO_REBUILD" -eq 1 ]; then
        setup_node
        build_tui
    else
        ok "Skipping TUI rebuild (--no-rebuild)"
    fi

    verify
    ok "Sync complete. Edits in $REPO_ROOT are now live in $INSTALL_DIR."
}

# ==============================================================================
#  MAIN
# ==============================================================================
main() {
    printf "\n${C_C}${C_B}"
    printf "  +----------------------------------------------------------+\n"
    printf "  |         OpenDrSai Dev Installer - Live Source            |\n"
    printf "  |  Local repo → ~/.drsai  |  Runtime deps online           |\n"
    printf "  +----------------------------------------------------------+\n"
    printf "${C_RST}\n"

    info "Repo root: $REPO_ROOT"

    # --sync short-circuits the full install
    if [ "$DO_SYNC" -eq 1 ]; then
        do_sync
        printf "\n${C_G}${C_B}Sync done.${C_RST} Run ${C_B}opendrsai${C_RST} to test.\n"
        exit 0
    fi

    detect_platform
    select_install_dir
    check_running
    detect_system_deps
    check_existing
    download_files
    extract_all
    setup_python
    setup_node
    if [ "$DO_REBUILD" -eq 1 ]; then
        build_tui
    else
        section "Building TUI"
        ok "Skipping TUI rebuild (--no-rebuild)"
    fi
    create_launcher
    add_to_shell_rc
    verify

    printf "\n${C_G}${C_B}"
    printf "  +----------------------------------------------------------+\n"
    printf "  |                Dev Installation Complete!                |\n"
    printf "  +----------------------------------------------------------+\n"
    printf "${C_RST}\n"

    printf "  ${C_B}Repo root:${C_RST}    $REPO_ROOT\n"
    printf "  ${C_B}Install dir:${C_RST}  $INSTALL_DIR\n"
    printf "  ${C_B}Source (live):${C_RST} $INSTALL_DIR/packages\n"
    printf "  ${C_B}Venv:${C_RST}        $INSTALL_DIR/packages/venv\n"
    printf "  ${C_B}Launcher:${C_RST}    $INSTALL_DIR/bin/opendrsai\n"
    printf "\n"
    printf "  ${C_Y}Next steps:${C_RST}\n"
    printf "    PATH has been added to ${C_B}${RC_FILE:-$HOME/.bashrc}${C_RST}\n"
    printf "    Apply in this session:  ${C_B}source ${RC_FILE:-$HOME/.bashrc}${C_RST}\n"
    printf "    Then run:               ${C_B}opendrsai${C_RST}\n"
    printf "\n"
    printf "  ${C_Y}Live editing:${C_RST}\n"
    printf "    After editing files in the repo, re-sync with:\n"
    printf "      ${C_B}bash $0 --sync${C_RST}\n"
    printf "    (re-copies apps/ui-tui + cores and rebuilds the TUI bundle)\n"
    printf "\n"
    printf "  ${C_GRAY}Backend is installed editable against packages, so Python edits${C_RST}\n"
    printf "  ${C_GRAY}take effect immediately after --sync (no reinstall needed).${C_RST}\n"
}

main "$@"