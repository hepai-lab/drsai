from __future__ import annotations

import hashlib
import sqlite3

import pytest

from drsai.config.knowledge_registry import (
    ConfigError,
    KnowledgeResource,
    index_local_files,
    knowledge_corpus_state,
    knowledge_index_path,
    knowledge_status,
    put_knowledge_resource,
    search_local_knowledge,
    search_local_knowledge_scope,
)

RUNTIME_DOC = "\n".join([
    "# OpenDrSai Runtime",
    "",
    "Runtime hosts Sessions and Runs.",
    "",
    "## Session",
    "",
    "A Session is one continuous user conversation and can contain multiple Runs.",
    "",
    "## Replay",
    "",
    "Replay always creates a new Run and never overwrites the original Run.",
])


def _resource(root, **overrides) -> KnowledgeResource:
    config = {"root_path": str(root), "paths": ["."], "chunk_size": 400, "chunk_overlap": 40}
    config.update(overrides)
    return KnowledgeResource("runtime-docs", "Runtime docs", "local-files", True, config)


def test_evidence_carries_a_position_that_can_be_opened(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))

    index_local_files(config_dir, resource)
    evidence = search_local_knowledge(config_dir, resource, "Replay original Run", top_k=3)

    assert evidence
    top = evidence[0]
    assert top.source == "runtime.md"
    assert top.locator["kind"] == "heading"
    assert top.locator["heading_path"] == ["OpenDrSai Runtime", "Replay"]
    # A line range is what makes the citation openable at the right spot.
    assert top.locator["line_start"] == 9
    assert top.locator_label.startswith("OpenDrSai Runtime > Replay")


def test_evidence_identifies_the_exact_document_revision(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    document = docs / "runtime.md"
    document.write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))

    first = index_local_files(config_dir, resource)
    evidence = search_local_knowledge(config_dir, resource, "Replay original Run")[0]
    expected = hashlib.sha256(document.read_bytes()).hexdigest()

    # The chunk digest only covers the excerpt; verifying a citation needs the
    # digest of the file revision the excerpt came from.
    assert evidence.document_sha256 == expected
    assert evidence.content_sha256 != expected

    document.write_text(RUNTIME_DOC + "\n\nGateway listens on a configured port.\n", encoding="utf-8")
    second = index_local_files(config_dir, resource)
    assert second["corpus_revision"] != first["corpus_revision"]


def test_chunks_never_span_two_heading_sections(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs, chunk_size=8000))

    index_local_files(config_dir, resource)
    db = sqlite3.connect(knowledge_index_path(config_dir, "runtime-docs"))
    try:
        rows = db.execute("SELECT content, locator_label FROM chunks ORDER BY ordinal").fetchall()
    finally:
        db.close()

    # chunk_size is large enough to hold the whole file, but a chunk that spans
    # two sections could not name one position, so the anchors still split it.
    assert len(rows) >= 3
    session = next(content for content, _label in rows if "one continuous user conversation" in content)
    assert "Replay always creates" not in session


def test_unreadable_document_breaks_corpus_completeness(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    # A PDF with no extractable text stands in for a scan: it is a document we
    # claim to support, so failing to read it must not pass as an empty corpus.
    (docs / "scanned.pdf").write_bytes(b"%PDF-1.4 not really a pdf")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))

    result = index_local_files(config_dir, resource)

    assert result["corpus_complete"] is False
    assert result["document_count"] == 1
    assert [item["source"] for item in result["unreadable_documents"]] == ["scanned.pdf"]

    state = knowledge_corpus_state(config_dir, resource)
    assert state["corpus_complete"] is False
    assert [item["source"] for item in state["unreadable_documents"]] == ["scanned.pdf"]
    assert knowledge_status(config_dir, resource)["unreadable_document_count"] == 1


