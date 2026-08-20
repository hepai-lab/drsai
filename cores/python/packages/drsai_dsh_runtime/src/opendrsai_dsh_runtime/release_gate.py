"""Machine-readable compatibility, security, and release gates."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Mapping


_SECRET_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "provider_token": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "github_token": re.compile(rb"\bgh[opsu]_[A-Za-z0-9]{30,}\b"),
}


def build_real_dsh_matrix(probe: Mapping[str, Any]) -> dict[str, Any]:
    """Turn a real-process probe into explicit, independently reviewable gates."""
    identity = _mapping(probe.get("native_identity"), "native_identity")
    compatibility = _mapping(probe.get("compatibility"), "compatibility")
    carrier = _mapping(probe.get("carrier"), "carrier")
    checks = [
        _check("real_process_initialized", identity.get("server_name") == "deepseek-harness-sdk-runtime"),
        _check("source_commit_pinned", _is_sha(probe.get("source_commit"))),
        _check("native_contract_pinned", _is_sha(identity.get("contract_sha256"))),
        _check("protocol_surface_observed", bool(identity.get("methods")) and bool(identity.get("notifications"))),
        _check("profile_decision_recorded", compatibility.get("state") in {"available", "probe_only", "blocked"}),
        _check("self_contained_production_carrier", carrier.get("kind") == "executable"),
        _check("production_capabilities_complete", probe.get("production_eligible") is True),
    ]
    deployment_ready = all(check["passed"] for check in checks)
    return {
        "schema_version": 1,
        "source": "real-dsh-process",
        "profile_id": compatibility.get("profile_id"),
        "server_version": identity.get("server_version"),
        "checks": checks,
        "missing": {
            "methods": list(compatibility.get("missing_methods", [])),
            "notifications": list(compatibility.get("missing_notifications", [])),
            "capabilities": list(compatibility.get("missing_capabilities", [])),
        },
        "deployment_verdict": "go" if deployment_ready else "no_go",
    }


def scan_release_artifacts(paths: Iterable[Path]) -> dict[str, Any]:
    """Scan release payload bytes without returning matched secret material."""
    findings: list[dict[str, str]] = []
    files = 0
    bytes_scanned = 0
    for raw_path in paths:
        path = raw_path.resolve(strict=True)
        if path.suffix == ".whl":
            with zipfile.ZipFile(path) as archive:
                for name in sorted(archive.namelist()):
                    if name.endswith("/"):
                        continue
                    payload = archive.read(name)
                    files += 1
                    bytes_scanned += len(payload)
                    findings.extend(_scan_payload(f"{path.name}!/{name}", payload))
        elif path.is_file():
            payload = path.read_bytes()
            files += 1
            bytes_scanned += len(payload)
            findings.extend(_scan_payload(path.name, payload))
        else:
            for child in sorted(item for item in path.rglob("*") if item.is_file()):
                payload = child.read_bytes()
                files += 1
                bytes_scanned += len(payload)
                findings.extend(_scan_payload(child.relative_to(path).as_posix(), payload))
    return {
        "schema_version": 1,
        "files_scanned": files,
        "bytes_scanned": bytes_scanned,
        "findings": findings,
        "passed": not findings,
    }


def build_release_report(
    *, ledger: Mapping[str, Any], real_matrix: Mapping[str, Any], wheel: Mapping[str, Any],
    security: Mapping[str, Any], pressure: Mapping[str, Any],
) -> dict[str, Any]:
    """Separate implementation acceptance from production deployment authority."""
    progress = _mapping(ledger.get("progress"), "ledger.progress")
    delivery_checks = [
        _check("acceptance_complete", progress.get("accepted_features") == progress.get("total_features")),
        _check("wheel_verified", _is_sha(wheel.get("wheel_sha256"))),
        _check("security_scan_clean", security.get("passed") is True),
        _check("pressure_matrix_passed", pressure.get("passed") is True),
        _check("real_matrix_present", real_matrix.get("source") == "real-dsh-process"),
    ]
    delivery_ready = all(check["passed"] for check in delivery_checks)
    deployment_ready = delivery_ready and real_matrix.get("deployment_verdict") == "go"
    return {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "delivery_checks": delivery_checks,
        "delivery_verdict": "accepted" if delivery_ready else "incomplete",
        "deployment_verdict": "go" if deployment_ready else "no_go",
        "deployment_blockers": [] if deployment_ready else list(
            _mapping(real_matrix.get("missing"), "real_matrix.missing").get("capabilities", [])
        ),
        "artifact_sha256": {
            "wheel": wheel.get("wheel_sha256"),
            "real_matrix": _canonical_sha(real_matrix),
            "security": _canonical_sha(security),
            "pressure": _canonical_sha(pressure),
        },
    }


def atomic_write_json(path: Path, value: Mapping[str, Any]) -> None:
    destination = path.resolve(strict=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(destination)


def _scan_payload(location: str, payload: bytes) -> list[dict[str, str]]:
    return [
        {"location": location, "kind": kind, "fingerprint": hashlib.sha256(match.group(0)).hexdigest()[:16]}
        for kind, pattern in _SECRET_PATTERNS.items()
        for match in pattern.finditer(payload)
    ]


def _check(name: str, passed: bool) -> dict[str, Any]:
    return {"name": name, "passed": bool(passed)}


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value) is not None


def _canonical_sha(value: Mapping[str, Any]) -> str:
    payload = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
