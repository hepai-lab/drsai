"""Provider-neutral public web errors."""

from __future__ import annotations


class WebProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, provider: str, retryable: bool = False, status_code: int | None = None, request_id: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.provider = provider
        self.retryable = retryable
        self.status_code = status_code
        self.request_id = request_id


def classify_http_error(status: int) -> tuple[str, bool]:
    if status == 400: return "invalid_request", False
    if status in {401, 403}: return "authentication_failed", False
    if status == 429: return "rate_limited", True
    if status in {432, 433}: return "quota_exhausted", False
    if status >= 500: return "upstream_unavailable", True
    return "upstream_unavailable", status >= 500
