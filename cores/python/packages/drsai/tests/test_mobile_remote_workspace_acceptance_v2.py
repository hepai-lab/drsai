from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/mobile_remote_workspace_acceptance_v2.py"
LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v2/acceptance.json"
SPEC = importlib.util.spec_from_file_location("mobile_remote_acceptance_v2", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_acceptance_ledger_has_exactly_the_plan_80_features_without_drift() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    assert len(ledger["items"]) == 80
    assert len({item["id"] for item in ledger["items"]}) == 80
    assert ledger["release_gate"]["stability_duration_seconds"] == 3600


def test_release_gate_fails_closed_until_all_evidence_is_present() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", "--require-release-ready"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "full_pass=0/80" in result.stdout + result.stderr

    ledger = copy.deepcopy(MODULE.generated())
    ledger["items"][0]["status"] = "full_pass"
    errors = MODULE.validate(ledger)
    assert any("full_pass missing evidence" in error for error in errors)


def test_android_remote_workspace_uses_relay_only_and_pairing_has_no_host_credentials() -> None:
    dependency_text = "\n".join(
        path.read_text(encoding="utf-8")
        for pattern in ("*.gradle.kts", "libs.versions.toml")
        for path in (ROOT / "apps/android").rglob(pattern)
    ).casefold()
    for forbidden_dependency in ("jsch", "sshj", "apache.sshd", "mina-sshd", "libssh"):
        assert forbidden_dependency not in dependency_text

    fixtures = json.loads(
        (ROOT / "cores/protocol/relay/mobile-pairing-fixtures.json").read_text(encoding="utf-8")
    )
    valid = fixtures["valid"]
    assert valid
    for item in valid:
        parsed = urlsplit(item["payload"])
        query = parse_qs(parsed.query, keep_blank_values=True)
        assert (parsed.scheme, parsed.netloc, parsed.path) == ("opendrsai", "associate", "")
        assert set(query) == {"v", "environment", "issuer", "code"}
        assert not set(query) & {
            "host", "hostname", "ip", "port", "path", "workspace_path",
            "username", "password", "private_key", "ssh_key", "token",
        }
