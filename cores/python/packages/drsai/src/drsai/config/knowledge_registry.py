"""Knowledge-base resources and auditable local-file retrieval indexes."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import tomllib
from typing import Callable, Iterable, Sequence

from ..content.documents import (
    SUPPORTED_SUFFIXES,
    DocumentLocator,
    DocumentUnit,
    ParsedDocument,
    parse_document,
)
from .loader import ConfigError

_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")
_SUPPORTED_TYPES = {"local-files", "ragflow"}

# Bumped whenever the on-disk index gains columns a reader depends on. An index
# written by an older build is reported as stale instead of being queried with
# missing position data, which would silently downgrade every citation.
_INDEX_SCHEMA_VERSION = 3

# Bumped whenever parsing or chunking changes what a document yields. Reusing an
# unchanged file's chunks is only safe while the code that produced them is the
# same code, so the revision is stored beside the index and compared before any
# chunk is reused. Changing how documents are parsed without bumping this would
# keep serving chunks no current parser would produce.
_PARSER_REVISION = "2026-09-16.1"

# How large a single document may be before the indexer skips it. This is a
# policy choice, not a capability limit: an oversized file is recorded as
# *skipped* with a reason, which keeps it visible in the corpus listing without
# claiming the corpus is unreadable. A Knowledge Base may tune it with
# `max_document_bytes`; the value is clamped rather than trusted, so a stored
# value can never make the corpus impossible to index.
_DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
_MIN_MAX_DOCUMENT_BYTES = 1 * 1024 * 1024
_MAX_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024

# Document-row statuses. `ok`: read and chunked. `skipped`: deliberately not
# read, by policy. `failed`: read attempted and not possible — an operator-visible
# error, and the only one of the three that makes a corpus incomplete.
_DOCUMENT_OK = "ok"
_DOCUMENT_SKIPPED = "skipped"
_DOCUMENT_FAILED = "failed"

ProgressCallback = Callable[[dict[str, object]], None]
StopCondition = Callable[[], bool]


class IndexBuildCancelled(Exception):
    """Raised when a running index build is asked to stop.

    A cancelled build rolls back without publishing, so the previous index stays
    queryable and a cancelled build never leaves a half-written corpus behind.
    """

# A search result travels into the model's context. Naming the scope that was
# searched is required for a refusal to be checkable, but a corpus with
# thousands of documents must not turn that into thousands of empty rows.
_MAX_SCOPE_ROWS = 20
_MAX_DOCUMENT_ROWS = 50


@dataclass(frozen=True)
class KnowledgeResource:
    knowledge_id: str
    display_name: str
    type: str
    enabled: bool = True
    config: dict[str, object] | None = None


@dataclass(frozen=True)
class KnowledgeEvidence:
    knowledge_id: str
    document_id: str
    title: str
    source: str
    chunk_id: str
    score: float
    content: str
    content_sha256: str
    # Where this chunk sits in its source document. Without it a citation can
    # name a file but cannot open it at the cited spot.
    locator: dict[str, object] = field(default_factory=dict)
    locator_label: str = ""
    # Digest of the whole source file, so a citation can be checked against the
    # exact document revision that was indexed. `content_sha256` only covers
    # this chunk and cannot prove which file version it came from.
    document_sha256: str = ""


def canonical_knowledge_id(value: str) -> str:
    candidate = value.strip().lower().replace("_", "-")
    candidate = re.sub(r"[^a-z0-9_.-]+", "-", candidate).strip(".-")
    if not candidate or not candidate[0].isalpha() or not _ID_RE.fullmatch(candidate):
        raise ConfigError("Knowledge Base ID is invalid")
    return candidate


def knowledge_registry_dir(config_dir: str | Path) -> Path:
    return Path(config_dir) / "knowledge"


def list_knowledge_resources(config_dir: str | Path) -> tuple[KnowledgeResource, ...]:
    root = knowledge_registry_dir(config_dir)
    resources = tuple(_read_resource(path) for path in sorted(root.glob("knowledge_*.toml"))) if root.is_dir() else ()
    ids = [resource.knowledge_id for resource in resources]
    if len(ids) != len(set(ids)):
        raise ConfigError("Knowledge registry contains duplicate IDs")
    return resources


def knowledge_registry_revision(resources: tuple[KnowledgeResource, ...]) -> str:
    payload = [
        {"knowledge_id": resource.knowledge_id, "display_name": resource.display_name, "type": resource.type,
         "enabled": resource.enabled, "config": dict(resource.config or {})}
        for resource in resources
    ]
    return "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def get_knowledge_resource(config_dir: str | Path, knowledge_id: str) -> KnowledgeResource:
    wanted = canonical_knowledge_id(knowledge_id)
    for resource in list_knowledge_resources(config_dir):
        if resource.knowledge_id == wanted:
            return resource
    raise ConfigError(f"Knowledge Base '{wanted}' was not found")


def put_knowledge_resource(config_dir: str | Path, resource: KnowledgeResource) -> KnowledgeResource:
    knowledge_id = canonical_knowledge_id(resource.knowledge_id)
    kind = str(resource.type).strip().lower()
    if kind not in _SUPPORTED_TYPES:
        raise ConfigError("Knowledge Base type is unsupported")
    display_name = str(resource.display_name).strip()
    if not display_name or len(display_name) > 160:
        raise ConfigError("Knowledge Base display name is invalid")
    config = dict(resource.config or {})
    _validate_config(kind, config)
    normalized = KnowledgeResource(knowledge_id, display_name, kind, bool(resource.enabled), config)
    _atomic_write(knowledge_registry_dir(config_dir) / f"knowledge_{knowledge_id}.toml", _render_resource(normalized))
    return normalized


def delete_knowledge_resource(config_dir: str | Path, knowledge_id: str) -> KnowledgeResource:
    resource = get_knowledge_resource(config_dir, knowledge_id)
    (knowledge_registry_dir(config_dir) / f"knowledge_{resource.knowledge_id}.toml").unlink()
    index_path = knowledge_index_path(config_dir, resource.knowledge_id)
    index_path.unlink(missing_ok=True)
    return resource


def knowledge_resource_payload(resource: KnowledgeResource) -> dict[str, object]:
    config = dict(resource.config or {})
    credential_configured = bool(config.pop("credential_ref", None))
    return {
        "knowledge_id": resource.knowledge_id, "display_name": resource.display_name,
        "type": resource.type, "enabled": resource.enabled,
        "config": config, "credential_configured": credential_configured,
    }


def knowledge_index_path(config_dir: str | Path, knowledge_id: str) -> Path:
    return knowledge_registry_dir(config_dir) / "indexes" / f"{canonical_knowledge_id(knowledge_id)}.sqlite3"


@dataclass(frozen=True)
class _PlannedDocument:
    """One corpus member and what a build intends to do with it."""

    source: str
    path: Path
    size: int
    mtime_ns: int
    parser: str
    # Set when the previous index holds this exact revision, so its chunks can be
    # carried over instead of being produced again.
    previous: dict[str, object] | None = None
    # Set when policy says not to read this file at all.
    skip_reason: str = ""
    # Set when the file could not even be stat'ed.
    unreadable: bool = False


def effective_max_document_bytes(config: dict[str, object] | None) -> int:
    """Resolve a Knowledge Base's per-document size policy, clamped.

    A stored value is never trusted outright: an out-of-range value would make
    an entire corpus unindexable, so it is clamped instead of obeyed.
    """

    raw = (config or {}).get("max_document_bytes")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return _DEFAULT_MAX_DOCUMENT_BYTES
    return max(_MIN_MAX_DOCUMENT_BYTES, min(_MAX_MAX_DOCUMENT_BYTES, raw))


def validate_local_index_target(resource: KnowledgeResource) -> Path:
    """Return the corpus root of a local-files Knowledge Base, or raise.

    Kept separate from :func:`index_local_files` because the gateway has to
    reject an unindexable Knowledge Base *before* it hands the build to a
    background job: once the build is a job, the only reporter left is a status
    poll, and "that folder is gone" is an answer the caller can act on now.
    """

    if resource.type != "local-files":
        raise ConfigError("Only local-files Knowledge Bases can be indexed locally")
    root = Path(str((resource.config or {}).get("root_path") or "")).expanduser().resolve()
    if not root.is_dir():
        raise ConfigError("Knowledge Base root_path is unavailable")
    return root


def index_local_files(
    config_dir: str | Path,
    resource: KnowledgeResource,
    *,
    reuse_unchanged: bool = True,
    progress: ProgressCallback | None = None,
    should_stop: StopCondition | None = None,
) -> dict[str, object]:
    """(Re)build the local-file index for one Knowledge Base.

    The build is incremental and atomic:

    * A file whose ``(size, mtime_ns)`` matches the previous index is reused
      without being read again, so re-indexing a large folder costs one stat per
      unchanged file instead of reparsing the whole corpus.
    * New and changed files are parsed and chunked; removed files are dropped.
    * The new tables are written *beside* the old ones and swapped inside a
      single transaction, so a concurrent search sees the complete previous
      index or the complete new one, never a half-built one. A crash or a
      cancellation rolls back and leaves the previous index queryable.

    ``should_stop`` is polled once per document so a caller that owns this build
    as a job can cancel it; a build that stops raises :class:`IndexBuildCancelled`.

    Every file whose format we claim to support is a corpus member. Files we
    never claimed to read (images, archives) are counted separately, so
    ``corpus_complete`` keeps meaning "every document we treat as a document was
    actually read" while the size policy stays separate: skipping a file by
    policy is not the same as failing to read it.
    """

    config = dict(resource.config or {})
    root = validate_local_index_target(resource)
    chunk_size = int(config.get("chunk_size") or 800)
    chunk_overlap = int(config.get("chunk_overlap") or 120)
    max_bytes = effective_max_document_bytes(config)

    _report_index_progress(progress, {"phase": "scanning", "done": 0, "total": 0})
    files, ignored = _scan_local_files(resource)

    index = knowledge_index_path(config_dir, resource.knowledge_id)
    index.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(index, timeout=30.0)
    # Transactions below are issued explicitly: the module's default implicit
    # transaction handling would commit the table swap out from under us.
    db.isolation_level = None
    try:
        previous_documents, previous_meta = _read_previous_documents(db)
        reusable = (
            reuse_unchanged
            and previous_meta.get("schema_version") == str(_INDEX_SCHEMA_VERSION)
            and previous_meta.get("parser_revision") == _PARSER_REVISION
        )
        plans = _plan_documents(files, previous_documents if reusable else {}, max_bytes)
        indexed_at = _utc_now()
        # Checked before the write transaction opens: a build cancelled while it
        # was still planning should leave the index file untouched.
        _raise_if_stopped(should_stop)

        db.execute("BEGIN IMMEDIATE")
        try:
            _create_next_tables(db)
            chunk_count = 0
            ok_documents = 0
            reused_documents = 0
            parsed_documents = 0
            skipped: list[dict[str, str]] = []
            failed: list[dict[str, str]] = []
            revisions: list[tuple[str, str]] = []
            total = len(plans)
            for position, plan in enumerate(plans):
                # Cancellation is checked per document, not per chunk: this is
                # the finest granularity at which the transaction can still be
                # rolled back cheaply.
                _raise_if_stopped(should_stop)
                _report_index_progress(progress, {
                    "phase": "indexing", "done": position, "total": total, "current": plan.source,
                })
                document_id = hashlib.sha256(plan.source.encode()).hexdigest()
                title = Path(plan.source).name
                if plan.skip_reason:
                    db.execute(
                        "INSERT INTO documents_next VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            document_id, plan.source, title, _DOCUMENT_SKIPPED, plan.skip_reason, "",
                            0, "", plan.size, plan.mtime_ns, plan.parser, indexed_at,
                        ),
                    )
                    skipped.append({"source": plan.source, "reason": plan.skip_reason})
                    revisions.append((plan.source, ""))
                    continue
                if plan.previous is not None:
                    document_chunks = _copy_previous_document(db, plan, document_id, title)
                    reused_documents += 1
                    revisions.append((plan.source, str(plan.previous.get("sha256") or "")))
                    ok_documents += 1
                else:
                    document = (
                        ParsedDocument(plan.source, "failed", detail="file_unreadable")
                        if plan.unreadable
                        else parse_document(plan.path, source=plan.source)
                    )
                    file_digest = "" if plan.unreadable else _file_sha256(plan.path)
                    document_chunks, status, reason, detail = _store_parsed_document(
                        db, plan, document_id, title, document, file_digest, indexed_at,
                        chunk_size, chunk_overlap,
                    )
                    parsed_documents += 1
                    revisions.append((plan.source, file_digest))
                    if status == _DOCUMENT_OK:
                        ok_documents += 1
                    else:
                        failed.append({
                            "source": plan.source, "status": _DOCUMENT_FAILED,
                            "reason": reason, "detail": detail,
                        })
                chunk_count += document_chunks

            # Only real read failures make a corpus incomplete. A policy skip is
            # recorded and shown, but it does not mean the corpus is unknown.
            corpus_complete = not failed
            # Identifies the exact corpus a citation was produced against, and
            # changes whenever any indexed document changes.
            corpus_revision = hashlib.sha256(json.dumps(sorted(revisions)).encode()).hexdigest()

            db.executemany("INSERT INTO meta_next VALUES (?, ?)", [
                ("schema_version", str(_INDEX_SCHEMA_VERSION)),
                ("parser_revision", _PARSER_REVISION),
                ("corpus_complete", "1" if corpus_complete else "0"),
                ("corpus_revision", corpus_revision),
                ("document_count", str(ok_documents)),
                ("chunk_count", str(chunk_count)),
                ("corpus_document_count", str(len(plans))),
                ("skipped_document_count", str(len(skipped))),
                ("failed_document_count", str(len(failed))),
                ("ignored_file_count", str(ignored)),
                ("indexed_at", indexed_at),
            ])
            _report_index_progress(progress, {
                "phase": "publishing", "done": total, "total": total,
            })
            # The swap is the publish point: readers keep seeing the previous
            # tables until this transaction commits.
            for table in ("chunks", "documents", "meta"):
                db.execute(f"DROP TABLE IF EXISTS {table}")
                db.execute(f"ALTER TABLE {table}_next RENAME TO {table}")
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    finally:
        db.close()

    _report_index_progress(progress, {
        "phase": "completed", "done": len(plans), "total": len(plans),
    })
    return {
        "knowledge_id": resource.knowledge_id,
        "status": "ready",
        "document_count": ok_documents,
        "chunk_count": chunk_count,
        "corpus_complete": corpus_complete,
        "corpus_revision": corpus_revision,
        "corpus_document_count": len(plans),
        "reused_document_count": reused_documents,
        "parsed_document_count": parsed_documents,
        "skipped_document_count": len(skipped),
        "failed_document_count": len(failed),
        "unreadable_documents": failed,
        "skipped_documents": skipped,
        "ignored_file_count": ignored,
        "index_path": str(index),
        "indexed_at": indexed_at,
        "schema_version": _INDEX_SCHEMA_VERSION,
    }


def _scan_local_files(resource: KnowledgeResource) -> tuple[list[tuple[str, Path]], int]:
    """Walk the Knowledge Base root once, returning members and ignored files.

    The indexer and the staleness diff share this walk so both agree on what a
    corpus member is.
    """

    if resource.type != "local-files":
        raise ConfigError("Only local-files Knowledge Bases support local file scans")
    config = dict(resource.config or {})
    root = Path(str(config.get("root_path") or "")).expanduser().resolve()
    if not root.is_dir():
        raise ConfigError("Knowledge Base root_path is unavailable")
    source_paths = config.get("paths") or ["."]
    if not isinstance(source_paths, list):
        raise ConfigError("Knowledge Base paths are invalid")
    seen: set[Path] = set()
    files: list[tuple[str, Path]] = []
    ignored = 0
    for raw in source_paths:
        candidate = (root / str(raw)).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ConfigError("Knowledge Base path escapes root_path") from exc
        paths: Iterable[Path] = sorted(candidate.rglob("*")) if candidate.is_dir() else (candidate,)
        for path in paths:
            if not path.is_file() or path in seen:
                continue
            seen.add(path)
            if path.suffix.lower() not in SUPPORTED_SUFFIXES:
                ignored += 1
                continue
            files.append((path.relative_to(root).as_posix(), path))
    return files, ignored


def _plan_documents(
    files: Sequence[tuple[str, Path]],
    previous: dict[str, dict[str, object]],
    max_bytes: int,
) -> list[_PlannedDocument]:
    """Decide, per corpus member, whether to reuse it, read it, or skip it."""

    plans: list[_PlannedDocument] = []
    for source, path in files:
        parser = path.suffix.lower().lstrip(".")
        try:
            stat = path.stat()
        except OSError:
            plans.append(_PlannedDocument(source, path, 0, 0, parser, unreadable=True))
            continue
        if stat.st_size > max_bytes:
            plans.append(_PlannedDocument(
                source, path, stat.st_size, stat.st_mtime_ns, parser, skip_reason="file_too_large",
            ))
            continue
        previous_row = previous.get(source)
        if (
            previous_row is not None
            and previous_row.get("status") == _DOCUMENT_OK
            and previous_row.get("size") == stat.st_size
            and previous_row.get("mtime_ns") == stat.st_mtime_ns
        ):
            plans.append(_PlannedDocument(
                source, path, stat.st_size, stat.st_mtime_ns, parser, previous=previous_row,
            ))
            continue
        plans.append(_PlannedDocument(source, path, stat.st_size, stat.st_mtime_ns, parser))
    return plans


def _read_previous_documents(
    db: sqlite3.Connection,
) -> tuple[dict[str, dict[str, object]], dict[str, str]]:
    """Read the index already on disk without assuming its schema is current.

    A row written by an older build simply lacks the columns reuse needs, which
    makes it ineligible for reuse instead of raising.
    """

    try:
        columns = {str(row[1]) for row in db.execute("PRAGMA table_info(documents)")}
    except sqlite3.DatabaseError:
        return {}, {}
    meta = _read_index_meta(db)
    if not columns:
        return {}, meta
    wanted = [
        name for name in (
            "source", "document_id", "status", "reason", "detail", "sha256",
            "chunk_count", "size", "mtime_ns", "indexed_at",
        ) if name in columns
    ]
    documents: dict[str, dict[str, object]] = {}
    try:
        for row in db.execute("SELECT " + ", ".join(wanted) + " FROM documents"):
            record = dict(zip(wanted, row))
            source = str(record.get("source") or "")
            if source:
                documents[source] = record
    except sqlite3.DatabaseError:
        return {}, {}
    return documents, meta


def _read_index_meta(db: sqlite3.Connection) -> dict[str, str]:
    try:
        return {str(key): str(value) for key, value in db.execute("SELECT key, value FROM meta")}
    except sqlite3.DatabaseError:
        return {}


def _create_next_tables(db: sqlite3.Connection) -> None:
    """Create the replacement tables, clearing any leftovers from a crash."""

    for statement in (
        "DROP TABLE IF EXISTS chunks_next",
        "DROP TABLE IF EXISTS documents_next",
        "DROP TABLE IF EXISTS meta_next",
        "CREATE TABLE chunks_next ("
        " chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, title TEXT NOT NULL,"
        " source TEXT NOT NULL, content TEXT NOT NULL, content_sha256 TEXT NOT NULL,"
        " ordinal INTEGER NOT NULL, locator_kind TEXT NOT NULL, locator_label TEXT NOT NULL,"
        " locator_json TEXT NOT NULL)",
        "CREATE TABLE documents_next ("
        " document_id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL,"
        " status TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL,"
        " chunk_count INTEGER NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,"
        " mtime_ns INTEGER NOT NULL, parser TEXT NOT NULL, indexed_at TEXT NOT NULL)",
        "CREATE TABLE meta_next (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ):
        db.execute(statement)


def _copy_previous_document(
    db: sqlite3.Connection, plan: _PlannedDocument, document_id: str, title: str,
) -> int:
    """Carry an unchanged document's chunks into the replacement tables."""

    previous = plan.previous or {}
    chunk_count = 0
    for row in db.execute(
        "SELECT chunk_id, document_id, title, source, content, content_sha256, ordinal,"
        " locator_kind, locator_label, locator_json FROM chunks WHERE document_id = ?",
        (document_id,),
    ):
        db.execute("INSERT INTO chunks_next VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
        chunk_count += 1
    db.execute(
        "INSERT INTO documents_next VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            document_id, plan.source, title, _DOCUMENT_OK, "", str(previous.get("detail") or ""),
            chunk_count, str(previous.get("sha256") or ""), plan.size, plan.mtime_ns, plan.parser,
            str(previous.get("indexed_at") or _utc_now()),
        ),
    )
    return chunk_count


