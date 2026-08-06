from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def green(path: Path, feature: str) -> bool:
    if not path.is_file():
        return False
    value = json.loads(path.read_text(encoding="utf-8"))
    return value.get("feature_id") == feature and value.get("passed") is True


def main() -> int:
    fixture = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-task-golden-v1.json"
    test = ROOT / "cores/python/packages/drsai/tests/test_p9_natural_task_golden.py"
    reports = {
        "M05-F04": ROOT / "docs/android/reports/evidence/p9/m05-f04-forced-retrieval.json",
        "M06-F06": ROOT / "docs/android/reports/evidence/p9/m06-f06-workspace-natural-e2e.json",
        "M07-F02": ROOT / "docs/android/reports/evidence/p9/m07-f02-skill-selection.json",
        "M07-F04": ROOT / "docs/android/reports/evidence/p9/m07-f04-streamable-http-mcp.json",
        "M07-F05": ROOT / "docs/android/reports/evidence/p9/m07-f05-stdio-mcp-handoff.json",
        "M08-F06": ROOT / "docs/android/reports/evidence/p9/m08-f06-natural-multistep-e2e.json",
    }
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", str(test.relative_to(ROOT)), "-q"], cwd=ROOT,
        capture_output=True, text=True, timeout=60, check=False,
    )
    value = json.loads(fixture.read_text(encoding="utf-8"))
    prompts = [case["prompt"].lower() for case in value["cases"]]
    domains = {domain for case in value["cases"] for domain in case["domains"]}
    gates = {
        "golden_fixture_is_versioned_and_has_six_unique_natural_cases": (
            value["schema_version"] == "opendrsai.p9-natural-task-golden/1"
            and len(value["cases"]) == len({case["id"] for case in value["cases"]}) >= 6
        ),
        "prompts_do_not_name_implementation_tools": not any(
            token.lower() in prompt for token in value["forbidden_prompt_tokens"] for prompt in prompts
        ),
        "hepix_freshness_and_citation_are_green": green(reports["M05-F04"], "M05-F04"),
        "workspace_edit_diff_approval_and_user_result_are_green": green(reports["M06-F06"], "M06-F06"),
        "skill_selection_and_version_visibility_are_green": green(reports["M07-F02"], "M07-F02"),
        "streamable_http_mcp_scope_and_result_are_green": green(reports["M07-F04"], "M07-F04"),
        "stdio_mcp_requires_remote_handoff_and_confirmation": green(reports["M07-F05"], "M07-F05"),
        "subagent_artifact_citation_and_terminal_e2e_are_green": green(reports["M08-F06"], "M08-F06"),
        "all_required_agent_domains_are_covered": {
            "fresh_information", "citation", "workspace", "approval", "skill", "mcp",
            "connector_scope", "subagent", "artifact",
        } <= domains,
        "golden_contract_tests_are_green": pytest.returncode == 0,
    }
    sources = (fixture, test, *reports.values())
    report = {
        "schema_version": 1, "feature_id": "M12-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(gates.values()),
        "gates": gates, "case_count": len(value["cases"]),
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "bound_feature_evidence": {key: digest(path) for key, path in reports.items()},
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m12-f03-natural-task-golden.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "cases": len(value["cases"])}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
