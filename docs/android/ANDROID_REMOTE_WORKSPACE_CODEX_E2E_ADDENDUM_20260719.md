# Android Remote Workspace — Codex E2E Addendum (2026-07-19)

## Result

M11-F03 is now accepted. A real OpenDrSai Full Runtime was started with the installed Codex development artifact and the Codex backend. The live verifier completed successfully (`passed: true`) using ChatGPT authentication mode.

The run covered the same protocol consumed by Android through Relay: workspace discovery, completed Codex runs, cancellation, approval materialization, multi-turn context retention, and session archive/unarchive round-trip.

Sanitized acceptance summary:

| Check | Result |
| --- | --- |
| Real Codex backend process and adapter | PASS |
| Completed runs | 3/3 PASS |
| Cancelled run | PASS |
| Approval file materialized | PASS (`OPENDRSAI_APPROVAL_OK`) |
| Multi-turn context retained | PASS |
| Session archive/unarchive | PASS |
| Verifier exit code | 0 |

Evidence was produced by `scripts/verify-codex-runtime-online.py` in execute mode. No credential or token contents are stored in this document. The Android client remains backend-agnostic; Codex private thread/turn identifiers stay inside Runtime metadata and are not part of the Android contract.

## Scope status

This addendum supersedes the earlier “M11-F03 deferred” release note. The full Android remote-workspace plan is now **12 modules / 96 functional points, 96 accepted**. Existing historical entries that describe the former 95-point gate remain unchanged for audit history.
