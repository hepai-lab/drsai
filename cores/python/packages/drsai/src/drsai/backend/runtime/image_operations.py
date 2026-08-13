"""Capability-gated OpenAI-compatible image generation and editing."""

from __future__ import annotations

import base64
import binascii
from io import BytesIO
from pathlib import Path
import json
import hashlib
from typing import Any, Mapping

import httpx
from PIL import Image as PILImage

from drsai.backend.runtime.agent import RuntimeExecutionError, RuntimeRunContext
from drsai.backend.runtime.input_resources import (
    MAX_NATIVE_IMAGE_DIMENSION,
    MAX_NATIVE_IMAGE_PIXELS,
    inspect_native_image_resources,
)
from drsai.backend.workspace.paths import WorkspacePathError, resolve_workspace_path
from drsai.config.agent_model_policy import current_agent_name, load_agent_model_policy
from drsai.config.loader import ConfigError as ModelProviderConfigError, load_user_config
from drsai.config.resolver import resolve_model_ref
from drsai.config.gemini_operation_adapter import GeminiGenerateContentAdapter
from drsai.config.model_catalog import ModelRef
from drsai.config.model_operation_routing import ResolvedAgentOperation, default_operation_routes
from drsai.platform_auth import get_model_credential_provider


MAX_IMAGE_RESULT_BYTES = 20 * 1024 * 1024
ALLOWED_SIZES = frozenset({"256x256", "512x512", "1024x1024", "1024x1536", "1536x1024", "auto"})


