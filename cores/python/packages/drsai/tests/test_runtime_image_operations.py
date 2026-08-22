from __future__ import annotations

import base64
import hashlib
import threading
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.image_operations import RuntimeImageOperationAdapter
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class ArtifactStore:
    def __init__(self):
        self.published = []

    def publish(self, context, arguments):
        content = (context.workspace_path / arguments["path"]).read_bytes()
        display_name = arguments["display_name"]
        mime_type = arguments["mime_type"]
        self.published.append((context, content, display_name, mime_type))
        return {
            "artifact_id": "artifact-1", "display_name": display_name, "relative_path": arguments["path"],
            "mime_type": mime_type, "sha256": hashlib.sha256(content).hexdigest(),
        }


class Response:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class Client:
    def __init__(self, payload, calls):
        self.payload = payload
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return Response(self.payload)


def context(workspace: Path, resources=()):
    return SimpleNamespace(
        workspace_path=workspace, workspace_id="workspace-a", session_id="session-a",
        run_id="run-a", input_resources=tuple(resources),
    )


def adapter(monkeypatch, payload):
    calls = []
    artifacts = ArtifactStore()
    events = []
    instance = RuntimeImageOperationAdapter(artifacts, lambda *args: events.append(args))
    resolved = SimpleNamespace(
        model="vendor/image-v2",
        provider=SimpleNamespace(
            wire_api="openai", requires_api_key=False, base_url="https://images.example/v1",
            api_key=None,
        ),
    )
    monkeypatch.setattr(instance, "_resolve_declared_model", lambda _operation: (resolved, "provider-a", "image-model"))
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.httpx.Client",
        lambda **_kwargs: Client(payload, calls),
    )
    monkeypatch.setattr("drsai.backend.runtime.image_operations.get_model_credential_provider", lambda *_args: None)
    return instance, artifacts, events, calls


def test_generation_uses_exact_model_route_and_publishes_bounded_artifact(tmp_path, monkeypatch) -> None:
    instance, artifacts, events, calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )

    result = instance.generate(context(tmp_path), {"prompt": "draw a moon", "size": "1024x1024"})

    assert calls == [("https://images.example/v1/images/generations", {
        "headers": {"Accept": "application/json"},
        "json": {"model": "vendor/image-v2", "prompt": "draw a moon", "size": "1024x1024", "n": 1, "response_format": "b64_json"},
    })]
    assert artifacts.published[0][1:] == (PNG, "opendrsai-image_generation.png", "image/png")
    assert (tmp_path / "artifacts" / "opendrsai-image_generation.png").read_bytes() == PNG
    assert events[0][1] == "artifact.created"
    assert result["model_ref"] == {"provider_id": "provider-a", "model_id": "image-model"}
    assert "b64_json" not in repr(result)


def test_generation_normalizes_provider_jpeg_when_png_was_requested(tmp_path, monkeypatch) -> None:
    encoded = BytesIO()
    PILImage.new("RGB", (8, 4), "navy").save(encoded, format="JPEG")
    instance, artifacts, _events, _calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(encoded.getvalue()).decode("ascii")}]},
    )

    result = instance.generate(context(tmp_path), {
        "prompt": "draw", "display_name": "requested.png", "size": "1536x1024",
    })

    assert result["mime_type"] == "image/png"
    assert result["relative_path"] == "artifacts/requested.png"
    assert artifacts.published[0][1].startswith(b"\x89PNG\r\n\x1a\n")


def test_generation_applies_controlled_visual_forbidden_constraints(tmp_path, monkeypatch) -> None:
    instance, _artifacts, _events, calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "image_constraints": {"forbidden": ["字母", "数字", "Logo", "水印"]},
    }
    resource = {"kind": "selection", "name": "OpenDrSai regression control", "content": __import__("json").dumps(control)}

    result = instance.generate(context(tmp_path, [resource]), {"prompt": "abstract runtime"})

    sent_prompt = calls[0][1]["json"]["prompt"]
    assert "Hard negative constraints" in sent_prompt
    assert "Never render the theme name" in sent_prompt
    assert result["applied_constraint_count"] == 4
    assert len(result["applied_constraints_sha256"]) == 64


