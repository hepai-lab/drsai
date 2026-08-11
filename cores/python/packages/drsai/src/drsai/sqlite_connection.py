"""Shared deterministic SQLite connection lifecycle."""
from __future__ import annotations

import sqlite3


class ClosingConnection(sqlite3.Connection):
    """Commit or roll back, then always release the OS file handle."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()
