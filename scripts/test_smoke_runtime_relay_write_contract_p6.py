from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from smoke_runtime_relay_write_contract_p6 import (
    APPROVAL_DECISION,
    APPROVAL_RECOVERY,
    MESSAGE_DELIVERY_RECOVERY,
    RUN_RECOVERY,
    RUN_APPROVAL_RACE_CONSISTENCY,
    RUN_COLLECTION,
    SESSION_COLLECTION,
    SESSION_ITEM,
    SmokeFailure,
    validate_contract,
    validate_message_delivery_recovery,
    validate_run_approval_race_consistency,
)


ROOT = Path(__file__).resolve().parents[1]
DEF_CLASS = {
    "session_create_request": "GeneratedSessionCreateRequest",
    "session_update_request": "GeneratedSessionUpdateRequest",
    "run_create_request": "GeneratedRunCreateRequest",
    "approval_decision_request": "GeneratedApprovalDecisionRequest",
    "session": "GeneratedSessionProjection",
    "run": "GeneratedRunProjection",
    "approval": "GeneratedApprovalProjection",
    "approval_decision_projection": "GeneratedApprovalDecisionProjection",
    "approval_decision_recovery_response": "GeneratedApprovalDecisionRecoveryResponse",
}


def _rewrite_refs(value):
    if isinstance(value, dict):
        return {
            key: (
                "#/components/schemas/" + DEF_CLASS.get(
                    item.removeprefix("#/$defs/"), item.removeprefix("#/$defs/")
                )
                if key == "$ref" and isinstance(item, str)
                else _rewrite_refs(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_rewrite_refs(item) for item in value]
    return value


def fixture() -> dict:
    relay = json.loads(
        (ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8")
    )
    schemas = {
        name: _rewrite_refs(copy.deepcopy(relay["$defs"][source]))
        for source, name in DEF_CLASS.items()
    }

    def operation(request: str | None = None, response: str | None = None):
        value = {"responses": {"200": {"content": {"application/json": {"schema": {
            "$ref": f"#/components/schemas/{response}"
        }}}}}}
        if request:
            value["requestBody"] = {"content": {"application/json": {"schema": {
                "$ref": f"#/components/schemas/{request}"
            }}}}
        return value

    return {
        "components": {"schemas": schemas},
        "paths": {
            SESSION_COLLECTION: {"post": operation("GeneratedSessionCreateRequest", "GeneratedSessionProjection")},
            SESSION_ITEM: {"patch": operation("GeneratedSessionUpdateRequest", "GeneratedSessionProjection")},
            RUN_COLLECTION: {"post": operation("GeneratedRunCreateRequest", "GeneratedRunProjection")},
            APPROVAL_DECISION: {"post": operation("GeneratedApprovalDecisionRequest", "GeneratedApprovalProjection")},
            APPROVAL_RECOVERY: {"get": operation(response="GeneratedApprovalDecisionRecoveryResponse")},
        },
    }


def test_public_write_contract_validator_accepts_generated_schema_shape() -> None:
    refs = validate_contract(fixture())
    assert refs["approval_recovery_resource"] == "GeneratedApprovalDecisionProjection"


def test_message_delivery_recovery_accepts_exact_content_free_contract() -> None:
    validate_message_delivery_recovery({
        "x-message-delivery-recovery": copy.deepcopy(MESSAGE_DELIVERY_RECOVERY),
        "paths": {RUN_RECOVERY: {"get": {}}},
    })


@pytest.mark.parametrize("mutation", [
    lambda value: value["delivery_states"].remove("accepted"),
    lambda value: value.update(runtime_lookup_before_retry=False),
    lambda value: value["scope_binding"].remove("session_id"),
    lambda value: value.update(result_at_rest="plaintext"),
])
def test_message_delivery_recovery_drift_fails_closed(mutation) -> None:
    contract = copy.deepcopy(MESSAGE_DELIVERY_RECOVERY)
    mutation(contract)
    with pytest.raises(SmokeFailure, match="message delivery recovery"):
        validate_message_delivery_recovery({
            "x-message-delivery-recovery": contract,
            "paths": {RUN_RECOVERY: {"get": {}}},
        })


def test_run_approval_race_accepts_exact_content_free_contract() -> None:
    validate_run_approval_race_consistency({
        "x-run-approval-race-consistency": copy.deepcopy(RUN_APPROVAL_RACE_CONSISTENCY)
    })


@pytest.mark.parametrize("mutation", [
    lambda value: value["decisions"].remove("cancel"),
    lambda value: value.update(single_terminal=False),
    lambda value: value.update(mutual_exclusion="relay_best_effort"),
    lambda value: value["scope_binding"].remove("run_id"),
])
def test_run_approval_race_drift_fails_closed(mutation) -> None:
    contract = copy.deepcopy(RUN_APPROVAL_RACE_CONSISTENCY)
    mutation(contract)
    with pytest.raises(SmokeFailure, match="run approval race consistency"):
        validate_run_approval_race_consistency({
            "x-run-approval-race-consistency": contract
        })


def test_public_write_contract_validator_accepts_created_success_status() -> None:
    openapi = fixture()
    operation = openapi["paths"][SESSION_COLLECTION]["post"]
    operation["responses"]["201"] = operation["responses"].pop("200")

    refs = validate_contract(openapi)

    assert refs["session_projection"] == "GeneratedSessionProjection"


@pytest.mark.parametrize("mutation", ["unknown", "missing", "permissive"])
def test_public_write_contract_validator_fails_closed(mutation: str) -> None:
    openapi = fixture()
    schema = openapi["components"]["schemas"]["GeneratedRunCreateRequest"]
    if mutation == "unknown":
        schema["properties"]["unexpected"] = {"type": "string"}
    elif mutation == "missing":
        schema["required"].remove("message")
    else:
        schema["additionalProperties"] = True
    with pytest.raises(SmokeFailure):
        validate_contract(openapi)
