#!/bin/bash
# cleanup.sh

echo "停止并删除容器..."
docker stop almalinux-vnc 2>/dev/null || true
docker rm almalinux-vnc 2>/dev/null || true

echo "删除镜像..."
docker rmi almalinux-vnc:9.3 2>/dev/null || true

echo "清理完成！"