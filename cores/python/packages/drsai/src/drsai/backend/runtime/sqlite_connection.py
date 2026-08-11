"""Backward-compatible import for the shared SQLite connection."""
from drsai.sqlite_connection import ClosingConnection

__all__ = ["ClosingConnection"]
