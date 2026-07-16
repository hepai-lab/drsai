from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "src" / "drsai" / "backend" / "workspace_resources.py"
FIXTURES = ROOT.parents[4] / "protocol" / "orca-inspired" / "domain.fixtures.json"

spec = importlib.util.spec_from_file_location("workspace_resources_under_test", MODULE)
assert spec and spec.loader
resources = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = resources
spec.loader.exec_module(resources)


class WorkspaceResourcesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))

    def test_cross_language_fixtures_round_trip(self) -> None:
        self.assertEqual(
            [resources.WorktreeResource.from_dict(item).as_dict() for item in self.fixtures["worktrees"]],
            self.fixtures["worktrees"],
        )
        self.assertEqual(
            [resources.TerminalResource.from_dict(item).as_dict() for item in self.fixtures["terminals"]],
            self.fixtures["terminals"],
        )

    def test_worktree_and_terminal_state_machines(self) -> None:
        self.assertTrue(resources.can_transition_worktree("creating", "active"))
        self.assertTrue(resources.can_transition_worktree("merge_pending", "review"))
        self.assertFalse(resources.can_transition_worktree("removed", "active"))
        self.assertTrue(resources.can_transition_terminal("running", "detached"))
        self.assertFalse(resources.can_transition_terminal("exited", "running"))

    def test_transport_loss_never_implies_exit(self) -> None:
        for status in ("running", "detached", "reconnecting"):
            self.assertEqual(resources.terminal_status_after_transport_loss(status), "reconnecting")
        self.assertEqual(resources.terminal_status_after_transport_loss("exited"), "exited")

    def test_resource_ids_and_shapes_fail_closed(self) -> None:
        for kind, valid in {
            "worktree": "worktree-1", "terminal": "terminal-1", "terminal_lease": "terminal-lease-1",
            "host_profile": "host-profile-1", "port_forward": "port-forward-1",
        }.items():
            self.assertTrue(resources.is_resource_id(kind, valid))
            self.assertFalse(resources.is_resource_id(kind, "wrong-1"))
        invalid = dict(self.fixtures["worktrees"][0], unexpected=True)
        with self.assertRaises(resources.WorkspaceResourceError):
            resources.WorktreeResource.from_dict(invalid)

    def test_worktree_workspace_is_distinct_from_source(self) -> None:
        invalid = dict(self.fixtures["worktrees"][0])
        invalid["workspaceId"] = invalid["sourceWorkspaceId"]
        with self.assertRaises(resources.WorkspaceResourceError) as caught:
            resources.WorktreeResource.from_dict(invalid)
        self.assertEqual(caught.exception.code, "worktree_workspace_identity_invalid")


if __name__ == "__main__":
    unittest.main()
