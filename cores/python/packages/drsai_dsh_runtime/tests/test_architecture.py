from __future__ import annotations

import ast
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PACKAGE_ROOT / "src/opendrsai_dsh_runtime"


def test_independent_distribution_does_not_import_product_or_codex_internals() -> None:
    forbidden = {"drsai", "codex_adapter"}
    violations: list[str] = []
    for path in SOURCE_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            for name in names:
                root = name.split(".", 1)[0]
                if root in forbidden or "codex_adapter" in name:
                    violations.append(f"{path.relative_to(PACKAGE_ROOT)}:{node.lineno}:{name}")
    assert violations == []


def test_distribution_has_only_protocol_validation_and_signature_dependencies() -> None:
    pyproject = (PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'dependencies = ["jsonschema>=4.23,<5", "cryptography>=43,<51"]' in pyproject
    assert '"../../../protocol/oaep/oaep.schema.json"' in pyproject
    assert 'opendrsai-dsh-runtime = "opendrsai_dsh_runtime.cli:main"' in pyproject
