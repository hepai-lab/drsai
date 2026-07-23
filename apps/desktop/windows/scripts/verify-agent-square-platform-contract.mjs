import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(join(root, "../shared/main/platformAgentClient.ts"), "utf8");
const agentsSource = readFileSync(join(root, "../shared/main/agents.ts"), "utf8");
const authSource = readFileSync(join(root, "../shared/main/auth.ts"), "utf8");
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/platform-agent-catalog.v1.json"), "utf8"));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { fetchPlatformAgents, setPlatformDefaultAgent, recordPlatformAgentUsage, stopPlatformAgentThread, respondPlatformAgentInput } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
        calls.push({ url, authorization: init.headers.Authorization, method: init.method, body: init.body });
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
  assert.equal(result.agents[0].available, true);
  assert.equal(result.executionDescriptors[0].platformId, "fixture-ddf-1");
  assert.equal(result.executionDescriptors[0].mode, "ddf");
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false");
  assert.equal(test.calls[0].authorization, "Bearer access-token-1");
  const publicPayload = JSON.stringify(result);
  assert(!publicPayload.includes("MUST_NOT_REACH_RENDERER"));
  assert(!publicPayload.includes("private.invalid"));
}

{
  const test = harness([response(200, {
    api_version: "1",
    capabilities: {
      catalog_version: "2026-07-14",
      refresh_supported: true,
      features: ["agent-catalog"],
    },
    agents: [
      { id: "hai.native.ddf", name: "Synthetic template", mode: "ddf", availability: "available" },
      {
        id: "real-ddf",
        name: "Real HAI agent",
        mode: "ddf",
        availability: "unavailable",
        description: JSON.stringify({ en: "English description", zh: "中文描述" }),
        capabilities: { streaming: true },
      },
      {
        id: "real-object-description",
        name: "Object description agent",
        mode: "custom",
        availability: "available",
        description: { en: "Object English", zh: "对象中文" },
      },
    ],
  })]);
  const result = await fetchPlatformAgents(test.options);
  assert.deepEqual(result.status.capabilities, ["agent-catalog"]);
  assert.deepEqual(result.agents.map((agent) => agent.id), ["platform:real-ddf", "platform:real-object-description"]);
  assert.equal(result.agents[0].available, false);
  assert.equal(result.agents[0].status, "unreachable");
  assert.deepEqual(result.agents[0].capabilities, ["streaming"]);
  assert.deepEqual(result.agents[0].localizedDescription, { en: "English description", zh: "中文描述" });
  assert.equal(result.agents[0].description, "English description");
  assert.deepEqual(result.agents[1].localizedDescription, { en: "Object English", zh: "对象中文" });
}

{
  const test = harness([response(401), response(200)]);
  const result = await setPlatformDefaultAgent(test.options, "owned-agent");
  assert.equal(result.ok, true);
  assert.equal(test.refreshes, 1);
  assert.equal(test.calls[0].method, "PUT");
  assert.equal(test.calls[0].body, JSON.stringify({ agent_id: "owned-agent" }));
  assert.equal(test.calls[1].authorization, "Bearer access-token-2");
}

{
  const test = harness([response(200)]);
  const result = await recordPlatformAgentUsage(test.options, "agent/with space");
  assert.equal(result.ok, true);
  assert.equal(test.calls[0].method, "POST");
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents/agent%2Fwith%20space/usage");
}

{
  const test = harness([response(200), response(200)]);
  assert.equal((await stopPlatformAgentThread(test.options, "agent/id", "thread:id")).ok, true);
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents/agent%2Fid/threads/thread%3Aid/stop");
  assert.equal((await respondPlatformAgentInput(test.options, "agent/id", "thread:id", { approved: true })).ok, true);
  assert.equal(test.calls[1].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents/agent%2Fid/threads/thread%3Aid/input");
  assert.equal(test.calls[1].body, JSON.stringify({ response: { approved: true } }));
}

{
  const test = harness([response(200, fixture)]);
  test.options.refresh = true;
  await fetchPlatformAgents(test.options);
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=true");
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

console.log("Agent square A1/A2/A3/E2 contract verification passed (OIDC primary path, one 401 retry, capability fallback, public DTO redaction, preference mutations).");
