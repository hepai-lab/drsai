"""The Desktop Runtime must not spend its access log on the ``/health`` probe.

The Desktop shell polls ``GET /health`` for the whole session (initially every
750ms, then every 2s) to observe Runtime readiness.  Under uvicorn's default
access log that single unauthenticated route produced the large majority of
``logs/gateway.log`` -- measured at ~83% of the access lines in a real
``~/.drsai-prod/logs/gateway.log``.

Silencing it costs nothing, and these tests pin *why*:

* uvicorn runs ``lifespan.startup()`` **before** creating the listening socket
  (``uvicorn/server.py``: ``startup()`` awaits the lifespan, then calls
  ``create_server()``), so while the Runtime is still starting no ``/health``
  request can be served and no access line can exist.  Every line the filter
  removes was written *after* the Gateway was already answering, and readiness
  is reported to the renderer by the probe's own response, never by this log.
* uvicorn's access call is
  ``access_logger.info('%s - "%s %s HTTP/%s" %d', client_addr, method,
  full_path, http_version, status_code)``, so the path is argument 3.
* a logger-level filter survives uvicorn's own ``logging.config.dictConfig``
  (it reinstalls handlers only), which is what makes the import-time install in
  ``app.py`` hold once the server configures logging.

The end-to-end test below runs a real uvicorn server and asserts on the real
access lines, so a change in uvicorn's argument order or in the filter wiring
fails here instead of silently re-flooding the log.

Everything here binds to loopback and only exits on demand.
"""

from __future__ import annotations

import asyncio
import logging
import logging.config
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import drsai
from drsai.backend.desktop_gateway.app import (
    _ACCESS_LOG_HEALTH_ENV,
    _ACCESS_LOG_PATH_ARG_INDEX,
    _SuppressHealthAccessLog,
    suppress_health_access_logging,
)

ACCESS_LOGGER_NAME = "uvicorn.access"

#: Uvicorn's access format, verbatim.
ACCESS_FORMAT = '%s - "%s %s HTTP/%s" %d'


def access_record(path: str, status: int = 200) -> logging.LogRecord:
    """Build the record uvicorn's HTTP protocols emit for one request."""

    return logging.LogRecord(
        name=ACCESS_LOGGER_NAME,
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg=ACCESS_FORMAT,
        args=("127.0.0.1:12345", "GET", path, "1.1", status),
        exc_info=None,
    )


@pytest.fixture(autouse=True)
def restore_access_logger():
    """Keep ``uvicorn.access`` global for the rest of the session."""

    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    filters = list(logger.filters)
    handlers = list(logger.handlers)
    level = logger.level
    yield
    logger.filters[:] = filters
    logger.handlers[:] = handlers
    logger.setLevel(level)


def installed_filters() -> list[logging.Filter]:
    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    return [f for f in logger.filters if isinstance(f, _SuppressHealthAccessLog)]


def drop_installed_filters() -> None:
    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    logger.filters[:] = [
        f for f in logger.filters if not isinstance(f, _SuppressHealthAccessLog)
    ]


# --------------------------------------------------------------------------- #
# filter semantics
# --------------------------------------------------------------------------- #


def test_health_probe_is_dropped():
    access_filter = _SuppressHealthAccessLog()
    assert access_filter.filter(access_record("/health")) is False
    # Unauthenticated and query-less in practice, but tolerate a query string.
    assert access_filter.filter(access_record("/health?verbose=1")) is False


def test_other_routes_keep_their_access_records():
    access_filter = _SuppressHealthAccessLog()
    for path in (
        "/v1/runtime",
        "/v1/capabilities",
        "/v1/gfs/health",
        "/v1/sessions/abc/agent-backend/history/sync",
        "/healthz",
    ):
        assert access_filter.filter(access_record(path)) is True, path


def test_records_that_are_not_uvicorn_access_lines_pass_through():
    access_filter = _SuppressHealthAccessLog()
    # A dict arg (``logger.info("...", {"a": 1})``) and a too-short tuple must
    # never be mistaken for an access line and dropped.
    for args in (None, {"path": "/health"}, ("127.0.0.1:1", "GET")):
        record = access_record("/health")
        record.args = args
        assert access_filter.filter(record) is True
    # The index the filter reads is the documented one.
    assert _ACCESS_LOG_PATH_ARG_INDEX == 2


