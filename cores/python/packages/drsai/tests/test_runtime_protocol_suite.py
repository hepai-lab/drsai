from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SUITE = ROOT / "cores" / "protocol" / "runtime" / "runtime-protocol-suite.json"
OAEP = ROOT / "cores" / "protocol" / "oaep" / "oaep.schema.json"
OWOP = ROOT / "cores" / "protocol" / "owop" / "owop.schema.json"
RELAY = ROOT / "cores" / "protocol" / "relay" / "runtime-relay.schema.json"


def test_runtime_protocol_suite_freezes_orthogonal_authorities() -> None:
    suite = json.loads(SUITE.read_text(encoding="utf-8"))
    protocols = suite["protocols"]
    assert set(protocols) == {"oaep", "owop", "control", "relay"}
    assert protocols["oaep"]["authority"] == "agent_session_facts"
    assert protocols["owop"]["authority"] == "workspace_resources_and_operations"
    assert protocols["control"]["authority"] == "runtime_commands"
    assert protocols["relay"]["authority"] == "transport_and_access"
    assert "workspace_operations" in protocols["oaep"]["does_not_own"]
    assert "agent_session_history" in protocols["owop"]["does_not_own"]
    assert "backend_event_mapping" in protocols["relay"]["does_not_own"]


def test_runtime_protocol_suite_versions_match_authoritative_schemas() -> None:
    suite = json.loads(SUITE.read_text(encoding="utf-8"))
    oaep = json.loads(OAEP.read_text(encoding="utf-8"))
    owop = json.loads(OWOP.read_text(encoding="utf-8"))
    relay = json.loads(RELAY.read_text(encoding="utf-8"))
    assert suite["protocols"]["oaep"]["version"] == oaep["version"]
    assert suite["protocols"]["owop"]["version"] == owop["version"]
    assert suite["protocols"]["relay"]["version"] == relay["version"]


def test_oaep_profile_freezes_session_event_and_run_item_sequences() -> None:
    suite = json.loads(SUITE.read_text(encoding="utf-8"))
    oaep = json.loads(OAEP.read_text(encoding="utf-8"))
    profile = oaep["x-oaep-profiles"]["oaep.session-stream/1"]
    assert profile == {
        "event_sequence_scope": "session",
        "item_sequence_scope": "run",
        "cursor_semantics": "exclusive",
    }
    assert suite["sequence_scopes"]["oaep_event_sequence"] == "session"
    assert suite["sequence_scopes"]["oaep_item_sequence"] == "run"
    assert suite["client_negotiation_order"][:2] == [
        "oaep.session-stream/1",
        "session-events/1",
    ]


def test_shared_identifiers_are_minimal_and_protocol_scoped() -> None:
    suite = json.loads(SUITE.read_text(encoding="utf-8"))
    identifiers = suite["shared_identifiers"]
    assert identifiers["runtime_id"] == ["oaep", "owop", "control", "relay"]
    assert identifiers["session_id"] == ["oaep", "control", "relay"]
    assert identifiers["item_id"] == ["oaep"]
    assert identifiers["operation_id"] == ["oaep", "owop"]
    assert identifiers["resource_ref"] == ["oaep", "owop"]
