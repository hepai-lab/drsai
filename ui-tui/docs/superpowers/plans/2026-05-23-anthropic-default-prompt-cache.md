# Anthropic Default Prompt Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Anthropic prompt caching by default with TTL `1h` for all DrSai Anthropic client branches.

**Architecture:** Entry points compute an Anthropic `cache_control` object from environment/config/function arguments and attach it to `model_info`. The Anthropic model client reads `model_info["anthropic_cache_control"]`, injects it into `messages.create(...)`, and logs cache usage fields from streaming responses.

**Tech Stack:** Python 3.12, Anthropic Python SDK, AutoGen model client abstractions.

---

## File Structure

- Modify `/home/xiongdb/drsai/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`
  - Add boolean parsing helper.
  - Read `DRSAI_ANTHROPIC_CACHE_ENABLED` / `DRSAI_ANTHROPIC_CACHE_TTL` with defaults `True` / `1h`.
  - Attach `anthropic_cache_control` to Anthropic `model_info`.
- Modify `/home/xiongdb/drsai/run_drsai_agent.py`
  - Add boolean parsing helper.
  - Add optional `create_agent()` args.
  - Read env vars with defaults `True` / `1h`.
  - Attach `anthropic_cache_control` to Anthropic `model_info`.
- Modify `/home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py`
  - Override `create_stream()` to call existing `create_stream_tmp()`.
  - Inject `cache_control` from `extra_create_args` or `model_info` into `request_args`.
  - Capture and log `cache_creation_input_tokens` and `cache_read_input_tokens`.

## Task 1: Add cache config parsing in factory

**Files:**
- Modify: `/home/xiongdb/drsai/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

- [ ] Add helper near `_resolve` or before `create_agent()`:

```python
def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on", "enable", "enabled"}:
        return True
    if text in {"0", "false", "no", "n", "off", "disable", "disabled"}:
        return False
    return default
```

- [ ] In `create_agent()`, after Anthropic/OpenAI API URL/key resolution, add:

```python
    anthropic_cache_enabled = _as_bool(
        _resolve(
            cli_cfg,
            "anthropic_cache_enabled",
            "DRSAI_ANTHROPIC_CACHE_ENABLED",
            default=True,
        ),
        default=True,
    )
    anthropic_cache_ttl = str(
        _resolve(
            cli_cfg,
            "anthropic_cache_ttl",
            "DRSAI_ANTHROPIC_CACHE_TTL",
            default="1h",
        )
    )
    if anthropic_cache_ttl not in {"5m", "1h"}:
        anthropic_cache_ttl = "1h"
    anthropic_cache_control = (
        {"type": "ephemeral", "ttl": anthropic_cache_ttl}
        if anthropic_cache_enabled
        else None
    )
```

- [ ] In `set_model_client()` Anthropic branch, before constructing `HepAIAnthropicChatCompletionClient`, add:

```python
            if anthropic_cache_control is not None:
                model_info["anthropic_cache_control"] = anthropic_cache_control
```

## Task 2: Add cache config parsing in standalone run_drsai_agent.py

**Files:**
- Modify: `/home/xiongdb/drsai/run_drsai_agent.py`

- [ ] Add helper near env constants:

```python
def _as_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on", "enable", "enabled"}:
        return True
    if text in {"0", "false", "no", "n", "off", "disable", "disabled"}:
        return False
    return default
```

- [ ] Extend `create_agent()` signature:

```python
def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "hepai/deepseek-v4-flash",
        anthropic_cache_enabled: bool | None = None,
        anthropic_cache_ttl: str | None = None,
) -> DrSaiAssistant:
```

- [ ] At start of `create_agent()`, compute cache control:

```python
    if anthropic_cache_enabled is None:
        anthropic_cache_enabled = _as_bool(
            os.getenv("DRSAI_ANTHROPIC_CACHE_ENABLED"),
            default=True,
        )
    if anthropic_cache_ttl is None:
        anthropic_cache_ttl = os.getenv("DRSAI_ANTHROPIC_CACHE_TTL") or "1h"
    if anthropic_cache_ttl not in {"5m", "1h"}:
        anthropic_cache_ttl = "1h"
    anthropic_cache_control = (
        {"type": "ephemeral", "ttl": anthropic_cache_ttl}
        if anthropic_cache_enabled
        else None
    )
```

- [ ] In Anthropic branch, replace direct `_MODEL_INFO` mutation with copy and inject cache:

```python
            model_info = dict(_MODEL_INFO["claude-sonnet-4-5"])
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            if anthropic_cache_control is not None:
                model_info["anthropic_cache_control"] = anthropic_cache_control
```

## Task 3: Make Anthropic client consume cache config

**Files:**
- Modify: `/home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py`

- [ ] Add `create_stream()` method to `HepAIAnthropicChatCompletionClient` that delegates to `create_stream_tmp()` with same signature.

- [ ] In `create_stream_tmp()`, after building `request_args` and before `messages.create`, add cache injection:

```python
        cache_control = create_args.get("cache_control")
        if cache_control is None:
            cache_control = self._model_info.get("anthropic_cache_control")
        if cache_control:
            request_args["cache_control"] = cache_control
```

- [ ] Also include `cache_control` in optional parameter passthrough list:

```python
        for param in ["top_p", "top_k", "stop_sequences", "metadata", "cache_control"]:
            if param in create_args:
                request_args[param] = create_args[param]
```

- [ ] Add streaming cache usage counters:

```python
        cache_creation_input_tokens: int = 0
        cache_read_input_tokens: int = 0
```

- [ ] In `message_start` and `message_delta` usage handling, update counters using `getattr(usage_obj, "cache_creation_input_tokens", None)` and `getattr(usage_obj, "cache_read_input_tokens", None)`.

- [ ] Before final usage update or near end event, log:

```python
        logger.info(
            "Anthropic prompt cache: creation=%s read=%s hit=%s",
            cache_creation_input_tokens,
            cache_read_input_tokens,
            cache_read_input_tokens > 0,
        )
```

## Task 4: Verify

**Files:**
- Verify modified files.

- [ ] Run syntax compilation:

```bash
python -m py_compile \
  /home/xiongdb/drsai/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py \
  /home/xiongdb/drsai/run_drsai_agent.py \
  /home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py
```

Expected: exits 0 with no output.

- [ ] Run grep verification:

```bash
grep -RIn "anthropic_cache_control\|DRSAI_ANTHROPIC_CACHE\|cache_control" \
  /home/xiongdb/drsai/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py \
  /home/xiongdb/drsai/run_drsai_agent.py \
  /home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py
```

Expected: shows env parsing, model_info injection, and request_args injection.
