from __future__ import annotations

import json
import sys
from pathlib import Path


HEADER = '''"""Generated from cores/protocol/runtime/runtime-control.schema.json.  Do not edit."""

from __future__ import annotations

from typing import NotRequired, Required, TypedDict, TypeAlias

JsonObject: TypeAlias = dict[str, object]

'''


def python_type(value: str) -> str:
    optional = value.endswith("?")
    base = value[:-1] if optional else value
    mapped = {"str": "str", "int": "int", "object": "JsonObject"}.get(base, base)
    return f"NotRequired[{mapped}]" if optional else mapped


def generate(schema: dict[str, object]) -> str:
    methods = schema["x-control-methods"]
    if not isinstance(methods, dict):
        raise ValueError("x-control-methods must be an object")
    definitions: dict[str, tuple[set[str], dict[str, str]]] = {}
    for method, raw in methods.items():
        if not isinstance(method, str) or not isinstance(raw, dict):
            raise ValueError("Control method definition is invalid")
        name, required, fields = raw.get("type"), raw.get("required"), raw.get("fields")
        if not isinstance(name, str) or not isinstance(required, list) or not isinstance(fields, dict):
            raise ValueError("Control method type definition is invalid")
        candidate = (set(map(str, required)), {str(key): str(value) for key, value in fields.items()})
        if name in definitions and definitions[name] != candidate:
            raise ValueError("A generated type has conflicting definitions")
        definitions[name] = candidate
    output = [HEADER]
    for name in sorted(definitions):
        required, fields = definitions[name]
        output.append(f"class {name}(TypedDict, total=False):\n")
        if not fields:
            output.append("    pass\n\n")
            continue
        for field, value in fields.items():
            annotation = python_type(value)
            if field in required:
                annotation = f"Required[{annotation}]"
            output.append(f"    {field}: {annotation}\n")
        output.append("\n")
    method_names = sorted(methods)
    output.append("CONTROL_METHODS = (\n")
    output.extend(f"    {method!r},\n" for method in method_names)
    output.append(")\n\nControlParams: TypeAlias = " + " | ".join(sorted(definitions)) + "\n")
    return "".join(output)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit("usage: generate_control_types.py SCHEMA OUTPUT")
    schema_path, output_path = map(Path, argv[1:])
    value = json.loads(schema_path.read_text(encoding="utf-8"))
    output_path.write_text(generate(value), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
