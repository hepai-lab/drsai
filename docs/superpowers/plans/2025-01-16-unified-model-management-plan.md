# Unified Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify model configuration management — backend as single source of truth with full CRUD REST API, desktop Chat/Models pages consume it.

**Architecture:** Backend `gateway.py` exposes `/v1/models/config` CRUD endpoints backed by `llm_mode_config.yaml`. Desktop replaces local `models.json` + `default-models.ts` with HTTP calls through expanded `model-catalog.ts`.

**Tech Stack:** Python/FastAPI (backend), TypeScript/Electron (desktop), YAML (config storage)

---

## File Structure

```
Backend:
  MODIFY: cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py
  MODIFY: cores/python/packages/drsai/src/drsai/backend/gateway.py

Desktop:
  MODIFY: desktop/drsai-desktop/src/main/model-catalog.ts
  MODIFY: desktop/drsai-desktop/src/main/index.ts
  MODIFY: desktop/drsai-desktop/src/preload/index.ts
  MODIFY: desktop/drsai-desktop/src/preload/index.d.ts
  MODIFY: desktop/drsai-desktop/src/renderer/src/screens/Models/Models.tsx
  MODIFY: desktop/drsai-desktop/src/renderer/src/screens/Chat/hooks/useModelConfig.ts
  MODIFY: desktop/drsai-desktop/src/renderer/src/screens/Chat/types.ts
  MODIFY: desktop/drsai-desktop/src/renderer/src/screens/Chat/ModelPicker.tsx
  REMOVE: desktop/drsai-desktop/src/main/default-models.ts
  REMOVE: desktop/drsai-desktop/src/main/models.ts
```

---

### Task 1: Backend — ModelEntry.to_dict() + save/ensure helpers

**Files:**
- Modify: `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py`

- [ ] **Step 1: Add `to_dict()` method to `ModelEntry` and `ReasoningConfig`**

```python
# In ReasoningConfig dataclass, add:
def to_dict(self) -> dict:
    return {
        "supported": self.supported,
        "effort_levels": self.effort_levels,
        "param_type": self.param_type,
    }

# In ModelEntry dataclass, add:
def to_dict(self) -> dict:
    d = {
        "model": self.model,
        "token_limit": self.token_limit,
        "max_tokens": self.max_tokens,
        "client_type": self.client_type,
    }
    if self.reasoning.supported:
        d["reasoning"] = self.reasoning.to_dict()
    return d
```

- [ ] **Step 2: Add `get_llm_config_file_path()` and `ensure_llm_config_file()` functions**

```python
# After load_llm_mode_config(), add:

from drsai.backend.cli.config import CLI_CONFIG_PATH, load_config, save_config

DEFAULT_LLM_CONFIG_FILE = str(Path(CONFIG_DIR) / "llm_mode_config.yaml")


def get_llm_config_file_path() -> Optional[str]:
    """Return the current llm_config_file path from cli_config.json, or None."""
    try:
        cfg = load_config()
        return cfg.get("llm_config_file") or None
    except Exception:
        return None


def ensure_llm_config_file() -> str:
    """Ensure llm_mode_config.yaml exists, seeding from defaults if needed.
    Returns the path to the config file.
    """
    existing = get_llm_config_file_path()
    if existing and Path(existing).exists():
        return existing

    path = Path(DEFAULT_LLM_CONFIG_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)

    if not path.exists():
        _write_llm_config(path, DEFAULT_LLM_MODE_CONFIG, DEFAULT_CONFIG_NAME)

    # Update cli_config.json
    cfg = load_config()
    cfg["llm_config_file"] = str(path)
    save_config(cfg)

    return str(path)
```

- [ ] **Step 3: Add `_write_llm_config()` and `save_llm_mode_config()` functions**

