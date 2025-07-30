#!/bin/bash
# build_and_run.sh

# 构建Docker镜像
echo "构建AlmaLinux 9.3 VNC镜像..."
docker build -t almalinux-vnc:9.3 .

# 运行容器
echo "启动容器..."
docker run -d \
  --name almalinux-vnc \
  -p 6080:6080 \
  -p 5901:5900 \
  --restart=unless-stopped \
  almalinux-vnc:9.3

echo "容器已启动！"
echo "访问 http://localhost:6080/vnc.html 进入远程桌面"
echo "VNC端口: 5901 (密码: vncpassword)"