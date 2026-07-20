"""Portable Node.js bootstrap — auto-download a private Node runtime if needed.

The OpenDrSai TUI is built on React/Ink, which requires Node.js to execute. Most
PyPI users won't have Node installed; rather than asking them to, we download
the official prebuilt binary from nodejs.org on first launch and cache it
under ``~/.drsai/cache/node/``.

This mirrors the strategy used by Playwright, Puppeteer, Cypress and VS Code:
one ``pip install`` plus a one-time ~25 MB download, then transparent reuse.

Override points (in priority order):

- ``DRSAI_NODE``            — full path to an existing node executable; if set
                              and present, skips download entirely.
- ``DRSAI_NODE_MIRROR``     — base URL for the Node distribution (default
                              ``https://nodejs.org/dist``). Useful for offline
                              installs (point at a local file:// path) or for
                              regions where nodejs.org is slow/blocked, e.g.
                              ``https://npmmirror.com/mirrors/node``.
- ``DRSAI_NODE_CACHE_DIR``  — override the cache root (default
                              ``~/.drsai/cache/node``).
- ``DRSAI_NODE_NO_DOWNLOAD=1`` — refuse to download; raise if no node is
                                 cached or installed. Useful in CI / air-gapped
                                 environments where you want explicit failure.
"""

from __future__ import annotations

import hashlib
import os
import platform
import shutil
import sys
import tarfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

# Pinned LTS — bump occasionally; the ui-tui bundle targets Node 20+.
NODE_VERSION = "v22.22.3"

DEFAULT_MIRROR = "https://nodejs.org/dist"
FALLBACK_MIRRORS = (
    "https://npmmirror.com/mirrors/node",
    "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release",
)


def _cache_root() -> Path:
    explicit = os.environ.get("DRSAI_NODE_CACHE_DIR", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    return Path.home() / ".drsai" / "cache" / "node"


def _platform_slug() -> tuple[str, str]:
    """Return ``(slug, archive_ext)`` for the current platform.

    Slug matches the file names served by nodejs.org/dist/<version>/
    (e.g. ``linux-x64``, ``win-x64``, ``darwin-arm64``).
    """
    sysname = sys.platform
    machine = platform.machine().lower()

    if sysname.startswith("linux"):
        if machine in ("aarch64", "arm64"):
            return "linux-arm64", "tar.xz"
        if machine in ("x86_64", "amd64"):
            return "linux-x64", "tar.xz"
        if machine in ("armv7l", "armv7"):
            return "linux-armv7l", "tar.xz"
        raise RuntimeError(f"Unsupported Linux arch: {machine}")

    if sysname == "darwin":
        if machine in ("arm64", "aarch64"):
            return "darwin-arm64", "tar.gz"
        if machine in ("x86_64", "amd64"):
            return "darwin-x64", "tar.gz"
        raise RuntimeError(f"Unsupported macOS arch: {machine}")

    if sysname == "win32":
        if machine in ("arm64", "aarch64"):
            return "win-arm64", "zip"
        if machine in ("amd64", "x86_64"):
            return "win-x64", "zip"
        if machine in ("x86", "i386", "i686"):
            return "win-x86", "zip"
        raise RuntimeError(f"Unsupported Windows arch: {machine}")

    raise RuntimeError(f"Unsupported platform: {sysname}-{machine}")


def _node_executable_path(install_dir: Path) -> Path:
    """Path to the ``node`` binary inside an extracted archive."""
    if sys.platform == "win32":
        return install_dir / "node.exe"
    return install_dir / "bin" / "node"


def _mirror_url() -> str:
    return (os.environ.get("DRSAI_NODE_MIRROR") or DEFAULT_MIRROR).rstrip("/")


def _candidate_mirrors() -> list[str]:
    """Return the configured mirror followed by safe public fallbacks."""
    configured = _mirror_url()
    candidates = [configured]
    if configured == DEFAULT_MIRROR:
        candidates.extend(FALLBACK_MIRRORS)
    return list(dict.fromkeys(candidates))


def _open_url(url: str, timeout: int):
    """Open a URL using environment or Windows system proxy settings."""
    # urllib.getproxies() reads HTTP(S)_PROXY and, on Windows, the user/system
    # Internet Settings proxy. This also honors NO_PROXY for local endpoints.
    proxies = urllib.request.getproxies()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies))
    return opener.open(url, timeout=timeout)


