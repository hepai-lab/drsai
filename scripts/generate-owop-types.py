from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEMA = ROOT / "protocol" / "owop" / "owop.schema.json"
DEFAULT_PYTHON = ROOT / "cores" / "python" / "packages" / "drsai" / "src" / "drsai" / "owop" / "generated.py"
DEFAULT_TYPESCRIPT = ROOT / "apps" / "desktop" / "windows" / "src" / "shared" / "owop.generated.ts"


def class_name(operation: str) -> str:
    return "".join(part.capitalize() for part in re.split(r"[^A-Za-z0-9]+", operation)) + "Params"


def result_class_name(operation: str) -> str:
    return "".join(part.capitalize() for part in re.split(r"[^A-Za-z0-9]+", operation)) + "Result"


def python_type(schema: Mapping[str, Any]) -> str:
    reference = schema.get("$ref")
    if reference:
        if str(reference).endswith("/worktreeResource"):
            return "OWOPWorktreeResource"
        if str(reference).endswith("/terminalResource"):
            return "OWOPTerminalResource"
        if str(reference).endswith("/terminalOutputEvent"):
            return "OWOPTerminalOutputEvent"
        if str(reference).endswith("/terminalScreenRun"):
            return "OWOPTerminalScreenRun"
        if str(reference).endswith("/terminalScreenSnapshot"):
            return "OWOPTerminalScreenSnapshot"
        return "str"
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null = [item for item in schema_type if item != "null"]
        base = python_type({**schema, "type": non_null[0]}) if len(non_null) == 1 else "Any"
        return f"{base} | None" if "null" in schema_type else base
    if schema_type == "string" or "enum" in schema or "const" in schema:
        return "str"
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float"
    if schema_type == "boolean":
        return "bool"
    if schema_type == "array":
        return f"list[{python_type(schema.get('items', {}))}]"
    if schema_type == "object":
        return "dict[str, Any]"
    return "Any"


def typescript_type(schema: Mapping[str, Any]) -> str:
    if schema.get("$ref"):
        if str(schema["$ref"]).endswith("/worktreeResource"):
            return "OWOPWorktreeResource"
        if str(schema["$ref"]).endswith("/terminalResource"):
            return "OWOPTerminalResource"
        if str(schema["$ref"]).endswith("/terminalOutputEvent"):
            return "OWOPTerminalOutputEvent"
        if str(schema["$ref"]).endswith("/terminalScreenRun"):
            return "OWOPTerminalScreenRun"
        if str(schema["$ref"]).endswith("/terminalScreenSnapshot"):
            return "OWOPTerminalScreenSnapshot"
        return "string"
    if "enum" in schema:
        return " | ".join(json.dumps(item) for item in schema["enum"])
    if "const" in schema:
        return json.dumps(schema["const"])
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return " | ".join("null" if item == "null" else typescript_type({**schema, "type": item}) for item in schema_type)
    if schema_type == "string":
        return "string"
    if schema_type in {"integer", "number"}:
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "array":
        return f"Array<{typescript_type(schema.get('items', {}))}>"
    if schema_type == "object":
        return "Record<string, unknown>"
    return "unknown"


def literal(values: list[str]) -> str:
    return ", ".join(repr(value) for value in values)


