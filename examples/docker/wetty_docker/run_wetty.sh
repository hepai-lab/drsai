#!/bin/bash
# source .env && ./run_wetty.sh - 启动wetty容器

set -e

USER="xiongdb"
PASSWORD="gpuuserXX_"

# 默认配置
CONTAINER_NAME="${WETTY_CONTAINER_NAME:-wetty-server}"
HOST_PORT="${WETTY_HOST_PORT:-8060}"
# 自动获取本机IP地址
LOCAL_IP=$(hostname -I | awk '{print $1}')
SSH_HOST="${WETTY_SSH_HOST:-$LOCAL_IP}"
SSH_PORT="${WETTY_SSH_PORT:-22}"
SSH_USER="${WETTY_SSH_USER:-$USER}"
SSH_PASSWORD="${WETTY_SSH_PASSWORD:-$PASSWORD}"
SSH_KEY="${WETTY_SSH_KEY:-}"
BASE_PATH="${WETTY_BASE_PATH:-/wetty}"
TITLE="${WETTY_TITLE:-Wetty Terminal}"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查镜像是否存在
if ! docker images | grep -q "wettyoss/wetty"; then
    echo -e "${RED}错误: wetty镜像不存在，请先运行 ./build_wetty.sh${NC}"
    exit 1
fi

# 检查是否已有同名容器在运行
if docker ps -a | grep -q "$CONTAINER_NAME"; then
    echo -e "${YELLOW}警告: 容器 $CONTAINER_NAME 已存在，正在停止并删除...${NC}"
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

# 构建运行命令
DOCKER_CMD="docker run -d --name $CONTAINER_NAME"
DOCKER_CMD="$DOCKER_CMD -p $HOST_PORT:3000"
DOCKER_CMD="$DOCKER_CMD --restart=unless-stopped"

# Wetty参数
WETTY_ARGS=""

# 添加SSH连接参数
if [ -n "$SSH_HOST" ]; then
    WETTY_ARGS="$WETTY_ARGS --ssh-host=$SSH_HOST"
fi

if [ -n "$SSH_PORT" ] && [ "$SSH_PORT" != "22" ]; then
    WETTY_ARGS="$WETTY_ARGS --ssh-port=$SSH_PORT"
fi

if [ -n "$SSH_USER" ]; then
    WETTY_ARGS="$WETTY_ARGS --ssh-user=$SSH_USER"
fi

if [ -n "$SSH_PASSWORD" ]; then
    WETTY_ARGS="$WETTY_ARGS --ssh-pass=$SSH_PASSWORD"
fi

if [ -n "$SSH_KEY" ]; then
    DOCKER_CMD="$DOCKER_CMD -v $SSH_KEY:/home/term/.ssh/id_rsa:ro"
    WETTY_ARGS="$WETTY_ARGS --ssh-key=/home/term/.ssh/id_rsa"
fi

if [ "$BASE_PATH" != "/" ]; then
    WETTY_ARGS="$WETTY_ARGS --base=$BASE_PATH"
fi

if [ -n "$TITLE" ]; then
    WETTY_ARGS="$WETTY_ARGS --title=\"$TITLE\""
fi

# 执行docker运行命令
echo -e "${GREEN}启动wetty容器...${NC}"
echo -e "容器名称: $CONTAINER_NAME"
echo -e "端口映射: $HOST_PORT:3000"
echo -e "SSH目标: $SSH_HOST:$SSH_PORT"

eval "$DOCKER_CMD wettyoss/wetty $WETTY_ARGS"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Wetty容器启动成功！${NC}"
    echo -e "${GREEN}访问地址: http://$LOCAL_IP:$HOST_PORT$BASE_PATH${NC}"
    
    # 显示容器状态
    echo -e "\n容器状态:"
    docker ps | grep "$CONTAINER_NAME"
    
    # 显示日志
    echo -e "\n最近日志:"
    docker logs --tail 10 "$CONTAINER_NAME"
else
    echo -e "${RED}✗ Wetty容器启动失败！${NC}"
    exit 1
fi