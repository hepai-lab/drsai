"""Collect an endpoint-local Android V3 secret scan from a debug device."""
from __future__ import annotations

import argparse
import atexit
import json
import os
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from uuid import uuid4

from scan_remote_workspace_secret_canary import run as scan


ACTION = "ai.drsai.remote.debug.SECURITY_CANARY_PROBE"
RECEIVER = "ai.drsai.remote.remote.debug.SecurityCanaryProbeReceiver"
INPUT = "files/v3-security-canary-input.json"
PROOF = "no_backup/v3-security-canary-proof.json"
PREFERENCES = "shared_prefs/opendrsai_security_canary.xml"


def _adb(args: argparse.Namespace, *command: str, input_bytes: bytes | None = None):
    return subprocess.run(
        [args.adb, "-s", args.device, *command],
        input=input_bytes,
        capture_output=True,
        timeout=60,
        check=False,
    )


def _require(result: subprocess.CompletedProcess[bytes], code: str) -> bytes:
    if result.returncode:
        raise RuntimeError(code)
    return result.stdout


def _write_private_input(
    args: argparse.Namespace,
    payload: bytes,
) -> None:
    # Do not use ``adb shell sh -c "cat > file"`` here.  ADB reconstructs a
    # remote command line from argv and can lose the intended ``sh -c``
    # boundary, while putting the payload in argv would expose the canaries.
    # ``dd`` receives the payload only on stdin and writes inside run-as.
    _require(
        _adb(
            args,
            "shell",
            "run-as",
            args.package,
            "dd",
            f"of={INPUT}",
            input_bytes=payload,
        ),
        "android_secret_input_write_failed",
    )


def _safe_extract(archive_path: Path, destination: Path) -> None:
    with tarfile.open(archive_path) as archive:
        members = []
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise RuntimeError("android_secret_scan_archive_unsafe")
            members.append(member)
        if not members:
            raise RuntimeError("android_secret_scan_archive_empty")
        archive.extractall(destination, members=members)


def _proof(args: argparse.Namespace, nonce: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = _adb(
            args,
            "shell",
            "run-as",
            args.package,
            "cat",
            PROOF,
        )
        if result.returncode == 0:
            try:
                value = json.loads(result.stdout)
            except json.JSONDecodeError:
                value = {}
            if value.get("nonce") == nonce:
                if value.get("status") != "passed":
                    raise RuntimeError(
                        "android_secret_probe_failed:"
                        + str(value.get("error_code", "unknown"))
                    )
                return value
        time.sleep(0.25)
    raise RuntimeError("android_secret_probe_timeout")


def collect(args: argparse.Namespace) -> dict:
    raw = os.getenv(args.canary_env)
    try:
        canaries = json.loads(raw or "")
    except json.JSONDecodeError as exc:
        raise RuntimeError("android_secret_canaries_invalid") from exc
    if (
        not isinstance(canaries, list)
        or not canaries
        or not all(isinstance(item, str) and 12 <= len(item) <= 128 for item in canaries)
    ):
        raise RuntimeError("android_secret_canaries_invalid")

    nonce = uuid4().hex
    payload = json.dumps(
        {"nonce": nonce, "canaries": canaries},
        separators=(",", ":"),
    ).encode()
    _write_private_input(args, payload)
    def cleanup() -> None:
        _adb(
            args,
            "shell",
            "run-as",
            args.package,
            "rm",
            "-f",
            INPUT,
            PROOF,
            PREFERENCES,
        )

    atexit.register(cleanup)
    dispatched = _adb(
        args,
        "shell",
        "am",
        "broadcast",
        "--receiver-foreground",
        "-a",
        ACTION,
        "-n",
        f"{args.package}/{RECEIVER}",
        "--es",
        "nonce",
        nonce,
    )
    if dispatched.returncode or b"result=0" not in dispatched.stdout:
        raise RuntimeError("android_secret_probe_dispatch_failed")
    proof = _proof(args, nonce)
    if (
        proof.get("encrypted_store_present") is not True
        or proof.get("log_redacted") is not True
        or proof.get("input_deleted") is not True
        or proof.get("canary_count") != len(canaries)
    ):
        raise RuntimeError("android_secret_probe_proof_invalid")

    with tempfile.TemporaryDirectory(prefix="opendrsai-v3-android-secret-") as raw_temp:
        temporary = Path(raw_temp)
        apk = temporary / "installed.apk"
        apk_path = _require(
            _adb(args, "shell", "pm", "path", args.package),
            "android_secret_apk_path_failed",
        ).decode(errors="replace").strip()
        if not apk_path.startswith("package:/"):
            raise RuntimeError("android_secret_apk_path_invalid")
        _require(
            _adb(args, "pull", apk_path.removeprefix("package:"), str(apk)),
            "android_secret_apk_pull_failed",
        )
        if not apk.is_file() or apk.stat().st_size <= 0:
            raise RuntimeError("android_secret_apk_missing")

        pid = _require(
            _adb(args, "shell", "pidof", args.package),
            "android_secret_pid_missing",
        ).decode().strip().split()[0]
        logs = temporary / "uid.log"
        logs.write_bytes(
            _require(
                _adb(args, "logcat", "-d", "--pid", pid),
                "android_secret_logcat_failed",
            )
        )
        if logs.stat().st_size <= 0:
            raise RuntimeError("android_secret_logcat_empty")

        archive = temporary / "private.tar"
        archive.write_bytes(
            _require(
                _adb(
                    args,
                    "exec-out",
                    "run-as",
                    args.package,
                    "tar",
                    "-cf",
                    "-",
                    "databases",
                    "shared_prefs",
                    "files",
                    "no_backup",
                ),
                "android_secret_private_export_failed",
            )
        )
        private = temporary / "private"
        private.mkdir()
        _safe_extract(archive, private)

        manifest = temporary / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "profile": "mobile-remote-workspace-v3-android",
                    "artifacts": [
                        {"label": "android_apk", "path": str(apk)},
                        {"label": "android_logs", "path": str(logs)},
                        {"label": "android_room", "path": str(private)},
                    ],
                }
            ),
            encoding="utf-8",
        )
        result = scan(manifest, args.canary_env)

    cleanup()
    atexit.unregister(cleanup)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary_output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary_output.replace(args.output)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument(
        "--adb",
        default=str(
            Path(os.getenv("LOCALAPPDATA", ""))
            / "Android/Sdk/platform-tools/adb.exe"
        ),
    )
    parser.add_argument("--canary-env", default="DRSAI_SECRET_CANARIES")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = collect(args)
    print(
        json.dumps(
            {
                "passed": result["passed"],
                "matches": result["matches"],
                "sources": result["sources"],
            },
            indent=2,
        )
    )
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
