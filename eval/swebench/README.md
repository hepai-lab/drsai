# SWE-bench 评测测试框架

基于 SWE-bench benchmark 对 DrSaiAssistant 进行性能评测的测试框架。

参考 `eval/gaia/` 框架结构，适配 SWE-bench 的代码修复任务。

---

## 📋 概述

SWE-bench 是评估大语言模型解决真实 GitHub Issue 能力的基准测试。与 GAIA（问答型）不同，SWE-bench 要求 Agent 阅读代码库、诊断问题、修改代码并生成补丁。

### 两阶段评测流程

```
Phase 1: Inference (Agent 生成补丁)
  DrSaiAssistant → 探索代码 → 修复 → git diff → predictions.jsonl

Phase 2: Evaluation (Docker 测试)
  SWE-bench Harness → Docker容器 → 应用补丁 → 运行测试 → 判定 resolved
```

### GAIA vs SWE-bench 对比

| 维度 | GAIA | SWE-bench |
|------|------|-----------|
| 输入 | 问题文本 | GitHub Issue + 代码库 |
| Agent任务 | 回答问题 | 生成代码补丁 (diff) |
| 输出 | 文本答案 | unified diff |
| 评估方式 | 归一化精确匹配 | Docker 运行测试 |
| 工具需求 | web search | bash, file read/write/edit |

---

## 📥 数据集

SWE-bench 数据集从 HuggingFace 加载，无需手动下载：

| 数据集 | 实例数 | 说明 |
|--------|--------|------|
| `princeton-nlp/SWE-bench_Lite` | 300 | 精简版（推荐入门） |
| `princeton-nlp/SWE-bench_Verified` | 500 | 人工验证版 |
| `princeton-nlp/SWE-bench` | 2294 | 完整版 |

```python
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
```

### 数据集字段

| 字段 | 说明 |
|------|------|
| `instance_id` | 唯一标识 (e.g. `astropy__astropy-12907`) |
| `repo` | GitHub 仓库名 (e.g. `astropy/astropy`) |
| `base_commit` | 需要checkout的commit |
| `problem_statement` | GitHub Issue 文本 |
| `hints_text` | Issue 讨论中的提示 |
| `patch` | Gold patch（标准答案，不提供给Agent） |
| `test_patch` | 测试补丁（Docker评估时使用） |
| `FAIL_TO_PASS` | 修复后应通过的测试 |
| `PASS_TO_PASS` | 修复后仍应通过的测试 |
| `version` | 项目版本 |

---

## 📁 框架文件结构

```
eval/swebench/
├── __init__.py               # 包入口
├── swebench_config.py        # 配置（数据集、模型、并发、超时、Docker等）
├── swebench_dataset.py       # 数据集加载器（HuggingFace / 本地文件）
├── swebench_prompts.py       # SWE-bench 专用系统提示词
├── swebench_runner.py        # 主运行器（Phase 1: Agent生成补丁）
├── swebench_evaluator.py     # 评估器（Phase 2: Docker测试）
├── run_swebench.py           # CLI 命令行入口
├── utils.py                  # 工具函数（结果比较、展示）
└── README.md                 # 本文件
```

---

## 🚀 使用方式

### 环境准备

```bash
# 1. 创建 swebench conda 环境（用户已配置）
conda create -n swebench python=3.12
conda run -n swebench pip install -e /data/xiongdb/SWE-bench
conda run -n swebench pip install datasets docker

# 2. 确保 Docker 已安装并运行
docker --version

# 3. 设置 API Key
export HEPAI_API_KEY=your_key_here
```

### 基本用法

```bash
# 在项目根目录运行

# 1. 列出所有实例
python -m eval.swebench.run_swebench --list-instances

# 2. 先用单个实例调试
python -m eval.swebench.run_swebench --instance-ids astropy__astropy-12907 --concurrency 1

# 3. 只跑某个 repo 的实例
python -m eval.swebench.run_swebench --repos django/django

# 4. 正式运行 SWE-bench Lite (300题)
python -m eval.swebench.run_swebench --concurrency 2

# 5. 换模型测试
python -m eval.swebench.run_swebench --model hepai/deepseek-v4-pro

# 6. 只生成补丁，不跑 Docker 评估
python -m eval.swebench.run_swebench --no-eval

# 7. 查看结果
python -m eval.swebench.run_swebench --show-latest    # 最近一次
python -m eval.swebench.run_swebench --compare        # 所有历史对比

# 8. 断点续跑
python -m eval.swebench.run_swebench --resume         # 自动找最新run
python -m eval.swebench.run_swebench --resume 20250709_120000  # 指定run_id
```

### 编程式调用

```python
import asyncio
from eval.swebench import SWEBenchRunner, SWEBenchConfig

config = SWEBenchConfig(
    dataset_name="princeton-nlp/SWE-bench_Lite",
    model_name="hepai/deepseek-v4-flash",
    max_concurrent=2,
    per_task_timeout=1800,
    run_evaluation=True,
)
runner = SWEBenchRunner(config)
asyncio.run(runner.run())
```

---

## 🔑 核心设计

### Phase 1: Agent 生成补丁