def test_gemini_generation_uses_generate_content_and_publishes_artifact(tmp_path, monkeypatch) -> None:
    artifacts = ArtifactStore()
    instance = RuntimeImageOperationAdapter(artifacts, lambda *_args: None)
    resolved = SimpleNamespace(
        model="gemini-3.1-flash-lite-image",
        provider=SimpleNamespace(wire_api="gemini", requires_api_key=False, base_url="https://provider.example/google", api_key=None),
    )
    monkeypatch.setattr(instance, "_resolve_declared_model", lambda _operation: (resolved, "zhizengzeng", "gemini-3.1-flash-lite-image"))
    calls = []

    class Gemini:
        def create(self, bound, **kwargs):
            calls.append((bound, kwargs))
            return SimpleNamespace(images=(SimpleNamespace(content=PNG, mime_type="image/png"),))

    monkeypatch.setattr("drsai.backend.runtime.image_operations.GeminiGenerateContentAdapter", Gemini)
    result = instance.generate(context(tmp_path), {"prompt": "draw a compact blue orbit"})

    assert calls[0][1]["response_modalities"] == ("TEXT", "IMAGE")
    assert calls[0][0].model.model == "gemini-3.1-flash-lite-image"
    assert result["protocol"] == "gemini_generate_content"
    assert artifacts.published[0][1] == PNG


def test_edit_revalidates_attached_resource_and_uses_multipart(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.png"
    source.write_bytes(PNG)
    resource = {
        "protocol": "oaep.input/1", "resource_id": "image-1", "kind": "file",
        "name": "source.png", "reference": "source.png", "mime": "image/png",
        "size_bytes": len(PNG), "sha256": hashlib.sha256(PNG).hexdigest(),
        "permission": "read", "status": "encoded",
    }
    instance, artifacts, _events, calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )

    result = instance.edit(context(tmp_path, [resource]), {
        "prompt": "make it blue", "resource_id": "image-1", "size": "512x512",
    })

    assert calls[0][0] == "https://images.example/v1/images/edits"
    assert calls[0][1]["data"]["model"] == "vendor/image-v2"
    assert calls[0][1]["data"]["prompt"] == "make it blue"
    assert calls[0][1]["files"]["image"][0] == "source.png"
    assert result["operation"] == "image_edit"
    assert artifacts.published


def test_edit_uses_the_only_attached_image_without_forcing_resource_id(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.png"
    source.write_bytes(PNG)
    resource = {
        "protocol": "oaep.input/1", "resource_id": "image-1", "kind": "file",
        "name": "source.png", "reference": "source.png", "mime": "image/png",
        "size_bytes": len(PNG), "sha256": hashlib.sha256(PNG).hexdigest(),
        "permission": "read", "status": "encoded",
    }
    instance, _artifacts, _events, calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )

    instance.edit(context(tmp_path, [resource]), {"prompt": "make it blue"})

    assert calls[0][1]["files"]["image"][0] == "source.png"


@pytest.mark.parametrize("payload,code", [
    ({"data": [{"url": "https://untrusted.example/result.png"}]}, "image_provider_invalid_response"),
    ({"data": [{"b64_json": base64.b64encode(b"not-an-image").decode("ascii")}]}, "image_provider_invalid_response"),
])
def test_provider_output_fails_closed_without_artifact(tmp_path, monkeypatch, payload, code) -> None:
    instance, artifacts, events, _calls = adapter(monkeypatch, payload)

    with pytest.raises(RuntimeExecutionError) as error:
        instance.generate(context(tmp_path), {"prompt": "draw"})

    assert error.value.code == code
    assert artifacts.published == []
    assert events == []


def test_edit_rejects_changed_attachment_before_provider_call(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source.png"
    source.write_bytes(PNG)
    resource = {
        "protocol": "oaep.input/1", "resource_id": "image-1", "kind": "file",
        "name": "source.png", "reference": "source.png", "mime": "image/png",
        "size_bytes": len(PNG), "sha256": "0" * 64,
        "permission": "read", "status": "encoded",
    }
    instance, artifacts, events, calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )

    with pytest.raises(RuntimeExecutionError) as error:
        instance.edit(context(tmp_path, [resource]), {"prompt": "edit", "resource_id": "image-1"})

    assert error.value.code == "image_edit_resource_invalid"
    assert calls == [] and artifacts.published == [] and events == []


