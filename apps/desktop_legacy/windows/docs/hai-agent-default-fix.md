# HAI Native default-agent mutation fix

This is an authorized implementation and ai-dev hot-load request. Work in the existing HAI backend worktree and do not commit or push.

## Confirmed failure

The Windows Agent Square star button calls:

`PUT /api/native/v1/agents/default`

with JSON:

`{"agent_id":"<real platform agent id>"}`

The current ai-dev Native router only implements `GET /agents`, so the button cannot persist a default. The OpenDrSai service already implements `PUT /api/agentworker/user_default_agent` and `GET /api/agentworker/user_default_agent`.

## Required implementation

1. Add `PUT /api/native/v1/agents/default` to `backend/webui/routers/native_agents.py`.
2. Resolve the catalog user exclusively from the validated OIDC subject via the existing `NativePrincipal`; never accept a client `user_id`.
3. Before mutation, verify the requested agent ID is present in that principal's real visible catalog. Reject an unknown or another user's ID with 404/403 and do not proxy it.
4. Proxy to the existing OpenDrSai `PUT /api/agentworker/user_default_agent` with the principal's mapped catalog user ID and requested agent ID, forwarding the bearer token without logging it.
5. Preserve secret-free error responses. Map upstream auth/permission/not-found failures to appropriate Native status codes; transient upstream failures should be 502/503, not false success.
6. After success, update or invalidate the subject-isolated Native catalog cache so the next list response marks exactly that agent `is_default=true`. If the upstream list response already contains this field, preserve it.
7. Advertise an `agent-default` feature only when the endpoint is active. Do not advertise `agent-chat`.
8. Add tests for success, per-subject identity, unknown agent rejection, cross-user isolation, one-default projection, upstream failure, and no token/config leakage.
9. Run focused Native/OIDC tests, formatter/compile/diff checks, hot-load ai-dev, and report the sanitized result. Do not print a real token.

The Windows client already handles a successful 2xx response and one 401 refresh retry. No Windows contract change is requested unless the deployed API proves a concrete mismatch.
