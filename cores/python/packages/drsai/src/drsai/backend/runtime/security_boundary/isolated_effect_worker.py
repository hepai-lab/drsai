"""Trusted entry point executed inside the AppContainer effect worker."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .filesystem import WindowsWorkspaceFilesystem
from .models import canonical_digest
from .sandbox import SandboxError


def _canonical_bytes(value: dict[str, object]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def execute_request(request: dict[str, object], filesystem) -> dict[str, object]:
    operation = str(request.get("operation", ""))
    relative = str(request.get("relative_path", ""))
    try:
        if operation == "file.write":
            content = base64.b64decode(str(request["content_b64"]), validate=True)
            filesystem.atomic_write(relative, content)
            result = {
                "operation": operation,
                "relative_path_digest": canonical_digest(relative),
                "content_digest": "sha256:" + hashlib.sha256(content).hexdigest(),
                "size_bytes": len(content),
            }
        elif operation == "file.edit":
            content = base64.b64decode(str(request["result_content_b64"]), validate=True)
            filesystem.compare_and_swap(relative, str(request["source_content_digest"]), content)
            result = {
                "operation": operation,
                "relative_path_digest": canonical_digest(relative),
                "content_digest": "sha256:" + hashlib.sha256(content).hexdigest(),
                "size_bytes": len(content),
            }
        else:
            raise SandboxError("isolated_effect_operation_denied", "Worker operation is not supported.")
    except SandboxError as error:
        status = "failed" if error.code == "filesystem_edit_conflict" else "outcome_unknown"
        return {"status": status, "error_code": error.code}
    except BaseException as error:
        return {"status": "outcome_unknown", "error_code": type(error).__name__[:128]}
    return {"status": "succeeded", "error_code": None, **result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--execution-id", required=True)
    options = parser.parse_args(argv)
    key_text = os.environ.pop("OPENDRSAI_ISOLATED_EFFECT_KEY", "")
    key = base64.b64decode(key_text, validate=True)
    encrypted = Path(options.request).read_bytes()
    request = json.loads(AESGCM(key).decrypt(
        encrypted[:12], encrypted[12:], options.execution_id.encode("utf-8"),
    ))
    if request.get("execution_id") != options.execution_id:
        raise SystemExit(70)
    result = execute_request(request, WindowsWorkspaceFilesystem(Path.cwd()))
    body: dict[str, object] = {
        "schema_version": "isolated-effect-receipt/1",
        "execution_id": options.execution_id,
        "operation": str(request.get("operation", "")),
        "status": str(result["status"]),
        "error_code": result.get("error_code"),
        "request_digest": canonical_digest(request),
        "result_digest": canonical_digest(result),
    }
    body["receipt_digest"] = canonical_digest(body)
    body["mac"] = hmac.new(key, _canonical_bytes(body), hashlib.sha256).hexdigest()
    Path(options.response).write_text(
        json.dumps(body, sort_keys=True, separators=(",", ":")), encoding="utf-8",
    )
    return 0 if result["status"] in {"succeeded", "failed"} else 74


if __name__ == "__main__":
    raise SystemExit(main())
