from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

import verify_p6_p5_legacy_transition as verifier


def _manifest() -> dict:
    return json.loads(verifier.DEFAULT_MANIFEST.read_text(encoding="utf-8"))


def _write(tmp_path: Path, value: dict) -> Path:
    path = tmp_path / "migration.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_all_48_p5_features_are_partitioned_and_15_pending_have_one_p6_owner() -> None:
    report = verifier.verify()
    assert report == {
        "schema_version": "p5-to-p6-transition-report/1",
        "source_feature_count": 48,
        "completed_p5_feature_count": 33,
        "pending_p5_feature_count": 15,
        "mapped_p6_owner_count": 12,
        "required_evidence_counts": {
            "human": 1, "local": 0, "physical": 14,
            "production": 10, "release": 2,
        },
        "completion_inherited": False,
        "pending_evidence_carried": True,
        "passed": True,
    }


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda value: value["pending_mappings"].pop(), "p6_p5_transition_partition_invalid"),
        (lambda value: value["pending_mappings"].__setitem__(
            1, deepcopy(value["pending_mappings"][0])
        ), "p6_p5_transition_duplicate_or_overlap"),
        (lambda value: value["policy"].__setitem__("inherit_completion", True),
         "p6_p5_transition_policy_invalid"),
        (lambda value: value["pending_mappings"][0].__setitem__(
            "p6_owner", "P6-M09-F01"
        ), "p6_p5_transition_mapping_invalid"),
        (lambda value: value["pending_mappings"][0].__setitem__(
            "required_evidence", []
        ), "p6_p5_transition_mapping_invalid"),
    ],
)
def test_missing_duplicate_promoted_or_invalid_mapping_fails_closed(
    tmp_path: Path, mutate, code: str,
) -> None:
    value = _manifest()
    mutate(value)
    with pytest.raises(verifier.P5TransitionError, match=code):
        verifier.verify(_write(tmp_path, value))


def test_duplicate_json_key_fails_closed(tmp_path: Path) -> None:
    source = verifier.DEFAULT_MANIFEST.read_text(encoding="utf-8")
    duplicate = source.replace(
        '"schema_version": "p5-to-p6-migration/1",',
        '"schema_version": "p5-to-p6-migration/1",\n'
        '  "schema_version": "p5-to-p6-migration/1",',
        1,
    )
    path = tmp_path / "duplicate.json"
    path.write_text(duplicate, encoding="utf-8")
    with pytest.raises(
        verifier.P5TransitionError,
        match="p6_p5_transition_manifest_duplicate_key",
    ):
        verifier.verify(path)
