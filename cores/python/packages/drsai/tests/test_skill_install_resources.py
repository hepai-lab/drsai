from __future__ import annotations

import asyncio
from pathlib import Path

from drsai.backend import gateway


def test_bundled_skill_install_copies_complete_resource_tree(tmp_path: Path, monkeypatch) -> None:
    bundled = tmp_path / "catalog" / "pptx"
    (bundled / "scripts").mkdir(parents=True)
    (bundled / "agents").mkdir()
    (bundled / "SKILL.md").write_text("---\nname: pptx\ndescription: test\n---\n", encoding="utf-8")
    (bundled / "scripts" / "create.py").write_text("print('ok')\n", encoding="utf-8")
    (bundled / "scripts" / "__pycache__").mkdir()
    (bundled / "scripts" / "__pycache__" / "create.pyc").write_bytes(b"cache")
    (bundled / "agents" / "openai.yaml").write_text("interface: {}\n", encoding="utf-8")
    installed = tmp_path / "installed"
    monkeypatch.setattr(gateway, "_get_skills_dir", lambda _user_id=None: installed)
    monkeypatch.setattr(gateway, "_get_available_skills_dirs", lambda: [bundled.parent])

    result = asyncio.run(gateway.install_skill(gateway.SkillInstallRequest(name="pptx", source="catalog")))

    assert (installed / "pptx" / "SKILL.md").is_file()
    assert (installed / "pptx" / "scripts" / "create.py").read_text(encoding="utf-8") == "print('ok')\n"
    assert (installed / "pptx" / "agents" / "openai.yaml").is_file()
    assert not (installed / "pptx" / "scripts" / "__pycache__").exists()
    assert result["installed_files"] == ["SKILL.md", "agents/openai.yaml", "scripts/create.py"]


def test_inline_skill_install_remains_single_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(gateway, "_get_skills_dir", lambda _user_id=None: tmp_path)
    result = asyncio.run(gateway.install_skill(gateway.SkillInstallRequest(
        name="inline", content="---\nname: inline\ndescription: test\n---\n",
    )))
    assert result["installed_files"] == ["SKILL.md"]
