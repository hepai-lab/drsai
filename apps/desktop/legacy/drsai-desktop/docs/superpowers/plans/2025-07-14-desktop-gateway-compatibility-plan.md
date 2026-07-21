# Desktop-DrSai Backend Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify database access, add gateway endpoints, and replace desktop stubs so drsai-desktop and Python backend share the same database, state management, and config files.

**Architecture:** Desktop reads `drsai.db` directly for fast offline session browsing; all writes go through gateway HTTP API. Gateway is a thin proxy over `CLISessionStore`, `DatabaseManager`, and `UserProfileManager`.

**Tech Stack:** TypeScript (better-sqlite3, Electron IPC), Python (FastAPI, SQLAlchemy/SQLModel)

---

### Task 1: Add rename session endpoint to gateway.py

**Files:**
- Modify: `python/packages/drsai/src/drsai/backend/gateway.py` (after line ~1340, near other thread endpoints)

- [ ] **Step 1: Add POST /v1/threads/{thread_id}/rename endpoint**

Insert after the `/v1/threads/{thread_id}/stop` route block:

```python
@app.post("/v1/threads/{thread_id}/rename")
async def rename_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
    name: str = Query(..., min_length=1, description="New session name"),
):
    """Rename a session thread."""
    store = _get_store(user_id)
    success = store.rename(thread_id, name)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok", "thread_id": thread_id, "name": name}
```

- [ ] **Step 2: Verify** — No compile needed (Python). Restart gateway and test with curl:

```bash
curl -X POST "http://127.0.0.1:8642/v1/threads/{existing_id}/rename?user_id=test&name=NewName"
# Expected: {"status": "ok", "thread_id": "...", "name": "NewName"}
```

- [ ] **Step 3: Commit**

```bash
git add python/packages/drsai/src/drsai/backend/gateway.py
git commit -m "feat(gateway): add POST /v1/threads/{id}/rename endpoint"
```

---

### Task 2: Add agents-md (SOUL) CRUD endpoints to gateway.py

**Files:**
- Modify: `python/packages/drsai/src/drsai/backend/gateway.py` (after existing `/v1/skills` block, around line 1510)

- [ ] **Step 1: Add Pydantic model for content request**

Add near other Pydantic models (after `UserNameRequest`):

```python
class ContentRequest(BaseModel):
    content: str = Field(..., description="File content to write")
```

- [ ] **Step 2: Add GET/PUT /v1/config/agents-md endpoints**

```python
def _get_config_dir(user_id: str | None = None) -> Path:
    """Resolve the user config directory."""
    from drsai.backend.run_drsai_agent_factory import WORKDIR
    uid = user_id or _get_user_id()
    return Path(WORKDIR) / uid / "configs"


@app.get("/v1/config/agents-md")
async def get_agents_md(
    user_id: str | None = Query(default=None),
):
    """Read AGENTS.md (SOUL) for the given user."""
    cfg_dir = _get_config_dir(user_id)
    agents_md = cfg_dir / "AGENTS.md"
    if agents_md.exists():
        content = agents_md.read_text(encoding="utf-8", errors="replace")
        return {"content": content, "exists": True}
    return {"content": "", "exists": False}


@app.put("/v1/config/agents-md")
async def put_agents_md(
    req: ContentRequest,
    user_id: str | None = Query(default=None),
):
    """Write AGENTS.md (SOUL) for the given user."""
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "AGENTS.md").write_text(req.content, encoding="utf-8")
    return {"status": "ok"}
```

- [ ] **Step 3: Verify**

```bash
# Write
curl -X PUT "http://127.0.0.1:8642/v1/config/agents-md?user_id=test" \
  -H "Content-Type: application/json" \
  -d '{"content": "# My Agent\n\nYou are a helpful assistant."}'
# Expected: {"status": "ok"}

# Read
curl "http://127.0.0.1:8642/v1/config/agents-md?user_id=test"
# Expected: {"content": "# My Agent\n\nYou are a helpful assistant.", "exists": true}
```

- [ ] **Step 4: Commit**

```bash
git add python/packages/drsai/src/drsai/backend/gateway.py
git commit -m "feat(gateway): add GET/PUT /v1/config/agents-md for SOUL"
```

---

### Task 3: Add user-md CRUD endpoints to gateway.py

**Files:**
- Modify: `python/packages/drsai/src/drsai/backend/gateway.py` (after agents-md endpoints)

- [ ] **Step 1: Add GET/PUT /v1/config/user-md endpoints**

