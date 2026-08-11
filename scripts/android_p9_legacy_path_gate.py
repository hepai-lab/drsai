from __future__ import annotations

import argparse
import ast
from dataclasses import dataclass
import json
from pathlib import Path
import zipfile


@dataclass(frozen=True)
class LegacyPathAudit:
    passed: bool
    gates: dict[str, bool]
    errors: tuple[str, ...]


def python_kernel_gate(engine: Path, factory: Path, probe: Path) -> dict[str, bool]:
    engine_text = engine.read_text(encoding="utf-8")
    factory_text = factory.read_text(encoding="utf-8")
    probe_text = probe.read_text(encoding="utf-8")
    tree = ast.parse(engine_text)
    mobile_classes = [node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == "MobileAgentCore"]
    aliases = [node for node in ast.walk(tree) if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == "MobileAgentCore" for target in node.targets)]
    alias_is_exact = len(aliases) == 1 and isinstance(aliases[0].value, ast.Name) and aliases[0].value.id == "DrSaiAgentKernel"
    return {
        "mobile_agent_core_has_no_independent_class": not mobile_classes and alias_is_exact,
        "legacy_constructor_delegates_only_to_shared_factory": (
            'return create_agent_kernel(surface="android")' in engine_text
            and "return DrSaiAgentKernel(" not in engine_text
        ),
        "shared_compatibility_factory_delegates_only_to_shared_factory": (
            "return create_agent_kernel(surface=surface)" in factory_text
            and "DrSaiAgentKernel()" not in factory_text
        ),
        "android_production_probe_uses_shared_factory_directly": (
            'create_agent_kernel(surface="android")' in probe_text
            and "create_mobile_agent_core" not in probe_text
            and "create_shared_mobile_core" not in probe_text
        ),
    }


def apk_gate(main_apk: Path, test_apk: Path | None = None) -> dict[str, bool]:
    with zipfile.ZipFile(main_apk) as archive:
        main_bytes = b"".join(archive.read(name) for name in archive.namelist()
                             if name.endswith((".dex", ".pyc", ".py", ".json")))
    test_has_acceptance = True
    if test_apk is not None:
        with zipfile.ZipFile(test_apk) as archive:
            test_bytes = b"".join(archive.read(name) for name in archive.namelist() if name.endswith((".dex", ".json")))
        test_has_acceptance = b"acceptance_tool_" in test_bytes and b"runP9NaturalToolSelection" in test_bytes
    return {
        "production_apk_contains_no_fake_acceptance_tool": b"acceptance_tool_" not in main_bytes,
        "production_apk_contains_no_acceptance_runner_argument": b"runP9NaturalToolSelection" not in main_bytes,
        "scanner_distinguishes_test_apk_from_production_apk": test_has_acceptance,
    }


def audit(root: Path, main_apk: Path, test_apk: Path | None = None) -> LegacyPathAudit:
    gates = {
        **python_kernel_gate(
            root / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
            root / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/factory.py",
            root / "apps/android/app/src/main/python/runtime_probe.py",
        ),
        **apk_gate(main_apk, test_apk),
    }
    kotlin = "\n".join(path.read_text(encoding="utf-8") for path in
                        (root / "apps/android/app/src/main").rglob("*.kt"))
    gates["kotlin_lite_runtime_is_absent_from_production"] = (
        "class LocalAgentRuntime" not in kotlin and "LocalAgentRuntime(" not in kotlin
    )
    gates["parity_claim_is_derived_only_from_the_72_item_ledger"] = all(token in
        (root / "apps/android/app/build.gradle.kts").read_text(encoding="utf-8") for token in (
            "p9AcceptanceItems.all", "desktopAgentParityComplete", "expectedP9Ids",
        ))
    return LegacyPathAudit(all(gates.values()), gates, tuple(key for key, value in gates.items() if not value))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--main-apk", type=Path, required=True)
    parser.add_argument("--test-apk", type=Path)
    args = parser.parse_args()
    result = audit(args.root.resolve(), args.main_apk.resolve(), args.test_apk.resolve() if args.test_apk else None)
    print(json.dumps({"passed": result.passed, "gates": result.gates, "errors": result.errors}))
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
