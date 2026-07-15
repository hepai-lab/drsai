import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : "default";
if (!["default", "background-close", "minimized-notification", "network-recovery", "business-progress", "completion-criteria", "continuous-task", "d1-plan-g2", "d1-plan-g3", "d1-plan-g4", "d2-edit-plan", "d3-depth", "d5-plan-adjustment", "g1-results-center", "g2-deliverable-report", "g3-output-versions", "g4-preview-download", "g5-local-edit", "g6-chart-consistency", "i4-analysis-routes", "i5-route-comparison", "i6-external-conflict"].includes(scenario)) {
  throw new Error(`Unknown Agent run scenario: ${scenario}`);
}
const isAnalysisRouteScenario = scenario === "i4-analysis-routes" || scenario === "i5-route-comparison";
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
const userData = join(tempDir, "electron-user-data");
const resultPath = join(tempDir, "result.json");
const evidenceDir = join(
  root,
  "release",
  "product-evidence",
  scenario === "background-close"
    ? "agent-background-close"
    : scenario === "network-recovery"
      ? "agent-network-recovery"
      : scenario === "business-progress"
        ? "agent-business-progress"
        : scenario === "completion-criteria"
          ? "d6-completion-criteria"
          : scenario === "continuous-task"
            ? "d4-continuous-task"
            : scenario.startsWith("d1-plan-")
              ? "d1-structured-plans"
              : scenario === "d2-edit-plan"
                ? "d2-edit-plan"
                : scenario === "d3-depth"
                  ? "d3-task-depth"
                  : scenario === "d5-plan-adjustment"
                    ? "d5-plan-adjustment"
                    : scenario === "g1-results-center"
                      ? "g1-results-center"
                      : scenario === "g2-deliverable-report"
                        ? "g2-deliverable-report"
                        : scenario === "g3-output-versions"
                          ? "g3-output-versions"
                          : scenario === "g4-preview-download"
                            ? "g4-preview-download"
                            : scenario === "g5-local-edit"
                              ? "g5-local-edit"
                              : scenario === "g6-chart-consistency"
                                ? "g6-chart-consistency"
                                : scenario === "i4-analysis-routes"
                                  ? "i4-analysis-routes"
                                  : scenario === "i5-route-comparison"
                                    ? "i5-route-comparison"
                                    : scenario === "i6-external-conflict"
                                      ? "i6-external-conflict"
        : "agent-completion-notifications",
);
const evidenceStem = scenario === "background-close"
    ? "packaged-agent-background-close"
  : scenario === "minimized-notification"
    ? "packaged-agent-minimized-notification"
    : scenario === "network-recovery"
      ? "packaged-agent-network-recovery"
      : scenario === "business-progress"
        ? "packaged-agent-business-progress"
        : scenario === "completion-criteria"
          ? "packaged-d6-completion-criteria"
          : scenario === "continuous-task"
            ? "packaged-d4-continuous-task"
            : scenario.startsWith("d1-plan-")
              ? `packaged-${scenario}`
              : scenario === "d2-edit-plan"
                ? "packaged-d2-edit-plan"
                : scenario === "d3-depth"
                  ? "packaged-d3-task-depth"
                  : scenario === "d5-plan-adjustment"
                    ? "packaged-d5-plan-adjustment"
                    : scenario === "g1-results-center"
                      ? "packaged-g1-results-center"
                      : scenario === "g2-deliverable-report"
                        ? "packaged-g2-deliverable-report"
                        : scenario === "g3-output-versions"
                          ? "packaged-g3-output-versions"
                          : scenario === "g4-preview-download"
                            ? "packaged-g4-preview-download"
                            : scenario === "g5-local-edit"
                              ? "packaged-g5-local-edit"
                              : scenario === "g6-chart-consistency"
                                ? "packaged-g6-chart-consistency"
                                : scenario === "i4-analysis-routes"
                                  ? "packaged-i4-analysis-routes"
                                  : scenario === "i5-route-comparison"
                                    ? "packaged-i5-route-comparison"
                                    : scenario === "i6-external-conflict"
                                      ? "packaged-i6-external-conflict"
        : "packaged-agent-foreground-notification";
