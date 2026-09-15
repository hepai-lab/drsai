# OpenDrSai WebUI 前端

基于 Gatsby 的 Web 前端。克隆仓库后如何同时跑前后端，见仓库文档：

**[docs/webui/local-dev.md](../../../docs/webui/local-dev.md)**

## 本地开发

```bash
cp .env.example .env.development   # 不要设置 GATSBY_API_URL
yarn install --legacy-peer-deps
yarn dev                           # http://localhost:8000
```

开发模式下浏览器请求同源 `/api`，由 `gatsby-node.ts` 代理到 `127.0.0.1:${GATSBY_DEV_API_PORT:-8086}`。后端请用：

```bash
drsai-ui ui --host 0.0.0.0 --port 8086 --reload
```

## 环境变量

- 开发：`.env.development`（从 `.env.example` 复制）
- 生产构建：`.env.production`

模板里把 `GATSBY_API_URL` 注释掉。写死远程地址会让本地登录打到错误环境。

## 打包

```bash
yarn build        # 生产静态资源，同步到 ../backend/.../web/ui/
yarn build:dev    # 开发模式构建（不压缩）
```
