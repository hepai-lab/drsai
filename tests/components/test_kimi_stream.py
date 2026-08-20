"""
测试从 ~/.drsai/configs/llm_mode_config.yaml 抽取 `moonshot/kimi-k3` 条目，
并用 HepAIChatCompletionClient.create_stream 做一次流式调用。

运行:
    python tests/components/test_kimi_stream.py
或:
    pytest -s tests/components/test_kimi_stream.py

需要环境变量:
    HEPAI_API_KEY  (base_url 为 https://aiapi.ihep.ac.cn/apiv2，走 HEPAI 网关)
"""
import asyncio
import os
from pathlib import Path

import pytest

from autogen_core.models import UserMessage, SystemMessage

from drsai.backend.run_drsai_agent_factory import load_llm_mode_config
from drsai.modules.components.model_client import HepAIChatCompletionClient


# ── 抽取 YAML 条目 ────────────────────────────────────────────────────────────

LLM_CONFIG_PATH = str(Path.home() / ".drsai" / "configs" / "llm_mode_config.yaml")
KIMI_ALIAS = "moonshot/kimi-k3"


def _load_kimi_entry():
    """从 llm_mode_config.yaml 读取 moonshot/kimi-k3 的 ModelEntry。"""
    cfg = load_llm_mode_config(LLM_CONFIG_PATH)
    entry = cfg.get(KIMI_ALIAS)
    assert entry is not None, (
        f"在 {LLM_CONFIG_PATH} 中找不到 alias={KIMI_ALIAS!r}；"
        f"现有 alias: {sorted(cfg.keys())}"
    )
    return entry


def test_extract_kimi_entry():
    """仅验证条目能被正确抽取（不发网络请求）。"""
    entry = _load_kimi_entry()
    print("\n=== 抽取到的 moonshot/kimi-k3 条目 ===")
    print(f"  model        : {entry.model}")
    print(f"  client_type  : {entry.client_type}")
    print(f"  token_limit  : {entry.token_limit}")
    print(f"  max_tokens   : {entry.max_tokens}")
    print(f"  vision       : {entry.vision}")
    print(f"  base_url     : {entry.base_url}")
    print(f"  requires_api_key: {entry.requires_api_key}")
    print(f"  api_key_env  : {entry.api_key_env!r}")

    assert entry.model == "moonshot/kimi-k3"
    assert entry.client_type == "openai"
    assert entry.base_url, "base_url 未配置"


# ── 流式调用 ──────────────────────────────────────────────────────────────────

def _build_client():
    """根据 YAML 条目构造 HepAIChatCompletionClient。"""
    entry = _load_kimi_entry()

    # api_key 解析顺序: entry.api_key > entry.api_key_env > HEPAI_API_KEY 环境变量
    api_key = entry.api_key
    if not api_key and entry.api_key_env:
        api_key = os.environ.get(entry.api_key_env, "")
    if not api_key:
        api_key = os.environ.get("HEPAI_API_KEY", "")
    assert api_key, (
        "未找到 api_key：entry.api_key 为空、api_key_env 未设置，"
        "且环境变量 HEPAI_API_KEY 也不存在。"
    )

    max_tokens = entry.max_tokens if entry.max_tokens > 0 else int(entry.token_limit * 0.25)

    return HepAIChatCompletionClient(
        model=entry.model,
        api_key=api_key,
        base_url=entry.base_url,
        model_info={
            "vision": entry.vision,
            "function_calling": True,
            "json_output": True,
            "structured_output": False,
            "family": 1,  # ModelFamily.GPT_41
            "multiple_system_messages": True,
            "token_model": "gpt-4o-2024-11-20",
        },
        max_tokens=max_tokens,
        timeout=90,
        # kimi 走 OpenAI Chat Completions 兼容路由，不用 Responses API
        use_responses_api=False,
        allow_deferred_oidc=True,
    )


def test_kimi_create_stream():
    """对 moonshot/kimi-k3 做一次真实流式调用，打印增量并校验最终结果。"""
    client = _build_client()
    print(f"\n=== 开始流式调用 {KIMI_ALIAS} ===")

    messages = [
        SystemMessage(content="你是一个简洁的中文助手，用一句话回答。"),
        UserMessage(content="用一句话介绍你自己。", source="user"),
    ]

    async def _run():
        collected = []
        final_result = None
        try:
            async for chunk in client.create_stream(
                messages,
                extra_create_args={"stream_options": {"include_usage": True}},
            ):
                if isinstance(chunk, str):
                    collected.append(chunk)
                    print(chunk, end="", flush=True)
                else:
                    final_result = chunk
                    print("\n\n=== 流式结束 ===")
                    print(f"  finish_reason: {getattr(chunk, 'finish_reason', '?')}")
                    usage = getattr(chunk, 'usage', None)
                    if usage is not None:
                        print(f"  usage: prompt_tokens={usage.prompt_tokens}, "
                              f"completion_tokens={usage.completion_tokens}")
        finally:
            await client.close()
        return collected, final_result

    collected, final_result = asyncio.run(_run())

    full_text = "".join(collected)
    print(f"\n=== 完整输出 ===\n{full_text}")

    assert full_text, "流式输出为空"
    assert final_result is not None, "未收到 CreateResult"


if __name__ == "__main__":
    # 直接 python 运行：跑流式调用并打印
    async def _main():
        client = _build_client()
        print(f"=== 开始流式调用 {KIMI_ALIAS} ===")
        messages = [
            SystemMessage(content="你是一个简洁的中文助手，用一句话回答。"),
            UserMessage(content="用一句话介绍你自己。", source="user"),
        ]
        collected = []
        try:
            async for chunk in client.create_stream(
                messages,
                extra_create_args={"stream_options": {"include_usage": True}},
            ):
                if isinstance(chunk, str):
                    collected.append(chunk)
                    print(chunk, end="", flush=True)
                else:
                    print("\n\n=== 流式结束 ===")
                    print(f"  finish_reason: {getattr(chunk, 'finish_reason', '?')}")
                    usage = getattr(chunk, 'usage', None)
                    if usage is not None:
                        print(f"  usage: prompt={usage.prompt_tokens}, "
                              f"completion={usage.completion_tokens}")
        finally:
            await client.close()
        print(f"\n=== 完整输出 ===\n{''.join(collected)}")

    asyncio.run(_main())
