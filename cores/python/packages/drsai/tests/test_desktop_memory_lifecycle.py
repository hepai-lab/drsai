from __future__ import annotations

from drsai.backend.runtime.agent_kernel import select_relevant_memories
from drsai.backend.runtime.desktop_agent_kernel_adapter import _desktop_memory_candidates
from drsai.modules.components.memory.curated_memory import CuratedMemoryStore


def test_legacy_memory_file_is_readable_idempotent_and_deleted_entry_cannot_be_recalled(tmp_path) -> None:
    path = tmp_path / "MEMORY.md"
    first = CuratedMemoryStore(memory_path=path)
    assert first.add_entry("I prefer concise answers.")["success"] is True
    assert first.add_entry("I prefer concise answers.")["noop"] is True

    restarted = CuratedMemoryStore(memory_path=path)
    restarted.load_from_disk()
    candidates = _desktop_memory_candidates(type("Agent", (), {"_curated_memory": restarted})())
    assert select_relevant_memories("What answers do I prefer?", candidates)["selected"]
    assert restarted.remove_by_text("concise")["success"] is True

    restarted_again = CuratedMemoryStore(memory_path=path)
    restarted_again.load_from_disk()
    candidates_after_delete = _desktop_memory_candidates(type("Agent", (), {"_curated_memory": restarted_again})())
    assert select_relevant_memories("What answers do I prefer?", candidates_after_delete)["selected"] == []
