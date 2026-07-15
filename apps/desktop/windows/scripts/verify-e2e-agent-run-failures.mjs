import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURE_PORT || "18647");
const baseUrl = `http://127.0.0.1:${port}`;
const evidenceDir = join(root, "release", "product-evidence", "k4-failure-recovery");
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E agent run failure smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-agent-run-failures.");
}

const scenarios = process.argv.includes("--k4-only")
  ? ["network-exhausted", "external-service"]
  : ["abort", "sse-error", "timeout", "chunk-disconnect", "network-exhausted", "external-service"];
let requestAudit = [];

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log(`E2E agent run failure paths passed: ${scenarios.join(", ")}.`);

async function runScenario(scenario) {
  requestAudit = [];
  const tempDir = mkdtempSync(join(tmpdir(), `opendrsai-e2e-agent-${scenario}-`));
  const appHome = join(tempDir, "drsai-home");
  const resultPath = join(tempDir, "result.json");
  mkdirSync(appHome, { recursive: true });
  let server = null;

  try {
    await assertPortFree();
    server = await startScenarioGateway(scenario);
    await runPackagedApp({ appHome, resultPath, scenario });
    if (!existsSync(resultPath)) {
      throw new Error(`${scenario}: packaged app did not write an agent run smoke result.`);
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!result.ok) {
      throw new Error(`${scenario}: E2E agent run failure smoke failed:\n${JSON.stringify(result, null, 2)}`);
    }
    assertScenarioDiagnostics(scenario, result);
    assertThreadPersistence(scenario, result, appHome);
    if (["network-exhausted", "external-service"].includes(scenario)) {
      if (requestAudit.length < 3) throw new Error(`${scenario}: retry policy did not issue at least three attempts: ${requestAudit.length}`);
      const idempotencyKeys = new Set(requestAudit.map((entry) => entry.idempotencyKey));
      if (idempotencyKeys.size !== 1 || ![...idempotencyKeys][0]) {
        throw new Error(`${scenario}: retry attempts did not preserve a single idempotency key:\n${JSON.stringify(requestAudit, null, 2)}`);
      }
      const attemptNumbers = requestAudit.map((entry) => entry.retryAttempt);
      if (attemptNumbers.some((value, index) => value !== index)) {
        throw new Error(`${scenario}: retry attempt sequence is invalid: ${attemptNumbers.join(", ")}`);
      }
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, `${scenario}-result.json`), `${JSON.stringify({
        ok: true,
        scenario,
        result,
        requestAudit,
      }, null, 2)}\n`, "utf8");
    }
  } finally {
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertThreadPersistence(scenario, result, appHome) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    timeout: "timeout",
    "chunk-disconnect": "chunkDisconnect",
    "network-exhausted": "networkExhausted",
    "external-service": "externalService",
  }[scenario];
  const requestId = {
    abort: "e2e-agent-failure-abort",
    "sse-error": "e2e-agent-failure-error",
    timeout: "e2e-agent-failure-timeout",
    "chunk-disconnect": "e2e-agent-failure-disconnect",
    "network-exhausted": "e2e-agent-failure-network-exhausted",
    "external-service": "e2e-agent-failure-external-service",
  }[scenario];
  const summary = result?.details?.[detailKey];
  if (summary?.thread && (summary.thread.id !== requestId || summary.thread.status !== "error")) {
    throw new Error(`${scenario}: listThreads did not persist terminal agent thread status error:\n${JSON.stringify(summary, null, 2)}`);
  }
  const threadsPath = join(appHome, "desktop", "threads.json");
  if (!existsSync(threadsPath)) {
    throw new Error(`${scenario}: threads.json was not written.`);
  }
  const threads = JSON.parse(readFileSync(threadsPath, "utf8"));
  if (!Array.isArray(threads)) {
    throw new Error(`${scenario}: threads.json is not an array.`);
  }
  if (threads.some((thread) => thread.status === "running")) {
    throw new Error(`${scenario}: threads.json left a running agent thread:\n${JSON.stringify(threads, null, 2)}`);
  }
  const persisted = threads.find((thread) => thread.id === requestId);
  if (!persisted || persisted.status !== "error") {
    throw new Error(`${scenario}: threads.json did not persist ${requestId} as error:\n${JSON.stringify(threads, null, 2)}`);
  }
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-agent-run-failures.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function startScenarioGateway(scenario) {
  const openResponses = new Set();
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
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let body = null;
      try {
        body = await readJsonBody(req);
      } catch {
        body = null;
      }
      assertAgentRunFailureBody(scenario, body);
      requestAudit.push({
        idempotencyKey: String(req.headers["idempotency-key"] || ""),
        retryAttempt: Number(body?.metadata?.network_retry_attempt),
        resumeFromChars: Number(body?.metadata?.resume_from_chars),
      });
      if (scenario === "external-service") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "synthetic external service unavailable" }));
        return;
      }
      if (scenario === "network-exhausted") {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Drsai-Session-Id": `agent-failure-${scenario}`,
      });
      if (scenario === "abort") {
        openResponses.add(res);
        res.write('data: {"choices":[{"delta":{"content":"agent partial before abort"},"index":0}]}\n\n');
        req.on("close", () => openResponses.delete(res));
        res.on("close", () => openResponses.delete(res));
        return;
      }
      if (scenario === "sse-error") {
        res.write('data: {"error":{"message":"synthetic agent error"}}\n\n');
        res.end();
        return;
      }
      if (scenario === "timeout") {
        openResponses.add(res);
        res.write(": waiting for agent timeout\n\n");
        req.on("close", () => openResponses.delete(res));
        res.on("close", () => openResponses.delete(res));
        return;
      }
      if (scenario === "chunk-disconnect") {
        res.write('data: {"choices":[{"delta":{"content":"agent partial before disconnect"},"index":0}]}\n\n');
        res.end();
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  server.on("close", () => {
    for (const response of openResponses) response.destroy();
    openResponses.clear();
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

function assertAgentRunFailureBody(scenario, body) {
  if (body?.metadata?.source !== "e2e-agent-run-failures") throw new Error(`${scenario}: source metadata mismatch`);
  if (body?.metadata?.team_config?.preset !== "general-collaboration") throw new Error(`${scenario}: team config mismatch`);
  if (body?.thread_id !== body?.metadata?.desktop_request_id) throw new Error(`${scenario}: thread/request id mismatch`);
  if (body?.messages?.[0]?.role !== "user") throw new Error(`${scenario}: user message missing`);
}

function assertScenarioDiagnostics(scenario, result) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    timeout: "timeout",
    "chunk-disconnect": "chunkDisconnect",
    "network-exhausted": "networkExhausted",
    "external-service": "externalService",
  }[scenario];
  const expectedTerminal = {
    abort: "aborted",
    "sse-error": "error",
    timeout: "error",
    "chunk-disconnect": "error",
    "network-exhausted": "error",
    "external-service": "error",
  }[scenario];
  const summary = detailKey ? result?.details?.[detailKey] : null;
  if (!summary || summary.firstEventType !== "start" || summary.terminalEventType !== expectedTerminal) {
    throw new Error(`${scenario}: E2E agent run failure smoke did not record the expected terminal summary:\n${JSON.stringify(result, null, 2)}`);
  }
  if (summary.lastEventType !== summary.terminalEventType) {
    throw new Error(`${scenario}: last event and terminal event diverged:\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`${scenario}: durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = summary.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`${scenario}: events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  if (
    scenario === "chunk-disconnect" &&
    !events.some((event) => event.type === "error" && String(event.error || "").includes("ended before data: [DONE]"))
  ) {
    throw new Error(`${scenario}: missing agent stream disconnect error:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`${scenario}: event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
}

function runPackagedApp({ appHome, resultPath, scenario }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(exePath, [], {
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
        OPENDRSAI_E2E_AGENT_RUN_FAILURES: "1",
        OPENDRSAI_E2E_AGENT_RUN_FAILURE_SCENARIO: scenario,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
        OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS: ["network-exhausted", "external-service"].includes(scenario) ? "1400" : "180000",
        OPENDRSAI_AGENT_RUN_TIMEOUT_MS: ["network-exhausted", "external-service"].includes(scenario) ? "12000" : "1000",
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
      reject(new Error(`${scenario}: E2E agent run failure timed out.\n${stdout}\n${stderr}`));
    }, 60_000);
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
      if (code === 0) {
        resolveRun();
        return;
      }
      const result = existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : "";
      reject(new Error(`${scenario}: packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
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
        resolveBody(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
