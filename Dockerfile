# 使用 Docker 内置的 Dockerfile 解析器，避免构建时额外拉取 docker/dockerfile frontend 镜像
# 使用官方 Python 3.12 基础镜像
FROM python:3.12-slim
USER root

# 设置工作目录
WORKDIR /app

# 项目 Python 虚拟环境。PATH 置于最前，确保构建和运行都不使用系统 site-packages。
ENV VIRTUAL_ENV=/app/.venv \
    PATH=/app/.venv/bin:${PATH} \
    PYTHONNOUSERSITE=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

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
    # Node.js 和 npm（用于安装 pm2 和 Claude Code）
    nodejs npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 配置SSH（允许密码和公钥认证）
RUN mkdir -p /run/sshd \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && ssh-keygen -A

# 创建supervisor配置目录
RUN mkdir -p /etc/supervisor/conf.d

# 创建项目独立的 Python 环境，并只在该环境中升级打包工具
RUN python -m venv "${VIRTUAL_ENV}" \
    && "${VIRTUAL_ENV}/bin/python" -m pip install --upgrade pip setuptools wheel

# # 安装 Claude Code 支持（Anthropic SDK）
# RUN python -m pip install anthropic

# 安装 Claude Code CLI 工具
RUN npm install -g @anthropic-ai/claude-code

# 安装 pm2 进程管理器和 Chromium 浏览器驱动（用于 playwright-cli）
RUN npm install -g pm2 @playwright/cli@latest \
    && npx -y playwright install chromium

# 安装 VS Code Server (code-server)
RUN curl -fsSL https://github.com/coder/code-server/releases/download/v4.116.0/code-server_4.116.0_amd64.deb -o /tmp/code-server.deb \
    && dpkg -i /tmp/code-server.deb \
    && rm /tmp/code-server.deb

# 配置 code-server - 使用环境变量确保绑定到所有接口
RUN mkdir -p /root/.config/code-server
RUN echo 'bind-addr: 0.0.0.0:8080' > /root/.config/code-server/config.yaml \
    && echo 'auth: none' >> /root/.config/code-server/config.yaml \
    && echo 'cert: false' >> /root/.config/code-server/config.yaml

# 设置环境变量强制使用指定的配置
ENV CODESERVER_CONFIG=/root/.config/code-server/config.yaml

# 复制整个项目到容器内（.dockerignore 必须排除宿主机 .venv）
COPY . /app

# 安装 Python 包（按依赖顺序）。使用 python -m pip 确保安装到 /app/.venv。
# 1. 先安装 drsai 核心包
WORKDIR /app/cores/python/packages/drsai
RUN python -m pip install -e .

# 2. 安装 drsai_ext 扩展包（drsai_ui 依赖它，必须在 drsai_ui 之前安装）
WORKDIR /app/cores/python/packages/drsai_ext
RUN python -m pip install -e .

# 3. 安装 drsai_ui UI 包（依赖 drsai 和 drsai_ext，放在最后）
WORKDIR /app/apps/webui/backend
RUN python -m pip install -e .

# 构建期验证：解释器和依赖必须来自项目虚拟环境
RUN python -c "import sys; assert sys.executable.startswith('/app/.venv/'), sys.executable; assert sys.prefix == '/app/.venv', sys.prefix; print(sys.executable)"

# 创建必要的目录
WORKDIR /app
RUN mkdir -p workspace/dataset workspace/runs

# 设置环境变量
ENV SYSTEM_SKILLS_DIR=/app/skills/skills

# 暴露端口（根据 run_drsai_agent.py 中的配置，加上 code-server 的 8080 端口）
EXPOSE 22 42858 8086 8080

# 设置默认工作目录
WORKDIR /app

# 创建启动脚本。显式使用 /app/.venv/bin/python，避免 shell 环境改变 PATH 后回退到系统 Python。
RUN printf '#!/bin/bash\n\
\n\
export VIRTUAL_ENV=/app/.venv\n\
export PATH=/app/.venv/bin:$PATH\n\
export PYTHONNOUSERSITE=1\n\
\n\
# 启动 SSH 服务\n\
service ssh start\n\
\n\
# 启动 code-server\n\
code-server --config /root/.config/code-server/config.yaml &\n\
\n\
# 启动 drsai 服务（即使失败也保持容器运行）\n\
/app/.venv/bin/python /app/run_drsai_agent.py || true\n\
\n\
# 保持容器运行\n\
tail -f /dev/null\n' > /app/start-services.sh

RUN chmod +x /app/start-services.sh

# 默认启动命令
CMD ["bash", "/app/start-services.sh"]
