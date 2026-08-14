from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SKILL = ROOT / "skills" / "skills" / "pptx"


def _load(name: str):
    path = SKILL / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"pptx_skill_{name}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_builtin_pptx_skill_creates_editable_valid_deck(tmp_path: Path) -> None:
    create = _load("create_deck")
    validate = _load("validate_deck")
    output = tmp_path / "deck.pptx"
    create.create({
        "title": "OpenDrSai Runtime",
        "subtitle": "Session, Run, OAEP",
        "slides": [
            {"kind": "title", "title": "OpenDrSai Runtime", "subtitle": "Session, Run, OAEP"},
            {"kind": "content", "title": "Session and Run", "bullets": ["A session contains runs", "A run is traceable"]},
        ],
    }, output)
    result = validate.validate(output)
    assert result["valid"] is True
    assert result["slide_count"] == 2
    assert output.stat().st_size > 10_000
    assert "OpenDrSai Runtime" in result["slides"][0]
    assert any("A session contains runs" in text for text in result["slides"][1])


def test_builtin_pptx_skill_rejects_overfull_content_slide(tmp_path: Path) -> None:
    create = _load("create_deck")
    output = tmp_path / "deck.pptx"
    try:
        create.create({
            "slides": [{"kind": "content", "title": "Too much", "bullets": [str(index) for index in range(7)]}],
        }, output)
    except ValueError as exc:
        assert "more than 6 bullets" in str(exc)
    else:
        raise AssertionError("overfull content slide was accepted")