| 特性 | 说明 |
|------|------|
| **Agent 接口** | 通过 `run_drsai_agent.py` 的 `create_agent()` 创建 DrSaiAssistant |
| **任务隔离** | 每个实例创建独立 agent + 独立 thread_id + 独立 repo checkout |
| **Repo 管理** | 每个仓库 clone 一次到缓存，每个实例创建本地 clone + checkout base_commit |
| **补丁提取** | Agent 编辑文件后，通过 `git add -A && git diff --cached` 提取 diff |
| **断点续跑** | 结果逐行写入 JSONL，中断后重跑自动跳过已完成任务 |
| **并发控制** | asyncio.Semaphore 控制最大并发数 |

### Phase 2: Docker 评估

| 特性 | 说明 |
|------|------|
| **评估工具** | SWE-bench 官方 harness (`swebench.harness.run_evaluation`) |
| **评估流程** | 构建 Docker 镜像 → 应用补丁 → 运行测试 → 判定 resolved |
| **判定标准** | FAIL_TO_PASS 全部通过 + PASS_TO_PASS 全部通过 = RESOLVED |
| **结果解析** | 解析 `logs/run_evaluation/<run_id>/` 下的 report.json |

### 核心流程

```
1. 加载数据集: SWEBenchDataset 从 HuggingFace 加载实例
2. 过滤任务: 按 instance_ids 或 repos 筛选
3. 准备 Repo: RepoManager clone 仓库 → checkout base_commit
4. 创建 Agent: 每个任务创建独立的 DrSaiAssistant 实例
5. 发送 Issue: 调用 agent.run_stream(task=prompt) 发送 problem_statement
6. Agent 工作流: 探索代码 → 诊断问题 → 编辑文件 → 运行测试验证
7. 提取补丁: git diff 提取 Agent 的所有文件修改
8. 保存预测: 写入 predictions.jsonl (SWE-bench 标准格式)
9. Docker评估: 调用 SWE-bench harness 运行测试
10. 生成报告: 解析 report.json → 汇总 resolved/failed
```

---

## 📊 输出结果

每次运行会在 `eval/results/swebench/{timestamp}/` 目录下生成：

```
eval/results/swebench/20250709_120000/
├── results.jsonl          # 每个任务的详细结果
├── predictions.jsonl      # SWE-bench 格式的预测文件
├── summary.json           # Phase 1 汇总统计
├── eval_summary.json      # Phase 2 评估汇总（Docker完成后）
├── eval_details.jsonl     # Phase 2 每个实例的评估详情
├── swebench_eval.db       # Agent 上下文数据库
├── swebench_eval.log      # 全局日志
└── logs/                  # 每个任务的完整交互日志
    ├── astropy__astropy-12907.json
    ├── django__django-11039.json
    └── ...
```

### predictions.jsonl 格式 (SWE-bench 标准)

```json
{
    "instance_id": "astropy__astropy-12907",
    "model_name_or_path": "hepai/deepseek-v4-flash",
    "model_patch": "diff --git a/astropy/modeling/separable.py\n--- a/..."
}
```

### summary.json 格式

```json
{
    "run_id": "20250709_120000",
    "model_name": "hepai/deepseek-v4-flash",
    "total_tasks": 300,
    "with_patch": 250,
    "no_patch": 30,
    "errored": 20,
    "duration_sec": 7200.5,
    "repo_stats": {
        "django/django": {"total": 60, "with_patch": 50, "no_patch": 5, "errored": 5},
        ...
    }
}
```

### eval_summary.json 格式

```json
{
    "run_id": "20250709_120000",
    "total_instances": 250,
    "resolved": 75,
    "failed": 160,
    "errored": 15,
    "resolve_rate": 0.30,
    "repo_stats": {
        "django/django": {"total": 50, "resolved": 20, "failed": 28, "errored": 2},
        ...
    }
}
```

---

## 📝 评分规则

SWE-bench 使用 **Docker 测试执行** 评估：

1. 将 Agent 生成的补丁应用到 Docker 容器中的代码库
2. 运行 `FAIL_TO_PASS` 测试（修复前失败，修复后应通过）
3. 运行 `PASS_TO_PASS` 测试（修复前后都应通过）
4. 判定标准：
   - **RESOLVED_FULL**: 所有 FAIL_TO_PASS 通过 + 所有 PASS_TO_PASS 通过
   - **RESOLVED_PARTIAL**: 部分 FAIL_TO_PASS 通过 + 所有 PASS_TO_PASS 通过
   - **RESOLVED_NO**: 不满足上述条件

---

## ⚠️ 注意事项

- SWE-bench Lite 共 300 题，覆盖 11 个 Python 开源项目
- 每个 Agent 任务需要探索代码库并实现修复，平均耗时 5-30 分钟
- Docker 评估需要 120GB+ 磁盘空间和 16GB+ 内存
- 首次运行会 clone 所有涉及的 GitHub 仓库（约 5-10GB）
- 建议先用 `--instance-ids` 调试单个实例
- 使用 `--no-eval` 先只生成补丁，确认效果后再跑 Docker 评估
- 断点续跑使用 `--resume`，会跳过已完成的实例

### 环境要求

- Python 3.12+（drsai_dev conda 环境，运行评测框架）
- `swebench` conda 环境（Phase 2 Docker 评估，已安装 swebench 包）
- Docker（Phase 2 评估需要）
- drsai 包（在 drsai_dev 环境中已安装）
- datasets 库（在 drsai_dev 环境中）

```bash
# drsai_dev 环境（运行评测框架 + Agent bash）
pip install datasets loguru  # 已安装

# swebench 环境（Phase 2 Docker 评估）
conda run -n swebench pip install -e /data/xiongdb/SWE-bench
```
