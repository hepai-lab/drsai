import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const manifest = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const evidenceResult = join(evidenceDir, "packaged-presentation-action-result.json");
const evidenceScreenshot = join(evidenceDir, "packaged-presentation-action.png");
const evidenceGeneratedPptx = join(evidenceDir, "packaged-generated-manager-zh.pptx");
const evidenceGeneratedManifest = join(evidenceDir, "packaged-generated-manager-zh.provenance.json");
const port = Number(process.env.OPENDRSAI_PACKAGED_PRESENTATION_PORT || "18655");
const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "120000");

assert(process.platform === "win32", "Packaged presentation PDF E2E requires Windows");
assert(existsSync(exePath), "Build release/win-unpacked/OpenDrSai.exe before this test");
assert(existsSync(sourcePdf), `CERN PDF fixture is missing: ${sourcePdf}`);
assert(existsSync(python), `Acceptance Python runtime is missing: ${python}`);
assert(existsSync(parser), `Presentation PDF parser is missing: ${parser}`);
const bytes = readFileSync(sourcePdf);
assert(bytes.length === manifest.source.sizeBytes, "CERN PDF fixture size changed");
assert(createHash("sha256").update(bytes).digest("hex").toUpperCase() === manifest.source.sha256, "CERN PDF fixture SHA-256 changed");

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-presentation-action-"));
const drsaiHome = join(tempDir, "drsai-home");
const userData = join(tempDir, "electron-user-data");
const resultPath = join(tempDir, "result.json");
const fixturePath = join(drsaiHome, manifest.source.filename);
mkdirSync(drsaiHome, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
copyFileSync(sourcePdf, fixturePath);
writeE2eAuthSession();

let gateway;
try {
  gateway = await startFakeGateway();
  await runApp();
  assert(existsSync(resultPath), "Packaged app did not write the presentation action result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  assert(result.ok, `Packaged presentation PDF action failed:\n${JSON.stringify(result, null, 2)}`);
  copyGeneratedEvidence(result);
  console.log(JSON.stringify({
    ok: true,
    fixture: { path: sourcePdf, bytes: bytes.length, sha256: manifest.source.sha256 },
    executable: exePath,
    checks: result.checks,
    evidence: {
      result: evidenceResult,
      screenshot: evidenceScreenshot,
      generatedPptx: evidenceGeneratedPptx,
      generatedManifest: evidenceGeneratedManifest,
    },
  }, null, 2));
} catch (error) {
  if (existsSync(resultPath)) {
    const failedResult = readFileSync(resultPath, "utf8");
    writeFileSync(evidenceResult, failedResult, "utf8");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nResult:\n${failedResult}`);
  }
  throw error;
} finally {
  if (gateway) await new Promise((resolveClose) => gateway.close(resolveClose));
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function startFakeGateway() {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [] }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "fake gateway" }));
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

function writeE2eAuthSession() {
  const authDir = join(drsaiHome, "auth");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, "auth.json"), `${JSON.stringify({
    authenticated: true,
    sessionId: randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authMode: "offline",
    user: {
      id: "presentation-e2e",
      email: "presentation-e2e@opendrsai.local",
      name: "Presentation E2E",
      role: "user",
    },
  }, null, 2)}\n`, "utf8");
}

function copyGeneratedEvidence(result) {
  const outputPath = result?.details?.generatedOutputPath;
  const manifestPath = result?.details?.manifestPath;
  assert(typeof outputPath === "string" && existsSync(outputPath), "Generated PPTX evidence is missing");
  assert(typeof manifestPath === "string" && existsSync(manifestPath), "Generated provenance evidence is missing");
  copyFileSync(outputPath, evidenceGeneratedPptx);
  copyFileSync(manifestPath, evidenceGeneratedManifest);
}

function runApp() {
  return new Promise((resolveRun, reject) => {
    const child = spawn(exePath, [
      `--user-data-dir=${userData}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--in-process-gpu",
    ], {
      cwd: root,
      env: {
        ...process.env,
        PATH: [dirname(exePath), process.env.PATH || ""].join(delimiter),
        DRSAI_HOME: drsaiHome,
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_E2E_PRESENTATION_PDF_ACTION: "1",
        OPENDRSAI_E2E_PRESENTATION_PDF_NAME: manifest.source.filename,
        OPENDRSAI_E2E_PRESENTATION_PDF_PATH: fixturePath,
        OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS: "350",
        OPENDRSAI_E2E_PRESENTATION_FAIL_ATTEMPT: "2",
        OPENDRSAI_E2E_PRESENTATION_FAIL_PHASE: "analyzing",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_SCREENSHOT: evidenceScreenshot,
        OPENDRSAI_E2E_TIMEOUT_MS: String(timeoutMs),
        OPENDRSAI_PDF_PYTHON: python,
        OPENDRSAI_PDF_SCRIPT: parser,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killTree(child.pid);
      reject(new Error(`Packaged presentation action timed out.\n${stdout}\n${stderr}`));
    }, timeoutMs + 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`Packaged presentation action exited with code ${code}.\n${stdout}\n${stderr}`));
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
