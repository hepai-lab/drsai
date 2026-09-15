# Desktop Chat 401 "OIDC signing keys are unavailable" — Root Cause & Fix

**Date:** 2026-08-30
**Symptom:** After OIDC login, sending a chat message returns "回复失败。请查看调试信息" with error `Error code: 401 - {'detail': {'error': 'invalid_token', 'message': 'OIDC signing keys are unavailable'}}`.

## Root Cause

### Configuration mismatch between OIDC issuer and model API server

The desktop dev launch scripts set:

| Env Var | Value | Server |
|---------|-------|--------|
| `OPENDRSAI_OIDC_ISSUER` | `https://ai-dev.ihep.ac.cn/api` | **Dev** OIDC |
| `OPENDRSAI_MODEL_BASE_URL` | `https://aiapi.ihep.ac.cn/apiv2/v1` | **Production** API |

When the user logs in via OIDC, the OIDC token is issued by the **dev** server (`ai-dev.ihep.ac.cn`). When a chat message is sent, this OIDC token is used as the Bearer token for the model API request. The request goes to the **production** API server (`aiapi.ihep.ac.cn`), which must verify the OIDC token by fetching JWKS from the dev OIDC issuer.

**The production API server cannot fetch JWKS from the dev OIDC issuer** (likely due to network restrictions, different server environments, or a missing OIDC verification configuration on the production server). This results in the 401 error: `OIDC signing keys are unavailable`.

### Complete error chain

1. **Local gateway** (`_auth.py` middleware): Verifies OIDC token using RS256/JWKS from `https://ai-dev.ihep.ac.cn/api/.well-known/jwks.json` → ✅ succeeds (JWKS is reachable from the user's machine, cached 300s)
2. **PlatformAuthContext**: Created with `model_base_url = https://aiapi.ihep.ac.cn/apiv2/v1` (from `OPENDRSAI_MODEL_BASE_URL` env var override)
3. **HepAIChatCompletionClient**: Uses OIDC token as API key, sends request to `https://aiapi.ihep.ac.cn/apiv2/v1/chat/completions`
4. **Production API server** (`aiapi.ihep.ac.cn`): Tries to verify OIDC token by fetching JWKS from the dev issuer → ❌ fails → returns 401

### Why `resolve_hepai_model_base_url()` didn't help

`platform_upstream.py` L18-38 has correct logic to resolve the model base URL based on the OIDC issuer:

```python
def resolve_hepai_model_base_url(environ, *, issuer=None):
    override = env.get("OPENDRSAI_MODEL_BASE_URL", "").strip().rstrip("/")
    if override:
        return override                    # ← This override short-circuits!
    selected_issuer = (issuer or ...).strip().rstrip("/")
    if selected_issuer == DEVELOPMENT_OIDC_ISSUER:
        return DEVELOPMENT_MODEL_BASE_URL   # https://ai-dev.ihep.ac.cn/apiv2/v1
    ...
```

Without `OPENDRSAI_MODEL_BASE_URL`, the function would correctly return `https://ai-dev.ihep.ac.cn/apiv2/v1` (dev model API) based on the dev OIDC issuer. But the dev script's `OPENDRSAI_MODEL_BASE_URL` override bypassed this logic entirely.

### Error source identification

The error `Error code: 401 - {'detail': {'error': 'invalid_token', 'message': 'OIDC signing keys are unavailable'}}` is from the **HepAI production API server**, not the local gateway:
- `"Error code: 401"` — OpenAI SDK's HTTP error wrapper format
- `{'detail': {...}}` — FastAPI's default error response format (uses `detail` key)
- Local gateway errors use `{"error": {"code": ..., "message": ..., "retryable": ...}}` format
- Local JWKS failure would raise `ValueError("oidc_verification_unavailable")` → mapped to HTTP 409, not 401

## Fix Applied

### Files modified

1. **`apps/desktop/windows/scripts/dev.ps1`** (L678)
   - Removed `$env:OPENDRSAI_MODEL_BASE_URL = "$PlatformApiBaseUrl/v1"` line
   - Added explanatory comment about why this override must not be set

2. **`apps/desktop/windows-desktop-dev.cmd`** (L61)
   - Removed `set "OPENDRSAI_MODEL_BASE_URL=https://aiapi.ihep.ac.cn/apiv2/v1"` line
   - Added explanatory comment

### What the fix does

After removing the `OPENDRSAI_MODEL_BASE_URL` override, `resolve_hepai_model_base_url()` resolves the correct URL:

1. `OPENDRSAI_MODEL_BASE_URL` is not set → skip override
2. `OPENDRSAI_OIDC_ISSUER = "https://ai-dev.ihep.ac.cn/api"` → matches `DEVELOPMENT_OIDC_ISSUER`
3. Returns `DEVELOPMENT_MODEL_BASE_URL = "https://ai-dev.ihep.ac.cn/apiv2/v1"` (dev model API)

Now the OIDC token (issued by dev) is sent to the dev model API server (same server), which can successfully fetch JWKS and verify the token.

### What was NOT changed

- `OPENDRSAI_PLATFORM_API_BASE_URL` — kept as `aiapi.ihep.ac.cn` (for DDF agents / Agent Square)
- `OPENDRSAI_DDF_API_BASE_URL` — kept as `aiapi.ihep.ac.cn` (for DDF agents)
- `OPENDRSAI_OIDC_ISSUER` — kept as `ai-dev.ihep.ac.cn/api` (dev OIDC)
- `platform_upstream.py` — no changes needed (logic was already correct)

## Verification

```
Before fix:
  OIDC Issuer:      https://ai-dev.ihep.ac.cn/api (dev)
  Model Base URL:   https://aiapi.ihep.ac.cn/apiv2/v1 (PRODUCTION)
  Result:            OIDC token sent to production → 401

After fix:
  OIDC Issuer:      https://ai-dev.ihep.ac.cn/api (dev)
  Model Base URL:   https://ai-dev.ihep.ac.cn/apiv2/v1 (DEV, auto-resolved)
  Result:            OIDC token sent to dev → should work
```

**Key insight:** The OIDC issuer and model API server must be on the same host (or at least the model API server must be able to fetch JWKS from the OIDC issuer). Using a dev OIDC token with a production API server breaks this invariant.

## Related Files

- `cores/python/packages/drsai/src/drsai/platform_upstream.py` — Canonical URL resolution logic
- `cores/python/packages/drsai/src/drsai/platform_auth.py` — OIDC token verification + credential provider
- `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_auth.py` — Gateway auth middleware
- `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_agent_backend.py` — Chat execution
- `cores/python/packages/drsai/src/drsai/modules/components/model_client/LLMClient.py` — HepAI model client
- `apps/desktop/windows/scripts/dev.ps1` — Dev launch script (modified)
- `apps/desktop/windows-desktop-dev.cmd` — Dev launcher CMD (modified)
