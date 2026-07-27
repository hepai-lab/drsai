# Windows App External Connections TODOs

These items track external systems that should become readable, operable, and
auditable context/tool surfaces for the Windows app. Status uses the smart chat
bar checklist convention: `[x]` complete and verified, `[~]` partial with known
gaps, `[ ]` not implemented.

## TODOs

- [~] Mobile: local readiness is visible in Channels through
  `listExternalConnectionReadiness()`, and the existing `mobile-chat` adapter
  supports reviewed `.drsai/mobile-context.json` phone-originated message
  handoff plus approval-aware outbound drafts. Remaining gaps: live mobile
  device pairing, push notification routing, remote mobile send/read receipt
  reconciliation, and mobile-side task state sync.

- [~] GitHub: readiness distinguishes read-only local Git remote from verified
  Device OAuth. The connector supports reviewed snapshots, live issue/PR reads,
  and approval-gated comments with revoke and idempotency. Remaining gaps are
  Actions log/retry orchestration, push/webhook sync, and mutations beyond comments.

- [~] Chrome: local readiness is visible in Channels and ties together browser
  task approvals plus reviewed HAR, NetLog, trace, bookmark, cookie, and URL
  shortcut imports. Remaining gaps: live Chrome profile connection, signed-in
  session reuse, interactive DOM/screenshot capture, and controlled browser
  automation beyond approval-gated tasks.

- [~] Slack: readiness distinguishes local snapshots from a verified bot token.
  The adapter supports `auth.test`, live `conversations.history`, approval-gated
  `chat.postMessage`, revoke, redaction and idempotency. Remaining gaps are thread
  pagination/cursors, event subscriptions, and remote update/delete operations.

- [~] Docs: readiness distinguishes snapshots from a verified Google token with
  document read/write scope. The connector supports live bounded reads and
  approval-gated, revision-bound `batchUpdate` append with revoke and idempotency.
  Remaining gaps are comments/suggestions, permissions, version history and push sync.

- [~] Calendar: readiness distinguishes local JSON/ICS snapshots from a verified
  Google Calendar token. The inbound-only connector supports bounded live
  `events.list`, timed/all-day mapping, redaction, pagination, revoke and expiry.
  Remaining gaps are attendee/free-busy details, push sync and remote event mutation.

- [~] LaTeX: local readiness is visible in Channels and uses `file-input`
  previews for `.tex`, `.bib`, `.bibtex`, and `latexmkrc` snapshots without
  running TeX tools. Remaining gaps: TeX/BibTeX execution, PDF compilation,
  SyncTeX/source mapping, bibliography resolution, and template workflow
  management.

- [~] Database: local readiness is visible in Channels through
  `listExternalConnectionReadiness()`, and the existing `database-connector`
  supports reviewed `.drsai/database-context.json` table/query snapshots plus
  schema-context handoff. Remaining gaps: live database connection management,
  credential validation, query execution, schema introspection, and rollback for
  approved mutations.

- [~] Log monitor: local readiness is visible in Channels through
  `listExternalConnectionReadiness()`, and the existing `logs-monitor` adapter
  supports reviewed `.drsai/log-monitor.json` incremental log deltas with local
  cursor metadata plus reviewed retention policy hints that are surfaced without
  deleting, rotating, truncating, or enforcing retention. Remaining gaps: live
  log streaming, watcher lifecycle, retention enforcement, provider-backed alert
  correlation, and remote incident sync.

- [~] Unified connection model: local readiness is visible in Channels and
  consolidates channel adapters, Approval Center, MCP live bridge audit, workflow
  `external_runtime` resume semantics, and Docs/Calendar snapshot contracts.
  Each connection now exposes local reconnect policy review metadata in Channels:
  startup/refresh/snapshot-sync triggers, manual-review safeguards, and
  verification that no autonomous reconnect or provider runtime was started.
  Each connection also exposes reconnect readiness checks before that policy:
  configured/setup state, local adapter catalog evidence, visible live-runtime
  gaps, approval-boundary readiness, no credential/network/runtime verification,
  and the next live gap.
  Remaining gaps: provider-owned process supervision, cross-provider credential
  vault integration, remote connector marketplace sync, approval-gated live
  reconnect execution, autonomous safe reconnect, and remote mutation rollback.

## Verification

- `npm run verify:external-connections` checks the readiness API contract, IPC
  handler, preload bridge, mock fixture, Channels UI, visible gap and
  verification details, reconnect readiness checks, local reconnect policy review, styles,
  checklist/roadmap evidence, and this TODO status.
- `npm run verify:channel-adapters`, `npm run verify:approval-center`,
  `npm run verify:workflow-marketplace`, and `npm run verify:mcp-live-bridge`
  cover the underlying local channel, approval, workflow, and MCP boundaries.

## Safety Boundary

The readiness matrix is intentionally local and read-only. It does not start
OAuth, open browser processes, execute LaTeX, call provider APIs, make network
requests, or mutate workspace files.
