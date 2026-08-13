# Windows desktop startup performance plan

## Objective

Keep Gateway lifecycle coupled to the source-launched Desktop. The default launch starts a normal Gateway; `-HotLoad` starts a source-watching Gateway. Both modes stop the complete Gateway process tree when Desktop exits.

## Acceptance criteria

1. `windows-desktop-dev.cmd` starts Electron and a normal Gateway by default.
2. `-HotLoad` changes that Gateway to source-watching hot-load mode; legacy `-NoGateway` remains accepted.
3. Closing Desktop stops Gateway and all child processes in both modes.
4. Chat and agent execution still ensure Gateway is ready before network work.
5. Concurrent first-use requests share one Gateway startup attempt.
6. Startup health rendering does not invoke Python/Git diagnostics on its critical path; deep health remains available after the first paint.
7. Workflow recovery, scheduler startup, and deep diagnostics begin after the renderer has loaded.
8. The developer launcher caches successful backend and dependency validation and invalidates it when relevant manifests change.
9. Startup milestones are logged so regressions can be measured.
10. Static verification covers the lifecycle contract and all relevant TypeScript/verifier suites pass.

## Startup modes

`OPENDRSAI_GATEWAY_STARTUP` supports:

- `eager` (default): start Gateway after the renderer is loaded. Without `-HotLoad`, Electron owns it.
- `on-demand`: retained for `-NoGateway`; the first explicit runtime operation may still start Gateway.
- `external`: never spawn Gateway; report an externally managed endpoint only.

## Delivery stages

### Stage 1 — UI-first lifecycle

- Separate default Gateway startup from the opt-in `-HotLoad` watcher.
- Remove unconditional main-process and renderer autostart.
- Preserve explicit start/stop controls.
- Coalesce concurrent `startGateway()` calls.

### Stage 2 — lightweight startup health

- Return a filesystem-only startup snapshot immediately.
- Run version, PATH, Git, Python, update, and endpoint diagnostics after `did-finish-load`.
- Cache the latest deep result for subsequent renderer refreshes.

### Stage 3 — deferred background work

- Create and load the window before workflow recovery, scheduled task workers, update checks, and Gateway eager startup.
- Start deferred work from the renderer-ready boundary.

### Stage 4 — launcher caching

- Store validation stamps below `DRSAI_HOME\cache\desktop-dev`.
- Invalidate backend validation from Python path and backend dependency/source manifests.
- Invalidate frontend validation from `package.json` and lockfile timestamps.
- Keep `-ForceInstall` and explicit verification paths as cache bypasses.

### Stage 5 — measurement and verification

- Emit `startup:*` milestones from CMD/PowerShell, Electron main, and renderer load.
- Verify default/on-demand, eager, and external lifecycle behavior without requiring a live provider.
- Track CMD-to-window, CMD-to-interactive, and first-runtime-request-to-ready times.

## Expected behavior

The Files, terminal, settings, workspaces, and history surfaces remain usable while Runtime is stopped. Runtime-backed actions show their existing connecting state, wait for the shared startup promise, and continue automatically when ready. A startup failure leaves the request recoverable and exposes Gateway diagnostics.

