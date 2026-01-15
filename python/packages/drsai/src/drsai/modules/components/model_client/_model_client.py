from __future__ import annotations

from typing import Literal, TypeAlias

from typing_extensions import Any


class ModelFamily:
    """A model family is a group of models that share similar characteristics from a capabilities perspective. This is different to discrete supported features such as vision, function calling, and JSON output.

    This namespace class holds constants for the model families that AutoGen understands. Other families definitely exist and can be represented by a string, however, AutoGen will treat them as unknown."""

    GPT_5 = "gpt-5"
    GPT_41 = "gpt-41"
    GPT_45 = "gpt-45"
    GPT_4O = "gpt-4o"
    O1 = "o1"
    O3 = "o3"
    O4 = "o4"
    GPT_4 = "gpt-4"
    GPT_35 = "gpt-35"
    R1 = "r1"
    GEMINI_1_5_FLASH = "gemini-1.5-flash"
    GEMINI_1_5_PRO = "gemini-1.5-pro"
    GEMINI_2_0_FLASH = "gemini-2.0-flash"
    GEMINI_2_5_PRO = "gemini-2.5-pro"
    GEMINI_2_5_FLASH = "gemini-2.5-flash"
    CLAUDE_3_HAIKU = "claude-3-haiku"
    CLAUDE_3_SONNET = "claude-3-sonnet"
    CLAUDE_3_OPUS = "claude-3-opus"
    CLAUDE_3_5_HAIKU = "claude-3-5-haiku"
    CLAUDE_3_5_SONNET = "claude-3-5-sonnet"
    CLAUDE_3_7_SONNET = "claude-3-7-sonnet"
    CLAUDE_4_OPUS = "claude-4-opus"
    CLAUDE_4_SONNET = "claude-4-sonnet"
    CLAUDE_4_1_OPUS = "claude-4-1-opus"
    CLAUDE_4_5_OPUS = "claude-4-5-opus"
    CLAUDE_4_5_HAIKU = "claude-4-5-haiku"
    CLAUDE_4_5_SONNET = "claude-4-5-sonnet"
    LLAMA_3_3_8B = "llama-3.3-8b"
    LLAMA_3_3_70B = "llama-3.3-70b"
    LLAMA_4_SCOUT = "llama-4-scout"
    LLAMA_4_MAVERICK = "llama-4-maverick"
    CODESRAL = "codestral"
    OPEN_CODESRAL_MAMBA = "open-codestral-mamba"
    MISTRAL = "mistral"
    MINISTRAL = "ministral"
    PIXTRAL = "pixtral"
    UNKNOWN = "unknown"

    ANY: TypeAlias = Literal[
        # openai_models
        "gpt-5",
        "gpt-41",
        "gpt-45",
        "gpt-4o",
        "o1",
        "o3",
        "o4",
        "gpt-4",
        "gpt-35",
        "r1",
        # google_models
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        # anthropic_models
        "claude-3-haiku",
        "claude-3-sonnet",
        "claude-3-opus",
        "claude-3-5-haiku",
        "claude-3-5-sonnet",
        "claude-3-7-sonnet",
        "claude-4-opus",
        "claude-4-1-opus",
        "claude-4-sonnet",
        "claude-4-5-sonnet"
        "claude-4-5-opus",
        "claude-4-5-haiku",
        # llama_models
        "llama-3.3-8b",
        "llama-3.3-70b",
        "llama-4-scout",
        "llama-4-maverick",
        # mistral_models
        "codestral",
        "open-codestral-mamba",
        "mistral",
        "ministral",
        "pixtral",
        # unknown
        "unknown",
    ]

    def __new__(cls, *args: Any, **kwargs: Any) -> ModelFamily:
        raise TypeError(f"{cls.__name__} is a namespace class and cannot be instantiated.")

    @staticmethod
    def is_claude(family: str) -> bool:
        return family in (
            ModelFamily.CLAUDE_3_HAIKU,
            ModelFamily.CLAUDE_3_SONNET,
            ModelFamily.CLAUDE_3_OPUS,
            ModelFamily.CLAUDE_3_5_HAIKU,
            ModelFamily.CLAUDE_3_5_SONNET,
            ModelFamily.CLAUDE_3_7_SONNET,
            ModelFamily.CLAUDE_4_OPUS,
            ModelFamily.CLAUDE_4_SONNET,
            ModelFamily.CLAUDE_4_1_OPUS,
            ModelFamily.CLAUDE_4_5_HAIKU,
            ModelFamily.CLAUDE_4_5_SONNET,
            ModelFamily.CLAUDE_4_5_OPUS,
        )

    @staticmethod
    def is_gemini(family: str) -> bool:
        return family in (
            ModelFamily.GEMINI_1_5_FLASH,
            ModelFamily.GEMINI_1_5_PRO,
            ModelFamily.GEMINI_2_0_FLASH,
            ModelFamily.GEMINI_2_5_PRO,
            ModelFamily.GEMINI_2_5_FLASH,
        )

    @staticmethod
    def is_openai(family: str) -> bool:
        return family in (
            ModelFamily.GPT_5,
            ModelFamily.GPT_45,
            ModelFamily.GPT_41,
            ModelFamily.GPT_4O,
            ModelFamily.O1,
            ModelFamily.O3,
            ModelFamily.O4,
            ModelFamily.GPT_4,
            ModelFamily.GPT_35,
        )

    @staticmethod
    def is_llama(family: str) -> bool:
        return family in (
            ModelFamily.LLAMA_3_3_8B,
            ModelFamily.LLAMA_3_3_70B,
            ModelFamily.LLAMA_4_SCOUT,
            ModelFamily.LLAMA_4_MAVERICK,
        )

    @staticmethod
    def is_mistral(family: str) -> bool:
        return family in (
            ModelFamily.CODESRAL,
            ModelFamily.OPEN_CODESRAL_MAMBA,
            ModelFamily.MISTRAL,
            ModelFamily.MINISTRAL,
            ModelFamily.PIXTRAL,
        )