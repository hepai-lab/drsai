"""
SWE-bench Evaluation Configuration

Controls dataset selection, model, concurrency, timeouts,
repo management, and Docker evaluation settings.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class SWEBenchConfig:
    """Configuration for SWE-bench evaluation.

    Attributes:
        dataset_name: HuggingFace dataset name or local path.
                      Options: "princeton-nlp/SWE-bench_Lite" (300 instances),
                               "princeton-nlp/SWE-bench_Verified" (500 instances),
                               "princeton-nlp/SWE-bench" (2294 instances)
        split: Dataset split ("test" or "dev").
        output_dir: Where to save results. Default: eval/results/swebench/
        model_name: DrSai model config name.
        api_key: API key for the model. If None, reads from env.

        # Instance selection
        instance_ids: If set, only run these specific instance IDs.
        repos: If set, only run instances from these repos (e.g. ["django/django"]).

        # Execution
        max_concurrent: Max parallel agent tasks.
        per_task_timeout: Timeout in seconds for each task (SWE-bench tasks are complex).
        max_turns: Max agent turns per task.

        # Repo management
        repo_cache_dir: Where to cache cloned Git repositories.
        clean_repo_after: Whether to remove worktrees after each task.

        # Evaluation (Phase 2 - Docker)
        run_evaluation: Whether to run SWE-bench harness after inference.
        swebench_repo_path: Path to the SWE-bench repo (for harness CLI).
        max_workers: Max Docker evaluation workers.
        eval_timeout: Timeout for Docker test execution per instance.

        # Output
        save_intermediate: Save results after each task (for crash recovery).
        log_verbose: Log full agent interaction traces.

        # Database
        db_path: Path to SQLite database for agent context.
                 If None, created inside the run output directory.

        # Resume / checkpoint-restart
        resume: False=新run, True=自动找最新run, str=指定run_id
    """

    # Dataset
    dataset_name: str = "princeton-nlp/SWE-bench_Lite"
    split: str = "test"

    # Output
    output_dir: str = "./eval/results/swebench"

    # Model
    model_name: str = "hepai/deepseek-v4-flash"
    api_key: Optional[str] = None

    # Instance selection
    instance_ids: Optional[list] = None
    repos: Optional[list] = None

    # Execution
    max_concurrent: int = 2
    per_task_timeout: int = 1800  # 30 minutes
    max_turns: int = 50

    # Repo management
    repo_cache_dir: str = "/data/xiongdb/swebench_repos"
    clean_repo_after: bool = False

    # Evaluation (Phase 2)
    run_evaluation: bool = True
    swebench_repo_path: str = "/data/xiongdb/SWE-bench"
    max_workers: int = 4
    eval_timeout: int = 1800  # 30 min per instance in Docker

    # Output
    save_intermediate: bool = True
    log_verbose: bool = True

    # Database
    db_path: Optional[str] = None

    # Resume
    resume: bool | str = False

    @property
    def results_base_dir(self) -> Path:
        return Path(self.output_dir)
