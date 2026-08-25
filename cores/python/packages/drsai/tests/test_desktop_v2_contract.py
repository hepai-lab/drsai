"""M0 gate for the Desktop V2 runtime contract.

Two artifacts have to hold still before any V2 code is written, because both are
joint baselines between the Runtime and the Desktop renderer:

- ``cores/protocol/desktop-v2/runtime-v1.openapi.yaml`` -- the 42-operation HTTP
  surface.
- ``cores/protocol/desktop-v2/fixtures/session-round-v1.json`` -- one complete
  conversation round on the session stream.

:func:`replay` below is deliberately written as the reference reducer. The
renderer has to implement the same fold in TypeScript, and
:func:`test_replaying_the_round_reproduces_the_snapshot` is what pins the two
implementations to one another: if replaying the events does not reproduce the
trailing snapshot, a client that reconnects mid-run will render a different
conversation than one that loaded it fresh, and nothing else in the test suite
would notice.
"""

from __future__ import annotations

import collections
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml

PROTOCOL = Path(__file__).resolve().parents[4] / "protocol"
SPEC_PATH = PROTOCOL / "desktop-v2" / "runtime-v1.openapi.yaml"
FIXTURE_PATH = PROTOCOL / "desktop-v2" / "fixtures" / "session-round-v1.json"
OAEP_SCHEMA_PATH = PROTOCOL / "oaep" / "oaep.schema.json"

HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete"})
EXPECTED_OPERATION_COUNT = 42

# v1 narrows OAEP to these five; the other five stay reserved. A renderer that
# meets an unlisted type must degrade to a notice, never crash.
V1_ITEM_TYPES = frozenset({"message", "reasoning", "tool_call", "artifact", "notice"})


