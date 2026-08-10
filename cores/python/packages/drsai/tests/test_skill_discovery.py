from pathlib import Path

from drsai.modules.components.skills import resolve_builtin_skills_dir


def test_auto_discovery_loads_only_skills_skills(tmp_path: Path, monkeypatch) -> None:
    builtin = tmp_path / "skills" / "skills"
    builtin.mkdir(parents=True)
    (tmp_path / "skills" / "anthropic_skills_collection").mkdir()
    (tmp_path / "skills" / "skills_hepai").mkdir()
    monkeypatch.delenv("SYSTEM_SKILLS_DIR", raising=False)
    monkeypatch.setenv("AGENT_SKILLS_DIR", str(tmp_path / "skills" / "skills_hepai"))

    resolved = resolve_builtin_skills_dir(search_from=(tmp_path / "apps" / "desktop",))

    assert resolved == builtin.resolve()


def test_system_skills_dir_relocates_the_single_catalog(tmp_path: Path, monkeypatch) -> None:
    relocated = tmp_path / "packaged" / "builtin-skills"
    relocated.mkdir(parents=True)
    monkeypatch.setenv("SYSTEM_SKILLS_DIR", str(relocated))

    assert resolve_builtin_skills_dir() == relocated.resolve()


def test_invalid_explicit_catalog_fails_closed_without_loading_siblings(
    tmp_path: Path, monkeypatch,
) -> None:
    (tmp_path / "skills" / "skills").mkdir(parents=True)
    missing = tmp_path / "missing"
    monkeypatch.setenv("SYSTEM_SKILLS_DIR", str(missing))

    assert resolve_builtin_skills_dir(search_from=(tmp_path,)) is None
