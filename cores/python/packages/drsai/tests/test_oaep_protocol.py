from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from drsai.oaep.protocol import OAEPStreamValidator, OAEPValidationError
from drsai.backend.runtime.oaep import _safe_text


ROOT = Path(__file__).resolve().parents[5]
SCHEMA = ROOT / "cores" / "protocol" / "oaep" / "oaep.schema.json"
EXAMPLES = ROOT / "cores" / "protocol" / "oaep" / "examples.json"


def test_runtime_oaep_preserves_public_error_code_but_redacts_credentials() -> None:
    safe = _safe_text('{"error_code":"service_unavailable","api_key":"secret-value"}')
    assert "service_unavailable" in safe
    assert "secret-value" not in safe


def _fixture_ref(data: dict[str, Any], ref: str) -> Any:
    match = re.fullmatch(r"items\[(\d+)\]", ref)
    if not match:
        raise AssertionError(f"Unsupported OAEP fixture reference: {ref}")
    return copy.deepcopy(data["items"][int(match.group(1))])


def _expand_refs(value: Any, fixture: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$ref"} and isinstance(value["$ref"], str):
            return _fixture_ref(fixture, value["$ref"])
        return {key: _expand_refs(child, fixture) for key, child in value.items()}
    if isinstance(value, list):
        return [_expand_refs(child, fixture) for child in value]
    return value


def test_oaep_schema_is_valid_and_examples_cover_core_item_types() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)

    snapshot_validator = Draft202012Validator(
        {"$defs": schema["$defs"], "$ref": "#/$defs/snapshot"}
    )
    snapshot_validator.validate({
        "version": fixture["version"],
        "session": fixture["session"],
        "runs": fixture["runs"],
        "items": fixture["items"],
        "snapshot_sequence": max(event["sequence"] for event in fixture["events"]),
    })
    validator.validate(fixture["session"])
    for run in fixture["runs"]:
        validator.validate(run)
    for item in fixture["items"]:
        validator.validate(item)
    for event in fixture["events"]:
        validator.validate(event)

    item_types = {item["type"] for item in fixture["items"]}
    assert item_types == {
        "message", "reasoning", "plan", "command_execution", "file_change",
        "tool_call", "artifact", "interaction", "subtask", "notice",
    }
    event_types = {event["type"] for event in fixture["events"]}
    assert {"event.item.delta", "event.item.completed", "event.item.failed", "event.run.failed"} <= event_types


def test_oaep_event_page_is_strict_and_uses_event_sequence_cursor() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    page_validator = Draft202012Validator(
        {"$defs": schema["$defs"], "$ref": "#/$defs/eventPage"}
    )
    page = {
        "version": "1.0",
        "object": "list",
        "data": fixture["events"],
        "next_sequence": fixture["events"][-1]["sequence"],
        "has_more": False,
    }
    page_validator.validate(page)
    forged = {**page, "items": page["data"]}
    assert list(page_validator.iter_errors(forged))


def test_oaep_delta_is_only_valid_inside_item_delta_event() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    event_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/event"})
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    completed = next(event for event in fixture["events"] if event["type"] == "event.item.completed")
    forged = copy.deepcopy(completed)
    forged["data"]["delta"] = {"kind": "message.text.append", "text": "illegal"}

    errors = list(event_validator.iter_errors(forged))
    assert errors


def test_future_backend_additive_extensions_are_preserved_and_ignored_safely() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    event = copy.deepcopy(fixture["events"][0])
    event["source"]["future_backend_capability"] = "example.future/1"
    event["data"]["future_backend_metadata"] = {"hint": "optional"}
    event["future_envelope_metadata"] = {"trace_class": "optional"}

    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/event"})
    validator.validate(event)
    round_tripped = json.loads(json.dumps(event))
    assert round_tripped["source"]["future_backend_capability"] == "example.future/1"
    assert round_tripped["data"]["future_backend_metadata"]["hint"] == "optional"
    assert round_tripped["future_envelope_metadata"]["trace_class"] == "optional"


def test_each_oaep_item_content_is_discriminated_by_item_type() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    items = fixture["items"]
    for index, item in enumerate(items):
        validator.validate(item)
        wrong = copy.deepcopy(item)
        wrong["type"] = items[(index + 1) % len(items)]["type"]
        assert list(validator.iter_errors(wrong)), (
            f"{item['type']} content was accepted as {wrong['type']}"
        )


def test_oaep_owop_references_are_bounded_and_never_inline_paths_or_content() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    item = copy.deepcopy(next(value for value in fixture["items"] if value["type"] == "tool_call"))
    item["content"]["operation_ref"] = {
        "protocol": "owop/1",
        "operation_id": "operation-1",
        "workspace_id": "workspace-1",
        "operation": "files.read",
        "correlation_id": "correlation-1",
    }
    item["content"]["resource_refs"] = [{
        "protocol": "owop/1",
        "workspace_id": "workspace-1",
        "resource_type": "artifact",
        "resource_id": "artifact-1",
        "operation_id": "operation-1",
        "digest": "a" * 64,
    }]
    validator.validate(item)

    for forbidden in (
        {"path": "C:/Users/private/file.txt"},
        {"path": "/home/private/file.txt"},
        {"content": "secret body"},
        {"protocol": "ssh/1"},
    ):
        forged = copy.deepcopy(item)
        forged["content"]["resource_refs"][0].update(forbidden)
        assert list(validator.iter_errors(forged))


def test_file_change_rejects_absolute_unc_and_escape_paths() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    template = next(value for value in fixture["items"] if value["type"] == "file_change")
    for path in ("C:/secret.txt", "/home/secret.txt", "\\\\server\\share\\secret.txt", "../secret.txt"):
        forged = copy.deepcopy(template)
        forged["content"]["changes"][0]["path"] = path
        assert list(validator.iter_errors(forged)), path


def test_oaep_stream_validator_rejects_gaps_late_delta_and_duplicate_terminal() -> None:
    raw_fixture = json.loads(EXAMPLES.read_text(encoding="utf-8"))
    fixture = _expand_refs(raw_fixture, raw_fixture)
    started = copy.deepcopy(fixture["events"][0])
    user_completed = copy.deepcopy(fixture["events"][1])

    validator = OAEPStreamValidator()
    validator.accept(started)
    validator.accept(user_completed)

    late_delta = copy.deepcopy(fixture["events"][2])
    late_delta["sequence"] = 3
    late_delta["item_id"] = user_completed["item_id"]
    late_delta["data"]["delta"] = {"kind": "message.text.append", "text": "late"}
    try:
        validator.accept(late_delta)
        raise AssertionError("terminal Item accepted a late delta")
    except OAEPValidationError as exc:
        assert str(exc) == "oaep_item_event_after_terminal"

    gap = OAEPStreamValidator()
    forged_gap = copy.deepcopy(started)
    forged_gap["sequence"] = 2
    try:
        gap.accept(forged_gap)
        raise AssertionError("discontinuous cursor was accepted")
    except OAEPValidationError as exc:
        assert str(exc) == "oaep_sequence_discontinuous"

    terminal = OAEPStreamValidator()
    terminal.accept(started)
    failed = copy.deepcopy(fixture["events"][7])
    failed["sequence"] = 2
    terminal.accept(failed)
    duplicate = copy.deepcopy(failed)
    duplicate["sequence"] = 3
    try:
        terminal.accept(duplicate)
        raise AssertionError("duplicate Run terminal was accepted")
    except OAEPValidationError as exc:
        assert str(exc) == "oaep_run_event_after_terminal"
