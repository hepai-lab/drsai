"""Content-safe canonical digest for a converged OAEP Item projection."""
from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from typing import Any


_FIELDS = ("id", "session_id", "run_id", "type", "status", "sequence", "source", "content")


def _semantic_item(item: Mapping[str, Any]) -> dict[str, Any]:
    value = {field: item[field] for field in _FIELDS}
    content = dict(value["content"])
    defaults: dict[str, dict[str, Any]] = {
        "message": {"citations": []},
        "artifact": {"previewable": False, "downloadable": False},
        "interaction": {"request_summary": {}},
        "notice": {"details": {}},
    }
    for key, default in defaults.get(str(value["type"]), {}).items():
        content.setdefault(key, default)
    # Kotlin's generated Message model has an empty-list default and therefore
    # emits ``parts: []`` on the wire. Absence and an empty optional parts list
    # are the same OAEP semantic value (matching Android canonicalization).
    if content.get("parts") == []:
        content.pop("parts")
    if value["type"] in {"command_execution", "tool_call"} and content.get("replay_policy") == {}:
        content.pop("replay_policy")
    value["content"] = content
    return value


def _normalize(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("oaep_digest_number_invalid")
        return int(value) if value.is_integer() else value
    if isinstance(value, Mapping):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("oaep_digest_key_invalid")
        return {key: _normalize(value[key]) for key in sorted(value)}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_normalize(item) for item in value]
    raise ValueError("oaep_digest_value_invalid")


def canonical_oaep_items(items: Sequence[Mapping[str, Any]]) -> str:
    rows = []
    for item in sorted(
        items,
        key=lambda value: (str(value.get("run_id", "")), int(value.get("sequence", -1)), str(value.get("id", ""))),
    ):
        missing = [field for field in _FIELDS if field not in item]
        if missing:
            raise ValueError("oaep_digest_item_invalid:" + ",".join(missing))
        rows.append(_normalize(_semantic_item(item)))
    return json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_oaep_item(item: Mapping[str, Any]) -> str:
    """Canonicalize one already ordered Item for bounded-memory checkpoints."""
    missing = [field for field in _FIELDS if field not in item]
    if missing:
        raise ValueError("oaep_digest_item_invalid:" + ",".join(missing))
    return json.dumps(
        _normalize(_semantic_item(item)),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def oaep_items_digest(items: Sequence[Mapping[str, Any]]) -> str:
    return hashlib.sha256(canonical_oaep_items(items).encode("utf-8")).hexdigest()
