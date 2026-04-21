# 使用官方 Python 3.12 基础镜像
FROM python:3.12-slim
USER root

# 设置工作目录
WORKDIR /app

# 安装系统依赖和基础工具
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    # 基础系统工具
    openssh-server sudo vim nano htop less procps \
    net-tools iproute2 curl wget dnsutils \
    # 版本控制和终端工具
    git tmux screen \
    # Python编译依赖
    build-essential gcc g++ make \
    python3-dev \
    # 常用库开发文件
    libpq-dev libssl-dev libffi-dev \
    # 系统服务管理
    supervisor \
    ufw iptables \
    # Node.js 和 npm（用于安装 pm2）
    nodejs npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# # 安装Caddy
# RUN curl -fsSL https://dl.google.com/go/go1.22.0.linux-amd64.tar.gz -o go.tar.gz \
#     && tar -xzf go.tar.gz -C /usr/local \
#     && rm go.tar.gz \
#     && export PATH=/usr/local/go/bin:$PATH \
#     && go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest \
#     && /root/go/bin/xcaddy build \
#     && mv caddy /usr/local/bin/ \
#     && chmod +x /usr/local/bin/caddy \
#     && rm -rf /root/go

# 配置SSH（允许密码和公钥认证）
RUN mkdir -p /run/sshd \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && ssh-keygen -A

# 创建supervisor配置目录
RUN mkdir -p /etc/supervisor/conf.d

# 升级pip和安装常用工具
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# 安装 pm2 进程管理器# 安装 Chromium 浏览器驱动（用于 playwright-cli）
RUN npm install -g pm2 @playwright/cli@latest \
    && npx -y playwright install chromium \
    && playwright-cli install chromium

# 复制整个项目到容器内
COPY . /app

# 安装 Python 包（按依赖顺序）
# 先安装 drsai 核心包
WORKDIR /app/python/packages/drsai
RUN pip install --no-cache-dir -e .

# 安装 drsai_ui UI 包
WORKDIR /app/python/packages/drsai_ui
RUN pip install --no-cache-dir -e .

# 安装 drsai_ext 扩展包
WORKDIR /app/python/packages/drsai_ext
RUN pip install --no-cache-dir -e .

# 创建必要的目录
WORKDIR /app
RUN mkdir -p workspace/dataset workspace/runs

# 设置环境变量
ENV SYSTEM_SKILLS_DIR=/app/agent_skills/skills

# 暴露端口（根据 run_drsai_agent.py 中的配置）
EXPOSE 22 42858 8086

# 设置默认工作目录
WORKDIR /app

# # 默认启动命令
# CMD ["python", "run_drsai_agent.py"]
