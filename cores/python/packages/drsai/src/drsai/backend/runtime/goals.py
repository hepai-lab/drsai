"""Immutable Goal protocol used before an Agent Run may cause side effects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
import json
import re


GOAL_FIELDS = ("objective", "materials", "outputs", "constraints")
DEFAULTS = {
    "language": "user_input",
    "length": "appropriate",
    "citation_style": "preserve_sources",
    "format": "best_fit",
}
DEFAULT_SOURCES = {
    "language": "user_request_language",
    "length": "opendrsai_task_policy",
    "citation_style": "available_material_provenance",
    "format": "requested_output_inference",
}

_VAGUE_REQUESTS = {
    "help", "help me", "do it", "do this", "continue", "go ahead", "take care of it",
    "帮我", "帮我弄一下", "处理一下", "继续", "开始吧", "做一下", "看看", "搞定它",
}
_HIGH_IMPACT = re.compile(r"(?i)\b(delete|remove|publish|send|email|deploy|pay|purchase|merge)\b|删除|移除|发布|发送|邮件|部署|付款|购买|合并")
_OBJECT_HINT = re.compile(r"(?i)\b(file|folder|report|document|code|tests?|email|message|release|branch|data|table|chart|presentation|workspace)\b|文件|文件夹|报告|文档|代码|测试|邮件|消息|版本|分支|数据|表格|图表|演示|工作区")


def propose_goal_from_request(
    request: str,
    *,
    materials: list[str] | None = None,
    clarifications: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Produce a confirmation-ready Goal or bounded blocking questions.

    This pre-execution classifier is intentionally deterministic and pure: it
    may shape intent but cannot call a model, Tool, filesystem, or dispatcher.
    """
    prompt = " ".join(str(request or "").split()).strip()
    material_list = [str(item).strip() for item in (materials or []) if str(item).strip()]
    answers = {
        str(key): str(value).strip()
        for key, value in (clarifications or {}).items()
        if str(value).strip()
    }
    questions: list[dict[str, str]] = []
    normalized = prompt.casefold().rstrip(".!?。！？")
    objective_answer = answers.get("objective", "")
    if (not prompt or normalized in _VAGUE_REQUESTS or len(normalized) < 4) and not objective_answer:
        questions.append({
            "field": "objective", "prompt": "What outcome should this task achieve?",
            "reason": "The request does not yet identify a concrete outcome.",
        })
    high_impact = bool(_HIGH_IMPACT.search(prompt))
    if high_impact and not (_OBJECT_HINT.search(prompt) or material_list or answers.get("scope")):
        questions.append({
            "field": "scope", "prompt": "Which exact item or scope should this action affect?",
            "reason": "A high-impact action needs an explicit target before it can be planned safely.",
        })
    if high_impact and not answers.get("constraints") and not re.search(r"(?i)\b(after|only|except|without|not|if|when|to|from|in)\b|仅|只|不要|除外|如果|当|到|从|在", prompt):
        questions.append({
            "field": "constraints", "prompt": "What limits or confirmation conditions should apply?",
            "reason": "The request can affect external or durable state and its boundary is not explicit.",
        })
    if questions:
        return {"status": "clarification_required", "questions": questions[:3], "side_effects_allowed": False}
    return {
        "status": "ready",
        "goal": normalize_goal({
            "objective": objective_answer or prompt,
            "materials": material_list,
            "outputs": [_infer_output(objective_answer or prompt)],
            "constraints": [
                "Preserve user files unless a reviewed action explicitly changes them",
                *([f"Scope: {answers['scope']}"] if answers.get("scope") else []),
                *([f"Conditions: {answers['constraints']}"] if answers.get("constraints") else []),
            ],
            "defaults": DEFAULTS,
            "default_sources": DEFAULT_SOURCES,
        }),
        "questions": [],
        "side_effects_allowed": False,
    }


