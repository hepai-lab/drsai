from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from threading import RLock
from typing import Any, Callable

from .registry import RelayRegistryError


class RequestOutcome(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class RequestRecord:
    subject: str
    operation: str
    idempotency_key: str
    request_id: str
    correlation_id: str
    outcome: RequestOutcome
    result: Any = None
    error_code: str | None = None


class IdempotencyLedger:
    """Records create outcomes so a transport timeout can be queried safely."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._records: dict[tuple[str, str, str], RequestRecord] = {}

    def execute(self, *, subject: str, operation: str, idempotency_key: str, request_id: str,
                correlation_id: str, action: Callable[[], Any]) -> RequestRecord:
        if len(idempotency_key) < 8:
            raise RelayRegistryError("idempotency_key_invalid", "idempotency_key is required")
        key = (subject, operation, idempotency_key)
        with self._lock:
            existing = self._records.get(key)
            if existing:
                return existing
            self._records[key] = RequestRecord(subject, operation, idempotency_key, request_id,
                                               correlation_id, RequestOutcome.PENDING)
        try:
            result = action()
        except TimeoutError:
            record = RequestRecord(subject, operation, idempotency_key, request_id, correlation_id,
                                   RequestOutcome.UNKNOWN)
        except RelayRegistryError as exc:
            record = RequestRecord(subject, operation, idempotency_key, request_id, correlation_id,
                                   RequestOutcome.FAILED, error_code=exc.code)
        else:
            record = RequestRecord(subject, operation, idempotency_key, request_id, correlation_id,
                                   RequestOutcome.SUCCEEDED, result=result)
        with self._lock:
            self._records[key] = record
        return record

    def query(self, subject: str, operation: str, idempotency_key: str) -> RequestRecord | None:
        return self._records.get((subject, operation, idempotency_key))
