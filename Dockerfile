# 使用官方 Python 3.12 基础镜像
FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制 Python 包目录
COPY python/packages /app/python/packages

# 安装 Python 包（按依赖顺序）
# 先安装 drsai 核心包
WORKDIR /app/python/packages/drsai
RUN pip install --no-cache-dir -e .

# 安装 drsai_ext 扩展包
WORKDIR /app/python/packages/drsai_ext
RUN pip install --no-cache-dir -e .

# 安装 drsai_ui UI 包
WORKDIR /app/python/packages/drsai_ui
RUN pip install --no-cache-dir -e .

# 复制示例代码和配置
WORKDIR /app
COPY examples /app/examples
COPY docs /app/docs

# 创建必要的目录
RUN mkdir -p /app/examples/agent_groupchat/assistant_skill/drsai_assistant/workspace/dataset \
    /app/examples/agent_groupchat/assistant_skill/drsai_assistant/workspace/runs

# 设置环境变量
ENV PYTHONPATH=/app/python/packages/drsai/src:/app/python/packages/drsai_ext/src:/app/python/packages/drsai_ui/src:${PYTHONPATH}
ENV WORKDIR=/app/examples/agent_groupchat/assistant_skill/drsai_assistant/workspace/runs

# 暴露端口（根据 run_agent.py 中的配置）
EXPOSE 42818

# 设置默认工作目录
WORKDIR /app/examples/agent_groupchat/assistant_skill/drsai_assistant

# 默认启动命令
CMD ["python", "run_agent.py"]
