import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const parser = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const h1EvidenceDir = join(root, "release", "product-evidence", "h1-key-conclusions");
const h2EvidenceDir = join(root, "release", "product-evidence", "h2-citation-support");
const h3EvidenceDir = join(root, "release", "product-evidence", "h3-numeric-traceability");
const h4EvidenceDir = join(root, "release", "product-evidence", "h4-uncertainty-conflict");
const h5EvidenceDir = join(root, "release", "product-evidence", "h5-consistency-check");
const h7EvidenceDir = join(root, "release", "product-evidence", "h7-trust-labels");
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : "cancel-retry";
assert([
  "cancel-retry",
  "cancel-planning-retry",
  "cancel-generating-retry",
  "failure-retry",
  "file-busy-retry",
  "stage-artifacts",
  "structured-summary",
  "status-matrix",
  "business-progress",
  "g8-storyline",
  "g11-audience-versions",
  "h1-key-conclusions",
  "h2-citation-support",
  "h3-numeric-traceability",
  "h4-uncertainty-conflict",
  "h5-consistency-check",
  "h6-independent-review",
  "h7-trust-labels",
  "i1-version-history",
  "i2-whole-undo",
  "i3-partial-undo",
  "pause-resume",
  "requirements-update",
  "restart-resume",
  "background-close",
  "network-outage",
  "strong-kill-resume",
  "strong-kill-restart",
  "strong-kill-abandon",
].includes(scenario), `Unknown presentation scenario: ${scenario}`);
const evidenceSuffix = scenario === "cancel-retry" ? "" : `-${scenario}`;
const evidenceResult = join(evidenceDir, `packaged-presentation-action${evidenceSuffix}-result.json`);
const evidenceScreenshot = join(evidenceDir, `packaged-presentation-action${evidenceSuffix}.png`);
const evidenceGeneratedPptx = join(evidenceDir, `packaged-generated-manager-zh${evidenceSuffix}.pptx`);
const evidenceGeneratedManifest = join(evidenceDir, `packaged-generated-manager-zh${evidenceSuffix}.provenance.json`);
const evidenceTechnicalPptx = join(evidenceDir, `packaged-generated-technical-zh${evidenceSuffix}.pptx`);
const evidenceTechnicalManifest = join(evidenceDir, `packaged-generated-technical-zh${evidenceSuffix}.provenance.json`);
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
const interruptedResultPath = join(tempDir, "interrupted-result.json");
const interruptedScreenshot = join(evidenceDir, "packaged-presentation-action-restart-interrupted.png");
const fixturePath = join(drsaiHome, manifest.source.filename);
mkdirSync(drsaiHome, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
copyFileSync(sourcePdf, fixturePath);
if (["i2-whole-undo", "i3-partial-undo"].includes(scenario)) {
  writeFileSync(join(drsaiHome, "user-owned-notes.md"), `User-owned baseline content must survive every ${scenario === "i2-whole-undo" ? "whole" : "partial"} undo.\n`, "utf8");
}
writeE2eAuthSession();
writeE2eWorkspace();

let gateway;
try {
  gateway = await startFakeGateway();
  if (scenario === "restart-resume") {
    await runApp("restart-interrupt", interruptedResultPath, interruptedScreenshot);
    assert(existsSync(interruptedResultPath), "First app process did not record its interrupted stage");
    const interruptedResult = JSON.parse(readFileSync(interruptedResultPath, "utf8"));
    assert(interruptedResult.ok && interruptedResult.checks?.interruptedWhileParsing, "First app process did not exit during PDF parsing");
  }
  if (["strong-kill-resume", "strong-kill-restart", "strong-kill-abandon"].includes(scenario)) {
    const killed = await runStrongKillApp();
    assert(killed.taskPersisted, "Strong-kill setup did not persist an active CERN task");
    assert(killed.forcedTermination, `First app process was not forcibly terminated: ${JSON.stringify(killed.termination)}`);
    assert(killed.persistedAfterKill && ["analyzing", "planning", "generating", "validating"].includes(killed.persistedAfterKill.phase),
      `Strong-kill checkpoint was not recoverable after termination: ${JSON.stringify(killed.persistedAfterKill)}`);
    const preResumeArtifacts = existsSync(join(drsaiHome, "artifacts"))
      ? readFileNames(join(drsaiHome, "artifacts")).filter((name) => /manager-zh.*\.(pptx|provenance\.json)$/i.test(name))
      : [];
    assert(preResumeArtifacts.length === 0, `Strong-kill left orphan artifacts before recovery: ${preResumeArtifacts.join(", ")}`);
  }
  await runApp(scenario, resultPath, evidenceScreenshot);
  assert(existsSync(resultPath), "Packaged app did not write the presentation action result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  assert(result.ok, `Packaged presentation PDF action failed:\n${JSON.stringify(result, null, 2)}`);
  if (scenario === "g11-audience-versions") copyG11Evidence(result);
  else if (!["strong-kill-abandon", "g8-storyline"].includes(scenario)) {
    copyGeneratedEvidence(result);
    if (scenario === "h1-key-conclusions") copyH1GoldenEvidence();
    if (scenario === "h2-citation-support") copyH2GoldenEvidence();
    if (scenario === "h3-numeric-traceability") copyH3GoldenEvidence();
    if (scenario === "h4-uncertainty-conflict") copyH4GoldenEvidence();
    if (scenario === "h5-consistency-check") copyH5GoldenEvidence();
    if (scenario === "h7-trust-labels") copyH7GoldenEvidence();
  }
  console.log(JSON.stringify({
    ok: true,
    scenario,
    fixture: { path: sourcePdf, bytes: bytes.length, sha256: manifest.source.sha256 },
    executable: exePath,
    checks: result.checks,
    evidence: {
      result: evidenceResult,
      screenshot: evidenceScreenshot,
      ...(scenario === "g8-storyline" ? {} : {
        generatedPptx: evidenceGeneratedPptx,
        generatedManifest: evidenceGeneratedManifest,
        ...(scenario === "g11-audience-versions" ? { technicalPptx: evidenceTechnicalPptx, technicalManifest: evidenceTechnicalManifest } : {}),
      }),
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

function writeE2eWorkspace() {
  const desktopDir = join(drsaiHome, "desktop");
  const now = new Date().toISOString();
  mkdirSync(desktopDir, { recursive: true });
  writeFileSync(join(desktopDir, "workspaces.json"), `${JSON.stringify([{
    id: "workspace-presentation-e2e",
    name: "CERN presentation test",
    path: drsaiHome,
    type: "local",
    description: "Isolated packaged CERN PDF acceptance workspace",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    trusted: true,
    pinned: true,
  }], null, 2)}\n`, "utf8");
  if (["h1-key-conclusions", "h2-citation-support"].includes(scenario)) {
    writeFileSync(join(drsaiHome, "paper-source.md"), "# Controlled Intervention Study\n\nAuthors: Alice Chen; Bob Singh\n\nParagraph 3: The intervention improved accuracy from 82% to 91%.\n\nParagraph 7: The study is limited to a single institution.\n", "utf8");
    writeFileSync(join(drsaiHome, "paper-summary.md"), "# 新手论文摘要\n\n准确率从 82% 提升到 91%；研究仅覆盖单一机构。\n", "utf8");
    writeFileSync(join(drsaiHome, "synthesis-sources.md"), "# Multi-material sources\n\n## Recall Improvements A\nAuthor: Mei Lin\nSource A paragraph 4: Method X improves recall.\n\n## Recall Improvements B\nAuthor: Omar Diaz\nSource B paragraph 6: Method X improves recall.\n\n## Precision Conflict Study\nAuthor: Priya Rao\nSource C paragraph 2: Precision results conflict across datasets.\n", "utf8");
    writeFileSync(join(drsaiHome, "synthesis-report.md"), "# 多材料调研\n\n两项来源支持召回率改善；精确率结果存在冲突。\n", "utf8");
    writeFileSync(join(drsaiHome, "latest-data.csv"), "metric,old,new\nsample_size,100,160\nmean_score,42,47\n", "utf8");
    writeFileSync(join(drsaiHome, "mentor-report.md"), "# 导师版更新报告\n\n样本量从 100 更新为 160，平均分从 42 更新为 47。\n", "utf8");
  }
  if (scenario === "h3-numeric-traceability") {
    writeFileSync(join(drsaiHome, "numeric-source.csv"), "id,score,passed,anomaly,q2_output\n1,40,false,false,18\n2,50,true,true,18\n3,60,true,false,18\n4,70,true,true,18\n5,80,true,false,18\n", "utf8");
    writeFileSync(join(drsaiHome, "numeric-report.md"), "# 数字核对报告\n\n平均分 60；通过比例 80%；异常点 2 个；图表 Q2 数值 18。\n", "utf8");
  }
  if (["h4-uncertainty-conflict", "h7-trust-labels"].includes(scenario)) {
    writeFileSync(join(drsaiHome, "uncertainty-sources.md"), "# D3 uncertainty sources\n\nSource A paragraph 3: In dataset Alpha, Method X increased precision by 12 percentage points.\n\nSource B paragraph 5: In dataset Beta, Method X produced no measurable precision improvement.\n\nSource C paragraph 2: Follow-up lasted only two weeks, insufficient to assess long-term effects.\n\nSource D paragraph 4: Biomarker levels moved after treatment, but the causal mechanism was not directly measured.\n", "utf8");
    writeFileSync(join(drsaiHome, "uncertainty-report.md"), "# 不确定性调研报告\n\n不同数据集的精确率结果存在来源冲突。长期效果数据不足，无法下结论。生物标志物变化可能提示机制，但这只是推测，尚未直接测量。\n", "utf8");
  }
  if (scenario === "h5-consistency-check") {
    writeFileSync(join(drsaiHome, "stale-report.md"), "# 待检查报告\n\nMinimal Model 带宽为 4.7 Tbps。\n\n2029 年将确定完成 100% HL-LHC Data Challenge。\n\n图表 Q2 数值为 20。\n", "utf8");
    writeFileSync(join(drsaiHome, "current-data.csv"), "metric,current_value,unit\nminimal_bandwidth,4.8,Tbps\nq2_output,18,items\n", "utf8");
  }
}

function copyGeneratedEvidence(result) {
  const outputPath = result?.details?.generatedOutputPath;
  const manifestPath = result?.details?.manifestPath;
  assert(typeof outputPath === "string" && existsSync(outputPath), "Generated PPTX evidence is missing");
  assert(typeof manifestPath === "string" && existsSync(manifestPath), "Generated provenance evidence is missing");
  copyFileSync(outputPath, evidenceGeneratedPptx);
  copyFileSync(manifestPath, evidenceGeneratedManifest);
}

function copyG11Evidence(result) {
  const versions = result?.details?.g11AudienceVersions || {};
  const files = [
    [versions.managerOutputPath, evidenceGeneratedPptx, "manager PPTX"],
    [versions.managerManifestPath, evidenceGeneratedManifest, "manager manifest"],
    [versions.technicalOutputPath, evidenceTechnicalPptx, "technical PPTX"],
    [versions.technicalManifestPath, evidenceTechnicalManifest, "technical manifest"],
  ];
  for (const [source, target, label] of files) {
    assert(typeof source === "string" && existsSync(source), `G11 ${label} evidence is missing`);
    copyFileSync(source, target);
  }
  const managerManifest = JSON.parse(readFileSync(versions.managerManifestPath, "utf8"));
  const technicalManifest = JSON.parse(readFileSync(versions.technicalManifestPath, "utf8"));
  assert(managerManifest.audience === "non_expert_managers", "G11 manager manifest audience mismatch");
  assert(technicalManifest.audience === "technical_experts", "G11 technical manifest audience mismatch");
  assert(managerManifest.source.sha256 === technicalManifest.source.sha256, "G11 versions do not share the same source PDF");
}

function copyH1GoldenEvidence() {
  mkdirSync(h1EvidenceDir, { recursive: true });
  for (const name of [
    "paper-source.md",
    "paper-summary.md",
    "synthesis-sources.md",
    "synthesis-report.md",
    "latest-data.csv",
    "mentor-report.md",
  ]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H1 golden task evidence is missing: ${name}`);
    copyFileSync(source, join(h1EvidenceDir, name));
  }
}

function copyH2GoldenEvidence() {
  mkdirSync(h2EvidenceDir, { recursive: true });
  for (const name of ["paper-source.md", "paper-summary.md", "synthesis-sources.md", "synthesis-report.md"]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H2 golden citation evidence is missing: ${name}`);
    copyFileSync(source, join(h2EvidenceDir, name));
  }
}

function copyH3GoldenEvidence() {
  mkdirSync(h3EvidenceDir, { recursive: true });
  for (const name of ["numeric-source.csv", "numeric-report.md"]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H3 golden numeric evidence is missing: ${name}`);
    copyFileSync(source, join(h3EvidenceDir, name));
  }
}

function copyH4GoldenEvidence() {
  mkdirSync(h4EvidenceDir, { recursive: true });
  for (const name of ["uncertainty-sources.md", "uncertainty-report.md"]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H4 golden uncertainty evidence is missing: ${name}`);
    copyFileSync(source, join(h4EvidenceDir, name));
  }
}

function copyH5GoldenEvidence() {
  mkdirSync(h5EvidenceDir, { recursive: true });
  for (const name of ["stale-report.md", "current-data.csv"]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H5 golden consistency evidence is missing: ${name}`);
    copyFileSync(source, join(h5EvidenceDir, name));
  }
}

function copyH7GoldenEvidence() {
  mkdirSync(h7EvidenceDir, { recursive: true });
  for (const name of ["uncertainty-sources.md", "uncertainty-report.md"]) {
    const source = join(drsaiHome, name);
    assert(existsSync(source), `H7 golden trust evidence is missing: ${name}`);
    copyFileSync(source, join(h7EvidenceDir, name));
  }
}

function runApp(e2eScenario = scenario, outputPath = resultPath, screenshotPath = evidenceScreenshot) {
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
        DRSAI_REPO: drsaiHome,
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_E2E_PRESENTATION_PDF_ACTION: "1",
        OPENDRSAI_E2E_PRESENTATION_PDF_NAME: manifest.source.filename,
        OPENDRSAI_E2E_PRESENTATION_PDF_PATH: fixturePath,
        OPENDRSAI_E2E_PRESENTATION_SCENARIO: e2eScenario,
        OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS: e2eScenario.startsWith("strong-kill-") ? "200" : "900",
        OPENDRSAI_E2E_PRESENTATION_FAIL_ATTEMPT: e2eScenario === "failure-retry" ? "1" : "0",
        OPENDRSAI_E2E_PRESENTATION_FAIL_PHASE: "analyzing",
        OPENDRSAI_E2E_PRESENTATION_FILE_BUSY_ATTEMPT: e2eScenario === "file-busy-retry" ? "1" : "0",
        OPENDRSAI_E2E_PRESENTATION_FILE_BUSY_ATTEMPTS: e2eScenario === "file-busy-retry" ? "3" : "0",
        OPENDRSAI_PRESENTATION_FILE_WRITE_RETRY_LIMIT: "3",
        OPENDRSAI_E2E_PRESENTATION_ELAPSED_MS: e2eScenario === "stage-artifacts" ? "600001" : "0",
        OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: ["structured-summary", "g8-storyline", "g11-audience-versions", "h1-key-conclusions", "h2-citation-support", "h3-numeric-traceability", "h4-uncertainty-conflict", "h5-consistency-check", "h6-independent-review", "h7-trust-labels", "i1-version-history", "i2-whole-undo", "i3-partial-undo"].includes(e2eScenario) ? "1" : "0",
        OPENDRSAI_PRESENTATION_STAGE_ARTIFACT_THRESHOLD_MS: "600000",
        OPENDRSAI_E2E_RESULT: outputPath,
        OPENDRSAI_E2E_SCREENSHOT: screenshotPath,
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

async function runStrongKillApp() {
  const taskPath = join(drsaiHome, "desktop", "manager-presentation-tasks.json");
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
      DRSAI_REPO: drsaiHome,
      OPENDRSAI_GATEWAY_PORT: String(port),
      OPENDRSAI_E2E_PRESENTATION_PDF_ACTION: "1",
      OPENDRSAI_E2E_PRESENTATION_PDF_NAME: manifest.source.filename,
      OPENDRSAI_E2E_PRESENTATION_PDF_PATH: fixturePath,
      OPENDRSAI_E2E_PRESENTATION_SCENARIO: "strong-kill-wait",
      OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS: "5000",
      OPENDRSAI_E2E_RESULT: interruptedResultPath,
      OPENDRSAI_E2E_SCREENSHOT: interruptedScreenshot,
      OPENDRSAI_E2E_TIMEOUT_MS: String(timeoutMs),
      OPENDRSAI_PDF_PYTHON: python,
      OPENDRSAI_PDF_SCRIPT: parser,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const close = new Promise((resolveClose) => child.once("close", (code, signal) => resolveClose({ code, signal })));
  const deadline = Date.now() + 30_000;
  let taskPersisted = false;
  while (Date.now() < deadline) {
    try {
      const tasks = JSON.parse(readFileSync(taskPath, "utf8"));
      taskPersisted = Array.isArray(tasks) && tasks.some((task) =>
        task.sourcePath === fixturePath && task.phase === "analyzing" && task.progress >= 12);
      if (taskPersisted) break;
    } catch {
      // Wait until the renderer starts the task and the main process commits a checkpoint.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!taskPersisted) {
    killTree(child.pid);
    await close;
    return { taskPersisted: false, forcedTermination: false };
  }
  const directKilled = child.kill("SIGKILL");
  const exited = await Promise.race([
    close,
    new Promise((resolveExit) => setTimeout(() => resolveExit({ code: null, signal: "kill-timeout" }), 5_000)),
  ]);
  const termination = exited.signal === "kill-timeout" ? killTree(child.pid) : { status: 0, stdout: "direct TerminateProcess", stderr: "" };
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  let persistedAfterKill = null;
  try {
    const tasks = JSON.parse(readFileSync(taskPath, "utf8"));
    persistedAfterKill = Array.isArray(tasks) ? tasks.find((task) => task.sourcePath === fixturePath) || null : null;
  } catch {
    persistedAfterKill = null;
  }
  return {
    taskPersisted: true,
    forcedTermination: directKilled && termination.status === 0 && (exited.code !== 0 || exited.signal !== null),
    termination,
    persistedAfterKill,
  };
}

function killTree(pid) {
  if (!pid) return { status: -1, stdout: "", stderr: "missing pid" };
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
  return { status: result.status ?? -1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function readFileNames(path) {
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
