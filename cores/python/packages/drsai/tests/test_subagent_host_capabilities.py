"""Local subagents inherit the real Host contract without sharing live state.

Run directly with Python or through pytest. No network/model calls are made.
"""

import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from drsai.backend.runtime.agent_kernel import (
    build_execution_tool_registry,
    normalize_tool_loop_policy,
)
from drsai.modules.agents.skills_agent import drsai_assistant as module


class SubagentHostCapabilitiesTest(unittest.IsolatedAsyncioTestCase):
    async def test_local_children_inherit_host_contract(self):
        names = [
            "read", "glob", "grep", "write", "edit", "exec",
            "image_edit", "image_generation", "web_search", "web_fetch",
            "deliver_artifact", "Delegate", "UpdateUserConfig", "ScheduledTaskManager",
        ]
        parent = object.__new__(module.DrSaiAssistant)
        parent._user_sub_agents = deepcopy(module.BUILTIN_SUBAGENTS)
        parent._tools = [SimpleNamespace(name=name) for name in names]
        parent._workbench = SimpleNamespace(_tools=parent._tools)
        parent._work_dir = Path.cwd()
        parent._thread_id = "parent-thread"
        parent._user_id = "test-user"
        parent._model_client = object()
        parent._db_manager = object()
        parent._delegate_depth = 0
        parent._kernel_host_port = {
            "surface": "desktop",
            "capabilities": [
                "image_edit", "image_generation", "web_search", "web_fetch",
                "network.public_https",
            ],
        }
        parent._tool_loop_policy = normalize_tool_loop_policy()

        async def approve(record, arguments):
            return False

        async def artifact(record, content):
            return {"id": "parent-artifact"}

        parent._tool_approval_handler = approve
        parent._tool_output_artifact_handler = artifact

        class Child:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self._active_model_tool_snapshot = None
                self._active_execution_tool_registry = None

            async def lazy_init(self):
                # Contract must be present before lazy initialization/inference.
                tools = [
                    {"name": tool.name, "description": "test", "parameters": {
                        "type": "object", "properties": {},
                    }} for tool in self.kwargs["tools"]
                ]
                metadata = {
                    tool["name"]: module._desktop_execution_metadata(
                        tool["name"], f"workbench:{tool['name']}",
                        desktop_mode=self._tool_approval_handler is not None,
                    ) for tool in tools
                }
                self.registry = build_execution_tool_registry(
                    "desktop", tools, metadata,
                    getattr(self, "_kernel_host_port", {}).get("capabilities", []),
                )

        create = module.DrSaiAssistant._create_local_subagent
        with patch.object(module, "DrSaiAssistant", Child):
            child, sibling = await asyncio.gather(
                create(parent, "general"), create(parent, "general"),
            )
            explore = await create(parent, "explore")

        inherited = {tool.name for tool in child.kwargs["tools"]}
        self.assertEqual(inherited, set(names) - {
            "Delegate", "UpdateUserConfig", "ScheduledTaskManager",
        })
        self.assertEqual({t.name for t in explore.kwargs["tools"]}, {"read", "glob", "grep"})
        self.assertIs(child._tool_approval_handler, approve)
        self.assertFalse(await child._tool_approval_handler({}, {}))
        self.assertIs(child._tool_output_artifact_handler, artifact)
        self.assertEqual(await child._tool_output_artifact_handler({}, b"x"), {"id": "parent-artifact"})
        self.assertEqual(child._kernel_host_port, parent._kernel_host_port)
        self.assertIsNot(child._kernel_host_port, parent._kernel_host_port)
        child._kernel_host_port["capabilities"].clear()
        self.assertTrue(parent._kernel_host_port["capabilities"])
        self.assertTrue(sibling._kernel_host_port["capabilities"])
        self.assertIsNot(child._tool_loop_policy, parent._tool_loop_policy)
        self.assertNotEqual(child.kwargs["thread_id"], sibling.kwargs["thread_id"])
        self.assertIs(child.kwargs["model_client"], parent._model_client)
        self.assertFalse(child.kwargs["owns_model_client"])
        self.assertIsNone(child._active_model_tool_snapshot)
        self.assertIsNone(child._active_execution_tool_registry)

        # A legacy parent cannot conjure capabilities just by supplying tools.
        del parent._kernel_host_port
        parent._tool_approval_handler = None
        parent._tool_output_artifact_handler = None
        with patch.object(module, "DrSaiAssistant", Child):
            await create(parent, "explore")
            with self.assertRaisesRegex(ValueError, "execution_tool_capability_unavailable"):
                await create(parent, "general")


if __name__ == "__main__":
    unittest.main()