def test_custom_provider_credentials_do_not_get_replaced_by_platform_identity(tmp_path, monkeypatch) -> None:
    calls = []
    artifacts = ArtifactStore()
    instance = RuntimeImageOperationAdapter(artifacts, lambda *_args: None)
    resolved = SimpleNamespace(
        model="vendor/image-v2",
        provider=SimpleNamespace(
            wire_api="openai", requires_api_key=True, base_url="https://custom.example/v1",
            api_key=SimpleNamespace(reveal=lambda: "custom-secret"),
        ),
    )
    monkeypatch.setattr(instance, "_resolve_declared_model", lambda _operation: (resolved, "custom", "image-model"))
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.get_model_credential_provider",
        lambda *_args: (_ for _ in ()).throw(AssertionError("custom Provider must not use HepAI identity")),
    )
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.httpx.Client",
        lambda **_kwargs: Client(
            {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]}, calls,
        ),
    )

    instance.generate(context(tmp_path), {"prompt": "draw"})

    assert calls[0][0] == "https://custom.example/v1/images/generations"
    assert calls[0][1]["headers"]["Authorization"] == "Bearer custom-secret"


def test_hepai_image_generation_uses_request_scoped_oidc(tmp_path, monkeypatch) -> None:
    calls = []
    artifacts = ArtifactStore()
    instance = RuntimeImageOperationAdapter(artifacts, lambda *_args: None)
    resolved = SimpleNamespace(
        model="gemini-3.1-flash-lite-image",
        provider=SimpleNamespace(
            wire_api="openai", requires_api_key=False,
            base_url="https://configured.invalid/apiv2/v1", api_key=None,
        ),
    )
    monkeypatch.setattr(instance, "_resolve_declared_model", lambda _operation: (resolved, "hepai", "gemini-3.1-flash-lite-image"))
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.httpx.Client",
        lambda **_kwargs: Client(
            {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]}, calls,
        ),
    )
    auth = PlatformAuthContext(
        access_token="oidc-image-token",
        subject="user-1",
        issuer="https://issuer.example",
        expires_at=4_102_444_800,
        model_base_url="https://ai-dev.example/apiv2/v1",
    )

    with platform_auth_scope(auth):
        instance.generate(context(tmp_path), {"prompt": "draw"})

    assert calls[0][0] == "https://ai-dev.example/apiv2/v1/images/generations"
    assert calls[0][1]["headers"]["Authorization"] == "Bearer oidc-image-token"


def test_generation_declaration_does_not_implicitly_enable_edit(monkeypatch) -> None:
    config = parse_user_config({
        "model": "image", "model_provider": "custom",
        "model_providers": {"custom": {
            "base_url": "https://custom.example/v1", "wire_api": "openai",
            "requires_api_key": False, "models": ["image"],
            "model_operations": {"image": ["image_generation"]},
        }},
    })
    policy = AgentModelPolicy(
        "my-drsai", image_model=AgentModelSelection("explicit", ModelRef("custom", "image")),
    )
    monkeypatch.setattr("drsai.backend.runtime.image_operations.load_user_config", lambda: config)
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.load_agent_model_policy",
        lambda _agent_id: SimpleNamespace(policy=policy),
    )

    with pytest.raises(RuntimeExecutionError) as unsupported:
        RuntimeImageOperationAdapter._resolve_declared_model("image_edit")

    assert unsupported.value.code == "image_operation_unsupported"


def test_cancellation_after_provider_submission_never_publishes_artifact(tmp_path, monkeypatch) -> None:
    instance, artifacts, events, _calls = adapter(
        monkeypatch, {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]},
    )
    cancelled = threading.Event()

    class CancellingClient(Client):
        def post(self, url, **kwargs):
            response = super().post(url, **kwargs)
            cancelled.set()
            return response

    calls = []
    monkeypatch.setattr(
        "drsai.backend.runtime.image_operations.httpx.Client",
        lambda **_kwargs: CancellingClient(
            {"data": [{"b64_json": base64.b64encode(PNG).decode("ascii")}]}, calls,
        ),
    )

    with pytest.raises(RuntimeExecutionError) as error:
        instance.generate(context(tmp_path), {"prompt": "draw"}, cancelled)

    assert error.value.code == "side_effect_outcome_unknown"
    assert len(calls) == 1
    assert artifacts.published == [] and events == []
