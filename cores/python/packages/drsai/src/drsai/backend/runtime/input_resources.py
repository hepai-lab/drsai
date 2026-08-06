"""Backend-neutral OAEP input resources and bounded validation."""

from __future__ import annotations

import re
import hashlib
import warnings
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Iterable, Mapping


INPUT_RESOURCE_PROTOCOL = "oaep.input/1"
INPUT_RESOURCE_KINDS = frozenset({"file", "folder", "selection", "terminal", "browser"})
MAX_INPUT_RESOURCES = 32
MAX_RESOURCE_CONTENT_CHARS = 100_000
MAX_TOTAL_RESOURCE_CONTENT_CHARS = 200_000
MAX_NATIVE_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_NATIVE_IMAGE_BYTES = 50 * 1024 * 1024
MAX_NATIVE_IMAGE_PIXELS = 40_000_000
MAX_NATIVE_IMAGE_DIMENSION = 20_000
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
_IMAGE_FORMAT_MIMES = MappingProxyType({
    "PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp",
})
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def normalize_input_resources(values: object) -> tuple[Mapping[str, Any], ...]:
    """Return an immutable, JSON-safe input-resource collection.

    Resources that cannot be encoded must be rejected by the caller before a
    Run starts. This function never silently drops a supplied entry.
    """
    if values is None:
        return ()
    if not isinstance(values, (list, tuple)):
        raise ValueError("input_resources must be an array")
    if len(values) > MAX_INPUT_RESOURCES:
        raise ValueError(f"input_resources cannot exceed {MAX_INPUT_RESOURCES} entries")
    normalized: list[Mapping[str, Any]] = []
    total_content = 0
    seen: set[str] = set()
    for index, raw in enumerate(values):
        if not isinstance(raw, Mapping):
            raise ValueError(f"input_resources[{index}] must be an object")
        protocol = str(raw.get("protocol") or "")
        resource_id = str(raw.get("resource_id") or "")
        kind = str(raw.get("kind") or "")
        name = str(raw.get("name") or "")
        reference = str(raw.get("reference") or "")
        content = raw.get("content")
        if raw.get("permission") not in {None, "read"} or raw.get("status") not in {None, "encoded"}:
            raise ValueError(f"input_resources[{index}] is not authorized for read encoding")
        if protocol != INPUT_RESOURCE_PROTOCOL:
            raise ValueError(f"input_resources[{index}] uses an unsupported protocol")
        if not _ID.fullmatch(resource_id) or resource_id in seen:
            raise ValueError(f"input_resources[{index}] has an invalid or duplicate resource_id")
        if kind not in INPUT_RESOURCE_KINDS:
            raise ValueError(f"input_resources[{index}] has an unsupported kind")
        if not name or len(name) > 300 or any(char in name for char in "\r\n\0"):
            raise ValueError(f"input_resources[{index}] has an invalid name")
        if content is not None and not isinstance(content, str):
            raise ValueError(f"input_resources[{index}].content must be text")
        if isinstance(content, str):
            if len(content) > MAX_RESOURCE_CONTENT_CHARS:
                raise ValueError(f"input_resources[{index}].content exceeds its limit")
            total_content += len(content)
            if total_content > MAX_TOTAL_RESOURCE_CONTENT_CHARS:
                raise ValueError("input_resources content exceeds the request limit")
        if kind in {"file", "folder"}:
            _validate_workspace_reference(reference, index)
        elif not content:
            raise ValueError(f"input_resources[{index}] requires explicit content")
        captured_at = raw.get("captured_at")
        if kind in {"selection", "terminal", "browser"} and (
            not isinstance(captured_at, str) or not captured_at or len(captured_at) > 80
        ):
            raise ValueError(f"input_resources[{index}] requires a capture timestamp")
        size_bytes = raw.get("size_bytes")
        if size_bytes is not None and (not isinstance(size_bytes, int) or isinstance(size_bytes, bool) or size_bytes < 0):
            raise ValueError(f"input_resources[{index}].size_bytes is invalid")
        record: dict[str, Any] = {
            "protocol": INPUT_RESOURCE_PROTOCOL,
            "resource_id": resource_id,
            "kind": kind,
            "name": name,
            "permission": "read",
            "status": "encoded",
        }
        if reference:
            record["reference"] = reference.replace("\\", "/")
        if content is not None:
            record["content"] = content
        for key in ("mime", "title", "url"):
            value = raw.get(key)
            if isinstance(value, str) and value:
                record[key] = value[:2048 if key == "url" else 300]
        if size_bytes is not None:
            record["size_bytes"] = size_bytes
        sha256 = raw.get("sha256")
        if sha256 is not None:
            if kind != "file" or not isinstance(sha256, str) or not _SHA256.fullmatch(sha256):
                raise ValueError(f"input_resources[{index}].sha256 is invalid")
            record["sha256"] = sha256
        if isinstance(captured_at, str):
            record["captured_at"] = captured_at
        seen.add(resource_id)
        normalized.append(MappingProxyType(record))
    return tuple(normalized)


