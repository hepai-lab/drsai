"""Keep AutoGen's token-estimator schema chatter out of ``logs/gateway.log``.

``autogen_ext.models.openai._openai_client.count_tokens_openai`` walks every
tool property and prices exactly three keys -- ``type``, ``description`` and
``enum``; every other key hits::

    trace_logger.warning(f"Not supported field {field}")   # _openai_client.py:364

The schema it walks is the tool's JSON Schema, and Pydantic's
``model_json_schema()`` emits ``title`` for every property, ``anyOf`` for every
``Optional[...]``, ``default`` for every defaulted field and ``items`` for every
list, none of which the estimator prices.  So one ``count_tokens()`` call over
the Agent's tool set emits ~90 lines, and ``count_tokens`` runs at least once
per turn (``DrSaiModelContext.count_prompt_tokens``) plus once per compression
pass -- enough that a real ``~/.drsai-prod/logs/gateway.log`` reached 5430 such
lines out of 6151 (88%).

They look like raw output because drsai logs through loguru and never installs
a handler on the stdlib root logger: the records propagate from
``autogen_core.trace`` to ``logging.lastResort`` -- a bare ``_StderrHandler`` at
``WARNING`` whose formatter is ``None`` -- and reach the Gateway log through
``sys.stderr`` (piped by the Desktop shell, or redirected by
``drsai.backend.runtime_logging``) without a timestamp or level prefix.

Dropping them hides no failure: ``convert_tools`` passes the schema through
unchanged, so the warning only reports that the *estimate* cannot price a key.
The filter is installed at import time of
:mod:`drsai.modules.components.model_client` -- the same import-time pattern as
:func:`drsai.backend.desktop_gateway.app.suppress_health_access_logging` -- and
it applies at the *logger*, before propagation, which is what also protects
``logging.lastResort`` (and covers Ollama's client, whose estimator warns on the
same logger name).

Only ``Not supported field`` records are dropped: the neighbouring ``Model ...
not found. Using cl100k_base encoding.`` warning is kept, because it reports
that the estimate fell back to a different encoding and is worth seeing.  Set
``OPENDRSAI_TOKEN_ESTIMATOR_LOG=1`` to keep the warnings while debugging.
"""

from __future__ import annotations

import logging
import os

from autogen_core import TRACE_LOGGER_NAME

#: Escape hatch: a truthy value keeps the estimator warnings visible.
_TOKEN_ESTIMATOR_LOG_ENV = "OPENDRSAI_TOKEN_ESTIMATOR_LOG"

#: Prefix of the message AutoGen emits for a tool-schema key it cannot price.
_UNPRICED_FIELD_PREFIX = "Not supported field "

_TRUTHY_VALUES = frozenset({"1", "true", "yes", "on"})


class _DropTokenEstimatorSchemaWarnings(logging.Filter):
    """Drop the token estimator's per-tool-schema-field warnings."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            # Rendering a record is the emitter's business; a logging filter
            # must never turn an unrelated log call into a new failure.
            return True
        return not message.startswith(_UNPRICED_FIELD_PREFIX)


def suppress_token_estimator_schema_warnings() -> None:
    """Silence the estimator's unpriceable-field warnings (idempotent).

    A logger-level filter is consulted by ``Logger.handle`` *before*
    ``callHandlers``, so it also stops the record from reaching
    ``logging.lastResort`` when no handler is installed -- which is exactly how
    these lines used to reach the Gateway log.
    """

    if os.environ.get(_TOKEN_ESTIMATOR_LOG_ENV, "").strip().lower() in _TRUTHY_VALUES:
        return
    trace_logger = logging.getLogger(TRACE_LOGGER_NAME)
    if any(isinstance(installed, _DropTokenEstimatorSchemaWarnings) for installed in trace_logger.filters):
        return
    trace_logger.addFilter(_DropTokenEstimatorSchemaWarnings())
