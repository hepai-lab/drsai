import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const state = {
  chatRequests: 0,
  authorizedRequests: 0,
  inputResponses: [],
  stopRequests: 0,
  requestBodies: [],
  cancelledConnections: 0,
};

const server = createServer(async (request, response) => {
  if (request.url === "/input" && request.method === "POST") {
    state.inputResponses.push(JSON.parse(await readBody(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":true}');
    return;
  }
  if (request.url === "/stop" && request.method === "POST") {
    state.stopRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":true}');
    return;
  }
  if (request.url !== "/chat" || request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }
  state.chatRequests += 1;
  if (request.headers.authorization === "Bearer token-1") {
    response.writeHead(401, { "content-type": "application/json" });
    // The real Native auth response does not need to opt into retryability;
    // the desktop treats an explicit token_expired 401 as one safe refresh.
    response.end('{"detail":{"code":"token_expired","message":"expired"}}');
    return;
  }
  assert.equal(request.headers.authorization, "Bearer token-2");
  state.authorizedRequests += 1;
  const body = JSON.parse(await readBody(request));
  state.requestBodies.push(body);
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  request.on("close", () => { if (!response.writableEnded) state.cancelledConnections += 1; });
  response.write('data: {"choices":[{"delta":{"content":"cloud "}}]}\n\n');
  if (body.metadata?.cancel_test) return;
  response.write('event: agent.input_request\ndata: {"type":"input_request","input_type":"approval","prompt":"Continue?"}\n\n');
  await waitFor(() => state.inputResponses.length > 0, 3000);
  response.write('data: {"file_events":[{"action":"artifact","path":"result.txt","name":"result.txt"}]}\n\n');
  response.write('data: {"tool_event":{"id":"tool-1","kind":"tool_result","title":"Tool result","status":"completed","content":"ok"}}\n\n');
  response.write('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n');
  response.end('data: [DONE]\n\n');
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert(address && typeof address === "object");
globalThis.__agentCloudBase = `http://127.0.0.1:${address.port}`;

try {
  const output = await build({
    entryPoints: [resolve(root, "src/main/chat.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    plugins: [stubMainDependencies()],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`;
  const chat = await import(moduleUrl);
  const events = [];
  const webContents = {
    send(channel, event) {
      if (channel !== "desktop:chat-event") return;
      events.push(event);
      if (event.type === "input_request") {
        void chat.respondChatInput(event.requestId, { approved: true });
      }
    },
  };

  const requestId = "cloud-route-0001";
  chat.startChat(webContents, {
    requestId,
    agentId: "platform:test-agent",
    threadId: "thread-cloud-1",
    messages: [{ role: "user", content: "Use the cloud agent." }],
  });
  await waitFor(() => events.some((event) => event.type === "done"), 5000);
  assert.deepEqual(
    [...new Set(events.map((event) => event.type))],
    ["start", "chunk", "input_request", "tool_timeline", "done"],
  );
  assert.equal(state.chatRequests, 2, "platform chat must retry one HTTP 401 exactly once");
  assert.equal(state.authorizedRequests, 1);
  assert.deepEqual(state.inputResponses, [{ response: { approved: true } }]);
  assert.equal(state.requestBodies[0].thread_id, "thread-cloud-1");
  assert(!JSON.stringify(state.requestBodies[0]).includes("private-config-secret"));

  const cancelEvents = [];
  const cancelRequestId = "cloud-route-0002";
  chat.startChat({ send: (_channel, event) => cancelEvents.push(event) }, {
    requestId: cancelRequestId,
    agentId: "platform:test-agent",
    threadId: "thread-cloud-2",
    metadata: { cancel_test: true },
    messages: [{ role: "user", content: "Cancel this cloud run." }],
  });
  await waitFor(() => cancelEvents.some((event) => event.type === "chunk"), 3000);
  assert.equal(chat.abortChat(cancelRequestId), true);
  await waitFor(() => state.stopRequests === 1 && cancelEvents.some((event) => event.type === "aborted"), 3000);
  assert.equal(state.stopRequests, 1);
  assert(cancelEvents.some((event) => event.type === "aborted"));

  console.log("Agent cloud route E2E passed (explicit agentId, HTTP 401 refresh, SSE text/tool/file/input, continuation, stop and secret isolation).");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function stubMainDependencies() {
  const stubs = new Map([
    ["./auth", `
      export async function requireAuthContext(){ return { userId:"user-1", authMode:"oidc", accessToken:"token-1" }; }
      export async function refreshAuthContextAfterUnauthorized(){ return { userId:"user-1", authMode:"oidc", accessToken:"token-2" }; }
      export function invalidateAuthSession(){}
    `],
    ["./agents", `
      export function getPlatformAgentExecutionDescriptor(id){ return id === "platform:test-agent" ? { publicId:id, platformId:"test-agent", mode:"ddf", name:"Test Agent", available:true, privateConfig:"private-config-secret" } : null; }
      export function getPlatformAgentChatUrl(){ return globalThis.__agentCloudBase + "/chat"; }
      export function isPlatformAgentExecutionAvailable(){ return true; }
      export async function respondToPlatformChatInput(_agent,_thread,response){ const result=await fetch(globalThis.__agentCloudBase+"/input",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({response})}); return result.ok; }
      export async function stopPlatformChat(){ const result=await fetch(globalThis.__agentCloudBase+"/stop",{method:"POST"}); return result.ok; }
    `],
    ["./gateway", `export function getGatewayRequestHeaders(){return {}}; export async function startGateway(){throw new Error("platform chat must not start the local gateway")}`],
    ["./modelDefaults", `export function getDefaultModelAlias(){return "drsai";}`],
    ["./threads", `export async function upsertThreadFromRun(){return {};}`],
    ["./providerErrorAnalytics", `export async function persistProviderErrorAnalytics(){}`],
    ["./providerUsageAnalytics", `export async function persistProviderUsageAnalytics(){}`],
    ["./remoteWorkspace", `export function bindRemoteThread(){}; export function getRemoteGatewayAccess(){return null;}`],
    ["./agentTelemetry", `export function recordAgentTelemetry(){}`],
    ["./agentCircuitBreaker", `export function assertAgentCircuitAvailable(){}; export function recordAgentCircuitFailure(){}; export function recordAgentCircuitSuccess(){}`],
  ]);
  return {
    name: "agent-cloud-main-stubs",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\// }, (args) => {
        if (!args.importer.endsWith("chat.ts") || !stubs.has(args.path)) return null;
        return { path: args.path, namespace: "agent-cloud-stub" };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "agent-cloud-stub" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("Timed out waiting for agent cloud route E2E condition.");
}
