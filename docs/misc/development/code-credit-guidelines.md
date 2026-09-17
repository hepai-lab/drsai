# 代码归属与模块说明规范

## 目的

本规范用于说明 OpenDrSai 自有代码中模块的职责、维护责任与主要贡献归属。它不替代 Git 提交历史：Git 历史仍是完整作者与逐次修改归属的权威记录。

## 适用范围

新建或重构的核心模块应遵循本规范，优先覆盖协议、运行时、后端服务和跨端桥接层。既有文件在被实质性修改时逐步补齐，无需为全仓库进行一次性机械添加。

## Python 模块头

自有核心 Python 模块在文件开头使用模块文档字符串，依次说明功能、维护方和主要贡献者：

```python
"""
Remote workspace relay client.

Purpose:
    Provides authenticated Relay access, event streaming, and retry handling
    for the OpenDrSai remote-workspace runtime.

Maintainer:
    HepAI Team, Computing Center, IHEP, CAS

Primary contributor:
    Zhengde Zhang
"""
```

约定如下：

- `Purpose` 使用简洁、可验证的职责描述；必要时说明关键协议或边界。
- `Maintainer` 统一写为 `HepAI Team, Computing Center, IHEP, CAS`，除非模块已明确移交给其他维护方。
- 单位主要贡献者使用 `Primary contributor`；多位时使用 `Primary contributors`，每行一位。
- 不记录“最后修改人”或“最后修改日期”；这类信息由 Git 历史维护。
- 对测试文件可使用精简说明，仅描述被验证的行为及其对应模块。

## 自动生成与第三方代码

- 自动生成文件不得手工追加贡献者信息；保留或添加 `Generated file — do not edit manually`，并指向生成脚本或源协议。
- 第三方代码必须完整保留原许可证、版权和作者声明；不得用本项目的 credit 替换原始声明。

## 完整贡献记录

跨模块、跨阶段的完整贡献记录应通过 Git 历史、合并请求和发布说明维护。需要集中展示时，应更新项目级贡献者文档，而非在每次修改时重复编辑每个文件头。
