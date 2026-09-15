# Channel Adapter Windows Runtime Fixtures Implementation Plan

**Goal:** Extend smart chat bar channel adapter runtime verification so representative Windows diagnostic, installer, and driver files are exercised through `importChannelContext`, not only source-string or checklist evidence.

**Design:** Reuse `scripts/verify-channel-adapter-runtime-fixtures.mjs` and add temporary workspace fixtures for `.evtx`, `.etl`, `.wer`, `.msi`, `.appxmanifest`, `.inf`, and `.cat`. The verifier should call the existing selected-file import path and assert bounded preview evidence plus no-runtime/no-mutation safety copy. No Windows system tools, installers, debuggers, event-log readers, driver tools, provider runtimes, or network calls should launch.

**Test commitment:** `npm run verify:channel-adapter-runtime-fixtures` must cover these runtime selected-file summaries. `npm run verify:chatbar-checklist`, `npm run verify:channel-adapters`, `npm run verify:channel-adapter-route-order`, and `npm run typecheck:node` remain the regression gate for docs evidence, broad adapter contracts, route ordering, and node type safety.

## Task 1: Runtime Windows Diagnostic And Installer Fixture Coverage

- [x] Add failing verifier expectations for a `runtime-windows-diagnostics-golden-agent` checklist/roadmap record.
- [x] Add `.evtx`, `.etl`, `.wer`, `.msi`, `.appxmanifest`, `.inf`, and `.cat` temporary workspace fixtures.
- [x] Import the fixtures through `importChannelContext` and assert specialized preview text, extracted fields or header cues, MIME/safety provenance, and no-runtime/no-mutation safety copy.
- [x] Update checklist and roadmap evidence with remaining gaps for packaged Electron IPC fixture imports, live Windows tool validation, package trust decisions, event payload decoding, dump analysis, and driver catalog trust-chain validation.
- [x] Run the focused and related verification commands and record the result.

## Verification Result

2026-07-09:

- `npm run verify:channel-adapter-runtime-fixtures` failed first on missing `runtime-windows-diagnostics-golden-agent` docs evidence, then passed after adding fixtures and docs evidence.
- `npm run verify:channel-adapter-route-order` passed.
- `npm run verify:channel-adapters` passed.
- `npm run verify:chatbar-checklist` passed.
- `npm run typecheck:node` passed.
