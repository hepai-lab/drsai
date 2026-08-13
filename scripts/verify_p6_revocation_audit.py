#!/usr/bin/env python3
"""Static fail-closed gate for P6 targeted revocation and content-free audit UX."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _source(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file() or not (value := path.read_text(encoding="utf-8")):
        raise RuntimeError(f"p6_revocation_source_missing:{relative}")
    return value


def verify() -> dict[str, object]:
    home = _source(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"
    )
    screen = _source(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt"
    )
    replay = _source("cores/python/packages/drsai/src/drsai/relay/oaep_replay.py")
    api = _source("cores/python/packages/drsai/src/drsai/relay/api.py")
    audit_screen = _source(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt"
    )
    audit_model = _source(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt"
    )
    checks = {
        "disconnect_preserves_cache_by_default": (
            "clearLocalCache: Boolean = false" in home
            and "if (clearLocalCache)" in home
        ),
        "explicit_clear_cache_choice": (
            "同时清除本机缓存、草稿和历史投影" in screen
            and "onRevokeAssociationAndClear" in screen
        ),
        "targeted_stream_invalidation": (
            "invalidate_authorization" in replay
            and api.count("invalidate_authorization(") >= 3
            and "invalidate_runtime(runtime_id)" in api
        ),
        "audit_shows_actor_workspace_time_action": all(value in audit_screen for value in (
            "remoteAuditActionLabel(entry.action)",
            "操作方：${entry.actorLabel}",
            "工作区：$workspaceName",
            "Text(entry.timestamp",
        )),
        "audit_model_excludes_content": (
            "data class RemoteAuditEntry(" in audit_model
            and not any(value in audit_model.split("data class RemoteAuditEntry(", 1)[1].split(")", 1)[0]
                        for value in ("message", "content", "body", "command", "path", "token"))
        ),
    }
    failed = sorted(name for name, passed in checks.items() if not passed)
    if failed:
        raise RuntimeError("p6_revocation_audit_gate_failed:" + ",".join(failed))
    return {"passed": True, "checks": checks, "check_count": len(checks)}


def main() -> int:
    print(json.dumps(verify(), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
