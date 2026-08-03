"""Unified user model-provider configuration for OpenDrSai."""

from .loader import ConfigError, load_user_config
from .connectivity import test_provider_connection
from .credentials import credential_available, delete_credential, resolve_credential, store_credential
from .credential_lifecycle import cleanup_orphaned_credentials, scan_orphaned_credentials
from .provider_registry import builtin_provider_names
from .probe import ProviderDraft, probe_provider_draft
from .provider_presets import get_provider_preset, list_provider_presets
from .model_discovery import clear_model_discovery_cache, discover_provider_models
from .probe_history import clear_probe_history, latest_probe_result
from .telemetry import clear_telemetry, telemetry_snapshot
from .doctor import diagnose_model_config
from .guidance import guidance_for
from .revisions import config_revision
from .service import (
    ConfigCommitResult,
    ConfigConflict,
    ConfigPreview,
    ConfigUpdateRequest,
    commit_update,
    preview_update,
    restore_last_known_good,
    last_known_good_path,
)
from .migration import MigrationResult, migrate_legacy_model_config
from .resolver import resolve_model_config
from .writer import delete_provider, update_model_selection, upsert_provider
from .schema import (
    DrSaiConfig,
    ModelCapabilities,
    ProviderConfig,
    ReasoningCapabilities,
    ResolvedModelConfig,
    SecretValue,
)

__all__ = [
    "ConfigError",
    "DrSaiConfig",
    "ModelCapabilities",
    "MigrationResult",
    "ProviderConfig",
    "ReasoningCapabilities",
    "ResolvedModelConfig",
    "SecretValue",
    "load_user_config",
    "migrate_legacy_model_config",
    "resolve_model_config",
    "delete_provider",
    "update_model_selection",
    "upsert_provider",
    "test_provider_connection",
    "store_credential",
    "resolve_credential",
    "delete_credential",
    "credential_available",
    "builtin_provider_names",
    "config_revision",
    "ConfigCommitResult",
    "ConfigConflict",
    "ConfigPreview",
    "ConfigUpdateRequest",
    "commit_update",
    "preview_update",
    "ProviderDraft",
    "probe_provider_draft",
    "diagnose_model_config",
    "guidance_for",
    "restore_last_known_good",
    "last_known_good_path",
    "get_provider_preset",
    "list_provider_presets",
    "discover_provider_models",
    "clear_model_discovery_cache",
    "scan_orphaned_credentials",
    "cleanup_orphaned_credentials",
    "latest_probe_result",
    "clear_probe_history",
    "telemetry_snapshot",
    "clear_telemetry",
]
