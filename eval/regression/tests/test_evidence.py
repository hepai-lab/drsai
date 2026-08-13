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


def test_collect_evidence_decodes_kernel_tool_result_attempts_and_retry() -> None:
    result = {"result": {"attempts": [
        {"tool": "web_search", "status": "failed", "error_code": "service_unavailable", "retryable": True},
        {"tool": "web_search", "status": "completed"},
    ]}}
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{"type": "tool_call", "content": {"tool_name": "web_search", "result": __import__("json").dumps(result)}}]},
    )
    assert [item["status"] for item in evidence["tool_attempts"]] == ["failed", "completed"]
    assert evidence["retry"] == {"initiated_by": "runtime_policy", "exact": 1, "same_logical_operation": True}


def test_collect_evidence_decodes_nested_knowledge_documents() -> None:
    document = {
        "knowledge_base_id": "regression.opendrsai-runtime",
        "knowledge_base_revision": 1,
        "document_path": "opendrsai_runtime_overview_v1.md",
        "sha256": "1" * 64,
    }
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{
            "type": "tool_call", "content": {
                "tool_name": "knowledge_search", "status": "completed",
                "result": __import__("json").dumps({"_inspection": {"kind": "knowledge_search"}, "result": {"documents": [document]}}),
            },
        }]},
    )

    assert evidence["retrieved_documents"] == [document]


def test_collect_evidence_derives_direct_web_source_access() -> None:
    url = "https://indico.cern.ch/event/1598655/"
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{
            "type": "tool_call", "content": {
                "tool_name": "web_fetch", "status": "completed",
                "result": __import__("json").dumps({"result": {"final_url": url}}),
            },
        }]},
    )

    assert evidence["source_access"]["require_primary_source"] is True
    assert evidence["source_access"]["required_domains"] == ["indico.cern.ch"]
    assert evidence["source_access"]["fetched_urls"] == [url]


def test_collect_evidence_uses_web_fetch_inspection_and_oaep_message_citations() -> None:
    url = "https://indico.cern.ch/event/1598655/"
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [
            {
                "id": "tool-1", "type": "tool_call", "content": {
                    "tool_name": "web_fetch", "status": "completed",
                    "result": __import__("json").dumps({"_inspection": {"final_url": url}, "result": {}}),
                },
            },
            {
                "id": "message-1", "type": "message", "content": {
                    "role": "assistant", "text": f"Source: {url}",
                    "citations": [{"citation_id": "citation-1", "url": url}],
                },
            },
        ]},
    )

    assert evidence["source_access"]["fetched_urls"] == [url]
    assert evidence["citations"][0]["interactive"] is True
    assert evidence["citations"][0]["markdown_part_id"] == "message-1:markdown"


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


def test_collect_evidence_derives_real_skill_loader_activation() -> None:
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{
            "type": "tool_call",
            "content": {
                "tool_name": "Skill", "status": "completed",
                "arguments": {"skill": "pptx"}, "call_id": "call-skill",
            },
        }]},
    )
    assert evidence["skill_activations"] == [{
        "skill_id": "pptx", "tool_name": "pptx", "status": "completed",
        "required_steps": ["instructions_loaded"], "call_id": "call-skill",
    }]


def test_collect_evidence_recovers_non_sensitive_skill_id_from_redacted_loader_result() -> None:
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [{
            "type": "tool_call", "content": {
                "tool_name": "Skill", "status": "completed", "arguments": "[REDACTED]",
                "result": __import__("json").dumps({"content": '<skill-loaded name="pptx">instructions</skill-loaded>'}),
                "call_id": "call-skill",
            },
        }]},
    )

    assert evidence["skill_activations"][0]["skill_id"] == "pptx"


def test_collect_evidence_projects_controlled_run_operations_and_interactive_references() -> None:
    comparison_uri = "opendrsai://run-comparisons/comparison-regression-001"
    run_uri = "opendrsai://runs/run-regression-baseline-001"
    timeline = [
        {"type": "tool_call", "content": {
            "tool_name": "run_inspect", "arguments": {"run_id": "run-regression-baseline-001"},
            "result": {"references": [{"type": "run", "id": "run-regression-baseline-001", "uri": run_uri}]},
        }},
        {"type": "tool_call", "content": {
            "tool_name": "run_compare", "arguments": {
                "baseline_run_id": "run-regression-baseline-001", "candidate_run_id": "run-regression-candidate-001",
            },
            "result": {
                "comparison": {"comparison_id": "comparison-regression-001", "verdict": "regressed"},
                "references": [{"type": "run_comparison", "id": "comparison-regression-001", "uri": comparison_uri}],
            },
        }},
    ]
    evidence = collect_evidence(
        run={"status": "completed", "output": f"See {run_uri} and {comparison_uri}."},
        manifest={"model": "x"}, snapshot={}, inspection={"timeline": timeline},
    )
    assert [item["operation"] for item in evidence["operation_calls"]] == ["run.inspect", "run.compare"]
    assert evidence["comparison"]["verdict"] == "regressed"
    assert all(item["interactive"] is True for item in evidence["references"])