def _infer_output(prompt: str) -> str:
    lowered = prompt.casefold()
    if re.search(r"summari[sz]e|analy[sz]e|review|compare|explain|总结|分析|审查|比较|解释", lowered):
        return "A structured answer or report covering the requested findings"
    if re.search(r"fix|update|change|refactor|修改|修复|更新|重构", lowered):
        return "Reviewed workspace changes plus a concise verification summary"
    if re.search(r"create|write|generate|build|draft|制作|创建|编写|生成|起草", lowered):
        return "The requested deliverable plus a concise completion summary"
    if "?" in prompt or "？" in prompt:
        return "A direct answer supported by the available materials"
    return "A completed result that directly satisfies the requested task"


def normalize_goal(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("Goal must be an object")
    objective = _text(value.get("objective"), "objective", required=True, limit=4_000)
    materials = _text_list(value.get("materials", []), "materials", limit=200)
    outputs = _text_list(value.get("outputs"), "outputs", limit=50, required=True)
    constraints = _text_list(value.get("constraints", []), "constraints", limit=100)
    defaults = value.get("defaults", {})
    if defaults is None:
        defaults = {}
    if not isinstance(defaults, Mapping):
        raise ValueError("Goal defaults must be an object")
    normalized_defaults = {
        key: _text(defaults.get(key, fallback), f"defaults.{key}", required=True, limit=200)
        for key, fallback in DEFAULTS.items()
    }
    sources = value.get("default_sources", {})
    if sources is None:
        sources = {}
    if not isinstance(sources, Mapping):
        raise ValueError("Goal default_sources must be an object")
    normalized_sources = {
        key: _text(sources.get(key, DEFAULT_SOURCES[key]), f"default_sources.{key}", required=True, limit=200)
        for key in DEFAULTS
    }
    return {
        "objective": objective,
        "materials": materials,
        "outputs": outputs,
        "constraints": constraints,
        "defaults": normalized_defaults,
        "default_sources": normalized_sources,
    }


def clarification_questions(value: Mapping[str, Any]) -> list[dict[str, str]]:
    """Ask only blockers, in stable priority order, with a hard three-question cap."""
    questions: list[dict[str, str]] = []
    objective = value.get("objective") if isinstance(value, Mapping) else None
    outputs = value.get("outputs") if isinstance(value, Mapping) else None
    if not isinstance(objective, str) or not objective.strip():
        questions.append({
            "field": "objective",
            "prompt": "What outcome should this task achieve?",
            "reason": "The Agent cannot choose safe actions without a concrete outcome.",
        })
    if not isinstance(outputs, list) or not any(isinstance(item, str) and item.strip() for item in outputs):
        questions.append({
            "field": "outputs",
            "prompt": "What should the finished result contain or create?",
            "reason": "A completion boundary is required before execution.",
        })
    return questions[:3]


def render_goal_execution_prompt(goal: Mapping[str, Any], user_prompt: str) -> str:
    """Bind execution to the confirmed Goal without mutating the stored user input."""
    normalized = normalize_goal(goal)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, indent=2)
    return (
        "Execute only the confirmed task Goal below. Treat its objective, materials, outputs, "
        "constraints, and defaults as authoritative. If the request text conflicts with the Goal, "
        "follow the Goal and report the conflict instead of silently changing scope.\n\n"
        f"<confirmed_goal>\n{payload}\n</confirmed_goal>\n\n"
        f"<original_user_request>\n{user_prompt.strip()}\n</original_user_request>"
    )


def _text(value: Any, field: str, *, required: bool, limit: int) -> str:
    if not isinstance(value, str):
        if required:
            raise ValueError(f"Goal {field} is required")
        return ""
    result = value.strip()
    if required and not result:
        raise ValueError(f"Goal {field} is required")
    if len(result) > limit:
        raise ValueError(f"Goal {field} is too long")
    return result


def _text_list(value: Any, field: str, *, limit: int, required: bool = False) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"Goal {field} must be a list")
    if len(value) > limit:
        raise ValueError(f"Goal {field} has too many entries")
    result = [_text(item, field, required=True, limit=2_000) for item in value]
    if required and not result:
        raise ValueError(f"Goal {field} is required")
    return result
