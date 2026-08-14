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

# How many envelopes to peel before giving up. Deep enough for the shapes seen
# in practice, bounded so a self-referential result cannot loop.
_MAX_RESULT_ENVELOPES = 4


def unwrap_tool_result(value: Any) -> Any:
    """Read the tool result out of whatever the host wrapped it in.

    The same result reaches this code in three shapes: the object itself, a JSON
    string, and a JSON string holding ``{"content": "<json>"}``. Reading only the
    outer shape finds no evidence, and the failure is silent in the worst
    direction — no evidence means no citations are required, so the answers that
    most need checking are the ones that stop being checked.

    The unwrapping exists in two other places, written out by hand: the kernel's
    citation evidence and the engine's per-sentence check. Missing this third
    site is what left a correctly cited answer showing no citations at all.
    Those two cannot import this module without a cycle (`grounded` imports
    `agent_kernel`) or without breaking the standalone-source-set rule that
    `mobile_core` is held to, so folding them in means moving the helper into
    `agent_kernel` and re-exporting through `mobile_core.context`.
    """

    for _ in range(_MAX_RESULT_ENVELOPES):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, json.JSONDecodeError):
                return {}
        # Only descend when the outer object cannot be the result itself.
        # An object that already carries evidence is the result, even if it
        # happens to have a "content" key as well.
        elif isinstance(value, Mapping) and "evidence" not in value and "content" in value:
            value = value["content"]
        else:
            return value
    return value

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
_SOURCE_REFERENCE = re.compile(
    r"^(?:[-*]\s*)?(?:sources?|来源|出处)?\s*[:：]?\s*(?:\[[^\]]*\]\(\s*)?\w+://\S+\)?$",
    re.IGNORECASE,
)
# The engine's own citation repair appends a "Sources:" block, so the heading
# has to be recognised as apparatus rather than scored as an uncited claim.
_SOURCE_HEADING = re.compile(
    r"^(?:证据|参考|引证)?\s*(?:sources?|来源|出处|引用|references?)\s*[:：]?\s*$",
    re.IGNORECASE,
)
# An attribution line names where the evidence came from and repeats the
# locator we supplied. Scoring it as a claim makes the model's own citation
# ("第1-13行") look like an invented figure, because those line numbers are
# not in the passage text.
_SOURCE_ATTRIBUTION = re.compile(
    r"^(?:来源|出处|证据来源|证据引用|引用来源|参考|sources?|evidence|reference)\s*[:：]\s*"
    # It must actually look like an attribution: a file name, path or URL.
    # A lead-in alone would let any invented sentence skip the check simply
    # by opening with "来源：".
    r"[^\n]*?(?:\w+://\S+|[\w./\\-]+\.[A-Za-z0-9]{1,8})",
    re.IGNORECASE,
)
_CJK_TOKEN = re.compile(r"[㐀-鿿]{2,}")


_QUOTE_PAIRS = (("“", "”"), ("「", "」"), ("『", "』"))


def _quotes_balanced(text: str) -> bool:
    """Whether every quotation opened in `text` is also closed inside it."""
    for opener, closer in _QUOTE_PAIRS:
        if text.count(opener) != text.count(closer):
            return False
    return text.count('"') % 2 == 0


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

    # Models place the marker on either side of the terminator. Splitting
    # "... multiple Runs. [E1]" leaves the marker in a segment of its own and
    # the claim looking uncited, so a correctly cited answer would be sent back
    # as unsupported. Reattach a marker-only segment to the claim it follows.
    segments: list[str] = []
    pending = ""
    for raw in _SENTENCE_SPLIT.split(final_content):
        piece = f"{pending} {raw.strip()}".strip() if pending else raw.strip()
        if not piece:
            continue
        # A grounded answer quotes the passage it cites, and the quotation has
        # its own terminators. Splitting inside it separates the claim from the
        # marker that follows the closing quote, so a correctly cited answer
        # gets reported as uncited.
        if not _quotes_balanced(piece):
            pending = piece
            continue
        pending = ""
        remainder = _CITATION_MARKER.sub("", piece).strip()
        if segments and (not remainder or _SOURCE_REFERENCE.match(remainder)):
            # Carry only the markers back. Folding the source text in too would
            # make the claim inherit tokens the passage never contains and fail
            # its own support check.
            carried = "".join(f"[E{value}]" for value in _CITATION_MARKER.findall(piece))
            if carried:
                segments[-1] = f"{segments[-1]} {carried}"
            continue
        segments.append(piece)
    if pending:
        segments.append(pending)

    factual: list[int] = []
    cited: list[int] = []
    unsupported: list[int] = []
    fabricated: set[int] = set()
    carried: list[int] = []
    for index, sentence in enumerate(segments):
        own = [int(value) for value in _CITATION_MARKER.findall(sentence)]
        body = _CITATION_MARKER.sub(" ", sentence)
        if not _is_factual(body):
            continue
        factual.append(index)
        # People cite once and keep writing, so a sentence continuing a cited
        # one inherits its marker rather than counting as uncited. This does not
        # weaken the check: the inherited passage still has to support the
        # sentence, and every figure in it must occur there.
        markers = own or carried
        if own:
            carried = own
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
    # A bare source reference is citation apparatus, not a claim. Scoring it as
    # one makes every properly sourced answer look partly unsupported.
    if (
        _SOURCE_REFERENCE.match(stripped)
        or _SOURCE_HEADING.match(stripped)
        or _SOURCE_ATTRIBUTION.match(stripped)
    ):
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
    # Chinese has no word boundaries, so whole runs of characters only match
    # when the model quotes verbatim; a faithful paraphrase would look invented.
    # Character bigrams give overlap that survives rewording.
    tokens = {value.casefold() for value in _LATIN_TOKEN.findall(sentence)}
    for run in _CJK_TOKEN.findall(sentence):
        tokens.update(run[index:index + 2] for index in range(len(run) - 1))
    if not tokens:
        return bool(numbers)
    # Deliberately weak. This asks "is the sentence talking about the cited
    # passage at all", and leaves the load-bearing check to the figures above.
    # Demanding heavy overlap would reject every restatement that is not a
    # quotation, and training people to ignore the warning is worse than the
    # narrower guarantee.
    return any(token in folded or token in passage for token in tokens)


def _digest(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
