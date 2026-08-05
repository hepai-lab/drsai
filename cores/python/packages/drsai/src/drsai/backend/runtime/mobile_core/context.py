"""Deterministic, dependency-free context assembly for mobile runtimes."""

from __future__ import annotations

from typing import Any, Mapping, Sequence


ALLOWED_ROLES = {"system", "user", "assistant", "tool"}


def assemble_mobile_context(
    history: Sequence[Mapping[str, Any]],
    input_text: str,
    *,
    max_messages: int = 20,
    max_chars: int = 32_000,
) -> list[dict[str, Any]]:
    if not 1 <= max_messages <= 100 or max_chars < 1_024:
        raise ValueError("context_budget_invalid")
    if not input_text or len(input_text) > max_chars:
        raise ValueError("context_input_invalid")
    normalized: list[dict[str, Any]] = []
    for raw in history:
        if not isinstance(raw, Mapping):
            raise ValueError("context_message_invalid")
        role = raw.get("role")
        content = raw.get("content", "")
        if role not in ALLOWED_ROLES or not isinstance(content, str):
            raise ValueError("context_message_invalid")
        message: dict[str, Any] = {"role": role, "content": content}
        for key in ("tool_call_id", "tool_calls"):
            if key in raw:
                message[key] = raw[key]
        normalized.append(message)

    current = {"role": "user", "content": input_text}
    remaining_chars = max_chars - len(input_text)
    selected: list[dict[str, Any]] = []
    omitted: list[dict[str, Any]] = []
    for message in reversed(normalized):
        cost = len(message["content"])
        if len(selected) < max_messages - 1 and cost <= remaining_chars:
            selected.append(message)
            remaining_chars -= cost
        else:
            omitted.append(message)
    selected.reverse()
    omitted.reverse()
    if omitted and len(selected) < max_messages - 1 and remaining_chars > 64:
        lines = [f"{item['role']}: {' '.join(item['content'].split())[:240]}" for item in omitted]
        summary = "Earlier context summary:\n" + "\n".join(lines)
        summary = summary[:remaining_chars]
        selected.insert(0, {"role": "system", "content": summary})
    return [*selected, current]
