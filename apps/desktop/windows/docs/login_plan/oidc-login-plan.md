# Windows OIDC Login Plan

> This is the authoritative overall OIDC login plan. The RFC 8628 extension,
> Sandbox automation, and its detailed acceptance matrix are documented in
> `docs/desktop/device-code-login-implementation-plan.zh-CN.md`.

This document records the planned login integration between OpenDrSai Windows
Desktop and the HAI lightweight OIDC provider implemented in
`hai-ai-platform-backend` branch `feature/oidc_auth`.

## Summary

Use standard OpenID Connect Authorization Code Flow with PKCE as the default
login method for the normal Windows desktop product. Support OAuth 2.0 Device
Authorization Grant as a secondary method for Windows Sandbox, headless or
remote environments where loopback is unreliable, and the explicit
"Sign in on another device" user action.

The HAI backend acts as a lightweight OIDC provider for OpenDrSai. IHEP SSO
remains the upstream identity authority. The desktop app is a public OIDC
client and receives tokens from HAI, not directly from IHEP.

Recommended desktop flow:

1. OpenDrSai starts a temporary loopback callback server.
2. OpenDrSai loads HAI OIDC discovery metadata, then opens the system browser
   to the discovered authorization endpoint.
3. HAI redirects to IHEP SSO if the browser has no HAI session.
4. IHEP redirects back to HAI's fixed upstream callback.
5. HAI maps or creates the HAI user.
6. HAI redirects to the desktop loopback callback with an authorization code.
7. OpenDrSai exchanges the code plus PKCE verifier for tokens.
8. OpenDrSai calls HAI APIs with `Authorization: Bearer <access_token>`.
9. OpenDrSai refreshes tokens with the refresh token when needed.
10. The user can cancel the pending browser sign-in from the desktop login UI.

Authorization Code + PKCE remains the main product login path because it gives
normal desktop users a one-click browser round trip back to the app. Publishing
`device_authorization_endpoint` in discovery must not silently change that
default. The obsolete DrSai `/desktop-auth/start`, poll, and cancel client bridge
has been removed; it is not an OIDC fallback. Existing stored SSO sessions may
still be read, encrypted, refreshed, and migrated during the compatibility
window.

## Login Method Selection

| Product action | Protocol | Selection rule |
| --- | --- | --- |
| Sign in with HepAI | OIDC Authorization Code Flow with PKCE (`authorization_code`) | Default on normal Windows/macOS desktop |
| Sign in on another device | OAuth 2.0 Device Authorization Grant (`urn:ietf:params:oauth:grant-type:device_code`) | Explicit secondary action; visible only when discovery supports it |
| Windows Sandbox acceptance | Device Authorization Grant | Forced by the bounded acceptance flag so the host browser can approve |
| Headless/remote/loopback-restricted environment | Device Authorization Grant | Explicit environment policy or user choice |

If Authorization Code login cannot start or its callback times out, show a
recoverable error and offer the device method. Do not silently switch methods.
If device authorization is rejected, expires, or is denied, preserve that
terminal result and do not bypass it by starting an authorization-code flow.
Both methods converge on the same token validation, encrypted storage, refresh,
revoke, logout, Runtime bearer identity, and local-data ownership code.

## Backend Capabilities

The `feature/oidc_auth` branch adds a compact OIDC provider under:

```text
C:\Users\win11\VSProjects\hai-ai-platform-backend\backend\webui\oidc
```

Important endpoints:

```text
GET  /.well-known/openid-configuration
GET  /.well-known/jwks.json
GET  /oauth2/authorize
POST /oauth2/token
GET  /oauth2/userinfo
POST /oauth2/revoke
POST /oauth2/introspect
GET  /oauth2/upstream/ihep/login
GET  /oauth2/upstream/ihep/callback
GET  /api/v1/oidc/clients
POST /api/v1/oidc/clients
```

The backend seeds a default public desktop client:

```text
client_id: opendrsai-desktop
client_type: public
require_pkce: true
allow_refresh_token: true
```

Allowed redirect URI patterns:

```text
http://127.0.0.1:{port}/callback
http://localhost:{port}/callback
opendrsai://auth/callback
```

Allowed scopes:

```text
openid email profile roles groups hai_api offline_access
```

The branch also wires HAI OIDC access tokens into existing backend auth:

```text
backend/webui/utils/auth.py
```

`get_current_user()` first tries `get_user_from_access_token(token)`. That means
OpenDrSai can call existing protected APIs with the HAI OIDC access token as a
bearer token.

