"""Fail-closed static checks for the Android Stage 7 security boundary."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ANDROID = "{http://schemas.android.com/apk/res/android}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.repo.resolve()
    app = root / "apps/android/app"
    manifest = ET.parse(app / "src/main/AndroidManifest.xml").getroot()
    application = manifest.find("application")
    errors: list[str] = []
    checks: dict[str, bool] = {}

    def require(name: str, condition: bool) -> None:
        checks[name] = condition
        if not condition:
            errors.append(name)

    require("backup_disabled", application is not None and application.get(ANDROID + "allowBackup") == "false")
    require("no_large_heap", application is not None and application.get(ANDROID + "largeHeap") != "true")
    components = list(application or [])
    exported = [node for node in components if node.get(ANDROID + "exported") == "true"]
    require("single_exported_entry", len(exported) == 1 and exported[0].get(ANDROID + "name") == ".ExternalEntryActivity")
    runtime = next((node for node in components if node.get(ANDROID + "name") == ".runtime.python.PythonRuntimeService"), None)
    require("runtime_private_process", runtime is not None and runtime.get(ANDROID + "exported") == "false" and runtime.get(ANDROID + "process") == ":runtime")

    paths = ET.parse(app / "src/main/res/xml/file_paths.xml").getroot()
    require("file_provider_narrow_paths", all(node.tag == "cache-path" and node.get("path", "") not in ("", ".", "/") for node in paths))

    gradle = (app / "build.gradle.kts").read_text(encoding="utf-8")
    release = gradle[gradle.find("release {"):gradle.find('create("mvp")')]
    require("release_cleartext_disabled", 'manifestPlaceholders["usesCleartextTraffic"] = "false"' in release)

    source_text = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in (app / "src/main").rglob("*.kt"))
    pending_calls = re.findall(r"PendingIntent\.get\w+\([\s\S]*?\n\s*\)", source_text)
    require("pending_intents_immutable", bool(pending_calls) and all("FLAG_IMMUTABLE" in call for call in pending_calls))
    forbidden = ("DexClassLoader", "PathClassLoader", "InMemoryDexClassLoader", "Runtime.getRuntime().exec", "ProcessBuilder(")
    require("no_dynamic_code_execution", not any(token in source_text for token in forbidden))
    entry = (app / "src/main/java/ai/drsai/remote/ExternalEntryActivity.kt").read_text(encoding="utf-8")
    require("exported_entry_drops_extras", "Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(intent.data)" in entry and "putExtras" not in entry)

    identity = None
    if args.identity_from:
        identity = json.loads(args.identity_from.read_text(encoding="utf-8")).get("identity")
        require("identity_present", isinstance(identity, dict))
    value = {"schema_version": 2, "result": "passed" if not errors else "failed", "checks": checks, "errors": errors}
    if identity is not None:
        value["identity"] = identity
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
