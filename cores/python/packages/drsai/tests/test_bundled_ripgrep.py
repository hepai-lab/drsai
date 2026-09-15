"""Ripgrep resolution for the agent ``grep`` tool.

Regression coverage for a Windows gap: OpenDrSai ships a pinned ripgrep inside
the Desktop payload, but ``grep`` only ever consulted PATH. On Windows there is
no usable system ``rg`` (``findstr`` is ASCII-only, ``Select-String`` costs
100-150 ms of PowerShell startup per call), so the tool silently fell back to
the in-process Python scan -- correct, but orders of magnitude slower on large
workspaces.

``_detect_ripgrep_executable()`` must therefore find the shipped copy in every
deployment shape -- source checkout, packaged Desktop payload and Runtime
install -- while an explicit ``DRSAI_RG_PATH`` override, PATH and an existing
``DRSAI_HOME/bin`` install keep working.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable

import pytest

from drsai.modules.agents.skills_agent.managers import operater_funs as operater_funs_module

# Payload-relative directories that can carry the shipped ripgrep, mirroring
# the source checkout, a Runtime install and a packaged Desktop payload.
PAYLOAD_LAYOUTS = (
    ("apps", "desktop", "windows", "resources", "tools", "ripgrep"),
    ("app", "resources", "tools", "ripgrep"),
    ("resources", "tools", "ripgrep"),
)


def _fake_rg(path: Path) -> Path:
    """Create an executable placeholder at ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    if os.name != "nt":  # os.access(..., X_OK) is meaningful on POSIX only
        path.chmod(0o755)
    return path


def _grep_tool(workspace: Path) -> Callable:
    """Return the ``grep`` closure the agent registers for ``workspace``."""
    for tool in operater_funs_module.get_operator_funcs(workspace, thread_id="test-thread"):
        if getattr(tool, "__name__", "") == "grep":
            return tool
    raise AssertionError("get_operator_funcs() did not return a grep tool")


def test_env_var_name_matches_the_desktop_contract() -> None:
    """Desktop exports this exact name (pinned by windows/scripts/verify-bundled-ripgrep.mjs)."""
    assert operater_funs_module._RIPGREP_ENV_VAR == "DRSAI_RG_PATH"


def test_explicit_override_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    override = _fake_rg(tmp_path / "custom" / "rg.exe")
    monkeypatch.setenv(operater_funs_module._RIPGREP_ENV_VAR, str(override))

    def _unexpected_path_lookup(name: str) -> str:
        raise AssertionError(f"PATH must not be consulted for {name!r}")

    monkeypatch.setattr(shutil, "which", _unexpected_path_lookup)
    assert operater_funs_module._detect_ripgrep_executable() == str(override)


def test_unusable_override_falls_back_to_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(
        operater_funs_module._RIPGREP_ENV_VAR, str(tmp_path / "gone" / "rg.exe")
    )
    monkeypatch.setattr(operater_funs_module, "_bundled_ripgrep_candidates", lambda names: [])
    on_path = _fake_rg(tmp_path / "from-path" / "rg")
    monkeypatch.setattr(shutil, "which", lambda name: str(on_path))

    assert operater_funs_module._detect_ripgrep_executable() == str(on_path)


@pytest.mark.parametrize("layout", PAYLOAD_LAYOUTS)
def test_shipped_payload_is_preferred_over_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, layout: tuple[str, ...]
) -> None:
    monkeypatch.delenv(operater_funs_module._RIPGREP_ENV_VAR, raising=False)
    monkeypatch.setenv("DRSAI_REPO", str(tmp_path))
    for name in ("rg.exe", "rg"):
        _fake_rg(Path(tmp_path, *layout, name))
    ambient = _fake_rg(tmp_path / "ambient" / "rg.exe")
    monkeypatch.setattr(shutil, "which", lambda name: str(ambient))

    detected = operater_funs_module._detect_ripgrep_executable()
    # The pinned payload must beat whatever happens to be on PATH.
    assert detected is not None
    assert detected.startswith(str(Path(tmp_path, *layout)))


def test_drsai_home_bin_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(operater_funs_module._RIPGREP_ENV_VAR, raising=False)
    monkeypatch.delenv("DRSAI_REPO", raising=False)
    monkeypatch.setattr(operater_funs_module, "_bundled_ripgrep_candidates", lambda names: [])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    installed = _fake_rg(tmp_path / "bin" / "rg.exe")

    assert operater_funs_module._detect_ripgrep_executable() == str(installed)


def test_non_file_candidates_are_skipped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A directory named like the binary must not shadow a real install."""
    monkeypatch.setenv(operater_funs_module._RIPGREP_ENV_VAR, str(tmp_path / "rg.exe"))
    (tmp_path / "rg.exe").mkdir()
    monkeypatch.setattr(operater_funs_module, "_bundled_ripgrep_candidates", lambda names: [])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "home"))
    installed = _fake_rg(tmp_path / "home" / "bin" / "rg.exe")

    assert operater_funs_module._detect_ripgrep_executable() == str(installed)


def test_missing_everywhere_returns_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(operater_funs_module._RIPGREP_ENV_VAR, raising=False)
    monkeypatch.setattr(operater_funs_module, "_bundled_ripgrep_candidates", lambda names: [])
    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "empty"))

    assert operater_funs_module._detect_ripgrep_executable() is None


@pytest.mark.asyncio
async def test_grep_resolves_ripgrep_through_the_resolver(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """grep() must ask the resolver instead of probing PATH on its own."""
    resolved: list[bool] = []

    def _resolver() -> None:
        resolved.append(True)
        return None  # force the in-process fallback; the call itself is the assertion

    monkeypatch.setattr(operater_funs_module, "_detect_ripgrep_executable", _resolver)
    (tmp_path / "sample.txt").write_text("alpha\nneedle here\n", encoding="utf-8")

    result = await _grep_tool(tmp_path)(pattern="needle", mode="content")

    assert resolved, "grep() must resolve ripgrep through _detect_ripgrep_executable()"
    assert "sample.txt" in result


@pytest.mark.asyncio
async def test_grep_finds_matches_with_the_shipped_ripgrep(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ripgrep = operater_funs_module._detect_ripgrep_executable()
    if not ripgrep:
        pytest.skip("no ripgrep available in this environment")
    monkeypatch.setenv(operater_funs_module._RIPGREP_ENV_VAR, ripgrep)
    (tmp_path / "workspace.txt").write_text("alpha\nneedle here\n", encoding="utf-8")

    result = await _grep_tool(tmp_path)(
        pattern="NEEDLE", mode="content", case_insensitive=True
    )

    assert "workspace.txt" in result
    assert "needle here" in result
