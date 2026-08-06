from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import (  # noqa: E402
    CONTEXT_BUDGET_POLICY_VERSION,
    ContextBudgetPolicy,
    assemble_agent_context,
    estimate_context_tokens,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cost(messages: list[dict]) -> int:
    return sum(4 + estimate_context_tokens(message) for message in messages)


def main() -> int:
    policy_raw = {
        "policy_version": CONTEXT_BUDGET_POLICY_VERSION,
        "context_window_tokens": 4_096,
        "reserved_output_tokens": 1_024,
        "max_messages": 18,
        "summary_tokens": 256,
    }
    policy = ContextBudgetPolicy.from_mapping(policy_raw)
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"turn-{index} 关键约束 " + "数据😀" * 80}
        for index in range(1_000)
    ]
    call = {"id": "call-1", "type": "function", "function": {"name": "search", "arguments": "{}"}}
    history.extend((
        {"role": "assistant", "content": "", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "call-1", "content": '{"verified":true}'},
    ))
    result = assemble_agent_context(history, "CURRENT-INTENT", context_budget=policy_raw)
    call_index = next(index for index, value in enumerate(result) if value.get("tool_calls"))

    android_engine = (REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt").read_text(encoding="utf-8")
    desktop_adapter = (REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py").read_text(encoding="utf-8")
    factory = (REPO / "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py").read_text(encoding="utf-8")
    gates = {
        "within_input_token_budget": cost(result) <= policy.input_tokens,
        "response_tokens_reserved": policy.input_tokens + policy.reserved_output_tokens == policy.context_window_tokens,
        "message_limit_respected": len(result) <= policy.max_messages,
        "authoritative_system_pinned": result[0]["role"] == "system" and "[TOOL_POLICY]" in result[0]["content"],
        "current_user_intent_pinned": result[-1] == {"role": "user", "content": "CURRENT-INTENT"},
        "long_history_summarized": any("EARLIER_CONVERSATION_SUMMARY" in value["content"] for value in result),
        "active_tool_chain_atomic": result[call_index + 1].get("tool_call_id") == "call-1",
        "unicode_estimator_is_utf8_aware": estimate_context_tokens("😀" * 100) > estimate_context_tokens("a" * 100),
        "android_binds_selected_model_window": "ModelContextBudgetEnvelope.from(selectedModel)" in android_engine,
        "desktop_binds_factory_window": 'context_budget=getattr(agent, "_p9_context_budget", None)' in desktop_adapter
        and 'assistant._p9_context_budget = {' in factory,
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/context.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/tests/test_context_budget_policy.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt",
        "apps/android/app/src/test/java/ai/drsai/remote/AndroidLocalCapabilitiesTest.kt",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M02-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "fixture": {
            "history_messages": len(history),
            "selected_messages": len(result),
            "estimated_input_tokens": cost(result),
            "input_token_limit": policy.input_tokens,
        },
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m02-f05-context-budget.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