## Required Backend Configuration

Set a public issuer:

```text
HAI_OIDC_ISSUER=https://ai-dev.ihep.ac.cn/api
OPENDRSAI_OIDC_DISCOVERY_URL=https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration
```

The issuer must match the public route used by the desktop app and by token
validators. It is used in discovery, token `iss`, and JWKS validation.

The Windows app reads the issuer from:

```text
OPENDRSAI_OIDC_ISSUER
```

The built-in environment defaults are:

| Runtime | Discovery URL | Expected issuer |
| --- | --- | --- |
| Development | `https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration` | `https://ai-dev.ihep.ac.cn/api` |
| Packaged production | `https://ai.ihep.ac.cn/api/.well-known/openid-configuration` | `https://ai.ihep.ac.cn/api` |

Environment variables override both defaults when an explicit deployment is
needed. Local development can use `http://localhost:8081/api` for Discovery
and the corresponding local issuer.

At runtime, the app loads:

```text
{OPENDRSAI_OIDC_DISCOVERY_URL}
```

and uses the discovered `authorization_endpoint`, `token_endpoint`, and
`jwks_uri`. The discovered `issuer` must exactly match the configured issuer.

Register only this fixed callback in the IHEP SSO app:

```text
https://ai-dev.ihep.ac.cn/api/oauth2/upstream/ihep/callback
```

Desktop redirect URIs do not need to be registered in IHEP SSO. HAI validates
client redirect URIs itself.

Other relevant environment variables:

```text
HAI_OIDC_AUTH_CODE_TTL=300
HAI_OIDC_ACCESS_TOKEN_TTL=3600
HAI_OIDC_REFRESH_TOKEN_TTL=2592000
HAI_OIDC_SIGNING_KEY_ID=hai-oidc-rs256-1
HAI_OIDC_DEFAULT_DESKTOP_CLIENT_ID=opendrsai-desktop
```

IHEP upstream settings must also be configured through the existing backend
OAuth variables:

```text
OAUTH_CLIENT_ID=<ihep-client-id>
OAUTH_CLIENT_SECRET=<ihep-client-secret>
OAUTH_SCOPES=<ihep-scopes>
```

Before using the provider, run the OIDC migration so the `server.oidc_*` tables
exist. Startup then creates an active signing key and the default desktop
client.

## Desktop Authorization Request

OpenDrSai should generate:

```text
code_verifier: high-entropy random string
code_challenge: base64url(sha256(code_verifier))
state: high-entropy random string
nonce: high-entropy random string
```

Then start a local callback server on an available port:

```text
http://127.0.0.1:{port}/callback
```

Open the system browser to:

```text
{HAI_OIDC_ISSUER}/oauth2/authorize
  ?client_id=opendrsai-desktop
  &redirect_uri=http://127.0.0.1:{port}/callback
  &response_type=code
  &scope=openid%20email%20profile%20roles%20groups%20hai_api%20offline_access
  &code_challenge={code_challenge}
  &code_challenge_method=S256
  &state={state}
  &nonce={nonce}
```

Rules:

- Always request `openid`.
- Request `hai_api` so the access token is accepted by HAI APIs.
- Request `offline_access` only when "Keep me signed in" is enabled.
- Always use PKCE `S256`; the default client requires it.
- Validate returned `state` before exchanging the code.
- Validate token RS256 signatures through JWKS, then check `iss`, `aud`, `exp`,
  and the original `nonce` after token exchange.

## Token Exchange

When the loopback callback receives:

```text
GET /callback?code={code}&state={state}
```

OpenDrSai exchanges the code:

```http
POST {HAI_OIDC_ISSUER}/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
client_id=opendrsai-desktop
redirect_uri=http://127.0.0.1:{port}/callback
code={code}
code_verifier={code_verifier}
```

Expected response:

```json
{
  "access_token": "...",
  "id_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid email profile roles groups hai_api offline_access"
}
```

If `offline_access` was not requested or the backend client disallows refresh
tokens, `refresh_token` can be absent.

## Token Refresh

When the access token is missing or close to expiry, and a refresh token exists:

```http
POST {HAI_OIDC_ISSUER}/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
client_id=opendrsai-desktop
refresh_token={refresh_token}
```

The backend returns a new access token and ID token. The current implementation
does not rotate refresh tokens on refresh; keep using the existing refresh token
unless a newer one is returned later.

If refresh fails, clear the local session and show the login screen.

## API Calls

