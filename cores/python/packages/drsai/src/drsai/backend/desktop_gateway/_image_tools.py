"""Host-owned image generation / edit tools for the Desktop Agent.

Mirrors the Full Runtime wrappers in ``gateway_legacy`` but binds the current
Run through ``_artifacts.run_context`` (set by ``DesktopAgentBackend``).

Model selection comes from Agent ``image_generation_model`` policy; credentials
come from platform auth / Provider config — never from tool arguments.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from autogen_core import CancellationToken

from drsai.backend.runtime.image_operations import RuntimeImageOperationAdapter

from . import _artifacts, _state

# Injected every Desktop turn so end users can say natural language like
# 「画一只猫」without needing to name tools or forbid scripts themselves.
IMAGE_GENERATION_HOST_POLICY = """## Host image generation (required)

When the user asks to draw, generate, create, or edit an image:

1. Call the Host tool `image_generation` (or `image_edit` for edits) immediately.
2. Do **not** load Skill `image-process` (or similar) for generation.
3. Do **not** write/run Python, shell, curl, or HTTP scripts to call image APIs.
4. Do **not** invent ASCII/Markdown fake images as a substitute.
5. The Host picks the image model from Agent settings and handles credentials.

If `image_generation` fails, report the tool error and suggest switching the
Agent image-generation model in settings. Do **not** offer a script/HTTP
fallback, even as an optional backup.
"""

_image_adapter: RuntimeImageOperationAdapter | None = None


def image_adapter() -> RuntimeImageOperationAdapter:
    global _image_adapter
    if _image_adapter is None:
        _image_adapter = RuntimeImageOperationAdapter(
            _state.artifact_store(),
            lambda run_id, event_type, item, context: _state.runtime_engine().append_event(
                run_id, event_type, item,
            ),
        )
    return _image_adapter


def reset_image_adapter() -> None:
    global _image_adapter
    _image_adapter = None


async def image_generation(
    prompt: str,
    size: str = "1024x1024",
    display_name: str | None = None,
    cancellation_token: CancellationToken | None = None,
) -> dict[str, Any]:
    """Generate an image and publish it as a Workspace Artifact.

    Required for any user request to draw / generate / create an image.
    Prefer this Host tool over Skills, terminal scripts, or raw HTTP to image
    APIs. The Host selects the Agent's image_generation_model and credentials;
    never invent image bytes in text. Optional display_name when the user names
    the asset.
    """
    arguments: dict[str, Any] = {"prompt": prompt, "size": size}
    if display_name:
        arguments["display_name"] = display_name
    context = _artifacts.required_run_context()
    cancelled = threading.Event()
    if cancellation_token is not None:
        cancellation_token.add_callback(cancelled.set)
    return await asyncio.to_thread(image_adapter().generate, context, arguments, cancelled)


async def image_edit(
    prompt: str,
    resource_id: str | None = None,
    size: str = "1024x1024",
    display_name: str | None = None,
    cancellation_token: CancellationToken | None = None,
) -> dict[str, Any]:
    """Edit an attached image and publish a Workspace Artifact.

    Required for image-edit requests. Prefer this Host tool over Skills or
    custom scripts. resource_id is optional when exactly one image is attached.
    """
    arguments: dict[str, Any] = {"prompt": prompt, "size": size}
    if resource_id:
        arguments["resource_id"] = resource_id
    if display_name:
        arguments["display_name"] = display_name
    context = _artifacts.required_run_context()
    cancelled = threading.Event()
    if cancellation_token is not None:
        cancellation_token.add_callback(cancelled.set)
    return await asyncio.to_thread(image_adapter().edit, context, arguments, cancelled)
