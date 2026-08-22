"""Trusted Codex artifact installation and platform-aware binary selection."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from drsai.backend.runtime.agent import RuntimeExecutionError


_VERSION = re.compile(r"(?:codex-cli\s+)?(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)")
_WINDOWS_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _canonical_manifest(manifest: Mapping[str, Any]) -> bytes:
    unsigned = {key: value for key, value in manifest.items() if key != "signature"}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def load_trusted_publishers(path: Path) -> dict[str, bytes]:
    """Load the product Codex Ed25519 trust store shared by install and runtime."""
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeExecutionError("codex_trust_store_invalid", "Codex trusted publisher configuration is invalid.") from exc
    if not isinstance(value, dict) or not value:
        raise RuntimeExecutionError("codex_trust_store_invalid", "Codex trusted publisher configuration must be a non-empty object.")
    result: dict[str, bytes] = {}
    for publisher, encoded in value.items():
        if not isinstance(publisher, str) or not re.fullmatch(r"[0-9A-Za-z_.-]{1,128}", publisher) or not isinstance(encoded, str):
            raise RuntimeExecutionError("codex_trust_store_invalid", "Codex trusted publisher entry is invalid.")
        try:
            key = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise RuntimeExecutionError("codex_trust_store_invalid", "Codex trusted publisher key is invalid.") from exc
        if len(key) != 32:
            raise RuntimeExecutionError("codex_trust_store_invalid", "Codex trusted publisher key must be Ed25519.")
        result[publisher] = key
    return result


@dataclass(frozen=True)
class CodexBinary:
    path: Path
    version: str | None
    schema_digest: str | None
    source: str
    release_safe: bool
    manifest: Mapping[str, Any] | None = None


class CodexArtifactStore:
    """Installs signed artifacts into immutable version directories."""

    def __init__(self, root: Path, trusted_publishers: Mapping[str, bytes], *, expected_platform: str | None = None):
        self.root = Path(root)
        self.versions = self.root / "versions"
        self.trusted_publishers = dict(trusted_publishers)
        self.expected_platform = expected_platform or ("windows-x86_64" if os.name == "nt" else "linux-x86_64")
        self.versions.mkdir(parents=True, exist_ok=True)

    def verify(self, artifact_dir: Path) -> dict[str, Any]:
        artifact_dir = Path(artifact_dir)
        try:
            manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeExecutionError("codex_artifact_manifest_invalid", "Codex artifact manifest is invalid.") from exc
        required = {"version", "platform", "executable", "binary_digest", "schema", "schema_digest", "publisher", "signature"}
        if not required.issubset(manifest) or not all(isinstance(manifest[key], str) for key in required):
            raise RuntimeExecutionError("codex_artifact_manifest_invalid", "Codex artifact manifest is incomplete.")
        if manifest["platform"] != self.expected_platform:
            raise RuntimeExecutionError("codex_artifact_platform_mismatch", "Codex artifact targets a different platform.")
        publisher = manifest["publisher"]
        public_key = self.trusted_publishers.get(publisher)
        if public_key is None:
            raise RuntimeExecutionError("codex_artifact_publisher_unknown", "Codex artifact publisher is not trusted.")
        try:
            signature = base64.b64decode(manifest["signature"], validate=True)
            Ed25519PublicKey.from_public_bytes(public_key).verify(signature, _canonical_manifest(manifest))
        except (ValueError, InvalidSignature) as exc:
            raise RuntimeExecutionError("codex_artifact_signature_invalid", "Codex artifact signature is invalid.") from exc
        executable = self._member(artifact_dir, manifest["executable"])
        schema = self._member(artifact_dir, manifest["schema"])
        if not executable.is_file() or _sha256(executable) != manifest["binary_digest"]:
            raise RuntimeExecutionError("codex_artifact_digest_mismatch", "Codex binary digest does not match its manifest.")
        if not schema.is_file() or _sha256(schema) != manifest["schema_digest"]:
            raise RuntimeExecutionError("codex_schema_digest_mismatch", "Codex App Server Schema digest does not match its manifest.")
        return manifest

    def install(self, artifact_dir: Path, *, before_switch: Callable[[], None] | None = None) -> CodexBinary:
        manifest = self.verify(artifact_dir)
        version = manifest["version"]
        if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z._-]{0,127}", version):
            raise RuntimeExecutionError("codex_artifact_version_invalid", "Codex artifact version is invalid.")
        destination = self.versions / version
        if destination.exists():
            installed = self.verify(destination)
            if installed != manifest:
                raise RuntimeExecutionError("codex_artifact_version_conflict", "A different Codex artifact already uses this version.")
        else:
            temporary = Path(tempfile.mkdtemp(prefix=f".{version}-", dir=self.versions))
            try:
                shutil.copytree(artifact_dir, temporary, dirs_exist_ok=True)
                self.verify(temporary)
                os.replace(temporary, destination)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary, ignore_errors=True)
        if before_switch:
            before_switch()
        old_current = self._read_pointer("current")
        if old_current and old_current != version:
            self._write_pointer("previous", old_current)
        self._write_pointer("current", version)
        return self.resolve(version)

    def resolve(self, version: str | None = None) -> CodexBinary:
        selected = version or self._read_pointer("current")
        if not selected:
            raise RuntimeExecutionError("codex_artifact_not_installed", "No managed Codex artifact is installed.")
        directory = self.versions / selected
        manifest = self.verify(directory)
        return CodexBinary(directory / manifest["executable"], manifest["version"],
                           manifest["schema_digest"], "managed", True, manifest)

    def _read_pointer(self, name: str) -> str | None:
        try:
            value = (self.root / f"{name}.json").read_text(encoding="utf-8")
            data = json.loads(value)
            return str(data["version"])
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError, KeyError) as exc:
            raise RuntimeExecutionError("codex_artifact_pointer_invalid", f"Managed Codex {name} pointer is invalid.") from exc

    def _write_pointer(self, name: str, version: str) -> None:
        path = self.root / f"{name}.json"
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{name}-", dir=self.root)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump({"version": version}, handle, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, path)
        finally:
            Path(temporary_name).unlink(missing_ok=True)

    @staticmethod
    def _member(root: Path, relative: str) -> Path:
        value = Path(relative)
        if value.is_absolute() or ".." in value.parts:
            raise RuntimeExecutionError("codex_artifact_manifest_invalid", "Artifact member escapes its root.")
        candidate = (root / value).resolve(strict=False)
        if os.path.commonpath([os.path.normcase(str(root.resolve())), os.path.normcase(str(candidate))]) != os.path.normcase(str(root.resolve())):
            raise RuntimeExecutionError("codex_artifact_manifest_invalid", "Artifact member escapes its root.")
        return candidate


class CodexBinaryProvider:
    def __init__(
        self, store: CodexArtifactStore, *, mode: str = "product",
        environ: Mapping[str, str] | None = None,
        desktop_signature_verifier: Callable[[Path], bool] | None = None,
    ):
        if mode not in {"product", "development"}:
            raise ValueError("mode must be product or development")
        self.store = store
        self.mode = mode
        self.environ = dict(os.environ if environ is None else environ)
        self.desktop_signature_verifier = desktop_signature_verifier or _windows_openai_signature_is_valid

    def resolve(self) -> CodexBinary:
        override = self.environ.get("CODEX_BIN")
        if self.mode == "development" and override:
            path = Path(override).resolve(strict=False)
            if not path.is_file():
                raise RuntimeExecutionError("codex_development_override_invalid", "CODEX_BIN does not name a file.")
            return CodexBinary(path, _probe_codex_version(path), None, "CODEX_BIN", False)
        try:
            return self.store.resolve()
        except RuntimeExecutionError as exc:
            if exc.code != "codex_artifact_not_installed" or os.name != "nt":
                raise
        discovered = discover_windows_codex_desktop(self.environ)
        if discovered is None:
            raise RuntimeExecutionError(
                "codex_artifact_not_installed",
                "No managed Codex artifact or trusted Codex Desktop CLI was found.",
            )
        if not self.desktop_signature_verifier(discovered):
            raise RuntimeExecutionError(
                "codex_desktop_signature_invalid",
                "The discovered Codex Desktop CLI is not signed by the trusted OpenAI publisher.",
            )
        version = _probe_codex_version(discovered)
        if not version:
            raise RuntimeExecutionError(
                "codex_binary_version_unreadable",
                "The discovered Codex Desktop CLI could not be started by the Runtime.",
            )
        return CodexBinary(discovered, version, None, "codex-desktop", True)


def discover_windows_codex_desktop(environ: Mapping[str, str] | None = None) -> Path | None:
    """Return a real Codex Desktop CLI, never the WindowsApps execution alias."""
    environment = os.environ if environ is None else environ
    local = environment.get("LOCALAPPDATA", "").strip()
    if not local:
        return None
    root = (Path(local) / "OpenAI" / "Codex" / "bin").resolve(strict=False)
    if not root.is_dir():
        return None
    candidates: list[Path] = []
    for candidate in root.glob("*/codex.exe"):
        try:
            resolved = candidate.resolve(strict=True)
            if (
                resolved.is_file()
                and re.fullmatch(r"[0-9a-fA-F]{8,64}", resolved.parent.name)
                and os.path.commonpath([os.path.normcase(str(root)), os.path.normcase(str(resolved))]) == os.path.normcase(str(root))
            ):
                candidates.append(resolved)
        except (OSError, ValueError):
            continue
    return max(candidates, key=lambda path: path.stat().st_mtime_ns, default=None)


def _windows_openai_signature_is_valid(path: Path, *, timeout: float = 10) -> bool:
    if os.name != "nt":
        return False
    script = (
        "$s=Get-AuthenticodeSignature -LiteralPath $env:OPENDRSAI_CODEX_SIGNATURE_TARGET;"
        "if($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match 'OpenAI (?:OpCo|L\\.L\\.C\\.)'){exit 0};exit 1"
    )
    try:
        environment = dict(os.environ)
        environment["OPENDRSAI_CODEX_SIGNATURE_TARGET"] = str(path)
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, timeout=timeout, check=False, env=environment,
            creationflags=_WINDOWS_NO_WINDOW,
        )
        return completed.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


class CodexPlatformLauncher:
    @staticmethod
    def command(
        binary: Path, args: Sequence[str], *, platform: str | None = None,
        comspec: str | None = None, executable_access: Callable[[Path, int], bool] = os.access,
    ) -> list[str]:
        selected = platform or ("windows" if os.name == "nt" else "linux")
        if selected not in {"windows", "linux"}:
            raise RuntimeExecutionError("codex_platform_unsupported", "Codex platform implementation is unsupported.")
        path = str(binary)
        if selected == "windows" and binary.suffix.casefold() in {".cmd", ".bat"}:
            return [comspec or os.environ.get("ComSpec", "cmd.exe"), "/d", "/s", "/c", subprocess.list2cmdline([path, *args])]
        if selected == "windows" and "windowsapps" in path.casefold() and not executable_access(binary, os.X_OK):
            raise RuntimeExecutionError(
                "codex_windowsapps_alias_inaccessible",
                "The WindowsApps Codex alias cannot be executed by the Runtime; install a managed Codex artifact or set CODEX_BIN in development mode.",
            )
        return [path, *args]


def _probe_codex_version(path: Path, *, timeout: float = 5) -> str | None:
    """Read display metadata without treating a development binary as trusted."""
    try:
        completed = subprocess.run(
            CodexPlatformLauncher.command(path, ["--version"]),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=_WINDOWS_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired, RuntimeExecutionError):
        return None
    match = _VERSION.search(f"{completed.stdout}\n{completed.stderr}")
    return match.group("version") if completed.returncode == 0 and match else None


def verify_codex_compatibility(binary: CodexBinary, *, timeout: float = 15) -> str:
    if not binary.release_safe:
        raise RuntimeExecutionError("codex_development_override_unverified", "Development Codex override is not release-compatible.")
    command = CodexPlatformLauncher.command(binary.path, ["--version"])
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False,
            creationflags=_WINDOWS_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeExecutionError("codex_binary_start_failed", "Codex binary version check could not run.") from exc
    output = f"{completed.stdout}\n{completed.stderr}"
    match = _VERSION.search(output)
    if completed.returncode != 0 or not match:
        raise RuntimeExecutionError("codex_binary_version_unreadable", "Codex binary did not report a valid version.")
    actual = match.group("version")
    if binary.source == "codex-desktop" and binary.manifest is None:
        # Authenticity is established by Windows Authenticode during discovery.
        # Stable app-server compatibility is then negotiated by initialize.
        return actual
    if not binary.manifest:
        raise RuntimeExecutionError("codex_artifact_manifest_invalid", "Release Codex metadata is unavailable.")
    expected = str(binary.manifest["version"])
    if actual != expected:
        raise RuntimeExecutionError("codex_binary_version_mismatch", "Codex binary version does not match its manifest.",
                                    detail={"expected": expected, "actual": actual})
    executable_relative = Path(str(binary.manifest["executable"]))
    artifact_root = binary.path
    for _ in executable_relative.parts:
        artifact_root = artifact_root.parent
    schema_path = artifact_root / str(binary.manifest["schema"])
    if _sha256(schema_path) != binary.schema_digest:
        raise RuntimeExecutionError("codex_schema_digest_mismatch", "Codex App Server Schema changed after installation.")
    return actual
