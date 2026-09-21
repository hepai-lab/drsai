"""AST scanner preventing unreviewed host-side effect APIs from spreading."""

from __future__ import annotations

import ast
import json
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable


SENSITIVE_CALLS = frozenset({
    "asyncio.create_subprocess_exec",
    "asyncio.create_subprocess_shell",
    "os.popen",
    "os.spawnl",
    "os.spawnle",
    "os.spawnlp",
    "os.spawnlpe",
    "os.spawnv",
    "os.spawnve",
    "os.spawnvp",
    "os.spawnvpe",
    "os.system",
    "socket.create_connection",
    "socket.socket",
    "subprocess.call",
    "subprocess.check_call",
    "subprocess.check_output",
    "subprocess.Popen",
    "subprocess.run",
    "os.remove",
    "os.rename",
    "os.replace",
    "os.unlink",
})

SENSITIVE_METHODS = frozenset({
    "rename", "rmdir", "unlink", "write_bytes", "write_text",
})
WRITE_OPEN_CALLS = frozenset({"open", "aiofiles.open"})


@dataclass(frozen=True)
class UnsafeCallFinding:
    path: str
    scope: str
    call: str
    line: int

    @property
    def fingerprint(self) -> str:
        return f"{self.path}:{self.scope}:{self.call}"


def _qualified_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _qualified_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""


class _Visitor(ast.NodeVisitor):
    def __init__(self, relative_path: str):
        self.relative_path = relative_path
        self.scopes: list[str] = ["<module>"]
        self.findings: list[UnsafeCallFinding] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.scopes.append(node.name)
        self.generic_visit(node)
        self.scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node: ast.Call) -> None:
        name = _qualified_name(node.func)
        sensitive = name in SENSITIVE_CALLS
        if isinstance(node.func, ast.Attribute) and node.func.attr in SENSITIVE_METHODS:
            sensitive = True
        if name in WRITE_OPEN_CALLS:
            mode_node = None
            if len(node.args) > 1:
                mode_node = node.args[1]
            for keyword in node.keywords:
                if keyword.arg == "mode":
                    mode_node = keyword.value
            mode = mode_node.value if isinstance(mode_node, ast.Constant) and isinstance(mode_node.value, str) else "r"
            sensitive = any(flag in mode for flag in "wax+")
            if sensitive:
                name = f"{name}[write-mode]"
        if sensitive:
            self.findings.append(UnsafeCallFinding(self.relative_path, self.scopes[-1], name, node.lineno))
        self.generic_visit(node)


def scan_python_files(repository_root: Path, files: Iterable[Path]) -> list[UnsafeCallFinding]:
    findings: list[UnsafeCallFinding] = []
    root = repository_root.resolve()
    for file in files:
        resolved = file.resolve()
        relative = resolved.relative_to(root).as_posix()
        visitor = _Visitor(relative)
        visitor.visit(ast.parse(resolved.read_text(encoding="utf-8"), filename=relative))
        findings.extend(visitor.findings)
    return sorted(findings, key=lambda item: (item.path, item.scope, item.call, item.line))


def load_exception_baseline(
    path: Path, *, today: date | None = None,
) -> dict[str, dict[str, object]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Unsafe-call exception baseline must be an object.")
    result: dict[str, dict[str, object]] = {}
    for fingerprint, record in raw.items():
        if (
            not isinstance(fingerprint, str)
            or not isinstance(record, dict)
            or not isinstance(record.get("count"), int)
            or int(record["count"]) < 1
            or not str(record.get("reason") or "").strip()
            or not str(record.get("owner") or "").strip()
            or not str(record.get("expires_on") or "").strip()
        ):
            raise ValueError(f"Unsafe-call exception is incomplete: {fingerprint}")
        try:
            expires_on = date.fromisoformat(str(record["expires_on"]))
        except ValueError as error:
            raise ValueError(f"Unsafe-call exception expiry is invalid: {fingerprint}") from error
        if expires_on < (today or date.today()):
            raise ValueError(f"Unsafe-call exception expired: {fingerprint}")
        result[fingerprint] = record
    return result


def unapproved_findings(
    findings: Iterable[UnsafeCallFinding], baseline: dict[str, dict[str, object]],
) -> list[str]:
    counts = Counter(item.fingerprint for item in findings)
    violations: list[str] = []
    for fingerprint, count in sorted(counts.items()):
        approved = int(baseline.get(fingerprint, {}).get("count", 0))
        if count > approved:
            violations.append(f"{fingerprint}: observed {count}, approved {approved}")
    return violations
