from dataclasses import dataclass

from drsai.backend.runtime.capabilities import (
    classify_web_search_configuration,
    prompt_requires_current_web,
)


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
    assert not prompt_requires_current_web("解释二叉树的中序遍历", current_year=2026)
    assert not prompt_requires_current_web("HEPiX 2024 的历史背景是什么？", current_year=2026)


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
