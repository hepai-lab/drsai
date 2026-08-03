from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "src" / "drsai" / "backend"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


paths = load("workspace_paths_under_test", "workspace/paths.py")


class WorkspacePathTests(unittest.TestCase):
    def test_relative_windows_posix_and_mixed_separators_normalize(self) -> None:
        fixtures = {
            "src/main.py": ("src", "main.py"),
            r"src\main.py": ("src", "main.py"),
            r"src\generated/output.json": ("src", "generated", "output.json"),
            "./src//main.py": ("src", "main.py"),
            ".": (),
        }
        for value, expected in fixtures.items():
            with self.subTest(value=value):
                self.assertEqual(paths.relative_parts(value), expected)

    def test_drive_unc_posix_absolute_and_traversal_are_rejected(self) -> None:
        fixtures = [
            r"C:\workspace\file.txt",
            "C:/workspace/file.txt",
            r"\\server\share\file.txt",
            "/etc/passwd",
            "../outside.txt",
            r"folder\..\outside.txt",
            "file.txt:secret",
        ]
        for value in fixtures:
            with self.subTest(value=value), self.assertRaises(paths.WorkspacePathError):
                paths.relative_parts(value)

    def test_registry_root_resolution_blocks_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            workspace = base / "workspace"
            workspace.mkdir()
            child = workspace / "folder"
            child.mkdir()
            self.assertEqual(paths.resolve_workspace_path(workspace, r"folder\file.txt"), child / "file.txt")
            outside = base / "outside"
            outside.mkdir()
            link = workspace / "link"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest("Symlink creation is unavailable on this Windows host")
            with self.assertRaises(paths.WorkspacePathError) as caught:
                paths.resolve_workspace_path(workspace, "link/secret.txt")
            self.assertEqual(caught.exception.code, "workspace_escape_rejected")


if __name__ == "__main__":
    unittest.main()
