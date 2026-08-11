from __future__ import annotations

import json
from pathlib import Path
import re


REPO = Path(__file__).resolve().parents[5]
FIXTURE = REPO / "cores/protocol/android-runtime/fixtures/workspace-tool-parity-v1.json"
DESKTOP = REPO / "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py"
ANDROID = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/device/AndroidLocalCapabilities.kt"


def glob_regex(pattern: str) -> re.Pattern[str]:
    normalized = pattern.replace("\\", "/").lstrip("/")
    assert normalized and ".." not in normalized.split("/")
    output, index = "^", 0
    while index < len(normalized):
        value = normalized[index]
        if value == "*" and index + 1 < len(normalized) and normalized[index + 1] == "*":
            output += ".*"; index += 1
        elif value == "*": output += "[^/]*"
        elif value == "?": output += "[^/]"
        else: output += re.escape(value)
        index += 1
    return re.compile(output + "$", re.IGNORECASE)


def test_desktop_and_android_expose_every_declared_semantic_mapping() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    desktop = DESKTOP.read_text(encoding="utf-8")
    android = ANDROID.read_text(encoding="utf-8")
    for desktop_name, android_name in fixture["mappings"].items():
        assert f"def {desktop_name}(" in desktop
        assert f'"{android_name}"' in android


def test_relative_path_line_and_glob_fixtures_are_platform_neutral() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for path in fixture["safe_paths"]:
        assert not path.startswith(("/", "\\")) and all(part not in {"", ".", ".."} for part in path.replace("\\", "/").split("/"))
    for path in fixture["denied_paths"]:
        assert any(part in {"", ".", ".."} for part in path.replace("\\", "/").split("/"))
    for case in fixture["line_slices"]:
        lines = case["text"].splitlines()
        actual = "" if case["start"] > len(lines) else "\n".join(lines[case["start"] - 1:case["end"]])
        assert actual == case["expected"]
    for case in fixture["glob_cases"]:
        assert bool(glob_regex(case["pattern"]).fullmatch(case["path"])) is case["matches"]
