配置Hepai Claude Code (Based on Linux)
===

- 1. 安装claude-code

```shell
npm install -g @anthropic-ai/claude-code
```

- 2. 配置hepai DDF 信息

apikey见：https://aiapi.ihep.ac.cn/

在~/.bashrc or ~/.zshrc

```shell
export ANTHROPIC_BASE_URL="https://aiapi.ihep.ac.cn/apiv2/anthropic"
export ANTHROPIC_API_KEY="sk-**"  # HepAI的 apikey， 见：https://aiapi.ihep.ac.cn/
```
然后
```shell
source ~/.bashrc # or source ~/.zshrc
```

- 3. 使用kimi跳转

运行以下命令：

```shell
bash -c "$(curl -fsSL https://raw.githubusercontent.com/LLM-Red-Team/kimi-cc/refs/heads/main/install.sh)"
```

按照要求再次粘贴：HepAI的 apikey。具体如下：

![](https://note.ihep.ac.cn/uploads/b4574e86-086a-49a3-a5e0-a7c4c422aa0d.png)


- 4. 使用启动claude-code

![](https://note.ihep.ac.cn/uploads/9221706d-7f6f-4da1-a738-0bd1ccc36e12.png)



- 5.具体教程：https://blog.axiaoxin.com/post/claude-code-full-guide/

