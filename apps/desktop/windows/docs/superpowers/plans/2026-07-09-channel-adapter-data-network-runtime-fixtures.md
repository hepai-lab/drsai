# Channel Adapter Data And Network Runtime Fixtures Implementation Plan

**Goal:** Extend smart chat bar channel adapter runtime verification so representative database, event-stream, network trace, packet capture, notebook, and columnar files are exercised through `importChannelContext`, not only source-string or checklist evidence.

**Design:** Reuse `scripts/verify-channel-adapter-runtime-fixtures.mjs` and add temporary workspace fixtures for `.sqlite`, `.sql`, `.jsonl`, `.har`, `.pcap`, `.pcapng`, `.ipynb`, `.parquet`, and `.arrow`. The verifier should call the existing selected-file import path and assert bounded preview evidence, secret redaction, and no-runtime/no-provider safety copy. No database engine, SQL client, browser replay, packet analyzer, notebook kernel, DuckDB/PyArrow/Spark runtime, provider, or network call should launch.

**Test commitment:** `npm run verify:channel-adapter-runtime-fixtures` must cover these runtime selected-file summaries. `npm run verify:channel-adapter-route-order`, `npm run verify:channel-adapters`, `npm run verify:chatbar-checklist`, and `npm run typecheck:node` remain the regression gate for route ordering, broad adapter contracts, docs evidence, and node type safety.

## Task 1: Runtime Data And Network Fixture Coverage

- [x] Add failing verifier expectations for a `runtime-data-network-golden-agent` checklist/roadmap record.
- [x] Add `.sqlite`, `.sql`, `.jsonl`, `.har`, `.pcap`, `.pcapng`, `.ipynb`, `.parquet`, and `.arrow` temporary workspace fixtures.
- [x] Import the fixtures through `importChannelContext` and assert specialized preview text, redaction, metadata evidence, and no-runtime/no-provider safety copy.
- [x] Fix columnar route order so `.parquet`, `.arrow`, and `.feather` route before the generic document fallback.
- [x] Update checklist and roadmap evidence with remaining gaps for packaged Electron IPC fixture imports, live database connections/schema sampling, HAR replay, packet decoding, notebook kernel execution, row-group/record-batch decoding, provider-backed schema inference, and live provider validation.
- [x] Run the focused and related verification commands and record the result.

## Verification Result

2026-07-09:

- `npm run verify:channel-adapter-runtime-fixtures` failed first on PCAPNG block-name assertion wording, then on columnar data routing through the generic document fallback.
- Fixed the PCAPNG assertion to match existing normalized block names and moved columnar data routing before generic document text extraction.
- `npm run verify:channel-adapter-runtime-fixtures` passed.
- `npm run verify:channel-adapter-route-order` passed.
- `npm run verify:channel-adapters` passed.
- `npm run verify:chatbar-checklist` passed.
- `npm run typecheck:node` passed.
