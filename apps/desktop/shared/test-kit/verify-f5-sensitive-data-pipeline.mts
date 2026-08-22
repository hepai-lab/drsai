import assert from "node:assert/strict";
import { redactSensitiveData, sanitizeSensitiveValue, scanSensitiveData } from "../api/sensitiveData";
import { buildLocalDesktopDataExport } from "../renderer/src/localDataExport";
import { analyzeMemorySafetyIntent, redactSensitiveMemoryText } from "../renderer/src/userPreferenceIntent";

const canaries = {
  apiKey: "F5ApiKey123456789",
  bearer: "F5BearerToken123456789",
  email: "f5.user@example.test",
  phone: "13812345678",
  userSecret: "F5PersonalSecret123456",
};
const input = `api_key=${canaries.apiKey} Bearer ${canaries.bearer} ${canaries.email} ${canaries.phone} user_secret=${canaries.userSecret}`;
assert.deepEqual([...new Set(scanSensitiveData(input).map((item) => item.kind))].sort(), ["api_key", "bearer_token", "email", "phone", "user_secret"].sort());
const outputs = [
  redactSensitiveData(input),
  JSON.stringify(sanitizeSensitiveValue({ message: input, nested: { values: [input] } })),
  redactSensitiveMemoryText(input),
  buildLocalDesktopDataExport({ thread: { messages: [{ role: "user", content: input }] } }, { "opendrsai.fixture": input }, "2026-08-05T00:00:00.000Z"),
];
for (const output of outputs) for (const canary of Object.values(canaries)) assert.ok(!output.includes(canary), `Sensitive value survived: ${canary}`);
const safety = analyzeMemorySafetyIntent(input);
assert.equal(safety.hasSensitiveContent, true);
assert.deepEqual([...safety.sensitiveKinds].sort(), ["api_key", "bearer_token", "email", "phone", "token", "user_secret"].sort());
assert.match(outputs.at(-1)!, /redacted-before-export/);
console.log("F5 common scanner, nested channel redaction, chat blocking, and local export tests passed.");