```python
def _write_llm_config(path: Path, config: dict[str, ModelEntry], default_alias: str) -> None:
    """Write llm_mode_config to YAML file."""
    import yaml

    data: dict[str, Any] = {"default_alias": default_alias}
    for alias, entry in config.items():
        data[alias] = entry.to_dict()

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def save_llm_mode_config(config: dict[str, ModelEntry], default_alias: str) -> None:
    """Persist llm_mode_config to the configured YAML file."""
    file_path = ensure_llm_config_file()
    _write_llm_config(Path(file_path), config, default_alias)
```

- [ ] **Step 4: Verify imports and syntax**

```bash
cd /home/xiongdb/drsai && python -c "from drsai.backend.run_drsai_agent_factory import ModelEntry, ReasoningConfig, ensure_llm_config_file, save_llm_mode_config; print('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py
git commit -m "feat: add ModelEntry.to_dict() and llm config save helpers"
```

---

### Task 2: Backend — Add CRUD endpoints to gateway

**Files:**
- Modify: `cores/python/packages/drsai/src/drsai/backend/gateway.py`

- [ ] **Step 1: Update import to include new helpers**

```python
# Replace the existing import from run_drsai_agent_factory:
from drsai.backend.run_drsai_agent_factory import (
    create_agent,
    load_llm_mode_config,
    build_model_catalog,
    ModelEntry,
    ReasoningConfig,
    ensure_llm_config_file,
    save_llm_mode_config,
    get_llm_config_file_path,
    DEFAULT_CONFIG_NAME,
)
```

- [ ] **Step 2: Add helper to get current config with path resolution**

```python
# After the existing /v1/models endpoint, add:

def _get_live_llm_config() -> tuple[dict[str, ModelEntry], str]:
    """Get current llm config + default_alias, resolving file path."""
    config_path = get_llm_config_file_path()
    llm_config = load_llm_mode_config(config_path)
    # default_alias: from file's default_alias field, or DEFAULT_CONFIG_NAME
    default_alias = DEFAULT_CONFIG_NAME
    if config_path:
        import yaml
        try:
            raw = yaml.safe_load(Path(config_path).read_text(encoding="utf-8")) or {}
            if "default_alias" in raw:
                default_alias = raw["default_alias"]
        except Exception:
            pass
    return llm_config, default_alias
```

- [ ] **Step 3: Add GET /v1/models/config endpoint (list all)**

```python
@app.get("/v1/models/config")
async def list_model_configs():
    """List all models with full ModelEntry configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)
    return build_model_catalog(llm_config)
```

- [ ] **Step 4: Add GET /v1/models/config/{alias} endpoint**

```python
@app.get("/v1/models/config/{alias}")
async def get_model_config(alias: str):
    """Get single model configuration by alias."""
    llm_config, _ = await asyncio.to_thread(_get_live_llm_config)
    entry = llm_config.get(alias)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")
    return {
        "alias": alias,
        "display_name": _display_name_from_alias(alias),
        **entry.to_dict(),
    }
```

Note: need to import `_display_name_from_alias` from the factory or duplicate it.

- [ ] **Step 5: Add POST /v1/models/config endpoint (create)**

```python
from pydantic import BaseModel

class ModelConfigCreate(BaseModel):
    alias: str
    model: str
    token_limit: int = 128000
    max_tokens: int = 0
    client_type: str = "auto"
    reasoning: dict | None = None


@app.post("/v1/models/config")
async def create_model_config(body: ModelConfigCreate):
    """Create a new model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if body.alias in llm_config:
        raise HTTPException(status_code=409, detail=f"Model '{body.alias}' already exists")

    reasoning = ReasoningConfig(
        supported=body.reasoning.get("supported", False) if body.reasoning else False,
        effort_levels=body.reasoning.get("effort_levels", []) if body.reasoning else [],
        param_type=body.reasoning.get("param_type", "none") if body.reasoning else "none",
    )

    llm_config[body.alias] = ModelEntry(
        model=body.model,
        token_limit=body.token_limit,
        max_tokens=body.max_tokens,
        client_type=body.client_type,
        reasoning=reasoning,
    )

    await asyncio.to_thread(save_llm_mode_config, llm_config, default_alias)
    return {
        "alias": body.alias,
        "display_name": _display_name_from_alias(body.alias),
        **llm_config[body.alias].to_dict(),
    }
```

