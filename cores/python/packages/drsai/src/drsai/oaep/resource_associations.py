"""Canonical P1-to-P2 OAEP resource association projection.

The migration is deliberately in-memory and deterministic.  It never rewrites
append-only P1 events and it refuses to guess an authority namespace.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from typing import Any, Mapping


MAPPING_VERSION = "oaep-resource-association-p2/1"
P1_READER_ENV = "OPENDRSAI_OAEP_P1_READER"


class ResourceAssociationMigrationError(ValueError):
    """A legacy resource cannot be projected without guessing security context."""


def p1_reader_enabled() -> bool:
    """Deployment rollback switch for the read-only P1 compatibility path.

    There is intentionally no corresponding P1 writer switch: rollback may
    restore history readability, never unsafe legacy writes.
    """

    value = os.environ.get(P1_READER_ENV, "enabled").strip().lower()
    if value in {"enabled", "1", "true", "on"}:
        return True
    if value in {"disabled", "0", "false", "off"}:
        return False
    raise ResourceAssociationMigrationError("p1_reader_policy_invalid")


def _contains_p1_resources(snapshot: Mapping[str, Any]) -> bool:
    for item in snapshot.get("items", []):
        if not isinstance(item, Mapping):
            continue
        content = item.get("content")
        if not isinstance(content, Mapping):
            continue
        if content.get("resource_refs"):
            return True
        if any(isinstance(part, Mapping) and "resource_ref" in part for part in content.get("parts", [])):
            return True
        if any(isinstance(change, Mapping) and "resource_ref" in change for change in content.get("changes", [])):
            return True
    return False


def _stable_id(prefix: str, *parts: object) -> str:
    payload = "\x1f".join(str(part) for part in parts).encode("utf-8")
    return f"{prefix}-{hashlib.sha256(payload).hexdigest()[:32]}"


def _canonical_digest(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    candidate = value if value.startswith("sha256:") else f"sha256:{value}"
    suffix = candidate.removeprefix("sha256:")
    if len(suffix) != 64 or any(character not in "0123456789abcdef" for character in suffix):
        return None
    return candidate


def _strict_locator(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    kind = value.get("kind")
    if kind == "text_range" and isinstance(value.get("line"), int):
        line = int(value["line"])
        column = int(value.get("column", 1))
        return {
            "kind": kind,
            "line": line,
            "column": column,
            "end_line": int(value.get("end_line", line)),
            "end_column": int(value.get("end_column", column)),
        }
    required_by_kind = {
        "page": ("page",),
        "slide": ("slide",),
        "sheet_cell": ("sheet", "cell"),
        "time_range": ("start_ms", "end_ms"),
    }
    required = required_by_kind.get(str(kind))
    if required and all(field in value for field in required):
        if kind == "sheet_cell" and (
            not isinstance(value.get("sheet"), str) or len(value["sheet"]) > 255
            or not isinstance(value.get("cell"), str) or len(value["cell"]) > 64
        ):
            return None
        return {"kind": kind, **{field: value[field] for field in required}}
    return None


def _association(
    *,
    session_id: str,
    item_id: str,
    slot: str,
    ref: Mapping[str, Any],
    authority_id: str,
    label_fallback: str,
    mime_type: object = None,
    size: object = None,
) -> dict[str, Any]:
    workspace_id = ref.get("workspace_id")
    resource_type = ref.get("resource_type")
    resource_id = ref.get("resource_id")
    if not all(isinstance(value, str) and value for value in (workspace_id, resource_type, resource_id)):
        raise ResourceAssociationMigrationError("p1_resource_identity_invalid")
    association: dict[str, Any] = {
        "association_id": _stable_id("assoc", session_id, item_id, slot),
        "resource": {
            "protocol": "owop/1",
            "authority_id": authority_id,
            "workspace_id": workspace_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "generation": 1,
        },
        "relation": ref.get("relation") or "related",
        "label_snapshot": str(ref.get("label") or label_fallback or resource_id),
        "presentation": ref.get("presentation") or "card",
    }
    digest = _canonical_digest(ref.get("digest"))
    if digest:
        version: dict[str, Any] = {
            "version_id": f"version-{digest.removeprefix('sha256:')}",
            "digest": digest,
        }
        if isinstance(size, int) and size >= 0:
            version["size"] = size
        if isinstance(mime_type, str) and mime_type:
            version["mime_type"] = mime_type
        association["version_snapshot"] = version
    locator = _strict_locator(ref.get("locator"))
    if locator:
        association["locator"] = locator
    if isinstance(ref.get("operation_id"), str) and ref["operation_id"]:
        association["operation_id"] = ref["operation_id"]
    return association


def migrate_p1_snapshot(snapshot: Mapping[str, Any], *, authority_id: str | None) -> dict[str, Any]:
    """Return a canonical P2 projection without mutating *snapshot*.

    ``authority_id`` must come from the Session's authoritative Runtime binding.
    A caller that cannot provide it must render the legacy reference as
    unsupported; this function never falls back to a current UI Runtime.
    """

    if _contains_p1_resources(snapshot) and not p1_reader_enabled():
        raise ResourceAssociationMigrationError("p1_reader_disabled")
    if not isinstance(authority_id, str) or not authority_id:
        raise ResourceAssociationMigrationError("authority_binding_required")
    projected = copy.deepcopy(dict(snapshot))
    session = projected.get("session")
    if not isinstance(session, Mapping) or not isinstance(session.get("id"), str):
        raise ResourceAssociationMigrationError("p1_session_invalid")
    session_id = str(session["id"])

    for raw_item in projected.get("items", []):
        if not isinstance(raw_item, dict):
            continue
        if raw_item.get("associations") is not None:
            continue
        item_id = str(raw_item.get("id") or "")
        content = raw_item.get("content")
        if not item_id or not isinstance(content, dict):
            continue
        associations: list[dict[str, Any]] = []

        if raw_item.get("type") == "message" and isinstance(content.get("parts"), list):
            migrated_parts: list[dict[str, Any]] = []
            for index, raw_part in enumerate(content["parts"]):
                if not isinstance(raw_part, Mapping):
                    continue
                part_id = _stable_id("part", session_id, item_id, index)
                if raw_part.get("type") == "text" and isinstance(raw_part.get("text"), str):
                    migrated_parts.append({"part_id": part_id, "type": "text", "text": raw_part["text"]})
                    continue
                ref = raw_part.get("resource_ref")
                if isinstance(ref, Mapping):
                    association = _association(
                        session_id=session_id,
                        item_id=item_id,
                        slot=f"part:{index}",
                        ref=ref,
                        authority_id=authority_id,
                        label_fallback=str(raw_part.get("name") or "resource"),
                        mime_type=raw_part.get("mime_type"),
                        size=raw_part.get("size"),
                    )
                    associations.append(association)
                    migrated_parts.append({
                        "part_id": part_id,
                        "type": "resource",
                        "association_id": association["association_id"],
                    })
            content["parts"] = migrated_parts

        if raw_item.get("type") == "file_change" and isinstance(content.get("changes"), list):
            for index, change in enumerate(content["changes"]):
                if not isinstance(change, dict) or not isinstance(change.get("resource_ref"), Mapping):
                    continue
                ref = change.pop("resource_ref")
                association = _association(
                    session_id=session_id, item_id=item_id, slot=f"change:{index}", ref=ref,
                    authority_id=authority_id,
                    label_fallback=str(change.get("new_path") or change.get("path") or "resource"),
                )
                associations.append(association)
                change["association_id"] = association["association_id"]

        legacy_refs = content.pop("resource_refs", [])
        if isinstance(legacy_refs, list):
            for index, ref in enumerate(legacy_refs):
                if not isinstance(ref, Mapping):
                    continue
                association = _association(
                    session_id=session_id, item_id=item_id, slot=f"content:{index}", ref=ref,
                    authority_id=authority_id,
                    label_fallback=str(content.get("name") or content.get("artifact_id") or "resource"),
                    mime_type=content.get("mime_type"), size=content.get("size"),
                )
                associations.append(association)
        if raw_item.get("type") == "artifact" and associations:
            content["association_id"] = associations[0]["association_id"]
        if associations:
            raw_item["associations"] = associations
        source = raw_item.get("source")
        if isinstance(source, dict):
            source["mapping_version"] = MAPPING_VERSION

    projected["mapping_version"] = MAPPING_VERSION
    return projected


def canonical_projection_bytes(value: Mapping[str, Any]) -> bytes:
    """Stable bytes used by cross-host conformance vectors and replay checks."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


