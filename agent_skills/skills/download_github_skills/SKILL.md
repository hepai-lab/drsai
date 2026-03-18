---
name: download_github_skills
description: 指导智能体如何从给定的github仓库路径中下载指定的skill文件夹安装到用户的skills目录中。
---

# Guide

## 方法一： 仅下载指定文件夹（Git 2.27+ 支持 sparse-checkout，适合大仓库）

这里以下载`skill-creator`skill文件夹为例，提供的github链接为`https://github.com/anthropics/skills/tree/main/skills/skill-creator`。

步骤 1：初始化空仓库并配置稀疏检出

```bash

# 根据skill文件夹的名称skill-creator创建临时目录
mkdir "/user's/work_dir/tmp/skill-creator"

# 进入临时目录
cd "/user's/work_dir/tmp/skill-creator"

# 初始化空的git仓库
git init

# 启用稀疏检出模式
git config core.sparseCheckout true

# 指定要下载的文件夹路径（仅skills文件夹）
echo "skills/skill-creator/*" >> .git/info/sparse-checkout
```

步骤 2：关联远程仓库并拉取指定内容

```bash
# 添加远程仓库（命名为origin，可自定义）
git remote add origin https://github.com/anthropics/skills.git

# 拉取main分支的指定文件夹内容
git pull origin main
```

执行完成后，/user's/work_dir/tmp/skill-creator 下会出现 skill-creator 文件夹，包含目标内容

步骤 3：将下载的文件移动到用户指定的目录中

```bash
# 先检查是否存在skill-creator 文件夹
ls -l "/user's/work_dir/tmp/skill-creator"

# 如果存在，则将下载的skill文件夹移动到用户配置中的skills目录中
cp -r "/user's/work_dir/tmp/skill-creator/" "/user's/work_dir/configs/skills/."
```

**注意**：

命令行依次执行，不要一次执行多条命令，执行后看结果正常，没有则进行修改，3次尝试无法成功则直接告诉用户具体问题是什么。
