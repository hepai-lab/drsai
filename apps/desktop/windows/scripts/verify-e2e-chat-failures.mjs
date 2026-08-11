import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_CHAT_FAILURE_PORT || "18644");
const baseUrl = `http://127.0.0.1:${port}`;
const ATTACHMENT_SENTINEL = "E2E_TEXT_ATTACHMENT_SENTINEL";
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E chat failure smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-chat-failures.");
}

const allScenarios = ["abort", "sse-error", "gateway-unreachable", "timeout", "empty-done", "chunk-disconnect", "attachments"];
const requestedScenarios = String(process.env.OPENDRSAI_E2E_SCENARIOS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const unknownScenarios = requestedScenarios.filter((scenario) => !allScenarios.includes(scenario));
if (unknownScenarios.length > 0) {
  throw new Error(`Unknown E2E chat failure scenario(s): ${unknownScenarios.join(", ")}`);
}
const scenarios = requestedScenarios.length > 0 ? requestedScenarios : allScenarios;

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log(`E2E chat failure paths passed: ${scenarios.join(", ")}.`);

async function runScenario(scenario) {
  const tempDir = mkdtempSync(join(tmpdir(), `opendrsai-e2e-${scenario}-`));
  const appHome = join(tempDir, "drsai-home");
  const resultPath = join(tempDir, "result.json");
  const attachmentFixture = scenario === "attachments" ? createAttachmentFixture(tempDir) : null;
  mkdirSync(appHome, { recursive: true });
  let server = null;

  try {
    await assertPortFree();
    if (scenario !== "gateway-unreachable") {
      server = await startScenarioGateway(scenario, attachmentFixture);
    }
    await runPackagedApp({ appHome, resultPath, scenario, attachmentFixture });
    if (!existsSync(resultPath)) {
      throw new Error(`${scenario}: packaged app did not write a smoke result.`);
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!result.ok && !hasOnlyStaleGatewayHealth(result)) {
      throw new Error(`${scenario}: E2E failure smoke failed:\n${JSON.stringify(result, null, 2)}`);
    }
    assertScenarioDiagnostics(scenario, result);
    assertThreadPersistence(scenario, result, appHome);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    cleanupTempDir(tempDir);
  }
}

function hasOnlyStaleGatewayHealth(result) {
  const checks = result?.checks;
  return Boolean(checks) && Object.entries(checks).every(
    ([name, passed]) => name === "gatewayReady" || passed === true,
  );
}

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    throw new Error(
      `Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function assertThreadPersistence(scenario, result, appHome) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    "gateway-unreachable": "gatewayUnreachable",
    timeout: "timeout",
    "empty-done": "emptyDone",
    "chunk-disconnect": "chunkDisconnect",
    attachments: "attachments",
  }[scenario];
  const requestId = {
    abort: "e2e-failure-abort",
    "sse-error": "e2e-failure-error",
    "gateway-unreachable": "e2e-failure-unreachable",
    timeout: "e2e-failure-timeout",
    "empty-done": "e2e-failure-empty-done",
    "chunk-disconnect": "e2e-failure-disconnect",
    attachments: "e2e-attachments",
  }[scenario];
  const expectedStatus = scenario === "abort" || scenario === "empty-done" || scenario === "attachments"
    ? "idle"
    : "error";
  const summary = result?.details?.[detailKey];
  if (summary?.thread && (summary.thread.id !== requestId || summary.thread.status !== expectedStatus)) {
    throw new Error(`${scenario}: listThreads did not persist terminal thread status ${expectedStatus}:\n${JSON.stringify(summary, null, 2)}`);
  }
  const threadsPath = join(appHome, "desktop", "threads.json");
  if (scenario === "gateway-unreachable") {
    if (!existsSync(threadsPath)) return;
    const threads = JSON.parse(readFileSync(threadsPath, "utf8"));
    if (!Array.isArray(threads) || threads.some((thread) => thread.id === requestId || thread.status === "running")) {
      throw new Error(`${scenario}: readiness failure unexpectedly persisted a running Chat thread:\n${JSON.stringify(threads, null, 2)}`);
    }
    return;
  }
  if (!existsSync(threadsPath)) {
    throw new Error(`${scenario}: threads.json was not written.`);
  }
  const threads = JSON.parse(readFileSync(threadsPath, "utf8"));
  if (!Array.isArray(threads)) {
    throw new Error(`${scenario}: threads.json is not an array.`);
  }
  if (threads.some((thread) => thread.status === "running")) {
    throw new Error(`${scenario}: threads.json left a running thread:\n${JSON.stringify(threads, null, 2)}`);
  }
  const persisted = threads.find((thread) => thread.id === requestId);
  if (!persisted || persisted.status !== expectedStatus) {
    throw new Error(`${scenario}: threads.json did not persist ${requestId} as ${expectedStatus}:\n${JSON.stringify(threads, null, 2)}`);
  }
}

function createAttachmentFixture(tempDir) {
  const fixtureRoot = join(tempDir, "fixtures");
  const folderPath = join(fixtureRoot, "project");
  const filePath = join(fixtureRoot, "notes.md");
  mkdirSync(folderPath, { recursive: true });
  writeFileSync(filePath, `# E2E Notes\n\n${ATTACHMENT_SENTINEL}\n\nUse this text as chat context.\n`, "utf8");
  return { workspacePath: fixtureRoot, filePath, folderPath };
}

function assertScenarioDiagnostics(scenario, result) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    "gateway-unreachable": "gatewayUnreachable",
    timeout: "timeout",
    "empty-done": "emptyDone",
    "chunk-disconnect": "chunkDisconnect",
    attachments: "attachments",
  }[scenario];
  const expectedTerminal = {
    abort: "aborted",
    "sse-error": "error",
    "gateway-unreachable": "error",
    timeout: "error",
    "empty-done": "done",
    "chunk-disconnect": "error",
    attachments: "done",
  }[scenario];
  const summary = detailKey ? result?.details?.[detailKey] : null;
  const expectedFirst = scenario === "gateway-unreachable" ? "error" : "start";
  if (!summary || summary.firstEventType !== expectedFirst || summary.terminalEventType !== expectedTerminal) {
    throw new Error(`${scenario}: E2E failure smoke did not record the expected terminal summary:\n${JSON.stringify(result, null, 2)}`);
  }
  const terminalIndex = summary.events.findIndex((event) => {
    if (["done", "error", "aborted"].includes(event.type)) return true;
    return event.type === "structured" && ["turn.completed", "turn.error", "turn.cancelled"].includes(event.structuredEvent?.type);
  });
  const trailingEvents = terminalIndex >= 0 ? summary.events.slice(terminalIndex + 1) : [];
  if (terminalIndex < 0 || !trailingEvents.every((event) => event.type === "connection")) {
    throw new Error(`${scenario}: terminal event was missing or followed by non-connection output:\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`${scenario}: durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = summary.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`${scenario}: events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`${scenario}: event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-chat-failures.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function startScenarioGateway(scenario, attachmentFixture) {
  const openResponses = new Set();
  const runtimeStreams = new Map();
  const runtimeSessions = new Map();
  const runSessions = new Map();
  let runtimeSessionSequence = 0;
  let eventSequence = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "drsai", object: "model" }] }));
      return;
    }
    if (req.url === "/v1/config/agents" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        current_agent: "opendrsai",
        agents: [{
          agent_name: "opendrsai",
          display_name: "OpenDrSai",
          current: true,
          schema_version: 2,
          config_file: "configs/agents/agent_opendrsai.toml",
        }],
      }));
      return;
    }
    if (req.url === "/v1/config/agents/opendrsai/models" && req.method === "GET") {
      const ref = { provider_id: "hepai", model_id: "deepseek-v4-pro" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        agent_id: "opendrsai",
        valid: true,
        error: null,
        primary_model: { mode: "explicit", ref },
        effective_ref: ref,
        revision: "sha256:e2e-chat-failure-agent-model-policy",
      }));
      return;
    }
    if (req.url === "/v1/runtime" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        runtime_id: `failure-runtime-${scenario}`,
        instance_id: `failure-runtime-instance-${scenario}`,
        version: "e2e",
        protocol_version: 1,
        platform: "win32",
      }));
      return;
    }
    if (req.url === "/v1/workspaces" && req.method === "POST") {
      const body = await readJsonBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        workspace_id: `failure-workspace-${scenario}`,
        path: body.path,
        display_name: body.display_name || "Failure workspace",
        open: true,
      }));
      return;
    }
    if (req.url === "/v1/sessions" && req.method === "POST") {
      const body = await readJsonBody(req);
      runtimeSessionSequence += 1;
      const sessionId = `failure-session-${scenario}-${runtimeSessionSequence}`;
      runtimeSessions.set(sessionId, body.workspace_id);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        session_id: sessionId,
        workspace_id: body.workspace_id,
        title: body.title || "Failure chat",
      }));
      return;
    }
    const snapshotMatch = req.url?.match(/^\/v1\/sessions\/([^/?]+)\/oaep-snapshot$/);
    if (snapshotMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(snapshotMatch[1]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0", session: { id: sessionId }, runs: [], items: [], snapshot_sequence: 0 }));
      return;
    }
    const eventListMatch = req.url?.match(/^\/v1\/sessions\/([^/?]+)\/oaep-events(?:\?.*)?$/);
    if (eventListMatch && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0", object: "list", data: [], next_sequence: eventSequence, has_more: false }));
      return;
    }
    const streamMatch = req.url?.match(/^\/v1\/sessions\/([^/?]+)\/oaep-events\/stream(?:\?.*)?$/);
    if (streamMatch && req.method === "GET") {
      const sessionId = decodeURIComponent(streamMatch[1]);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.flushHeaders();
      runtimeStreams.set(sessionId, res);
      openResponses.add(res);
      res.on("close", () => {
        openResponses.delete(res);
        if (runtimeStreams.get(sessionId) === res) runtimeStreams.delete(sessionId);
      });
      return;
    }
    const createRunMatch = req.url?.match(/^\/v1\/sessions\/([^/?]+)\/runs$/);
    if (createRunMatch && req.method === "POST") {
      const sessionId = decodeURIComponent(createRunMatch[1]);
      const runId = `failure-run-${scenario}-${runSessions.size + 1}`;
      runSessions.set(runId, sessionId);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        run_id: runId,
        session_id: sessionId,
        workspace_id: runtimeSessions.get(sessionId),
        backend_id: "opendrsai",
        status: "queued",
      }));
      return;
    }
    const executeRunMatch = req.url?.match(/^\/v1\/runs\/([^/?]+)\/execute$/);
    if (executeRunMatch && req.method === "POST") {
      const runId = decodeURIComponent(executeRunMatch[1]);
      const body = await readJsonBody(req);
      const sessionId = runSessions.get(runId);
      const stream = runtimeStreams.get(sessionId);
      const requestId = body?.metadata?.desktop_request_id || "";
      const emit = (type, data = {}, itemId) => {
        if (!stream || stream.destroyed) return;
        eventSequence += 1;
        stream.write(`data: ${JSON.stringify({
          version: "1.0",
          event_id: `failure-${scenario}-${eventSequence}`,
          dedupe_key: `failure-${scenario}-${eventSequence}`,
          session_id: sessionId,
          run_id: runId,
          ...(itemId ? { item_id: itemId } : {}),
          sequence: eventSequence,
          timestamp: new Date().toISOString(),
          type,
          source: { backend: "opendrsai", client: "runtime" },
          data,
        })}\n\n`);
      };
      const emitText = (text) => emit("event.item.delta", { delta: { kind: "message.text.append", text } }, "failure-message");
      const emitTerminal = (type, data = {}) => {
        emit(type, { run: { id: runId, status: type.slice("event.run.".length), created_at: new Date().toISOString(), completed_at: new Date().toISOString() }, ...data });
        if (stream && !stream.destroyed) stream.end();
      };
      if (scenario === "abort") {
        emitText("partial before abort");
      } else if (scenario === "sse-error") {
        emitTerminal("event.run.failed", { error: { code: "synthetic_gateway_error", message: "synthetic gateway error" } });
      } else if (scenario === "timeout") {
        // The desktop timeout cancels this Run; the cancel endpoint emits the terminal.
      } else if (scenario === "empty-done") {
        emitTerminal("event.run.completed");
      } else if (scenario === "chunk-disconnect") {
        emitText("partial before disconnect");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run: { run_id: runId, session_id: sessionId, status: "running" } }));
        setTimeout(() => {
          for (const response of openResponses) response.destroy();
          server.close();
        }, 25);
        return;
      } else if (scenario === "attachments") {
        const attachmentCount = assertAttachmentBody(body, attachmentFixture);
        if (attachmentCount === 2) {
          emitText("fake-agent attachments: 2");
          emitTerminal("event.run.completed");
        } else {
          emitTerminal("event.run.failed", { error: { code: "attachment_metadata_mismatch", message: `attachment metadata mismatch: ${attachmentCount}` } });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ run: { run_id: runId, session_id: sessionId, status: "running" }, result: { request_id: requestId } }));
      return;
    }
    const cancelRunMatch = req.url?.match(/^\/v1\/runs\/([^/?]+)\/cancel$/);
    if (cancelRunMatch && req.method === "POST") {
      const runId = decodeURIComponent(cancelRunMatch[1]);
      const sessionId = runSessions.get(runId);
      const stream = runtimeStreams.get(sessionId);
      if (stream && !stream.destroyed) {
        eventSequence += 1;
        const isTimeout = scenario === "timeout";
        stream.write(`data: ${JSON.stringify({
          version: "1.0",
          event_id: `failure-${scenario}-${eventSequence}`,
          dedupe_key: `failure-${scenario}-${eventSequence}`,
          session_id: sessionId,
          run_id: runId,
          sequence: eventSequence,
          timestamp: new Date().toISOString(),
          type: isTimeout ? "event.run.failed" : "event.run.cancelled",
          source: { backend: "opendrsai", client: "runtime" },
          data: isTimeout
            ? { error: { code: "chat_timeout", message: "Chat request timed out." } }
            : { reason: "cancelled_by_user" },
        })}\n\n`);
        stream.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ run_id: runId, session_id: sessionId, status: scenario === "timeout" ? "failed" : "cancelled" }));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let body = null;
      try {
        body = await readJsonBody(req);
      } catch {
        body = null;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Drsai-Session-Id": `failure-${scenario}`,
      });
      if (scenario === "abort") {
        openResponses.add(res);
        res.write('data: {"choices":[{"delta":{"content":"partial before abort"},"index":0}]}\n\n');
        req.on("close", () => openResponses.delete(res));
        res.on("close", () => openResponses.delete(res));
        return;
      }
      if (scenario === "sse-error") {
        res.write('data: {"error":{"message":"synthetic gateway error"}}\n\n');
        res.end();
        return;
      }
      if (scenario === "timeout") {
        openResponses.add(res);
        res.write(": waiting for timeout\n\n");
        req.on("close", () => openResponses.delete(res));
        res.on("close", () => openResponses.delete(res));
        return;
      }
      if (scenario === "empty-done") {
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (scenario === "chunk-disconnect") {
        res.write('data: {"choices":[{"delta":{"content":"partial before disconnect"},"index":0}]}\n\n');
        res.end();
        return;
      }
      if (scenario === "attachments") {
        const attachmentCount = assertAttachmentBody(body, attachmentFixture);
        if (attachmentCount === 2) {
          res.write('data: {"choices":[{"delta":{"content":"fake-agent attachments: 2"},"index":0}]}\n\n');
          res.write("data: [DONE]\n\n");
        } else {
          res.write(`data: {"error":{"message":"attachment metadata mismatch: ${attachmentCount}"}}\n\n`);
        }
        res.end();
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  server.on("close", () => {
    for (const response of openResponses) {
      response.destroy();
    }
    openResponses.clear();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 128_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function assertAttachmentBody(body, attachmentFixture) {
  if (!attachmentFixture) return -10;
  if (!body?.model_selection && (typeof body?.model !== "string" || !body.model.trim())) return -11;
  const resources = body?.metadata?.input_resources;
  const refs = body?.metadata?.attachment_refs;
  if (!Array.isArray(resources) || !Array.isArray(refs)) return -1;
  if (resources.length !== 2 || refs.length !== 2) return resources.length;
  const expected = [
    { kind: "file", reference: "notes.md", name: "notes.md" },
    { kind: "folder", reference: "project", name: "project" },
  ];
  const matches = expected.every((item, index) =>
    resources[index]?.protocol === "oaep.input/1" &&
    resources[index]?.kind === item.kind &&
    resources[index]?.reference === item.reference &&
    resources[index]?.name === item.name &&
    refs[index] === item.reference,
  );
  if (!matches) return -2;
  if (body?.metadata?.desktop_request_id !== "e2e-attachments") return -3;
  if (body?.metadata?.source_message_id !== "desktop:e2e-attachments") return -4;
  const context = body?.metadata?.attachment_context;
  if (!Array.isArray(context) || context.length !== 2) return -5;
  const fileContext = context.find((item) => item?.kind === "file");
  const folderContext = context.find((item) => item?.kind === "folder");
  if (!fileContext?.included || fileContext?.name !== "notes.md") return -6;
  if (!String(fileContext.content || "").includes(ATTACHMENT_SENTINEL)) return -7;
  if (!folderContext || folderContext.name !== "project") return -8;
  // Runtime receives the enriched last-user prompt plus protocol-neutral OAEP
  // resources; it no longer receives the legacy Gateway messages/files body.
  const userContent = String(body?.prompt || "");
  if (!userContent.includes("use attached files")) return -15;
  if (!userContent.includes(ATTACHMENT_SENTINEL)) return -13;
  if (!userContent.includes("notes.md")) return -14;
  if (!userContent.includes("The user attached the following local context.")) return -16;
  return resources.length;
}

function runPackagedApp({ appHome, resultPath, scenario, attachmentFixture }) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${join(appHome, "electron-user-data")}`], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: systemPath,
        DRSAI_HOME: appHome,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_CHAT_FAILURES: "1",
        OPENDRSAI_E2E_CHAT_FAILURE_SCENARIO: scenario,
        ...(attachmentFixture ? {
          OPENDRSAI_E2E_ATTACHMENT_FILE: attachmentFixture.filePath,
          OPENDRSAI_E2E_ATTACHMENT_FOLDER: attachmentFixture.folderPath,
          OPENDRSAI_E2E_ATTACHMENT_WORKSPACE: attachmentFixture.workspacePath,
        } : {}),
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "30000",
        OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS: scenario === "chunk-disconnect" ? "1400" : "180000",
        ...(scenario === "timeout" ? { OPENDRSAI_CHAT_TIMEOUT_MS: "1500" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`${scenario}: E2E failure smoke timed out.\n${stdout}\n${stderr}`));
    }, 45_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 || (existsSync(resultPath) && hasOnlyStaleGatewayHealth(JSON.parse(readFileSync(resultPath, "utf8"))))) {
        resolvePromise();
        return;
      }
      const result = existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : "";
      reject(new Error(`${scenario}: packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
