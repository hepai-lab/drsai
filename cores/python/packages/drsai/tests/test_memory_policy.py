from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel import (
    build_memory_policy,
    normalize_memory_policy,
    validate_memory_tool_call,
)


def test_memory_mutation_requires_explicit_durable_user_intent() -> None:
    direct = build_memory_policy("Tell me about concise writing")
    with pytest.raises(ValueError, match="memory_explicit_intent_required"):
        validate_memory_tool_call(direct, "save_memory", {"content": "prefers concise answers"})

    requested = build_memory_policy("Remember that I prefer concise answers")
    result = validate_memory_tool_call(requested, "save_memory", {"content": "prefers concise answers"})
    assert result is not None and result["operation"] == "add" and result["authorized"] is True
    assert "concise" not in str(result)


def test_memory_policy_supports_chinese_save_and_separate_delete_intent() -> None:
    save = build_memory_policy("请记住：我喜欢简洁回答")
    assert save["allowed_mutations"] == ["add", "replace"]
    delete = build_memory_policy("请删除我的回答偏好记忆")
    assert delete["allowed_mutations"] == ["remove"]
    validate_memory_tool_call(delete, "memory", {"action": "remove", "old_text": "回答偏好"})
    with pytest.raises(ValueError, match="memory_explicit_intent_required"):
        validate_memory_tool_call(save, "memory", {"action": "remove", "old_text": "回答偏好"})


@pytest.mark.parametrize(
    "content",
    [
        "api_key=super-secret",
        "Bearer abc.def.ghi",
        "-----BEGIN PRIVATE KEY----- secret",
        "病历：诊断结果为测试",
        "password: hunter2",
        "medical diagnosis: test",
    ],
)
def test_sensitive_content_is_never_persisted(content: str) -> None:
    policy = build_memory_policy("Remember this as a memory")
    with pytest.raises(ValueError, match="memory_sensitive_content_denied"):
        validate_memory_tool_call(policy, "save_memory", {"content": content})


def test_disabled_and_tampered_memory_policies_fail_closed() -> None:
    disabled = build_memory_policy("Remember my preference", enabled=False)
    with pytest.raises(ValueError, match="memory_disabled"):
        validate_memory_tool_call(disabled, "save_memory", {"content": "prefers concise answers"})
    with pytest.raises(ValueError, match="memory_policy_digest_mismatch"):
        normalize_memory_policy({**build_memory_policy("Remember my preference"), "enabled": False})


def test_memory_search_is_read_only_and_needs_no_mutation_intent() -> None:
    result = validate_memory_tool_call(build_memory_policy("What are my preferences?"), "search_memory", {"query": "preference"})
    assert result is not None and result["operation"] == "read"
