---
tags: OpenDrSai, 智能体文档, nvm
---

# OpenDrSai-前端配置与打包

我们在启动drsai ui时的默认前端是本地认证的开发模式，如果需要启动don统一认证，请使用以下的教程进行打包。

## 1.Frontend环境变量配置

在开发阶段，Gatsby 会从名为 `.env.development` 的文件加载环境变量。对于构建过程，它会从 `.env.production` 文件加载环境变量。[gatsby](https://www.gatsbyjs.com/docs/how-to/local-development/environment-variables/)

### 1.1.本地认证drsai/frontend配置参数

``` bash
# .env.development

当前模式
GATSBY_SERVICE_MODE="DEV"

连接后端api
GATSBY_API_URL=http://127.0.0.1:8004/api  

连接VNC
GATSBY_VNC_SERVICE_URL="http://127.0.0.1:8004/api/vncapi"
```

### 1.2.高能所统一认证drsai/frontend配置参数

```bash
# .env.production

GATSBY_API_URL=''  # 置空 自动读取服务器的启动地址
GATSBY_VNC_SERVICE_URL="" # 同上
GATSBY_SERVICE_MODE="PROD" 

跳转SSO的默认配置
统一身份认证配置，从login.ihep.ac.cn获取
IHEP_SSO_APP_KEY="***"
IHEP_SSO_APP_SECRET="***"
IHEP_SSO_REDIRECT_URI="http://****.ihep.ac.cn/umt/callback"

HepAI子应用配置，从hepai@ihep.ac.cn获取
HEPAI_APP_ADMIN_API_KEY="******"
```

## 2.如何打包两个不同的环境作为drsai ui的静态前端？

设置对应的环境变量文件，在 drsai/frontend 目录下 
打包development环境,执行 `npm run build:dev`
打包production环境,执行 `npm run build`


## 3.如何查看是否打包好对应的内容？

运行 `npm run serve `

dev->登录框 √
prod->统一认证 √

