# GAIA 评测测试框架

基于 GAIA benchmark 对 DrSaiAssistant 进行性能评测的测试框架。

---

## 📥 数据集下载地址

**https://huggingface.co/datasets/gaia-benchmark/GAIA**

下载方式（二选一）：

```bash
# 方式一：huggingface-cli（推荐）
huggingface-cli download gaia-benchmark/GAIA \
    --repo-type dataset \
    --local-dir ./eval/data/gaia \
    --include "validation/*"
```

或网页下载后放到 `eval/data/gaia/validation/` 目录。

> ⚠️ 需要先在 HuggingFace 网站上登录并接受 GAIA 数据集的许可协议。

### 数据集结构

下载后的目录结构应如下：

```
eval/data/gaia/
└── validation/
    ├── metadata.parquet       # 任务元数据（466 题）
    ├── file_name_column/       # 附件文件目录
    │   ├── xxx.pdf
    │   ├── xxx.xlsx
    │   ├── xxx.png
    │   └── ...
    └── ...
```

### 数据集字段说明

| 字段 | 说明 |
|------|------|
| `task_id` | 任务唯一标识 |
| `Question` | 问题文本 |
| `Level` | 难度等级（1=简单, 2=中等, 3=困难） |
| `Final answer` | 标准答案 |
| `file_name` | 附件文件名（如有） |
| `file_path` | 附件文件路径 |
| `Annotator` | 标注者信息 |

---

## 📁 框架文件结构

```
eval/gaia/
├── __init__.py           # 包入口
├── gaia_config.py        # 配置（数据集路径、模型、并发数、超时等）
├── gaia_dataset.py       # 数据集加载器（支持 parquet/json）
├── gaia_evaluator.py     # 答案提取 + 归一化精确匹配评分
├── gaia_prompts.py       # GAIA 专用系统提示词
├── gaia_runner.py        # 主运行器（并发执行、断点续跑、结果收集）
├── run_gaia.py           # CLI 命令行入口
├── utils.py              # 工具函数（历史结果比较）
└── README.md             # 本文件
```

---

## 🚀 使用方式

### 基本用法

```bash
# 在项目根目录运行

# 1. 下载数据集后，先列出任务确认数据加载正常
python -m eval.gaia.run_gaia --list-tasks

# 2. 先用 Level 1（53题最简单的）调试
python -m eval.gaia.run_gaia --levels 1 --concurrency 1

# 3. 正式运行 Level 1
python -m eval.gaia.run_gaia --levels 1 --concurrency 3

# 4. 换模型测试
python -m eval.gaia.run_gaia --levels 1 --model hepai/minimax-m2.7-highspeed

# 5. 查看结果
python -m eval.gaia.run_gaia --show-latest    # 最近一次
python -m eval.gaia.run_gaia --compare        # 所有历史对比
```

### 调试模式

```bash
# 只运行特定任务（用 --list-tasks 查看 task_id）
python -m eval.gaia.run_gaia --task-ids <task_id_1> <task_id_2>

# 列出所有任务
python -m eval.gaia.run_gaia --list-tasks

# 调整并发数和超时
python -m eval.gaia.run_gaia --levels 1 --concurrency 1 --timeout 1200
```

### 编程式调用

```python
import asyncio
from eval.gaia import GAIARunner, GAIAConfig

config = GAIAConfig(
    dataset_path="./eval/data/gaia",
    model_name="hepai/deepseek-v4-flash",
    levels=[1],
    max_concurrent=3,
    per_task_timeout=600,
)
runner = GAIARunner(config)
asyncio.run(runner.run())
```

---

## 🔑 核心设计

| 特性 | 说明 |
|------|------|
| **Agent 接口** | 通过 `run_drsai_agent.py` 的 `create_agent()` 创建 DrSaiAssistant，调用 `agent.run_stream(task=prompt)` |
| **任务隔离** | 每个任务创建独立 agent 实例 + 独立 thread_id，避免上下文污染 |
| **断点续跑** | 结果逐行写入 JSONL，中断后重跑自动跳过已完成任务 |
| **并发控制** | asyncio.Semaphore 控制最大并发数 |
| **答案提取** | 支持 "Answer:"、"答案是"、`\boxed{}` 等多种格式 |
| **评分规则** | GAIA 官方归一化精确匹配（小写化、去冠词、数字归一化等） |
| **附件文件** | 自动检测 GAIA 任务的附件文件，在 prompt 中告知 agent 文件路径 |

