"""Version-pinned DSH edge extensions and deterministic staging support."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path

from .contracts import canonical_json_sha256


DSH_RC5_COMMIT = "47f943859bef60e4160492346772ded9b24f765a"
DSH_RC5_EXTENSION_ID = "dsh-sdk/0.1.0-rc.5+opendrsai.1"


class NativeExtensionError(RuntimeError):
    pass


@dataclass(frozen=True)
class NativeExtensionBundle:
    extension_id: str
    source_commit: str
    files: dict[str, bytes]
    contract_sha256: str

    @classmethod
    def rc5(cls) -> "NativeExtensionBundle":
        root = files("opendrsai_dsh_runtime").joinpath(
            "native_extension", "dsh-sdk-0.1.0-rc.5"
        )
        content = {
            "node_modules/@opendrsai/dsh-sdk-extension/server.mjs": root.joinpath("opendrsai-sdk-server.mjs").read_bytes(),
            "node_modules/@opendrsai/dsh-sdk-extension/package.json": (
                b'{"name":"@opendrsai/dsh-sdk-extension","private":true,'
                b'"type":"module","exports":"./server.mjs"}\n'
            ),
            "opendrsai.cordis.yml": root.joinpath("cordis.yml").read_bytes(),
        }
        inventory = {
            "extension_id": DSH_RC5_EXTENSION_ID,
            "source_commit": DSH_RC5_COMMIT,
            "files": {name: hashlib.sha256(body).hexdigest() for name, body in sorted(content.items())},
        }
        return cls(
            DSH_RC5_EXTENSION_ID, DSH_RC5_COMMIT, content,
            canonical_json_sha256(inventory),
        )

    def stage(self, carrier_root: Path, *, source_commit: str) -> dict[str, object]:
        """Install into a mutable carrier staging tree before release signing."""
        if source_commit != self.source_commit:
            raise NativeExtensionError("DSH source commit is incompatible with this extension")
        root = carrier_root.expanduser().resolve(strict=True)
        package_json = root / "package.json"
        modules = root / "node_modules"
        if not package_json.is_file() or not modules.is_dir():
            raise NativeExtensionError("target is not a staged DSH Node carrier")
        required = (
            "@deepseek-ai/dsh-sdk-protocol", "@deepseek-ai/dsh-agent",
            "@deepseek-ai/dsh-sandbox-local", "@deepseek-ai/dsh-fs-sandbox",
        )
        if any(not (modules.joinpath(*name.split("/"))).is_dir() for name in required):
            raise NativeExtensionError("DSH carrier dependency closure is incomplete")
        written: list[str] = []
        for relative, body in self.files.items():
            target = root.joinpath(*relative.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = target.with_name(f".{target.name}.tmp")
            temporary.write_bytes(body)
            os.replace(temporary, target)
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(body).digest():
                raise NativeExtensionError(f"staged extension verification failed: {relative}")
            written.append(relative)
        manifest = {
            "schema_version": 1,
            "extension_id": self.extension_id,
            "source_commit": self.source_commit,
            "contract_sha256": self.contract_sha256,
            "files": sorted(written),
        }
        manifest_path = root / "opendrsai-extension.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8"
        )
        return manifest

    def materialize_config(self, target: Path) -> Path:
        """Write the profile-owned Cordis config beside runtime state."""
        body = self.files["opendrsai.cordis.yml"]
        path = target.expanduser().resolve(strict=False)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_name(f".{path.name}.tmp")
        temporary.write_bytes(body)
        os.replace(temporary, path)
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(body).digest():
            raise NativeExtensionError("materialized Cordis config failed verification")
        return path
