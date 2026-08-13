from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_device_proof_lifecycle.py"
    spec = importlib.util.spec_from_file_location("p6_device_proof_lifecycle", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_device_proof_lifecycle_is_atomic_and_fail_closed() -> None:
    assert _module().verify() == {
        "android_wrapped_key": True,
        "stable_device_identity": True,
        "atomic_rotation": True,
        "nonce_ttl_seconds": 60,
        "nonce_fail_closed": True,
        "passed": True,
    }


def test_live_nonce_eviction_regression_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "registry.py"
    fake.write_text(
        module.REGISTRY.read_text(encoding="utf-8")
        + "\nset(sorted(association.proof_nonces)[-256:])\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "REGISTRY", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure) == "p6_device_proof_live_nonce_eviction_forbidden"
    else:
        raise AssertionError("live nonce eviction must fail closed")
