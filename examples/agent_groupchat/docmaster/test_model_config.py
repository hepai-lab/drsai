import logging

from autogen_ext.models.openai._openai_client import convert_tools

from model_config import (
    _TokenEstimatorSchemaWarningFilter,
    summarize_tool_schemas,
)


def test_summarize_tool_schemas_reports_size_shape_and_no_values():
    tools = [{
        "name": "example",
        "description": "example tool",
        "parameters": {
            "type": "object",
            "properties": {
                "choice": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": "secret"},
                "rows": {"type": "array", "items": {"type": "integer"}},
            },
            "additionalProperties": False,
        },
    }]

    summary = summarize_tool_schemas(tools)

    assert summary["tool_count"] == 1
    assert summary["schema_bytes"] > 0
    assert len(summary["schema_sha256"]) == 16
    assert summary["field_counts"] == {"additionalProperties": 1, "anyOf": 1, "default": 1, "items": 1}
    assert summary["largest_tools"][0]["name"] == "example"
    assert "secret" not in str(summary)


def test_token_estimator_filter_only_hides_known_noise():
    warning_filter = _TokenEstimatorSchemaWarningFilter()
    hidden = logging.LogRecord("x", logging.WARNING, __file__, 1, "Not supported field anyOf", (), None)
    visible = logging.LogRecord("x", logging.WARNING, __file__, 1, "provider rejected anyOf", (), None)

    assert warning_filter.filter(hidden) is False
    assert warning_filter.filter(visible) is True


def test_openai_request_converter_preserves_complex_schema_fields():
    schema = {
        "name": "example",
        "description": "example tool",
        "parameters": {
            "type": "object",
            "properties": {"rows": {"type": "array", "items": {"anyOf": [{"type": "integer"}]}}},
            "additionalProperties": False,
        },
    }

    parameters = convert_tools([schema])[0]["function"]["parameters"]

    assert parameters["additionalProperties"] is False
    assert parameters["properties"]["rows"]["items"]["anyOf"] == [{"type": "integer"}]
