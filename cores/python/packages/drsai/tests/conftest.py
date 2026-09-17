"""Run these tests against the checkout, never against an installed ``drsai``.

A developer machine usually has a second copy of this package under
``~/.drsai/packages``.  Without this shim ``import drsai`` can silently pick that
frozen copy up, so a green run would prove nothing about the working tree.
Prepending the sibling ``src`` directory is idempotent and only affects test
collection from this checkout.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if _SRC.is_dir():
    _resolved = str(_SRC)
    if _resolved not in sys.path:
        sys.path.insert(0, _resolved)
