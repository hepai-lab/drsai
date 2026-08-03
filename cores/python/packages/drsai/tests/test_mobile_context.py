import pytest

from drsai.backend.runtime.mobile_core import assemble_mobile_context


def test_recent_history_is_preserved_and_current_input_is_last() -> None:
    context = assemble_mobile_context(
        [{"role": "user", "content": "old question"}, {"role": "assistant", "content": "old answer"}],
        "new question",
    )
    assert [item["role"] for item in context] == ["user", "assistant", "user"]
    assert context[-1]["content"] == "new question"


def test_budget_compacts_omitted_history_into_bounded_summary() -> None:
    history = [{"role": "user", "content": f"message-{index}-" + "x" * 500} for index in range(30)]
    context = assemble_mobile_context(history, "current", max_messages=6, max_chars=2_000)

    assert len(context) <= 6
    assert sum(len(item["content"]) for item in context) <= 2_000
    assert context[0]["role"] == "system"
    assert context[0]["content"].startswith("Earlier context summary:")


def test_context_rejects_invalid_roles_and_oversized_current_input() -> None:
    with pytest.raises(ValueError, match="context_message_invalid"):
        assemble_mobile_context([{"role": "developer", "content": "secret"}], "hello")
    with pytest.raises(ValueError, match="context_input_invalid"):
        assemble_mobile_context([], "x" * 32_001)
