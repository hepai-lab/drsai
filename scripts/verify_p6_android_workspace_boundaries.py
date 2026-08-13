#!/usr/bin/env python3
"""Fail-closed architecture gate for the eight Android remote-workspace boundaries."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/android/app/src/main/java"
BOUNDARY_FILE = MAIN / "ai/drsai/remote/remote/data/RemoteWorkspaceBoundaries.kt"
CONTAINER_FILE = MAIN / "ai/drsai/remote/remote/data/RemoteWorkspaceContainer.kt"
BOUNDARIES = ("auth", "association", "catalog", "session", "run", "approval", "file", "push")
RAW_CAPABILITIES = (
    "tokenStore", "auth", "deviceProof", "repository", "stream", "oaepSessions",
    "legacyConversations", "relayDiscovery", "runControls", "approvalDecisions", "workspace",
)


def verify() -> dict[str, object]:
    boundary = BOUNDARY_FILE.read_text(encoding="utf-8")
    container = CONTAINER_FILE.read_text(encoding="utf-8")
    expected_classes = {
        "auth": "RemoteAuthBoundary", "association": "RemoteAssociationBoundary",
        "catalog": "RemoteCatalogBoundary", "session": "RemoteSessionBoundary",
        "run": "RemoteRunBoundary", "approval": "RemoteApprovalBoundary",
        "file": "RemoteFileBoundary", "push": "RemotePushBoundary",
    }
    for name, class_name in expected_classes.items():
        if not re.search(rf"\b(?:data\s+)?class\s+{class_name}\b", boundary):
            raise ValueError(f"p6_android_boundary_missing:{name}")
        if not re.search(rf"\bval\s+{name}:\s*{class_name}\b", boundary):
            raise ValueError(f"p6_android_boundary_catalog_missing:{name}")
        if not re.search(rf"\b{name}\s*=\s*{class_name}\b", container):
            raise ValueError(f"p6_android_boundary_wiring_missing:{name}")
    if "val boundaries: RemoteWorkspaceBoundaries" not in container:
        raise ValueError("p6_android_boundary_root_missing")
    for capability in RAW_CAPABILITIES:
        if re.search(rf"^\s*val\s+{capability}\b", container, re.MULTILINE):
            raise ValueError(f"p6_android_raw_capability_public:{capability}")

    violations: list[str] = []
    raw_pattern = re.compile(rf"\bcontainer\.({'|'.join(RAW_CAPABILITIES)})\b")
    for path in sorted(MAIN.rglob("*.kt")):
        if path in {BOUNDARY_FILE, CONTAINER_FILE}:
            continue
        if raw_pattern.search(path.read_text(encoding="utf-8")):
            violations.append(path.relative_to(ROOT).as_posix())
    if violations:
        raise ValueError(f"p6_android_raw_capability_bypass:{','.join(violations)}")

    required_consumers = {
        "RemoteHomeViewModel.kt": ("boundaries.auth", "boundaries.association", "boundaries.catalog"),
        "WorkspaceSessionsViewModel.kt": ("boundaries.session", "boundaries.approval", "boundaries.catalog", "boundaries.file"),
        "RemoteSessionViewModel.kt": ("boundaries.auth", "boundaries.session", "boundaries.run", "boundaries.approval", "boundaries.file"),
        "RemotePushMessaging.kt": ("boundaries.push",),
    }
    all_files = {path.name: path for path in MAIN.rglob("*.kt")}
    for filename, markers in required_consumers.items():
        source = all_files[filename].read_text(encoding="utf-8")
        for marker in markers:
            if marker not in source:
                raise ValueError(f"p6_android_boundary_consumer_missing:{filename}:{marker}")
    return {"boundaries": len(BOUNDARIES), "bypasses": 0, "passed": True}


def main() -> int:
    try:
        result = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
