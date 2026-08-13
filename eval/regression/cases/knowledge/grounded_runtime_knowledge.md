# 案例 5：根据固定知识库回答

## 身份与目的

- Case ID：`knowledge.grounded`
- Revision：2
- 目的：验证 OpenDrSai 实际检索指定知识库，忠实回答，并通过 OAEP 提供可交互的内部资料引用；不能依赖模型记忆或网络搜索。

## 为什么使用固定资料

真实产品文档持续变化，会让代码回归与资料变更混在一起。本案例使用专用 Fixture `opendrsai_runtime_overview_v1.md`，并固定知识库 ID、revision 和 SHA-256。Fixture 只服务测试，不替代正式产品文档。

## 输入与基准事实

用户询问 Session、Run、一对多关系和 Replay 是否能覆盖原始 Run。答案必须表达五项事实：Session 是持续用户会话；Run 是一次具体执行；一个 Session 可含多个 Run；Replay/实验创建新 Run；原始 Run 不可覆盖。

允许自然语言、条目和表格等表达变体，不要求逐字匹配。不得声称 Session 只能含一个 Run，或 Replay 会修改、覆盖原始 Run。

## 环境与过程

- 新建空白 Session，禁用网络；
- 只挂载 `regression.opendrsai-runtime@1`；
- 该 Fixture 显式声明 `corpus_complete: true`，表示列出的固定文档就是本案例知识库的完整语料；
- 文档正文不能直接拼入系统提示，Agent 必须调用知识检索；
- 知识查询 1–3 次；
- 不得进行网络搜索、无关 Tool/Skill、审批或外部写操作；
- Manifest 必须记录知识库 ID、revision 和文档摘要。

## 引用交互

建议使用两个引用：一个支持 Session/Run 定义，一个支持 Replay 不覆盖原始 Run；不强制每句话独立引用。

引用必须成为 OAEP `citation`，正文标记与 Citation Part 关联。点击正文标记应定位引用卡片；卡片显示文档名、知识库版本和支持结论的原文片段；可打开 OpenDrSai 内部资料预览，并能返回正文位置。纯文本文件名或不可交互路径不算通过。

## 自动断言与验收

确定性检查 Run 状态、知识查询、命中文档及摘要、禁止能力、Manifest 和引用关系；语义 Evaluator 检查五项事实与三项禁止结论。两类断言必须全部通过。知识库未挂载、证据缺失或引用不可交互时 fail closed，不能用模型答案看似正确代替检索证据。

## 资产变更规则

修改 Fixture 内容时必须同时更新文件 SHA-256、Case revision、基准事实和相关测试。禁止只替换文件而保留原 revision。
