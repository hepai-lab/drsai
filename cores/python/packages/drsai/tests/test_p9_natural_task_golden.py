import json
from pathlib import Path


ROOT = Path(__file__).parents[5]
FIXTURE = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-task-golden-v1.json"


def test_natural_task_golden_is_complete_unique_and_contains_no_tool_name_prompting() -> None:
    value = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = value["cases"]
    assert value["schema_version"] == "opendrsai.p9-natural-task-golden/1"
    assert len(cases) >= value["minimum_cases"] == 6
    assert len({case["id"] for case in cases}) == len(cases)
    forbidden = [token.lower() for token in value["forbidden_prompt_tokens"]]
    for case in cases:
        prompt = case["prompt"].lower()
        assert prompt.strip() and not any(token in prompt for token in forbidden), case["id"]
        assert case["domains"]
        assert case["required_observations"][-1] == "run.completed"
        assert "message.completed" in case["required_observations"]


def test_golden_covers_every_full_agent_domain_and_user_visible_terminal_contract() -> None:
    value = json.loads(FIXTURE.read_text(encoding="utf-8"))
    domains = {domain for case in value["cases"] for domain in case["domains"]}
    assert {
        "fresh_information", "citation", "workspace", "approval", "skill",
        "mcp", "connector_scope", "subagent", "artifact",
    } <= domains
    observations = {event for case in value["cases"] for event in case["required_observations"]}
    assert {"tool.completed", "file_change.completed", "skill.selected", "subagent.completed",
            "artifact.created", "citation.verified", "message.completed", "run.completed"} <= observations
