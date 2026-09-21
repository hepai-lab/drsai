"""One place that turns Runtime exceptions into HTTP responses.

Every route funnels through :func:`http_errors` so the renderer sees one
error shape.  The mapping is small because the Runtime already speaks in codes:

- ``KeyError``            -> 404, the Session/Run/Workspace does not exist
- ``ValueError``          -> 400, the request is malformed or out of order
- ``SessionCursorExpired``-> 409, the client's resume cursor fell out of the
  retained window; it must re-snapshot instead of replaying
- ``RuntimeExecutionError`` -> 401/403/409, carrying its own code and
  ``retryable`` flag

409 for an expired cursor is not cosmetic. A client resuming from
``after_sequence`` cannot distinguish "no new events" from "the events you
missed are gone", and silently returning an empty list would render a
conversation with a hole in it.
"""

from __future__ import annotations

from contextlib import contextmanager

from fastapi import HTTPException

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.journal import SessionCursorExpired

_UNAUTHORIZED = frozenset({"token_expired", "model_unauthorized", "credential_unavailable"})


def cursor_expired(exc: SessionCursorExpired) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "cursor_expired",
            "message": str(exc),
            "retryable": False,
            "details": exc.details,
        },
    )


def execution_error(exc: RuntimeExecutionError) -> HTTPException:
    status = (
        401 if exc.code in _UNAUTHORIZED
        else 403 if exc.code == "permission_denied"
        else 409
    )
    return HTTPException(status_code=status, detail=exc.as_dict())


@contextmanager
def http_errors(*, not_found: str = "", invalid: int = 400):
    """Translate Runtime exceptions raised inside the block into HTTP errors."""
    try:
        yield
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=not_found or str(exc)) from exc
    except SessionCursorExpired as exc:
        raise cursor_expired(exc) from exc
    except RuntimeExecutionError as exc:
        raise execution_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=invalid, detail=str(exc)) from exc
