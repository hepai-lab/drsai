import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactDesktopSecrets, sanitizeDiagnosticUrl } from "../main/secretRedaction.ts";
import { redactSensitiveData, sanitizeSensitiveValue, scanSensitiveData } from "../api/sensitiveData.ts";
import { redactText } from "../main/diagnostics.ts";

const samples = [
  "Authorization: Bearer abc.def.secret",
  "api_key=sk-secret-value",
  "refresh_token: refresh-secret",
  '{"access_token":"access-secret","safe":"ok"}',
  '{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB","safe":"ok"}',
  '{"data_url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}',
  "https://example.test/callback?code=auth-code&state=csrf-state",
];
for (const sample of samples) {
  const redacted = redactDesktopSecrets(sample);
  assert.ok(!redacted.includes("secret-value") && !redacted.includes("auth-code") && !redacted.includes("csrf-state") && !redacted.includes("abc.def.secret") && !redacted.includes("refresh-secret") && !redacted.includes("access-secret"), `Secret survived redaction: ${redacted}`);
  assert.ok(!redacted.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"), `Image body survived redaction: ${redacted}`);
}
const url = sanitizeDiagnosticUrl("https://login.example/authorize?state=one&code_challenge=two#fragment");
assert.ok(!url.includes("one") && !url.includes("two") && !url.includes("fragment"));
assert.match(url, /state=%5BREDACTED%5D/);
const allChannelCanaries = "api_key=F5ApiKey123456 Bearer F5BearerToken123456 f5.user@example.test 13812345678";
assert.deepEqual([...new Set(scanSensitiveData(allChannelCanaries).map((item) => item.kind))].sort(), ["api_key", "bearer_token", "email", "phone"].sort());
for (const sanitized of [
  redactSensitiveData(allChannelCanaries),
  redactText(allChannelCanaries),
  JSON.stringify(sanitizeSensitiveValue({ message: allChannelCanaries, nested: [allChannelCanaries] })),
]) {
  for (const canary of ["F5ApiKey123456", "F5BearerToken123456", "f5.user@example.test", "13812345678"]) assert.ok(!sanitized.includes(canary), `All-channel canary survived: ${canary}`);
}
const structured = sanitizeSensitiveValue({
  headers: { Authorization: "Bearer arbitrary-token-body", "x-api-key": "arbitrary-api-key" },
  result: { b64_json: "arbitrary-image-body", data_url: "data:image/png;base64,arbitrary-image-body" },
  safe: "visible",
});
assert.deepEqual(structured, {
  headers: { Authorization: "[REDACTED SECRET]", "x-api-key": "[REDACTED SECRET]" },
  result: { b64_json: "[REDACTED BINARY]", data_url: "[REDACTED BINARY]" },
  safe: "visible",
});
const sourceFixture = new URL("../../../../cores/protocol/relay/secret-redaction-fixtures.json", import.meta.url);
const bundledFixture = resolve(process.cwd(), "../../../cores/protocol/relay/secret-redaction-fixtures.json");
const fixture = JSON.parse(readFileSync(existsSync(sourceFixture) ? sourceFixture : bundledFixture, "utf8"));
for (const sample of fixture.samples) {
  const redacted = redactDesktopSecrets(sample.input);
  assert.ok(redacted.includes("[REDACTED]"));
  for (const canary of sample.must_not_contain) {
    assert.ok(!redacted.includes(canary), `Shared canary survived Desktop redaction: ${canary}`);
  }
}
console.log("Desktop secret redaction verification passed.");
