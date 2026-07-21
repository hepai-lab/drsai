"""OWOP schema validation, negotiation, envelopes, and event sequencing."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping, Union

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError


OWOP_VERSION = "1.0"


def _default_schema_path() -> Path:
    current = Path(__file__).resolve()
    packaged = current.with_name("owop.schema.json")
    if packaged.is_file():
        return packaged
    for parent in current.parents:
        candidate = parent / "protocol" / "owop" / "owop.schema.json"
        if candidate.is_file():
            return candidate
    raise RuntimeError("OWOP schema is not installed")


@dataclass(frozen=True)
class OWOPError(RuntimeError):
    code: str
    message: str
    correlation_id: str
    retryable: bool = False
    details: Mapping[str, Any] | None = None

    def __str__(self) -> str:
        return self.message

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "correlation_id": self.correlation_id,
            "retryable": self.retryable,
            "details": dict(self.details or {}),
        }


Handler = Callable[[Mapping[str, Any]], Union[Mapping[str, Any], Awaitable[Mapping[str, Any]]]]


class OWOPProtocol:
    def __init__(self, schema_path: Path | None = None):
        self.schema_path = Path(schema_path) if schema_path else _default_schema_path()
        self.schema = json.loads(self.schema_path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(self.schema)
        self.version = str(self.schema["version"])
        self.capabilities = frozenset(self.schema["x-owop-capabilities"])
        self.bindings = frozenset(self.schema["x-owop-bindings"])
        self.operations: Mapping[str, Mapping[str, Any]] = self.schema["x-owop-operations"]
        self.results: Mapping[str, Mapping[str, Any]] = self.schema.get("x-owop-results", {})
        self._request_validator = Draft202012Validator({
            "$schema": self.schema["$schema"],
            "$defs": self.schema["$defs"],
            **self.schema["$defs"]["request"],
        })
        self._event_validator = Draft202012Validator({
            "$schema": self.schema["$schema"],
            "$defs": self.schema["$defs"],
            **self.schema["$defs"]["event"],
        })
        self._operation_validators = {
            name: Draft202012Validator({
                "$schema": self.schema["$schema"],
                "$defs": self.schema["$defs"],
                **operation_schema,
            })
            for name, operation_schema in self.operations.items()
        }
        self._result_validators = {
            name: Draft202012Validator({
                "$schema": self.schema["$schema"],
                "$defs": self.schema["$defs"],
                **result_schema,
            })
            for name, result_schema in self.results.items()
        }

    def negotiate(self, versions: list[str], capabilities: list[str]) -> dict[str, Any]:
        if self.version not in versions:
            raise OWOPError(
                "owop_version_incompatible",
                f"OWOP version {self.version} is required.",
                "negotiation",
                details={"supported": [self.version], "offered": versions},
            )
        unknown = sorted(set(capabilities) - self.capabilities)
        return {
            "version": self.version,
            "capabilities": sorted(set(capabilities).intersection(self.capabilities)),
            "unsupported_capabilities": unknown,
            "bindings": sorted(self.bindings),
        }

    def validate_request(self, request: Mapping[str, Any]) -> None:
        correlation_id = str(request.get("correlation_id") or "unknown")
        try:
            self._request_validator.validate(dict(request))
        except ValidationError as exc:
            raise OWOPError(
                "owop_request_invalid",
                "OWOP request envelope is invalid.",
                correlation_id,
                details={"path": list(exc.absolute_path), "rule": exc.validator},
            ) from exc
        operation = str(request["operation"])
        validator = self._operation_validators.get(operation)
        if validator is None:
            raise OWOPError(
                "owop_operation_unknown",
                f"OWOP operation {operation} is not supported.",
                correlation_id,
                details={"operation": operation},
            )
        try:
            validator.validate(dict(request["params"]))
        except ValidationError as exc:
            raise OWOPError(
                "owop_params_invalid",
                f"Parameters for {operation} are invalid.",
                correlation_id,
                details={"operation": operation, "path": list(exc.absolute_path), "rule": exc.validator},
            ) from exc

    def validate_event(self, event: Mapping[str, Any]) -> None:
        try:
            self._event_validator.validate(dict(event))
        except ValidationError as exc:
            raise OWOPError(
                "owop_event_invalid",
                "OWOP Workspace Event is invalid.",
                str(event.get("event_id") or "event"),
                details={"path": list(exc.absolute_path), "rule": exc.validator},
            ) from exc

    async def dispatch(self, request: Mapping[str, Any], handlers: Mapping[str, Handler]) -> dict[str, Any]:
        try:
            self.validate_request(request)
            operation = str(request["operation"])
            handler = handlers.get(operation)
            if handler is None:
                raise OWOPError(
                    "owop_operation_unavailable",
                    f"OWOP operation {operation} is valid but unavailable in this Binding.",
                    str(request["correlation_id"]),
                    details={"operation": operation},
                )
            result = handler(request["params"])
            if hasattr(result, "__await__"):
                result = await result  # type: ignore[assignment]
            if not isinstance(result, Mapping):
                raise OWOPError(
                    "owop_result_invalid",
                    "OWOP handler returned a non-object result.",
                    str(request["correlation_id"]),
                )
            result_validator = self._result_validators.get(operation)
            if result_validator is not None:
                try:
                    result_validator.validate(dict(result))
                except ValidationError as exc:
                    raise OWOPError(
                        "owop_result_invalid",
                        f"Result for {operation} is invalid.",
                        str(request["correlation_id"]),
                        details={"operation": operation, "path": list(exc.absolute_path), "rule": exc.validator},
                    ) from exc
            return {
                "version": self.version,
                "request_id": request["request_id"],
                "correlation_id": request["correlation_id"],
                "ok": True,
                "result": dict(result),
            }
        except OWOPError as exc:
            correlation_id = str(request.get("correlation_id") or exc.correlation_id)
            error = exc.as_dict()
            error["correlation_id"] = correlation_id
            return {
                "version": self.version,
                "request_id": str(request.get("request_id") or "invalid"),
                "correlation_id": correlation_id,
                "ok": False,
                "error": error,
            }


class OWOPEventCursor:
    """Consumes one Workspace journal without reordering or cross-Workspace data."""

    def __init__(self, protocol: OWOPProtocol, workspace_id: str, *, after_sequence: int = 0):
        self.protocol = protocol
        self.workspace_id = workspace_id
        self.sequence = after_sequence
        self._dedupe: set[str] = set()

    def consume(self, event: Mapping[str, Any]) -> bool:
        self.protocol.validate_event(event)
        if event["workspace_id"] != self.workspace_id:
            raise OWOPError(
                "owop_workspace_mismatch",
                "Workspace Event belongs to another Workspace.",
                str(event["event_id"]),
            )
        dedupe_key = str(event["dedupe_key"])
        sequence = int(event["sequence"])
        if dedupe_key in self._dedupe or sequence <= self.sequence:
            return False
        if sequence != self.sequence + 1:
            raise OWOPError(
                "owop_event_gap",
                "Workspace Event sequence contains a gap.",
                str(event["event_id"]),
                retryable=True,
                details={"expected": self.sequence + 1, "received": sequence},
            )
        self.sequence = sequence
        self._dedupe.add(dedupe_key)
        return True
