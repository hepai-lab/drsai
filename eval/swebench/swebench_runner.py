"""
SWE-bench Evaluation Runner (Phase 1: Inference)

The main runner that:
1. Loads the SWE-bench dataset
2. For each instance:
   a. Prepares a local repo checkout at base_commit
   b. Creates a DrSaiAssistant agent instance
   c. Sends the problem_statement to the agent
   d. Agent explores the code, makes edits, runs tests
   e. Extracts the diff (model_patch) from the repo
3. Saves predictions in SWE-bench format (predictions.jsonl)
4. Generates summary statistics

Key differences from GAIA runner:
- Tasks involve code modification, not Q&A
- Output is a git diff (patch), not a text answer
- Repo management (clone, checkout, worktree) is required
- Evaluation is done separately via Docker (Phase 2)

Usage:
    python -m eval.swebench.run_swebench --dataset princeton-nlp/SWE-bench_Lite

    # Or programmatically:
    from eval.swebench import SWEBenchRunner, SWEBenchConfig
    runner = SWEBenchRunner(SWEBenchConfig())
    asyncio.run(runner.run())
"""

import asyncio
import json
import time
import uuid
import traceback
import shutil
import subprocess
import os
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any

from loguru import logger
from autogen_core import CancellationToken

from .swebench_config import SWEBenchConfig
from .swebench_dataset import SWEBenchDataset, SWEBenchTask
from .swebench_prompts import SWEBENCH_SYSTEM_PROMPT, build_swebench_prompt


# ─── Data Classes ────────────────────────────────────────────────────────

@dataclass
class SWEBenchTaskResult:
    """Result of running a single SWE-bench instance through the agent."""
    instance_id: str
    repo: str
    base_commit: str
    problem_statement: str  # truncated for storage
    model_patch: str
    raw_response: str
    duration_sec: float
    error: Optional[str] = None
    num_tool_calls: int = 0
    has_patch: bool = False
    timestamp: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def to_prediction(self, model_name: str) -> dict:
        """Convert to SWE-bench prediction format."""
        return {
            "instance_id": self.instance_id,
            "model_name_or_path": model_name,
            "model_patch": self.model_patch,
        }


@dataclass
class SWEBenchRunSummary:
    """Summary statistics for a SWE-bench evaluation run."""
    run_id: str
    model_name: str
    timestamp: str
    total_tasks: int
    completed: int
    with_patch: int  # How many produced a non-empty patch
    no_patch: int  # How many produced no patch
    errored: int
    duration_sec: float
    repo_stats: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ─── Repo Manager ────────────────────────────────────────────────────────

