"""Protocol adapters that normalize model text and function-call results."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, AsyncIterator, Mapping, Sequence

import httpx

from drsai.platform_auth import get_model_credential_provider

from .model_operation_routing import OperationProtocol, ResolvedAgentOperation


@dataclass(frozen=True)
class NormalizedToolCall:
    call_id: str
    name: str
    arguments: Mapping[str, object]


@dataclass(frozen=True)
class NormalizedModelResult:
    protocol: OperationProtocol
    response_id: str | None
    text: str
    tool_calls: tuple[NormalizedToolCall, ...] = ()
    reasoning_observed: bool = False
    finish_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None

    def public_dict(self) -> dict[str, object]:
        return {
            "protocol": self.protocol,
            "response_id": self.response_id,
            "text": self.text[:2_000],
            "tool_calls": [
                {"call_id": call.call_id, "name": call.name, "arguments": dict(call.arguments)}
                for call in self.tool_calls
            ],
            "reasoning_observed": self.reasoning_observed,
            "finish_reason": self.finish_reason,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }


@dataclass(frozen=True)
class NormalizedModelStreamEvent:
    type: str
    text_delta: str = ""
    result: NormalizedModelResult | None = None


class ModelProtocolError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False, status_code: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code


class OpenAITextOperationAdapter:
    """Execute Responses or Chat against one already-resolved Agent model."""

    def __init__(self, *, timeout: float = 60.0, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.timeout = timeout
        self.transport = transport

    async def create(
        self,
        resolved: ResolvedAgentOperation,
        *,
        protocol: OperationProtocol,
        input_value: str | Sequence[Mapping[str, object]],
        tools: Sequence[Mapping[str, object]] = (),
        reasoning_effort: str | None = None,
        previous_response_id: str | None = None,
        max_output_tokens: int = 256,
    ) -> NormalizedModelResult:
        if protocol not in {"openai_responses", "openai_chat_completions"}:
            raise ModelProtocolError("protocol_unsupported", f"Unsupported text protocol: {protocol}")
        if max_output_tokens < 1 or max_output_tokens > 4_096:
            raise ModelProtocolError("request_rejected", "max_output_tokens is outside the probe limit")
        provider = resolved.model.provider
        static_key = provider.api_key.reveal() if provider.api_key else None
        credential = (
            get_model_credential_provider(static_key, provider.base_url)
            if provider.name == "hepai" else None
        )
        key = credential.access_token if credential is not None else static_key
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        base_url = (
            credential.openai_base_url if credential is not None else provider.base_url
        ).rstrip("/")
        if protocol == "openai_responses":
            url = f"{base_url}/responses"
            payload: dict[str, object] = {
                "model": resolved.model.model,
                "input": input_value,
                "max_output_tokens": max_output_tokens,
            }
            if tools:
                payload["tools"] = list(tools)
            if reasoning_effort:
                payload["reasoning"] = {"effort": reasoning_effort}
            if previous_response_id:
                payload["previous_response_id"] = previous_response_id
        else:
            url = f"{base_url}/chat/completions"
            messages = (
                [{"role": "user", "content": input_value}]
                if isinstance(input_value, str) else list(input_value)
            )
            payload = {
                "model": resolved.model.model,
                "messages": messages,
                "max_tokens": max_output_tokens,
            }
            if tools:
                payload["tools"] = [_responses_tool_to_chat(tool) for tool in tools]
            if reasoning_effort:
                payload["reasoning_effort"] = reasoning_effort
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, transport=self.transport, follow_redirects=False,
            ) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ModelProtocolError("provider_timeout", "Provider request timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ModelProtocolError("provider_unreachable", "Provider request failed", retryable=True) from exc
        if response.status_code >= 400:
            raise _http_error(response)
        try:
            body = response.json()
            return (
                _normalize_responses(body)
                if protocol == "openai_responses" else _normalize_chat(body)
            )
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise ModelProtocolError("invalid_provider_response", "Provider returned an invalid response") from exc

    async def stream(
        self,
        resolved: ResolvedAgentOperation,
        *,
        protocol: OperationProtocol,
        input_value: str | Sequence[Mapping[str, object]],
        tools: Sequence[Mapping[str, object]] = (),
        reasoning_effort: str | None = None,
        max_output_tokens: int = 256,
    ) -> AsyncIterator[NormalizedModelStreamEvent]:
        """Normalize SSE text deltas and emit one validated terminal result."""
        if protocol not in {"openai_responses", "openai_chat_completions"}:
            raise ModelProtocolError("protocol_unsupported", f"Unsupported text protocol: {protocol}")
        provider = resolved.model.provider
        static_key = provider.api_key.reveal() if provider.api_key else None
        credential = (
            get_model_credential_provider(static_key, provider.base_url)
            if provider.name == "hepai" else None
        )
        key = credential.access_token if credential is not None else static_key
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        headers = {"Accept": "text/event-stream", "Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        base_url = (
            credential.openai_base_url if credential is not None else provider.base_url
        ).rstrip("/")
        if protocol == "openai_responses":
            url = f"{base_url}/responses"
            payload: dict[str, object] = {"model": resolved.model.model, "input": input_value, "stream": True, "max_output_tokens": max_output_tokens}
            if tools:
                payload["tools"] = list(tools)
            if reasoning_effort:
                payload["reasoning"] = {"effort": reasoning_effort}
        else:
            url = f"{base_url}/chat/completions"
            payload = {
                "model": resolved.model.model,
                "messages": [{"role": "user", "content": input_value}] if isinstance(input_value, str) else list(input_value),
                "stream": True,
                "stream_options": {"include_usage": True},
                "max_tokens": max_output_tokens,
            }
            if tools:
                payload["tools"] = [_responses_tool_to_chat(tool) for tool in tools]
            if reasoning_effort:
                payload["reasoning_effort"] = reasoning_effort
        text_parts: list[str] = []
        response_id: str | None = None
        finish_reason: str | None = None
        reasoning_observed = False
        usage: dict[str, object] = {}
        tool_parts: dict[int, dict[str, str]] = {}
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport, follow_redirects=False) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code >= 400:
                        raise _http_error(response)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError as exc:
                            raise ModelProtocolError("invalid_provider_response", "Provider returned malformed stream data") from exc
                        delta = _consume_responses_stream_event(event, tool_parts) if protocol == "openai_responses" else _consume_chat_stream_event(event, tool_parts)
                        response_id = delta.get("response_id") or response_id
                        finish_reason = delta.get("finish_reason") or finish_reason
                        reasoning_observed = reasoning_observed or bool(delta.get("reasoning_observed"))
                        if isinstance(delta.get("usage"), dict):
                            usage = delta["usage"]
                        text_delta = str(delta.get("text_delta") or "")
                        if text_delta:
                            text_parts.append(text_delta)
                            yield NormalizedModelStreamEvent("text_delta", text_delta=text_delta)
        except ModelProtocolError:
            raise
        except httpx.TimeoutException as exc:
            raise ModelProtocolError("provider_timeout", "Provider stream timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ModelProtocolError("provider_unreachable", "Provider stream failed", retryable=True) from exc
        calls = tuple(_stream_tool_call(value) for _, value in sorted(tool_parts.items()))
        result = NormalizedModelResult(
            protocol=protocol, response_id=response_id, text="".join(text_parts).strip(), tool_calls=calls,
            reasoning_observed=reasoning_observed, finish_reason=finish_reason,
            input_tokens=_optional_int(usage.get("input_tokens") if protocol == "openai_responses" else usage.get("prompt_tokens")),
            output_tokens=_optional_int(usage.get("output_tokens") if protocol == "openai_responses" else usage.get("completion_tokens")),
        )
        yield NormalizedModelStreamEvent("completed", result=result)


def _responses_tool_to_chat(tool: Mapping[str, object]) -> dict[str, object]:
    if tool.get("type") != "function":
        return dict(tool)
    function = {
        key: tool[key] for key in ("name", "description", "parameters", "strict") if key in tool
    }
    return {"type": "function", "function": function}


def _consume_responses_stream_event(event: object, tools: dict[int, dict[str, str]]) -> dict[str, object]:
    if not isinstance(event, dict):
        raise ModelProtocolError("invalid_provider_response", "Responses stream event must be an object")
    kind = event.get("type")
    result: dict[str, object] = {}
    response = event.get("response") if isinstance(event.get("response"), dict) else {}
    if response.get("id"):
        result["response_id"] = str(response["id"])
    if kind == "response.output_text.delta" and isinstance(event.get("delta"), str):
        result["text_delta"] = event["delta"]
    elif kind == "response.reasoning_summary_text.delta":
        result["reasoning_observed"] = True
    elif kind == "response.output_item.added" and isinstance(event.get("item"), dict):
        item = event["item"]
        if item.get("type") == "function_call":
            index = int(event.get("output_index") or 0)
            tools[index] = {"id": str(item.get("call_id") or item.get("id") or ""), "name": str(item.get("name") or ""), "arguments": str(item.get("arguments") or "")}
    elif kind == "response.function_call_arguments.delta":
        index = int(event.get("output_index") or 0)
        tools.setdefault(index, {"id": str(event.get("item_id") or ""), "name": "", "arguments": ""})["arguments"] += str(event.get("delta") or "")
    elif kind in {"response.completed", "response.incomplete", "response.failed"}:
        result["finish_reason"] = str(response.get("status") or kind.removeprefix("response."))
        if isinstance(response.get("usage"), dict):
            result["usage"] = response["usage"]
    return result


def _consume_chat_stream_event(event: object, tools: dict[int, dict[str, str]]) -> dict[str, object]:
    if not isinstance(event, dict):
        raise ModelProtocolError("invalid_provider_response", "Chat stream event must be an object")
    result: dict[str, object] = {"response_id": str(event.get("id"))} if event.get("id") else {}
    if isinstance(event.get("usage"), dict):
        result["usage"] = event["usage"]
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices:
        return result
    choice = choices[0]
    if not isinstance(choice, dict):
        return result
    if choice.get("finish_reason"):
        result["finish_reason"] = str(choice["finish_reason"])
    delta = choice.get("delta")
    if not isinstance(delta, dict):
        return result
    if isinstance(delta.get("content"), str):
        result["text_delta"] = delta["content"]
    if delta.get("reasoning") or delta.get("reasoning_content"):
        result["reasoning_observed"] = True
    if isinstance(delta.get("tool_calls"), list):
        for raw in delta["tool_calls"]:
            if not isinstance(raw, dict):
                continue
            index = int(raw.get("index") or 0)
            target = tools.setdefault(index, {"id": "", "name": "", "arguments": ""})
            if raw.get("id"):
                target["id"] = str(raw["id"])
            function = raw.get("function")
            if isinstance(function, dict):
                if function.get("name"):
                    target["name"] += str(function["name"])
                if function.get("arguments"):
                    target["arguments"] += str(function["arguments"])
    return result


def _stream_tool_call(value: Mapping[str, str]) -> NormalizedToolCall:
    return _tool_call(value.get("id"), value.get("name"), value.get("arguments"))


def _normalize_responses(body: object) -> NormalizedModelResult:
    if not isinstance(body, dict):
        raise ValueError("response must be an object")
    texts: list[str] = []
    calls: list[NormalizedToolCall] = []
    reasoning = False
    output = body.get("output")
    if not isinstance(output, list):
        raise ValueError("Responses output must be a list")
    for item in output:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind == "reasoning":
            reasoning = True
        elif kind == "function_call":
            calls.append(_tool_call(item.get("call_id") or item.get("id"), item.get("name"), item.get("arguments")))
        elif kind == "message":
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") in {"output_text", "text"} and isinstance(part.get("text"), str):
                        texts.append(part["text"])
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    return NormalizedModelResult(
        protocol="openai_responses",
        response_id=str(body.get("id")) if body.get("id") else None,
        text="\n".join(texts).strip(),
        tool_calls=tuple(calls),
        reasoning_observed=reasoning,
        finish_reason=str(body.get("status")) if body.get("status") else None,
        input_tokens=_optional_int(usage.get("input_tokens")),
        output_tokens=_optional_int(usage.get("output_tokens")),
    )


def _normalize_chat(body: object) -> NormalizedModelResult:
    if not isinstance(body, dict) or not isinstance(body.get("choices"), list) or not body["choices"]:
        raise ValueError("Chat response has no choices")
    choice = body["choices"][0]
    if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
        raise ValueError("Chat response has no message")
    message = choice["message"]
    content = message.get("content")
    text = content if isinstance(content, str) else ""
    calls: list[NormalizedToolCall] = []
    if isinstance(message.get("tool_calls"), list):
        for item in message["tool_calls"]:
            function = item.get("function") if isinstance(item, dict) else None
            if isinstance(function, dict):
                calls.append(_tool_call(item.get("id"), function.get("name"), function.get("arguments")))
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    return NormalizedModelResult(
        protocol="openai_chat_completions",
        response_id=str(body.get("id")) if body.get("id") else None,
        text=text.strip(),
        tool_calls=tuple(calls),
        reasoning_observed=bool(message.get("reasoning") or message.get("reasoning_content")),
        finish_reason=str(choice.get("finish_reason")) if choice.get("finish_reason") else None,
        input_tokens=_optional_int(usage.get("prompt_tokens")),
        output_tokens=_optional_int(usage.get("completion_tokens")),
    )


def _tool_call(call_id: object, name: object, arguments: object) -> NormalizedToolCall:
    if not isinstance(call_id, str) or not call_id or not isinstance(name, str) or not name:
        raise ValueError("tool call identity is invalid")
    if isinstance(arguments, str):
        parsed = json.loads(arguments)
    else:
        parsed = arguments
    if not isinstance(parsed, dict):
        raise ValueError("tool arguments must be an object")
    return NormalizedToolCall(call_id, name, parsed)


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _http_error(response: httpx.Response | int) -> ModelProtocolError:
    status = response if isinstance(response, int) else response.status_code
    mapping = {
        400: ("request_rejected", False),
        401: ("authentication_failed", False),
        403: ("permission_denied", False),
        404: ("endpoint_not_found", False),
        429: ("quota_exceeded", True),
    }
    code, retryable = mapping.get(status, ("provider_rejected", status >= 500))
    safe_text = ""
    if isinstance(response, httpx.Response):
        try:
            payload = response.json()
            error = payload.get("error") if isinstance(payload, dict) else None
            detail = payload.get("detail") if isinstance(payload, dict) else None
            candidate = error if error is not None else detail
            if isinstance(candidate, dict):
                safe_text = " ".join(str(candidate.get(key) or "") for key in ("code", "type", "status", "message"))
            elif isinstance(candidate, str):
                safe_text = candidate
        except (TypeError, ValueError):
            safe_text = ""
    normalized = safe_text[:1000].casefold()
    if any(marker in normalized for marker in ("model_not_found", "model not found", "unknown model", "does not exist", "invalid model")):
        code, retryable = "model_not_found", False
    elif any(marker in normalized for marker in ("operation_unsupported", "not supported", "unsupported operation")):
        code, retryable = "operation_unsupported", False
    elif any(marker in normalized for marker in ("permission", "forbidden", "access denied")):
        code, retryable = "permission_denied", False
    elif any(marker in normalized for marker in ("quota", "insufficient balance", "insufficient credit")):
        code, retryable = "quota_exceeded", True
    elif any(marker in normalized for marker in ("unauthorized", "authentication", "api key")):
        code, retryable = "authentication_failed", False
    elif any(marker in normalized for marker in ("bad gateway", "upstream", "temporarily unavailable", "timeout")):
        code, retryable = "provider_unreachable", True
    return ModelProtocolError(code, "Provider rejected the request", retryable=retryable, status_code=status)
