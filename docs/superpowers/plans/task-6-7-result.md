# Tasks 6+7 Result: Chat types, useModelConfig, and ModelPicker

## Summary

Successfully updated all three files. `npx tsc --noEmit` passes with zero errors (including zero pre-existing errors in the entire project).

## Files Modified

### 1. `desktop/drsai-desktop/src/renderer/src/screens/Chat/types.ts`

**Changes:**
- Added `ModelItem` interface matching the `listModels()` API return shape:
  - `alias`, `display_name`, `client_type`, `model`, `token_limit`, `max_tokens`, `reasoning?`
- Updated `ModelGroup` to use `client_type` (instead of `provider`) and `ModelItem[]` (instead of inline model shape)
- `UsageState`, `MessageRole`, and `ChatMessage` remain unchanged

### 2. `desktop/drsai-desktop/src/renderer/src/screens/Chat/hooks/useModelConfig.ts`

**Changes:**
- `groupModelsByProvider` → `groupModelsByClientType`:
  - Accepts `ModelItem[]` instead of inline model shape
  - Groups by `m.client_type` (fallback `"auto"`)
  - Builds `providerLabel` from `PROVIDERS.labels` with special-casing for `anthropic`/`openai`
- `reload()`:
  - Destructures `catalog` from `listModels()` and accesses `catalog.models` (matches API return `{ default_alias, models }`)
  - Stores `allModels` in state for `displayModel` lookup
- `displayModel`:
  - Now searches `allModels` to find `display_name` for the current model
  - Falls back to extracting from path (last segment after `/`)

### 3. `desktop/drsai-desktop/src/renderer/src/screens/Chat/ModelPicker.tsx`

**Changes:**
- Imports `ModelGroup, ModelItem` from `./types` (instead of just `ModelGroup`)
- Group key: `group.client_type` (was `group.provider`)
- Model key: `${m.client_type}:${m.alias}` (was `${m.provider}:${m.model}`)
- Active check: `currentProvider === m.client_type` (was `currentProvider === m.provider`)
- Select call: `select(m.client_type, m.model, "")` (was `select(m.provider, m.model, m.baseUrl)`)
- Display: `m.display_name` / `m.alias` (was `m.label` / `m.model`)

## Verification

```bash
cd /home/xiongdb/drsai/desktop/drsai-desktop && npx tsc --noEmit
# Exit code: 0, no output = zero errors
```

The type system now correctly reflects the unified `listModels()` API response shape throughout the Chat screen's model selection pipeline.