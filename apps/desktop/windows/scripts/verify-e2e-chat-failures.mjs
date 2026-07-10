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

const scenarios = ["abort", "sse-error", "gateway-unreachable", "timeout", "empty-done", "chunk-disconnect", "attachments"];

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log(`E2E chat failure paths passed: ${scenarios.join(", ")}.`);
process.exit(process.exitCode ?? 0);

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
    if (!result.ok) {
      throw new Error(`${scenario}: E2E failure smoke failed:\n${JSON.stringify(result, null, 2)}`);
    }
    assertScenarioDiagnostics(scenario, result);
    assertThreadPersistence(scenario, result, appHome);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    cleanupTempDir(tempDir);
  }
}

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(`Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
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
  const expectedStatus = scenario === "empty-done" || scenario === "attachments" ? "idle" : "error";
  const summary = result?.details?.[detailKey];
  if (summary?.thread && (summary.thread.id !== requestId || summary.thread.status !== expectedStatus)) {
    throw new Error(`${scenario}: listThreads did not persist terminal thread status ${expectedStatus}:\n${JSON.stringify(summary, null, 2)}`);
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
  return { filePath, folderPath };
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
  if (!summary || summary.firstEventType !== "start" || summary.terminalEventType !== expectedTerminal) {
    throw new Error(`${scenario}: E2E failure smoke did not record the expected terminal summary:\n${JSON.stringify(result, null, 2)}`);
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
  if (typeof body?.model !== "string" || !body.model.trim()) return -11;
  if (body?.stream !== true) return -12;
  const attachments = body?.metadata?.attachments;
  const files = body?.metadata?.files;
  if (!Array.isArray(attachments) || !Array.isArray(files)) return -1;
  if (attachments.length !== 2 || files.length !== 2) return attachments.length;
  const expected = [
    { kind: "file", path: attachmentFixture.filePath, name: "notes.md" },
    { kind: "folder", path: attachmentFixture.folderPath, name: "project" },
  ];
  const matches = expected.every((item, index) =>
    attachments[index]?.kind === item.kind &&
    attachments[index]?.path === item.path &&
    attachments[index]?.name === item.name &&
    files[index]?.kind === item.kind &&
    files[index]?.path === item.path &&
    files[index]?.name === item.name,
  );
  if (!matches) return -2;
  if (body?.metadata?.desktop_request_id !== "e2e-attachments") return -3;
  if (body?.thread_id !== "e2e-attachments") return -4;
  const context = body?.metadata?.attachment_context;
  if (!Array.isArray(context) || context.length !== 2) return -5;
  const fileContext = context.find((item) => item?.kind === "file");
  const folderContext = context.find((item) => item?.kind === "folder");
  if (!fileContext?.included || fileContext?.name !== "notes.md") return -6;
  if (!String(fileContext.content || "").includes(ATTACHMENT_SENTINEL)) return -7;
  if (!folderContext || folderContext.name !== "project") return -8;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 2) return -9;
  if (messages[0]?.role !== "system" || !String(messages[0]?.content || "").includes(ATTACHMENT_SENTINEL)) return -13;
  if (!String(messages[0]?.content || "").includes("notes.md")) return -14;
  if (!messages.some((message) => message?.role === "user" && message?.content === "use attached files")) return -15;
  return attachments.length;
}

function runPackagedApp({ appHome, resultPath, scenario, attachmentFixture }) {
  return new Promise((resolvePromise, reject) => {
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
        OPENDRSAI_E2E_CHAT_FAILURES: "1",
        OPENDRSAI_E2E_CHAT_FAILURE_SCENARIO: scenario,
        ...(attachmentFixture ? {
          OPENDRSAI_E2E_ATTACHMENT_FILE: attachmentFixture.filePath,
          OPENDRSAI_E2E_ATTACHMENT_FOLDER: attachmentFixture.folderPath,
        } : {}),
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "30000",
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
      if (code === 0) {
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
