"""Token accounting must not drown ``logs/gateway.log`` in schema chatter.

AutoGen's OpenAI token estimator (``count_tokens_openai``) prices exactly three
keys per tool property -- ``type``, ``description`` and ``enum`` -- and warns for
every other key, which is precisely the set Pydantic's ``model_json_schema()``
emits by default (``title``, ``default``, ``anyOf``, ``items``).  drsai calls
``count_tokens`` at least once per turn, so one real
``~/.drsai-prod/logs/gateway.log`` reached 5430 such lines out of 6151 (88%) --
written *unformatted*, because drsai installs no stdlib root handler and the
records fell through ``autogen_core.trace`` to ``logging.lastResort``.

These tests pin every piece that makes the fix work, so a change in any of them
fails here instead of silently re-flooding the log:

* the filter drops exactly the estimator's ``Not supported field`` records
  (and nothing else, notably not the useful ``cl100k_base`` fallback warning),
* ``Logger.filter`` is the gate ``Logger.handle`` consults *before*
  ``callHandlers``/``lastResort``, which is why the lever has to be the logger,
* the install is idempotent and honours the ``OPENDRSAI_TOKEN_ESTIMATOR_LOG``
  escape hatch,
* importing ``drsai.modules.components.model_client`` installs it -- the
  Desktop Runtime, CLI, daemon and hot-reloaded uvicorn all reach clients that
  way, and ``main()`` is not the only launch path,
* and a *real* ``count_tokens_openai`` call stops emitting the lines without
  changing the token count, which binds the filter's message prefix to AutoGen's
  current wording.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from pydantic import BaseModel, Field

import drsai
from autogen_core import TRACE_LOGGER_NAME
from autogen_core.models import UserMessage
from autogen_ext.models.openai import _openai_client
from autogen_ext.models.openai._openai_client import count_tokens_openai
from drsai.modules.components.model_client._trace_log_filters import (
    _TOKEN_ESTIMATOR_LOG_ENV,
    _UNPRICED_FIELD_PREFIX,
    _DropTokenEstimatorSchemaWarnings,
    suppress_token_estimator_schema_warnings,
)

#: The estimator must keep warning on this logger for a logger-level filter to work.
ESTIMATOR_LOGGER_NAME = "autogen_core.trace"

#: The keys observed flooding the real Gateway log, one per Pydantic feature.
OBSERVED_UNPRICEABLE_KEYS = ("title", "anyOf", "default", "items")

#: A neighbouring estimator warning that must survive: it reports that the token
#: *estimate* fell back to another encoding, which is worth seeing.
MODEL_FALLBACK_WARNING = "Model hepai/deepseek-v4-flash not found. Using cl100k_base encoding."


class _DemoToolParameters(BaseModel):
    """A parameter model shaped like the Agent's real tools.

    Pydantic emits ``title`` for every property, ``default`` for the defaulted
    field, ``anyOf`` for ``Optional[...]`` and ``items`` for the list.
    """

    path: str = Field(..., description="the file to inspect")
    recursive: bool = False
    patterns: list[str] = Field(default_factory=list)
    limit: int | None = None


def demo_tool() -> dict[str, object]:
    return {
        "name": "demo_tool",
        "description": "demo",
        "parameters": _DemoToolParameters.model_json_schema(),
    }


def demo_messages() -> list[UserMessage]:
    return [UserMessage(content="hi", source="user")]


@pytest.fixture(autouse=True)
def restore_trace_logger() -> Iterator[None]:
    """Keep ``autogen_core.trace`` global for the rest of the session."""

    logger = logging.getLogger(ESTIMATOR_LOGGER_NAME)
    filters = list(logger.filters)
    handlers = list(logger.handlers)
    level = logger.level
    propagate = logger.propagate
    yield
    logger.filters[:] = filters
    logger.handlers[:] = handlers
    logger.setLevel(level)
    logger.propagate = propagate


def installed_filters() -> list[logging.Filter]:
    logger = logging.getLogger(ESTIMATOR_LOGGER_NAME)
    return [f for f in logger.filters if isinstance(f, _DropTokenEstimatorSchemaWarnings)]


def drop_installed_filters() -> None:
    logger = logging.getLogger(ESTIMATOR_LOGGER_NAME)
    logger.filters[:] = [
        f for f in logger.filters if not isinstance(f, _DropTokenEstimatorSchemaWarnings)
    ]


def estimator_record(message: str, *args: object) -> logging.LogRecord:
    """Build the record AutoGen's estimator emits for one schema key."""

    return logging.LogRecord(
        name=ESTIMATOR_LOGGER_NAME,
        level=logging.WARNING,
        pathname=__file__,
        lineno=0,
        msg=message,
        args=args,
        exc_info=None,
    )


@contextmanager
def captured_trace_records() -> Iterator[list[str]]:
    """Collect the messages that survive the trace logger's filters."""

    messages: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            messages.append(record.getMessage())

    logger = logging.getLogger(ESTIMATOR_LOGGER_NAME)
    handler = _Capture(level=logging.NOTSET)
    logger.addHandler(handler)
    previous_level = logger.level
    logger.setLevel(logging.NOTSET)
    try:
        yield messages
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)


# --------------------------------------------------------------------------- #
# filter semantics
# --------------------------------------------------------------------------- #


