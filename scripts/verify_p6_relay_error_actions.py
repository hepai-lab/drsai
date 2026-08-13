#!/usr/bin/env python3
"""Fail-closed verifier for the generated P6 Relay error-action contract."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
ACTIONS = {"retry", "login", "re-pair", "update", "contact-admin"}


def _tool(name: str) -> str:
    executable = name + (".cmd" if os.name == "nt" else "")
    bundled = ROOT / "apps/desktop/node_modules/.bin" / executable
    if bundled.is_file():
        return str(bundled)
    resolved = shutil.which(name)
    if resolved:
        return resolved
    raise RuntimeError(f"p6_error_action_{name}_missing")


def main() -> int:
    schema = json.loads(
        (ROOT / "cores/protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8")
    )
    groups = schema.get("x-relay-error-actions")
    if not isinstance(groups, dict) or set(groups) != ACTIONS:
        raise RuntimeError("p6_error_action_groups_invalid")
    codes = [code for values in groups.values() for code in values]
    if not codes or len(codes) != len(set(codes)):
        raise RuntimeError("p6_error_action_codes_invalid")

    esbuild, node = _tool("esbuild"), _tool("node")
    source = ROOT / "apps/desktop/windows/scripts/verify-p6-relay-error-actions.mts"
    if not source.is_file():
        raise RuntimeError("p6_error_action_desktop_test_missing")
    with tempfile.TemporaryDirectory(prefix="opendrsai-p6-error-actions-") as directory:
        bundle = Path(directory) / "verify.mjs"
        build = subprocess.run(
            [esbuild, str(source), "--bundle", "--platform=node", "--format=esm", f"--outfile={bundle}"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if build.returncode != 0:
            raise RuntimeError("p6_error_action_desktop_compile_failed")
        run = subprocess.run([node, str(bundle)], cwd=ROOT, capture_output=True, text=True, check=False)
        if run.returncode != 0:
            raise RuntimeError("p6_error_action_desktop_test_failed")
        result = json.loads(run.stdout.strip())
        if result != {"passed": True, "codes": len(codes), "actions": len(ACTIONS)}:
            raise RuntimeError("p6_error_action_desktop_result_invalid")
    print(json.dumps({"passed": True, "codes": len(codes), "actions": len(ACTIONS)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
