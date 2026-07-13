import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_AGENT_RUN_PORT || "18646");
const baseUrl = `http://127.0.0.1:${port}`;
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E agent run smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-agent-run.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-agent-run-"));
const appHome = join(tempDir, "drsai-home");
const workspacePath = join(tempDir, "workspace");
const resultPath = join(tempDir, "result.json");
mkdirSync(appHome, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
writeFileSync(join(workspacePath, "user-work.txt"), "user work before agent\n", "utf8");

let server = null;
let requestBody = null;
let requestCount = 0;
const gatewayRequests = [];

try {
  await assertPortFree();
  server = await startGateway(workspacePath);
  await runPackagedApp({ appHome, resultPath, workspacePath });
  if (!existsSync(resultPath)) {
    throw new Error("E2E agent run did not write a smoke result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(`E2E agent run failed:\n${JSON.stringify(result, null, 2)}`);
  }
  assertAgentRunDiagnostics(result);
  if (readFileSync(join(workspacePath, "user-work.txt"), "utf8") !== "user work before agent\n") {
    throw new Error("Agent change rejection did not restore the user's pre-run file content.");
  }
  if (existsSync(join(workspacePath, "agent-created.txt"))) {
    throw new Error("Agent change rejection did not remove a file created during the run.");
  }
  console.log("E2E agent run passed with packaged Electron + fake gateway.");
} finally {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  cleanupTempDir(tempDir);
}
process.exit(process.exitCode ?? 0);

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(`Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-agent-run.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function startGateway(workspacePath) {
  const serverInstance = createServer(async (req, res) => {
    gatewayRequests.push(`${req.method || "GET"} ${req.url || "/"}`);
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
        requestBody = body;
        requestCount += 1;
        writeFileSync(join(workspacePath, "user-work.txt"), "user work before agent\nagent change\n", "utf8");
        writeFileSync(join(workspacePath, "agent-created.txt"), "created by agent\n", "utf8");
      } catch (error) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: {"error":{"message":${JSON.stringify(error instanceof Error ? error.message : String(error))}}}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Drsai-Session-Id": body?.thread_id || "e2e-agent-run-thread",
      });
      res.write('data: {"choices":[{"delta":{"content":"fake-agent-run: write a short plan"},"index":0}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  return new Promise((resolveListen, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(port, "127.0.0.1", () => resolveListen(serverInstance));
  });
}

function assertAgentRunBody(body, threadId) {
  if (typeof body?.model !== "string" || !body.model.trim()) throw new Error("agent run model missing");
  if (body?.thread_id !== threadId) throw new Error("agent run thread id mismatch");
  if (body?.work_dir !== workspacePath) throw new Error("agent run workspace mismatch");
  if (body?.messages?.[0]?.role !== "user") throw new Error("agent run message role mismatch");
  if (body?.messages?.[0]?.content !== "write a short plan") throw new Error("agent run task mismatch");
  if (body?.metadata?.source !== "e2e-agent-run") throw new Error("agent run metadata source mismatch");
  if (body?.metadata?.desktop_request_id !== "e2e-agent-run-request-0001") throw new Error("agent run desktop request id mismatch");
  if (body?.metadata?.run_id !== "e2e-agent-run-run-0001") throw new Error("agent run run id mismatch");
  if (body?.metadata?.desktop_request_id === body?.metadata?.run_id) throw new Error("agent run request id collapsed into run id");
  if (body?.thread_id === body?.metadata?.desktop_request_id || body?.thread_id === body?.metadata?.run_id) {
    throw new Error("agent run thread id collapsed into request/run id");
  }
  if (body?.metadata?.team_config?.preset !== "general-collaboration") throw new Error("agent run team config mismatch");
  const files = body?.metadata?.files;
  if (!Array.isArray(files) || files.length !== 1) throw new Error("agent run files metadata missing");
  if (files[0]?.kind !== "file" || files[0]?.path !== "C:\\OpenDrSai\\fixtures\\notes.md" || files[0]?.name !== "notes.md") {
    throw new Error("agent run file metadata mismatch");
  }
}

function assertAgentRunDiagnostics(result) {
  const threadId = result?.details?.thread?.id;
  if (typeof threadId !== "string" || !threadId.startsWith("thread-")) {
    throw new Error(`E2E agent run did not create a real thread:\n${JSON.stringify(result, null, 2)}`);
  }
  if (result?.details?.thread?.kind !== "agent_run") {
    throw new Error(`E2E agent run did not create an agent_run thread:\n${JSON.stringify(result?.details?.thread, null, 2)}`);
  }
  if (requestCount !== 1 || !requestBody) {
    throw new Error(`E2E agent run expected exactly one gateway request, got ${requestCount}.`);
  }
  assertAgentRunBody(requestBody, threadId);
  const summary = result?.details?.agentRunSummary;
  if (!summary || summary.firstEventType !== "start" || summary.terminalEventType !== "done" || summary.lastEventType !== "done") {
    throw new Error(`E2E agent run did not record a completed event summary:\n${JSON.stringify(result, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`E2E agent run durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = result?.details?.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`E2E agent run events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`E2E agent run event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
  if (!events.every((event) => !event.sessionId || event.sessionId === threadId)) {
    throw new Error(`E2E agent run events did not use the created thread id:\n${JSON.stringify(events, null, 2)}`);
  }
  if (!events.every((event) => !event.runId || event.runId === "e2e-agent-run-run-0001")) {
    throw new Error(`E2E agent run events did not use the requested run id:\n${JSON.stringify(events, null, 2)}`);
  }
  if (!result?.checks?.startAgentRunReturned || !result?.checks?.agentRunDistinctIds || !result?.checks?.agentRunThreadEvents) {
    throw new Error(`E2E agent run did not prove distinct thread/request/run ids:\n${JSON.stringify(result, null, 2)}`);
  }
}

function runPackagedApp({ appHome, resultPath, workspacePath }) {
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
        OPENDRSAI_E2E_AGENT_RUN: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_WORKSPACE_PATH: workspacePath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
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
      reject(new Error(`E2E agent run timed out.\n${stdout}\n${stderr}`));
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
      reject(new Error(`Packaged app exited with code ${code}. Gateway requests: ${gatewayRequests.join(", ") || "none"}.${result}\n${stdout}\n${stderr}`));
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
