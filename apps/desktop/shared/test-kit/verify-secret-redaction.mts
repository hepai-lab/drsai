import assert from "node:assert/strict";
import { redactDesktopSecrets, sanitizeDiagnosticUrl } from "../main/secretRedaction.ts";

const samples = [
  "Authorization: Bearer abc.def.secret",
  "api_key=sk-secret-value",
  "refresh_token: refresh-secret",
  '{"access_token":"access-secret","safe":"ok"}',
  "https://example.test/callback?code=auth-code&state=csrf-state",
];
for (const sample of samples) {
  const redacted = redactDesktopSecrets(sample);
  assert.ok(!redacted.includes("secret-value") && !redacted.includes("auth-code") && !redacted.includes("csrf-state") && !redacted.includes("abc.def.secret") && !redacted.includes("refresh-secret") && !redacted.includes("access-secret"), `Secret survived redaction: ${redacted}`);
}
const url = sanitizeDiagnosticUrl("https://login.example/authorize?state=one&code_challenge=two#fragment");
assert.ok(!url.includes("one") && !url.includes("two") && !url.includes("fragment"));
assert.match(url, /state=%5BREDACTED%5D/);
console.log("Desktop secret redaction verification passed.");
