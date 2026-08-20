from __future__ import annotations

import argparse
import json
from pathlib import Path

from opendrsai_dsh_runtime.pressure import run_pressure_matrix
from opendrsai_dsh_runtime.release_gate import (
    atomic_write_json,
    build_real_dsh_matrix,
    build_release_report,
    scan_release_artifacts,
)
from opendrsai_dsh_runtime.wheel_verify import verify_bridge_wheel


def _read(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Build auditable DSH Runtime P1 release evidence")
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--pressure-database", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve(strict=False)
    probe = _read(args.probe)
    matrix = build_real_dsh_matrix(probe)
    wheel = verify_bridge_wheel(args.wheel)
    security = scan_release_artifacts([args.wheel, args.probe])
    pressure = run_pressure_matrix(args.pressure_database)
    report = build_release_report(
        ledger=_read(args.ledger), real_matrix=matrix, wheel=wheel, security=security, pressure=pressure,
    )
    for name, value in {
        "dsh-real-rc5-matrix.json": matrix,
        "dsh-runtime-wheel-verification.json": wheel,
        "dsh-runtime-security-scan.json": security,
        "dsh-runtime-pressure-matrix.json": pressure,
        "dsh-runtime-p1-release-report.json": report,
    }.items():
        atomic_write_json(output / name, value)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["delivery_verdict"] == "accepted" else 2


if __name__ == "__main__":
    raise SystemExit(main())
