"""Model-client level error types shared by model clients and the base agent.

This module is deliberately a leaf: it imports nothing from ``drsai``, so both
``drsai.modules.components.model_client.*`` and ``drsai.modules.baseagent.*``
can import it without creating an import cycle.

``ModelEmptyStreamError`` used to live in
``drsai/modules/baseagent/drsaiagent.py``; it is re-exported from there and
from ``drsai.modules.baseagent`` so every existing import site keeps working.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from autogen_core import FunctionCall


class ModelEmptyStreamError(RuntimeError):
    """Raised when a model client produces zero usable output events.

    Covers two failure shapes that previously terminated the agent loop
    without retry:
      1. Streaming mode: ``create_stream()`` completes without ever yielding
         a final ``CreateResult`` (e.g. upstream gateway silently closes the
         SSE connection, or the stream ends mid-way after yielding only
         text chunks).
      2. Non-streaming mode: ``create()`` returns ``None`` instead of a
         ``CreateResult``.

    This is almost always transient (gateway hiccup, network blip, upstream
    5xx masquerading as an empty 200), so ``is_retryable_llm_error`` treats
    it as retriable and the agent-level retry loop applies exponential
    backoff instead of crashing the whole ``on_messages_stream``.
    """


class ModelMalformedToolCallError(ModelEmptyStreamError):
    """Raised when a tool call comes back without a usable ``name`` or ``id``.

    Distinct from ``model_tool_not_in_snapshot`` raised by
    ``drsai.backend.runtime.agent_kernel.verify_model_tool_calls``:

      * ``model_tool_not_in_snapshot`` = the model asked for a Tool that this
        turn never advertised -> a real contract violation.  It must stay
        fail-closed and non-retryable (retrying cannot fix it).
      * ``ModelMalformedToolCallError`` = the transport lost the tool-call
        header (id/name), so no Tool can be resolved at all.  Re-sampling the
        model can plausibly succeed, so this deliberately subclasses
        ``ModelEmptyStreamError``: ``is_retryable_llm_error`` returns True via
        its isinstance check and the agent-level retry loop applies backoff.

    Do NOT move ``model_tool_not_in_snapshot`` into the retryable set: that
    would make a genuine contract violation (e.g. a tool call emitted during a
    tool-free finalization turn) retry forever.
    """


def assert_well_formed_model_result(result: Any) -> None:
    """Raise ``ModelMalformedToolCallError`` when a tool call lacks name/id.

    Model clients call this right before handing out a ``CreateResult`` so a
    nameless/headless call can never reach the Tool execution layer, where
    ``agent_kernel.verify_model_tool_calls`` would fail the whole turn closed
    with the much less actionable ``model_tool_not_in_snapshot:unknown``.

    This does NOT check whether the name is present in this turn's Tool
    snapshot -- that is the kernel's contract check and stays fail-closed.
    """
    content = getattr(result, "content", None)
    if not isinstance(content, Sequence) or isinstance(content, (str, bytes)):
        return
    for index, call in enumerate(content):
        if isinstance(call, Mapping):
            name = call.get("name")
            call_id = call.get("id")
            arguments = call.get("arguments")
        elif isinstance(call, FunctionCall):
            name = call.name
            call_id = call.id
            arguments = call.arguments
        else:
            continue
        if isinstance(name, str) and name and isinstance(call_id, str) and call_id:
            continue
        raise ModelMalformedToolCallError(
            "model_malformed_tool_call:"
            f"index={index}:name={name or 'unknown'!r}:id={call_id or 'unknown'!r}"
            f":arguments={str(arguments)[:120]!r}"
        )
