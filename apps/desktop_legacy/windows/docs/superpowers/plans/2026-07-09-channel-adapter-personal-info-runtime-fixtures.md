# Channel Adapter Personal Info Runtime Fixtures Implementation Plan

**Goal:** Extend smart chat bar channel adapter runtime verification so reviewed personal-information handoff files are exercised through `importChannelContext`, not only source-string or checklist evidence.

**Design:** Reuse `scripts/verify-channel-adapter-runtime-fixtures.mjs` and add temporary workspace fixtures for `.eml`, `.mbox`, `.vcf`, and `.ics`. The verifier should call the existing selected-file import path and assert bounded preview evidence plus no-provider/no-mutation safety copy. No provider, mailbox, contacts, calendar, or network runtime should be launched.

**Test commitment:** `npm run verify:channel-adapter-runtime-fixtures` must cover these runtime selected-file summaries. `npm run verify:chatbar-checklist`, `npm run verify:channel-adapters`, `npm run verify:channel-adapter-route-order`, and `npm run typecheck:node` remain the regression gate for docs evidence, broad adapter contracts, route ordering, and node type safety.

## Task 1: Runtime Personal Information Fixture Coverage

- [x] Add failing verifier expectations for a `runtime-personal-info-golden-agent` checklist/roadmap record.
- [x] Add `.eml`, `.mbox`, `.vcf`, and `.ics` temporary workspace fixtures.
- [x] Import the fixtures through `importChannelContext` and assert specialized preview text, extracted fields, MIME/safety provenance, and no-provider safety copy.
- [x] Update checklist and roadmap evidence with remaining gaps for live mailbox sync, contacts provider sync, calendar provider sync, and packaged IPC fixture coverage.
- [x] Run the focused and related verification commands and record the result.

## Verification Result

2026-07-09:

- `npm run verify:channel-adapter-runtime-fixtures` passed after first failing on missing `runtime-personal-info-golden-agent` docs evidence.
- `npm run verify:channel-adapter-route-order` passed.
- `npm run verify:channel-adapters` passed.
- `npm run verify:chatbar-checklist` passed.
- `npm run typecheck:node` passed.