def _store_parsed_document(
    db: sqlite3.Connection,
    plan: _PlannedDocument,
    document_id: str,
    title: str,
    document: ParsedDocument,
    file_digest: str,
    indexed_at: str,
    chunk_size: int,
    chunk_overlap: int,
) -> tuple[int, str, str, str]:
    """Write one freshly parsed document, reporting the status it ended with."""

    chunk_count = 0
    for content, locator in _pack_units(document.units, chunk_size, chunk_overlap):
        digest = hashlib.sha256(content.encode()).hexdigest()
        db.execute(
            "INSERT INTO chunks_next VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                f"{document_id}:{chunk_count}", document_id, title, plan.source,
                content, digest, chunk_count, locator.kind, locator.label(),
                json.dumps(locator.payload(), ensure_ascii=False, sort_keys=True),
            ),
        )
        chunk_count += 1
    # A document we tried and could not read is a failure; its parse status is
    # kept as the reason so the operator sees why.
    status = _DOCUMENT_OK if document.ok else _DOCUMENT_FAILED
    reason = "" if document.ok else document.status
    db.execute(
        "INSERT INTO documents_next VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            document_id, plan.source, title, status, reason, document.detail,
            chunk_count, file_digest, plan.size, plan.mtime_ns, plan.parser, indexed_at,
        ),
    )
    return chunk_count, status, reason, document.detail


