"""Fill a DOCX template using the bundled Drsai implementation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from docmaster_impl.docx_template_skill import DocxTemplateSkill


def _json_object(value: str) -> dict[str, Any]:
    path = Path(value)
    raw = path.read_text(encoding="utf-8") if path.is_file() else value
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise argparse.ArgumentTypeError("JSON value must be an object")
    return parsed


def _json_list(value: str) -> list[str]:
    parsed = json.loads(value)
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise argparse.ArgumentTypeError("JSON value must be a list of strings")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("template_path")
    parser.add_argument("output_path")
    parser.add_argument("--context", type=_json_object, default={})
    parser.add_argument("--slot-values", type=_json_object, default={})
    parser.add_argument("--removal-ids", type=_json_list, default=[])
    parser.add_argument("--mode", default="auto")
    parser.add_argument("--force-fresh", action="store_true")
    args = parser.parse_args()
    result = DocxTemplateSkill().fill_template(
        args.template_path,
        args.output_path,
        context=args.context,
        mode=args.mode,
        slot_values=args.slot_values,
        removal_ids=args.removal_ids,
        force_fresh=args.force_fresh,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
