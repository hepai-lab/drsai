"""Content-free dry-run analysis for Codex history reprojection."""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any


_SERIALIZED_PARTS = re.compile(
    r"^\s*(?:\[\s*\{|\{)\s*['\"]?(?:text|type)['\"]?\s*:", re.IGNORECASE
)


def codex_history_migration_dry_run(
    session_id: str,
    history: Iterable[Mapping[str, Any]],
    existing_items: Iterable[Mapping[str, Any]],
    existing_events: Iterable[Mapping[str, Any]],
    *,
    mapping_version: str,
) -> dict[str, Any]:
    """Identify V6 correction candidates without returning message bodies or IDs."""
    expected: dict[tuple[str, str], tuple[str, Any]] = {}
    for turn in history:
        backend_run_id = str(turn.get("backend_run_id") or "")
        if not backend_run_id:
            continue
        for item in turn.get("items") or []:
            if not isinstance(item, Mapping):
                continue
            backend_item_id = str(item.get("item_id") or "")
            if backend_item_id:
                digest = hashlib.sha256(
                    f"{session_id}\0{backend_run_id}\0{backend_item_id}".encode("utf-8")
                ).hexdigest()[:32]
                expected[(backend_run_id, backend_item_id)] = (
                    f"codex-item-{digest}", item.get("role")
                )

    reasons: Counter[str] = Counter()
    affected: set[str] = set()
    backend_identities: Counter[tuple[str, str]] = Counter()
    final_digests: Counter[tuple[str, str]] = Counter()
    rows = list(existing_items)
    for index, item in enumerate(rows):
        payload = item.get("payload") if isinstance(item.get("payload"), Mapping) else {}
        backend_item_id = str(payload.get("backend_item_id") or "")
        backend_run_id = str(payload.get("backend_run_id") or "")
        identity = (backend_run_id, backend_item_id)
        item_key = str(item.get("item_id") or f"row-{index}")
        is_codex = bool(backend_item_id or str(item.get("source_message_id") or "").startswith("codex:"))
        if not is_codex:
            continue
        if str(payload.get("mapping_version") or "") != mapping_version:
            reasons["outdated_mapping"] += 1
            affected.add(item_key)
        text = payload.get("text") if isinstance(payload.get("text"), str) else payload.get("content")
        if isinstance(text, str) and _SERIALIZED_PARTS.search(text):
            reasons["serialized_message_parts"] += 1
            affected.add(item_key)
        expected_row = expected.get(identity)
        if expected_row:
            expected_id, expected_role = expected_row
            if item_key != expected_id:
                reasons["unstable_item_identity"] += 1
                affected.add(item_key)
            if expected_role in {"user", "assistant", "system"} and item.get("role") != expected_role:
                reasons["role_mismatch"] += 1
                affected.add(item_key)
        if all(identity):
            backend_identities[identity] += 1
        if item.get("role") == "assistant" and isinstance(text, str) and text:
            final_digests[(backend_run_id, hashlib.sha256(text.encode("utf-8")).hexdigest())] += 1

    duplicate_identities = sum(count - 1 for count in backend_identities.values() if count > 1)
    if duplicate_identities:
        reasons["duplicate_backend_item"] += duplicate_identities
    duplicate_finals = sum(count - 1 for count in final_digests.values() if count > 1)
    if duplicate_finals:
        reasons["duplicate_final_text"] += duplicate_finals
    fake_resumed = sum(
        1 for event in existing_events
        if event.get("type") == "event.run.resumed"
        and not isinstance(event.get("data"), Mapping)
        or (
            event.get("type") == "event.run.resumed"
            and isinstance(event.get("data"), Mapping)
            and not (event.get("data") or {}).get("reason")
        )
    )
    if fake_resumed:
        reasons["unexplained_run_resumed"] += fake_resumed

    return {
        "mode": "dry-run",
        "mapping_version": mapping_version,
        "scanned_items": len(rows),
        "expected_items": len(expected),
        "affected_items": len(affected),
        "reasons": dict(sorted(reasons.items())),
        "content_redacted": True,
    }
