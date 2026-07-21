"""
Utility functions for GAIA evaluation.
"""

import json
from pathlib import Path
from typing import Dict, Any, List


def load_results(results_file: str | Path) -> List[Dict[str, Any]]:
    """Load all results from a results.jsonl file."""
    results = []
    path = Path(results_file)
    if not path.exists():
        return results
    with open(path, "r") as f:
        for line in f:
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return results


def load_summary(summary_file: str | Path) -> Dict[str, Any]:
    """Load summary from a summary.json file."""
    path = Path(summary_file)
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return json.load(f)


def find_latest_run(results_dir: str | Path = "./eval/results/gaia") -> Path | None:
    """Find the most recent run directory."""
    base = Path(results_dir)
    if not base.exists():
        return None
    runs = sorted([d for d in base.iterdir() if d.is_dir()])
    return runs[-1] if runs else None


def compare_runs(results_dir: str | Path = "./eval/results/gaia") -> str:
    """Generate a comparison table of all runs."""
    base = Path(results_dir)
    if not base.exists():
        return "No results directory found."

    runs = sorted([d for d in base.iterdir() if d.is_dir()])
    if not runs:
        return "No runs found."

    lines = []
    header = f"{'Run ID':<22} {'Model':<30} {'Total':>6} {'Pass':>6} {'Acc':>8} {'Duration':>10}"
    lines.append(header)
    lines.append("-" * len(header))

    for run_dir in runs:
        summary_file = run_dir / "summary.json"
        if not summary_file.exists():
            continue
        with open(summary_file, "r") as f:
            summary = json.load(f)
        lines.append(
            f"{summary.get('run_id', '?'):<22} "
            f"{summary.get('model_name', '?'):<30} "
            f"{summary.get('total_tasks', 0):>6} "
            f"{summary.get('succeeded', 0):>6} "
            f"{summary.get('accuracy', 0):>7.2%} "
            f"{summary.get('duration_sec', 0):>9.1f}s"
        )

    return "\n".join(lines)
