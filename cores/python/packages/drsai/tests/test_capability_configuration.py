from dataclasses import dataclass

from drsai.backend.runtime.capabilities import (
    classify_managed_web_search_status,
    classify_web_search_configuration,
    prompt_requires_current_web,
)


_SCREENSHOT_PROMPT = """
请分析这张 OpenDrSai Desktop 截图：

1. 当前运行发生了什么？
2. 截图中显示的错误类型、错误消息、Backend 和模型是什么？
3. 根据截图，最可能应该优先检查什么，身份恢复后应怎么做？
4. 哪些信息因为被截断或脱敏而无法确定？

请区分截图中明确可见的事实、合理诊断和无法确认的信息。
"""


@dataclass(frozen=True)
class Resource:
    kind: str = "public_web"
    adapter: str = "tavily"
    capabilities: tuple[str, ...] = ("web.search", "web.extract")
    enabled: bool = True
    credential: bool = True


def test_current_or_explicit_queries_require_web_but_timeless_prompts_do_not() -> None:
    assert prompt_requires_current_web("HEPiX 2026 是什么？", current_year=2026)
    assert prompt_requires_current_web("请搜索 HEPiX 的官方网站", current_year=2026)
    assert prompt_requires_current_web("What is the latest HEPiX schedule?", current_year=2026)
    assert prompt_requires_current_web("当前油价是多少", current_year=2026)
    assert not prompt_requires_current_web("解释二叉树的中序遍历", current_year=2026)
    assert not prompt_requires_current_web("HEPiX 2024 的历史背景是什么？", current_year=2026)


def test_local_run_and_screenshot_prompts_do_not_require_web() -> None:
    assert not prompt_requires_current_web("当前运行发生了什么？", current_year=2026)
    assert not prompt_requires_current_web(_SCREENSHOT_PROMPT, current_year=2026)
    assert prompt_requires_current_web("请搜索这张截图里公司的官方网站", current_year=2026)


def test_managed_search_permission_denied_pauses_instead_of_failing_the_run() -> None:
    denied = classify_managed_web_search_status("permission_denied")
    assert denied is not None
    assert denied.capability == "web.search"
    assert denied.reason == "credential_unavailable"
    assert classify_managed_web_search_status("available") is None
    assert classify_managed_web_search_status("worker_unavailable") is None


def test_configuration_state_distinguishes_missing_disabled_and_unavailable() -> None:
    missing = classify_web_search_configuration([], credential_available=lambda resource: resource.credential)
    assert missing is not None and missing.reason == "resource_missing"
    disabled = classify_web_search_configuration([Resource(enabled=False)], credential_available=lambda resource: resource.credential)
    assert disabled is not None and disabled.reason == "resource_disabled"
    unavailable = classify_web_search_configuration([Resource(credential=False)], credential_available=lambda resource: resource.credential)
    assert unavailable is not None and unavailable.reason == "credential_unavailable"
    assert classify_web_search_configuration([Resource()], credential_available=lambda resource: resource.credential) is None


def test_public_contract_never_contains_query_or_credential() -> None:
    request = classify_web_search_configuration([], credential_available=lambda _resource: False)
    assert request is not None
    payload = request.public_dict()
    assert payload["query_disclosed"] is False
    assert "query" not in payload
    assert "credential" not in repr(payload).lower()
