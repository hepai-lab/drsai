from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_resource_ownership.py"
    spec = importlib.util.spec_from_file_location("p6_resource_ownership", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_resource_graph_is_single_owner_and_bounded() -> None:
    assert _module().verify() == {
        "process_owners": 9,
        "sse_surfaces": 4,
        "page_account_network_cycles": 100,
        "latency_events": 10_000,
        "passed": True,
    }


def test_missing_owner_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteWorkspaceContainer.kt"
    fake.write_text(
        module.CONTAINER.read_text(encoding="utf-8").replace(
            'resourceLeases.registerOwner("database", database)', "",
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "CONTAINER", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure) == "p6_resource_owner_missing:database:1"
    else:
        raise AssertionError("missing process owner must fail closed")
