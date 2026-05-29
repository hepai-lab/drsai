# Task 5: Update Preload Layer for Unified Model Config API

**Status**: ✅ Complete

## Changes Made

### 1. `desktop/drsai-desktop/src/preload/index.ts`

- **`getModelCatalog`** (line ~104): Added `reasoning?: { supported: boolean; effort_levels: string[]; param_type: string }` to the model entry type.

- **Old model stubs replaced** (lines ~468-528): Replaced the old `listModels`, `addModel`, `removeModel`, `updateModel` stubs with the new unified backend API:
  - `listModels` - now returns `{ default_alias, models: [...] }` with `reasoning` field
  - `getModelDetail(alias)` - **new** method to get a single model by alias
  - `addModel(body)` - now takes a single body object with `alias`, `model`, `token_limit`, `max_tokens`, `client_type`, `reasoning`
  - `updateModel(alias, body)` - now takes alias + body with optional `new_alias` for renaming
  - `removeModel(alias)` - now takes alias instead of id, returns `{ ok, new_default_alias }`
  - `setDefaultModel(alias)` - **new** method to set the default model

### 2. `desktop/drsai-desktop/src/preload/index.d.ts`

- **`getModelCatalog`** (line ~149): Added `reasoning` field to match the implementation.

- **`DrSaiAPI` model section** (lines ~411-469): Updated all model-related type signatures to match the new unified backend API (same structure as index.ts, without the `=> ipcRenderer.invoke(...)` part).

## Verification

- `npx tsc --noEmit` passed with no errors.
- All old model stubs were successfully replaced.
- All new methods (`getModelDetail`, `setDefaultModel`) were added.
- `reasoning` field was added to `getModelCatalog` and all model return types.