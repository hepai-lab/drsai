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
const { fetchPlatformAgents, stopPlatformAgentThread, respondPlatformAgentInput, respondDdfAgentInput } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
        calls.push({ url, authorization: init.headers.Authorization, idempotencyKey: init.headers["Idempotency-Key"], method: init.method, body: init.body });
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
  assert.deepEqual(result.executionDescriptors[0].capabilities, ["chat", "streaming"]);
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
  const test = harness([response(200)]);
  test.options.catalogBaseUrl = "https://ai-dev.ihep.ac.cn/apiv2";
  const result = await respondDdfAgentInput(test.options, {
    model: "drsai_v3_test",
    chatId: "chat-1",
    runId: "run-1",
    requestId: "input-1",
    response: { option_id: "mumu", value: "mumu" },
  });
  assert.equal(result.ok, true);
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/apiv2/agents/input");
  assert.equal(test.calls[0].authorization, "Bearer access-token-1");
  assert.equal(test.calls[0].idempotencyKey, "input-1");
  assert.equal(test.calls[0].body, JSON.stringify({
    model: "drsai_v3_test",
    chat_id: "chat-1",
    run_id: "run-1",
    request_id: "input-1",
    response: { option_id: "mumu", value: "mumu" },
  }));
}

{
  const test = harness([
    response(200, {
      data: [{
        id: "drsai_v3_test",
        owner: "zdzhang@ihep.ac.cn",
        examples: {
          zh: ["检查 BESIII 事例选择", "生成 BESIII 分析方案"],
          en: ["Review BESIII event selection", "Create a BESIII analysis plan"],
        },
      }],
    }),
  ]);
  test.options.catalogBaseUrl = "https://ai-dev.ihep.ac.cn/apiv2";
  test.options.refresh = true;
  const result = await fetchPlatformAgents(test.options);
  assert.equal(test.calls[0].url, "https://ai-dev.ihep.ac.cn/apiv2/agents/list_agents?refresh=true");
  assert.equal(test.calls.length, 1, "HAI discovery must not wait for a second Portal Native metadata request");
  assert.deepEqual(result.agents.map((agent) => agent.id), ["platform:drsai_v3_test"]);
  assert.deepEqual(result.agents[0].examples, [
    { zh: "检查 BESIII 事例选择", en: "Review BESIII event selection" },
    { zh: "生成 BESIII 分析方案", en: "Create a BESIII analysis plan" },
  ]);
  assert.deepEqual(result.status.capabilities, []);
}

{
  const test = harness([response(200, {
    agents: [
      { id: "trusted-logo", name: "Trusted", availability: "available", capabilities: ["chat", "streaming"], logo: "/assets/agent.png" },
      { id: "third-party-logo", name: "Third party", availability: "available", capabilities: ["chat", "streaming"], logo: "https://tracking.invalid/pixel.png" },
    ],
  })]);
  test.options.catalogBaseUrl = "https://ai-dev.ihep.ac.cn/apiv2";
  const result = await fetchPlatformAgents(test.options);
  assert.equal(result.agents[0].logo, "https://ai-dev.ihep.ac.cn/assets/agent.png");
  assert.equal(result.agents[1].logo, undefined, "untrusted third-party logo URLs must not reach the Renderer");
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

console.log("Agent square platform contract verification passed (OIDC, one 401 retry, one-request HAI discovery, safe DTO and DDF input routing).");
