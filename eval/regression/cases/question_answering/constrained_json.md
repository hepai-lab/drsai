# 案例 2：严格按照 Schema 输出 JSON

## 身份与目的

- Case ID：`qa.constraints.json`
- Revision：1
- 目的：验证普通用户指令下的严格结构化输出，而非 Provider 专有 Structured Output API。

## 输入与唯一数据语义

将张三、28 岁、技能 Python 和 TypeScript 整理为指定 JSON。字段顺序和空白不作要求，但值、类型和集合必须一致。

## 严格格式

整个响应从首字符到末字符必须是一个可解析 JSON 对象。禁止 Markdown 围栏、前后说明、JavaScript 对象语法、额外字段和字符串形式的年龄。评测框架不能暗中抽取或修复 JSON。

## 过程与验收

网络禁用，Tool、Skill、知识库、审批和 Artifact 均为零。输出必须通过 Case 中的 JSON Schema，包括 `additionalProperties: false`。该案例只使用确定性断言，不需要 LLM Judge。