- [ ] **Step 6: Add PUT /v1/models/config/{alias} endpoint (update)**

```python
class ModelConfigUpdate(BaseModel):
    model: str | None = None
    token_limit: int | None = None
    max_tokens: int | None = None
    client_type: str | None = None
    reasoning: dict | None = None
    new_alias: str | None = None  # support rename


@app.put("/v1/models/config/{alias}")
async def update_model_config(alias: str, body: ModelConfigUpdate):
    """Update an existing model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    entry = llm_config[alias]

    if body.model is not None:
        entry.model = body.model
    if body.token_limit is not None:
        entry.token_limit = body.token_limit
    if body.max_tokens is not None:
        entry.max_tokens = body.max_tokens
    if body.client_type is not None:
        entry.client_type = body.client_type
    if body.reasoning is not None:
        entry.reasoning = ReasoningConfig(
            supported=body.reasoning.get("supported", entry.reasoning.supported),
            effort_levels=body.reasoning.get("effort_levels", entry.reasoning.effort_levels),
            param_type=body.reasoning.get("param_type", entry.reasoning.param_type),
        )

    # Handle rename
    target_alias = body.new_alias or alias
    if body.new_alias and body.new_alias != alias:
        llm_config[body.new_alias] = entry
        del llm_config[alias]
        # Update default alias if needed
        if default_alias == alias:
            default_alias = body.new_alias

    await asyncio.to_thread(save_llm_mode_config, llm_config, default_alias)
    final_alias = body.new_alias or alias
    return {
        "alias": final_alias,
        "display_name": _display_name_from_alias(final_alias),
        **llm_config[final_alias].to_dict(),
    }
```

- [ ] **Step 7: Add DELETE /v1/models/config/{alias} endpoint**

```python
@app.delete("/v1/models/config/{alias}")
async def delete_model_config(alias: str):
    """Delete a model configuration."""
    llm_config, default_alias = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    del llm_config[alias]

    # If deleting the default, pick first available
    new_default = default_alias
    if default_alias == alias:
        new_default = next(iter(llm_config)) if llm_config else DEFAULT_CONFIG_NAME

    await asyncio.to_thread(save_llm_mode_config, llm_config, new_default)
    return {"ok": True, "new_default_alias": new_default}
```

- [ ] **Step 8: Add PUT /v1/models/config/default/{alias} endpoint**

```python
@app.put("/v1/models/config/default/{alias}")
async def set_default_model_config(alias: str):
    """Set the default model alias."""
    llm_config, _ = await asyncio.to_thread(_get_live_llm_config)

    if alias not in llm_config:
        raise HTTPException(status_code=404, detail=f"Model '{alias}' not found")

    await asyncio.to_thread(save_llm_mode_config, llm_config, alias)
    return {"default_alias": alias}
```

- [ ] **Step 9: Add `import asyncio` and ensure `Path` is imported at top of gateway.py**

```python
# Check that these imports exist at top of gateway.py:
import asyncio
from pathlib import Path
```

- [ ] **Step 10: Verify syntax**

```bash
cd /home/xiongdb/drsai && python -c "from drsai.backend.gateway import app; print('OK')"
```

- [ ] **Step 11: Commit**

```bash
git add cores/python/packages/drsai/src/drsai/backend/gateway.py
git commit -m "feat: add model config CRUD endpoints to gateway"
```

---

### Task 3: Desktop — Extend model-catalog.ts with full CRUD

**Files:**
- Modify: `desktop/drsai-desktop/src/main/model-catalog.ts`

- [ ] **Step 1: Rewrite model-catalog.ts**