def test_complete_corpus_is_reported_complete(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    # Files in formats the Knowledge Base never claimed to read are not corpus
    # members and must not drag completeness down.
    (docs / "diagram.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))

    result = index_local_files(config_dir, resource)

    assert result["corpus_complete"] is True
    assert result["ignored_file_count"] == 1
    assert knowledge_corpus_state(config_dir, resource)["corpus_complete"] is True
    assert knowledge_status(config_dir, resource)["corpus_complete"] is True


def test_scope_reports_supporting_evidence_with_a_position(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))
    index_local_files(config_dir, resource)

    scope = search_local_knowledge_scope(config_dir, resource, "Session Run")

    assert scope["status"] == "completed"
    assert scope["completed"] is True
    assert scope["corpus_complete"] is True
    assert scope["supporting_match"] is True
    assert scope["supporting_matches"]
    top = scope["supporting_matches"][0]
    assert top["relation"] == "supports_claim"
    assert top["locator"]["heading_path"]
    assert scope["documents"][0]["document_path"] == "runtime.md"


def test_scope_names_what_was_searched_when_nothing_supports(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))
    index_local_files(config_dir, resource)

    scope = search_local_knowledge_scope(config_dir, resource, "OpenDrSai Gateway default port")

    # The document shares "OpenDrSai" and "Gateway" with the question but says
    # nothing about ports. Term overlap alone would call that support and turn
    # a correct refusal into a guess.
    assert scope["supporting_match"] is False
    assert scope["supporting_matches"] == []
    assert scope["evidence"], "a refusal still has to name the scope it searched"
    assert all(row["relation"] == "searched_scope" for row in scope["evidence"])
    assert scope["evidence"][0]["document_path"] == "runtime.md"
    assert scope["corpus_complete"] is True


def test_scope_listing_is_capped_and_says_so(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    for index in range(60):
        (docs / f"doc_{index:03d}.md").write_text(f"# Doc {index}\n\nRuntime note {index}.\n", encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))
    index_local_files(config_dir, resource)

    scope = search_local_knowledge_scope(config_dir, resource, "OpenDrSai Gateway default port")

    # A refusal has to name what it searched, but a large corpus must not push
    # thousands of empty rows into the model's context.
    assert scope["supporting_match"] is False
    assert len(scope["evidence"]) <= 20
    assert scope["scope_truncated"] is True
    assert len(scope["documents"]) <= 50
    assert scope["documents_truncated"] is True
    # The exact size stays visible even when the listing is cut.
    assert scope["document_count"] == 60


def test_truncated_document_breaks_corpus_completeness(tmp_path, monkeypatch) -> None:
    import drsai.content.documents as documents

    monkeypatch.setattr(documents, "_MAX_UNITS", 3)
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "long.md").write_text("\n".join(f"- item {index}" for index in range(10)), encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))

    result = index_local_files(config_dir, resource)

    assert result["corpus_complete"] is False
    assert [item["status"] for item in result["unreadable_documents"]] == ["truncated"]
    # The part that was read is still searchable; only completeness is denied.
    assert result["chunk_count"] > 0


def test_incomplete_corpus_is_reported_through_scope(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    (docs / "scanned.pdf").write_bytes(b"%PDF-1.4 not really a pdf")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))
    index_local_files(config_dir, resource)

    scope = search_local_knowledge_scope(config_dir, resource, "OpenDrSai Gateway default port")

    # "Not found" must not be reported as "not present" while part of the
    # corpus was never read.
    assert scope["corpus_complete"] is False
    assert scope["supporting_match"] is False


def test_index_written_by_an_older_build_is_refused_not_downgraded(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "runtime.md").write_text(RUNTIME_DOC, encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, _resource(docs))
    index_local_files(config_dir, resource)

    db = sqlite3.connect(knowledge_index_path(config_dir, "runtime-docs"))
    try:
        db.execute("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
        db.commit()
    finally:
        db.close()

    # Serving results from an index without positions would quietly downgrade
    # every citation to file level, so reading it is refused outright.
    with pytest.raises(ConfigError):
        search_local_knowledge(config_dir, resource, "Replay")
    assert knowledge_status(config_dir, resource)["status"] == "stale_index"