def _raise_if_stopped(should_stop: StopCondition | None) -> None:
    if should_stop is not None and should_stop():
        raise IndexBuildCancelled("Knowledge Base indexing was cancelled")


def _report_index_progress(progress: ProgressCallback | None, payload: dict[str, object]) -> None:
    if progress is None:
        return
    try:
        progress(payload)
    except Exception:
        # Progress is observability; it must never fail the build it reports on.
        pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _iter_local_supported_files(resource: KnowledgeResource) -> list[tuple[str, Path]]:
    """Return (relative source, absolute path) for supported files under the KB root."""
    return _scan_local_files(resource)[0]


def diff_local_knowledge_corpus(config_dir: str | Path, resource: KnowledgeResource) -> dict[str, object]:
    """Compare the on-disk folder against the current index.

    ``stale`` is true when files were added, removed, or changed since the last
    index, or when the last index left unreadable corpus members.
    """
    state = knowledge_corpus_state(config_dir, resource)
    indexed = {
        str(document["source"]): str(document.get("sha256") or "")
        for document in state.get("documents", [])
        if isinstance(document, dict) and document.get("source")
    }
    max_bytes = effective_max_document_bytes(dict(resource.config or {}))
    disk: dict[str, str] = {}
    skipped: list[dict[str, str]] = []
    for source, path in _iter_local_supported_files(resource):
        try:
            size = path.stat().st_size
        except OSError:
            skipped.append({"source": source, "reason": "file_unreadable"})
            disk[source] = indexed.get(source, "")
            continue
        if size > max_bytes:
            # Presence still counts, so "removed" stays accurate, but the file is
            # reported as skipped rather than hashed: hashing something the
            # policy refuses to index would cost the whole corpus's read time.
            skipped.append({"source": source, "reason": "file_too_large"})
            disk[source] = indexed.get(source, "")
            continue
        disk[source] = _file_sha256(path)

    added = [{"source": source} for source in sorted(set(disk) - set(indexed))]
    removed = [{"source": source} for source in sorted(set(indexed) - set(disk))]
    changed = [
        {"source": source}
        for source in sorted(set(disk) & set(indexed))
        if indexed[source] and disk[source] and indexed[source] != disk[source]
    ]
    incomplete = not bool(state.get("corpus_complete", False))
    stale = bool(added or removed or changed or incomplete)
    return {
        "knowledge_id": resource.knowledge_id,
        "stale": stale,
        "changed": changed,
        "added": added,
        "removed": removed,
        "skipped": skipped,
        "corpus_complete": not incomplete,
        "documents": state.get("documents", []),
    }


