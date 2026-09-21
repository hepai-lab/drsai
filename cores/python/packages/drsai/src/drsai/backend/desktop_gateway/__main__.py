"""``python -m drsai.backend.desktop_gateway``.

The desktop shell launches the Runtime by module name rather than by file path,
because the packaged app has no stable path to ``app.py``.  Without this file
that launch fails with "is a package and cannot be directly executed" -- which
the shell reports as a Runtime that never became ready, several layers away from
the real cause.
"""

from __future__ import annotations

from .app import main

if __name__ == "__main__":
    main()
