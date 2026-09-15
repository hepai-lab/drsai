"""Regression coverage for the reasoning-effort → wire-args mapping in ``DrSaiAgent.call_llm``.

Bug this pins down: with ``param_type="deepseek_reasoning_effort"`` and the
user-facing effort "off"/"none" the code did ``pass``, i.e. *nothing* was sent.
The HEPAI DeepSeek deployment then fell back to its own default, which **thinks**,
so the desktop kept showing "不思考" while the model still streamed reasoning.

Measured on the live gateway (ai-dev.ihep.ac.cn, ``deepseek-ai/deepseek-v4.1-flash``):

============================  ==========================  =======
request                        reasoning_tokens           status
============================  ==========================  =======
no reasoning parameter         39 .. 113 (thinks)          200
``reasoning_effort="none"``    0 (no thinking)             200
``reasoning_effort="high"``    49 .. 78 (thinks)           200
============================  ==========================  =======

``reasoning_effort`` is a typed field of the OpenAI client
(``CompletionCreateParamsBase``), so it also passes AutoGen's
``validate_extra_create_args`` — unlike Anthropic's ``thinking``, which raises
``ValueError: Extra create args are invalid: {'thinking'}`` (the reason the
``deepseek_reasoning_effort`` param_type exists at all).

The function under test only touches ``self._reasoning_effort``, so the test
drives the unbound method with a light namespace instead of building a full agent.
"""

from __future__ import annotations

import types
from typing import Any

import pytest

from drsai.config.model_defaults import ReasoningConfig
from drsai.config.model_registry import find_model_capabilities
from drsai.modules.baseagent.drsaiagent import DrSaiAgent

pytestmark = pytest.mark.asyncio


class _Captured(Exception):
    """Stops ``call_llm`` right after the outgoing args are recorded."""


class _FakeClient:
    """Minimal stand-in for a HepAI/AutoGen chat client."""

    def __init__(self, reasoning: ReasoningConfig) -> None:
        self.model_info = {"reasoning_config": reasoning}
        self.extra_create_args: dict[str, Any] | None = None

    async def create_stream(
        self,
        messages: Any,
        *,
        tools: Any,
        json_output: Any,
        cancellation_token: Any,
        extra_create_args: dict[str, Any],
    ):  # noqa: ANN201 - async generator
        self.extra_create_args = dict(extra_create_args)
        raise _Captured
        yield  # pragma: no cover - unreachable, makes this an async generator


class AnthropicChatCompletionClient(_FakeClient):
    """The class name matters: ``call_llm`` sniffs the MRO for it."""


async def _outgoing_args(
    reasoning: ReasoningConfig,
    effort: str | None,
    client: _FakeClient | None = None,
) -> dict[str, Any]:
    """Run one turn through ``call_llm`` and return the recorded create args."""
    client = client or _FakeClient(reasoning)
    agent = types.SimpleNamespace(_reasoning_effort=effort)
    stream = DrSaiAgent.call_llm(agent, "test-agent", client, [], [], True, None, None)
    with pytest.raises(_Captured):
        await stream.__anext__()
    await stream.aclose()
    assert client.extra_create_args is not None
    return client.extra_create_args


DEEPSEEK = ReasoningConfig(
    supported=True,
    effort_levels=["none", "high", "max"],
    param_type="deepseek_reasoning_effort",
)
GPT = ReasoningConfig(
    supported=True,
    effort_levels=["none", "low", "medium", "high", "xhigh"],
    param_type="reasoning_effort",
)
ANTHROPIC_ADAPTIVE = ReasoningConfig(
    supported=True,
    effort_levels=["low", "medium", "high"],
    param_type="adaptive",
)


async def test_deepseek_off_is_sent_as_explicit_reasoning_effort_none() -> None:
    """The regression: off/none must reach the wire, not be silently dropped."""
    args = await _outgoing_args(DEEPSEEK, "none")
    assert args["reasoning_effort"] == "none"


async def test_deepseek_off_synonym_is_sent_as_reasoning_effort_none() -> None:
    args = await _outgoing_args(DEEPSEEK, "off")
    assert args["reasoning_effort"] == "none"


async def test_deepseek_never_receives_anthropic_thinking_field() -> None:
    """``thinking`` is not a valid OpenAI-client arg — that was the old crash."""
    for effort in ("none", "off", "high", "max"):
        args = await _outgoing_args(DEEPSEEK, effort)
        assert "thinking" not in args


