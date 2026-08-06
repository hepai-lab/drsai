from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from types import SimpleNamespace

from drsai.backend import gateway


def test_runtime_identity_binds_gateway_process_to_loaded_source(monkeypatch) -> None:
    digest = hashlib.sha256()
    backend_root = Path(gateway.__file__).resolve().parent
    for logical in sorted(gateway._RUNTIME_EVIDENCE_SOURCE_FILES):
        if logical.endswith("/backend/gateway.py"):
            location = backend_root / "gateway.py"
        elif logical.endswith("/backend/run_drsai_agent_factory.py"):
            location = backend_root / "run_drsai_agent_factory.py"
        elif logical.endswith("/config/model_registry.py"):
            location = backend_root.parent / "config" / "model_registry.py"
        elif "/backend/runtime/" in logical:
            location = backend_root / "runtime" / logical.rsplit("/", 1)[-1]
        else:
            location = backend_root.parent / "modules" / "agents" / "skills_agent" / logical.rsplit("/", 1)[-1]
        digest.update(logical.encode("utf-8"))
        digest.update(b"\0")
        digest.update(location.read_bytes())
        digest.update(b"\0")

    assert gateway._RUNTIME_EVIDENCE_SOURCE_DIGEST == digest.hexdigest()
    monkeypatch.setattr(gateway, "_runtime_registry", lambda: SimpleNamespace(
        identity=SimpleNamespace(runtime_id="runtime-test", instance_id="instance-test")))
    identity = asyncio.run(gateway.runtime_identity())
    assert identity["runtime_source_digest"] == digest.hexdigest()
