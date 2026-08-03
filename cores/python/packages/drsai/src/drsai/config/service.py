"""Transactional preview and commit service for model configuration."""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Mapping

from .loader import ConfigError, default_config_path, load_user_config
from .credentials import credential_available, delete_credential, store_credential
from .locking import config_write_lock
from .resolver import resolve_model_config
from .revisions import config_revision
from .schema import DrSaiConfig, ResolvedModelConfig
from .writer import delete_provider, replace_config_text, update_model_selection, upsert_provider
from .feature_flags import ensure_model_config_writes_enabled
from .telemetry import increment_metric


class ConfigConflict(ConfigError):
    """The file changed since the caller read its revision."""


@dataclass(frozen=True)
class ConfigUpdateRequest:
    model: str | None = None
    model_provider: str | None = None
    provider_name: str | None = None
    provider_values: Mapping[str, object] | None = None
    provider_secret: str | None = field(default=None, repr=False)
    delete_provider_name: str | None = None
    delete_provider_credential: bool = True


@dataclass(frozen=True)
class ConfigPreview:
    config: DrSaiConfig
    resolved: ResolvedModelConfig
    base_revision: str
    candidate_text: str = field(repr=False)


@dataclass(frozen=True)
class ConfigCommitResult:
    config: DrSaiConfig
    resolved: ResolvedModelConfig
    previous_revision: str
    revision: str
    warnings: tuple[str, ...] = ()
    changed_fields: tuple[str, ...] = ()
    restart_required: bool = False
    apply_strategy: str = "next_turn_atomic_client_swap"


def last_known_good_path(path: str | Path | None = None) -> Path:
    target = Path(path) if path is not None else default_config_path()
    return target.with_suffix(target.suffix + ".last-good")


