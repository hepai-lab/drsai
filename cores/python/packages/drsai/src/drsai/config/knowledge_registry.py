"""Knowledge-base resources and auditable local-file retrieval indexes."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import tomllib
from typing import Iterable

from .loader import ConfigError

_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")
_SUPPORTED_TYPES = {"local-files", "ragflow"}
_TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".rst", ".py", ".js", ".ts", ".tsx", ".json", ".toml", ".yaml", ".yml", ".csv"}


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


def index_local_files(config_dir: str | Path, resource: KnowledgeResource) -> dict[str, object]:
    if resource.type != "local-files":
        raise ConfigError("Only local-files Knowledge Bases can be indexed locally")
    config = dict(resource.config or {})
    root = Path(str(config.get("root_path") or "")).expanduser().resolve()
    if not root.is_dir():
        raise ConfigError("Knowledge Base root_path is unavailable")
    source_paths = config.get("paths") or ["."]
    assert isinstance(source_paths, list)
    chunk_size = int(config.get("chunk_size") or 800)
    chunk_overlap = int(config.get("chunk_overlap") or 120)
    documents: list[tuple[str, str]] = []
    seen: set[Path] = set()
    for raw in source_paths:
        candidate = (root / str(raw)).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ConfigError("Knowledge Base path escapes root_path") from exc
        paths: Iterable[Path] = candidate.rglob("*") if candidate.is_dir() else (candidate,)
        for path in paths:
            if not path.is_file() or path in seen or path.stat().st_size > 20 * 1024 * 1024:
                continue
            text = _extract_text(path)
            if text.strip():
                seen.add(path)
                documents.append((path.relative_to(root).as_posix(), text))
    index = knowledge_index_path(config_dir, resource.knowledge_id)
    index.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(index)
    try:
        db.executescript("DROP TABLE IF EXISTS chunks; CREATE TABLE chunks (chunk_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, content TEXT NOT NULL, content_sha256 TEXT NOT NULL);")
        chunk_count = 0
        for source, text in documents:
            document_id = hashlib.sha256(source.encode()).hexdigest()
            for position, content in enumerate(_chunks(text, chunk_size, chunk_overlap)):
                digest = hashlib.sha256(content.encode()).hexdigest()
                chunk_id = f"{document_id}:{position}"
                db.execute("INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)", (chunk_id, document_id, Path(source).name, source, content, digest))
                chunk_count += 1
        db.commit()
    finally:
        db.close()
    return {"knowledge_id": resource.knowledge_id, "status": "ready", "document_count": len(documents), "chunk_count": chunk_count, "index_path": str(index)}


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
        for chunk_id, document_id, title, source, content, digest in db.execute("SELECT chunk_id, document_id, title, source, content, content_sha256 FROM chunks"):
            lowered = content.lower()
            matches = sum(lowered.count(term) for term in query_terms)
            if matches <= 0:
                continue
            score = min(1.0, matches / max(1, len(query_terms) * 3))
            if score >= score_threshold:
                scored.append(KnowledgeEvidence(resource.knowledge_id, document_id, title, source, chunk_id, score, content, digest))
    finally:
        db.close()
    scored.sort(key=lambda item: (-item.score, item.source, item.chunk_id))
    return tuple(scored[:max(1, min(top_k, 50))])


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
            document_count = db.execute("SELECT COUNT(DISTINCT document_id) FROM chunks").fetchone()[0]
            chunk_count = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        finally:
            db.close()
        return {"knowledge_id": resource.knowledge_id, "status": "ready", "document_count": document_count, "chunk_count": chunk_count, "updated_at": index.stat().st_mtime}
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
    else:
        url = str(config.get("base_url") or "")
        dataset_ids = config.get("dataset_ids")
        if not re.fullmatch(r"https?://[^\s]+", url) or not isinstance(dataset_ids, list) or not dataset_ids:
            raise ConfigError("RAGFlow Knowledge Base connection is invalid")
        if config.get("token") or config.get("api_key"):
            raise ConfigError("Knowledge Base secrets must use credential_ref")


def _extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in _TEXT_SUFFIXES:
        return path.read_text(encoding="utf-8", errors="replace")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            return "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
        except Exception:
            return ""
    if suffix == ".docx":
        try:
            from docx import Document
            return "\n".join(paragraph.text for paragraph in Document(str(path)).paragraphs)
        except Exception:
            return ""
    return ""


def _chunks(text: str, size: int, overlap: int) -> Iterable[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    step = max(1, size - overlap)
    for start in range(0, len(normalized), step):
        value = normalized[start:start + size].strip()
        if value:
            yield value
        if start + size >= len(normalized):
            break


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
