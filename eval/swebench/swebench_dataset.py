"""
SWE-bench Dataset Loader

Loads SWE-bench instances from HuggingFace datasets or local JSON/JSONL files.

SWE-bench dataset fields:
    - repo: GitHub repo name (e.g. "astropy/astropy")
    - instance_id: Unique identifier (e.g. "astropy__astropy-12907")
    - base_commit: The commit to checkout before applying the fix
    - patch: Gold patch (the correct fix - NOT given to the agent)
    - test_patch: Test patch (applied during evaluation only)
    - problem_statement: The GitHub issue text
    - hints_text: Optional hints from the issue
    - created_at: Issue creation timestamp
    - version: Project version
    - FAIL_TO_PASS: Tests that should pass after the fix (JSON string)
    - PASS_TO_PASS: Tests that should still pass after the fix (JSON string)
    - environment_setup_commit: Commit for environment setup
"""

import json
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, List
from loguru import logger


@dataclass
class SWEBenchTask:
    """A single SWE-bench instance."""
    instance_id: str
    repo: str
    base_commit: str
    problem_statement: str
    hints_text: str
    patch: str  # Gold patch (for reference, NOT given to agent)
    test_patch: str  # Test patch (applied during Docker evaluation)
    fail_to_pass: List[str]  # Tests that should pass after fix
    pass_to_pass: List[str]  # Tests that should still pass after fix
    version: str
    created_at: str
    environment_setup_commit: str

    def to_dict(self) -> dict:
        return {
            "instance_id": self.instance_id,
            "repo": self.repo,
            "base_commit": self.base_commit,
            "problem_statement": self.problem_statement,
            "hints_text": self.hints_text,
            "patch": self.patch,
            "test_patch": self.test_patch,
            "fail_to_pass": self.fail_to_pass,
            "pass_to_pass": self.pass_to_pass,
            "version": self.version,
            "created_at": self.created_at,
            "environment_setup_commit": self.environment_setup_commit,
        }


class SWEBenchDataset:
    """Loader for SWE-bench datasets."""

    def __init__(self, dataset_name: str = "princeton-nlp/SWE-bench_Lite",
                 split: str = "test"):
        """
        Args:
            dataset_name: HuggingFace dataset name or local file path (.json/.jsonl).
            split: Dataset split ("test" or "dev").
        """
        self.dataset_name = dataset_name
        self.split = split
        self._tasks: List[SWEBenchTask] = []
        self._loaded = False

    def load(self) -> List[SWEBenchTask]:
        """Load the dataset from HuggingFace or local file."""
        if self._loaded:
            return self._tasks

        if self.dataset_name.endswith(".json") or self.dataset_name.endswith(".jsonl"):
            self._load_from_file(self.dataset_name)
        else:
            self._load_from_huggingface()

        self._loaded = True
        logger.info(f"Loaded {len(self._tasks)} SWE-bench instances "
                     f"from {self.dataset_name} (split={self.split})")
        return self._tasks

    def _load_from_huggingface(self):
        """Load from HuggingFace datasets library."""
        try:
            from datasets import load_dataset
        except ImportError:
            raise ImportError(
                "datasets library not installed. Install with: pip install datasets"
            )

        logger.info(f"Loading SWE-bench dataset: {self.dataset_name} [{self.split}]")
        ds = load_dataset(self.dataset_name, split=self.split)

        for row in ds:
            self._tasks.append(self._row_to_task(row))

    def _load_from_file(self, path: str):
        """Load from local JSON or JSONL file."""
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Dataset file not found: {path}")

        if path.suffix == ".json":
            with open(path, "r") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    data = list(data.values())
        elif path.suffix == ".jsonl":
            data = []
            with open(path, "r") as f:
                for line in f:
                    data.append(json.loads(line))
        else:
            raise ValueError(f"Unsupported file format: {path.suffix}")

        for row in data:
            self._tasks.append(self._row_to_task(row))

    @staticmethod
    def _row_to_task(row: dict) -> SWEBenchTask:
        """Convert a dataset row to a SWEBenchTask."""
        # FAIL_TO_PASS and PASS_TO_PASS are stored as JSON strings in the dataset
        fail_to_pass = row.get("FAIL_TO_PASS", "[]")
        pass_to_pass = row.get("PASS_TO_PASS", "[]")

        if isinstance(fail_to_pass, str):
            fail_to_pass = json.loads(fail_to_pass)
        if isinstance(pass_to_pass, str):
            pass_to_pass = json.loads(pass_to_pass)

        return SWEBenchTask(
            instance_id=row["instance_id"],
            repo=row["repo"],
            base_commit=row["base_commit"],
            problem_statement=row["problem_statement"],
            hints_text=row.get("hints_text", ""),
            patch=row.get("patch", ""),
            test_patch=row.get("test_patch", ""),
            fail_to_pass=fail_to_pass,
            pass_to_pass=pass_to_pass,
            version=row.get("version", ""),
            created_at=row.get("created_at", ""),
            environment_setup_commit=row.get("environment_setup_commit", ""),
        )

    def filter(
        self,
        instance_ids: Optional[list] = None,
        repos: Optional[list] = None,
    ) -> List[SWEBenchTask]:
        """Filter tasks by instance IDs or repo names."""
        tasks = self.load()

        if instance_ids:
            id_set = set(instance_ids)
            tasks = [t for t in tasks if t.instance_id in id_set]

        if repos:
            repo_set = set(repos)
            tasks = [t for t in tasks if t.repo in repo_set]

        return tasks

    def get_repos(self) -> List[str]:
        """Get list of unique repos in the dataset."""
        tasks = self.load()
        return sorted(set(t.repo for t in tasks))

    def get_instance(self, instance_id: str) -> Optional[SWEBenchTask]:
        """Get a single instance by ID."""
        tasks = self.load()
        for t in tasks:
            if t.instance_id == instance_id:
                return t
        return None
