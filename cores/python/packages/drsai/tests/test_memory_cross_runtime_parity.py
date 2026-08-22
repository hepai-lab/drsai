from __future__ import annotations

import hashlib

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.desktop_agent_kernel_adapter import _desktop_memory_candidates
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


CONTENTS = ["I prefer concise answers in Chinese.", "My favorite color is blue."]


def stable_candidates() -> list[dict[str, str]]:
    return [
        {"id": f"memory-{hashlib.sha256(content.encode()).hexdigest()[:24]}", "content": content}
        for content in CONTENTS
    ]


def run(surface: str):
    core = create_agent_kernel(surface=surface)
    output = core.handle(RuntimeEnvelope(
        MessageType.START_RUN, f"request-{surface}", f"run-{surface}", f"session-{surface}", 0, "start",
        {
            "input": "How should you format my answers?",
            "model_id": "fixture-model",
            "tools": [],
            "memory_candidates": stable_candidates(),
            "host_port": {
                "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": surface,
                "capabilities": [{"id": "chat", "version": 1, "required": True}],
            },
        },
    ))
    model = next(item for item in output if item.message_type is MessageType.MODEL_REQUEST)
    started = next(item for item in output if item.message_type is MessageType.RUNTIME_EVENT and item.payload.get("kind") == "run.started")
    return model.payload["messages"], started.payload["memory_selection"]


def test_desktop_and_android_memory_selection_and_final_context_are_identical() -> None:
    desktop_messages, desktop_selection = run("desktop")
    android_messages, android_selection = run("android")

    assert desktop_selection == android_selection
    assert desktop_messages == android_messages
    system = desktop_messages[0]["content"]
    assert system.index("[TOOL_POLICY]") < system.index("[MEMORY_SUMMARY]")
    assert "concise answers" in system
    assert "favorite color" not in system


def test_desktop_host_candidate_ids_match_shared_android_content_id_contract() -> None:
    store = type("Store", (), {"memory_entries": CONTENTS})()
    agent = type("Agent", (), {"_curated_memory": store})()

    assert _desktop_memory_candidates(agent) == stable_candidates()