### 核心流程

1. **加载数据集**: `GAIADataset` 从 parquet/json 文件加载 466 道验证集题目
2. **过滤任务**: 按 level 或 task_id 筛选
3. **创建 Agent**: 每个任务创建独立的 DrSaiAssistant 实例（通过 `create_agent()`）
4. **发送问题**: 调用 `agent.run_stream(task=prompt)` 发送 GAIA 问题
5. **收集响应**: 流式收集 agent 的所有事件（工具调用、思考、文本输出）
6. **提取答案**: 使用正则模式从响应中提取 "Answer: xxx" 格式的答案
7. **评估匹配**: 使用 GAIA 官方规则进行归一化精确匹配
8. **保存结果**: 逐任务保存（支持中断恢复），最后生成汇总

---

## 📊 输出结果

每次运行会在 `eval/results/gaia/{timestamp}/` 目录下生成：

```
eval/results/gaia/20250105_120000/
├── results.jsonl       # 每个任务的详细结果（逐行 JSON）
├── summary.json        # 汇总统计（准确率、按级别拆分）
├── gaia_eval.log       # 全局日志
└── logs/               # 每个任务的完整交互日志
    ├── task_id_1.json
    ├── task_id_2.json
    └── ...
```

### results.jsonl 格式

```json
{
    "task_id": "d04c8e08-...",
    "level": 1,
    "question": "What is ...",
    "ground_truth": "Paris",
    "predicted_answer": "Paris",
    "success": true,
    "reason": "Exact match: 'paris' == 'paris'",
    "raw_response": "After searching... Answer: Paris",
    "duration_sec": 45.3,
    "error": null,
    "num_tool_calls": 3,
    "timestamp": "2025-01-05T12:00:00"
}
```

### summary.json 格式

```json
{
    "run_id": "20250105_120000",
    "model_name": "hepai/deepseek-v4-flash",
    "total_tasks": 53,
    "succeeded": 18,
    "failed": 30,
    "errored": 5,
    "accuracy": 0.3396,
    "duration_sec": 1820.5,
    "level_stats": {
        "1": {"total": 53, "succeeded": 18, "accuracy": 0.3396}
    }
}
```

---

## 📝 评分规则

GAIA 使用**归一化精确匹配**（Normalized Exact Match）：

1. 从 agent 响应中提取答案（支持 "Answer:"、"答案是"、`\boxed{}` 等格式）
2. 对预测答案和标准答案进行归一化：
   - 转小写
   - 去除首尾空格
   - 去除句末标点
   - 去除短答案前的冠词（the/a/an）
   - 数字归一化（如 1.0 → 1）
3. 精确匹配比较
4. 支持多答案匹配（标准答案可能含多个可接受答案）

---

## ✅ 已验证

- 所有模块导入正常
- 答案提取、归一化、匹配逻辑测试通过
- CLI `--help`、`--list-tasks`、`--compare`、`--show-latest` 均正常工作
- 数据集不存在时给出清晰的下载指引

---

## 📋 环境要求

- Python 3.10+
- drsai 包（已安装）
- pandas（读取 parquet）
- pyarrow（parquet 支持）
- loguru（日志）
- autogen-core, autogen-agentchat（DrSaiAssistant 依赖）

```bash
pip install pandas pyarrow loguru
```

---

## ⚠️ 注意事项

- GAIA 验证集共 466 题（Level 1: 53, Level 2: 180, Level 3: 233）
- Level 1 任务平均需要 1-5 步推理，Level 3 可能需要 10-40 步
- 某些任务需要分析附件文件（PDF、Excel、图片等）
- 建议先用 Level 1 + 低并发调试，确认无误后再全量运行
- 全量运行 466 题可能需要数小时（取决于模型速度和并发数）
