"""
Utility functions for SWE-bench evaluation.
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


def load_predictions(predictions_file: str | Path) -> List[Dict[str, Any]]:
    """Load predictions from a predictions.jsonl file."""
    return load_results(predictions_file)


def load_summary(summary_file: str | Path) -> Dict[str, Any]:
    """Load summary from a summary.json file."""
    path = Path(summary_file)
    if not path.exists():
        return {}
    with open(path, "r") as f:
        return json.load(f)


def find_latest_run(results_dir: str | Path = "./eval/results/swebench") -> Path | None:
    """Find the most recent run directory."""
    import re
    base = Path(results_dir)
    if not base.exists():
        return None

    pattern = re.compile(r"^\d{8}_\d{6}$")
    candidates = []
    for child in base.iterdir():
        if child.is_dir() and pattern.match(child.name):
            candidates.append(child)

    if not candidates:
        return None

    candidates.sort(key=lambda p: p.name, reverse=True)
    return candidates[0]


def compare_runs(results_dir: str | Path = "./eval/results/swebench") -> str:
    """Generate a comparison table of all runs."""
    import re
    base = Path(results_dir)
    if not base.exists():
        return "No results directory found."

    pattern = re.compile(r"^\d{8}_\d{6}$")
    runs = sorted(
        [d for d in base.iterdir() if d.is_dir() and pattern.match(d.name)],
        key=lambda p: p.name,
    )
    if not runs:
        return "No runs found."

    lines = []
    header = (
        f"{'Run ID':<22} {'Model':<30} {'Total':>6} "
        f"{'Patch':>6} {'Patch%':>8} {'Resolved':>9} {'Resolve%':>10} {'Duration':>10}"
    )
    lines.append(header)
    lines.append("-" * len(header))

    for run_dir in runs:
        summary_file = run_dir / "summary.json"
        eval_summary_file = run_dir / "eval_summary.json"

        summary = {}
        if summary_file.exists():
            with open(summary_file, "r") as f:
                summary = json.load(f)

        eval_summary = {}
        if eval_summary_file.exists():
            with open(eval_summary_file, "r") as f:
                eval_summary = json.load(f)

        total = summary.get("total_tasks", 0)
        with_patch = summary.get("with_patch", 0)
        patch_rate = with_patch / total if total > 0 else 0

        resolved = eval_summary.get("resolved", 0)
        resolve_rate = eval_summary.get("resolve_rate", 0)

        lines.append(
            f"{summary.get('run_id', '?'):<22} "
            f"{summary.get('model_name', '?'):<30} "
            f"{total:>6} "
            f"{with_patch:>6} "
            f"{patch_rate:>7.2%} "
            f"{resolved:>9} "
            f"{resolve_rate:>9.2%} "
            f"{summary.get('duration_sec', 0):>9.1f}s"
        )

    return "\n".join(lines)


def show_run_details(run_dir: str | Path) -> str:
    """Show detailed results for a specific run."""
    run_dir = Path(run_dir)
    lines = []

    # Summary
    summary_file = run_dir / "summary.json"
    if summary_file.exists():
        with open(summary_file, "r") as f:
            summary = json.load(f)
        lines.append(f"=== Run {summary.get('run_id', '?')} ===")
        lines.append(f"Model: {summary.get('model_name', '?')}")
        lines.append(f"Total: {summary.get('total_tasks', 0)}")
        lines.append(f"With patch: {summary.get('with_patch', 0)}")
        lines.append(f"No patch: {summary.get('no_patch', 0)}")
        lines.append(f"Errored: {summary.get('errored', 0)}")
        lines.append("")

        # Repo stats
        lines.append("By Repo:")
        for repo, stats in sorted(summary.get("repo_stats", {}).items()):
            lines.append(
                f"  {repo}: {stats['with_patch']}/{stats['total']} "
                f"(errored={stats['errored']})"
            )
        lines.append("")

    # Eval summary
    eval_summary_file = run_dir / "eval_summary.json"
    if eval_summary_file.exists():
        with open(eval_summary_file, "r") as f:
            eval_summary = json.load(f)
        lines.append("=== Phase 2: Docker Evaluation ===")
        lines.append(f"Resolved: {eval_summary.get('resolved', 0)}/"
                      f"{eval_summary.get('total_instances', 0)}")
        lines.append(f"Resolve rate: {eval_summary.get('resolve_rate', 0):.2%}")
        lines.append("")

        if eval_summary.get("repo_stats"):
            lines.append("By Repo:")
            for repo, stats in sorted(eval_summary["repo_stats"].items()):
                rr = stats["resolved"] / stats["total"] if stats["total"] > 0 else 0
                lines.append(
                    f"  {repo}: {stats['resolved']}/{stats['total']} ({rr:.0%})"
                )

    return "\n".join(lines)
