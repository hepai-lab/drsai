# HAI Native agent chat implementation

This is an authorized implementation, test, and ai-dev hot-load request. Continue in the existing HAI Codex session and worktrees. Do not commit or push.

## Confirmed failure

The Windows client successfully reads the real catalog and default preference, but cloud-agent messages fail before execution because HAI advertises no `agent-chat` and implements no:

`POST /api/native/v1/agents/{agent_id}/chat`

The HAI WebUI works through its existing OpenDrSai runtime. The Windows client already sends an OIDC bearer token and this JSON contract:

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "thread_id": "stable-thread-id",
  "run_id": "optional-run-id",
  "model": "optional-model",
  "attachments": [],
  "metadata": {}
}
```

It expects OpenAI-style `text/event-stream`, structured events where available, and terminal `data: [DONE]`.

## Required implementation

1. Add the authenticated route `POST /api/native/v1/agents/{agent_id}/chat` to the HAI Native router.
2. Resolve identity only from the validated OIDC subject. Verify `agent_id` belongs to the principal's real visible catalog before any upstream call.
3. For `mode=ddf`, route execution to `https://aiapi.ihep.ac.cn/apiv2/chat/completions` using the real DDF runtime identifier/name from the catalog record, not the stable OpenDrSai UUID. Forward the OIDC bearer token without logging it. Preserve OpenAI SSE frames and guarantee one terminal `[DONE]`.
4. Prefer reuse of the existing HAI/OpenDrSai execution code for remote/custom. If those modes cannot safely execute in this HAI service yet, keep them unavailable and do not falsely claim them; report the exact missing internal endpoint. Do not build an insecure client-supplied URL proxy.
5. Validate message count/content sizes, roles, thread/run IDs, attachments metadata, upstream content type, redirects, timeouts, cancellation/disconnect, and error status mapping. Never expose tokens, API keys, private URLs, raw config, or upstream response bodies in errors/logs.
6. Add `agent-chat` to catalog features only after the route is active for the selected supported mode. If feature metadata can express per-agent capabilities, mark DDF agents with chat/streaming and leave unsupported modes disabled.
7. Add tests for OIDC isolation, stable-ID-to-runtime-name mapping, unknown/cross-user ID rejection, upstream bearer forwarding without log leakage, SSE text/error/DONE forwarding, disconnect cancellation, 401/403/404/429/5xx mapping, malformed/non-SSE upstream responses, and bounded inputs.
8. Run focused Native/OIDC tests, formatter, py_compile and diff checks; hot-load ai-dev and report sanitized results. Do not print a real token.

## Existing Windows behavior

Windows posts to `https://ai-dev.ihep.ac.cn/api/native/v1/agents/{id}/chat`, retries one 401 after OIDC refresh, parses SSE, handles timeout/cancel/circuit breaking, and has now been fixed to skip local Gateway startup for platform agents.

## Acceptance

- Catalog includes `agent-chat` only when the deployed route is usable.
- A real DDF agent can stream at least one text delta and `[DONE]` through the Native endpoint.
- No local OpenDrSai gateway is required by Windows.
- WebUI behavior remains unchanged.