```typescript
import * as http from "http";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

// ── Types ───────────────────────────────────────────────

export interface ReasoningConfig {
  supported: boolean;
  effort_levels: string[];
  param_type: string;
}

export interface ModelCatalogEntry {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: ReasoningConfig;
}

export interface ModelCatalogResponse {
  default_alias: string;
  models: ModelCatalogEntry[];
}

// ── HTTP helpers ────────────────────────────────────────

function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DRSAI_API_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 10000,
        headers: bodyStr
          ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bodyStr)) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              let msg = data;
              try { msg = JSON.parse(data).detail || data; } catch {}
              reject(new Error(msg));
              return;
            }
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── API functions ───────────────────────────────────────

export async function getModelCatalog(): Promise<ModelCatalogResponse> {
  return httpRequest<ModelCatalogResponse>("GET", "/v1/models/config");
}

export async function getModelConfig(alias: string): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest<ModelCatalogEntry & { alias: string }>(
    "GET",
    `/v1/models/config/${encodeURIComponent(alias)}`,
  );
}

export async function createModelConfig(body: {
  alias: string;
  model: string;
  token_limit?: number;
  max_tokens?: number;
  client_type?: string;
  reasoning?: ReasoningConfig;
}): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest("POST", "/v1/models/config", body);
}

export async function updateModelConfig(
  alias: string,
  body: {
    model?: string;
    token_limit?: number;
    max_tokens?: number;
    client_type?: string;
    reasoning?: ReasoningConfig;
    new_alias?: string;
  },
): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest("PUT", `/v1/models/config/${encodeURIComponent(alias)}`, body);
}

export async function deleteModelConfig(alias: string): Promise<{ ok: boolean; new_default_alias: string }> {
  return httpRequest("DELETE", `/v1/models/config/${encodeURIComponent(alias)}`);
}

export async function setDefaultModelConfig(alias: string): Promise<{ default_alias: string }> {
  return httpRequest("PUT", `/v1/models/config/default/${encodeURIComponent(alias)}`);
}
```

- [ ] **Step 2: Check TypeScript compilation**

```bash
cd /home/xiongdb/drsai/desktop/drsai-desktop && npx tsc --noEmit src/main/model-catalog.ts 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/main/model-catalog.ts
git commit -m "feat: extend model-catalog.ts with full CRUD API"
```

---

### Task 4: Desktop — Update main/index.ts IPC handlers

**Files:**
- Modify: `desktop/drsai-desktop/src/main/index.ts`

- [ ] **Step 1: Update imports**

```typescript
// REMOVE these imports:
// import { listModels, addModel, removeModel, updateModel } from "./models";

// UPDATE model-catalog import to include all new functions:
import {
  getModelCatalog,
  getModelConfig,
  createModelConfig,
  updateModelConfig,
  deleteModelConfig,
  setDefaultModelConfig,
} from "./model-catalog";
```

- [ ] **Step 2: Replace old model IPC handlers**

```typescript
// REMOVE the old handlers block (around lines 918-935):
//   ipcMain.handle("list-models", ...)
//   ipcMain.handle("add-model", ...)
//   ipcMain.handle("remove-model", ...)
//   ipcMain.handle("update-model", ...)

// ADD new handlers:
  // Models (new unified API)
  ipcMain.handle("list-models", async () => {
    return getModelCatalog();
  });
  ipcMain.handle("get-model-detail", async (_event, alias: string) => {
    return getModelConfig(alias);
  });
  ipcMain.handle("add-model", async (_event, body: {
    alias: string; model: string; token_limit?: number;
    max_tokens?: number; client_type?: string; reasoning?: Record<string, unknown>;
  }) => {
    return createModelConfig(body);
  });
  ipcMain.handle("update-model", async (_event, alias: string, body: Record<string, unknown>) => {
    return updateModelConfig(alias, body);
  });
  ipcMain.handle("remove-model", async (_event, alias: string) => {
    return deleteModelConfig(alias);
  });
  ipcMain.handle("set-default-model", async (_event, alias: string) => {
    return setDefaultModelConfig(alias);
  });
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/main/index.ts
git commit -m "feat: update IPC handlers for new model config CRUD API"
```

---

### Task 5: Desktop — Update preload layer

**Files:**
- Modify: `desktop/drsai-desktop/src/preload/index.ts`
- Modify: `desktop/drsai-desktop/src/preload/index.d.ts`

