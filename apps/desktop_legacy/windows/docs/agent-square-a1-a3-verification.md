# Agent Square A1–A3 verification record

Status: **partial / blocked for P0 release acceptance**.

This record covers only A1, A2, and A3 from `agent-square-implementation-plan.md`. Local contract coverage does not replace the required real HAI integration loop.

## Local environment and commands

- Environment: Windows development checkout; contract endpoint fixture targets `https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false` without making a network request.
- Commands:
  - `cd apps/desktop/windows; npm run verify:platform-auth`
  - `cd apps/desktop/windows; npm run verify:oidc-login`
  - `cd apps/desktop/windows; npm run typecheck:node`
- Relevant files:
  - `src/main/platformAgentClient.ts`
  - `src/main/agents.ts`
  - `src/main/auth.ts`
  - `tests/fixtures/platform-agent-catalog.v1.json`
  - `scripts/verify-agent-square-platform-contract.mjs`

### Executed results (2026-07-14, Asia/Shanghai)

| Command | Result | Evidence / failure reason |
| --- | --- | --- |
| `npm run verify:platform-auth` | PASS | A1/A2/A3 executable contract scenarios passed, followed by 11 Python platform-auth tests. |
| `npm run verify:oidc-login` | PASS | 15 OIDC login checks passed. |
| `npm run typecheck:node` | PASS after one fix | First run found two TypeScript errors in the new mixed string/object example normalization. The implementation was changed to an explicitly typed loop; the rerun exited 0. |
| `npm run typecheck:web` | PASS | Renderer status API and explanatory UI state type-check cleanly. |
| `OPENDRSAI_LIVE_REFRESH=1 npm run verify:live-platform-oidc` | **FAIL / platform blocked** | Real encrypted Windows OIDC session refreshed successfully; claims shape/issuer/audience/activity checks passed. `GET https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false` returned HTTP 404, while the same refreshed token received HTTP 200 from `/apiv2/v1/models`. The catalog response exposed only the top-level field name `detail`; no values, tokens, or user data were recorded. |

The real command intentionally exits non-zero until the Native catalog is authorized and its returned field names pass the secret-like-field scan.

## Covered locally

- A1: the platform catalog primary path gets the logged-in OIDC access token inside Electron Main and does not read `HEPAI_API_KEY`; the Renderer receives only a public allow-listed DTO.
- A2: a 401 causes exactly one strict refresh and one retry. Refresh failure or a second 401 invalidates the local session and returns a re-login state. The fixture asserts that neither token is present in the returned result.
- A3: the catalog request doubles as first-entry Native API capability/version detection. HTTP 404/405/501 becomes `native_api_unavailable`, while local agents remain usable; 403 and other errors have distinct public states.
- Contract fixture: includes deliberately planted server-side secret fields and asserts they are absent from the public result.

## Required real integration evidence (blocked)

No real Windows OIDC credential is stored in this repository or supplied to the local contract test. Therefore the following P0 acceptance items remain blocked and must not be marked complete:

1. A real Windows login token successfully reads the ai-dev catalog.
2. ai-dev confirms `hai_api` scope behavior and records actual 401/403 status codes.
3. A real near-expiry refresh and a real one-time post-401 retry are observed with redacted logs.
4. The deployed Native API advertises or omits its version/capabilities as expected.
5. Real default, DDF, remote, and custom responses are checked for stable IDs and absence of server secrets.

The local machine did contain an Electron `safeStorage`-encrypted OIDC session, so a limited real check was performed without printing credentials. It proves real refresh and general HAI API authorization, but the Native catalog itself is absent at the planned path (404). It does **not** prove a real catalog read or a real post-401 retry.

Platform coordination: a sanitized contract request with environment, endpoint, expected/actual behavior, status codes, minimal field-name-only log, suggested contract, acceptance steps, and regression scope was sent to task `019f5208-0f19-7883-b3e2-4dcc8ffa4b61`. No Token, API Key, user content, response values, or remote secret was included.

## ai-dev acceptance steps and regression range

1. Sign in through the Windows OIDC flow using a designated non-production test account.
2. Enter Agent Square and record only timestamp, endpoint path, HTTP status, advertised API version/capability names, agent count, and sanitized field names.
3. Force a controlled expired/invalid access-token scenario; verify one refresh and at most one retry, then verify re-login on refresh failure or a second 401.
4. Repeat with a restricted account to capture 403 behavior.
5. Test an environment where Native API is absent and verify the explanatory state plus continued My DrSai availability.
6. Regression range: OIDC login/session persistence, Agent Square loading, local My DrSai listing, restricted-account handling, and IPC payload secret scans.
