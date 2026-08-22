from __future__ import annotations

from drsai.relay.models import session_conversation_digest


def item(
    item_id: str,
    sequence: int,
    payload: dict,
    *,
    source_client: str = "windows",
) -> dict:
    return {
        "item_id": item_id,
        "session_id": "session-one",
        "run_id": "run-one",
        "kind": "message",
        "role": "user",
        "revision": 1,
        "session_sequence": sequence,
        "source_client": source_client,
        "source_message_id": f"source-{item_id}",
        "created_at": f"ignored-created-{item_id}",
        "updated_at": f"ignored-updated-{item_id}",
        "payload": payload,
    }


def test_digest_is_stable_across_item_map_order_and_transport_timestamps() -> None:
    first = item("one", 1, {"z": 2, "a": [True, "值"]})
    second = item("two", 2, {"content": "hello"})
    reordered = {
        **first,
        "created_at": "different",
        "updated_at": "different",
        "payload": {"a": [True, "值"], "z": 2},
    }
    digest = session_conversation_digest([first, second])
    assert digest == session_conversation_digest([second, reordered])
    assert digest == "ea44f0e94828575e7dffdd66a0c1512580bf338c0549d2b7b04686078feaf3c9"


def test_digest_changes_for_visible_payload_revision_or_source_identity() -> None:
    baseline = item("one", 1, {"content": "hello"})
    digest = session_conversation_digest([baseline])
    assert digest != session_conversation_digest(
        [{**baseline, "payload": {"content": "changed"}}]
    )
    assert digest != session_conversation_digest([{**baseline, "revision": 2}])
    assert digest != session_conversation_digest(
        [{**baseline, "source_client": "android"}]
    )