class RepoManager:
    """Manages local Git repository checkouts for SWE-bench instances.

    - Clones each repo once into a cache directory.
    - For each instance, creates a local clone from the cache and checks out
      the specific base_commit.
    - Extracts diffs from the working tree after the agent makes edits.
    """

    def __init__(self, cache_dir: str):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.worktrees_dir = self.cache_dir / "worktrees"
        self.worktrees_dir.mkdir(exist_ok=True)
        self._clone_locks: Dict[str, asyncio.Lock] = {}

    def _get_clone_lock(self, repo: str) -> asyncio.Lock:
        """Get or create a lock for cloning a specific repo."""
        if repo not in self._clone_locks:
            self._clone_locks[repo] = asyncio.Lock()
        return self._clone_locks[repo]

    async def prepare_repo(
        self,
        repo: str,
        base_commit: str,
        instance_id: str,
    ) -> Path:
        """Prepare a local repo checkout at the given base_commit.

        Returns the path to the working directory.
        """
        cache_key = repo.replace("/", "_")
        cache_path = self.cache_dir / cache_key
        work_path = self.worktrees_dir / instance_id

        # Clone the cache repo if not already done (with lock per repo)
        lock = self._get_clone_lock(repo)
        async with lock:
            if not cache_path.exists():
                await self._clone_repo(repo, cache_path)

        # Create a working clone from the cache
        if work_path.exists():
            shutil.rmtree(work_path)

        def _make_clone():
            result = subprocess.run(
                ["git", "clone", "--local", str(cache_path), str(work_path)],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"Failed to clone {repo} from cache: {result.stderr}"
                )
        await asyncio.to_thread(_make_clone)

        # Ensure the base_commit exists (fetch if needed)
        await self._ensure_commit(work_path, base_commit, repo)

        # Checkout the base_commit
        def _checkout():
            result = subprocess.run(
                ["git", "checkout", base_commit],
                cwd=work_path,
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"Failed to checkout {base_commit[:12]} in {repo}: {result.stderr}"
                )
            # Clean any leftover untracked files
            subprocess.run(
                ["git", "clean", "-fdx"],
                cwd=work_path,
                capture_output=True, text=True,
            )
        await asyncio.to_thread(_checkout)

        return work_path

    async def _clone_repo(self, repo: str, cache_path: Path):
        """Clone a repo from GitHub into the cache directory."""
        url = f"https://github.com/{repo}.git"
        logger.info(f"📦 Cloning {repo} from GitHub...")

        def _do_clone():
            result = subprocess.run(
                ["git", "clone", url, str(cache_path)],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"Failed to clone {repo}: {result.stderr[:500]}"
                )
        await asyncio.to_thread(_do_clone)
        logger.info(f"✅ Cloned {repo} → {cache_path}")

    async def _ensure_commit(
        self,
        work_path: Path,
        commit: str,
        repo: str,
    ):
        """Ensure the given commit exists in the working clone.

        If the commit doesn't exist (e.g., it's from a PR branch),
        try fetching it from the remote.
        """
        def _check_and_fetch():
            # Check if commit exists
            result = subprocess.run(
                ["git", "cat-file", "-t", commit],
                cwd=work_path,
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                logger.info(f"📥 Fetching commit {commit[:12]} for {repo}...")
                # Add the original GitHub remote and fetch
                url = f"https://github.com/{repo}.git"
                subprocess.run(
                    ["git", "remote", "add", "origin", url],
                    cwd=work_path,
                    capture_output=True, text=True,
                )
                result = subprocess.run(
                    ["git", "fetch", "origin", commit],
                    cwd=work_path,
                    capture_output=True, text=True,
                )
                if result.returncode != 0:
                    # Try fetching all
                    subprocess.run(
                        ["git", "fetch", "--all"],
                        cwd=work_path,
                        capture_output=True, text=True,
                    )
        await asyncio.to_thread(_check_and_fetch)

    def extract_diff(self, work_path: Path, base_commit: str) -> str:
        """Extract the git diff from the working tree after the agent's edits.

        This captures all file changes (modified, added, deleted) made by the agent.
        """
        try:
            # Stage all changes (including new files)
            subprocess.run(
                ["git", "add", "-A"],
                cwd=work_path,
                capture_output=True, text=True,
            )

            # Get diff of staged changes vs HEAD
            result = subprocess.run(
                ["git", "diff", "--cached", "--no-color"],
                cwd=work_path,
                capture_output=True, text=True,
            )
            diff = result.stdout.strip()

            if not diff:
                # Maybe the agent committed changes - diff from base_commit
                result = subprocess.run(
                    ["git", "diff", base_commit, "--no-color"],
                    cwd=work_path,
                    capture_output=True, text=True,
                )
                diff = result.stdout.strip()

            return diff
        except Exception as e:
            logger.error(f"Failed to extract diff: {e}")
            return ""

    def cleanup_worktree(self, work_path: Path):
        """Remove a working directory."""
        try:
            if work_path.exists():
                shutil.rmtree(work_path, ignore_errors=True)
        except Exception as e:
            logger.warning(f"Failed to cleanup worktree {work_path}: {e}")


# ─── Main Runner ──────────────────────────────────────────────────────────

class SWEBenchRunner:
    """Main runner for SWE-bench evaluation of DrSaiAssistant (Phase 1)."""

    def __init__(self, config: SWEBenchConfig):
        self.config = config
        self.dataset = SWEBenchDataset(config.dataset_name, config.split)
        self.repo_manager = RepoManager(config.repo_cache_dir)

        # ── Resume / checkpoint-restart logic ──────────────────────────
        self._resume_mode = False
        resume = config.resume
        if resume:
            if isinstance(resume, str):
                prev_run_dir = Path(config.output_dir) / resume
            else:
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
                    f"Resume requested but no previous run found; starting fresh."
                )

        if not self._resume_mode:
            self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

        self.run_dir = Path(config.output_dir) / self.run_id
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.results_file = self.run_dir / "results.jsonl"
        self.predictions_file = self.run_dir / "predictions.jsonl"
        self.summary_file = self.run_dir / "summary.json"
        self.logs_dir = self.run_dir / "logs"
        self.logs_dir.mkdir(exist_ok=True)

        # ── Database for agent model context ──────────────────────────
        self._db_manager = self._init_database()

        # Track completed task IDs for resume support
        self._completed_task_ids: set = set()
        self._load_completed()

    # ── Setup / Init ──────────────────────────────────────────────────

    @staticmethod
    def _find_latest_run_dir(output_dir: str | Path) -> Path | None:
        """Find the most recent run directory under ``output_dir``."""
        import re
        output_dir = Path(output_dir)
        if not output_dir.is_dir():
            return None

        pattern = re.compile(r"^\d{8}_\d{6}$")
        candidates = []
        for child in output_dir.iterdir():
            if child.is_dir() and pattern.match(child.name):
                if (child / "results.jsonl").exists():
                    candidates.append(child)

        if not candidates:
            return None

        candidates.sort(key=lambda p: p.name, reverse=True)
        return candidates[0]

    def _init_database(self):
        """Create and initialise a DatabaseManager for this evaluation run."""
        from drsai.modules.managers.database import DatabaseManager

        db_path = self.config.db_path or str(self.run_dir / "swebench_eval.db")
        db_path = Path(db_path)

        if db_path.is_dir():
            db_path = db_path / "swebench_eval.db"

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
                        self._completed_task_ids.add(result["instance_id"])
                    except json.JSONDecodeError:
                        pass
            if self._completed_task_ids:
                logger.info(
                    f"🔄 Loaded {len(self._completed_task_ids)} previously "
                    f"completed tasks from {self.results_file}"
                )
            else:
                logger.info(f"No completed tasks found in {self.results_file}")

    # ── Save / Load ───────────────────────────────────────────────────

    def _save_result(self, result: SWEBenchTaskResult):
        """Save a single task result (append mode)."""
        with open(self.results_file, "a") as f:
            f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")

    def _save_prediction(self, result: SWEBenchTaskResult):
        """Append a prediction in SWE-bench format."""
        with open(self.predictions_file, "a") as f:
            pred = result.to_prediction(self.config.model_name)
            f.write(json.dumps(pred, ensure_ascii=False) + "\n")

    def _save_task_log(self, task: SWEBenchTask, events: List[dict]):
        """Save detailed event log for a task."""
        log_file = self.logs_dir / f"{task.instance_id}.json"
        with open(log_file, "w") as f:
            json.dump({
                "instance_id": task.instance_id,
                "repo": task.repo,
                "base_commit": task.base_commit,
                "problem_statement": task.problem_statement[:5000],
                "events": events,
            }, f, ensure_ascii=False, indent=2)

    # ── Event Recording ───────────────────────────────────────────────

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
                return {
                    "type": type(message).__name__,
                    "source": getattr(message, "source", "unknown"),
                    "content": str(getattr(message, "content", "")),
                }
        except Exception as e:
            logger.debug(f"Failed to record event: {e}")
            return None

    # ── Single Task Execution ─────────────────────────────────────────

    async def _run_single_task(
        self,
        task: SWEBenchTask,
        agent_factory: callable,
        semaphore: asyncio.Semaphore,
    ) -> SWEBenchTaskResult:
        """Run a single SWE-bench instance through the DrSaiAssistant agent.

        Flow:
        1. Prepare local repo checkout at base_commit
        2. Create agent instance
        3. Send problem_statement as prompt
        4. Collect agent events
        5. Extract diff from repo (model_patch)
        """
        start_time = time.time()
        events: List[dict] = []
        raw_response = ""
        num_tool_calls = 0
        error = None
        work_path: Optional[Path] = None

        async with semaphore:
            logger.info(f"[{task.instance_id}] Starting task "
                         f"(repo={task.repo}, version={task.version})")
            agent = None
            try:
                # 1. Prepare local repo checkout
                try:
                    work_path = await self.repo_manager.prepare_repo(
                        task.repo, task.base_commit, task.instance_id,
                    )
                    logger.info(f"[{task.instance_id}] Repo ready at {work_path}")
                except Exception as e:
                    error = f"Repo setup error: {e}"
                    logger.error(f"[{task.instance_id}] {error}")
                    duration = time.time() - start_time
                    return SWEBenchTaskResult(
                        instance_id=task.instance_id,
                        repo=task.repo,
                        base_commit=task.base_commit,
                        problem_statement=task.problem_statement[:2000],
                        model_patch="",
                        raw_response="",
                        duration_sec=round(duration, 2),
                        error=error,
                        num_tool_calls=0,
                        has_patch=False,
                        timestamp=datetime.now().isoformat(),
                    )

                # 2. Build the prompt
                prompt = build_swebench_prompt(
                    problem_statement=task.problem_statement,
                    repo_path=str(work_path),
                    hints_text=task.hints_text,
                )

                # 3. Generate unique thread ID for this task
                thread_id = f"swebench_{task.instance_id}_{uuid.uuid4().hex[:8]}"

                # 4. Create agent instance
                agent_kwargs = {
                    "thread_id": thread_id,
                    "user_id": "swebench_eval",
                    "defult_config_name": self.config.model_name,
                    "db_manager": self._db_manager,
                }
                if self.config.api_key is not None:
                    agent_kwargs["api_key"] = self.config.api_key

                agent = agent_factory(**agent_kwargs)
                cancellation_token = CancellationToken()

                # 5. Run the agent with timeout
                timeout = self.config.per_task_timeout
                try:
                    async def _run_agent():
                        nonlocal raw_response, num_tool_calls
                        async for message in agent.run_stream(
                            task=prompt,
                            cancellation_token=cancellation_token,
                        ):
                            event_record = self._record_event(message)
                            if event_record:
                                events.append(event_record)
                                if "tool_call" in event_record.get("type", "").lower():
                                    num_tool_calls += 1
                                if event_record.get("type") == "TextMessage":
                                    if event_record.get("source") != "user":
                                        raw_response = event_record.get("content", "")

                    await asyncio.wait_for(_run_agent(), timeout=timeout)

                except asyncio.TimeoutError:
                    error = f"Task timed out after {timeout}s"
                    logger.warning(f"[{task.instance_id}] {error}")
                except Exception as e:
                    error = f"Agent error: {e}"
                    logger.error(f"[{task.instance_id}] {error}\n{traceback.format_exc()}")

                # Extract final response if not captured
                if not raw_response:
                    for ev in reversed(events):
                        if ev.get("type") == "TextMessage" and ev.get("source") != "user":
                            raw_response = ev.get("content", "")
                            break

                # 6. Extract diff from the repo (model_patch)
                model_patch = ""
                if work_path and work_path.exists():
                    model_patch = self.repo_manager.extract_diff(
                        work_path, task.base_commit,
                    )

                has_patch = bool(model_patch.strip())
                duration = time.time() - start_time

                result = SWEBenchTaskResult(
                    instance_id=task.instance_id,
                    repo=task.repo,
                    base_commit=task.base_commit,
                    problem_statement=task.problem_statement[:2000],
                    model_patch=model_patch,
                    raw_response=raw_response[:10000],  # Truncate for storage
                    duration_sec=round(duration, 2),
                    error=error,
                    num_tool_calls=num_tool_calls,
                    has_patch=has_patch,
                    timestamp=datetime.now().isoformat(),
                )

                # Save results
                if self.config.save_intermediate:
                    self._save_result(result)
                    self._save_prediction(result)
                self._save_task_log(task, events)

                status = "✓" if has_patch else "✗"
                logger.info(
                    f"[{task.instance_id}] {status} "
                    f"({duration:.1f}s, {num_tool_calls} tool calls) | "
                    f"Patch: {'yes' if has_patch else 'NO'}"
                    + (f" | Error: {error}" if error else "")
                )

                return result

            except Exception as e:
                error = f"Task setup error: {e}"
                logger.error(f"[{task.instance_id}] {error}\n{traceback.format_exc()}")
                duration = time.time() - start_time
                return SWEBenchTaskResult(
                    instance_id=task.instance_id,
                    repo=task.repo,
                    base_commit=task.base_commit,
                    problem_statement=task.problem_statement[:2000],
                    model_patch="",
                    raw_response="",
                    duration_sec=round(duration, 2),
                    error=error,
                    num_tool_calls=0,
                    has_patch=False,
                    timestamp=datetime.now().isoformat(),
                )
            finally:
                # Clean up agent
                if agent and hasattr(agent, "close"):
                    try:
                        await agent.close()
                    except Exception:
                        pass
                # Clean up worktree
                if work_path and self.config.clean_repo_after:
                    self.repo_manager.cleanup_worktree(work_path)

    # ── Main Run ──────────────────────────────────────────────────────

    async def run(self, agent_factory: Optional[callable] = None):
        """Run the SWE-bench evaluation (Phase 1: Inference).

        Args:
            agent_factory: The create_agent function from run_drsai_agent.py.
                           If None, imports it automatically.
        """
        logger.info(f"=== SWE-bench Evaluation Run {self.run_id} ===")
        logger.info(f"Model: {self.config.model_name}")
        logger.info(f"Dataset: {self.config.dataset_name} [{self.config.split}]")
        logger.info(f"Max concurrent: {self.config.max_concurrent}")
        logger.info(f"Output: {self.run_dir}")

        # Import agent factory if not provided
        if agent_factory is None:
            agent_factory = self._get_default_agent_factory()

        # Load and filter tasks
        tasks = self.dataset.filter(
            instance_ids=self.config.instance_ids,
            repos=self.config.repos,
        )
        logger.info(f"Total tasks to run: {len(tasks)}")

        if not tasks:
            logger.error("No tasks to run! Check dataset name and filters.")
            return

        # Show repo distribution
        repo_counts: Dict[str, int] = {}
        for t in tasks:
            repo_counts[t.repo] = repo_counts.get(t.repo, 0) + 1
        for repo, count in sorted(repo_counts.items()):
            logger.info(f"  {repo}: {count} instances")

        # Filter out already completed tasks (resume support)
        pending_tasks = [
            t for t in tasks if t.instance_id not in self._completed_task_ids
        ]
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

        results: List[SWEBenchTaskResult] = []
        for coro in asyncio.as_completed(tasks_coroutines):
            result = await coro
            results.append(result)

        total_duration = time.time() - start_time

        # Load all results (including previously completed)
        all_results = self._load_all_results()

        # Generate summary
        summary = self._generate_summary(all_results, total_duration)
        self._save_summary(summary)
        self._print_summary(summary)

        # Close the evaluation database
        await self._close_database()

        # Run Phase 2 evaluation if enabled
        if self.config.run_evaluation:
            logger.info("=" * 60)
            logger.info("Starting Phase 2: SWE-bench Docker Evaluation")
            logger.info("=" * 60)
            evaluator = self._get_evaluator()
            eval_result = await evaluator.evaluate(
                predictions_path=str(self.predictions_file),
                run_id=self.run_id,
            )
            if eval_result:
                logger.info(f"Phase 2 evaluation complete: {eval_result}")

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
        project_root = str(Path(__file__).parent.parent.parent)
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        from run_drsai_agent import create_agent
        return create_agent

    def _get_evaluator(self):
        """Create the SWE-bench evaluator for Phase 2."""
        from .swebench_evaluator import SWEBenchEvaluator
        return SWEBenchEvaluator(self.config)

    def _load_all_results(self) -> List[SWEBenchTaskResult]:
        """Load all results from the results file."""
        results = []
        if self.results_file.exists():
            with open(self.results_file, "r") as f:
                for line in f:
                    try:
                        data = json.loads(line)
                        results.append(SWEBenchTaskResult(**data))
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.warning(f"Failed to parse result: {e}")
        return results

    def _generate_summary(
        self,
        results: List[SWEBenchTaskResult],
        duration: float,
    ) -> SWEBenchRunSummary:
        """Generate summary statistics from results."""
        repo_stats: Dict[str, Dict[str, Any]] = {}

        for r in results:
            if r.repo not in repo_stats:
                repo_stats[r.repo] = {
                    "total": 0,
                    "with_patch": 0,
                    "no_patch": 0,
                    "errored": 0,
                }
            repo_stats[r.repo]["total"] += 1
            if r.has_patch:
                repo_stats[r.repo]["with_patch"] += 1
            elif r.error:
                repo_stats[r.repo]["errored"] += 1
            else:
                repo_stats[r.repo]["no_patch"] += 1

        total = len(results)
        with_patch = sum(1 for r in results if r.has_patch)
        errored = sum(1 for r in results if r.error)
        no_patch = total - with_patch - errored

        return SWEBenchRunSummary(
            run_id=self.run_id,
            model_name=self.config.model_name,
            timestamp=datetime.now().isoformat(),
            total_tasks=total,
            completed=total,
            with_patch=with_patch,
            no_patch=no_patch,
            errored=errored,
            duration_sec=round(duration, 2),
            repo_stats=repo_stats,
        )

    def _save_summary(self, summary: SWEBenchRunSummary):
        """Save summary to JSON file."""
        with open(self.summary_file, "w") as f:
            json.dump(summary.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info(f"Summary saved to {self.summary_file}")

    def _print_summary(self, summary: SWEBenchRunSummary):
        """Print a human-readable summary."""
        print("\n" + "=" * 70)
        print(f"  SWE-bench Evaluation Summary (Phase 1: Inference)")
        print(f"  Run ID: {summary.run_id}")
        print(f"  Model: {summary.model_name}")
        print(f"  Date: {summary.timestamp}")
        print("=" * 70)
        print(f"  Total tasks:    {summary.total_tasks}")
        print(f"  With patch:     {summary.with_patch}")
        print(f"  No patch:       {summary.no_patch}")
        print(f"  Errored:        {summary.errored}")
        patch_rate = summary.with_patch / summary.total_tasks if summary.total_tasks > 0 else 0
        print(f"  Patch rate:     {patch_rate:.2%}")
        print(f"  Duration:       {summary.duration_sec:.1f}s")
        print("-" * 70)

        for repo in sorted(summary.repo_stats.keys()):
            stats = summary.repo_stats[repo]
            pr = stats["with_patch"] / stats["total"] if stats["total"] > 0 else 0
            print(
                f"  {repo:<40} "
                f"{stats['with_patch']}/{stats['total']} ({pr:.0%})"
                f"  [no_patch={stats['no_patch']}, errored={stats['errored']}]"
            )

        print("=" * 70)
        print(f"  Results:     {self.results_file}")
        print(f"  Predictions: {self.predictions_file}")
        print(f"  Summary:     {self.summary_file}")
        print(f"  Logs:        {self.logs_dir}")
        print("=" * 70 + "\n")