def generate_python(schema: Mapping[str, Any], digest: str) -> str:
    operations = schema["x-owop-operations"]
    results = schema.get("x-owop-results", {})
    capabilities = schema["x-owop-capabilities"]
    bindings = schema["x-owop-bindings"]
    lines = [
        '"""Generated from protocol/owop/owop.schema.json; do not edit."""',
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any, Literal, TypedDict",
        "try:",
        "    from typing import NotRequired, Required, TypeAlias",
        "except ImportError:  # Python 3.9 compatibility for tooling hosts",
        "    from typing_extensions import NotRequired, Required, TypeAlias",
        "",
        f'SCHEMA_SHA256 = "{digest}"',
        f'OWOP_VERSION = {schema["version"]!r}',
        f"OWOPCapability: TypeAlias = Literal[{literal(capabilities)}]",
        f"OWOPBindingKind: TypeAlias = Literal[{literal(bindings)}]",
        f"OWOPOperation: TypeAlias = Literal[{literal(list(operations))}]",
        "",
    ]
    worktree_schema = schema.get("$defs", {}).get("worktreeResource")
    if worktree_schema:
        required = set(worktree_schema.get("required", []))
        lines.append("class OWOPWorktreeResource(TypedDict, total=False):")
        for name, property_schema in worktree_schema.get("properties", {}).items():
            wrapper = "Required" if name in required else "NotRequired"
            lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
        lines.append("")
    terminal_schema = schema.get("$defs", {}).get("terminalResource")
    if terminal_schema:
        required = set(terminal_schema.get("required", []))
        lines.append("class OWOPTerminalResource(TypedDict, total=False):")
        for name, property_schema in terminal_schema.get("properties", {}).items():
            wrapper = "Required" if name in required else "NotRequired"
            lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
        lines.append("")
    terminal_event_schema = schema.get("$defs", {}).get("terminalOutputEvent")
    if terminal_event_schema:
        required = set(terminal_event_schema.get("required", []))
        lines.append("class OWOPTerminalOutputEvent(TypedDict, total=False):")
        for name, property_schema in terminal_event_schema.get("properties", {}).items():
            wrapper = "Required" if name in required else "NotRequired"
            lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
        lines.append("")
    for definition, generated_name in (
        ("terminalScreenRun", "OWOPTerminalScreenRun"),
        ("terminalScreenSnapshot", "OWOPTerminalScreenSnapshot"),
    ):
        definition_schema = schema.get("$defs", {}).get(definition)
        if definition_schema:
            required = set(definition_schema.get("required", []))
            lines.append(f"class {generated_name}(TypedDict, total=False):")
            for name, property_schema in definition_schema.get("properties", {}).items():
                wrapper = "Required" if name in required else "NotRequired"
                lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
            lines.append("")
    for operation, operation_schema in operations.items():
        required = set(operation_schema.get("required", []))
        lines.append(f"class {class_name(operation)}(TypedDict, total=False):")
        properties = operation_schema.get("properties", {})
        if not properties:
            lines.append("    pass")
        for name, property_schema in properties.items():
            wrapper = "Required" if name in required else "NotRequired"
            lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
        lines.append("")
    lines.extend([
        "OWOP_PARAMS_BY_OPERATION: dict[str, type[TypedDict]] = {",
        *[f"    {operation!r}: {class_name(operation)}," for operation in operations],
        "}",
        "",
    ])
    for operation, result_schema in results.items():
        required = set(result_schema.get("required", []))
        lines.append(f"class {result_class_name(operation)}(TypedDict, total=False):")
        for name, property_schema in result_schema.get("properties", {}).items():
            wrapper = "Required" if name in required else "NotRequired"
            lines.append(f"    {name}: {wrapper}[{python_type(property_schema)}]")
        lines.append("")
    lines.extend([
        "OWOP_RESULTS_BY_OPERATION: dict[str, type[TypedDict]] = {",
        *[f"    {operation!r}: {result_class_name(operation)}," for operation in results],
        "}",
        "",
    ])
    return "\n".join(lines)