@pytest.fixture(scope="module")
def spec() -> dict[str, Any]:
    return yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def oaep_schema() -> dict[str, Any]:
    return json.loads(OAEP_SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def round_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def operations(spec: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (method.upper(), path, operation)
        for path, item in spec["paths"].items()
        for method, operation in item.items()
        if method in HTTP_METHODS
    ]


def iter_refs(node: Any):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                yield value
            else:
                yield from iter_refs(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_refs(value)


def resolve_pointer(document: Any, pointer: str) -> bool:
    node = document
    for part in pointer.lstrip("/").split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return False
    return True


# --------------------------------------------------------------- OpenAPI spec


def test_spec_declares_the_agreed_operation_count(spec) -> None:
    found = operations(spec)
    assert len(found) == EXPECTED_OPERATION_COUNT, (
        f"Contract drifted to {len(found)} operations. Adding one needs review: "
        "the first question is whether it could be a new item type or tool_call "
        "instead of an endpoint."
    )


def test_every_operation_has_a_unique_operation_id(spec) -> None:
    """operationId is not cosmetic -- the desktop client is generated from it."""
    ids = [operation.get("operationId") for _, _, operation in operations(spec)]
    assert all(ids), "Every operation needs an operationId."
    duplicates = [name for name, count in collections.Counter(ids).items() if count > 1]
    assert not duplicates, f"Duplicate operationIds: {duplicates}"


def test_all_references_resolve(spec, oaep_schema) -> None:
    unresolved = []
    for ref in set(iter_refs(spec)):
        if ref.startswith("#"):
            if not resolve_pointer(spec, ref[1:]):
                unresolved.append(ref)
            continue
        relative, _, pointer = ref.partition("#")
        target = (SPEC_PATH.parent / relative).resolve()
        if not target.exists() or not resolve_pointer(
            json.loads(target.read_text(encoding="utf-8")), pointer
        ):
            unresolved.append(ref)
    assert not unresolved, f"Dangling $ref: {unresolved}"


def test_event_payloads_are_not_redefined(spec) -> None:
    """OAEP stays the single source of truth for anything on the stream."""
    external = {ref for ref in iter_refs(spec) if not ref.startswith("#")}
    assert external, "Session and run payloads must $ref the OAEP schema, not restate it."
    assert all("oaep.schema.json" in ref for ref in external), (
        f"Unexpected external references: {sorted(external)}"
    )


def test_unauthenticated_operations_are_limited_to_the_handshake(spec) -> None:
    """Anything else reachable without a token would be a hole, not a feature."""
    public = {
        path for _, path, operation in operations(spec) if operation.get("security") == []
    }
    assert public == {"/v1/runtime", "/v1/auth/session"}, (
        f"Unexpected unauthenticated operations: {sorted(public)}"
    )


def test_starting_a_run_returns_immediately(spec) -> None:
    """202 plus the session stream is what makes reconnect and background runs work.

    A 200 with a streaming body would couple run output to the request that
    started it, which is the shape v1 exists to get away from.
    """
    operation = spec["paths"]["/v1/sessions/{session_id}/runs"]["post"]
    assert "202" in operation["responses"], "Starting a run must return 202."
    assert "200" not in operation["responses"], (
        "A 200 on this operation means output streams on the request that started "
        "the run, which breaks reconnect, background runs, and multi-window sync."
    )

    body = operation["requestBody"]["content"]["application/json"]["schema"]
    request = resolve_local(spec, body["$ref"]) if "$ref" in body else body
    assert "idempotency_key" in request["required"], (
        "Without an idempotency key a retried submit starts a second run."
    )


def test_history_gap_is_part_of_the_stream_contract(spec) -> None:
    """Reconnect has to be specified in v1; bolting it on later is expensive."""
    for path in (
        "/v1/sessions/{session_id}/events",
        "/v1/sessions/{session_id}/events/stream",
    ):
        operation = spec["paths"][path]["get"]
        assert "409" in operation["responses"], f"{path} must define the history-gap response"
        assert any(
            parameter["$ref"].endswith("AfterSequence")
            for parameter in operation["parameters"]
            if "$ref" in parameter
        ), f"{path} must accept after_sequence"


def resolve_local(spec: dict[str, Any], ref: str) -> dict[str, Any]:
    node: Any = spec
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


# ------------------------------------------------------------- Round fixture


def test_every_event_validates_against_oaep(round_fixture, oaep_schema) -> None:
    validator = jsonschema.Draft202012Validator(oaep_schema)
    for event in round_fixture["events"]:
        errors = sorted(validator.iter_errors(event), key=lambda e: e.path)
        assert not errors, (
            f"Event {event['event_id']} ({event['type']}) violates OAEP: "
            f"{errors[0].message}"
        )


def test_snapshot_validates_against_oaep(round_fixture, oaep_schema) -> None:
    jsonschema.Draft202012Validator(oaep_schema).validate(round_fixture["snapshot"])


def test_round_exercises_every_v1_item_type(round_fixture) -> None:
    """A baseline that skips a type would let a whole rendering path go untested."""
    seen = {
        event["data"]["item"]["type"]
        for event in round_fixture["events"]
        if "item" in event.get("data", {})
    }
    assert seen == V1_ITEM_TYPES, f"Round misses item types: {sorted(V1_ITEM_TYPES - seen)}"


def test_sequences_are_dense_and_monotonic(round_fixture) -> None:
    """Clients resume from last_sequence, so a hole is indistinguishable from loss."""
    sequences = [event["sequence"] for event in round_fixture["events"]]
    expected = list(range(1, len(sequences) + 1))
    assert sequences == expected, (
        f"Sequences are not dense and monotonic: got {sequences}, expected {expected}"
    )


def test_dedupe_keys_are_unique(round_fixture) -> None:
    """Redelivery is expected on reconnect; dedupe_key is the only thing stopping it."""
    keys = [event["dedupe_key"] for event in round_fixture["events"]]
    duplicates = [key for key, count in collections.Counter(keys).items() if count > 1]
    assert not duplicates, f"Duplicate dedupe_key: {duplicates}"


# ------------------------------------------------- Reference replay reducer


def replay(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Fold a session's events into its state. The reference for the renderer.

    Deltas accumulate onto the item they name; a completed item replaces what
    the deltas accumulated, because the terminal payload is authoritative. That
    ordering is what lets a client join a run late, apply only the completion,
    and still land on the same state as one that watched every delta.
    """
    session: dict[str, Any] | None = None
    runs: dict[str, dict[str, Any]] = {}
    items: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()

    for event in events:
        if event["dedupe_key"] in seen:
            continue
        seen.add(event["dedupe_key"])

        data = event.get("data") or {}
        kind = event["type"]

        if kind.startswith("event.session."):
            if "session" in data:
                session = dict(data["session"])
        elif kind.startswith("event.run."):
            if "run" in data:
                runs[data["run"]["id"]] = dict(data["run"])
        elif kind == "event.item.delta":
            item = items.setdefault(
                event["item_id"], {"id": event["item_id"], "content": {}}
            )
            delta = data["delta"]
            if delta.get("kind") == "message.text.append":
                content = item.setdefault("content", {})
                content["text"] = content.get("text", "") + delta.get("text", "")
        elif "item" in data:
            items[data["item"]["id"]] = dict(data["item"])

    return {
        "session": session,
        "runs": sorted(runs.values(), key=lambda run: run.get("sequence", 0)),
        "items": sorted(items.values(), key=lambda item: item["sequence"]),
    }


def test_replaying_the_round_reproduces_the_snapshot(round_fixture) -> None:
    """The M0 criterion, and the reason the fixture exists.

    If this diverges, a client that reconnects mid-run renders a different
    conversation than one loading the session fresh -- a class of bug that
    surfaces to users as "a message went missing" and is invisible to every
    other test.
    """
    state = replay(round_fixture["events"])
    snapshot = round_fixture["snapshot"]

    assert state["session"] == snapshot["session"]
    assert state["runs"] == snapshot["runs"]
    assert len(state["items"]) == len(snapshot["items"])
    for actual, expected in zip(state["items"], snapshot["items"]):
        assert actual == expected, f"Item {expected['id']} does not replay to its snapshot form"


def test_replay_is_idempotent_under_redelivery(round_fixture) -> None:
    """Reconnect replays an overlap; applying it twice must change nothing."""
    events = round_fixture["events"]
    once = replay(events)
    twice = replay(events + events[8:])
    assert once == twice


def test_text_deltas_accumulate_to_the_completed_message(round_fixture) -> None:
    """Guards the streaming path specifically, not just the end state."""
    deltas = "".join(
        event["data"]["delta"].get("text", "")
        for event in round_fixture["events"]
        if event["type"] == "event.item.delta"
        and event["item_id"] == "item_msg_001"
        and event["data"]["delta"]["kind"] == "message.text.append"
    )
    final = next(
        item for item in round_fixture["snapshot"]["items"] if item["id"] == "item_msg_001"
    )
    assert deltas == final["content"]["text"]
