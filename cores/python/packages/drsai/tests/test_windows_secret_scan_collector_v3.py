from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/collect_windows_secret_scan_v3.py"
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("windows_secret_scan_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_windows_collector_falls_back_to_read_only_copy_when_hardlinks_are_denied(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"safe fixture")
    destination = tmp_path / "collected"

    def denied(*_args, **_kwargs):
        raise PermissionError("hardlinks denied")

    monkeypatch.setattr(MODULE.os, "link", denied)
    assert MODULE._link([source], destination) == 1
    assert (destination / "0000-source.bin").read_bytes() == b"safe fixture"
