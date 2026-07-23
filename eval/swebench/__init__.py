"""
SWE-bench Evaluation Framework for DrSaiAssistant

Based on the GAIA evaluation framework structure.
Evaluates DrSaiAssistant on real-world GitHub issues from SWE-bench.

Two-phase evaluation:
  Phase 1: Agent generates code patches (swebench_runner.py)
  Phase 2: SWE-bench harness evaluates patches via Docker (swebench_evaluator.py)
"""

from .swebench_config import SWEBenchConfig
from .swebench_dataset import SWEBenchDataset, SWEBenchTask
from .swebench_runner import SWEBenchRunner, SWEBenchTaskResult, SWEBenchRunSummary
from .swebench_evaluator import SWEBenchEvaluator
from .swebench_prompts import SWEBENCH_SYSTEM_PROMPT, build_swebench_prompt

__all__ = [
    "SWEBenchConfig",
    "SWEBenchDataset",
    "SWEBenchTask",
    "SWEBenchRunner",
    "SWEBenchTaskResult",
    "SWEBenchRunSummary",
    "SWEBenchEvaluator",
    "SWEBENCH_SYSTEM_PROMPT",
    "build_swebench_prompt",
]
