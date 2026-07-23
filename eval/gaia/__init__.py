"""
GAIA Benchmark Evaluation Framework for DrSaiAssistant

This package provides a test framework to evaluate DrSaiAssistant on the
GAIA benchmark (https://huggingface.co/datasets/gaia-benchmark/GAIA).

Quick Start:
    from eval.gaia import GAIARunner, GAIAConfig

    config = GAIAConfig(
        dataset_path="./eval/data/gaia",
        model_name="hepai/deepseek-v4-flash",
        levels=[1],
        max_concurrent=3,
    )
    runner = GAIARunner(config)
    asyncio.run(runner.run())
"""

from .gaia_config import GAIAConfig
from .gaia_dataset import GAIADataset
from .gaia_evaluator import GAIAEvaluator, QuestionSucceeded
from .gaia_runner import GAIARunner

__all__ = [
    "GAIAConfig",
    "GAIADataset",
    "GAIAEvaluator",
    "GAIARunner",
    "QuestionSucceeded",
]