- [ ] **Step 1: Update preload/index.ts — replace old model stubs with new**

In `preload/index.ts`, replace the old model stubs (around lines 467-497):

```typescript
  // Models (unified backend API)
  listModels: (): Promise<{
    default_alias: string;
    models: Array<{
      alias: string;
      display_name: string;
      client_type: string;
      model: string;
      token_limit: number;
      max_tokens: number;
      reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
    }>;
  }> => ipcRenderer.invoke("list-models"),

  getModelDetail: (alias: string): Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }> => ipcRenderer.invoke("get-model-detail", alias),

  addModel: (body: {
    alias: string;
    model: string;
    token_limit?: number;
    max_tokens?: number;
    client_type?: string;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }): Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }> => ipcRenderer.invoke("add-model", body),

  updateModel: (
    alias: string,
    body: {
      model?: string;
      token_limit?: number;
      max_tokens?: number;
      client_type?: string;
      reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
      new_alias?: string;
    },
  ): Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }> => ipcRenderer.invoke("update-model", alias, body),

  removeModel: (alias: string): Promise<{ ok: boolean; new_default_alias: string }> =>
    ipcRenderer.invoke("remove-model", alias),

  setDefaultModel: (alias: string): Promise<{ default_alias: string }> =>
    ipcRenderer.invoke("set-default-model", alias),
```

- [ ] **Step 2: Update preload/index.d.ts — replace old type signatures**

```typescript
  // Models (unified backend API)
  listModels: () => Promise<{
    default_alias: string;
    models: Array<{
      alias: string;
      display_name: string;
      client_type: string;
      model: string;
      token_limit: number;
      max_tokens: number;
      reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
    }>;
  }>;
  getModelDetail: (alias: string) => Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }>;
  addModel: (body: {
    alias: string;
    model: string;
    token_limit?: number;
    max_tokens?: number;
    client_type?: string;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }) => Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }>;
  updateModel: (
    alias: string,
    body: {
      model?: string;
      token_limit?: number;
      max_tokens?: number;
      client_type?: string;
      reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
      new_alias?: string;
    },
  ) => Promise<{
    alias: string;
    display_name: string;
    client_type: string;
    model: string;
    token_limit: number;
    max_tokens: number;
    reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
  }>;
  removeModel: (alias: string) => Promise<{ ok: boolean; new_default_alias: string }>;
  setDefaultModel: (alias: string) => Promise<{ default_alias: string }>;
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/preload/index.ts desktop/drsai-desktop/src/preload/index.d.ts
git commit -m "feat: update preload layer for unified model config API"
```

---

### Task 6: Desktop — Update Chat types and useModelConfig hook

**Files:**
- Modify: `desktop/drsai-desktop/src/renderer/src/screens/Chat/types.ts`
- Modify: `desktop/drsai-desktop/src/renderer/src/screens/Chat/hooks/useModelConfig.ts`

- [ ] **Step 1: Update types.ts — Update ModelGroup**

```typescript
// In types.ts, update ModelGroup:
export interface ModelItem {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
}

export interface ModelGroup {
  client_type: string;  // was "provider", now "client_type"
  providerLabel: string;
  models: ModelItem[];
}
```

- [ ] **Step 2: Update useModelConfig.ts**