def _pack_units(
    units: Sequence[DocumentUnit], size: int, overlap: int,
) -> Iterable[tuple[str, DocumentLocator]]:
    """Group parsed units into chunks without losing their position.

    The previous implementation collapsed the whole document into one string
    and cut it every N characters, which discarded every page and line number.
    Packing whole units keeps each chunk addressable, and a chunk never spans
    two different anchors (pages, slides, heading sections) so its locator
    stays exact rather than approximate.
    """

    chunk: list[DocumentUnit] = []
    length = 0
    for unit in units:
        if chunk:
            crossed_anchor = _anchor(unit.locator) != _anchor(chunk[-1].locator)
            if crossed_anchor or length + len(unit.text) + 1 > size:
                yield _join_units(chunk)
                chunk = [] if crossed_anchor else _carry_overlap(chunk, overlap)
                length = sum(len(item.text) + 1 for item in chunk)
        chunk.append(unit)
        length += len(unit.text) + 1
    if chunk:
        yield _join_units(chunk)


def _anchor(locator: DocumentLocator) -> tuple[object, ...]:
    return (locator.kind, locator.page, locator.slide, locator.sheet, locator.heading_path)


def _carry_overlap(chunk: list[DocumentUnit], overlap: int) -> list[DocumentUnit]:
    carried: list[DocumentUnit] = []
    carried_length = 0
    for unit in reversed(chunk):
        carried_length += len(unit.text) + 1
        if carried_length > overlap:
            break
        carried.insert(0, unit)
    return carried


