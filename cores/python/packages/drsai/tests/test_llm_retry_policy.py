import asyncio

from drsai.modules.agents.skills_agent.drsai_assistant import is_retryable_llm_error


class HttpError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


def test_auth_and_request_errors_are_not_retried() -> None:
    for status in (400, 401, 403, 404, 422):
        assert not is_retryable_llm_error(HttpError(status))


def test_transient_http_errors_are_retried() -> None:
    for status in (408, 409, 429, 500, 502, 503, 504):
        assert is_retryable_llm_error(HttpError(status))


def test_timeout_and_connection_errors_are_retried() -> None:
    assert is_retryable_llm_error(asyncio.TimeoutError())
    assert is_retryable_llm_error(ConnectionError())


def test_unknown_programming_errors_are_not_retried() -> None:
    assert not is_retryable_llm_error(ValueError("invalid local configuration"))