```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup, ModelItem } from "../types";

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<void>;
}

function groupModelsByClientType(
  models: ModelItem[],
): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    const key = m.client_type || "auto";
    if (!groupMap.has(key)) {
      const labelKey = key === "anthropic" ? "constants.anthropicName"
        : key === "openai" ? "constants.openaiName"
        : PROVIDERS.labels[key] || key;
      groupMap.set(key, {
        client_type: key,
        providerLabel: labelKey,
        models: [],
      });
    }
    groupMap.get(key)!.models.push(m);
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [allModels, setAllModels] = useState<ModelItem[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    const [mc, catalog] = await Promise.all([
      window.drsaiAPI.getModelConfig(profile),
      window.drsaiAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setAllModels(catalog.models);
    setModelGroups(groupModelsByClientType(catalog.models));
  }, [profile]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectModel = useCallback(
    async (provider: string, model: string, baseUrl: string): Promise<void> => {
      await window.drsaiAPI.setModelConfig(provider, model, baseUrl, profile);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(baseUrl);
    },
    [profile],
  );

  const displayModel = useMemo(
    () => {
      if (!currentModel) {
        return currentProvider === "auto" ? t("chat.auto") : t("chat.noModel");
      }
      // Try to find display_name from catalog
      const found = allModels.find((m) => m.model === currentModel);
      if (found) return found.display_name;
      return currentModel.split("/").pop() || currentModel;
    },
    [currentModel, currentProvider, t, allModels],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/renderer/src/screens/Chat/types.ts
git add desktop/drsai-desktop/src/renderer/src/screens/Chat/hooks/useModelConfig.ts
git commit -m "feat: update Chat types and useModelConfig for unified API"
```

---

### Task 7: Desktop — Update ModelPicker to new data shape

**Files:**
- Modify: `desktop/drsai-desktop/src/renderer/src/screens/Chat/ModelPicker.tsx`

- [ ] **Step 1: Update ModelPicker props and rendering**

```typescript
// Update the rendering part. The key changes:
// - group.provider → group.client_type
// - m.model → m.alias for display
// - active check uses model ID, not provider+model pair

// In the dropdown rendering section, change:
{modelGroups.map((group) => (
  <div key={group.client_type} className="chat-model-group">
    <div className="chat-model-group-label">
      {t(group.providerLabel)}
    </div>
    {group.models.map((m) => {
      const active =
        currentModel === m.model && currentProvider === m.client_type;
      return (
        <button
          key={`${m.client_type}:${m.alias}`}
          className={`chat-model-option ${active ? "active" : ""}`}
          onClick={() => select(m.client_type, m.model, "")}
        >
          <span className="chat-model-option-label">{m.display_name}</span>
          <span className="chat-model-option-id">{m.alias}</span>
        </button>
      );
    })}
  </div>
))}
```

The full file replacement — the `select` function also changes to accept the model's client_type as provider:

```typescript
import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { ModelGroup, ModelItem } from "./types";

interface ModelPickerProps {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (provider: string, model: string, baseUrl: string) => void;
}

export const ModelPicker = memo(function ModelPicker({
  currentModel,
  currentProvider,
  currentBaseUrl,
  modelGroups,
  displayModel,
  onOpen,
  onSelectModel,
}: ModelPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function toggle(): void {
    if (!isOpen) onOpen();
    setIsOpen((v) => !v);
  }

  function select(provider: string, model: string, baseUrl: string): void {
    onSelectModel(provider, model, baseUrl);
    setIsOpen(false);
    setCustomInput("");
  }

  function submitCustom(): void {
    const model = customInput.trim();
    if (!model) return;
    select(
      currentProvider === "auto" ? "auto" : currentProvider,
      model,
      currentBaseUrl,
    );
  }

  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button className="chat-model-trigger" onClick={toggle}>
        <span className="chat-model-name">{displayModel}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="chat-model-dropdown">
          {modelGroups.map((group) => (
            <div key={group.client_type} className="chat-model-group">
              <div className="chat-model-group-label">
                {t(group.providerLabel)}
              </div>
              {group.models.map((m) => {
                const active =
                  currentModel === m.model &&
                  currentProvider === m.client_type;
                return (
                  <button
                    key={`${m.client_type}:${m.alias}`}
                    className={`chat-model-option ${active ? "active" : ""}`}
                    onClick={() => select(m.client_type, m.model, "")}
                  >
                    <span className="chat-model-option-label">{m.display_name}</span>
                    <span className="chat-model-option-id">{m.alias}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="chat-model-group">
            <div className="chat-model-group-label">{t("chat.custom")}</div>
            <div className="chat-model-custom">
              <input
                className="chat-model-custom-input"
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCustom();
                }}
                placeholder={t("chat.typeModelName")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add desktop/drsai-desktop/src/renderer/src/screens/Chat/ModelPicker.tsx
git commit -m "feat: update ModelPicker for new unified model data shape"
```

