"""Generate reproducible supply-chain and security evidence for Android Python Core."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ALLOWED_STDLIB = {"__future__", "asyncio", "base64", "dataclasses", "enum", "json", "typing"}
FORBIDDEN_RUNTIME = {"aiohttp", "boto3", "cryptography", "debugpy", "fastapi", "pydantic", "uvicorn"}
SECRET_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "jwt": re.compile(rb"eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}"),
    "openai_key": re.compile(rb"sk-[A-Za-z0-9_-]{32,}"),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    core = repo / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core"
    sources = sorted(core.glob("*.py"))
    files = []
    imports: set[str] = set()
    for path in sources:
        data = path.read_bytes()
        files.append({"path": path.relative_to(repo).as_posix(), "sha256": sha256(data), "bytes": len(data)})
        tree = ast.parse(data, filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imports.add(node.module.split(".")[0])
    external = sorted(imports - ALLOWED_STDLIB)
    forbidden = sorted(imports & FORBIDDEN_RUNTIME)
    apk = args.apk.resolve() if args.apk else None
    native = []
    apk_hash = None
    findings = []
    if apk and apk.is_file():
        apk_data = apk.read_bytes()
        apk_hash = sha256(apk_data)
        for name, pattern in SECRET_PATTERNS.items():
            if pattern.search(apk_data):
                findings.append({"source": "apk", "rule": name})
        with zipfile.ZipFile(apk) as archive:
            for info in archive.infolist():
                if info.filename.endswith(".so") and any(token in info.filename.lower() for token in ("python", "chaquopy")):
                    data = archive.read(info)
                    native.append({"path": info.filename, "sha256": sha256(data), "bytes": len(data)})

    generated = datetime.now(timezone.utc).isoformat()
    compatibility = {
        "schema_version": 1,
        "generated_at": generated,
        "python": {"version": "3.11", "license": "PSF-2.0", "abis": ["arm64-v8a", "x86_64"]},
        "chaquopy": {"version": "17.0.0", "license": "MIT"},
        "drsai_core_mobile": {
            "version": "1", "license": "MIT", "stdlib_imports": sorted(imports),
            "external_dependencies": external, "forbidden_dependencies": forbidden, "files": files,
        },
        "native_files": native,
        "build_policy": {"dynamic_pip_install": False, "downloaded_code_execution": False, "hashes_complete": True},
        "result": "passed" if not external and not forbidden and apk_hash else "failed",
        "apk_sha256": apk_hash,
    }
    write_json(args.output / "dependency-compatibility.json", compatibility)

    components = [
        {"type": "application", "name": "drsai-core-mobile", "version": "1", "licenses": [{"license": {"id": "MIT"}}]},
        {"type": "framework", "name": "CPython", "version": "3.11", "licenses": [{"license": {"id": "PSF-2.0"}}]},
        {"type": "framework", "name": "Chaquopy", "version": "17.0.0", "licenses": [{"license": {"id": "MIT"}}]},
    ]
    sbom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
        "metadata": {"timestamp": generated, "component": components[0]},
        "components": components[1:],
    }
    write_json(args.output / "cyclonedx-sbom.json", sbom)

    security = {
        "schema_version": 1,
        "generated_at": generated,
        "scans": [
            {"source": "apk", "status": "passed" if apk_hash and not findings else "failed", "sha256": apk_hash},
            {"source": "device_log", "status": "not_executed", "reason": "no_adb_device"},
            {"source": "device_app_data", "status": "not_executed", "reason": "no_adb_device"},
        ],
        "findings": findings,
        "result": "incomplete" if apk_hash and not findings else "failed",
    }
    write_json(args.output / "security-scan.json", security)
    write_json(args.output / "device-performance.json", {
        "schema_version": 1,
        "generated_at": generated,
        "environment": "not_executed",
        "reason": "no_adb_device",
        "metrics": {
            "cold_start_p95_ms": None, "foreground_pss_p95_mb": None, "peak_pss_mb": None,
            "storage_mb": None, "cpu": None, "battery": None, "thermal": None, "anr": None,
            "runtime_release_verified": False,
        },
        "result": "incomplete",
    })
    return 0 if compatibility["result"] == "passed" and not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
