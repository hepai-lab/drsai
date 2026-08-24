from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from types import SimpleNamespace

from drsai.backend import gateway


def test_runtime_identity_binds_gateway_process_to_loaded_source(monkeypatch) -> None:
    digest = hashlib.sha256()
    # The gateway is now a package (``backend/gateway/__init__.py``) that
    # re-executes the legacy monolith source (``backend/gateway_legacy.py``)
    # into its own namespace during the modular-split scaffolding. Compute the
    # ``backend/`` root the same way the digest function does: ``__file__`` is
    # the package init, so walk up two parents to reach ``backend/``.
    _here = Path(gateway.__file__).resolve()
    backend_root = _here.parent if _here.name == "gateway_legacy.py" else _here.parent.parent
    for logical in sorted(gateway._RUNTIME_EVIDENCE_SOURCE_FILES):
        if logical.endswith("/backend/gateway_legacy.py"):
            location = backend_root / "gateway_legacy.py"
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
