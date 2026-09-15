"""Input-resource bounds must fail loudly, never silently.

Two defects met here.

First, ``apps/desktop`` inlined the Base64 data URL of every native image into
``input_resources[].content``.  The Runtime never reads ``content`` for ``file``
resources -- ``_append_autogen_resource`` builds the ``MultiModalMessage`` from
``reference`` through ``Image.from_file`` and ``_append_codex_resource`` emits a
``localImage`` path -- while ``normalize_input_resources`` bounded that dead
field at ``MAX_RESOURCE_CONTENT_CHARS`` (100 000 characters).  Base64 inflates
bytes by 4/3, so any attachment larger than roughly 75 KB made
``POST /v1/runs/{run_id}/execute`` answer ``422 Unprocessable Entity`` and the
Desktop kept waiting for a terminal OAEP event that could never arrive.
Measured on real Sessions: ``.opendrsai/attachments/run-35d53e33.../image.png``
was 118 945 bytes = 158 618 content characters and 422'd, while a 41 862-byte
image = 55 838 characters succeeded.  That is why the failure looked like a
turn-parity bug ("the second turn always fails") when it was an
attachment-size bug.  The Desktop no longer sends the field at all.

Second, and the reason this file exists in this shape: a bound that is only
enforced on some paths, or that downgrades instead of failing, turns a client
bug into a mystery.  Every over-limit input must be rejected with an explicit,
actionable error on every path: the per-resource and per-request ``content``
bounds, and the per-image and per-request native image byte bounds.  The total
image budget used to be enforced only by ``inspect_native_image_resources``
(the vision/evidence path), so the Agent delivery path could hand an unbounded
number of individually legal images to the model.

The tests pin that contract:

* an over-limit payload raises ``ValueError`` naming the bound, on the
  normalization path and on the ``POST /v1/runs/{run_id}/execute`` route (422),
* ``file``/``folder`` still require a valid workspace reference, and
  ``selection``/``terminal``/``browser`` still require explicit ``content``,
* a within-limit legacy payload executes, and the duplicated Base64 is not
  persisted into the durable Run input,
* images that are each legal but together exceed the total budget are rejected
  by ``autogen_input_task``, ``codex_input_items`` and
  ``inspect_native_image_resources``,
* the rejection the Desktop finally shows keeps the actionable text for
  Runtime-authored ``ValueError``s and the stable generic text for ``OSError``s
  (whose messages can embed an absolute path),
* remote attachments name the cause that failed -- missing name, oversized
  file, oversized total -- instead of one shared "too large" message.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException

from drsai.backend.desktop_gateway import _state
from drsai.backend.desktop_gateway._models import (
    RunCreateRequest,
    RunExecuteRequest,
    SessionCreateRequest,
    WorkspaceOpenRequest,
)
from drsai.backend.desktop_gateway.routes import runs as runs_routes
from drsai.backend.desktop_gateway.routes import sessions as sessions_routes
from drsai.backend.desktop_gateway.routes import workspaces as workspaces_routes
from drsai.backend.runtime import input_resources as input_resources_module
from drsai.backend.runtime.input_resources import (
    MAX_RESOURCE_CONTENT_CHARS,
    MAX_TOTAL_RESOURCE_CONTENT_CHARS,
    autogen_input_task,
    codex_input_items,
    input_resource_error_message,
    inspect_native_image_resources,
    normalize_input_resources,
)

ATTACHMENT_DIR = Path(".opendrsai") / "attachments" / "run-regression"
CAPTURED_AT = "2026-09-15T00:00:00+00:00"


def _noisy_png(width: int, height: int) -> bytes:
    """A real PNG whose size is dominated by pixels, not container overhead."""
    import os

    from PIL import Image as PILImage

    frame = PILImage.frombytes("RGB", (width, height), os.urandom(width * height * 3))
    buffer = io.BytesIO()
    frame.save(buffer, format="PNG", compress_level=0)
    return buffer.getvalue()


def _write_noisy_png(path: Path, width: int, height: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_noisy_png(width, height))
    return path


def _staged_image_resource(
    workspace: Path,
    *,
    name: str = "image.png",
    width: int = 256,
    height: int = 256,
    inline_content: bool = True,
) -> tuple[dict[str, Any], str | None]:
    """Stage one image inside the Workspace the way ``stageAttachments`` does."""
    target = _write_noisy_png(workspace / ATTACHMENT_DIR / name, width, height)
    payload = target.read_bytes()
    resource: dict[str, Any] = {
        "protocol": "oaep.input/1",
        "resource_id": f"attachment-{Path(name).stem}",
        "kind": "file",
        "name": name,
        "permission": "read",
        "status": "encoded",
        "reference": f"{ATTACHMENT_DIR.as_posix()}/{name}",
        "size_bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "mime": "image/png",
    }
    if not inline_content:
        return resource, None
    data_url = f"data:image/png;base64,{base64.b64encode(payload).decode('ascii')}"
    return {**resource, "content": data_url}, data_url


# ── The content bound is enforced, and never silently swallowed ──────────────


def test_an_oversized_image_data_url_is_rejected_with_an_explicit_error(tmp_path: Path) -> None:
    # The exact payload shape the Desktop used to send: the inline Base64 of the
    # whole image. It must fail loudly instead of being dropped, otherwise the
    # client believes the bytes travelled.
    resource, data_url = _staged_image_resource(tmp_path)
    assert data_url is not None and len(data_url) > MAX_RESOURCE_CONTENT_CHARS

    with pytest.raises(ValueError, match=r"content exceeds its limit of 100000 characters"):
        normalize_input_resources([resource])


def test_a_plain_file_resource_with_oversized_content_is_rejected_too() -> None:
    # ``content`` is dead for every file resource, not only for images: the
    # bound still applies, because the field must not become an unmeasured
    # side channel.
    with pytest.raises(ValueError, match=r"content exceeds its limit"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "attachment-1", "kind": "file",
            "name": "notes.txt", "reference": "notes.txt",
            "content": "x" * (MAX_RESOURCE_CONTENT_CHARS + 1),
        }])


def test_a_within_limit_legacy_payload_executes_without_persisting_content(tmp_path: Path) -> None:
    # Compatibility: a payload from a Desktop build that still inlines a small
    # data URL must keep working, and the duplicated bytes must not be stored.
    resource, data_url = _staged_image_resource(tmp_path, width=64, height=64)
    assert data_url is not None and len(data_url) < MAX_RESOURCE_CONTENT_CHARS

    normalized = normalize_input_resources([resource])

    assert len(normalized) == 1
    assert "content" not in normalized[0]
    assert normalized[0]["reference"] == resource["reference"]
    assert normalized[0]["sha256"] == resource["sha256"]
    assert normalized[0]["mime"] == "image/png"


def test_selection_content_keeps_the_anti_abuse_bound() -> None:
    # ``selection``/``terminal``/``browser`` really are transported as text, so
    # the per-resource and per-request bounds must stay enforced.
    with pytest.raises(ValueError, match=r"content exceeds its limit"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "attachment-1", "kind": "selection",
            "name": "Selected text", "content": "x" * (MAX_RESOURCE_CONTENT_CHARS + 1),
            "captured_at": CAPTURED_AT,
        }])
    with pytest.raises(ValueError, match=r"input_resources content exceeds the request limit"):
        normalize_input_resources([
            {
                "protocol": "oaep.input/1", "resource_id": f"attachment-{index}", "kind": "selection",
                "name": f"Selected text {index}", "content": "x" * MAX_RESOURCE_CONTENT_CHARS,
                "captured_at": CAPTURED_AT,
            }
            for index in range(3)
        ])
    assert MAX_TOTAL_RESOURCE_CONTENT_CHARS == 2 * MAX_RESOURCE_CONTENT_CHARS


def test_the_reference_and_content_contract_is_unchanged() -> None:
    with pytest.raises(ValueError, match=r"invalid workspace reference"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "attachment-1", "kind": "file",
            "name": "image.png", "reference": "", "content": "data:image/png;base64,AAAA",
        }])
    with pytest.raises(ValueError, match=r"invalid workspace reference"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "attachment-1", "kind": "file",
            "name": "image.png", "reference": "../escape.png",
        }])
    with pytest.raises(ValueError, match=r"requires explicit content"):
        normalize_input_resources([{
            "protocol": "oaep.input/1", "resource_id": "attachment-1", "kind": "terminal",
            "name": "Terminal output", "captured_at": CAPTURED_AT,
        }])


# ── The total image budget is enforced on every delivery path ────────────────


def _delivery_fixture(tmp_path: Path) -> tuple[dict[str, Any], dict[str, Any], int]:
    """Two individually legal images whose sum trips a deliberately low budget."""
    first, _ = _staged_image_resource(tmp_path, name="one.png", width=8, height=8)
    second, _ = _staged_image_resource(tmp_path, name="two.png", width=8, height=8)
    total = int(first["size_bytes"]) + int(second["size_bytes"])
    assert 0 < int(first["size_bytes"]) < total
    return first, second, total


def test_images_over_the_total_budget_are_rejected_on_the_delivery_path(
    tmp_path: Path, monkeypatch,
) -> None:
    first, second, total = _delivery_fixture(tmp_path)
    monkeypatch.setattr(input_resources_module, "MAX_TOTAL_NATIVE_IMAGE_BYTES", total - 1)

    # Each image alone is fine; the accumulated total is what must fail.
    assert autogen_input_task("one", [first], workspace_path=tmp_path) is not None
    assert codex_input_items("one", [first], workspace_path=tmp_path)

    for encode in (
        lambda: autogen_input_task("both", [first, second], workspace_path=tmp_path),
        lambda: codex_input_items("both", [first, second], workspace_path=tmp_path),
        lambda: inspect_native_image_resources([first, second], workspace_path=tmp_path),
    ):
        with pytest.raises(ValueError, match=r"exceed the \d+-byte total limit"):
            encode()


def test_the_total_budget_is_not_bypassed_by_input_parts(tmp_path: Path, monkeypatch) -> None:
    # ``input_parts`` reorders the same resources; it must not admit any twice or
    # escape the budget.
    first, second, total = _delivery_fixture(tmp_path)
    monkeypatch.setattr(input_resources_module, "MAX_TOTAL_NATIVE_IMAGE_BYTES", total - 1)

    parts = [
        {"type": "text", "text": "look at both"},
        {"type": "resource", "resource_id": first["resource_id"]},
        {"type": "resource", "resource_id": second["resource_id"]},
    ]
    with pytest.raises(ValueError, match=r"total limit"):
        autogen_input_task("both", [first, second], workspace_path=tmp_path, input_parts=parts)


# ── The actionable rejection reaches the Desktop ─────────────────────────────


def test_the_rejection_keeps_actionable_text_and_hides_oserror_paths(tmp_path: Path) -> None:
    assert input_resource_error_message(
        ValueError("native image dimensions exceed the supported limit"),
    ) == "An input resource is invalid: native image dimensions exceed the supported limit."
    # ``OSError`` text from ``Path.resolve(strict=True)`` embeds an absolute path,
    # so it must keep the stable wording.
    assert input_resource_error_message(
        FileNotFoundError(2, "The system cannot find the file specified", "C:/secret/path.png"),
    ) == "An input resource is unavailable, changed, or cannot be decoded."


def test_delivery_keeps_using_the_workspace_reference(tmp_path: Path) -> None:
    resource, _ = _staged_image_resource(tmp_path, width=64, height=64)

    task = autogen_input_task("describe the image", [resource], workspace_path=tmp_path)

    from autogen_core import Image as AutogenImage

    assert any(isinstance(part, AutogenImage) for part in task.content)
    assert any(f"resource_id={resource['resource_id']}" in str(part) for part in task.content)

    items = codex_input_items("describe the image", [resource], workspace_path=tmp_path)
    images = [item for item in items if item.get("type") == "localImage"]
    assert len(images) == 1
    assert Path(str(images[0]["path"])).resolve() == (
        tmp_path / ATTACHMENT_DIR / "image.png"
    ).resolve()


# ── The execute route: 422 with an explicit detail, or a real Run ────────────


@pytest.fixture()
def state_root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    _state.reset_state()
    yield tmp_path
    _state.reset_state()


class _CapturingAgentService:
    """Records the arguments ``run_execute`` would hand to the Agent."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def execute(self, run_id, prompt, correlation_id, **kwargs):
        self.calls.append({"run_id": run_id, "prompt": prompt, **kwargs})
        return {"run_id": run_id, "status": "completed"}