---

### Task 8: Desktop — Update Models page

**Files:**
- Modify: `desktop/drsai-desktop/src/renderer/src/screens/Models/Models.tsx`

- [ ] **Step 1: Rewrite Models page with new data types and API**

```typescript
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Search } from "../../assets/icons";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";

interface ModelItem {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: { supported: boolean; effort_levels: string[]; param_type: string };
}

interface CatalogResponse {
  default_alias: string;
  models: ModelItem[];
}

function Models(): React.JSX.Element {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null);
  const [formAlias, setFormAlias] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formClientType, setFormClientType] = useState("openai");
  const [formTokenLimit, setFormTokenLimit] = useState(128000);
  const [formMaxTokens, setFormMaxTokens] = useState(0);
  const [formReasoningSupported, setFormReasoningSupported] = useState(false);
  const [formError, setFormError] = useState("");

  const loadModels = useCallback(async () => {
    const data = await window.drsaiAPI.listModels();
    setCatalog(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  function openAddModal(): void {
    setEditingModel(null);
    setFormAlias("");
    setFormModel("");
    setFormClientType("openai");
    setFormTokenLimit(128000);
    setFormMaxTokens(0);
    setFormReasoningSupported(false);
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(m: ModelItem): void {
    setEditingModel(m);
    setFormAlias(m.alias);
    setFormModel(m.model);
    setFormClientType(m.client_type);
    setFormTokenLimit(m.token_limit);
    setFormMaxTokens(m.max_tokens);
    setFormReasoningSupported(m.reasoning?.supported || false);
    setFormError("");
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
  }

  async function handleSave(): Promise<void> {
    const alias = formAlias.trim();
    const model = formModel.trim();
    if (!alias || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    setFormError("");

    if (editingModel) {
      await window.drsaiAPI.updateModel(editingModel.alias, {
        model,
        client_type: formClientType,
        token_limit: formTokenLimit,
        max_tokens: formMaxTokens,
        reasoning: {
          supported: formReasoningSupported,
          effort_levels: [],
          param_type: formClientType === "anthropic" ? "adaptive" : "reasoning_effort",
        },
        new_alias: alias !== editingModel.alias ? alias : undefined,
      });
    } else {
      await window.drsaiAPI.addModel({
        alias,
        model,
        client_type: formClientType,
        token_limit: formTokenLimit,
        max_tokens: formMaxTokens,
        reasoning: formReasoningSupported
          ? { supported: true, effort_levels: [], param_type: formClientType === "anthropic" ? "adaptive" : "reasoning_effort" }
          : undefined,
      });
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(alias: string): Promise<void> {
    await window.drsaiAPI.removeModel(alias);
    setConfirmDelete(null);
    await loadModels();
  }

  const models = catalog?.models || [];
  const defaultAlias = catalog?.default_alias;

  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.alias.toLowerCase().includes(q) ||
      m.display_name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="models-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("models.title")}
          </h1>
          <p className="models-subtitle">{t("models.subtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          <Plus size={14} />
          {t("models.addModel")}
        </button>
      </div>

      <div className="models-search">
        <Search size={14} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("models.searchPlaceholder")}
        />
        {search && (
          <button className="models-search-clear" onClick={() => setSearch("")}>
            <X size={14} />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="models-empty">
          {search ? t("models.noResults") : t("models.noModels")}
        </div>
      ) : (
        <div className="models-list">
          {filtered.map((m) => (
            <div key={m.alias} className="models-card" onClick={() => openEditModal(m)}>
              <div className="models-card-main">
                <span className="models-card-name">{m.display_name}</span>
                {m.alias === defaultAlias && (
                  <span className="models-card-badge">{t("models.default")}</span>
                )}
                <span className="models-card-alias">{m.alias}</span>
              </div>
              <div className="models-card-meta">
                <span className="models-card-client">{m.client_type}</span>
                <span className="models-card-tokens">
                  {m.token_limit >= 1000000 ? `${(m.token_limit / 1000000).toFixed(1)}M` : `${(m.token_limit / 1000).toFixed(0)}K`} ctx
                </span>
                {m.reasoning?.supported && (
                  <span className="models-card-reasoning">{t("models.reasoning")}</span>
                )}
              </div>
              <div className="models-card-model">{m.model}</div>
              <button
                className="models-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(m.alias);
                }}
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="modal-overlay">
          <div className="modal">
            <p>{t("models.confirmDelete")}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal modal-lg">
            <h2>{editingModel ? t("models.editModel") : t("models.addModel")}</h2>
            {formError && <p className="form-error">{formError}</p>}

            <div className="form-group">
              <label>{t("models.alias")}</label>
              <input
                type="text"
                value={formAlias}
                onChange={(e) => setFormAlias(e.target.value)}
                placeholder="claude-sonnet-4-6"
              />
            </div>

            <div className="form-group">
              <label>{t("models.modelId")}</label>
              <input
                type="text"
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                placeholder="anthropic/claude-sonnet-4-6"
              />
            </div>

            <div className="form-group">
              <label>{t("models.clientType")}</label>
              <select value={formClientType} onChange={(e) => setFormClientType(e.target.value)}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>{t("models.tokenLimit")}</label>
                <input
                  type="number"
                  value={formTokenLimit}
                  onChange={(e) => setFormTokenLimit(Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label>{t("models.maxTokens")}</label>
                <input
                  type="number"
                  value={formMaxTokens}
                  onChange={(e) => setFormMaxTokens(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={formReasoningSupported}
                  onChange={(e) => setFormReasoningSupported(e.target.checked)}
                />
                {" "}{t("models.reasoningSupported")}
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={closeModal}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Models;
```

