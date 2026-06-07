#!/usr/bin/env bash
# drsai-dev.sh — DrSai 开发环境统一管理脚本（pm2 编排前后端）
#
# 用法:
#   ./drsai-dev.sh start   [backend|frontend|all]   启动（默认 all）
#   ./drsai-dev.sh stop    [backend|frontend|all]   停止
#   ./drsai-dev.sh restart [backend|frontend|all]   重启（重新读取端口/.env）
#   ./drsai-dev.sh status                            进程状态 + 端口监听
#   ./drsai-dev.sh verify                            完整健康链路检查 + 访问地址
#   ./drsai-dev.sh logs    [backend|frontend]        查看日志
#
# 设计说明见 agent_skills/skills/drsai-dev-skill/SKILL.md
set -euo pipefail

# ───────────────────────── 配置（可用 env 覆盖）─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

CONDA_ENV="${DRSAI_CONDA_ENV:-drsai}"
BACKEND_HOST="${DRSAI_BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${DRSAI_BACKEND_PORT:-4291}"
FRONTEND_PORT="${DRSAI_FRONTEND_PORT:-4290}"

PM2_BACKEND="${DRSAI_PM2_BACKEND:-drsai-dev-backend}"
PM2_FRONTEND="${DRSAI_PM2_FRONTEND:-drsai-dev-frontend}"

ADMIN_USER="${DRSAI_ADMIN_USER:-admin}"
ADMIN_PASS="${DRSAI_ADMIN_PASS:-admin123456}"

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# ───────────────────────── 颜色 / 日志 ─────────────────────────
if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_GRN=$'\e[32m'; C_YLW=$'\e[33m'; C_BLU=$'\e[34m'; C_BLD=$'\e[1m'; C_RST=$'\e[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_BLD=''; C_RST=''
fi
info() { echo "${C_BLU}[*]${C_RST} $*"; }
ok()   { echo "${C_GRN}[ok]${C_RST} $*"; }
warn() { echo "${C_YLW}[!]${C_RST} $*" >&2; }
err()  { echo "${C_RED}[x]${C_RST} $*" >&2; }
die()  { err "$*"; exit 1; }

# ───────────────────────── 通用工具检查 ─────────────────────────
need_cmd()   { command -v "$1" &>/dev/null || die "缺少命令: $1"; }
ensure_pm2() { need_cmd pm2; }

ensure_conda() {
  if ! command -v conda &>/dev/null; then
    for base in "$HOME/miniconda3" "$HOME/anaconda3" /opt/conda; do
      if [[ -f "$base/etc/profile.d/conda.sh" ]]; then
        # shellcheck disable=SC1090
        source "$base/etc/profile.d/conda.sh"; break
      fi
    done
  fi
  command -v conda &>/dev/null || die "未找到 conda，请安装 miniconda 或配置 PATH"
  conda activate "$CONDA_ENV" 2>/dev/null \
    || die "conda 环境 '$CONDA_ENV' 不存在（conda env list 查看）"
  command -v drsai-ui &>/dev/null \
    || die "激活 '$CONDA_ENV' 后仍找不到 drsai-ui（drsai_ui 是否已 editable 安装？）"
}

ensure_node() {
  if ! command -v node &>/dev/null; then
    export NVM_DIR
    # shellcheck disable=SC1091
    [[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
  fi
  command -v node &>/dev/null || die "未找到 node（nvm: $NVM_DIR/nvm.sh 缺失）。请安装 Node >= 18"
  command -v yarn &>/dev/null || die "未找到 yarn，请执行: npm install -g yarn"
}

# ───────────────────────── 环境文件预检 ─────────────────────────
ensure_backend_env() {
  # .env 含密钥（HEPAI_API_KEY 等），缺失时不自动创建，明确提示
  [[ -f "$PROJECT_ROOT/.env" ]] && return 0
  if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
    die ".env 缺失。请先复制并填写密钥:  cp .env.example .env"
  fi
  die "项目根缺少 .env，且无 .env.example 可复制"
}

ensure_frontend_env() {
  [[ -f "$FRONTEND_DIR/.env.development" ]] && return 0
  if [[ -f "$FRONTEND_DIR/.env.example" ]]; then
    info "从 .env.example 创建 frontend/.env.development"
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env.development"
  else
    die "frontend/.env.development 缺失，且无 .env.example 可复制"
  fi
}

ensure_frontend_deps() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]] || [[ -z "$(ls -A "$FRONTEND_DIR/node_modules" 2>/dev/null)" ]]; then
    info "安装前端依赖 (yarn install --legacy-peer-deps)"
    ( cd "$FRONTEND_DIR" && yarn install --legacy-peer-deps )
  fi
}

