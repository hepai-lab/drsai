# Task 1: ModelEntry.to_dict() + save/ensure helpers

## Status: DONE

## What was implemented

1. **`ReasoningConfig.to_dict()`** - Added serialization method to the `ReasoningConfig` dataclass that returns a dict with `supported`, `effort_levels`, and `param_type`.

2. **`ModelEntry.to_dict()`** - Added serialization method to the `ModelEntry` dataclass that returns a dict with `model`, `token_limit`, `max_tokens`, and `client_type`. Includes `reasoning` key only when `reasoning.supported` is True.

3. **`DEFAULT_LLM_CONFIG_FILE`** - Added constant for the default YAML config path: `{CONFIG_DIR}/llm_mode_config.yaml`

4. **`get_llm_config_file_path()`** - Returns the `llm_config_file` path from `cli_config.json`, or `None` if not set or on error.

5. **`ensure_llm_config_file()`** - Ensures the YAML config file exists, seeding from `DEFAULT_LLM_MODE_CONFIG` if needed, and updates `cli_config.json` with the path.

6. **`_write_llm_config()`** - Internal helper that serializes a `dict[str, ModelEntry]` to YAML using `to_dict()`.

7. **`save_llm_mode_config()`** - Public API to persist model config to the configured YAML file.

## Files changed

- **`python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`**
  - Added import: `from drsai.backend.cli.config import load_config, save_config`
  - Added `CONFIG_DIR` to the existing import from `drsai.configs.constant`
  - Added `DEFAULT_LLM_CONFIG_FILE` constant
  - Added `to_dict()` to `ReasoningConfig` (lines ~65-70)
  - Added `to_dict()` to `ModelEntry` (lines ~140-152)
  - Added 4 new functions: `get_llm_config_file_path()`, `ensure_llm_config_file()`, `_write_llm_config()`, `save_llm_mode_config()` (lines ~390-437)

## Verification output

```
$ python -c "from drsai.backend.run_drsai_agent_factory import ModelEntry, ReasoningConfig, ensure_llm_config_file, save_llm_mode_config; print('OK')"
OK
```

All unit tests pass:
- `ReasoningConfig.to_dict()`: OK
- `ReasoningConfig.to_dict()` defaults: OK
- `ModelEntry.to_dict()` with reasoning: OK
- `ModelEntry.to_dict()` without reasoning: OK