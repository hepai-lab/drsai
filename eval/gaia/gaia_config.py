"""
GAIA Evaluation Configuration

Controls dataset paths, model selection, concurrency, timeouts,
and output locations.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class GAIAConfig:
    """Configuration for GAIA benchmark evaluation.

    Attributes:
        dataset_path: Path to the GAIA dataset directory (downloaded from HuggingFace).
                      Expected structure:
                        dataset_path/
                        ├── validation/metadata.parquet  (or .json)
                        └── validation/                  (attached files)
        output_dir: Where to save results. Default: eval/results/gaia/
        model_name: DrSai model config name, e.g. "hepai/deepseek-v4-flash".
        levels: Which GAIA levels to test. [1, 2, 3] by default.
        task_ids: If set, only run these specific task IDs. Useful for debugging.
        max_concurrent: Max parallel agent tasks.
        per_task_timeout: Timeout in seconds for each task.
        max_turns: Max agent turns per task.
        api_key: API key for the model. If None, reads from env.
        save_intermediate: Save results after each task (for crash recovery).
        log_verbose: Log full agent interaction traces.
    """

    dataset_path: str = "./eval/data/gaia"
    output_dir: str = "./eval/results/gaia"

    # Model
    model_name: str = "hepai/deepseek-v4-flash"
    api_key: Optional[str] = None

    # Task selection
    levels: list = field(default_factory=lambda: [1, 2, 3])
    task_ids: Optional[list] = None

    # Execution
    max_concurrent: int = 3
    per_task_timeout: int = 600  # 10 minutes
    max_turns: int = 30

    # Output
    save_intermediate: bool = True
    log_verbose: bool = True

    # GAIA-specific
    # Whether to copy attached files to a temp workdir for the agent
    use_file_workdir: bool = True

    # Database
    # Path to the SQLite database file for the agent's model context.
    # If None, a database file is created inside the run output directory
    # (e.g. eval/results/gaia/<run_id>/gaia_eval.db) and reused for all
    # tasks in that run.  Set to an explicit path to persist across runs.
    db_path: Optional[str] = None

    # Resume / checkpoint-restart support
    # - False (default): always start a fresh run with a new timestamp directory.
    # - True: auto-find the latest run directory under output_dir and resume
    #   from its results.jsonl.  If no previous run is found, starts fresh.
    # - "<run_id>": resume from a specific run directory (e.g. "20250707_205341").
    resume: bool | str = False

    @property
    def dataset_dir(self) -> Path:
        return Path(self.dataset_path)

    @property
    def validation_dir(self) -> Path:
        return self.dataset_dir / "validation"

    @property
    def results_base_dir(self) -> Path:
        return Path(self.output_dir)
