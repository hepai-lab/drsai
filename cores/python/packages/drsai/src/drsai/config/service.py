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
from .resolver import resolve_model_config, resolve_model_ref
from .revisions import config_revision
from .schema import DrSaiConfig, ResolvedModelConfig
from .writer import delete_provider, replace_config_text, replace_models_file_text, update_model_selection, upsert_provider
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


@dataclass(frozen=True)
class ConfigSnapshot:
    """One immutable config/revision pair captured under the writer lock."""

    config: DrSaiConfig
    revision: str


def load_config_snapshot(
    *,
    path: str | Path | None = None,
    lock_timeout: float = 10.0,
) -> ConfigSnapshot:
    """Load a config and its digest without mixing two concurrent revisions."""

    target = Path(path) if path is not None else default_config_path()
    with config_write_lock(target, timeout=lock_timeout):
        revision_before = config_revision(target)
        config = load_user_config(target)
        revision_after = config_revision(target)
        if revision_before != revision_after:
            raise ConfigConflict("Model configuration changed while the Run snapshot was being captured")
        return ConfigSnapshot(config=config, revision=revision_after)


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
        candidate_text, config, resolved, _candidate_model_files = _build_candidate(target, preview_request, preview_environ)
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
        model_file_backups: list[tuple[Path, bytes | None]] = []
        try:
            prepared, new_reference, old_reference, removes_old = _prepare_commit_request(target, request)
            candidate_text, _candidate, candidate_resolved, candidate_model_files = _build_candidate(
                target, prepared, os.environ if environ is None else environ
            )
            for provider_name, models_file, text in candidate_model_files:
                model_path = _models_file_path(target, models_file)
                model_file_backups.append((model_path, model_path.read_bytes() if model_path.is_file() else None))
                replace_models_file_text(models_file, text, path=target, provider_name=provider_name)
            replace_config_text(candidate_text, path=target)
        except Exception:
            for model_path, previous in reversed(model_file_backups):
                try:
                    if previous is None:
                        model_path.unlink(missing_ok=True)
                    else:
                        model_path.parent.mkdir(parents=True, exist_ok=True)
                        model_path.write_bytes(previous)
                except OSError:
                    pass
            increment_metric("config_commit_failed")
            if new_reference:
                delete_credential(new_reference)
            raise
        committed = load_user_config(target)
        resolved = candidate_resolved
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
) -> tuple[str, DrSaiConfig, ResolvedModelConfig, tuple[tuple[str, str, str], ...]]:
    if request.model is not None or request.model_provider is not None:
        raise ConfigError(
            "Global model selection has been removed; update the selected Agent model policy instead"
        )
    with tempfile.TemporaryDirectory(prefix="drsai-config-preview-") as directory:
        candidate_path = Path(directory) / "config.toml"
        if target.exists():
            shutil.copy2(target, candidate_path)
        source_models_dir = target.parent / "configs" / "models"
        if source_models_dir.is_dir():
            shutil.copytree(source_models_dir, candidate_path.parent / "configs" / "models", dirs_exist_ok=True)
        if request.provider_name is not None:
            if request.provider_values is None:
                raise ConfigError("provider_values are required with provider_name")
            upsert_provider(request.provider_name, request.provider_values, path=candidate_path)
            # Compatibility-only normalization for configurations that still
            # contain the retired top-level selection. New configurations and
            # Runtime admission never consult these fields.
            if request.model is None and request.model_provider is None:
                candidate_after_provider = load_user_config(candidate_path)
                if candidate_after_provider.model_provider == request.provider_name:
                    active_provider = candidate_after_provider.providers.get(request.provider_name)
                    active_model = candidate_after_provider.model
                    enabled_models = _enabled_provider_models(active_provider)
                    has_explicit_catalog = bool(
                        active_provider is not None
                        and (active_provider.models_file or active_provider.models or active_provider.model_configs)
                    )
                    if has_explicit_catalog and active_model not in enabled_models:
                        fallback_provider = request.provider_name
                        if not enabled_models:
                            alternative = next((
                                (provider_name, provider_models[0])
                                for provider_name, provider_input in candidate_after_provider.providers.items()
                                if provider_name != request.provider_name
                                for provider_models in (_enabled_provider_models(provider_input),)
                                if provider_models
                            ), None)
                            if alternative is None:
                                raise ConfigError("At least one configured model must remain enabled")
                            fallback_provider, fallback_model = alternative
                        else:
                            fallback_model = enabled_models[0]
                        update_model_selection(
                            model=fallback_model,
                            model_provider=fallback_provider,
                            path=candidate_path,
                        )
        if request.delete_provider_name is not None:
            if not delete_provider(request.delete_provider_name, path=candidate_path):
                raise ConfigError(f"provider '{request.delete_provider_name}' not found")
        config = load_user_config(candidate_path)
        for provider_name, provider_input in config.providers.items():
            enabled_models = _enabled_provider_models(provider_input)
            if enabled_models:
                for model_id in enabled_models:
                    resolve_model_ref(
                        config,
                        provider_id=provider_name,
                        model_id=model_id,
                        environ=environ,
                        require_credentials=False,
                    )
            else:
                resolve_model_config(
                    config,
                    environ=environ,
                    provider=provider_name,
                    model="__provider_configuration_validation__",
                    require_credentials=False,
                )
        representative = next((
            (provider_name, models[0])
            for provider_name, provider_input in config.providers.items()
            for models in (_enabled_provider_models(provider_input),)
            if models
        ), None)
        if request.provider_name is not None:
            requested_models = _enabled_provider_models(config.providers.get(request.provider_name))
            if requested_models:
                representative = (request.provider_name, requested_models[0])
        if representative is None:
            resolved = resolve_model_config(
                config,
                environ=environ,
                require_credentials=False,
            )
        else:
            resolved = resolve_model_ref(
                config,
                provider_id=representative[0],
                model_id=representative[1],
                environ=environ,
                require_credentials=False,
            )
        changed_provider = config.providers.get(request.provider_name) if request.provider_name else None
        candidate_model_files = (
            ((request.provider_name, changed_provider.models_file, (candidate_path.parent / changed_provider.models_file).read_text(encoding="utf-8")),)
            if request.provider_name is not None and changed_provider is not None and changed_provider.models_file is not None
            else ()
        )
        return candidate_path.read_text(encoding="utf-8"), config, resolved, candidate_model_files


def _models_file_path(config_path: Path, models_file: str) -> Path:
    root = config_path.resolve().parent
    target = (root / Path(models_file)).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ConfigError("models_file must stay inside the config directory") from exc
    return target


def _enabled_provider_models(provider: object) -> tuple[str, ...]:
    if provider is None:
        return ()
    models = tuple(getattr(provider, "models", ()))
    configs = getattr(provider, "model_configs", {})
    return tuple(
        model_id for model_id in models
        if getattr(configs.get(model_id), "enabled", True)
    )
