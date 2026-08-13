from pathlib import Path

from opendrsai_regression.assertions import _matches_required, evaluate, semantic_pending, verdict
from opendrsai_regression.case_loader import CaseCatalog
from opendrsai_regression.media_evaluator import inspect_artifact


ROOT = Path(__file__).resolve().parents[1]


def test_required_skill_steps_are_order_independent() -> None:
    assert _matches_required(
        {"skill_id": "pptx", "required_steps": ["artifact_registered", "instructions_loaded", "visual_check_completed"]},
        {"skill_id": "pptx", "required_steps": ["instructions_loaded", "visual_check_completed", "artifact_registered"]},
    )


def test_greeting_passes_deterministic_assertions() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    results = evaluate(case, {
        "run": {"status": "completed"}, "output": "Hello! How can I help?",
        "tool_calls": [], "skill_activations": [], "knowledge_queries": [], "approvals": [], "artifacts": [],
    })
    assert all(item.passed for item in results)
    assert verdict(results, semantic_pending=True) == "inconclusive"


def test_json_rejects_surrounding_text() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.constraints.json"]
    results = evaluate(case, {
        "run": {"status": "completed"},
        "output": '结果：{"name":"张三","age":28,"skills":["Python","TypeScript"]}',
        "tool_calls": [], "skill_activations": [], "knowledge_queries": [], "approvals": [], "artifacts": [],
    })
    assert verdict(results) == "failed"
    assert any(item.path == "output.json" and not item.passed for item in results)


def test_runtime_retry_requires_both_attempts() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.failure.recovery"]
    results = evaluate(case, {
        "run": {"status": "completed"}, "output": "2026年9月10日至11日，上海。",
        "tool_calls": [{"tool": "web_search"}], "logical_tool_call_count": 1,
        "tool_attempts": [{"tool": "web_search", "status": "completed"}],
        "artifacts": [],
    })
    assert verdict(results) == "failed"


def test_runtime_retry_uses_only_deterministic_fixture_fact_assertions() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.failure.recovery"]
    output = "活动于2026年9月10日至11日在上海举办，主题包括 Agent Runtime、OAEP 和 Tool Safety。"
    spec = case.data["expect"]["output"]

    assert case.revision == 4
    assert "semantic_requirements" not in spec
    assert semantic_pending(case, {"output": output}) is False
    assert all(literal.casefold() in output.casefold() for literal in spec["required_literals"])
    assert all(__import__("re").search(pattern, output) for pattern in spec["required_patterns"])


def test_web_citation_assertions_accept_indico_overview_alias_without_generic_false_failure() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.web.hepix"]
    requirements = case.data["expect"]["output"]["semantic_requirements"]
    citations = [
        {
            "citation_id": f"citation-{index}", "url": url, "interactive": True,
            "markdown_part_id": "assistant:markdown", "claim_ids": ["assistant"],
        }
        for index, url in enumerate((
            "https://www.hepix.org/",
            "https://indico.cern.ch/event/1598655/",
            "https://indico.cern.ch/event/1679145/",
        ), 1)
    ]
    evidence = {
        "run": {"status": "completed"}, "output": "HEPiX Spring and Fall 2026",
        "capabilities": ["web_search"], "tool_calls": [{"tool_name": "web_search", "status": "completed"}],
        "logical_tool_call_count": 1, "external_writes": [], "artifacts": [],
        "source_access": {"require_primary_source": True, "required_domains": ["hepix.org", "indico.cern.ch"]},
        "citations": citations, "semantic_judgments": {item: True for item in requirements},
    }

    results = evaluate(case, evidence)

    assert all(item.passed for item in results), [item.message for item in results if not item.passed]


def test_oaep_citation_navigation_requires_openable_bidirectional_relation() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.web.hepix"]
    requirements = case.data["expect"]["output"]["semantic_requirements"]
    evidence = {
        "run": {"status": "completed"}, "output": "HEPiX Spring and Fall 2026",
        "capabilities": ["web_search"], "tool_calls": [{"tool_name": "web_search", "status": "completed"}],
        "logical_tool_call_count": 1, "external_writes": [], "artifacts": [],
        "source_access": {"require_primary_source": True, "required_domains": ["hepix.org", "indico.cern.ch"]},
        "citations": [
            {"citation_id": "one", "url": "https://indico.cern.ch/event/1598655/", "interactive": False},
            {"citation_id": "two", "url": "https://indico.cern.ch/event/1679145/overview", "interactive": True},
        ],
        "semantic_judgments": {item: True for item in requirements},
    }

    results = evaluate(case, evidence)

    assert any(item.path == "citations.openable_target" and not item.passed for item in results)
    assert any(item.path == "citations.bidirectional_navigation" and not item.passed for item in results)


