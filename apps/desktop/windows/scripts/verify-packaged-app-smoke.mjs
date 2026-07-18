import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_PACKAGED_SMOKE_PORT || "18645");
const e2eTimeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "30000");
const processTimeoutMs = e2eTimeoutMs + 15_000;
const baseUrl = `127.0.0.1:${port}`;
const systemPath = [
  dirname(exePath),
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
  process.env.PATH || "",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("Packaged app smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:packaged.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-packaged-smoke-"));
const drsaiHome = join(tempDir, "drsai-home");
const electronUserData = join(tempDir, "electron-user-data");
const resultPath = join(tempDir, "result.json");
const envPath = join(drsaiHome, ".env");
mkdirSync(drsaiHome, { recursive: true });
mkdirSync(electronUserData, { recursive: true });

try {
  const fakeGateway = await startFakeGateway();
  await runPackagedApp();
  if (!existsSync(resultPath)) {
    throw new Error("Packaged app did not write a smoke result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(`Packaged app smoke failed:\n${JSON.stringify(result, null, 2)}`);
  }
  verifyNoEnvFile(result);
  console.log("Packaged app smoke passed with real main/preload/IPC.");
} finally {
  if (globalThis.__opendrsaiFakeGateway) {
    await new Promise((resolve) => globalThis.__opendrsaiFakeGateway.close(resolve));
  }
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(
      `Could not remove packaged smoke temp directory ${tempDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function startFakeGateway() {
  const terminals = new Map();
  const workspacePaths = new Map();
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
      return;
    }
    if (req.url === "/v1/workspaces" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const path = JSON.parse(body || "{}").path;
        const now = new Date().toISOString();
        const workspaceId = `packaged-smoke-${Buffer.from(String(path)).toString("base64url").slice(0, 48)}`;
        workspacePaths.set(workspaceId, path);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          workspace_id: workspaceId,
          path,
          created_at: now,
          last_opened_at: now,
          closed_at: null,
          open: true,
        }));
      });
      return;
    }
    if (/^\/v1\/workspaces\/[^/]+\/worktrees(?:\?.*)?$/.test(req.url || "") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ worktrees: [] }));
      return;
    }
    if (/^\/v1\/workspaces\/[^/]+\/events(?:\?.*)?$/.test(req.url || "") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ events: [], next_sequence: 0 }));
      return;
    }
    if (req.url === "/v1/owop" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const request = JSON.parse(body || "{}");
        const now = Date.now() / 1000;
        const makeTerminal = (id = `terminal-packaged-${terminals.size + 1}`) => ({
          terminal_id: id, runtime_id: "runtime-packaged-smoke", workspace_id: request.workspace_id,
          worktree_id: null, cwd: workspacePaths.get(request.workspace_id) || ".", argv: ["controlled-packaged-shell"], status: "running",
          generation: 1, pid: 4242, cols: 100, rows: 30, created_at: now, updated_at: now,
          exited_at: null, exit_code: null, exit_signal: null, last_sequence: 0, first_sequence: 1, journal_bytes: 0,
        });
        let result;
        if (request.operation === "pty.create") {
          const terminal = makeTerminal(); terminals.set(terminal.terminal_id, terminal); result = { terminal };
        } else if (request.operation === "pty.list") result = { terminals: [...terminals.values()] };
        else if (request.operation === "pty.attach") {
          const terminal = terminals.get(request.params?.pty_id) || makeTerminal(request.params?.pty_id);
          result = { lease_id: "terminal-lease-packaged", mode: request.params?.mode || "writer", expires_at: now + 30,
            terminal, snapshot_required: false, events: [], last_sequence: 0 };
        } else if (["pty.detach", "pty.kill", "pty.resize"].includes(request.operation)) {
          const terminal = terminals.get(request.params?.pty_id) || makeTerminal(request.params?.pty_id);
          if (request.operation === "pty.kill") terminal.status = "exited";
          result = { terminal };
        } else if (request.operation === "pty.write") {
          const terminal = terminals.get(request.params?.pty_id);
          const command = Buffer.from(String(request.params?.content_base64 || ""), "base64").toString("utf8");
          const append = command.match(/echo\s+(.+?)>>\s*([^\r\n]+)/i);
          if (terminal && append) {
            appendFileSync(join(terminal.cwd, append[2].trim()), `${append[1]}\n`, "utf8");
          }
          result = { accepted_bytes: Buffer.byteLength(command) };
        }
        else result = {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  globalThis.__opendrsaiFakeGateway = server;
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      reject(new Error(`Could not start fake gateway on ${baseUrl} for packaged smoke: ${error.message}`));
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function verifyNoEnvFile(result) {
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    writeFileSync(join(tempDir, "unexpected-env.txt"), envContent, "utf8");
    throw new Error(`Packaged app unexpectedly exposed API-key configuration.\n${JSON.stringify(result, null, 2)}`);
  }
}

function runPackagedApp() {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [
      `--user-data-dir=${electronUserData}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--in-process-gpu",
    ], {
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
        DRSAI_HOME: drsaiHome,
        OPENDRSAI_GATEWAY_PORT: String(port),
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_E2E_SMOKE: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: String(e2eTimeoutMs),
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
      reject(new Error(`Packaged app smoke timed out.\n${stdout}\n${stderr}`));
    }, processTimeoutMs);
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
      const result = existsSync(resultPath)
        ? `\n${readFileSync(resultPath, "utf8")}`
        : "";
      reject(new Error(`Packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
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
