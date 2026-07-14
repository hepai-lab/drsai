# HAI Agent Square platform catalog fix

This is an implementation request, not an investigation-only request. The user authorizes code changes, tests, and hot reload/deployment to `ai-dev.ihep.ac.cn` in the existing HAI development environment. Do not commit or push unless the existing session already requires it.

Work directly in the current session environment `zzd_3090_via_chat_ihep`. The Codex executable is available by absolute path even though it is absent from the non-login SSH PATH. Do not stop because `command -v codex` is empty.

## Confirmed bug

The Windows Agent Square must have exactly two catalog authorities:

1. `my-drsai` is the only device-local agent.
2. Every other agent must come from the authenticated HAI platform catalog for the OIDC token subject.

The live Windows HAI cache currently contains synthetic entries named `hai.native.default`, `hai.native.ddf`, `hai.native.remote`, and `hai.native.custom`. Those are mode templates, not the actual agents visible to the signed-in HAI user. They must not be returned by `GET /api/native/v1/agents` unless they are real persisted platform agents owned by or visible to that user.

## Required platform change

1. Locate the HAI backend worktree used by `ai-dev.ihep.ac.cn`.
2. Fix `GET /api/native/v1/agents?refresh={true|false}` so it resolves the user exclusively from the validated OIDC token subject and returns the real HAI catalog visible to that user.
3. Reuse the existing HAI catalog logic and database records (`get_user_agents`, `UserAgents`, DDF agents, and persisted remote/custom agents). Do not construct one placeholder per mode.
4. Keep the public DTO secret-free. Never return API keys, bearer tokens, private runtime URLs, raw `config`, or credential-bearing headers.
5. Return stable real agent IDs, names, descriptions, owner/author, mode, availability, default/featured state, capabilities, logo, examples, last-used time, and `catalog_group` (`official` or `mine`) where available.
6. Ensure `refresh=false` uses persisted/cached real data and `refresh=true` refreshes HAI data without replacing a non-empty catalog with synthetic templates on transient failure.
7. Preserve Native Chat behavior and advertise `agent-chat` only when the chat route is actually deployed.
8. Add or update tests proving: authenticated per-user isolation; actual DDF/remote/custom rows are projected; no synthetic `hai.native.*` IDs are generated; secrets are absent; unauthenticated access is 401; another user's private agents are not visible.
9. Hot reload or deploy the fix to `ai-dev.ihep.ac.cn`, then run an authenticated sanitized smoke test. Report only IDs/names/modes and counts; do not print tokens or configs.

## Required response

Report the backend worktree, changed files, tests and results, deployment/hot-load action, sanitized live catalog result, and any remaining Windows-side action. If blocked by write permission or deployment access, give the exact failing command and the minimum owner action required.
