#!/bin/bash
# build_wetty.sh - 构建/拉取wetty镜像

set -e

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}开始拉取wettyoss/wetty镜像...${NC}"

# 拉取官方wetty镜像
docker pull wettyoss/wetty:latest

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ wetty镜像拉取成功！${NC}"
    docker images | grep wettyoss/wetty
else
    echo -e "${RED}✗ wetty镜像拉取失败！${NC}"
    exit 1
fi
