from __future__ import annotations

import base64
from pathlib import Path

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_set_run_input_records_oaep_image_part_and_input_evidence(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "shot.png").write_bytes(PNG)
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-image-input", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    # Bind workspace path through a thin registry stub used by artifact/workspace helpers.
    engine._workspace_root = lambda _workspace_id: str(workspace)  # type: ignore[attr-defined]
    session = engine.create_session("workspace-one", "Image input")
    run, _ = engine.create_run(session["session_id"], "opendrsai@1", "image-input", "opendrsai")
    digest = "b3742a0f7997e8ef07fdba9fee167a4141088b5da779cc08056ae82c333e7919"
    engine.set_run_input(
        run["run_id"],
        "Diagnose this screenshot",
        attachment_refs=["shot.png"],
        input_resources=[{
            "protocol": "oaep.input/1",
            "resource_id": "attachment-1",
            "kind": "file",
            "name": "attachment-01.png",
            "reference": "shot.png",
            "mime": "image/png",
            "sha256": digest,
            "permission": "read",
            "status": "encoded",
        }],
        evidence={
            "attachments": [{
                "type": "image",
                "mime_type": "image/png",
                "sha256": digest,
                "width": 1598,
                "height": 1021,
                "resource_id": "attachment-1",
            }],
            "input_evidence": {
                "attachments": [{
                    "type": "image",
                    "mime_type": "image/png",
                    "sha256": digest,
                    "width": 1598,
                    "height": 1021,
                    "resource_id": "attachment-1",
                }],
                "require_manifest_reference": True,
                "require_oaep_user_message_part": True,
                "forbid_ocr_text_injection": True,
            },
        },
    )
    inspection = engine.inspect_run(run["run_id"])
    evidence = inspection["input_evidence"]
    assert evidence["require_manifest_reference"] is True
    assert evidence["require_oaep_user_message_part"] is True
    assert evidence["forbid_ocr_text_injection"] is True
    assert evidence["attachments"][0]["mime_type"] == "image/png"
    assert evidence["attachments"][0]["sha256"] == digest
    assert evidence["attachments"][0]["width"] == 1598

    user_items = [
        item for item in inspection["timeline"]
        if item.get("type") == "message"
        and (item.get("content") or {}).get("role") == "user"
    ]
    assert user_items
    parts = user_items[0]["content"]["parts"]
    assert any(part.get("type") == "text" for part in parts)
    image_parts = [part for part in parts if part.get("type") == "image"]
    assert len(image_parts) == 1
    assert image_parts[0]["mime_type"] == "image/png"
    assert image_parts[0]["resource_id"] == "attachment-1"
    assert image_parts[0]["sha256"] == digest