- [ ] **Step 2: Commit**

```bash
git add desktop/drsai-desktop/src/renderer/src/screens/Models/Models.tsx
git commit -m "feat: rewrite Models page for unified backend API"
```

---

### Task 9: Desktop — Remove old files and clean up

**Files:**
- Remove: `desktop/drsai-desktop/src/main/default-models.ts`
- Remove: `desktop/drsai-desktop/src/main/models.ts`

- [ ] **Step 1: Delete old files**

```bash
rm desktop/drsai-desktop/src/main/default-models.ts
rm desktop/drsai-desktop/src/main/models.ts
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -rn "default-models\|from \"./models\"\|from './models'" desktop/drsai-desktop/src/
# Should return no results related to the deleted files
```

- [ ] **Step 3: Commit**

```bash
git rm desktop/drsai-desktop/src/main/default-models.ts desktop/drsai-desktop/src/main/models.ts
git commit -m "chore: remove old models.ts and default-models.ts (replaced by backend API)"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: TypeScript check for desktop**

```bash
cd /home/xiongdb/drsai/desktop/drsai-desktop && npx tsc --noEmit 2>&1 | head -50
```
Expected: no new type errors in the modified files.

- [ ] **Step 2: Python syntax check for backend**

```bash
cd /home/xiongdb/drsai && python -c "
from drsai.backend.run_drsai_agent_factory import (
    ModelEntry, ReasoningConfig,
    ensure_llm_config_file, save_llm_mode_config,
    get_llm_config_file_path, load_llm_mode_config,
    build_model_catalog, DEFAULT_CONFIG_NAME,
)
from drsai.backend.gateway import app
print('All imports OK')
"
```
Expected: "All imports OK"

- [ ] **Step 3: Verify default catalog includes all 8+ models**

```bash
cd /home/xiongdb/drsai && python -c "
from drsai.backend.run_drsai_agent_factory import load_llm_mode_config, build_model_catalog
catalog = build_model_catalog()
print(f'Models: {len(catalog[\"models\"])}')
for m in catalog['models']:
    print(f'  {m[\"alias\"]:25s} {m[\"client_type\"]:10s} {m[\"token_limit\"]:>10d}')
print(f'Default: {catalog[\"default_alias\"]}')
"
```
Expected: 8+ models listed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: end-to-end verification for unified model management"
```