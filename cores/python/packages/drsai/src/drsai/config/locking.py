"""Process-local and cross-process locks for config.toml commits."""

from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .loader import ConfigError, default_config_path

_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}


def _local_lock(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _guard:
        return _locks.setdefault(key, threading.RLock())


@contextmanager
def config_write_lock(
    path: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> Iterator[None]:
    target = Path(path) if path is not None else default_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    local = _local_lock(target)
    if not local.acquire(timeout=timeout):
        raise ConfigError("Timed out waiting for the model configuration lock")
    handle = None
    try:
        lock_path = target.with_suffix(target.suffix + ".lock")
        try:
            with open(lock_path, "xb") as initializer:
                initializer.write(b"0")
                initializer.flush()
                os.fsync(initializer.fileno())
        except FileExistsError:
            pass
        handle = open(lock_path, "r+b")
        deadline = time.monotonic() + timeout
        while True:
            try:
                _lock_handle(handle)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise ConfigError("Timed out waiting for another process to update model configuration")
                time.sleep(0.05)
        yield
    finally:
        if handle is not None:
            try:
                _unlock_handle(handle)
            except OSError:
                pass
            handle.close()
        local.release()


def _lock_handle(handle) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_handle(handle) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
