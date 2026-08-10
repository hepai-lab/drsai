from __future__ import annotations

import pytest

from drsai.config.knowledge_registry import (
    KnowledgeResource,
    delete_knowledge_resource,
    get_knowledge_resource,
    index_local_files,
    knowledge_status,
    list_knowledge_resources,
    put_knowledge_resource,
    knowledge_resource_payload,
    search_local_knowledge,
)


def test_local_knowledge_registry_indexes_and_returns_auditable_evidence(tmp_path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "product.md").write_text("OpenDrSai supports per-Agent tools and knowledge bases.", encoding="utf-8")
    config_dir = tmp_path / "config"
    resource = put_knowledge_resource(config_dir, KnowledgeResource(
        "product-docs", "Product docs", "local-files", True,
        {"root_path": str(docs), "paths": ["."], "chunk_size": 200, "chunk_overlap": 20},
    ))

    result = index_local_files(config_dir, resource)
    evidence = search_local_knowledge(config_dir, resource, "Agent knowledge", top_k=3)

    assert result["document_count"] == 1
    assert knowledge_status(config_dir, resource)["status"] == "ready"
    assert len(evidence) == 1
    assert evidence[0].knowledge_id == "product-docs"
    assert evidence[0].source == "product.md"
    assert evidence[0].content_sha256
    assert get_knowledge_resource(config_dir, "product-docs") == resource


def test_local_knowledge_rejects_path_escape(tmp_path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("secret", encoding="utf-8")
    resource = put_knowledge_resource(tmp_path / "config", KnowledgeResource(
        "safe-docs", "Safe docs", "local-files", True,
        {"root_path": str(root), "paths": ["../outside.md"]},
    ))
    with pytest.raises(Exception, match="escapes"):
        index_local_files(tmp_path / "config", resource)


def test_ragflow_registry_requires_credential_reference_not_plaintext_secret(tmp_path) -> None:
    with pytest.raises(Exception, match="credential_ref"):
        put_knowledge_resource(tmp_path, KnowledgeResource(
            "remote", "Remote", "ragflow", True,
            {"base_url": "https://rag.example.invalid", "dataset_ids": ["one"], "token": "secret"},
        ))


def test_ragflow_public_payload_exposes_only_credential_presence() -> None:
    payload = knowledge_resource_payload(KnowledgeResource(
        "remote", "Remote", "ragflow", True,
        {"base_url": "https://rag.example.invalid", "dataset_ids": ["one"], "credential_ref": "drsai-credential:private"},
    ))
    assert payload["credential_configured"] is True
    assert "credential_ref" not in payload["config"]
    assert "drsai-credential:" not in str(payload)


def test_delete_knowledge_removes_resource_and_index(tmp_path) -> None:
    docs = tmp_path / "docs"; docs.mkdir(); (docs / "a.txt").write_text("hello world", encoding="utf-8")
    resource = put_knowledge_resource(tmp_path / "config", KnowledgeResource(
        "docs", "Docs", "local-files", True, {"root_path": str(docs), "paths": ["."]},
    ))
    index_local_files(tmp_path / "config", resource)
    assert delete_knowledge_resource(tmp_path / "config", "docs") == resource
    assert list_knowledge_resources(tmp_path / "config") == ()