def preview_update(
    request: ConfigUpdateRequest,
    *,
    path: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> ConfigPreview:
    target = Path(path) if path is not None else default_config_path()
    try:
        base_revision = config_revision(target)
        preview_request, preview_environ = _prepare_preview_request(
            request, os.environ if environ is None else environ
        )
        candidate_text, config, resolved = _build_candidate(target, preview_request, preview_environ)
        increment_metric("config_preview_succeeded")
        return ConfigPreview(config, resolved, base_revision, candidate_text)
    except Exception:
        increment_metric("config_preview_failed")
        raise


def commit_update(
    request: ConfigUpdateRequest,
    *,
    path: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    expected_revision: str | None = None,
    lock_timeout: float = 10.0,
) -> ConfigCommitResult:
    ensure_model_config_writes_enabled()
    target = Path(path) if path is not None else default_config_path()
    with config_write_lock(target, timeout=lock_timeout):
        previous_revision = config_revision(target)
        if expected_revision is not None and expected_revision != previous_revision:
            increment_metric("config_commit_conflict")
            raise ConfigConflict("Model configuration changed; reload it before saving")
        new_reference = None
        try:
            prepared, new_reference, old_reference, removes_old = _prepare_commit_request(target, request)
            candidate_text, _candidate, _resolved = _build_candidate(
                target, prepared, os.environ if environ is None else environ
            )
            replace_config_text(candidate_text, path=target)
        except Exception:
            increment_metric("config_commit_failed")
            if new_reference:
                delete_credential(new_reference)
            raise
        committed = load_user_config(target)
        resolved = resolve_model_config(
            committed,
            environ=os.environ if environ is None else environ,
            require_credentials=False,
        )
        warnings: list[str] = []
        try:
            snapshot = last_known_good_path(target)
            shutil.copy2(target, snapshot)
            try:
                snapshot.chmod(0o600)
            except OSError:
                pass
        except OSError:
            warnings.append("last_known_good_snapshot_failed")
        if removes_old and old_reference and old_reference != new_reference:
            try:
                if not delete_credential(old_reference):
                    warnings.append("replaced_credential_cleanup_failed")
            except ConfigError:
                warnings.append("replaced_credential_cleanup_failed")
        increment_metric("config_commit_succeeded")
        return ConfigCommitResult(
            committed,
            resolved,
            previous_revision,
            config_revision(target),
            tuple(warnings),
            _changed_fields(request),
        )


def restore_last_known_good(
    *,
    path: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    expected_revision: str | None = None,
    lock_timeout: float = 10.0,
) -> ConfigCommitResult:
    ensure_model_config_writes_enabled()
    target = Path(path) if path is not None else default_config_path()
    snapshot = last_known_good_path(target)
    if not snapshot.is_file():
        increment_metric("config_restore_failed")
        raise ConfigError("No last-known-good model configuration is available")
    try:
        with config_write_lock(target, timeout=lock_timeout):
            previous_revision = config_revision(target)
            if expected_revision is not None and expected_revision != previous_revision:
                increment_metric("config_restore_conflict")
                raise ConfigConflict("Model configuration changed; reload it before restoring")
            config = load_user_config(snapshot)
            active_environ = os.environ if environ is None else environ
            for provider_name in config.providers:
                resolve_model_config(config, environ=active_environ, provider=provider_name, require_credentials=False)
            resolved = resolve_model_config(config, environ=active_environ, require_credentials=False)
            replace_config_text(snapshot.read_text(encoding="utf-8"), path=target)
            committed = load_user_config(target)
            increment_metric("config_restore_succeeded")
            return ConfigCommitResult(
                committed,
                resolved,
                previous_revision,
                config_revision(target),
                changed_fields=("restore_last_known_good",),
            )
    except ConfigConflict:
        raise
    except Exception:
        increment_metric("config_restore_failed")
        raise


def _prepare_preview_request(
    request: ConfigUpdateRequest,
    environ: Mapping[str, str],
) -> tuple[ConfigUpdateRequest, Mapping[str, str]]:
    if request.provider_secret is None:
        return request, environ
    values = dict(request.provider_values or {})
    for key in ("api_key", "api_key_env", "api_key_credential"):
        values.pop(key, None)
    values["api_key_env"] = "DRSAI_CONFIG_PREVIEW_API_KEY"
    preview_environ = dict(environ)
    preview_environ["DRSAI_CONFIG_PREVIEW_API_KEY"] = request.provider_secret
    return replace(request, provider_values=values, provider_secret=None), preview_environ


def _changed_fields(request: ConfigUpdateRequest) -> tuple[str, ...]:
    fields: list[str] = []
    if request.model is not None:
        fields.append("model")
    if request.model_provider is not None:
        fields.append("model_provider")
    if request.provider_name is not None:
        fields.append(f"model_providers.{request.provider_name}")
    if request.delete_provider_name is not None:
        fields.append(f"model_providers.{request.delete_provider_name}")
    if request.provider_secret is not None:
        fields.append("credential")
    return tuple(fields)


def _prepare_commit_request(
    target: Path,
    request: ConfigUpdateRequest,
) -> tuple[ConfigUpdateRequest, str | None, str | None, bool]:
    provider_name = request.provider_name or request.delete_provider_name
    current = load_user_config(target)
    current_provider = current.providers.get(provider_name) if provider_name else None
    old_reference = current_provider.api_key_credential if current_provider else None
    if request.delete_provider_name is not None:
        return request, None, old_reference, request.delete_provider_credential
    if request.provider_name is None:
        return request, None, None, False

    values = dict(request.provider_values or {})
    new_reference = None
    if request.provider_secret is not None:
        for key in ("api_key", "api_key_env", "api_key_credential"):
            values.pop(key, None)
        new_reference = store_credential(request.provider_secret)
        values["api_key_credential"] = new_reference
    supplied_reference = values.get("api_key_credential")
    if isinstance(supplied_reference, str) and supplied_reference != new_reference:
        if not credential_available(supplied_reference):
            raise ConfigError("Model Provider credential is unavailable or corrupted")
    replaces_old = (
        request.provider_secret is not None
        or any(key in values for key in ("api_key", "api_key_env", "api_key_credential"))
        or values.get("requires_api_key") is False
    )
    return replace(request, provider_values=values, provider_secret=None), new_reference, old_reference, replaces_old


def _build_candidate(
    target: Path,
    request: ConfigUpdateRequest,
    environ: Mapping[str, str],
) -> tuple[str, DrSaiConfig, ResolvedModelConfig]:
    with tempfile.TemporaryDirectory(prefix="drsai-config-preview-") as directory:
        candidate_path = Path(directory) / "config.toml"
        if target.exists():
            shutil.copy2(target, candidate_path)
        if request.provider_name is not None:
            if request.provider_values is None:
                raise ConfigError("provider_values are required with provider_name")
            upsert_provider(request.provider_name, request.provider_values, path=candidate_path)
        if request.delete_provider_name is not None:
            if not delete_provider(request.delete_provider_name, path=candidate_path):
                raise ConfigError(f"provider '{request.delete_provider_name}' not found")
        if request.model is not None or request.model_provider is not None:
            current = load_user_config(candidate_path)
            model = request.model or current.model
            provider = request.model_provider or current.model_provider or "hepai"
            if not model:
                raise ConfigError("model is required")
            update_model_selection(model=model, model_provider=provider, path=candidate_path)
        config = load_user_config(candidate_path)
        for provider_name in config.providers:
            resolve_model_config(
                config,
                environ=environ,
                provider=provider_name,
                require_credentials=False,
            )
        resolved = resolve_model_config(
            config,
            environ=environ,
            require_credentials=False,
        )
        return candidate_path.read_text(encoding="utf-8"), config, resolved