def codex_input_items(
    prompt: str,
    resources: Iterable[Mapping[str, Any]],
    *,
    workspace_path: Path,
) -> list[dict[str, Any]]:
    """Encode OAEP resources into reviewed stable Codex UserInput variants."""
    items: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    root = workspace_path.resolve(strict=True)
    for resource in normalize_input_resources(list(resources)):
        kind = str(resource["kind"])
        if kind in {"file", "folder"}:
            reference = str(resource["reference"])
            target = _resolve_workspace_resource(root, reference, kind=kind, resource=resource)
            image = _inspect_native_image(target, resource) if kind == "file" else None
            if image is not None:
                items.append({"type": "localImage", "path": str(target)})
            else:
                items.append({"type": "mention", "name": str(resource["name"]), "path": str(target)})
            continue
        header = f"[OpenDrSai input resource: {kind}; name={resource['name']}]"
        details = [header]
        if resource.get("title"):
            details.append(f"Title: {resource['title']}")
        if resource.get("url"):
            details.append(f"URL: {resource['url']}")
        details.append(str(resource["content"]))
        items.append({"type": "text", "text": "\n".join(details)})
    return items


def autogen_input_task(
    prompt: str,
    resources: Iterable[Mapping[str, Any]],
    *,
    workspace_path: Path,
) -> Any:
    """Encode the same OAEP resources for the production OpenDrSai Agent.

    The Desktop has already staged files inside the authoritative Workspace.
    Revalidate every reference at this final Backend boundary, then use the
    Agent's native ``MultiModalMessage`` for images.  No second attachment
    store or Backend-specific manifest is introduced.
    """
    normalized = normalize_input_resources(list(resources))
    if not normalized:
        return prompt
    from autogen_agentchat.messages import MultiModalMessage
    from autogen_core import Image

    root = workspace_path.resolve(strict=True)
    content: list[Any] = [prompt]
    for resource in normalized:
        kind = str(resource["kind"])
        if kind in {"file", "folder"}:
            reference = str(resource["reference"])
            target = _resolve_workspace_resource(root, reference, kind=kind, resource=resource)
            image = _inspect_native_image(target, resource) if kind == "file" else None
            if image is not None:
                content.append(
                    f"[OpenDrSai image resource: resource_id={resource['resource_id']}; "
                    f"name={resource['name']}]"
                )
                content.append(Image.from_file(target))
            else:
                content.append(
                    f"[OpenDrSai input resource: {kind}; name={resource['name']}; "
                    f"workspace_path={reference}]"
                )
            continue
        details = [f"[OpenDrSai input resource: {kind}; name={resource['name']}]" ]
        if resource.get("title"):
            details.append(f"Title: {resource['title']}")
        if resource.get("url"):
            details.append(f"URL: {resource['url']}")
        details.append(str(resource["content"]))
        content.append("\n".join(details))
    return MultiModalMessage(content=content, source="user")


