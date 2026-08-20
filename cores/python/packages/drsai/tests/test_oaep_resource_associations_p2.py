from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError

from drsai.oaep.resource_associations import (
    MAPPING_VERSION,
    ResourceAssociationMigrationError,
    canonical_projection_bytes,
    migrate_p1_snapshot,
    project_p2_resources,
)


ROOT = Path(__file__).resolve().parents[5]
SCHEMA = ROOT / "cores" / "protocol" / "oaep" / "oaep.schema.json"
P1_FIXTURE = ROOT / "cores" / "protocol" / "oaep" / "conversation-resources-p1.fixture.json"
P2_FIXTURE = ROOT / "cores" / "protocol" / "oaep" / "conversation-resources-p2.fixture.json"


@pytest.fixture(scope="module")
def schema() -> dict[str, object]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def validator(schema: dict[str, object], definition: str) -> Draft202012Validator:
    return Draft202012Validator({"$defs": schema["$defs"], "$ref": f"#/$defs/{definition}"})


def test_resource_key_rejects_association_or_host_fields(schema: dict[str, object]) -> None:
    key = {
        "protocol": "owop/1", "authority_id": "runtime-1", "workspace_id": "workspace-1",
        "resource_type": "file", "resource_id": "file-1", "generation": 1,
    }
    validator(schema, "resourceKey").validate(key)
    for forbidden in ("path", "capabilities", "relation", "locator", "presentation"):
        with pytest.raises(ValidationError):
            validator(schema, "resourceKey").validate({**key, forbidden: "forbidden"})


def test_p2_association_and_parts_are_strict(schema: dict[str, object]) -> None:
    association = {
        "association_id": "assoc-1",
        "resource": {
            "protocol": "owop/1", "authority_id": "runtime-1", "workspace_id": "workspace-1",
            "resource_type": "file", "resource_id": "file-1", "generation": 1,
        },
        "relation": "input_reference", "label_snapshot": "Plan.md", "presentation": "inline",
        "locator": {"kind": "text_range", "line": 1, "column": 1, "end_line": 2, "end_column": 4},
    }
    validator(schema, "resourceAssociation").validate(association)
    with pytest.raises(ValidationError):
        validator(schema, "resourceAssociation").validate({key: value for key, value in association.items() if key != "relation"})
    validator(schema, "messagePartV2").validate({"part_id": "part-1", "type": "resource", "association_id": "assoc-1"})
    for invalid in (
        {"part_id": "part-1", "type": "resource", "association_id": "assoc-1", "text": "bad"},
        {"part_id": "part-1", "type": "text"},
        {"part_id": "part-1", "type": "unknown"},
    ):
        with pytest.raises(ValidationError):
            validator(schema, "messagePartV2").validate(invalid)


def test_p1_migration_is_non_mutating_deterministic_and_idempotent(schema: dict[str, object]) -> None:
    original = json.loads(P1_FIXTURE.read_text(encoding="utf-8"))
    before = copy.deepcopy(original)
    first = migrate_p1_snapshot(original, authority_id="runtime-local-1")
    second = migrate_p1_snapshot(first, authority_id="runtime-local-1")
    assert original == before
    assert canonical_projection_bytes(first) == canonical_projection_bytes(second)
    assert first["mapping_version"] == MAPPING_VERSION
    validator(schema, "snapshot").validate(first)

    message, change, artifact = first["items"]
    assert [part["type"] for part in message["content"]["parts"]] == ["text", "resource", "text"]
    assert message["content"]["parts"][1]["association_id"] == message["associations"][0]["association_id"]
    assert change["content"]["changes"][0]["association_id"] == change["associations"][0]["association_id"]
    assert artifact["content"]["association_id"] == artifact["associations"][0]["association_id"]
    assert all(item.get("source", {}).get("mapping_version") == MAPPING_VERSION for item in first["items"])


def test_same_resource_multiple_associations_are_not_identity_deduplicated() -> None:
    original = json.loads(P1_FIXTURE.read_text(encoding="utf-8"))
    message = original["items"][0]
    duplicate = copy.deepcopy(message["content"]["parts"][1])
    duplicate["resource_ref"]["locator"] = {"kind": "page", "page": 2}
    message["content"]["parts"].insert(2, duplicate)
    migrated = migrate_p1_snapshot(original, authority_id="runtime-local-1")
    associations = migrated["items"][0]["associations"]
    assert len(associations) == 2
    assert associations[0]["resource"] == associations[1]["resource"]
    assert associations[0]["association_id"] != associations[1]["association_id"]
    assert associations[0].get("locator") != associations[1].get("locator")