_RESOURCE_TYPES = frozenset((
    "workspace", "worktree", "file", "git", "process", "pty", "checkpoint", "artifact",
))
_RELATIONS = frozenset((
    "input_reference", "input_attachment", "output_artifact", "citation_source",
    "file_change_target", "derived_from", "related",
))
_PRESENTATIONS = frozenset(("inline", "card", "activity"))


def _project_association(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    resource = value.get("resource")
    # Producers are checked against the strict JSON Schema.  Readers retain a
    # compatibility margin by dropping unknown optional Association metadata;
    # identity and semantic substructures below remain exact/fail-closed.
    if not isinstance(resource, Mapping):
        return None
    if set(resource) != {
        "protocol", "authority_id", "workspace_id", "resource_type", "resource_id", "generation",
    }:
        return None
    if resource.get("protocol") != "owop/1" or resource.get("resource_type") not in _RESOURCE_TYPES:
        return None
    if not all(isinstance(resource.get(field), str) and 0 < len(resource[field]) <= 256 for field in (
        "authority_id", "workspace_id", "resource_id",
    )):
        return None
    if not isinstance(resource.get("generation"), int) or resource["generation"] < 1:
        return None
    if not isinstance(value.get("association_id"), str) or not 0 < len(value["association_id"]) <= 256:
        return None
    if value.get("relation") not in _RELATIONS or value.get("presentation") not in _PRESENTATIONS:
        return None
    if not isinstance(value.get("label_snapshot"), str) or not 0 < len(value["label_snapshot"]) <= 512:
        return None
    if "locator" in value and _strict_locator(value["locator"]) != value["locator"]:
        return None
    version = value.get("version_snapshot")
    if version is not None:
        if not isinstance(version, Mapping) or not isinstance(version.get("version_id"), str) or not 0 < len(version["version_id"]) <= 256:
            return None
        if "digest" in version and _canonical_digest(version["digest"]) != version["digest"]:
            return None
        if "size" in version and (not isinstance(version["size"], int) or version["size"] < 0):
            return None
        if "mime_type" in version and (
            not isinstance(version["mime_type"], str) or len(version["mime_type"]) > 256
        ):
            return None
    if "operation_id" in value and (
        not isinstance(value["operation_id"], str) or not 0 < len(value["operation_id"]) <= 256
    ):
        return None
    if isinstance(version, Mapping) and "captured_at" in version and not isinstance(version["captured_at"], str):
        return None
    projected = {
        field: copy.deepcopy(value[field]) for field in (
            "association_id", "resource", "relation", "label_snapshot", "presentation",
            "locator", "operation_id",
        ) if field in value
    }
    if isinstance(version, Mapping):
        projected["version_snapshot"] = {
            field: copy.deepcopy(version[field]) for field in (
                "version_id", "digest", "size", "mime_type", "captured_at",
            ) if field in version
        }
    return projected


def project_p2_resources(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Host-neutral, fail-closed P2 projection used by Python/Web hosts."""

    items = snapshot.get("items")
    if not isinstance(items, list):
        raise ValueError("oaep_snapshot_items_invalid")
    associations: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    item_by_association: dict[str, str] = {}
    parts_by_item: dict[str, list[dict[str, Any]]] = {}
    diagnostics: list[dict[str, str]] = []
    for raw_item in items:
        if not isinstance(raw_item, Mapping):
            continue
        item_id = raw_item.get("id") if isinstance(raw_item.get("id"), str) else "unknown-item"
        for raw_association in raw_item.get("associations", []):
            association = _project_association(raw_association)
            if association is None:
                diagnostics.append({"code": "association_invalid", "item_id": item_id})
                continue
            association_id = association["association_id"]
            if association_id not in by_id:
                by_id[association_id] = association
                associations.append(association)
                item_by_association[association_id] = item_id
        content = raw_item.get("content")
        if raw_item.get("type") != "message" or not isinstance(content, Mapping) or not isinstance(content.get("parts"), list):
            continue
        projected_parts: list[dict[str, Any]] = []
        for index, raw_part in enumerate(content["parts"]):
            part = raw_part if isinstance(raw_part, Mapping) else {}
            part_id = part.get("part_id") if isinstance(part.get("part_id"), str) and part["part_id"] else f"unsupported-{index + 1}"
            if set(part) == {"part_id", "type", "text"} and part.get("type") == "text" and isinstance(part.get("text"), str):
                projected_parts.append({"part_id": part_id, "type": "text", "text": part["text"]})
            elif set(part) == {"part_id", "type", "association_id"} and part.get("type") == "resource" and part.get("association_id") in by_id:
                projected_parts.append({"part_id": part_id, "type": "resource", "association_id": part["association_id"]})
            else:
                diagnostics.append({"code": "part_unsupported", "item_id": item_id, "part_id": part_id})
                wire_type = part.get("type") if isinstance(part.get("type"), str) and part["type"] else "unknown"
                projected_parts.append({"part_id": part_id, "type": "unsupported", "wire_type": wire_type})
        parts_by_item[item_id] = projected_parts
    return {
        "associations": associations,
        "itemByAssociation": item_by_association,
        "partsByItem": parts_by_item,
        "diagnostics": diagnostics,
    }
