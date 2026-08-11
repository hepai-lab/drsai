import json
from pathlib import Path

import pytest

from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


def envelope(**overrides: object) -> RuntimeEnvelope:
    values = {
        "message_type": MessageType.START_RUN,
        "request_id": "request-1",
        "run_id": "run-1",
        "session_id": "session-1",
        "sequence": 0,
        "idempotency_key": "start:run-1",
        "payload": {"input": "你好"},
    }
    values.update(overrides)
    return RuntimeEnvelope(**values)


def test_envelope_round_trip_is_canonical() -> None:
    original = envelope()
    encoded = original.to_json()

    assert RuntimeEnvelope.from_json(encoded) == original
    assert json.loads(encoded)["protocol_version"] == 1
    assert "你好" in encoded


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"protocol_version": 2}, "unsupported_protocol_version"),
        ({"request_id": ""}, "request_id_invalid"),
        ({"sequence": -1}, "sequence_invalid"),
        ({"idempotency_key": ""}, "idempotency_key_invalid"),
        ({"payload": []}, "payload_must_be_object"),
    ],
)
def test_envelope_rejects_invalid_boundary(overrides: dict[str, object], code: str) -> None:
    with pytest.raises(ValueError, match=code):
        envelope(**overrides)


def test_envelope_rejects_unknown_fields_and_message_types() -> None:
    value = envelope().to_dict()
    value["secret"] = "must-not-cross-boundary"
    with pytest.raises(ValueError, match="envelope_fields_invalid"):
        RuntimeEnvelope.from_dict(value)

    value.pop("secret")
    value["message_type"] = "shell_request"
    with pytest.raises(ValueError, match="message_type_invalid"):
        RuntimeEnvelope.from_dict(value)


def test_shared_golden_fixture_round_trips_without_drift() -> None:
    fixture = (
        Path(__file__).parents[4]
        / "protocol"
        / "android-runtime"
        / "fixtures"
        / "envelope-v1.json"
    )
    raw = json.loads(fixture.read_text(encoding="utf-8"))

    decoded = RuntimeEnvelope.from_dict(raw)

    assert decoded.message_type is MessageType.START_RUN
    assert decoded.payload["artifact_ids"] == ["artifact-opaque-1"]
    assert decoded.to_dict() == raw
