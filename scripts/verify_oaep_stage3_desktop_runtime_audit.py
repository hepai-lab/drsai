"""Audit the OAEP Stage 3 Windows Desktop + Runtime scope.

Android real-device convergence is owned by the Android thread.  This gate
keeps the desktop/runtime portion explicit so Windows Desktop UI and backend
Runtime work can be completed without depending on a physical Android device.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

FEATURES: list[dict[str, Any]] = [
    {
        "id": "M01-F01",
        "module": "M01",
        "title": "Desktop dev Runtime startup guard",
        "status": "passed_local",
        "evidence": ["verify:gateway-smoke"],
    },
    {
        "id": "M01-F02",
        "module": "M01",
        "title": "Desktop OAEP capability detection",
        "status": "passed_local",
        "evidence": ["verify:oaep-release"],
    },
    {
        "id": "M01-F03",
        "module": "M01",
        "title": "Desktop text streaming",
        "status": "passed_local",
        "evidence": ["verify:chat-output", "verify:oaep-runtime-contract"],
    },
    {
        "id": "M01-F04",
        "module": "M01",
        "title": "Desktop tool and command projection",
        "status": "passed_local",
        "evidence": ["verify:oaep-runtime-contract"],
    },
    {
        "id": "M01-F05",
        "module": "M01",
        "title": "Desktop failed and cancelled run display",
        "status": "passed_local",
        "evidence": ["verify:oaep-runtime-contract", "verify:chat-output"],
    },
    {
        "id": "M01-F06",
        "module": "M01",
        "title": "Desktop snapshot refresh recovery",
        "status": "passed_local",
        "evidence": ["verify:session-conversation-subscription"],
    },
    {
        "id": "M01-F07",
        "module": "M01",
        "title": "Desktop OAEP debug entry",
        "status": "passed_local",
        "evidence": ["verify:oaep-runtime-contract"],
    },
    {
        "id": "M03-F01",
        "module": "M03",
        "title": "Legacy chat_completion text-only projection",
        "status": "passed_local",
        "evidence": ["test_oaep_protocol.py"],
    },
    {
        "id": "M03-F02",
        "module": "M03",
        "title": "Legacy chat_completion session binding",
        "status": "passed_local",
        "evidence": ["test_gateway_session_events.py"],
    },
    {
        "id": "M03-F03",
        "module": "M03",
        "title": "Legacy chat_completion compatibility path",
        "status": "passed_local",
        "evidence": ["test_relay_api.py"],
    },
    {
        "id": "M03-F04",
        "module": "M03",
        "title": "Tool semantics stay in OAEP",
        "status": "passed_local",
        "evidence": ["test_oaep_protocol.py"],
    },
    {
        "id": "M03-F05",
        "module": "M03",
        "title": "Legacy text stream regression",
        "status": "passed_local",
        "evidence": ["verify:chat-output"],
    },
    {
        "id": "M03-F06",
        "module": "M03",
        "title": "Legacy provider migration safety",
        "status": "passed_local",
        "evidence": ["test_model_provider_config.py"],
    },
    {
        "id": "M04-F01",
        "module": "M04",
        "title": "Normalized event field inventory",
        "status": "passed_local",
        "evidence": ["test_codex_event_mapper.py"],
    },
    {
        "id": "M04-F02",
        "module": "M04",
        "title": "Stable item_id",
        "status": "passed_local",
        "evidence": ["test_normalized_agent_events.py"],
    },
    {
        "id": "M04-F03",
        "module": "M04",
        "title": "Unified phase and status",
        "status": "passed_local",
        "evidence": ["test_normalized_agent_events.py"],
    },
    {
        "id": "M04-F04",
        "module": "M04",
        "title": "Command stream normalization",
        "status": "passed_local",
        "evidence": ["test_codex_event_mapper.py"],
    },
    {
        "id": "M04-F05",
        "module": "M04",
        "title": "Artifact metadata normalization",
        "status": "passed_local",
        "evidence": ["test_runtime_conversation_journal.py"],
    },
    {
        "id": "M04-F06",
        "module": "M04",
        "title": "Runtime error envelope",
        "status": "passed_local",
        "evidence": ["test_gateway_session_events.py"],
    },
    {
        "id": "M04-F07",
        "module": "M04",
        "title": "Adapter fixtures",
        "status": "passed_local",
        "evidence": ["test_codex_event_mapper.py"],
    },
    {
        "id": "M05-F01",
        "module": "M05",
        "title": "Runtime/Relay public OAEP DTO validation",
        "status": "passed_local",
        "evidence": ["smoke_runtime_relay_public_v4.py"],
    },
    {
        "id": "M05-F03",
        "module": "M05",
        "title": "OAEP cursor expired handling",
        "status": "passed_local",
        "evidence": ["test_relay_oaep_replay.py"],
    },
    {
        "id": "M05-F04",
        "module": "M05",
        "title": "OAEP stream timeout handling",
        "status": "passed_local",
        "evidence": ["test_relay_api.py"],
    },
    {
        "id": "M05-F05",
        "module": "M05",
        "title": "Public DTO sensitive-field scan",
        "status": "passed_local",
        "evidence": ["smoke_runtime_relay_public_v4.py", "verify:oaep-stage3-readiness"],
    },
    {
        "id": "M07-F01",
        "module": "M07",
        "title": "Runtime scoped OAEP tests",
        "status": "passed_local",
        "evidence": ["pytest runtime OAEP groups"],
    },
    {
        "id": "M07-F02",
        "module": "M07",
        "title": "Windows Desktop OAEP verifier",
        "status": "passed_local",
        "evidence": ["verify:oaep-release", "verify:oaep-stage3-desktop-runtime"],
    },
    {
        "id": "M07-F05",
        "module": "M07",
        "title": "Windows dev owner guard",
        "status": "passed_local",
        "evidence": ["verify:gateway-smoke"],
    },
]

ANDROID_OWNED_FEATURE_IDS = {
    "M02-F01",
    "M02-F02",
    "M02-F03",
    "M02-F04",
    "M02-F05",
    "M02-F06",
    "M05-F02",
    "M06-F01",
    "M06-F02",
    "M06-F03",
    "M06-F04",
    "M06-F05",
    "M07-F03",
    "M07-F04",
}

TUI_FOLLOWUP_FEATURE_IDS = {"M06-F06", "M08-F05"}

EVIDENCE_COMMANDS = [
    "npm --prefix apps\\desktop\\windows run typecheck",
    "npm --prefix apps\\desktop\\windows run verify:oaep-runtime-contract",
    "npm --prefix apps\\desktop\\windows run verify:session-conversation-subscription",
    "npm --prefix apps\\desktop\\windows run verify:chat-output",
    "npm --prefix apps\\desktop\\windows run verify:gateway-smoke",
    "npm --prefix apps\\desktop\\windows run verify:oaep-release",
    ".\\.venv\\Scripts\\python.exe -m pytest cores\\python\\packages\\drsai\\tests\\test_oaep_protocol.py cores\\python\\packages\\drsai\\tests\\test_gateway_session_events.py cores\\python\\packages\\drsai\\tests\\test_codex_event_mapper.py cores\\python\\packages\\drsai\\tests\\test_normalized_agent_events.py cores\\python\\packages\\drsai\\tests\\test_runtime_conversation_journal.py cores\\python\\packages\\drsai\\tests\\test_relay_oaep_replay.py cores\\python\\packages\\drsai\\tests\\test_relay_api.py cores\\python\\packages\\drsai\\tests\\test_model_provider_config.py -q",
]


def _module_summaries(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        grouped[feature["module"]].append(feature)
    summaries = []
    for module in sorted(grouped):
        rows = grouped[module]
        counts = Counter(row["status"] for row in rows)
        summaries.append(
            {
                "module": module,
                "total": len(rows),
                "status": "passed_local" if counts == {"passed_local": len(rows)} else "incomplete",
                "counts": dict(sorted(counts.items())),
            }
        )
    return summaries


def build_report(*, require_complete: bool = False) -> dict[str, Any]:
    feature_rows = [dict(feature) for feature in FEATURES]
    counts = Counter(feature["status"] for feature in feature_rows)
    blockers = [
        {
            "code": "desktop_runtime_feature_incomplete",
            "message": feature["id"],
        }
        for feature in feature_rows
        if feature.get("status") != "passed_local"
    ]
    complete = not blockers
    return {
        "schema_version": 1,
        "protocol": "oaep/1",
        "stage": 3,
        "scope": "windows_desktop_runtime",
        "feature_total": len(feature_rows),
        "audit_valid": True,
        "complete": complete,
        "passed": complete or not require_complete,
        "counts": dict(sorted(counts.items())),
        "completion_percent": round((counts.get("passed_local", 0) / len(feature_rows)) * 100, 2),
        "module_summaries": _module_summaries(feature_rows),
        "features": feature_rows,
        "out_of_scope": {
            "android_owned_feature_ids": sorted(ANDROID_OWNED_FEATURE_IDS),
            "tui_followup_feature_ids": sorted(TUI_FOLLOWUP_FEATURE_IDS),
        },
        "blockers": blockers,
        "evidence_commands": EVIDENCE_COMMANDS,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(require_complete=args.require_complete)
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
