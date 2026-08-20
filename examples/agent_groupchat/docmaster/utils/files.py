"""
File utilities for DocMaster.
Handles file event generation, GFS uploads, HepAI filesystem integration, and path validation.
"""

import base64
import mimetypes
import os
from pathlib import Path
from loguru import logger

from drsai.modules.managers.messages import FileInfo, FilesContent
from drsai.utils.utils import upload_to_hepai_filesystem
from ..constants import GFS_GENERATED_PREFIX, HALLUCINATED_PATH_HINTS


# ─────────────────────────────────────────────────────────────────────────────
# File Event Building
# ─────────────────────────────────────────────────────────────────────────────


def build_files_event_data(file_path: str, description: str) -> dict | None:
    """
    Build a serialized FilesEvent payload for a generated/edited file.

    Tries to upload via HepAI filesystem (URL method) first.
    Falls back to base64 encoding if the upload fails.

    Args:
        file_path: Absolute path to the file
        description: Human-readable description of the file

    Returns:
        Dictionary (serialized FilesContent) to be appended to the
        pending files-events side-channel, or None if both methods fail.
    """
    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        return None

    file_name = file_path_obj.name
    file_size = file_path_obj.stat().st_size
    mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    file_info = None

    # --- Primary: upload to HepAI filesystem for a URL ---
    try:
        file_obj = upload_to_hepai_filesystem(file_path=file_path)
        url = file_obj.get("url") if isinstance(file_obj, dict) else getattr(file_obj, "url", None)
        if url:
            file_info = FileInfo(
                name=file_name,
                url=url,
                description=description,
                download_method="url",
                size=file_size,
                mime_type=mime_type,
                path=file_path,  # Store the file path for tracking in on_messages_stream
            )
            print(f"📤 File uploaded for FilesEvent (URL): {url}")
    except Exception as upload_err:
        print(f"⚠️ HepAI upload failed, falling back to base64: {upload_err}")
        logger.debug(f"HepAI upload error details: {upload_err}")

    # --- Fallback: base64 encode the file ---
    if file_info is None:
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            file_info = FileInfo(
                name=file_name,
                base64_content=encoded,
                description=description,
                download_method="base64",
                size=file_size,
                mime_type=mime_type,
                path=file_path,  # Store the file path for tracking in on_messages_stream
            )
            print(f"📦 File encoded for FilesEvent (base64): {file_name}")
        except Exception as b64_err:
            print(f"❌ base64 fallback also failed: {b64_err}")
            logger.error(f"Base64 encoding error for {file_path}: {b64_err}")
            return None

    try:
        files_content = FilesContent(
            files=[file_info],
            title=file_name,
            description=description,
        )
        return files_content.model_dump()
    except Exception as e:
        logger.error(f"Error serializing FilesContent for {file_path}: {e}")
        return None


