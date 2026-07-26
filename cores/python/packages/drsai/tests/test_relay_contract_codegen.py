from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from drsai.relay.models import RuntimeCapabilities, RuntimeIdentity, RuntimeSummary


ROOT = Path(__file__).resolve().parents[5]


def test_relay_contract_generated_files_have_no_drift() -> None:
    result = subprocess.run([sys.executable, str(ROOT / "scripts/generate_relay_contract.py"), "--check"],
                            cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + result.stdout


def test_relay_openapi_has_no_drift_and_contract_is_backward_compatible() -> None:
    for script in ("generate_relay_openapi.py", "check_relay_contract_compatibility.py"):
        arguments = [sys.executable, str(ROOT / "scripts" / script)]
        if script.startswith("generate"):
            arguments.append("--check")
        result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr + result.stdout


def test_schema_forbids_privilege_and_canonical_path_inputs() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    serialized = json.dumps(schema)
    assert "canonical_path" not in serialized
    assert '"permission"' not in serialized
    assert schema["protocol_version"] == "owop/1"


def test_v2_schema_defines_resource_lifecycle_and_complete_mobile_control_surface() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    assert schema["version"] == "2.0.0"
    assert schema["$defs"]["resource_lifecycle"]["enum"] == ["active", "archived", "removed"]
    assert {
        "association_create", "runtime_connect", "session_read", "conversation_read",
        "run_list", "event_stream", "approval_list", "approval_decision",
        "association_revoke", "runtime_association_list",
        "runtime_association_revoke", "runtime_enrollment_revoke",
    }.issubset(schema["x-relay-endpoints"])
    assert {
        "session.read", "conversation.read", "run.list", "event.stream",
        "event.cursor_expired", "approval.list", "approval.decide",
        "association.revoke", "association.list", "enrollment.revoke",
    }.issubset(schema["x-relay-capabilities"])


def test_v2_schema_freezes_hai_http_over_wss_frames() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    definitions = schema["$defs"]
    assert definitions["runtime_http_request_frame"]["properties"]["type"]["const"] == "request"
    assert definitions["runtime_http_response_frame"]["properties"]["type"]["const"] == "response"
    assert definitions["runtime_heartbeat_frame"]["properties"]["type"]["const"] == "heartbeat"
    assert definitions["runtime_event_frame"]["properties"]["event"]["$ref"] == "#/$defs/event"


def test_v2_schema_freezes_revocation_privacy_and_cursor_expiry_contracts() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    definitions = schema["$defs"]
    assert definitions["subject_summary"]["pattern"] == "^sub_[0-9a-f]{12}$"
    assert definitions["association"]["additionalProperties"] is False
    assert "subject" not in definitions["association"]["properties"]
    assert definitions["access_grant_status"]["properties"]["subject_summary"]["oneOf"][1] == {
        "type": "null"
    }
    cursor = definitions["cursor_expired_error"]["allOf"][1]["properties"]
    assert cursor["code"]["const"] == "cursor_expired"
    assert cursor["retryable"]["const"] is False
    assert cursor["details"]["properties"]["reason"]["const"] == "history_truncated"


def test_shared_runtime_directory_fixture_decodes_with_python_contract() -> None:
    fixture = json.loads(
        (ROOT / "cores/protocol/relay/runtime-directory-fixtures.json").read_text(
            encoding="utf-8"
        )
    )
    item = fixture["runtime_list"]["items"][0]
    summary = RuntimeSummary(
        runtime=RuntimeIdentity.model_validate(item["runtime"]),
        display_name=item["display_name"],
    )
    capabilities = RuntimeCapabilities(values=frozenset(item["capabilities"]))
    assert summary.runtime.runtime_id == "runtime-fixture"
    assert summary.runtime.connection_generation == 7
    assert summary.display_name == "Fixture Windows"
    assert capabilities.values == frozenset({"workspace.list", "session.list"})
    assert "path" not in json.dumps(fixture)
