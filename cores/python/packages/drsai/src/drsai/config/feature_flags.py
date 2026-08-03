"""Operational safety switches for model configuration writes."""

from __future__ import annotations

import os

from .loader import ConfigError
from .telemetry import increment_metric


def ensure_model_config_writes_enabled() -> None:
    value = os.environ.get("DRSAI_MODEL_CONFIG_WRITES", "transactional").strip().lower()
    if value not in {"transactional", "enabled", "1", "true"}:
        increment_metric("config_write_disabled")
        raise ConfigError(
            "Model configuration writes are disabled by DRSAI_MODEL_CONFIG_WRITES; "
            "the current configuration remains active"
        )
