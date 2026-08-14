"""Grounded answering: answer only from supplied material, or refuse.

Three things have to hold together for this to work, and each fails silently on
its own:

* the model must retrieve before answering, because it will otherwise answer a
  familiar question from memory and be right often enough that testing passes;
* it must not reach outside the supplied material, including into conversation
  history, which may contain its own earlier output;
* it must be able to point at the passage behind every factual claim, because
  a refusal built on the model's own confidence is a much weaker signal than
  one built on whether evidence can be produced.

Nothing here stores the user's text. Decisions are reported as flags, counts
and digests so a Run can be audited without retaining what was asked.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping, Sequence

from .agent_kernel import tool_decision_domain

GROUNDED_POLICY_VERSION = "grounded-answering-v1"
CLAIM_SUPPORT_POLICY_VERSION = "claim-support-v1"

# Retrieval that stays inside the supplied corpus. Every other retrieval tool
# reaches outside it and is withheld while grounded.
GROUNDED_RETRIEVAL_TOOLS = frozenset({"knowledge_search"})

# Conversation history is not supplied material: it can contain the model's own
# earlier answers, so treating it as evidence lets an invention become its own
# source on the next turn.
GROUNDED_WITHHELD_DOMAINS = frozenset({"retrieval", "memory"})

_EXPLICIT_GROUNDED_PATTERNS = (
    # Chinese: "仅根据/只根据/只能根据……回答", "根据提供的……回答"
    r"(?:仅|只|仅仅|只能)(?:根据|依据|基于|使用|用)",
    r"根据(?:所)?提供的[^，。；\n]{0,20}(?:资料|材料|文档|知识库|内容)",
    r"不要(?:使用|依赖)(?:你)?(?:自己|自身)的?知识",
    r"(?:不得|禁止)(?:编造|臆测|猜测|推测)",
    # English
    r"\bbased only on\b",
    r"\bonly (?:use|using|from|based on)\b",
    r"\busing only the\b",
    r"\baccording to the (?:provided|supplied|given|attached)\b",
    r"\bfrom the (?:provided|supplied|given|attached) (?:material|document|documents|knowledge base|corpus|sources?)\b",
    r"\bdo not use your own knowledge\b",
)

_CITATION_REQUEST_PATTERNS = (
    r"(?:提供|给出|附上|标注|注明)(?:引用|出处|来源|依据)",
    r"(?:并|请)(?:提供|给出)(?:引用|依据|出处|来源)",
    r"\b(?:with|provide|give|include|cite)\b[^.\n]{0,24}\b(?:citations?|sources?|references?|evidence)\b",
)


def detect_grounded_request(input_text: str) -> dict[str, Any]:
    """Decide whether this turn asked to be answered only from given material.

    Deliberately explicit-only: inferring the mode would silently change how
    ordinary questions are answered. A missed trigger shows up as an answer
    with no citations, which is why the decision is recorded on the Run rather
    than left implicit.
    """

    if not isinstance(input_text, str) or len(input_text) > 100_000:
        raise ValueError("grounded_input_invalid")
    matched = [
        pattern for pattern in _EXPLICIT_GROUNDED_PATTERNS
        if re.search(pattern, input_text, re.IGNORECASE)
    ]
    citations = any(
        re.search(pattern, input_text, re.IGNORECASE) for pattern in _CITATION_REQUEST_PATTERNS
    )
    unsigned = {
        "policy_version": GROUNDED_POLICY_VERSION,
        "grounded": bool(matched),
        "requires_citations": bool(matched) and citations,
        "trigger_count": len(matched),
        "trigger_sha256": sorted(
            hashlib.sha256(pattern.encode("utf-8")).hexdigest() for pattern in matched
        ),
    }
    return {**unsigned, "sha256": _digest(unsigned)}


def partition_grounded_tools(names: Sequence[str]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Split available tools into those allowed while grounded and those withheld.

    Corpus retrieval stays; anything that can reach outside the supplied
    material goes, so "not in the material" cannot be quietly answered from
    somewhere else. Telling the model not to use such a tool is a request —
    taking the tool away is the part it cannot ignore.

    The split is derived from the kernel's own capability classification rather
    than a list of tool names kept here. A second list would have to be updated
    by whoever adds a tool, would not fail loudly when they did not, and would
    leave the door it was meant to close standing open.
    """

    if not isinstance(names, Sequence) or isinstance(names, (str, bytes)):
        raise ValueError("grounded_tools_invalid")
    allowed: list[str] = []
    withheld: list[str] = []
    for value in names:
        if not isinstance(value, str) or not value:
            continue
        if value.casefold() in GROUNDED_RETRIEVAL_TOOLS:
            allowed.append(value)
        elif tool_decision_domain(value) in GROUNDED_WITHHELD_DOMAINS:
            withheld.append(value)
        else:
            # Unclassified tools stay available: withholding everything the
            # kernel does not recognise would disable Skills and custom tools
            # that have nothing to do with reaching outside the material.
            allowed.append(value)
    return tuple(sorted(set(allowed))), tuple(sorted(set(withheld)))


