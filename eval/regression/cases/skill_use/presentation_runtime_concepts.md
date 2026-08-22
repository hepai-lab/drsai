# 案例 7：创建演示文稿

## 身份与目的

- Case ID：`skill.presentation`
- Revision：4
- 目的：验证能力选择、Presentation Skill 流程、可编辑 PPTX、结构与视觉质量、Artifact 交付和 Run 可追溯性。

## 固定内容与范围

用户提供四页完整中文提纲，不需要检索事实。禁用网络、知识库、图片搜索和图片生成，不使用外部图片，以免外部内容和版权干扰 P1 对演示文稿核心能力的判断。允许原生文本、形状和简单关系表达。

## Codex 基准

基准文件为 `opendrsai-runtime-core-concepts.pptx`，SHA-256 为 `936939c311ff5a18730734a0bc3955d03db7b44acde547ef17eab1cc8389200a`。它是 16:9、四页、蓝色科技风格、全页页码、可编辑文本的已接受参考，并已逐页渲染检查和通过溢出检测。

基准用于定义最低结构、信息层级、可读性和视觉完成度，不要求候选文件像素一致，也不要求复刻其坐标、形状或配色数值。候选 PPTX 自身摘要不应与基准相同作为通过条件。

## 预期工作流

Agent 必须激活仓库实际内置的 `pptx` Skill（用户界面可称 Presentation Skill），完整读取说明，创建 PPTX，渲染全部页面，逐页检查并在必要时修正，最后注册 Artifact。只在最终回答中声称“已使用 Skill”不构成证据；Runtime/Skill 事件必须记录说明已加载、已创建、已渲染、已视觉检查和已注册产物。

回归控制只允许执行三个产品 Skill 脚本。Host 同时校验 Python 入口、Skill ID、脚本相对路径、脚本 SHA-256、参数数量及所有输入输出的隔离 Workspace 解析路径，并拒绝换行、管道、重定向和 Shell 控制符。不得要求用户开启 `/dangerous on`，也不得放开任意脚本执行。

## 文件与结构验收

最终文件固定为隔离 Workspace 下 `artifacts/opendrsai-runtime-core-concepts.pptx`。必须是合法 Office Open XML、16:9、恰好四页，包含 YAML 声明的全部文本和每页页码。关键文字必须作为可编辑文本存在，不能以四张扁平图片冒充可编辑演示文稿。允许合理换行和中英文标点变体。

## 视觉验收

必须渲染全部四页。机器检查文字溢出、元素越界、明显非预期重叠、裁切、空白页和页码；视觉 Evaluator 检查风格一致、蓝色科技感、标题正文层级、可读性和页面密度。视觉比较采用质量阈值和结构特征，不做像素 diff。

## Artifact 交互

最终回答显示可交互 Artifact。点击可预览或打开文件，文件路径、MIME、大小和 SHA-256 与 Run Inspector 的 Artifact Item 一致，并可追溯到本次 Run。纯文本路径、损坏文件、PDF、大纲或不存在的链接均失败。

## 写入与清理

仅允许写入 `artifacts/` 和 `tmp/presentation-render/`。渲染中间文件可在临时目录存在但必须清理；最终只交付一个 PPTX Artifact。越界写入、网络调用、知识检索或图片生成均失败。

## 通过标准

Skill 与流程、PPTX 结构、逐页视觉检查和 Artifact 交互四层必须同时通过。Skill 不可用属于 `environment_failed`；文件或行为不符合要求属于 `assertion_failed`；缺少 Run/Artifact/渲染证据属于 `incomplete_evidence`。
