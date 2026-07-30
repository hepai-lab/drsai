"""Run the four Desktop V3 gates and emit a secret-free JUnit report."""
from __future__ import annotations

import argparse
import os
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "apps/desktop/windows"
COMMANDS = (
    ("desktop-node-typecheck", ("run", "typecheck:node")),
    ("desktop-web-typecheck", ("run", "typecheck:web")),
    ("desktop-session-sync-state", ("run", "verify:session-sync-state")),
    (
        "desktop-session-conversation-subscription",
        ("run", "verify:session-conversation-subscription"),
    ),
)


@dataclass(frozen=True)
class Result:
    name: str
    duration_seconds: float
    returncode: int


def npm_executable() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def run_all(timeout_seconds: float) -> list[Result]:
    results: list[Result] = []
    for name, arguments in COMMANDS:
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                [npm_executable(), *arguments],
                cwd=DESKTOP,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout_seconds,
                check=False,
            )
            returncode = completed.returncode
        except subprocess.TimeoutExpired:
            returncode = 124
        results.append(
            Result(
                name=name,
                duration_seconds=time.perf_counter() - started,
                returncode=returncode,
            )
        )
    return results


def write_junit(path: Path, results: list[Result]) -> None:
    suite = ET.Element(
        "testsuite",
        {
            "name": "mobile-remote-workspace-v3-desktop",
            "tests": str(len(results)),
            "failures": str(sum(result.returncode != 0 for result in results)),
            "errors": "0",
            "time": f"{sum(result.duration_seconds for result in results):.6f}",
        },
    )
    for result in results:
        case = ET.SubElement(
            suite,
            "testcase",
            {
                "name": result.name,
                "classname": "OpenDrSai.Desktop.RemoteWorkspaceV3",
                "time": f"{result.duration_seconds:.6f}",
            },
        )
        if result.returncode:
            failure = ET.SubElement(
                case,
                "failure",
                {"type": "command_failed"},
            )
            failure.text = f"exit_code={result.returncode}"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    ET.ElementTree(suite).write(temporary, encoding="utf-8", xml_declaration=True)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            ROOT
            / "release/product-evidence/mobile-remote-workspace-v3/"
            "desktop-junit.xml"
        ),
    )
    parser.add_argument("--timeout-seconds", type=float, default=120)
    args = parser.parse_args()
    results = run_all(args.timeout_seconds)
    write_junit(args.output, results)
    failed = [result.name for result in results if result.returncode]
    print(
        f"Desktop V3 gates: {len(results) - len(failed)}/{len(results)} passed; "
        f"JUnit={args.output}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
