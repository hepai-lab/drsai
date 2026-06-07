#!/bin/bash
# run_drsai_ui.sh — 向后兼容入口，转发到统一管理脚本 drsai-dev.sh
#
# 历史上此脚本直接 pm2 start 前后端，但缺少 --host/--port 导致后端绑到
# 127.0.0.1:8081（前端连不上）。现统一由 drsai-dev.sh 管理：正确的
# --host 0.0.0.0 --port 4291、幂等预检、健康验证。
#
# 直接管理服务请用：
#   ./drsai-dev.sh start|stop|restart|status|verify|logs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/drsai-dev.sh" start all
