from __future__ import annotations

import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/scan_remote_workspace_secret_canary.py"
SPEC = importlib.util.spec_from_file_location("remote_workspace_secret_canary", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_scanner_detects_plain_and_compressed_canaries_without_reporting_value(
    tmp_path: Path, monkeypatch,
) -> None:
    canary = "DRS_TEST_CANARY_4f671a"
    safe = tmp_path / "safe.log"
    safe.write_text("token=[REDACTED]", encoding="utf-8")
    unsafe = tmp_path / "diagnostics.zip"
    with zipfile.ZipFile(unsafe, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("nested/runtime.log", f"registration_token={canary}")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "profile": "unit",
        "artifacts": [
            {"label": "safe", "path": str(safe)},
            {"label": "diagnostics", "path": str(unsafe)},
        ],
    }), encoding="utf-8")
    monkeypatch.setenv("TEST_CANARIES", json.dumps([canary]))

    report = MODULE.run(manifest, "TEST_CANARIES")

    assert report["passed"] is False
    assert report["results"][0]["leaked"] is False
    assert report["results"][1]["leaked"] is True
    encoded = json.dumps(report)
    assert canary not in encoded
    assert "diagnostics.zip!/nested/runtime.log" in encoded


def test_stream_scanner_finds_canary_across_chunk_boundary(tmp_path: Path) -> None:
    canary = b"DRS_BOUNDARY_CANARY_918f2d"
    artifact = tmp_path / "runtime.db"
    artifact.write_bytes(b"x" * (MODULE.CHUNK_SIZE - 5) + canary)
    result = MODULE.scan_artifact("runtime_db", artifact, (canary,))
    assert result.leaked is True


@pytest.mark.parametrize("encoding", ["casefold", "url", "base64", "base64url", "hex"])
def test_scanner_expands_common_persistence_encodings(
    tmp_path: Path, monkeypatch, encoding: str,
) -> None:
    canary = "DRS_ENCODING_CANARY_Ab91"
    variants = {
        "casefold": canary.casefold().encode(),
        "url": __import__("urllib.parse", fromlist=["quote"]).quote(canary, safe="").encode(),
        "base64": __import__("base64").b64encode(canary.encode()),
        "base64url": __import__("base64").urlsafe_b64encode(canary.encode()).rstrip(b"="),
        "hex": canary.encode().hex().encode(),
    }
    artifact = tmp_path / f"{encoding}.bin"
    artifact.write_bytes(variants[encoding])
    monkeypatch.setenv("TEST_CANARIES", json.dumps([canary]))

    result = MODULE.scan_artifact("encoded", artifact, MODULE.load_canaries("TEST_CANARIES"))

    assert result.leaked is True


@pytest.mark.parametrize("kind", ["missing", "empty_directory"])
def test_scanner_rejects_artifacts_that_would_scan_zero_files(
    tmp_path: Path, kind: str,
) -> None:
    artifact = tmp_path / kind
    if kind == "empty_directory":
        artifact.mkdir()

    with pytest.raises((FileNotFoundError, ValueError), match="artifact"):
        MODULE.scan_artifact("required", artifact, (b"DRS_REQUIRED_CANARY_71bca9",))
