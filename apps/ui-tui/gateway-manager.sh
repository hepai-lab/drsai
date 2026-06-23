#!/bin/bash
# Gateway Manager - 管理 TUI Gateway 后台进程

GATEWAY_NAME="tui_gateway"
PID_FILE="$HOME/.drsai/tui_gateway.pid"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印彩色消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. 查看 Gateway 状态
status() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Gateway 进程状态"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # 查找所有 gateway 进程
    PIDS=$(pgrep -f "$GATEWAY_NAME")
    
    if [ -z "$PIDS" ]; then
        print_info "没有运行中的 gateway 进程"
    else
        print_success "找到 $(echo "$PIDS" | wc -l) 个 gateway 进程:"
        echo ""
        ps aux | head -1
        ps aux | grep "$GATEWAY_NAME" | grep -v grep
    fi
    
    echo ""
    
    # 检查 PID 文件
    if [ -f "$PID_FILE" ]; then
        PID_IN_FILE=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$PID_IN_FILE" ]; then
            print_info "PID 文件存在: $PID_FILE"
            echo "  记录的 PID: $PID_IN_FILE"
            
            # 检查进程是否真的存在
            if kill -0 "$PID_IN_FILE" 2>/dev/null; then
                print_success "  进程存活 ✓"
            else
                print_warning "  进程不存在（可能是孤儿 PID 文件）"
            fi
        fi
    else
        print_info "PID 文件不存在"
    fi
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 2. 停止 Gateway
stop() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  停止 Gateway 进程"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    PIDS=$(pgrep -f "$GATEWAY_NAME")
    
    if [ -z "$PIDS" ]; then
        print_info "没有运行中的 gateway 进程"
    else
        for PID in $PIDS; do
            print_info "停止进程 PID=$PID ..."
            
            # 尝试 SIGTERM (优雅关闭)
            kill -TERM "$PID" 2>/dev/null
            
            # 等待最多 3 秒
            for i in {1..3}; do
                sleep 1
                if ! kill -0 "$PID" 2>/dev/null; then
                    print_success "进程 $PID 已停止"
                    break
                fi
            done
            
            # 如果还活着，使用 SIGKILL
            if kill -0 "$PID" 2>/dev/null; then
                print_warning "进程 $PID 未响应 SIGTERM，使用 SIGKILL ..."
                kill -KILL "$PID" 2>/dev/null
                sleep 1
                
                if ! kill -0 "$PID" 2>/dev/null; then
                    print_success "进程 $PID 已强制停止"
                else
                    print_error "无法停止进程 $PID"
                fi
            fi
        done
    fi
    
    # 清理 PID 文件
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
        print_info "已删除 PID 文件"
    fi
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 3. 清理所有孤儿进程
cleanup() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  清理孤儿 Gateway 进程"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    stop
    
    print_success "清理完成"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 4. 查看 Gateway 日志（如果有）
logs() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Gateway 日志"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    LOG_FILE="$HOME/.drsai/logs/tui_gateway.log"
    
    if [ -f "$LOG_FILE" ]; then
        print_info "日志文件: $LOG_FILE"
        echo ""
        tail -50 "$LOG_FILE"
    else
        print_info "日志文件不存在: $LOG_FILE"
        print_info "Gateway 的日志通常输出到 stderr"
    fi
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 5. 重启 Gateway (通过重启 TUI)
restart() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  重启 Gateway"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    print_info "停止现有进程..."
    stop
    
    echo ""
    print_info "Gateway 会在下次运行 'drsai' 命令时自动启动"
    print_info "运行: drsai"
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 6. 帮助信息
usage() {
    cat << 'HELP'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Gateway Manager - TUI Gateway 管理工具
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用法: ./gateway-manager.sh [命令]

命令:
  status    - 查看 Gateway 进程状态
  stop      - 停止所有 Gateway 进程
  cleanup   - 清理所有孤儿进程（同 stop）
  restart   - 重启 Gateway（停止后提示重新运行 drsai）
  logs      - 查看 Gateway 日志（如果有）
  help      - 显示此帮助信息

示例:
  ./gateway-manager.sh status   # 查看状态
  ./gateway-manager.sh stop     # 停止进程
  ./gateway-manager.sh cleanup  # 清理孤儿进程

说明:
  • Gateway 由 TUI 自动管理，通常不需要手动干预
  • 如果 TUI 崩溃，可能留下孤儿进程，使用 cleanup 清理
  • Gateway 会在下次运行 drsai 时自动启动

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HELP
}

# 主程序
case "${1:-status}" in
    status)
        status
        ;;
    stop)
        stop
        ;;
    cleanup)
        cleanup
        ;;
    restart)
        restart
        ;;
    logs)
        logs
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        print_error "未知命令: $1"
        echo ""
        usage
        exit 1
        ;;
esac