def upload_generated_to_gfs(user_id: str | None, local_path: str) -> None:
    """
    Upload a DocMaster-generated file into the user's GFS bucket so it
    shows up in 文件空间 alongside everything else.

    Best-effort. Any failure (no GFS, file gone, network error) is logged
    and swallowed — the FilesEvent that goes to the chat UI is the primary
    user-visible artifact, and we don't want to block it on storage.

    Storage layout: ``gfs://<bucket>/docmaster/generated/<filename>``.
    Flat dir, last-write-wins on filename collision.

    Args:
        user_id: User identifier (can be None, in which case this is a no-op)
        local_path: Absolute path to the file to upload
    """
    if not user_id:
        return
    try:
        if not Path(local_path).is_file():
            return
    except Exception:
        return
    try:
        from drsai.modules.managers.gfs import get_user_client
    except Exception as exc:
        logger.warning("GFS upload skipped (provisioner unavailable): {}", exc)
        return
    try:
        client = get_user_client(user_id)
    except Exception as exc:
        logger.warning("GFS upload skipped (no client for {}): {}", user_id, exc)
        return
    remote = f"{GFS_GENERATED_PREFIX}/{Path(local_path).name}"
    try:
        client.upload_file(local_path, remote)
        print(f"☁️ Uploaded to GFS: gfs://{client.bucket}/{remote}")
    except Exception as exc:
        logger.warning("GFS upload failed for {} -> {}: {}", local_path, remote, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Path Validation & Guards
# ─────────────────────────────────────────────────────────────────────────────


def guard_docx_file_path(file_path, *, tool_label: str) -> dict | None:
    """
    Reject obviously-hallucinated DOCX paths before tool execution.

    The LLM regularly invents paths like `/Users/jerry/Desktop/<filename>.docx`
    when the user mentions a template by name. The generic "File not found"
    response gives it no recovery target, so it falls back to `run_bash` /
    `run_glob` to "find" the file — which either misses entirely or pulls a
    stale duplicate. This guard returns a directive error that names the
    exact recovery path (get_template_path_tool or the upload event).

    Args:
        file_path: Path to validate
        tool_label: Name of the tool calling this guard (for error messages)

    Returns:
        None if path is valid, or error dict to return to the LLM
    """
    if not file_path or not isinstance(file_path, str):
        return {
            "success": False,
            "error": "Missing file_path",
            "message": (
                f"{tool_label} requires an absolute file_path. If the user "
                "referred to a template by name, call get_template_path_tool "
                "first; if the user uploaded a file, use the absolute path "
                "from the upload event. Do NOT guess paths, and do NOT use "
                "run_bash / run_glob / run_read to search for the file."
            ),
        }
    looks_hallucinated = any(hint in file_path for hint in HALLUCINATED_PATH_HINTS)
    if looks_hallucinated and not os.path.exists(file_path):
        return {
            "success": False,
            "error": "Hallucinated file path",
            "message": (
                f"{tool_label}: the path {file_path!r} does not exist on this "
                "system and looks invented (macOS/Windows-style or "
                "Desktop/Downloads/Documents). This server is Linux and user "
                "files live under the docmaster workspace. NEVER guess "
                "filesystem paths. To recover: "
                "(1) if the user named a template (e.g. \"用 X 模板\"), call "
                "get_template_path_tool(template_ref=<user's words>) — it "
                "returns the canonical absolute path; "
                "(2) if the user just uploaded a file, re-read the upload "
                "event in the conversation for the absolute path; "
                "(3) if neither applies, ask the user — do NOT use "
                "run_bash / run_glob / run_read to search the filesystem."
            ),
        }
    if not os.path.exists(file_path):
        return {
            "success": False,
            "error": "File not found",
            "message": (
                f"{tool_label}: no file at {file_path!r}. If you got this "
                "path from get_template_path_tool the catalog may be stale — "
                "call list_templates_tool then get_template_path_tool again. "
                "If from an upload event, re-check the absolute path from "
                "that event. Do NOT use run_bash / run_glob / run_read to "
                "search for the file."
            ),
        }
    return None


def guard_template_path(template_path) -> dict | None:
    """
    Validate template_path before calling DocxTemplateSkill.

    Returns an error dict (to be returned directly to the agent) when the
    path is empty / relative / non-existent. Returns None when the path is
    acceptable. The error messages are intentionally directive — the LLM
    has a habit of falling back to run_glob / run_bash when a tool call
    fails, which can silently pick up the wrong copy of a template (e.g.
    a stray export under downloads/). Spelling out the recovery in the
    tool error lands in fresh attention and is followed reliably.

    Args:
        template_path: Path to validate

    Returns:
        None if path is valid, or error dict to return to the LLM
    """
    if not template_path or not isinstance(template_path, str):
        return {
            "success": False,
            "error": "Missing template_path",
            "message": (
                "template_path is required. If the user named a template, call "
                "get_template_path_tool first and use the absolute template_path "
                "it returns. Do NOT use run_glob / run_bash / run_read to find "
                "template files — those can pick the wrong copy of the template."
            ),
        }
    p = Path(template_path)
    if not p.is_absolute():
        return {
            "success": False,
            "error": "Relative template_path not accepted",
            "message": (
                f"template_path={template_path!r} is a relative path. Use the "
                "absolute path returned by get_template_path_tool (the same value "
                "you received earlier in this conversation — re-call "
                "get_template_path_tool with the template name if you lost it). "
                "Do NOT pass bare filenames like 'template.docx', and do NOT use "
                "run_glob / run_bash / run_read to search the filesystem for the "
                "template — it can find a stale duplicate under downloads/ and "
                "bypass the template library."
            ),
        }
    if not p.exists():
        return {
            "success": False,
            "error": "Template file not found",
            "message": (
                f"template_path={template_path!r} does not exist. The template "
                "catalog may be stale or the file was deleted. Call "
                "list_templates_tool to browse available templates, then call "
                "get_template_path_tool with the template name. Do NOT use "
                "run_glob / run_bash / run_read to search for the template."
            ),
        }
    return None
