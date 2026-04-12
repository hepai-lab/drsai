# DrSAI Assistant Docker 部署指南

本指南介绍如何使用 Docker 部署 DrSAI Assistant。

## 镜像特性

- **Python 3.12** 运行环境
- **SSH 服务器** - 支持远程登录和调试
- **开发工具** - vim、nano、tmux、screen
- **系统监控** - htop、procps、net-tools
- **进程管理** - supervisor
- **完整编译环境** - gcc、g++、make、python3-dev

## 前置要求

- Docker (>= 20.10)
- Docker Compose (>= 1.29，可选）

## 快速开始

### 1. 配置环境变量

在项目根目录创建 `.env` 文件：

```bash
# API Keys
HEPAI_API_KEY=your_api_key_here

# Skills 目录（默认已设置在镜像中）
SYSTEM_SKILLS_DIR=/app/agent_skills/skills

# RAG Flow 配置
RAGFLOW_URL=your_ragflow_url
RAGFLOW_TOKEN=your_ragflow_token
MEMORY_DATASET_ID=your_dataset_id
```

### 2. 构建 Docker 镜像

```bash
# 构建镜像
docker build -t drsai:latest .

# 或使用自定义标签
docker build -t drsai:v1.0 .
```

### 3. 启动容器

#### 方式一：基础启动（仅服务）

```bash
docker run -d \
  --name drsai-assistant \
  -p 42818:42818 \
  -v $(pwd)/workspace:/app/workspace \
  --env-file .env \
  drsai:latest \
  python run_drsai_agent.py
```

#### 方式二：完整启动（包含SSH）

```bash
docker run -d \
  --name drsai-assistant \
  -p 42818:42818 \
  -p 2222:22 \
  -v $(pwd)/workspace:/app/workspace \
  -v $(pwd)/agent_skills:/app/agent_skills \
  --env-file .env \
  --privileged \
  drsai:latest \
  bash -c "service ssh start && python run_drsai_agent.py"
```

#### 方式三：交互式启动（开发调试）

```bash
docker run -it \
  --name drsai-dev \
  -p 42818:42818 \
  -p 2222:22 \
  -v $(pwd):/app \
  --env-file .env \
  drsai:latest \
  bash
```

### 4. 访问服务

#### HTTP API 访问
```bash
curl http://localhost:42818
```

#### SSH 访问容器（需要先设置密码）
```bash
# 进入容器
docker exec -it drsai-assistant bash

# 设置root密码
passwd root

# 从宿主机SSH登录
ssh -p 2222 root@localhost
```

### 5. 查看日志

```bash
# 查看容器日志
docker logs -f drsai-assistant

# 进入容器查看详细日志
docker exec -it drsai-assistant bash
tail -f /var/log/supervisor/*.log
```

### 6. 停止和删除

```bash
# 停止容器
docker stop drsai-assistant

# 删除容器
docker rm drsai-assistant

# 删除镜像
docker rmi drsai:latest
```

## 使用 Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  drsai-assistant:
    build: .
    image: drsai:latest
    container_name: drsai-assistant
    restart: unless-stopped
    ports:
      - "42818:42818"  # DrSAI API
      - "2222:22"      # SSH (可选)
    volumes:
      - ./workspace:/app/workspace
      - ./agent_skills:/app/agent_skills
    env_file:
      - .env
    environment:
      - SYSTEM_SKILLS_DIR=/app/agent_skills/skills
    command: bash -c "service ssh start && python run_drsai_agent.py"
    # 如果需要 Docker-in-Docker
    # privileged: true
    # volumes:
    #   - /var/run/docker.sock:/var/run/docker.sock
```

使用方式：

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down

# 重启
docker-compose restart
```

## 高级配置

### 1. 使用 Supervisor 管理多进程

在容器内创建 `/etc/supervisor/conf.d/drsai.conf`：

```ini
[program:drsai]
command=python /app/run_drsai_agent.py
directory=/app
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/drsai.err.log
stdout_logfile=/var/log/supervisor/drsai.out.log
```

启动命令改为：

```bash
docker run -d \
  --name drsai-assistant \
  -p 42818:42818 \
  drsai:latest \
  bash -c "supervisord -n"
```

### 2. 启用 Caddy（如果需要反向代理）

取消 Dockerfile 中 Caddy 安装部分的注释，然后创建 `Caddyfile`：

```
:80 {
    reverse_proxy localhost:42818
}
```

### 3. 数据持久化建议

```bash
# 推荐挂载的目录
-v $(pwd)/workspace:/app/workspace           # 工作空间
-v $(pwd)/agent_skills:/app/agent_skills     # 技能目录
-v $(pwd)/.env:/app/.env:ro                  # 环境配置（只读）
-v drsai-data:/app/data                      # 数据目录（使用命名卷）
```

### 4. 资源限制

```bash
docker run -d \
  --name drsai-assistant \
  --memory="2g" \
  --cpus="2.0" \
  -p 42818:42818 \
  drsai:latest
```

或在 `docker-compose.yml` 中：

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 2G
    reservations:
      cpus: '1.0'
      memory: 1G
```

### 5. Docker-in-Docker 配置

如果 DrSAI 需要执行 Docker 命令：

```bash
docker run -d \
  --name drsai-assistant \
  --privileged \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 42818:42818 \
  drsai:latest
```

⚠️ **安全警告**: `--privileged` 和挂载 Docker socket 会给容器完整的系统权限，生产环境请谨慎使用。

## 开发模式

### 挂载源代码实现热更新

```bash
docker run -it \
  --name drsai-dev \
  -p 42818:42818 \
  -v $(pwd)/python/packages/drsai:/app/python/packages/drsai \
  -v $(pwd)/python/packages/drsai_ui:/app/python/packages/drsai_ui \
  -v $(pwd)/python/packages/drsai_ext:/app/python/packages/drsai_ext \
  -v $(pwd)/workspace:/app/workspace \
  --env-file .env \
  drsai:latest \
  bash
```

容器内运行：
```bash
# 重新安装开发版本
cd /app/python/packages/drsai && pip install -e .

# 启动服务
python /app/run_drsai_agent.py
```

### 使用 tmux 后台运行

```bash
# 进入容器
docker exec -it drsai-assistant bash

# 启动 tmux 会话
tmux new -s drsai

# 运行服务
python run_drsai_agent.py

# 分离会话：Ctrl+B, 然后按 D
# 重新连接：tmux attach -t drsai
```

## 故障排查

### 1. 容器启动失败

```bash
# 查看详细日志
docker logs drsai-assistant

# 检查容器状态
docker ps -a | grep drsai

# 检查容器健康状态
docker inspect drsai-assistant | grep -A 10 "Health"
```

### 2. SSH 无法连接

```bash
# 确认SSH服务已启动
docker exec -it drsai-assistant service ssh status

# 手动启动SSH
docker exec -it drsai-assistant service ssh start

# 检查端口映射
docker port drsai-assistant
```

### 3. 依赖安装失败

```bash
# 重新构建镜像（不使用缓存）
docker build --no-cache -t drsai:latest .

# 查看构建日志
docker build -t drsai:latest . 2>&1 | tee build.log
```

### 4. 权限问题

```bash
# 修改工作空间权限
chmod -R 755 workspace/

# 或在容器内运行
docker exec -it drsai-assistant chown -R root:root /app/workspace
```

### 5. 端口冲突

```bash
# 检查端口占用
lsof -i :42818
netstat -tuln | grep 42818

# 使用不同端口
docker run -p 8080:42818 ... drsai:latest
```

## 生产部署建议

### 1. 安全加固

```bash
# 使用非root用户（修改Dockerfile）
RUN useradd -m -s /bin/bash drsai
USER drsai

# 禁用SSH密码认证，仅使用密钥
# 在Dockerfile中：
RUN sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
```

### 2. 日志管理

```yaml
# docker-compose.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### 3. 健康检查

```yaml
# docker-compose.yml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:42818/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### 4. 使用反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name drsai.yourdomain.com;

    location / {
        proxy_pass http://localhost:42818;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 5. 自动重启策略

```yaml
restart: unless-stopped  # 推荐
# 或
restart: always
# 或
restart: on-failure:5
```

### 6. 备份和恢复

```bash
# 备份工作空间
docker run --rm -v $(pwd)/workspace:/source -v $(pwd)/backup:/backup \
  alpine tar czf /backup/workspace-$(date +%Y%m%d).tar.gz /source

# 恢复工作空间
tar xzf backup/workspace-20260410.tar.gz -C workspace/
```

## 镜像管理

### 导出和导入镜像

```bash
# 导出镜像
docker save drsai:latest | gzip > drsai-latest.tar.gz

# 导入镜像
gunzip -c drsai-latest.tar.gz | docker load
```

### 推送到镜像仓库

```bash
# 登录镜像仓库
docker login registry.yourdomain.com

# 打标签
docker tag drsai:latest registry.yourdomain.com/drsai:latest

# 推送
docker push registry.yourdomain.com/drsai:latest
```

### 清理资源

```bash
# 清理未使用的镜像
docker image prune -a

# 清理所有未使用的资源
docker system prune -a --volumes

# 查看磁盘使用情况
docker system df
```

## 性能优化

### 1. 多阶段构建（可选）

如果需要减小镜像体积，可以使用多阶段构建。

### 2. 使用 .dockerignore

创建 `.dockerignore` 文件：

```
**/__pycache__
**/*.pyc
**/*.pyo
**/*.pyd
.git
.gitignore
.vscode
.idea
*.md
tests/
docs/
.env
workspace/
```

### 3. 缓存优化

```bash
# 使用 BuildKit
DOCKER_BUILDKIT=1 docker build -t drsai:latest .
```

## 常见使用场景

### 场景1：纯服务模式
```bash
docker run -d --name drsai -p 42818:42818 drsai:latest python run_drsai_agent.py
```

### 场景2：开发调试模式
```bash
docker run -it --rm -v $(pwd):/app drsai:latest bash
```

### 场景3：生产部署模式
```bash
docker-compose up -d  # 使用完整的docker-compose.yml
```

## 参考资料

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Python Docker 最佳实践](https://docs.docker.com/language/python/)
- [DrSAI 项目文档](https://github.com/hepaihub/drsai)

## 支持

如有问题，请提交 Issue 或联系维护团队。
