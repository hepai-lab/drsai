#!/usr/bin/env python3
"""
SWE-bench Evaluation CLI

Run SWE-bench evaluation on DrSaiAssistant.

Usage examples:
    # List available instances
    python -m eval.swebench.run_swebench --list-instances

    # Run SWE-bench Lite (300 instances) with default model
    python -m eval.swebench.run_swebench

    # Run specific instances only (for debugging)
    python -m eval.swebench.run_swebench --instance-ids astropy__astropy-12907

    # Run only instances from a specific repo
    python -m eval.swebench.run_swebench --repos django/django

    # Run with a specific model
    python -m eval.swebench.run_swebench --model hepai/deepseek-v4-pro

    # Skip Docker evaluation (only generate patches)
    python -m eval.swebench.run_swebench --no-eval

    # Compare all previous runs
    python -m eval.swebench.run_swebench --compare

    # Show results from the latest run
    python -m eval.swebench.run_swebench --show-latest

    # Resume a previous run
    python -m eval.swebench.run_swebench --resume
    python -m eval.swebench.run_swebench --resume 20250709_120000

Environment variables:
    The script reads API keys from .env file.
    Make sure HEPAI_API_KEY is set.
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

from eval.swebench.swebench_config import SWEBenchConfig
from eval.swebench.swebench_runner import SWEBenchRunner
from eval.swebench.utils import (
    find_latest_run, compare_runs, load_summary,
    show_run_details,
)


def main():
    parser = argparse.ArgumentParser(
        description="SWE-bench Evaluation for DrSaiAssistant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python -m eval.swebench.run_swebench --list-instances
    python -m eval.swebench.run_swebench --instance-ids astropy__astropy-12907
    python -m eval.swebench.run_swebench --repos django/django
    python -m eval.swebench.run_swebench --model hepai/deepseek-v4-pro
    python -m eval.swebench.run_swebench --no-eval
    python -m eval.swebench.run_swebench --compare
    python -m eval.swebench.run_swebench --show-latest
    python -m eval.swebench.run_swebench --resume
        """,
    )

    # Dataset
    parser.add_argument(
        "--dataset",
        default="princeton-nlp/SWE-bench_Lite",
        help="HuggingFace dataset name (default: princeton-nlp/SWE-bench_Lite). "
             "Options: SWE-bench_Lite (300), SWE-bench_Verified (500), SWE-bench (2294)",
    )
    parser.add_argument(
        "--split",
        default="test",
        help="Dataset split (default: test)",
    )

    # Output
    parser.add_argument(
        "--output-dir",
        default="./eval/results/swebench",
        help="Output directory for results (default: ./eval/results/swebench)",
    )

    # Model
    parser.add_argument(
        "--model",
        default="hepai/deepseek-v4-flash",
        help="Model config name (default: hepai/deepseek-v4-flash)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API key (default: reads from HEPAI_API_KEY env var)",
    )

    # Instance selection
    parser.add_argument(
        "--instance-ids",
        nargs="+",
        default=None,
        help="Specific instance IDs to run (for debugging)",
    )
    parser.add_argument(
        "--repos",
        nargs="+",
        default=None,
        help="Only run instances from these repos (e.g. django/django sympy/sympy)",
    )

    # Execution
    parser.add_argument(
        "--concurrency",
        type=int,
        default=2,
        help="Max concurrent tasks (default: 2)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=1800,
        help="Per-task timeout in seconds (default: 1800 = 30 min)",
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=50,
        help="Max agent turns per task (default: 50)",
    )

    # Repo management
    parser.add_argument(
        "--repo-cache-dir",
        default="/data/xiongdb/swebench_repos",
        help="Directory for cached Git repos (default: /data/xiongdb/swebench_repos)",
    )
    parser.add_argument(
        "--clean-repo",
        action="store_true",
        help="Clean up repo worktrees after each task (saves disk space)",
    )

    # Evaluation (Phase 2)
    parser.add_argument(
        "--no-eval",
        action="store_true",
        help="Skip Docker evaluation (only generate patches, Phase 1 only)",
    )
    parser.add_argument(
        "--swebench-path",
        default="/data/xiongdb/SWE-bench",
        help="Path to SWE-bench repo for harness CLI (default: /data/xiongdb/SWE-bench)",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Max Docker evaluation workers (default: 4)",
    )
    parser.add_argument(
        "--eval-timeout",
        type=int,
        default=1800,
        help="Timeout for Docker test execution per instance (default: 1800s)",
    )

    # Database
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to the SQLite database for agent context. "
             "Default: <output_dir>/<run_id>/swebench_eval.db",
    )

    # Resume
    parser.add_argument(
        "--resume",
        nargs="?",
        const=True,
        default=False,
        help="Resume from previous run. "
             "No value = auto-find latest; <run_id> = specific run",
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
        "--show-run",
        type=str,
        default=None,
        help="Show detailed results for a specific run_id and exit",
    )
    parser.add_argument(
        "--list-instances",
        action="store_true",
        help="List all instances in the dataset and exit",
    )

    args = parser.parse_args()

    # ── Handle utility commands ──────────────────────────────────────

    if args.compare:
        print(compare_runs(args.output_dir))
        return

    if args.show_latest:
        latest = find_latest_run(args.output_dir)
        if not latest:
            print("No runs found.")
            return
        print(show_run_details(latest))
        return

    if args.show_run:
        run_dir = Path(args.output_dir) / args.show_run
        if not run_dir.exists():
            print(f"Run directory not found: {run_dir}")
            return
        print(show_run_details(run_dir))
        return

    if args.list_instances:
        config = SWEBenchConfig(
            dataset_name=args.dataset,
            split=args.split,
        )
        from eval.swebench.swebench_dataset import SWEBenchDataset
        ds = SWEBenchDataset(config.dataset_name, config.split)
        try:
            tasks = ds.load()
            print(f"\nDataset: {args.dataset} [{args.split}]")
            print(f"Total instances: {len(tasks)}\n")

            # Group by repo
            repo_tasks: dict = {}
            for t in tasks:
                repo_tasks.setdefault(t.repo, []).append(t)

            for repo in sorted(repo_tasks.keys()):
                repo_instances = repo_tasks[repo]
                print(f"{repo} ({len(repo_instances)} instances):")
                for t in repo_instances[:3]:
                    print(f"  [{t.instance_id}] (v{t.version}) "
                          f"{t.problem_statement[:80]}...")
                if len(repo_instances) > 3:
                    print(f"  ... and {len(repo_instances) - 3} more")
                print()

            print(f"Repos: {len(repo_tasks)}")
            print(f"Total: {len(tasks)} instances")
        except Exception as e:
            print(f"Error loading dataset: {e}")
        return

    # ── Configure logging ─────────────────────────────────────────────

    from loguru import logger
    logger.remove()
    logger.add(sys.stderr, level="INFO")
    logger.add(
        Path(args.output_dir) / "swebench_eval.log",
        level="DEBUG",
        rotation="10 MB",
    )

    # ── Resolve API key ───────────────────────────────────────────────

    resolved_api_key = args.api_key or os.environ.get("HEPAI_API_KEY")

    # ── Create config ─────────────────────────────────────────────────

    config = SWEBenchConfig(
        dataset_name=args.dataset,
        split=args.split,
        output_dir=args.output_dir,
        model_name=args.model,
        api_key=resolved_api_key,
        instance_ids=args.instance_ids,
        repos=args.repos,
        max_concurrent=args.concurrency,
        per_task_timeout=args.timeout,
        max_turns=args.max_turns,
        repo_cache_dir=args.repo_cache_dir,
        clean_repo_after=args.clean_repo,
        run_evaluation=not args.no_eval,
        swebench_repo_path=args.swebench_path,
        max_workers=args.max_workers,
        eval_timeout=args.eval_timeout,
        db_path=args.db_path,
        resume=args.resume if isinstance(args.resume, str) else (
            True if args.resume is True else False
        ),
    )

    # ── Run ───────────────────────────────────────────────────────────

    runner = SWEBenchRunner(config)
    asyncio.run(runner.run())


if __name__ == "__main__":
    main()
