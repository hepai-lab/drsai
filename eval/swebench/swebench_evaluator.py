"""
SWE-bench Evaluation Harness Bridge (Phase 2: Docker Evaluation)

Calls the SWE-bench harness to evaluate agent-generated patches.
The harness:
1. Builds Docker images for each repo/version
2. Applies the model_patch to the container
3. Runs FAIL_TO_PASS and PASS_TO_PASS tests
4. Determines if the issue is resolved

This module wraps the SWE-bench CLI (`swebench.harness.run_evaluation`)
and parses the resulting report files.
"""

import asyncio
import json
import subprocess
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any, List
from loguru import logger

from .swebench_config import SWEBenchConfig


@dataclass
class EvalInstanceResult:
    """Evaluation result for a single instance."""
    instance_id: str
    resolved: bool
    patch_applied: bool
    tests_status: Optional[dict] = None
    error: Optional[str] = None


@dataclass
class EvalSummary:
    """Summary of Phase 2 evaluation."""
    run_id: str
    total_instances: int
    resolved: int
    failed: int
    errored: int
    resolve_rate: float
    repo_stats: Dict[str, Dict[str, Any]] = None

    def to_dict(self) -> dict:
        return asdict(self)


class SWEBenchEvaluator:
    """Runs SWE-bench Docker evaluation on agent predictions.

    Phase 2 of the SWE-bench evaluation pipeline.
    """

    def __init__(self, config: SWEBenchConfig):
        self.config = config
        self.swebench_path = Path(config.swebench_repo_path)

    async def evaluate(
        self,
        predictions_path: str,
        run_id: str,
    ) -> Optional[EvalSummary]:
        """Run the SWE-bench harness evaluation.

        Args:
            predictions_path: Path to predictions.jsonl file.
            run_id: Unique run identifier.

        Returns:
            EvalSummary with results, or None on failure.
        """
        if not Path(predictions_path).exists():
            logger.error(f"Predictions file not found: {predictions_path}")
            return None

        # Build the command
        cmd = self._build_eval_command(predictions_path, run_id)
        logger.info(f"Running SWE-bench harness:")
        logger.info(f"  {' '.join(cmd)}")
        logger.info(f"  Working dir: {self.swebench_path}")

        # Run the evaluation
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.swebench_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Stream output
            stdout_lines = []
            stderr_lines = []

            async def _read_stream(stream, lines_list, prefix=""):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    decoded = line.decode("utf-8", errors="replace").rstrip()
                    lines_list.append(decoded)
                    if prefix:
                        logger.info(f"[swebench]{prefix} {decoded}")
                    else:
                        logger.info(f"[swebench] {decoded}")

            await asyncio.gather(
                _read_stream(process.stdout, stdout_lines),
                _read_stream(process.stderr, stderr_lines, prefix=" [ERR]"),
            )

            await process.wait()

            if process.returncode != 0:
                logger.error(
                    f"SWE-bench harness failed with exit code {process.returncode}"
                )
                # Still try to parse partial results
            else:
                logger.info("SWE-bench harness completed successfully.")

        except FileNotFoundError:
            logger.error(
                f"conda or swebench not found. "
                f"Make sure the 'swebench' conda environment exists and has swebench installed:\n"
                f"  conda create -n swebench python=3.12\n"
                f"  conda run -n swebench pip install -e {self.swebench_path}"
            )
            return None
        except Exception as e:
            logger.error(f"Error running SWE-bench harness: {e}")
            return None

        # Parse results
        summary = self._parse_results(run_id)
        if summary:
            self._print_eval_summary(summary)

        return summary

    def _build_eval_command(
        self,
        predictions_path: str,
        run_id: str,
    ) -> List[str]:
        """Build the SWE-bench harness CLI command.

        Uses `conda run -n swebench` to invoke the harness in the
        dedicated swebench conda environment where the swebench
        package is installed.
        """
        cmd = [
            "conda", "run", "--no-capture-output", "-n", "swebench",
            "python", "-m", "swebench.harness.run_evaluation",
            "--dataset_name", self.config.dataset_name,
            "--split", self.config.split,
            "--predictions_path", str(predictions_path),
            "--max_workers", str(self.config.max_workers),
            "--run_id", run_id,
            "--timeout", str(self.config.eval_timeout),
        ]

        # Add instance_ids filter if specified
        if self.config.instance_ids:
            cmd.extend(["--instance_ids"] + self.config.instance_ids)

        return cmd

    def _parse_results(self, run_id: str) -> Optional[EvalSummary]:
        """Parse the evaluation report files generated by the harness.

        The harness creates report files at:
            logs/run_evaluation/<run_id>/<model_name>/<instance_id>/report.json
        """
        model_slug = self.config.model_name.replace("/", "__")
        report_base = self.swebench_path / "logs" / "run_evaluation" / run_id / model_slug

        if not report_base.exists():
            # Try alternate location
            report_base = Path("logs") / "run_evaluation" / run_id / model_slug
            if not report_base.exists():
                logger.error(f"Report directory not found: {report_base}")
                return None

        logger.info(f"Parsing evaluation reports from {report_base}")

        instance_results: List[EvalInstanceResult] = []

        for instance_dir in sorted(report_base.iterdir()):
            if not instance_dir.is_dir():
                continue

            instance_id = instance_dir.name
            report_file = instance_dir / "report.json"

            if not report_file.exists():
                logger.warning(f"No report.json for {instance_id}")
                instance_results.append(EvalInstanceResult(
                    instance_id=instance_id,
                    resolved=False,
                    patch_applied=False,
                    error="No report.json found",
                ))
                continue

            try:
                with open(report_file, "r") as f:
                    report = json.load(f)

                if instance_id in report:
                    instance_report = report[instance_id]
                    resolved = instance_report.get("resolved", False)
                    patch_applied = instance_report.get(
                        "patch_successfully_applied", False
                    )
                    tests_status = instance_report.get("tests_status", None)
                else:
                    # Try first key
                    first_key = next(iter(report), None)
                    if first_key:
                        instance_report = report[first_key]
                        resolved = instance_report.get("resolved", False)
                        patch_applied = instance_report.get(
                            "patch_successfully_applied", False
                        )
                        tests_status = instance_report.get("tests_status", None)
                    else:
                        resolved = False
                        patch_applied = False
                        tests_status = None

                instance_results.append(EvalInstanceResult(
                    instance_id=instance_id,
                    resolved=resolved,
                    patch_applied=patch_applied,
                    tests_status=tests_status,
                ))

            except Exception as e:
                logger.error(f"Error parsing report for {instance_id}: {e}")
                instance_results.append(EvalInstanceResult(
                    instance_id=instance_id,
                    resolved=False,
                    patch_applied=False,
                    error=str(e),
                ))

        # Build summary
        total = len(instance_results)
        resolved_count = sum(1 for r in instance_results if r.resolved)
        errored = sum(1 for r in instance_results if r.error)

        # Load dataset for repo mapping
        repo_stats: Dict[str, Dict[str, Any]] = {}
        try:
            from .swebench_dataset import SWEBenchDataset
            ds = SWEBenchDataset(self.config.dataset_name, self.config.split)
            tasks = ds.load()
            repo_map = {t.instance_id: t.repo for t in tasks}

            for r in instance_results:
                repo = repo_map.get(r.instance_id, "unknown")
                if repo not in repo_stats:
                    repo_stats[repo] = {
                        "total": 0, "resolved": 0, "failed": 0, "errored": 0,
                    }
                repo_stats[repo]["total"] += 1
                if r.resolved:
                    repo_stats[repo]["resolved"] += 1
                elif r.error:
                    repo_stats[repo]["errored"] += 1
                else:
                    repo_stats[repo]["failed"] += 1
        except Exception as e:
            logger.warning(f"Could not load dataset for repo stats: {e}")

        resolve_rate = resolved_count / total if total > 0 else 0

        summary = EvalSummary(
            run_id=run_id,
            total_instances=total,
            resolved=resolved_count,
            failed=total - resolved_count - errored,
            errored=errored,
            resolve_rate=round(resolve_rate, 4),
            repo_stats=repo_stats,
        )

        # Save evaluation summary
        eval_summary_file = Path(self.config.output_dir) / run_id / "eval_summary.json"
        with open(eval_summary_file, "w") as f:
            json.dump(summary.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info(f"Evaluation summary saved to {eval_summary_file}")

        # Save detailed instance results
        eval_details_file = Path(self.config.output_dir) / run_id / "eval_details.jsonl"
        with open(eval_details_file, "w") as f:
            for r in instance_results:
                f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")
        logger.info(f"Evaluation details saved to {eval_details_file}")

        return summary

    def _print_eval_summary(self, summary: EvalSummary):
        """Print human-readable evaluation summary."""
        print("\n" + "=" * 70)
        print(f"  SWE-bench Evaluation Summary (Phase 2: Docker)")
        print(f"  Run ID: {summary.run_id}")
        print("=" * 70)
        print(f"  Total instances: {summary.total_instances}")
        print(f"  Resolved:        {summary.resolved}")
        print(f"  Failed:          {summary.failed}")
        print(f"  Errored:         {summary.errored}")
        print(f"  Resolve rate:    {summary.resolve_rate:.2%}")
        print("-" * 70)

        if summary.repo_stats:
            for repo in sorted(summary.repo_stats.keys()):
                stats = summary.repo_stats[repo]
                rr = stats["resolved"] / stats["total"] if stats["total"] > 0 else 0
                print(
                    f"  {repo:<40} "
                    f"{stats['resolved']}/{stats['total']} ({rr:.0%})"
                    f"  [failed={stats['failed']}, errored={stats['errored']}]"
                )

        print("=" * 70 + "\n")
