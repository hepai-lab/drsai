from __future__ import annotations

from pathlib import Path
import hashlib
import asyncio
from types import SimpleNamespace

import pytest

from autogen_agentchat.messages import MultiModalMessage
from autogen_core import Image
from autogen_core.models import UserMessage
from autogen_ext.models.anthropic._anthropic_client import to_anthropic_type
from PIL import Image as PILImage

from drsai.backend.runtime.input_resources import (
    MAX_NATIVE_IMAGE_BYTES,
    autogen_input_task,
    codex_input_items,
    inspect_native_image_resources,
    normalize_input_resources,
)
from drsai.modules.baseagent.drsaiagent import DrSaiAgent


def resource(resource_id: str, kind: str, **values):
    result = {
        "protocol": "oaep.input/1", "resource_id": resource_id, "kind": kind,
        "name": values.pop("name", resource_id), **values,
    }
    if kind in {"selection", "terminal", "browser"}:
        result.setdefault("captured_at", "2026-08-05T00:00:00Z")
    return result


def test_all_five_input_resource_kinds_are_explicit_and_codex_encodable(tmp_path: Path) -> None:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "readme.md").write_text("hello", encoding="utf-8")
    PILImage.new("RGB", (1, 1), "white").save(tmp_path / "proof.png")
    proof = (tmp_path / "proof.png").read_bytes()
    values = [
        resource("file", "file", reference="docs/readme.md", mime="text/markdown", size_bytes=5,
                 sha256=hashlib.sha256(b"hello").hexdigest()),
        resource("image", "file", reference="proof.png", mime="image/png", size_bytes=len(proof)),
        resource("folder", "folder", reference="docs"),
        resource("selection", "selection", content="selected text"),
        resource("terminal", "terminal", content="test output"),
        resource("browser", "browser", content="visible page", url="https://example.invalid", title="Example"),
    ]
    normalized = normalize_input_resources(values)
    assert {value["kind"] for value in normalized} == {"file", "folder", "selection", "terminal", "browser"}
    items = codex_input_items("prompt", normalized, workspace_path=tmp_path)
    assert [item["type"] for item in items] == ["text", "mention", "localImage", "mention", "text", "text", "text"]
    assert "selected text" in items[4]["text"]
    assert "https://example.invalid" in items[-1]["text"]


@pytest.mark.parametrize("value", [
    [resource("x", "future", content="x")],
    [resource("x", "file", reference="../outside")],
    [resource("x", "file", reference="C:/outside")],
    [resource("x", "browser")],
    [resource("x", "selection", content="x"), resource("x", "terminal", content="y")],
])
def test_invalid_or_unsupported_resources_are_rejected_instead_of_dropped(value) -> None:
    with pytest.raises(ValueError):
        normalize_input_resources(value)


def test_resource_content_and_count_are_bounded() -> None:
    with pytest.raises(ValueError, match="content exceeds"):
        normalize_input_resources([resource("large", "selection", content="x" * 100_001)])
    with pytest.raises(ValueError, match="cannot exceed"):
        normalize_input_resources([resource(f"r{i}", "selection", content="x") for i in range(33)])


def test_file_identity_is_rechecked_at_codex_encoding_time(tmp_path: Path) -> None:
    target = tmp_path / "note.txt"
    target.write_text("first", encoding="utf-8")
    value = resource(
        "file", "file", reference="note.txt", size_bytes=5,
        sha256=hashlib.sha256(b"first").hexdigest(),
    )
    target.write_text("other", encoding="utf-8")
    with pytest.raises(ValueError, match="changed after"):
        codex_input_items("prompt", [value], workspace_path=tmp_path)


def test_symlink_escape_is_rejected_at_final_resolution(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside.txt"
    outside.write_text("secret", encoding="utf-8")
    link = tmp_path / "link.txt"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlink creation is unavailable on this Windows host")
    with pytest.raises(ValueError, match="outside the workspace"):
        codex_input_items("prompt", [resource("link", "file", reference="link.txt")], workspace_path=tmp_path)


def test_context_lifecycle_and_authorization_are_explicit() -> None:
    with pytest.raises(ValueError, match="capture timestamp"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "selection", "kind": "selection",
            "name": "selection", "content": "text",
        }])
    with pytest.raises(ValueError, match="not authorized"):
        normalize_input_resources([resource("selection", "selection", content="text", permission="write")])


def test_opendrsai_autogen_encoding_reuses_oaep_resources_and_preserves_images(tmp_path: Path) -> None:
    PILImage.new("RGB", (2, 2), "white").save(tmp_path / "proof.png")
    image = (tmp_path / "proof.png").read_bytes()
    task = autogen_input_task("describe", [
        resource("image", "file", reference="proof.png", mime="image/png", size_bytes=len(image),
                 sha256=hashlib.sha256(image).hexdigest()),
        resource("selection", "selection", content="visible error code P3-TRACE-42"),
    ], workspace_path=tmp_path)
    assert isinstance(task, MultiModalMessage)
    assert task.content[0] == "describe"
    assert "resource_id=image" in task.content[1]
    assert task.content[2].to_base64()
    assert "P3-TRACE-42" in task.content[3]


