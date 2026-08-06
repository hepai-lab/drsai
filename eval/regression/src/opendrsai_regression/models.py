from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class RegressionCase:
    id: str
    revision: int
    title: str
    path: str
    data: dict[str, Any]


@dataclass(frozen=True)
class RegressionSuite:
    id: str
    path: str
    cases: tuple[str, ...]
    defaults: dict[str, Any]
    data: dict[str, Any]


@dataclass(frozen=True)
class AssertionResult:
    path: str
    operator: str
    expected: Any
    actual: Any
    passed: bool
    message: str = ""
    critical: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CaseResult:
    execution_id: str
    case_id: str
    case_revision: int
    attempt: int = 1
    status: str = "error"
    run_id: str | None = None
    session_id: str | None = None
    error_category: str | None = None
    error: str | None = None
    output: Any = None
    evidence: dict[str, Any] = field(default_factory=dict)
    assertions: list[dict[str, Any]] = field(default_factory=list)
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float | None = None
    case_snapshot_sha256: str | None = None
    schema_version: str = "opendrsai.agent-regression-result/1"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
