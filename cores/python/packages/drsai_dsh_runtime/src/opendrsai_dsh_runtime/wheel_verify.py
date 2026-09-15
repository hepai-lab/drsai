"""Release-time verification for the independently built bridge wheel."""

from __future__ import annotations

import base64
import ast
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path, PurePosixPath

from .contracts import CONTROL_SCHEMA_SHA256, OAEP_SCHEMA_SHA256, canonical_json_sha256
from .native_extension import DSH_RC5_COMMIT, DSH_RC5_EXTENSION_ID
from .profiles import ProtocolProfile


class WheelVerificationError(RuntimeError):
    pass


def verify_bridge_wheel(path: Path) -> dict[str, object]:
    path = path.resolve(strict=True)
    with zipfile.ZipFile(path) as wheel:
        names = wheel.namelist()
        if len(names) != len(set(names)) or any(not _safe_name(name) for name in names):
            raise WheelVerificationError("wheel contains unsafe or duplicate paths")
        oaep_name = "opendrsai_dsh_runtime/protocol_data/oaep.schema.json"
        control_name = "opendrsai_dsh_runtime/protocol_data/runtime-control.schema.json"
        required = {
            oaep_name,
            control_name,
            "opendrsai_dsh_runtime/control_types.py",
            "opendrsai_dsh_runtime/event_disposition/dsh-session-events-v1.json",
            "opendrsai_dsh_runtime/profile_data/dsh-sdk-0.1.0-rc.5.json",
            "opendrsai_dsh_runtime/profile_data/dsh-sdk-0.1.0-rc.5-opendrsai.1.json",
            "opendrsai_dsh_runtime/native_extension/dsh-sdk-0.1.0-rc.5/cordis.yml",
            "opendrsai_dsh_runtime/native_extension/dsh-sdk-0.1.0-rc.5/opendrsai-sdk-server.mjs",
        }
        if not required.issubset(names):
            raise WheelVerificationError("wheel is missing protocol or compatibility resources")
        if hashlib.sha256(wheel.read(oaep_name)).hexdigest() != OAEP_SCHEMA_SHA256:
            raise WheelVerificationError("wheel OAEP schema digest mismatch")
        if hashlib.sha256(wheel.read(control_name)).hexdigest() != CONTROL_SCHEMA_SHA256:
            raise WheelVerificationError("wheel Control schema digest mismatch")
        probe_profile = ProtocolProfile.from_mapping(json.loads(
            wheel.read("opendrsai_dsh_runtime/profile_data/dsh-sdk-0.1.0-rc.5.json")
        ))
        extension_profile = ProtocolProfile.from_mapping(json.loads(
            wheel.read("opendrsai_dsh_runtime/profile_data/dsh-sdk-0.1.0-rc.5-opendrsai.1.json")
        ))
        server = wheel.read(
            "opendrsai_dsh_runtime/native_extension/dsh-sdk-0.1.0-rc.5/opendrsai-sdk-server.mjs"
        )
        config = wheel.read(
            "opendrsai_dsh_runtime/native_extension/dsh-sdk-0.1.0-rc.5/cordis.yml"
        )
        package = (
            b'{"name":"@opendrsai/dsh-sdk-extension","private":true,'
            b'"type":"module","exports":"./server.mjs"}\n'
        )
        inventory = {
            "extension_id": DSH_RC5_EXTENSION_ID,
            "source_commit": DSH_RC5_COMMIT,
            "files": {
                "node_modules/@opendrsai/dsh-sdk-extension/package.json": hashlib.sha256(package).hexdigest(),
                "node_modules/@opendrsai/dsh-sdk-extension/server.mjs": hashlib.sha256(server).hexdigest(),
                "opendrsai.cordis.yml": hashlib.sha256(config).hexdigest(),
            },
        }
        if canonical_json_sha256(inventory) != extension_profile.native_contract_sha256:
            raise WheelVerificationError("wheel native extension contract digest mismatch")
        record_names = [name for name in names if name.endswith(".dist-info/RECORD")]
        metadata_names = [name for name in names if name.endswith(".dist-info/METADATA")]
        if len(record_names) != 1 or len(metadata_names) != 1:
            raise WheelVerificationError("wheel metadata topology is invalid")
        _verify_record(wheel, record_names[0])
        metadata = wheel.read(metadata_names[0]).decode("utf-8")
        for dependency in ("jsonschema", "cryptography"):
            if f"Requires-Dist: {dependency}" not in metadata:
                raise WheelVerificationError(f"wheel metadata omits {dependency}")
        for name in names:
            if name.startswith("opendrsai_dsh_runtime/") and name.endswith(".py"):
                tree = ast.parse(wheel.read(name).decode("utf-8"), filename=name)
                for node in ast.walk(tree):
                    modules = []
                    if isinstance(node, ast.Import):
                        modules = [alias.name for alias in node.names]
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        modules = [node.module]
                    if any(module == "drsai" or module.startswith(("drsai.", "apps.desktop")) for module in modules):
                        raise WheelVerificationError("wheel imports a forbidden product implementation")
        return {
            "wheel_sha256": _file_sha256(path),
            "files": len(names),
            "oaep_schema_sha256": OAEP_SCHEMA_SHA256,
            "control_schema_sha256": CONTROL_SCHEMA_SHA256,
            "profiles": [
                {"profile_id": probe_profile.profile_id, "profile_sha256": probe_profile.profile_sha256},
                {"profile_id": extension_profile.profile_id, "profile_sha256": extension_profile.profile_sha256},
            ],
        }


def _verify_record(wheel: zipfile.ZipFile, record_name: str) -> None:
    rows = list(csv.reader(io.StringIO(wheel.read(record_name).decode("utf-8"))))
    indexed = {row[0]: row for row in rows if len(row) == 3}
    if set(wheel.namelist()) != set(indexed):
        raise WheelVerificationError("wheel RECORD does not cover every file")
    for name, row in indexed.items():
        if name == record_name:
            continue
        algorithm, separator, encoded = row[1].partition("=")
        if algorithm != "sha256" or not separator:
            raise WheelVerificationError("wheel RECORD uses an unsupported digest")
        expected = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = wheel.read(name)
        if hashlib.sha256(payload).digest() != expected or int(row[2]) != len(payload):
            raise WheelVerificationError("wheel RECORD digest or size mismatch")


def _safe_name(value: str) -> bool:
    path = PurePosixPath(value)
    return not path.is_absolute() and bool(path.parts) and all(part not in {"", ".", ".."} for part in path.parts)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
