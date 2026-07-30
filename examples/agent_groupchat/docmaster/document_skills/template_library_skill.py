"""
Template Library Skill for DocMaster.

A filesystem-backed catalog of reusable `.docx` templates, with a shared
admin-curated library and per-user libraries. Lets DocMaster answer
"用 3-1 技术开发合同模板" / "我有哪些模板" without asking the user to re-upload.

The target users work primarily in Chinese, so names, descriptions, categories,
tags, and aliases are expected to contain CJK characters; resolution is
substring-based and case-insensitive on ASCII components.

## Storage layout

Root: `<workspace>/templates/` (override via env var `DOCMASTER_TEMPLATE_DIR`).

    templates/
    ├── shared/
    │   ├── catalog.yaml
    │   └── <template_id>/
    │       └── template.docx
    └── users/
        └── <user_email>/
            ├── catalog.yaml
            └── <template_id>/
                └── template.docx

## catalog.yaml schema

    templates:
      - id: tech-dev-3-1
        name: 技术开发合同（3-1）
        description: 科技部印制的技术开发委托合同模板
        category: 合同/技术开发
        tags: [合同, 技术开发, 科技部]
        aliases: ["3-1", "3-1技术开发", "技术开发合同"]
        file: tech-dev-3-1/template.docx       # relative to catalog.yaml's dir
        owner: shared                           # "shared" or "<user_email>"
        added_at: 2026-05-15

## Seeding the shared library

Phase 1 has no auto-importer. To seed the shared library:

1. Pick an `id` (filesystem-safe; kebab-case recommended).
2. Copy the source `.docx` to
   `<workspace>/templates/shared/<id>/template.docx`.
3. Append an entry to `<workspace>/templates/shared/catalog.yaml`
   (hand-edit, or call `TemplateLibrarySkill(...).save(...)` with
   `user_id="shared"` from a one-off REPL).

## Public API

    skill = TemplateLibrarySkill(workspace_dir)
    skill.list(user_id, category=None, query=None)
    skill.get_path(template_ref, user_id)
    skill.save(source_path, user_id, name, description, ...)
    skill.delete(template_id, user_id)

## Future scaling

- `_resolve()` is the single bottleneck — swap its body for a SQLite FTS5
  query when the catalog hits a few hundred entries.
- `_shared_dir()` / `_user_dir()` return `Path` — wrap them in an fsspec-style
  abstraction for object storage (S3/MinIO).
- The catalog schema is forward-compatible: `version`, `approval_status`,
  `owner_org`, etc. can be added without breaking existing entries.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


_CATALOG_FILENAME = "catalog.yaml"
_DEFAULT_TEMPLATE_FILENAME = "template.docx"
_ALLOWED_TEMPLATE_SUFFIXES = {".docx", ".pptx"}
_TEMPLATE_MIME_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_ID_SAFE_RE = re.compile(r"[^a-z0-9\-]+")
_ASCII_LETTER_RE = re.compile(r"[a-zA-Z0-9]")


class TemplateLibrarySkill:
    """Filesystem catalog for DocMaster reusable templates."""

    def __init__(
        self,
        workspace_dir: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> None:
        if workspace_dir is None:
            workspace_dir = str(Path(__file__).resolve().parent.parent / "workspace")
        self.workspace_dir = Path(workspace_dir)
        override = os.environ.get("DOCMASTER_TEMPLATE_DIR")
        if override:
            self.root = Path(override)
        else:
            self.root = self.workspace_dir / "templates"

        # Per-user storage backend. When user_id is provided AND we can
        # resolve a `GfsUserClient` (via GfsProvisioner reading from the
        # GFS OpenAPI), the user's templates live at
        # `gfs://<bucket>/模板库/` instead of under self.root/users/<id>/.
        # Shared templates always stay on local FS — they're admin-curated.
        self._user_storage = None
        if user_id:
            try:
                # Load the sibling module by file path so this also works
                # when the skill itself is loaded via importlib.util (which
                # is how docmaster.py's `_load_template_library_skill`
                # mounts us — relative imports don't resolve in that case).
                import importlib.util as _il_util
                gfs_module_key = "drsai_ui._docmaster_gfs_template_storage"
                if gfs_module_key in sys.modules:
                    _gfs_mod = sys.modules[gfs_module_key]
                else:
                    _gfs_path = Path(__file__).resolve().parent / "gfs_template_storage.py"
                    _spec = _il_util.spec_from_file_location(gfs_module_key, _gfs_path)
                    _gfs_mod = _il_util.module_from_spec(_spec)
                    sys.modules[gfs_module_key] = _gfs_mod
                    _spec.loader.exec_module(_gfs_mod)
                GfsTemplateStorage = _gfs_mod.GfsTemplateStorage
                self._user_storage = GfsTemplateStorage(user_id)
            except LookupError as exc:
                logger.debug(
                    "GFS storage unavailable for %s; falling back to local FS: %s",
                    user_id,
                    exc,
                )
            except Exception as exc:
                logger.warning(
                    "GFS storage init failed for %s; falling back to local FS: %s",
                    user_id,
                    exc,
                )

    # ------------------------------------------------------------------ #
    # Public API                                                          #
    # ------------------------------------------------------------------ #

    def list(
        self,
        user_id: Optional[str] = None,
        category: Optional[str] = None,
        query: Optional[str] = None,
    ) -> Dict[str, Any]:
        shared_entries = self._load_catalog(self._shared_catalog_path())
        user_entries = self._load_user_catalog(user_id) if user_id else []
        shared_view = [
            self._public_view(e, "shared")
            for e in shared_entries
            if _matches_filters(e, category, query)
        ]
        mine_view = [
            self._public_view(e, "mine")
            for e in user_entries
            if _matches_filters(e, category, query)
        ]
        message = (
            f"共 {len(shared_view)} 个共享模板"
            + (f"，{len(mine_view)} 个我的模板" if user_id else "")
        )
        return {
            "success": True,
            "shared": shared_view,
            "mine": mine_view,
            "message": message,
        }

    def get_path(
        self,
        template_ref: str,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        ref = (template_ref or "").strip()
        if not ref:
            return {
                "success": False,
                "ambiguous": False,
                "message": "template_ref 不能为空。",
            }
        candidates = self._resolve(ref, user_id)
        if not candidates:
            return {
                "success": False,
                "ambiguous": False,
                "message": (
                    f"模板库里没找到匹配 '{template_ref}' 的模板。"
                    " 请用 list_templates_tool 看一下可用模板，或让用户上传新模板。"
                ),
            }
        if len(candidates) > 1:
            return {
                "success": False,
                "ambiguous": True,
                "candidates": [
                    {
                        "id": c["entry"]["id"],
                        "name": c["entry"].get("name", ""),
                        "source": c["source"],
                        "description": c["entry"].get("description", ""),
                    }
                    for c in candidates
                ],
                "message": (
                    f"匹配到 {len(candidates)} 个模板，请让用户从候选中挑选一个。"
                ),
            }
        hit = candidates[0]
        entry = hit["entry"]
        source = hit["source"]
        rel_file = entry.get("file") or f"{entry['id']}/{_DEFAULT_TEMPLATE_FILENAME}"
        if source == "mine" and self._user_storage is not None:
            full_path = self._user_storage.resolve_template_path(rel_file).resolve()
        else:
            catalog_dir = (
                self._shared_dir() if source == "shared"
                else self._user_dir(user_id)
            )
            full_path = (catalog_dir / rel_file).resolve()
        if not full_path.exists():
            return {
                "success": False,
                "ambiguous": False,
                "message": (
                    f"模板 '{entry['id']}' 在 catalog 里登记了，但文件 {full_path}"
                    " 找不到。请联系管理员或重新保存模板。"
                ),
            }
        return {
            "success": True,
            "template_path": str(full_path),
            "source": source,
            "metadata": self._public_view(entry, source),
            "message": f"已定位模板 '{entry.get('name', entry['id'])}'。",
        }

    def save(
        self,
        source_path: str,
        user_id: str,
        name: str,
        description: str,
        category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        aliases: Optional[List[str]] = None,
        template_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        src = Path(source_path) if source_path else None
        if not src or not src.exists():
            return {
                "success": False,
                "message": f"源文件不存在: {source_path}",
            }
        suffix = src.suffix.lower()
        if suffix not in _ALLOWED_TEMPLATE_SUFFIXES:
            return {
                "success": False,
                "message": f"模板必须是 .docx 或 .pptx 文件 (当前 {src.suffix})",
            }
        if not user_id or not user_id.strip():
            return {
                "success": False,
                "message": "user_id 不能为空 —— 模板要保存到用户自己的库里。",
            }
        if not name or not name.strip():
            return {
                "success": False,
                "message": "name 不能为空 —— 模板要有一个显示名称。",
            }
        existing = self._load_user_catalog(user_id)
        existing_ids = {e["id"] for e in existing}
        chosen_id = (template_id or "").strip() or self._slugify(name)
        if chosen_id in existing_ids:
            chosen_id = self._unique_id(chosen_id, existing_ids)
        if self._user_storage is not None:
            try:
                target_file = self._user_storage.import_template(chosen_id, str(src), suffix)
            except Exception as exc:
                return {
                    "success": False,
                    "message": f"复制模板文件失败: {exc}",
                }
        else:
            target_dir = self._user_dir(user_id) / chosen_id
            target_dir.mkdir(parents=True, exist_ok=True)
            target_file = target_dir / f"template{suffix}"
            try:
                shutil.copyfile(src, target_file)
            except Exception as exc:
                return {
                    "success": False,
                    "message": f"复制模板文件失败: {exc}",
                }
        entry: Dict[str, Any] = {
            "id": chosen_id,
            "name": name.strip(),
            "description": (description or "").strip(),
            "category": (category or "").strip() or None,
            "tags": list(tags or []),
            "aliases": list(aliases or []),
            "file": f"{chosen_id}/template{suffix}",
            "file_type": suffix.lstrip("."),
            "owner": user_id,
            "added_at": str(date.today()),
        }
        # Drop empty optional fields for a cleaner catalog file.
        for k in ("category",):
            if entry.get(k) is None:
                entry.pop(k, None)
        existing.append(entry)
        self._save_user_catalog(user_id, existing)
        return {
            "success": True,
            "template_id": chosen_id,
            "template_path": str(target_file),
            "metadata": self._public_view(entry, "mine"),
            "message": f"已把模板 '{name}' 保存到你的模板库 (id={chosen_id})。",
        }

    def delete(self, template_id: str, user_id: str) -> Dict[str, Any]:
        if not user_id or not user_id.strip():
            return {
                "success": False,
                "message": "user_id 不能为空 —— 不能删除共享模板。",
            }
        entries = self._load_user_catalog(user_id)
        keep: List[Dict[str, Any]] = []
        removed: Optional[Dict[str, Any]] = None
        for e in entries:
            if e["id"] == template_id and removed is None:
                removed = e
                continue
            keep.append(e)
        if removed is None:
            return {
                "success": False,
                "message": f"你的模板库里没有 id='{template_id}' 的模板。共享模板不能删除。",
            }
        if self._user_storage is not None:
            try:
                self._user_storage.remove_template(template_id)
            except Exception as exc:
                logger.warning("GFS template removal failed for %s/%s: %s", user_id, template_id, exc)
        else:
            target_dir = self._user_dir(user_id) / template_id
            try:
                if target_dir.exists():
                    shutil.rmtree(target_dir)
            except Exception as exc:
                logger.warning("failed to remove template dir %s: %s", target_dir, exc)
        self._save_user_catalog(user_id, keep)
        return {
            "success": True,
            "removed_id": template_id,
            "message": f"已从你的模板库删除 '{removed.get('name', template_id)}'。",
        }

    # ------------------------------------------------------------------ #
    # Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _shared_dir(self) -> Path:
        return self.root / "shared"

    def _user_dir(self, user_id: Optional[str]) -> Path:
        if not user_id:
            raise ValueError("user_id required to resolve user template dir")
        return self.root / "users" / user_id

    def _shared_catalog_path(self) -> Path:
        return self._shared_dir() / _CATALOG_FILENAME

    def _user_catalog_path(self, user_id: Optional[str]) -> Path:
        return self._user_dir(user_id) / _CATALOG_FILENAME

    def _load_user_catalog(self, user_id: Optional[str]) -> List[Dict[str, Any]]:
        """Read the user's catalog. Routed through GFS storage when available,
        local FS fallback otherwise. Always returns a list (possibly empty)."""
        if self._user_storage is not None:
            try:
                return self._user_storage.load_catalog()
            except Exception as exc:
                logger.warning("GFS catalog read failed; falling back to local: %s", exc)
        if not user_id:
            return []
        return self._load_catalog(self._user_catalog_path(user_id))

    def _save_user_catalog(self, user_id: str, entries: List[Dict[str, Any]]) -> None:
        """Persist the user's catalog. GFS-first when available."""
        if self._user_storage is not None:
            try:
                self._user_storage.save_catalog(entries)
                return
            except Exception as exc:
                logger.error("GFS catalog write failed; falling back to local: %s", exc)
        self._save_catalog(self._user_catalog_path(user_id), entries)

    def _load_catalog(self, catalog_path: Path) -> List[Dict[str, Any]]:
        if not catalog_path.exists():
            return []
        try:
            import yaml
        except ImportError:
            logger.warning("PyYAML not installed; returning empty catalog")
            return []
        try:
            with catalog_path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception as exc:
            logger.warning("failed to read %s: %s", catalog_path, exc)
            return []
        entries = data.get("templates", []) if isinstance(data, dict) else []
        # Drop malformed entries (must have at least id + file or id alone)
        valid: List[Dict[str, Any]] = []
        for e in entries:
            if isinstance(e, dict) and e.get("id"):
                valid.append(e)
        return valid

    def _save_catalog(self, catalog_path: Path, entries: List[Dict[str, Any]]) -> None:
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError(
                "PyYAML required to write template catalog"
            ) from exc
        catalog_path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: dump to a sibling temp file then rename.
        tmp_fd, tmp_name = tempfile.mkstemp(
            prefix=".catalog.", suffix=".yaml.tmp", dir=str(catalog_path.parent)
        )
        os.close(tmp_fd)
        try:
            with open(tmp_name, "w", encoding="utf-8") as f:
                yaml.safe_dump(
                    {"templates": entries},
                    f,
                    allow_unicode=True,
                    sort_keys=False,
                )
            os.replace(tmp_name, catalog_path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

    def _resolve(
        self,
        ref: str,
        user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Return a list of {entry, source} candidates for `ref`.

        Resolution order — first non-empty stage wins:
          1. Exact id match in user's library
          2. Exact id match in shared library
          3. Exact alias match (user first, then shared)
          4. Case-insensitive substring match on name/aliases/id
             (user first, then shared; deduplicated by (source, id))
        """
        ref_lower = ref.lower()
        shared = self._load_catalog(self._shared_catalog_path())
        user = self._load_user_catalog(user_id) if user_id else []

        def _by_id(entries: List[Dict[str, Any]], rid: str) -> Optional[Dict[str, Any]]:
            for e in entries:
                if e["id"] == rid:
                    return e
            return None

        # Stage 1 — exact id, user library
        e = _by_id(user, ref)
        if e:
            return [{"entry": e, "source": "mine"}]
        # Stage 2 — exact id, shared library
        e = _by_id(shared, ref)
        if e:
            return [{"entry": e, "source": "shared"}]
        # Stage 3 — exact alias (case-insensitive on ASCII, exact on CJK)
        def _alias_hit(entries, source):
            hits = []
            for e in entries:
                aliases = [str(a) for a in (e.get("aliases") or [])]
                for a in aliases:
                    if a == ref or a.lower() == ref_lower:
                        hits.append({"entry": e, "source": source})
                        break
            return hits

        hits = _alias_hit(user, "mine") + _alias_hit(shared, "shared")
        if hits:
            return hits
        # Stage 4 — substring match on name / aliases / id
        def _substring_hit(entries, source):
            hits = []
            for e in entries:
                fields = [
                    str(e.get("name", "")),
                    str(e.get("id", "")),
                    *[str(a) for a in (e.get("aliases") or [])],
                    *[str(t) for t in (e.get("tags") or [])],
                ]
                for f in fields:
                    if not f:
                        continue
                    if ref in f or ref_lower in f.lower():
                        hits.append({"entry": e, "source": source})
                        break
            return hits

        hits = _substring_hit(user, "mine") + _substring_hit(shared, "shared")
        # Dedup by (source, id) preserving order
        seen = set()
        dedup: List[Dict[str, Any]] = []
        for h in hits:
            key = (h["source"], h["entry"]["id"])
            if key in seen:
                continue
            seen.add(key)
            dedup.append(h)
        return dedup

    def _slugify(self, name: str) -> str:
        """Make a filesystem-safe id from a (possibly CJK) name.

        Phase 1 strategy: drop CJK / non-ASCII chars, lower-case, replace
        runs of non [a-z0-9-] with '-'. If the result is empty (pure-CJK
        name), fall back to `tpl-<short_hash>` so the id is still stable
        and unique-ish. Pinyin transliteration is a future improvement.
        """
        ascii_only = "".join(c if _ASCII_LETTER_RE.match(c) else "-" for c in name)
        slug = _ID_SAFE_RE.sub("-", ascii_only.lower()).strip("-")
        if not slug:
            h = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
            return f"tpl-{h}"
        return slug

    def _unique_id(self, base: str, taken: set) -> str:
        if base not in taken:
            return base
        # append -2, -3, ...
        i = 2
        while f"{base}-{i}" in taken:
            i += 1
        return f"{base}-{i}"

    def _public_view(self, entry: Dict[str, Any], source: str) -> Dict[str, Any]:
        file_value = str(entry.get("file") or "")
        suffix = Path(file_value).suffix.lower() if file_value else ".docx"
        return {
            "id": entry["id"],
            "name": entry.get("name", entry["id"]),
            "description": entry.get("description", ""),
            "category": entry.get("category", ""),
            "tags": list(entry.get("tags") or []),
            "aliases": list(entry.get("aliases") or []),
            "owner": entry.get("owner", source),
            "added_at": entry.get("added_at", ""),
            "source": source,
            "file": file_value,
            "file_type": entry.get("file_type") or suffix.lstrip("."),
        }


def _matches_filters(
    entry: Dict[str, Any],
    category: Optional[str],
    query: Optional[str],
) -> bool:
    if category:
        if (entry.get("category") or "") != category and not str(
            entry.get("category") or ""
        ).startswith(category + "/"):
            return False
    if query:
        q = query.lower()
        haystack = " ".join([
            str(entry.get("name", "")),
            str(entry.get("description", "")),
            str(entry.get("id", "")),
            " ".join(str(t) for t in (entry.get("tags") or [])),
            " ".join(str(a) for a in (entry.get("aliases") or [])),
        ]).lower()
        if q not in haystack and query not in haystack:
            return False
    return True


# ---------------------------------------------------------------------- #
# Smoke test                                                              #
# ---------------------------------------------------------------------- #

if __name__ == "__main__":
    import tempfile
    from docx import Document

    tmp_root = Path(tempfile.mkdtemp(prefix="tpl_lib_smoke_"))
    workspace = tmp_root / "workspace"
    workspace.mkdir(parents=True)
    skill = TemplateLibrarySkill(str(workspace))

    # Make two source docs to save
    src_a = tmp_root / "alpha.docx"
    src_b = tmp_root / "beta.docx"
    for p, body in [(src_a, "alpha contract"), (src_b, "beta contract")]:
        d = Document()
        d.add_paragraph(body)
        d.save(str(p))

    user = "alice@example.com"

    print("== empty list ==")
    print(skill.list(user))

    print("\n== save alpha ==")
    r1 = skill.save(
        str(src_a), user,
        name="采购合同（标准）",
        description="标准产品采购合同范本",
        category="合同/采购",
        tags=["合同", "采购"],
        aliases=["采购", "标准采购"],
    )
    print(r1)

    print("\n== save beta with same name ==")
    r2 = skill.save(
        str(src_b), user,
        name="采购合同（标准）",
        description="另一份采购合同",
        category="合同/采购",
    )
    print(r2)

    print("\n== list now ==")
    print(skill.list(user))

    print("\n== get_path by id ==")
    print(skill.get_path(r1["template_id"], user))

    print("\n== get_path by alias ==")
    print(skill.get_path("标准采购", user))

    print("\n== get_path by fuzzy name (ambiguous) ==")
    res = skill.get_path("采购合同", user)
    print(res)
    assert res.get("ambiguous") is True, "expected ambiguous match"

    print("\n== get_path nonexistent ==")
    print(skill.get_path("不存在的模板", user))

    print("\n== save bad ext ==")
    bad = tmp_root / "x.txt"
    bad.write_text("not a docx")
    print(skill.save(str(bad), user, name="bad", description=""))

    print("\n== save without user_id ==")
    print(skill.save(str(src_a), "", name="orphan", description=""))

    print("\n== delete first ==")
    print(skill.delete(r1["template_id"], user))

    print("\n== list after delete ==")
    print(skill.list(user))

    print("\n== delete shared (refused) ==")
    print(skill.delete("nonexistent", ""))

    print("\n[smoke] OK — workspace at:", workspace)
