"""Curated core skills shipped with OpenDrSai (on-demand install only)."""

from __future__ import annotations

# Product ids under skills/skills (or extra bundled paths — see skills_api).
CORE_PREINSTALL_SKILL_IDS: tuple[str, ...] = ("pptx", "docx", "ragflow-knowledge")

# Friendly labels for UI (presentation / dox / ragflow).
CORE_PREINSTALL_LABELS: dict[str, str] = {
    "pptx": "presentation",
    "docx": "dox",
    "ragflow-knowledge": "ragflow",
}