def test_run_comparison_checks_numbers_references_and_causality() -> None:
    case = CaseCatalog(ROOT).load_cases()["run.inspect_compare"]
    requirements = case.data["expect"]["output"]["semantic_requirements"]
    evidence = {
        "run": {"status": "completed"},
        "output": "run-regression-baseline-001 和 run-regression-candidate-001：web_search，耗时增加 1420，Token 增加 39。",
        "operation_calls": [
            {"operation": "run.inspect", "run_id": "run-regression-baseline-001"},
            {"operation": "run.inspect", "run_id": "run-regression-candidate-001"},
            {"operation": "run.manifest.read", "run_id": "run-regression-baseline-001"},
            {"operation": "run.manifest.read", "run_id": "run-regression-candidate-001"},
            {"operation": "run.compare", "baseline_run_id": "run-regression-baseline-001", "candidate_run_id": "run-regression-candidate-001"},
        ],
        "approvals": [], "external_network_calls": [], "external_writes": [], "artifacts": [],
        "comparison": case.data["expect"]["comparison"],
        "references": [{**item, "interactive": True} for item in case.data["expect"]["references"]["required"]],
        "semantic_judgments": {item: True for item in requirements},
    }
    results = evaluate(case, evidence)
    assert all(item.passed for item in results), [item.message for item in results if not item.passed]


def test_absent_knowledge_requires_completed_exhaustive_search_without_match() -> None:
    case = CaseCatalog(ROOT).load_cases()["knowledge.absent"]
    result = {
        "status": "completed", "completed": True, "corpus_complete": True,
        "supporting_match": False, "supporting_matches": [],
        "documents": [{
            "knowledge_base_id": "regression.opendrsai-runtime",
            "knowledge_base_revision": 1,
        }],
    }
    base = {
        "run": {"status": "completed"},
        "output": "提供的知识库没有默认端口信息，无法仅根据该知识库确定。",
        "tool_calls": [], "skill_activations": [], "approvals": [], "artifacts": [],
        "workspace_search_calls": [], "unrelated_tool_calls": [], "external_writes": [],
        "knowledge_queries": [{"tool": "knowledge_search", "result": result}],
    }
    checks = [
        item for item in evaluate(case, base)
        if item.path.startswith("behavior.knowledge_search")
    ]
    assert checks and all(item.passed for item in checks)

    nested = {
        **base,
        "knowledge_queries": [{
            "tool": "knowledge_search", "result": __import__("json").dumps({"result": result}),
        }],
    }
    nested_checks = [
        item for item in evaluate(case, nested)
        if item.path.startswith("behavior.knowledge_search")
    ]
    assert nested_checks and all(item.passed for item in nested_checks)

    false_support = {
        **base,
        "knowledge_queries": [{
            "tool": "knowledge_search", "result": {**result, "supporting_match": True},
        }],
    }
    failed = evaluate(case, false_support)
    assert any(item.path.endswith("no_supporting_match") and not item.passed for item in failed)


def test_absent_knowledge_refusal_is_deterministic_not_model_judged() -> None:
    case = CaseCatalog(ROOT).load_cases()["knowledge.absent"]
    output = "文档中并未包含 Gateway 默认监听端口的信息，因此基于当前知识库我无法回答。"
    spec = case.data["expect"]["output"]

    assert case.revision == 2
    assert "semantic_requirements" not in spec
    assert semantic_pending(case, {"output": output}) is False
    assert all(__import__("re").search(pattern, output) for pattern in spec["required_patterns"])


def test_presentation_uses_structural_visual_and_artifact_evidence() -> None:
    case = CaseCatalog(ROOT).load_cases()["skill.presentation"]
    inspected = inspect_artifact(ROOT / "assets" / "presentation" / "opendrsai-runtime-core-concepts.pptx")
    requirements = case.data["expect"]["presentation"]["visual"]["semantic_requirements"]
    required_slides = case.data["expect"]["presentation"]["required_slides"]
    slides = [{"index": item["index"], "text": item["required_text"]} for item in required_slides]
    presentation = {
        **inspected,
        "slides": slides, "slide_text": [item["text"] for item in slides],
        "visual": {"rendered_slide_count": 4, "conditions": []},
    }
    artifact = {
        **inspected,
        "relative_path": "artifacts/opendrsai-runtime-core-concepts.pptx",
        "linked_in_output": True, "interactive": True, "run_relation": True,
    }
    evidence = {
        "run": {"status": "completed"}, "output": "演示文稿：[打开](opendrsai://artifact/deck)",
        "skill_activations": [{
            "skill_id": "pptx", "status": "completed",
            "required_steps": [
                "instructions_loaded", "presentation_created", "presentation_rendered",
                "visual_check_completed", "artifact_registered",
            ],
        }],
        "tool_calls": [], "knowledge_queries": [], "external_writes": [],
        "presentation": presentation, "artifacts": [artifact],
        "semantic_judgments": {item: True for item in requirements},
    }
    results = evaluate(case, evidence)
    assert all(item.passed for item in results), [item.message for item in results if not item.passed]

    no_render = {**evidence, "presentation": {**presentation, "visual": {"conditions": []}}}
    failed = evaluate(case, no_render)
    assert any(item.path == "presentation.visual.render_all_slides" and not item.passed for item in failed)


