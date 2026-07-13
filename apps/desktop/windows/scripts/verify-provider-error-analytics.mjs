import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const tempHome = await mkdtemp(join(tmpdir(), "opendrsai-provider-error-"));
const source = readFileSync(new URL("../src/main/providerErrorAnalytics.ts", import.meta.url), "utf8");
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
  new Script(compiled, { filename: "providerErrorAnalytics.ts" }).runInNewContext({
    exports: module.exports,
    module,
    require: localRequire,
    console,
  });

  const { persistProviderErrorAnalytics, listProviderErrorAnalytics } = module.exports;
  const stored = await persistProviderErrorAnalytics({
    requestId: "request-error-fixture",
    sessionId: "thread-error-fixture",
    runId: "run-error-fixture",
    event: {
      provider: "openai_responses",
      eventName: "response.failed",
      code: "rate_limit_exceeded",
      message: "Rate limit reached",
      retryable: false,
      summary: "OpenAI Responses stream error. code=rate_limit_exceeded message=Rate limit reached retryable=false",
      rawPayload: { metadata: { secret: "do-not-store" } },
    },
  });
  if (!stored) throw new Error("Provider error analytics record was not persisted.");

  const skipped = await persistProviderErrorAnalytics({
    requestId: "request-without-message",
    sessionId: "thread-without-message",
    runId: "run-without-message",
    event: {
      provider: "anthropic",
      eventName: "error",
      code: "overloaded_error",
      message: "",
      retryable: true,
      summary: "Anthropic stream error.",
    },
  });
  if (skipped !== null) throw new Error("Provider error analytics persisted an event without a message.");

  const records = await listProviderErrorAnalytics();
  if (records.length !== 1) throw new Error(`Expected one analytics record, found ${records.length}.`);
  const [record] = records;
  if (record.requestId !== "request-error-fixture" || record.code !== "rate_limit_exceeded" || record.retryable !== false) {
    throw new Error(`Persisted provider error record is malformed: ${JSON.stringify(record)}`);
  }
  if (!record.id.startsWith("provider-error:") || record.provider !== "openai_responses") {
    throw new Error(`Persisted provider error record identity is malformed: ${JSON.stringify(record)}`);
  }

  const rawStore = await readFile(join(tempHome, "desktop", "provider-error-analytics.json"), "utf8");
  if (rawStore.includes("metadata") || rawStore.includes("do-not-store") || rawStore.includes("rawPayload")) {
    throw new Error("Provider error analytics store leaked raw provider payload details.");
  }
  if (!rawStore.includes('"version": 1') || !rawStore.includes('"rate_limit_exceeded"')) {
    throw new Error(`Provider error analytics store omitted version or code evidence:\n${rawStore}`);
  }
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

console.log("Provider error analytics verification passed.");
