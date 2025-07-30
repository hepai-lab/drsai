#!/bin/bash
# cleanup_wetty.sh - 完全清理wetty容器和镜像

set -e

# 默认配置
CONTAINER_NAME="${WETTY_CONTAINER_NAME:-wetty-server}"
REMOVE_IMAGE="${WETTY_REMOVE_IMAGE:-false}"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}开始清理wetty...${NC}"

# 1. 停止容器
if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "停止容器: $CONTAINER_NAME"
    docker stop "$CONTAINER_NAME"
    echo -e "${GREEN}✓ 容器已停止${NC}"
else
    echo -e "容器未在运行"
fi

# 2. 删除容器
if docker ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "删除容器: $CONTAINER_NAME"
    docker rm "$CONTAINER_NAME"
    echo -e "${GREEN}✓ 容器已删除${NC}"
else
    echo -e "容器不存在"
fi

# 3. 删除镜像（可选）
if [ "$REMOVE_IMAGE" = "true" ] || [ "$1" = "--remove-image" ]; then
    echo -e "${YELLOW}删除wetty镜像...${NC}"
    
    if docker images | grep -q "wettyoss/wetty"; then
        docker rmi wettyoss/wetty:latest
        echo -e "${GREEN}✓ 镜像已删除${NC}"
    else
        echo -e "镜像不存在"
    fi
else
    echo -e "${YELLOW}保留镜像 (使用 --remove-image 或设置 WETTY_REMOVE_IMAGE=true 来删除镜像)${NC}"
fi

# 4. 显示清理结果
echo -e "\n${GREEN}清理完成！${NC}"
echo -e "\n当前Docker状态:"
echo -e "容器列表:"
docker ps -a | grep wetty || echo "  无wetty容器"
echo -e "\n镜像列表:"
docker images | grep wetty || echo "  无wetty镜像"