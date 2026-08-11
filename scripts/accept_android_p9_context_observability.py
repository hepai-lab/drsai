from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import assemble_agent_context, build_context_observability  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    secret = "sk-private-prompt-body"
    path = "C:\\Users\\private\\SKILL.md"
    agent = {"project_instructions": secret}
    skills = [{
        "id": "private", "version": 1, "source": path,
        "availability": "local", "instructions": secret,
    }]
    budget = {
        "policy_version": "p9-context-budget-v1",
        "context_window_tokens": 4_096,
        "reserved_output_tokens": 1_024,
        "max_messages": 10,
        "summary_tokens": 256,
    }
    history = [{"role": "user", "content": f"old-{index} {secret}" + "x" * 260} for index in range(100)]
    messages = assemble_agent_context(history, "current", agent=agent, skills=skills, context_budget=budget)
    diagnostic = build_context_observability(
        agent, skills, messages, budget, history_message_count=len(history),
    )
    encoded = json.dumps(diagnostic, ensure_ascii=False, sort_keys=True)
    mapper_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt"
    mapper = mapper_path.read_text(encoding="utf-8")
    gates = {
        "prompt_body_redacted": secret not in encoded,
        "absolute_path_redacted": path not in encoded and "external-source" in encoded,
        "active_layers_have_digest": all(len(value["sha256"]) == 64 for value in diagnostic["layers"]),
        "absent_layers_explained": any(
            value["status"] == "absent" and value["trim_reason"] == "not_configured"
            for value in diagnostic["layers"]
        ),
        "token_estimate_exported": diagnostic["context"]["estimated_input_tokens"] > 0,
        "budget_digest_exported": len(diagnostic["context"]["sha256"]) == 64,
        "trimming_explained": diagnostic["omitted_history_messages"] > 0
        and diagnostic["trim_reason"] == "token_or_message_budget"
        and diagnostic["summary_applied"],
        "android_allowlist_mapper": "contextObservabilityDiagnostic" in mapper
        and '"context_observability_snapshot"' in mapper
        and '"content" to' not in mapper[mapper.index("private fun contextObservabilityDiagnostic"):mapper.index("private fun safeSource")],
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/tests/test_context_budget_policy.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt",
        "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M02-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "diagnostic": diagnostic,
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m02-f06-context-observability.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
