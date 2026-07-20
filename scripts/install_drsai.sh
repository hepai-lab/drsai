#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  OpenDrSai Installer — Bash (Linux + macOS)
#
#  Fully self-contained: downloads portable Python 3.12 + Node.js v22 + source
#  from ihepbox cloud storage. ZERO system pollution — no sudo, no system
#  PATH modification, no conflicts with existing Python/Node.
#
#  Usage:
#    curl -fsSL <URL>/install_drsai.sh | bash
#    bash install_drsai.sh [--install-dir /opt/drsai] [--force]
#
#  Requirements: curl, tar (both pre-installed on virtually all Linux/macOS)
# ══════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG — 在这里修改所有下载地址
# ══════════════════════════════════════════════════════════════════════════════
IHEPBOX="https://ihepbox.ihep.ac.cn/ihepbox/index.php/s"

# 源码包 (完整项目结构, .zip 格式, 不含预构建 dist/entry.mjs)
SRC_URL="${IHEPBOX}/hv9iGTJHvuQbRxE/download"

# Python 3.12.13 便携版 (python-build-standalone, .tar.gz)
# 用函数代替关联数组，确保 macOS bash 3.2 兼容
get_python_url() {
    case "$1" in
        linux-x64)    printf '%s' "${IHEPBOX}/GQtYPVjmhn3RV2X/download" ;;
        linux-arm64)  printf '%s' "${IHEPBOX}/QcqYLu2a5Nq1BD9/download" ;;
        macos-x64)    printf '%s' "${IHEPBOX}/G9kgRSzhqpLldaX/download" ;;
        macos-arm64)  printf '%s' "${IHEPBOX}/K0DCIdm9qpiBgKq/download" ;;
        *)            printf '%s' "" ;;
    esac
}

# Node.js v22.22.3 便携版 (官方分发)
get_node_url() {
    case "$1" in
        linux-x64)    printf '%s' "${IHEPBOX}/6pM9SJSTj2bLxZu/download" ;;
        linux-arm64)  printf '%s' "${IHEPBOX}/EmgmxX1I2XHd5oW/download" ;;
        macos-x64)    printf '%s' "${IHEPBOX}/qwrMnqbzusemhUi/download" ;;
        macos-arm64)  printf '%s' "${IHEPBOX}/70RiQ8Hzn0ZjjlO/download" ;;
        *)            printf '%s' "" ;;
    esac
}

# 安装参数
DEFAULT_INSTALL_DIR="$HOME/.drsai"
REQUIRED_SPACE_GB=2
REQUIRED_SPACE_BYTES=$((REQUIRED_SPACE_GB * 1024 * 1024 * 1024))
FORCE=0
INSTALL_DIR=""

# ── Parse args ──────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir) INSTALL_DIR="${2:?}"; shift 2 ;;
        --force)       FORCE=1; shift ;;
        -h|--help)     sed -n '2,18p' "$0" 2>/dev/null; exit 0 ;;
        *)             echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Colors ──────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RST='\033[0m'; C_B='\033[1m'
    C_R='\033[31m'; C_G='\033[32m'; C_Y='\033[33m'; C_C='\033[36m'; C_GRAY='\033[90m'
else
    C_RST=''; C_B=''; C_R=''; C_G=''; C_Y=''; C_C=''; C_GRAY=''
fi

# ── Logging ─────────────────────────────────────────────────────────────────────
log()     { printf "${C_B}▸${C_RST} %s\n" "$*"; }
info()    { printf "${C_C}ℹ${C_RST}  %s\n" "$*"; }
ok()      { printf "${C_G}✓${C_RST}  %s\n" "$*"; }
warn()    { printf "${C_Y}⚠${C_RST}  %s\n" "$*" >&2; }
err()     { printf "${C_R}✗${C_RST}  %s\n" "$*" >&2; }
die()     { err "$*"; exit 1; }
section() { printf "\n${C_C}━━━ %s ━━━${C_RST}\n" "$*"; }

# ── Terminal input (works even when piped: curl | bash) ────────────────────────
tty_read() {
    # $1 = variable name, reads user input from /dev/tty
    local _var="$1"
    if [ -e /dev/tty ]; then
        read -r "$_var" < /dev/tty
    else
        read -r "$_var"
    fi
}

