# OpenDrSai Windows A5 First-User Manual Test Template

This template is for the A5 "service unavailable guidance" user study. It is product research evidence only. Do not mark A5 as complete or 3 points from this template alone.

## Session Metadata

| Field | Value |
| --- | --- |
| Participant ID | U01-U10 |
| Date/time |  |
| Observer |  |
| App version |  |
| Commit/build |  |
| Windows version | Windows 10 / Windows 11 |
| Display/scaling |  |
| Account type | not signed in / no service permission / normal user |
| Network/runtime condition | auth_required / service_unavailable / runtime_missing / permission_denied |
| Evidence folder |  |

## Required Scenario Matrix

Run each state with at least one participant; distribute all four states across 10 first-time users.

| State | Required user-visible reason | Expected recovery entry |
| --- | --- | --- |
| auth_required | User understands that sign-in is required before any task can run. | Sign in, copy redacted diagnostics |
| service_unavailable | User understands local service is not ready and no task was sent. | Retry, sign in again where available, copy redacted diagnostics |
| runtime_missing | User understands local runtime must be repaired or checked. | Repair/check runtime, retry, copy redacted diagnostics |
| permission_denied | User understands the current account lacks service permission. | Sign in with another account, copy redacted diagnostics |

## Observation Form

| Item | Record |
| --- | --- |
| Could explain reason in own words? | yes / partial / no |
| Explanation transcript |  |
| Found the correct recovery entry without help? | yes / no |
| Time to find recovery entry |  |
| Help requests count |  |
| Clicked or attempted correct CTA | yes / no |
| Tried to start chat/Agent while blocked | yes / no |
| Copied diagnostics | yes / no |
| Diagnostics reviewed for redaction | pass / fail |
| Screenshot path |  |
| Recording path |  |
| Notes |  |

## Pass/Fail Notes

- Record failures verbatim. Do not correct participant wording.
- Diagnostics must not contain token, API key, cookie, email address, or personal absolute user path.
- If the user cannot find the recovery action, record the time and the exact point of confusion.
- This manual evidence complements automation and cannot replace packaged E2E, Win10/11 matrix, or 20-run stability evidence.
