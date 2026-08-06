from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    tests = [
        "cores/python/packages/drsai/tests/test_agent_kernel_factory.py",
        "cores/python/packages/drsai/tests/test_desktop_agent_kernel_adapter.py",
        "cores/python/packages/drsai/tests/test_desktop_autogen_ports.py",
        "cores/python/packages/drsai/tests/test_desktop_kernel_coordinator.py",
        "cores/python/packages/drsai/tests/test_desktop_kernel_run_stream.py",
        "cores/python/packages/drsai/tests/test_desktop_manager_ports.py",
        "cores/python/packages/drsai/tests/test_memory_policy.py",
    ]
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", *tests, "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=120, check=False,
    )
    assistant_source = (REPO / "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py").read_text(encoding="utf-8")
    factory_source = (REPO / "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py").read_text(encoding="utf-8")
    adapter_source = (REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py").read_text(encoding="utf-8")
    gates = {
        "focused_production_regression_passed": completed.returncode == 0,
        "production_entry_calls_shared_adapter": "async for event in run_agent_through_kernel(" in assistant_source,
        "all_non_command_task_shapes_use_kernel": "and isinstance(task, str)" not in assistant_source[assistant_source.index("use_kernel_stream = ("):assistant_source.index("if use_kernel_stream:")],
        "shared_kernel_is_factory_default": "assistant._shared_agent_kernel = shared_agent_kernel" in factory_source,
        "legacy_environment_cannot_select_second_loop": "DRSAI_P9_DESKTOP_KERNEL_LEGACY" not in factory_source,
        "multimodal_task_has_opaque_artifact_binding": "normalize_desktop_kernel_task" in adapter_source and "input-image-" in adapter_source,
        "default_subagent_policy_enters_kernel_profile": '"agent_profile": _desktop_default_subagent_profile(agent)' in adapter_source,
        "terminal_checkpoint_is_proven": "agent._agent_kernel_checkpoint" in (REPO / tests[1]).read_text(encoding="utf-8"),
    }
    sources = [
        "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_autogen_ports.py",
        "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py",
        *tests,
    ]
    report = {
        "schema_version": 1,
        "feature_id": "M01-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {
            "returncode": completed.returncode,
            "summary": "\n".join((completed.stdout + completed.stderr).strip().splitlines()[-4:]),
        },
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m01-f04-desktop-production-entry.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