prompt_yes_no() {
    # $1 = question, returns "y" or "n" in $REPLY
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

trap 'err "安装失败，行号: $LINENO (退出码: $?)"' ERR

# ══════════════════════════════════════════════════════════════════════════════
#  1. PLATFORM DETECTION
# ══════════════════════════════════════════════════════════════════════════════
detect_platform() {
    section "平台检测"
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *)       die "不支持的操作系统: $os (仅支持 Linux 和 macOS)" ;;
    esac
    case "$arch" in
        x86_64|amd64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *)             die "不支持的架构: $arch" ;;
    esac

    PLATFORM="${OS}-${ARCH}"
    ok "平台: $PLATFORM"

    # 检测 Node 压缩格式
    case "$OS" in
        linux|macos) NODE_EXT="tar.xz" ;;
    esac
}

# ══════════════════════════════════════════════════════════════════════════════
#  2. INSTALL DIRECTORY SELECTION (≥2GB)
# ══════════════════════════════════════════════════════════════════════════════
select_install_dir() {
    section "安装目录"

    if [ -z "$INSTALL_DIR" ]; then
        INSTALL_DIR="$DEFAULT_INSTALL_DIR"
    fi
    info "默认安装目录: $INSTALL_DIR"

    # 确保父目录存在
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
        warn "磁盘空间不足: ${avail_gb}GB < ${REQUIRED_SPACE_GB}GB"
        printf "请输入新的安装目录 (或按 Enter 取消): " >&2
        tty_read user_dir
        [ -n "$user_dir" ] || die "用户取消安装"
        INSTALL_DIR="$user_dir"
        mkdir -p "$INSTALL_DIR"
        check_disk_space "$INSTALL_DIR"
    done

    ok "可用空间: ${avail_gb}GB (≥ ${REQUIRED_SPACE_GB}GB)"
    ok "安装目录: $INSTALL_DIR"
}