def test_generated_image_requires_dimensions_visual_ocr_and_call_relation() -> None:
    case = CaseCatalog(ROOT).load_cases()["image.output.simple"]
    image_spec = case.data["expect"]["image"]
    requirements = list(image_spec["visual_requirements"])
    requirements.extend(f"不得包含：{item}" for item in image_spec["visual_forbidden"])
    evidence = {
        "run": {"status": "completed"}, "output": "图片：[打开](opendrsai://artifact/image)",
        "capabilities": ["image_generation"],
        "tool_calls": [{"tool": "image_generation", "status": "completed"}],
        "knowledge_queries": [], "unrelated_skill_activations": [], "approvals": [], "external_writes": [],
        "image": {
            "format": "png", "orientation": "landscape", "color_mode": "RGB",
            "width": 1280, "height": 720, "ocr": {"recognized_characters": 0},
        },
        "artifacts": [{
            "type": "image", "mime_type": "image/png", "extension": ".png",
            "relative_path": "artifacts/opendrsai-agent-runtime.png", "size_bytes": 20001,
            "sha256": "a" * 64, "openable": True, "run_relation": True,
            "generation_call_relation": True, "linked_in_output": True, "interactive": True,
        }],
        "semantic_judgments": {item: True for item in requirements},
    }
    results = evaluate(case, evidence)
    assert all(item.passed for item in results), [item.message for item in results if not item.passed]

    no_ocr = {**evidence, "image": {key: value for key, value in evidence["image"].items() if key != "ocr"}}
    assert all(item.passed for item in evaluate(case, no_ocr))
    missing_character_judgment = {
        **no_ocr,
        "semantic_judgments": {
            key: value for key, value in evidence["semantic_judgments"].items()
            if key != "不得包含：字母"
        },
    }
    failed = evaluate(case, missing_character_judgment)
    assert any(item.path == "image.ocr.recognized_characters" and not item.passed for item in failed)


def test_workspace_diagnosis_requires_read_only_command_and_failed_test_evidence() -> None:
    case = CaseCatalog(ROOT).load_cases()["workspace.readonly.diagnose"]
    requirements = case.data["expect"]["output"]["semantic_requirements"]
    command = case.data["expect"]["test_execution"]["command"]
    evidence = {
        "run": {"status": "completed"},
        "output": "src/runtime_metrics.py 的 success_rate 在空列表上先除以零，触发 ZeroDivisionError；应先检查空输入。没有修改文件。",
        "workspace_reads": [{"path": "src/runtime_metrics.py"}, {"path": "tests/test_runtime_metrics.py"}],
        "workspace_writes": [], "file_creations": [], "file_deletions": [],
        "patch_operations": [], "git_write_operations": [],
        "shell_commands": [{"policy": "read_only", "command": command}],
        "network_calls": [], "approvals": [], "artifacts": [],
        "test_execution": {
            "command": command, "exit_code": 1,
            "output": "test_success_rate_empty_returns_zero FAILED ZeroDivisionError",
        },
        "workspace": case.data["expect"]["workspace"],
        "semantic_judgments": {item: True for item in requirements},
    }
    results = evaluate(case, evidence)
    assert all(item.passed for item in results), [item.message for item in results if not item.passed]

    wrong_policy = {**evidence, "shell_commands": [{"policy": "write", "command": command}]}
    failed = evaluate(case, wrong_policy)
    assert any(item.path.endswith("require_policy") and not item.passed for item in failed)


def test_approval_required_means_evidence_presence_not_literal_required_field() -> None:
    case = CaseCatalog(ROOT).load_cases()["safety.write_approval"]
    expected = case.data["expect"]["approval"]
    actual = {key: value for key, value in expected.items() if key != "required"}
    actual["count"] = 1
    base = {
        "run": {"status": "completed"}, "output": "output/approval-proof.txt 已在审批后创建。",
        "capabilities": ["regression_controlled_write"],
        "tool_calls": [{"tool": "regression_controlled_write"}], "tool_attempts": [{}],
        "approvals": [{}], "unauthorized_writes": [], "network_calls": [], "writes_outside_allowed_root": [],
        "approval": actual, "idempotency": case.data["expect"]["idempotency"],
        "filesystem": case.data["expect"]["filesystem"], "artifacts": [],
        "semantic_judgments": {item: True for item in case.data["expect"]["output"]["semantic_requirements"]},
    }
    checks = [item for item in evaluate(case, base) if item.path.startswith("approval")]
    assert checks and all(item.passed for item in checks)

    missing = [item for item in evaluate(case, {**base, "approval": None}) if item.path.startswith("approval")]
    assert any(not item.passed for item in missing)
