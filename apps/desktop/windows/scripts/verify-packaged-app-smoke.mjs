import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  verifyEnvFile(result);
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

function verifyEnvFile(result) {
  if (!existsSync(envPath)) {
    throw new Error(`Packaged app smoke did not write ${envPath}.`);
  }
  const envContent = readFileSync(envPath, "utf8");
  const expectedLine = "HEPAI_API_KEY=opendrsai-packaged-smoke-key";
  if (!envContent.split(/\r?\n/).includes(expectedLine)) {
    writeFileSync(join(tempDir, "failed-env.txt"), envContent, "utf8");
    throw new Error(
      `Packaged app smoke wrote an unexpected .env file.\n${JSON.stringify(result, null, 2)}\n.env:\n${envContent}`,
    );
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