class RuntimeImageOperationAdapter:
    """Execute only explicitly declared image operations on one exact model."""

    def __init__(self, artifact_store, emit_artifact) -> None:
        self.artifact_store = artifact_store
        self.emit_artifact = emit_artifact

    def generate(
        self, context: RuntimeRunContext, arguments: Mapping[str, Any], cancellation_event: Any = None,
    ) -> dict[str, Any]:
        return self._execute(context, "image_generation", arguments, cancellation_event)

    def edit(
        self, context: RuntimeRunContext, arguments: Mapping[str, Any], cancellation_event: Any = None,
    ) -> dict[str, Any]:
        return self._execute(context, "image_edit", arguments, cancellation_event)

    def _execute(
        self, context: RuntimeRunContext, operation: str, arguments: Mapping[str, Any],
        cancellation_event: Any = None,
    ) -> dict[str, Any]:
        if cancellation_event is not None and cancellation_event.is_set():
            raise RuntimeExecutionError("run_cancelled", "Image operation was cancelled.")
        prompt = str(arguments.get("prompt") or "").strip()
        if not prompt or len(prompt) > 4_000 or any(char == "\0" for char in prompt):
            raise RuntimeExecutionError("image_prompt_invalid", "Image prompt must contain 1-4000 characters.")
        applied_constraints: list[str] = []
        for resource in context.input_resources:
            if resource.get("kind") != "selection" or resource.get("name") != "OpenDrSai regression control":
                continue
            try:
                control = json.loads(str(resource.get("content") or ""))
            except json.JSONDecodeError:
                continue
            constraints = control.get("image_constraints") if isinstance(control, dict) else None
            if not isinstance(constraints, dict):
                continue
            applied_constraints = [str(value) for value in constraints.get("forbidden") or [] if isinstance(value, str)]
            if applied_constraints:
                prompt += (
                    "\n\nHard negative constraints (must be obeyed literally): "
                    + "; ".join(applied_constraints)
                    + ". Represent concepts only with abstract unlabeled shapes or icons. Never render the theme name, "
                      "capability names, typography, glyphs, letters, digits, logos, or watermarks."
                )
            break
        if len(prompt) > 4_000:
            raise RuntimeExecutionError("image_prompt_invalid", "Image prompt plus controlled constraints exceeds 4000 characters.")
        size = str(arguments.get("size") or "1024x1024")
        if size not in ALLOWED_SIZES:
            raise RuntimeExecutionError("image_size_unsupported", "The requested image size is unsupported.")

        resolved, provider_id, model_id = self._resolve_declared_model(operation)
        if resolved.provider.wire_api not in {"openai", "gemini"}:
            raise RuntimeExecutionError(
                "image_operation_protocol_unsupported",
                "This Provider does not declare a supported image operation protocol.",
            )
        static_token = resolved.provider.api_key.reveal() if resolved.provider.api_key else None
        credential = (
            get_model_credential_provider(static_token, resolved.provider.base_url)
            if provider_id == "hepai" else None
        )
        access_token = credential.access_token if credential else static_token
        if resolved.provider.requires_api_key and not access_token:
            raise RuntimeExecutionError("model_unauthorized", "Image Provider credentials are unavailable.")
        base_url = (
            credential.openai_base_url if credential and provider_id == "hepai"
            else resolved.provider.base_url
        ).rstrip("/")
        headers = {"Accept": "application/json"}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"

        try:
            if resolved.provider.wire_api == "gemini":
                bound = ResolvedAgentOperation(
                    role="image_generation_model",
                    ref=ModelRef(provider_id, model_id),
                    model=resolved,
                    route_plan=default_operation_routes(ModelRef(provider_id, model_id), operation),
                )
                source_image = None
                source_mime = None
                if operation == "image_edit":
                    resource, image_path, source_mime = self._edit_resource(context, arguments)
                    source_image = image_path.read_bytes()
                result = GeminiGenerateContentAdapter().create(
                    bound,
                    prompt=prompt,
                    image=source_image,
                    image_mime=source_mime,
                    response_modalities=("TEXT", "IMAGE"),
                )
                if not result.images:
                    raise RuntimeExecutionError(
                        "image_provider_invalid_response", "Image Provider returned no image data."
                    )
                content, mime = self._validate_image_content(
                    result.images[0].content, result.images[0].mime_type,
                )
            else:
                content, mime = self._execute_openai_image(
                    context, operation, arguments, prompt, size, base_url, headers, resolved.model,
                )
        except RuntimeExecutionError:
            raise
        except ModelProviderConfigError as exc:
            raise RuntimeExecutionError("image_model_unavailable", "The selected image model is unavailable.") from exc
        except Exception as exc:
            # Gemini adapter exposes stable error attributes without leaking the
            # upstream response or credential into Runtime evidence.
            code = getattr(exc, "code", None)
            if isinstance(code, str):
                mapped = "model_unauthorized" if code in {"authentication_failed", "permission_denied", "credential_unavailable"} else code
                raise RuntimeExecutionError(mapped, "Image Provider rejected the operation.", retryable=bool(getattr(exc, "retryable", False))) from exc
            raise

        if cancellation_event is not None and cancellation_event.is_set():
            raise RuntimeExecutionError("side_effect_outcome_unknown", "Image operation was cancelled after submission.")
        requested_name = str(arguments.get("display_name") or "")
        if requested_name.casefold().endswith(".png") and mime != "image/png":
            try:
                with PILImage.open(BytesIO(content)) as image:
                    normalized = BytesIO()
                    image.convert("RGBA" if "A" in image.getbands() else "RGB").save(normalized, format="PNG")
                    content = normalized.getvalue()
                if len(content) > MAX_IMAGE_RESULT_BYTES:
                    raise RuntimeExecutionError("image_result_too_large", "Normalized image exceeds the Runtime limit.")
                mime = "image/png"
            except RuntimeExecutionError:
                raise
            except Exception as exc:
                raise RuntimeExecutionError("image_provider_invalid_response", "Image output could not be normalized.") from exc
        extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[mime]
        display_name = Path(str(arguments.get("display_name") or f"opendrsai-{operation}{extension}")).name[:240]
        if not display_name.lower().endswith(extension):
            display_name = f"{Path(display_name).stem}{extension}"
        artifact_dir = context.workspace_path / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        target = artifact_dir / display_name
        try:
            target.write_bytes(content)
            artifact = self.artifact_store.publish(
                context, {"path": target.relative_to(context.workspace_path).as_posix(), "display_name": display_name, "mime_type": mime},
            )
        except Exception:
            target.unlink(missing_ok=True)
            raise
        self.emit_artifact(context.run_id, "artifact.created", artifact)
        return {
            **artifact,
            "operation": operation,
            "model_ref": {"provider_id": provider_id, "model_id": model_id},
            "upstream_model_id": resolved.model,
            "protocol": "gemini_generate_content" if resolved.provider.wire_api == "gemini" else "openai_images_generation" if operation == "image_generation" else "openai_images_edits",
            **({
                "applied_constraint_count": len(applied_constraints),
                "applied_constraints_sha256": hashlib.sha256("\n".join(applied_constraints).encode("utf-8")).hexdigest(),
            } if applied_constraints else {}),
            "_replay_policy": {"classification": "external_side_effect", "replay": "approval_required"},
        }

    def _execute_openai_image(
        self, context: RuntimeRunContext, operation: str, arguments: Mapping[str, Any],
        prompt: str, size: str, base_url: str, headers: Mapping[str, str], upstream_model_id: str,
    ) -> tuple[bytes, str]:
        try:
            with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=False) as client:
                if operation == "image_generation":
                    response = client.post(
                        f"{base_url}/images/generations", headers=headers,
                        json={"model": upstream_model_id, "prompt": prompt, "size": size, "n": 1, "response_format": "b64_json"},
                    )
                else:
                    resource, image_path, mime = self._edit_resource(context, arguments)
                    with image_path.open("rb") as image_stream:
                        response = client.post(
                            f"{base_url}/images/edits", headers=headers,
                            data={"model": upstream_model_id, "prompt": prompt, "size": size, "n": "1", "response_format": "b64_json"},
                            files={"image": (Path(str(resource["reference"])).name, image_stream, mime)},
                        )
                response.raise_for_status()
                payload = response.json()
        except (httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            raise RuntimeExecutionError("image_provider_timeout", "Image Provider request timed out.", retryable=True) from exc
        except httpx.TimeoutException as exc:
            raise RuntimeExecutionError(
                "side_effect_outcome_unknown",
                "The image request may have reached the Provider; automatic retry is blocked.",
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            code = "model_unauthorized" if status in {401, 403} else "image_provider_rejected"
            raise RuntimeExecutionError(code, "Image Provider rejected the operation.", retryable=status >= 500) from exc
        except httpx.HTTPError as exc:
            raise RuntimeExecutionError(
                "side_effect_outcome_unknown",
                "The image request outcome could not be confirmed; automatic retry is blocked.",
            ) from exc
        except ValueError as exc:
            raise RuntimeExecutionError("image_provider_invalid_response", "Image Provider returned an invalid response.") from exc

        return self._decode_result(payload)

    @staticmethod
    def _resolve_declared_model(operation: str):
        config = load_user_config()
        policy = load_agent_model_policy(current_agent_name()).policy
        selection = policy.image_generation_model or policy.image_model
        if selection is None or selection.ref is None:
            raise RuntimeExecutionError("image_model_unconfigured", "Select a declared image model before using this tool.")
        ref = selection.ref
        configured = config.providers.get(ref.provider_id)
        declared = set(configured.model_operations.get(ref.model_id, ())) if configured else set()
        if configured and ref.model_id in configured.model_configs:
            declared.update(operation for operation in configured.model_configs[ref.model_id].capabilities if operation in {"image_generation", "image_edit"})
        if operation not in declared:
            raise RuntimeExecutionError(
                "image_operation_unsupported", "The selected image model does not declare this operation."
            )
        try:
            resolved = resolve_model_ref(
                config, provider_id=ref.provider_id, model_id=ref.model_id, require_credentials=False,
            )
        except ModelProviderConfigError as exc:
            raise RuntimeExecutionError("image_model_unavailable", "The selected image model is unavailable.") from exc
        return resolved, ref.provider_id, ref.model_id

    @staticmethod
    def _edit_resource(
        context: RuntimeRunContext, arguments: Mapping[str, Any],
    ) -> tuple[Mapping[str, Any], Path, str]:
        resource_id = str(arguments.get("resource_id") or "").strip()
        candidates = [
            item for item in context.input_resources
            if item.get("kind") == "file" and str(item.get("mime") or "").startswith("image/")
        ]
        resource = (
            next((item for item in candidates if item.get("resource_id") == resource_id), None)
            if resource_id else candidates[0] if len(candidates) == 1 else None
        )
        if resource is None or resource.get("kind") != "file" or not str(resource.get("mime") or "").startswith("image/"):
            raise RuntimeExecutionError("image_edit_resource_invalid", "Image editing requires an attached image resource ID.")
        try:
            evidence = inspect_native_image_resources([resource], workspace_path=context.workspace_path)
            if len(evidence["resources"]) != 1:
                raise ValueError("attached resource is not a supported image")
            target = resolve_workspace_path(context.workspace_path, str(resource["reference"]), strict=True)
        except (KeyError, WorkspacePathError, OSError, ValueError) as exc:
            raise RuntimeExecutionError("image_edit_resource_invalid", "The attached image is unavailable.") from exc
        if not target.is_file():
            raise RuntimeExecutionError("image_edit_resource_invalid", "The attached image is unavailable.")
        return resource, target, str(resource["mime"])

    @staticmethod
    def _decode_result(payload: object) -> tuple[bytes, str]:
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list) or not payload["data"]:
            raise RuntimeExecutionError("image_provider_invalid_response", "Image Provider returned no image data.")
        first = payload["data"][0]
        encoded = first.get("b64_json") if isinstance(first, dict) else None
        if not isinstance(encoded, str) or not encoded or len(encoded) > MAX_IMAGE_RESULT_BYTES * 2:
            raise RuntimeExecutionError("image_provider_invalid_response", "Image Provider did not return bounded base64 image data.")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise RuntimeExecutionError("image_provider_invalid_response", "Image Provider image data is invalid.") from exc
        if not content or len(content) > MAX_IMAGE_RESULT_BYTES:
            raise RuntimeExecutionError("image_result_too_large", "Generated image exceeds the Runtime artifact limit.")
        return RuntimeImageOperationAdapter._validate_image_content(content, "")

    @staticmethod
    def _validate_image_content(content: bytes, declared_mime: str) -> tuple[bytes, str]:
        try:
            with PILImage.open(BytesIO(content)) as image:
                width, height = image.size
                if (
                    width <= 0 or height <= 0
                    or width > MAX_NATIVE_IMAGE_DIMENSION or height > MAX_NATIVE_IMAGE_DIMENSION
                    or width * height > MAX_NATIVE_IMAGE_PIXELS
                ):
                    raise ValueError("generated image dimensions exceed Runtime limits")
                image.verify()
                image_format = str(image.format or "").upper()
        except Exception as exc:
            raise RuntimeExecutionError("image_provider_invalid_response", "Generated image could not be decoded.") from exc
        mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}.get(image_format)
        if mime is None:
            raise RuntimeExecutionError("image_provider_invalid_response", "Generated image format is unsupported.")
        if declared_mime and declared_mime != mime:
            raise RuntimeExecutionError("image_provider_invalid_response", "Generated image MIME type does not match its content.")
        return content, mime
