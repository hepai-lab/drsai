from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel, kernel_factory_identity  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    surfaces = ("desktop", "tui", "android")
    kernels = {surface: create_agent_kernel(surface=surface) for surface in surfaces}
    identities = {surface: kernel_factory_identity(kernel) for surface, kernel in kernels.items()}
    test_path = "cores/python/packages/drsai/tests/test_agent_kernel_factory.py"
    completed = subprocess.run(
        [sys.executable, "-m", "pytest", test_path, "-q"], cwd=REPO,
        capture_output=True, text=True, timeout=90, check=False,
    )
    factory_path = REPO / "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py"
    factory_source = factory_path.read_text(encoding="utf-8")
    android_probe_path = REPO / "apps/android/app/src/main/python/runtime_probe.py"
    android_probe_source = android_probe_path.read_text(encoding="utf-8")
    adapter_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_adapter.py"
    adapter_source = adapter_path.read_text(encoding="utf-8")
    gates = {
        "factory_contract_tests_passed": completed.returncode == 0,
        "all_surfaces_return_same_agent_type": len({type(kernel).__name__ for kernel in kernels.values()}) == 1,
        "all_surfaces_return_same_agent_id": {kernel.agent_type for kernel in kernels.values()} == {"drsai-agent-kernel"},
        "all_surfaces_share_kernel_digest": len({identity["kernel_sha256"] for identity in identities.values()}) == 1,
        "all_surfaces_share_prompt_digest": len({identity["base_prompt_sha256"] for identity in identities.values()}) == 1,
        "desktop_factory_uses_only_kernel_factory": factory_source.count("create_agent_kernel(") == 1 and "DrSaiAgentKernel(" not in factory_source,
        "android_probe_uses_only_kernel_factory": "create_agent_kernel(surface=\"android\")" in android_probe_source and "DrSaiAgentKernel(" not in android_probe_source,
        "desktop_tui_adapters_use_only_kernel_factory": "create_agent_kernel(surface=" in adapter_source and "DrSaiAgentKernel(" not in adapter_source,
        "legacy_production_loop_switch_removed": "DRSAI_P9_DESKTOP_KERNEL_LEGACY" not in factory_source,
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel_factory.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/factory.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_adapter.py",
        "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py",
        "apps/android/app/src/main/python/runtime_probe.py",
        test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M01-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "identities": identities,
        "pytest": {
            "returncode": completed.returncode,
            "summary": "\n".join((completed.stdout + completed.stderr).strip().splitlines()[-4:]),
        },
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m01-f02-single-kernel-factory.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