def test_opendrsai_autogen_encoding_hides_trusted_regression_control_from_model(tmp_path: Path) -> None:
    task = autogen_input_task("run case", [resource(
        "regression-control", "selection",
        name="OpenDrSai regression control",
        content='{"schema_version":"opendrsai.regression-control/1","successful_result":"SECRET"}',
    )], workspace_path=tmp_path)
    assert isinstance(task, MultiModalMessage)
    assert task.content == ["run case"]


def test_opendrsai_autogen_encoding_rechecks_staged_file_identity(tmp_path: Path) -> None:
    target = tmp_path / "note.txt"
    target.write_text("changed", encoding="utf-8")
    with pytest.raises(ValueError, match="changed after"):
        autogen_input_task("read", [resource(
            "file", "file", reference="note.txt", size_bytes=5,
            sha256=hashlib.sha256(b"first").hexdigest(),
        )], workspace_path=tmp_path)


def test_native_image_preflight_returns_only_safe_evidence(tmp_path: Path) -> None:
    PILImage.new("RGB", (3, 2), "red").save(tmp_path / "proof.png")
    body = (tmp_path / "proof.png").read_bytes()
    evidence = inspect_native_image_resources([resource(
        "image", "file", reference="proof.png", mime="image/png", size_bytes=len(body),
        sha256=hashlib.sha256(body).hexdigest(),
    )], workspace_path=tmp_path)
    assert evidence["image_count"] == 1
    assert evidence["mime_types"] == ["image/png"]
    assert evidence["resources"][0]["width"] == 3
    serialized = str(evidence)
    assert str(tmp_path) not in serialized
    assert "proof.png" not in serialized
    assert "base64" not in serialized


def test_native_image_preflight_rejects_corruption_mime_mismatch_and_oversize(tmp_path: Path) -> None:
    (tmp_path / "broken.png").write_bytes(b"not an image")
    with pytest.raises(ValueError, match="corrupt"):
        inspect_native_image_resources([
            resource("broken", "file", reference="broken.png", mime="image/png")
        ], workspace_path=tmp_path)

    PILImage.new("RGB", (1, 1), "white").save(tmp_path / "mismatch.png")
    with pytest.raises(ValueError, match="MIME"):
        inspect_native_image_resources([
            resource("mismatch", "file", reference="mismatch.png", mime="image/jpeg")
        ], workspace_path=tmp_path)

    oversized = tmp_path / "large.png"
    oversized.write_bytes(b"\x89PNG\r\n\x1a\n")
    oversized.write_bytes(oversized.read_bytes() + b"\0" * (MAX_NATIVE_IMAGE_BYTES + 1))
    with pytest.raises(ValueError, match="limit"):
        inspect_native_image_resources([
            resource("large", "file", reference="large.png", mime="image/png")
        ], workspace_path=tmp_path)


def test_native_image_without_declared_mime_still_uses_multimodal_message(tmp_path: Path) -> None:
    PILImage.new("RGB", (1, 1), "white").save(tmp_path / "camera-upload.bin", format="PNG")
    task = autogen_input_task("describe", [
        resource("image", "file", reference="camera-upload.bin"),
    ], workspace_path=tmp_path)
    assert isinstance(task, MultiModalMessage)
    assert "resource_id=image" in task.content[1]
    assert task.content[2].to_base64()


def test_openai_and_anthropic_adapters_receive_native_image_blocks(tmp_path: Path) -> None:
    PILImage.new("RGB", (1, 1), "white").save(tmp_path / "proof.png")
    native = Image.from_file(tmp_path / "proof.png")
    message = UserMessage(content=["describe", native], source="user")

    agent = object.__new__(DrSaiAgent)
    openai_messages = asyncio.run(agent.llm_messages2oai_messages([message]))
    assert openai_messages[0]["content"][0] == {"type": "text", "text": "describe"}
    assert openai_messages[0]["content"][1]["type"] == "image_url"
    assert openai_messages[0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")

    anthropic_message = to_anthropic_type(message)
    blocks = anthropic_message[0]["content"] if isinstance(anthropic_message, list) else anthropic_message["content"]
    image_block = next(block for block in blocks if block["type"] == "image")
    assert image_block["source"]["type"] == "base64"
    assert image_block["source"]["media_type"] == "image/png"


def test_nonvision_context_rejects_image_instead_of_silently_removing_it(tmp_path: Path) -> None:
    PILImage.new("RGB", (1, 1), "white").save(tmp_path / "proof.png")
    message = UserMessage(content=["describe", Image.from_file(tmp_path / "proof.png")], source="user")
    with pytest.raises(ValueError, match="does not support vision"):
        DrSaiAgent._get_compatible_context(SimpleNamespace(model_info={"vision": False}), [message])
    assert DrSaiAgent._get_compatible_context(SimpleNamespace(model_info={"vision": True}), [message]) == [message]
