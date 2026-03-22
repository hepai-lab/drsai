---
name: download_skills
description: 从clawhub.ai中的下载链接下载到指定的skill文件夹，并安装到用户的skills目录中。
---

# Guide

## 1.检索skill，获取链接

**步骤1：** 从`https://clawhub.ai/skills?sort=downloads`中检索相应的skill，如下图所示：

![](https://jupyter.ihep.ac.cn/uploads/47392a66-b224-4592-b41b-84cd08090fb1.png)

**步骤2：** 选择合适的skill，点击进入，找到`Download.zip`按钮，右键点击，复制链接，将链接给AI助手进行下载，示意图如下：

![](https://jupyter.ihep.ac.cn/uploads/3056a426-3e1f-47c4-b22e-bce378c9cbd7.png)

链接的格式如：`https://wry-manatee-359.convex.site/api/v1/download?slug=baidu-scholar-search-skill`

## 2.wget下载，将skill加载到用户的目录中

这里以下载`baidu-scholar-search-skill`为例。

**步骤 1：** 进入用户的Download Directory目录中，通过用户提供的链接下载，使用wget下载对应的zip文件：

```bash
cd /user/work_dir/downloads && wget https://wry-manatee-359.convex.site/api/v1/download?slug=baidu-baike-data -O baidu-baike-data.zip
```

**步骤 2：** 进入用户的Download Directory目录中，创建对应名称的文件夹，将下载的zip文件解压到对应的文件夹：

```bash
mkdir /user/work_dir/downloads/baidu-baike-data && unzip baidu-baike-data.zip -d /user/work_dir/downloads/baidu-baike-data.zip -d /user/work_dir/downloads/baidu-baike-data
```

**步骤 3：** 将解压后的skill文件夹复制到用户的skills文件夹中：

```bash
cp -r /user/work_dir/downloads/baidu-baike-data /user/work_dir/configs/skills/.
```

**注意**：

命令行依次执行，不要一次执行多条命令，每次执行后查看结果是否正常，没有问题继续下一条命令。有问题则进行修改，3次尝试无法成功则直接告诉用户具体问题是什么。