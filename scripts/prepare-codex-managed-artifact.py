"""Create an OpenDrSai-managed Codex artifact from an official native package."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return f"sha256:{value.hexdigest()}"


def canonical(manifest: dict[str, object]) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def read_private_key(path: Path | None) -> tuple[Ed25519PrivateKey, bool]:
    if path is None:
        return Ed25519PrivateKey.generate(), True
    raw = path.read_bytes()
    try:
        key = serialization.load_pem_private_key(raw, password=None)
    except ValueError:
        key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw.strip(), validate=True))
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Codex artifact signing key must be Ed25519")
    return key, False


def prepare(
    vendor_root: Path, schema_root: Path, license_path: Path, output: Path,
    publisher: str, private_key_path: Path | None,
) -> dict[str, object]:
    if not re.fullmatch(r"[0-9A-Za-z_.-]{1,128}", publisher):
        raise ValueError("publisher contains unsupported characters")
    executable = vendor_root / "bin" / "codex.exe"
    schema = schema_root / "codex_app_server_protocol.v2.schemas.json"
    if not executable.is_file() or not schema.is_file() or not license_path.is_file():
        raise FileNotFoundError("vendor bin/codex.exe, stable v2 schema, and license are required")
    version_result = subprocess.run([str(executable), "--version"], capture_output=True, text=True, timeout=30, check=False)
    match = re.search(r"(?:codex-cli\s+)?(\d+\.\d+\.\d+)", f"{version_result.stdout}\n{version_result.stderr}")
    if version_result.returncode or not match:
        raise RuntimeError("official Codex executable did not report a valid version")
    version = match.group(1)
    artifact = output / "artifact"
    if output.exists():
        shutil.rmtree(output)
    artifact.mkdir(parents=True)
    shutil.copytree(vendor_root, artifact / "vendor")
    shutil.copytree(schema_root, artifact / "app-server-schema")
    shutil.copy2(license_path, artifact / "LICENSE-CODEX")
    executable_target = artifact / "vendor" / "bin" / "codex.exe"
    schema_target = artifact / "app-server-schema" / schema.name
    key, ephemeral = read_private_key(private_key_path)
    manifest: dict[str, object] = {
        "version": version,
        "platform": "windows-x86_64",
        "executable": "vendor/bin/codex.exe",
        "binary_digest": digest(executable_target),
        "schema": f"app-server-schema/{schema.name}",
        "schema_digest": digest(schema_target),
        "publisher": publisher,
        "distribution": {"package": "@openai/codex", "license": "Apache-2.0", "version": version},
        "acceptance_only": ephemeral,
    }
    manifest["signature"] = base64.b64encode(key.sign(canonical(manifest))).decode("ascii")
    (artifact / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    trust_store = output / "trusted-publishers.json"
    trust_store.write_text(json.dumps({publisher: base64.b64encode(public).decode("ascii")}, indent=2) + "\n", encoding="utf-8")
    result = {
        "artifact": str(artifact), "trust_store": str(trust_store), "version": version,
        "publisher": publisher, "acceptance_only": ephemeral,
        "binary_digest": manifest["binary_digest"], "schema_digest": manifest["schema_digest"],
    }
    (output / "build-evidence.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor-root", type=Path, required=True)
    parser.add_argument("--schema-root", type=Path, required=True)
    parser.add_argument("--license", dest="license_path", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publisher", default="opendrsai-release")
    parser.add_argument("--private-key", type=Path, help="PEM or base64 raw Ed25519 private key; omit only for acceptance builds")
    args = parser.parse_args()
    print(json.dumps(prepare(args.vendor_root, args.schema_root, args.license_path, args.output, args.publisher, args.private_key), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
