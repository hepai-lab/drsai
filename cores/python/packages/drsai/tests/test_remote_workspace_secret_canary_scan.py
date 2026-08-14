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
    assert report["matches"] == 1
    assert report["sources"][0]["status"] == "clean"
    assert report["sources"][0]["bytes_scanned"] > 0
    encoded = json.dumps(report)
    assert canary not in encoded
    assert "diagnostics.zip" not in encoded
    assert "nested/runtime.log" not in encoded
    assert "results" not in report


def test_stream_scanner_finds_canary_across_chunk_boundary(tmp_path: Path) -> None:
    canary = b"DRS_BOUNDARY_CANARY_918f2d"
    artifact = tmp_path / "runtime.db"
    artifact.write_bytes(b"x" * (MODULE.CHUNK_SIZE - 5) + canary)
    result = MODULE.scan_artifact("runtime_db", artifact, (canary,))
    assert result.leaked is True


def test_stream_scanner_finds_overlapping_prefixes_across_tiny_chunks() -> None:
    import io

    matcher = MODULE._StreamingMultiPatternMatcher((b"ababaca", b"bac", b"aca"))
    stream = io.BytesIO(b"prefix-ababaca-suffix")
    assert matcher.contains(stream) is True


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


def test_mobile_v3_manifest_requires_every_release_surface(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact = tmp_path / "clean.bin"
    artifact.write_bytes(b"redacted")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "profile": "mobile-remote-workspace-v3",
                "artifacts": [
                    {"label": "android_apk", "path": str(artifact)}
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TEST_CANARIES", json.dumps(["DRS_V3_CANARY_123456"]))

    with pytest.raises(ValueError, match="mobile V3 secret sources missing"):
        MODULE.run(manifest, "TEST_CANARIES")


def test_mobile_v3_report_matches_finalizer_source_contract(
    tmp_path: Path,
    monkeypatch,
) -> None:
    artifact = tmp_path / "clean.bin"
    artifact.write_bytes(b"only irreversible hashes")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "profile": "mobile-remote-workspace-v3",
                "artifacts": [
                    {"label": label, "path": str(artifact)}
                    for label in sorted(MODULE.V3_REQUIRED_SOURCES)
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TEST_CANARIES", json.dumps(["DRS_V3_CANARY_abcdef"]))

    report = MODULE.run(manifest, "TEST_CANARIES")

    assert report["passed"] is True
    assert report["matches"] == 0
    assert {
        row["name"]
        for row in report["sources"]
        if row["status"] == "clean" and row["bytes_scanned"] > 0
    } == MODULE.V3_REQUIRED_SOURCES


def test_mobile_p6_manifest_requires_exactly_eleven_sources(
    tmp_path: Path, monkeypatch,
) -> None:
    artifact = tmp_path / "clean.bin"
    artifact.write_bytes(b"irreversible hashes only")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "profile": "mobile-remote-workspace-p6",
        "artifacts": [
            {"label": label, "path": str(artifact)}
            for label in sorted(MODULE.P6_REQUIRED_SOURCES)
        ],
    }), encoding="utf-8")
    monkeypatch.setenv("TEST_CANARIES", json.dumps(["DRS_P6_CANARY_abcdef"] ))

    report = MODULE.run(manifest, "TEST_CANARIES")

    assert report["passed"] is True
    assert len(report["sources"]) == 11
    assert "results" not in report
