"""Project persisted P1 Items into the OAEP P2 shape the renderer reads.

The journal stores Items in their original P1 form. The compatibility migration
adds semantic fields (``part_id``, ``mapping_version``, resource associations)
that the desktop replay reducer expects.

The subtlety is in :func:`migrate_snapshot`. Those added fields participate in
the OAEP Item digest, so a checkpoint computed over the raw P1 Items would not
match the projection the client actually received, and a client verifying the
checkpoint would conclude its history was corrupt. The checkpoint is therefore
recomputed over the *projected* Items, across the full Item set at the snapshot
waterline -- not just the page being returned.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from drsai.oaep.digest import oaep_items_digest
from drsai.oaep.resource_associations import migrate_p1_snapshot

from . import _state


def _authority_id() -> str:
    return _state.runtime_registry().identity.runtime_id


def migrate_event(event: Mapping[str, Any]) -> dict[str, Any]:
    projected = dict(event)
    data = dict(projected.get("data") or {})
    item = data.get("item")
    if isinstance(item, Mapping):
        session_id = str(projected.get("session_id") or item.get("session_id") or "")
        migrated = migrate_p1_snapshot(
            {"session": {"id": session_id}, "items": [item]},
            authority_id=_authority_id(),
        )
        data["item"] = migrated["items"][0]
        projected["data"] = data
    return projected


def migrate_snapshot(
    snapshot: Mapping[str, Any],
    *,
    checkpoint_items: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    authority_id = _authority_id()
    projected = migrate_p1_snapshot(snapshot, authority_id=authority_id)
    checkpoint = projected.get("checkpoint")
    if not isinstance(checkpoint, Mapping):
        return projected
    expected = int(checkpoint.get("item_count", -1))
    if expected != len(checkpoint_items):
        raise RuntimeError("OAEP Snapshot checkpoint Item count changed")
    checkpoint_projection = migrate_p1_snapshot(
        {"session": snapshot["session"], "items": list(checkpoint_items)},
        authority_id=authority_id,
    )
    projected["checkpoint"] = {
        **dict(checkpoint),
        "snapshot_hash": oaep_items_digest(checkpoint_projection["items"]),
    }
    return projected
