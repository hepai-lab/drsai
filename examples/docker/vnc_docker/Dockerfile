# Dockerfile
FROM almalinux:9.3

# 安装必要的软件包
RUN dnf update -y && \
    dnf install -y \
    epel-release && \
    dnf install -y --allowerasing \
    tigervnc-server \
    xorg-x11-server-Xvfb \
    xorg-x11-fonts-Type1 \
    xorg-x11-drivers \
    dejavu-sans-fonts \
    liberation-fonts \
    mesa-dri-drivers \
    sudo \
    which \
    wget \
    curl \
    bash \
    nano \
    vim \
    firefox \
    xterm \
    xclock \
    xsetroot \
    openbox \
    tint2 \
    git \
    python3-websockify \
    python3-numpy \
    supervisor && \
    dnf clean all

# 创建用户
RUN useradd -m -s /bin/bash vncuser && \
    echo "vncuser:vncpassword" | chpasswd && \
    usermod -aG wheel vncuser

# 配置VNC
USER vncuser
WORKDIR /home/vncuser

# 创建VNC配置目录
RUN mkdir -p ~/.vnc

# 创建xstartup文件
RUN echo '#!/bin/bash' > ~/.vnc/xstartup && \
    echo 'export USER=vncuser' >> ~/.vnc/xstartup && \
    echo 'cd /home/vncuser' >> ~/.vnc/xstartup && \
    echo '[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup' >> ~/.vnc/xstartup && \
    echo '[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources' >> ~/.vnc/xstartup && \
    echo 'xsetroot -solid grey' >> ~/.vnc/xstartup && \
    echo 'export XKL_XMODMAP_DISABLE=1' >> ~/.vnc/xstartup && \
    echo 'tint2 &' >> ~/.vnc/xstartup && \
    echo 'openbox &' >> ~/.vnc/xstartup && \
    chmod +x ~/.vnc/xstartup

# 创建openbox配置
RUN mkdir -p ~/.config/openbox && \
    echo '<?xml version="1.0" encoding="UTF-8"?>' > ~/.config/openbox/rc.xml && \
    echo '<openbox_config xmlns="http://openbox.org/3.4/rc">' >> ~/.config/openbox/rc.xml && \
    echo '  <theme><name>Clearlooks</name></theme>' >> ~/.config/openbox/rc.xml && \
    echo '</openbox_config>' >> ~/.config/openbox/rc.xml

# 切换回root用户
USER root

# 手动安装noVNC
RUN git clone https://github.com/novnc/noVNC.git /usr/share/novnc && \
    git clone https://github.com/novnc/websockify /usr/share/novnc/utils/websockify && \
    ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# 创建supervisor配置
RUN mkdir -p /var/log/supervisor

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 暴露端口
EXPOSE 5901 6080

# 启动supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]