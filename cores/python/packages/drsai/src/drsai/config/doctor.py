"""Offline diagnostics for the active model configuration."""

from __future__ import annotations

import os
import asyncio
from pathlib import Path
from typing import Mapping

from .credentials import credential_available
from .credential_lifecycle import scan_orphaned_credentials
from .guidance import guidance_for
from .loader import ConfigError, default_config_path, load_user_config
from .resolver import resolve_model_config
from .revisions import config_revision
from .service import last_known_good_path
from .connectivity import test_provider_connection


def diagnose_model_config(
    *,
    path: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    online: bool = False,
) -> dict[str, object]:
    target = Path(path) if path is not None else default_config_path()
    env = os.environ if environ is None else environ
    checks: list[dict[str, object]] = []
    provider_only = not config.model and not config.model_provider
    diagnostic_provider = next(iter(config.providers), None) if provider_only else None
    if provider_only and diagnostic_provider is None:
        checks.append(_check(
            "provider", "warning",
            "No Provider is configured here; models must be selected by an Agent model policy",
        ))
        return _result(target, checks, {"agent_policy_required": True, "diagnostic_provider": None})

    try:
        config = load_user_config(target)
        checks.append(_check("toml", "ok", "Configuration file is valid"))
        checks.append(_check("revision", "ok", f"Content revision is {config_revision(target)[:12]}"))
    except ConfigError as exc:
        checks.append(_check("toml", "error", str(exc), "invalid_config"))
        return _result(target, checks, None)

    try:
        # Validate provider structure independently so a broken secure-store entry
        # can be reported by the dedicated credential check below.
        resolved = resolve_model_config(
            config,
            environ=env,
            provider=diagnostic_provider,
            credential_resolver=lambda _reference: None,
            require_credentials=False,
        )
        checks.append(_check("provider", "ok", f"Provider '{resolved.provider.name}' is valid"))
        checks.append(_check("base_url", "ok", "Base URL is an absolute HTTP(S) endpoint without embedded credentials"))
        checks.append(_check("protocol", "ok", f"Configured protocol is {resolved.provider.wire_api}"))
        checks.append(_check(
            "model_capabilities",
            "ok" if resolved.known_model else "warning",
            "Model capabilities are calibrated" if resolved.known_model else "Model is allowed, but capabilities use generic uncalibrated defaults",
        ))
    except ConfigError as exc:
        checks.append(_check("provider", "error", str(exc), "invalid_config"))
        return _result(target, checks, None)

    provider_input = config.providers.get(resolved.provider.name)
    if resolved.provider.requires_api_key:
        if provider_input and provider_input.api_key_credential:
            available = credential_available(provider_input.api_key_credential)
            checks.append(_check(
                "credential",
                "ok" if available else "error",
                "Stored credential is available" if available else "Stored credential is unavailable or corrupted",
                None if available else "credential_unavailable",
            ))
        elif provider_input and provider_input.api_key_env:
            available = bool(env.get(provider_input.api_key_env))
            checks.append(_check(
                "credential",
                "ok" if available else "error",
                f"Environment variable {provider_input.api_key_env} is set" if available else f"Environment variable {provider_input.api_key_env} is not set",
                None if available else "credential_unavailable",
            ))
        else:
            checks.append(_check(
                "credential",
                "ok" if resolved.provider.has_api_key else "error",
                "API key source is available" if resolved.provider.has_api_key else "API key source is unavailable",
                None if resolved.provider.has_api_key else "credential_unavailable",
            ))
    else:
        checks.append(_check("credential", "ok", "Provider does not require an API key"))
    try:
        orphan_result = scan_orphaned_credentials(path=target)
        orphan_count = int(orphan_result["orphan_count"])
        checks.append(_check(
            "credential_orphans",
            "warning" if orphan_count else "ok",
            f"{orphan_count} unreferenced local credential(s) found" if orphan_count else "No unreferenced local credentials found",
        ))
    except ConfigError as exc:
        checks.append(_check("credential_orphans", "warning", f"Orphan scan skipped: {exc}"))
    legacy_available = any((target.parent / name).is_file() for name in ("config.yaml", "cli_config.json", "llm_mode_config.yaml"))
    checks.append(_check(
        "legacy_config",
        "warning" if legacy_available and not target.is_file() else "ok",
        "Legacy configuration is available for migration" if legacy_available and not target.is_file() else "No migration is required",
    ))
    snapshot = last_known_good_path(target)
    if snapshot.is_file():
        try:
            snapshot_config = load_user_config(snapshot)
            snapshot_provider = next(iter(snapshot_config.providers), None) if not snapshot_config.model and not snapshot_config.model_provider else None
            resolve_model_config(
                snapshot_config, environ=env, provider=snapshot_provider,
                credential_resolver=lambda _reference: None, require_credentials=False,
            )
            checks.append(_check("last_known_good", "ok", "Last-known-good configuration is valid and restorable"))
        except ConfigError as exc:
            checks.append(_check("last_known_good", "error", f"Last-known-good configuration is invalid: {exc}", "invalid_config"))
    else:
        checks.append(_check("last_known_good", "warning", "No last-known-good configuration is available yet"))
    if online:
        try:
            online_resolved = resolve_model_config(
                config, environ=env, provider=diagnostic_provider, require_credentials=True,
            )
            probe = asyncio.run(test_provider_connection(online_resolved, mode="model"))
            checks.append(_check(
                "online_model",
                "ok" if probe.get("ok") else "error",
                "Protocol and selected model are reachable" if probe.get("ok") else f"Online model test failed: {probe.get('error', 'unknown')}",
                None if probe.get("ok") else str(probe.get("error", "connection_failed")),
            ))
        except ConfigError as exc:
            checks.append(_check("online_model", "error", str(exc), "credential_unavailable"))
    effective = (
        {"agent_policy_required": True, "diagnostic_provider": resolved.provider.public_dict()}
        if provider_only else resolved.public_dict()
    )
    return _result(target, checks, effective)


def _check(check_id: str, status: str, message: str, code: str | None = None) -> dict[str, object]:
    result: dict[str, object] = {"id": check_id, "status": status, "message": message}
    if code:
        result["guidance"] = guidance_for(code)
    return result


def _result(target: Path, checks: list[dict[str, object]], effective: object) -> dict[str, object]:
    return {
        "ok": all(item["status"] != "error" for item in checks),
        "path": str(target),
        "revision": config_revision(target),
        "last_known_good_available": last_known_good_path(target).is_file(),
        "checks": checks,
        "effective": effective,
    }
