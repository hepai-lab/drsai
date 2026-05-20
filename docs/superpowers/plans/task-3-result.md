# Task 3 Result: Extend model-catalog.ts with Full CRUD API Functions

**Status:** ✅ Complete

## What was done

Rewrote `desktop/drsai-desktop/src/main/model-catalog.ts` (~41 lines → ~122 lines) to support full CRUD operations against the new backend endpoints.

### Changes summary

| Aspect | Before | After |
|--------|--------|-------|
| **HTTP helper** | Inline `http.request` in `getModelCatalog()` only | Generic `httpRequest<T>()` helper with error handling, status code checking, and JSON body support |
| **Types** | `ModelCatalogEntry`, `ModelCatalogResponse` | Added `ReasoningConfig`, added optional `reasoning` field to `ModelCatalogEntry` |
| **API functions** | 1 (`getModelCatalog`) | 6: `getModelCatalog`, `getModelConfig`, `createModelConfig`, `updateModelConfig`, `deleteModelConfig`, `setDefaultModelConfig` |
| **Endpoint paths** | `/v1/config/model-catalog` | Uses new `/v1/models/config` endpoints |

### New API functions

1. **`getModelCatalog()`** — `GET /v1/models/config` — Returns full catalog with default alias
2. **`getModelConfig(alias)`** — `GET /v1/models/config/{alias}` — Get single model config
3. **`createModelConfig(body)`** — `POST /v1/models/config` — Create new model config
4. **`updateModelConfig(alias, body)`** — `PUT /v1/models/config/{alias}` — Update existing config (supports `new_alias` for renaming)
5. **`deleteModelConfig(alias)`** — `DELETE /v1/models/config/{alias}` — Delete config; returns new default
6. **`setDefaultModelConfig(alias)`** — `PUT /v1/models/config/default/{alias}` — Set default model

### HTTP helper improvements

- Uses `new URL()` for proper URL construction (handles special characters)
- Sets `Content-Type` and `Content-Length` headers for requests with body
- Checks HTTP status codes ≥ 400 and extracts error detail from JSON response
- Proper timeout handling with `req.destroy()`

### Verification

```bash
$ npx tsc --noEmit src/main/model-catalog.ts
# No output = no errors
```

TypeScript compilation passes with zero errors.