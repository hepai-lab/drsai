from __future__ import annotations

import json
from pathlib import Path

from drsai.backend.runtime.agent_kernel import select_relevant_memories


def test_frozen_relevant_irrelevant_and_adversarial_memory_dataset() -> None:
    repo = Path(__file__).parents[5]
    fixture = json.loads((repo / "cores/protocol/android-runtime/fixtures/p9-memory-selection-v1.json").read_text(encoding="utf-8"))
    assert fixture["schema_version"] == "opendrsai.p9-memory-selection/1"
    true_positive = expected_total = selected_total = 0
    for case in fixture["cases"]:
        result = select_relevant_memories(case["query"], case["candidates"])
        observed = [item["id"] for item in result["selected"]]
        expected = case["expected"]
        true_positive += len(set(observed).intersection(expected))
        expected_total += len(expected)
        selected_total += len(observed)
        if "expected_omitted" in case:
            omitted = {item["id"]: item["reason"] for item in result["omitted"]}
            for memory_id, reason in case["expected_omitted"].items():
                assert omitted[memory_id] == reason
        if case["id"] == "stable-order":
            assert observed == expected
    recall = true_positive / expected_total
    precision = true_positive / selected_total
    assert recall >= fixture["minimum_recall"]
    assert precision >= fixture["minimum_precision"]