def _join_units(units: list[DocumentUnit]) -> tuple[str, DocumentLocator]:
    locator = units[0].locator
    for unit in units[1:]:
        locator = locator.merged_with(unit.locator)
    return "\n".join(unit.text for unit in units), locator


def search_local_knowledge(config_dir: str | Path, resource: KnowledgeResource, query: str, *, top_k: int = 6, score_threshold: float = 0.0) -> tuple[KnowledgeEvidence, ...]:
    query_terms = _terms(query)
    if not query_terms:
        return ()
    index = knowledge_index_path(config_dir, resource.knowledge_id)
    if not index.is_file():
        raise ConfigError("Knowledge Base has not been indexed")
    scored: list[KnowledgeEvidence] = []
    db = sqlite3.connect(index)
    try:
        _require_current_index(db)
        rows = db.execute(
            "SELECT c.chunk_id, c.document_id, c.title, c.source, c.content, c.content_sha256,"
            " c.locator_label, c.locator_json, d.sha256"
            " FROM chunks c JOIN documents d ON d.document_id = c.document_id"
        )
        for chunk_id, document_id, title, source, content, digest, locator_label, locator_json, file_digest in rows:
            lowered = content.lower()
            matches = sum(lowered.count(term) for term in query_terms)
            if matches <= 0:
                continue
            score = min(1.0, matches / max(1, len(query_terms) * 3))
            if score >= score_threshold:
                scored.append(KnowledgeEvidence(
                    resource.knowledge_id, document_id, title, source, chunk_id, score, content, digest,
                    _decode_locator(locator_json), locator_label, file_digest,
                ))
    finally:
        db.close()
    scored.sort(key=lambda item: (-item.score, item.source, item.chunk_id))
    return tuple(scored[:max(1, min(top_k, 50))])


