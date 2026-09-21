"""Inspect a DOCX template using the bundled Drsai implementation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from docmaster_impl.docx_template_skill import DocxTemplateSkill


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("template_path")
    args = parser.parse_args()
    result = DocxTemplateSkill().inspect_template(args.template_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