def generate_typescript(schema: Mapping[str, Any], digest: str) -> str:
    operations = schema["x-owop-operations"]
    results = schema.get("x-owop-results", {})
    capabilities = schema["x-owop-capabilities"]
    bindings = schema["x-owop-bindings"]
    union = lambda values: " | ".join(json.dumps(value) for value in values)
    lines = [
        "// Generated from protocol/owop/owop.schema.json; do not edit.",
        f'export const OWOP_SCHEMA_SHA256 = "{digest}" as const;',
        f'export const OWOP_VERSION = {json.dumps(schema["version"])} as const;',
        f"export type OWOPCapability = {union(capabilities)};",
        f"export type OWOPBindingKind = {union(bindings)};",
        f"export type OWOPOperation = {union(list(operations))};",
        "",
    ]
    worktree_schema = schema.get("$defs", {}).get("worktreeResource")
    if worktree_schema:
        required = set(worktree_schema.get("required", []))
        lines.append("export interface OWOPWorktreeResource {")
        for name, property_schema in worktree_schema.get("properties", {}).items():
            optional = "" if name in required else "?"
            lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
        lines.append("}")
        lines.append("")
    terminal_schema = schema.get("$defs", {}).get("terminalResource")
    if terminal_schema:
        required = set(terminal_schema.get("required", []))
        lines.append("export interface OWOPTerminalResource {")
        for name, property_schema in terminal_schema.get("properties", {}).items():
            optional = "" if name in required else "?"
            lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
        lines.append("}")
        lines.append("")
    terminal_event_schema = schema.get("$defs", {}).get("terminalOutputEvent")
    if terminal_event_schema:
        required = set(terminal_event_schema.get("required", []))
        lines.append("export interface OWOPTerminalOutputEvent {")
        for name, property_schema in terminal_event_schema.get("properties", {}).items():
            optional = "" if name in required else "?"
            lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
        lines.append("}")
        lines.append("")
    for definition, generated_name in (
        ("terminalScreenRun", "OWOPTerminalScreenRun"),
        ("terminalScreenSnapshot", "OWOPTerminalScreenSnapshot"),
    ):
        definition_schema = schema.get("$defs", {}).get(definition)
        if definition_schema:
            required = set(definition_schema.get("required", []))
            lines.append(f"export interface {generated_name} {{")
            for name, property_schema in definition_schema.get("properties", {}).items():
                optional = "" if name in required else "?"
                lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
            lines.append("}")
            lines.append("")
    for operation, operation_schema in operations.items():
        required = set(operation_schema.get("required", []))
        lines.append(f"export interface {class_name(operation)} {{")
        for name, property_schema in operation_schema.get("properties", {}).items():
            optional = "" if name in required else "?"
            lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
        lines.append("}")
        lines.append("")
    lines.extend([
        "export interface OWOPParamsByOperation {",
        *[f'  {json.dumps(operation)}: {class_name(operation)};' for operation in operations],
        "}",
        "",
    ])
    for operation, result_schema in results.items():
        required = set(result_schema.get("required", []))
        lines.append(f"export interface {result_class_name(operation)} {{")
        for name, property_schema in result_schema.get("properties", {}).items():
            optional = "" if name in required else "?"
            lines.append(f"  {name}{optional}: {typescript_type(property_schema)};")
        lines.append("}")
        lines.append("")
    lines.extend([
        "export interface OWOPResultsByOperation {",
        *[f'  {json.dumps(operation)}: {result_class_name(operation)};' for operation in results],
        "}",
        "",
        "export interface OWOPRequest<K extends OWOPOperation = OWOPOperation> {",
        "  version: typeof OWOP_VERSION;",
        "  request_id: string;",
        "  correlation_id: string;",
        "  workspace_id: string;",
        "  operation: K;",
        "  params: OWOPParamsByOperation[K];",
        "  binding: { kind: OWOPBindingKind; endpoint?: string; host_alias?: string; socket_path?: string };",
        "}",
        "",
        "export interface OWOPError { code: string; message: string; correlation_id: string; retryable: boolean; details: Record<string, unknown> }",
        "export type OWOPResponse =",
        "  | { version: typeof OWOP_VERSION; request_id: string; correlation_id: string; ok: true; result: Record<string, unknown> }",
        "  | { version: typeof OWOP_VERSION; request_id: string; correlation_id: string; ok: false; error: OWOPError };",
        "",
    ])
    return "\n".join(lines)


def write_or_check(path: Path, content: str, check: bool) -> bool:
    normalized = content.rstrip() + "\n"
    if check:
        return path.is_file() and path.read_text(encoding="utf-8") == normalized
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(normalized)
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--python-out", type=Path, default=DEFAULT_PYTHON)
    parser.add_argument("--typescript-out", type=Path, default=DEFAULT_TYPESCRIPT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raw = args.schema.read_bytes()
    schema = json.loads(raw)
    digest = hashlib.sha256(raw).hexdigest()
    results = [
        write_or_check(args.python_out, generate_python(schema, digest), args.check),
        write_or_check(args.typescript_out, generate_typescript(schema, digest), args.check),
    ]
    if not all(results):
        print("OWOP generated types drift from owop.schema.json")
        return 1
    print("OWOP generated types are current" if args.check else "OWOP generated types updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
