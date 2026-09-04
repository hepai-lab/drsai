"""Settings persistence: one row per user_id."""

from __future__ import annotations

import os
import re
from typing import Any, Sequence

from ..datamodel import Settings

_API_KEY_RE = re.compile(r'api_key:\s*["\']?([A-Za-z0-9_\-\.]+)["\']?')


def extract_model_api_key(model_configs: str | None) -> str | None:
    if not model_configs:
        return None
    match = _API_KEY_RE.search(model_configs)
    return match.group(1) if match else None


def replace_model_api_key(model_configs: str, old_key: str, new_key: str) -> str:
    if not old_key or old_key == new_key:
        return model_configs
    return model_configs.replace(old_key, new_key)


def stored_key_is_shared_env_key(model_configs: str | None) -> bool:
    stored = extract_model_api_key(model_configs)
    shared = (os.getenv("HEPAI_API_KEY") or "").strip()
    return bool(stored and shared and stored == shared)


def upsert_settings_by_user_id(db: Any, settings: Settings) -> Any:
    """Create or update Settings keyed by user_id, collapsing duplicate rows.

    DatabaseManager.upsert matches on primary key ``id``. The frontend PUT
    body typically omits ``id``, which used to insert a new row on every save.
    """
    user_id = (settings.user_id or "").strip()
    if not user_id:
        return db.upsert(settings)

    response = db.get(Settings, filters={"user_id": user_id})
    rows: Sequence[Any] = response.data if response.status and response.data else []
    if not rows:
        return db.upsert(settings)

    incoming_id = getattr(settings, "id", None)
    keeper = next((row for row in rows if incoming_id and row.id == incoming_id), rows[0])
    settings.id = keeper.id
    settings.uuid = keeper.uuid
    settings.created_at = keeper.created_at
    result = db.upsert(settings)
    extra_ids = [row.id for row in rows if row.id is not None and row.id != keeper.id]
    for extra_id in extra_ids:
        db.delete(Settings, filters={"id": extra_id})
    return result