# ───────────────────────── 启动 ─────────────────────────
# describe-or-start：进程已存在则 restart（刷新配置），否则新建
pm2_up() {
  local name="$1"; shift
  if pm2 describe "$name" &>/dev/null; then
    info "pm2 进程 '$name' 已存在，重启以刷新配置"
    pm2 restart "$name" --update-env
  else
    info "启动 pm2 进程 '$name'"
    "$@"
  fi
}

start_backend() {
  ensure_pm2; ensure_backend_env; ensure_conda
  info "后端 → $BACKEND_HOST:$BACKEND_PORT (reload 开)"
  # 在 pm2 子进程内 source .env 并 exec，确保后端及 reload worker 都读到密钥/配置
  pm2_up "$PM2_BACKEND" \
    pm2 start -n "$PM2_BACKEND" --cwd "$PROJECT_ROOT" \
      bash -- -lc "source '$PROJECT_ROOT/.env'; exec drsai-ui ui --host $BACKEND_HOST --port $BACKEND_PORT --reload"
  ok "后端已启动"
}

start_frontend() {
  ensure_pm2; ensure_node; ensure_frontend_env; ensure_frontend_deps
  info "前端 → 端口 $FRONTEND_PORT (Gatsby HMR)"
  pm2_up "$PM2_FRONTEND" \
    pm2 start -n "$PM2_FRONTEND" --cwd "$FRONTEND_DIR" \
      --env GATSBY_DEV_PORT="$FRONTEND_PORT" \
      yarn -- develop
  pm2 set "$PM2_FRONTEND:GATSBY_DEV_PORT" "$FRONTEND_PORT" >/dev/null 2>&1 || true
  ok "前端已启动"
}

cmd_start() {
  case "$1" in
    backend)  start_backend ;;
    frontend) start_frontend ;;
    all)      start_backend; start_frontend ;;
  esac
  pm2 save >/dev/null 2>&1 || true
  echo; cmd_status
}

# ───────────────────────── 停止 / 重启 ─────────────────────────
_names_for() {
  case "$1" in
    backend)  echo "$PM2_BACKEND" ;;
    frontend) echo "$PM2_FRONTEND" ;;
    all)      echo "$PM2_BACKEND $PM2_FRONTEND" ;;
  esac
}

cmd_stop() {
  ensure_pm2
  local n
  for n in $(_names_for "$1"); do
    if pm2 stop "$n" 2>/dev/null; then ok "已停止 $n"; else warn "$n 未在运行"; fi
  done
}

# restart 走 stop+start，确保改了端口/.env 能真正生效（裸 pm2 restart 会沿用旧 --port）
cmd_restart() { cmd_stop "$1"; cmd_start "$1"; }

# ───────────────────────── 状态 ─────────────────────────
port_listening() {
  if command -v ss &>/dev/null; then
    ss -ltn 2>/dev/null | grep -q ":$1 "
  elif command -v lsof &>/dev/null; then
    lsof -iTCP:"$1" -sTCP:LISTEN &>/dev/null
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

port_state() {
  if port_listening "$1"; then ok "$2 端口 $1 监听中"; else err "$2 端口 $1 未监听"; fi
}

cmd_status() {
  ensure_pm2
  echo "${C_BLD}pm2 进程:${C_RST}"
  pm2 list 2>/dev/null | grep -E "name|$PM2_BACKEND|$PM2_FRONTEND" || true
  echo
  echo "${C_BLD}端口:${C_RST}"
  port_state "$BACKEND_PORT"  "后端"
  port_state "$FRONTEND_PORT" "前端"
}

# ───────────────────────── 验证 ─────────────────────────
# 独立外部 IP：优先 MTU=1500 网卡(net1)，回退非 eth0，再回退首个 global IP
detect_external_ip() {
  local best="" ip mtu ifc
  while read -r ifc ip; do
    [[ "$ifc" == "lo" ]] && continue
    mtu=$(cat "/sys/class/net/$ifc/mtu" 2>/dev/null || echo 0)
    if [[ "$mtu" == "1500" ]]; then echo "$ip"; return 0; fi
    if [[ "$ifc" != "eth0" && -z "$best" ]]; then best="$ip"; fi
  done < <(ip -o -4 addr show 2>/dev/null | awk '{split($4,a,"/"); print $2, a[1]}')
  if [[ -n "$best" ]]; then echo "$best"; return 0; fi
  ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}'
}

PASS=0; FAIL=0
pass() { ok "$1";  PASS=$((PASS+1)); }
fail() { err "$1"; FAIL=$((FAIL+1)); }

