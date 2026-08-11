#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parent / "src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from opendrsai_regression.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
