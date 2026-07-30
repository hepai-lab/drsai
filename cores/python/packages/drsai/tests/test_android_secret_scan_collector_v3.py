from __future__ import annotations

import importlib.util
import io
import subprocess
import sys
import tarfile
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/collect_android_secret_scan_v3.py"
if str(SCRIPT.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("android_secret_scan_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def archive(path: Path, name: str) -> Path:
    content = b"fixture"
    with tarfile.open(path, "w") as output:
        member = tarfile.TarInfo(name)
        member.size = len(content)
        output.addfile(member, io.BytesIO(content))
    return path


def test_android_private_archive_extract_is_traversal_safe(tmp_path: Path) -> None:
    source = archive(tmp_path / "safe.tar", "databases/remote.db")
    destination = tmp_path / "safe"
    destination.mkdir()
    MODULE._safe_extract(source, destination)
    assert (destination / "databases/remote.db").read_bytes() == b"fixture"

    unsafe = archive(tmp_path / "unsafe.tar", "../outside")
    with pytest.raises(RuntimeError, match="android_secret_scan_archive_unsafe"):
        MODULE._safe_extract(unsafe, tmp_path / "unsafe")
    assert not (tmp_path / "outside").exists()


def test_android_private_archive_rejects_empty_tar(tmp_path: Path) -> None:
    source = tmp_path / "empty.tar"
    with tarfile.open(source, "w"):
        pass
    destination = tmp_path / "empty"
    destination.mkdir()
    with pytest.raises(RuntimeError, match="android_secret_scan_archive_empty"):
        MODULE._safe_extract(source, destination)


def test_android_private_input_uses_stdin_not_command_line(monkeypatch) -> None:
    captured = {}

    def fake_adb(args, *command, input_bytes=None):
        captured["command"] = command
        captured["input"] = input_bytes
        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setattr(MODULE, "_adb", fake_adb)
    payload = b'{"canaries":["private-canary"]}'
    MODULE._write_private_input(
        SimpleNamespace(package="ai.drsai.remote.debug"),
        payload,
    )

    assert captured["command"] == (
        "shell",
        "run-as",
        "ai.drsai.remote.debug",
        "dd",
        f"of={MODULE.INPUT}",
    )
    assert captured["input"] == payload
    assert payload.decode() not in " ".join(captured["command"])
