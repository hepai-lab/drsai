import assert from "node:assert/strict";
import { describeUserFacingError } from "../../shared/renderer/src/userFacingErrors.ts";

const matrix = [
  ["login_required", false, "Sign in to use managed web search", "login_codex"],
  ["permission_denied", false, "Managed web search is not enabled for this account", "diagnostics"],
  ["rate_limited", true, "Web-search requests are temporarily rate limited", "retry"],
  ["quota_exhausted", false, "Managed web-search quota is exhausted", "diagnostics"],
  ["worker_unavailable", true, "Web-search service is temporarily unavailable", "retry"],
  ["provider_authentication_failed", false, "The platform-managed search credential failed", "diagnostics"],
  ["provider_rate_limited", true, "Tavily is temporarily rate limited", "retry"],
  ["provider_quota_exhausted", false, "The platform Tavily quota is exhausted", "diagnostics"],
  ["provider_timeout", true, "Web search timed out", "retry"],
  ["provider_unavailable", true, "The upstream web-search provider is unavailable", "retry"],
  ["provider_invalid_response", true, "Web search returned an invalid response", "retry"],
  ["unsafe_web_url", false, "The web address is not safe to access", "diagnostics"],
] as const;

for (const [code, retryable, title, firstAction] of matrix) {
  const result = describeUserFacingError({ code, retryable, message: "SECRET-PROVIDER-BODY" }, "en");
  assert.equal(result.title, title);
  assert.equal(result.retryable, retryable);
  assert.equal(result.actions[0]?.id, firstAction);
  assert.equal(JSON.stringify(result).includes("SECRET-PROVIDER-BODY"), false);
}
console.log(`Tavily P3 error UX verification passed (${matrix.length} states).`);