# ══════════════════════════════════════════════════════════════════════════════
#  3. EXISTING INSTALLATION CHECK
# ══════════════════════════════════════════════════════════════════════════════
check_existing() {
    section "检测已有安装"
    local launcher="$INSTALL_DIR/bin/opendrsai"

    if [ -e "$launcher" ]; then
        warn "检测到已有 opendrsai 安装: $launcher"

        if [ "$FORCE" -eq 1 ]; then
            info "使用 --force, 直接覆盖"
            REPLY="y"
        else
            prompt_yes_no "是否覆盖安装? (仅删除 bin/ 和 packages/，保留配置和数据)"
        fi

        if [ "$REPLY" = "y" ]; then
            info "清除旧安装 (保留配置、聊天记录等用户数据)..."
            # 只删除安装脚本创建的目录，保留用户数据
            # (configs/, workspace/, logs/ 等不受影响)
            rm -rf "$INSTALL_DIR/bin" "$INSTALL_DIR/packages" 2>/dev/null || true
            ok "已清除旧安装 (bin/ + packages/)"
        else
            die "用户取消安装"
        fi
    else
        ok "无已有安装"
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
#  4. DOWNLOAD
# ══════════════════════════════════════════════════════════════════════════════
download_files() {
    section "下载文件"

    local py_url node_url
    py_url="$(get_python_url "$PLATFORM")"
    node_url="$(get_node_url "$PLATFORM")"

    [ -n "$py_url" ]   || die "不支持的平台: $PLATFORM (无 Python 下载链接)"
    [ -n "$node_url" ] || die "不支持的平台: $PLATFORM (无 Node 下载链接)"

    # 临时下载目录
    local tmp_dir="$INSTALL_DIR/.download"
    mkdir -p "$tmp_dir"

    # 源码
    info "下载源码 (drsai.zip)..."
    curl -fsSL "$SRC_URL" -o "$tmp_dir/drsai.zip" || die "源码下载失败"
    ok "源码: $(du -h "$tmp_dir/drsai.zip" | cut -f1)"

    # Python
    info "下载 Python 3.12.13 ($PLATFORM)..."
    curl -fsSL "$py_url" -o "$tmp_dir/python.tar.gz" || die "Python 下载失败"
    ok "Python: $(du -h "$tmp_dir/python.tar.gz" | cut -f1)"

    # Node
    info "下载 Node.js v22.22.3 ($PLATFORM)..."
    curl -fsSL "$node_url" -o "$tmp_dir/node.tar.xz" || die "Node 下载失败"
    ok "Node: $(du -h "$tmp_dir/node.tar.xz" | cut -f1)"

    DOWNLOAD_DIR="$tmp_dir"
}

# ══════════════════════════════════════════════════════════════════════════════
#  5. EXTRACT
# ══════════════════════════════════════════════════════════════════════════════
extract_all() {
    section "解压文件"

    local pkg_dir="$INSTALL_DIR/packages"
    mkdir -p "$pkg_dir"

    # ── Python (tar.gz → packages/python/) ──
    info "解压 Python..."
    local py_tmp="$pkg_dir/_py_tmp"
    mkdir -p "$py_tmp"
    tar xzf "$DOWNLOAD_DIR/python.tar.gz" -C "$py_tmp"

    # python-build-standone 的顶层目录通常是 python/
    local py_src_dir
    if [ -d "$py_tmp/python" ]; then
        py_src_dir="$py_tmp/python"
    else
        # 任意含 bin/python3 的子目录
        py_src_dir=$(find "$py_tmp" -maxdepth 1 -mindepth 1 -type d | head -1)
    fi
    [ -n "$py_src_dir" ] || die "Python 解压失败: 找不到 python 目录"

    mv "$py_src_dir" "$pkg_dir/python"
    rm -rf "$py_tmp"

    local py_bin="$pkg_dir/python/bin/python3"
    [ -x "$py_bin" ] || py_bin="$pkg_dir/python/bin/python"
    [ -x "$py_bin" ] || die "Python 可执行文件未找到: $pkg_dir/python/bin/"
    ok "Python: $($py_bin --version 2>&1)"

    PYTHON_BIN="$py_bin"

    # ── Node (tar.xz → packages/node/) ──
    info "解压 Node..."
    local node_tmp="$pkg_dir/_node_tmp"
    mkdir -p "$node_tmp"
    tar xJf "$DOWNLOAD_DIR/node.tar.xz" -C "$node_tmp" 2>/dev/null || \
    tar xf "$DOWNLOAD_DIR/node.tar.xz" -C "$node_tmp"

    local node_src_dir
    node_src_dir=$(find "$node_tmp" -maxdepth 1 -type d -name "node*" | head -1)
    [ -n "$node_src_dir" ] || die "Node 解压失败: 找不到 node 目录"

    mv "$node_src_dir" "$pkg_dir/node"
    rm -rf "$node_tmp"

    local node_bin="$pkg_dir/node/bin/node"
    [ -x "$node_bin" ] || die "Node 可执行文件未找到: $pkg_dir/node/bin/"
    ok "Node: $($node_bin -v 2>&1)"

    NODE_BIN="$node_bin"

    # ── 源码 (zip → packages/src/) ──
    # 使用便携 Python 解压 zip（不依赖系统 unzip）
    info "解压源码..."
    mkdir -p "$pkg_dir/src"
    "$PYTHON_BIN" -c "
import zipfile, sys
zipfile.ZipFile('$DOWNLOAD_DIR/drsai.zip').extractall('$pkg_dir/src')
" || die "源码解压失败"

    # 检测源码根目录 (可能解压出 drsai/ 或直接展开 apps/ cores/)
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

    [ -n "$src_root" ] || die "源码解压失败: 找不到 apps/ 和 cores/ 目录"
    ok "源码根目录: $src_root"

    # 验证关键文件
    [ -f "$src_root/apps/ui-tui/package.json" ] || die "找不到 apps/ui-tui/package.json"
    [ -f "$src_root/cores/python/packages/drsai/pyproject.toml" ] || die "找不到 drsai/pyproject.toml"
    ok "源码验证通过"

    SRC_ROOT="$src_root"

    # 清理下载的压缩包
    rm -rf "$DOWNLOAD_DIR"
    ok "已清理临时下载文件"
}

# ══════════════════════════════════════════════════════════════════════════════
#  6. SETUP PYTHON VENV + INSTALL BACKEND
# ══════════════════════════════════════════════════════════════════════════════
setup_python() {
    section "Python 环境配置"

    local venv_dir="$INSTALL_DIR/packages/venv"
    info "创建虚拟环境..."
    "$PYTHON_BIN" -m venv "$venv_dir"

    local venv_python
    venv_python="$venv_dir/bin/python"
    [ -x "$venv_python" ] || die "venv 创建失败: $venv_python"

    info "升级 pip..."
    "$venv_python" -m pip install --upgrade pip setuptools wheel --quiet

    info "安装 DrSai 后端 (editable)..."
    local drsai_pkg="$SRC_ROOT/cores/python/packages/drsai"
    # 跳过 TUI 构建（后面单独构建）
    DRSAI_SKIP_TUI_BUILD=1 "$venv_python" -m pip install -e "$drsai_pkg" --quiet

    local version
    version=$("$venv_python" -c "from drsai.version import __version__; print(__version__)" 2>/dev/null || echo "unknown")
    ok "DrSai 后端版本: $version"

    VENV_PYTHON="$venv_python"
}

# ══════════════════════════════════════════════════════════════════════════════
#  7. SETUP NODE + PNPM
# ══════════════════════════════════════════════════════════════════════════════
setup_node() {
    section "Node.js 环境配置"

    local node_dir="$INSTALL_DIR/packages/node"
    local npm_bin="$node_dir/bin/npm"

    [ -x "$npm_bin" ] || die "npm 未找到: $npm_bin"

    # 安装 pnpm 到 node 目录（本地，不污染全局）
    info "安装 pnpm..."
    "$npm_bin" install -g pnpm --prefix="$node_dir" 2>/dev/null || {
        warn "npm install pnpm 失败，尝试 corepack..."
        "$node_dir/bin/corepack" enable 2>/dev/null || true
        "$node_dir/bin/corepack" prepare pnpm@latest --activate 2>/dev/null || true
    }

    local pnpm_bin="$node_dir/bin/pnpm"
    if [ -x "$pnpm_bin" ]; then
        ok "pnpm: $("$pnpm_bin" -v 2>&1)"
    else
        warn "pnpm 安装失败，将尝试用 npm 构建 TUI"
    fi

    NODE_DIR="$node_dir"
}

# ══════════════════════════════════════════════════════════════════════════════
#  8. BUILD TUI
# ══════════════════════════════════════════════════════════════════════════════
build_tui() {
    section "构建 TUI"

    local tui_dir="$SRC_ROOT/apps/ui-tui"

    # 如果已有预构建 bundle，跳过
    if [ -f "$tui_dir/dist/entry.mjs" ]; then
        ok "已有预构建 bundle: dist/entry.mjs"
        return 0
    fi

    # 将 node/bin 加入 PATH（确保 pnpm/node 可用）
    export PATH="$NODE_DIR/bin:$PATH"

    local pnpm_bin="$NODE_DIR/bin/pnpm"
    local npm_bin="$NODE_DIR/bin/npm"

    cd "$tui_dir"

    # 安装依赖 (最多重试 3 次)
    local retry=0
    while [ $retry -lt 3 ]; do
        retry=$((retry + 1))
        info "安装 TUI 依赖 (尝试 $retry/3)..."
        if [ -x "$pnpm_bin" ]; then
            if "$pnpm_bin" install --frozen-lockfile 2>/dev/null || "$pnpm_bin" install; then
                break
            fi
        else
            if "$npm_bin" install; then
                break
            fi
        fi
        warn "依赖安装失败，重试..."
        [ $retry -eq 3 ] && die "TUI 依赖安装失败 (3 次重试后放弃)"
    done

    # 构建
    info "构建 TUI bundle..."
    if [ -x "$pnpm_bin" ]; then
        "$pnpm_bin" build || die "pnpm build 失败"
    else
        "$npm_bin" run build || die "npm build 失败"
    fi

    [ -f "$tui_dir/dist/entry.mjs" ] || die "TUI 构建失败: dist/entry.mjs 未生成"
    ok "TUI 构建成功: $(du -h "$tui_dir/dist/entry.mjs" | cut -f1)"

    cd - >/dev/null
}

# ══════════════════════════════════════════════════════════════════════════════
#  9. CREATE LAUNCHER
# ══════════════════════════════════════════════════════════════════════════════
create_launcher() {
    section "创建启动脚本"

    local bin_dir="$INSTALL_DIR/bin"
    mkdir -p "$bin_dir"

    local launcher="$bin_dir/opendrsai"
    local tui_dir="$SRC_ROOT/apps/ui-tui"
    local venv_python="$INSTALL_DIR/packages/venv/bin/python"
    local src_root="$SRC_ROOT"
    cat > "$launcher" <<LAUNCHER_EOF
#!/usr/bin/env bash
set -e
# ── OpenDrSai 启动脚本 (自包含，不依赖系统 Python/Node) ──
INSTALL_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
export DRSAI_HOME="\${DRSAI_HOME:-\$INSTALL_DIR}"
export DRSAI_UI_TUI_DIR="$tui_dir"
# 关键：告诉 TUI 用 venv 里的 Python 来启动 gateway 子进程
# 否则 TUI 会 fallback 到系统 python3 (没有 drsai 及其依赖)
export DRSAI_PYTHON="$venv_python"
export DRSAI_PYTHON_SRC_ROOT="$src_root/cores/python/packages/drsai/src"
export VIRTUAL_ENV="\$INSTALL_DIR/packages/venv"
export PATH="\$INSTALL_DIR/packages/node/bin:\$PATH"
exec "\$INSTALL_DIR/packages/venv/bin/python" -m drsai.backend.run_cli "\$@"
LAUNCHER_EOF
    chmod +x "$launcher"

    ok "启动脚本: $launcher"
}

# ══════════════════════════════════════════════════════════════════════════════
#  10. VERIFY
# ══════════════════════════════════════════════════════════════════════════════
verify() {
    section "验证安装"

    info "检查 drsai 导入..."
    local r
    r=$("$VENV_PYTHON" -c "import drsai; print('ok')" 2>&1)
    [ "$r" = "ok" ] && ok "drsai 导入成功" || err "导入失败: $r"

    info "检查版本..."
    local v
    v=$("$VENV_PYTHON" -W ignore -c "from drsai.version import __version__; print(__version__)" 2>&1 || echo "unknown")
    ok "drsai 版本: $v"

    [ -x "$INSTALL_DIR/bin/opendrsai" ] && ok "启动脚本: $INSTALL_DIR/bin/opendrsai"
    [ -f "$SRC_ROOT/apps/ui-tui/dist/entry.mjs" ] && ok "TUI bundle: OK"
    [ -x "$INSTALL_DIR/packages/python/bin/python3" ] && ok "Python: $($INSTALL_DIR/packages/python/bin/python3 --version 2>&1)"
    [ -x "$INSTALL_DIR/packages/node/bin/node" ] && ok "Node: $($INSTALL_DIR/packages/node/bin/node -v 2>&1)"
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════
main() {
    printf "\n${C_C}${C_B}"
    printf "  ╔══════════════════════════════════════════════════════════╗\n"
    printf "  ║           OpenDrSai Installer — Self-Contained         ║\n"
    printf "  ║    便携 Python + Node — 零系统污染                      ║\n"
    printf "  ╚══════════════════════════════════════════════════════════╝\n"
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
    printf "  ╔══════════════════════════════════════════════════════════╗\n"
    printf "  ║                    安装完成!                             ║\n"
    printf "  ╚══════════════════════════════════════════════════════════╝\n"
    printf "${C_RST}\n"

    printf "  ${C_B}安装目录:${C_RST}    $INSTALL_DIR\n"
    printf "  ${C_B}Python:${C_RST}       $INSTALL_DIR/packages/python\n"
    printf "  ${C_B}Node:${C_RST}         $INSTALL_DIR/packages/node\n"
    printf "  ${C_B}虚拟环境:${C_RST}    $INSTALL_DIR/packages/venv\n"
    printf "  ${C_B}源码:${C_RST}         $INSTALL_DIR/packages/src\n"
    printf "  ${C_B}启动脚本:${C_RST}    $INSTALL_DIR/bin/opendrsai\n"
    printf "\n"
    printf "  ${C_Y}下一步:${C_RST}\n"
    printf "    将以下路径添加到环境变量:\n"
    printf "    ${C_B}export PATH=\"$INSTALL_DIR/bin:\$PATH\"${C_RST}\n"
    printf "\n"
    printf "    然后运行: ${C_B}opendrsai${C_RST}\n"
    printf "    首次运行会触发 API 密钥配置向导\n"
    printf "\n"
    printf "  ${C_GRAY}未修改系统 Python/Node，所有环境自包含。${C_RST}\n"
}

main "$@"
