from __future__ import annotations

import copy

import pytest

from smoke_runtime_relay_error_actions_p6 import SmokeFailure, canonical_actions, expected_actions


def test_error_action_contract_accepts_shared_mapping() -> None:
    mapping = expected_actions()
    assert len(mapping) == 5
    assert sum(map(len, mapping.values())) == 132
    assert "catalog_order_invalid" in mapping["contact-admin"]


@pytest.mark.parametrize("mutation", ["missing_action", "duplicate", "unsorted", "sensitive"])
def test_error_action_contract_fails_closed(mutation: str) -> None:
    mapping = copy.deepcopy(expected_actions())
    if mutation == "missing_action":
        mapping.pop("update")
    elif mutation == "duplicate":
        mapping["login"].append(mapping["retry"][0])
    elif mutation == "unsorted":
        mapping["retry"] = list(reversed(mapping["retry"]))
    else:
        mapping["message"] = ["leak"]
    with pytest.raises(SmokeFailure):
        canonical_actions(mapping)
