"""Stable content revisions for optimistic model configuration updates."""

from __future__ import annotations

import hashlib
import tomllib
from pathlib import Path
from typing import Mapping

from .loader import default_config_path


def config_revision(path: str | Path | None = None) -> str:
    target = Path(path) if path is not None else default_config_path()
    try:
        content = target.read_bytes()
    except FileNotFoundError:
        content = b""
    digest = hashlib.sha256()
    digest.update(b"config.toml\0")
    digest.update(content)
    try:
        document = tomllib.loads(content.decode("utf-8")) if content else {}
    except (UnicodeDecodeError, tomllib.TOMLDecodeError):
        document = {}
    providers = document.get("model_providers") if isinstance(document, Mapping) else None
    # Both halves of a split Provider catalog participate in the revision, so a
    # user editing their own model file invalidates front-end caches exactly
    # like editing config.toml does.
    referenced: dict[str, str] = {}
    if isinstance(providers, Mapping):
        for value in providers.values():
            if not isinstance(value, Mapping):
                continue
            for field in ("models_file", "user_models_file"):
                referenced_path = value.get(field)
                if isinstance(referenced_path, str) and referenced_path.strip():
                    referenced.setdefault(referenced_path.strip(), field)
    root = target.resolve().parent
    for relative_text in sorted(referenced):
        relative = Path(relative_text)
        if relative.is_absolute():
            continue
        model_path = (root / relative).resolve()
        try:
            model_path.relative_to(root)
            model_content = model_path.read_bytes()
        except (ValueError, OSError):
            model_content = b""
        digest.update(b"\0" + referenced[relative_text].encode("utf-8") + b"\0")
        digest.update(relative_text.encode("utf-8"))
        digest.update(b"\0")
        digest.update(model_content)
    return digest.hexdigest()