```python
@app.get("/v1/config/user-md")
async def get_user_md(
    user_id: str | None = Query(default=None),
):
    """Read USER.md for the given user."""
    cfg_dir = _get_config_dir(user_id)
    user_md = cfg_dir / "USER.md"
    if user_md.exists():
        content = user_md.read_text(encoding="utf-8", errors="replace")
        return {"content": content, "exists": True}
    return {"content": "", "exists": False}


@app.put("/v1/config/user-md")
async def put_user_md(
    req: ContentRequest,
    user_id: str | None = Query(default=None),
):
    """Write USER.md for the given user."""
    cfg_dir = _get_config_dir(user_id)
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "USER.md").write_text(req.content, encoding="utf-8")
    return {"status": "ok"}
```

- [ ] **Step 2: Verify**

```bash
curl -X PUT "http://127.0.0.1:8642/v1/config/user-md?user_id=test" \
  -H "Content-Type: application/json" \
  -d '{"content": "# About Me\n\nI am a developer."}'
# Expected: {"status": "ok"}
```

- [ ] **Step 3: Commit**

```bash
git add python/packages/drsai/src/drsai/backend/gateway.py
git commit -m "feat(gateway): add GET/PUT /v1/config/user-md"
```

---

### Task 4: Add skills install/uninstall endpoints to gateway.py

**Files:**
- Modify: `python/packages/drsai/src/drsai/backend/gateway.py` (after existing `/v1/skills/{skill_path:path}` endpoint)

- [ ] **Step 1: Add POST /v1/skills/install and DELETE /v1/skills/{name}**

```python
class SkillInstallRequest(BaseModel):
    name: str = Field(..., description="Skill name (directory name)")
    content: str = Field(..., description="SKILL.md content")


@app.post("/v1/skills/install")
async def install_skill(
    req: SkillInstallRequest,
    user_id: str | None = Query(default=None),
):
    """Install a skill by writing SKILL.md to the user's skills directory."""
    skills_dir = _get_skills_dir(user_id)
    skill_dir = skills_dir / req.name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(req.content, encoding="utf-8")
    return {"status": "ok", "name": req.name, "path": str(skill_dir)}


@app.delete("/v1/skills/{skill_name}")
async def uninstall_skill(
    skill_name: str,
    user_id: str | None = Query(default=None),
):
    """Uninstall a skill by removing its directory."""
    import shutil
    skills_dir = _get_skills_dir(user_id)
    skill_dir = skills_dir / skill_name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    shutil.rmtree(skill_dir)
    return {"status": "ok", "name": skill_name}
```

- [ ] **Step 2: Verify**

```bash
# Install
curl -X POST "http://127.0.0.1:8642/v1/skills/install?user_id=test" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-skill", "content": "# My Skill\n\nDescription here."}'
# Expected: {"status": "ok", "name": "my-skill", ...}

# Uninstall
curl -X DELETE "http://127.0.0.1:8642/v1/skills/my-skill?user_id=test"
# Expected: {"status": "ok", "name": "my-skill"}
```

- [ ] **Step 3: Commit**

```bash
git add python/packages/drsai/src/drsai/backend/gateway.py
git commit -m "feat(gateway): add POST /v1/skills/install and DELETE /v1/skills/{name}"
```

---

### Task 5: Rewrite session-cache.ts to read drsai.db

**Files:**
- Modify: `desktop/drsai-desktop/src/main/session-cache.ts` (full rewrite)

- [ ] **Step 1: Update DB path and interface**

Replace the constant and add helper functions at the top of the file:

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DRSAI_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import Database from "better-sqlite3";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

const CACHE_DIR = join(DRSAI_HOME, "desktop");
const CACHE_FILE = join(CACHE_DIR, "sessions.json");
// Changed: state.db → drsai.db under workspace
const DB_PATH = join(DRSAI_HOME, "workspace", "drsai", "drsai.db");

