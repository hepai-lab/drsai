"""
GAIA Dataset Loader

Loads the GAIA benchmark dataset from local files downloaded from HuggingFace.
Supports both parquet and JSON formats.

Expected dataset structure (after downloading from HuggingFace):
    dataset_path/
    ├── validation/
    │   ├── metadata.parquet   (or metadata.json)
    │   ├── file_name_column_contains_filenames
    │   └── <attached files...>   (images, PDFs, spreadsheets, etc.)

GAIA dataset fields (from HuggingFace):
    - task_id: Unique identifier (e.g. "d04c8e08-5a31-4f3e-9a23...')
    - Question: The question text
    - Level: Difficulty level (1, 2, or 3)
    - Final Answer: Ground truth answer
    - file_name: Name of attached file (if any), or empty string
    - file_path: Path to the attached file
    - Annotator: Metadata about who annotated the question
"""

import json
import pandas as pd
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, List
from loguru import logger


@dataclass
class GAIATask:
    """A single GAIA task."""
    task_id: str
    question: str
    level: int
    final_answer: str
    file_name: str
    file_path: str
    annotator: str

    @property
    def has_file(self) -> bool:
        return bool(self.file_name and self.file_name.strip())

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "question": self.question,
            "level": self.level,
            "final_answer": self.final_answer,
            "file_name": self.file_name,
            "file_path": str(self.file_path),
            "annotator": self.annotator,
        }


class GAIADataset:
    """Loader for the GAIA benchmark dataset."""

    def __init__(self, validation_dir: str | Path):
        self.validation_dir = Path(validation_dir)
        self._tasks: List[GAIATask] = []
        self._loaded = False

    def _try_read_parquet(self, path: Path) -> pd.DataFrame | None:
        """Try to read a parquet file, return None if pyarrow/fastparquet not installed."""
        try:
            import pyarrow  # noqa: F401 — ensure pyarrow is importable
            return pd.read_parquet(path)
        except ImportError:
            logger.warning(
                "pyarrow is not installed. Cannot read parquet files. "
                "Install it with: pip install pyarrow"
            )
            return None

    def _try_read_json(self, path: Path) -> pd.DataFrame | None:
        """Try to read a JSON file."""
        try:
            with open(path, "r") as f:
                data = json.load(f)
            # Handle both list-of-dicts (standard) and dict-of-dicts (HF) formats
            if isinstance(data, dict):
                # HF format: {"0": {"task_id": "...", ...}, ...}
                return pd.DataFrame(list(data.values()))
            return pd.DataFrame(data)
        except Exception as e:
            logger.warning(f"Failed to read JSON file {path}: {e}")
            return None

    def load(self) -> List[GAIATask]:
        """Load the validation split from local files."""
        if self._loaded:
            return self._tasks

        # Try parquet first, then JSON
        parquet_path = self.validation_dir / "metadata.parquet"
        json_path = self.validation_dir / "metadata.json"

        df = None
        if parquet_path.exists():
            df = self._try_read_parquet(parquet_path)

        if df is None and json_path.exists():
            logger.info(f"Falling back to JSON: {json_path}")
            df = self._try_read_json(json_path)

        if df is None:
            # Try loading from the HuggingFace datasets library format
            # The HF dataset might have the data in a different structure
            # Let's search for any parquet or json file in validation dir
            parquet_files = list(self.validation_dir.glob("*.parquet"))
            json_files = list(self.validation_dir.glob("*.json"))

            for pf in parquet_files:
                df = self._try_read_parquet(pf)
                if df is not None:
                    logger.info(f"Loaded GAIA dataset from {pf}")
                    break

            if df is None:
                for jf in json_files:
                    df = self._try_read_json(jf)
                    if df is not None:
                        logger.info(f"Loaded GAIA dataset from {jf}")
                        break

        if df is None:
            raise FileNotFoundError(
                f"No metadata file found in {self.validation_dir}. "
                f"Expected metadata.parquet or metadata.json. "
                f"Please download the GAIA dataset from "
                f"https://huggingface.co/datasets/gaia-benchmark/GAIA\n\n"
                f"After downloading, ensure the dataset directory looks like:\n"
                f"  {self.validation_dir}/\n"
                f"  ├── metadata.parquet\n"
                f"  └── ... (attached files)\n\n"
                f"If you already downloaded the dataset, make sure pyarrow is installed:\n"
                f"  pip install pyarrow"
            )

        logger.info(f"Loaded {len(df)} tasks from GAIA dataset")
        logger.info(f"Columns: {list(df.columns)}")

        for _, row in df.iterrows():
            task = self._parse_row(row)
            self._tasks.append(task)

        self._loaded = True
        logger.info(
            f"Parsed {len(self._tasks)} GAIA tasks. "
            f"Level 1: {sum(1 for t in self._tasks if t.level == 1)}, "
            f"Level 2: {sum(1 for t in self._tasks if t.level == 2)}, "
            f"Level 3: {sum(1 for t in self._tasks if t.level == 3)}"
        )
        return self._tasks

    def _parse_row(self, row: pd.Series) -> GAIATask:
        """Parse a dataset row into a GAIATask.

        Handles different column naming conventions that might exist
        in different versions of the GAIA dataset.
        """
        # Handle different column name conventions
        task_id = str(row.get("task_id", row.get("Task ID", "")))
        question = str(row.get("Question", row.get("question", "")))
        level = int(row.get("Level", row.get("level", 1)))
        final_answer = str(row.get("Final answer", row.get("final_answer", row.get("Final Answer", ""))))

        # file_name and file_path
        file_name = str(row.get("file_name", row.get("File Name", "")))
        file_path = str(row.get("file_path", row.get("File Path", "")))

        # If file_path is empty but file_name exists, construct path
        if file_name and file_name.strip() and not file_path:
            file_path = str(self.validation_dir / file_name)

        annotator = str(row.get("Annotator", row.get("annotator", "")))

        # Handle NaN values
        if file_name == "nan":
            file_name = ""
        if file_path == "nan":
            file_path = ""

        return GAIATask(
            task_id=task_id,
            question=question,
            level=level,
            final_answer=final_answer,
            file_name=file_name,
            file_path=file_path,
            annotator=annotator,
        )

    def filter(
        self,
        levels: Optional[List[int]] = None,
        task_ids: Optional[List[str]] = None,
    ) -> List[GAIATask]:
        """Filter tasks by level and/or task IDs."""
        tasks = self.load()

        if levels:
            tasks = [t for t in tasks if t.level in levels]

        if task_ids:
            tasks = [t for t in tasks if t.task_id in task_ids]

        logger.info(f"Filtered to {len(tasks)} tasks (levels={levels}, task_ids={task_ids})")
        return tasks

    def get_task(self, task_id: str) -> Optional[GAIATask]:
        """Get a single task by ID."""
        tasks = self.load()
        for t in tasks:
            if t.task_id == task_id:
                return t
        return None

    def __len__(self) -> int:
        return len(self.load())

    def __iter__(self):
        return iter(self.load())