def test_collect_evidence_derives_read_only_workspace_and_test_execution() -> None:
    command_result = {
        "result": {
            "command": "python -B -m pytest tests/test_runtime_metrics.py",
            "argv": ["python", "-B", "-m", "pytest", "tests/test_runtime_metrics.py"],
            "output": "test_success_rate_empty_returns_zero\nZeroDivisionError\n[exit code: 1]",
            "exit_code": 1,
            "policy": "read_only",
        },
        "_inspection": {"version": 1, "kind": "test_execution"},
    }
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, snapshot={},
        inspection={"timeline": [
            {"type": "tool_call", "content": {"tool_name": "run_read", "arguments": {"path": "src/runtime_metrics.py"}}},
            {"type": "tool_call", "content": {
                "tool_name": "run_powershell",
                "arguments": {"command": "python -B -m pytest tests/test_runtime_metrics.py"},
                "result": __import__("json").dumps(command_result),
            }},
        ]},
    )
    assert evidence["workspace_reads"][0]["tool"] == "run_read"
    assert evidence["shell_commands"][0]["policy"] == "read_only"
    assert evidence["test_execution"] == {
        "command": {"executable": "python", "args": ["-B", "-m", "pytest", "tests/test_runtime_metrics.py"]},
        "exit_code": 1,
        "output": "test_success_rate_empty_returns_zero\nZeroDivisionError\n[exit code: 1]",
    }


def test_collect_evidence_projects_desktop_command_execution_items() -> None:
    result = {
        "result": {
            "command": "python -B tests/test_runtime_metrics.py",
            "argv": ["python", "-B", "tests/test_runtime_metrics.py"],
            "output": "test_success_rate_empty_returns_zero\nZeroDivisionError",
            "exit_code": 1,
            "policy": "read_only",
        },
        "_inspection": {"version": 1, "kind": "test_execution"},
    }
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"},
        inspection={"timeline": [{"id": "read-1", "type": "tool_call", "content": {
            "tool_name": "run_read", "arguments": {"path": "src/runtime_metrics.py"},
        }}]},
        snapshot={"items": [{
            "id": "command-1",
            "type": "command_execution",
            "content": {
                "operation_ref": {"operation": "run_powershell"},
                "output": __import__("json").dumps(result),
            },
        }]},
    )
    assert evidence["workspace_reads"][0]["tool"] == "run_read"
    assert evidence["shell_commands"] == [{
        "tool": "run_powershell",
        "command": "python -B tests/test_runtime_metrics.py",
        "argv": ["python", "-B", "tests/test_runtime_metrics.py"],
        "exit_code": 1,
        "output": "test_success_rate_empty_returns_zero\nZeroDivisionError",
        "policy": "read_only",
    }]
    assert evidence["test_execution"]["exit_code"] == 1


def test_collect_evidence_does_not_count_command_policy_denial_as_execution() -> None:
    denied = {
        "result": {"error": "desktop_regression_command_shell_control_denied", "policy": "regression_allowlist"},
        "_inspection": {"version": 1, "kind": "command_policy_denial"},
    }
    evidence = collect_evidence(
        run={"status": "completed"}, manifest={"model": "x"}, inspection={},
        snapshot={"items": [{
            "id": "denied-command", "type": "command_execution", "content": {
                "operation_ref": {"operation": "run_powershell"},
                "output": __import__("json").dumps(denied),
            },
        }]},
    )
    assert evidence["shell_commands"] == []
    assert evidence["test_execution"] is None


def test_recursive_redaction_catches_secret_names() -> None:
    value = redact({"nested": [{"gateway_token": "one", "my_api_key_value": "two", "safe": "ok"}]})
    assert value["nested"][0] == {"gateway_token": "[REDACTED]", "my_api_key_value": "[REDACTED]", "safe": "ok"}


def test_collect_evidence_proves_local_artifact_link_interaction() -> None:
    run = {"run_id": "run-1", "status": "completed"}
    evidence = collect_evidence(
        run=run, manifest={"model": "fixture"}, snapshot={},
        inspection={"output": "已生成 `artifacts/deck.pptx`", "timeline": [{
            "type": "artifact", "run_id": "run-1", "content": {
                "artifact_id": "artifact-1", "path": "artifacts/deck.pptx",
                "downloadable": True, "previewable": False,
                "resource_refs": [{
                    "protocol": "owop/1", "workspace_id": "workspace-1",
                    "resource_type": "artifact", "resource_id": "artifact-1",
                }],
            },
        }]},
    )
    artifact = evidence["artifacts"][0]
    assert artifact["linked_in_output"] is True
    assert artifact["interactive"] is True
    assert artifact["run_relation"] is True


def test_collect_evidence_relates_generated_image_to_its_tool_call() -> None:
    evidence = collect_evidence(
        run={"run_id": "run-1", "status": "completed"}, manifest={"model": "fixture"}, snapshot={},
        inspection={"output": "artifacts/image.png", "timeline": [
            {"type": "tool_call", "content": {
                "tool_name": "image_generation", "status": "completed",
                "result": __import__("json").dumps({
                    "content": repr({"artifact_id": "artifact-image", "operation": "image_generation"}),
                }),
            }},
            {"type": "artifact", "run_id": "run-1", "content": {
                "artifact_id": "artifact-image", "path": "artifacts/image.png",
            }},
        ]},
    )
    assert evidence["artifacts"][0]["generation_call_relation"] is True


def test_recursive_redaction_catches_secret_corpus_inside_text() -> None:
    canaries = ["p3-bearer-canary", "p3-api-canary", "p3-cookie-canary", "p3-url-canary"]
    value = redact({"safe": (
        "Authorization: Bearer p3-bearer-canary "
        "api_key=p3-api-canary Cookie: session=p3-cookie-canary\n"
        "https://user:p3-url-canary@example.test/path"
    )})
    serialized = str(value)
    assert not any(canary in serialized for canary in canaries)