def search_local_knowledge_scope(
    config_dir: str | Path,
    resource: KnowledgeResource,
    query: str,
    *,
    top_k: int = 6,
    score_threshold: float = 0.0,
    knowledge_base_revision: object | None = None,
) -> dict[str, object]:
    """Retrieve evidence together with the scope that was searched.

    An empty result only means "the corpus does not answer this" when the
    caller can also see what the corpus was and whether it was read completely.
    Returning retrieval and scope separately invites answering from the first
    without checking the second, so they are produced together.

    This is the seam the next stage replaces: swapping term matching for a real
    retriever changes what fills `evidence`, not the contract around it.
    """

    state = knowledge_corpus_state(config_dir, resource)
    revision = knowledge_base_revision if knowledge_base_revision is not None else state["corpus_revision"]
    documents = [document for document in state["documents"] if isinstance(document, dict)]
    readable = [document for document in documents if document.get("status") == "ok"]
    matches = search_local_knowledge(
        config_dir, resource, query, top_k=top_k, score_threshold=score_threshold,
    )

    evidence: list[dict[str, object]] = []
    supporting_match = False
    for item in matches:
        supports = _query_supported(query, item.content)
        supporting_match = supporting_match or supports
        evidence.append({
            "knowledge_id": item.knowledge_id,
            "knowledge_base_revision": revision,
            "document_id": item.document_id,
            "document_path": item.source,
            "title": item.title,
            "source": item.source,
            "chunk_id": item.chunk_id,
            "locator": item.locator,
            "locator_label": item.locator_label,
            "score": item.score,
            "content": item.content,
            "content_sha256": item.content_sha256,
            "document_sha256": item.document_sha256,
            "supporting_match": supports,
            "relation": "supports_claim" if supports else "searched_scope",
        })
    scope_limit = max(1, min(top_k, _MAX_SCOPE_ROWS))
    scope_truncated = False
    if not supporting_match:
        # Nothing in the corpus supports the question. A refusal still has to
        # say what it looked at, so name the documents that were searched —
        # but a large corpus would otherwise put thousands of empty rows into
        # the model's context, so the list is capped and the cap is declared.
        cited = {row["document_id"] for row in evidence}
        pending = [
            document for document in readable
            if hashlib.sha256(str(document["source"]).encode()).hexdigest() not in cited
        ]
        scope_truncated = len(pending) > scope_limit
        for document in pending[:scope_limit]:
            document_id = hashlib.sha256(str(document["source"]).encode()).hexdigest()
            evidence.append({
                "knowledge_id": resource.knowledge_id,
                "knowledge_base_revision": revision,
                "document_id": document_id,
                "document_path": document["source"],
                "title": document["title"],
                "source": document["source"],
                "chunk_id": f"{document_id}:scope",
                "locator": {},
                "locator_label": "",
                "score": 0.0,
                "content": "",
                "content_sha256": "",
                "document_sha256": document.get("sha256", ""),
                "supporting_match": False,
                "relation": "searched_scope",
            })

    return {
        "knowledge_id": resource.knowledge_id,
        "knowledge_base_revision": revision,
        "status": "completed",
        "completed": True,
        "corpus_complete": state["corpus_complete"],
        "supporting_match": supporting_match,
        "supporting_matches": [row for row in evidence if row["supporting_match"]],
        "evidence": evidence,
        # `document_count` stays exact even when the listing is capped, so a
        # caller can tell "the corpus has three documents" from "the corpus has
        # three thousand and you are seeing the first few".
        "document_count": len(documents),
        "scope_truncated": scope_truncated,
        "documents_truncated": len(documents) > _MAX_DOCUMENT_ROWS,
        "documents": [
            {
                "knowledge_base_id": resource.knowledge_id,
                "knowledge_base_revision": revision,
                "document_path": document["source"],
                "sha256": document.get("sha256", ""),
                "source": document["source"],
                "status": document["status"],
                "corpus_complete": state["corpus_complete"],
            }
            for document in documents[:_MAX_DOCUMENT_ROWS]
        ],
    }


