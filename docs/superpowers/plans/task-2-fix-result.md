# Task 2 Fix Summary

**Date:** 2025-05-20

## Fix 1: `build_model_catalog` hardcodes `DEFAULT_CONFIG_NAME` instead of using actual default_alias

**File:** `python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

**Problem:** `build_model_catalog()` always returned `DEFAULT_CONFIG_NAME` as the `default_alias`, ignoring the actual default alias stored in the YAML file (`_default_alias`). After a user changes the default via `PUT /v1/models/config/default/{alias}`, `list_model_configs` would still show the hardcoded default.

**Fix:** Added an optional `default_alias` parameter to `build_model_catalog()`:
```python
def build_model_catalog(
    llm_config: Optional[dict[str, ModelEntry]] = None,
    default_alias: Optional[str] = None,
) -> dict[str, Any]:
```
And changed the return to use `default_alias or DEFAULT_CONFIG_NAME`.

**File:** `python/packages/drsai/src/drsai/backend/gateway.py`

**Fix:** Updated `list_model_configs` to pass the resolved default alias from `_get_live_llm_config()`:
```python
return build_model_catalog(llm_config, default_alias=default_alias)
```

The existing `GET /v1/config/model-catalog` endpoint remains unchanged (still uses the hardcoded default).

## Fix 2: Rename silently overwrites existing model

**File:** `python/packages/drsai/src/drsai/backend/gateway.py`

**Problem:** When renaming a model via `PUT /v1/models/config/{alias}`, if `body.new_alias` matched an existing model alias, it would silently overwrite it without warning.

**Fix:** Added a duplicate check before the rename:
```python
if body.new_alias and body.new_alias != alias:
    if body.new_alias in llm_config:
        raise HTTPException(status_code=409, detail=f"Model '{body.new_alias}' already exists")
    llm_config[body.new_alias] = entry
    del llm_config[alias]
```

## Fix 3: Dead variable `target_alias`

**File:** `python/packages/drsai/src/drsai/backend/gateway.py`

**Problem:** The line `target_alias = body.new_alias or alias` was assigned but never used anywhere.

**Fix:** Removed the dead variable assignment.

## Verification

```bash
cd /home/xiongdb/drsai && python -c "
from drsai.backend.run_drsai_agent_factory import build_model_catalog, DEFAULT_CONFIG_NAME
from drsai.backend.gateway import app

# Test build_model_catalog with custom default_alias
cat = build_model_catalog(default_alias='custom-default')
assert cat['default_alias'] == 'custom-default'

# Test build_model_catalog without default_alias (backward compat)
cat2 = build_model_catalog()
assert cat2['default_alias'] == DEFAULT_CONFIG_NAME

print('All checks pass')
"
```

**Result:** All checks pass.