def test_unpriceable_schema_fields_are_dropped():
    warning_filter = _DropTokenEstimatorSchemaWarnings()
    for key in OBSERVED_UNPRICEABLE_KEYS:
        assert warning_filter.filter(estimator_record(f"{_UNPRICED_FIELD_PREFIX}{key}")) is False, key
    # The prefix is the one AutoGen actually writes (``_openai_client.py:364``).
    assert _UNPRICED_FIELD_PREFIX == "Not supported field "


def test_the_useful_neighbouring_warnings_survive():
    warning_filter = _DropTokenEstimatorSchemaWarnings()
    for message in (
        MODEL_FALLBACK_WARNING,
        "Could not convert {'a': 1} to string, skipping.",
        "Not supported by the provider",  # prefix, not substring -- must pass
        "Not supported field",  # no trailing key: not the estimator's message
        "Something else entirely",
    ):
        assert warning_filter.filter(estimator_record(message)) is True, message


def test_a_record_that_cannot_be_rendered_is_never_dropped():
    # ``record.getMessage()`` raises on a mismatched %-format.  A logging filter
    # must not turn an unrelated log call into a new failure, nor swallow it.
    warning_filter = _DropTokenEstimatorSchemaWarnings()
    assert warning_filter.filter(estimator_record("%d", "not-a-number")) is True


def test_filter_is_consulted_before_handlers_and_last_resort():
    """``Logger.handle`` gates on ``Logger.filter`` before ``callHandlers``.

    That ordering is the whole point: it is what keeps the record away from
    ``logging.lastResort`` -- the bare ``_StderrHandler`` with ``formatter=None``
    that wrote these lines into ``logs/gateway.log`` with no timestamp.
    """

    drop_installed_filters()
    logger = logging.getLogger(ESTIMATOR_LOGGER_NAME)
    with captured_trace_records() as messages:
        logger.warning(f"{_UNPRICED_FIELD_PREFIX}title")
        assert messages == [f"{_UNPRICED_FIELD_PREFIX}title"]

        suppress_token_estimator_schema_warnings()

        # ``Logger.filter`` returns the record when it passes, hence the truthiness.
        assert logger.filter(estimator_record(f"{_UNPRICED_FIELD_PREFIX}title")) is False
        logger.warning(f"{_UNPRICED_FIELD_PREFIX}title")
        logger.warning(MODEL_FALLBACK_WARNING)
        assert messages[1:] == [MODEL_FALLBACK_WARNING]


# --------------------------------------------------------------------------- #
# installation
# --------------------------------------------------------------------------- #


def test_the_filter_targets_the_logger_the_estimator_warns_on():
    # If AutoGen moves the warning to another logger the filter would be inert,
    # so pin the identity rather than the string alone.
    assert TRACE_LOGGER_NAME == ESTIMATOR_LOGGER_NAME
    assert _openai_client.trace_logger is logging.getLogger(ESTIMATOR_LOGGER_NAME)


def test_install_is_idempotent():
    drop_installed_filters()

    suppress_token_estimator_schema_warnings()
    suppress_token_estimator_schema_warnings()

    assert len(installed_filters()) == 1


def test_escape_hatch_keeps_the_estimator_warnings(monkeypatch):
    drop_installed_filters()
    monkeypatch.setenv(_TOKEN_ESTIMATOR_LOG_ENV, "1")

    suppress_token_estimator_schema_warnings()

    assert installed_filters() == []


def test_importing_the_model_client_package_installs_the_filter():
    # A fresh interpreter proves the install happens at import time, on every
    # launch path -- not only when ``__init__`` first runs in this process.
    src_root = Path(drsai.__file__).resolve().parents[1]
    script = (
        "import logging, drsai.modules.components.model_client;"
        "print(sum(1 for f in logging.getLogger('autogen_core.trace').filters"
        " if f.__class__.__name__ == '_DropTokenEstimatorSchemaWarnings'))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ, "PYTHONPATH": str(src_root)},
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "1", completed.stdout + completed.stderr


# --------------------------------------------------------------------------- #
# end to end: a real estimator call
# --------------------------------------------------------------------------- #


def test_a_real_estimator_call_stops_warning_about_unpriceable_fields():
    """Bind the filter's prefix to AutoGen's live wording.

    If AutoGen rewords the warning, or stops reaching the estimator, the first
    half fails; the second half pins that dropping the lines is cosmetic -- the
    token count is identical with and without the filter.
    """

    messages = demo_messages()
    tool = demo_tool()

    drop_installed_filters()
    with captured_trace_records() as emitted:
        unfiltered_tokens = count_tokens_openai(messages, "gpt-4o-2024-11-20", tools=[tool])

    unpriced = [m for m in emitted if m.startswith(_UNPRICED_FIELD_PREFIX)]
    assert unpriced, emitted
    warned_keys = {m.removeprefix(_UNPRICED_FIELD_PREFIX) for m in unpriced}
    assert set(OBSERVED_UNPRICEABLE_KEYS) <= warned_keys, warned_keys

    suppress_token_estimator_schema_warnings()
    with captured_trace_records() as emitted:
        filtered_tokens = count_tokens_openai(messages, "gpt-4o-2024-11-20", tools=[tool])

    assert emitted == []
    assert filtered_tokens == unfiltered_tokens