# --------------------------------------------------------------------------- #
# installation
# --------------------------------------------------------------------------- #


def test_install_is_idempotent_and_applies_to_health_only():
    drop_installed_filters()

    suppress_health_access_logging()
    suppress_health_access_logging()

    assert len(installed_filters()) == 1
    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    # ``Logger.filter`` returns the record when it passes, hence the truthiness.
    assert logger.filter(access_record("/health")) is False
    assert logger.filter(access_record("/v1/runtime"))


def test_filter_survives_uvicorns_logging_configuration():
    drop_installed_filters()
    suppress_health_access_logging()

    from uvicorn.config import LOGGING_CONFIG

    logging.config.dictConfig(LOGGING_CONFIG)

    assert len(installed_filters()) == 1
    logger = logging.getLogger(ACCESS_LOGGER_NAME)
    assert logger.filter(access_record("/health")) is False
    assert logger.filter(access_record("/v1/runtime"))


def test_escape_hatch_keeps_health_lines(monkeypatch):
    drop_installed_filters()
    monkeypatch.setenv(_ACCESS_LOG_HEALTH_ENV, "1")

    suppress_health_access_logging()

    assert installed_filters() == []


def test_importing_the_app_module_installs_the_filter():
    # ``main()`` is not the only launch path: hot-reload starts uvicorn against
    # ``drsai.backend.desktop_gateway.app:app`` and never calls it, so the
    # install has to happen at import time.  A fresh interpreter proves that,
    # and unlike ``importlib.reload`` it cannot be fooled by the reloaded
    # module redefining ``_SuppressHealthAccessLog`` (a new class object).
    src_root = Path(drsai.__file__).resolve().parents[1]
    script = (
        "import logging, drsai.backend.desktop_gateway.app;"
        "print(sum(1 for f in logging.getLogger('uvicorn.access').filters"
        " if f.__class__.__name__ == '_SuppressHealthAccessLog'))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=180,
        env={**os.environ, "PYTHONPATH": str(src_root)},
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "1", completed.stdout + completed.stderr


# --------------------------------------------------------------------------- #
# end to end: a real uvicorn server, real access lines
# --------------------------------------------------------------------------- #


def free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def fetch(path: str, port: int, timeout: float = 5.0) -> int:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as reply:
        reply.read()
        return int(reply.status)


def wait_until_serving(port: int, deadline_seconds: float = 15.0) -> None:
    deadline = time.monotonic() + deadline_seconds
    while time.monotonic() < deadline:
        try:
            fetch("/v1/runtime", port, timeout=0.5)
            return
        except (urllib.error.URLError, OSError):
            time.sleep(0.05)
    raise AssertionError("uvicorn did not start serving in time")


def test_real_server_logs_every_route_but_health(capsys):
    uvicorn = pytest.importorskip("uvicorn")
    from fastapi import FastAPI

    app = FastAPI()

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/runtime")
    async def runtime() -> dict[str, bool]:
        return {"ok": True}

    suppress_health_access_logging()
    assert len(installed_filters()) == 1

    port = free_loopback_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info", access_log=True)
    server = uvicorn.Server(config)
    # ``serve()`` (unlike ``run()``) does not install a global event-loop policy,
    # and uvicorn skips signal handling off the main thread.
    thread = threading.Thread(target=lambda: asyncio.run(server.serve()), daemon=True)
    thread.start()
    try:
        wait_until_serving(port)
        assert fetch("/health", port) == 200
        assert fetch("/v1/runtime", port) == 200
        time.sleep(0.3)
    finally:
        server.should_exit = True
        thread.join(timeout=15)

    assert not thread.is_alive(), "uvicorn did not shut down"
    captured = capsys.readouterr()

    assert '"GET /health HTTP/1.1" 200' not in captured.out
    assert '"GET /v1/runtime HTTP/1.1" 200' in captured.out
