import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const tempHome = await mkdtemp(join(tmpdir(), "opendrsai-provider-usage-"));
const source = readFileSync(new URL("../src/main/providerUsageAnalytics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
}).outputText;

const module = { exports: {} };
function localRequire(specifier) {
  if (specifier === "./paths") return { DRSAI_HOME: tempHome };
  return require(specifier);
}

try {
  new Script(compiled, { filename: "providerUsageAnalytics.ts" }).runInNewContext({
    exports: module.exports,
    module,
    require: localRequire,
    console,
  });

  const { persistProviderUsageAnalytics, listProviderUsageAnalytics } = module.exports;
  const stored = await persistProviderUsageAnalytics({
    requestId: "request-usage-fixture",
    sessionId: "thread-usage-fixture",
    runId: "run-usage-fixture",
    event: {
      provider: "openai_responses",
      eventName: "response.completed",
      status: "completed",
      summary: "OpenAI Responses stream completed. input_tokens=42 output_tokens=17 total_tokens=59",
      usage: { inputTokens: 42, outputTokens: 17, totalTokens: 59 },
      rawPayload: { metadata: { secret: "do-not-store" } },
    },
  });
  if (!stored) throw new Error("Provider usage analytics record was not persisted.");

  const skipped = await persistProviderUsageAnalytics({
    requestId: "request-without-usage",
    sessionId: "thread-without-usage",
    runId: "run-without-usage",
    event: {
      provider: "anthropic",
      eventName: "message_stop",
      summary: "Anthropic message stopped.",
      usage: {},
    },
  });
  if (skipped !== null) throw new Error("Provider usage analytics persisted a status event without token usage.");

  const records = await listProviderUsageAnalytics();
  if (records.length !== 1) throw new Error(`Expected one analytics record, found ${records.length}.`);
  const [record] = records;
  if (record.requestId !== "request-usage-fixture" || record.usage.inputTokens !== 42 || record.usage.outputTokens !== 17) {
    throw new Error(`Persisted provider usage record is malformed: ${JSON.stringify(record)}`);
  }
  if (!record.id.startsWith("provider-usage:") || record.provider !== "openai_responses") {
    throw new Error(`Persisted provider usage record identity is malformed: ${JSON.stringify(record)}`);
  }

  const rawStore = await readFile(join(tempHome, "desktop", "provider-usage-analytics.json"), "utf8");
  if (rawStore.includes("metadata") || rawStore.includes("do-not-store")) {
    throw new Error("Provider usage analytics store leaked raw provider payload details.");
  }
  if (!rawStore.includes('"version": 1') || !rawStore.includes('"totalTokens": 59')) {
    throw new Error(`Provider usage analytics store omitted version or token evidence:\n${rawStore}`);
  }
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

console.log("Provider usage analytics verification passed.");
