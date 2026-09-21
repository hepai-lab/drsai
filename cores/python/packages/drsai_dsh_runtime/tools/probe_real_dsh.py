from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from opendrsai_dsh_runtime.probe import atomic_write_probe, probe_real_dsh


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe a real DeepSeek Harness SDK JSON-RPC carrier")
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--source-commit")
    parser.add_argument("--provider", default="deepseek-official")
    parser.add_argument("--model", default="deepseek-v4-flash")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    evidence = asyncio.run(probe_real_dsh(
        command=command, workspace_root=args.workspace, state_root=args.state_root,
        profile_id=args.profile, source_commit=args.source_commit,
        provider=args.provider, model=args.model,
    ))
    atomic_write_probe(args.output, evidence)
    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
