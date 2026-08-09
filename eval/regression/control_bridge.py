from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from opendrsai_regression.catalog_api import RegressionCatalogApi  # noqa: E402
from opendrsai_regression.control_service import RegressionControlService  # noqa: E402


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="OpenDrSai Desktop regression control bridge")
    value.add_argument("--output-root", required=True)
    subcommands = value.add_subparsers(dest="command", required=True)
    subcommands.add_parser("list-suites")
    listing = subcommands.add_parser("list-cases")
    listing.add_argument("--suite", required=True)
    detail = subcommands.add_parser("get-case")
    detail.add_argument("--case", required=True)
    begin = subcommands.add_parser("begin")
    begin.add_argument("--suite", required=True)
    begin.add_argument("--case", required=True)
    begin.add_argument("--revision", required=True, type=int)
    begin.add_argument("--definition-sha256", required=True)
    transition = subcommands.add_parser("transition")
    transition.add_argument("--evaluation", required=True)
    transition.add_argument("--status", required=True)
    transition.add_argument("--updates-json", default="{}")
    attach = subcommands.add_parser("attach-run")
    attach.add_argument("--evaluation", required=True)
    attach.add_argument("--thread", required=True)
    attach.add_argument("--run", required=True)
    attach.add_argument("--input-sha256", required=True)
    get = subcommands.add_parser("get")
    get.add_argument("--evaluation", required=True)
    cancel = subcommands.add_parser("cancel")
    cancel.add_argument("--evaluation", required=True)
    history = subcommands.add_parser("history")
    history.add_argument("--limit", type=int, default=100)
    events = subcommands.add_parser("events")
    events.add_argument("--evaluation", required=True)
    return value


def main() -> int:
    args = parser().parse_args()
    api = RegressionCatalogApi(ROOT)
    service = RegressionControlService(ROOT, args.output_root)
    if args.command == "list-suites":
        result = api.list_suites()
    elif args.command == "list-cases":
        result = api.list_cases(args.suite)
    elif args.command == "get-case":
        result = api.get_case(args.case)
    elif args.command == "begin":
        result = service.begin_evaluation(
            suite_id=args.suite,
            case_id=args.case,
            case_revision=args.revision,
            definition_sha256=args.definition_sha256,
        )
    elif args.command == "transition":
        updates = json.loads(args.updates_json)
        if not isinstance(updates, dict):
            raise ValueError("updates-json must contain an object")
        result = service.transition(args.evaluation, args.status, **updates)
    elif args.command == "attach-run":
        result = service.attach_run(
            args.evaluation,
            thread_id=args.thread,
            run_id=args.run,
            input_sha256=args.input_sha256,
        )
    elif args.command == "get":
        result = service.get(args.evaluation)
    elif args.command == "cancel":
        result = service.cancel(args.evaluation)
    elif args.command == "history":
        result = service.list_history(limit=args.limit)
    elif args.command == "events":
        result = service.list_events(args.evaluation)
    else:  # pragma: no cover - argparse enforces this
        raise ValueError("Unsupported command")
    # Keep the bridge byte protocol ASCII-safe on Windows regardless of the
    # parent process' active console code page. JSON parsing restores Unicode.
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": {"code": "regression_control_failed", "message": str(exc)}}, ensure_ascii=True), file=sys.stderr)
        raise SystemExit(2)
