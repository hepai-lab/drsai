#!/usr/bin/env python3
"""Single P5 entry point for Mobile Remote Workspace acceptance.

Legacy V2/V3/V4 drivers remain implementation details until their compatibility
windows close. Release automation and operator documentation must call this CLI.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

PHASES: dict[str, tuple[str, str, str]] = {
    "architecture": ("OAEP/OWOP architecture and legacy isolation", "oaep/1+owop/1", "verify_remote_workspace_p5_architecture.py"),
    "local": ("local contract and component acceptance", "oaep/1+owop/1", "mobile_remote_workspace_acceptance_v4.py"),
    "real-device": ("Windows and one physical Android device", "oaep/1+owop/1", "accept_mobile_remote_workspace_real_device_v4.py"),
    "two-device": ("two physical Android devices and revocation isolation", "oaep/1+owop/1", "accept_mobile_remote_workspace_two_device_v4.py"),
    "stability": ("one-hour recovery and stability gate", "oaep/1+owop/1", "monitor_mobile_remote_workspace_stability_v4.py"),
    "secret-scan": ("endpoint-local Android/Windows scan and cross-boundary assembly", "oaep/1+owop/1", "accept_remote_workspace_secret_scan_p5.py"),
    "push-preflight": ("Android, Relay, and public push readiness preflight", "oaep/1+owop/1", "preflight_remote_workspace_push.py"),
    "evidence": ("assemble a physical P5 release ledger", "oaep/1+owop/1", "assemble_remote_workspace_p5_evidence.py"),
    "finalize": ("P5 evidence and release finalizer", "oaep/1+owop/1", "finalize_remote_workspace_p5.py"),
}


def phase_catalog() -> list[dict[str, str]]:
    return [
        {"phase": phase, "description": values[0], "protocol": values[1], "driver": values[2]}
        for phase, values in PHASES.items()
    ]


def run_phase(phase: str, forwarded: list[str]) -> int:
    if phase not in PHASES:
        raise ValueError(f"unknown_remote_workspace_phase:{phase}")
    driver = ROOT / "scripts" / PHASES[phase][2]
    if not driver.is_file():
        raise RuntimeError(f"remote_workspace_driver_missing:{phase}")
    return subprocess.run([sys.executable, str(driver), *forwarded], cwd=ROOT, check=False).returncode


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="remote-workspace")
    sub = result.add_subparsers(dest="command", required=True)
    accept = sub.add_parser("accept", help="run a named P5 acceptance phase")
    accept.add_argument("phase", nargs="?")
    accept.add_argument("--list", action="store_true", dest="list_phases")
    return result


def main(argv: list[str] | None = None) -> int:
    arguments, forwarded = parser().parse_known_args(argv)
    if arguments.command == "accept" and arguments.list_phases:
        print(json.dumps({"schema_version": "p5/1", "phases": phase_catalog()}, ensure_ascii=False, indent=2))
        return 0
    if arguments.command == "accept" and arguments.phase:
        return run_phase(arguments.phase, forwarded)
    parser().error("accept requires <phase> or --list")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
