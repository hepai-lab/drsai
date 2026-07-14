import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(join(root, "src/main/platformAgentClient.ts"), "utf8");
const agentsSource = readFileSync(join(root, "src/main/agents.ts"), "utf8");
const authSource = readFileSync(join(root, "src/main/auth.ts"), "utf8");
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/platform-agent-catalog.v1.json"), "utf8"));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fetchPlatformAgents } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function response(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-opendrsai-api-version": "native-v1" },
  });
}

function harness(responses, { refreshFails = false } = {}) {
  const calls = [];
  let refreshes = 0;
  let invalidations = 0;
  return {
    calls,
    get refreshes() { return refreshes; },
    get invalidations() { return invalidations; },
    options: {
      baseUrl: "https://ai-dev.ihep.ac.cn",
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        calls.push({ url, authorization: init.headers.Authorization });
        const next = responses.shift();
        if (!next) throw new Error("unexpected extra request");
        return next;
      },
      auth: {
        getAccessToken: async () => "access-token-1",
        refreshAfterUnauthorized: async () => {
          refreshes += 1;
          if (refreshFails) throw new Error("fixture refresh failure");
          return "access-token-2";
        },
        invalidate: () => { invalidations += 1; },
      },
    },
  };
}

{
  const test = harness([response(200, fixture)]);
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "ready");
  assert.equal(result.status.apiVersion, "native-v1");
  assert.deepEqual(result.status.capabilities, ["agents", "agent-details"]);
  assert.equal(result.agents[0].id, "platform:fixture-ddf-1");
  assert.equal(result.agents[0].mode, "ddf");
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false");
  assert.equal(test.calls[0].authorization, "Bearer access-token-1");
  const publicPayload = JSON.stringify(result);
  assert(!publicPayload.includes("MUST_NOT_REACH_RENDERER"));
  assert(!publicPayload.includes("private.invalid"));
}

{
  const test = harness([response(401), response(200, fixture)]);
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "ready");
  assert.equal(test.refreshes, 1);
  assert.equal(test.calls.length, 2);
  assert.equal(test.calls[1].authorization, "Bearer access-token-2");
}

{
  const test = harness([response(401)], { refreshFails: true });
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "requires_login");
  assert.equal(test.refreshes, 1);
  assert.equal(test.calls.length, 1);
  assert.equal(test.invalidations, 1);
}

{
  const test = harness([response(401), response(401)]);
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "requires_login");
  assert.equal(test.refreshes, 1);
  assert.equal(test.calls.length, 2);
  assert.equal(test.invalidations, 1);
}

{
  const test = harness([response(404)]);
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "native_api_unavailable");
  assert.equal(test.refreshes, 0);
  assert.match(result.status.message, /not deployed/i);
}

{
  const test = harness([response(403)]);
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.status.state, "forbidden");
  assert.equal(test.refreshes, 0);
  assert.match(result.status.message, /cannot access/i);
}

assert(!agentsSource.includes("HEPAI_API_KEY"), "platform catalog must not use HEPAI_API_KEY");
assert(agentsSource.includes("requireAuthContext()"), "platform catalog must use the Main-process OIDC session");
assert(authSource.includes("refreshAuthContextAfterUnauthorized"), "strict post-401 refresh entrypoint is missing");
assert(!source.includes("console."), "platform client must not log tokens or request payloads");

console.log("Agent square A1/A2/A3 contract verification passed (OIDC primary path, one 401 retry, capability fallback, public DTO redaction).");
