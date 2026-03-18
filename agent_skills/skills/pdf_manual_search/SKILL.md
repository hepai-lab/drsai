---
name: pdf_manual_search
description: 基于pdf_manual_search工具的手册检索教程，可以查询《spec - X-Ray Diffraction Software》，OpenDrSai智能体开发等手册内容。
---

# Guide

## 用途

在用户需要检索《spec - X-Ray Diffraction Software》，OpenDrSai智能体开发等PDF手册，帮助准确地找到需要的内容。

## 步骤

1. 调用`pdf_manual_search`工具，传入用户输入的查询内容。
2. 根据工具返回与用户查询内容的相关条目，使用`run_read`依次读取相关条目中包括的源Markdown files文件，找到相关的内容后根据用户的问题进行总结，并说明引用的层级路径。

**注意**：

- 你不需要将对应条目所有的内容都使用`run_read`读取，在读取到相关的内容后就可以停止读取，然后参考内容做出回复。
- 你读取的Markdown files文件必须是`pdf_manual_search`工具中检索返回的文件地址，不要捏造！

## 示例

如果用户想问spec中scan和dscan命令的区别是什么？

## 限制

暂无