def _query_supported(query: str, content: str) -> bool:
    """Conservatively decide whether a passage actually answers the question.

    Term overlap is far too generous here: a question about a default port
    shares "OpenDrSai" and "Gateway" with an overview that never mentions
    ports, and calling that a match turns a correct refusal into a guess. Every
    meaningful term has to appear before a passage may claim support.
    """

    if not content.strip():
        return False
    folded = content.casefold()
    latin_terms = {
        term.casefold() for term in re.findall(r"[A-Za-z][A-Za-z0-9._-]+", query)
        if term.casefold() not in _SUPPORT_STOP_TERMS
    }
    if latin_terms:
        return all(term in folded for term in latin_terms)
    cjk_terms = {
        term for term in re.findall(r"[㐀-鿿]{2,}", query)
        if term not in _SUPPORT_STOP_TERMS_CJK
        and not any(term.startswith(prefix) for prefix in ("根据", "请仅"))
    }
    return bool(cjk_terms) and all(term in content for term in cjk_terms)


_SUPPORT_STOP_TERMS = {"opendrsai", "runtime"}
_SUPPORT_STOP_TERMS_CJK = {"根据", "提供", "知识库", "回答", "请问", "什么", "是否", "可以", "哪个"}


def knowledge_corpus_state(config_dir: str | Path, resource: KnowledgeResource) -> dict[str, object]:
    """Report what the index actually contains, including what it failed to read.

    Retrieval that finds nothing means "the corpus does not answer this" only
    when the corpus is known to be complete. Callers that turn an empty result
    into a refusal must consult this first.
    """

    index = knowledge_index_path(config_dir, resource.knowledge_id)
    if not index.is_file():
        raise ConfigError("Knowledge Base has not been indexed")
    db = sqlite3.connect(index)
    try:
        _require_current_index(db)
        documents = [
            {
                "source": source, "title": title, "status": status, "reason": reason,
                "detail": detail, "chunk_count": chunk_count, "sha256": sha256,
            }
            for source, title, status, reason, detail, chunk_count, sha256 in db.execute(
                "SELECT source, title, status, reason, detail, chunk_count, sha256"
                " FROM documents ORDER BY source"
            )
        ]
        meta = dict(db.execute("SELECT key, value FROM meta").fetchall())
    finally:
        db.close()
    # A document we could not read and a document we chose not to read are both
    # listed, but only the first one means the corpus is not fully known.
    failed = [document for document in documents if document["status"] == _DOCUMENT_FAILED]
    skipped = [document for document in documents if document["status"] == _DOCUMENT_SKIPPED]
    return {
        "knowledge_id": resource.knowledge_id,
        "corpus_complete": meta.get("corpus_complete") == "1",
        "corpus_revision": meta.get("corpus_revision", ""),
        "document_count": len(documents) - len(failed) - len(skipped),
        "documents": documents,
        "unreadable_documents": failed,
        "skipped_documents": skipped,
    }


