import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_THREADS_PORT || "18648");
const baseUrl = `http://127.0.0.1:${port}`;
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E threads smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-threads.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-threads-"));
const appHome = join(tempDir, "drsai-home");
const createResultPath = join(tempDir, "result-create.json");
const listResultPath = join(tempDir, "result-list.json");
const threadsJsonPath = join(appHome, "desktop", "threads.json");
mkdirSync(appHome, { recursive: true });

const requests = [];
let server = null;

try {
  await assertPortFree();
  server = await startGateway();
  await runPackagedApp({ appHome, resultPath: createResultPath, phase: "create" });
  const createResult = readResult(createResultPath, "create");
  assertCreatePhase(createResult);
  assertGatewayRequests(requests, createResult.details.created.id);
  assertThreadsJson(createResult.details.created.id);

  await runPackagedApp({
    appHome,
    resultPath: listResultPath,
    phase: "list",
    threadId: createResult.details.created.id,
  });
  const listResult = readResult(listResultPath, "list");
  assertListPhase(listResult, createResult.details.created.id);
  console.log("E2E threads passed with restart persistence and stable gateway thread_id.");
} finally {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tempDir, { recursive: true, force: true });
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-threads.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function startGateway() {
  const serverInstance = createServer(async (req, res) => {
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
      const body = await readJsonBody(req);
      requests.push(body);
      const content = body?.messages?.at(-1)?.content || "thread message";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: {"choices":[{"delta":{"content":"fake-thread: ${escapeJsonContent(content)}"},"index":0}]}\n\n`);
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

function assertCreatePhase(result) {
  if (!result.ok) throw new Error(`threads create phase failed:\n${JSON.stringify(result, null, 2)}`);
  const created = result.details?.created;
  if (!created || typeof created.id !== "string" || !created.id.startsWith("thread-")) {
    throw new Error(`threads create phase did not return a real thread:\n${JSON.stringify(result, null, 2)}`);
  }
  if (!result.checks?.createdThread || !result.checks?.firstDone || !result.checks?.secondDone || !result.checks?.sameThreadEvents || !result.checks?.distinctRuns || !result.checks?.threadListed) {
    throw new Error(`threads create phase checks were incomplete:\n${JSON.stringify(result, null, 2)}`);
  }
}

function assertListPhase(result, threadId) {
  if (!result.ok) throw new Error(`threads list phase failed:\n${JSON.stringify(result, null, 2)}`);
  if (!result.checks?.threadPersisted || !result.checks?.sortedByUpdatedAt) {
    throw new Error(`threads list phase did not prove restart persistence:\n${JSON.stringify(result, null, 2)}`);
  }
  const matches = result.details?.threads?.filter((thread) => thread.id === threadId) || [];
  if (matches.length !== 1) {
    throw new Error(`threads list phase found duplicate/missing thread ids:\n${JSON.stringify(result.details?.threads, null, 2)}`);
  }
}

function assertGatewayRequests(bodies, threadId) {
  if (bodies.length !== 2) throw new Error(`expected exactly 2 gateway chat requests, got ${bodies.length}`);
  const [first, second] = bodies;
  if (first.thread_id !== threadId || second.thread_id !== threadId) {
    throw new Error(`gateway requests did not share thread_id:\n${JSON.stringify(bodies, null, 2)}`);
  }
  if (first.metadata?.desktop_request_id !== "e2e-thread-run-0001" || second.metadata?.desktop_request_id !== "e2e-thread-run-0002") {
    throw new Error(`gateway desktop_request_id did not track request ids:\n${JSON.stringify(bodies, null, 2)}`);
  }
  if (first.metadata?.run_id !== "e2e-thread-run-0001" || second.metadata?.run_id !== "e2e-thread-run-0002") {
    throw new Error(`gateway run_id did not track run ids:\n${JSON.stringify(bodies, null, 2)}`);
  }
  if (first.metadata?.desktop_request_id === first.thread_id || second.metadata?.desktop_request_id === second.thread_id) {
    throw new Error(`request id should not collapse into thread id:\n${JSON.stringify(bodies, null, 2)}`);
  }
}

function assertThreadsJson(threadId) {
  if (!existsSync(threadsJsonPath)) throw new Error("threads.json was not written.");
  const threads = JSON.parse(readFileSync(threadsJsonPath, "utf8"));
  const matches = threads.filter((thread) => thread.id === threadId);
  if (matches.length !== 1) throw new Error(`threads.json did not contain exactly one target thread:\n${JSON.stringify(threads, null, 2)}`);
  const thread = matches[0];
  if (thread.lastRequestId !== "e2e-thread-run-0002" || thread.lastRunId !== "e2e-thread-run-0002" || thread.status !== "idle") {
    throw new Error(`threads.json target thread metadata is stale:\n${JSON.stringify(thread, null, 2)}`);
  }
}

function readResult(path, phase) {
  if (!existsSync(path)) throw new Error(`${phase}: packaged app did not write a threads result.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function runPackagedApp({ appHome, resultPath, phase, threadId }) {
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
        OPENDRSAI_E2E_THREADS: "1",
        OPENDRSAI_E2E_THREADS_PHASE: phase,
        ...(threadId ? { OPENDRSAI_E2E_THREADS_ID: threadId } : {}),
        OPENDRSAI_E2E_RESULT: resultPath,
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
      reject(new Error(`E2E threads ${phase} phase timed out.\n${stdout}\n${stderr}`));
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
      reject(new Error(`E2E threads ${phase} phase exited with code ${code}.${result}\n${stdout}\n${stderr}`));
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

function escapeJsonContent(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
