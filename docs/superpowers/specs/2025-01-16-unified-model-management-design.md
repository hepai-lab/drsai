# Unified Model Management - Design Spec

**Date:** 2025-01-16
**Status:** Approved

---

## 1. Problem Statement

The desktop Chat sidebar only shows 4 hard-coded models while the backend
`DEFAULT_LLM_MODE_CONFIG` defines 8+ models with rich metadata (token_limit,
max_tokens, reasoning config, client_type). The Chat and Models pages use a
separate `models.json` with a different schema than the backend `ModelEntry`,
creating data duplication and inconsistency.

## 2. Goals

- Single source of truth: backend manages all model configuration
- Desktop Chat and Models pages consume backend API
- Full CRUD on model config via backend REST endpoints
- Schema unified around backend `ModelEntry`

## 3. Architecture

```
Desktop (Electron)                  Backend (FastAPI)
─────────────────                    ────────────────
Chat / Models pages                  /v1/models/config (CRUD)
        │                                   │
        ▼                                   ▼
model-catalog.ts (IPC→HTTP)          llm_mode_config.yaml
                                     (or DEFAULT_LLM_MODE_CONFIG as seed)
```

## 4. Backend Changes

### 4.1 New API Endpoints

All under `/v1/models/config`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/models/config` | List all models with full ModelEntry fields |
| GET | `/v1/models/config/{alias}` | Get single model detail |
| POST | `/v1/models/config` | Create new model |
| PUT | `/v1/models/config/{alias}` | Update model (supports rename via new_alias query param) |
| DELETE | `/v1/models/config/{alias}` | Delete model |
| PUT | `/v1/models/config/default/{alias}` | Set default model alias |

### 4.2 Storage Strategy (Option B: Full Copy on First Edit)

- On first read: if `llm_config_file` not set in `cli_config.json`, serve from
  in-memory `DEFAULT_LLM_MODE_CONFIG`
- On first write (POST/PUT/DELETE): export all defaults to
  `~/.drsai/llm_mode_config.yaml`, set `llm_config_file` in `cli_config.json`,
  then perform the mutation
- Subsequent reads/writes go through the YAML file

### 4.3 YAML File Format (v2)

```yaml
default_alias: claude-sonnet-4-6
models:
  claude-sonnet-4-6:
    model: anthropic/claude-sonnet-4-6
    token_limit: 1000000
    max_tokens: 64000
    client_type: anthropic
    reasoning:
      supported: true
      effort_levels: []
      param_type: adaptive
```

### 4.4 API Response Format

```json
{
  "default_alias": "claude-sonnet-4-6",
  "models": [
    {
      "alias": "claude-sonnet-4-6",
      "display_name": "Claude Sonnet 4 6",
      "model": "anthropic/claude-sonnet-4-6",
      "token_limit": 1000000,
      "max_tokens": 64000,
      "client_type": "anthropic",
      "reasoning": {
        "supported": true,
        "effort_levels": [],
        "param_type": "adaptive"
      }
    }
  ]
}
```

## 5. Desktop Changes

### 5.1 Files to Remove
- `src/main/default-models.ts` — no longer needed
- `src/main/models.ts` — CRUD moves to backend

### 5.2 Files to Modify

| File | Change |
|------|--------|
| `src/main/model-catalog.ts` | Extend with full CRUD: `listModels()`, `getModel()`, `addModel()`, `updateModel()`, `removeModel()`, `setDefaultModel()` |
| `src/main/index.ts` | Update IPC handlers: remove old `listModels`/`addModel`/etc from `./models`, wire new `model-catalog` CRUD handlers |
| `src/main/config.ts` | Remove `getModelConfig`/`setModelConfig` (or refactor to use backend) |
| `src/renderer/src/screens/Models/Models.tsx` | Adapt form to full ModelEntry fields (token_limit, max_tokens, reasoning) |
| `src/renderer/src/screens/Chat/hooks/useModelConfig.ts` | Use `model-catalog` API instead of old `models.ts` |
| `src/renderer/src/screens/Chat/types.ts` | Update `ModelGroup` if needed |
| `src/renderer/src/screens/Chat/ModelPicker.tsx` | Minor adapt to new data shape |

### 5.3 ModelPicker Display

Keep simple: group by `client_type` (anthropic/openai), show alias as label:

```
Anthropic
  claude-sonnet-4-6
  claude-opus-4-7
  claude-haiku-4-5

OpenAI
  gpt-5.3-codex
  gpt-5.4
  gpt-5.5
```

## 6. Migration Path

1. Backend CRUD endpoints first
2. Update desktop `model-catalog.ts` to call new endpoints
3. Remove old `models.ts` / `default-models.ts`
4. Update Models page UI
5. Update Chat `useModelConfig` hook
6. Test full flow: Chat model picker → select model → chat with correct model

## 7. Open Questions

- `ssh-remote.ts` has `sshListModels` / `sshGetModelConfig` / `sshSetModelConfig`.
  These need to be updated to use the new backend endpoints. Defer to
  implementation phase after reviewing SSH remote code paths.
- The `getModelConfig`/`setModelConfig` in `config.ts` reads/writes
  `cli_config.yaml` provider/default/base_url fields. These should continue to
  work for the "current active model" selection, but the available models list
  should come from the catalog endpoint.