def _install_capture(monkeypatch) -> _CapturingAgentService:
    service = _CapturingAgentService()
    monkeypatch.setattr(_state, "agent_service", lambda: service)
    monkeypatch.setattr(runs_routes._auth, "auth_context", lambda _request: None)
    monkeypatch.setattr(runs_routes._auth, "correlation_id", lambda _request: "test-correlation")
    return service


def _open_run(state_root: Path, *, key: str) -> tuple[str, Path]:
    workspace = state_root / "ws"
    workspace.mkdir(parents=True, exist_ok=True)
    opened = asyncio.run(workspaces_routes.workspace_open(
        WorkspaceOpenRequest(path=str(workspace), display_name="Image attachment"),
    ))
    session = asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        workspace_id=opened["workspace_id"], title="Image attachment",
    )))
    run = json.loads(asyncio.run(runs_routes.run_create(
        session["session_id"], RunCreateRequest(), idempotency_key_header=key,
    )).body)
    return str(run["run_id"]), workspace


def test_the_execute_route_rejects_an_oversized_payload_with_an_explicit_detail(
    monkeypatch, state_root: Path,
) -> None:
    service = _install_capture(monkeypatch)
    run_id, workspace = _open_run(state_root, key="oversized-image-content")
    resource, _ = _staged_image_resource(workspace)

    with pytest.raises(HTTPException) as raised:
        asyncio.run(runs_routes.run_execute(run_id, RunExecuteRequest(
            prompt="describe the image",
            metadata={"input_resources": [resource], "attachment_refs": [resource["reference"]]},
        ), None, wait=True))

    # 422 used to be the *only* symptom: an unexplained Unprocessable Entity. It
    # must now name the bound that was exceeded, and no Agent work may start.
    assert raised.value.status_code == 422
    assert "content exceeds its limit of 100000 characters" in str(raised.value.detail)
    assert service.calls == []


