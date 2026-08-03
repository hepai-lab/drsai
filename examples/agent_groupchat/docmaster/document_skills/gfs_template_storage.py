"""GFS-backed storage for per-user DocMaster templates (boto3-direct).

Backs the `mine` branch of `TemplateLibrarySkill` with the user's GFS bucket
under `gfs://<bucket>/模板库/`. Talks directly to GFS via `GfsUserClient`
(the same boto3-based S3 client used by the agent's gfs_* tools), so:

  - Same code path whether the call comes from a DocMaster tool, the
    UI's right-rail 添加 button, or any other caller.
  - No mirror, no jcli subprocess, no per-backend URL routing.
  - Credentials resolved per-user via `GfsProvisioner` from the user's email.

Storage layout in the bucket:

    模板库/
    ├── catalog.yaml                  # template index (id, name, aliases, ...)
    └── <template_id>/
        └── template.docx | .pptx     # the actual template file

Refuses construction if no GFS credential can be resolved for the user, so
the skill catches `LookupError` and falls back to local FS for dev users.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _gfs_log(level: str, step: str, user_id: str = "", **fields) -> None:
    record: dict = {"gfs_step": step}
    if user_id:
        record["user_id"] = user_id
    record.update(fields)
    getattr(logger, level)(json.dumps(record, ensure_ascii=False))

# Folder visible under the user's bucket. Picked by the user — they want
# 模板库 to show up in the 文件空间 tree under that exact label.
TEMPLATE_DIR_NAME = "模板库"
_CATALOG_FILENAME = "catalog.yaml"
_TEMPLATE_BASENAME = "template"


def _make_user_client(email: str):
    """Resolve a `GfsUserClient` for `email` via `GfsProvisioner`. Raises
    `LookupError` so the caller can fall back to local FS storage."""
    if not email:
        raise LookupError("user_id required for GFS template storage")
    try:
        from drsai.modules.managers.gfs import get_user_client
    except Exception as exc:
        raise LookupError(f"GfsProvisioner unavailable: {exc}") from exc
    try:
        return get_user_client(email)
    except Exception as exc:
        # GfsAdminError / NO_CREDENTIAL / NO_BUCKET / network failures —
        # all mean we can't talk to the user's bucket. Fall back to local.
        raise LookupError(f"failed to resolve GFS client for {email}: {exc}") from exc


class GfsTemplateStorage:
    """Per-user GFS storage backend, talking S3 directly via `GfsUserClient`."""

    def __init__(self, user_id: str) -> None:
        self._client = _make_user_client(user_id)
        self._user_id = user_id
        # Cache directory for downloaded template files. Inspect/fill tools
        # need a real on-disk path; we hand them this cache dir and pull
        # files on demand. Keyed by user so two skill instances for two
        # users don't stomp on each other.
        self._cache_dir = Path(tempfile.gettempdir()) / "docmaster_gfs_templates" / _safe_dir(user_id)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    # paths
    # ------------------------------------------------------------------ #

    def _remote_catalog(self) -> str:
        return f"{TEMPLATE_DIR_NAME}/{_CATALOG_FILENAME}"

    def _remote_template(self, template_id: str, suffix: str) -> str:
        return f"{TEMPLATE_DIR_NAME}/{template_id}/{_TEMPLATE_BASENAME}{suffix}"

    def _cache_path(self, file_rel: str) -> Path:
        """Local cache path for a template file (mirrors the `file` field
        from the catalog, e.g. `tpl-abc/template.docx`)."""
        return (self._cache_dir / file_rel).resolve()

    # ------------------------------------------------------------------ #
    # catalog
    # ------------------------------------------------------------------ #

    def load_catalog(self) -> List[Dict[str, Any]]:
        """Read `模板库/catalog.yaml` from GFS. Returns [] if it doesn't exist
        yet (fresh user) or if the body can't be parsed as YAML."""
        if not self._client.exists(self._remote_catalog()):
            return []
        try:
            import yaml
        except ImportError:
            logger.warning("PyYAML not installed; returning empty catalog")
            return []
        try:
            text = self._client.read_text(self._remote_catalog())
            data = yaml.safe_load(text) or {}
        except Exception as exc:
            logger.warning("failed to read GFS catalog for %s: %s", self._user_id, exc)
            return []
        entries = data.get("templates", []) if isinstance(data, dict) else []
        return [e for e in entries if isinstance(e, dict) and e.get("id")]

    def save_catalog(self, entries: List[Dict[str, Any]]) -> None:
        """Serialize entries and write `模板库/catalog.yaml` to GFS."""
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError("PyYAML required to write template catalog") from exc
        text = yaml.safe_dump(
            {"templates": entries},
            allow_unicode=True,
            sort_keys=False,
        )
        _gfs_log("info", "docmaster_catalog_write_start", self._user_id,
                 remote=self._remote_catalog(), count=len(entries))
        try:
            self._client.write_text(self._remote_catalog(), text)
            _gfs_log("info", "docmaster_catalog_write_success", self._user_id,
                     remote=self._remote_catalog(), count=len(entries))
        except Exception as exc:
            _gfs_log("error", "docmaster_catalog_write_failed", self._user_id,
                     remote=self._remote_catalog(), error=str(exc))
            raise

    # ------------------------------------------------------------------ #
    # template files
    # ------------------------------------------------------------------ #

    def import_template(self, template_id: str, src_path: str, suffix: str) -> Path:
        """Upload the template file to GFS at `模板库/<id>/template<suffix>`.
        Also caches a local copy so inspect/fill tools have a real path
        immediately, without an extra round-trip."""
        remote = self._remote_template(template_id, suffix)
        _gfs_log("info", "docmaster_template_upload_start", self._user_id,
                 template_id=template_id, file=Path(src_path).name, remote=remote)
        try:
            self._client.upload_file(src_path, remote)
            _gfs_log("info", "docmaster_template_upload_success", self._user_id,
                     template_id=template_id, remote=remote, bucket=self._client.bucket)
        except Exception as exc:
            _gfs_log("error", "docmaster_template_upload_failed", self._user_id,
                     template_id=template_id, remote=remote, bucket=self._client.bucket,
                     error=str(exc))
            raise
        # Mirror into cache so resolve_template_path is a no-op the first time.
        cache = self._cache_path(f"{template_id}/{_TEMPLATE_BASENAME}{suffix}")
        cache.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copyfile(src_path, cache)
        except Exception as exc:
            logger.warning("failed to seed template cache at %s: %s", cache, exc)
        return cache

    def resolve_template_path(self, file_rel: str) -> Path:
        """Return a local file path for the template. Downloads from GFS
        on cache miss. `file_rel` is the catalog's `file` field, e.g.
        `tpl-abc/template.docx`."""
        cache = self._cache_path(file_rel)
        if cache.exists() and cache.stat().st_size > 0:
            return cache
        remote = f"{TEMPLATE_DIR_NAME}/{file_rel}"
        _gfs_log("info", "docmaster_template_download_start", self._user_id,
                 remote=remote, cache=str(cache))
        try:
            self._client.download_file(remote, str(cache))
            _gfs_log("info", "docmaster_template_download_success", self._user_id,
                     remote=remote)
        except Exception as exc:
            _gfs_log("warning", "docmaster_template_download_failed", self._user_id,
                     remote=remote, error=str(exc))
        return cache

    def remove_template(self, template_id: str) -> None:
        """Delete every object under `模板库/<id>/` from GFS, plus the
        local cache copy. Recursive list + delete_many handles arbitrary
        sidecar files (e.g. previews, filled outputs)."""
        prefix = f"{TEMPLATE_DIR_NAME}/{template_id}/"
        try:
            objs = self._client.list_dir(prefix, recursive=True)
            paths = [o.path for o in objs if not o.is_dir]
            if paths:
                _gfs_log("info", "docmaster_template_delete_start", self._user_id,
                         template_id=template_id, count=len(paths))
                self._client.delete_many(paths)
                _gfs_log("info", "docmaster_template_delete_success", self._user_id,
                         template_id=template_id, count=len(paths))
        except Exception as exc:
            _gfs_log("error", "docmaster_template_delete_failed", self._user_id,
                     template_id=template_id, error=str(exc))
        # Local cache cleanup — best-effort.
        cache_dir = self._cache_dir / template_id
        if cache_dir.exists():
            shutil.rmtree(cache_dir, ignore_errors=True)


def _safe_dir(name: str) -> str:
    """Filesystem-safe form of an email or username for use as a dir
    component. Replaces '@' and '/' with '_'. Empty fallback to 'anon'."""
    cleaned = name.replace("/", "_").replace(os.sep, "_")
    return cleaned or "anon"
