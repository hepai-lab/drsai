"""
Content-plane split for agent text.

Agents (esp. planners) often mix three roles into one string:

  reply   — user-visible answer
  thought — monologue / reasoning
  control — waiting_for_user_response (protocol only)

Keep this aligned with apps/webui/frontend/.../chatMessagePipeline.ts
``splitAgentVisibleContent``.
"""
from __future__ import annotations

import re
from typing import NamedTuple


class SplitAgentContent(NamedTuple):
    reply: str
    thought: str
    awaits_user: bool


_CONTROL_TOKEN_RE = re.compile(r"\bwaiting_for_user_response\b", re.IGNORECASE)
_THINK_BLOCK_RE = re.compile(
    r"<think>([\s\S]*?)</(?:think|redacted_thinking)>", re.IGNORECASE
)
_MONOLOGUE_START_RE = re.compile(
    r"(?:^|\n\s*)((?:we need to|i need to|i(?:'m| am) the\b|as (?:the )?planner|"
    r"the user (?:is asking|asked|didn't)|i(?:'ll| will) (?:answer|craft|emit|describe)|"
    r"i should (?:answer|not)|this is (?:a |not a )?(?:general|free-style|knowledge)|"
    r"output as per|i must (?:stay|not)|i'll end with|i'll emit|state needed info)\b[\s\S]*)$",
    re.IGNORECASE,
)
_MONOLOGUE_WHOLE_RE = re.compile(
    r"(?:"
    r"i(?:'m| am) the \w*agent\b|"
    r"we need to answer (?:the )?question\b|"
    r"i can answer directly\b|"
    r"no (?:further|need to) (?:action|dispatch)|"
    r"dispatch(?:ing)? to (?:any |an )?agent\b|"
    r"the user's request is complete\b|"
    r"i should not emit\b|"
    r"not a task that requires\b|"
    r"keep(?:ing)? it within \d+ words\b|"
    r"this is a (?:general|free-style|knowledge)|"
    r"i'll (?:craft|emit|answer|end with)\b"
    r")",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def _near_duplicate(a: str, b: str) -> bool:
    na, nb = _normalize(a), _normalize(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    head = 160
    if len(na) >= head and len(nb) >= head and na[:head] == nb[:head]:
        return True
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    return len(shorter) >= 80 and shorter in longer


def _looks_like_monologue(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    if re.fullmatch(r"waiting_for_user_response\.?", t):
        return True
    return bool(_MONOLOGUE_WHOLE_RE.search(t))


def _peel_trailing_monologue(text: str) -> tuple[str, str]:
    m = _MONOLOGUE_START_RE.search(text or "")
    if not m:
        return (text or "").strip(), ""
    reply = (text[: m.start()]).strip()
    monologue = (m.group(1) or "").strip()
    if not reply and monologue:
        return "", monologue
    if not reply:
        return (text or "").strip(), ""
    return reply, monologue


def split_agent_visible_content(raw: str) -> SplitAgentContent:
    text = raw or ""
    thoughts: list[str] = []

    def _think_sub(match: re.Match[str]) -> str:
        body = (match.group(1) or "").strip()
        if body:
            thoughts.append(body)
        return "\n"

    text = _THINK_BLOCK_RE.sub(_think_sub, text)
    awaits_user = bool(_CONTROL_TOKEN_RE.search(text))
    segments = [s.strip() for s in _CONTROL_TOKEN_RE.split(text) if s.strip()]

    reply = ""
    for seg in segments:
        peeled_reply, peeled_mono = _peel_trailing_monologue(seg)
        if peeled_mono:
            thoughts.append(peeled_mono)
        candidate = peeled_reply.strip()
        if not candidate:
            continue
        if _looks_like_monologue(candidate) and len(candidate) < 400:
            thoughts.append(candidate)
            continue
        if not reply:
            reply = candidate
            continue
        if _near_duplicate(reply, candidate):
            reply = candidate if len(candidate) >= len(reply) else reply
        elif _looks_like_monologue(candidate):
            thoughts.append(candidate)
        else:
            reply = candidate if len(candidate) >= len(reply) else reply

    if not awaits_user and len(segments) <= 1:
        peeled_reply, peeled_mono = _peel_trailing_monologue(reply or text.strip())
        reply = peeled_reply
        if peeled_mono:
            thoughts.append(peeled_mono)

    if reply and _looks_like_monologue(reply) and not thoughts:
        thoughts.append(reply)
        reply = ""

    return SplitAgentContent(
        reply=reply.strip(),
        thought="\n\n".join(t for t in thoughts if t).strip(),
        awaits_user=awaits_user,
    )