def serializable_input_resources(values: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [dict(value) for value in values]


def inspect_native_image_resources(
    resources: Iterable[Mapping[str, Any]], *, workspace_path: Path,
) -> dict[str, Any]:
    """Decode native image resources and return privacy-safe admission evidence."""
    root = workspace_path.resolve(strict=True)
    images: list[dict[str, Any]] = []
    for resource in normalize_input_resources(list(resources)):
        if resource["kind"] != "file":
            continue
        target = _resolve_workspace_resource(
            root, str(resource["reference"]), kind="file", resource=resource,
        )
        metadata = _inspect_native_image(target, resource)
        if metadata is None:
            continue
        images.append({
            "resource_id": str(resource["resource_id"]),
            "mime": metadata["mime"],
            "size_bytes": metadata["size_bytes"],
            "sha256": str(resource.get("sha256") or _sha256_file(target)),
            "width": metadata["width"],
            "height": metadata["height"],
        })
    total_bytes = sum(int(item["size_bytes"]) for item in images)
    if total_bytes > MAX_TOTAL_NATIVE_IMAGE_BYTES:
        raise ValueError(f"native images exceed the {MAX_TOTAL_NATIVE_IMAGE_BYTES}-byte total limit")
    return {
        "image_count": len(images),
        "total_bytes": total_bytes,
        "mime_types": sorted({str(item["mime"]) for item in images}),
        "resources": images,
    }


def _inspect_native_image(path: Path, resource: Mapping[str, Any]) -> dict[str, Any] | None:
    declared_mime = str(resource.get("mime") or "").lower()
    with path.open("rb") as stream:
        prefix = stream.read(16)
    magic_image = (
        prefix.startswith(b"\x89PNG\r\n\x1a\n") or prefix.startswith(b"\xff\xd8\xff")
        or prefix.startswith((b"GIF87a", b"GIF89a"))
        or (prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP")
    )
    candidate = declared_mime.startswith("image/") or path.suffix.lower() in _IMAGE_EXTENSIONS or magic_image
    if not candidate:
        return None
    size = path.stat().st_size
    if size > MAX_NATIVE_IMAGE_BYTES:
        raise ValueError(f"native image exceeds the {MAX_NATIVE_IMAGE_BYTES}-byte limit")
    try:
        from PIL import Image as PILImage
        with warnings.catch_warnings():
            warnings.simplefilter("error", PILImage.DecompressionBombWarning)
            with PILImage.open(path) as opened:
                image_format = str(opened.format or "").upper()
                width, height = opened.size
                opened.verify()
    except Exception as exc:
        raise ValueError("native image is corrupt or uses an unsupported format") from exc
    actual_mime = _IMAGE_FORMAT_MIMES.get(image_format)
    if actual_mime is None:
        raise ValueError("native image must be PNG, JPEG, GIF, or WebP")
    if declared_mime and declared_mime != actual_mime:
        raise ValueError("native image MIME does not match its decoded content")
    if width <= 0 or height <= 0 or width > MAX_NATIVE_IMAGE_DIMENSION or height > MAX_NATIVE_IMAGE_DIMENSION:
        raise ValueError("native image dimensions exceed the supported limit")
    if width * height > MAX_NATIVE_IMAGE_PIXELS:
        raise ValueError("native image pixel count exceeds the supported limit")
    return {"mime": actual_mime, "size_bytes": size, "width": width, "height": height}


def _validate_workspace_reference(reference: str, index: int) -> None:
    normalized = reference.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or len(normalized) > 4096
        or any(char in normalized for char in "\r\n\0")
        or path.is_absolute()
        or bool(re.match(r"^[A-Za-z]:", normalized))
        or ".." in path.parts
    ):
        raise ValueError(f"input_resources[{index}] has an invalid workspace reference")


def _resolve_workspace_resource(
    root: Path,
    reference: str,
    *,
    kind: str,
    resource: Mapping[str, Any],
) -> Path:
    target = (root / Path(reference)).resolve(strict=True)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("input resource resolves outside the workspace") from exc
    if kind == "file" and not target.is_file():
        raise ValueError("file input resource is not a regular file")
    if kind == "folder" and not target.is_dir():
        raise ValueError("folder input resource is not a directory")
    if kind == "file":
        expected_size = resource.get("size_bytes")
        if isinstance(expected_size, int) and target.stat().st_size != expected_size:
            raise ValueError("file input resource changed after it was staged")
        expected_digest = resource.get("sha256")
        if isinstance(expected_digest, str) and _sha256_file(target) != expected_digest:
            raise ValueError("file input resource changed after it was staged")
    return target


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