export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
}
```

- [ ] **Step 2: Add message extraction helper**

After `generateTitle()`:

```typescript
// Extract first user message preview from Thread.messages JSON
function extractPreview(messagesJson: string | null): string {
  if (!messagesJson) return "";
  try {
    const msgs = JSON.parse(messagesJson);
    if (!Array.isArray(msgs)) return "";
    for (const m of msgs) {
      if (m.role === "user" && m.content?.trim()) {
        return m.content.trim().split("\n")[0].slice(0, 120);
      }
    }
  } catch {
    /* ignore malformed JSON */
  }
  return "";
}
```

- [ ] **Step 3: Replace syncSessionCache() query**

Replace the existing `syncSessionCache()` function:

```typescript
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const db = getDb();
  if (!db) return cache.sessions;

  try {
    const rows = db
      .prepare(`
        SELECT
          thread_id                AS id,
          updated_at               AS started_at,
          json_array_length(messages) AS message_count,
          json_extract(meta, '$.name') AS title,
          messages
        FROM thread
        WHERE user_id IS NOT NULL
          AND updated_at > ?
        ORDER BY updated_at DESC
      `)
      .all(cache.lastSync > 0 ? cache.lastSync - 300 : 0) as Array<{
      id: string;
      started_at: string;       // ISO 8601
      message_count: number;
      title: string | null;
      messages: string | null;  // JSON string
    }>;

    const existingById = new Map<string, CachedSession>();
    for (const s of cache.sessions) existingById.set(s.id, s);
    const newSessions: CachedSession[] = [];

    for (const row of rows) {
      const existing = existingById.get(row.id);
      if (existing) {
        existing.messageCount = row.message_count;
        continue;
      }

      let title = row.title || "";
      if (!title) {
        const preview = extractPreview(row.messages);
        title = preview
          ? generateTitle(preview)
          : t("sessions.newConversation", getAppLocale());
      }

      const startedAt = row.started_at
        ? new Date(row.started_at).getTime()
        : Date.now();

      newSessions.push({
        id: row.id,
        title,
        startedAt,
        source: "desktop",
        messageCount: row.message_count || 0,
        model: "",
      });
    }

    const allSessions = [...newSessions, ...cache.sessions];
    allSessions.sort((a, b) => b.startedAt - a.startedAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated);
    return updated.sessions;
  } catch {
    return cache.sessions;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Replace updateSessionTitle() — use local cache + best-effort API**

```typescript
export function updateSessionTitle(
  sessionId: string,
  title: string,
): boolean {
  const cache = readCache();
  const session = cache.sessions.find(s => s.id === sessionId);
  if (!session) return false;
  session.title = title;
  writeCache(cache);
  return true;
}

// Async variant that also calls gateway API
export async function updateSessionTitleAsync(
  sessionId: string,
  title: string,
): Promise<boolean> {
  updateSessionTitle(sessionId, title); // local cache first
  try {
    const http = require("http") as typeof import("http");
    const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${DRSAI_API_PORT}/v1/threads/${encodeURIComponent(sessionId)}/rename?name=${encodeURIComponent(title)}`,
        { method: "POST", timeout: 5000 },
        (res: any) => { res.resume(); resolve(); },
      );
      req.on("error", () => resolve()); // best-effort
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.end();
    });
    return true;
  } catch {
    return true; // local update succeeded
  }
}
```

- [ ] **Step 5: Verify** — Build TypeScript:

```bash
cd desktop/drsai-desktop && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add desktop/drsai-desktop/src/main/session-cache.ts
git commit -m "refactor(session-cache): read drsai.db Thread table instead of state.db"
```

---

### Task 6: Replace soul.ts stubs with real gateway API calls

**Files:**
- Modify: `desktop/drsai-desktop/src/main/soul.ts` (full rewrite)

- [ ] **Step 1: Implement real API calls**

```typescript
/**
 * SOUL (agent personality) management via DrSai API Gateway.
 *
 * AGENTS.md is the SOUL file — managed through /v1/config/agents-md endpoints.
 */

import http from "http";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

function apiGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .request(`${DRSAI_API_URL}${path}`, { method: "GET", timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d.toString()));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error("Invalid JSON")); }
        });
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error("Request timed out"));
      })
      .end();
  });
}

function apiPut(path: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, timeout: 10000 },
      (res) => { res.resume(); resolve(); },
    );
    req.on("error", reject);
    req.on("timeout", function (this: http.ClientRequest) {
      this.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(data);
    req.end();
  });
}

export async function readSoul(_profile?: string): Promise<string> {
  try {
    const resp = (await apiGet<{ content: string; exists: boolean }>(
      "/v1/config/agents-md",
    )) as { content: string; exists: boolean };
    return resp.content || "";
  } catch (err) {
    console.error("[soul] readSoul failed:", err);
    return "";
  }
}

export async function writeSoul(content: string, _profile?: string): Promise<boolean> {
  try {
    await apiPut("/v1/config/agents-md", { content });
    return true;
  } catch (err) {
    console.error("[soul] writeSoul failed:", err);
    return false;
  }
}

