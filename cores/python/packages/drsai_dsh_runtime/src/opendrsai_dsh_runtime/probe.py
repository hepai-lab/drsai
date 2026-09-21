"""Auditable real DeepSeek Harness protocol probe."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

from .driver import HarnessSdkDriver
from .process import HarnessProcessSpec, HarnessProcessSupervisor
from .profiles import ProtocolProfileRegistry


async def probe_real_dsh(
    *, command: Sequence[str], workspace_root: Path, state_root: Path, profile_id: str,
    provider: str = "deepseek-official", model: str = "deepseek-v4-flash", source_commit: str | None = None,
) -> dict[str, Any]:
    if not command:
        raise ValueError("Real DSH probe command cannot be empty")
    workspace = workspace_root.resolve(strict=True)
    state = state_root.resolve(strict=False)
    state.mkdir(parents=True, exist_ok=True)
    profile = next(
        (item for item in ProtocolProfileRegistry.bundled().profiles if item.profile_id == profile_id), None,
    )
    if profile is None:
        raise ValueError("Real DSH probe profile is unavailable")
    resolved_executable = shutil.which(command[0]) if not Path(command[0]).is_absolute() else command[0]
    if resolved_executable is None:
        raise FileNotFoundError(f"Real DSH probe executable was not found: {command[0]}")
    executable = Path(resolved_executable).resolve(strict=True)
    spec = HarnessProcessSpec.create(
        [str(executable), *command[1:]], cwd=workspace, inherited_environment=os.environ,
        managed_environment={"DSH_CWD": str(workspace), "DSH_SESSION_ROOT": str(state / "native-sessions")},
    )
    supervisor = HarnessProcessSupervisor(spec)
    process = await supervisor.start()
    try:
        driver = HarnessSdkDriver(process.peer, contract_sha256=profile.native_contract_sha256)
        identity = await driver.initialize(cwd=workspace, provider=provider, model=model)
        decision = ProtocolProfileRegistry.bundled().decide(
            server_name=identity.server_name, version=identity.server_version,
            native_contract_sha256=identity.contract_sha256, methods=identity.methods,
            notifications=identity.notifications, capabilities=identity.capabilities,
        )
        return {
            "schema_version": 1,
            "probed_at": datetime.now(UTC).isoformat(),
            "source_commit": source_commit,
            "carrier": {
                "kind": "development-node" if executable.name.lower().startswith("node") else "executable",
                "executable_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
                "platform": os.name,
            },
            "native_identity": {
                "server_name": identity.server_name, "server_version": identity.server_version,
                "contract_sha256": identity.contract_sha256,
                "methods": sorted(identity.methods), "notifications": sorted(identity.notifications),
                "capabilities": sorted(identity.capabilities),
            },
            "compatibility": {
                "state": decision.state, "reason": decision.reason,
                "profile_id": decision.profile.profile_id if decision.profile else None,
                "missing_methods": list(decision.missing_methods),
                "missing_notifications": list(decision.missing_notifications),
                "missing_capabilities": list(decision.missing_capabilities),
            },
            "production_eligible": decision.available and executable.name.lower() != "node.exe",
        }
    finally:
        await supervisor.close()


def atomic_write_probe(path: Path, evidence: dict[str, Any]) -> None:
    destination = path.resolve(strict=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.write_text(
        json.dumps(evidence, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, destination)
