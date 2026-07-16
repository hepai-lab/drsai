import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-runtime-client-"));
const bundle = join(temp, "runtimeClient.mjs");
await build({ entryPoints: [join(root, "src/main/runtimeClient.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", external: ["electron"] });
const { LocalRuntimeClient, RemoteRuntimeClient, RuntimeProtocolCompatibilityError } = await import(pathToFileURL(bundle).href);

const localFixture = await startFixture(false);
const remoteFixture = await startFixture(true);
try {
  const local = LocalRuntimeClient.forAccess(localFixture.baseUrl);
  const remote = new RemoteRuntimeClient(remoteFixture.baseUrl, "temporary-runtime-token");
  await verifySameContract(local, "local");
  await verifySameContract(remote, "remote");

  remoteFixture.state.protocol = 2;
  await assertRejects(() => remote.getCapabilities(), (error) => error instanceof RuntimeProtocolCompatibilityError, "Incompatible Runtime protocol was accepted");
  remoteFixture.state.protocol = 1;

  remoteFixture.state.structuredFailure = true;
  await assertRejects(
    () => remote.listSessions("workspace-fixture"),
    (error) => error.code === "fixture_failure" && error.correlationId === "fixture-correlation" && error.retryable === true,
    "Structured Runtime error fields were not preserved",
  );
  remoteFixture.state.structuredFailure = false;

  const localRequestsBefore = localFixture.state.requests;
  await remoteFixture.close();
  await assertRejects(() => remote.getRuntime(), () => true, "Unavailable Remote Runtime unexpectedly succeeded");
  assert(localFixture.state.requests === localRequestsBefore, "Remote failure silently fell back to Local Runtime");
  console.log("Local/Remote Runtime Client integration verification passed.");
} finally {
  await localFixture.close();
  await remoteFixture.close();
  rmSync(temp, { recursive: true, force: true });
}

async function verifySameContract(client, location) {
  const identity = await client.getRuntime();
  const capabilities = await client.getCapabilities();
  const workspace = await client.openWorkspace(`/fixture/${location}`);
  const listed = await client.listWorkspaces();
  const sessions = await client.listSessions(workspace.workspace_id);
  const formalSession = await client.createSession(workspace.workspace_id, `Codex ${location}`);
  const formalRun = await client.createAgentRun(formalSession.session_id, "codex@1", `formal-${location}`);
  const formalResult = await client.executeAgentRun(formalRun.run_id, "formal run");
  const formalEvents = await client.listAgentRunEvents(formalRun.run_id);
  await client.respondAgentApproval(formalRun.run_id, "approval-fixture", "accept");
  const cancelled = await client.cancelAgentRun(formalRun.run_id);
  const account = await client.getBackendAccount("codex", true);
  const login = await client.startBackendLogin("codex", "chatgptDeviceCode");
  await client.cancelBackendLogin("codex", login.loginId);
  await client.logoutBackend("codex");
  const run = await client.createRun({ model: "fixture", messages: [{ role: "user", content: "run" }], workspace_id: workspace.workspace_id, thread_id: `session-${location}`, stream: true });
  const streamText = new TextDecoder().decode(await new Response(run.events).arrayBuffer());
  assert(client.location === location && identity.protocol_version === 1, `${location} identity failed`);
  assert(capabilities.capability_versions.files === 1, `${location} capabilities failed`);
  assert(listed.some((item) => item.workspace_id === workspace.workspace_id), `${location} Workspace list failed`);
  assert(sessions.object === "list" && streamText.includes("run.completed"), `${location} Session/Run contract failed`);
  assert(formalResult.run.backend_id === "codex" && formalEvents[0].type === "agent.message.delta" && cancelled.status === "cancelled", `${location} formal Agent Backend contract failed`);
  assert(account.auth_mode === "chatgpt" && login.loginId === "login-fixture", `${location} Backend account contract failed`);
  await client.closeWorkspace(workspace.workspace_id);
}

async function startFixture(requireToken) {
  const state = { requests: 0, protocol: 1, structuredFailure: false, workspaces: new Map(), sessions: new Map(), runs: new Map() };
  const server = createServer(async (request, response) => {
    state.requests += 1;
    if (requireToken && request.headers["x-opendrsai-gateway-token"] !== "temporary-runtime-token") return json(response, 401, { error: { code: "unauthorized", message: "Unauthorized", retryable: false } });
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/v1/runtime") return json(response, 200, { runtime_id: "runtime-fixture", instance_id: "instance-fixture", version: "fixture", protocol_version: state.protocol, platform: process.platform });
    if (url.pathname === "/v1/capabilities") return json(response, 200, { protocol_version: state.protocol, capabilities: ["files"], capability_versions: { files: 1 } });
    if (url.pathname === "/v1/agent-backends/codex/account" && request.method === "GET") return json(response, 200, { logged_in: true, auth_mode: "chatgpt", email: "fixture@example.test", plan_type: "test", credential_source: null, requires_openai_auth: true });
    if (url.pathname === "/v1/agent-backends/codex/account/login" && request.method === "POST") return json(response, 200, { type: "chatgptDeviceCode", loginId: "login-fixture", verificationUrl: "https://example.test", userCode: "ABCD" });
    if (url.pathname === "/v1/agent-backends/codex/account/login/cancel" && request.method === "POST") return json(response, 200, { cancelled: true });
    if (url.pathname === "/v1/agent-backends/codex/account/logout" && request.method === "POST") return json(response, 200, { logged_out: true });
    if (url.pathname === "/v1/workspaces" && request.method === "POST") {
      const body = JSON.parse(await bodyText(request)); const id = `workspace-${state.workspaces.size + 1}`;
      const workspace = { workspace_id: id, path: body.path, created_at: new Date().toISOString(), last_opened_at: new Date().toISOString(), open: true };
      state.workspaces.set(id, workspace); return json(response, 200, workspace);
    }
    if (url.pathname === "/v1/workspaces" && request.method === "GET") return json(response, 200, { data: [...state.workspaces.values()] });
    if (/^\/v1\/workspaces\/[^/]+$/.test(url.pathname) && request.method === "DELETE") { const id = url.pathname.split("/").at(-1); const workspace = state.workspaces.get(id); workspace.open = false; return json(response, 200, workspace); }
    if (url.pathname === "/v1/threads") {
      if (state.structuredFailure) return json(response, 503, { error: { code: "fixture_failure", message: "Fixture failure", correlation_id: "fixture-correlation", retryable: true } }, { "X-Correlation-ID": "fixture-correlation" });
      return json(response, 200, { object: "list", data: [], total: 0 });
    }
    if (url.pathname === "/v1/sessions" && request.method === "POST") {
      const body = JSON.parse(await bodyText(request)); const value = { session_id: `session-${state.sessions.size + 1}`, workspace_id: body.workspace_id, title: body.title };
      state.sessions.set(value.session_id, value); return json(response, 200, value);
    }
    if (/^\/v1\/sessions\/[^/]+\/runs$/.test(url.pathname) && request.method === "POST") {
      const body = JSON.parse(await bodyText(request)); const sessionId = url.pathname.split("/")[3]; const session = state.sessions.get(sessionId);
      const value = { run_id: `run-${state.runs.size + 1}`, session_id: sessionId, workspace_id: session.workspace_id, backend_id: body.agent_definition.split("@")[0], status: "queued" };
      state.runs.set(value.run_id, value); return json(response, 201, value);
    }
    if (/^\/v1\/runs\/[^/]+\/execute$/.test(url.pathname) && request.method === "POST") { const id = url.pathname.split("/")[3]; const run = state.runs.get(id); run.status = "completed"; return json(response, 200, { run, result: { content: "fixture" } }); }
    if (/^\/v1\/runs\/[^/]+\/events$/.test(url.pathname) && request.method === "GET") { const id = url.pathname.split("/")[3]; return json(response, 200, { data: [{ event_id: "event-1", run_id: id, sequence: 1, type: "agent.message.delta", data: { content: "fixture" } }] }); }
    if (/^\/v1\/runs\/[^/]+\/approvals\/[^/]+\/decision$/.test(url.pathname) && request.method === "POST") return json(response, 200, { decision: "accept" });
    if (/^\/v1\/runs\/[^/]+\/cancel$/.test(url.pathname) && request.method === "POST") { const id = url.pathname.split("/")[3]; const run = state.runs.get(id); run.status = "cancelled"; return json(response, 200, run); }
    if (url.pathname === "/v1/chat/completions") { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end("event: run.completed\ndata: {}\n\n"); return; }
    return json(response, 404, { error: { code: "not_found", message: "Not found", retryable: false } });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  let closed = false;
  return { state, baseUrl: `http://127.0.0.1:${address.port}`, close: () => closed ? Promise.resolve() : new Promise((resolveClose) => { closed = true; server.close(resolveClose); }) };
}

function json(response, status, value, headers = {}) { response.writeHead(status, { "Content-Type": "application/json", ...headers }); response.end(JSON.stringify(value)); }
function bodyText(request) { return new Promise((resolveBody) => { let value = ""; request.on("data", (chunk) => value += chunk); request.on("end", () => resolveBody(value)); }); }
async function assertRejects(operation, predicate, message) { try { await operation(); } catch (error) { if (predicate(error)) return; throw error; } throw new Error(message); }
function assert(value, message) { if (!value) throw new Error(message); }
