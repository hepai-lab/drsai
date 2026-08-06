from opendrsai_regression.evidence import collect_evidence, redact


def test_collect_evidence_distinguishes_empty_from_missing() -> None:
    complete = collect_evidence(run={"status": "completed"}, inspection={"timeline": []}, snapshot={}, manifest={"model": "x"})
    assert complete["evidence_complete"] is True
    assert complete["tool_calls"] == []
    missing = collect_evidence(run={"status": "completed"}, inspection={}, snapshot={}, manifest={"model": "x"})
    assert missing["evidence_complete"] is False
    assert "items" in missing["missing"]


def test_collect_evidence_extracts_attempts_and_relations() -> None:
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{"type": "tool_call", "tool": "web_search", "attempts": [{"status": "failed"}, {"status": "completed"}]}]},
    )
    assert len(evidence["tool_calls"]) == 1
    assert [item["status"] for item in evidence["tool_attempts"]] == ["failed", "completed"]


def test_collect_evidence_normalizes_skill_and_artifact_fields() -> None:
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [
            {"type": "tool_call", "content": {"tool_kind": "skill", "tool_name": "presentations", "status": "completed"}},
            {"type": "artifact", "content": {"path": "deck.pptx", "mime_type": "application/test", "sha256": "abc"}},
        ]},
    )
    assert evidence["skill_activations"][0]["tool_name"] == "presentations"
    assert evidence["artifacts"][0]["relative_path"] == "deck.pptx"


def test_recursive_redaction_catches_secret_names() -> None:
    value = redact({"nested": [{"gateway_token": "one", "my_api_key_value": "two", "safe": "ok"}]})
    assert value["nested"][0] == {"gateway_token": "[REDACTED]", "my_api_key_value": "[REDACTED]", "safe": "ok"}


def test_recursive_redaction_catches_secret_corpus_inside_text() -> None:
    canaries = ["p3-bearer-canary", "p3-api-canary", "p3-cookie-canary", "p3-url-canary"]
    value = redact({"safe": (
        "Authorization: Bearer p3-bearer-canary "
        "api_key=p3-api-canary Cookie: session=p3-cookie-canary\n"
        "https://user:p3-url-canary@example.test/path"
    )})
    serialized = str(value)
    assert not any(canary in serialized for canary in canaries)