async def test_deepseek_high_and_max_pass_through_unchanged() -> None:
    assert (await _outgoing_args(DEEPSEEK, "high"))["reasoning_effort"] == "high"
    assert (await _outgoing_args(DEEPSEEK, "max"))["reasoning_effort"] == "max"


async def test_openai_reasoning_effort_models_send_none() -> None:
    assert (await _outgoing_args(GPT, "none"))["reasoning_effort"] == "none"


async def test_zhipu_style_models_send_reasoning_effort_none() -> None:
    zhipu = ReasoningConfig(
        supported=True, effort_levels=["low", "medium", "high"], param_type="zhipu_format"
    )
    assert (await _outgoing_args(zhipu, "none"))["reasoning_effort"] == "none"


async def test_adaptive_openai_client_disables_thinking() -> None:
    adaptive = ReasoningConfig(supported=True, effort_levels=[], param_type="adaptive")
    args = await _outgoing_args(adaptive, "none")
    assert args["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in args


async def test_adaptive_anthropic_client_uses_thinking_and_output_config() -> None:
    args = await _outgoing_args(
        ANTHROPIC_ADAPTIVE, "high", client=AnthropicChatCompletionClient(ANTHROPIC_ADAPTIVE)
    )
    assert args["thinking"] == {"type": "adaptive"}
    assert args["output_config"] == {"effort": "high"}


async def test_adaptive_anthropic_xhigh_is_dropped_before_the_wire() -> None:
    """Shipped Claude entries declare ["low", "medium", "high"], so "xhigh"/"max"
    never reach the ``output_config`` branch — the gate drops them first and the
    anthropic client then runs without any thinking parameter at all.
    """
    args = await _outgoing_args(
        ANTHROPIC_ADAPTIVE, "xhigh", client=AnthropicChatCompletionClient(ANTHROPIC_ADAPTIVE)
    )
    assert "output_config" not in args
    assert "thinking" not in args


async def test_adaptive_anthropic_maps_declared_xhigh_to_max() -> None:
    """The xhigh ⇒ effort:"max" mapping itself, for a config that declares xhigh."""
    cfg = ReasoningConfig(
        supported=True,
        effort_levels=["low", "medium", "high", "xhigh"],
        param_type="adaptive",
    )
    args = await _outgoing_args(cfg, "xhigh", client=AnthropicChatCompletionClient(cfg))
    assert args["output_config"] == {"effort": "max"}


async def test_non_reasoning_model_sends_no_reasoning_args() -> None:
    args = await _outgoing_args(ReasoningConfig(supported=False), "none")
    assert "reasoning_effort" not in args
    assert "thinking" not in args


async def test_absent_effort_sends_no_reasoning_args() -> None:
    args = await _outgoing_args(DEEPSEEK, None)
    assert "reasoning_effort" not in args


async def test_stream_options_are_always_requested() -> None:
    args = await _outgoing_args(DEEPSEEK, "none")
    assert args["stream_options"] == {"include_usage": True}


@pytest.mark.parametrize(
    "model",
    [
        "deepseek-v4.1-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "gpt-5.6-luna",
    ],
)
async def test_shipped_openai_reasoning_models_disable_thinking_on_none(model: str) -> None:
    """Registry-backed: the real model defaults must reach the wire as "none".

    These are exactly the entries whose ``param_type`` is not ``adaptive``, i.e.
    the ones that ride the OpenAI-compatible client, and where "no reasoning"
    previously degraded into "provider default (thinking)".

    (``glm-5.3`` is intentionally excluded: its shipped entry declares only
    ``["low", "medium", "high"]``, so the desktop offers no "不思考" option for it
    at all — a separate configuration gap from the wire bug fixed here.)
    """
    capabilities, _known = find_model_capabilities(model)
    reasoning = capabilities.reasoning
    assert reasoning is not None and reasoning.supported, model
    assert "none" in reasoning.effort_levels, model
    args = await _outgoing_args(reasoning, "none")
    assert args.get("reasoning_effort") == "none", model
    assert "thinking" not in args, model


async def test_effort_outside_declared_levels_is_still_omitted() -> None:
    """Documents today's silent fallback: an unsupported level ⇒ no arg ⇒ provider
    default (DeepSeek thinks). ``config/routes`` normalises selections before they
    reach here, so this only bites callers that bypass that (e.g. sub-agents whose
    default is "medium")."""
    args = await _outgoing_args(DEEPSEEK, "medium")
    assert "reasoning_effort" not in args
