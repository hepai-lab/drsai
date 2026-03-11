---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-安装OpenDrSai

Dr.Sai UI见：https://drsaiv2.ihep.ac.cn/
稳定版本的最新源码地址见：https://github.com/hepai-lab/drsai
最新版本的源码地址见：https://code.ihep.ac.cn/hepai/drsai

## 1.pip 安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
pip install drsai -U # 智能体、多智能体系统后端开发框架（与autogen 0.5.7兼容）
pip install drsai_ui -U # 与智能体、多智能体系统后端进行人机交互的UI后端和静态前端
pip install drsai_ext -U # 扩展功能, 可选安装
```

## 2.源码安装

```shell
conda create -n drsai python=>3.11
conda activate drsai
git clone https://github.com/hepai-lab/drsai.git drsai # Github 或
git clone https://code.ihep.ac.cn/hepai/drsai drsai # Gitlab

cd drsai

cd python/packages/drsai && pip install -e . # for OpenDrSai backend and agent components
cd python/packages/drsai_ui && pip install -e . # for DrSai-UI  human-computer interaction frontend
cd python/packages/drsai_ext && pip install -e . # for extend functions
```

## 3.配置HepAI平台的API访问密钥

配置高能AI平台[HepAI](https://ai.ihep.ac.cn)的API访问密钥等环境变量(Based on bash)：

如图：登录后，右上角`个人中心`-`API秘钥`-`创建新秘钥`-`复制`
![](https://note.ihep.ac.cn/uploads/abd23486-e817-4390-a3e7-dee76b1e879b.png)


linux/mac平台:

```shell
vi ~/.bashrc
export HEPAI_API_KEY=your_api_key
source ~/.bashrc
```

windows平台：

```shell
setx "HEPAI_API_KEY" "your_api_key"
# 注意 windows环境变量需要重启电脑才会生效
```

**NOTE:**
- 所有OpenAI格式的模型都可以使用以上方式接入，具体接入见：[tutorials/components/ModelClient01.md](https://github.com/hepai-lab/drsai/blob/main/tutorials/components/ModelClient01.md)
- DrSai-UI 中的 DrSai-General 功能需要编译python执行沙盒和浏览器VNC的Docker镜像，请确保安装了docker环境。具体docker镜像及安装配置见[docker](https://github.com/hepai-lab/drsai/blob/main/docker/README.md)


## 4.人机交互前后端

人机交互前后端需要安装`drsai`和`drsai_ui`两个后端python包。

### 4.1.命令行启动OpenDrSai人机交互后端服务

```shell
# pip install drsai_ui -U # 确保安装了drsai_ui

cp .env.example .env # 复制.env.example文件为.env, 可用于高能所部署统一认证

drsai ui # 启动Dr.Sai-UI人机交互后端和静态前端
```

后端和静态前端默认启动在8081端口，```drsai --help```获取更多的启动参数，`.env.example`的示例参数如下：

```env
# ------------#
# 运行通用配置 #
# ------------#

# VNC服务配置，需要地址和端口开放
VNC_SERVICE_URL="http://**/api/vncapi"
MIN_PORT="40000"
MAX_PORT="65000"
# 是否将前端上传的文件上传到文件系统
USE_HEPAI_FILE=true
# 前端默认展示的智能体
DEFAULT_REMOTE_AGENTS="<enter your path of remote_agents_example.json here>"

# ------------#
# 开发环境配置 #
# ------------#

SERVICE_MODE="DEV"
# 访问LLM和文件系统的API-KEY,通过ai.ihep.ac.cn获取
HEPAI_API_KEY="<enter your key here>"

# ---------------------------------------------
# 生产环境配置（不需要统一认证时可不设置），使用生产环境时将SERVICE MODE改为PROD
# ---------------------------------------------

# # SERVICE_MODE="PROD"
# # 统一身份认证配置，从login.ihep.ac.cn获取
# IHEP_SSO_APP_KEY="**"
# IHEP_SSO_APP_SECRET="**"
# IHEP_SSO_REDIRECT_URI="**"
# # HepAI子应用配置，从hepai@ihep.ac.cn获取
# HEPAI_APP_ADMIN_API_KEY="**"
```

remote_agents_example.json文件的示例如下，可包含多个智能体：

```json
[
    {
        "mode": "remote",
        "name": "your_Agent",
        "url": "http://*********/apiv2",
        "apiKey": "sk-****",
        "description": "******.",
        "version": "0.1.0",
        "author": "***6@ihep.ac.cn",
        "logo": "https://aiapi.ihep.ac.cn/apiv2/files/file-61518e9f7e8f45049739d7ae58abe35a/preview",
        "owner": "***6@ihep.ac.cn",
        "id": "1hxiubhysdijih23456",
        "examples": ["Search arXiv for the latest papers on computer use agents","检索arXiv上关于高能物理人工智能智能体的最新进展"]
    }
]
```
- mode：默认为remote
- name：智能体名称
- url：访问智能体的url
- apiKey：访问智能体的apikey
- description：智能体的描述
- version：智能体的版本号
- author：你的名字
- logo：你智能体logo的url
- owner：你的邮箱或者其它联系方式
- id：智能体的UUID，请自己生成，确保独一无二
- examples：前端展示的智能体访问示例

### 4.2.人机交互前端

#### 配置npm环境

安装node

```shell
# install nvm to install node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install node # recommended node version ~ 22
```

安装前端依赖并启动前端

```shell
cd your/path/to/drsai/frontend
npm install -g gatsby-cli
npm install --global yarn
yarn install

# *********NOTE：*********
# cp .env.default .env.development or .env.production # 复制.env.default文件为.env.development或.env.production
# 开发环境变量为frontend/.env.development
# 生产环境变量为frontend/.env.production
# ************************

# yarn build # 打包前端静态资源
yarn run dev # 启动前端开发环境
```

`.env.default`的内容：

```env
# ------------#
# 运行通用配置 #
# ------------#

# 后端API的地址
GATSBY_API_URL=http://127.0.0.1:8081/api 

# ------------#
# 开发环境配置 #
# ------------#

GATSBY_SERVICE_MODE="DEV"
# 后端浏览器VNC地址
GATSBY_VNC_SERVICE_URL="http://127.0.0.1:8081/api/vncapi"
# 是否开启统一认证
GATSBY_SSO=false

# ---------------------------------------------
# 生产环境配置（不需要统一认证和多用户时可不设置），使用生产环境时将SERVICE MODE改为PROD
# ---------------------------------------------
# GATSBY_SERVICE_MODE="PROD"
# GATSBY_VNC_SERVICE_URL="http://aitest.ihep.ac.cn/api/vncapi"
# GATSBY_SSO=true
```