All HAI API calls from the desktop app should include:

```http
Authorization: Bearer {access_token}
```

The `hai_api` audience is enforced in the OIDC token decoder:

```text
aud: hai-api
typ: access_token
```

The desktop app should not send the ID token to application APIs. The ID token
is for the client session and user profile claims.

## Windows App Changes

Current Windows auth code is centered around:

```text
apps/desktop/windows/src/main/auth.ts
apps/desktop/windows/src/renderer/src/auth/AuthProvider.tsx
apps/desktop/windows/src/renderer/src/auth/LoginScreen.tsx
```

Add or replace the browser SSO path with:

```text
startOidcLogin()
completeOidcLogin()
refreshOidcSession()
logoutOidcSession()
```

Main-process responsibilities:

- Generate PKCE verifier/challenge.
- Generate state and nonce.
- Start a loopback HTTP server on `127.0.0.1`.
- Open the system browser with `shell.openExternal`.
- Receive the callback.
- Validate `state`.
- Exchange `code` for tokens.
- Store token bundle.
- Refresh access tokens.
- Return only public session data to the renderer.

Renderer responsibilities:

- Show "Continue with IHEP SSO" as the primary login action.
- Show loading while the browser login is pending.
- Provide cancel/retry. Cancellation closes the loopback callback server and
  resolves the login attempt as a retryable failure.
- Keep API key and developer bypass as secondary or development options.
- Avoid handling raw tokens in renderer state where possible.

Suggested stored session shape:

```ts
interface StoredOidcSession {
  authenticated: true;
  authMode: "oidc";
  provider: "hai";
  issuer: string;
  clientId: "opendrsai-desktop";
  user: {
    id: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
    roles?: string[];
    groups?: string[];
  };
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: string;
  createdAt: string;
}
```

The renderer-facing public session must omit raw tokens.

## Local Token Storage

The session metadata is stored at `~/.drsai/auth/auth.json` (or
`%DRSAI_HOME%/auth/auth.json` when overridden), but token fields are encrypted
before they are written. Writes use a same-directory temporary file and atomic
rename. The old `auth/session.json` file is read once and migrated automatically.

Current implementation uses Electron `safeStorage` in the main process, which
uses OS-backed encryption where available. Existing plaintext sessions remain
readable for migration, and future writes move token fields to encrypted
`encryptedAccessToken`, `encryptedRefreshToken`, and `encryptedIdToken` fields.

Do not store access or refresh tokens in renderer localStorage.

## Loopback vs Custom Protocol

Preferred first implementation:

```text
http://127.0.0.1:{port}/callback
```

Reasons:

- Already supported by the HAI default client.
- Standard desktop OAuth pattern.
- Does not require installer-level protocol registration.
- Easier to test in development.

Future fallback:

```text
opendrsai://auth/callback
```

Use this only after installer protocol registration is reliable. It is useful
when loopback ports are blocked by local policy, but it adds Windows packaging
and deep-link lifecycle complexity.

## Error Handling

Handle these user-visible cases distinctly:

- Browser login cancelled.
- Loopback callback timed out.
- Returned `state` does not match.
- Token exchange failed.
- Refresh token expired or revoked.
- Backend discovery is unreachable.
- IHEP SSO is unavailable.
- User is created but API access is denied by role/group policy.

The login UI should show concise retryable messages and preserve a secondary
API key path for development and emergency access.

## Verification Checklist

Backend checks:

- `GET /.well-known/openid-configuration` returns issuer and endpoints.
- `GET /.well-known/jwks.json` returns an active RS256 signing key.
- Default client `opendrsai-desktop` exists after startup.
- IHEP callback is registered and reachable.
- Authorization request redirects to IHEP when no session exists.
- Token exchange succeeds with valid PKCE.
- Token exchange fails with wrong verifier.
- Access token works against a protected HAI API.
- Refresh token returns a new access token.

Windows checks:

- Login opens the system browser.
- Callback returns control to the app.
- State mismatch is rejected.
- Access token is refreshed before expiry.
- Logout revokes the OIDC refresh token when possible, then clears stored tokens.
- App restart restores a valid session.
- Expired refresh token returns to login screen.
- Clean Windows user account can complete login.

## Open Questions

- Which HAI base URL should production OpenDrSai default to?
- Should API key login remain visible in production or move behind an advanced
  option?
- Which OS credential storage package should be used for Electron on Windows?
- Do we need group or role checks on first desktop login, or is token-level
  authentication enough initially?
