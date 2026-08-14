"""Stage one local Provider for a disposable P3 Sandbox without logging its key."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from drsai.config.loader import load_user_config
from drsai.config.resolver import resolve_model_config


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-profile", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--provider", default="zhizengzeng")
    parser.add_argument("--api-key-file")
    args = parser.parse_args()

    source = Path(args.source_profile).resolve()
    destination = Path(args.destination).resolve()
    if not (source / "config.toml").is_file():
        raise SystemExit("source profile has no config.toml")
    if destination.exists():
        raise SystemExit("destination must not already exist")

    os.environ["DRSAI_HOME"] = str(source)
    config = load_user_config()
    provider = config.providers.get(args.provider)
    if provider is None:
        raise SystemExit(f"provider is not configured: {args.provider}")
    selected_model = config.model if config.model_provider == args.provider else (provider.models[0] if provider.models else None)
    if not selected_model:
        raise SystemExit(f"provider has no selectable model: {args.provider}")
    resolved = resolve_model_config(config, provider=args.provider, model=selected_model, require_credentials=False)
    secret = None
    if args.api_key_file:
        # This is intentionally a one-shot P3 handoff: the source file is
        # never printed, added to evidence, or retained in the output report.
        secret = Path(args.api_key_file).read_text(encoding="utf-8").strip()
    elif resolved.provider.api_key:
        secret = resolved.provider.api_key.reveal()
    if not secret:
        raise SystemExit(f"provider credential is unavailable: {args.provider}")

    destination.mkdir(parents=True)
    models_source = source / "configs" / "models"
    if models_source.is_dir():
        shutil.copytree(models_source, destination / "configs" / "models")

    lines = [
        f"model = {toml_string(selected_model)}",
        f"model_provider = {toml_string(args.provider)}",
        "",
        f"[model_providers.{args.provider}]",
        f"base_url = {toml_string(resolved.provider.base_url)}",
        f"wire_api = {toml_string(resolved.provider.wire_api)}",
        f"requires_api_key = {'true' if resolved.provider.requires_api_key else 'false'}",
        f"api_key = {toml_string(secret)}",
    ]
    if provider.anthropic_base_url:
        lines.append(f"anthropic_base_url = {toml_string(provider.anthropic_base_url)}")
    if provider.google_base_url:
        lines.append(f"google_base_url = {toml_string(provider.google_base_url)}")
    if provider.models_file:
        lines.append(f"models_file = {toml_string(provider.models_file)}")
    elif provider.models:
        lines.append("models = [" + ", ".join(toml_string(model) for model in provider.models) + "]")
    (destination / "config.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # stdout is deliberately public metadata only; the API key never leaves
    # this process except inside the temporary staging directory.
    print(json.dumps({
        "provider": args.provider,
        "model_count": len(resolved.provider.models),
        "models": list(resolved.provider.models),
        "credential_staged": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
