"""Parallel-subagent identity isolation.

Two same-type subagents running concurrently must not share tool-Item
identity (Runtime journal keys tool Items by ``tool:{run_id}:{tool_id}``),
pending-call bookkeeping, or display cards.  Regression test for
``ValueError: OAEP Item status cannot transition from completed to running``.
"""

from __future__ import annotations

import time

from autogen_core import FunctionCall
from autogen_core.models import FunctionExecutionResult

from drsai.backend.events.agent_event_translator import (
    TurnState,
    _namespace_tool_id,
    _recover_pending_tool_id,
    translate,
)


def _request(source: str, call_id: str, name: str = "read"):
    from autogen_agentchat.messages import ToolCallRequestEvent

    return ToolCallRequestEvent(content=[FunctionCall(id=call_id, arguments="{}", name=name)], source=source)


def _result(source: str, call_id: str, name: str = "read"):
    from autogen_agentchat.messages import ToolCallExecutionEvent

    return ToolCallExecutionEvent(
        content=[FunctionExecutionResult(content="ok", name=name, call_id=call_id, is_error=False)],
        source=source,
    )


def test_subagent_tool_ids_are_namespaced():
    state = TurnState()
    out = translate(_request("sub:general/call_A", "call_0"), state)
    assert out and out[0][0] == "tool.start"
    assert out[0][1]["tool_id"] == "sub:general/call_A:call_0"


def test_parallel_same_id_no_collision():
    """Both siblings emit provider id ``call_0``; journal ids must differ."""
    state = TurnState()
    a_start = translate(_request("sub:general/call_A", "call_0"), state)[0][1]
    b_start = translate(_request("sub:general/call_B", "call_0"), state)[0][1]
    assert a_start["tool_id"] != b_start["tool_id"]

    a_done = translate(_result("sub:general/call_A", "call_0"), state)[0][1]
    assert a_done["tool_id"] == a_start["tool_id"]
    # B's start after A's complete targets its own (still running) Item.
    b_done = translate(_result("sub:general/call_B", "call_0"), state)[0][1]
    assert b_done["tool_id"] == b_start["tool_id"]


def test_pending_recovery_scoped_to_source():
    state = TurnState()
    state.pending_tool_calls["sub:general/call_A:tool-1"] = ("read", {}, time.time())
    # Sibling's result without call_id must not steal A's pending call.
    assert _recover_pending_tool_id(state, "read", "sub:general/call_B") == ""
    assert _recover_pending_tool_id(state, "read", "sub:general/call_A") == "sub:general/call_A:tool-1"


def test_main_agent_ids_untouched():
    state = TurnState()
    out = translate(_request("assistant", "call_0"), state)[0][1]
    assert out["tool_id"] == "call_0"
    assert "subagent_id" not in out


def test_synthesized_ids_have_entropy():
    state = TurnState()
    out1 = translate(_request("sub:general/call_A", ""), state)[0][1]
    out2 = translate(_request("sub:general/call_A", ""), state)[0][1]
    assert out1["tool_id"] != out2["tool_id"]


def test_display_name_strips_instance_suffix():
    state = TurnState()
    out = translate(_request("sub:general/call_A", "call_0"), state)[0][1]
    assert out["name"] == "[general] read"


def test_namespace_idempotent():
    assert _namespace_tool_id("sub:a/1", "sub:a/1:x") == "sub:a/1:x"
    assert _namespace_tool_id("", "x") == "x"
