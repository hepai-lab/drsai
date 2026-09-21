from __future__ import annotations

import json

import pytest

from opendrsai_dsh_runtime.contracts import runtime_protocol_description
from opendrsai_dsh_runtime.registration import RuntimeRegistrationError, write_runtime_registration


def test_registration_is_atomic_secret_free_and_recoverably_removed(tmp_path) -> None:
    token = "secret-token-" + "x" * 36
    lease = write_runtime_registration(
        registry_root=tmp_path,
        base_url="http://127.0.0.1:43871",
        initialize_result={"runtime_id": "runtime-dsh", "protocols": runtime_protocol_description()},
        bearer_token=token,
    )
    manifest = json.loads(lease.manifest_path.read_text(encoding="utf-8"))
    assert manifest["agent"]["id"] == "runtime:deepseek-harness"
    assert manifest["endpoint"]["bearer_token_file"] == str(lease.token_path)
    assert token not in lease.manifest_path.read_text(encoding="utf-8")
    assert lease.token_path.read_text(encoding="utf-8") == token
    assert not list(tmp_path.glob("*.tmp"))

    lease.close()
    assert not lease.manifest_path.exists()
    assert not lease.token_path.exists()
    lease.close()


@pytest.mark.parametrize("url", [
    "http://0.0.0.0:43871", "http://example.com:43871", "https://127.0.0.1:43871", "http://127.0.0.1",
    "http://user:password@127.0.0.1:43871",
])
def test_registration_rejects_non_loopback_or_ambiguous_endpoint(tmp_path, url) -> None:
    with pytest.raises(RuntimeRegistrationError, match="loopback"):
        write_runtime_registration(
            registry_root=tmp_path,
            base_url=url,
            initialize_result={"runtime_id": "runtime-dsh", "protocols": runtime_protocol_description()},
        )


def test_registration_rejects_protocol_drift_before_writing(tmp_path) -> None:
    protocols = runtime_protocol_description()
    protocols["oaep"]["schema_sha256"] = "0" * 64
    with pytest.raises(RuntimeRegistrationError, match="protocol"):
        write_runtime_registration(
            registry_root=tmp_path,
            base_url="http://127.0.0.1:43871",
            initialize_result={"runtime_id": "runtime-dsh", "protocols": protocols},
        )
    assert not list(tmp_path.iterdir())
