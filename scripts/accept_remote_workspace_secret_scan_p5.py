#!/usr/bin/env python3
"""Single operator entry for endpoint-local P5 secret evidence."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
OPERATIONS = {
    "android": "collect_android_secret_scan_p5.py",
    "windows": "collect_windows_secret_scan_v3.py",
    "assemble": "assemble_remote_workspace_secret_scan_p5.py",
}


def run(operation: str, forwarded: list[str]) -> int:
    driver_name = OPERATIONS.get(operation)
    if driver_name is None:
        raise ValueError(f"p5_secret_operation_unknown:{operation}")
    driver = ROOT / "scripts" / driver_name
    if not driver.is_file() or not driver.read_bytes():
        raise RuntimeError(f"p5_secret_driver_missing:{operation}")
    return subprocess.run([sys.executable, str(driver), *forwarded], cwd=ROOT, check=False).returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="remote-workspace accept secret-scan")
    parser.add_argument("operation", choices=tuple(OPERATIONS))
    args, forwarded = parser.parse_known_args(argv)
    return run(args.operation, forwarded)


if __name__ == "__main__":
    raise SystemExit(main())