_CITATION_MARKER = re.compile(r"\[E(\d{1,3})\]")
# Split on CJK terminators, on a full stop that ends a word (so "18642.5" and
# "runtime.md" stay intact), and on line breaks.
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？!?])\s*|(?<!\d)\.\s+|\n+")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_LATIN_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9._-]{2,}")
_CJK_TOKEN = re.compile(r"[㐀-鿿]{2,}")


def build_claim_support(
    final_content: str, evidence: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Check every cited sentence against the passage it cites.

    Whole-answer citation checking passes an answer that cites a real document
    and then states something the document never says. Support is therefore
    judged per sentence, and numbers are judged strictly: a figure that does not
    occur in the cited passage is the exact failure this is here to catch.
    """

    if not isinstance(final_content, str) or len(final_content) > 1_000_000:
        raise ValueError("claim_content_invalid")
    contents: dict[int, str] = {}
    for position, row in enumerate(evidence or (), start=1):
        if isinstance(row, Mapping):
            contents[position] = str(row.get("content") or "")

    factual: list[int] = []
    cited: list[int] = []
    unsupported: list[int] = []
    fabricated: set[int] = set()
    for index, raw in enumerate(_SENTENCE_SPLIT.split(final_content)):
        sentence = raw.strip()
        if not sentence:
            continue
        markers = [int(value) for value in _CITATION_MARKER.findall(sentence)]
        body = _CITATION_MARKER.sub(" ", sentence)
        if not _is_factual(body):
            continue
        factual.append(index)
        if not markers:
            unsupported.append(index)
            continue
        unknown = [marker for marker in markers if marker not in contents]
        fabricated.update(unknown)
        supporting = "\n".join(contents[marker] for marker in markers if marker in contents)
        cited.append(index)
        if unknown or not _passage_supports(body, supporting):
            unsupported.append(index)

    unsigned = {
        "policy_version": CLAIM_SUPPORT_POLICY_VERSION,
        "factual_claims": len(factual),
        "cited_claims": len(cited),
        "uncited_claims": len(factual) - len(cited),
        "unsupported_claims": len(unsupported),
        "fabricated_citation_ids": sorted(fabricated),
        "valid": not unsupported and not fabricated,
    }
    return {**unsigned, "sha256": _digest(unsigned)}


def _is_factual(sentence: str) -> bool:
    """Skip framing sentences so refusals are not scored as unsupported claims."""
    stripped = sentence.strip()
    if len(stripped) < 4:
        return False
    hedges = (
        "知识库", "文档", "资料", "未包含", "没有找到", "不包含", "无法", "并未",
        "does not", "not found", "no information", "cannot", "could not", "unable to",
        "i searched", "searched the",
    )
    return not any(hedge in stripped.casefold() for hedge in hedges)


def _passage_supports(sentence: str, passage: str) -> bool:
    if not passage.strip():
        return False
    folded = passage.casefold()
    # Every figure asserted must occur in the cited passage. This is the check
    # that separates "read it off the material" from "produced a plausible
    # number", and a wrong number is worse than a refusal.
    numbers = set(_NUMBER.findall(sentence))
    if any(number not in passage for number in numbers):
        return False
    tokens = {value.casefold() for value in _LATIN_TOKEN.findall(sentence)}
    tokens.update(_CJK_TOKEN.findall(sentence))
    if not tokens:
        return bool(numbers)
    hits = sum(1 for token in tokens if token in folded or token in passage)
    return hits >= max(1, len(tokens) // 3)


def _digest(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