export async function resetSoul(_profile?: string): Promise<boolean> {
  // Reset = write empty content
  return writeSoul("");
}
```

- [ ] **Step 2: Verify** — Build TypeScript:

```bash
cd desktop/drsai-desktop && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/main/soul.ts
git commit -m "feat(soul): replace stubs with gateway API calls for SOUL (AGENTS.md)"
```

---

### Task 7: Add install/uninstall to skills.ts

**Files:**
- Modify: `desktop/drsai-desktop/src/main/skills.ts` (add functions at end of file)

- [ ] **Step 1: Add installSkill and uninstallSkill functions**

```typescript
// ── Install / Uninstall ────────────────────────────

function apiPost(path: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 10000 },
      (res) => { res.resume(); resolve(); },
    );
    req.on("error", reject);
    req.on("timeout", function (this: http.ClientRequest) {
      this.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(data);
    req.end();
  });
}

function apiDelete(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "DELETE", timeout: 10000 },
      (res) => { res.resume(); resolve(); },
    );
    req.on("error", reject);
    req.on("timeout", function (this: http.ClientRequest) {
      this.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

export async function installSkillAsync(
  name: string,
  content: string,
): Promise<boolean> {
  try {
    await apiPost(`/v1/skills/install?user_id=${encodeURIComponent(getUserName())}`, {
      name,
      content,
    });
    return true;
  } catch (err) {
    console.error("[skills] installSkillAsync failed:", err);
    return false;
  }
}

export async function uninstallSkillAsync(name: string): Promise<boolean> {
  try {
    await apiDelete(
      `/v1/skills/${encodeURIComponent(name)}?user_id=${encodeURIComponent(getUserName())}`,
    );
    return true;
  } catch (err) {
    console.error("[skills] uninstallSkillAsync failed:", err);
    return false;
  }
}
```

- [ ] **Step 2: Verify** — Build TypeScript:

```bash
cd desktop/drsai-desktop && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add desktop/drsai-desktop/src/main/skills.ts
git commit -m "feat(skills): add installSkillAsync and uninstallSkillAsync via gateway API"
```

---

### Task 8: Update index.ts IPC registrations and preload

**Files:**
- Modify: `desktop/drsai-desktop/src/main/index.ts`
- Modify: `desktop/drsai-desktop/src/preload/index.ts`
- Modify: `desktop/drsai-desktop/src/preload/index.d.ts`

- [ ] **Step 1: Import new async session-cache functions in index.ts**

Add import (update existing import from session-cache):
```typescript
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
  updateSessionTitleAsync,  // new
} from "./session-cache";
```

- [ ] **Step 2: Register IPC handler for updateSessionTitleAsync**

After existing `update-session-title` handler:
```typescript
  ipcMain.handle("update-session-title-async", (_event, sessionId: string, title: string) =>
    updateSessionTitleAsync(sessionId, title),
  );
```

- [ ] **Step 3: Update preload/index.ts and preload/index.d.ts**

Add to the API surface:
```typescript
  updateSessionTitleAsync: (sessionId: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke("update-session-title-async", sessionId, title),
```

And the type declaration:
```typescript
  updateSessionTitleAsync: (sessionId: string, title: string) => Promise<boolean>;
```

- [ ] **Step 4: Verify** — Build:

```bash
cd desktop/drsai-desktop && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add desktop/drsai-desktop/src/main/index.ts desktop/drsai-desktop/src/preload/index.ts desktop/drsai-desktop/src/preload/index.d.ts
git commit -m "feat(ipc): register updateSessionTitleAsync IPC handler"
```

---

## Summary of Commits

| # | Commit message | Files |
|---|---------------|-------|
| 1 | `feat(gateway): add POST /v1/threads/{id}/rename endpoint` | `gateway.py` |
| 2 | `feat(gateway): add GET/PUT /v1/config/agents-md for SOUL` | `gateway.py` |
| 3 | `feat(gateway): add GET/PUT /v1/config/user-md` | `gateway.py` |
| 4 | `feat(gateway): add POST /v1/skills/install and DELETE /v1/skills/{name}` | `gateway.py` |
| 5 | `refactor(session-cache): read drsai.db Thread table instead of state.db` | `session-cache.ts` |
| 6 | `feat(soul): replace stubs with gateway API calls for SOUL (AGENTS.md)` | `soul.ts` |
| 7 | `feat(skills): add installSkillAsync and uninstallSkillAsync via gateway API` | `skills.ts` |
| 8 | `feat(ipc): register updateSessionTitleAsync IPC handler` | `index.ts`, `preload/*` |
