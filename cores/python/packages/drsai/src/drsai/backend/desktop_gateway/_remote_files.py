"""Materialise a remote Agent's ``FilesEvent`` payload as a local Artifact.

A remote DrSaiAssistant (HepAI/DDF worker) emits ``FilesEvent`` messages whose
``FileInfo`` entries point at content the Desktop cannot reach directly: either
a HepAI filesystem ``url`` or an inline ``base64_content`` fallback, selected by
``download_method``.  The Desktop Workspace, however, only knows how to preview
and download *local* files, and the frozen OAEP ``artifact`` content schema has
no ``url``/``base64_content`` field at all.

Rather than widen a stable protocol, the gateway does the conversion once, at
the boundary: it pulls the bytes (URL) or decodes them (base64), stores them as
a Workspace Artifact through :meth:`RuntimeArtifactStore.publish_content`, and
emits the standard ``artifact.created`` for that stored descriptor.  Downstream
everything behaves exactly like a locally produced artifact — preview, download
and the Artifact card all work unchanged.

The conversion is strictly best-effort: any failure (no URL, network error,
decoding error, quota) falls through to the original event so the Desktop still
shows the name/metadata card it would have shown before.
"""

from __future__ import annotations

import base64
import binascii
import mimetypes
import re
import urllib.error
import urllib.request
from typing import Any, Mapping

from loguru import logger

from drsai.backend.runtime.agent import RuntimeRunContext

from . import _state

# Remote payloads are bounded before they ever reach the Workspace.  The store
# applies its own per-file quota afterwards; this is the network/decode ceiling
# that keeps a hostile or accidental huge URL from being read into memory.
MAX_REMOTE_BYTES = 64 * 1024 * 1024
_DOWNLOAD_TIMEOUT_SECONDS = 60.0

# A URL/base64 payload is downloaded by the Runtime, not the Agent, so the
# scheme allow-list matters: refuse anything that is not plain HTTP(S).
_ALLOWED_URL_SCHEMES = ("http://", "https://")

_UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class RemoteFileMaterializationError(RuntimeError):
    """The remote payload could not be turned into a local Artifact."""


def materialize_remote_file(
    context: RuntimeRunContext,
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Resolve a remote ``artifact.created`` payload into a stored Artifact.

    Returns the stored descriptor (ready to emit as ``artifact.created``) or
    ``None`` when there is nothing remote to materialise, i.e. the payload
    already references a local file or has neither ``url`` nor
    ``base64_content``.  Raises only for a payload that clearly *is* remote but
    could not be materialised; callers decide whether to surface that as a
    non-fatal warning.
    """
    url = str(payload.get("url") or "").strip()
    encoded = payload.get("base64_content")
    encoded_str = str(encoded).strip() if isinstance(encoded, str) else ""
    if not url and not encoded_str:
        # Not a remote payload (e.g. a local file already registered by the
        # gateway, or a name-only card).  Leave it to the normal path.
        return None

    display_name = _display_name(payload)
    declared_mime = str(payload.get("mime") or payload.get("mime_type") or "").strip() or None

    if encoded_str:
        content = _decode_base64(encoded_str)
    else:
        content = _download(url)

    if not content:
        raise RemoteFileMaterializationError("remote_file_empty")

    mime_type = declared_mime or mimetypes.guess_type(display_name)[0] or "application/octet-stream"
    descriptor = _state.artifact_store().publish_content(
        context,
        content,
        display_name=display_name,
        mime_type=mime_type,
    )
    # Re-key the descriptor under the remote identity so a re-delivered
    # FilesEvent for the same file dedupes the way the Desktop already expects
    # (it collapses artifacts by sha256), while still carrying the local
    # download path the UI needs.
    stored = {
        **descriptor,
        "artifact_type": str(payload.get("artifact_type") or descriptor.get("artifact_type") or "file"),
        "summary": str(payload.get("summary") or ""),
        "source": str(payload.get("source") or "agent"),
        "download_method": "url" if url else "base64",
        "downloadable": True,
    }
    remote_artifact_id = str(payload.get("artifact_id") or "").strip()
    if remote_artifact_id:
        stored["remote_artifact_id"] = remote_artifact_id
    return stored


def _display_name(payload: Mapping[str, Any]) -> str:
    raw = str(payload.get("name") or payload.get("title") or "").strip()
    leaf = raw.replace("\\", "/").rsplit("/", 1)[-1]
    leaf = _UNSAFE_NAME.sub("_", leaf).strip(" .")
    return leaf[:200] or "artifact"


def _decode_base64(encoded: str) -> bytes:
    # Inline payloads occasionally arrive as a data: URI; keep only the payload.
    if encoded.startswith("data:") and "," in encoded:
        encoded = encoded.split(",", 1)[1]
    if len(encoded) > (MAX_REMOTE_BYTES * 4 // 3) + 16:
        raise RemoteFileMaterializationError("remote_file_too_large")
    try:
        return base64.b64decode(encoded, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise RemoteFileMaterializationError("remote_file_base64_invalid") from exc


def _download(url: str) -> bytes:
    lowered = url.lower()
    if not lowered.startswith(_ALLOWED_URL_SCHEMES):
        raise RemoteFileMaterializationError("remote_file_url_scheme_rejected")
    request = urllib.request.Request(url, method="GET")
    request.add_header("Accept", "*/*")
    try:
        with urllib.request.urlopen(request, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:  # noqa: S310 - scheme restricted above
            declared = response.headers.get("Content-Length")
            if declared is not None:
                try:
                    if int(declared) > MAX_REMOTE_BYTES:
                        raise RemoteFileMaterializationError("remote_file_too_large")
                except ValueError:
                    pass
            # Read one byte past the ceiling so an unlabeled oversize body is
            # detected instead of silently truncated.
            content = response.read(MAX_REMOTE_BYTES + 1)
    except RemoteFileMaterializationError:
        raise
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise RemoteFileMaterializationError("remote_file_download_failed") from exc
    if len(content) > MAX_REMOTE_BYTES:
        raise RemoteFileMaterializationError("remote_file_too_large")
    return content


def try_materialize(context: RuntimeRunContext, payload: Mapping[str, Any]) -> dict[str, Any] | None:
    """Best-effort wrapper: never raises, returns ``None`` on any failure.

    A remote file that cannot be fetched must not fail the Run; the Desktop
    still receives the original ``artifact.created`` metadata card.
    """
    try:
        return materialize_remote_file(context, payload)
    except RemoteFileMaterializationError as exc:
        logger.debug("remote file materialization skipped: {}", exc)
        return None
    except Exception as exc:  # pragma: no cover - defensive: never fail a Run here
        logger.debug("remote file materialization failed: {}", type(exc).__name__)
        return None


__all__ = [
    "MAX_REMOTE_BYTES",
    "RemoteFileMaterializationError",
    "materialize_remote_file",
    "try_materialize",
]
