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

import hashlib
import os
import threading
import weakref
from collections import OrderedDict
from contextlib import closing
from typing import TYPE_CHECKING, Any, Iterable, Mapping, Sequence

from drsai.oaep.digest import canonical_oaep_item
from drsai.oaep.resource_associations import MAPPING_VERSION, P1_READER_ENV, migrate_p1_snapshot

if TYPE_CHECKING:
    from drsai.backend.runtime.journal import RuntimeConversationJournal

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


# Process-local, globally bounded metadata only. Weak journal identity prevents
# cross-database reuse (including a new engine opened at the same path) without
# keeping engines alive. Authority is essential even though today's digest omits
# top-level associations: those still carry authority-specific resource handles.
_CHECKPOINT_CACHE_LIMIT = 128
_checkpoint_cache: OrderedDict[tuple[Any, ...], tuple[int, str]] = OrderedDict()
_checkpoint_cache_lock = threading.Lock()


def _stream_checkpoint(
    items: Iterable[Mapping[str, Any]], *, session: Mapping[str, Any], authority_id: str,
) -> tuple[int, str, str]:
    """Hash the exact canonical array bytes, never a concatenation of hashes.

    P1 migration is item-local: stable IDs use session/id/slot, with no sibling
    lookup. It leaves run_id/sequence/id unchanged. Keep canonical digest order,
    NOT the pagination latest_sequence order. Fail closed if a producer violates
    the sorted-iterator contract rather than silently emitting a different hash.
    """
    raw_digest, projected_digest = hashlib.sha256(b"["), hashlib.sha256(b"[")
    count = 0
    previous = None
    for item in items:
        key = (str(item.get("run_id", "")), int(item.get("sequence", -1)), str(item.get("id", "")))
        if previous is not None and key < previous:
            raise RuntimeError("OAEP Snapshot checkpoint Item order changed")
        previous = key
        migrated = migrate_p1_snapshot(
            {"session": session, "items": [item]}, authority_id=authority_id,
        )["items"][0]
        if count:
            raw_digest.update(b",")
            projected_digest.update(b",")
        raw_digest.update(canonical_oaep_item(item).encode("utf-8"))
        projected_digest.update(canonical_oaep_item(migrated).encode("utf-8"))
        count += 1
    raw_digest.update(b"]")
    projected_digest.update(b"]")
    return count, raw_digest.hexdigest(), projected_digest.hexdigest()


def migrate_snapshot(
    snapshot: Mapping[str, Any],
    *,
    checkpoint_items: Sequence[Mapping[str, Any]] | None = None,
    journal: RuntimeConversationJournal | None = None,
) -> dict[str, Any]:
    """Migrate a page with a verified *full* checkpoint at its waterline.

    Cold requests still scan all Items, but retain only one migrated Item. Warm
    pages skip that scan only while the journal waterline is unchanged. The
    journal is a current projection, not MVCC history: an old cursor after an
    update must revalidate count/hash, not reuse a previously valid digest.
    """
    authority_id = _authority_id()
    projected = migrate_p1_snapshot(snapshot, authority_id=authority_id)
    checkpoint = projected.get("checkpoint")
    if not isinstance(checkpoint, Mapping):
        return projected
    expected = int(checkpoint.get("item_count", -1))
    if checkpoint_items is not None and expected != len(checkpoint_items):
        raise RuntimeError("OAEP Snapshot checkpoint Item count changed")
    waterline = int(snapshot["snapshot_sequence"])
    if int(checkpoint.get("sequence", -1)) != waterline:
        raise RuntimeError("OAEP Snapshot checkpoint waterline changed")
    session_id = str(snapshot["session"]["id"])
    raw_hash = str(checkpoint.get("snapshot_hash", ""))
    cache_key = None
    cached = None
    if journal is not None and journal.snapshot_waterline(session_id) == waterline:
        cache_key = (
            weakref.ref(journal), session_id, authority_id, MAPPING_VERSION,
            os.environ.get(P1_READER_ENV), waterline, raw_hash, expected,
        )
        with _checkpoint_cache_lock:
            cached = _checkpoint_cache.get(cache_key)
            if cached is not None:
                _checkpoint_cache.move_to_end(cache_key)
    if cached is None:
        if checkpoint_items is not None:
            # This compatibility API accepts unordered complete sequences. The
            # HTTP fast path supplies at most 500 Items, not a full history copy.
            ordered = sorted(checkpoint_items, key=lambda item: (
                str(item.get("run_id", "")), int(item.get("sequence", -1)), str(item.get("id", "")),
            ))
            count, actual_raw_hash, digest = _stream_checkpoint(
                ordered, session=snapshot["session"], authority_id=authority_id,
            )
        elif journal is not None:
            with closing(journal.iter_oaep_items(session_id, through_sequence=waterline)) as items:
                count, actual_raw_hash, digest = _stream_checkpoint(
                    items, session=snapshot["session"], authority_id=authority_id,
                )
        else:
            raise ValueError("OAEP Snapshot requires full checkpoint Items or journal")
        if expected != count:
            raise RuntimeError("OAEP Snapshot checkpoint Item count changed")
        if actual_raw_hash != raw_hash:
            raise RuntimeError("OAEP Snapshot checkpoint hash changed")
        cached = (count, digest)
        # A write during the scan must not populate an entry eligible for hits.
        if cache_key is not None and journal.snapshot_waterline(session_id) == waterline:
            with _checkpoint_cache_lock:
                _checkpoint_cache[cache_key] = cached
                _checkpoint_cache.move_to_end(cache_key)
                while len(_checkpoint_cache) > _CHECKPOINT_CACHE_LIMIT:
                    _checkpoint_cache.popitem(last=False)
    if expected != cached[0]:
        raise RuntimeError("OAEP Snapshot checkpoint Item count changed")
    projected["checkpoint"] = {**dict(checkpoint), "snapshot_hash": cached[1]}
    return projected
