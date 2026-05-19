# Desktop-DrSai Backend Compatibility Design

**Date:** 2025-07-14
**Status:** Approved
**Topic:** Unifying drsai-desktop with Python backend (gateway.py / run_cli.py)

---

## 1. Problem Statement

`drsai-desktop` (Electron) and the Python backend (`gateway.py` / `run_cli.py`) have
diverged in three areas:

1. **Database** — `session-cache.ts` reads a legacy `state.db` with old
   `sessions`/`messages` tables, while the Python backend uses `DatabaseManager`
   with the `Thread` table in `drsai.db`.

2. **State management** — Agent lifecycle (`lazy_init` → `run_stream` →
   `save_state`/`load_state`) is already aligned between `gateway.py` and
   `run_cli.py`. No structural change needed here.

3. **Config/Skills/Memory** — Desktop has stubs (`soul.ts`) or partial paths;
   some modules go through gateway API (`memory.ts`, `skills.ts`) while others
   read local files directly.

## 2. Architecture

```
                    drsai.db (~/.drsai/workspace/drsai/drsai.db)
                    ┌──────────────────────────────────────┐
                    │  Thread table (full schema)           │
                    │  + UserProfileManager configs         │
                    └──────┬───────────────┬───────────────┘
                           │               │
              direct read  │               │  ORM (DatabaseManager)
              (better-     │               │
              sqlite3)     │               │
                    ┌──────┴─────┐  ┌──────┴──────────────┐
                    │ Desktop    │  │ Python Backend       │
                    │ session-   │  │ gateway.py           │
                    │ cache.ts   │  │ run_cli.py           │
                    │ (read-only)│  │ (full lifecycle)     │
                    └────────────┘  └─────────────────────┘

Desktop writes → gateway HTTP API → DatabaseManager/UserProfileManager
Desktop reads  → direct SQLite (session-cache.ts) or gateway API (skills/memory)
```

### Principles

- **Single database** `drsai.db` — both sides share the same file.
- **Desktop reads offline** — `session-cache.ts` reads SQLite directly.
- **Desktop writes via API** — all mutations go through gateway HTTP endpoints.
- **Gateway is a thin proxy** — delegates to `DatabaseManager`, `CLISessionStore`,
  and `UserProfileManager`.

## 3. Thread State Machine

```
CREATED ──▶ ACTIVE ──▶ PAUSED ──▶ ACTIVE ...
                │                    │
                ▼                    ▼
              STOPPED ◀──────────────┘
```

Gateway endpoint mapping:

| User action | HTTP call | Gateway handler |
|------------|-----------|----------------|
| Send message | `POST /v1/chat/completions` | `AgentManager.run_stream()` → `save_state` after each turn |
| Pause | `POST /v1/threads/{id}/pause` | `AgentManager.pause_agent()` → `save_state` → `Thread→PAUSED` |
| Resume | `POST /v1/threads/{id}/resume` | `AgentManager.resume_agent()` → `Thread→ACTIVE` |
| Stop/switch | `POST /v1/threads/{id}/stop` | `AgentManager.stop_agent()` → `save_state` → `close()` → `Thread→STOPPED` |

## 4. Changes

### 4.1 session-cache.ts — Rewrite (read drsai.db)

**DB path:** `~/.drsai/state.db` → `~/.drsai/workspace/drsai/drsai.db`

**Query changes:**

| Old (state.db) | New (drsai.db) |
|----------------|----------------|
| `SELECT * FROM sessions` | `SELECT * FROM thread WHERE user_id IS NOT NULL` |
| `sessions.id` | `thread.thread_id` |
| `sessions.started_at` | `thread.updated_at` (ISO 8601 → Unix ms) |
| `sessions.message_count` | `json_array_length(thread.messages)` |
| `sessions.title` | `json_extract(thread.meta, '$.name')` |
| `messages` table join | `thread.messages` JSON column → JS iteration |

**Preview extraction:** Iterate `messages` JSON array in JS, find first
`role === "user"` message, truncate to 120 chars.

**updateSessionTitle:** Changed from direct SQLite write to:
1. Update local `sessions.json` cache immediately.
2. Optionally call `POST /v1/threads/{id}/rename` (best-effort).

### 4.2 gateway.py — New Endpoints

| Endpoint | Method | Purpose | Implementation |
|----------|--------|---------|---------------|
| `/v1/threads/{id}/rename` | POST | Rename session | `CLISessionStore.rename()` |
| `/v1/config/agents-md` | GET | Read AGENTS.md (SOUL) | Read `configs/AGENTS.md` |
| `/v1/config/agents-md` | PUT | Write AGENTS.md (SOUL) | Write `configs/AGENTS.md` |
| `/v1/config/user-md` | GET | Read USER.md | Read `configs/USER.md` |
| `/v1/config/user-md` | PUT | Write USER.md | Write `configs/USER.md` |
| `/v1/skills/install` | POST | Install a skill | Copy SKILL.md to skills_dir |
| `/v1/skills/{name}` | DELETE | Uninstall a skill | Remove skill directory |

All new endpoints follow the same pattern: resolve `user_id` → locate
`WORKDIR/{user_id}/configs/` → read/write files.

### 4.3 soul.ts — Implement (remove stubs)

```typescript
// Current (stub):
export async function readSoul(): Promise<string> { return ""; }

// New:
export async function readSoul(): Promise<string> {
  const resp = await apiGet<{content: string}>("/v1/config/agents-md");
  return resp.content || "";
}
```

Same pattern for `writeSoul()` and `resetSoul()`.

### 4.4 skills.ts — Add install/uninstall

Add `POST /v1/skills/install` and `DELETE /v1/skills/{name}` calls.

### 4.5 Files NOT Changed

| File | Reason |
|------|--------|
| `run_cli.py` | Independent CLI path |
| `run_drsai_agent_factory.py` | Already used correctly by gateway |
| `DrSaiAssistant` / `DrSaiCLIAssistant` | State management aligned |
| `DatabaseManager` / `Thread` | Schema correct |
| `CLISessionStore` | Gateway uses it correctly |
| `memory.ts` | Already calls gateway API |
| Desktop `drsai.ts` | Gateway lifecycle correct |

## 5. Config File Layout

```
~/.drsai/
├── drsai.json              ← Desktop-only (connections, SSH, user name)
├── .env                    ← Agent env vars (via gateway API)
├── config.yaml             ← LLM model catalog (via gateway API)
├── workspace/
│   ├── drsai/drsai.db      ← Shared database
│   └── runs/{user_id}/
│       └── configs/        ← UserProfileManager domain
│           ├── AGENTS.md   ← SOUL (GET/PUT /v1/config/agents-md)
│           ├── USER.md     ← User profile
│           ├── MEMORY.md   ← Memory (GET /v1/memory)
│           ├── skills/     ← Installed skills
│           └── ...
└── desktop/
    └── sessions.json       ← Local session cache
```

## 6. Implementation Order

1. **gateway.py** — Add new endpoints (rename, agents-md, user-md, skills install/uninstall)
2. **session-cache.ts** — Rewrite to read `drsai.db`
3. **soul.ts** — Replace stubs with real API calls
4. **skills.ts** — Add install/uninstall API calls
5. **index.ts** — Register updated IPC handlers
