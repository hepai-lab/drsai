#!/bin/bash
# stop_wetty.sh - 停止wetty容器

set -e

# 默认配置
CONTAINER_NAME="${WETTY_CONTAINER_NAME:-wetty-server}"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}正在停止wetty容器...${NC}"

# 检查容器是否存在
if docker ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    # 检查容器是否正在运行
    if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "停止容器: $CONTAINER_NAME"
        docker stop "$CONTAINER_NAME"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ 容器已成功停止${NC}"
        else
            echo -e "${RED}✗ 停止容器失败${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}容器 $CONTAINER_NAME 已经停止${NC}"
    fi
else
    echo -e "${RED}错误: 容器 $CONTAINER_NAME 不存在${NC}"
    exit 1
fi

# 显示容器状态
echo -e "\n当前容器状态:"
docker ps -a | grep "$CONTAINER_NAME" || echo "容器不存在"