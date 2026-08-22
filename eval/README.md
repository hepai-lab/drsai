# Eval - 智能体性能评测调研

本文件夹包含智能体性能评测的调研资料。

## 文件列表

| 文件 | 说明 |
|------|------|
| `智能体性能评测调研报告.md` | 综合调研报告，涵盖代码能力、深度检索、文档/电脑操作、工具使用等维度的评测方案与 Benchmark |
| `gaia/` | GAIA benchmark 评测框架 — 对 DrSaiAssistant 进行实际测试 |
| `regression/` | OpenDrSai 产品智能体回归测试：12 个代表任务、正式 Runtime 执行、证据断言与发布门禁 |
| `data/gaia/` | GAIA 数据集存放目录（需手动下载） |
| `results/gaia/` | GAIA 评测结果输出目录 |

未来需要补充、但尚未纳入上述 12 项回归测试的用户需求，统一记录在 [`docs/product/opendrsai-user-requirements-backlog.md`](../docs/product/opendrsai-user-requirements-backlog.md)。

## 报告涵盖的评测维度

### 1. 代码能力
- SWE-bench / SWE-bench Verified (500题, 真实GitHub Issue)
- SWE-bench Multimodal
- LiveCodeBench (contamination-free)
- HumanEval / MBPP
- BigCodeBench

### 2. 深度检索与资料整合
- GAIA (466题, 通用智能体黄金标准)
- BrowseComp (1266题, 深度网页搜索)
- SimpleQA (4326题, 事实准确性)
- FanOutQA (多跳多文档问答)
- HLE (Humanity's Last Exam)
- Mind2Web 2 (智能体搜索)

### 3. 文档/电脑操作
- OSWorld (369题, 真实OS环境)
- WindowsAgentArena (154题, Windows)
- WebArena (812题, 网页环境)
- VisualWebArena (多模态网页)
- Mind2Web (2350题, 177个网站)
- AndroidWorld (移动设备)
- OmniACT (桌面自动化)
- Office-Bench (办公软件)

### 4. 工具使用
- τ-bench (pass^k可靠性指标)
- ToolBench / ToolLLM (16000+ API)
- API-Bank (314题, 53个API)
- BFCL (Berkeley函数调用排行榜)
- MINT-Bench (多轮工具交互)
- AgentBench (8个环境综合评测)
- AgentBoard (过程分析)
- MLAgentBench (ML实验)

### 5. 综合/通用评测
- Agent-as-a-Judge / DevAI
- Chatbot Arena / AgentArena (LMSYS)
- CORE-Bench (科研复现)

## 先进智能体评测实践

报告中还包含以下先进智能体的评测方法分析：
- Claude Code (Anthropic) — SWE-bench Verified SOTA 76.80%
- Hermes (Nous Research) — 函数调用评测
- OpenAI Operator / Deep Research — OSWorld/WebArena/GAIA
- Devin (Cognition) — SWE-bench
- Manus — GAIA L1 ~86.5%
- Magentic-One (Microsoft) — GAIA/WebArena
