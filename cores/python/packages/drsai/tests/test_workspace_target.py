from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "src" / "drsai" / "backend"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


target_module = load("workspace_target_under_test", "workspace/target.py")


class WorkspaceTargetTests(unittest.TestCase):
    def test_local_and_remote_round_trip_one_schema(self) -> None:
        fixtures = [
            {
                "workspaceId": "workspace-local",
                "canonicalPath": r"C:\\work\\project",
                "connection": {"location": "local", "transport": "in-process", "runtimeId": "runtime-local"},
            },
            {
                "workspaceId": "workspace-remote",
                "canonicalPath": "/home/user/project",
                "connection": {
                    "location": "remote",
                    "transport": "ssh",
                    "runtimeId": "runtime-remote",
                    "instanceId": "instance-1",
                    "hostAlias": "linux-a",
                },
            },
        ]
        round_tripped = [
            target_module.WorkspaceTarget.from_dict(json.loads(json.dumps(item))).as_dict()
            for item in fixtures
        ]
        self.assertEqual(round_tripped, fixtures)
        self.assertEqual(set(round_tripped[0]), set(round_tripped[1]))
        self.assertNotIn("hostAlias", round_tripped[0]["connection"])

    def test_local_rejects_ssh_metadata_and_remote_requires_it(self) -> None:
        invalid_connections = [
            {"location": "local", "transport": "ssh", "hostAlias": "should-not-exist"},
            {"location": "local", "transport": "in-process", "hostAlias": "should-not-exist"},
            {"location": "remote", "transport": "ssh"},
            {"location": "remote", "transport": "in-process", "hostAlias": "linux-a"},
        ]
        for connection in invalid_connections:
            with self.subTest(connection=connection), self.assertRaises(target_module.WorkspaceTargetError):
                target_module.WorkspaceTarget.from_dict({
                    "workspaceId": "workspace-1", "canonicalPath": "/project", "connection": connection
                })

    def test_unknown_fields_are_rejected(self) -> None:
        with self.assertRaises(target_module.WorkspaceTargetError) as caught:
            target_module.WorkspaceTarget.from_dict({
                "workspaceId": "workspace-1",
                "canonicalPath": "/project",
                "connection": {"location": "local", "transport": "in-process"},
                "ssh": {"host": "escape"},
            })
        self.assertEqual(caught.exception.code, "workspace_target_invalid")

    def test_agent_backends_share_workspace_schema(self) -> None:
        workspace = target_module.WorkspaceTarget.from_dict({
            "workspaceId": "workspace-local",
            "canonicalPath": r"C:\\work\\project",
            "connection": {"location": "local", "transport": "in-process"},
        })
        open_drsai = target_module.WorkspaceExecutionTarget(
            workspace, target_module.AgentBackendMetadata("opendrsai", "1")
        ).as_dict()
        codex = target_module.WorkspaceExecutionTarget(
            workspace, target_module.AgentBackendMetadata("codex", "0.142.5")
        ).as_dict()
        self.assertEqual(open_drsai["workspace"], codex["workspace"])
        self.assertEqual(set(open_drsai), set(codex))
        self.assertNotEqual(open_drsai["agentBackend"], codex["agentBackend"])


if __name__ == "__main__":
    unittest.main()
