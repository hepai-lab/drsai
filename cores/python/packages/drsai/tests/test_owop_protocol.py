from __future__ import annotations

import asyncio
import copy
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

from drsai.owop import OWOPError, OWOPEventCursor, OWOPProtocol


SCHEMA = Path(__file__).resolve().parents[5] / "protocol" / "owop" / "owop.schema.json"
DIGEST = "sha256:" + "a" * 64


class OWOPProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.protocol = OWOPProtocol(SCHEMA)
        cls.whole_validator = Draft202012Validator(cls.protocol.schema)

    def request(self, operation: str, params: dict | None = None) -> dict:
        return {
            "version": "1.0",
            "request_id": "request-1",
            "correlation_id": "correlation-1",
            "workspace_id": "workspace-1",
            "operation": operation,
            "params": params or {},
            "binding": {"kind": "in_process"},
        }

    def test_version_capability_and_binding_negotiation(self) -> None:
        result = self.protocol.negotiate(["0.9", "1.0"], ["files", "git", "future"])
        self.assertEqual(result["version"], "1.0")
        self.assertEqual(result["capabilities"], ["files", "git"])
        self.assertEqual(result["unsupported_capabilities"], ["future"])
        self.assertIn("local_ipc", result["bindings"])
        with self.assertRaises(OWOPError) as caught:
            self.protocol.negotiate(["0.9"], ["files"])
        self.assertEqual(caught.exception.code, "owop_version_incompatible")

    def test_request_response_and_error_envelopes_are_strict(self) -> None:
        request = self.request("workspace.describe")
        self.protocol.validate_request(request)
        response = asyncio.run(self.protocol.dispatch(request, {"workspace.describe": lambda _: {"name": "workspace"}}))
        self.whole_validator.validate(response)
        self.assertTrue(response["ok"])

        unavailable = asyncio.run(self.protocol.dispatch(request, {}))
        self.whole_validator.validate(unavailable)
        self.assertFalse(unavailable["ok"])
        self.assertEqual(
            set(unavailable["error"]),
            {"code", "message", "correlation_id", "retryable", "details"},
        )
        unknown = asyncio.run(self.protocol.dispatch(self.request("unknown.operation"), {}))
        self.assertEqual(unknown["error"]["code"], "owop_operation_unknown")
        self.assertEqual(unknown["error"]["correlation_id"], "correlation-1")

        forged = {**request, "arbitrary_json": {"escape": True}}
        with self.assertRaises(OWOPError) as caught:
            self.protocol.validate_request(forged)
        self.assertEqual(caught.exception.code, "owop_request_invalid")

    def test_all_strongly_typed_operations_accept_valid_fixtures(self) -> None:
        fixtures = {
            "workspace.describe": {},
            "files.list": {"path": ".", "limit": 100},
            "files.stat": {"path": "src/main.py"},
            "files.read": {"path": "src/main.py", "offset": 0, "length": 1024},
            "files.write": {"path": "src/main.py", "content_base64": "aGVsbG8=", "expected_digest": DIGEST},
            "files.move": {"source": "a.txt", "destination": "b.txt"},
            "files.remove": {"path": "b.txt", "recursive": False},
            "search.query": {"query": "needle", "path": ".", "limit": 50},
            "watch.subscribe": {"path": ".", "after_sequence": 0, "limit": 100},
            "git.status": {},
            "git.diff": {"path": "src/main.py", "staged": False},
            "git.file_at_ref": {"path": "src/main.py", "ref": "HEAD"},
            "git.stage": {"paths": ["src/main.py"]},
            "git.unstage": {"paths": ["src/main.py"]},
            "git.revert": {"paths": ["src/main.py"], "diff_digest": DIGEST},
            "git.commit": {"message": "test commit", "diff_digest": DIGEST},
            "process.start": {"argv": ["python", "-V"], "cwd": "."},
            "process.write": {"process_id": "process-1", "content_base64": "Cg=="},
            "process.attach": {"process_id": "process-1", "after_offset": 0},
            "process.kill": {"process_id": "process-1", "tree": True},
            "pty.create": {"argv": ["powershell.exe"], "cwd": ".", "cols": 120, "rows": 40},
            "pty.write": {"pty_id": "pty-1", "content_base64": "ZGlyDQo="},
            "pty.resize": {"pty_id": "pty-1", "cols": 100, "rows": 30},
            "pty.attach": {"pty_id": "pty-1", "after_offset": 0},
            "pty.kill": {"pty_id": "pty-1"},
            "checkpoint.create": {"label": "before edit", "max_file_bytes": 10485760},
            "checkpoint.preview": {"checkpoint_id": "checkpoint-1"},
            "checkpoint.restore": {"checkpoint_id": "checkpoint-1", "preview_digest": DIGEST},
            "checkpoint.accept": {"checkpoint_id": "checkpoint-1"},
            "artifact.metadata": {"artifact_id": "artifact-1"},
            "artifact.chunk": {"artifact_id": "artifact-1", "offset": 0, "length": 4096},
        }
        self.assertEqual(set(fixtures), set(self.protocol.operations))
        for operation, params in fixtures.items():
            with self.subTest(operation=operation):
                self.protocol.validate_request(self.request(operation, params))
                escaped = copy.deepcopy(params)
                escaped["arbitrary_json"] = {"escape": True}
                with self.assertRaises(OWOPError) as caught:
                    self.protocol.validate_request(self.request(operation, escaped))
                self.assertEqual(caught.exception.code, "owop_params_invalid")

    def test_paths_and_process_argv_cannot_escape_typed_protocol(self) -> None:
        invalid = [
            self.request("files.read", {"path": "../secret", "offset": 0, "length": 1}),
            self.request("files.read", {"path": r"C:\\secret", "offset": 0, "length": 1}),
            self.request("process.start", {"argv": "cmd.exe /c dir", "cwd": "."}),
            self.request("process.start", {"argv": [], "cwd": "."}),
            self.request("pty.create", {"argv": "powershell.exe", "cwd": ".", "cols": 80, "rows": 24}),
        ]
        for request in invalid:
            with self.subTest(request=request), self.assertRaises(OWOPError):
                self.protocol.validate_request(request)

    def test_event_sequence_dedupe_gap_resume_and_unknown_event(self) -> None:
        def event(sequence: int, *, workspace: str = "workspace-1", dedupe: str | None = None, event_type: str = "file.changed"):
            return {
                "version": "1.0",
                "event_id": f"event-{sequence}",
                "workspace_id": workspace,
                "sequence": sequence,
                "resource_sequence": sequence,
                "cursor": f"cursor-{sequence}",
                "dedupe_key": dedupe or f"dedupe-{sequence}",
                "type": event_type,
                "data": {"path": "file.txt"},
            }

        cursor = OWOPEventCursor(self.protocol, "workspace-1")
        self.assertTrue(cursor.consume(event(1)))
        self.assertFalse(cursor.consume(event(1)))
        with self.assertRaises(OWOPError) as caught:
            cursor.consume(event(3))
        self.assertEqual(caught.exception.code, "owop_event_gap")
        self.assertTrue(cursor.consume(event(2, event_type="unknown")))
        with self.assertRaises(OWOPError) as caught:
            cursor.consume(event(3, workspace="workspace-2"))
        self.assertEqual(caught.exception.code, "owop_workspace_mismatch")
        resumed = OWOPEventCursor(self.protocol, "workspace-1", after_sequence=2)
        self.assertTrue(resumed.consume(event(3)))


if __name__ == "__main__":
    unittest.main()
