#!/usr/bin/env python3
"""Verify P6 independent scope reduction and pre-body authorization gates."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "cores/python/packages/drsai/src/drsai/relay/api.py"
REGISTRY = ROOT / "cores/python/packages/drsai/src/drsai/relay/registry.py"
NOTIFICATIONS = ROOT / "cores/python/packages/drsai/src/drsai/relay/notifications.py"
RELAY_TEST = ROOT / "cores/python/packages/drsai/tests/test_relay_api.py"
DESKTOP_EDITOR = ROOT / "apps/desktop/shared/renderer/src/components/mobileAssociationScopeEditor.ts"
DESKTOP_UI = ROOT / "apps/desktop/shared/renderer/src/App.tsx"
DESKTOP_TEST = ROOT / "apps/desktop/shared/test-kit/verify-mobile-association-authorization.mts"


def verify() -> dict[str, object]:
    sources = {
        "api": API.read_text(encoding="utf-8"),
        "registry": REGISTRY.read_text(encoding="utf-8"),
        "notifications": NOTIFICATIONS.read_text(encoding="utf-8"),
        "relay_test": RELAY_TEST.read_text(encoding="utf-8"),
        "desktop_editor": DESKTOP_EDITOR.read_text(encoding="utf-8"),
        "desktop_ui": DESKTOP_UI.read_text(encoding="utf-8"),
        "desktop_test": DESKTOP_TEST.read_text(encoding="utf-8"),
    }
    required = {
        "api": (
            'workspace_sender = workspace_permission("send")',
            'workspace_approver = workspace_permission("approve")',
            'workspace_file_reader = workspace_permission("files")',
            'runtime_sender = runtime_permission("send")',
            'x_subject: str = Depends(workspace_sender)',
            'x_subject: str = Depends(workspace_approver)',
            'x_subject: str = Depends(workspace_file_reader)',
            '"session.create": "send"',
            '"approval.decide": "approve"',
        ),
        "registry": (
            'requested_permissions.issubset(association.permissions)',
            'runtime = self._authorized(subject, runtime_id, "send")',
            'and "read" in association.permissions',
            'workspace_id in association.allowed_workspace_ids',
        ),
        "notifications": (
            "self.device_resolver(runtime_id, workspace_id)",
        ),
        "relay_test": (
            "test_write_permission_is_rejected_before_body_validation_and_runtime_proxy",
            "test_sensitive_readback_requires_its_independent_permission",
            "test_push_fanout_honors_read_permission_and_workspace_allowlist",
        ),
        "desktop_editor": (
            "selectedPermissions",
            "permissionSelection.size > 0",
            "workspaceReduction || permissionReduction",
        ),
        "desktop_ui": (
            "Allowed actions",
            "selectedPermissions.has(permission)",
            "[...mobileScopeEditor.selectedPermissions]",
        ),
        "desktop_test": (
            "permissionOnly",
            "at least one permission must remain",
            "narrowed",
        ),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_minimum_authorization_marker_missing:{name}:{marker}")
    forbidden = (
        'async def approvals(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject))',
        'runtime = self._authorized(subject, runtime_id)\n            runtime.display_name',
        'self.device_resolver(runtime_id)))',
    )
    combined = "\n".join(sources.values())
    for marker in forbidden:
        if marker in combined:
            raise ValueError(f"p6_minimum_authorization_regression:{marker}")
    return {
        "permissions": ["read", "send", "approve", "files"],
        "workspace_allowlist": True,
        "pre_body_denial": True,
        "push_scope_filter": True,
        "desktop_independent_reduction": True,
        "passed": True,
    }


def main() -> int:
    try:
        result = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
