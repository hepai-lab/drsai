from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from drsai.relay.generated_contract import (
    CAPABILITIES,
    CAPABILITY_PROFILES,
    MINIMUM_VERSIONS,
    SESSION_EVENT_KINDS,
)
from drsai.relay.models import (
    ConversationSnapshot,
    RuntimeCapabilities,
    RuntimeIdentity,
    RuntimeSessionEventFrame,
    RuntimeSummary,
    SessionEvent,
)


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
        "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
        "oaep.session.events.stream",
    }.issubset(schema["x-relay-capabilities"])


def test_v2_schema_freezes_hai_http_over_wss_frames() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    definitions = schema["$defs"]
    assert definitions["runtime_http_request_frame"]["properties"]["type"]["const"] == "request"
    assert definitions["runtime_http_response_frame"]["properties"]["type"]["const"] == "response"
    assert definitions["runtime_heartbeat_frame"]["properties"]["type"]["const"] == "heartbeat"
    assert definitions["runtime_event_frame"]["properties"]["event"]["$ref"] == "#/$defs/event"


def test_session_event_profile_is_declared_but_not_advertised_before_runtime_support() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    profile = schema["x-relay-capability-profiles"]["session-events/1"]
    assert set(profile) == {
        "conversation.snapshot",
        "session.event.resume",
        "session.event.stream",
        "session.event.cursor_expired",
    }
    assert CAPABILITY_PROFILES["session-events/1"] == frozenset(profile)
    assert CAPABILITY_PROFILES["session-events/1"].isdisjoint(CAPABILITIES)
    assert MINIMUM_VERSIONS["session-events/1"] == {
        "runtime": "1.5.3",
        "android": "1.5.3",
        "desktop": "1.5.3",
    }
    assert set(schema["x-session-event-kinds"]) == SESSION_EVENT_KINDS
    oaep_profile = schema["x-relay-capability-profiles"]["oaep/1"]
    assert set(oaep_profile) == {
        "oaep.v1",
        "oaep.session.snapshot",
        "oaep.session.events",
        "oaep.session.events.stream",
        "event.cursor_expired",
    }
    assert CAPABILITY_PROFILES["oaep/1"] == frozenset(oaep_profile)
    assert CAPABILITY_PROFILES["oaep/1"].issubset(CAPABILITIES)
    assert MINIMUM_VERSIONS["oaep/1"] == {
        "runtime": "1.6.0",
        "android": "1.5.6",
        "desktop": "1.6.0",
    }
    assert schema["x-relay-capability-profiles"]["oaep.session-stream/1"] == oaep_profile
    assert schema["x-relay-minimum-versions"]["oaep.session-stream/1"] == {
        "runtime": "1.6.0",
        "android": "1.5.6",
        "desktop": "1.6.0",
    }


def test_relay_oaep_frame_accepts_oaep_and_rejects_legacy_session_shape() -> None:
    schema = json.loads(
        (ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(
            encoding="utf-8"
        )
    )
    oaep_schema = json.loads(
        (ROOT / "cores/protocol/oaep/oaep.schema.json").read_text(encoding="utf-8")
    )
    raw_fixture = json.loads(
        (ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8")
    )
    event = next(item for item in raw_fixture["events"] if item["type"] == "event.item.delta")
    frame_schema = json.loads(json.dumps(schema["$defs"]["runtime_oaep_event_frame"]))
    frame_schema["properties"]["event"] = {"$ref": "#/$defs/event"}
    validator = Draft202012Validator({**frame_schema, "$defs": oaep_schema["$defs"]})
    frame = {
        "type": "event",
        "protocol": "oaep/1",
        "scope": "session",
        "runtime_id": "runtime-1",
        "workspace_id": "workspace-1",
        "session_id": event["session_id"],
        "sequence": event["sequence"],
        "event": event,
    }
    validator.validate(frame)

    legacy = {
        "event_id": "legacy-1",
        "runtime_id": "runtime-1",
        "workspace_id": "workspace-1",
        "session_id": event["session_id"],
        "run_id": event["run_id"],
        "session_sequence": event["sequence"],
        "kind": "conversation.item.delta",
        "timestamp": event["timestamp"],
        "payload": {"delta": "legacy"},
    }
    forged = {**frame, "event": legacy}
    assert list(validator.iter_errors(forged))


def test_session_conversation_fixture_validates_snapshot_event_and_runtime_frame() -> None:
    schema = json.loads((ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
    fixture = json.loads(
        (ROOT / "cores/protocol/relay/session-conversation-fixtures.json").read_text(encoding="utf-8")
    )
    definitions = schema["$defs"]
    resolver_schema = {
        "$schema": schema["$schema"],
        "$defs": definitions,
        "$ref": "#/$defs/conversation_snapshot",
    }
    Draft202012Validator(resolver_schema).validate(fixture["snapshot"])
    event_schema = {
        "$schema": schema["$schema"],
        "$defs": definitions,
        "$ref": "#/$defs/session_event",
    }
    frame_schema = {
        "$schema": schema["$schema"],
        "$defs": definitions,
        "$ref": "#/$defs/runtime_session_event_frame",
    }
    event_validator = Draft202012Validator(event_schema)
    for event in fixture["events_after_snapshot"]:
        event_validator.validate(event)
    Draft202012Validator(frame_schema).validate(fixture["runtime_frame"])

    snapshot = ConversationSnapshot.model_validate(fixture["snapshot"])
    events = [SessionEvent.model_validate(item) for item in fixture["events_after_snapshot"]]
    frame = RuntimeSessionEventFrame.model_validate(fixture["runtime_frame"])
    assert snapshot.snapshot_sequence == 3
    assert [item.session_sequence for item in events] == [4, 5]
    assert frame.session_sequence == frame.event.session_sequence == 4


def test_session_contract_rejects_revision_regression_unknown_kind_and_cross_sequence_frame() -> None:
    fixture = json.loads(
        (ROOT / "cores/protocol/relay/session-conversation-fixtures.json").read_text(encoding="utf-8")
    )
    invalid_item = dict(fixture["snapshot"]["items"][0], revision=0)
    try:
        ConversationSnapshot.model_validate(
            dict(fixture["snapshot"], items=[invalid_item])
        )
    except ValueError:
        pass
    else:
        raise AssertionError("revision=0 must be rejected")

    invalid_event = dict(fixture["events_after_snapshot"][0], kind="unknown")
    try:
        SessionEvent.model_validate(invalid_event)
    except ValueError:
        pass
    else:
        raise AssertionError("unknown Session Event kind must be rejected")

    invalid_frame = dict(fixture["runtime_frame"], session_sequence=99)
    try:
        RuntimeSessionEventFrame.model_validate(invalid_frame)
    except ValueError:
        pass
    else:
        raise AssertionError("frame and event session_sequence must match")


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