@pytest.mark.parametrize("field,value", [
    ("label_snapshot", "<script>attack</script>" + "x" * 513),
    ("operation_id", "o" * 257),
])
def test_projector_rejects_untrusted_oversized_display_fields(field: str, value: str) -> None:
    fixture = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
    fixture["items"][0]["associations"][0][field] = value
    projection = project_p2_resources(fixture)
    assert all(association.get(field) != value for association in projection["associations"])
    assert any(item["code"] == "association_invalid" for item in projection["diagnostics"])


def test_projector_rejects_oversized_mime_and_locator_strings() -> None:
    fixture = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
    association = fixture["items"][0]["associations"][0]
    association["version_snapshot"]["mime_type"] = "m" * 257
    association["locator"] = {"kind": "sheet_cell", "sheet": "s" * 256, "cell": "A1"}
    projection = project_p2_resources(fixture)
    assert association["association_id"] not in {item["association_id"] for item in projection["associations"]}


def test_reader_ignores_unknown_optional_association_metadata_but_required_semantics_fail_closed() -> None:
    fixture = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
    association = fixture["items"][0]["associations"][0]
    association["future_display_hint"] = {"density": "compact"}
    association["version_snapshot"]["future_cache_hint"] = 30
    projected = project_p2_resources(fixture)
    parsed = next(item for item in projected["associations"] if item["association_id"] == association["association_id"])
    assert "future_display_hint" not in parsed
    assert "future_cache_hint" not in parsed["version_snapshot"]

    association["relation"] = "future_required_relation"
    rejected = project_p2_resources(fixture)
    assert association["association_id"] not in {item["association_id"] for item in rejected["associations"]}


def test_migration_requires_authoritative_session_binding() -> None:
    original = json.loads(P1_FIXTURE.read_text(encoding="utf-8"))
    with pytest.raises(ResourceAssociationMigrationError, match="authority_binding_required"):
        migrate_p1_snapshot(original, authority_id=None)


def test_p1_reader_rollback_switch_never_restores_legacy_writes(monkeypatch) -> None:
    legacy = json.loads(P1_FIXTURE.read_text(encoding="utf-8"))
    monkeypatch.setenv("OPENDRSAI_OAEP_P1_READER", "disabled")
    with pytest.raises(ResourceAssociationMigrationError, match="p1_reader_disabled"):
        migrate_p1_snapshot(legacy, authority_id="runtime-local-1")

    # A P2-only snapshot remains readable when the compatibility reader is off.
    p2 = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))["snapshot"]
    projected = migrate_p1_snapshot(p2, authority_id="runtime-local-1")
    assert all("resource_refs" not in item.get("content", {}) for item in projected["items"])

    # Rollback restores only the in-memory reader and always emits P2.
    monkeypatch.setenv("OPENDRSAI_OAEP_P1_READER", "enabled")
    restored = migrate_p1_snapshot(legacy, authority_id="runtime-local-1")
    assert all("resource_refs" not in item.get("content", {}) for item in restored["items"])
    assert all(item.get("associations") for item in restored["items"])


def test_shared_p2_conformance_fixture_is_valid_and_preserves_duplicate_identity(schema: dict[str, object]) -> None:
    fixture = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))
    snapshot = fixture["snapshot"]
    validator(schema, "snapshot").validate(snapshot)
    associations = [association for item in snapshot["items"] for association in item.get("associations", [])]
    assert [association["association_id"] for association in associations] == fixture["expected_association_ids"]
    assert associations[0]["resource"] == associations[1]["resource"]
    assert associations[0]["locator"] != associations[1]["locator"]
    assert snapshot["items"][1]["associations"][0]["operation_id"] == "operation-publish-report"
    projection = project_p2_resources(snapshot)
    assert [association["association_id"] for association in projection["associations"]] == fixture["expected_association_ids"]
    assert [part["type"] for part in projection["partsByItem"]["message-resource-p2"]] == fixture["expected_message_part_types"]


def test_unknown_part_has_safe_unsupported_projection_without_object_stringification() -> None:
    fixture = json.loads(P2_FIXTURE.read_text(encoding="utf-8"))
    fixture["snapshot"]["items"][0]["content"]["parts"].append({
        "part_id": "part-unknown", "type": "future_object", "opaque": {"secret": True},
    })
    projection = project_p2_resources(fixture["snapshot"])
    assert projection["partsByItem"]["message-resource-p2"][-1] == {
        "part_id": "part-unknown", "type": "unsupported", "wire_type": "future_object",
    }
    assert b"secret" not in canonical_projection_bytes(projection)
