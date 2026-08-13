"""Runtime capability preflight and recoverable configuration contracts."""

from .configuration import (
    CapabilityConfigurationRequest,
    classify_web_search_configuration,
    prompt_requires_current_web,
)

__all__ = [
    "CapabilityConfigurationRequest",
    "classify_web_search_configuration",
    "prompt_requires_current_web",
]
