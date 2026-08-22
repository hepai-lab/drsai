from __future__ import annotations

import json

import pytest

from drsai.config.tool_registry import (
    ToolResource,
    delete_tool_resource,
    get_tool_resource,
    list_tool_resources,
    put_tool_resource,
    merge_tool_secret_placeholders,
    resolve_tool_config,
    resolve_tool_set,
    tool_resource_payload,
)


def test_legacy_tools_migrate_to_stable_toml_resources(tmp_path) -> None:
    legacy = tmp_path / "TOOLS_CONFIG.json"
    legacy.write_text(json.dumps([
        {"name": "GitHub MCP", "type": "mcp-std", "config": {"command": "node", "args": ["server.js"]}},
        {"tool_id": "web.search", "name": "Web search", "type": "local", "config": {"provider": "bing"}, "enabled": False},
    ]), encoding="utf-8")

    resources = list_tool_resources(tmp_path)

    assert len(resources) == 2
    assert {resource.tool_id for resource in resources} >= {"web.search"}
    assert get_tool_resource(tmp_path, "web.search").enabled is False
    assert legacy.with_suffix(".json.migrated.bak").is_file()
    assert not legacy.exists()
    assert len(list((tmp_path / "tools").glob("tool_*.toml"))) == 2


def test_tool_registry_round_trip_and_delete(tmp_path) -> None:
    expected = ToolResource("mcp.github", "mcp-sse", {"url": "https://example.invalid/sse", "headers": {"x-test": "ok"}}, "GitHub")
    assert put_tool_resource(tmp_path, expected) == expected
    assert get_tool_resource(tmp_path, "mcp.github") == expected
    assert delete_tool_resource(tmp_path, "mcp.github") == expected
    assert list_tool_resources(tmp_path) == ()


def test_tool_registry_rejects_file_identity_mismatch(tmp_path) -> None:
    directory = tmp_path / "tools"
    directory.mkdir()
    (directory / "tool_wrong.toml").write_text(
        'schema_version = 1\ntool_id = "other"\ntype = "local"\nconfig_json = "{}"\n',
        encoding="utf-8",
    )
    with pytest.raises(Exception, match="invalid"):
        list_tool_resources(tmp_path)


def test_resolve_tool_set_applies_agent_explicit_policy() -> None:
    resources = (
        ToolResource("web.search", "local", {}, enabled=True),
        ToolResource("mcp.offline", "mcp-std", {}, enabled=False),
    )
    resolved = resolve_tool_set(
        mode="explicit",
        enabled=("web.search", "mcp.offline", "missing.tool", "builtin.files"),
        disabled=("builtin.files",),
        resources=resources,
        builtin_ids=("builtin.files",),
    )
    assert resolved.enabled_ids == ("web.search", "missing.tool")
    assert resolved.missing_ids == ("missing.tool",)
    assert resolved.disabled_ids == ("builtin.files",)


def test_tool_secrets_are_protected_redacted_and_runtime_resolvable(tmp_path) -> None:
    secret = "Bearer top-secret-tool-token"
    resource = put_tool_resource(tmp_path, ToolResource(
        "mcp.secure", "mcp-sse",
        {"url": "https://example.invalid/sse", "headers": {"Authorization": secret, "x-api-key": "key-secret"}},
    ))
    stored_text = (tmp_path / "tools" / "tool_mcp.secure.toml").read_text(encoding="utf-8")
    public = tool_resource_payload(resource)

    assert secret not in stored_text
    assert "key-secret" not in stored_text
    assert public["config"]["headers"]["Authorization"] == "***configured***"
    assert "drsai-credential:" not in json.dumps(public)
    hydrated = resolve_tool_config(resource.config, tmp_path)
    assert hydrated["headers"]["Authorization"] == secret
    assert hydrated["headers"]["x-api-key"] == "key-secret"
    merged = merge_tool_secret_placeholders(public["config"], resource.config)
    assert merged["headers"]["Authorization"] == resource.config["headers"]["Authorization"]


def test_legacy_tool_secret_backup_is_sanitized(tmp_path) -> None:
    legacy = tmp_path / "TOOLS_CONFIG.json"
    legacy.write_text(json.dumps([{
        "tool_id": "mcp.secure", "type": "mcp-sse",
        "config": {"url": "https://example.invalid/sse", "headers": {"Authorization": "legacy-secret"}},
    }]), encoding="utf-8")

    list_tool_resources(tmp_path)

    all_config_text = "\n".join(path.read_text(encoding="utf-8") for path in tmp_path.rglob("*.toml"))
    backup_text = (tmp_path / "TOOLS_CONFIG.json.migrated.bak").read_text(encoding="utf-8")
    assert "legacy-secret" not in all_config_text
    assert "legacy-secret" not in backup_text


def test_replacing_and_deleting_tool_cleans_protected_credentials(tmp_path) -> None:
    first = put_tool_resource(tmp_path, ToolResource(
        "mcp.secure", "mcp-sse", {"url": "https://example.invalid", "headers": {"Authorization": "first-secret"}},
    ))
    first_ref = first.config["headers"]["Authorization"]
    assert resolve_tool_config(first.config, tmp_path)["headers"]["Authorization"] == "first-secret"
    second = put_tool_resource(tmp_path, ToolResource(
        "mcp.secure", "mcp-sse", {"url": "https://example.invalid", "headers": {"Authorization": "second-secret"}},
    ))
    with pytest.raises(Exception, match="credential is unavailable"):
        resolve_tool_config({"Authorization": first_ref}, tmp_path)
    assert resolve_tool_config(second.config, tmp_path)["headers"]["Authorization"] == "second-secret"
    delete_tool_resource(tmp_path, "mcp.secure")
    with pytest.raises(Exception, match="credential is unavailable"):
        resolve_tool_config(second.config, tmp_path)
