#!/usr/bin/env python3
"""
GAIA Benchmark Evaluation CLI

Run GAIA benchmark evaluation on DrSaiAssistant.

Usage examples:
    # Run Level 1 only with default model
    python -m eval.gaia.run_gaia --levels 1

    # Run specific levels with a specific model
    python -m eval.gaia.run_gaia --levels 1 2 --model hepai/minimax-m2.7-highspeed

    # Run specific tasks (for debugging)
    python -m eval.gaia.run_gaia --task-ids d04c8e08-... 2a8e1c3d-...

    # Run with higher concurrency
    python -m eval.gaia.run_gaia --levels 1 --concurrency 5

    # Compare all previous runs
    python -m eval.gaia.run_gaia --compare

    # Show results from the latest run
    python -m eval.gaia.run_gaia --show-latest

Environment variables:
    The script reads API keys and other settings from .env file.
    Make sure HEPAI_API_KEY or equivalent is set.
"""

import argparse
import asyncio
import sys
import os
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv()

from eval.gaia.gaia_config import GAIAConfig
from eval.gaia.gaia_runner import GAIARunner
from eval.gaia.utils import find_latest_run, compare_runs, load_summary, load_results


def main():
    parser = argparse.ArgumentParser(
        description="GAIA Benchmark Evaluation for DrSaiAssistant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python -m eval.gaia.run_gaia --levels 1
    python -m eval.gaia.run_gaia --levels 1 2 --model hepai/minimax-m2.7-highspeed
    python -m eval.gaia.run_gaia --task-ids abc123 def456
    python -m eval.gaia.run_gaia --compare
    python -m eval.gaia.run_gaia --show-latest
        """,
    )

    parser.add_argument(
        "--dataset-path",
        default="/data/xiongdb/GAIA/2023/",
        help="Path to the GAIA dataset directory (default: ./eval/data/gaia)",
    )
    parser.add_argument(
        "--output-dir",
        default="./eval/results/gaia",
        help="Output directory for results (default: ./eval/results/gaia)",
    )
    parser.add_argument(
        "--model",
        default="hepai/deepseek-v4-flash",
        help="Model config name (default: hepai/deepseek-v4-flash)",
    )
    parser.add_argument(
        "--levels",
        nargs="+",
        type=int,
        default=[1, 2, 3],
        help="GAIA levels to test (default: 1 2 3)",
    )
    parser.add_argument(
        "--task-ids",
        nargs="+",
        default=None,
        help="Specific task IDs to run (for debugging)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=3,
        help="Max concurrent tasks (default: 3)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Per-task timeout in seconds (default: 600)",
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=30,
        help="Max agent turns per task (default: 30)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API key (default: reads from HEPAI_API_KEY env var)",
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the SQLite database for agent context. "
             "Default: <output_dir>/<run_id>/gaia_eval.db",
    )

    # Utility commands
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Compare all previous runs and exit",
    )
    parser.add_argument(
        "--show-latest",
        action="store_true",
        help="Show results from the latest run and exit",
    )
    parser.add_argument(
        "--list-tasks",
        action="store_true",
        help="List all tasks in the dataset and exit",
    )

    args = parser.parse_args()

    # Handle utility commands
    if args.compare:
        print(compare_runs(args.output_dir))
        return

    if args.show_latest:
        latest = find_latest_run(args.output_dir)
        if not latest:
            print("No runs found.")
            return
        summary = load_summary(latest / "summary.json")
        if summary:
            print(f"\nLatest run: {latest}")
            print(f"  Model: {summary.get('model_name', '?')}")
            print(f"  Total: {summary.get('total_tasks', 0)}")
            print(f"  Succeeded: {summary.get('succeeded', 0)}")
            print(f"  Accuracy: {summary.get('accuracy', 0):.2%}")
            for level, stats in sorted(summary.get("level_stats", {}).items()):
                print(f"  Level {level}: {stats['succeeded']}/{stats['total']} ({stats['accuracy']:.2%})")
        else:
            print(f"No summary found in {latest}")
        return

    if args.list_tasks:
        config = GAIAConfig(dataset_path=args.dataset_path)
        from eval.gaia.gaia_dataset import GAIADataset
        ds = GAIADataset(config.validation_dir)
        try:
            tasks = ds.load()
            print(f"\nTotal tasks: {len(tasks)}")
            for level in [1, 2, 3]:
                level_tasks = [t for t in tasks if t.level == level]
                print(f"\nLevel {level} ({len(level_tasks)} tasks):")
                for t in level_tasks[:5]:
                    print(f"  [{t.task_id[:12]}...] {t.question[:80]}...")
                if len(level_tasks) > 5:
                    print(f"  ... and {len(level_tasks) - 5} more")
        except Exception as e:
            print(f"Error loading dataset: {e}")
            print(f"Please download the GAIA dataset to {config.dataset_dir}")
            print(f"From: https://huggingface.co/datasets/gaia-benchmark/GAIA")
        return

    # Configure logging
    from loguru import logger
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    logger.add(
        Path(args.output_dir) / "gaia_eval.log",
        level="DEBUG",
        rotation="10 MB",
    )

    # Resolve API key: CLI argument takes precedence, fall back to env var
    resolved_api_key = args.api_key or os.environ.get("HEPAI_API_KEY")

    # Create config
    config = GAIAConfig(
        dataset_path=args.dataset_path,
        output_dir=args.output_dir,
        model_name=args.model,
        api_key=resolved_api_key,
        levels=args.levels,
        task_ids=args.task_ids,
        max_concurrent=args.concurrency,
        per_task_timeout=args.timeout,
        max_turns=args.max_turns,
        db_path=args.db_path,
    )

    # Verify dataset exists
    if not config.validation_dir.exists():
        print(f"\nERROR: Dataset not found at {config.validation_dir}")
        print(f"\nPlease download the GAIA dataset:")
        print(f"  1. Visit: https://huggingface.co/datasets/gaia-benchmark/GAIA")
        print(f"  2. Accept the terms and conditions")
        print(f"  3. Download the validation split files")
        print(f"  4. Place them in: {config.dataset_dir}/validation/")
        print(f"\nExpected structure:")
        print(f"  {config.dataset_dir}/")
        print(f"  └── validation/")
        print(f"      ├── metadata.parquet (or .json)")
        print(f"      └── <attached files...>")
        print(f"\nOr use huggingface-cli:")
        print(f"  pip install huggingface_hub")
        print(f"  huggingface-cli download gaia-benchmark/GAIA --repo-type dataset --local-dir {config.dataset_dir}")
        return

    # Run evaluation
    runner = GAIARunner(config)
    asyncio.run(runner.run())


if __name__ == "__main__":
    main()
