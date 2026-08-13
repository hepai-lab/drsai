from __future__ import annotations

import argparse
import json
import time

from drsai.modules.agents.skills_agent.managers.regression_manager import RegressionManager


def main() -> int:
    parser = argparse.ArgumentParser(description="Exercise one case through the Agent regression tool adapter.")
    parser.add_argument("case_id")
    parser.add_argument("--suite", default="p3-desktop")
    parser.add_argument("--workspace-agent", required=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args()

    manager = RegressionManager(args.workspace_agent)
    preflight = json.loads(manager.execute("regression_preflight", {
        "suite_id": args.suite,
        "case_ids": [args.case_id],
    }))
    print(json.dumps({"preflight": preflight}, ensure_ascii=False), flush=True)
    if preflight["status"] != "ready":
        return 2
    evaluation = json.loads(manager.execute("regression_start", {
        "suite_id": args.suite,
        "case_ids": preflight["case_ids"],
        "catalog_revision": preflight["catalog_revision"],
        "confirmation_token": preflight.get("confirmation_token"),
    }))
    print(json.dumps({"started": evaluation}, ensure_ascii=False), flush=True)
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        current = json.loads(manager.execute("regression_get", {
            "evaluation_id": evaluation["evaluation_id"],
        }))
        if current["status"] in {"passed", "failed", "blocked", "cancelled"}:
            print(json.dumps({"finished": current}, ensure_ascii=False), flush=True)
            return 0 if current["status"] == "passed" else 1
        time.sleep(1.0)
    print(json.dumps({"timeout": evaluation["evaluation_id"]}), flush=True)
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