def _require_current_index(db: sqlite3.Connection) -> None:
    try:
        row = db.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    except sqlite3.DatabaseError:
        row = None
    if not row or row[0] != str(_INDEX_SCHEMA_VERSION):
        raise ConfigError("Knowledge Base index is outdated; re-index the Knowledge Base")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _decode_locator(raw: str) -> dict[str, object]:
    try:
        decoded = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def knowledge_status(config_dir: str | Path, resource: KnowledgeResource) -> dict[str, object]:
    if not resource.enabled:
        return {"knowledge_id": resource.knowledge_id, "status": "disabled"}
    if resource.type == "ragflow":
        credential_ref = str((resource.config or {}).get("credential_ref") or "")
        return {"knowledge_id": resource.knowledge_id, "status": "credential_required" if not credential_ref else "configured"}
    index = knowledge_index_path(config_dir, resource.knowledge_id)
    if not index.is_file():
        return {"knowledge_id": resource.knowledge_id, "status": "not_indexed"}
    try:
        db = sqlite3.connect(index)
        try:
            _require_current_index(db)
            chunk_count = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            document_count, unreadable_count, skipped_count = db.execute(
                "SELECT"
                " SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END),"
                " SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),"
                " SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END)"
                " FROM documents"
            ).fetchone()
            complete = db.execute("SELECT value FROM meta WHERE key = 'corpus_complete'").fetchone()
        finally:
            db.close()
        return {
            "knowledge_id": resource.knowledge_id,
            "status": "ready",
            "document_count": int(document_count or 0),
            "chunk_count": chunk_count,
            "corpus_complete": bool(complete and complete[0] == "1"),
            "unreadable_document_count": int(unreadable_count or 0),
            "skipped_document_count": int(skipped_count or 0),
            "updated_at": index.stat().st_mtime,
        }
    except ConfigError:
        # An index from an older build cannot answer position or completeness
        # questions; surface it as needing a rebuild rather than as ready.
        return {"knowledge_id": resource.knowledge_id, "status": "stale_index"}
    except (OSError, sqlite3.DatabaseError):
        return {"knowledge_id": resource.knowledge_id, "status": "failed"}


def _validate_config(kind: str, config: dict[str, object]) -> None:
    if kind == "local-files":
        if not str(config.get("root_path") or "").strip():
            raise ConfigError("local-files Knowledge Base requires root_path")
        paths = config.get("paths", ["."])
        if not isinstance(paths, list) or any(not isinstance(value, str) or not value for value in paths):
            raise ConfigError("Knowledge Base paths are invalid")
        chunk_size = config.get("chunk_size", 800)
        overlap = config.get("chunk_overlap", 120)
        if not isinstance(chunk_size, int) or not 100 <= chunk_size <= 8000 or not isinstance(overlap, int) or overlap < 0 or overlap >= chunk_size:
            raise ConfigError("Knowledge Base chunk settings are invalid")
        max_bytes = config.get("max_document_bytes")
        # Out-of-range values are clamped when used, but a non-numeric value is a
        # configuration mistake worth reporting instead of silently ignoring.
        if max_bytes is not None and (isinstance(max_bytes, bool) or not isinstance(max_bytes, int)):
            raise ConfigError("Knowledge Base max_document_bytes is invalid")
    else:
        url = str(config.get("base_url") or "")
        dataset_ids = config.get("dataset_ids")
        if not re.fullmatch(r"https?://[^\s]+", url) or not isinstance(dataset_ids, list) or not dataset_ids:
            raise ConfigError("RAGFlow Knowledge Base connection is invalid")
        if config.get("token") or config.get("api_key"):
            raise ConfigError("Knowledge Base secrets must use credential_ref")


def _terms(query: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(re.findall(r"[\w\u4e00-\u9fff]{2,}", query.lower())))


def _read_resource(path: Path) -> KnowledgeResource:
    try:
        with path.open("rb") as stream:
            raw = tomllib.load(stream)
        config = json.loads(str(raw.get("config_json") or "{}"))
        resource = KnowledgeResource(str(raw["knowledge_id"]), str(raw["display_name"]), str(raw["type"]), bool(raw.get("enabled", True)), config)
    except (OSError, KeyError, ValueError, TypeError, tomllib.TOMLDecodeError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Knowledge resource '{path.name}' is invalid") from exc
    normalized = put_validation_only(resource)
    if raw.get("schema_version") != 1 or path.name != f"knowledge_{normalized.knowledge_id}.toml":
        raise ConfigError(f"Knowledge resource '{path.name}' is invalid")
    return normalized


def put_validation_only(resource: KnowledgeResource) -> KnowledgeResource:
    knowledge_id = canonical_knowledge_id(resource.knowledge_id)
    kind = str(resource.type).strip().lower()
    if kind not in _SUPPORTED_TYPES:
        raise ConfigError("Knowledge Base type is unsupported")
    config = dict(resource.config or {})
    _validate_config(kind, config)
    display_name = str(resource.display_name).strip()
    if not display_name or len(display_name) > 160:
        raise ConfigError("Knowledge Base display name is invalid")
    return KnowledgeResource(knowledge_id, display_name, kind, bool(resource.enabled), config)


def _render_resource(resource: KnowledgeResource) -> str:
    config_json = json.dumps(resource.config or {}, ensure_ascii=False, sort_keys=True)
    return "".join((
        "schema_version = 1\n",
        f"knowledge_id = {json.dumps(resource.knowledge_id, ensure_ascii=False)}\n",
        f"display_name = {json.dumps(resource.display_name, ensure_ascii=False)}\n",
        f"type = {json.dumps(resource.type)}\n",
        f"enabled = {'true' if resource.enabled else 'false'}\n",
        f"config_json = {json.dumps(config_json, ensure_ascii=False)}\n",
    ))


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            handle.write(payload); handle.flush(); os.fsync(handle.fileno()); temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists(): temporary.unlink(missing_ok=True)
