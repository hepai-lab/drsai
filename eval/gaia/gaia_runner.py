"""
GAIA Evaluation Runner

The main test runner that:
1. Loads the GAIA dataset
2. Creates DrSaiAssistant instances via create_agent()
3. Sends each question to the agent
4. Collects responses and evaluates answers
5. Saves results and generates summary statistics

Usage:
    python -m eval.gaia.run_gaia --levels 1 --model hepai/deepseek-v4-flash

    # Or programmatically:
    from eval.gaia import GAIARunner, GAIAConfig
    runner = GAIARunner(GAIAConfig(levels=[1]))
    asyncio.run(runner.run())
"""

import asyncio
import json
import time
import uuid
import traceback
import shutil
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any

from loguru import logger
from autogen_core import CancellationToken

from .gaia_config import GAIAConfig
from .gaia_dataset import GAIADataset, GAIATask
from .gaia_evaluator import GAIAEvaluator, QuestionSucceeded
from .gaia_prompts import GAIA_SYSTEM_PROMPT, build_gaia_prompt, build_file_info


@dataclass
class TaskResult:
    """Result of running a single GAIA task."""
    task_id: str
    level: int
    question: str
    ground_truth: str
    predicted_answer: str
    success: bool
    reason: str
    raw_response: str
    duration_sec: float
    error: Optional[str] = None
    num_tool_calls: int = 0
    timestamp: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class RunSummary:
    """Summary statistics for a GAIA evaluation run."""
    run_id: str
    model_name: str
    timestamp: str
    total_tasks: int
    completed: int
    succeeded: int
    failed: int
    errored: int
    accuracy: float
    duration_sec: float
    level_stats: Dict[int, Dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class GAIARunner:
    """Main runner for GAIA benchmark evaluation of DrSaiAssistant."""

    def __init__(self, config: GAIAConfig):
        self.config = config
        self.dataset = GAIADataset(config.validation_dir)
        self.evaluator = GAIAEvaluator()

        # ── Resume / checkpoint-restart logic ──────────────────────────
        # When resume is enabled, reuse the previous run directory (and its
        # results.jsonl) instead of creating a new timestamped one.
        self._resume_mode = False
        resume = config.resume
        if resume:
            if isinstance(resume, str):
                # Resume from a specific run_id
                prev_run_dir = Path(config.output_dir) / resume
            else:
                # Auto-find the latest run directory
                prev_run_dir = self._find_latest_run_dir(config.output_dir)

            if prev_run_dir and prev_run_dir.is_dir():
                self._resume_mode = True
                self.run_id = prev_run_dir.name
                logger.info(
                    f"🔄 Resume mode: reusing run directory {prev_run_dir} "
                    f"(run_id={self.run_id})"
                )
            else:
                logger.info(
                    f"Resume requested but no previous run found under "
                    f"{config.output_dir}; starting a fresh run."
                )

        if not self._resume_mode:
            self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

        self.run_dir = Path(config.output_dir) / self.run_id
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.results_file = self.run_dir / "results.jsonl"
        self.summary_file = self.run_dir / "summary.json"
        self.logs_dir = self.run_dir / "logs"
        self.logs_dir.mkdir(exist_ok=True)

        # ── Database for agent model context ──────────────────────────
        # A single SQLite DB is created per run and shared across all
        # concurrent tasks.  Each task gets its own thread_id so messages
        # are isolated within the same DB file.
        self._db_manager = self._init_database()

        # Track completed task IDs for resume support
        self._completed_task_ids: set = set()
        self._load_completed()

    @staticmethod
    def _find_latest_run_dir(output_dir: str | Path) -> Path | None:
        """Find the most recent run directory under ``output_dir``.

        Looks for subdirectories whose names match the timestamp pattern
        ``YYYYMMDD_HHMMSS`` and returns the one with the latest mtime
        (or lexicographically largest name).
        """
        import re
        output_dir = Path(output_dir)
        if not output_dir.is_dir():
            return None

        pattern = re.compile(r"^\d{8}_\d{6}$")
        candidates = []
        for child in output_dir.iterdir():
            if child.is_dir() and pattern.match(child.name):
                # Only consider directories that have a results.jsonl
                if (child / "results.jsonl").exists():
                    candidates.append(child)

        if not candidates:
            return None

        # Sort by directory name (timestamp) descending → latest first
        candidates.sort(key=lambda p: p.name, reverse=True)
        return candidates[0]

    def _init_database(self):
        """Create and initialise a DatabaseManager for this evaluation run.

        The database file lives inside the run output directory by default,
        so it is automatically cleaned up when the user deletes the run
        folder.  An explicit ``config.db_path`` overrides this location.

        If the ``db_path`` points to an existing **directory** (e.g. the user
        forgot the ``.db`` extension), a ``gaia_eval.db`` file is created
        *inside* that directory instead.
        """
        from drsai.modules.managers.database import DatabaseManager

        db_path = self.config.db_path or str(self.run_dir / "gaia_eval.db")
        db_path = Path(db_path)

        # If the path is an existing directory, create the DB file inside it.
        if db_path.is_dir():
            db_path = db_path / "gaia_eval.db"

        # Use a per-model subdirectory as base_dir to avoid alembic conflicts
        # when multiple evaluations (e.g. flash + pro) run concurrently.
        # e.g. /path/to/gaia_eval/  →  /path/to/gaia_eval/<model_slug>/
        model_slug = self.config.model_name.replace("/", "_").replace(".", "-")
        db_dir = str(db_path.parent / model_slug)
        Path(db_dir).mkdir(parents=True, exist_ok=True)

        db_path_str = str(db_path)
        engine_uri = f"sqlite:///{db_path_str}"

        logger.info(f"Initialising evaluation database: {db_path_str}")
        db_manager = DatabaseManager(
            engine_uri=engine_uri,
            base_dir=db_dir,
        )
        init_resp = db_manager.initialize_database(auto_upgrade=False)
        if not init_resp.status:
            raise RuntimeError(
                f"Failed to initialise evaluation database: {init_resp.message}"
            )
        logger.info("Evaluation database ready.")
        return db_manager

    def _load_completed(self):
        """Load previously completed task IDs for resume support."""
        if self.results_file.exists():
            with open(self.results_file, "r") as f:
                for line in f:
                    try:
                        result = json.loads(line)
                        self._completed_task_ids.add(result["task_id"])
                    except json.JSONDecodeError:
                        pass
            if self._completed_task_ids:
                logger.info(
                    f"🔄 Loaded {len(self._completed_task_ids)} previously "
                    f"completed tasks from {self.results_file}"
                )
            else:
                logger.info(f"No completed tasks found in {self.results_file}")

    def _save_result(self, result: TaskResult):
        """Save a single task result (append mode)."""
        with open(self.results_file, "a") as f:
            f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")

    def _save_task_log(self, task: GAIATask, events: List[dict]):
        """Save detailed event log for a task."""
        log_file = self.logs_dir / f"{task.task_id}.json"
        with open(log_file, "w") as f:
            json.dump({
                "task_id": task.task_id,
                "question": task.question,
                "level": task.level,
                "ground_truth": task.final_answer,
                "events": events,
            }, f, ensure_ascii=False, indent=2)

    async def _run_single_task(
        self,
        task: GAIATask,
        agent_factory: callable,
        semaphore: asyncio.Semaphore,
    ) -> TaskResult:
        """Run a single GAIA task through the DrSaiAssistant agent.

        Creates a fresh agent instance for each task to ensure isolation.
        """
        start_time = time.time()
        events: List[dict] = []
        raw_response = ""
        num_tool_calls = 0
        error = None

        # Build the prompt
        file_info = ""
        if task.has_file:
            file_info = build_file_info(task.file_name, task.file_path)

        prompt = build_gaia_prompt(task.question, file_info)

        # Generate unique thread ID for this task
        thread_id = f"gaia_{task.task_id}_{uuid.uuid4().hex[:8]}"

        async with semaphore:
            logger.info(f"[{task.task_id}] Starting task (Level {task.level})")
            agent = None
            try:
                # Create agent instance
                # NOTE: Only pass api_key if it's set, otherwise let the underlying
                # HepAIChatCompletionClient fall back to the HEPAI_API_KEY env var.
                # Passing None explicitly would bypass the fallback check
                # (which uses: if "api_key" not in kwargs: kwargs["api_key"] = os.environ.get("HEPAI_API_KEY"))
                agent_kwargs = {
                    "thread_id": thread_id,
                    "user_id": f"gaia_eval",
                    "defult_config_name": self.config.model_name,
                    "db_manager": self._db_manager,
                }
                if self.config.api_key is not None:
                    agent_kwargs["api_key"] = self.config.api_key
                agent = agent_factory(**agent_kwargs)

                # Inject GAIA system prompt if the agent supports it
                # DrSaiAssistant uses its default system message if None,
                # but we can prepend our GAIA instructions via the prompt
                cancellation_token = CancellationToken()

                # Run the agent
                timeout = self.config.per_task_timeout
                try:
                    async for message in agent.run_stream(
                        task=prompt,
                        cancellation_token=cancellation_token,
                    ):
                        event_record = self._record_event(message)
                        if event_record:
                            events.append(event_record)

                            # Count tool calls
                            if "tool_call" in event_record.get("type", "").lower():
                                num_tool_calls += 1

                            # Collect final response
                            if event_record.get("type") == "TextMessage":
                                if event_record.get("source") != "user":
                                    raw_response = event_record.get("content", "")
                except asyncio.TimeoutError:
                    error = f"Task timed out after {timeout}s"
                    logger.warning(f"[{task.task_id}] {error}")
                except Exception as e:
                    error = f"Agent error: {e}"
                    logger.error(f"[{task.task_id}] {error}\n{traceback.format_exc()}")

                # Extract the final response
                if not raw_response:
                    # Try to extract from events
                    for ev in reversed(events):
                        if ev.get("type") == "TextMessage" and ev.get("source") != "user":
                            raw_response = ev.get("content", "")
                            break

                # Evaluate the answer
                eval_result = self.evaluator.evaluate(
                    task_id=task.task_id,
                    raw_response=raw_response,
                    ground_truth=task.final_answer,
                )

                duration = time.time() - start_time
                result = TaskResult(
                    task_id=task.task_id,
                    level=task.level,
                    question=task.question,
                    ground_truth=task.final_answer,
                    predicted_answer=eval_result.predicted_answer,
                    success=eval_result.success,
                    reason=eval_result.reason,
                    raw_response=raw_response,
                    duration_sec=round(duration, 2),
                    error=error,
                    num_tool_calls=num_tool_calls,
                    timestamp=datetime.now().isoformat(),
                )

                # Save results
                if self.config.save_intermediate:
                    self._save_result(result)
                self._save_task_log(task, events)

                status = "✓" if result.success else "✗"
                logger.info(
                    f"[{task.task_id}] {status} Level {task.level} "
                    f"({duration:.1f}s) | Predicted: '{result.predicted_answer}' | "
                    f"GT: '{result.ground_truth}'"
                )

                return result

            except Exception as e:
                error = f"Task setup error: {e}"
                logger.error(f"[{task.task_id}] {error}\n{traceback.format_exc()}")
                duration = time.time() - start_time
                return TaskResult(
                    task_id=task.task_id,
                    level=task.level,
                    question=task.question,
                    ground_truth=task.final_answer,
                    predicted_answer="",
                    success=False,
                    reason="Setup error",
                    raw_response="",
                    duration_sec=round(duration, 2),
                    error=error,
                    num_tool_calls=0,
                    timestamp=datetime.now().isoformat(),
                )
            finally:
                # Clean up agent
                if agent and hasattr(agent, "close"):
                    try:
                        await agent.close()
                    except Exception:
                        pass

    def _record_event(self, message) -> Optional[dict]:
        """Record an agent event as a serializable dict."""
        try:
            from drsai.modules.managers.messages import (
                TextMessage,
                ToolCallRequestEvent,
                ToolCallExecutionEvent,
                ModelClientStreamingChunkEvent,
                ThoughtEvent,
            )

            if isinstance(message, TextMessage):
                return {
                    "type": "TextMessage",
                    "source": message.source,
                    "content": message.content,
                }
            elif isinstance(message, ToolCallRequestEvent):
                return {
                    "type": "ToolCallRequestEvent",
                    "source": message.source,
                    "content": str(message.content),
                }
            elif isinstance(message, ToolCallExecutionEvent):
                return {
                    "type": "ToolCallExecutionEvent",
                    "source": message.source,
                    "content": str(message.content),
                }
            elif isinstance(message, ThoughtEvent):
                return {
                    "type": "ThoughtEvent",
                    "source": message.source,
                    "content": message.content,
                }
            elif isinstance(message, ModelClientStreamingChunkEvent):
                return None  # Skip streaming chunks to save space
            else:
                # Try to get useful info from unknown message types
                return {
                    "type": type(message).__name__,
                    "source": getattr(message, "source", "unknown"),
                    "content": str(getattr(message, "content", "")),
                }
        except Exception as e:
            logger.debug(f"Failed to record event: {e}")
            return None

    async def run(self, agent_factory: Optional[callable] = None):
        """Run the GAIA evaluation.

        Args:
            agent_factory: The create_agent function from run_drsai_agent.py.
                          If None, imports it automatically.
        """
        logger.info(f"=== GAIA Evaluation Run {self.run_id} ===")
        logger.info(f"Model: {self.config.model_name}")
        logger.info(f"Levels: {self.config.levels}")
        logger.info(f"Max concurrent: {self.config.max_concurrent}")
        logger.info(f"Output: {self.run_dir}")

        # Import agent factory if not provided
        if agent_factory is None:
            agent_factory = self._get_default_agent_factory()

        # Load and filter tasks
        tasks = self.dataset.filter(
            levels=self.config.levels,
            task_ids=self.config.task_ids,
        )
        logger.info(f"Total tasks to run: {len(tasks)}")

        if not tasks:
            logger.error("No tasks to run! Check dataset path and filters.")
            return

        # Filter out already completed tasks (resume support)
        pending_tasks = [t for t in tasks if t.task_id not in self._completed_task_ids]
        if len(pending_tasks) < len(tasks):
            logger.info(
                f"Resuming: {len(self._completed_task_ids)} already completed, "
                f"{len(pending_tasks)} pending"
            )

        # Run tasks with concurrency control
        semaphore = asyncio.Semaphore(self.config.max_concurrent)
        start_time = time.time()

        tasks_coroutines = [
            self._run_single_task(task, agent_factory, semaphore)
            for task in pending_tasks
        ]

        results: List[TaskResult] = []
        for coro in asyncio.as_completed(tasks_coroutines):
            result = await coro
            results.append(result)

        total_duration = time.time() - start_time

        # Load all results (including previously completed)
        all_results = self._load_all_results()

        # Generate summary
        summary = self._generate_summary(all_results, total_duration)
        self._save_summary(summary)

        # Print summary
        self._print_summary(summary)

        # Close the evaluation database
        await self._close_database()

        return summary

    async def _close_database(self):
        """Dispose the evaluation database engine after the run completes."""
        if self._db_manager is not None:
            try:
                await self._db_manager.close()
                logger.info("Evaluation database closed.")
            except Exception as e:
                logger.warning(f"Error closing evaluation database: {e}")

    def _get_default_agent_factory(self) -> callable:
        """Import the create_agent function from run_drsai_agent.py."""
        import sys
        # Add the project root to sys.path if needed
        project_root = str(Path(__file__).parent.parent.parent)
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        from run_drsai_agent import create_agent
        return create_agent

    def _load_all_results(self) -> List[TaskResult]:
        """Load all results from the results file."""
        results = []
        if self.results_file.exists():
            with open(self.results_file, "r") as f:
                for line in f:
                    try:
                        data = json.loads(line)
                        results.append(TaskResult(**data))
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.warning(f"Failed to parse result: {e}")
        return results

    def _generate_summary(
        self,
        results: List[TaskResult],
        duration: float,
    ) -> RunSummary:
        """Generate summary statistics from results."""
        level_stats: Dict[int, Dict[str, Any]] = {}

        for r in results:
            if r.level not in level_stats:
                level_stats[r.level] = {
                    "total": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "errored": 0,
                }
            level_stats[r.level]["total"] += 1
            if r.success:
                level_stats[r.level]["succeeded"] += 1
            elif r.error:
                level_stats[r.level]["errored"] += 1
            else:
                level_stats[r.level]["failed"] += 1

        # Calculate per-level accuracy
        for level, stats in level_stats.items():
            stats["accuracy"] = round(
                stats["succeeded"] / stats["total"] if stats["total"] > 0 else 0, 4
            )

        total = len(results)
        succeeded = sum(1 for r in results if r.success)
        errored = sum(1 for r in results if r.error)
        failed = total - succeeded - errored

        return RunSummary(
            run_id=self.run_id,
            model_name=self.config.model_name,
            timestamp=datetime.now().isoformat(),
            total_tasks=total,
            completed=total,
            succeeded=succeeded,
            failed=failed,
            errored=errored,
            accuracy=round(succeeded / total if total > 0 else 0, 4),
            duration_sec=round(duration, 2),
            level_stats=level_stats,
        )

    def _save_summary(self, summary: RunSummary):
        """Save summary to JSON file."""
        with open(self.summary_file, "w") as f:
            json.dump(summary.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info(f"Summary saved to {self.summary_file}")

    def _print_summary(self, summary: RunSummary):
        """Print a human-readable summary."""
        print("\n" + "=" * 60)
        print(f"  GAIA Evaluation Summary")
        print(f"  Run ID: {summary.run_id}")
        print(f"  Model: {summary.model_name}")
        print(f"  Date: {summary.timestamp}")
        print("=" * 60)
        print(f"  Total tasks:    {summary.total_tasks}")
        print(f"  Succeeded:      {summary.succeeded}")
        print(f"  Failed:         {summary.failed}")
        print(f"  Errored:        {summary.errored}")
        print(f"  Accuracy:       {summary.accuracy:.2%}")
        print(f"  Duration:       {summary.duration_sec:.1f}s")
        print("-" * 60)

        for level in sorted(summary.level_stats.keys()):
            stats = summary.level_stats[level]
            print(
                f"  Level {level}: {stats['succeeded']}/{stats['total']} "
                f"({stats['accuracy']:.2%})"
                f"  [failed={stats['failed']}, errored={stats['errored']}]"
            )

        print("=" * 60)
        print(f"  Results:  {self.results_file}")
        print(f"  Summary:  {self.summary_file}")
        print(f"  Logs:     {self.logs_dir}")
        print("=" * 60 + "\n")
