from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: str(item).casefold()):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return f"sha256:{digest.hexdigest()}"


def junction(link: Path, target: Path) -> None:
    completed = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr or completed.stdout)


def rejected(callable_, codes: set[str]) -> str:
    from drsai.owop.protocol import OWOPError

    try:
        callable_()
    except OWOPError as exc:
        if exc.code not in codes:
            raise AssertionError(f"unexpected rejection code: {exc.code}") from exc
        return exc.code
    raise AssertionError("unsafe operation was accepted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if os.name != "nt":
        raise RuntimeError("This acceptance probe requires Windows junction semantics")

    archive = Path(args.backend_source).resolve(strict=True)
    output = Path(args.output).resolve(strict=False)
    checks: dict[str, bool] = {}
    with tempfile.TemporaryDirectory(prefix="opendrsai-workspace-guard-") as temp:
        temp_root = Path(temp)
        extracted = temp_root / "packaged-backend"
        with zipfile.ZipFile(archive) as source:
            source.extractall(extracted)
        sys.path.insert(0, str(extracted / "cores" / "python" / "packages" / "drsai" / "src"))
        from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal

        workspace = temp_root / "中文 工作区"
        outside = temp_root / "outside"
        workspace.mkdir()
        outside.mkdir()
        (outside / "secret.txt").write_text("outside-secret", encoding="utf-8")
        outside_before = tree_digest(outside)
        operations = LocalWorkspaceOperations(
            "workspace-round25",
            workspace,
            WorkspaceWatchJournal(temp_root / "watch.sqlite3"),
        )
        try:
            normal = operations.write_file({
                "path": "safe/inside.txt",
                "content_base64": base64.b64encode(b"inside").decode(),
                "create_parents": True,
            })
            checks["normal_file_write"] = normal["digest"].startswith("sha256:")
            checks["normal_file_read"] = base64.b64decode(operations.read_file({
                "path": "safe/inside.txt", "offset": 0, "length": 1024,
            })["content_base64"]) == b"inside"

            file_codes = {"workspace_absolute_path_rejected", "workspace_escape_rejected", "workspace_path_invalid"}
            attacks = {
                "traversal": "../outside/secret.txt",
                "absolute": str(outside / "secret.txt"),
                "drive": r"C:\Windows\win.ini",
                "unc": r"\\server\share\secret.txt",
            }
            for name, value in attacks.items():
                rejected(lambda value=value: operations.stat_file({"path": value}), file_codes)
                checks[f"file_{name}_rejected"] = True

            linked = workspace / "linked-outside"
            junction(linked, outside)
            try:
                rejected(
                    lambda: operations.read_file({"path": "linked-outside/secret.txt", "offset": 0, "length": 1024}),
                    {"workspace_reparse_point_rejected"},
                )
                checks["junction_read_rejected"] = True
                rejected(
                    lambda: operations.write_file({
                        "path": "linked-outside/created.txt",
                        "content_base64": base64.b64encode(b"escape").decode(),
                    }),
                    {"workspace_reparse_point_rejected"},
                )
                checks["junction_write_rejected"] = True
            finally:
                linked.rmdir()

            operations._assert_boundary(Path(str(workspace).swapcase()) / "case-child")
            checks["case_insensitive_root_allowed"] = True
            rejected(
                lambda: operations._assert_boundary(workspace.parent / f"{workspace.name}-evil" / "secret.txt"),
                {"workspace_escape_rejected"},
            )
            checks["case_prefix_escape_rejected"] = True

            process_codes = {"workspace_absolute_path_rejected", "workspace_escape_rejected"}
            for name, value in attacks.items():
                rejected(lambda value=value: operations.process_pty._cwd(value), process_codes)
                checks[f"command_{name}_rejected"] = True
            command_link = workspace / "command-link"
            junction(command_link, outside)
            try:
                rejected(lambda: operations.process_pty._cwd("command-link"), {"workspace_reparse_point_rejected"})
                checks["command_junction_rejected"] = True
            finally:
                command_link.rmdir()

            race = workspace / "race"
            race.mkdir()
            race_original = workspace / "race-original"
            original_reparse_check = operations._reject_reparse
            calls = 0

            def inject_parent_swap(parts, *, include_leaf):
                nonlocal calls
                calls += 1
                if calls == 2:
                    race.rename(race_original)
                    junction(race, outside)
                return original_reparse_check(parts, include_leaf=include_leaf)

            operations._reject_reparse = inject_parent_swap
            try:
                rejected(lambda: operations.write_file({
                    "path": "race/toctou.txt",
                    "content_base64": base64.b64encode(b"must-not-escape").decode(),
                }), {"workspace_reparse_point_rejected"})
                checks["parent_toctou_rejected"] = True
                checks["parent_toctou_no_outside_write"] = not (outside / "toctou.txt").exists()
            finally:
                operations._reject_reparse = original_reparse_check
                race.rmdir()
                race_original.rename(race)

            registered = workspace
            original = temp_root / "workspace-original"
            registered.rename(original)
            junction(registered, outside)
            try:
                rejected(lambda: operations.write_file({
                    "path": "root-escape.txt",
                    "content_base64": base64.b64encode(b"must-not-escape").decode(),
                }), {"workspace_root_changed"})
                checks["registered_root_swap_rejected"] = True
                rejected(lambda: operations.process_pty._cwd("."), {"workspace_root_changed"})
                checks["command_root_swap_rejected"] = True
                checks["root_swap_no_outside_write"] = not (outside / "root-escape.txt").exists()
            finally:
                registered.rmdir()
                original.rename(registered)
        finally:
            operations.close()

        checks["outside_tree_unchanged"] = tree_digest(outside) == outside_before
        if not all(checks.values()):
            raise AssertionError(json.dumps(checks, indent=2))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({
            "schema_version": "opendrsai.windows.workspace-guard-probe/1",
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "checks": checks,
            "passed_checks": sum(checks.values()),
            "outside_before": outside_before,
            "outside_after": tree_digest(outside),
            "backend_source": str(archive),
        }, indent=2), encoding="utf-8")
    print(f"Packaged OWOP workspace guard passed {sum(checks.values())}/{len(checks)} checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