const evidenceResult = join(evidenceDir, `${evidenceStem}-result.json`);
const evidenceScreenshot = join(evidenceDir, `${evidenceStem}.png`);
const g4SaveDirectory = join(tempDir, "下载结果", "导师版本");
const i6SaveDirectory = join(tempDir, "冲突保留副本");
mkdirSync(appHome, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(g4SaveDirectory, { recursive: true });
mkdirSync(i6SaveDirectory, { recursive: true });
writeFileSync(join(workspacePath, "user-work.txt"), "user work before agent\n", "utf8");
if (scenario === "d2-edit-plan") {
  writeFileSync(join(appHome, "old-report.md"), "# 旧报告\n\n样本量：100；平均值：42。\n", "utf8");
  writeFileSync(join(appHome, "latest-data.csv"), "metric,old,new\nsample_size,100,160\nmean,42,47\n", "utf8");
  writeFileSync(join(appHome, "result.png"), "deterministic-image-fixture", "utf8");
}
if (scenario === "d3-depth") {
  writeFileSync(join(appHome, "study-a.md"), "研究 A：短期记忆表现改善；实施成本较低。\n", "utf8");
  writeFileSync(join(appHome, "study-b.md"), "研究 B：短期记忆表现改善；实施成本较高。\n", "utf8");
  writeFileSync(join(appHome, "study-c.md"), "研究 C：长期稳定性证据不足，需要扩大样本并延长随访。\n", "utf8");
}
if (scenario === "d5-plan-adjustment") {
  writeFileSync(join(appHome, "study-a.md"), "研究 A：短期记忆表现改善；实施成本较低。\n", "utf8");
  writeFileSync(join(appHome, "study-c.md"), "研究 C：长期稳定性证据不足，需要扩大样本并延长随访。\n", "utf8");
}
if (scenario === "business-progress") {
  writeFileSync(join(workspacePath, "paper-a.md"), "材料 A：现有方法在准确率上形成共识，但成本仍有争议。\n", "utf8");
  writeFileSync(join(workspacePath, "paper-b.md"), "材料 B：支持扩大样本，并建议研究长期稳定性。\n", "utf8");
  writeFileSync(join(workspacePath, "data.csv"), "study,accuracy,cost\nA,0.91,high\nB,0.89,medium\n", "utf8");
}
if (scenario === "completion-criteria" || scenario === "d1-plan-g4" || scenario === "g2-deliverable-report") {
  writeFileSync(join(workspacePath, "old-report.md"), "# 旧报告\n\n样本量：100；平均值：42。\n", "utf8");
  writeFileSync(join(workspacePath, "latest-data.csv"), "metric,old,new\nsample_size,100,160\nmean,42,47\n", "utf8");
  writeFileSync(join(workspacePath, "result.png"), "deterministic-image-fixture", "utf8");
}
if (scenario === "continuous-task" || scenario === "d1-plan-g3") {
  writeFileSync(join(workspacePath, "study-a.md"), "# 研究 A\n\n## 结论\n干预使短期记忆表现改善。实施成本较低。\n", "utf8");
  writeFileSync(join(workspacePath, "study-b.md"), "# 研究 B\n\n## 结果\n短期记忆表现改善，但实施成本较高。\n", "utf8");
  writeFileSync(join(workspacePath, "study-c.md"), "# 研究 C\n\n## 限制\n长期稳定性仍缺乏充分证据，需要扩大样本并延长随访。\n", "utf8");
}
if (scenario === "d1-plan-g2") {
  writeFileSync(join(workspacePath, "experiment.csv"), "id,value\n1,10\n1,10\n2,\n3,999\n", "utf8");
  writeFileSync(join(workspacePath, "experiment.xlsx"), "deterministic-xlsx-fixture", "utf8");
}
if (scenario === "g1-results-center") {
  writeFileSync(join(workspacePath, "paper-summary.md"), "# Paper summary\n\nAutomated G1 result fixture.\n", "utf8");
  writeFileSync(join(workspacePath, "data-analysis.csv"), "metric,value\naccuracy,0.91\n", "utf8");
  mkdirSync(join(workspacePath, "research-synthesis"), { recursive: true });
  writeFileSync(join(workspacePath, "research-synthesis", "README.md"), "# Research synthesis\n", "utf8");
  writeFileSync(join(workspacePath, "mentor-report.pptx"), "deterministic-presentation-fixture", "utf8");
}
if (scenario === "g3-output-versions") {
  writeFileSync(join(workspacePath, "mentor-report.md"), [
    "# 导师版研究结果更新报告", "", "## 摘要", "样本量由 100 增至 160，平均值由 42 增至 47。", "",
    "## 方法", "核对历史报告与最新数据。", "", "## 结果", "样本量 100 → 160；平均值 42 → 47。", "",
    "## 限制", "变化原因仍需进一步研究。", "", "## 来源", "mentor-report.md", "",
  ].join("\n"), "utf8");
}
if (scenario === "g4-preview-download") writeG4PreviewFixtures(workspacePath);
if (scenario === "g5-local-edit") writeG5LocalEditFixtures(workspacePath);
if (scenario === "g6-chart-consistency") writeG6ChartFixtures(workspacePath);
if (isAnalysisRouteScenario) writeI4AnalysisRouteFixtures(workspacePath);
if (scenario === "i6-external-conflict") {
  writeI6ExternalConflictFixtures(workspacePath);
  const desktopStateDir = join(appHome, "desktop");
  mkdirSync(desktopStateDir, { recursive: true });
  const seededAt = "2026-07-15T00:00:00.000Z";
  writeFileSync(join(desktopStateDir, "workspaces.json"), `${JSON.stringify([{
    id: "workspace-i6-cern-conflict",
    name: "CERN 冲突保护",
    path: workspacePath,
    type: "local",
    createdAt: seededAt,
    updatedAt: seededAt,
    lastOpenedAt: seededAt,
    trusted: true,
    pinned: true,
  }], null, 2)}\n`, "utf8");
}

let server = null;
let requestBody = null;
let requestCount = 0;
const gatewayRequests = [];
const completionRequests = [];
let outageStartedAt = 0;
let sideEffectCount = 0;
let externalEditCount = 0;
let i6ExternalWatcher = null;
const outageMs = Number(process.env.OPENDRSAI_E2E_NETWORK_OUTAGE_MS || "60000");

try {
  if (scenario === "i6-external-conflict") {
    const triggerPath = join(workspacePath, "i6-external-trigger.txt");
    let observedTrigger = readFileSync(triggerPath, "utf8");
    i6ExternalWatcher = setInterval(() => {
      const nextTrigger = readFileSync(triggerPath, "utf8");
      if (nextTrigger === observedTrigger) return;
      observedTrigger = nextTrigger;
      externalEditCount += 1;
      writeFileSync(join(workspacePath, "cern-capacity-notes.md"), i6ExternalContent(externalEditCount), "utf8");
    }, 20);
  }
  await assertPortFree();
  server = await startGateway(workspacePath);
  await runPackagedApp({ appHome, resultPath, workspacePath });
  if (!existsSync(resultPath)) {
    throw new Error("E2E agent run did not write a smoke result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (!result.ok) {
    throw new Error(`E2E agent run failed:\n${JSON.stringify(result, null, 2)}`);
  }
  if (scenario === "d2-edit-plan") {
    assertD2EditPlanDiagnostics(result);
  } else if (scenario === "d3-depth") {
    assertD3TaskDepthDiagnostics(result);
  } else if (scenario === "d5-plan-adjustment") {
    assertD5PlanAdjustmentDiagnostics(result);
  } else if (scenario === "g1-results-center") {
    assertG1ResultsCenterDiagnostics(result);
  } else if (scenario === "g2-deliverable-report") {
    assertAgentRunDiagnostics(result);
    assertG2DeliverableReportDiagnostics(result);
  } else if (scenario === "g3-output-versions") {
    assertG3OutputVersionsDiagnostics(result);
  } else if (scenario === "g4-preview-download") {
    assertG4PreviewDownloadDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else if (scenario === "g5-local-edit") {
    assertG5LocalEditDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else if (scenario === "g6-chart-consistency") {
    assertG6ChartConsistencyDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else if (scenario === "i4-analysis-routes") {
    assertI4AnalysisRouteDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else if (scenario === "i5-route-comparison") {
    assertI4AnalysisRouteDiagnostics(result);
    assertI5RouteComparisonDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else if (scenario === "i6-external-conflict") {
    assertI6ExternalConflictDiagnostics(result);
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } else {
    assertAgentRunDiagnostics(result);
    if (readFileSync(join(workspacePath, "user-work.txt"), "utf8") !== "user work before agent\n") {
      throw new Error("Agent change rejection did not restore the user's pre-run file content.");
    }
    if (existsSync(join(workspacePath, "agent-created.txt"))) {
      throw new Error("Agent change rejection did not remove a file created during the run.");
    }
  }
  console.log(`E2E agent run ${scenario} passed with packaged Electron + fake gateway.`);
} finally {
  if (i6ExternalWatcher) clearInterval(i6ExternalWatcher);
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  cleanupTempDir(tempDir);
}

function assertG3OutputVersionsDiagnostics(result) {
  const requiredChecks = [
    "bridge", "login", "workspaceRegistered", "sourceReportSeeded", "fixedResultsCenterUsed",
    "versionActionVisible", "visibleRunCompleted", "oneVersionRunOnly", "fiveArtifactsRegistered",
    "expectedVersionNames", "onePageFormat", "fullReportFormat", "presentationOutlineFormat",
    "emailFormat", "englishFormat", "sourceTraceable", "numericConsistency100",
    "variantArtifactsSkipFullReportChecker", "noChatTemporaryLinkUsed",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`G3 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (requestCount !== 1 || !requestBody) throw new Error(`G3 expected one versioning request, received ${requestCount}.`);
  const prompt = String(requestBody?.messages?.[0]?.content || "");
  for (const required of ["五种", "100% 一致", "one-page-summary.md", "full-report.md", "presentation-outline.md", "email.md", "english.md"]) {
    if (!prompt.includes(required)) throw new Error(`G3 versioning prompt omitted ${required}.`);
  }
  if (requestBody?.metadata?.source !== "windows-results-center-versioning") throw new Error("G3 request did not originate from Results center versioning.");
  if (requestBody?.metadata?.required_numeric_consistency !== 100) throw new Error("G3 request omitted the 100% numeric consistency contract.");
  if (!Array.isArray(requestBody?.metadata?.output_versions) || requestBody.metadata.output_versions.length !== 5) throw new Error("G3 request omitted the five output version identifiers.");
  if (!Array.isArray(requestBody?.metadata?.files) || requestBody.metadata.files.length !== 1 || !String(requestBody.metadata.files[0]?.path || "").endsWith("mentor-report.md")) {
    throw new Error("G3 request did not attach the source report.");
  }
  const consistency = result?.details?.numericConsistency;
  if (consistency?.matched !== 20 || consistency?.expected !== 20 || consistency?.coverage !== 100) {
    throw new Error(`G3 numeric consistency accounting mismatch: ${JSON.stringify(consistency)}`);
  }
}

function assertG4PreviewDownloadDiagnostics(result) {
  const requiredChecks = [
    "bridge", "login", "workspaceRegistered", "fiveFormatsSeeded", "fixedResultsCenterUsed",
    "fivePreviewKindsCorrect", "pdfPreviewVisible", "wordPreviewVisible", "tablePreviewVisible",
    "imagePreviewVisible", "markdownPreviewVisible", "pdfSystemOpenAvailable", "twentySaveActionsCompleted",
    "everySaveShowsIntegrity", "noChatTemporaryLinkUsed",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`G4 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (requestCount !== 0) throw new Error(`G4 preview/save should not start an Agent request; received ${requestCount}.`);
  const saved = readSavedFiles(g4SaveDirectory);
  if (saved.length !== 20) throw new Error(`G4 expected 20 saved copies, found ${saved.length}.`);
  const sources = new Map([
    ["CERN 摘要.pdf", join(workspacePath, "CERN 摘要.pdf")],
    ["导师报告.docx", join(workspacePath, "导师报告.docx")],
    ["实验数据.csv", join(workspacePath, "实验数据.csv")],
    ["结果图.png", join(workspacePath, "结果图.png")],
    ["研究总结.md", join(workspacePath, "研究总结.md")],
  ]);
  const counts = new Map([...sources.keys()].map((name) => [name, 0]));
  for (const savedPath of saved) {
    const savedName = savedPath.split(/[\\/]/).pop().replace(/^\d{2}-/, "");
    const sourcePath = sources.get(savedName);
    if (!sourcePath) throw new Error(`G4 saved an unexpected file: ${savedPath}`);
    if (hashPath(savedPath) !== hashPath(sourcePath)) throw new Error(`G4 saved copy is corrupted: ${savedPath}`);
    if (savedPath.slice(savedPath.lastIndexOf(".")).toLowerCase() !== sourcePath.slice(sourcePath.lastIndexOf(".")).toLowerCase()) {
      throw new Error(`G4 changed the extension for ${savedPath}.`);
    }
    counts.set(savedName, counts.get(savedName) + 1);
  }
  if (![...counts.values()].every((count) => count === 4)) throw new Error(`G4 did not save each format exactly four times: ${JSON.stringify(Object.fromEntries(counts))}`);
  result.details.savedFileAudit = {
    directory: g4SaveDirectory,
    containsChinesePath: /[\u4e00-\u9fff]/.test(g4SaveDirectory),
    total: saved.length,
    perFormat: Object.fromEntries(counts),
    hashesMatched: saved.length,
    extensionsPreserved: saved.length,
  };
}

function assertG5LocalEditDiagnostics(result) {
  const requiredChecks = [
    "bridge", "login", "workspaceRegistered", "fourSourceArtifactsSeeded", "fixedResultsCenterUsed",
    "textSelectionCaptured", "tableSelectionCaptured", "imageSelectionCaptured", "threeEditRunsCompleted",
    "threeNewVersionsRegistered", "lineagePersisted", "threeCompareActionsVisible", "threeComparisonsOpened",
    "originalsUnchangedInPreview", "editedResultsDiffer", "noChatTemporaryLinkUsed",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`G5 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (requestCount !== 3 || completionRequests.length !== 3) throw new Error(`G5 expected three localized-edit requests, received ${requestCount}.`);
  const actions = completionRequests.map((item) => item.body?.metadata?.edit_action).sort();
  if (JSON.stringify(actions) !== JSON.stringify(["log_scale_image", "simplify_text", "sort_table_numeric"])) throw new Error(`G5 edit action matrix mismatch: ${JSON.stringify(actions)}`);
  for (const { body } of completionRequests) {
    if (body?.metadata?.source !== "windows-results-center-local-edit") throw new Error("G5 request did not originate from the Results center local editor.");
    if (body?.metadata?.preserve_unselected !== true || body?.metadata?.create_new_version !== true) throw new Error("G5 request omitted scope isolation or new-version protection.");
    const prompt = String(body?.messages?.[0]?.content || "");
    if (!prompt.includes("不得覆盖或改写源文件") || !prompt.includes("其他") || !prompt.includes("保持不变")) throw new Error("G5 prompt omitted original/scope protection.");
  }
  const sourceReport = readFileSync(join(workspacePath, "局部修改报告.md"), "utf8");
  const editedReport = readFileSync(join(workspacePath, "局部修改报告-edited.md"), "utf8");
  if (sourceReport !== g5SourceReport()) throw new Error("G5 changed the source report.");
  if (editedReport !== g5EditedReport()) throw new Error("G5 text edit changed content outside the selected sentence.");
  const sourceCsv = readFileSync(join(workspacePath, "排序数据.csv"), "utf8");
  const editedCsv = readFileSync(join(workspacePath, "排序数据-edited.csv"), "utf8");
  if (sourceCsv !== g5SourceCsv()) throw new Error("G5 changed the source table.");
  if (editedCsv !== g5EditedCsv()) throw new Error("G5 table edit did not only reorder rows by numeric value.");
  const sourceImage = join(workspacePath, "坐标图.png");
  const editedImage = join(workspacePath, "坐标图-edited.png");
  if (hashPath(sourceImage) !== createHash("sha256").update(g5SourceImage()).digest("hex")) throw new Error("G5 changed the source image.");
  if (hashPath(editedImage) === hashPath(sourceImage)) throw new Error("G5 image edit did not create a distinct version.");
  if (readFileSync(join(workspacePath, "其他成果.md"), "utf8") !== "# 其他成果\n\n不得改变。\n") throw new Error("G5 changed an unrelated artifact.");
  result.details.scopeIsolationAudit = {
    textOutsideSelectionPreserved: true,
    tableCellSetPreserved: true,
    imageOriginalPreserved: true,
    unrelatedArtifactPreserved: true,
    originalFilesOverwritten: 0,
    newVersions: 3,
  };
}

function assertG6ChartConsistencyDiagnostics(result) {
  const requiredChecks = [
    "bridge", "login", "workspaceRegistered", "twoDataArtifactsSeeded", "fixedResultsCenterUsed",
    "twoChartControlsVisible", "twoChartRunsCompleted", "validChartRegistered", "invalidChartRegistered",
    "validChartQualityPassed", "validAxesUnitLegend", "validAllPointsMapped", "validAllCoordinatesMapped",
    "validAnomalyMapped", "invalidChartQualityFailed", "invalidMismatchVisible", "invalidNotClaimedPassed",
    "qualityPersisted", "sourceDataUnchanged", "chartPreviewVisible", "noChatTemporaryLinkUsed",
  ];
  for (const check of requiredChecks) if (!result?.checks?.[check]) throw new Error(`G6 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  if (requestCount !== 2 || completionRequests.length !== 2) throw new Error(`G6 expected two chart requests, received ${requestCount}.`);
  for (const { body } of completionRequests) {
    if (body?.metadata?.source !== "windows-results-center-chart-generation") throw new Error("G6 request did not originate from the Results center chart action.");
    if (body?.metadata?.x_column !== "day" || body?.metadata?.y_column !== "throughput_tbps" || body?.metadata?.unit !== "Tbps" || body?.metadata?.legend !== "Observed throughput") throw new Error("G6 chart configuration metadata mismatch.");
    if (body?.metadata?.x_min !== 1 || body?.metadata?.x_max !== 3 || body?.metadata?.y_min !== 0 || body?.metadata?.y_max !== 10) throw new Error("G6 chart scale metadata mismatch.");
  }
  const source = g6Csv();
  if (readFileSync(join(workspacePath, "正确图表数据.csv"), "utf8") !== source || readFileSync(join(workspacePath, "矛盾图表数据.csv"), "utf8") !== source) throw new Error("G6 changed source CSV data.");
  const validSvg = readFileSync(join(workspacePath, "正确图表数据-chart.svg"), "utf8");
  if (!["day", "throughput_tbps", "Tbps", "Observed throughput", 'data-x="3"', 'data-y="9.6"', 'data-anomaly="true"'].every((token) => validSvg.includes(token))) throw new Error("G6 valid SVG omitted required chart semantics.");
  result.details.chartConsistencyAudit = { sourceRows: 3, pointsMatched: 3, coordinatesMatched: 3, anomaliesMatched: 1, contradictionsAccepted: 0, sourceFilesChanged: 0 };
}

function assertI4AnalysisRouteDiagnostics(result) {
  const required = [
    "bridge", "login", "workspaceRegistered", "cernInputsPresent", "originalRouteTaskSeeded",
    "fixedResultsCenterUsed", "alternativeRouteActionVisible", "alternativeRouteCompleted",
    "twoIndependentTasks", "twoIndependentRouteArtifacts", "sameInputIndependentMethods",
    "independentRouteIds", "alternativeQualityPassed", "twoRouteCardsVisible",
    "bothRoutesOpenSeparately", "originalArtifactNotOverwritten", "cernCsvNotChanged",
    "cernPdfNotChanged", "alternativeArtifactExistsSeparately", "alternativeOutputDistinct", "onlyOneAlternativeCreated",
    "noTechnicalNoise",
  ];
  for (const name of required) {
    if (result.checks?.[name] !== true) throw new Error(`I4 check failed: ${name}`);
  }
  const hashes = result.details?.hashes;
  if (!hashes || hashes.beforeCsv !== hashes.afterCsv || hashes.beforePdf !== hashes.afterPdf || hashes.beforeOriginal !== hashes.afterOriginal || !hashes.alternative) {
    throw new Error("I4 source/original hash isolation evidence is incomplete.");
  }
}

function assertI5RouteComparisonDiagnostics(result) {
  const required = [
    "comparisonViewVisible", "sixComparisonFieldsVisible", "differencesMappedToBothRoutes",
    "sameInputShown", "distinctMethodsShown", "distinctConclusionsShown", "risksAndUsesShown",
    "alternativeVersionSelected", "selectionPersistedExactlyOnce", "selectionCanSwitch",
    "continueQuestionNavigatesToChat", "continueQuestionCarriesRouteContext", "comparisonRestoredAfterQuestion",
  ];
  for (const name of required) {
    if (result.checks?.[name] !== true) throw new Error(`I5 check failed: ${name}`);
  }
  const comparison = result.details?.routeComparison;
  if (!comparison || comparison.fields?.length !== 6 || comparison.routeIds?.length !== 2 || comparison.selectedRouteCount !== 1) {
    throw new Error("I5 structured route comparison evidence is incomplete.");
  }
}

function assertI6ExternalConflictDiagnostics(result) {
  const required = [
    "bridge", "login", "workspaceRegistered", "workspaceSelected", "filesPanelVisible", "safeEditVisible",
    "externalProgramModifiedAfterRead", "conflictDetectedAndWriteStopped", "threeRecoveryChoicesVisible",
    "externalVersionPreservedOnBlock", "reloadUsesLatestExternalVersion", "saveAsPreservesBothVersions",
    "manualChoiceExplainsBothOutcomes", "manualKeepExternalWorks", "unchangedHashAllowsSafeSave",
    "repeatedExternalChangeStillProtected", "cernPdfUnchanged", "noTechnicalNoise",
  ];
  for (const name of required) if (result.checks?.[name] !== true) throw new Error(`I6 check failed: ${name}`);
  if (externalEditCount !== 3) throw new Error(`I6 expected three independent external edits, received ${externalEditCount}.`);
  const original = readFileSync(join(workspacePath, "cern-capacity-notes.md"), "utf8");
  const savedCopy = readFileSync(join(i6SaveDirectory, "cern-capacity-notes-my-version.md"), "utf8");
  if (!original.includes("外部程序版本 3") || original.includes("不应静默写入的后续草稿")) throw new Error("I6 silently overwrote the final external version.");
  if (!savedCopy.includes("我的草稿版本 2")) throw new Error("I6 save-as copy did not preserve the user's draft.");
  const pdfHash = createHash("sha256").update(readFileSync(join(workspacePath, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"))).digest("hex").toUpperCase();
  if (pdfHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("I6 changed the CERN source PDF.");
}

function g6Csv() { return "day,throughput_tbps,anomaly\n1,4.8,false\n2,5.6,false\n3,9.6,true\n"; }
function i6ExternalContent(version) {
  return [
    "# CERN 容量复核笔记", "", `外部程序版本 ${version}：同事已更新这份文件。`,
    "CERN p.42：4.8 Tbps 与 9.6 Tbps。", "CERN p.43：2027 50%，2029 100% 待确认。", "",
  ].join("\n");
}
function g6ValidSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">',
    '<text x="250" y="390">day</text><text x="10" y="190">throughput_tbps</text><text x="500" y="20">Tbps</text><text x="60" y="20">Observed throughput</text>',
    '<circle cx="60" cy="196" r="6" data-x="1" data-y="4.8" data-anomaly="false"/>',
    '<circle cx="300" cy="172" r="6" data-x="2" data-y="5.6" data-anomaly="false"/>',
    '<circle cx="540" cy="52" r="8" class="anomaly" data-x="3" data-y="9.6" data-anomaly="true"/>',
    '</svg>',
  ].join("");
}
function g6AlternativeRouteSvg() {
  return g6ValidSvg().replace("</svg>", [
    '<line x1="60" y1="184" x2="300" y2="184" stroke="#7c3aed" stroke-dasharray="6 4" data-route-analysis="non-anomaly-baseline"/>',
    '<text x="60" y="372">Anomaly-first segmented analysis</text>',
    "</svg>",
  ].join(""));
}
function g6InvalidSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">',
    '<text x="250" y="390">day</text><text x="10" y="190">throughput_tbps</text><text x="60" y="20">Observed throughput</text>',
    '<circle cx="60" cy="196" r="6" data-x="1" data-y="4.8" data-anomaly="false"/>',
    '<circle cx="300" cy="172" r="6" data-x="2" data-y="5.6" data-anomaly="false"/>',
    '<circle cx="540" cy="100" r="6" data-x="3" data-y="8.6" data-anomaly="false"/>',
    '</svg>',
  ].join("");
}

function g5SourceReport() {
  return "# 局部修改报告\n\nKEEP BEFORE\n\n由于多重因素相互交织，该结果呈现出较为复杂且不易理解的变化趋势。\n\nKEEP AFTER\n";
}
function g5EditedReport() {
  return "# 局部修改报告\n\nKEEP BEFORE\n\n这个结果受多个因素影响，变化比较复杂。\n\nKEEP AFTER\n";
}
function g5SourceCsv() { return "id,value,label\n1,30,A\n2,10,B\n3,20,C\n"; }
function g5EditedCsv() { return "id,value,label\n2,10,B\n3,20,C\n1,30,A\n"; }
function g5SourceImage() { return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"); }
function g5EditedImage() { return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf7sAAAAASUVORK5CYII=", "base64"); }

function hashPath(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readSavedFiles(directory) {
  return Array.from({ length: 20 }, (_, index) => {
    const prefix = `${String(index + 1).padStart(2, "0")}-`;
    const expected = ["CERN 摘要.pdf", "导师报告.docx", "实验数据.csv", "结果图.png", "研究总结.md"]
      .map((name) => join(directory, `${prefix}${name}`))
      .find((path) => existsSync(path));
    return expected || null;
  }).filter(Boolean);
}

function assertG1ResultsCenterDiagnostics(result) {
  const requiredChecks = [
    "bridge", "login", "artifactWorkspaceRegistered", "fourSourceTasksCompleted", "fixedMainNavigationEntry",
    "fixedResultsRouteVisible", "allResultsIndexed", "indexedByTask", "indexedByType",
    "stableIdsAndPathsPresent", "noChatTemporaryLinkUsed", "typeFilterWorks",
    "everyResultOpenActionWorks", "idsStableAfterRefresh",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`G1 packaged check failed: ${check}`);
  }
  if (result?.details?.navigationPath !== "main-sidebar-results") {
    throw new Error("G1 did not access results through the fixed main navigation entry.");
  }
  if (!Array.isArray(result?.details?.openedArtifacts) || result.details.openedArtifacts.length !== 4) {
    throw new Error("G1 did not exercise every result open action.");
  }
}

function assertG2DeliverableReportDiagnostics(result) {
  const requiredChecks = [
    "g2ReportArtifactRegistered", "g2QualityPersisted", "g2FormatValid",
    "g2RequiredSectionsComplete", "g2NoPlaceholders", "g2NoMojibake",
    "g2NoEmptyImages", "g2NoBrokenLinks", "g2GoldenCoverageAtLeast90",
    "g2QualityPassed", "g2CompletionCriteriaIncludesQuality", "g2ResultsCenterQualityVisible",
    "g2QualityDetailsVisible", "g2ArtifactOpenWorks",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`G2 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  const quality = result?.details?.g2DeliverableReport?.quality;
  if (quality?.goldenFactsExpected !== 5 || quality?.goldenFactsMatched !== 5 || quality?.goldenFactCoverage !== 100) {
    throw new Error(`G2 golden fact accounting mismatch: ${JSON.stringify(quality)}`);
  }
  const reportText = readFileSync(join(workspacePath, "mentor-report.md"), "utf8");
  for (const heading of ["# 导师版研究结果更新报告", "## 摘要", "## 方法", "## 结果", "## 限制", "## 来源"]) {
    if (!reportText.includes(heading)) throw new Error(`G2 report omitted ${heading}.`);
  }
}

function assertD3TaskDepthDiagnostics(result) {
  if (requestCount !== 3 || completionRequests.length !== 3) throw new Error(`D3 expected three Agent requests, received ${requestCount}.`);
  const expectedDepths = ["quick", "standard", "deep"];
  for (let index = 0; index < expectedDepths.length; index += 1) {
    const body = completionRequests[index]?.body;
    const depth = expectedDepths[index];
    const prompt = String(body?.messages?.[0]?.content || "");
    if (body?.metadata?.execution_depth !== depth) throw new Error(`D3 request ${index + 1} depth mismatch.`);
    if (!prompt.includes(`执行深度：${depth === "quick" ? "快速" : depth === "standard" ? "标准" : "深入"}`)) throw new Error(`D3 ${depth} prompt omitted selected depth.`);
    if (!prompt.includes("不能只改变文字长度") || !prompt.includes("材料覆盖") || !prompt.includes("检查深度") || !prompt.includes("交付物")) {
      throw new Error(`D3 ${depth} prompt omitted the structural depth contract.`);
    }
    if (body?.metadata?.source !== "windows-agent-run-workspace") throw new Error(`D3 ${depth} did not originate from the visible Agent workspace.`);
  }
  const prompts = completionRequests.map((item) => String(item.body?.messages?.[0]?.content || ""));
  if (!prompts[0].includes("最相关的材料") || !prompts[0].includes("一次核心事实或一致性检查")) throw new Error("D3 quick contract is incomplete.");
  if (!prompts[1].includes("覆盖全部已提供材料") || !prompts[1].includes("结构化报告与来源清单")) throw new Error("D3 standard contract is incomplete.");
  if (!prompts[2].includes("独立方法复核") || !prompts[2].includes("证据附录") || !prompts[2].includes("风险及待研究问题清单")) throw new Error("D3 deep contract is incomplete.");
  for (const check of [
    "bridge", "login", "gatewayReady", "agentWorkspaceVisible", "depthSelectorVisible",
    "defaultDepthStandard", "threeDepthsVisible", "estimatedTimesVisible", "outputDifferencesExplained",
    "notLengthOnlyExplained", "allDepthSelectionsApplied", "threeRunsCompleted", "quickUsesFocusedMaterial",
    "standardCoversAllMaterials", "standardChecksSources", "deepCoversAllMaterials",
    "deepPerformsIndependentReview", "deliverablesDiffer", "deepHasEvidenceAndRiskDeliverables", "differencesAreStructural",
  ]) {
    if (!result?.checks?.[check]) throw new Error(`D3 packaged check failed: ${check}`);
  }
}

function assertD5PlanAdjustmentDiagnostics(result) {
  if (requestCount !== 1 || !requestBody) throw new Error(`D5 expected one Agent request, received ${requestCount}.`);
  if (requestBody?.metadata?.source !== "windows-agent-run-workspace") throw new Error("D5 did not originate from the visible Agent workspace.");
  if (requestBody?.metadata?.execution_depth !== "standard") throw new Error("D5 did not preserve the default standard depth.");
  const requiredChecks = [
    "bridge", "login", "gatewayReady", "agentWorkspaceVisible", "planAdjustmentEventReceived",
    "adjustmentVisibleDuringRun", "runReachedTerminalEvent", "taskNotMarkedComplete", "adjustmentPersisted",
    "failedStepExplained", "reasonExplained", "replacementExplained", "impactExplained",
    "visibleAdjustmentComplete", "failedStepMarkedAdjusted", "failedStepNotCompleted",
    "partialArtifactRegistered", "partialReportTransparent", "completionCardSaysPartial",
    "incompleteCriteriaRecorded", "impactInRemainingRisks", "noFalseCompleteClaim",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`D5 packaged check failed: ${check}`);
  }
  const reportText = readFileSync(join(appHome, "partial-research-report.md"), "utf8");
  if (!reportText.includes("study-b.md 数据源不可用") || !reportText.includes("无法形成完整的成本争议结论")) {
    throw new Error("D5 partial report hid the missing source impact.");
  }
}

function assertD2EditPlanDiagnostics(result) {
  if (requestCount !== 1 || !requestBody) throw new Error(`D2 expected one Agent request, received ${requestCount}.`);
  const prompt = String(requestBody?.messages?.[0]?.content || "");
  const plan = requestBody?.metadata?.execution_plan;
  const expectedTitles = [
    "核对新数据、结果图与报告内容一致",
    "读取旧报告、最新数据和结果图",
    "生成保留原文件的导师版报告",
    "必须有引用",
  ];
  if (!Array.isArray(plan) || JSON.stringify(plan.map((step) => step.title)) !== JSON.stringify(expectedTitles)) {
    throw new Error(`D2 gateway plan mismatch: ${JSON.stringify(plan)}`);
  }
  if (plan.map((step) => step.phase).join(",") !== "check,input,output,check") throw new Error("D2 gateway phase order mismatch.");
  if (prompt.includes("更新报告中的数字、文字和图表关系")) throw new Error("D2 deleted step leaked into the execution prompt.");
  let lastIndex = -1;
  for (const title of expectedTitles) {
    const index = prompt.indexOf(title);
    if (index <= lastIndex) throw new Error(`D2 prompt did not preserve edited order at: ${title}`);
    lastIndex = index;
  }
  if (!prompt.includes("只执行列出的步骤") || !prompt.includes("不得恢复已删除步骤")) throw new Error("D2 execution contract is missing.");
  if (requestBody?.metadata?.source !== "windows-agent-run-workspace") throw new Error("D2 did not originate from the visible Agent workspace.");
  if (!Array.isArray(requestBody?.metadata?.files) || requestBody.metadata.files.length !== 0) throw new Error("D2 file metadata is invalid.");
  const requiredChecks = [
    "bridge", "login", "gatewayReady", "agentWorkspaceVisible", "initialPlanHasFourSteps",
    "planStepDeleted", "planOrderChanged", "citationRequirementAdded", "submitEnabled", "runCompleted",
    "editedPlanPersisted", "deletedStepNotExecuted", "editedOrderExecuted",
    "editedPlanVisibleCompleted", "citationRequirementInResult", "artifactRegistered",
  ];
  for (const check of requiredChecks) {
    if (!result?.checks?.[check]) throw new Error(`D2 packaged check failed: ${check}`);
  }
  if (readFileSync(join(appHome, "old-report.md"), "utf8") !== "# 旧报告\n\n样本量：100；平均值：42。\n") {
    throw new Error("D2 executed the deleted report-update step and changed old-report.md.");
  }
  const reportText = readFileSync(join(appHome, "edited-plan-report.md"), "utf8");
  if (!reportText.includes("## 引用") || !reportText.includes("[1]")) throw new Error("D2 result did not honor the citation requirement.");
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
      let depthArtifacts = [];
      try {
        body = await readJsonBody(req);
        requestBody = body;
        requestCount += 1;
        completionRequests.push({ body, idempotencyKey: req.headers["idempotency-key"] });
        if (scenario === "d3-depth") {
          const depth = body?.metadata?.execution_depth;
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : appHome;
          depthArtifacts = buildD3DepthArtifacts(depth);
          for (const artifact of depthArtifacts) {
            writeFileSync(join(runWorkspace, artifact.path), artifact.content, "utf8");
            sideEffectCount += 1;
          }
        } else if (scenario === "d5-plan-adjustment") {
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : appHome;
          writeFileSync(join(runWorkspace, "partial-research-report.md"), [
            "# 多材料综合：部分结果",
            "",
            "study-b.md 数据源不可用，本次仅使用 study-a.md 与 study-c.md。",
            "",
            "## 当前可确认",
            "study-a.md 提示短期记忆表现改善；study-c.md 指出长期稳定性证据不足。",
            "",
            "## 未完成",
            "由于缺少 study-b.md，无法形成完整的成本争议结论。数据源恢复后需要重新核对。",
            "",
          ].join("\n"), "utf8");
          sideEffectCount += 1;
        } else if (scenario === "g3-output-versions") {
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : workspacePath;
          const versions = buildG3OutputVersions();
          for (const artifact of versions) writeFileSync(join(runWorkspace, artifact.path), artifact.content, "utf8");
          sideEffectCount += 1;
        } else if (scenario === "g5-local-edit") {
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : workspacePath;
          const action = body?.metadata?.edit_action;
          if (action === "simplify_text") writeFileSync(join(runWorkspace, "局部修改报告-edited.md"), g5EditedReport(), "utf8");
          else if (action === "sort_table_numeric") writeFileSync(join(runWorkspace, "排序数据-edited.csv"), g5EditedCsv(), "utf8");
          else if (action === "log_scale_image") writeFileSync(join(runWorkspace, "坐标图-edited.png"), g5EditedImage());
          else throw new Error(`Unsupported G5 edit action: ${String(action)}`);
          sideEffectCount += 1;
        } else if (scenario === "g6-chart-consistency") {
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : workspacePath;
          const valid = body?.metadata?.source_artifact_id === "g6-valid";
          writeFileSync(join(runWorkspace, valid ? "正确图表数据-chart.svg" : "矛盾图表数据-chart.svg"), valid ? g6ValidSvg() : g6InvalidSvg(), "utf8");
          sideEffectCount += 1;
        } else if (isAnalysisRouteScenario) {
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : workspacePath;
          if (body?.metadata?.source !== "windows-results-center-analysis-route") throw new Error("I4 request did not use the analysis-route product action.");
          writeFileSync(join(runWorkspace, "cern-wlcg-bandwidth-anomaly-first-route.svg"), g6AlternativeRouteSvg(), "utf8");
          sideEffectCount += 1;
        } else if (scenario === "i6-external-conflict") {
          if (body?.metadata?.source !== "i6-external-modifier") throw new Error("I6 external modification did not use the isolated test actor.");
          const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : workspacePath;
          externalEditCount += 1;
          writeFileSync(join(runWorkspace, "cern-capacity-notes.md"), i6ExternalContent(externalEditCount), "utf8");
          sideEffectCount += 1;
        } else if (sideEffectCount === 0) {
          sideEffectCount += 1;
          if (scenario === "d2-edit-plan") {
            const runWorkspace = typeof body?.work_dir === "string" ? body.work_dir : appHome;
            writeFileSync(join(runWorkspace, "edited-plan-report.md"), [
              "# 修改后计划执行记录",
              "",
              "已按用户调整后的顺序核对结果、读取材料并形成执行记录。",
              "已删除的报告更新步骤没有执行，old-report.md 保持原样。",
              "",
              "## 引用",
              "[1] old-report.md；[2] latest-data.csv；[3] result.png。",
              "",
            ].join("\n"), "utf8");
          } else {
            writeFileSync(join(workspacePath, "user-work.txt"), "user work before agent\nagent change\n", "utf8");
            writeFileSync(join(workspacePath, "agent-created.txt"), "created by agent\n", "utf8");
          if (scenario === "completion-criteria") {
            writeFileSync(join(workspacePath, "mentor-report.md"), "# 给导师的更新报告\n\n样本量已由 100 更新为 160，平均值由 42 更新为 47。\n\n## 检查\n\n数字与最新数据一致；结果图仍需导师确认。\n", "utf8");
          }
          if (scenario === "g2-deliverable-report") {
            writeFileSync(join(workspacePath, "mentor-report.md"), [
              "# 导师版研究结果更新报告",
              "",
              "## 摘要",
              "本报告使用 latest-data.csv 更新 old-report.md：样本量由 100 增至 160，平均值由 42 增至 47，并结合 result.png 核对结果。",
              "",
              "## 方法",
              "读取 old-report.md 的历史基线，解析 latest-data.csv 中 sample_size,100,160 与 mean,42,47 两行数据，再检查 result.png 是否与更新方向一致。",
              "",
              "## 结果",
              "样本量从 100 更新为 160；平均值从 42 更新为 47。新版本保留旧报告用于复核。",
              "",
              "![更新结果图](result.png)",
              "",
              "## 限制",
              "result.png 仅用于结果方向核对，当前数据不足以解释变化原因；最终措辞仍需导师确认。",
              "",
              "## 来源",
              "- [旧报告 old-report.md](old-report.md)",
              "- [最新数据 latest-data.csv](latest-data.csv)",
              "- [结果图 result.png](result.png)",
              "",
            ].join("\n"), "utf8");
          }
          if (scenario === "continuous-task") {
            writeFileSync(join(workspacePath, "research-synthesis.md"), [
              "# 多材料研究综合报告",
              "",
              "## 共识",
              "study-a.md 与 study-b.md 均报告短期记忆表现改善。",
              "",
              "## 争议",
              "成本判断存在冲突：study-a.md 判断为低成本，study-b.md 判断为高成本。",
              "",
              "## 下一步研究问题",
              "长期稳定性仍缺乏充分证据，应扩大样本并延长随访（study-c.md）。",
              "",
              "## 不确定性与限制",
              "现有材料未采用统一成本口径，且长期观察不足，当前不能断言长期效果。",
              "",
              "## 来源",
              "- study-a.md：结论",
              "- study-b.md：结果",
              "- study-c.md：限制",
              "",
            ].join("\n"), "utf8");
          }
          }
        }
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
      if (scenario === "d5-plan-adjustment") {
        res.write(`data: ${JSON.stringify({
          plan_adjustment: {
            id: "missing-study-b",
            failed_step_id: "step-2",
            failed_step_title: "比较材料并整理共识、争议和证据缺口",
            reason: "study-b.md 数据源暂时不可用",
            replacement_step_title: "仅使用 study-a.md 和 study-c.md 形成部分综合，并保留证据缺口",
            impact: "无法核对成本争议的另一方证据，成本结论不完整",
            completeness: "partial",
            timestamp: "2026-07-15T10:00:00.000Z",
          },
        })}\n\n`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      }
      res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(scenario === "business-progress"
        ? "fake-agent-run: multi-material synthesis"
        : scenario === "d2-edit-plan"
          ? "fake-agent-run: edited plan followed with citations"
        : scenario === "d3-depth"
          ? `fake-agent-run: ${body?.metadata?.execution_depth || "standard"} depth completed`
        : scenario === "d5-plan-adjustment"
          ? "已使用可用材料生成部分结果；缺失数据源的影响已记录。"
        : scenario === "continuous-task"
          ? "fake-agent-run: continuous research synthesis"
        : scenario === "completion-criteria" || scenario === "g2-deliverable-report"
          ? "fake-agent-run: mentor report updated and checked"
        : scenario === "g3-output-versions"
          ? "fake-agent-run: five audience-specific versions generated and checked"
        : scenario === "g5-local-edit"
          ? "fake-agent-run: selected scope edited into a new version"
        : scenario === "g6-chart-consistency"
          ? "fake-agent-run: chart generated for automatic data consistency review"
        : isAnalysisRouteScenario
          ? "fake-agent-run: independent anomaly-first route generated while preserving the original"
        : scenario === "i6-external-conflict"
          ? "fake-external-program: CERN notes changed outside the protected editor"
          : "fake-agent-run: write a short plan")}},"index":0}]}\n\n`);
      if (scenario === "business-progress") {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
        res.write('data: {"file_event":{"action":"create","path":"analysis-summary.md"}}\n\n');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      }
      if (scenario === "completion-criteria" || scenario === "g2-deliverable-report") {
        res.write('data: {"file_event":{"action":"artifact","path":"mentor-report.md","name":"mentor-report.md"}}\n\n');
      }
      if (scenario === "continuous-task") {
        res.write('data: {"file_event":{"action":"artifact","path":"research-synthesis.md","name":"research-synthesis.md"}}\n\n');
      }
      if (scenario === "d2-edit-plan") {
        res.write('data: {"file_event":{"action":"artifact","path":"edited-plan-report.md","name":"edited-plan-report.md"}}\n\n');
      }
      if (scenario === "d3-depth") {
        for (const artifact of depthArtifacts) {
          res.write(`data: {"file_event":{"action":"artifact","path":${JSON.stringify(artifact.path)},"name":${JSON.stringify(artifact.path)}}}\n\n`);
        }
      }
      if (scenario === "d5-plan-adjustment") {
        res.write('data: {"file_event":{"action":"artifact","path":"partial-research-report.md","name":"partial-research-report.md"}}\n\n');
      }
      if (scenario === "g3-output-versions") {
        for (const artifact of buildG3OutputVersions()) {
          res.write(`data: {"file_event":{"action":"artifact","path":${JSON.stringify(artifact.path)},"name":${JSON.stringify(artifact.path)}}}\n\n`);
        }
      }
      if (scenario === "g5-local-edit") {
        const action = body?.metadata?.edit_action;
        const artifactPath = action === "simplify_text" ? "局部修改报告-edited.md" : action === "sort_table_numeric" ? "排序数据-edited.csv" : "坐标图-edited.png";
        res.write(`data: {"file_event":{"action":"artifact","path":${JSON.stringify(artifactPath)},"name":${JSON.stringify(artifactPath)}}}\n\n`);
      }
      if (scenario === "g6-chart-consistency") {
        const artifactPath = body?.metadata?.source_artifact_id === "g6-valid" ? "正确图表数据-chart.svg" : "矛盾图表数据-chart.svg";
        res.write(`data: {"file_event":{"action":"artifact","path":${JSON.stringify(artifactPath)},"name":${JSON.stringify(artifactPath)}}}\n\n`);
      }
      if (isAnalysisRouteScenario) {
        res.write('data: {"file_event":{"action":"artifact","path":"cern-wlcg-bandwidth-anomaly-first-route.svg","name":"cern-wlcg-bandwidth-anomaly-first-route.svg"}}\n\n');
      }
      if (scenario === "network-recovery" && requestCount === 1) {
        res.write('data: {"file_event":{"action":"modify","path":"user-work.txt"}}\n\n');
        outageStartedAt = Date.now();
        setTimeout(() => res.destroy(), 100);
        return;
      }
      if (scenario === "network-recovery" && Date.now() - outageStartedAt < outageMs) {
        res.destroy();
        return;
      }
      if (scenario === "network-recovery") {
        res.write('data: {"file_event":{"action":"modify","path":"user-work.txt"}}\n\n');
        res.write('data: {"choices":[{"delta":{"content":" after recovery"},"index":0}]}\n\n');
      }
      if (scenario !== "default") {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1800));
      }
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
  const expectedTask = scenario === "background-close" || scenario === "minimized-notification"
    ? "write a short plan api_key=secret-notification-token analyst@example.com"
    : scenario === "d1-plan-g2"
      ? "帮我看看这份数据有没有问题。"
      : scenario === "d1-plan-g3"
        ? "综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。"
        : scenario === "d1-plan-g4"
          ? "把最新数据更新进旧报告，生成给导师看的版本。"
    : scenario === "business-progress"
      ? "综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。"
      : scenario === "continuous-task"
        ? "综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。"
      : scenario === "completion-criteria" || scenario === "g2-deliverable-report"
        ? "认真检查后再给我：把最新数据更新进旧报告，生成给导师看的版本。"
      : "write a short plan";
  if (body?.messages?.[0]?.content !== expectedTask) throw new Error("agent run task mismatch");
  if (body?.metadata?.source !== "e2e-agent-run") throw new Error("agent run metadata source mismatch");
  if (body?.metadata?.desktop_request_id !== "e2e-agent-run-request-0001") throw new Error("agent run desktop request id mismatch");
  if (body?.metadata?.run_id !== "e2e-agent-run-run-0001") throw new Error("agent run run id mismatch");
  if (body?.metadata?.desktop_request_id === body?.metadata?.run_id) throw new Error("agent run request id collapsed into run id");
  if (body?.thread_id === body?.metadata?.desktop_request_id || body?.thread_id === body?.metadata?.run_id) {
    throw new Error("agent run thread id collapsed into request/run id");
  }
  if (body?.metadata?.team_config?.preset !== "general-collaboration") throw new Error("agent run team config mismatch");
  const files = body?.metadata?.files;
  const expectedFiles = scenario === "business-progress"
    ? ["paper-a.md", "paper-b.md", "data.csv"]
    : scenario === "d1-plan-g2"
      ? ["experiment.csv", "experiment.xlsx"]
      : scenario === "d1-plan-g3"
        ? ["study-a.md", "study-b.md", "study-c.md"]
        : scenario === "d1-plan-g4"
          ? ["old-report.md", "latest-data.csv", "result.png"]
    : scenario === "completion-criteria" || scenario === "g2-deliverable-report"
      ? ["old-report.md", "latest-data.csv", "result.png"]
      : scenario === "continuous-task"
        ? ["study-a.md", "study-b.md", "study-c.md"]
    : ["C:\\OpenDrSai\\fixtures\\notes.md"];
  if (!Array.isArray(files) || files.length !== expectedFiles.length) throw new Error("agent run files metadata missing");
  if (!files.every((file, index) => file?.kind === "file" && file?.path === expectedFiles[index])) {
    throw new Error(`agent run file metadata mismatch: ${JSON.stringify(files)}`);
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
  const expectedRequestCount = scenario === "network-recovery" ? 2 : 1;
  if ((scenario === "network-recovery" ? requestCount < expectedRequestCount : requestCount !== expectedRequestCount) || !requestBody) {
    throw new Error(`E2E agent run request count was invalid: ${requestCount}.`);
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
  if (scenario === "network-recovery") {
    const keys = new Set(completionRequests.map((item) => item.idempotencyKey));
    const chunks = events.filter((event) => event.type === "chunk").map((event) => event.content || "").join("");
    const statuses = events.filter((event) => event.type === "status").map((event) => event.content || "").join("\n");
    const fileEvents = events.filter((event) => event.type === "file_event");
    if (keys.size !== 1 || !completionRequests[0]?.idempotencyKey) throw new Error("Network recovery changed the idempotency key.");
    if (!completionRequests.some((item) => Number(item.body?.metadata?.network_retry_attempt) > 0)) throw new Error("Network recovery did not mark retry attempts.");
    if (!completionRequests.some((item) => Number(item.body?.metadata?.resume_from_chars) > 0)) throw new Error("Network recovery did not send a resume offset.");
    if (chunks !== "fake-agent-run: write a short plan after recovery") throw new Error(`Recovered output was duplicated or missing: ${chunks}`);
    if (!statuses.includes("网络连接中断") || !statuses.includes("网络已恢复")) throw new Error(`Recovery statuses missing: ${statuses}`);
    if (fileEvents.length !== 1) throw new Error(`File side effect event was duplicated ${fileEvents.length} times.`);
    if (sideEffectCount !== 1) throw new Error(`Gateway side effect executed ${sideEffectCount} times.`);
    if (Date.now() - outageStartedAt < outageMs) throw new Error("The configured outage duration was not exercised.");
  }
  if (scenario === "business-progress") {
    for (const check of [
      "agentBusinessProgressObserverInstalled",
      "agentBusinessProgressWorkspaceVisible",
      "agentBusinessProgressAllEventsReceived",
      "agentBusinessProgressAllStagesVisible",
      "agentBusinessProgressWithinTwoSeconds",
      "agentBusinessProgressMatchesRunState",
      "agentBusinessProgressUsesBusinessLanguage",
      "agentBusinessProgressNoTechnicalNoise",
      "agentBusinessProgressNotRawOutputOnly",
      "agentBusinessProgressG3Task",
    ]) {
      if (!result?.checks?.[check]) {
        throw new Error(`E1 Agent business-progress check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
      }
    }
  }
  if (scenario === "completion-criteria") {
    for (const check of [
      "agentBusinessProgressWorkspaceVisible",
      "d6CompletionNotificationAvailable",
      "d6CompletionNotificationClicked",
      "d6CompletionCardVisible",
      "d6ExplainsWorkDone",
      "d6ChecksPassedVisible",
      "d6IncompleteVisible",
      "d6RemainingRisksVisible",
      "d6ArtifactRegistered",
      "d6NotOnlyTaskComplete",
      "d6NoRawRunOutput",
      "d6MatchesCompletedTask",
    ]) {
      if (!result?.checks?.[check]) throw new Error(`D6 completion-criteria check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
    }
  }
  if (scenario === "continuous-task") {
    for (const check of [
      "agentBusinessProgressWorkspaceVisible",
      "d4SingleRunCompleted",
      "d4AllIntermediateStepsRecorded",
      "d4NoNonCriticalApproval",
      "d4NoPendingDecision",
      "d4ArtifactRegistered",
      "d4CompleteReportGenerated",
      "d4GoldenConsensus",
      "d4GoldenDispute",
      "d4GoldenNextQuestion",
      "d4BusinessStepsNoTechnicalNoise",
      "i1AgentBeforeAfterPair",
      "i1AgentVersionMetadata",
      "i1AgentNewReportInDiff",
      "i1AgentBeforeRestoreRemovesReport",
      "i1AgentAfterRestoreReturnsReport",
    ]) {
      if (!result?.checks?.[check]) throw new Error(`D4 continuous-task check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
    }
  }
  if (scenario.startsWith("d1-plan-")) {
    for (const check of [
      "agentBusinessProgressWorkspaceVisible",
      "d1PlanPersisted",
      "d1RequiredPhasesCovered",
      "d1SemanticCoverageAtLeast90",
      "d1NoForbiddenTerms",
      "d1PlanVisibleInUi",
      "d1UiMatchesStoredPlan",
      "d1AllStepsCompleted",
    ]) {
      if (!result?.checks?.[check]) throw new Error(`D1 structured-plan check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
    }
  }
  if (scenario === "background-close") {
    for (const check of [
      "nativeWindowCloseIntercepted",
      "windowHiddenDuringBackgroundWork",
      "backgroundCompletedWhileWindowHidden",
      "persistedBackgroundTaskComplete",
      "secondInstanceLaunched",
      "windowReopenedAfterBackgroundCompletion",
      "inMemoryRunStatePreserved",
      "agentRunThreadIdleAfterReopen",
      "agentRunInUnifiedBackgroundQueue",
      "backgroundQueueCompleted",
      "backgroundQueuePreservedSteps",
      "awayFailureSeeded",
      "awayPendingDecisionSeeded",
      "awaySummaryPrioritizedOnReturn",
      "awaySummaryHasThreeStructuredRegions",
      "awaySummaryContainsCompletedTask",
      "awaySummaryContainsFailedTask",
      "awaySummaryContainsPendingDecision",
      "awaySummarySensitiveTextRedacted",
      "awaySummaryContinueVisible",
      "awaySummaryContinueOpenedApprovalCenter",
      "awaySummaryContinueLocatedPendingEvent",
      "windowsNotificationShownInAwayState",
      "windowsNotificationSummaryRedacted",
      "singleCompletionNotification",
      "duplicateCompletionNotificationSuppressed",
      "notificationClickTriggered",
      "notificationClickFocusedApp",
      "notificationClickReachedRenderer",
      "notificationClickTargetsCorrectTask",
      "completionNotificationsDisabled",
      "disabledCompletionNotificationPreferenceRespected",
      "agentRunRestoreApproved",
      "agentRunBaselineRestored",
    ]) {
      if (!result?.checks?.[check]) {
        throw new Error(`E2E Agent background-close check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
      }
    }
  }
  if (scenario === "minimized-notification") {
    for (const check of [
      "windowMinimizedDuringBackgroundWork",
      "backgroundCompletedWhileWindowMinimized",
      "persistedBackgroundTaskComplete",
      "windowsNotificationShownInAwayState",
      "windowsNotificationSummaryRedacted",
      "singleCompletionNotification",
      "duplicateCompletionNotificationSuppressed",
      "windowAwayBeforeNotificationClick",
      "notificationClickTriggered",
      "notificationClickFocusedApp",
      "notificationClickReachedRenderer",
      "notificationClickTargetsCorrectTask",
      "completionNotificationsDisabled",
      "disabledCompletionNotificationPreferenceRespected",
      "agentRunBaselineRestored",
    ]) {
      if (!result?.checks?.[check]) {
        throw new Error(`E2E Agent minimized-notification check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
      }
    }
  }
}

function buildD3DepthArtifacts(depth) {
  if (depth === "quick") {
    return [{
      path: "quick-findings.md",
      content: [
        "# 快速结论",
        "",
        "材料覆盖：1/3（study-a.md）。",
        "",
        "## 核心检查",
        "研究 A 的短期记忆改善结论在其结论段中有明确表述。",
        "",
        "## 核心结论与下一步建议",
        "现有材料提示短期改善；下一步应补充长期随访。",
        "",
      ].join("\n"),
    }];
  }
  if (depth === "standard") {
    return [
      {
        path: "standard-report.md",
        content: [
          "# 标准综合报告",
          "",
          "材料覆盖：3/3（study-a.md、study-b.md、study-c.md）。",
          "",
          "## 关键依据核对",
          "study-a.md 与 study-b.md 均支持短期记忆改善；两者对实施成本的判断冲突。study-c.md 指出长期稳定性证据不足。",
          "",
          "## 结构化报告",
          "共识、争议与下一步研究问题已经分别整理。",
          "",
        ].join("\n"),
      },
      {
        path: "standard-sources.md",
        content: "# 来源清单\n\n- study-a.md：短期改善、低成本\n- study-b.md：短期改善、高成本\n- study-c.md：长期证据不足\n",
      },
    ];
  }
  if (depth === "deep") {
    return [
      {
        path: "deep-report.md",
        content: [
          "# 深入综合报告",
          "",
          "材料覆盖：3/3（study-a.md、study-b.md、study-c.md）。",
          "",
          "## 逐项核对",
          "逐项核对了短期效果、实施成本和长期稳定性三项主要结论。",
          "",
          "## 冲突与不确定性",
          "study-a.md 与 study-b.md 对实施成本的判断冲突；study-c.md 表明长期效果仍不确定。",
          "",
          "## 独立复核",
          "按结论反向检索三份材料，复核结果与首次综合一致。",
          "",
        ].join("\n"),
      },
      {
        path: "deep-evidence-appendix.md",
        content: "# 证据附录\n\n- 短期改善 → study-a.md、study-b.md\n- 成本冲突 → study-a.md 对照 study-b.md\n- 长期证据不足 → study-c.md\n",
      },
      {
        path: "deep-risk-list.md",
        content: "# 风险与待研究问题清单\n\n1. 成本口径未统一。\n2. 长期随访不足。\n3. 需要扩大样本并预注册验证方案。\n",
      },
    ];
  }
  throw new Error(`Unsupported D3 execution depth: ${String(depth)}`);
}

function buildG3OutputVersions() {
  const factsZh = "源成果：mentor-report.md。样本量由 100 增至 160，平均值由 42 增至 47。";
  const factsEn = "Source result: mentor-report.md. The sample size increased from 100 to 160, and the mean increased from 42 to 47.";
  return [
    {
      path: "mentor-report-one-page-summary.md",
      content: ["# 一页摘要", "", "## 关键发现", factsZh, "", "## 建议", "向导师确认结果措辞，并进一步研究变化原因。", ""].join("\n"),
    },
    {
      path: "mentor-report-full-report.md",
      content: ["# 完整报告", "", "## 摘要", factsZh, "", "## 方法", "核对历史报告与最新数据。", "", "## 结果", factsZh, "", "## 限制", "变化原因仍需进一步研究。", "", "## 来源", "mentor-report.md", ""].join("\n"),
    },
    {
      path: "mentor-report-presentation-outline.md",
      content: ["# PPT 提纲", "", "## 幻灯片 1｜关键更新", `讲述要点：${factsZh}`, "", "## 幻灯片 2｜下一步", "讲述要点：向导师确认措辞并研究变化原因。", ""].join("\n"),
    },
    {
      path: "mentor-report-email.md",
      content: ["# 邮件", "", "主题：研究结果更新", "", "老师您好：", "", factsZh, "", "行动请求：请确认结果措辞，并告知是否需要补充分析。", ""].join("\n"),
    },
    {
      path: "mentor-report-english.md",
      content: ["# Mentor Update", "", "## Executive Summary", factsEn, "", "## Methods", "We checked the historical report against the latest data.", "", "## Results", factsEn, "", "## Limitations", "The cause of the changes still requires further study.", "", "## Sources", "mentor-report.md", ""].join("\n"),
    },
  ];
}

function zipLocalEntry(name, contents) {
  const nameBuffer = Buffer.from(name, "utf8");
  const data = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  return Buffer.concat([header, nameBuffer, data]);
}

function writeG4PreviewFixtures(targetWorkspace) {
  const cernFixture = "C:\\tmp\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
  const fallbackPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Length 34>>stream\nBT (G4 CERN PDF preview) Tj ET\nendstream\nendobj\n%%EOF\n", "latin1");
  writeFileSync(join(targetWorkspace, "CERN 摘要.pdf"), existsSync(cernFixture) ? readFileSync(cernFixture) : fallbackPdf);
  writeFileSync(join(targetWorkspace, "导师报告.docx"), Buffer.concat([
    zipLocalEntry("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>G4 Word preview body</w:t></w:r></w:p></w:body></w:document>'),
  ]));
  writeFileSync(join(targetWorkspace, "实验数据.csv"), "metric,old,new\nsample_size,100,160\nmean,42,47\n", "utf8");
  writeFileSync(join(targetWorkspace, "结果图.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  writeFileSync(join(targetWorkspace, "研究总结.md"), "# G4 Markdown preview\n\n样本量从 100 增至 160，平均值从 42 增至 47。\n", "utf8");
}

function writeG5LocalEditFixtures(targetWorkspace) {
  writeFileSync(join(targetWorkspace, "局部修改报告.md"), g5SourceReport(), "utf8");
  writeFileSync(join(targetWorkspace, "排序数据.csv"), g5SourceCsv(), "utf8");
  writeFileSync(join(targetWorkspace, "坐标图.png"), g5SourceImage());
  writeFileSync(join(targetWorkspace, "其他成果.md"), "# 其他成果\n\n不得改变。\n", "utf8");
}

function writeG6ChartFixtures(targetWorkspace) {
  writeFileSync(join(targetWorkspace, "正确图表数据.csv"), g6Csv(), "utf8");
  writeFileSync(join(targetWorkspace, "矛盾图表数据.csv"), g6Csv(), "utf8");
}

function writeI4AnalysisRouteFixtures(targetWorkspace) {
  const sourcePdf = "C:\\tmp\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
  if (!existsSync(sourcePdf)) throw new Error(`CERN I4 fixture is missing: ${sourcePdf}`);
  const pdfBytes = readFileSync(sourcePdf);
  const pdfHash = createHash("sha256").update(pdfBytes).digest("hex").toUpperCase();
  if (pdfHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("CERN I4 fixture SHA-256 changed.");
  copyFileSync(sourcePdf, join(targetWorkspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"));
  writeFileSync(join(targetWorkspace, "cern-wlcg-bandwidth.csv"), g6Csv(), "utf8");
  writeFileSync(join(targetWorkspace, "cern-wlcg-bandwidth-chart.svg"), g6ValidSvg(), "utf8");
  for (const args of [
    ["init"],
    ["config", "user.email", "i4-acceptance@opendrsai.local"],
    ["config", "user.name", "OpenDrSai I4 Acceptance"],
    ["add", "."],
    ["commit", "-m", "CERN analysis route baseline"],
  ]) {
    const completed = spawnSync("git", ["-C", targetWorkspace, ...args], { encoding: "utf8", windowsHide: true });
    if (completed.status !== 0) throw new Error(`Could not create I4 protected baseline: git ${args.join(" ")}\n${completed.stderr}`);
  }
}

function writeI6ExternalConflictFixtures(targetWorkspace) {
  const sourcePdf = "C:\\tmp\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
  if (!existsSync(sourcePdf)) throw new Error(`CERN I6 fixture is missing: ${sourcePdf}`);
  const pdfBytes = readFileSync(sourcePdf);
  const pdfHash = createHash("sha256").update(pdfBytes).digest("hex").toUpperCase();
  if (pdfHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("CERN I6 fixture SHA-256 changed.");
  copyFileSync(sourcePdf, join(targetWorkspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"));
  writeFileSync(join(targetWorkspace, "cern-capacity-notes.md"), [
    "# CERN 容量复核笔记", "", "App 初始版本：等待用户补充。", "CERN p.42：4.8 Tbps 与 9.6 Tbps。", "CERN p.43：2027 50%，2029 100% 待确认。", "",
  ].join("\n"), "utf8");
  writeFileSync(join(targetWorkspace, "i6-external-trigger.txt"), "ready\n", "utf8");
  for (const args of [
    ["init"],
    ["config", "user.email", "i6-acceptance@opendrsai.local"],
    ["config", "user.name", "OpenDrSai I6 Acceptance"],
    ["add", "."],
    ["commit", "-m", "CERN external conflict baseline"],
  ]) {
    const completed = spawnSync("git", ["-C", targetWorkspace, ...args], { encoding: "utf8", windowsHide: true });
    if (completed.status !== 0) throw new Error(`Could not create I6 protected baseline: git ${args.join(" ")}\n${completed.stderr}`);
  }
}

function runPackagedApp({ appHome, resultPath, workspacePath }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: isAnalysisRouteScenario || scenario === "i6-external-conflict" ? process.env.PATH : systemPath,
        DRSAI_HOME: appHome,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_AGENT_RUN: "1",
        OPENDRSAI_E2E_AGENT_RUN_SCENARIO: scenario,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_SCREENSHOT: evidenceScreenshot,
        OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
        OPENDRSAI_E2E_WORKSPACE_PATH: workspacePath,
        OPENDRSAI_E2E_G4_SAVE_DIR: scenario === "g4-preview-download" ? g4SaveDirectory : undefined,
        OPENDRSAI_E2E_I6_SAVE_DIR: scenario === "i6-external-conflict" ? i6SaveDirectory : undefined,
        OPENDRSAI_E2E_TIMEOUT_MS: scenario === "network-recovery" ? "120000" : scenario === "i6-external-conflict" ? "90000" : "45000",
        OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS: scenario === "network-recovery" ? "90000" : undefined,
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
    }, scenario === "network-recovery" ? 140_000 : scenario === "i6-external-conflict" ? 105_000 : 60_000);
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