def test_the_execute_route_runs_a_within_limit_legacy_payload(
    monkeypatch, state_root: Path,
) -> None:
    service = _install_capture(monkeypatch)
    run_id, workspace = _open_run(state_root, key="within-limit-image-content")
    resource, _ = _staged_image_resource(workspace, width=64, height=64)

    asyncio.run(runs_routes.run_execute(run_id, RunExecuteRequest(
        prompt="describe the image",
        metadata={"input_resources": [resource], "attachment_refs": [resource["reference"]]},
    ), None, wait=True))

    assert [call["run_id"] for call in service.calls] == [run_id]
    persisted = _state.runtime_engine().get_run(run_id)
    assert persisted["input_resources"][0]["reference"] == resource["reference"]
    # The durable Run input stays free of the duplicated Base64.
    assert "content" not in persisted["input_resources"][0]
    assert persisted["input_message"] == "describe the image"


# ── Remote attachments report the limit that actually failed ─────────────────


def _remote_file(name: str, size: int) -> dict[str, Any]:
    return {"name": name, "base64": base64.b64encode(b"x" * size).decode("ascii")}


def test_remote_files_report_the_limit_that_was_exceeded(monkeypatch) -> None:
    from drsai.backend.runtime.agent import RuntimeExecutionError

    monkeypatch.setattr(runs_routes, "_REMOTE_FILE_MAX_BYTES", 2 * 1024 * 1024)

    with pytest.raises(RuntimeExecutionError) as missing_name:
        runs_routes._remote_payloads({"remote_files": [{"base64": base64.b64encode(b"x").decode("ascii")}]})
    assert missing_name.value.code == "remote_files_invalid"
    assert "requires a name" in missing_name.value.message

    with pytest.raises(RuntimeExecutionError) as invalid_base64:
        runs_routes._remote_payloads({"remote_files": [{"name": "a.bin", "base64": "***"}]})
    assert invalid_base64.value.code == "remote_files_invalid"
    assert "invalid Base64" in invalid_base64.value.message

    with pytest.raises(RuntimeExecutionError) as per_file:
        runs_routes._remote_payloads({"remote_files": [_remote_file("big.bin", 3 * 1024 * 1024)]})
    assert per_file.value.code == "remote_file_too_large"
    assert "big.bin exceeds the 2 MB remote attachment limit" in per_file.value.message

    # Two files that are individually legal but together oversized.
    with pytest.raises(RuntimeExecutionError) as total:
        runs_routes._remote_payloads({"remote_files": [
            _remote_file("a.bin", 1_500_000), _remote_file("b.bin", 1_500_000),
        ]})
    assert total.value.code == "remote_file_too_large"
    assert "10 MB in total" in total.value.message

    accepted, _ = runs_routes._remote_payloads({"remote_files": [
        _remote_file("a.bin", 10), _remote_file("b.bin", 10),
    ]})
    assert [item["name"] for item in accepted] == ["a.bin", "b.bin"]
