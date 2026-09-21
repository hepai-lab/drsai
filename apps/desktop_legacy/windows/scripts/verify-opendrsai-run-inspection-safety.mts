import assert from "node:assert/strict";
import {
  redactRunInspectionText,
  sanitizeRunInspection,
  sanitizeRunReproductionManifest,
} from "../../shared/api/runInspectionSafety";
import type { RunInspection, RunReproductionManifest } from "../../shared/api/runInspection";

const canaries = [
  "raw-chain-canary",
  "hidden-analysis-canary",
  "secret-bearer-canary",
  "secret-api-key-canary",
  "secret-cookie-canary",
  "secret-url-token-canary",
  "private-user",
  "private-server",
  "secret-private-key-canary",
  "system-prompt-canary",
  "input-body-canary",
];

const manifest = {
  schema_version: "opendrsai.run-manifest/1",
  run_id: "run-safe-1",
  manifest: {
    model: { id: "hai-public-model", api_key: "secret-api-key-canary" },
    prompt: { id: "prompt-1", digest: "a".repeat(64), content: "system-prompt-canary" },
    input: { sha256: "b".repeat(64), length: 42, text: "input-body-canary" },
    workspace: { root: "C:\\Users\\private-user\\OpenDrSai\\workspace" },
    environment: { note: "loaded /home/private-user/opendrsai/.env" },
  },
  manifest_digest: "c".repeat(64),
  safe_manifest_digest: "d".repeat(64),
  reproducibility_level: "partial",
  missing_evidence: ["file C:\\Users\\private-user\\OpenDrSai\\missing.txt"],
  created_at: "2026-08-05T00:00:00.000Z",
  finalized_at: null,
  integrity: { algorithm: "sha256", digest_scope: "safe_manifest", digest: "d".repeat(64) },
} as RunReproductionManifest;

const inspection = {
  schema_version: "opendrsai.run-inspection/1",
  run: {
    run_id: "run-safe-1", session_id: "session-safe-1", workspace_id: "workspace-safe-1",
    backend_id: "full-agent-runtime", agent_definition: "my-drsai", status: "completed",
    created_at: "2026-08-05T00:00:00.000Z",
    private_path: "C:\\Users\\private-user\\OpenDrSai\\run.json",
  },
  summary: {
    duration_ms: 1200,
    counts_by_item_type: { reasoning: 1, tool_call: 1 },
    counts_by_status: { completed: 2 },
    error: { code: "provider_error", message: "Bearer secret-bearer-canary at C:\\Users\\private-user\\log.txt", retryable: false },
    usage: { input_tokens: 7, output_tokens: 5, total_tokens: 12 },
    artifact_count: 0, warning_count: 1,
  },
  timeline: [
    {
      id: "reasoning-1", session_id: "session-safe-1", run_id: "run-safe-1", type: "reasoning",
      status: "completed", sequence: 1, created_at: "2026-08-05T00:00:00.000Z", updated_at: "2026-08-05T00:00:00.000Z",
      source: { backend: "runtime" }, event_refs: [{ event_id: "event-1", sequence: 1 }],
      content: {
        segments: [{ text: "raw-chain-canary" }],
        chain_of_thought: "hidden-analysis-canary",
        public_summary: "Compared the supplied evidence and verified the result.",
      },
    },
    {
      id: "tool-1", session_id: "session-safe-1", run_id: "run-safe-1", type: "tool_call",
      status: "completed", sequence: 2, created_at: "2026-08-05T00:00:01.000Z", updated_at: "2026-08-05T00:00:01.000Z",
      source: { backend: "runtime" }, event_refs: [{ event_id: "event-2", sequence: 2 }],
      content: {
        name: "read_file",
        arguments: { path: "\\\\private-server\\share\\secret.txt", api_key: "secret-api-key-canary" },
        output: "Cookie: sid=secret-cookie-canary URL=https://example.test/a?token=secret-url-token-canary",
        private_key: "-----BEGIN PRIVATE KEY-----secret-private-key-canary-----END PRIVATE KEY-----",
      },
    },
  ],
  manifest,
  page: { next_cursor: null, has_more: false },
} as unknown as RunInspection;

const sanitized = sanitizeRunInspection(inspection);
const serialized = JSON.stringify(sanitized);
for (const canary of canaries) assert.equal(serialized.includes(canary), false, `public inspection leaked ${canary}`);
assert.deepEqual((sanitized.timeline[0]?.content as { segments?: unknown[] }).segments, []);
assert.match(JSON.stringify(sanitized.timeline[0]?.content), /Compared the supplied evidence/);
assert.equal("private_path" in sanitized.run, false);
assert.match(serialized, /REDACTED/);

const safeManifest = sanitizeRunReproductionManifest(manifest);
const serializedManifest = JSON.stringify(safeManifest);
for (const canary of canaries) assert.equal(serializedManifest.includes(canary), false, `public manifest leaked ${canary}`);
assert.deepEqual(Object.keys(safeManifest.manifest.prompt as object).sort(), ["digest", "id"]);
assert.deepEqual(Object.keys(safeManifest.manifest.input as object).sort(), ["length", "sha256"]);

const diagnostic = redactRunInspectionText(
  "Bearer secret-bearer-canary C:\\Users\\private-user\\OpenDrSai\\debug.log /tmp/private-user/debug.log token=secret-url-token-canary",
);
assert.equal(canaries.some((canary) => diagnostic.includes(canary)), false);

console.log(JSON.stringify({
  ok: true,
  schema: sanitized.schema_version,
  publicReasoningSummaries: 1,
  rawReasoningSegments: (sanitized.timeline[0]?.content as { segments?: unknown[] }).segments?.length ?? -1,
  canariesChecked: canaries.length,
  secretLeaks: 0,
  privatePathLeaks: 0,
  manifestPromptBodyFields: 0,
  manifestInputBodyFields: 0,
}, null, 2));
