"""Generate small, dependency-free Relay contract catalogs from the schema."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/runtime-relay.schema.json"
PY_OUT = ROOT / "cores/python/packages/drsai/src/drsai/relay/generated_contract.py"
KT_OUT = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"
TS_OUT = ROOT / "apps/desktop/shared/api/runtimeRelayErrorActions.generated.ts"

ERROR_ACTIONS = ("retry", "login", "re-pair", "update", "contact-admin")


def generated_error_actions(data: dict[str, object]) -> dict[str, str]:
    groups = data.get("x-relay-error-actions")
    if not isinstance(groups, dict) or set(groups) != set(ERROR_ACTIONS):
        raise ValueError("Relay error actions must define the five frozen user actions")
    result: dict[str, str] = {}
    for action in ERROR_ACTIONS:
        codes = groups.get(action)
        if not isinstance(codes, list) or not codes:
            raise ValueError(f"Relay error action group is empty: {action}")
        for code in codes:
            if not isinstance(code, str) or not code or code != code.lower():
                raise ValueError(f"Relay error code is invalid: {code!r}")
            if code in result:
                raise ValueError(f"Relay error code is assigned more than once: {code}")
            result[code] = action
    return dict(sorted(result.items()))


def generated_dtos(data: dict[str, object]) -> list[tuple[str, str, dict[str, object]]]:
    definitions = data["$defs"]
    result = []
    for class_name, schema_name in data.get("x-relay-generated-dtos", {}).items():
        schema = definitions.get(schema_name)
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ValueError(f"Generated DTO schema is missing or not an object: {schema_name}")
        if schema.get("additionalProperties") is not False:
            raise ValueError(f"Generated DTO must forbid unknown fields: {schema_name}")
        result.append((class_name, schema_name, schema))
    return result


def _deref(data: dict[str, object], schema: dict[str, object]) -> tuple[str | None, dict[str, object]]:
    reference = schema.get("$ref")
    if not isinstance(reference, str):
        return None, schema
    prefix = "#/$defs/"
    if not reference.startswith(prefix):
        raise ValueError(f"Unsupported generated DTO reference: {reference}")
    name = reference.removeprefix(prefix)
    target = data["$defs"].get(name)
    if not isinstance(target, dict):
        raise ValueError(f"Generated DTO reference is missing: {reference}")
    return name, target


def _nullable_variant(schema: dict[str, object]) -> dict[str, object] | None:
    variants = schema.get("oneOf")
    if not isinstance(variants, list):
        return None
    non_null = [item for item in variants if isinstance(item, dict) and item.get("type") != "null"]
    nulls = [item for item in variants if isinstance(item, dict) and item.get("type") == "null"]
    return non_null[0] if len(non_null) == 1 and len(nulls) == 1 else None


def _python_type(data: dict[str, object], schema: dict[str, object], classes: dict[str, str]) -> str:
    ref_name, resolved = _deref(data, schema)
    if ref_name in classes:
        return classes[ref_name]
    schema = resolved
    nullable = _nullable_variant(schema)
    if nullable is not None:
        return f"{_python_type(data, nullable, classes)} | None"
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null = [item for item in schema_type if item != "null"]
        if len(non_null) == 1 and len(non_null) != len(schema_type):
            return f"{_python_type(data, {**schema, 'type': non_null[0]}, classes)} | None"
    if "const" in schema:
        return f"Literal[{schema['const']!r}]"
    values = schema.get("enum")
    if isinstance(values, list):
        return "Literal[" + ", ".join(repr(item) for item in values) + "]"
    if schema_type == "string":
        if schema.get("format") == "uuid":
            # UUID is a string at the JSON boundary. Keeping the wire type as
            # strict str avoids Pydantic's Python-mode UUID instance demand;
            # format validation remains part of the shared JSON Schema gate.
            return "str"
        if schema.get("format") == "date-time":
            # Generated wire DTOs preserve RFC3339 timestamps as JSON strings.
            # Runtime domain models may use datetime internally, but the Relay
            # boundary is intentionally strict about the serialized type.
            return "str"
        return "str"
    if schema_type == "integer":
        return "int"
    if schema_type == "number":
        return "float"
    if schema_type == "boolean":
        return "bool"
    if schema_type == "array":
        return f"list[{_python_type(data, schema['items'], classes)}]"
    if schema_type == "object" and isinstance(schema.get("additionalProperties"), dict):
        return f"dict[str, {_python_type(data, schema['additionalProperties'], classes)}]"
    if schema_type == "object":
        return "dict[str, Any]"
    raise ValueError(f"Unsupported generated Python DTO property: {schema}")


def render_python_dtos(data: dict[str, object]) -> str:
    specs = generated_dtos(data)
    classes = {schema_name: class_name for class_name, schema_name, _ in specs}
    blocks: list[str] = []
    for class_name, _, schema in specs:
        required = set(schema.get("required", []))
        lines = [f"class {class_name}(GeneratedWireStrictModel):"]
        for name, prop in schema.get("properties", {}).items():
            annotation = _python_type(data, prop, classes)
            if name not in required and "default" in prop:
                if prop["default"] == []:
                    lines.append(f"    {name}: {annotation} = Field(default_factory=list)")
                else:
                    lines.append(f"    {name}: {annotation} = {prop['default']!r}")
            elif name not in required:
                if "None" not in annotation:
                    annotation += " | None"
                lines.append(f"    {name}: {annotation} = None")
            else:
                lines.append(f"    {name}: {annotation}")
        any_of = schema.get("anyOf")
        if isinstance(any_of, list):
            alternatives = [item.get("required", []) for item in any_of if isinstance(item, dict)]
            expression = " or ".join(
                " and ".join(f"self.{name} is not None" for name in names)
                for names in alternatives
            )
            lines.extend([
                "",
                "    @model_validator(mode=\"after\")",
                f"    def validate_{class_name.removeprefix('Generated').lower()}(self):",
                f"        if not ({expression}):",
                "            raise ValueError(\"generated_dto_required_alternative_missing\")",
                "        return self",
            ])
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def _kotlin_type(data: dict[str, object], schema: dict[str, object], classes: dict[str, str]) -> tuple[str, str]:
    ref_name, resolved = _deref(data, schema)
    if ref_name in classes:
        return classes[ref_name], "object"
    schema = resolved
    nullable = _nullable_variant(schema)
    if nullable is not None:
        value_type, decoder = _kotlin_type(data, nullable, classes)
        return value_type + "?", "nullable_" + decoder
    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        non_null = [item for item in schema_type if item != "null"]
        if len(non_null) == 1 and len(non_null) != len(schema_type):
            value_type, decoder = _kotlin_type(data, {**schema, "type": non_null[0]}, classes)
            return value_type + "?", "nullable_" + decoder
    if "const" in schema or isinstance(schema.get("enum"), list):
        return "String", "string"
    if schema_type == "string":
        return "String", "string"
    if schema_type == "integer":
        return "Long", "long"
    if schema_type == "number":
        return "Double", "double"
    if schema_type == "boolean":
        return "Boolean", "boolean"
    if schema_type == "array":
        item_type, item_decoder = _kotlin_type(data, schema["items"], classes)
        if item_decoder == "string":
            return "List<String>", "string_list"
        raise ValueError(f"Unsupported generated Kotlin DTO array: {schema}")
    if schema_type == "object" and isinstance(schema.get("additionalProperties"), dict):
        item_type, item_decoder = _kotlin_type(data, schema["additionalProperties"], classes)
        if item_decoder == "long":
            return "Map<String, Long>", "long_map"
    raise ValueError(f"Unsupported generated Kotlin DTO property: {schema}")


def _kotlin_decode(name: str, decoder: str, kotlin_type: str) -> str:
    if decoder == "object":
        return f"{kotlin_type}.fromJson(value.generatedObject(\"{name}\"))"
    if decoder == "nullable_object":
        base = kotlin_type.removesuffix("?")
        return f"value.generatedNullableObject(\"{name}\")?.let({base}::fromJson)"
    helpers = {
        "string": "generatedString",
        "nullable_string": "generatedNullableString",
        "long": "generatedLong",
        "nullable_long": "generatedNullableLong",
        "double": "generatedDouble",
        "nullable_double": "generatedNullableDouble",
        "boolean": "generatedBoolean",
        "nullable_boolean": "generatedNullableBoolean",
        "string_list": "generatedStringList",
        "nullable_string_list": "generatedNullableStringList",
        "long_map": "generatedLongMap",
        "nullable_long_map": "generatedNullableLongMap",
    }
    return f"value.{helpers[decoder]}(\"{name}\")"


def _kotlin_encode(name: str, decoder: str, required: bool) -> str:
    if decoder in {"object", "nullable_object"}:
        encoded = f"{name}.toJson()" if decoder == "object" else f"{name}?.toJson()"
    elif decoder in {"string_list", "nullable_string_list"}:
        encoded = f"JSONArray({name})" if decoder == "string_list" else f"{name}?.let(::JSONArray)"
    elif decoder in {"long_map", "nullable_long_map"}:
        encoded = f"JSONObject({name})" if decoder == "long_map" else f"{name}?.let(::JSONObject)"
    else:
        encoded = name
    if required:
        if decoder.startswith("nullable_"):
            return f'put("{name}", {encoded} ?: JSONObject.NULL)'
        return f'put("{name}", {encoded})'
    return f'{name}?.let {{ put("{name}", {encoded.replace(name, "it", 1)}) }}'


def _kotlin_name(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(item[:1].upper() + item[1:] for item in tail)


def render_kotlin_dtos(data: dict[str, object]) -> str:
    specs = generated_dtos(data)
    classes = {schema_name: class_name for class_name, schema_name, _ in specs}
    blocks: list[str] = []
    for class_name, _, schema in specs:
        required = set(schema.get("required", []))
        fields = []
        decoders: dict[str, tuple[str, str, str, bool]] = {}
        for name, prop in schema.get("properties", {}).items():
            property_name = _kotlin_name(name)
            kotlin_type, decoder = _kotlin_type(data, prop, classes)
            has_default = name not in required and "default" in prop
            if name not in required and not has_default and not kotlin_type.endswith("?"):
                kotlin_type += "?"
                decoder = "nullable_" + decoder
            if has_default and prop["default"] == []:
                default = " = emptyList()"
            else:
                default = " = null" if name not in required else ""
            fields.append(f"    val {property_name}: {kotlin_type}{default},")
            decoders[name] = (property_name, kotlin_type, decoder, has_default)
        required_values = ", ".join(f'"{name}"' for name in schema.get("required", []))
        optional_values = ", ".join(
            f'"{name}"' for name in schema.get("properties", {}) if name not in required
        )
        body = [f"data class {class_name}(", *fields, ") {"]
        validations = []
        for name, prop in schema.get("properties", {}).items():
            property_name = _kotlin_name(name)
            _, resolved = _deref(data, prop)
            values = resolved.get("enum")
            optional_guard = f"{property_name} == null || " if name not in required else ""
            if "const" in resolved:
                validations.append(f'require({optional_guard}{property_name} == {resolved["const"]!r}) {{ "generated_dto_constant_invalid" }}'.replace("'", '"'))
            elif isinstance(values, list):
                encoded_values = ", ".join(repr(item) for item in values).replace("'", '"')
                validations.append(f'require({optional_guard}{property_name} in setOf({encoded_values})) {{ "generated_dto_enum_invalid" }}')
        any_of = schema.get("anyOf")
        if isinstance(any_of, list):
            alternatives = [item.get("required", []) for item in any_of if isinstance(item, dict)]
            expression = " || ".join(
                " && ".join(f"{_kotlin_name(name)} != null" for name in names)
                for names in alternatives
            )
            validations.append(f'require({expression}) {{ "generated_dto_required_alternative_missing" }}')
        if validations:
            body.extend(["    init {", *[f"        {line}" for line in validations], "    }"])
        body.extend([
            "    fun toJson(): JSONObject = JSONObject().apply {",
            *[f"        {_kotlin_encode(property_name, decoder, name in required or has_default).replace(chr(34) + property_name + chr(34), chr(34) + name + chr(34), 1)}" for name, (property_name, _, decoder, has_default) in decoders.items()],
            "    }",
            "",
            "    companion object {",
            "        fun fromJson(value: JSONObject): " + class_name + " {",
            f"            value.generatedRequireKeys(setOf({required_values}), setOf({optional_values}))",
            "            return " + class_name + "(",
            *[f"                {property_name} = " + (f"if (value.has(\"{name}\")) {_kotlin_decode(name, decoder, kotlin_type)} else emptyList()" if has_default else _kotlin_decode(name, decoder, kotlin_type)) + "," for name, (property_name, kotlin_type, decoder, has_default) in decoders.items()],
            "            )",
            "        }",
            "    }",
            "}",
        ])
        blocks.append("\n".join(body))
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def render_python(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    capability_profiles = data.get("x-relay-capability-profiles", {})
    minimum_versions = data.get("x-relay-minimum-versions", {})
    session_event_kinds = data.get("x-session-event-kinds", [])
    error_actions = generated_error_actions(data)
    profile_lines = ", ".join(
        f"{name!r}: frozenset({sorted(values)!r})"
        for name, values in sorted(capability_profiles.items())
    )
    return (
        '"""Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit."""\n'
        'from __future__ import annotations\n'
        'from datetime import datetime\n'
        'from typing import Any, Literal\n'
        'from uuid import UUID\n'
        'from pydantic import BaseModel, ConfigDict, Field, model_validator\n\n'
        f'SCHEMA_VERSION = {data["version"]!r}\n'
        f'PROTOCOL_VERSION = {data["protocol_version"]!r}\n'
        f'SOURCE_SCHEMA_SHA256 = {data["x-source-schema-sha256"]!r}\n'
        f'ENDPOINTS = {dict(sorted(endpoints.items()))!r}\n'
        f'CAPABILITIES = frozenset({sorted(capabilities)!r})\n\n'
        f'CAPABILITY_PROFILES = {{{profile_lines}}}\n'
        f'MINIMUM_VERSIONS = {dict(sorted(minimum_versions.items()))!r}\n'
        f'SESSION_EVENT_KINDS = frozenset({sorted(session_event_kinds)!r})\n\n'
        f'RELAY_ERROR_ACTIONS = {error_actions!r}\n'
        f'RELAY_USER_ACTIONS = frozenset({sorted(ERROR_ACTIONS)!r})\n\n'
        'def generated_relay_error_action(code: str | None, retryable: bool = False) -> str:\n'
        '    """Return one safe user action; unknown transient errors retry, all others escalate."""\n'
        '    return RELAY_ERROR_ACTIONS.get(code or "", "retry" if retryable else "contact-admin")\n\n'
        'class GeneratedStrictModel(BaseModel):\n    model_config = ConfigDict(extra="forbid", frozen=True)\n\n'
        'class GeneratedWireStrictModel(GeneratedStrictModel):\n    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)\n\n'
        'class GeneratedControlRequest(GeneratedStrictModel):\n    request_id: UUID\n    correlation_id: str\n    idempotency_key: str | None = None\n\n'
        'class GeneratedErrorEnvelope(GeneratedStrictModel):\n    code: str\n    message: str\n    correlation_id: str\n    retryable: bool\n    details: dict[str, Any]\n    source: Literal["relay", "runtime"]\n\n'
        'class GeneratedRelayEvent(GeneratedStrictModel):\n    event_id: str\n    sequence: int\n    runtime_id: str\n    workspace_id: str\n    session_id: str\n    run_id: str\n    timestamp: datetime\n    kind: str\n    payload: dict[str, Any]\n\n'
        'class GeneratedSessionConversationItem(GeneratedStrictModel):\n    item_id: str\n    session_id: str\n    run_id: str | None\n    kind: Literal["message", "reasoning", "tool", "file_change", "approval", "artifact", "error"]\n    role: Literal["user", "assistant", "system", "tool"] | None\n    revision: int\n    session_sequence: int\n    source_client: Literal["windows", "android", "runtime"]\n    source_message_id: str | None\n    created_at: datetime\n    updated_at: datetime\n    payload: dict[str, Any]\n\n'
        'class GeneratedConversationSnapshot(GeneratedStrictModel):\n    session_id: str\n    snapshot_sequence: int\n    items: list[GeneratedSessionConversationItem]\n    next_cursor: str | None\n\n'
        'class GeneratedSessionEvent(GeneratedStrictModel):\n    event_id: str\n    runtime_id: str\n    workspace_id: str\n    session_id: str\n    run_id: str | None\n    item_id: str | None = None\n    item_revision: int | None = None\n    session_sequence: int\n    kind: str\n    timestamp: datetime\n    payload: dict[str, Any]\n\n'
        'class GeneratedRuntimeSessionEventFrame(GeneratedStrictModel):\n    type: Literal["event"] = "event"\n    scope: Literal["session"] = "session"\n    session_id: str\n    session_sequence: int\n    event: GeneratedSessionEvent\n\n'
        + render_python_dtos(data)
    )


def render_kotlin(data: dict[str, object]) -> str:
    endpoints = data["x-relay-endpoints"]
    capabilities = data["x-relay-capabilities"]
    capability_profiles = data.get("x-relay-capability-profiles", {})
    minimum_versions = data.get("x-relay-minimum-versions", {})
    session_event_kinds = data.get("x-session-event-kinds", [])
    error_actions = generated_error_actions(data)
    endpoint_lines = ",\n".join(f'        "{k}" to "{v}"' for k, v in sorted(endpoints.items()))
    capability_lines = ",\n".join(f'        "{value}"' for value in sorted(capabilities))
    profile_lines = ",\n".join(
        f'        "{profile}" to setOf({", ".join(f"{value!r}" for value in sorted(values))})'.replace("'", '"')
        for profile, values in sorted(capability_profiles.items())
    )
    minimum_version_lines = ",\n".join(
        f'        "{profile}" to mapOf({", ".join(f"{component!r} to {version!r}" for component, version in sorted(versions.items()))})'.replace("'", '"')
        for profile, versions in sorted(minimum_versions.items())
    )
    session_event_kind_lines = ",\n".join(
        f'        "{value}"' for value in sorted(session_event_kinds)
    )
    error_action_lines = ",\n".join(
        f'        "{code}" to "{action}"' for code, action in error_actions.items()
    )
    dto_text = render_kotlin_dtos(data)
    return f'''// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

import org.json.JSONArray
import org.json.JSONObject

object RelayContractGenerated {{
    const val SCHEMA_VERSION: String = "{data['version']}"
    const val PROTOCOL_VERSION: String = "{data['protocol_version']}"
    const val SOURCE_SCHEMA_SHA256: String = "{data['x-source-schema-sha256']}"
    val ENDPOINTS: Map<String, String> = mapOf(
{endpoint_lines}
    )
    val CAPABILITIES: Set<String> = setOf(
{capability_lines}
    )
    val CAPABILITY_PROFILES: Map<String, Set<String>> = mapOf(
{profile_lines}
    )
    val MINIMUM_VERSIONS: Map<String, Map<String, String>> = mapOf(
{minimum_version_lines}
    )
    val SESSION_EVENT_KINDS: Set<String> = setOf(
{session_event_kind_lines}
    )
    val ERROR_ACTIONS: Map<String, String> = mapOf(
{error_action_lines}
    )

    fun errorAction(code: String?, retryable: Boolean = false): String =
        ERROR_ACTIONS[code.orEmpty()] ?: if (retryable) "retry" else "contact-admin"
}}

data class GeneratedControlRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
)

data class GeneratedErrorEnvelope(
    val code: String,
    val message: String,
    val correlationId: String,
    val retryable: Boolean,
    val details: Map<String, Any?>,
    val source: String,
)

data class GeneratedRelayEvent(
    val eventId: String,
    val sequence: Long,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val timestamp: String,
    val kind: String,
    val payload: Map<String, Any?>,
)

data class GeneratedSessionConversationItem(
    val itemId: String,
    val sessionId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payload: Map<String, Any?>,
)

data class GeneratedConversationSnapshot(
    val sessionId: String,
    val snapshotSequence: Long,
    val items: List<GeneratedSessionConversationItem>,
    val nextCursor: String?,
)

data class GeneratedSessionEvent(
    val eventId: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
    val itemId: String? = null,
    val itemRevision: Long? = null,
)

data class GeneratedRuntimeSessionEventFrame(
    val type: String = "event",
    val scope: String = "session",
    val sessionId: String,
    val sessionSequence: Long,
    val event: GeneratedSessionEvent,
)

{dto_text}
private fun JSONObject.generatedRequireKeys(required: Set<String>, optional: Set<String>) {{
    val actual = keys().asSequence().toSet()
    require(actual.containsAll(required) && actual.all {{ it in required || it in optional }}) {{
        "generated_dto_shape_invalid"
    }}
}}

private fun JSONObject.generatedString(name: String): String =
    get(name).let {{ require(it is String) {{ "generated_dto_type_invalid" }}; it }}

private fun JSONObject.generatedNullableString(name: String): String? =
    if (!has(name) || isNull(name)) null else generatedString(name)

private fun JSONObject.generatedLong(name: String): Long = get(name).let {{
    require(it is Byte || it is Short || it is Int || it is Long) {{ "generated_dto_type_invalid" }}
    (it as Number).toLong()
}}

private fun JSONObject.generatedNullableLong(name: String): Long? =
    if (!has(name) || isNull(name)) null else generatedLong(name)

private fun JSONObject.generatedDouble(name: String): Double = get(name).let {{
    require(it is Number) {{ "generated_dto_type_invalid" }}
    it.toDouble().also {{ value -> require(value.isFinite()) {{ "generated_dto_type_invalid" }} }}
}}

private fun JSONObject.generatedNullableDouble(name: String): Double? =
    if (!has(name) || isNull(name)) null else generatedDouble(name)

private fun JSONObject.generatedBoolean(name: String): Boolean =
    get(name).let {{ require(it is Boolean) {{ "generated_dto_type_invalid" }}; it }}

private fun JSONObject.generatedNullableBoolean(name: String): Boolean? =
    if (!has(name) || isNull(name)) null else generatedBoolean(name)

private fun JSONObject.generatedObject(name: String): JSONObject =
    get(name).let {{ require(it is JSONObject) {{ "generated_dto_type_invalid" }}; it }}

private fun JSONObject.generatedNullableObject(name: String): JSONObject? =
    if (!has(name) || isNull(name)) null else generatedObject(name)

private fun JSONObject.generatedStringList(name: String): List<String> =
    get(name).let {{ value ->
        require(value is JSONArray) {{ "generated_dto_type_invalid" }}
        List(value.length()) {{ index ->
            value.get(index).let {{ item -> require(item is String) {{ "generated_dto_type_invalid" }}; item }}
        }}
    }}

private fun JSONObject.generatedNullableStringList(name: String): List<String>? =
    if (!has(name) || isNull(name)) null else generatedStringList(name)

private fun JSONObject.generatedLongMap(name: String): Map<String, Long> = generatedObject(name).let {{ value ->
    value.keys().asSequence().associateWith {{ key -> value.generatedLong(key) }}
}}

private fun JSONObject.generatedNullableLongMap(name: String): Map<String, Long>? =
    if (!has(name) || isNull(name)) null else generatedLongMap(name)
'''


def render_typescript(data: dict[str, object]) -> str:
    error_actions = generated_error_actions(data)
    entries = "\n".join(
        f'  "{code}": "{action}",' for code, action in error_actions.items()
    )
    return f'''// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
export type RelayUserAction = "retry" | "login" | "re-pair" | "update" | "contact-admin";

export const RELAY_ERROR_ACTIONS = Object.freeze({{
{entries}
}} satisfies Record<string, RelayUserAction>);

export function relayErrorAction(code: string | null | undefined, retryable = false): RelayUserAction {{
  return RELAY_ERROR_ACTIONS[code ?? ""] ?? (retryable ? "retry" : "contact-admin");
}}
'''


def generated() -> tuple[str, str, str]:
    raw = SCHEMA.read_bytes()
    data = json.loads(raw.decode("utf-8"))
    data["x-source-schema-sha256"] = hashlib.sha256(raw).hexdigest()
    return render_python(data), render_kotlin(data), render_typescript(data)


def main(check: bool = False) -> int:
    python_text, kotlin_text, typescript_text = generated()
    outputs = ((PY_OUT, python_text), (KT_OUT, kotlin_text), (TS_OUT, typescript_text))
    if check:
        drift = [str(path.relative_to(ROOT)) for path, text in outputs if not path.exists() or path.read_text(encoding="utf-8") != text]
        if drift:
            raise SystemExit("Relay generated contract drift: " + ", ".join(drift))
        return 0
    for path, text in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main("--check" in sys.argv))