cmd_verify() {
  need_cmd curl
  local base="http://localhost:$BACKEND_PORT" ip token origin code
  ip="$(detect_external_ip)"
  origin="http://${ip:-localhost}:$FRONTEND_PORT"
  info "验证目标 $base （外部 IP: ${ip:-未知}）"

  # 1. 端口监听
  if port_listening "$BACKEND_PORT";  then pass "后端端口 $BACKEND_PORT 监听中"; else fail "后端端口 $BACKEND_PORT 未监听"; fi
  if port_listening "$FRONTEND_PORT"; then pass "前端端口 $FRONTEND_PORT 监听中"; else fail "前端端口 $FRONTEND_PORT 未监听"; fi

  # 2. GET /api/version == 200
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/version" 2>/dev/null || echo 000)
  if [[ "$code" == "200" ]]; then pass "GET /api/version == 200"; else fail "GET /api/version → $code"; fi

  # 3. 本地登录 → token
  token="$(curl -s -X POST "$base/api/umtlocal/login?user_id=$ADMIN_USER&password=$ADMIN_PASS" 2>/dev/null \
    | sed -n 's/.*"access_token"[: ]*"\([^"]*\)".*/\1/p')"
  if [[ -n "$token" ]]; then pass "本地登录 ($ADMIN_USER) → 取得 token"; else fail "本地登录 ($ADMIN_USER) 失败"; fi

  # 4. JWT 校验 GET /api/auth/me
  if [[ -n "$token" ]]; then
    if curl -s "$base/api/auth/me" -H "Authorization: Bearer $token" 2>/dev/null | grep -q '"user_id"'; then
      pass "GET /api/auth/me (Bearer) → user_id"
    else
      fail "GET /api/auth/me 未返回 user_id"
    fi
  else
    fail "GET /api/auth/me 跳过（无 token）"
  fi

  # 5. CORS 预检
  if curl -s -i -X OPTIONS "$base/api/version" \
        -H "Origin: $origin" -H "Access-Control-Request-Method: GET" 2>/dev/null \
      | grep -qi "access-control-allow-origin: *$origin"; then
    pass "CORS 预检 ($origin) → allow-origin 匹配"
  else
    fail "CORS 预检 ($origin) 未通过"
  fi

  echo
  echo "${C_BLD}结果: ${C_GRN}$PASS 通过${C_RST}, ${C_RED}$FAIL 失败${C_RST}"
  echo "${C_BLD}访问地址:${C_RST} ${C_GRN}http://${ip:-localhost}:$FRONTEND_PORT${C_RST}  (后端: http://${ip:-localhost}:$BACKEND_PORT/api)"
  [[ $FAIL -eq 0 ]] || exit 1
}

# ───────────────────────── 日志 ─────────────────────────
cmd_logs() {
  ensure_pm2
  case "$1" in
    backend)  exec pm2 logs "$PM2_BACKEND" ;;
    frontend) exec pm2 logs "$PM2_FRONTEND" ;;
    *) die "logs 目标须为 backend|frontend" ;;
  esac
}

# ───────────────────────── 分发 ─────────────────────────
require_target() {
  case "$1" in backend|frontend|all) ;; *) die "目标须为 backend|frontend|all（收到 '$1'）";; esac
}

usage() {
  cat <<EOF
${C_BLD}drsai-dev.sh${C_RST} — DrSai 开发环境管理 (pm2)

  start   [backend|frontend|all]   启动（默认 all），预检 + 正确 host/port
  stop    [backend|frontend|all]   停止
  restart [backend|frontend|all]   重启（重新读取端口/.env）
  status                           pm2 状态 + 端口监听
  verify                           完整健康链路 + 访问地址
  logs    [backend|frontend]       查看 pm2 日志

  默认账号: ${ADMIN_USER}/${ADMIN_PASS}（管理员）、dev/dev123456（开发者）
  端口可覆盖: DRSAI_BACKEND_PORT(=$BACKEND_PORT) DRSAI_FRONTEND_PORT(=$FRONTEND_PORT)
            DRSAI_CONDA_ENV(=$CONDA_ENV)
EOF
}

main() {
  local cmd="${1:-}"; shift || true
  local target="${1:-all}"
  case "$cmd" in
    start)   require_target "$target"; cmd_start   "$target" ;;
    stop)    require_target "$target"; cmd_stop    "$target" ;;
    restart) require_target "$target"; cmd_restart "$target" ;;
    status)  cmd_status ;;
    verify)  cmd_verify ;;
    logs)    cmd_logs "${1:-backend}" ;;
    ""|-h|--help|help) usage ;;
    *) err "未知命令: $cmd"; usage; exit 2 ;;
  esac
}

main "$@"
