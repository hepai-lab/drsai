"""Run the Desktop OAEP V4 release checks and emit a minimal JUnit report."""
from __future__ import annotations

import argparse
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "apps" / "desktop" / "windows"
CHECKS = (
    ("desktop_typecheck", ("npm.cmd", "run", "typecheck")),
    ("oaep_runtime_contract", ("npm.cmd", "run", "verify:oaep-runtime-contract")),
    (
        "session_conversation_subscription",
        ("npm.cmd", "run", "verify:session-conversation-subscription"),
    ),
    (
        "runtime_client_integration",
        ("npm.cmd", "run", "verify:runtime-client-integration"),
    ),
)


def run(output: Path) -> int:
    suite = ET.Element(
        "testsuite",
        name="desktop-mobile-remote-workspace-v4",
        tests=str(len(CHECKS)),
        failures="0",
        errors="0",
    )
    failures = 0
    started = time.perf_counter()
    for name, command in CHECKS:
        check_started = time.perf_counter()
        completed = subprocess.run(
            command,
            cwd=DESKTOP,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        case = ET.SubElement(
            suite,
            "testcase",
            classname="desktop.v4.release",
            name=name,
            time=f"{time.perf_counter() - check_started:.3f}",
        )
        if completed.returncode:
            failures += 1
            failure = ET.SubElement(
                case,
                "failure",
                type="release_check_failed",
                message=f"{name} exited with code {completed.returncode}",
            )
            failure.text = "Command output omitted from release evidence."
    suite.set("failures", str(failures))
    suite.set("time", f"{time.perf_counter() - started:.3f}")
    output.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(suite).write(output, encoding="utf-8", xml_declaration=True)
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return run(args.output.resolve())


if __name__ == "__main__":
    raise SystemExit(main())
