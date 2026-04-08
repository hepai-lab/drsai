# DrSai Assistant Docker 部署指南

本指南介绍如何使用 Docker 部署 DrSai Assistant。

## 前置要求

- Docker (>= 20.10)
- Docker Compose (>= 1.29)

## 快速开始

### 1. 配置环境变量

在项目根目录创建 `.env` 文件，添加必要的环境变量:

```bash
# API Keys
HEPAI_API_KEY=your_api_key_here

# Skills 目录（可选）
SYSTEM_SKILLS_DIR=/path/to/skills

# RAG Flow 配置（可选）
RAGFLOW_URL=your_ragflow_url
RAGFLOW_TOKEN=your_ragflow_token
MEMORY_DATASET_ID=your_dataset_id
```

### 2. 构建 Docker 镜像

```bash
# 构建镜像
docker-compose build

# 或者使用 docker 直接构建
docker build -t drsai-assistant .
```

### 3. 启动服务

```bash
# 使用 docker-compose 启动（推荐）
docker-compose up -d

# 或者使用 docker 直接运行
docker run -d \
  --name drsai-assistant \
  -p 42818:42818 \
  -v $(pwd)/examples/agent_groupchat/assistant_skill/drsai_assistant/workspace:/app/examples/agent_groupchat/assistant_skill/drsai_assistant/workspace \
  -v $(pwd)/.env:/app/examples/agent_groupchat/assistant_skill/drsai_assistant/.env:ro \
  --env-file .env \
  drsai-assistant
```

### 4. 查看日志

```bash
# 查看服务日志
docker-compose logs -f drsai-assistant

# 或使用 docker
docker logs -f drsai-assistant
```

### 5. 停止服务

```bash
# 停止服务
docker-compose down

# 或使用 docker
docker stop drsai-assistant
docker rm drsai-assistant
```

## 访问服务

服务启动后，可以通过以下地址访问:

- HTTP API: `http://localhost:42818`

## 高级配置

### 使用 Docker-in-Docker

如果你的 Agent 需要使用 `DockerCommandLineCodeExecutor`，需要挂载 Docker socket:

```yaml
# 在 docker-compose.yml 中取消注释以下行:
privileged: true
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

⚠️ **注意**: 这会给容器额外的权限，请谨慎使用。

### 数据持久化

工作空间数据会自动挂载到宿主机，路径为:
```
./examples/agent_groupchat/assistant_skill/drsai_assistant/workspace
```

这样即使容器重启，数据也不会丢失。

### 自定义端口

如果端口 42818 被占用，可以修改 `docker-compose.yml` 中的端口映射:

```yaml
ports:
  - "8080:42818"  # 宿主机端口:容器端口
```

## 开发模式

在开发时，可以挂载本地代码到容器中实现热更新:

```yaml
volumes:
  - ./python/packages:/app/python/packages
  - ./examples:/app/examples
```

然后重启容器:
```bash
docker-compose restart
```

## 故障排查

### 1. 容器无法启动

检查日志:
```bash
docker-compose logs drsai-assistant
```

### 2. API Key 错误

确保 `.env` 文件中设置了正确的 `HEPAI_API_KEY`。

### 3. 端口冲突

修改 `docker-compose.yml` 中的端口映射，或停止占用该端口的其他服务。

### 4. 权限问题

如果遇到文件权限问题，可能需要调整挂载目录的权限:
```bash
chmod -R 755 examples/agent_groupchat/assistant_skill/drsai_assistant/workspace
```

## 镜像管理

### 清理未使用的镜像

```bash
docker system prune -a
```

### 导出镜像（用于迁移）

```bash
# 导出镜像
docker save drsai-assistant > drsai-assistant.tar

# 在另一台机器上导入
docker load < drsai-assistant.tar
```

## 生产部署建议

1. **使用环境变量管理敏感信息**: 不要将 API Key 等敏感信息硬编码在代码或配置文件中
2. **配置日志轮转**: 防止日志文件占用过多磁盘空间
3. **设置资源限制**: 在 `docker-compose.yml` 中添加 CPU 和内存限制
4. **使用反向代理**: 通过 Nginx 等反向代理来处理 HTTPS 和负载均衡
5. **定期备份**: 定期备份 workspace 目录
6. **监控和告警**: 配置容器监控和告警机制

## 参考资料

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [DrSai 项目文档](https://github.com/hepaihub/drsai)
