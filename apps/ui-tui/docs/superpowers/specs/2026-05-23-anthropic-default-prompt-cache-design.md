# Design: Default Anthropic Prompt Cache

## Goal
Enable Anthropic prompt caching by default for DrSai Anthropic model clients, including Claude and Anthropic-compatible providers such as MiniMax/HepAI Anthropic gateway.

## Default behavior
- `anthropic_cache_enabled`: defaults to `True`.
- `anthropic_cache_ttl`: defaults to `"1h"`.
- Applies to every model routed through `client_type == "anthropic"`.
- The effective cache control object is:
  ```python
  {"type": "ephemeral", "ttl": "1h"}
  ```

## Configuration inputs
`run_drsai_agent_factory.py` reads from:
1. Environment variables:
   - `DRSAI_ANTHROPIC_CACHE_ENABLED`
   - `DRSAI_ANTHROPIC_CACHE_TTL`
2. `cli_cfg` keys:
   - `anthropic_cache_enabled`
   - `anthropic_cache_ttl`
3. Defaults: enabled, `1h`.

`run_drsai_agent.py` reads from function parameters first, then environment variables, then defaults.

Accepted TTL values are `"5m"` and `"1h"`; invalid values fall back to `"1h"`.

## Data flow
The entry points compute:

```python
anthropic_cache_control = {"type": "ephemeral", "ttl": ttl} if enabled else None
```

For Anthropic clients, they attach it to:

```python
model_info["anthropic_cache_control"] = anthropic_cache_control
```

`HepAIAnthropicChatCompletionClient` consumes that value in streaming requests and sends it to Anthropic SDK as:

```python
request_args["cache_control"] = cache_control
```

## Implementation scope
Modify:
- `/home/xiongdb/drsai/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`
- `/home/xiongdb/drsai/run_drsai_agent.py`
- `/home/xiongdb/drsai/python/packages/drsai/src/drsai/modules/components/model_client/anthropic/_anthropic_client.py`

The Anthropic client must override `create_stream()` because the existing `create_stream_tmp()` is not called by project code.

## Verification
- Run Python syntax compilation on modified files.
- Confirm the Anthropic client injects `cache_control` into request args when model info contains `anthropic_cache_control`.
- Confirm cache can be disabled via `DRSAI_ANTHROPIC_CACHE_ENABLED=false`.
