# Task 1 Fix Results

## Fix 1: `default_alias` YAML roundtrip corruption

**File:** `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

**Problem:** `_write_llm_config()` wrote `default_alias` as a top-level YAML key. Since `load_llm_mode_config()` only filters keys starting with `_`, `default_alias` (which does NOT start with `_`) was passed to `ModelEntry.from_dict()` as if it were a model alias. Since its value is a plain string like `"hepai/minimax-m2.7-highspeed"`, `from_dict()` hit the fallback path and created a bogus `ModelEntry`.

**Fix:** Changed `"default_alias"` to `"_default_alias"` in `_write_llm_config()` (line 425):

```python
# Before
data: dict[str, Any] = {"default_alias": default_alias}

# After
data: dict[str, Any] = {"_default_alias": default_alias}
```

The leading underscore ensures it is filtered by the existing `alias.startswith("_")` check in `load_llm_mode_config()`.

## Fix 2: Missing exception handling in `ensure_llm_config_file()`

**Problem:** `ensure_llm_config_file()` called `load_config()` and `save_config()` directly without try/except, while `get_llm_config_file_path()` already wrapped it. If `cli_config.json` was missing or corrupted, this would crash.

**Fix:** Wrapped the `load_config()` / `save_config()` block in try/except:

```python
# Update cli_config.json (best-effort)
try:
    cfg = load_config()
    cfg["llm_config_file"] = str(path)
    save_config(cfg)
except Exception:
    pass
```

## Verification

```bash
cd /home/xiongdb/drsai && python -c "
from drsai.backend.run_drsai_agent_factory import ensure_llm_config_file, save_llm_mode_config, load_llm_mode_config
path = ensure_llm_config_file()
config = load_llm_mode_config(path)
print(f'Models loaded: {len(config)}')
for alias in config:
    print(f'  {alias}')
print('Roundtrip OK')
"
```

Output:
```
Models loaded: 12
  claude-sonnet-4-6
  claude-opus-4-7
  claude-haiku-4-5
  gpt-5.3-codex
  gpt-5.4
  gpt-5.5
  deepseek-v4-pro
  deepseek-v3.2
  hepai/deepseek-v4-flash
  glm-5.1
  hepai/minimax-m2.7-highspeed
  minimax-m2.7-highspeed
Roundtrip OK
```

The YAML file correctly stores `_default_alias`:

```yaml
_default_alias: hepai/minimax-m2.7-highspeed
claude-sonnet-4-6:
  model: anthropic/claude-sonnet-4-6
  ...
```

No bogus entries are loaded. Roundtrip is clean.