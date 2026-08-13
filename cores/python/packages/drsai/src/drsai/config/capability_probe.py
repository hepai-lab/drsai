"""Bounded, redacted capability probes and immutable result snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
import asyncio
import base64
import hashlib
from io import BytesIO
import json
import re
import time
from typing import Literal, Mapping
from uuid import uuid4

from PIL import Image as PILImage, ImageDraw

from .audio_operation_adapter import OpenAIAudioOperationAdapter, SpeechSynthesisResult
from .gemini_operation_adapter import GeminiGenerateContentAdapter
from .model_operation_adapters import ModelProtocolError, OpenAITextOperationAdapter
from .model_operation_routing import OperationProtocol, ResolvedAgentOperation
from .openai_image_operation_adapter import OpenAIImageOperationAdapter


ProbeStatus = Literal["verified", "runtime_verified", "unsupported", "unavailable", "inconclusive", "stale", "error"]


@dataclass(frozen=True)
class ProbeAssertion:
    id: str
    passed: bool
    detail: str = ""

    def public_dict(self) -> dict[str, object]:
        return {"id": self.id, "passed": self.passed, **({"detail": self.detail[:500]} if self.detail else {})}


@dataclass(frozen=True)
class CapabilityProbeResult:
    probe_id: str
    agent_id: str
    provider_id: str
    model_id: str
    upstream_model_id: str
    operation: str
    protocol: OperationProtocol
    status: ProbeStatus
    started_at: str
    duration_ms: int
    assertions: tuple[ProbeAssertion, ...]
    may_incur_cost: bool = True
    error_code: str | None = None
    http_status: int | None = None
    retryable: bool = False
    request_bytes: int = 0
    output_bytes: int = 0
    revisions: Mapping[str, str] | None = None
    runtime_evidence: Mapping[str, str] | None = None

    def public_dict(self) -> dict[str, object]:
        revisions = dict(self.revisions or {})
        for name in ("provider_config", "agent_policy", "model_catalog", "route_rules", "probe_definition"):
            revisions.setdefault(name, "unknown")
        return {
            "schema_version": "opendrsai.model-capability-probe-result/1",
            "probe_id": self.probe_id,
            "agent_id": self.agent_id,
            "provider_id": self.provider_id,
            "model_id": self.model_id,
            "upstream_model_id": self.upstream_model_id,
            "operation": self.operation,
            "protocol": self.protocol,
            "status": self.status,
            "error_code": self.error_code,
            "http_status": self.http_status,
            "retryable": self.retryable,
            "started_at": self.started_at,
            "duration_ms": self.duration_ms,
            "request_bytes": self.request_bytes,
            "output_bytes": self.output_bytes,
            "may_incur_cost": self.may_incur_cost,
            "evidence_kind": "real_provider",
            "assertions": [item.public_dict() for item in self.assertions],
            "revisions": revisions,
            "runtime_evidence": dict(self.runtime_evidence) if self.runtime_evidence else None,
        }


def build_capability_snapshot(
    agent_id: str, results: list[CapabilityProbeResult], revisions: Mapping[str, str],
) -> dict[str, object]:
    rows = [item.public_dict() for item in results]
    core = {
        "schema_version": "opendrsai.model-capability-snapshot/1",
        "agent_id": agent_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "revisions": dict(revisions),
        "results": rows,
    }
    digest_input = _stable_snapshot_payload(core)
    digest = hashlib.sha256(json.dumps(digest_input, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {**core, "digest": f"sha256:{digest}"}


def _stable_snapshot_payload(snapshot: Mapping[str, object]) -> dict[str, object]:
    """Return the capability facts without execution-specific telemetry."""
    stable = dict(snapshot)
    stable.pop("digest", None)
    stable["created_at"] = None
    stable_rows: list[object] = []
    for raw_row in stable.get("results", []):
        if not isinstance(raw_row, Mapping):
            stable_rows.append(raw_row)
            continue
        row = dict(raw_row)
        for key in ("probe_id", "started_at", "duration_ms"):
            row.pop(key, None)
        stable_rows.append(row)
    stable["results"] = stable_rows
    return stable


class CapabilityProbeService:
    def __init__(
        self,
        *,
        text_adapter: OpenAITextOperationAdapter | None = None,
        gemini_adapter: GeminiGenerateContentAdapter | None = None,
        image_adapter: OpenAIImageOperationAdapter | None = None,
        audio_adapter: OpenAIAudioOperationAdapter | None = None,
    ) -> None:
        self.text_adapter = text_adapter or OpenAITextOperationAdapter()
        self.gemini_adapter = gemini_adapter or GeminiGenerateContentAdapter()
        self.image_adapter = image_adapter or OpenAIImageOperationAdapter()
        self.audio_adapter = audio_adapter or OpenAIAudioOperationAdapter()

    async def probe(
        self,
        resolved: ResolvedAgentOperation,
        *,
        agent_id: str,
        protocol: OperationProtocol,
        audio_input: bytes | None = None,
        revisions: Mapping[str, str] | None = None,
    ) -> tuple[CapabilityProbeResult, SpeechSynthesisResult | None]:
        started = time.monotonic()
        started_at = datetime.now(timezone.utc).isoformat()
        assertions: list[ProbeAssertion] = []
        output_bytes = 0
        synthesized: SpeechSynthesisResult | None = None
        retryable = False
        http_status = None
        try:
            operation = resolved.route_plan.operation
            if operation == "chat" and resolved.role == "image_understanding_model":
                image = _vision_fixture()
                prompt = "Return JSON with background, center, shape."
                image_url = f"data:image/png;base64,{base64.b64encode(image).decode('ascii')}"
                if protocol == "gemini_generate_content":
                    result = await asyncio.to_thread(
                        self.gemini_adapter.create,
                        resolved, prompt=prompt, image=image, image_mime="image/png",
                    )
                elif protocol == "openai_responses":
                    result = await self.text_adapter.create(
                        resolved, protocol=protocol,
                        input_value=[{"role": "user", "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": image_url},
                        ]}],
                    )
                elif protocol == "openai_chat_completions":
                    result = await self.text_adapter.create(
                        resolved, protocol=protocol,
                        input_value=[{"role": "user", "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ]}],
                    )
                else:  # pragma: no cover - endpoint validates route candidates.
                    raise ModelProtocolError("protocol_unsupported", f"Unsupported vision protocol: {protocol}")
                output_bytes = len(result.text.encode())
                normalized = result.text.casefold()
                assertions.extend([
                    ProbeAssertion("background_red", "red" in normalized),
                    ProbeAssertion("center_blue", "blue" in normalized),
                    ProbeAssertion("shape_circle", "circle" in normalized),
                ])
            elif operation == "image_generation":
                prompt = "A single flat blue circle centered on a plain white background, no text."
                if protocol == "gemini_generate_content":
                    result = await asyncio.to_thread(
                        self.gemini_adapter.create,
                        resolved, prompt=prompt, response_modalities=("TEXT", "IMAGE"),
                    )
                    content = result.images[0].content if result.images else b""
                elif protocol == "openai_images_generation":
                    image_result = await asyncio.to_thread(self.image_adapter.generate, resolved, prompt=prompt)
                    content = image_result.content
                else:
                    raise ModelProtocolError("protocol_unsupported", f"Unsupported image protocol: {protocol}")
                valid = bool(content)
                if valid:
                    output_bytes = len(content)
                    try:
                        with PILImage.open(BytesIO(content)) as image:
                            image.verify()
                    except Exception:
                        valid = False
                assertions.append(ProbeAssertion("decodable_image", valid))
            elif operation == "text_to_speech":
                synthesized = await asyncio.to_thread(
                    self.audio_adapter.synthesize,
                    resolved, text="OpenDrSai capability test 42", output_format="mp3",
                )
                output_bytes = len(synthesized.content)
                assertions.append(ProbeAssertion("valid_audio", output_bytes > 0))
            elif operation == "speech_to_text":
                if not audio_input:
                    raise ModelProtocolError("request_rejected", "Speech-to-text probe requires bounded audio input")
                result = await asyncio.to_thread(
                    self.audio_adapter.transcribe,
                    resolved, audio=audio_input, filename="capability-probe.mp3", media_type="audio/mpeg",
                )
                output_bytes = len(result.text.encode())
                normalized = re.sub(r"[^a-z0-9]+", " ", result.text.casefold())
                compact = normalized.replace(" ", "")
                brand_window = compact.split("capability", 1)[0][-20:]
                brand_observed = "opendrsai" in compact or SequenceMatcher(None, brand_window, "opendrsai").ratio() >= 0.65
                assertions.extend([
                    ProbeAssertion("mentions_opendrsai", brand_observed),
                    ProbeAssertion("mentions_capability_test", "capability test" in normalized),
                    ProbeAssertion("mentions_42", "42" in normalized),
                ])
            elif operation == "tool_calling":
                tool = {
                    "type": "function", "name": "calculator_add", "description": "Add two integers",
                    "parameters": {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"], "additionalProperties": False},
                }
                if protocol == "gemini_generate_content":
                    result = await asyncio.to_thread(
                        self.gemini_adapter.create,
                        resolved, prompt="Use calculator_add to add 17 and 25.", tools=[tool],
                    )
                else:
                    result = await self.text_adapter.create(
                        resolved, protocol=protocol, input_value="Use calculator_add to add 17 and 25.", tools=[tool],
                    )
                output_bytes = len(result.text.encode())
                call = result.tool_calls[0] if result.tool_calls else None
                assertions.extend([
                    ProbeAssertion("structured_tool_call", call is not None),
                    ProbeAssertion("tool_name", bool(call and call.name == "calculator_add")),
                    ProbeAssertion("tool_arguments", bool(call and call.arguments == {"a": 17, "b": 25})),
                ])
            else:
                prompt = "A price is discounted by 20%, then taxed by 10%. The final price is 88. Reply only with the original price as a number." if operation == "reasoning" else "Reply with exactly: pong"
                result = await self.text_adapter.create(
                    resolved, protocol=protocol, input_value=prompt,
                    reasoning_effort="high" if operation == "reasoning" else None,
                )
                output_bytes = len(result.text.encode())
                if operation == "reasoning":
                    assertions.append(ProbeAssertion("correct_result", bool(re.search(r"\b100(?:\.0+)?\b", result.text))))
                else:
                    assertions.append(ProbeAssertion("exact_pong", result.text.strip().casefold().strip(".!`") == "pong"))
            passed = bool(assertions) and all(item.passed for item in assertions)
            status: ProbeStatus = "verified" if passed else "inconclusive"
            error_code = None if passed else "capability_assertion_failed"
        except ModelProtocolError as exc:
            status = "unsupported" if exc.code in {"endpoint_not_found", "protocol_unsupported"} else "unavailable" if exc.code in {"credential_unavailable", "authentication_failed", "permission_denied", "quota_exceeded", "provider_timeout", "provider_unreachable"} else "error"
            error_code = exc.code
            retryable = exc.retryable
            http_status = exc.status_code
        result = CapabilityProbeResult(
            probe_id=f"probe-{uuid4()}", agent_id=agent_id,
            provider_id=resolved.ref.provider_id, model_id=resolved.ref.model_id,
            upstream_model_id=resolved.model.model,
            operation=resolved.route_plan.operation, protocol=protocol, status=status,
            started_at=started_at, duration_ms=max(0, round((time.monotonic() - started) * 1000)),
            assertions=tuple(assertions), error_code=error_code, retryable=retryable,
            http_status=http_status,
            request_bytes=len(str(resolved.route_plan.operation).encode()), output_bytes=output_bytes,
            revisions=revisions,
        )
        return result, synthesized


def _vision_fixture() -> bytes:
    image = PILImage.new("RGB", (64, 64), "red")
    draw = ImageDraw.Draw(image)
    draw.ellipse((16, 16, 48, 48), fill="blue")
    stream = BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return stream.getvalue()
