import json
from pathlib import Path

import jsonschema


ROOT = Path(__file__).parents[1]


def test_p5_platform_contract_is_self_consistent_and_content_free() -> None:
    contract = json.loads((ROOT / "cores/protocol/relay/p5-platform-adapter.contract.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(contract)
    assert contract["version"] == "p5-platform/1"
    catalog = contract["$defs"]["session_catalog_event"]
    push = contract["$defs"]["opaque_push_payload"]
    for schema in (catalog, push):
        encoded = json.dumps(schema, sort_keys=True).lower()
        assert not any(key in encoded for key in ('"message"', '"command"', '"path"', '"token"', '"subject"'))


def test_frozen_examples_validate_and_extra_content_fails_closed() -> None:
    contract = json.loads((ROOT / "cores/protocol/relay/p5-platform-adapter.contract.json").read_text(encoding="utf-8"))
    catalog = jsonschema.Draft202012Validator({
        "$defs": contract["$defs"], "$ref": "#/$defs/session_catalog_event",
    })
    catalog.validate({"event_id": "event", "session_id": "session", "type": "event.session.updated", "sequence": 1})
    errors = list(catalog.iter_errors({"event_id": "event", "session_id": "session", "type": "event.session.updated",
                                      "sequence": 1, "message": "forbidden"}))
    assert errors


def test_protocol_deletion_decision_is_low_dimension_and_fail_closed() -> None:
    contract = json.loads((ROOT / "cores/protocol/relay/p5-platform-adapter.contract.json").read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator({
        "$defs": contract["$defs"], "$ref": "#/$defs/protocol_deletion_decision",
    })
    base = {
        "schema_version": "p5-protocol-deletion-decision/1", "status": "no_data",
        "data_start": None, "data_end": None, "observation_days": 0, "release_cycles": 0,
        "oaep_ratio": 0.0, "legacy_ratio": 0.0, "migration_ratio": None,
        "fallback_error_ratio": 0.0, "gap_days": 0,
        "requirements": {"observation_days": 0, "release_cycles": 0, "oaep_ratio": 0.999,
                         "legacy_ratio": 0.001, "migration_ratio": 1.0,
                         "fallback_error_ratio": 0.001},
        "eligible": False,
    }
    validator.validate(base)
    assert list(validator.iter_errors({**base, "eligible": True}))
    eligible = {
        **base, "status": "eligible", "data_start": "2026-07-01", "data_end": "2026-07-01",
        "observation_days": 1, "release_cycles": 0, "oaep_ratio": 0.999,
        "legacy_ratio": 0.0009, "migration_ratio": 1.0,
        "fallback_error_ratio": 0.001, "gap_days": 7, "eligible": True,
    }
    validator.validate(eligible)
    assert list(validator.iter_errors({**eligible, "legacy_ratio": 0.001}))
    assert list(validator.iter_errors({**base, "subject": "forbidden"}))
    encoded = json.dumps(contract["$defs"]["protocol_deletion_decision"], sort_keys=True).lower()
    assert not any(key in encoded for key in ('"subject"', '"workspace"', '"session"', '"message"', '"path"'))