def _download(url: str, dest: Path) -> None:
    """Download *url* to *dest* with a progress indicator on stderr."""
    sys.stderr.write(f"  Downloading: {url}\n")
    sys.stderr.flush()

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")

    try:
        with _open_url(url, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", "0") or 0)
            downloaded = 0
            chunk = 64 * 1024
            with open(tmp, "wb") as f:
                while True:
                    buf = resp.read(chunk)
                    if not buf:
                        break
                    f.write(buf)
                    downloaded += len(buf)
                    if total and sys.stderr.isatty():
                        pct = downloaded * 100 // total
                        bar = "█" * (pct // 4) + " " * (25 - pct // 4)
                        sys.stderr.write(
                            f"\r  [{bar}] {pct:3d}%  "
                            f"{downloaded / 1024 / 1024:5.1f} / {total / 1024 / 1024:5.1f} MB"
                        )
                        sys.stderr.flush()
            if sys.stderr.isatty():
                sys.stderr.write("\n")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(
            f"Failed to download {url}: {exc}.\n"
            f"  Tip: set DRSAI_NODE_MIRROR to a closer mirror, e.g.\n"
            f"       DRSAI_NODE_MIRROR=https://npmmirror.com/mirrors/node"
        ) from exc

    tmp.rename(dest)


def _fetch_sha_table(version: str) -> dict[str, str]:
    """Fetch the SHASUMS256.txt for *version* from the mirror; return ``{filename: sha}``."""
    for mirror in _candidate_mirrors():
        url = f"{mirror}/{version}/SHASUMS256.txt"
        try:
            with _open_url(url, timeout=30) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            break
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    else:
        return {}
    table: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            table[parts[1].lstrip("*")] = parts[0]
    return table


def _verify_sha256(path: Path, expected: str) -> bool:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest() == expected


def _extract(archive: Path, ext: str, dest_parent: Path) -> Path:
    """Extract *archive* under *dest_parent*; return the path of the top-level dir."""
    dest_parent.mkdir(parents=True, exist_ok=True)
    if ext == "zip":
        with zipfile.ZipFile(archive) as zf:
            top = zf.namelist()[0].split("/", 1)[0]
            zf.extractall(dest_parent)
        return dest_parent / top
    # tar.xz / tar.gz
    with tarfile.open(archive) as tf:
        members = tf.getmembers()
        if not members:
            raise RuntimeError(f"Empty archive: {archive}")
        top = members[0].name.split("/", 1)[0]
        # Avoid the Python 3.12+ warning by setting filter explicitly when available
        if sys.version_info >= (3, 12):
            tf.extractall(dest_parent, filter="data")
        else:
            tf.extractall(dest_parent)
    return dest_parent / top


# ── Public API ──────────────────────────────────────────────────────────────


def find_cached_node() -> Optional[str]:
    """Return path to a previously-cached portable node, if any. Never downloads."""
    try:
        slug, _ = _platform_slug()
    except RuntimeError:
        return None
    install_dir = _cache_root() / NODE_VERSION / slug
    exe = _node_executable_path(install_dir)
    return str(exe) if exe.exists() else None


def ensure_portable_node() -> str:
    """Return path to a working node executable; download + cache if needed.

    Raises ``RuntimeError`` if ``DRSAI_NODE_NO_DOWNLOAD=1`` and the runtime
    isn't already cached, or if the download itself fails.
    """
    cached = find_cached_node()
    if cached:
        return cached

    if (os.environ.get("DRSAI_NODE_NO_DOWNLOAD") or "").strip() in {"1", "true", "yes", "on"}:
        raise RuntimeError(
            "Portable Node.js not cached and DRSAI_NODE_NO_DOWNLOAD=1 is set.\n"
            "  Either install Node.js system-wide, set DRSAI_NODE=/path/to/node,\n"
            "  or remove DRSAI_NODE_NO_DOWNLOAD to allow download."
        )

    slug, ext = _platform_slug()
    install_dir = _cache_root() / NODE_VERSION / slug
    archive_name = f"node-{NODE_VERSION}-{slug}.{ext}"
    archive_path = _cache_root() / archive_name

    sys.stderr.write(
        f"\n[OpenDrSai] Node.js not found — fetching portable runtime "
        f"({NODE_VERSION}, {slug}, ~25 MB, one-time).\n"
    )
    sys.stderr.flush()

    last_error: Exception | None = None
    for mirror in _candidate_mirrors():
        url = f"{mirror}/{NODE_VERSION}/{archive_name}"
        try:
            _download(url, archive_path)
            break
        except RuntimeError as exc:
            last_error = exc
            sys.stderr.write(f"  Download failed; trying next mirror.\n")
    else:
        raise RuntimeError(f"Unable to download {archive_name} from configured or fallback mirrors.") from last_error

    # Optional SHA-256 verification — silently skipped if checksums unreachable.
    expected = _fetch_sha_table(NODE_VERSION).get(archive_name)
    if expected:
        if not _verify_sha256(archive_path, expected):
            archive_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"SHA-256 mismatch for {archive_name}. Refusing to extract.\n"
                f"  Expected: {expected}\n"
                f"  This usually means a corrupt download or a tampered mirror.\n"
                f"  Try again, or pin DRSAI_NODE_MIRROR=https://nodejs.org/dist"
            )

    extract_parent = install_dir.parent
    sys.stderr.write(f"  Extracting to {install_dir}\n")
    extracted = _extract(archive_path, ext, extract_parent)

    if install_dir.exists():
        # Race with concurrent installs; another process beat us. Clean up.
        shutil.rmtree(extracted, ignore_errors=True)
    else:
        extracted.rename(install_dir)

    # Cleanup archive
    try:
        archive_path.unlink()
    except Exception:
        pass

    exe = _node_executable_path(install_dir)
    if not exe.exists():
        raise RuntimeError(f"Extracted Node.js missing executable at {exe}")

    # Make sure it's executable on POSIX
    if sys.platform != "win32":
        exe.chmod(exe.stat().st_mode | 0o111)

    sys.stderr.write(f"  Done. Cached at: {install_dir}\n")
    sys.stderr.write(f"  Future runs of `drsai` will use this copy instantly.\n\n")
    sys.stderr.flush()

    return str(exe)
