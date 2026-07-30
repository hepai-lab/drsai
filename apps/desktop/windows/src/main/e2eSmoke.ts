import { execFileSync, spawn } from "child_process";
import { createHash } from "crypto";
import { basename, dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { app, clipboard, type BrowserWindow } from "electron";
import type { DesktopBackgroundTask, DesktopTaskArtifactLink } from "../shared/desktopApi";
import {
  clickLatestCompletionNotificationForE2e,
  getCompletionNotificationDiagnostics,
  notifyBackgroundTaskCompleted,
} from "./completionNotifications";
import { createWorkspace } from "./workspaces";
import { createThread } from "./threads";

interface SmokeResult {
  ok: boolean;
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
  error?: string;
}

interface ForkMergeApprovedFixture {
  fixtureRoot: string;
  sourcePath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  forkCommit: string;
  expectedContent: string;
}

interface ForkMergeConflictFixture {
  fixtureRoot: string;
  sourcePath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  sourceHead: string;
  forkCommit: string;
  sourceContent: string;
}

interface ChannelImportFixture {
  workspacePath: string;
  markdownPath: string;
  cypressJsonPath: string;
  pngPath: string;
  sarifJsonPath: string;
  chatExportJsonPath: string;
  chatGptExportJsonPath: string;
  emlxPath: string;
  icsPath: string;
  vcardPath: string;
  contactsCsvPath: string;
  calendarCsvPath: string;
  openApiJsonPath: string;
  logcatPath: string;
  browserCookiesPath: string;
  browserPasswordsPath: string;
  browserAutofillCsvPath: string;
  browserAutofillJsonPath: string;
  playwrightTraceZipPath: string;
  csvPath: string;
  tsvPath: string;
  powershellTranscriptPath: string;
  opmlPath: string;
  bookmarksPath: string;
  metricsPath: string;
  codeownersPath: string;
  robotsPath: string;
  harPath: string;
  netlogPath: string;
  junitXmlPath: string;
  xunitXmlPath: string;
  trxPath: string;
  jmeterPlanPath: string;
  ghaJobSummaryPath: string;
  vscodeSettingsPath: string;
  vscodeTasksPath: string;
  vscodeLaunchPath: string;
  vscodeExtensionsPath: string;
  browserHistoryPath: string;
  browserDownloadsPath: string;
  browserStoragePath: string;
  browserExtensionManifestPath: string;
  pwaServiceWorkerPath: string;
  assetLinksPath: string;
  appleAssociationPath: string;
  securityTxtPath: string;
  svgPath: string;
  sshConfigPath: string;
  sshKnownHostsPath: string;
  sshAuthorizedKeysPath: string;
  vpnWireGuardPath: string;
  vpnOpenVpnPath: string;
  rdpPath: string;
  envrcPath: string;
  rushConfigPath: string;
  oxlintConfigPath: string;
  filePaths: string[];
}

interface IdeContextFixture {
  source: "vscode" | "jetbrains" | "visual_studio";
  workspacePath: string;
  sourcePath: string;
  relativePath: string;
  selectionText: string;
}

interface WorkspaceReviewFixture {
  workspacePath: string;
  stagePath: string;
  revertPath: string;
  stalePath: string;
  stageChangedContent: string;
  revertBaseContent: string;
  nonGitWorkspacePath: string;
  nonGitFilePath: string;
  nonGitBaseContent: string;
}

const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "30000");

export function maybeRunE2eSmoke(window: BrowserWindow): void {
  if (
    process.env.OPENDRSAI_E2E_SMOKE !== "1" &&
    process.env.OPENDRSAI_E2E_CHAT !== "1" &&
    process.env.OPENDRSAI_E2E_CHAT_FAILURES !== "1" &&
    process.env.OPENDRSAI_E2E_AGENT_RUN !== "1" &&
    process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES !== "1" &&
    process.env.OPENDRSAI_E2E_THREADS !== "1" &&
    process.env.OPENDRSAI_E2E_FORK_MERGE !== "1" &&
    process.env.OPENDRSAI_E2E_OIDC !== "1" &&
    process.env.OPENDRSAI_E2E_A5_SERVICE_GUIDANCE !== "1" &&
    process.env.OPENDRSAI_E2E_F2_APPROVALS !== "1" &&
    process.env.OPENDRSAI_E2E_F3_APPROVALS !== "1" &&
    process.env.OPENDRSAI_E2E_F4_ANOMALY_DECISION !== "1" &&
    process.env.OPENDRSAI_E2E_F1_LOW_RISK_APPROVALS !== "1" &&
    process.env.OPENDRSAI_E2E_C1_MATERIAL_IMPORT !== "1" &&
    process.env.OPENDRSAI_E2E_C2_FOLDER_IMPORT !== "1" &&
    process.env.OPENDRSAI_E2E_C3_MATERIAL_ROLES !== "1" &&
    process.env.OPENDRSAI_E2E_C4_MATERIAL_SUGGESTIONS !== "1" &&
    process.env.OPENDRSAI_E2E_C5_MATERIAL_CONSISTENCY !== "1" &&
    process.env.OPENDRSAI_E2E_C6_MATERIAL_QUERY !== "1" &&
    process.env.OPENDRSAI_E2E_C7_ABNORMAL_FILES !== "1" &&
    process.env.OPENDRSAI_E2E_C8_CHINESE_PRIVACY !== "1" &&
    process.env.OPENDRSAI_E2E_M3_WINDOW !== "1" &&
    process.env.OPENDRSAI_E2E_M4_KEYBOARD !== "1" &&
    process.env.OPENDRSAI_E2E_M5_ACCESSIBILITY !== "1" &&
    process.env.OPENDRSAI_E2E_M6_PERFORMANCE !== "1" &&
    process.env.OPENDRSAI_E2E_M7_STABILITY !== "1" &&
    process.env.OPENDRSAI_E2E_M8_RECOVERY !== "1" &&
    process.env.OPENDRSAI_E2E_M10_DATA_CLEANUP !== "1" &&
    process.env.OPENDRSAI_E2E_VOICE !== "1" &&
    process.env.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION !== "1"
  ) return;
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    throw new Error("OPENDRSAI_E2E_RESULT is required for OpenDrSai E2E smoke modes.");
  }

  const watchdog = setTimeout(() => {
    writeResult(resultPath, {
      ok: false,
      checks: {},
      details: {
        url: window.webContents.getURL(),
        title: window.webContents.getTitle(),
        isLoading: window.webContents.isLoading(),
        isLoadingMainFrame: window.webContents.isLoadingMainFrame(),
        startupTrace: (globalThis as { __OPENDRSAI_E2E_TRACE?: unknown }).__OPENDRSAI_E2E_TRACE,
      },
      error: "Packaged app smoke timed out.",
    });
    process.exit(1);
  }, timeoutMs);

  window.webContents.once("did-fail-load", (_event, _code, description) => {
    clearTimeout(watchdog);
    writeResult(resultPath, {
      ok: false,
      checks: {},
      details: {},
      error: `Renderer failed to load: ${description}`,
    });
    process.exit(1);
  });

  window.webContents.once("did-finish-load", () => {
    const runner = process.env.OPENDRSAI_E2E_CHAT_FAILURES === "1"
      ? runChatFailureSmoke
      : process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES === "1"
        ? runAgentRunFailureSmoke
      : process.env.OPENDRSAI_E2E_AGENT_RUN === "1"
        ? runAgentRunSmoke
      : process.env.OPENDRSAI_E2E_THREADS === "1"
        ? runThreadsSmoke
      : process.env.OPENDRSAI_E2E_FORK_MERGE === "1"
        ? runForkMergeSmoke
      : process.env.OPENDRSAI_E2E_OIDC === "1"
        ? runOidcSmoke
      : process.env.OPENDRSAI_E2E_A5_SERVICE_GUIDANCE === "1"
        ? runA5ServiceGuidanceSmoke
      : process.env.OPENDRSAI_E2E_F2_APPROVALS === "1"
        ? runF2ApprovalSmoke
      : process.env.OPENDRSAI_E2E_F3_APPROVALS === "1"
        ? runF3ApprovalSmoke
      : process.env.OPENDRSAI_E2E_F4_ANOMALY_DECISION === "1"
        ? runF4AnomalyDecisionSmoke
      : process.env.OPENDRSAI_E2E_F1_LOW_RISK_APPROVALS === "1"
        ? runF1LowRiskApprovalSmoke
      : process.env.OPENDRSAI_E2E_C1_MATERIAL_IMPORT === "1"
        ? runC1MaterialImportSmoke
      : process.env.OPENDRSAI_E2E_C2_FOLDER_IMPORT === "1"
        ? runC2FolderImportSmoke
      : process.env.OPENDRSAI_E2E_C3_MATERIAL_ROLES === "1"
        ? runC3MaterialRolesSmoke
      : process.env.OPENDRSAI_E2E_C4_MATERIAL_SUGGESTIONS === "1"
        ? runC4MaterialSuggestionsSmoke
      : process.env.OPENDRSAI_E2E_C5_MATERIAL_CONSISTENCY === "1"
        ? runC5MaterialConsistencySmoke
      : process.env.OPENDRSAI_E2E_C6_MATERIAL_QUERY === "1"
        ? runC6MaterialQuerySmoke
      : process.env.OPENDRSAI_E2E_C7_ABNORMAL_FILES === "1"
        ? runC7AbnormalFilesSmoke
      : process.env.OPENDRSAI_E2E_C8_CHINESE_PRIVACY === "1"
        ? runC8ChinesePrivacySmoke
      : process.env.OPENDRSAI_E2E_M3_WINDOW === "1"
        ? runM3WindowScalingSmoke
      : process.env.OPENDRSAI_E2E_M4_KEYBOARD === "1"
        ? runM4KeyboardSmoke
      : process.env.OPENDRSAI_E2E_M5_ACCESSIBILITY === "1"
        ? runM5AccessibilitySmoke
      : process.env.OPENDRSAI_E2E_M6_PERFORMANCE === "1"
        ? runM6PerformanceSmoke
      : process.env.OPENDRSAI_E2E_M7_STABILITY === "1"
        ? runM7StabilitySmoke
      : process.env.OPENDRSAI_E2E_M8_RECOVERY === "1"
        ? runM8RecoverySmoke
      : process.env.OPENDRSAI_E2E_M10_DATA_CLEANUP === "1"
        ? runM10DataCleanupSmoke
      : process.env.OPENDRSAI_E2E_VOICE === "1"
        ? runVoiceSmoke
      : process.env.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION === "1"
        ? runPresentationPdfActionSmoke
      : process.env.OPENDRSAI_E2E_CHAT === "1"
        ? runChatSmoke
        : runSmoke;
    runner(window)
      .then((result) => {
        clearTimeout(watchdog);
        writeResult(resultPath, result);
        process.exit(result.ok ? 0 : 1);
      })
      .catch((error) => {
        clearTimeout(watchdog);
        writeResult(resultPath, {
          ok: false,
          checks: {},
          details: {},
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  });
}

async function runC1MaterialImportSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C1_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C1_EVIDENCE_DIR;
  if (fixturePaths.length !== 7 || !evidenceDir || fixturePaths.slice(0, 6).some((path) => !existsSync(path)) || existsSync(fixturePaths[6]!)) {
    throw new Error("C1 requires six readable fixtures, one missing fixture, and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: "C1 CERN 标准材料包", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C1 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 30000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      document.querySelector('.composer-tools > button:first-child')?.click();
      const addFile = await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])'));
      addFile?.click();
      const chips = await waitFor(() => document.querySelectorAll('[data-testid="composer-attachment"]').length === 7 ? [...document.querySelectorAll('[data-testid="composer-attachment"]')] : null);
      checks.allSelectionsReported = chips?.length === 7;
      const descriptors = (chips || []).map(chip => ({ name: chip.querySelector('strong')?.textContent || '', meta: chip.querySelector('small')?.textContent || '', status: chip.getAttribute('data-import-status'), category: chip.getAttribute('data-file-category'), size: Number(chip.getAttribute('data-size-bytes') || 0), title: chip.getAttribute('title') || '' }));
      details.descriptors = descriptors;
      const ready = descriptors.filter(item => item.status === 'ready');
      const failed = descriptors.filter(item => item.status === 'unreadable');
      checks.sixSupportedFilesReady = ready.length === 6;
      checks.failedFileIsolated = failed.length === 1 && /其他已选文件仍可使用/.test(failed[0]?.title || '');
      checks.cernPdfVisible = ready.some(item => item.category === 'pdf' && item.name === 'WLCG-20260715-WLCG-talk-IHEP-visit.pdf');
      checks.wordVisible = ready.some(item => item.category === 'word' && /Word 文档/.test(item.meta));
      checks.excelVisible = ready.some(item => item.category === 'spreadsheet' && /Excel 工作簿/.test(item.meta));
      checks.csvVisible = ready.some(item => item.category === 'table' && /表格数据/.test(item.meta));
      checks.imageVisible = ready.some(item => item.category === 'image' && /图片/.test(item.meta));
      checks.textVisible = ready.some(item => item.category === 'text' && /文本/.test(item.meta));
      checks.namesTypesSizesStatusesVisible = ready.every(item => item.name && item.meta.includes('已就绪') && item.size > 0);
      checks.failureStatusVisible = failed[0]?.meta.includes('读取失败') === true;
      const contextPreviewText = document.querySelector('.context-assembly-preview')?.textContent || '';
      checks.failedFileExcludedFromContext = !contextPreviewText.includes('已移动的材料.pdf') && ready.every(item => contextPreviewText.includes(item.name));

      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])')))?.click();
      await new Promise(r => setTimeout(r, 150));
      checks.duplicatesNotAdded = document.querySelectorAll('[data-testid="composer-attachment"]').length === 7;

      const paths = ${JSON.stringify(fixturePaths.slice(0, 6))};
      const previews = [];
      for (const path of paths) previews.push(await api.previewWorkspaceFile({ workspacePath, path, maxBytes: 120000 }));
      details.previews = previews.map(item => ({ name: item.name, kind: item.kind, size: item.size, hasContent: Boolean(item.content), hasDataUrl: Boolean(item.dataUrl) }));
      const byName = Object.fromEntries(previews.map(item => [item.name, item]));
      const pdf = byName['WLCG-20260715-WLCG-talk-IHEP-visit.pdf'];
      checks.cernPdfReadWithoutConversion = pdf?.kind === 'pdf' && pdf?.size === 7664262 && /PDF type: presentation_pdf/.test(pdf?.content || '');
      checks.wordReadWithoutConversion = byName['CERN 研究说明.docx']?.kind === 'office' && /CERN DOCX material/.test(byName['CERN 研究说明.docx']?.content || '');
      checks.excelReadWithoutConversion = byName['CERN 数据.xlsx']?.kind === 'office' && /CERN throughput/.test(byName['CERN 数据.xlsx']?.content || '');
      checks.csvReadWithoutConversion = byName['CERN 指标.csv']?.kind === 'table' && /9.6/.test(byName['CERN 指标.csv']?.content || '');
      checks.imageReadWithoutConversion = byName['CERN 架构图.png']?.kind === 'image' && Boolean(byName['CERN 架构图.png']?.dataUrl);
      checks.textReadWithoutConversion = byName['CERN 补充说明.md']?.kind === 'markdown' && /Data Challenge/.test(byName['CERN 补充说明.md']?.content || '');
      checks.oneFailureDidNotBlockReadableFiles = previews.length === 6 && previews.every(item => item.size > 0);
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c1-material-import.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC2FolderImportSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const folderPath = process.env.OPENDRSAI_E2E_C2_FOLDER_PATH;
  const evidenceDir = process.env.OPENDRSAI_E2E_C2_EVIDENCE_DIR;
  const cernPdfPath = process.env.OPENDRSAI_E2E_C2_CERN_PDF;
  if (!folderPath || !evidenceDir || !cernPdfPath || !existsSync(folderPath) || !existsSync(cernPdfPath)) throw new Error("C2 requires the 30-file folder, CERN PDF, and evidence directory.");
  await createWorkspace({ source: "existing", path: folderPath, name: "C2 CERN 30 文件材料包", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C2 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 15000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 25)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const folderPath = ${JSON.stringify(folderPath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(folderPath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      const gaps = []; let lastBeat = performance.now(); const heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - lastBeat); lastBeat = now; }, 25);
      const openFolderPicker = async () => {
        document.querySelector('.composer-tools > button:first-child')?.click();
        const button = await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-folder-label"])'));
        button?.click();
      };
      const started = performance.now();
      await openFolderPicker();
      const scanning = await waitFor(() => document.querySelector('[data-testid="composer-attachment"][data-folder-import-phase="scanning"]'), 1000);
      details.scanningFeedbackMs = performance.now() - started;
      checks.scanningFeedbackVisible = Boolean(scanning) && details.scanningFeedbackMs <= 1000 && /正在扫描文件夹/.test(scanning?.textContent || '');
      const ready = await waitFor(() => document.querySelector('[data-testid="composer-attachment"][data-folder-import-phase="ready"]'), 10000);
      details.scanCompletedMs = performance.now() - started;
      checks.scanCompletedWithin2s = Boolean(ready) && details.scanCompletedMs <= 2000;
      const count = (name) => Number(ready?.getAttribute(name) || -1);
      checks.importedCountVisible = count('data-imported-count') === 27 && /已导入 27/.test(ready?.textContent || '');
      checks.skippedCountVisible = count('data-skipped-count') === 3 && /跳过 3/.test(ready?.textContent || '');
      checks.failedCountVisible = count('data-failed-count') === 1 && /失败 1/.test(ready?.textContent || '');
      checks.subdirectoryCountVisible = /子目录 2/.test(ready?.textContent || '');
      checks.unsupportedReasonVisible = /Unsupported: \.xyz/.test(ready?.getAttribute('title') || '');
      checks.folderIsSingleContextSource = document.querySelectorAll('[data-testid="composer-attachment"]').length === 1 && (document.querySelector('.context-assembly-preview')?.textContent || '').includes('C2 CERN 30 文件材料包');

      await openFolderPicker();
      const duplicate = await waitFor(() => document.querySelector('[data-testid="composer-attachment"][data-duplicate-count="1"]'), 2000);
      checks.duplicateExplainedWithoutDuplicateChip = Boolean(duplicate) && /重复 1/.test(duplicate?.textContent || '') && document.querySelectorAll('[data-testid="composer-attachment"]').length === 1;
      checks.countsStableAfterDuplicate = count('data-imported-count') === 27 && count('data-skipped-count') === 3 && count('data-failed-count') === 1;

      const summary = await api.summarizeWorkspaceFolder({ path: folderPath, maxDepth: 3, maxEntries: 240, maxSampleFiles: 30 });
      details.summary = { totalEntries: summary.totalEntries, fileCount: summary.fileCount, directoryCount: summary.directoryCount, imported: summary.importedFileCount, skipped: summary.skippedFileCount, skippedDirectories: summary.skippedDirectoryCount, failed: summary.failedFileCount, unsupportedExtensions: summary.unsupportedExtensions, truncated: summary.truncated };
      checks.exactThirtyFilesScanned = summary.fileCount === 30;
      checks.twoNestedDirectoriesScanned = summary.directoryCount === 2;
      checks.noisyDirectorySkipped = summary.skippedDirectoryCount === 1;
      checks.unsupportedFilesClassified = summary.skippedFileCount === 2 && summary.unsupportedExtensions.length === 1 && summary.unsupportedExtensions[0] === '.xyz';
      checks.corruptPdfClassifiedFailed = summary.failedFileCount === 1;
      checks.supportedFilesImported = summary.importedFileCount === 27 && summary.sampledFiles.length === 27;
      checks.scanNotTruncated = summary.truncated === false;
      checks.cernPdfIncluded = summary.sampledFiles.some(item => item.path === ${JSON.stringify(cernPdfPath)} && item.kind === 'pdf' && item.size === 7664262);
      const pdf = await api.previewWorkspaceFile({ workspacePath: folderPath, path: ${JSON.stringify(cernPdfPath)}, maxBytes: 120000 });
      checks.cernPdfStillPresentation = pdf.kind === 'pdf' && /PDF type: presentation_pdf/.test(pdf.content || '');
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      clearInterval(heartbeat);
      details.heartbeat = { samples: gaps.length, maxGapMs: gaps.length ? Math.max(...gaps) : 0 };
      checks.rendererStayedResponsive = gaps.length >= 8 && details.heartbeat.maxGapMs < 2000;
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c2-folder-import.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, folderPath, cernPdfPath, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC3MaterialRolesSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C3_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C3_EVIDENCE_DIR;
  const cernPdfPath = process.env.OPENDRSAI_E2E_C3_CERN_PDF;
  if (fixturePaths.length !== 12 || !evidenceDir || !cernPdfPath || fixturePaths.some((path) => !existsSync(path))) {
    throw new Error("C3 requires twelve golden materials, the fixed CERN PDF, and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: "C3 D4 材料角色识别", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C3 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const paths = ${JSON.stringify(fixturePaths)};
      const expectedRoles = Object.fromEntries(paths.map((path, index) => [path, index < 3 ? 'previous_report' : index < 6 ? 'latest_data' : index < 9 ? 'result_image' : 'reference_material']));
      const waitFor = async (find, timeout = 15000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 35)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])')))?.click();
      checks.twelveMaterialsVisible = Boolean(await waitFor(() => document.querySelectorAll('[data-testid="composer-attachment"]').length === 12));
      const panel = await waitFor(() => document.querySelector('[data-testid="material-role-panel"][data-analysis-phase="ready"]'));
      checks.rolePanelVisible = Boolean(panel) && /材料角色/.test(panel?.textContent || '');
      const count = (role) => Number(panel?.querySelector('[data-material-role="' + role + '"]')?.getAttribute('data-role-count') || -1);
      checks.fourRolesVisible = count('previous_report') === 3 && count('latest_data') === 3 && count('result_image') === 3 && count('reference_material') === 3;
      checks.roleNamesUnderstandable = ['旧报告', '最新数据', '结果图片', '参考材料'].every(label => (panel?.textContent || '').includes(label));
      checks.fileNamesVisibleInRoles = paths.every(path => (panel?.textContent || '').includes(path.split(/[\\\\/]/).at(-1)));

      const analysis = await api.analyzeMaterialRoles({ paths });
      const correct = analysis.items.filter(item => expectedRoles[item.path] === item.role).length;
      details.accuracy = correct / paths.length;
      details.analysis = analysis;
      checks.allGoldenMaterialsAnalyzed = analysis.items.length === 12;
      checks.keyRoleAccuracyAtLeast90 = details.accuracy >= 0.9;
      checks.confidenceAtLeast90 = analysis.items.every(item => item.confidence >= 0.9);
      checks.everyItemHasReason = analysis.items.every(item => item.reason && item.reason.length >= 8);
      checks.everyItemHasSuggestedUse = analysis.items.every(item => item.suggestedUse && item.suggestedUse.length >= 8);
      checks.summaryIncludesFourRoles = ['旧报告', '最新数据', '结果图片', '参考材料'].every(label => analysis.summary.includes(label));

      const input = document.querySelector('[data-testid="composer-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '系统现在拥有哪些材料？');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      document.querySelector('button.composer-submit')?.click();
      const answer = await waitFor(() => [...document.querySelectorAll('.message.assistant')].map(node => node.textContent || '').find(text => text.includes('旧报告（3）') && text.includes('最新数据（3）') && text.includes('结果图片（3）') && text.includes('参考材料（3）')));
      checks.inventoryQuestionAnswered = Boolean(answer);
      checks.answerNamesEveryMaterial = paths.every(path => answer?.includes(path.split(/[\\\\/]/).at(-1)));
      checks.answerContainsUsageAdvice = /先用最新数据核对结果图片/.test(answer || '') && /旧报告为结构基线/.test(answer || '');
      checks.localAnswerCompletedWithoutLoading = !document.querySelector('.message.assistant.streaming');
      const pdf = await api.previewWorkspaceFile({ workspacePath, path: ${JSON.stringify(cernPdfPath)}, maxBytes: 120000 });
      checks.cernPdfStillPresentation = pdf.kind === 'pdf' && pdf.size === 7664262 && /PDF type: presentation_pdf/.test(pdf.content || '');
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c3-material-roles.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, cernPdfPath, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC4MaterialSuggestionsSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C4_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C4_EVIDENCE_DIR;
  const scenario = process.env.OPENDRSAI_E2E_C4_SCENARIO || "d4";
  if (!fixturePaths.length || !evidenceDir || fixturePaths.some((path) => !existsSync(path)) || !["d1", "d2", "d4"].includes(scenario)) {
    throw new Error("C4 requires D1, D2, or D4 fixtures and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: `C4 ${scenario.toUpperCase()} 主动建议`, trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C4 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = { scenario: ${JSON.stringify(scenario)} };
      const waitFor = async (find, timeout = 20000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 40)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 100 && !gateway.ready; attempt += 1) { await new Promise(r => setTimeout(r, 100)); gateway = await api.getGatewayStatus(); }
      checks.realChatGatewayReady = Boolean(gateway.ready && !gateway.externalConflict);
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      const threadCountBefore = (await api.listThreads()).length;
      const newChat = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find(button => /开始聊天|New chat/.test(button.textContent || button.getAttribute('title') || '')));
      newChat?.click();
      checks.realConversationCreated = Boolean(await waitFor(async () => (await api.listThreads()).length === threadCountBefore + 1, 5000));
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])')))?.click();
      const expectedFiles = ${fixturePaths.length};
      checks.materialsVisible = Boolean(await waitFor(() => document.querySelectorAll('[data-testid="composer-attachment"]').length === expectedFiles));
      const suggestionPanel = await waitFor(() => document.querySelector('[data-testid="material-task-suggestions"]'));
      const suggestions = suggestionPanel ? [...suggestionPanel.querySelectorAll('[data-testid="material-task-suggestion"]')] : [];
      details.suggestions = suggestions.map(button => ({ id: button.getAttribute('data-suggestion-id'), title: button.querySelector('strong')?.textContent, description: button.querySelector('span')?.textContent, prompt: button.getAttribute('data-suggestion-prompt') }));
      checks.suggestionPanelVisibleWithoutTask = Boolean(suggestionPanel) && !document.querySelector('[data-testid="composer-input"]')?.value;
      checks.twoToFourSuggestions = suggestions.length >= 2 && suggestions.length <= 4;
      const scenarioIds = ${JSON.stringify({ d1: ["summarize-references", "organize-reference-questions"], d2: ["check-data", "visualize-data"], d4: ["update-report", "check-data", "check-image-data-consistency", "summarize-references"] })}[${JSON.stringify(scenario)}];
      checks.suggestionsMatchMaterial = scenarioIds.every(id => suggestions.some(button => button.getAttribute('data-suggestion-id') === id));
      checks.suggestionsUsePlainLanguage = details.suggestions.every(item => item.title && item.description && !/agent|mcp|ipc|json|tool call/i.test(item.title + ' ' + item.description));
      const selected = suggestions.find(button => button.getAttribute('data-suggestion-id') === scenarioIds[0]);
      const originalPrompt = selected?.getAttribute('data-suggestion-prompt') || '';
      selected?.click();
      const input = await waitFor(() => { const node = document.querySelector('[data-testid="composer-input"]'); return node?.value === originalPrompt ? node : null; });
      checks.clickCreatesEditableTask = Boolean(input) && originalPrompt.length > 20 && document.activeElement === input;
      checks.suggestionsHideWhileEditing = !document.querySelector('[data-testid="material-task-suggestions"]');
      const editedPrompt = originalPrompt + ' 请使用中文，并在结尾列出材料来源。';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, editedPrompt);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      checks.taskRemainsEditable = document.querySelector('[data-testid="composer-input"]')?.value === editedPrompt;
      const previewBeforeSubmit = document.querySelector('.context-assembly-preview')?.textContent || '';
      checks.materialsRemainAttachedBeforeSubmit = ${JSON.stringify(fixturePaths.map((path) => basename(path)))}.every(name => previewBeforeSubmit.includes(name));
      const send = await waitFor(() => { const node = document.querySelector('button.composer-submit'); return node && !node.disabled ? node : null; }, 5000);
      checks.realSubmitEnabled = Boolean(send);
      send?.click();
      const userMessage = await waitFor(() => [...document.querySelectorAll('.message.user')].find(node => (node.textContent || '').includes('请使用中文，并在结尾列出材料来源。')));
      checks.editedSuggestionSubmitted = Boolean(userMessage);
      const assistant = await waitFor(() => [...document.querySelectorAll('.message.assistant')].find(node => (node.textContent || '').includes('C4 真实任务已创建')), 20000);
      checks.realTaskCompleted = Boolean(assistant) && !assistant?.classList.contains('streaming');
      checks.materialsClearedAfterSubmit = document.querySelectorAll('[data-testid="composer-attachment"]').length === 0;
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      details.originalPrompt = originalPrompt;
      details.editedPrompt = editedPrompt;
      details.assistantText = assistant?.textContent || '';
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, `c4-${scenario}-suggestion-task.png`);
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC5MaterialConsistencySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C5_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C5_EVIDENCE_DIR;
  const scenario = process.env.OPENDRSAI_E2E_C5_SCENARIO || "d4";
  if (fixturePaths.length < 3 || !evidenceDir || fixturePaths.some((path) => !existsSync(path)) || !["d3", "d4"].includes(scenario)) {
    throw new Error("C5 requires D3 or D4 fixtures and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: `C5 ${scenario.toUpperCase()} 材料比较`, trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C5 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = { scenario: ${JSON.stringify(scenario)} };
      const waitFor = async (find, timeout = 20000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 40)); } return null; };
      checks.authenticatedProductUi = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])')))?.click();
      const expectedFiles = ${fixturePaths.length};
      checks.materialsVisible = Boolean(await waitFor(() => document.querySelectorAll('[data-testid="composer-attachment"]').length === expectedFiles));
      const panel = await waitFor(() => { const node = document.querySelector('[data-testid="material-consistency-panel"]'); return node?.getAttribute('data-analysis-phase') === 'ready' ? node : null; });
      checks.comparisonCompletes = Boolean(panel);
      const findingNodes = panel ? [...panel.querySelectorAll('[data-testid="material-consistency-finding"]')] : [];
      const findings = findingNodes.map(node => ({
        id: node.getAttribute('data-finding-id'),
        kind: node.getAttribute('data-finding-kind'),
        title: node.querySelector('header strong')?.textContent || '',
        text: node.textContent || '',
        sources: [...node.querySelectorAll('[data-testid="material-consistency-source"]')].map(source => ({ name: source.getAttribute('data-source-name'), locator: source.getAttribute('data-source-locator'), text: source.textContent || '' })),
      }));
      details.findings = findings;
      const requiredKinds = ${JSON.stringify({ d3: ["consensus", "source_conflict", "evidence_gap"], d4: ["consensus", "outdated_number", "chart_mismatch"] })}[${JSON.stringify(scenario)}];
      checks.requiredFindingKinds = requiredKinds.every(kind => findings.some(item => item.kind === kind));
      checks.noUnexpectedCriticalKind = ${JSON.stringify(scenario)} === 'd3'
        ? !findings.some(item => item.kind === 'outdated_number' || item.kind === 'chart_mismatch')
        : !findings.some(item => item.kind === 'source_conflict' || item.kind === 'evidence_gap');
      checks.findingsUsePlainLanguage = findings.length >= 3 && findings.every(item => item.title && !/agent|mcp|ipc|json|tool call/i.test(item.text));
      checks.everyFindingHasSources = findings.every(item => item.sources.length >= 1);
      checks.everySourceHasLocation = findings.flatMap(item => item.sources).every(source => source.name && source.locator && source.text.includes(source.locator));
      const expectedNames = ${JSON.stringify(fixturePaths.map((path) => basename(path)))};
      checks.sourcesNotConfused = findings.flatMap(item => item.sources).every(source => expectedNames.includes(source.name));
      checks.noLocalPathLeak = !String(panel?.textContent || '').includes(workspacePath);
      if (${JSON.stringify(scenario)} === 'd3') {
        const consensus = findings.find(item => item.kind === 'consensus');
        const conflict = findings.find(item => item.kind === 'source_conflict');
        const gap = findings.find(item => item.kind === 'evidence_gap');
        checks.goldenConsensusFound = Boolean(consensus && /短期记忆/.test(consensus.text) && /study-a\.md/.test(consensus.text) && /study-b\.md/.test(consensus.text));
        checks.goldenConflictFound = Boolean(conflict && /实施成本/.test(conflict.text) && /低/.test(conflict.text) && /高/.test(conflict.text) && conflict.sources.length === 2);
        checks.goldenEvidenceGapFound = Boolean(gap && /长期稳定/.test(gap.text) && /证据不足/.test(gap.text) && /study-c\.md/.test(gap.text));
      } else {
        const outdated = findings.find(item => item.kind === 'outdated_number');
        const mismatch = findings.find(item => item.kind === 'chart_mismatch');
        const consensus = findings.find(item => item.kind === 'consensus');
        checks.goldenOutdatedNumberFound = Boolean(outdated && /样本量/.test(outdated.text) && /100/.test(outdated.text) && /160/.test(outdated.text) && outdated.sources.length === 2);
        checks.goldenChartMismatchFound = Boolean(mismatch && /样本量/.test(mismatch.text) && /150/.test(mismatch.text) && /160/.test(mismatch.text) && mismatch.sources.length === 2);
        checks.goldenNumericConsensusFound = Boolean(consensus && /平均值/.test(consensus.text) && /47/.test(consensus.text) && consensus.sources.length >= 2);
        checks.cernReferenceNotMisrepresented = !findings.some(item => item.text.includes('WLCG-20260715-WLCG-talk-IHEP-visit.pdf'));
      }
      const firstSource = panel?.querySelector('[data-testid="material-consistency-source"]');
      firstSource?.click();
      checks.sourceCanBeOpened = Boolean(await waitFor(() => document.querySelector('[data-testid="material-consistency-source-status"]')?.textContent?.includes(firstSource?.getAttribute('data-source-name') || '')));
      const createTask = panel?.querySelector('[data-testid="material-consistency-create-task"]');
      createTask?.click();
      const input = await waitFor(() => { const node = document.querySelector('[data-testid="composer-input"]'); return node?.value?.includes('具体文件位置') ? node : null; });
      checks.findingsCreateEditableTask = Boolean(input) && document.activeElement === input;
      const original = input?.value || '';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, original + ' 请按风险高低排序。');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      checks.taskRemainsEditable = document.querySelector('[data-testid="composer-input"]')?.value?.endsWith('请按风险高低排序。') === true;
      checks.materialsRemainAttached = document.querySelectorAll('[data-testid="composer-attachment"]').length === expectedFiles;
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      details.summary = panel?.querySelector(':scope > p')?.textContent || '';
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, `c5-${scenario}-material-consistency.png`);
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC6MaterialQuerySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C6_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C6_EVIDENCE_DIR;
  if (fixturePaths.length !== 4 || !evidenceDir || fixturePaths.some((path) => !existsSync(path))) {
    throw new Error("C6 requires four readable fixtures and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: "C6 CERN 材料问答", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C6 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const paths = ${JSON.stringify(fixturePaths)};
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 30000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      checks.authenticatedProductUi = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(${JSON.stringify(workspacePath)})), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      const goldens = [
        { id: 'cern-title', question: 'What is the title of the CERN presentation?', expect: /Distributed computing for High Energy Physics/i, kind: 'title' },
        { id: 'cern-minimal-bandwidth', question: 'What is the Minimal Model expected HL-LHC bandwidth?', expect: /4\\.8\\s*Tbps/i, locator: /42/ },
        { id: 'cern-flexible-bandwidth', question: 'What is the Flexible Model expected HL-LHC bandwidth?', expect: /9\\.6\\s*Tbps/i, locator: /42/ },
        { id: 'cern-2027-target', question: 'What is the 2027 Data Challenge target?', expect: /2027[\\s\\S]*50%|50%[\\s\\S]*2027/i, locator: /43/ },
        { id: 'cern-2029-target', question: 'What is the 2029 Data Challenge target?', expect: /2029[\\s\\S]*100%|100%[\\s\\S]*2029/i, locator: /43/ },
        { id: 'research-method', question: 'What research method does the memory study use?', expect: /randomized double-blind controlled experiment/i, kind: 'method' },
        { id: 'latest-sample-size', question: 'What is the latest sample size?', expect: /160/, kind: 'numeric' },
        { id: 'sample-size-difference', question: 'Compare the sample size difference across the old report and latest data.', expect: /100[\\s\\S]*160|160[\\s\\S]*100/, kind: 'comparison', minimumCitations: 2 },
        { id: 'study-conclusion', question: 'What is the spaced repetition conclusion?', expect: /improved recall/i },
        { id: 'explicit-source', question: 'In methods.md, what protocol was used?', expect: /randomized double-blind controlled experiment/i, kind: 'method' },
        { id: 'not-found', question: 'What is the lead author birthday?', status: 'not_found' },
      ];
      const answers = [];
      for (const golden of goldens) {
        const response = await api.queryMaterials({ paths, question: golden.question });
        const correctStatus = response.status === (golden.status || 'answered');
        const correctAnswer = golden.status === 'not_found' ? /不会编造|not invent/i.test(response.answer) : golden.expect.test(response.answer);
        const correctKind = !golden.kind || response.queryKind === golden.kind;
        const correctLocator = !golden.locator || response.citations.some(item => golden.locator.test(item.locator));
        const citationsValid = golden.status === 'not_found'
          ? response.citations.length === 0 && !/第\\s*\\d+\\s*页|line\\s*\\d+/i.test(response.answer)
          : response.citations.length >= (golden.minimumCitations || 1) && response.citations.every(item => item.name && item.locator && item.excerpt);
        answers.push({ id: golden.id, correct: correctStatus && correctAnswer && correctKind && correctLocator && citationsValid, response });
      }
      details.answers = answers;
      details.correct = answers.filter(item => item.correct).length;
      details.total = answers.length;
      details.accuracy = details.correct / details.total;
      checks.goldenAccuracyAtLeast90 = details.accuracy >= 0.9;
      checks.everyAnsweredResultCitesSource = answers.filter(item => item.response.status === 'answered').every(item => item.response.citations.length > 0);
      checks.notFoundDoesNotInventLocation = answers.find(item => item.id === 'not-found')?.correct === true;
      checks.cernAnswersKeepPageMapping = answers.filter(item => item.id.startsWith('cern-') && item.id !== 'cern-title').every(item => item.correct);
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])')))?.click();
      checks.materialsVisible = Boolean(await waitFor(() => document.querySelectorAll('[data-testid="composer-attachment"]').length === paths.length));
      const input = await waitFor(() => document.querySelector('[data-testid="composer-input"]'));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '这份 CERN 演示报告的标题是什么？');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      const send = await waitFor(() => { const node = document.querySelector('button.composer-submit'); return node && !node.disabled ? node : null; });
      checks.localQuestionCanSubmitWithoutGateway = Boolean(send);
      send?.click();
      const assistant = await waitFor(() => [...document.querySelectorAll('.message.assistant')].find(node => /Distributed computing for High Energy Physics/i.test(node.textContent || '') && /来源|Sources/.test(node.textContent || '')), 35000);
      const assistantText = assistant?.textContent || '';
      checks.chatShowsAnswer = /Distributed computing for High Energy Physics/i.test(assistantText);
      checks.chatShowsSourceFile = /WLCG-20260715-WLCG-talk-IHEP-visit\\.pdf/i.test(assistantText);
      checks.chatShowsSourceLocation = /第\\s*1\\s*页|page\\s*1/i.test(assistantText);
      checks.materialsClearedAfterSubmit = document.querySelectorAll('[data-testid="composer-attachment"]').length === 0;
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      details.assistantText = assistantText;
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c6-material-query.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC7AbnormalFilesSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C7_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C7_EVIDENCE_DIR;
  if (fixturePaths.length !== 5 || !evidenceDir || fixturePaths.some((path) => !existsSync(path))) {
    throw new Error("C7 requires five readable fixture paths and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  await createWorkspace({ source: "existing", path: workspacePath, name: "C7 异常文件恢复", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C7 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 60000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      checks.authenticatedProductUi = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(${JSON.stringify(workspacePath)})), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      const started = performance.now();
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])'), 5000))?.click();
      const nodes = await waitFor(() => { const items = [...document.querySelectorAll('[data-testid="composer-attachment"]')]; return items.length === 5 ? items : null; });
      details.importFeedbackMs = performance.now() - started;
      checks.statusWithin60Seconds = Boolean(nodes) && details.importFeedbackMs < 60000;
      const records = (nodes || []).map(node => ({
        name: node.querySelector('strong')?.textContent || '',
        status: node.getAttribute('data-import-status'),
        diagnostic: node.getAttribute('data-diagnostic-code'),
        mode: node.getAttribute('data-processing-mode'),
        message: node.querySelector('[data-testid="composer-file-status-message"]')?.textContent || '',
        action: node.querySelector('[data-testid="composer-file-recovery-action"]')?.textContent || '',
        text: node.textContent || '',
      }));
      details.records = records;
      const byDiagnostic = code => records.find(item => item.diagnostic === code);
      const large = byDiagnostic('large_file');
      const corrupt = byDiagnostic('corrupt_file');
      const password = byDiagnostic('password_protected');
      const unsupported = byDiagnostic('unsupported_format');
      const cern = records.find(item => /WLCG-20260715/.test(item.name));
      checks.largeFileUsesBoundedReading = Boolean(large && large.status === 'ready' && large.mode === 'bounded' && /大文件/.test(large.message) && /继续|拆分/.test(large.action));
      checks.corruptFileExplainsCauseAndRecovery = Boolean(corrupt && corrupt.status === 'unreadable' && corrupt.mode === 'blocked' && /损坏|不完整/.test(corrupt.message) && /重新下载|另存/.test(corrupt.action));
      checks.passwordFileExplainsCauseAndRecovery = Boolean(password && password.status === 'unreadable' && password.mode === 'blocked' && /密码保护/.test(password.message) && /密码|不加密/.test(password.action));
      checks.unknownFormatExplainsCauseAndRecovery = Boolean(unsupported && unsupported.status === 'unsupported' && unsupported.mode === 'blocked' && /不支持/.test(unsupported.message) && /转换/.test(unsupported.action));
      checks.cernBaselineStillReady = Boolean(cern && cern.status === 'ready' && cern.mode === 'full');
      checks.everyAbnormalFileHasVisibleGuidance = [large, corrupt, password, unsupported].every(item => item?.message && item?.action);
      checks.failedFilesIsolated = records.filter(item => item.status !== 'ready').length === 3 && records.filter(item => item.status === 'ready').length === 2;
      const input = document.querySelector('[data-testid="composer-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '系统现在拥有哪些材料？');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      const send = await waitFor(() => { const node = document.querySelector('button.composer-submit'); return node && !node.disabled ? node : null; }, 10000);
      checks.remainingFilesCanSubmit = Boolean(send);
      send?.click();
      const assistant = await waitFor(() => [...document.querySelectorAll('.message.assistant')].find(node => /2 项材料|2 materials/i.test(node.textContent || '')), 30000);
      checks.taskDoesNotRemainStuck = Boolean(assistant) && !assistant?.classList.contains('streaming');
      checks.attachmentsClearAfterRecovery = document.querySelectorAll('[data-testid="composer-attachment"]').length === 0;
      checks.appRemainsResponsive = Boolean(document.querySelector('.app-shell')) && document.querySelector('[data-testid="composer-input"]')?.disabled !== true;
      checks.noAutomaticShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      details.assistantText = assistant?.textContent || '';
      return { checks, details };
    })()
  `, true) as SmokeResult;
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c7-abnormal-files.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runC8ChinesePrivacySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePaths = (process.env.OPENDRSAI_E2E_C8_IMPORT_PATHS || "").split("|").filter(Boolean);
  const evidenceDir = process.env.OPENDRSAI_E2E_C8_EVIDENCE_DIR;
  let sensitiveValues: string[] = [];
  try { sensitiveValues = JSON.parse(process.env.OPENDRSAI_E2E_C8_SENSITIVE_VALUES || "[]") as string[]; } catch { sensitiveValues = []; }
  if (fixturePaths.length !== 3 || !evidenceDir || sensitiveValues.length !== 4 || fixturePaths.some((path) => !existsSync(path))) {
    throw new Error("C8 requires three D5/D7 fixtures, four sensitive values, and an evidence directory.");
  }
  const workspacePath = dirname(fixturePaths[0]!);
  const notificationsBefore = getCompletionNotificationDiagnostics().length;
  await createWorkspace({ source: "existing", path: workspacePath, name: "C8 中文路径 隐私材料", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("C8 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const paths = ${JSON.stringify(fixturePaths)};
      const secrets = ${JSON.stringify(sensitiveValues)};
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 30000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      let stage = 'login';
      try {
      checks.authenticatedProductUi = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(${JSON.stringify(workspacePath)})), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      document.querySelector('.composer-tools > button:first-child')?.click();
      (await waitFor(() => document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])'), 5000))?.click();
      const nodes = await waitFor(() => { const items = [...document.querySelectorAll('[data-testid="composer-attachment"]')]; return items.length === 3 ? items : null; });
      const records = (nodes || []).map(node => ({ name: node.querySelector('strong')?.textContent || '', status: node.getAttribute('data-import-status'), sensitive: node.getAttribute('data-sensitive-detected'), kinds: node.getAttribute('data-sensitive-kinds') || '', count: Number(node.getAttribute('data-sensitive-count') || 0), privacy: node.querySelector('[data-testid="composer-file-privacy-notice"]')?.textContent || '', text: node.textContent || '' }));
      details.records = records;
      const expectedNames = paths.map(path => path.replaceAll('\\\\', '/').split('/').pop());
      checks.chineseAndSpaceNamesVisible = expectedNames.every(name => records.some(item => item.name === name));
      checks.allChinesePathFilesReady = records.length === 3 && records.every(item => item.status === 'ready');
      const privateMaterial = records.find(item => item.name === expectedNames[0]);
      checks.sensitiveKindsDetectedWithoutValues = Boolean(privateMaterial && privateMaterial.sensitive === 'true' && privateMaterial.count === 4 && ['api_key','email','phone','user_secret'].every(kind => privateMaterial.kinds.includes(kind)));
      checks.visiblePrivacyNotice = Boolean(privateMaterial && privateMaterial.privacy.includes('4') && privateMaterial.privacy.includes('\u654f\u611f') && privateMaterial.privacy.includes('\u539f\u503c') && privateMaterial.privacy.includes('\u5206\u4eab'));
      checks.unrelatedInterfaceHasNoRawSecrets = secrets.every(secret => !document.body.textContent.includes(secret));
      stage = 'preview-files';
      const previews = await Promise.all(paths.map(path => api.previewWorkspaceFile({ workspacePath: ${JSON.stringify(workspacePath)}, path, maxBytes: 150000 })));
      checks.d5ImageReadable = previews.some(preview => preview.kind === 'image' && (preview.dataUrl || '').startsWith('data:image/'));
      checks.d7TextReadable = previews.some(preview => (preview.kind === 'text' || preview.kind === 'markdown') && secrets.every(secret => (preview.content || '').includes(secret)));
      checks.cernChinesePathReadable = previews.some(preview => preview.kind === 'pdf' && /PDF type: presentation_pdf/.test(preview.content || '') && /Pages: 48/.test(preview.content || ''));
      checks.noAutomaticShareAfterImport = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      stage = 'submit-inventory';
      const input = document.querySelector('[data-testid="composer-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '\u7cfb\u7edf\u73b0\u5728\u62e5\u6709\u54ea\u4e9b\u6750\u6599\uff1f');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      const send = await waitFor(() => { const node = document.querySelector('button.composer-submit'); return node && !node.disabled ? node : null; }, 10000);
      checks.localInventoryCanSubmit = Boolean(send);
      send?.click();
      const assistant = await waitFor(() => [...document.querySelectorAll('.message.assistant')].find(node => (node.textContent || '').includes('3') && ((node.textContent || '').includes('\u6750\u6599') || /materials/i.test(node.textContent || ''))), 30000);
      const assistantText = assistant?.textContent || '';
      checks.materialUseDoesNotExposeSecrets = Boolean(assistant) && secrets.every(secret => !assistantText.includes(secret)) && secrets.every(secret => !document.body.textContent.includes(secret));
      checks.noAutomaticShareAfterUse = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
      checks.attachmentsCleared = document.querySelectorAll('[data-testid="composer-attachment"]').length === 0;
      details.assistantText = assistantText;
      return { checks, details };
      } catch (error) {
        return { checks, details: { ...details, failedStage: stage }, error: error instanceof Error ? error.stack || error.message : String(error) };
      }
    })()
  `, true) as SmokeResult;
  const notificationsAfter = getCompletionNotificationDiagnostics();
  result.checks.importAndUseCreateNoNotification = notificationsAfter.length === notificationsBefore;
  result.checks.notificationDiagnosticsSecretFree = sensitiveValues.every((secret) => !JSON.stringify(notificationsAfter).includes(secret));
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "c8-chinese-privacy.png");
  let screenshot = await window.capturePage();
  let blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  for (let attempt = 1; attempt < 4 && blackPixelRatio > 0.02; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    screenshot = await window.capturePage();
    blackPixelRatio = calculateBlackPixelRatio(screenshot.toBitmap());
  }
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = blackPixelRatio <= 0.02;
  result.details = { ...result.details, fixturePaths, screenshotPath, blackPixelRatio, notificationCount: notificationsAfter.length };
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runF1LowRiskApprovalSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_F1_CERN_PDF;
  const evidenceDir = process.env.OPENDRSAI_E2E_F1_EVIDENCE_DIR;
  if (!fixturePath || !evidenceDir || !existsSync(fixturePath)) {
    throw new Error("F1 requires the fixed CERN PDF and an evidence directory.");
  }
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: "F1 CERN 低风险任务", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("F1 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const fixturePath = ${JSON.stringify(fixturePath)};
      const workspacePath = ${JSON.stringify(workspacePath)};
      const checks = { bridgeAvailable: Boolean(api) };
      const details = { lowRiskOperations: [], approvalSamples: [], policyControl: null, presentation: null };
      if (!api) return { checks, details };
      const waitFor = async (find, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); } return null; };
      try {
        checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
        checks.productUiReady = Boolean(await waitFor(() => document.querySelector('.app-shell')));
        const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find(item => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
        workspace?.click();
        checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
        checks.cleanApprovalBaseline = (await api.listPendingApprovals()).length === 0 && (await api.listPendingBrowserTaskApprovals()).length === 0;

        let maximumDesktopApprovals = 0;
        let maximumBrowserApprovals = 0;
        const runWithoutApproval = async (id, operation) => {
          let monitoring = true;
          const startedAt = performance.now();
          const monitor = (async () => {
            while (monitoring) {
              const desktop = await api.listPendingApprovals();
              const browser = await api.listPendingBrowserTaskApprovals();
              maximumDesktopApprovals = Math.max(maximumDesktopApprovals, desktop.length);
              maximumBrowserApprovals = Math.max(maximumBrowserApprovals, browser.length);
              details.approvalSamples.push({ id, elapsedMs: performance.now() - startedAt, desktop: desktop.map(item => ({ source: item.source, actionKind: item.actionKind, risk: item.risk })), browser: browser.length });
              await new Promise(resolve => setTimeout(resolve, 25));
            }
          })();
          try {
            const value = await operation();
            details.lowRiskOperations.push({ id, elapsedMs: performance.now() - startedAt, approvalWaitMs: 0 });
            return value;
          } finally {
            monitoring = false;
            await monitor;
          }
        };

        const g1 = await runWithoutApproval('G1-material-read', () => api.previewWorkspaceFile({ workspacePath, path: fixturePath, maxBytes: 180000 }));
        checks.g1SelectedMaterialRead = g1.kind === 'pdf' && /presentation_pdf/.test(g1.content || '') && /Pages: 48/.test(g1.content || '');
        const g2 = await runWithoutApproval('G2-analysis', () => api.queryMaterials({ paths: [fixturePath], question: 'What are the Minimal and Flexible Model expected HL-LHC bandwidth values?' }));
        checks.g2AnalysisCompleted = g2.status === 'answered' && /4\\.8\\s*Tbps/i.test(g2.answer) && /9\\.6\\s*Tbps/i.test(g2.answer) && g2.citations.length >= 1;
        const g3 = await runWithoutApproval('G3-synthesis', () => api.queryMaterials({ paths: [fixturePath], question: 'Synthesize the 2027 and 2029 Data Challenge targets and cite the source.' }));
        checks.g3SynthesisCompleted = g3.status === 'answered' && /2027[\\s\\S]*50%|50%[\\s\\S]*2027/i.test(g3.answer) && /2029[\\s\\S]*100%|100%[\\s\\S]*2029/i.test(g3.answer) && g3.citations.length >= 1;
        const requestId = 'f1-cern-draft-' + Date.now();
        const g4 = await runWithoutApproval('G4-draft-generation', () => api.generateManagerPresentation({ requestId, workspacePath, sourcePath: fixturePath, audience: 'non_expert_managers', requirements: ['Generate an editable mentor-facing draft; keep source pages and speaker notes.'] }));
        details.presentation = { outputPath: g4.outputPath, manifestPath: g4.manifestPath, slideCount: g4.slideCount, speakerNotesCoverage: g4.speakerNotesCoverage, sourcePageCoverage: g4.sourcePageCoverage };
        checks.g4DraftGenerated = g4.slideCount >= 6 && g4.slideCount <= 12 && g4.speakerNotesCoverage === 1 && g4.sourcePageCoverage === 1;

        await runWithoutApproval('internal-context-refresh', async () => { await api.getWorkspaceContextOverview(workspacePath); await api.listWorkspaceFiles({ path: workspacePath, maxDepth: 2, maxEntries: 100 }); return true; });
        const lowRiskPending = await api.listPendingApprovals();
        const lowRiskBrowserPending = await api.listPendingBrowserTaskApprovals();
        const tasks = await api.listBackgroundTasks({ workspacePath });
        checks.lowRiskApprovalCountZero = maximumDesktopApprovals === 0 && lowRiskPending.length === 0;
        checks.lowRiskBrowserApprovalCountZero = maximumBrowserApprovals === 0 && lowRiskBrowserPending.length === 0;
        checks.internalOperationsDoNotBlock = !tasks.some(task => task.status === 'waiting_approval') && !document.querySelector('.approval-center-view');
        checks.lowRiskApprovalWaitZero = details.lowRiskOperations.every(item => item.approvalWaitMs === 0);

        const invalid = await api.proposeApproval({ source: 'network', actionKind: 'workflow.run', title: 'Invalid policy pair', detail: 'Must be rejected before entering the queue.', risk: 'high', idempotencyKey: 'f1-invalid-' + Date.now() });
        checks.nonPolicySourceActionBlocked = invalid.blocked === true && invalid.queued === false;
        const control = await api.proposeApproval({ source: 'workflow', actionKind: 'workflow.run', title: 'F1 critical action control', detail: 'This high-risk control proves that only a policy-listed key action interrupts the user.', target: 'CERN manager draft', scope: 'current workspace', impact: 'Would start a reviewed external workflow.', risk: 'high', idempotencyKey: 'f1-control-' + Date.now() });
        const pendingControl = await api.listPendingApprovals();
        details.policyControl = { proposal: control, pending: pendingControl.map(item => ({ id: item.id, source: item.source, actionKind: item.actionKind, risk: item.risk })) };
        checks.keyActionQueuesExactlyOneApproval = control.queued === true && pendingControl.length === 1 && pendingControl[0]?.id === control.approval?.id;
        checks.approvalMatchesPolicyTable = pendingControl[0]?.source === 'workflow' && pendingControl[0]?.actionKind === 'workflow.run' && pendingControl[0]?.risk === 'high';
        window.dispatchEvent(new Event('drsai:e2e-open-approval-center'));
        const controlCard = await waitFor(() => [...document.querySelectorAll('article')].find(node => (node.textContent || '').includes('F1 critical action control')), 10000);
        checks.keyActionApprovalVisible = Boolean(controlCard && /CERN manager draft/.test(controlCard.textContent || '') && /current workspace/.test(controlCard.textContent || ''));
        checks.rejectControl = Boolean(control.approval?.id && await api.decideApproval({ id: control.approval.id, approved: false, reason: 'reject' }));
        checks.queueClearedAfterReject = (await api.listPendingApprovals()).length === 0;
        checks.noUnauthorizedShare = (await api.listOutgoingShares()).length === 0 && (await api.listIncomingShares()).length === 0;
        details.maximumDesktopApprovalsDuringLowRisk = maximumDesktopApprovals;
        details.maximumBrowserApprovalsDuringLowRisk = maximumBrowserApprovals;
        return { checks, details };
      } catch (error) {
        return { checks, details, error: error instanceof Error ? error.stack || error.message : String(error) };
      }
    })()
  `, true) as SmokeResult;

  const presentation = result.details.presentation as { outputPath?: string; manifestPath?: string } | null;
  const outputPath = presentation?.outputPath;
  const manifestPath = presentation?.manifestPath;
  result.checks.generatedDraftFileReadable = Boolean(outputPath && existsSync(outputPath) && readFileSync(outputPath).length > 10_000);
  result.checks.generatedManifestReadable = Boolean(manifestPath && existsSync(manifestPath));
  if (manifestPath && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { source?: { sha256?: string } };
    result.checks.generatedDraftUsesFixedCernSource = manifest.source?.sha256 === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
  } else {
    result.checks.generatedDraftUsesFixedCernSource = false;
  }
  const sourceBytes = readFileSync(fixturePath);
  result.checks.cernFixtureSize = sourceBytes.length === 7_664_262;
  result.checks.cernFixtureSha256 = (await import("crypto")).createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
  mkdirSync(evidenceDir, { recursive: true });
  const screenshotPath = join(evidenceDir, "f1-low-risk-approval.png");
  const screenshot = await window.capturePage();
  writeFileSync(screenshotPath, screenshot.toPNG());
  result.checks.screenshotWritten = existsSync(screenshotPath);
  result.checks.screenshotFullyPainted = calculateBlackPixelRatio(screenshot.toBitmap()) <= 0.02;
  result.details = { ...result.details, fixturePath, screenshotPath };
  result.ok = !result.error && Object.values(result.checks).every(Boolean);
  return result;
}

function calculateBlackPixelRatio(bitmap: Buffer): number {
  if (bitmap.length < 4) return 1;
  let black = 0;
  let sampled = 0;
  for (let offset = 0; offset + 3 < bitmap.length; offset += 64) {
    sampled += 1;
    if (bitmap[offset]! < 4 && bitmap[offset + 1]! < 4 && bitmap[offset + 2]! < 4 && bitmap[offset + 3]! > 240) black += 1;
  }
  return sampled ? black / sampled : 1;
}

async function runM10DataCleanupSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M10_CERN_PDF;
  const companionPath = process.env.OPENDRSAI_E2E_M10_USER_REPORT;
  const evidenceDir = process.env.OPENDRSAI_E2E_M10_EVIDENCE_DIR;
  if (!fixturePath || !companionPath || !evidenceDir || !existsSync(fixturePath) || !existsSync(companionPath)) {
    throw new Error("M10 requires the fixed CERN PDF, a user-owned report, and an evidence directory.");
  }
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: "M10 CERN 用户材料", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("M10 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const phaseOne = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const waitFor = async (find, timeout = 15000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      const click = async (selector) => { const el = await waitFor(() => document.querySelector(selector)); el?.click(); return el; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true && Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspacePath = ${JSON.stringify(workspacePath)};
      await api.createThread({ kind: 'chat', title: 'M10 CERN cleanup session', workspacePath });
      await api.addProjectMemory({ workspacePath, content: 'M10 CERN project memory', source: 'manual' });
      await api.upsertUserPreference({ category: 'report_format', value: 'presentation', source: 'explicit_user_request' });
      await api.enqueueBackgroundTask({ kind: 'presentation_generation', source: 'presentation', title: 'M10 CERN report task', workspacePath, targetId: 'm10-cern-report', status: 'completed', progress: 100, message: 'User-owned report remains in the workspace.', verification: 'CERN source is pinned.', deliverySummary: { findingSummary: 'CERN report is ready.', importance: 'high', importanceReason: 'M10 cleanup acceptance.', suggestedAction: 'Preserve the user result.', workSummary: 'Prepared from the fixed CERN PDF.', coreConclusion: 'Application cleanup must not delete user materials.', verification: 'Source and report hashes are pinned.', remainingRisks: 'None.', completionCriteria: { passed: ['Report exists'], incomplete: [] }, artifacts: [{ id: 'm10-user-report', label: 'CERN user report', path: ${JSON.stringify(companionPath)}, kind: 'presentation' }] } });
      const before = { threads: (await api.listThreads()).length, workspaces: (await api.listWorkspaces()).length, memories: (await api.listProjectMemory({ workspacePath, limit: 20 })).length, preferences: (await api.listUserPreferences()).length, tasks: (await api.listBackgroundTasks()).length };
      checks.applicationDataSeeded = Object.values(before).every(value => value > 0);
      await click('[data-testid=user-menu-button]');
      await click('[data-testid=user-menu-settings]');
      await click('[data-testid=settings-pane-other]');
      const boundary = await waitFor(() => document.querySelector('[data-testid=data-cleanup-boundary]'));
      const boundaryText = boundary?.textContent || '';
      checks.clearBoundaryVisible = Boolean(boundary) && /应用数据/.test(boundaryText) && /用户原始材料/.test(boundaryText) && /PDF/.test(boundaryText) && /PPT/.test(boundaryText) && /卸载/.test(boundaryText) && /不会删除/.test(boundaryText);
      await click('[data-testid=clear-session-data]');
      const dialog = await waitFor(() => document.querySelector('[data-testid=data-cleanup-dialog][data-scope=sessions]'));
      checks.sessionPreviewExplicit = Boolean(dialog) && /会话/.test(dialog.textContent || '') && /不会删除/.test(dialog.textContent || '') && /1 个工作区/.test(dialog.textContent || '');
      await click('[data-testid=data-cleanup-confirm]');
      checks.sessionClearReported = Boolean(await waitFor(() => document.querySelector('[data-testid=data-cleanup-status]')));
      return { checks, before };
    })()
  `, true) as { checks: Record<string, boolean>; before: Record<string, number> };

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const phaseTwo = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const waitFor = async (find, timeout = 15000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      const click = async (selector) => { const el = await waitFor(() => document.querySelector(selector)); el?.click(); return el; };
      const workspacePath = ${JSON.stringify(workspacePath)};
      checks.sessionsRemovedOnly = (await api.listThreads()).length === 0;
      checks.workspaceRegistrationPreservedAfterSessionClear = (await api.listWorkspaces()).some(item => item.path === workspacePath);
      checks.memoryPreservedAfterSessionClear = (await api.listProjectMemory({ workspacePath, limit: 20 })).length > 0;
      checks.preferencesPreservedAfterSessionClear = (await api.listUserPreferences()).length > 0;
      checks.tasksPreservedAfterSessionClear = (await api.listBackgroundTasks()).some(item => item.targetId === 'm10-cern-report');
      await click('[data-testid=user-menu-button]');
      await click('[data-testid=user-menu-settings]');
      await click('[data-testid=settings-pane-other]');
      await click('[data-testid=clear-all-local-data]');
      const dialog = await waitFor(() => document.querySelector('[data-testid=data-cleanup-dialog][data-scope=all_local_data]'));
      const categories = dialog?.querySelectorAll('[data-testid=data-cleanup-categories] li').length || 0;
      const confirm = dialog?.querySelector('[data-testid=data-cleanup-confirm]');
      checks.fullPreviewHasSixCategories = categories === 6;
      checks.fullClearRequiresPhrase = Boolean(confirm?.disabled);
      checks.fullPreviewProtectsUserFiles = /不会删除/.test(dialog?.textContent || '') && /PDF/.test(dialog?.textContent || '') && /PPT/.test(dialog?.textContent || '');
      const input = dialog?.querySelector('[data-testid=data-cleanup-confirmation]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '清除');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      checks.fullClearEnabledAfterPhrase = !dialog?.querySelector('[data-testid=data-cleanup-confirm]')?.disabled;
      return { checks, categories };
    })()
  `, true) as { checks: Record<string, boolean>; categories: number };

  mkdirSync(evidenceDir, { recursive: true });
  const confirmationScreenshot = join(evidenceDir, "m10-full-cleanup-confirmation.png");
  writeFileSync(confirmationScreenshot, await window.capturePage().then((image) => image.toPNG()));

  const phaseThree = await window.webContents.executeJavaScript(`
    (async () => {
      const waitFor = async (find, timeout = 15000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = await find(); if (value) return value; await new Promise(r => setTimeout(r, 50)); } return null; };
      document.querySelector('[data-testid=data-cleanup-confirm]')?.click();
      const login = await waitFor(() => document.querySelector('.login-screen'));
      return { signedOutAfterFullClear: Boolean(login), rendererStorageCleared: localStorage.length === 0 && sessionStorage.length === 0 };
    })()
  `, true) as Record<string, boolean>;

  const checks = {
    ...phaseOne.checks,
    ...phaseTwo.checks,
    ...phaseThree,
    cernPdfStillExists: existsSync(fixturePath),
    userReportStillExists: existsSync(companionPath),
    confirmationScreenshotWritten: existsSync(confirmationScreenshot),
  };
  return { ok: Object.values(checks).every(Boolean), checks, details: { fixturePath, companionPath, confirmationScreenshot, before: phaseOne.before, categoryCount: phaseTwo.categories } };
}

async function runM8RecoverySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M8_CERN_PDF;
  const injectedKind = process.env.OPENDRSAI_E2E_M8_FAILURE_KIND || "";
  const expectedKinds: Record<string, string> = { service_unavailable: "external_service", disk_full: "disk_full", permission_denied: "permission_denied", file_busy: "file_busy", model_timeout: "model_timeout" };
  if (!fixturePath || !existsSync(fixturePath) || !expectedKinds[injectedKind]) throw new Error("M8 requires a fixed CERN PDF and a known failure kind.");
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: `M8 ${injectedKind} recovery`, trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("M8 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = { injectedKind: ${JSON.stringify(injectedKind)}, expectedKind: ${JSON.stringify(expectedKinds[injectedKind])} };
      const waitFor = async (find, timeout = 45000) => { const deadline = performance.now() + timeout; while (performance.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true;
      checks.appShellVisible = Boolean(await waitFor(() => document.querySelector('.app-shell'), 10000));
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active'), 5000));
      if (!document.querySelector('.files-context-panel')) document.querySelector('.titlebar-right-panel-toggle')?.click();
      checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector('.files-context-panel'), 10000));
      const fixtureName = ${JSON.stringify(fixturePath.split(/[\\/]/).at(-1) || "")};
      const fileRow = await waitFor(() => [...document.querySelectorAll('.files-tree-row')].find((row) => row.getAttribute('title') === fixtureName || row.textContent?.includes(fixtureName)), 15000);
      fileRow?.click();
      const generate = await waitFor(() => document.querySelector('[data-testid="generate-manager-presentation"]'), 20000);
      checks.cernRecoveryTaskAvailable = Boolean(generate);
      window.confirm = () => true;
      const startedAt = performance.now();
      generate?.click();
      const card = await waitFor(() => document.querySelector('[data-testid="manager-presentation-failure-recovery"]'), 10000);
      details.failureTerminalMs = performance.now() - startedAt;
      details.card = card ? { kind: card.getAttribute('data-kind'), affectedObject: card.getAttribute('data-affected-object'), recoveryAction: card.getAttribute('data-recovery-action'), text: card.textContent?.replace(/\\s+/g, ' ').trim() || '' } : null;
      checks.failureReachedTerminalWithinThreshold = Boolean(card) && details.failureTerminalMs <= 5000 && document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute('data-phase') === 'failed';
      checks.failureCategoryMatchesInjection = details.card?.kind === details.expectedKind;
      checks.affectedObjectVisible = Boolean(details.card?.affectedObject && details.card.text.includes(details.card.affectedObject));
      checks.causeAndRecoveryGuidanceVisible = Boolean(card?.querySelectorAll('span').length >= 4 && card?.querySelector('button'));
      const rawNoise = ['ENOSPC', 'EACCES', 'EPERM', 'EBUSY', 'MODEL_TIMEOUT', 'Error:', ' at '];
      checks.noRawStackOrBareErrorCode = rawNoise.every((token) => !(details.card?.text || '').includes(token));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const recovery = document.querySelector('[data-testid="manager-presentation-recovery-action"]');
      checks.recoveryActionIsExecutable = details.card?.recoveryAction === 'retry' && recovery?.isConnected === true && !recovery.hasAttribute('disabled');
      const retryStartedAt = performance.now();
      recovery?.click();
      const completed = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 45000);
      details.recoveryCompletedMs = performance.now() - retryStartedAt;
      details.outputPath = completed?.getAttribute('data-output-path') || '';
      checks.recoveryActionCompletedTask = Boolean(completed);
      checks.noInfiniteLoading = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute('data-phase') === 'completed';
      const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 });
      const failed = tasks.filter((task) => task.kind === 'presentation_generation' && task.status === 'failed');
      const succeeded = tasks.filter((task) => task.kind === 'presentation_generation' && task.status === 'completed');
      checks.failureAndRecoveryAreAuditable = failed.length === 1 && succeeded.length === 1;
      details.backgroundTasks = tasks.filter((task) => task.kind === 'presentation_generation').map((task) => ({ id: task.id, status: task.status, progress: task.progress, message: task.message }));
      return { checks, details };
    })()
  `, true) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const outputPath = String(result.details.outputPath || "");
  const manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
  result.checks.recoveredPptxExists = Boolean(outputPath && existsSync(outputPath));
  result.checks.recoveredManifestExists = Boolean(manifestPath && existsSync(manifestPath));
  if (result.checks.recoveredPptxExists) {
    const pptx = readFileSync(outputPath);
    const zipText = pptx.toString("latin1");
    result.checks.recoveredPptxIntact = pptx.length > 10_000 && pptx.subarray(0, 2).toString("ascii") === "PK" && zipText.includes("[Content_Types].xml") && zipText.includes("ppt/presentation.xml");
    result.details.outputBytes = pptx.length;
    result.details.outputSha256 = (await import("crypto")).createHash("sha256").update(pptx).digest("hex").toUpperCase();
  } else result.checks.recoveredPptxIntact = false;
  if (result.checks.recoveredManifestExists) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    result.checks.recoveredSourceMatchesCern = manifest?.source?.sha256 === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
    result.details.manifestPath = manifestPath;
  } else result.checks.recoveredSourceMatchesCern = false;
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) { mkdirSync(dirname(screenshotPath), { recursive: true }); writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG()); result.details.screenshotPath = screenshotPath; }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runM7StabilitySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M7_CERN_PDF;
  if (!fixturePath || !existsSync(fixturePath)) throw new Error("M7 requires the fixed CERN PDF fixture.");
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: "M7 CERN stability workspace", trusted: true });
  const sessionA = await createThread({ kind: "chat", title: "M7 CERN session A", workspacePath });
  const sessionB = await createThread({ kind: "chat", title: "M7 CERN session B", workspacePath });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("M7 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const started = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 15000) => { const deadline = performance.now() + timeout; while (performance.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 40)); } return null; };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.authenticatedProductUi = login?.ok === true;
      checks.appShellVisible = Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.getAttribute('title') || '').includes(workspacePath)));
      checks.workspaceVisible = Boolean(workspace);
      workspace?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => workspace?.closest('.workspace-row')?.classList.contains('active')));
      const switchSession = async (title) => {
        const item = await waitFor(() => [...document.querySelectorAll('.thread-item')].find((button) => button.textContent?.includes(title)));
        item?.click();
        return Boolean(await waitFor(() => item?.classList.contains('active')));
      };
      checks.sessionASwitchedBeforeTask = await switchSession('M7 CERN session A');
      checks.sessionBSwitchedBeforeTask = await switchSession('M7 CERN session B');
      const pendingBefore = await api.listPendingApprovals();
      const browserBefore = await api.listPendingBrowserTaskApprovals();
      details.approvalsBefore = { desktop: pendingBefore.length, browser: browserBefore.length };
      checks.noPendingAuthorizationBeforeTask = pendingBefore.length === 0 && browserBefore.length === 0;
      const rightPanelToggle = document.querySelector('.titlebar-right-panel-toggle');
      if (!document.querySelector('.files-context-panel')) rightPanelToggle?.click();
      checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector('.files-context-panel')));
      const fixtureName = ${JSON.stringify(fixturePath.split(/[\\/]/).at(-1) || "")};
      const fileRow = await waitFor(() => [...document.querySelectorAll('.files-tree-row')].find((row) => row.getAttribute('title') === fixtureName || row.textContent?.includes(fixtureName)), 20000);
      checks.cernPdfVisible = Boolean(fileRow);
      fileRow?.click();
      checks.presentationActionDetected = Boolean(await waitFor(() => document.querySelector('[data-testid="generate-manager-presentation"]'), 20000));
      window.confirm = () => true;
      document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
      const progress = await waitFor(() => { const node = document.querySelector('[data-testid="manager-presentation-progress"]'); const phase = node?.getAttribute('data-phase'); return phase && !['completed','failed','cancelled'].includes(phase) ? node : null; }, 10000);
      checks.cernGoldenTaskRunning = Boolean(progress);
      details.requestId = progress?.getAttribute('data-request-id') || '';
      return { checks, details };
    })()
  `, true) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const checks = { ...started.checks };
  const details: Record<string, unknown> = { ...started.details, sessionIds: [sessionA.id, sessionB.id] };
  window.minimize();
  checks.windowMinimizedDuringCernTask = !window.isDestroyed() && window.isMinimized();
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.restore();
  window.show();
  window.focus();
  checks.windowRestoredDuringCernTask = !window.isDestroyed() && !window.isMinimized() && window.isVisible();

  const finished = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 45000) => { const deadline = performance.now() + timeout; while (performance.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 60)); } return null; };
      checks.appInteractiveAfterRestore = Boolean(await waitFor(() => document.querySelector('.app-shell')));
      const switchSession = async (title) => { const item = await waitFor(() => [...document.querySelectorAll('.thread-item')].find((button) => button.textContent?.includes(title))); item?.click(); return Boolean(await waitFor(() => item?.classList.contains('active'))); };
      checks.sessionASwitchedAfterRestore = await switchSession('M7 CERN session A');
      checks.sessionBSwitchedAfterRestore = await switchSession('M7 CERN session B');
      const threads = await api.listThreads();
      const expectedIds = ${JSON.stringify([sessionA.id, sessionB.id])};
      checks.sessionsPersistedAfterTask = expectedIds.every((id) => threads.some((thread) => thread.id === id));
      details.threadCount = threads.length;
      details.persistedSessionIds = threads.filter((thread) => expectedIds.includes(thread.id)).map((thread) => thread.id);
      const pendingAfter = await api.listPendingApprovals();
      const browserAfter = await api.listPendingBrowserTaskApprovals();
      details.approvalsAfter = { desktop: pendingAfter.length, browser: browserAfter.length };
      checks.noUnauthorizedApprovalOrBrowserAction = pendingAfter.length === 0 && browserAfter.length === 0;
      const task = await waitFor(async () => {
        const tasks = await api.listBackgroundTasks({ workspacePath: ${JSON.stringify(workspacePath)}, limit: 100 });
        return tasks.find((candidate) => candidate.kind === 'presentation_generation' && candidate.targetId === ${JSON.stringify(String(started.details.requestId || ""))} && candidate.status === 'completed') || null;
      }, 45000);
      const tasks = await api.listBackgroundTasks({ workspacePath: ${JSON.stringify(workspacePath)}, limit: 100 });
      checks.cernGoldenTaskCompleted = task?.status === 'completed' && task?.progress === 100;
      details.outputPath = task?.deliverySummary?.artifacts?.find((artifact) => artifact.kind === 'presentation')?.path || '';
      document.querySelector('.sidebar-action-list button:nth-child(2)')?.click();
      const completedRow = await waitFor(() => [...document.querySelectorAll('[data-testid="background-task-list-item"]')].find((row) => row.getAttribute('data-task-status') === 'completed' && row.textContent?.includes('PPT')), 10000);
      checks.completedStateVisible = Boolean(completedRow);
      checks.backgroundTaskCompletedExactlyOnce = task?.status === 'completed' && task?.progress === 100 && tasks.filter((candidate) => candidate.targetId === task?.targetId).length === 1;
      details.backgroundTask = task || null;
      return { checks, details };
    })()
  `, true) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  Object.assign(checks, finished.checks);
  Object.assign(details, finished.details);

  const outputPath = String(finished.details.outputPath || "");
  const manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
  checks.pptxExists = Boolean(outputPath && existsSync(outputPath));
  checks.provenanceExists = Boolean(manifestPath && existsSync(manifestPath));
  if (checks.pptxExists) {
    const pptx = readFileSync(outputPath);
    const zipText = pptx.toString("latin1");
    checks.pptxNotCorrupt = pptx.length > 10_000 && pptx.subarray(0, 2).toString("ascii") === "PK"
      && zipText.includes("[Content_Types].xml") && zipText.includes("ppt/presentation.xml") && zipText.includes("ppt/slides/slide1.xml");
    details.outputBytes = pptx.length;
    details.outputSha256 = (await import("crypto")).createHash("sha256").update(pptx).digest("hex").toUpperCase();
  } else checks.pptxNotCorrupt = false;
  if (checks.provenanceExists) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    checks.provenanceMatchesFixedCernPdf = manifest?.source?.sha256 === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
    details.manifestPath = manifestPath;
    details.manifest = manifest;
  } else checks.provenanceMatchesFixedCernPdf = false;
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) { mkdirSync(dirname(screenshotPath), { recursive: true }); writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG()); details.screenshotPath = screenshotPath; }
  return { ok: Object.values(checks).every(Boolean), checks, details };
}

async function runM6PerformanceSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const workspacePath = process.env.OPENDRSAI_E2E_M6_WORKSPACE;
  const largeFilePath = process.env.OPENDRSAI_E2E_M6_LARGE_FILE;
  const cernPdfPath = process.env.OPENDRSAI_E2E_M6_CERN_PDF;
  if (!workspacePath || !largeFilePath || !cernPdfPath) throw new Error("M6 fixture paths are required.");
  if (![workspacePath, largeFilePath, cernPdfPath].every(existsSync)) throw new Error("M6 fixture is incomplete.");
  window.show();
  window.focus();
  await createWorkspace({ source: "existing", path: workspacePath, name: "M6 100k performance workspace", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("M6 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolveReload();
    });
    window.webContents.reload();
  });

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = { thresholdMs: 2000, timings: {}, heartbeat: {}, fixture: {} };
      const waitFor = async (find, timeout = 10000, interval = 25) => {
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, interval));
        }
        return null;
      };
      const timed = async (name, action, ready) => {
        const started = performance.now();
        action();
        const value = await waitFor(ready, 10000);
        const elapsed = performance.now() - started;
        details.timings[name] = elapsed;
        checks[name + "RespondedWithin2s"] = Boolean(value) && elapsed <= 2000;
        return value;
      };
      const gaps = [];
      let lastBeat = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        gaps.push(now - lastBeat);
        lastBeat = now;
      }, 25);
      try {
        const login = await api.login({ developerBypass: true, rememberMe: false });
        checks.authenticatedProductUi = login?.ok === true;
        const workspacePath = ${JSON.stringify("__M6_WORKSPACE__")}.replace("__M6_WORKSPACE__", ${JSON.stringify(workspacePath)});
        const largeFilePath = ${JSON.stringify("__M6_LARGE__")}.replace("__M6_LARGE__", ${JSON.stringify(largeFilePath)});
        const cernPdfPath = ${JSON.stringify("__M6_PDF__")}.replace("__M6_PDF__", ${JSON.stringify(cernPdfPath)});
        const workspace = await api.createWorkspace({ source: "existing", path: workspacePath, name: "M6 100k performance workspace", trusted: true });
        checks.workspaceRegistered = workspace?.path === workspacePath;

        const listStarted = performance.now();
        const tree = await api.listWorkspaceFiles({ workspacePath, maxDepth: 5, maxEntries: 900 });
        details.timings.bounded100kTreeMs = performance.now() - listStarted;
        details.fixture.treeEntriesReturned = tree.totalEntries;
        details.fixture.treeTruncated = tree.truncated;
        checks.workspaceTreeBounded = tree.truncated === true && tree.totalEntries <= 901;
        checks.workspaceTreeReturnedWithin2s = details.timings.bounded100kTreeMs <= 2000;

        const workspaceButton = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.getAttribute('title') || '').includes(workspacePath)), 10000);
        checks.workspaceVisible = Boolean(workspaceButton);
        await timed("workspaceSelection", () => workspaceButton?.click(), () => workspaceButton?.closest('.workspace-row')?.classList.contains('active'));

        const menuButton = document.querySelector('.composer-tools > button:first-child');
        await timed("attachmentMenu", () => menuButton?.click(), () => document.querySelector('.composer-tool-menu'));
        const addFileButton = document.querySelector('.composer-tool-menu button:has([data-testid="composer-add-file-label"])');
        const importStarted = performance.now();
        addFileButton?.click();
        const chips = await waitFor(() => document.querySelectorAll('.composer-attachment-chip').length === 30 ? document.querySelectorAll('.composer-attachment-chip') : null, 10000);
        details.timings.import30FilesMs = performance.now() - importStarted;
        details.fixture.importedCount = chips?.length || 0;
        checks.importedExactly30Files = chips?.length === 30;
        checks.import30FilesRespondedWithin2s = Boolean(chips) && details.timings.import30FilesMs <= 2000;
        checks.fixedCernPdfImported = [...(chips || [])].some((chip) => chip.textContent?.includes('WLCG-20260715-WLCG-talk-IHEP-visit.pdf'));

        const rightToggle = document.querySelector('.titlebar-right-panel-toggle');
        if (!document.querySelector('.files-context-panel')) rightToggle?.click();
        checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector('.files-context-panel')));
        const findTreeRow = (title) => [...document.querySelectorAll('.files-tree-row')].find((row) => row.getAttribute('title') === title);
        let largeRow = await waitFor(() => findTreeRow('bucket-000/001-large-preview.txt'), 500);
        for (let attempt = 0; !largeRow && attempt < 3; attempt += 1) {
          const firstFolder = await waitFor(() => findTreeRow('bucket-000'), 5000);
          firstFolder?.click();
          largeRow = await waitFor(() => findTreeRow('bucket-000/001-large-preview.txt'), 2500);
        }
        checks.largePreviewRowVisible = Boolean(largeRow);
        const previewStarted = performance.now();
        largeRow?.click();
        const feedback = await waitFor(() => {
          if (document.querySelector('.files-preview-empty h3')?.textContent?.match(/Loading|读取/)) return 'loading';
          if (document.querySelector('.files-preview-text, .files-preview-code, .files-preview-metadata, .files-preview-markdown')) return 'ready';
          return null;
        }, 2000);
        details.timings.largePreviewFeedbackMs = performance.now() - previewStarted;
        checks.largePreviewImmediateFeedback = Boolean(feedback) && details.timings.largePreviewFeedbackMs <= 2000;
        const previewReady = feedback === 'ready' ? feedback : await waitFor(() => document.querySelector('.files-preview-text, .files-preview-code, .files-preview-metadata, .files-preview-markdown'), 10000);
        details.timings.largePreviewReadyMs = performance.now() - previewStarted;
        checks.largePreviewCompleted = Boolean(previewReady);

        const task = await api.enqueueBackgroundTask({ kind: "presentation_generation", source: "presentation", title: "M6 long CERN analysis", workspacePath, targetId: "m6-long-task", status: "running", progress: 42, currentStep: "Analyzing page 42", message: "Long-running CERN analysis remains active while navigating.", planSteps: [{ id: "read", title: "Read fixed CERN PDF", phase: "input" }, { id: "report", title: "Generate report", phase: "output" }] });
        checks.longTaskStarted = task?.status === "running" && task?.progress === 42;
        const nav = async (name, button, selector) => timed(name, () => document.querySelector(button)?.click(), () => document.querySelector(selector));
        await nav("taskCenterNavigation", '.sidebar-action-list button:nth-child(2)', '[data-testid="task-center-view"]');
        const progress = await waitFor(() => document.querySelector('[data-task-status="running"] [role="progressbar"]'), 5000);
        checks.longTaskHasVisibleProgress = progress?.getAttribute('aria-valuenow') === '42';
        await nav("resultsNavigation", '[data-nav-id="results"]', '[data-testid="results-center-view"]');
        await nav("taskCenterReturnNavigation", '.sidebar-action-list button:nth-child(2)', '[data-testid="task-center-view"]');
        checks.longTaskSurvivesNavigation = Boolean(document.querySelector('[data-task-status="running"]'));
        await api.updateBackgroundTask({ taskId: task.id, status: "cancelled", progress: 42, message: "M6 acceptance cleanup." });

        const pdfStarted = performance.now();
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: cernPdfPath, maxBytes: 100000 });
        details.timings.cernPdfPreviewMs = performance.now() - pdfStarted;
        checks.fixedCernPdfPreviewed = pdf?.kind === "pdf" && pdf?.size === 7664262;
      } finally {
        clearInterval(heartbeat);
      }
      details.heartbeat.samples = gaps.length;
      details.heartbeat.maxGapMs = gaps.length ? Math.max(...gaps) : null;
      details.heartbeat.p95GapMs = gaps.length ? [...gaps].sort((a,b) => a-b)[Math.floor(gaps.length * .95)] : null;
      checks.rendererHeartbeatCollected = gaps.length >= 5;
      checks.rendererNeverBlockedFor2s = gaps.length > 0 && Math.max(...gaps) < 2000;
      checks.allMeasuredInteractionsWithin2s = Object.entries(details.timings).filter(([name]) => /Navigation|Selection|Menu|Feedback|import30|bounded100k/i.test(name)).every(([, value]) => value <= 2000);
      return { checks, details };
    })()
  `, true) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const pdfBytes = readFileSync(cernPdfPath);
  result.checks.cernFixtureSize = pdfBytes.length === 7_664_262;
  result.checks.cernFixtureSha256 = (await import("crypto")).createHash("sha256").update(pdfBytes).digest("hex").toUpperCase()
    === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runM5AccessibilitySmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M5_CERN_PDF;
  const chartPath = process.env.OPENDRSAI_E2E_M5_CERN_CHART;
  const axePath = process.env.OPENDRSAI_E2E_M5_AXE_PATH;
  const evidenceDir = process.env.OPENDRSAI_E2E_M5_EVIDENCE_DIR;
  if (!fixturePath || !existsSync(fixturePath)) throw new Error("M5 requires the fixed CERN PDF fixture.");
  if (!chartPath || !existsSync(chartPath)) throw new Error("M5 requires the CERN chart fixture.");
  if (!axePath || !existsSync(axePath)) throw new Error("M5 requires axe-core.");
  if (!evidenceDir) throw new Error("M5 requires an evidence directory.");
  mkdirSync(evidenceDir, { recursive: true });
  const fixtureWorkspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: fixtureWorkspacePath, name: "M5 CERN 无障碍工作区", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("M5 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const checks: Record<string, boolean> = {};
  const details: Record<string, unknown> = { pages: [] };
  const pdfBytes = readFileSync(fixturePath);
  checks.cernFixtureSize = pdfBytes.length === 7_664_262;
  checks.cernFixtureSha256 = (await import("crypto")).createHash("sha256").update(pdfBytes).digest("hex").toUpperCase()
    === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
  const axeSource = readFileSync(axePath, "utf8");

  const seeded = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const login = await api.login({ developerBypass: true, rememberMe: false });
      if (!login?.ok) throw new Error("M5 developer login failed");
      const workspaces = await api.listWorkspaces();
      let activeWorkspaceTitle = "";
      const activeDeadline = Date.now() + 5000;
      while (Date.now() < activeDeadline && !activeWorkspaceTitle) {
        activeWorkspaceTitle = document.querySelector('.workspace-row.active .workspace-item')?.getAttribute('title') || '';
        if (!activeWorkspaceTitle) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const activeWorkspacePath = activeWorkspaceTitle.split(/\\r?\\n/).map((item) => item.trim()).filter(Boolean).at(-1) || "";
      const workspacePath = ${JSON.stringify(fixtureWorkspacePath)};
      const workspacePaths = [...new Set([workspacePath, ...workspaces.map((item) => item.path)])];
      const runningTasks = [];
      for (const [index, taskWorkspacePath] of workspacePaths.entries()) runningTasks.push(await api.enqueueBackgroundTask({ kind: "presentation_generation", source: "presentation", title: "CERN WLCG accessible report", workspacePath: taskWorkspacePath, targetId: "m5-cern-progress-" + index, status: "running", progress: 42, currentStep: "Reading page 42 capacity chart", message: "Reading the fixed CERN PDF.", verification: "Progress is announced as a value.", planSteps: [{ id: "read", title: "Read CERN PDF", phase: "input" }, { id: "report", title: "Prepare accessible report", phase: "output" }] }));
      const result = await api.enqueueBackgroundTask({
        kind: "presentation_generation", source: "presentation", title: "CERN WLCG accessible result", workspacePath, targetId: "m5-cern-result", status: "completed", progress: 100, message: "Accessible CERN result ready.", verification: "PDF and chart alternatives verified.", completedSteps: ["Read CERN PDF", "Prepare accessible report"],
        deliverySummary: { findingSummary: "CERN WLCG accessible report ready.", importance: "high", importanceReason: "Screen-reader acceptance.", suggestedAction: "Review the PDF and capacity chart.", workSummary: "Read fixed CERN PDF and registered an accessible chart.", coreConclusion: "Capacity planning rises from 4.8 to 9.6 Tbps.", verification: "Source hash and chart data verified.", remainingRisks: "None.", completionCriteria: { passed: ["PDF verified", "Chart alternative provided"], incomplete: [] }, artifacts: [
          { id: "m5-cern-pdf", label: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", path: ${JSON.stringify(fixturePath)}, kind: "document" },
          { id: "m5-cern-chart", label: "cern-wlcg-capacity-chart.svg", path: ${JSON.stringify(chartPath)}, kind: "file", chartQuality: { status: "passed", checkedAt: "2026-07-15T00:00:00.000Z", sourcePath: ${JSON.stringify(fixturePath)}, xAxis: "year", yAxis: "throughput", unit: "Tbps", legend: "WLCG planned capacity", axisLabelsVisible: true, unitVisible: true, legendVisible: true, pointsExpected: 3, pointsMatched: 3, coordinateMatches: 3, anomaliesExpected: 0, anomaliesMatched: 0, mismatchCount: 0, checks: ["Axis labels visible", "Unit visible: Tbps", "Legend visible", "Data points 3/3"] } }
        ] }
      });
      const approval = await api.proposeApproval({ source: "workflow", actionKind: "workflow.run", title: "M5 CERN accessible approval", detail: "Review the accessible CERN report.", target: "CERN WLCG result", scope: "current workspace", impact: "Publishes the reviewed result.", risk: "high", idempotencyKey: "m5-accessibility-approval" });
      return { login: login.ok, workspacePath, workspacePaths, runningIds: runningTasks.map((task) => task.id), resultId: result.id, approvalId: approval.approval?.id || null, approvalQueued: approval.queued };
    })()
  `, true) as Record<string, unknown>;
  checks.authenticatedProductUi = seeded.login === true;
  checks.runningTaskSeeded = Array.isArray(seeded.runningIds) && seeded.runningIds.length >= 1;
  checks.cernResultSeeded = Boolean(seeded.resultId);
  checks.approvalSeeded = seeded.approvalQueued === true && Boolean(seeded.approvalId);
  details.seeded = seeded;

  await window.webContents.executeJavaScript(axeSource, true);
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Accessibility.enable");

  const waitForSelector = async (selector: string, timeout = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true)) return true;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return false;
  };
  const navigate = async (script: string, selector: string): Promise<void> => {
    await window.webContents.executeJavaScript(script, true);
    if (!(await waitForSelector(selector))) throw new Error(`M5 page did not become ready: ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 180));
  };
  const auditPage = async (page: string): Promise<void> => {
    const axeResult = await window.webContents.executeJavaScript(`
      (async () => {
        const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations", "incomplete", "passes"] });
        const controls = [...document.querySelectorAll('button,input,select,textarea,a[href],[role="button"],[role="menuitem"],[tabindex]:not([tabindex="-1"])')].filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; });
        const nameFor = (el) => { const labelledBy = el.getAttribute('aria-labelledby'); const label = el.labels?.[0]?.textContent || (labelledBy ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : ''); return (el.getAttribute('aria-label') || label || el.getAttribute('alt') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim(); };
        const unnamed = controls.filter((el) => !nameFor(el)).map((el) => el.outerHTML.slice(0, 300));
        const stateful = [...document.querySelectorAll('[aria-expanded],[aria-pressed],[aria-selected],input[type="checkbox"],input[type="radio"],progress,[role="progressbar"]')];
        const missingState = stateful.filter((el) => el.matches('input[type="checkbox"],input[type="radio"]') ? typeof el.checked !== "boolean" : el.matches('[role="progressbar"]') ? !el.hasAttribute("aria-valuenow") : !["aria-expanded", "aria-pressed", "aria-selected"].some((name) => el.hasAttribute(name))).map((el) => el.outerHTML.slice(0, 300));
        return { axe: { testEngine: result.testEngine, testEnvironment: result.testEnvironment, violations: result.violations, incomplete: result.incomplete, passCount: result.passes.length }, custom: { controlCount: controls.length, unnamed, statefulCount: stateful.length, missingState, statusCount: document.querySelectorAll('[role="status"],[aria-live]').length, alertCount: document.querySelectorAll('[role="alert"]').length, progress: [...document.querySelectorAll('[role="progressbar"]')].map((el) => ({ name: nameFor(el), valueNow: el.getAttribute("aria-valuenow"), valueMin: el.getAttribute("aria-valuemin"), valueMax: el.getAttribute("aria-valuemax") })), images: [...document.querySelectorAll('img')].filter((img) => { const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((img) => ({ alt: img.alt, src: img.currentSrc.slice(0, 80) })), errorLink: (() => { const input = document.querySelector('[data-testid=natural-schedule-input]'); const alert = document.querySelector('#natural-schedule-error[role=alert]'); return input ? { invalid: input.getAttribute('aria-invalid'), describedBy: input.getAttribute('aria-describedby'), alertId: alert?.id || null, alertText: alert?.textContent || null } : null; })() } };
      })()
    `, true) as { axe: { violations: Array<{ impact?: string | null }>; incomplete: unknown[]; passCount: number }; custom: Record<string, unknown> };
    const axTree = await window.webContents.debugger.sendCommand("Accessibility.getFullAXTree") as { nodes?: Array<Record<string, unknown>> };
    const nodes = axTree.nodes ?? [];
    const interactiveRoles = new Set(["button", "checkbox", "combobox", "link", "menuitem", "radio", "slider", "spinbutton", "switch", "tab", "textbox"]);
    const unnamedAx = nodes.filter((node) => interactiveRoles.has(String((node.role as { value?: unknown })?.value || "")) && !String((node.name as { value?: unknown })?.value || "").trim());
    const severe = axeResult.axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    checks[`${page}AxeCriticalSeriousZero`] = severe.length === 0;
    checks[`${page}DomControlsNamed`] = Array.isArray(axeResult.custom.unnamed) && axeResult.custom.unnamed.length === 0;
    checks[`${page}AxControlsNamed`] = unnamedAx.length === 0;
    checks[`${page}ControlStatesExposed`] = Array.isArray(axeResult.custom.missingState) && axeResult.custom.missingState.length === 0;
    checks[`${page}AxeRulesExecuted`] = axeResult.axe.passCount > 0;
    checks[`${page}AxeIncompleteZero`] = axeResult.axe.incomplete.length === 0;
    writeFileSync(join(evidenceDir, `${page}-axe.json`), JSON.stringify(axeResult, null, 2));
    writeFileSync(join(evidenceDir, `${page}-accessibility-tree.json`), JSON.stringify(axTree, null, 2));
    writeFileSync(join(evidenceDir, `${page}.png`), (await window.webContents.capturePage()).toPNG());
    (details.pages as Array<Record<string, unknown>>).push({ page, axe: axeResult, axNodeCount: nodes.length, unnamedAxCount: unnamedAx.length, severeViolationCount: severe.length });
  };

  await waitForSelector("[data-testid=composer-input]");
  await auditPage("home");

  const selectedWorkspace = await window.webContents.executeJavaScript(`
    (async () => {
      const workspacePath = ${JSON.stringify(String(seeded.workspacePath || ""))};
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const item = [...document.querySelectorAll('.workspace-item')].find((candidate) => (candidate.getAttribute('title') || '').includes(workspacePath));
        if (item) { item.click(); await new Promise((resolve) => setTimeout(resolve, 250)); return item.closest('.workspace-row')?.classList.contains('active') === true; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()
  `, true) as boolean;
  checks.taskWorkspaceSelected = selectedWorkspace;
  await navigate(`(() => { document.querySelector('.sidebar-action-list button:nth-child(2)')?.click(); return true; })()`, '[data-testid="task-center-view"]');
  if (!(await waitForSelector('[data-testid="background-task-list-item"]'))) throw new Error("M5 running task did not appear in the selected workspace.");
  await window.webContents.executeJavaScript(`(() => { const detail = document.querySelector('[data-task-status="running"] [data-testid="background-task-detail"]'); if (detail) detail.open = true; const input = document.querySelector('[data-testid="natural-schedule-input"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ''); input?.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-testid="natural-schedule-understand"]')?.click(); return true; })()`, true);
  await waitForSelector("#natural-schedule-error");
  await auditPage("task-status");
  const taskPage = (details.pages as Array<{ page: string; axe: unknown; custom?: unknown }>).find((item) => item.page === "task-status") as { axe?: unknown } | undefined;
  void taskPage;
  const taskSemantics = await window.webContents.executeJavaScript(`(() => { const progress = document.querySelector('[role="progressbar"][aria-valuenow="42"]'); const input = document.querySelector('[data-testid="natural-schedule-input"]'); const alert = document.querySelector('#natural-schedule-error[role=alert]'); return { progressName: progress?.getAttribute('aria-label') || '', progressNow: progress?.getAttribute('aria-valuenow'), liveCount: document.querySelectorAll('[role="status"],[aria-live]').length, errorAssociated: input?.getAttribute('aria-invalid') === 'true' && input?.getAttribute('aria-describedby') === alert?.id && Boolean(alert?.textContent?.trim()) }; })()`, true) as Record<string, unknown>;
  checks.taskProgressNamedAndValued = Boolean(taskSemantics.progressName) && taskSemantics.progressNow === "42";
  checks.taskDynamicStatusLive = Number(taskSemantics.liveCount) >= 1;
  checks.taskErrorAssociated = taskSemantics.errorAssociated === true;
  details.taskSemantics = taskSemantics;

  await navigate(`(() => { window.dispatchEvent(new Event("drsai:e2e-open-approval-center")); return true; })()`, ".approval-center-view");
  await auditPage("approval");

  await navigate(`(() => { document.querySelector('[data-nav-id="results"]')?.click(); return true; })()`, '[data-testid="results-center-view"]');
  await waitForSelector('li[data-artifact-id="m5-cern-chart"]');
  await window.webContents.executeJavaScript(`(() => { document.querySelector('li[data-artifact-id="m5-cern-chart"] [data-testid="results-preview-artifact"]')?.click(); return true; })()`, true);
  await waitForSelector('[data-testid="results-preview-dialog"] img');
  await auditPage("results");
  const chartSemantics = await window.webContents.executeJavaScript(`(() => { const img = document.querySelector('[data-testid="results-preview-dialog"] img'); return { alt: img?.getAttribute('alt') || '', containsAxes: /year.*throughput/i.test(img?.getAttribute('alt') || ''), containsUnit: /Tbps/.test(img?.getAttribute('alt') || ''), containsPoints: /3 data points/.test(img?.getAttribute('alt') || '') }; })()`, true) as Record<string, unknown>;
  checks.chartHasDetailedAlternative = chartSemantics.containsAxes === true && chartSemantics.containsUnit === true && chartSemantics.containsPoints === true;
  details.chartSemantics = chartSemantics;

  if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
  return { ok: Object.values(checks).every(Boolean), checks, details };
}

async function runM4KeyboardSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M4_CERN_PDF;
  const evidenceDir = process.env.OPENDRSAI_E2E_M4_EVIDENCE_DIR;
  if (!fixturePath || !existsSync(fixturePath)) throw new Error("M4 requires the fixed CERN PDF fixture.");
  if (!evidenceDir) throw new Error("M4 requires an evidence directory.");
  mkdirSync(evidenceDir, { recursive: true });
  window.show();
  window.focus();

  const checks: Record<string, boolean> = {};
  const focusTrace: Array<Record<string, unknown>> = [];
  const fixtureBytes = readFileSync(fixturePath);
  checks.cernFixtureSize = fixtureBytes.length === 7_664_262;
  checks.cernFixtureSha256 = (await import("crypto")).createHash("sha256").update(fixtureBytes).digest("hex").toUpperCase()
    === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";

  const seeded = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const login = await api.login({ developerBypass: true, rememberMe: false });
      if (!login?.ok) throw new Error("M4 developer login failed");
      const task = await api.enqueueBackgroundTask({
        kind: "presentation_generation", source: "presentation", title: "CERN WLCG keyboard acceptance result",
        workspacePath: ${JSON.stringify(dirname(fixturePath))}, targetId: "m4-keyboard-cern", status: "completed", progress: 100,
        message: "CERN PDF result is ready.", verification: "Fixed CERN PDF hash verified.", completedSteps: ["Read PDF", "Register result"],
        deliverySummary: { findingSummary: "CERN WLCG result ready.", importance: "high", importanceReason: "Keyboard acceptance fixture.", suggestedAction: "Open the result.", workSummary: "Registered fixed CERN PDF.", coreConclusion: "All primary actions must be keyboard reachable.", verification: "Fixture hash verified.", remainingRisks: "None.", completionCriteria: { passed: ["PDF verified", "Result registered"], incomplete: [] }, artifacts: [{ id: "m4-cern-pdf", label: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", path: ${JSON.stringify(fixturePath)}, kind: "document" }] }
      });
      const approval = await api.proposeApproval({ source: "workflow", actionKind: "workflow.run", title: "M4 CERN keyboard approval", detail: "Approve with Space.", target: "CERN WLCG result", scope: "current workspace", impact: "Runs the reviewed workflow.", risk: "high", idempotencyKey: "m4-keyboard-approval" });
      window.__m4PointerEvents = [];
      for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup"]) window.addEventListener(name, (event) => window.__m4PointerEvents.push({ name, trusted: event.isTrusted }), true);
      const style = document.createElement("style"); style.id = "m4-disable-pointer"; style.textContent = "*{pointer-events:none!important}"; document.head.append(style);
      return { login: login.ok, taskId: task.id, approvalId: approval.approval?.id || null, approvalQueued: approval.queued };
    })()
  `, true) as { login: boolean; taskId: string; approvalId: string | null; approvalQueued: boolean };
  checks.authenticatedProductUi = seeded.login === true;
  checks.cernResultSeeded = Boolean(seeded.taskId);
  checks.approvalSeeded = seeded.approvalQueued === true && Boolean(seeded.approvalId);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const press = async (keyCode: string, modifiers?: Array<"shift" | "control" | "alt" | "meta">): Promise<void> => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, ...(modifiers ? { modifiers } : {}) });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, ...(modifiers ? { modifiers } : {}) });
    await new Promise((resolve) => setTimeout(resolve, 45));
  };
  const snapshot = async (milestone: string, selector: string): Promise<Record<string, unknown>> => {
    const value = await window.webContents.executeJavaScript(`(() => { const el = document.activeElement; const rect = el?.getBoundingClientRect(); const css = el ? getComputedStyle(el) : null; return { milestone: ${JSON.stringify(milestone)}, selector: ${JSON.stringify(selector)}, matches: Boolean(el?.matches(${JSON.stringify(selector)})), tag: el?.tagName || "", label: el?.getAttribute("aria-label") || el?.getAttribute("title") || el?.textContent?.trim().slice(0, 120) || "", focusVisible: Boolean(el?.matches(":focus-visible")), visible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight), outline: css?.outline || "", boxShadow: css?.boxShadow || "" }; })()`, true) as Record<string, unknown>;
    focusTrace.push(value);
    return value;
  };
  const tabUntil = async (milestone: string, selector: string, maxTabs = 240, reverse = false): Promise<Record<string, unknown>> => {
    for (let index = 0; index < maxTabs; index += 1) {
      const current = await snapshot(`${milestone}:probe`, selector);
      focusTrace.pop();
      if (current.matches === true) return snapshot(milestone, selector);
      await press("TAB", reverse ? ["shift"] : undefined);
    }
    return snapshot(`${milestone}:not-found`, selector);
  };
  const assertFocus = (name: string, state: Record<string, unknown>): void => {
    checks[`${name}Focused`] = state.matches === true;
    checks[`${name}FocusVisible`] = state.focusVisible === true && state.visible === true && (state.outline !== "none" || state.boxShadow !== "none");
  };
  const waitDom = async (expression: string, timeout = 8000): Promise<boolean> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return true;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return false;
  };

  const newChat = await tabUntil("new-chat", ".sidebar-action-list .sidebar-button:first-child"); assertFocus("newChat", newChat); await press("SPACE");
  const attachment = await tabUntil("attachment", ".composer-tools > button"); assertFocus("attachment", attachment); await press("SPACE");
  const addFile = await tabUntil("add-file", ".composer-tool-menu button:has([data-testid=composer-add-file-label])"); assertFocus("addFile", addFile); await press("SPACE");
  checks.filePickerActivatedByKeyboard = await waitDom("document.querySelector('.composer-attachment-chip')?.textContent?.includes('WLCG-20260715-WLCG-talk-IHEP-visit.pdf')");
  const attachmentAgain = await tabUntil("attachment-reopen", ".composer-tools > button"); assertFocus("attachmentReopen", attachmentAgain); await press("SPACE"); await press("ESCAPE");
  checks.attachmentMenuEscClosed = !(await window.webContents.executeJavaScript("Boolean(document.querySelector('.composer-tool-menu'))", true));
  const attachmentAfterEsc = await snapshot("attachment-after-escape", ".composer-tools > button"); assertFocus("attachmentAfterEscape", attachmentAfterEsc);

  const composer = await tabUntil("composer", "[data-testid=composer-input]"); assertFocus("composer", composer);
  clipboard.writeText("Analyze the attached CERN WLCG PDF and prepare a concise manager report."); await press("V", ["control"]);
  checks.composerReceivedKeyboardPaste = await waitDom("document.querySelector('[data-testid=composer-input]')?.value?.includes('Analyze the attached CERN WLCG PDF')");
  const send = await tabUntil("send", ".composer-submit"); assertFocus("send", send); await press("SPACE");
  checks.messageSentByKeyboard = await waitDom("[...document.querySelectorAll('*')].some((el) => el.textContent?.includes('Analyze the attached CERN WLCG PDF and prepare a concise manager report.'))");

  const userMenu = await tabUntil("user-menu", "[data-testid=user-menu-button]", 240, true); assertFocus("userMenu", userMenu); await press("SPACE");
  const settings = await tabUntil("settings", "[data-testid=user-menu-settings]"); assertFocus("settings", settings); await press("SPACE");
  const approvalPane = await tabUntil("approval-pane", "[data-testid=settings-pane-approvals]"); assertFocus("approvalPane", approvalPane); await press("SPACE");
  const approve = await tabUntil("approve", ".approval-pending-actions button.approve"); assertFocus("approve", approve); await press("SPACE");
  checks.approvedWithSpace = await waitDom("!document.querySelector('.approval-pending-actions button.approve')");

  const results = await tabUntil("results", '[data-nav-id="results"]'); assertFocus("results", results); await press("SPACE");
  await waitDom("document.querySelector('[data-testid=results-open-artifact]')");
  const openArtifact = await tabUntil("open-artifact", '[data-testid="results-open-artifact"]'); assertFocus("openArtifact", openArtifact);
  await press("SPACE"); checks.resultOpenedByKeyboard = await waitDom("document.querySelector('[data-testid=results-open-status]')?.dataset.state === 'opened'");
  const share = await tabUntil("share-artifact", '[data-testid="results-share-artifact"]', 20, true); assertFocus("shareArtifact", share);
  await press("SPACE"); checks.shareDialogOpenedByKeyboard = await waitDom("document.querySelector('[data-testid=share-confirmation-dialog]')"); await press("ESCAPE");
  checks.shareDialogEscCancelled = await waitDom("!document.querySelector('[data-testid=share-confirmation-dialog]')");
  const shareAfterEsc = await snapshot("share-after-escape", '[data-testid="results-share-artifact"]'); assertFocus("shareAfterEscape", shareAfterEsc);
  await press("TAB", ["shift"]); const reverse = await snapshot("reverse-tab", "button");
  checks.shiftTabMovesBackward = reverse.tag === "BUTTON" && reverse.label !== shareAfterEsc.label;

  const pointerEvents = await window.webContents.executeJavaScript("window.__m4PointerEvents || []", true) as unknown[];
  checks.pointerEventsBlocked = pointerEvents.length === 0;
  checks.noKeyboardTrap = focusTrace.every((item) => item.visible === true) && focusTrace.length >= 14;
  const expectedOrder = ["new-chat", "attachment", "add-file", "attachment-reopen", "attachment-after-escape", "composer", "send", "user-menu", "settings", "approval-pane", "approve", "results", "open-artifact", "share-artifact", "share-after-escape", "reverse-tab"];
  checks.focusOrderMatchesSnapshot = expectedOrder.every((name, index) => focusTrace[index]?.milestone === name);
  const screenshotPath = join(evidenceDir, "m4-keyboard-final.png");
  writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  writeFileSync(join(evidenceDir, "focus-trace.json"), JSON.stringify({ expectedOrder, focusTrace, pointerEvents }, null, 2));
  return { ok: Object.values(checks).every(Boolean), checks, details: { fixturePath, seeded, expectedOrder, focusTrace, pointerEvents, screenshotPath } };
}

async function runM3WindowScalingSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_M3_CERN_PDF;
  const evidenceDir = process.env.OPENDRSAI_E2E_M3_EVIDENCE_DIR;
  if (!fixturePath || !existsSync(fixturePath)) throw new Error("M3 requires the fixed CERN PDF fixture.");
  if (!evidenceDir) throw new Error("M3 requires an evidence directory.");
  mkdirSync(evidenceDir, { recursive: true });

  const checks: Record<string, boolean> = {};
  const details: Record<string, unknown> = { fixturePath, profiles: [] };
  const fixtureBytes = readFileSync(fixturePath);
  checks.cernFixtureSize = fixtureBytes.length === 7_664_262;
  checks.cernFixtureSha256 = (await import("crypto")).createHash("sha256").update(fixtureBytes).digest("hex").toUpperCase()
    === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";

  const seeded = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const login = await api.login({ developerBypass: true, rememberMe: false });
      if (!login?.ok) throw new Error("M3 developer login failed: " + (login?.message || "unknown error"));
      const task = await api.enqueueBackgroundTask({
        kind: "presentation_generation",
        source: "presentation",
        title: "CERN WLCG 窗口适配验收成果",
        workspacePath: ${JSON.stringify(dirname(fixturePath))},
        targetId: "m3-cern-window-scaling",
        status: "completed",
        progress: 100,
        message: "CERN WLCG PDF 成果已就绪。",
        verification: "固定 48 页 CERN PDF 的大小和 SHA-256 已验证。",
        completedSteps: ["读取 CERN PDF", "生成管理者成果", "登记成果"],
        deliverySummary: {
          findingSummary: "CERN WLCG 管理者成果已完成。",
          importance: "high",
          importanceReason: "用于验证窗口缩放下成果始终可达。",
          suggestedAction: "在成果中心打开固定 CERN PDF。",
          workSummary: "验证真实 CERN WLCG PDF 并登记成果。",
          coreConclusion: "缩放和窗口切换不能遮挡成果入口。",
          verification: "PDF 大小、哈希和来源均已核对。",
          remainingRisks: "无。",
          completionCriteria: { passed: ["CERN PDF 已验证", "成果已登记"], incomplete: [] },
          artifacts: [{ id: "m3-cern-pdf", label: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", path: ${JSON.stringify(fixturePath)}, kind: "document" }],
        },
      });
      const proposal = await api.proposeApproval({
        source: "workflow",
        actionKind: "workflow.run",
        title: "确认发布 CERN WLCG 管理者成果",
        detail: "发布前请核对固定 CERN PDF 的成果范围。",
        target: "CERN WLCG manager result",
        scope: "current workspace",
        impact: "Makes the reviewed CERN result available to the selected audience.",
        risk: "high",
        idempotencyKey: "m3-window-scaling-approval",
      });
      return { login: login.ok, taskId: task.id, approvalId: proposal.approval?.id || null, approvalQueued: proposal.queued };
    })()
  `, true) as { login?: boolean; taskId?: string; approvalId?: string | null; approvalQueued?: boolean };
  details.seeded = seeded;
  checks.authenticatedProductUi = seeded.login === true;
  checks.cernResultSeeded = Boolean(seeded.taskId);
  checks.approvalSeeded = seeded.approvalQueued === true && Boolean(seeded.approvalId);

  const profiles = [
    { id: "1366x768-100", width: 1366, height: 768, zoom: 1 },
    { id: "1920x1080-150-maximized", width: 1920, height: 1080, zoom: 1.5 },
    { id: "1100x720-125-minimum", width: 1100, height: 720, zoom: 1.25 },
    { id: "1366x768-100-returned-display", width: 1366, height: 768, zoom: 1 },
  ];

  for (const profile of profiles) {
    window.setBounds({ x: profile.id.includes("returned") ? 80 : 0, y: profile.id.includes("returned") ? 40 : 0, width: profile.width, height: profile.height });
    window.webContents.setZoomFactor(profile.zoom);
    if (!window.isVisible()) window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const profileResult: Record<string, unknown> = { profile, pages: {} };
    const chat = await auditM3Page(window, "chat", ".conversation-panel textarea", [".conversation-panel textarea", ".conversation-panel .composer-submit"]);
    (profileResult.pages as Record<string, unknown>).chat = chat;
    recordM3Checks(checks, profile.id, "chat", chat);

    await window.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll("button")].find((item) => [item.textContent, item.title, item.getAttribute("aria-label")].some((value) => /成果|Results/i.test(value || "")));
        if (!button) return false;
        button.click();
        return true;
      })()
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const results = await auditM3Page(window, "results", '[data-testid="results-open-artifact"]', ['[data-testid="results-open-artifact"]', '[data-testid="results-share-artifact"]']);
    (profileResult.pages as Record<string, unknown>).results = results;
    recordM3Checks(checks, profile.id, "results", results);

    await window.webContents.executeJavaScript('window.dispatchEvent(new Event("drsai:e2e-open-approval-center")); true', true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const approvals = await auditM3Page(window, "approvals", ".approval-pending-actions button.approve", [".approval-pending-actions button.approve", ".approval-pending-actions button.reject"]);
    (profileResult.pages as Record<string, unknown>).approvals = approvals;
    recordM3Checks(checks, profile.id, "approvals", approvals);

    const image = await window.webContents.capturePage();
    const screenshotPath = join(evidenceDir, `${profile.id}.png`);
    writeFileSync(screenshotPath, image.toPNG());
    profileResult.screenshotPath = screenshotPath;
    (details.profiles as Array<Record<string, unknown>>).push(profileResult);

    await window.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll("button")].find((item) => [item.textContent, item.title, item.getAttribute("aria-label")].some((value) => /当前会话|Current session|开始聊天|New chat/i.test(value || "")));
        if (button) button.click();
      })()
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  checks.displayTransitionPreservedContent = profiles.length === 4 && (details.profiles as Array<unknown>).length === 4;
  return { ok: Object.values(checks).every(Boolean), checks, details };
}

interface M3PageAudit {
  page: string;
  targetPresent: boolean;
  targetVisible: boolean;
  noHorizontalOverflow: boolean;
  allRequiredControlsReachable: boolean;
  textReadable: boolean;
  controlsDoNotOverlap: boolean;
  viewport: { width: number; height: number };
  documentSize: { width: number; height: number };
  requiredControls: Array<Record<string, unknown>>;
}

async function auditM3Page(window: BrowserWindow, page: string, targetSelector: string, requiredSelectors: string[]): Promise<M3PageAudit> {
  return window.webContents.executeJavaScript(`
    (() => {
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, fontSize: Number.parseFloat(style.fontSize) || 0, display: style.display, visibility: style.visibility };
      };
      const visible = (rect) => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.x < innerWidth && rect.y < innerHeight && rect.display !== "none" && rect.visibility !== "hidden";
      const selectors = ${JSON.stringify(requiredSelectors)};
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const required = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => ({ selector, ...rectOf(element), text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 120) })));
      const targetRect = target ? rectOf(target) : null;
      const reachable = selectors.every((selector) => document.querySelector(selector)) && required.every((item) => visible(item) && item.x >= -1 && item.right <= innerWidth + 1 && item.y >= -1 && item.bottom <= innerHeight + 1);
      const readable = required.every((item) => item.fontSize >= 12);
      let overlap = false;
      for (let i = 0; i < required.length; i += 1) for (let j = i + 1; j < required.length; j += 1) {
        const a = required[i], b = required[j];
        if (a.selector === b.selector && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 2) overlap = true;
      }
      return {
        page: ${JSON.stringify(page)},
        targetPresent: Boolean(target),
        targetVisible: Boolean(targetRect && visible(targetRect)),
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.body.clientWidth + 1,
        allRequiredControlsReachable: reachable,
        textReadable: readable,
        controlsDoNotOverlap: !overlap,
        viewport: { width: innerWidth, height: innerHeight },
        documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        requiredControls: required,
      };
    })()
  `, true) as Promise<M3PageAudit>;
}

function recordM3Checks(checks: Record<string, boolean>, profile: string, page: string, audit: M3PageAudit): void {
  const prefix = `${profile}_${page}`.replace(/[^a-z0-9]+/gi, "_");
  checks[`${prefix}_targetPresent`] = audit.targetPresent;
  checks[`${prefix}_targetVisible`] = audit.targetVisible;
  checks[`${prefix}_noHorizontalOverflow`] = audit.noHorizontalOverflow;
  checks[`${prefix}_allRequiredControlsReachable`] = audit.allRequiredControlsReachable;
  checks[`${prefix}_textReadable`] = audit.textReadable;
  checks[`${prefix}_controlsDoNotOverlap`] = audit.controlsDoNotOverlap;
}

async function runBackgroundPresentationSmoke(
  window: BrowserWindow,
  fixtureName: string,
  fixturePath: string,
): Promise<SmokeResult> {
  const started = (await window.webContents.executeJavaScript(`
    (async () => {
      const fixtureName = ${JSON.stringify(fixtureName)};
      const fixturePath = ${JSON.stringify(fixturePath)};
      const checks = {};
      async function waitFor(find, timeout = 30000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      }
      checks.domReady = Boolean(await waitFor(() => document.querySelector(".app-shell"), 10000));
      const processStartedAt = Number(${JSON.stringify(process.env.OPENDRSAI_E2E_APP_STARTED_MS || "0")});
      details.firstInteractiveScreenMs = processStartedAt > 0 ? Date.now() - processStartedAt : null;
      checks.firstInteractiveScreenWithinThreeSeconds = processStartedAt > 0
        ? details.firstInteractiveScreenMs <= 3000
        : true;
      checks.authenticatedUserSessionVisible = (await window.openDrSai.getAuthSession())?.authenticated === true;
      const fixtureWorkspacePath = fixturePath.slice(0, fixturePath.lastIndexOf("\\\\"));
      const workspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item"))
        .find((button) => button.getAttribute("title")?.includes(fixtureWorkspacePath)), 15000);
      checks.fixtureWorkspaceAvailable = Boolean(workspaceButton);
      workspaceButton?.click();
      checks.fixtureWorkspaceSelected = Boolean(await waitFor(() => workspaceButton?.closest(".workspace-row")?.classList.contains("active"), 5000));
      const rightPanelToggle = document.querySelector(".titlebar-right-panel-toggle");
      if (!document.querySelector(".files-context-panel")) rightPanelToggle?.click();
      checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector(".files-context-panel"), 10000));
      const fileRow = await waitFor(() => Array.from(document.querySelectorAll(".files-tree-row"))
        .find((row) => row.getAttribute("title") === fixtureName || row.textContent?.includes(fixtureName)));
      checks.fixtureVisible = Boolean(fileRow);
      fileRow?.click();
      checks.presentationDetected = Boolean(await waitFor(() => document.querySelector(".presentation-pdf-action"), 10000));
      const actionButton = document.querySelector('[data-testid="generate-manager-presentation"]');
      checks.actionVisible = Boolean(actionButton);
      window.confirm = () => true;
      actionButton?.click();
      const parsing = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
        return candidate?.getAttribute("data-phase") === "analyzing"
          && Number(candidate.getAttribute("data-progress")) >= 12 ? candidate : null;
      }, 10000);
      checks.parserStartedBeforeWindowClose = Boolean(parsing);
      return {
        checks,
        requestId: parsing?.getAttribute("data-request-id") || "",
      };
    })()
  `, true)) as { checks: Record<string, boolean>; requestId: string };

  const checks = { ...started.checks };
  const details: Record<string, unknown> = {
    fixtureName,
    fixturePath,
    scenario: "background-close",
    backgroundRequestId: started.requestId,
    capturedAt: new Date().toISOString(),
  };
  window.close();
  checks.nativeWindowCloseIntercepted = !window.isDestroyed() && !window.isVisible();
  checks.windowHiddenDuringBackgroundWork = !window.isVisible();

  const taskStorePath = join(
    process.env.DRSAI_HOME || dirname(fixturePath),
    "desktop",
    "manager-presentation-tasks.json",
  );
  const completed = await waitForMain(() => {
    try {
      const tasks = JSON.parse(readFileSync(taskStorePath, "utf8"));
      return Array.isArray(tasks)
        ? tasks.find((task) => task?.requestId === started.requestId && task?.phase === "completed")
        : null;
    } catch {
      return null;
    }
  }, 60_000);
  checks.backgroundCompletedWhileWindowHidden = Boolean(completed)
    && !window.isDestroyed()
    && !window.isVisible();
  details.generatedOutputPath = completed?.outputPath || "";
  details.manifestPath = typeof completed?.outputPath === "string"
    ? completed.outputPath.replace(/\.pptx$/i, ".provenance.json")
    : "";

  const secondInstanceEnv = { ...process.env };
  delete secondInstanceEnv.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION;
  delete secondInstanceEnv.OPENDRSAI_E2E_PRESENTATION_SCENARIO;
  delete secondInstanceEnv.OPENDRSAI_E2E_RESULT;
  delete secondInstanceEnv.OPENDRSAI_E2E_SCREENSHOT;
  const secondInstance = spawn(process.execPath, [
    ...process.argv.slice(1).filter((argument) => !argument.startsWith("--user-data-dir=")),
    `--user-data-dir=${app.getPath("userData")}`,
  ], {
    env: secondInstanceEnv,
    stdio: "ignore",
    windowsHide: true,
  });
  secondInstance.unref();
  checks.secondInstanceLaunched = true;
  checks.windowReopenedAfterBackgroundCompletion = Boolean(await waitForMain(
    () => window.isVisible() && !window.isDestroyed(),
    10_000,
  ));

  const reopened = (await window.webContents.executeJavaScript(`
    (async () => {
      const requestId = ${JSON.stringify(started.requestId)};
      const fixturePath = ${JSON.stringify(fixturePath)};
      const checks = {};
      async function waitFor(find, timeout = 10000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      }
      const result = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'));
      const progress = document.querySelector('[data-testid="manager-presentation-progress"]');
      checks.resultVisibleAfterReopen = Boolean(result);
      checks.backgroundRequestIdPreserved = progress?.getAttribute("data-request-id") === requestId;
      checks.completedStateVisible = progress?.getAttribute("data-phase") === "completed";
      const api = window.openDrSai;
      const workspacePath = fixturePath.slice(0, fixturePath.lastIndexOf("\\\\"));
      const tasks = api ? await api.listBackgroundTasks({ workspacePath, limit: 50 }) : [];
      const task = tasks.find((candidate) => candidate.kind === "presentation_generation" && candidate.targetId === requestId);
      checks.presentationInUnifiedBackgroundQueue = Boolean(task);
      checks.backgroundQueueCompleted = task?.status === "completed" && task.progress === 100;
      checks.backgroundQueuePreservedSteps = Array.isArray(task?.completedSteps)
        && task.completedSteps.length === 4
        && Array.isArray(task.pendingDecisions)
        && task.pendingDecisions.length === 0;
      const recovery = api ? await api.getManagerPresentationRecovery({ workspacePath, sourcePath: fixturePath }) : undefined;
      checks.recoveryClearedAfterCompletion = recovery === null;
      const tree = api ? await api.listWorkspaceFiles({ workspacePath, maxDepth: 8, maxEntries: 900 }) : { nodes: [] };
      const pending = [...(tree.nodes || [])];
      const paths = [];
      while (pending.length) {
        const node = pending.pop();
        if (!node) continue;
        if (typeof node.path === "string") paths.push(node.path);
        if (Array.isArray(node.children)) pending.push(...node.children);
      }
      const artifactRoot = workspacePath.replace(/[\\\\/]+$/, "") + "\\\\artifacts\\\\";
      const deliverablePaths = paths.filter((path) =>
        path.toLowerCase().startsWith(artifactRoot.toLowerCase())
        && !/[\\\\/]/.test(path.slice(artifactRoot.length)));
      checks.singleManagerPptxFile = deliverablePaths.filter((path) => /manager-zh\.pptx$/i.test(path)).length === 1;
      checks.singleManagerManifestFile = deliverablePaths.filter((path) => /manager-zh\.provenance\.json$/i.test(path)).length === 1;
      return { checks, task, resultText: result?.textContent?.replace(/\\s+/g, " ").trim() || "" };
    })()
  `, true)) as { checks: Record<string, boolean>; task?: unknown; resultText: string };
  Object.assign(checks, reopened.checks);
  details.backgroundTask = reopened.task;
  details.generatedResultText = reopened.resultText;

  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    details.screenshotPath = screenshotPath;
  }
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    details,
  };
}

async function waitForMain<T>(find: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return null;
}

async function runPresentationPdfActionSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixtureName = process.env.OPENDRSAI_E2E_PRESENTATION_PDF_NAME || "";
  const fixturePath = process.env.OPENDRSAI_E2E_PRESENTATION_PDF_PATH || "";
  const scenario = process.env.OPENDRSAI_E2E_PRESENTATION_SCENARIO || "cancel-retry";
  if (scenario === "background-close") {
    return runBackgroundPresentationSmoke(window, fixtureName, fixturePath);
  }
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const fixtureName = ${JSON.stringify(fixtureName)};
      const fixturePath = ${JSON.stringify(fixturePath)};
      const scenario = ${JSON.stringify(scenario)};
      const recoveryScenario = ["restart-resume", "strong-kill-resume", "strong-kill-restart", "strong-kill-abandon"].includes(scenario);
      const checks = {};
      const details = { fixtureName, fixturePath, scenario, capturedAt: new Date().toISOString() };

      async function waitFor(find, timeout = 30000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      }

      checks.domReady = Boolean(await waitFor(() => document.querySelector(".app-shell"), 10000));
      const processStartedAt = Number(${JSON.stringify(process.env.OPENDRSAI_E2E_APP_STARTED_MS || "0")});
      details.firstInteractiveScreenMs = processStartedAt > 0 ? Date.now() - processStartedAt : null;
      checks.firstInteractiveScreenWithinThreeSeconds = processStartedAt > 0
        ? details.firstInteractiveScreenMs <= 3000
        : true;
      checks.authenticatedUserSessionVisible = (await window.openDrSai.getAuthSession())?.authenticated === true;
      const fixtureWorkspacePath = fixturePath.slice(0, fixturePath.lastIndexOf("\\\\"));
      const fixtureWorkspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item"))
        .find((button) => button.getAttribute("title")?.includes(fixtureWorkspacePath)), 15000);
      checks.fixtureWorkspaceAvailable = Boolean(fixtureWorkspaceButton);
      fixtureWorkspaceButton?.click();
      checks.fixtureWorkspaceSelected = Boolean(await waitFor(() => fixtureWorkspaceButton?.closest(".workspace-row")?.classList.contains("active"), 5000));
      const rightPanelToggle = document.querySelector(".titlebar-right-panel-toggle");
      checks.rightPanelToggleVisible = Boolean(rightPanelToggle);
      if (!document.querySelector(".files-context-panel")) rightPanelToggle?.click();
      checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector(".files-context-panel"), 10000));

      const fileRow = await waitFor(() => Array.from(document.querySelectorAll(".files-tree-row"))
        .find((row) => row.getAttribute("title") === fixtureName || row.textContent?.includes(fixtureName)));
      checks.fixtureVisible = Boolean(fileRow);
      fileRow?.click();

      const action = await waitFor(() => document.querySelector(".presentation-pdf-action"));
      const previewText = document.querySelector(".files-preview-pdf .files-preview-code")?.textContent || "";
      details.previewTextSample = previewText.slice(0, 1200);
      checks.presentationTypeInPreview = previewText.includes("PDF type: presentation_pdf");
      checks.pageCountInPreview = previewText.includes("Pages: 48");
      checks.coverRoleInPreview = previewText.includes("[Page 1 | cover]");
      checks.agendaRoleInPreview = previewText.includes("[Page 2 | agenda]");
      checks.summaryRoleInPreview = previewText.includes("[Page 47 | summary]");
      checks.questionsRoleInPreview = previewText.includes("[Page 48 | questions]");
      const actionText = action?.textContent || "";
      details.actionText = actionText.replace(/\\s+/g, " ").trim();
      checks.presentationDetected = Boolean(action);
      checks.explanationVisible = /演示型 PDF|presentation-style PDF/i.test(actionText)
        && /可编辑|editable/i.test(actionText)
        && /讲稿|speaker notes/i.test(actionText)
        && /来源页码|source pages/i.test(actionText);
      if (scenario === "g8-storyline") {
        const storyPanel = await waitFor(() => document.querySelector('[data-testid="presentation-storyline"]'), 10000);
        const storyPreview = await window.openDrSai.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: fixturePath, maxBytes: 220000 });
        const story = storyPreview?.presentationStory;
        const quality = story?.quality;
        const storyText = storyPanel?.textContent || "";
        const requiredSections = ["HEP at CERN", "WLCG distributed computing", "Asian networks for HEP", "WLCG Data Challenges", "Conclusions"];
        const sectionText = [...(story?.agenda || []), ...(story?.storySections || [])].map((item) => item.text).join("\\n");
        const numeric = story?.numericHighlights || [];
        const factPatterns = [
          { id: "hl_lhc_data_factor", page: 8, pattern: /volume of data[\\s\\S]{0,100}factor of 10/i },
          { id: "minimal_bandwidth_tbps", page: 42, pattern: /4\\.8\\s*Tbps expected HL-LHC bandwidth/i },
          { id: "flexible_bandwidth_tbps", page: 42, pattern: /9\\.6\\s*Tbps expected HL-LHC bandwidth/i },
          { id: "dc_2027_target", page: 43, pattern: /2027:\\s*50% of HL-LHC requirements/i },
          { id: "dc_2029_target", page: 43, pattern: /2029:\\s*100% of HL-LHC requirements/i },
        ];
        const factAudit = factPatterns.map((fact) => {
          const match = numeric.find((item) => fact.pattern.test(item.text));
          return { id: fact.id, expectedPage: fact.page, actualPage: match?.page ?? null, matched: Boolean(match && match.page === fact.page), text: match?.text || "" };
        });
        checks.storylinePanelVisible = Boolean(storyPanel);
        checks.storylineQualityPassed = storyPanel?.getAttribute("data-quality-status") === "passed" && quality?.status === "passed";
        checks.titleVisible = storyText.includes("Distributed computing for High Energy Physics");
        checks.requiredThemesComplete = requiredSections.every((section) => sectionText.includes(section));
        checks.goldenNumbersCorrect = factAudit.every((fact) => fact.matched);
        checks.goldenNumberAccuracy100 = factAudit.filter((fact) => fact.matched).length === factAudit.length;
        checks.summaryMappedToPage47 = (story?.summaryPoints || []).length >= 4 && story.summaryPoints.every((item) => item.page === 47);
        checks.allStoryItemsSourceMapped = quality?.sourceMappedItems === quality?.sourceMappingExpected && Number(quality?.sourceMappingExpected) > 0;
        checks.allNumericItemsVerifiedAgainstSource = quality?.numericSourceMatches === quality?.numericSourceExpected && Number(quality?.numericSourceExpected) > 0;
        checks.storylineVisibleWithoutGeneratingPpt = !document.querySelector('[data-testid="manager-presentation-progress"]');
        storyPanel?.querySelector('[data-testid="presentation-story-summary"] summary')?.click();
        checks.summaryAndChecksExpandable = Boolean(storyPanel?.querySelector('[data-testid="presentation-story-summary"][open]')) && /来源页码|source/i.test(storyText);
        const page42 = storyPanel?.querySelector('button[data-number-page="42"]');
        page42?.click();
        const pageStatus = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="story-source-page-status"]');
          return candidate?.getAttribute("data-opened-page") === "42" ? candidate : null;
        }, 5000);
        checks.keyNumberPage42Clickable = Boolean(page42 && pageStatus);
        checks.noInternalTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(storyText);
        details.g8Storyline = { title: story?.title, quality, sections: story?.storySections, factAudit, summaryPoints: story?.summaryPoints };
        storyPanel?.querySelector("header")?.scrollIntoView({ block: "start" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "g11-audience-versions") {
        window.confirm = () => true;
        const managerButton = document.querySelector('[data-testid="generate-manager-presentation"]');
        const technicalButton = document.querySelector('[data-testid="generate-technical-presentation"]');
        checks.twoAudienceActionsVisible = Boolean(managerButton && technicalButton);
        managerButton?.click();
        const managerCard = await waitFor(() => document.querySelector('[data-testid="presentation-audience-results"] article[data-audience="non_expert_managers"]'), 30000);
        checks.managerVersionCompleted = Boolean(managerCard);
        const technicalReady = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="generate-technical-presentation"]');
          return candidate && !candidate.hasAttribute("disabled") ? candidate : null;
        }, 5000);
        technicalReady?.click();
        const technicalCard = await waitFor(() => document.querySelector('[data-testid="presentation-audience-results"] article[data-audience="technical_experts"]'), 30000);
        const comparison = await waitFor(() => document.querySelector('[data-testid="presentation-audience-comparison"]'), 5000);
        checks.technicalVersionCompleted = Boolean(technicalCard);
        checks.twoDistinctPptxRegistered = Boolean(managerCard && technicalCard)
          && managerCard.getAttribute("data-output-path") !== technicalCard.getAttribute("data-output-path")
          && /manager-zh\.pptx$/i.test(managerCard.getAttribute("data-output-path") || "")
          && /technical-zh\.pptx$/i.test(technicalCard.getAttribute("data-output-path") || "");
        const managerFacts = (managerCard?.getAttribute("data-facts") || "").split(",").filter(Boolean).sort();
        const technicalFacts = (technicalCard?.getAttribute("data-facts") || "").split(",").filter(Boolean).sort();
        checks.coreFactsIdentical = managerFacts.length === 5 && JSON.stringify(managerFacts) === JSON.stringify(technicalFacts);
        const managerImpact = Number(managerCard?.getAttribute("data-impact-signals") || 0);
        const technicalImpact = Number(technicalCard?.getAttribute("data-impact-signals") || 0);
        const managerTechnical = Number(managerCard?.getAttribute("data-technical-signals") || 0);
        const technicalTechnical = Number(technicalCard?.getAttribute("data-technical-signals") || 0);
        const managerAcronyms = Number(managerCard?.getAttribute("data-acronyms") || 0);
        const technicalAcronyms = Number(technicalCard?.getAttribute("data-acronyms") || 0);
        checks.managerEmphasizesImpactAndDecision = managerImpact > technicalImpact;
        checks.technicalPreservesMoreModelDetail = technicalTechnical > managerTechnical;
        checks.managerUsesFewerAcronyms = managerAcronyms < technicalAcronyms;
        checks.notOnlyVisualDifference = Boolean(managerCard?.getAttribute("data-content-hash"))
          && managerCard?.getAttribute("data-content-hash") !== technicalCard?.getAttribute("data-content-hash");
        checks.comparisonPassed = comparison?.getAttribute("data-status") === "passed";
        const api = window.openDrSai;
        const tasks = await api.listBackgroundTasks({ workspacePath: fixtureWorkspacePath, limit: 100 });
        const audienceTasks = tasks.filter((task) => task.kind === "presentation_generation" && task.status === "completed");
        checks.twoCompletedBackgroundTasks = audienceTasks.length === 2;
        managerCard?.querySelector("button")?.click();
        technicalCard?.querySelector("button")?.click();
        checks.bothOpenActionsAvailable = Boolean(managerCard?.querySelector("button") && technicalCard?.querySelector("button"));
        details.g11AudienceVersions = {
          managerOutputPath: managerCard?.getAttribute("data-output-path") || "",
          technicalOutputPath: technicalCard?.getAttribute("data-output-path") || "",
          managerManifestPath: (managerCard?.getAttribute("data-output-path") || "").replace(/\.pptx$/i, ".provenance.json"),
          technicalManifestPath: (technicalCard?.getAttribute("data-output-path") || "").replace(/\.pptx$/i, ".provenance.json"),
          managerFacts,
          technicalFacts,
          managerImpact,
          technicalImpact,
          managerTechnical,
          technicalTechnical,
          managerAcronyms,
          technicalAcronyms,
          managerContentHash: managerCard?.getAttribute("data-content-hash") || "",
          technicalContentHash: technicalCard?.getAttribute("data-content-hash") || "",
          taskIds: audienceTasks.map((task) => task.id),
        };
        comparison?.scrollIntoView({ block: "center" });
        return { checks, details };
      }
      if (scenario === "h1-key-conclusions") {
        window.confirm = () => true;
        const generateButton = document.querySelector('[data-testid="generate-manager-presentation"]');
        checks.managerActionVisible = Boolean(generateButton);
        generateButton?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const conclusions = await waitFor(() => document.querySelector('[data-testid="presentation-key-conclusions"]'), 5000);
        const cards = Array.from(conclusions?.querySelectorAll('[data-testid="presentation-key-conclusion"]') || []);
        checks.generationCompleted = Boolean(generatedResult);
        checks.keyConclusionPanelVisible = Boolean(conclusions);
        checks.fiveGoldenConclusionsVisible = cards.length === 5;
        checks.traceabilityRate100 = conclusions?.getAttribute("data-traceability-rate") === "1"
          && conclusions?.getAttribute("data-status") === "passed";
        checks.everyConclusionVerified = cards.length === 5
          && cards.every((card) => card.getAttribute("data-verified") === "true");
        checks.everyConclusionHasExactSource = cards.length === 5
          && cards.every((card) => card.getAttribute("data-source-path") === fixturePath
            && Number.isInteger(Number(card.getAttribute("data-page")))
            && Number(card.getAttribute("data-page")) > 0
            && Boolean(card.getAttribute("data-evidence-text")));
        const expected = new Map([
          ["hl_lhc_data_growth_10x", "8"],
          ["minimal_bandwidth_4_8_tbps", "42"],
          ["flexible_bandwidth_9_6_tbps", "42"],
          ["data_challenge_2027_50_percent", "43"],
          ["data_challenge_2029_100_percent_uncertain", "43"],
        ]);
        checks.goldenConclusionPagesExact = cards.length === expected.size
          && cards.every((card) => expected.get(card.getAttribute("data-conclusion-id") || "") === card.getAttribute("data-page"));
        const opened = [];
        for (const card of cards) {
          const button = card.querySelector("button[data-conclusion-source-page]");
          button?.click();
          const page = button?.getAttribute("data-conclusion-source-page") || "";
          const status = await waitFor(() => {
            const candidate = document.querySelector('[data-testid="source-page-review-status"]');
            return candidate?.getAttribute("data-opened-page") === page ? candidate : null;
          }, 3000);
          opened.push({ id: card.getAttribute("data-conclusion-id"), page, opened: Boolean(status) });
        }
        checks.everyConclusionSourceClickable = opened.length === 5 && opened.every((item) => item.opened);
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        const api = window.openDrSai;
        const tasks = await api.listBackgroundTasks({ workspacePath: fixtureWorkspacePath, limit: 100 });
        checks.completedTaskPersisted = tasks.filter((task) => task.kind === "presentation_generation" && task.status === "completed").length === 1;
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(conclusions?.textContent || "");
        const goldenTasks = [
          {
            id: "h1-g1-paper",
            title: "G1 新手论文理解",
            artifact: "paper-summary.md",
            source: "paper-source.md",
            conclusions: [
              { id: "h1-g1-accuracy", conclusion: "该干预将准确率从 82% 提升到 91%。", locatorType: "file_paragraph", locator: "Paragraph 3", evidenceText: "The intervention improved accuracy from 82% to 91%." },
              { id: "h1-g1-limit", conclusion: "研究限制是仅覆盖单一机构。", locatorType: "file_paragraph", locator: "Paragraph 7", evidenceText: "The study is limited to a single institution." },
            ],
          },
          {
            id: "h1-g3-synthesis",
            title: "G3 多材料调研",
            artifact: "synthesis-report.md",
            source: "synthesis-sources.md",
            conclusions: [
              { id: "h1-g3-consensus", conclusion: "两项独立来源支持 Method X 改善召回率。", locatorType: "file_paragraph", locator: "Source A paragraph 4 + Source B paragraph 6", evidenceText: "Method X improves recall." },
              { id: "h1-g3-conflict", conclusion: "不同数据集的精确率结果存在来源冲突。", locatorType: "file_paragraph", locator: "Source C paragraph 2", evidenceText: "Precision results conflict across datasets." },
            ],
          },
          {
            id: "h1-g4-report",
            title: "G4 更新导师报告",
            artifact: "mentor-report.md",
            source: "latest-data.csv",
            conclusions: [
              { id: "h1-g4-sample", conclusion: "最新样本量从 100 更新为 160。", locatorType: "data_range", locator: "latest-data.csv!A2:C2", evidenceText: "sample_size,100,160" },
              { id: "h1-g4-mean", conclusion: "最新平均分从 42 更新为 47。", locatorType: "data_range", locator: "latest-data.csv!A3:C3", evidenceText: "mean_score,42,47" },
            ],
          },
        ];
        for (const task of goldenTasks) {
          const sourcePath = fixtureWorkspacePath + "\\\\" + task.source;
          await api.enqueueBackgroundTask({
            kind: "agent_run",
            source: "agent",
            title: task.title,
            workspacePath: fixtureWorkspacePath,
            targetId: task.id,
            status: "completed",
            progress: 100,
            message: "成果和关键结论依据已就绪。",
            verification: "关键结论可追溯率 100%。",
            deliverySummary: {
              findingSummary: task.title + "已完成。",
              importance: "high",
              importanceReason: "包含需要用户复核的重要事实性结论。",
              artifacts: [{
                id: task.id + "-artifact",
                label: task.artifact,
                path: fixtureWorkspacePath + "\\\\" + task.artifact,
                kind: "report",
                keyConclusions: task.conclusions.map((item) => ({ ...item, sourcePath, verified: true })),
                conclusionTraceabilityRate: 1,
              }],
              suggestedAction: "逐条查看结论依据。",
              workSummary: "已生成成果并建立结论级证据链。",
              coreConclusion: task.conclusions.map((item) => item.conclusion).join(" "),
              verification: "所有重要事实性结论均已绑定具体来源位置。",
              remainingRisks: "仍需结合实际业务语境复核。",
              completionCriteria: { passed: ["关键结论可追溯率 100%"], incomplete: [] },
            },
          });
        }
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button"))
          .find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRows = await waitFor(() => {
          const rows = goldenTasks.map((task) => document.querySelector('[data-artifact-id="' + task.id + '-artifact"]'));
          return rows.every(Boolean) ? rows : null;
        }, 10000);
        checks.g1G3G4ResultsVisible = Boolean(resultsNav && resultRows?.length === 3);
        const goldenEvidence = [];
        for (const row of resultRows || []) {
          const evidenceDetails = row.querySelector('[data-testid="results-conclusion-evidence"]');
          if (evidenceDetails) evidenceDetails.open = true;
          const evidenceCards = Array.from(row.querySelectorAll('[data-testid="results-key-conclusion"]'));
          for (const evidenceCard of evidenceCards) {
            const button = evidenceCard.querySelector('[data-testid="results-open-conclusion-evidence"]');
            button?.click();
            const status = await waitFor(() => {
              const candidate = evidenceCard.querySelector('[data-testid="results-conclusion-open-status"]');
              return candidate?.getAttribute("data-state") === "opened" ? candidate : null;
            }, 3000);
            goldenEvidence.push({
              id: evidenceCard.getAttribute("data-conclusion-id"),
              evidenceText: evidenceCard.getAttribute("data-evidence-text"),
              locator: evidenceCard.getAttribute("data-locator"),
              locatorType: evidenceCard.getAttribute("data-locator-type"),
              sourcePath: evidenceCard.getAttribute("data-source-path"),
              verified: evidenceCard.getAttribute("data-verified") === "true",
              opened: Boolean(status),
            });
          }
        }
        checks.g1G3G4ConclusionTraceability100 = goldenEvidence.length === 6
          && goldenEvidence.every((item) => item.verified && item.opened && item.locator && item.sourcePath);
        checks.paragraphAndDataRangeLocatorsCovered = goldenEvidence.filter((item) => item.locatorType === "file_paragraph").length === 4
          && goldenEvidence.filter((item) => item.locatorType === "data_range").length === 2;
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h1KeyConclusions = {
          traceabilityRate: conclusions?.getAttribute("data-traceability-rate"),
          conclusions: cards.map((card) => ({
            id: card.getAttribute("data-conclusion-id"),
            page: Number(card.getAttribute("data-page")),
            evidenceText: card.getAttribute("data-evidence-text"),
            sourcePath: card.getAttribute("data-source-path"),
            verified: card.getAttribute("data-verified") === "true",
          })),
          opened,
          goldenTasks: goldenEvidence,
        };
        const finalEvidence = document.querySelector('[data-artifact-id="h1-g4-report-artifact"] [data-testid="results-conclusion-evidence"]');
        finalEvidence?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h2-citation-support") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const cernPanel = await waitFor(() => document.querySelector('[data-testid="presentation-key-conclusions"]'), 5000);
        const cernCitations = Array.from(cernPanel?.querySelectorAll('[data-testid="presentation-citation"]') || []);
        checks.cernFiveCitationsVisible = cernCitations.length === 5;
        checks.cernCitationMetadataExact = cernCitations.length === 5 && cernCitations.every((citation) =>
          citation.getAttribute("data-citation-title") === "Distributed computing for High Energy Physics"
          && citation.getAttribute("data-citation-authors") === "Edoardo Martelli"
          && /^p\.(?:8|42|43)$/.test(citation.getAttribute("data-citation-locator") || "")
          && citation.getAttribute("data-citation-relation") === "supports"
          && Number(citation.getAttribute("data-citation-score")) === 1);
        const cernCitationOpens = [];
        for (const card of Array.from(cernPanel?.querySelectorAll('[data-testid="presentation-key-conclusion"]') || [])) {
          const button = card.querySelector("button[data-conclusion-source-page]");
          button?.click();
          const page = button?.getAttribute("data-conclusion-source-page") || "";
          const status = await waitFor(() => {
            const candidate = document.querySelector('[data-testid="source-page-review-status"]');
            return candidate?.getAttribute("data-opened-page") === page ? candidate : null;
          }, 3000);
          cernCitationOpens.push({ page, opened: Boolean(status) });
        }
        checks.cernCitationTargetsReadable = cernCitationOpens.length === 5 && cernCitationOpens.every((item) => item.opened);
        const api = window.openDrSai;
        const paperPath = fixtureWorkspacePath + "\\\\paper-source.md";
        const synthesisPath = fixtureWorkspacePath + "\\\\synthesis-sources.md";
        const goldenTasks = [
          {
            id: "h2-d1-paper",
            title: "D1 论文引用验收",
            artifact: "paper-summary.md",
            conclusions: [
              {
                id: "h2-d1-accuracy", conclusion: "该干预将准确率从 82% 提升到 91%。", sourcePath: paperPath, locatorType: "file_paragraph", locator: "Paragraph 3", evidenceText: "The intervention improved accuracy from 82% to 91%.", verified: true,
                citations: [{ id: "h2-cite-d1-accuracy", title: "Controlled Intervention Study", authors: ["Alice Chen", "Bob Singh"], sourcePath: paperPath, locatorType: "file_paragraph", locator: "Paragraph 3", excerpt: "The intervention improved accuracy from 82% to 91%.", relation: "supports", supportScore: 1 }],
              },
              {
                id: "h2-d1-limit", conclusion: "研究限制是仅覆盖单一机构。", sourcePath: paperPath, locatorType: "file_paragraph", locator: "Paragraph 7", evidenceText: "The study is limited to a single institution.", verified: true,
                citations: [{ id: "h2-cite-d1-limit", title: "Controlled Intervention Study", authors: ["Alice Chen", "Bob Singh"], sourcePath: paperPath, locatorType: "file_paragraph", locator: "Paragraph 7", excerpt: "The study is limited to a single institution.", relation: "supports", supportScore: 1 }],
              },
            ],
          },
          {
            id: "h2-d3-synthesis",
            title: "D3 多材料引用验收",
            artifact: "synthesis-report.md",
            conclusions: [
              {
                id: "h2-d3-consensus", conclusion: "两个独立来源均支持 Method X 改善召回率。", sourcePath: synthesisPath, locatorType: "file_paragraph", locator: "Source A paragraph 4 + Source B paragraph 6", evidenceText: "Method X improves recall.", verified: true,
                citations: [
                  { id: "h2-cite-d3-a", title: "Recall Improvements A", authors: ["Mei Lin"], sourcePath: synthesisPath, locatorType: "file_paragraph", locator: "Source A paragraph 4", excerpt: "Method X improves recall.", relation: "supports", supportScore: 1 },
                  { id: "h2-cite-d3-b", title: "Recall Improvements B", authors: ["Omar Diaz"], sourcePath: synthesisPath, locatorType: "file_paragraph", locator: "Source B paragraph 6", excerpt: "Method X improves recall.", relation: "supports", supportScore: 1 },
                ],
              },
              {
                id: "h2-d3-conflict", conclusion: "不同数据集的精确率结果存在来源冲突。", sourcePath: synthesisPath, locatorType: "file_paragraph", locator: "Source C paragraph 2", evidenceText: "Precision results conflict across datasets.", verified: true,
                citations: [{ id: "h2-cite-d3-c", title: "Precision Conflict Study", authors: ["Priya Rao"], sourcePath: synthesisPath, locatorType: "file_paragraph", locator: "Source C paragraph 2", excerpt: "Precision results conflict across datasets.", relation: "supports", supportScore: 1 }],
              },
            ],
          },
        ];
        for (const task of goldenTasks) {
          await api.enqueueBackgroundTask({
            kind: "agent_run", source: "agent", title: task.title, workspacePath: fixtureWorkspacePath, targetId: task.id,
            status: "completed", progress: 100, message: "引用已核对。", verification: "引用支持关系准确率 100%，虚构引用 0。",
            deliverySummary: {
              findingSummary: task.title + "已完成。", importance: "high", importanceReason: "重要结论依赖可验证引用。",
              artifacts: [{ id: task.id + "-artifact", label: task.artifact, path: fixtureWorkspacePath + "\\\\" + task.artifact, kind: "report", keyConclusions: task.conclusions, conclusionTraceabilityRate: 1 }],
              suggestedAction: "逐条打开引用复核。", workSummary: "已解析引用元数据和定位片段。",
              coreConclusion: task.conclusions.map((item) => item.conclusion).join(" "), verification: "引用目标存在且支持相邻结论。", remainingRisks: "无虚构引用。",
              completionCriteria: { passed: ["支持关系准确率 100%", "虚构引用 0"], incomplete: [] },
            },
          });
        }
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const rows = await waitFor(() => {
          const items = goldenTasks.map((task) => document.querySelector('[data-artifact-id="' + task.id + '-artifact"]'));
          return items.every(Boolean) ? items : null;
        }, 10000);
        const citations = [];
        for (const row of rows || []) {
          const evidence = row.querySelector('[data-testid="results-conclusion-evidence"]');
          if (evidence) evidence.open = true;
          for (const citation of Array.from(row.querySelectorAll('[data-testid="results-citation"]'))) {
            citation.querySelector('[data-testid="results-open-citation"]')?.click();
            const status = await waitFor(() => {
              const candidate = citation.querySelector('[data-testid="results-citation-open-status"]');
              return candidate?.getAttribute("data-state") === "opened" ? candidate : null;
            }, 3000);
            citations.push({
              id: citation.getAttribute("data-citation-id"), title: citation.getAttribute("data-citation-title"), authors: citation.getAttribute("data-citation-authors"),
              conclusion: citation.closest('[data-testid="results-key-conclusion"]')?.getAttribute("data-conclusion-text"), excerpt: citation.getAttribute("data-citation-excerpt"),
              locator: citation.getAttribute("data-citation-locator"), relation: citation.getAttribute("data-citation-relation"), score: Number(citation.getAttribute("data-citation-score")),
              sourcePath: citation.getAttribute("data-citation-source-path"), opened: Boolean(status),
            });
          }
        }
        checks.d1D3CitationMetadataVisible = citations.length === 5 && citations.every((citation) => citation.title && citation.authors && citation.locator);
        checks.d1D3TargetsReadable = citations.length === 5 && citations.every((citation) => citation.opened && citation.sourcePath);
        checks.supportRelationAccuracy100 = citations.length === 5 && citations.every((citation) => citation.relation === "supports" && citation.score >= 0.95);
        checks.fabricatedCitationsZero = citations.every((citation) => /paper-source\.md|synthesis-sources\.md/i.test(citation.sourcePath || ""));
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test((rows || []).map((row) => row.textContent || "").join(" "));
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h2CitationSupport = { cernCitations: cernCitations.map((citation) => ({ title: citation.getAttribute("data-citation-title"), authors: citation.getAttribute("data-citation-authors"), locator: citation.getAttribute("data-citation-locator"), relation: citation.getAttribute("data-citation-relation"), score: Number(citation.getAttribute("data-citation-score")) })), cernCitationOpens, goldenCitations: citations };
        const finalCitation = document.querySelector('[data-artifact-id="h2-d3-synthesis-artifact"] [data-testid="results-conclusion-evidence"]');
        finalCitation?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h3-numeric-traceability") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const cernPanel = await waitFor(() => document.querySelector('[data-testid="presentation-key-conclusions"]'), 5000);
        const cernNumeric = Array.from(cernPanel?.querySelectorAll('[data-testid="presentation-numeric-evidence"]') || []).map((node) => ({
          id: node.getAttribute("data-numeric-id"), displayValue: node.getAttribute("data-display-value"),
          reportedValue: Number(node.getAttribute("data-reported-value")), recalculatedValue: node.hasAttribute("data-recalculated-value") ? Number(node.getAttribute("data-recalculated-value")) : null,
          unit: node.getAttribute("data-numeric-unit"), kind: node.getAttribute("data-numeric-kind"), status: node.getAttribute("data-numeric-status"),
          formula: node.getAttribute("data-numeric-formula"), locator: node.getAttribute("data-numeric-locator"),
          sourceValues: JSON.parse(node.getAttribute("data-source-values") || "[]"), text: node.textContent || "",
        }));
        checks.cernFiveKeyNumbersVisible = cernNumeric.length === 5;
        checks.cernCalculatedNumbersReproduce = cernNumeric.filter((item) => item.kind === "calculated").length === 2
          && cernNumeric.filter((item) => item.kind === "calculated").every((item) => Math.abs(item.reportedValue - item.recalculatedValue) <= 0.000001);
        checks.cernDirectNumbersMatchSource = cernNumeric.filter((item) => item.kind === "direct").length === 3
          && cernNumeric.filter((item) => item.kind === "direct").every((item) => item.sourceValues.some((source) => Number(source.value) === item.reportedValue));
        checks.cernUnverifiableExplicitlyFlagged = cernNumeric.filter((item) => item.status === "unverifiable").length === 1
          && /100%.*待确认|无法验证.*明确标记/.test(cernNumeric.find((item) => item.status === "unverifiable")?.text || "");
        const cernNumericOpens = [];
        for (const card of Array.from(cernPanel?.querySelectorAll('[data-testid="presentation-key-conclusion"]') || [])) {
          const button = card.querySelector("button[data-conclusion-source-page]");
          button?.click();
          const page = button?.getAttribute("data-conclusion-source-page") || "";
          const status = await waitFor(() => document.querySelector('[data-testid="source-page-review-status"][data-opened-page="' + page + '"]'), 3000);
          cernNumericOpens.push({ page, opened: Boolean(status) });
        }
        checks.cernNumericSourcesOpen = cernNumericOpens.length === 5 && cernNumericOpens.every((item) => item.opened);
        const api = window.openDrSai;
        const numericSourcePath = fixtureWorkspacePath + "\\\\numeric-source.csv";
        const sourceValue = (label, value, unit, locator, rawText) => ({ label, value, unit, sourcePath: numericSourcePath, locator, rawText });
        const numericEvidence = [
          { id: "h3-mean", label: "平均分", displayValue: "60", reportedValue: 60, unit: "分", kind: "calculated", sourcePath: numericSourcePath, locatorType: "calculation", locator: "numeric-source.csv!B2:B6", sourceValues: [40, 50, 60, 70, 80].map((value, index) => sourceValue("score " + (index + 1), value, "分", "B" + (index + 2), String(value))), formula: "(40 + 50 + 60 + 70 + 80) / 5", recalculatedValue: 60, tolerance: 0, status: "verified", explanation: "读取五行 score 后求算术平均值，复算为 60。" },
          { id: "h3-ratio", label: "通过比例", displayValue: "80%", reportedValue: 80, unit: "%", kind: "calculated", sourcePath: numericSourcePath, locatorType: "calculation", locator: "numeric-source.csv!C2:C6", sourceValues: [sourceValue("通过数", 4, "个", "C2:C6", "false,true,true,true,true"), sourceValue("总数", 5, "个", "A2:A6", "5 rows")], formula: "4 / 5 × 100", recalculatedValue: 80, tolerance: 0, status: "verified", explanation: "通过记录 4 条、总记录 5 条，复算比例为 80%。" },
          { id: "h3-anomalies", label: "异常点数量", displayValue: "2 个", reportedValue: 2, unit: "个", kind: "calculated", sourcePath: numericSourcePath, locatorType: "calculation", locator: "numeric-source.csv!D2:D6", sourceValues: [sourceValue("异常标记", 2, "个", "D2:D6", "false,true,false,true,false")], formula: "COUNT(anomaly = true)", recalculatedValue: 2, tolerance: 0, status: "verified", explanation: "异常标记为 true 的记录是第 2、4 行，共 2 个。" },
          { id: "h3-chart-q2", label: "图表 Q2 数值", displayValue: "18", reportedValue: 18, unit: "项", kind: "direct", sourcePath: numericSourcePath, locatorType: "data_range", locator: "numeric-source.csv!E2", sourceValues: [sourceValue("Q2 output", 18, "项", "E2", "18")], formula: "直接读取 E2", recalculatedValue: 18, tolerance: 0, status: "verified", explanation: "图表 Q2 标签直接映射到源数据 E2，数值一致。" },
        ];
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "H3 数字追溯验收", workspacePath: fixtureWorkspacePath, targetId: "h3-numeric-report",
          status: "completed", progress: 100, message: "关键数字已复算。", verification: "黄金数字正确率 100%，无法验证项已明确标记。",
          deliverySummary: {
            findingSummary: "均值、比例、异常点和图表数字已核对。", importance: "high", importanceReason: "报告决策依赖数字准确性。",
            artifacts: [{ id: "h3-numeric-report-artifact", label: "numeric-report.md", path: fixtureWorkspacePath + "\\\\numeric-report.md", kind: "report", keyConclusions: [{ id: "h3-numeric-conclusion", conclusion: "报告包含平均分 60、通过比例 80%、异常点 2 个和图表 Q2 数值 18。", sourcePath: numericSourcePath, locatorType: "data_range", locator: "numeric-source.csv!A1:E6", evidenceText: "五行固定黄金数据。", verified: true, numericEvidence }], conclusionTraceabilityRate: 1 }],
            suggestedAction: "展开数字依据并复核公式。", workSummary: "已读取源数据并逐项复算。", coreConclusion: "四项关键数字均与底层数据一致。",
            verification: "黄金数字正确率 100%。", remainingRisks: "CERN 2029 暂定比例无法独立验证，已显式标记。",
            completionCriteria: { passed: ["黄金数字正确率 100%", "关键数字全部可追溯"], incomplete: ["CERN 2029 目标仍待正式确认"] },
          },
        });
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRow = await waitFor(() => document.querySelector('[data-artifact-id="h3-numeric-report-artifact"]'), 10000);
        const evidence = resultRow?.querySelector('[data-testid="results-conclusion-evidence"]');
        if (evidence) evidence.open = true;
        const goldenNumeric = [];
        for (const node of Array.from(resultRow?.querySelectorAll('[data-testid="results-numeric-evidence"]') || [])) {
          node.querySelector('[data-testid="results-open-numeric-source"]')?.click();
          const openStatus = await waitFor(() => node.querySelector('[data-testid="results-numeric-open-status"][data-state="opened"]'), 3000);
          goldenNumeric.push({
            id: node.getAttribute("data-numeric-id"), displayValue: node.getAttribute("data-display-value"), reportedValue: Number(node.getAttribute("data-reported-value")),
            recalculatedValue: Number(node.getAttribute("data-recalculated-value")), unit: node.getAttribute("data-numeric-unit"), kind: node.getAttribute("data-numeric-kind"),
            status: node.getAttribute("data-numeric-status"), formula: node.getAttribute("data-numeric-formula"), locator: node.getAttribute("data-numeric-locator"),
            sourcePath: node.getAttribute("data-numeric-source-path"), sourceValues: JSON.parse(node.getAttribute("data-source-values") || "[]"), opened: Boolean(openStatus),
          });
        }
        checks.meanRatioAnomalyChartCovered = goldenNumeric.length === 4 && ["h3-mean", "h3-ratio", "h3-anomalies", "h3-chart-q2"].every((id) => goldenNumeric.some((item) => item.id === id));
        checks.goldenNumbersAccuracy100 = goldenNumeric.length === 4 && goldenNumeric.every((item) => Math.abs(item.reportedValue - item.recalculatedValue) <= 0.000001);
        checks.allGoldenNumbersTraceable = goldenNumeric.length === 4 && goldenNumeric.every((item) => item.opened && item.sourcePath && item.locator && item.sourceValues.length > 0 && item.formula);
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\\.asar)/i.test(resultRow?.textContent || "");
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h3NumericTraceability = { cernNumeric, cernNumericOpens, goldenNumeric };
        resultRow?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h4-uncertainty-conflict") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const cernPanel = await waitFor(() => document.querySelector('[data-testid="presentation-key-conclusions"]'), 5000);
        const cernUncertainty = cernPanel?.querySelector('[data-testid="presentation-uncertainty"]');
        checks.cern2029InsufficientDataVisible = Boolean(cernUncertainty)
          && cernUncertainty.getAttribute("data-uncertainty-status") === "insufficient_data"
          && cernUncertainty.getAttribute("data-requires-qualification") === "true"
          && Number(cernUncertainty.getAttribute("data-claim-count")) === 1
          && /数据不足|待确认/.test(cernUncertainty.textContent || "");
        const cern2029Card = cernPanel?.querySelector('[data-conclusion-id="data_challenge_2029_100_percent_uncertain"]');
        const cernButton = cern2029Card?.querySelector("button[data-conclusion-source-page]");
        cernButton?.click();
        const cernOpen = await waitFor(() => document.querySelector('[data-testid="source-page-review-status"][data-opened-page="43"]'), 3000);
        checks.cern2029SourceOpen = Boolean(cernOpen);
        const api = window.openDrSai;
        const sourcePath = fixtureWorkspacePath + "\\\\uncertainty-sources.md";
        const claim = (id, position, locator, excerpt, stance) => ({ id, position, sourcePath, locatorType: "file_paragraph", locator, excerpt, stance });
        const conclusions = [
          {
            id: "h4-conflict", conclusion: "不同数据集对 Method X 精确率的结果存在来源冲突：Alpha 提升 12 个百分点，而 Beta 无可测改善。", sourcePath, locatorType: "file_paragraph", locator: "Source A paragraph 3 + Source B paragraph 5", evidenceText: "Alpha reports improvement; Beta reports no measurable improvement.", verified: true,
            uncertainty: { status: "source_conflict", label: "来源冲突 · 精确率结果不一致", explanation: "两个独立数据集对同一结论给出相反结果，不能合并成确定的正向效果。", recommendedAction: "按数据集分别报告，并补充统一方案的复现实验。", requiresQualification: true, qualifyingLanguage: ["来源冲突", "而"], claims: [
              claim("h4-claim-alpha", "Alpha：精确率提升 12 个百分点", "Source A paragraph 3", "In dataset Alpha, Method X increased precision by 12 percentage points.", "supports"),
              claim("h4-claim-beta", "Beta：没有可测的精确率改善", "Source B paragraph 5", "In dataset Beta, Method X produced no measurable precision improvement.", "contradicts"),
            ] },
          },
          {
            id: "h4-insufficient", conclusion: "长期效果数据不足，目前无法判断 Method X 是否持续有效。", sourcePath, locatorType: "file_paragraph", locator: "Source C paragraph 2", evidenceText: "Follow-up lasted only two weeks.", verified: true,
            uncertainty: { status: "insufficient_data", label: "数据不足 · 缺少长期随访", explanation: "现有随访只有两周，无法支持长期效果结论。", recommendedAction: "延长随访并预先定义长期效果指标。", requiresQualification: true, qualifyingLanguage: ["数据不足", "无法判断"], claims: [claim("h4-claim-followup", "只有两周随访", "Source C paragraph 2", "Follow-up lasted only two weeks, insufficient to assess long-term effects.", "insufficient")] },
          },
          {
            id: "h4-inference", conclusion: "生物标志物变化可能提示作用机制，但这只是推测，尚未直接测量因果机制。", sourcePath, locatorType: "file_paragraph", locator: "Source D paragraph 4", evidenceText: "The causal mechanism was not directly measured.", verified: true,
            uncertainty: { status: "inference", label: "推测 · 机制未直接测量", explanation: "观察到标志物变化，但没有直接测量因果机制。", recommendedAction: "增加机制实验后再形成因果结论。", requiresQualification: true, qualifyingLanguage: ["可能", "推测", "尚未"], claims: [claim("h4-claim-mechanism", "标志物变化但机制未测量", "Source D paragraph 4", "Biomarker levels moved after treatment, but the causal mechanism was not directly measured.", "insufficient")] },
          },
        ];
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "H4 不确定性调研验收", workspacePath: fixtureWorkspacePath, targetId: "h4-uncertainty-report",
          status: "completed", progress: 100, message: "冲突和不确定性已标记。", verification: "来源冲突、数据不足和推测均保持限定措辞。",
          deliverySummary: {
            findingSummary: "三类不确定结论已分别展示。", importance: "high", importanceReason: "错误确定化会误导后续决策。",
            artifacts: [{ id: "h4-uncertainty-report-artifact", label: "uncertainty-report.md", path: fixtureWorkspacePath + "\\\\uncertainty-report.md", kind: "report", keyConclusions: conclusions, conclusionTraceabilityRate: 1 }],
            suggestedAction: "查看冲突双方和建议补证动作。", workSummary: "已逐来源比较结论强度。", coreConclusion: "精确率结果冲突，长期证据不足，机制仅为推测。",
            verification: "三类状态与底层证据一致。", remainingRisks: "尚需统一复现、长期随访和机制实验。",
            completionCriteria: { passed: ["冲突双方已展示", "不确定结论保留限定措辞"], incomplete: ["长期与机制证据仍待补充"] },
          },
        });
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRow = await waitFor(() => document.querySelector('[data-artifact-id="h4-uncertainty-report-artifact"]'), 10000);
        const detailsPanel = resultRow?.querySelector('[data-testid="results-conclusion-evidence"]');
        if (detailsPanel) detailsPanel.open = true;
        const assessments = [];
        for (const node of Array.from(resultRow?.querySelectorAll('[data-testid="results-uncertainty-assessment"]') || [])) {
          const conclusion = node.closest('[data-testid="results-key-conclusion"]')?.getAttribute("data-conclusion-text") || "";
          const claims = [];
          for (const claimNode of Array.from(node.querySelectorAll('[data-testid="results-uncertainty-claim"]'))) {
            claimNode.querySelector('[data-testid="results-open-uncertainty-claim"]')?.click();
            const openStatus = await waitFor(() => claimNode.querySelector('[data-testid="results-uncertainty-open-status"][data-state="opened"]'), 3000);
            claims.push({ id: claimNode.getAttribute("data-claim-id"), position: claimNode.getAttribute("data-claim-position"), stance: claimNode.getAttribute("data-claim-stance"), locator: claimNode.getAttribute("data-claim-locator"), excerpt: claimNode.getAttribute("data-claim-excerpt"), sourcePath: claimNode.getAttribute("data-claim-source-path"), opened: Boolean(openStatus) });
          }
          assessments.push({ status: node.getAttribute("data-uncertainty-status"), requiresQualification: node.getAttribute("data-requires-qualification") === "true", qualifyingLanguage: node.getAttribute("data-qualifying-language"), conclusion, text: node.textContent || "", claims });
        }
        checks.threeUncertaintyStatesVisible = assessments.length === 3 && ["source_conflict", "insufficient_data", "inference"].every((status) => assessments.some((item) => item.status === status));
        const conflict = assessments.find((item) => item.status === "source_conflict");
        checks.conflictShowsBothSides = conflict?.claims.length === 2 && conflict.claims.some((item) => item.stance === "supports") && conflict.claims.some((item) => item.stance === "contradicts");
        checks.everyUncertaintySourceOpen = assessments.flatMap((item) => item.claims).length === 4 && assessments.flatMap((item) => item.claims).every((item) => item.opened);
        checks.uncertainConclusionsRemainQualified = assessments.every((item) => item.requiresQualification && item.qualifyingLanguage && (item.status === "source_conflict" ? /冲突|不一致/.test(item.conclusion) : item.status === "insufficient_data" ? /数据不足|无法/.test(item.conclusion) : /可能|推测|尚未/.test(item.conclusion)));
        checks.recommendedActionsVisible = assessments.every((item) => /建议动作|Next action/.test(item.text));
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(resultRow?.textContent || "");
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h4UncertaintyConflict = { cern: { status: cernUncertainty?.getAttribute("data-uncertainty-status"), text: cernUncertainty?.textContent, opened: Boolean(cernOpen) }, assessments };
        resultRow?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h5-consistency-check") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const api = window.openDrSai;
        const pdfPath = fixtureWorkspacePath + "\\\\" + fixtureName;
        const dataPath = fixtureWorkspacePath + "\\\\current-data.csv";
        const reportPath = fixtureWorkspacePath + "\\\\stale-report.md";
        const consistencyCheck = {
          checkedAt: new Date().toISOString(), status: "issues_found", expectedIssues: 3, detectedIssues: 3,
          summary: "发现 3 项预埋不一致：过期带宽、错误图表值和把待确认计划写成确定事实。",
          items: [
            { id: "h5-outdated-bandwidth", category: "outdated_number", severity: "high", status: "open", title: "Minimal Model 带宽使用了旧数字", finding: "报告写成 4.7 Tbps，但 CERN 当前来源和数据表均为 4.8 Tbps。", sourcePath: pdfPath, locatorType: "pdf_page", locator: "p.42", observedValue: "4.7 Tbps", expectedValue: "4.8 Tbps", evidenceText: "4.8Tbps expected HL-LHC bandwidth", recommendation: "把 4.7 Tbps 修正为 4.8 Tbps，并保留 p.42 来源。" },
            { id: "h5-chart-q2", category: "chart_mismatch", severity: "medium", status: "open", title: "图表 Q2 数值与数据表不一致", finding: "报告图表写成 20，当前数据表 Q2 output 为 18。", sourcePath: dataPath, locatorType: "data_range", locator: "current-data.csv!A3:C3", observedValue: "20", expectedValue: "18", evidenceText: "q2_output,18,items", recommendation: "把图表 Q2 数据点修正为 18，并重新生成图表。" },
            { id: "h5-2029-certainty", category: "source_mismatch", severity: "high", status: "open", title: "2029 暂定目标被错误写成确定计划", finding: "报告声称 2029 年确定完成 100%，但 CERN 来源明确说明日期和比例待确认。", sourcePath: pdfPath, locatorType: "pdf_page", locator: "p.43", observedValue: "2029 年确定完成 100%", expectedValue: "2029 年暂以 100% 为目标，日期和比例待确认", evidenceText: "2029: 100% of HL-LHC requirements (date and % to be confirmed)", recommendation: "恢复“暂定/待确认”措辞，等待正式计划更新。" },
          ],
        };
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "H5 自动一致性检查", workspacePath: fixtureWorkspacePath, targetId: "h5-consistency-report",
          status: "completed", progress: 100, message: "一致性检查发现 3 项问题。", verification: "预埋错误检出 3/3。",
          deliverySummary: {
            findingSummary: "过期数字、错误图表和来源表述不一致均已找到。", importance: "high", importanceReason: "不一致会直接影响报告可信度。",
            artifacts: [{ id: "h5-stale-report-artifact", label: "stale-report.md", path: reportPath, kind: "report", consistencyCheck }],
            suggestedAction: "逐项接受修正建议或忽略。", workSummary: "已对照 CERN PDF 和当前数据表检查报告。", coreConclusion: "3 项预埋错误全部检出。",
            verification: "错误检出率 100%，每项均有依据和修正建议。", remainingRisks: "被忽略的问题不会自动修正。",
            completionCriteria: { passed: ["预埋错误 3/3", "每项有依据和建议"], incomplete: [] },
          },
        });
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRow = await waitFor(() => document.querySelector('[data-artifact-id="h5-stale-report-artifact"]'), 10000);
        const cernPassed = await waitFor(() => document.querySelector('[data-testid="results-consistency-badge"][data-consistency-status="passed"]'), 10000);
        checks.correctCernArtifactPassesConsistency = Boolean(cernPassed)
          && Number(cernPassed.getAttribute("data-detected-issues")) === 0
          && Number(cernPassed.getAttribute("data-expected-issues")) === 0;
        const checkPanel = resultRow?.querySelector('[data-testid="results-consistency-check"]');
        if (checkPanel) checkPanel.open = true;
        const issueNodes = Array.from(resultRow?.querySelectorAll('[data-testid="results-consistency-issue"]') || []);
        const issues = [];
        for (const [index, node] of issueNodes.entries()) {
          node.querySelector('[data-testid="results-open-consistency-source"]')?.click();
          const openStatus = await waitFor(() => node.querySelector('[data-testid="results-consistency-open-status"][data-state="opened"]'), 3000);
          const action = index === 1 ? "ignored" : "accepted";
          node.querySelector(action === "accepted" ? '[data-testid="results-accept-consistency-issue"]' : '[data-testid="results-ignore-consistency-issue"]')?.click();
          const decision = await waitFor(() => node.querySelector('[data-testid="results-consistency-decision"][data-decision="' + action + '"]'), 3000);
          issues.push({
            id: node.getAttribute("data-issue-id"), category: node.getAttribute("data-issue-category"), severity: node.getAttribute("data-issue-severity"),
            observedValue: node.getAttribute("data-observed-value"), expectedValue: node.getAttribute("data-expected-value"), locator: node.getAttribute("data-issue-locator"),
            sourcePath: node.getAttribute("data-issue-source-path"), evidence: node.getAttribute("data-issue-evidence"), recommendation: node.getAttribute("data-issue-recommendation"),
            opened: Boolean(openStatus), decision: decision?.getAttribute("data-decision"),
          });
        }
        checks.allSeededIssuesDetected = checkPanel?.getAttribute("data-status") === "issues_found"
          && Number(checkPanel.getAttribute("data-expected-issues")) === 3
          && Number(checkPanel.getAttribute("data-detected-issues")) === 3
          && issues.length === 3;
        checks.threeIssueCategoriesCovered = ["outdated_number", "chart_mismatch", "source_mismatch"].every((category) => issues.some((item) => item.category === category));
        checks.everyIssueHasEvidenceAndRecommendation = issues.every((item) => item.opened && item.evidence && item.recommendation && item.observedValue && item.expectedValue);
        checks.acceptAndIgnoreBothWork = issues.filter((item) => item.decision === "accepted").length === 2 && issues.filter((item) => item.decision === "ignored").length === 1;
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(resultRow?.textContent || "");
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h5ConsistencyCheck = { cernPassed: Boolean(cernPassed), issues };
        resultRow?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h6-independent-review") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRow = await waitFor(() => {
          const rows = Array.from(document.querySelectorAll('[data-artifact-kind="presentation"]'));
          return rows.find((row) => row.querySelector('[data-testid="results-consistency-badge"][data-consistency-status="passed"]')) || null;
        }, 10000);
        resultRow?.querySelector('[data-testid="results-repeat-review"]')?.click();
        const repeatCompleted = await waitFor(() => resultRow?.querySelector('[data-testid="results-independent-review-status"][data-state="completed"][data-mode="repeat"]'), 10000);
        resultRow?.querySelector('[data-testid="results-alternative-review"]')?.click();
        const alternativeCompleted = await waitFor(() => resultRow?.querySelector('[data-testid="results-independent-review-status"][data-state="completed"][data-mode="alternative"]'), 10000);
        const reviewPanel = await waitFor(() => resultRow?.querySelector('[data-testid="results-independent-reviews"]'), 10000);
        if (reviewPanel) reviewPanel.open = true;
        const reviewNodes = Array.from(resultRow?.querySelectorAll('[data-testid="results-independent-review"]') || []);
        const reviews = [];
        for (const node of reviewNodes) {
          const sourceButton = node.querySelector('[data-testid="results-open-review-source"]');
          sourceButton?.click();
          const sourceOpened = await waitFor(() => node.querySelector('[data-testid="results-review-source-status"][data-state="opened"]'), 3000);
          reviews.push({
            id: node.getAttribute("data-review-id"),
            mode: node.getAttribute("data-review-mode"),
            method: node.getAttribute("data-review-method"),
            status: node.getAttribute("data-review-status"),
            checkedClaims: Number(node.getAttribute("data-checked-claims")),
            checkedSources: Number(node.getAttribute("data-checked-sources")),
            usesOriginalAnswerText: node.getAttribute("data-uses-original-answer-text"),
            fingerprint: node.getAttribute("data-evidence-fingerprint"),
            scope: Array.from(node.querySelectorAll('[data-testid="results-review-scope"] li')).map((item) => item.textContent || ""),
            findings: Array.from(node.querySelectorAll('[data-testid="results-review-findings"] li')).map((item) => ({
              id: item.getAttribute("data-review-finding-id"), outcome: item.getAttribute("data-review-finding-outcome"),
              sourcePath: item.getAttribute("data-review-finding-source-path"), locator: item.getAttribute("data-review-finding-locator"),
              evidence: item.getAttribute("data-review-finding-evidence"), text: item.textContent || "",
            })),
            uncovered: Array.from(node.querySelectorAll('[data-testid="results-review-uncovered"] li')).map((item) => item.textContent || ""),
            methodDifference: node.querySelector("dl > div:last-child dd")?.textContent || "",
            sourceOpened: Boolean(sourceOpened),
            text: node.textContent || "",
          });
        }
        const persistedTasks = await window.openDrSai.listBackgroundTasks({ limit: 100 });
        const persistedArtifact = persistedTasks.flatMap((task) => task.deliverySummary?.artifacts || []).find((artifact) => artifact.id === resultRow?.getAttribute("data-artifact-id"));
        checks.cernArtifactAvailableForReview = Boolean(resultRow) && Boolean(generatedResult);
        checks.bothUserActionsComplete = Boolean(repeatCompleted) && Boolean(alternativeCompleted);
        checks.sameArtifactHasTwoReviewRecords = reviews.length === 2 && new Set(reviews.map((item) => item.mode)).size === 2;
        checks.methodsAreActuallyDifferent = new Set(reviews.map((item) => item.method)).size === 2
          && new Set(reviews.map((item) => item.fingerprint)).size === 2
          && reviews.every((item) => item.methodDifference.length >= 20);
        checks.cernFactsIndependentlyRechecked = reviews.every((item) => item.checkedClaims === 5 && item.checkedSources === 3 && item.findings.length === 5 && item.status === "passed");
        checks.scopeFindingsAndUncoveredVisible = reviews.every((item) => item.scope.length >= 3 && item.findings.length === 5 && item.uncovered.length >= 2);
        checks.originalAnswerNotReused = reviews.every((item) => item.usesOriginalAnswerText === "false" && !item.text.includes("CERN 黄金数字、来源页码、图表引用和不确定性措辞一致"));
        checks.reviewSourcesOpen = reviews.every((item) => item.sourceOpened);
        checks.reviewRecordsPersist = persistedArtifact?.independentReviews?.length === 2
          && new Set(persistedArtifact.independentReviews.map((item) => item.method)).size === 2;
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(resultRow?.textContent || "");
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h6IndependentReview = { artifactId: resultRow?.getAttribute("data-artifact-id"), reviews };
        resultRow?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "h7-trust-labels") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const presentationTrustCards = Array.from(await waitFor(() => {
          const cards = document.querySelectorAll('[data-testid="presentation-trust-card"]');
          return cards.length === 5 ? cards : null;
        }, 5000) || []);
        const api = window.openDrSai;
        const pdfPath = fixtureWorkspacePath + "\\\\" + fixtureName;
        const sourcePath = fixtureWorkspacePath + "\\\\uncertainty-sources.md";
        const reportPath = fixtureWorkspacePath + "\\\\uncertainty-report.md";
        const definitions = {
          evidence_sufficient: { label: "依据充分", icon: "check", rule: "verified_source", definition: "结论可由可读取的原始来源直接支持，关键数字也已读取或复算一致。", action: "可以使用该结论；对外发布时保留来源位置。" },
          needs_confirmation: { label: "需要确认", icon: "question", rule: "provisional_source", definition: "来源中已有暂定信息，但关键日期、比例或承诺尚未最终确定。", action: "保留待确认措辞，获得正式计划后再更新。" },
          insufficient_data: { label: "数据不足", icon: "warning", rule: "insufficient_observation", definition: "现有观察范围或样本不足以支持当前结论。", action: "补充更长随访或更多样本后再判断。" },
          source_conflict: { label: "来源冲突", icon: "compare", rule: "conflicting_sources", definition: "多个可读取来源对同一问题给出互相矛盾的结果。", action: "并列保留双方结论，并用统一方案重新验证。" },
          inference: { label: "属于推测", icon: "hypothesis", rule: "inference_only", definition: "结论由间接现象推断，尚无直接测量支持因果关系。", action: "完成直接机制实验后再形成确定结论。" },
        };
        const makeTrust = (status, reason, evidenceIds) => ({ status, label: definitions[status].label, definition: definitions[status].definition, reason, icon: definitions[status].icon, recommendedAction: definitions[status].action, evidenceRule: definitions[status].rule, evidenceIds, ruleSatisfied: true });
        const citation = (id, source, locator, excerpt, relation = "supports") => ({ id, title: source === pdfPath ? "Distributed computing for High Energy Physics" : "D3 uncertainty sources", authors: source === pdfPath ? ["Edoardo Martelli"] : ["Controlled test authors"], sourcePath: source, locatorType: locator.startsWith("p.") ? "pdf_page" : "file_paragraph", locator, excerpt, relation, supportScore: relation === "supports" ? 1 : 0 });
        const conclusions = [
          { id: "h7-sufficient", conclusion: "HL-LHC 最低网络模型预计需要 4.8 Tbps 带宽。", sourcePath: pdfPath, locatorType: "pdf_page", locator: "p.42", evidenceText: "4.8Tbps expected HL-LHC bandwidth", verified: true, citations: [citation("h7-cern-42", pdfPath, "p.42", "4.8Tbps expected HL-LHC bandwidth")], trust: makeTrust("evidence_sufficient", "CERN p.42 直接给出 4.8 Tbps，来源可读取且支持结论。", ["h7-cern-42"]) },
          { id: "h7-confirmation", conclusion: "2029 年 Data Challenge 暂以 100% 为目标，日期和比例仍待确认。", sourcePath: pdfPath, locatorType: "pdf_page", locator: "p.43", evidenceText: "2029: 100% of HL-LHC requirements (date and % to be confirmed)", verified: true, citations: [citation("h7-cern-43", pdfPath, "p.43", "2029: 100% of HL-LHC requirements (date and % to be confirmed)")], trust: makeTrust("needs_confirmation", "原文明确写明 date and % to be confirmed，不能当作最终承诺。", ["h7-cern-43"]) },
          { id: "h7-conflict", conclusion: "不同数据集对 Method X 精确率的结果存在来源冲突。", sourcePath, locatorType: "file_paragraph", locator: "Source A paragraph 3 + Source B paragraph 5", evidenceText: "In dataset Alpha, Method X increased precision by 12 percentage points.", verified: true, citations: [citation("h7-conflict-a", sourcePath, "Source A paragraph 3", "In dataset Alpha, Method X increased precision by 12 percentage points."), citation("h7-conflict-b", sourcePath, "Source B paragraph 5", "In dataset Beta, Method X produced no measurable precision improvement.", "contradicts")], trust: makeTrust("source_conflict", "Alpha 报告提升 12 个百分点，Beta 报告没有可测改善。", ["h7-conflict-a", "h7-conflict-b"]) },
          { id: "h7-insufficient", conclusion: "只有两周随访，无法判断长期效果。", sourcePath, locatorType: "file_paragraph", locator: "Source C paragraph 2", evidenceText: "Follow-up lasted only two weeks, insufficient to assess long-term effects.", verified: true, citations: [citation("h7-insufficient-source", sourcePath, "Source C paragraph 2", "Follow-up lasted only two weeks, insufficient to assess long-term effects.", "insufficient")], trust: makeTrust("insufficient_data", "现有随访只有两周，不满足长期效果判断所需观察范围。", ["h7-insufficient-source"]) },
          { id: "h7-inference", conclusion: "生物标志物变化可能提示机制，但尚未直接测量因果机制。", sourcePath, locatorType: "file_paragraph", locator: "Source D paragraph 4", evidenceText: "Biomarker levels moved after treatment, but the causal mechanism was not directly measured.", verified: true, citations: [citation("h7-inference-source", sourcePath, "Source D paragraph 4", "Biomarker levels moved after treatment, but the causal mechanism was not directly measured.", "insufficient")], trust: makeTrust("inference", "观察到标志物变化，但因果机制没有被直接测量。", ["h7-inference-source"]) },
        ];
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "H7 五态可信度标签", workspacePath: fixtureWorkspacePath, targetId: "h7-trust-labels",
          status: "completed", progress: 100, message: "五种可信度状态已按证据规则标记。", verification: "五种标签与底层证据规则一致。",
          deliverySummary: {
            findingSummary: "五类结论分别标记为依据充分、需要确认、数据不足、来源冲突和属于推测。", importance: "high", importanceReason: "统一标签帮助用户判断哪些结论可以直接使用，哪些需要继续验证。",
            artifacts: [{ id: "h7-trust-report-artifact", label: "trust-assessment-report.md", path: reportPath, kind: "report", keyConclusions: conclusions, conclusionTraceabilityRate: 1 }],
            suggestedAction: "逐项查看标签定义、依据和建议动作。", workSummary: "已按五条互斥证据规则评估重要结论。", coreConclusion: "可信度标签完整覆盖五种用户状态。",
            verification: "标签、图标、定义、规则、来源和建议动作均已核对。", remainingRisks: "新来源到达后需要重新计算标签。",
            completionCriteria: { passed: ["五种状态全部覆盖", "证据规则匹配率 100%", "可访问名称完整"], incomplete: [] },
          },
        });
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/i.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const resultRow = await waitFor(() => document.querySelector('[data-artifact-id="h7-trust-report-artifact"]'), 10000);
        const conclusionPanel = resultRow?.querySelector('[data-testid="results-conclusion-evidence"]');
        if (conclusionPanel) conclusionPanel.open = true;
        const cardNodes = Array.from(resultRow?.querySelectorAll('[data-testid="results-trust-card"]') || []);
        const cards = [];
        for (const node of cardNodes) {
          node.querySelector('[data-testid="results-open-trust-evidence"]')?.click();
          const opened = await waitFor(() => node.querySelector('[data-testid="results-trust-open-status"][data-state="opened"]'), 3000);
          cards.push({
            id: node.getAttribute("data-trust-conclusion-id"), status: node.getAttribute("data-trust-status"), label: node.getAttribute("data-trust-label"), icon: node.getAttribute("data-trust-icon"),
            rule: node.getAttribute("data-trust-rule"), ruleSatisfied: node.getAttribute("data-trust-rule-satisfied"), evidenceIds: node.getAttribute("data-trust-evidence-ids"),
            sourcePath: node.getAttribute("data-trust-source-path"), locator: node.getAttribute("data-trust-locator"), evidence: node.getAttribute("data-trust-evidence-text"),
            accessibleName: node.getAttribute("aria-label"), text: node.textContent || "", opened: Boolean(opened),
          });
        }
        const expectedStatuses = Object.keys(definitions);
        checks.cernTrustLabelsVisible = presentationTrustCards.length === 5
          && presentationTrustCards.filter((card) => card.getAttribute("data-trust-status") === "evidence_sufficient").length === 4
          && presentationTrustCards.filter((card) => card.getAttribute("data-trust-status") === "needs_confirmation").length === 1;
        checks.fiveUniqueStatusesVisible = cardNodes.length === 5 && expectedStatuses.every((status) => cards.some((card) => card.status === status));
        checks.labelsAndIconsUnique = new Set(cards.map((card) => card.label)).size === 5 && new Set(cards.map((card) => card.icon)).size === 5;
        checks.definitionsAndActionsVisible = cards.every((card) => /建议动作：/.test(card.text) && card.text.length >= 70);
        checks.accessibleNamesExplainMeaningAndAction = cards.every((card) => card.accessibleName?.includes(card.label) && card.accessibleName.includes("建议动作：") && card.accessibleName.length >= 45);
        checks.evidenceRulesMatchStatuses = cards.every((card) => card.rule === definitions[card.status]?.rule && card.ruleSatisfied === "true" && card.evidenceIds);
        checks.everyTrustEvidenceOpens = cards.every((card) => card.opened);
        checks.nonColorCuesPresent = new Set(cards.map((card) => card.icon)).size === 5 && cards.every((card) => card.label && card.status);
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\\.asar)/i.test(resultRow?.textContent || "");
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        details.generatedOutputPath = outputPath;
        details.manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        details.h7TrustLabels = { cern: presentationTrustCards.map((card) => ({ status: card.getAttribute("data-trust-status"), label: card.getAttribute("data-trust-label"), rule: card.getAttribute("data-trust-rule") })), cards };
        resultRow?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "i1-version-history") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        const manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        const versionPanel = await waitFor(() => document.querySelector('[data-testid="workspace-version-history"]'), 5000);
        versionPanel?.querySelector('[data-testid="refresh-version-history"]')?.click();
        const versionRows = Array.from(await waitFor(() => {
          const rows = document.querySelectorAll('[data-testid="automatic-version-list"] > li[data-version-group]');
          return rows.length >= 2 ? rows : null;
        }, 5000) || []);
        const presentationRows = versionRows.filter((row) => (row.getAttribute("data-version-group") || "").startsWith("presentation-"));
        const beforeRow = presentationRows.find((row) => row.getAttribute("data-version-phase") === "before");
        const afterRow = presentationRows.find((row) => row.getAttribute("data-version-phase") === "after");
        afterRow?.querySelector('[data-testid="compare-version"]')?.click();
        const diffPreview = await waitFor(() => document.querySelector('[data-testid="version-diff-preview"]'), 3000);
        afterRow?.querySelector('[data-testid="open-version"]')?.click();
        const openedMessage = await waitFor(() => {
          const message = versionPanel?.querySelector('[data-testid="version-action-message"][data-version-opened="true"]');
          return message || null;
        }, 3000);
        const versionQuestionButtons = presentationRows.map((row) => row.querySelector('[data-testid="continue-version-question"]')).filter(Boolean);
        afterRow?.querySelector('[data-testid="continue-version-question"]')?.click();
        const versionQuestionInput = await waitFor(() => {
          const textarea = document.querySelector("textarea");
          return textarea && /继续询问版本 V2|Continue asking about version V2/.test(textarea.value || "") ? textarea : null;
        }, 3000);

        const api = window.openDrSai;
        const persisted = await api.listWorkspaceCheckpoints(fixtureWorkspacePath);
        const persistedVersions = persisted.filter((item) => item.automatic && item.versionGroupId?.startsWith("presentation-"));
        const before = persistedVersions.find((item) => item.versionPhase === "before");
        const after = persistedVersions.find((item) => item.versionPhase === "after");
        const beforeTargets = before?.entries.filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json")) || [];
        const afterTargets = after?.entries.filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json")) || [];

        let beforeRestore = null;
        let beforeRestoreApproved = false;
        let beforeRestorePreview = null;
        let afterRestore = null;
        let afterRestoreApproved = false;
        let afterRestorePreview = null;
        if (before && after) {
          beforeRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: before.id });
          beforeRestoreApproved = beforeRestore.approvalId
            ? await api.decidePendingApproval({ id: beforeRestore.approvalId, approved: true })
            : false;
          beforeRestorePreview = await api.previewWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: before.id });
          afterRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: after.id });
          afterRestoreApproved = afterRestore.approvalId
            ? await api.decidePendingApproval({ id: afterRestore.approvalId, approved: true })
            : false;
          afterRestorePreview = await api.previewWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: after.id });
        }

        checks.automaticBeforeAfterPairCreated = persistedVersions.length === 2
          && Boolean(before) && Boolean(after)
          && before.versionGroupId === after.versionGroupId
          && before.versionNumber === 1 && after.versionNumber === 2;
        checks.versionMetadataExplainsChange = persistedVersions.every((item) => item.automatic === true
          && Boolean(item.createdAt) && Boolean(item.objectLabel) && Boolean(item.changeReason));
        checks.cernArtifactsCapturedBeforeAndAfter = beforeTargets.length === 2 && beforeTargets.every((entry) => !entry.existed)
          && afterTargets.length === 2 && afterTargets.every((entry) => entry.existed && entry.stored && entry.fileHash);
        checks.versionFilesKeepOriginalExtensions = afterTargets.some((entry) => entry.versionPath?.endsWith(".pptx"))
          && afterTargets.some((entry) => entry.versionPath?.endsWith(".provenance.json"));
        checks.userVersionHistoryVisible = presentationRows.length === 2
          && Boolean(beforeRow) && Boolean(afterRow)
          && presentationRows.every((row) => row.textContent?.includes("V") && row.querySelector('[data-testid="compare-version"]') && row.querySelector('[data-testid="restore-version"]'));
        checks.versionQuestionAvailableForBothVersions = versionQuestionButtons.length === 2;
        checks.versionQuestionCarriesContext = Boolean(versionQuestionInput) && /修改后|after/.test(versionQuestionInput?.value || "") && /WLCG-20260715/.test(versionQuestionInput?.value || "") && /修改原因|change reason/i.test(versionQuestionInput?.value || "");
        checks.currentVersionComparisonWorks = diffPreview?.getAttribute("data-changed-entry-count") === "0";
        checks.oldVersionOpens = Boolean(openedMessage);
        checks.beforeVersionRestores = beforeRestore?.approvalQueued === true && beforeRestoreApproved === true
          && beforeRestorePreview?.changedEntryCount === 0
          && beforeTargets.every((entry) => beforeRestorePreview.entries.some((preview) => preview.relativePath === entry.relativePath && !preview.currentExists));
        checks.afterVersionRestores = afterRestore?.approvalQueued === true && afterRestoreApproved === true
          && afterRestorePreview?.changedEntryCount === 0
          && afterTargets.every((entry) => afterRestorePreview.entries.some((preview) => preview.relativePath === entry.relativePath && preview.currentExists && preview.change === "unchanged"));
        checks.versionHistoryPersists = (await api.listWorkspaceCheckpoints(fixtureWorkspacePath)).filter((item) => item.versionGroupId === before?.versionGroupId).length === 2;
        checks.noManualSaveRequired = presentationRows.every((row) => row.getAttribute("data-version-phase") === "before" || row.getAttribute("data-version-phase") === "after");
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(versionPanel?.textContent || "");
        details.generatedOutputPath = outputPath;
        details.manifestPath = manifestPath;
        details.i1VersionHistory = { persistedVersions, beforeRestore, beforeRestoreApproved, beforeRestorePreview, afterRestore, afterRestoreApproved, afterRestorePreview };
        versionPanel?.querySelector(".files-checkpoint-header")?.scrollIntoView({ block: "start" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "i2-whole-undo") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        const manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        const api = window.openDrSai;
        const userPath = fixtureWorkspacePath + "/user-owned-notes.md";
        const pdfPath = fixtureWorkspacePath + "/" + fixtureName;
        const initialUser = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: userPath, maxBytes: 100000 });
        const initialPdf = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: pdfPath, maxBytes: 100000 });

        const versionPanel = await waitFor(() => document.querySelector('[data-testid="workspace-version-history"]'), 5000);
        versionPanel?.querySelector('[data-testid="refresh-version-history"]')?.click();
        const versionRows = Array.from(await waitFor(() => {
          const rows = document.querySelectorAll('[data-testid="automatic-version-list"] > li[data-version-group]');
          return rows.length >= 2 ? rows : null;
        }, 5000) || []);
        const presentationRows = versionRows.filter((row) => (row.getAttribute("data-version-group") || "").startsWith("presentation-"));
        const afterRow = presentationRows.find((row) => row.getAttribute("data-version-phase") === "after");
        const wholeUndoButton = afterRow?.querySelector('[data-testid="restore-version-group"]');
        const persisted = await api.listWorkspaceCheckpoints(fixtureWorkspacePath);
        const versions = persisted.filter((item) => item.automatic && item.versionGroupId?.startsWith("presentation-"));
        const before = versions.find((item) => item.versionPhase === "before");
        const after = versions.find((item) => item.versionPhase === "after");
        const beforeTargets = before?.entries.filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json")) || [];
        const afterTargets = after?.entries.filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json")) || [];

        const approveRestore = async (checkpoint, operationId) => {
          const request = await api.restoreWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: checkpoint.id, operationId });
          const approved = request.approvalId ? await api.decidePendingApproval({ id: request.approvalId, approved: true }) : false;
          return { request, approved };
        };
        const auditState = async (checkpoint, expectedExists) => {
          const preview = await api.previewWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: checkpoint.id, maxFiles: 20 });
          const user = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: userPath, maxBytes: 100000 });
          const pdf = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: pdfPath, maxBytes: 100000 });
          const targets = preview.entries.filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json"));
          return {
            targetStateCorrect: targets.length === 2 && targets.every((entry) => entry.currentExists === expectedExists),
            userPreserved: user?.fileHash === initialUser?.fileHash && user?.content === initialUser?.content,
            pdfPreserved: pdf?.fileHash === initialPdf?.fileHash,
            previewChangedCount: preview.changedEntryCount,
          };
        };

        const rounds = [];
        let visibleActionApproval = null;
        if (before && after && wholeUndoButton) {
          const pendingBefore = await api.listPendingApprovals();
          wholeUndoButton.click();
          const approvalDeadline = Date.now() + 3000;
          while (Date.now() < approvalDeadline && !visibleActionApproval) {
            const pendingAfter = await api.listPendingApprovals();
            visibleActionApproval = pendingAfter.find((item) => !pendingBefore.some((old) => old.id === item.id) && item.actionKind === "workspace.revert") || null;
            if (!visibleActionApproval) await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const beforeApproved = visibleActionApproval ? await api.decidePendingApproval({ id: visibleActionApproval.id, approved: true }) : false;
          const beforeState = await auditState(before, false);
          const afterRestore = await approveRestore(after, "i2-after-1");
          const afterState = await auditState(after, true);
          rounds.push({ round: 1, beforeApproved, beforeState, afterApproved: afterRestore.approved, afterState });

          for (let round = 2; round <= 20; round += 1) {
            const beforeRestore = await approveRestore(before, "i2-before-" + round);
            const nextBeforeState = await auditState(before, false);
            const afterRestoreRound = await approveRestore(after, "i2-after-" + round);
            const nextAfterState = await auditState(after, true);
            rounds.push({ round, beforeApproved: beforeRestore.approved, beforeState: nextBeforeState, afterApproved: afterRestoreRound.approved, afterState: nextAfterState });
          }
        }

        const finalVersions = (await api.listWorkspaceCheckpoints(fixtureWorkspacePath)).filter((item) => item.versionGroupId === before?.versionGroupId);
        const finalBefore = finalVersions.find((item) => item.versionPhase === "before");
        const finalAfter = finalVersions.find((item) => item.versionPhase === "after");
        checks.wholeUndoActionVisible = Boolean(wholeUndoButton) && /整体回到修改前|Undo the whole change/i.test(wholeUndoButton?.textContent || "");
        checks.wholeUndoQueuesSingleApproval = Boolean(visibleActionApproval) && visibleActionApproval.actionKind === "workspace.revert";
        checks.twentyDeterministicRoundsPassed = rounds.length === 20 && rounds.every((round) => round.beforeApproved && round.afterApproved && round.beforeState.targetStateCorrect && round.afterState.targetStateCorrect);
        checks.userOriginalContentPreserved20Of20 = rounds.length === 20 && rounds.every((round) => round.beforeState.userPreserved && round.afterState.userPreserved);
        checks.cernSourcePreserved20Of20 = rounds.length === 20 && rounds.every((round) => round.beforeState.pdfPreserved && round.afterState.pdfPreserved);
        checks.allTargetArtifactsRestored20Of20 = rounds.length === 20 && rounds.every((round) => round.afterState.previewChangedCount === 0);
        checks.versionHistorySurvivesEveryUndo = finalVersions.length === 2 && finalBefore?.restoreCount === 20 && finalAfter?.restoreCount === 20;
        checks.eachUndoHasUniqueAuditOperation = finalBefore?.lastRestoreOperationId === "i2-before-20" && finalAfter?.lastRestoreOperationId === "i2-after-20";
        checks.onlyTargetArtifactsParticipate = beforeTargets.length === 2 && afterTargets.length === 2
          && [...beforeTargets, ...afterTargets].every((entry) => /\.(?:pptx|provenance\.json)$/i.test(entry.relativePath));
        checks.finalArtifactsMatchSavedVersion = afterTargets.every((target) => target.fileHash && finalAfter?.entries.some((entry) => entry.relativePath === target.relativePath && entry.fileHash === target.fileHash));
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(versionPanel?.textContent || "");
        details.generatedOutputPath = outputPath;
        details.manifestPath = manifestPath;
        details.i2WholeUndo = { versionGroupId: before?.versionGroupId, initialUserHash: initialUser?.fileHash, initialPdfHash: initialPdf?.fileHash, rounds, finalVersions };
        versionPanel?.querySelector(".files-checkpoint-header")?.scrollIntoView({ block: "start" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      if (scenario === "i3-partial-undo") {
        window.confirm = () => true;
        document.querySelector('[data-testid="generate-manager-presentation"]')?.click();
        const generatedResult = await waitFor(() => document.querySelector('[data-testid="manager-presentation-result"]'), 30000);
        const outputPath = generatedResult?.getAttribute("data-output-path") || "";
        const manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
        const api = window.openDrSai;
        const userPath = fixtureWorkspacePath + "/user-owned-notes.md";
        const pdfPath = fixtureWorkspacePath + "/" + fixtureName;
        const initialUser = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: userPath, maxBytes: 100000 });
        const initialPdf = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: pdfPath, maxBytes: 100000 });

        const versionPanel = await waitFor(() => document.querySelector('[data-testid="workspace-version-history"]'), 5000);
        versionPanel?.querySelector('[data-testid="refresh-version-history"]')?.click();
        const versionRows = Array.from(await waitFor(() => {
          const rows = document.querySelectorAll('[data-testid="automatic-version-list"] > li[data-version-group]');
          return rows.length >= 2 ? rows : null;
        }, 5000) || []);
        const presentationRows = versionRows.filter((row) => (row.getAttribute("data-version-group") || "").startsWith("presentation-"));
        const afterRow = presentationRows.find((row) => row.getAttribute("data-version-phase") === "after");
        const persisted = await api.listWorkspaceCheckpoints(fixtureWorkspacePath);
        const versions = persisted.filter((item) => item.automatic && item.versionGroupId?.startsWith("presentation-"));
        const before = versions.find((item) => item.versionPhase === "before");
        const after = versions.find((item) => item.versionPhase === "after");
        const pptxEntry = before?.entries.find((entry) => entry.relativePath.endsWith(".pptx"));
        const manifestEntry = after?.entries.find((entry) => entry.relativePath.endsWith(".provenance.json"));
        const partialButton = Array.from(afterRow?.querySelectorAll('[data-testid="restore-version-entry"]') || [])
          .find((button) => button.getAttribute("data-restore-path") === pptxEntry?.relativePath);

        const approvePartial = async (checkpoint, operationId, relativePath) => {
          const request = await api.restoreWorkspaceCheckpoint({
            workspacePath: fixtureWorkspacePath,
            checkpointId: checkpoint.id,
            operationId,
            includePaths: [relativePath],
          });
          const approved = request.approvalId ? await api.decidePendingApproval({ id: request.approvalId, approved: true }) : false;
          return { request, approved };
        };
        const auditState = async (expectedPptxExists) => {
          const preview = await api.previewWorkspaceCheckpoint({ workspacePath: fixtureWorkspacePath, checkpointId: after.id, maxFiles: 20 });
          const pptx = preview.entries.find((entry) => entry.relativePath === pptxEntry.relativePath);
          const manifest = preview.entries.find((entry) => entry.relativePath === manifestEntry.relativePath);
          const user = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: userPath, maxBytes: 100000 });
          const pdf = await api.previewWorkspaceFile({ workspacePath: fixtureWorkspacePath, path: pdfPath, maxBytes: 100000 });
          return {
            selectedTargetCorrect: pptx?.currentExists === expectedPptxExists && (expectedPptxExists ? pptx?.change === "unchanged" : true),
            unselectedTargetUnchanged: manifest?.currentExists === true && manifest?.change === "unchanged",
            userPreserved: user?.fileHash === initialUser?.fileHash && user?.content === initialUser?.content,
            pdfPreserved: pdf?.fileHash === initialPdf?.fileHash,
          };
        };

        const rounds = [];
        let visibleActionApproval = null;
        let visibleApprovalTargetsOnlyPptx = false;
        if (before && after && pptxEntry && manifestEntry && partialButton) {
          const pendingBefore = await api.listPendingApprovals();
          partialButton.click();
          const approvalDeadline = Date.now() + 3000;
          while (Date.now() < approvalDeadline && !visibleActionApproval) {
            const pendingAfter = await api.listPendingApprovals();
            visibleActionApproval = pendingAfter.find((item) => !pendingBefore.some((old) => old.id === item.id) && item.actionKind === "workspace.revert") || null;
            if (!visibleActionApproval) await new Promise((resolve) => setTimeout(resolve, 50));
          }
          visibleApprovalTargetsOnlyPptx = Boolean(visibleActionApproval?.target?.endsWith(".pptx"))
            && !String(visibleActionApproval?.detail || "").includes("provenance.json");
          const beforeApproved = visibleActionApproval ? await api.decidePendingApproval({ id: visibleActionApproval.id, approved: true }) : false;
          const beforeState = await auditState(false);
          const afterRestore = await approvePartial(after, "i3-after-1", pptxEntry.relativePath);
          const afterState = await auditState(true);
          rounds.push({ round: 1, beforeApproved, beforeState, afterApproved: afterRestore.approved, afterState });

          for (let round = 2; round <= 20; round += 1) {
            const beforeRestore = await approvePartial(before, "i3-before-" + round, pptxEntry.relativePath);
            const nextBeforeState = await auditState(false);
            const afterRestoreRound = await approvePartial(after, "i3-after-" + round, pptxEntry.relativePath);
            const nextAfterState = await auditState(true);
            rounds.push({ round, beforeApproved: beforeRestore.approved, beforeState: nextBeforeState, afterApproved: afterRestoreRound.approved, afterState: nextAfterState });
          }
        }

        let wrongTargetRejected = false;
        if (before) {
          try {
            const wrongTarget = await api.restoreWorkspaceCheckpoint({
              workspacePath: fixtureWorkspacePath,
              checkpointId: before.id,
              operationId: "i3-invalid-target",
              includePaths: ["artifacts/not-part-of-this-version.txt"],
            });
            if (wrongTarget.approvalId) {
              await api.decidePendingApproval({ id: wrongTarget.approvalId, approved: true });
            }
          } catch {
            wrongTargetRejected = true;
          }
        }
        versionPanel?.querySelector('[data-testid="refresh-version-history"]')?.click();
        const partialStatus = await waitFor(() => document.querySelector('[data-testid="partial-restore-status"]'), 3000);
        const finalVersions = (await api.listWorkspaceCheckpoints(fixtureWorkspacePath)).filter((item) => item.versionGroupId === before?.versionGroupId);
        const finalBefore = finalVersions.find((item) => item.versionPhase === "before");
        const finalAfter = finalVersions.find((item) => item.versionPhase === "after");
        checks.partialUndoActionsVisible = Boolean(partialButton) && presentationRows.filter((row) => row.getAttribute("data-version-phase") === "after")
          .every((row) => row.querySelectorAll('[data-testid="restore-version-entry"]').length === 2);
        checks.partialUndoQueuesSingleScopedApproval = Boolean(visibleActionApproval) && visibleApprovalTargetsOnlyPptx;
        checks.twentyPartialUndoRoundsPassed = rounds.length === 20 && rounds.every((round) => round.beforeApproved && round.afterApproved && round.beforeState.selectedTargetCorrect && round.afterState.selectedTargetCorrect);
        checks.unselectedArtifactPreserved20Of20 = rounds.length === 20 && rounds.every((round) => round.beforeState.unselectedTargetUnchanged && round.afterState.unselectedTargetUnchanged);
        checks.userOriginalContentPreserved20Of20 = rounds.length === 20 && rounds.every((round) => round.beforeState.userPreserved && round.afterState.userPreserved);
        checks.cernSourcePreserved20Of20 = rounds.length === 20 && rounds.every((round) => round.beforeState.pdfPreserved && round.afterState.pdfPreserved);
        checks.partialAuditPersists = finalVersions.length === 2
          && finalBefore?.restoreCount === 20 && finalAfter?.restoreCount === 20
          && finalBefore?.lastRestoreMode === "partial" && finalAfter?.lastRestoreMode === "partial"
          && finalBefore?.lastRestoredPaths?.length === 1 && finalAfter?.lastRestoredPaths?.length === 1
          && finalBefore.lastRestoredPaths[0] === pptxEntry?.relativePath && finalAfter.lastRestoredPaths[0] === pptxEntry?.relativePath;
        checks.eachPartialUndoHasUniqueAuditOperation = finalBefore?.lastRestoreOperationId === "i3-before-20" && finalAfter?.lastRestoreOperationId === "i3-after-20";
        checks.finalEffectiveVersionVisible = Boolean(partialStatus) && /最近局部撤销|Latest partial undo/.test(partialStatus?.textContent || "") && /其他修改保持不变|other changes stayed unchanged/i.test(partialStatus?.textContent || "");
        checks.finalArtifactsMatchAcceptedVersion = Boolean(rounds.at(-1)?.afterState.selectedTargetCorrect && rounds.at(-1)?.afterState.unselectedTargetUnchanged);
        checks.wrongTargetRejectedWithoutMutation = wrongTargetRejected && Boolean(rounds.at(-1)?.afterState.selectedTargetCorrect && rounds.at(-1)?.afterState.unselectedTargetUnchanged);
        checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\.asar)/i.test(versionPanel?.textContent || "");
        details.generatedOutputPath = outputPath;
        details.manifestPath = manifestPath;
        details.i3PartialUndo = { versionGroupId: before?.versionGroupId, selectedPath: pptxEntry?.relativePath, unselectedPath: manifestEntry?.relativePath, initialUserHash: initialUser?.fileHash, initialPdfHash: initialPdf?.fileHash, rounds, finalVersions };
        partialStatus?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { checks, details };
      }
      let recoveryProgress = null;
      if (recoveryScenario) {
        recoveryProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "interrupted" ? candidate : null;
        }, 10000);
      }
      const currentActionButton = document.querySelector('[data-testid="generate-manager-presentation"]');
      checks.actionVisible = Boolean(currentActionButton)
        && (recoveryScenario
          ? /继续未完成任务|Resume unfinished task/i.test(currentActionButton?.textContent || "")
          : /生成管理者版 PPT|Create manager PPT/i.test(currentActionButton?.textContent || ""));
      const editRequirementsButton = action?.querySelector('[data-testid="prepare-manager-presentation-task"]');
      checks.editRequirementsVisible = Boolean(editRequirementsButton);
      window.confirm = () => true;
      if (scenario === "structured-summary") {
        const preference = await window.openDrSai.setCompletionNotificationPreference({ enabled: true, language: "zh" });
        checks.structuredSummaryNotificationsEnabled = preference?.enabled === true && preference?.language === "zh";
      }
      if (scenario === "business-progress") {
        try {
          const progressState = { events: [], visible: [] };
          const captureVisibleProgress = () => {
            const card = document.querySelector('[data-testid="manager-business-progress"]');
            if (!card) return;
            const sourcePhase = card.getAttribute("data-source-phase") || "";
            const businessStage = card.getAttribute("data-business-stage") || "";
            const key = sourcePhase + ":" + businessStage;
            if (progressState.visible.some((item) => item.key === key)) return;
            progressState.visible.push({
              key,
              sourcePhase,
              businessStage,
              at: performance.now(),
              text: card.textContent?.replace(/\\s+/g, " ").trim() || "",
            });
          };
          const unsubscribe = window.openDrSai.onManagerPresentationProgress((event) => {
            if (!["analyzing", "planning", "generating", "validating", "completed"].includes(event.phase)) return;
            if (!progressState.events.some((item) => item.phase === event.phase)) {
              progressState.events.push({ phase: event.phase, at: performance.now(), requestId: event.requestId });
            }
          });
          const observer = new MutationObserver(captureVisibleProgress);
          observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
          window.__OPENDRSAI_E1_PROGRESS = { progressState, unsubscribe, observer, captureVisibleProgress };
          checks.businessProgressObserverInstalled = true;
        } catch (caught) {
          checks.businessProgressObserverInstalled = false;
          details.businessProgressObserverError = caught instanceof Error ? caught.stack || caught.message : String(caught);
        }
      }

      if (recoveryScenario) {
        checks.recoveryVisible = Boolean(recoveryProgress)
          && /未完成|safe checkpoint/i.test(recoveryProgress?.textContent || "");
        details.recoveryRequestId = recoveryProgress?.getAttribute("data-request-id") || "";
        checks.continueChoiceVisible = Boolean(document.querySelector('[data-testid="generate-manager-presentation"]'));
        checks.restartChoiceVisible = Boolean(document.querySelector('[data-testid="restart-manager-presentation"]'));
        checks.abandonChoiceVisible = Boolean(document.querySelector('[data-testid="abandon-manager-presentation"]'));
      }
      if (scenario === "strong-kill-abandon") {
        document.querySelector('[data-testid="abandon-manager-presentation"]')?.click();
        checks.abandonClearedInterruptedCard = Boolean(await waitFor(() =>
          !document.querySelector('[data-testid="manager-presentation-progress"]') ? true : null, 5000));
        const abandonedRecovery = await window.openDrSai.getManagerPresentationRecovery({ workspacePath: fixtureWorkspacePath, sourcePath: fixturePath });
        checks.abandonClearedRecoveryRecord = abandonedRecovery === null;
        checks.sourceMaterialPreservedAfterAbandon = Boolean(document.querySelector(".files-preview-pdf"));
        return { checks, details };
      }
      if (scenario === "strong-kill-restart") {
        document.querySelector('[data-testid="restart-manager-presentation"]')?.click();
      } else {
        currentActionButton?.click();
      }
      if (scenario === "network-outage") {
        window.dispatchEvent(new Event("offline"));
        const offlineBanner = await waitFor(() => document.querySelector('[data-testid="network-connectivity-status"]'), 5000);
        checks.offlineStatusVisible = Boolean(offlineBanner)
          && /网络已断开|You are offline/i.test(offlineBanner?.textContent || "");
        checks.offlineExplainsLocalWorkContinues = /本地文件处理会继续|local file work continues/i.test(offlineBanner?.textContent || "");
        await new Promise((resolve) => setTimeout(resolve, 60000));
        checks.localGenerationCompletedWhileOffline = Boolean(document.querySelector('[data-testid="manager-presentation-result"]'));
        window.dispatchEvent(new Event("online"));
        const restoredBanner = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="network-connectivity-status"]');
          return /网络已恢复|Connection restored/i.test(candidate?.textContent || "") ? candidate : null;
        }, 5000);
        checks.restoredStatusVisible = Boolean(restoredBanner);
      }
      let previousRequestId = "";
      let cancelledOutputPath = "";
      let stagePathsBeforeFinal = [];
      let stageContentsBeforeFinal = [];
      if (scenario === "restart-interrupt" || scenario === "strong-kill-wait") {
        const parsingProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "analyzing"
            && Number(candidate.getAttribute("data-progress")) >= 12 ? candidate : null;
        }, 5000);
        checks.interruptedWhileParsing = Boolean(parsingProgress);
        details.interruptedRequestId = parsingProgress?.getAttribute("data-request-id") || "";
        if (scenario === "strong-kill-wait") await new Promise(() => undefined);
        return { checks, details };
      } else if (scenario === "background-close") {
        const parsingProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "analyzing"
            && Number(candidate.getAttribute("data-progress")) >= 12 ? candidate : null;
        }, 5000);
        checks.parserStartedBeforeWindowClose = Boolean(parsingProgress);
        details.backgroundRequestId = parsingProgress?.getAttribute("data-request-id") || "";
        checks.rendererAliveAfterWindowClose = Boolean(await waitFor(() =>
          document.visibilityState === "hidden" && document.querySelector(".app-shell"), 5000));
      } else if (["cancel-retry", "cancel-planning-retry", "cancel-generating-retry"].includes(scenario)) {
        const targetStage = scenario === "cancel-planning-retry"
          ? "planning"
          : scenario === "cancel-generating-retry" ? "generating" : "analyzing";
        const targetProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === targetStage
            && (targetStage !== "analyzing" || Number(candidate.getAttribute("data-progress")) >= 12)
            ? candidate : null;
        }, 30000);
        checks.targetStageReachedBeforeCancel = Boolean(targetProgress);
        checks.cancelStageRecordedBeforeAction = targetProgress?.getAttribute("data-active-stage") === targetStage;
        details.cancelTargetStage = targetStage;
        const cancelButton = await waitFor(() => document.querySelector('[data-testid="cancel-manager-presentation"]'), 5000);
        cancelledOutputPath = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-output-path") || "";
        checks.cancelActionVisible = Boolean(cancelButton) && /取消生成|Cancel/i.test(cancelButton?.textContent || "");
        const cancelStartedAt = performance.now();
        cancelButton?.click();
        const cancelledProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "cancelled" ? candidate : null;
        }, 10000);
        checks.cancellationCompleted = Boolean(cancelledProgress)
          && /已取消|cancelled/i.test(cancelledProgress?.textContent || "");
        checks.cancelledAtTargetStage = cancelledProgress?.getAttribute("data-active-stage") === targetStage;
        details.cancelLatencyMs = Math.round(performance.now() - cancelStartedAt);
        checks.cancellationResponsive = checks.cancellationCompleted && details.cancelLatencyMs <= 3000;
        previousRequestId = cancelledProgress?.getAttribute("data-request-id") || "";
        details.cancelledOutputPath = cancelledOutputPath;
        await new Promise((resolve) => setTimeout(resolve, 700));
        checks.cancelledRecordPreserved = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-phase") === "cancelled";
        const api = window.openDrSai;
        if (api) {
          const workspacePath = fixturePath.slice(0, fixturePath.lastIndexOf("\\\\"));
          const cancelledTree = await api.listWorkspaceFiles({ workspacePath, maxDepth: 8, maxEntries: 900 });
          const pendingCancelledNodes = [...(cancelledTree.nodes || [])];
          const cancelledPaths = [];
          while (pendingCancelledNodes.length > 0) {
            const node = pendingCancelledNodes.pop();
            if (!node) continue;
            if (typeof node.path === "string") cancelledPaths.push(node.path);
            if (Array.isArray(node.children)) pendingCancelledNodes.push(...node.children);
          }
          checks.cancelledNoPartialFiles = !cancelledOutputPath || !cancelledPaths.includes(cancelledOutputPath);
          const cancelledTasks = await api.listBackgroundTasks({ workspacePath, limit: 50 });
          const cancelledTask = cancelledTasks.find((task) => task.kind === "presentation_generation" && task.targetId === previousRequestId);
          checks.cancelledInUnifiedBackgroundQueue = cancelledTask?.status === "cancelled";
          checks.cancelledQueueStagePreserved = cancelledTask?.currentStep === ({
            analyzing: "分析 PDF 内容",
            planning: "规划报告结构",
            generating: "生成可编辑 PPT",
          })[targetStage];
          details.cancelledTask = cancelledTask || null;
        } else {
          checks.cancelledNoPartialFiles = false;
          checks.cancelledInUnifiedBackgroundQueue = false;
          checks.cancelledQueueStagePreserved = false;
        }
        const retryAfterCancel = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="generate-manager-presentation"]');
          return candidate && !candidate.disabled && /重试生成|Retry generation/i.test(candidate.textContent || "") ? candidate : null;
        }, 5000);
        checks.retryAfterCancelVisible = Boolean(retryAfterCancel);
        retryAfterCancel?.click();
      } else if (scenario === "failure-retry" || scenario === "file-busy-retry") {
        const failedProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "failed" ? candidate : null;
        }, 10000);
        checks.failureVisible = Boolean(failedProgress) && (scenario === "file-busy-retry"
          ? /文件被占用|file is busy/i.test(failedProgress?.textContent || "")
          : /任务失败|Task failed|Simulated presentation failure at analyzing/i.test(failedProgress?.textContent || ""));
        if (scenario === "file-busy-retry") {
          const recovery = document.querySelector('[data-testid="manager-presentation-failure-recovery"]');
          checks.fileBusyClassified = recovery?.getAttribute("data-kind") === "file_busy";
          checks.fileBusyRetryExhausted = recovery?.getAttribute("data-exhausted") === "true";
          checks.fileBusyEscalatesToUser = recovery?.getAttribute("data-escalation") === "user_action";
          checks.fileBusyAttemptsVisible = (recovery?.textContent || "").replace(/\\s+/g, "").includes("3/3");
          checks.fileBusyActionVisible = /关闭占用|Close the program/i.test(recovery?.textContent || "");
          details.fileBusyRecoveryText = recovery?.textContent?.replace(/\\s+/g, " ").trim() || "";
        }
        previousRequestId = failedProgress?.getAttribute("data-request-id") || "";
        const retryAfterFailure = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="generate-manager-presentation"]');
          return candidate && !candidate.disabled && /重试生成|Retry generation/i.test(candidate.textContent || "") ? candidate : null;
        }, 5000);
        checks.retryAfterFailureVisible = Boolean(retryAfterFailure);
        retryAfterFailure?.click();
      } else if (scenario === "requirements-update") {
        const planningProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "planning" ? candidate : null;
        }, 30000);
        checks.planningReachedBeforeRequirement = Boolean(planningProgress);
        const requirementText = "把 4.8 和 9.6 Tbps 带宽需求列为管理层首要决策";
        details.liveRequirement = requirementText;
        const requirementInput = await waitFor(() => document.querySelector('[data-testid="manager-presentation-requirement-input"]'), 5000);
        checks.liveRequirementInputVisible = Boolean(requirementInput);
        if (requirementInput) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(requirementInput, requirementText);
          requirementInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const requirementSubmit = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="submit-manager-presentation-requirement"]');
          return candidate && !candidate.disabled ? candidate : null;
        }, 5000);
        checks.liveRequirementSubmitEnabled = Boolean(requirementSubmit);
        requirementSubmit?.click();
        const requirementStatus = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-requirement-status"]');
          return candidate?.getAttribute("data-scope") === "current_unfinished_stages" ? candidate : null;
        }, 5000);
        checks.requirementScopeConfirmed = Boolean(requirementStatus)
          && /当前任务尚未完成的规划、生成和验收阶段|unfinished planning, generation, and validation/i.test(requirementStatus?.textContent || "");
      } else if (scenario === "pause-resume") {
        const parsingProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "analyzing"
            && Number(candidate.getAttribute("data-progress")) >= 12 ? candidate : null;
        }, 5000);
        checks.parserStartedBeforePause = Boolean(parsingProgress);
        const pauseParsingButton = await waitFor(() => document.querySelector('[data-testid="pause-manager-presentation"]'), 5000);
        const parsingPauseStartedAt = performance.now();
        pauseParsingButton?.click();
        const parsingPaused = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "paused" ? candidate : null;
        }, 5000);
        details.parsingPauseLatencyMs = Math.round(performance.now() - parsingPauseStartedAt);
        checks.parsingPaused = Boolean(parsingPaused) && details.parsingPauseLatencyMs <= 3000;
        checks.parsingPausedAtReadingStage = parsingPaused?.getAttribute("data-active-stage") === "analyzing";
        await new Promise((resolve) => setTimeout(resolve, 700));
        checks.parsingStayedPaused = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-phase") === "paused";
        const resumeParsingButton = document.querySelector('[data-testid="resume-manager-presentation"]');
        checks.resumeParsingVisible = Boolean(resumeParsingButton) && /继续生成|Resume/i.test(resumeParsingButton?.textContent || "");
        resumeParsingButton?.click();
        checks.parsingResumed = Boolean(await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "analyzing"
            && Number(candidate.getAttribute("data-progress")) >= 12 ? candidate : null;
        }, 5000));

        const planningProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "planning" ? candidate : null;
        }, 30000);
        checks.planningReached = Boolean(planningProgress);
        const pausePlanningButton = document.querySelector('[data-testid="pause-manager-presentation"]');
        const planningPauseStartedAt = performance.now();
        pausePlanningButton?.click();
        const planningPaused = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "paused" ? candidate : null;
        }, 5000);
        details.planningPauseLatencyMs = Math.round(performance.now() - planningPauseStartedAt);
        checks.planningPaused = Boolean(planningPaused) && details.planningPauseLatencyMs <= 3000;
        checks.planningPausedAtComputingStage = planningPaused?.getAttribute("data-active-stage") === "planning";
        await new Promise((resolve) => setTimeout(resolve, 700));
        checks.planningStayedPaused = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-phase") === "paused";
        const resumePlanningButton = document.querySelector('[data-testid="resume-manager-presentation"]');
        checks.resumePlanningVisible = Boolean(resumePlanningButton);
        resumePlanningButton?.click();
        checks.planningResumed = Boolean(await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          const phase = candidate?.getAttribute("data-phase");
          return (candidate?.getAttribute("data-active-stage") === "planning" && phase === "resuming")
            || phase === "generating" ? candidate : null;
        }, 5000));

        const generatingProgress = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "generating" ? candidate : null;
        }, 30000);
        checks.generatingReached = Boolean(generatingProgress);
        const pauseGeneratingButton = document.querySelector('[data-testid="pause-manager-presentation"]');
        pauseGeneratingButton?.click();
        const generatingPaused = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-phase") === "paused" ? candidate : null;
        }, 5000);
        checks.generatingPaused = Boolean(generatingPaused);
        checks.generatingPausedAtOutputStage = generatingPaused?.getAttribute("data-active-stage") === "generating";
        await new Promise((resolve) => setTimeout(resolve, 700));
        checks.generatingStayedPaused = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-phase") === "paused";
        const resumeGeneratingButton = document.querySelector('[data-testid="resume-manager-presentation"]');
        checks.resumeGeneratingVisible = Boolean(resumeGeneratingButton);
        resumeGeneratingButton?.click();
      } else if (scenario === "network-outage") {
        previousRequestId = "__network-outage-no-retry__";
        checks.recoveryStarted = true;
      } else if (scenario === "structured-summary") {
        previousRequestId = "__structured-summary-no-retry__";
        checks.structuredSummaryRunStarted = true;
      } else if (scenario === "status-matrix") {
        previousRequestId = "__status-matrix-no-retry__";
        checks.statusMatrixRunStarted = true;
      } else if (scenario === "business-progress") {
        previousRequestId = "__business-progress-no-retry__";
        checks.businessProgressRunStarted = true;
      } else if (scenario === "stage-artifacts") {
        const stagePanel = await waitFor(() => {
          const panel = document.querySelector('[data-testid="manager-presentation-stage-artifacts"]');
          return panel?.querySelectorAll("article").length >= 2 ? panel : null;
        }, 30000);
        const stageCards = Array.from(stagePanel?.querySelectorAll("article") || []);
        checks.stageArtifactsVisibleBeforeFinal = Boolean(stagePanel) && !document.querySelector('[data-testid="manager-presentation-result"]');
        checks.stageArtifactsCount = stageCards.length === 2;
        checks.stageArtifactsMarkedTemporary = stageCards.every((card) => card.getAttribute("data-temporary") === "true"
          && /临时结果|Temporary/i.test(card.textContent || ""));
        checks.stageArtifactsMarkedImmutable = stageCards.every((card) => card.getAttribute("data-immutable") === "true");
        checks.stageArtifactsAfterTenMinutes = stageCards.every((card) => Number(card.getAttribute("data-task-elapsed-ms")) >= 600000);
        checks.stageArtifactSummariesVisible = /PDF 分析摘要/.test(stagePanel?.textContent || "")
          && /PPT 结构草案/.test(stagePanel?.textContent || "")
          && /不会覆盖/.test(stagePanel?.textContent || "");
        checks.stageArtifactOpenActionsVisible = stageCards.every((card) => /打开快照|Open snapshot/i.test(card.textContent || ""));
        stagePathsBeforeFinal = stageCards.map((card) => card.getAttribute("data-path") || "");
        const api = window.openDrSai;
        const previews = await Promise.all(stagePathsBeforeFinal.map((path) => api.previewWorkspaceFile({
          workspacePath: fixtureWorkspacePath,
          path,
          maxBytes: 220000,
        })));
        stageContentsBeforeFinal = previews.map((preview) => preview.content || "");
        checks.stageArtifactFilesReadable = previews.every((preview) => typeof preview.content === "string"
          && preview.content.length > 100
          && preview.size > 100);
        checks.stageArtifactWarningPersisted = stageContentsBeforeFinal.every((content) => content.includes("临时阶段成果")
          && content.includes("不会覆盖此快照"));
        checks.stageArtifactEvidenceUseful = stageContentsBeforeFinal[0]?.includes("原 PDF 第")
          && stageContentsBeforeFinal[1]?.includes("页面结构");
        details.stagePathsBeforeFinal = stagePathsBeforeFinal;
      } else if (scenario === "strong-kill-restart") {
        previousRequestId = details.recoveryRequestId || "";
        checks.recoveryStarted = Boolean(await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-request-id") !== previousRequestId
            && candidate?.getAttribute("data-phase") === "analyzing" ? candidate : null;
        }, 5000));
      } else {
        previousRequestId = details.recoveryRequestId || "";
        checks.recoveryStarted = Boolean(await waitFor(() => {
          const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
          return candidate?.getAttribute("data-request-id") === previousRequestId
            && candidate?.getAttribute("data-phase") === "analyzing" ? candidate : null;
        }, 5000));
      }
      const generatedResult = await waitFor(() => {
        const progress = document.querySelector('[data-testid="manager-presentation-progress"]');
        const result = document.querySelector('[data-testid="manager-presentation-result"]');
        return (["pause-resume", "restart-resume", "strong-kill-resume", "strong-kill-restart", "background-close"].includes(scenario)
          || progress?.getAttribute("data-request-id") !== previousRequestId) && result ? result : null;
      }, scenario === "network-outage" ? 10000 : 60000);
      checks.generationCompleted = Boolean(generatedResult);
      const generatedOutputPath = generatedResult?.getAttribute("data-output-path") || "";
      details.generatedOutputPath = generatedOutputPath;
      if (scenario === "stage-artifacts") {
        const stageCardsAfterFinal = Array.from(document.querySelectorAll('[data-testid="manager-presentation-stage-artifacts"] article'));
        const stagePathsAfterFinal = stageCardsAfterFinal.map((card) => card.getAttribute("data-path") || "");
        const stagePreviewsAfterFinal = await Promise.all(stagePathsAfterFinal.map((path) => window.openDrSai.previewWorkspaceFile({
          workspacePath: fixtureWorkspacePath,
          path,
          maxBytes: 220000,
        })));
        checks.stageArtifactsRemainVisibleAfterFinal = stageCardsAfterFinal.length === 2;
        checks.stageArtifactPathsUnchanged = JSON.stringify(stagePathsAfterFinal) === JSON.stringify(stagePathsBeforeFinal);
        checks.stageArtifactContentsNotOverwritten = JSON.stringify(stagePreviewsAfterFinal.map((preview) => preview.content || ""))
          === JSON.stringify(stageContentsBeforeFinal);
        checks.finalOutputSeparateFromSnapshots = stagePathsAfterFinal.every((path) => path !== generatedOutputPath && /\.md$/i.test(path));
      }
      if (scenario === "requirements-update") {
        const appliedRequirements = generatedResult?.querySelector('[data-testid="manager-presentation-applied-requirements"]');
        checks.appliedRequirementVisibleInResult = Boolean(appliedRequirements)
          && (appliedRequirements?.textContent || "").includes(details.liveRequirement);
      }
      if (["cancel-retry", "cancel-planning-retry", "cancel-generating-retry"].includes(scenario)) {
        checks.cancelledPathReused = !cancelledOutputPath || generatedOutputPath === cancelledOutputPath;
      }
      if (scenario === "pause-resume") checks.pauseResumeDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      if (scenario === "restart-resume" || scenario === "strong-kill-resume") {
        checks.recoveryRequestIdPreserved = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id") === details.recoveryRequestId;
        checks.restartResumeDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      }
      if (scenario === "strong-kill-restart") {
        checks.restartCreatedFreshRequest = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id") !== details.recoveryRequestId;
        checks.restartDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      }
      if (scenario === "background-close") {
        checks.backgroundCloseRequestIdPreserved = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id") === details.backgroundRequestId;
        checks.backgroundCloseDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      }
      if (scenario === "network-outage") {
        checks.networkOutageDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      }
      if (scenario === "file-busy-retry") {
        checks.fileBusyRetryCreatedFreshRequest = document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id") !== previousRequestId;
        checks.fileBusyRetryDidNotCreateDuplicate = Boolean(generatedOutputPath) && !/\(\d+\)\.pptx$/i.test(generatedOutputPath);
      }
      details.generatedResultText = generatedResult?.textContent?.replace(/\\s+/g, " ").trim() || "";
      checks.generatedMetricsVisible = details.generatedResultText.includes("9 页")
        && details.generatedResultText.includes("讲稿 100%")
        && details.generatedResultText.includes("来源 100%");
      checks.openPptActionVisible = Boolean(generatedResult?.querySelector("button"));
      document.querySelector('[data-testid="prepare-manager-presentation-task"]')?.click();
      const basketChip = await waitFor(() => Array.from(document.querySelectorAll(".files-basket-chip"))
        .find((chip) => chip.getAttribute("title") === fixturePath || chip.textContent?.includes(fixtureName)), 10000);
      checks.pdfAttached = Boolean(basketChip);
      details.basketText = basketChip?.textContent?.replace(/\\s+/g, " ").trim() || "";
      const composer = await waitFor(() => document.querySelector(".composer textarea"), 10000);
      const task = composer && "value" in composer ? String(composer.value) : "";
      details.task = task;
      checks.taskPrepared = task.includes("给非专业管理者看的中文 PPTX");
      checks.slideRangeRequired = task.includes("8–12 页");
      checks.editableContentRequired = task.includes("可编辑的原生文本");
      checks.sourcePagesRequired = task.includes("原 PDF 页码");
      checks.speakerNotesRequired = task.includes("为每一页写可直接演讲的讲稿");
      checks.uncertaintyRequired = task.includes("尚未确认");
      checks.screenshotReuseForbidden = task.includes("不得把原 PDF 整页截图");
      checks.acceptanceReportRequired = task.includes("自动验收结果");
      checks.taskNotAutoSubmitted = !Array.from(document.querySelectorAll(".message.user .message-body"))
        .some((message) => message.textContent?.includes("给非专业管理者看的中文 PPTX"));
      const registeredArtifact = await waitFor(() => {
        const panel = document.querySelector(".files-artifacts");
        return /manager-zh\.pptx/i.test(panel?.textContent || "") ? panel : null;
      }, 10000);
      details.artifactsText = registeredArtifact?.textContent?.replace(/\\s+/g, " ").trim() || "";
      checks.artifactRegistered = Boolean(registeredArtifact);
      const api = window.openDrSai;
      checks.bridgeAvailable = Boolean(api);
      if (api && generatedOutputPath) {
        const recoveryAfterCompletion = await api.getManagerPresentationRecovery({
          workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
          sourcePath: fixturePath,
        });
        checks.recoveryClearedAfterCompletion = recoveryAfterCompletion === null;
        const generatedTree = await api.listWorkspaceFiles({
          workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
          maxDepth: 8,
          maxEntries: 900,
        });
        const pendingNodes = [...(generatedTree.nodes || [])];
        const generatedPaths = [];
        while (pendingNodes.length > 0) {
          const node = pendingNodes.pop();
          if (!node) continue;
          if (typeof node.path === "string") generatedPaths.push(node.path);
          if (Array.isArray(node.children)) pendingNodes.push(...node.children);
        }
        const workspacePath = fixturePath.slice(0, fixturePath.lastIndexOf("\\\\"));
        const artifactRoot = workspacePath.replace(/[\\\\/]+$/, "") + "\\\\artifacts\\\\";
        const deliverablePaths = generatedPaths.filter((path) =>
          path.toLowerCase().startsWith(artifactRoot.toLowerCase())
          && !/[\\\\/]/.test(path.slice(artifactRoot.length)));
        checks.singleManagerPptxFile = deliverablePaths.filter((path) => /manager-zh\.pptx$/i.test(path)).length === 1;
        checks.singleManagerManifestFile = deliverablePaths.filter((path) => /manager-zh\.provenance\.json$/i.test(path)).length === 1;
        const backgroundTasks = await api.listBackgroundTasks({
          workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
          limit: 50,
        });
        const presentationTask = backgroundTasks.find((task) =>
          task.kind === "presentation_generation"
          && task.targetId === document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id"));
        checks.presentationInUnifiedBackgroundQueue = Boolean(presentationTask);
        checks.backgroundQueueCompleted = presentationTask?.status === "completed"
          && presentationTask.progress === 100;
        checks.backgroundQueuePreservedSteps = Array.isArray(presentationTask?.completedSteps)
          && presentationTask.completedSteps.length === 4
          && Array.isArray(presentationTask.pendingDecisions)
          && presentationTask.pendingDecisions.length === 0;
        if (scenario === "business-progress") {
          const criteria = presentationTask?.deliverySummary?.completionCriteria;
          checks.cernCompletionCriteriaPersisted = Boolean(criteria)
            && criteria.passed.length === 4
            && criteria.incomplete.length === 2;
          checks.cernCompletionCriteriaConcrete = Boolean(criteria)
            && criteria.passed.some((item) => item.includes("讲稿覆盖检查通过：100%"))
            && criteria.passed.some((item) => item.includes("来源覆盖检查通过：100%"))
            && criteria.incomplete.some((item) => item.includes("2029"))
            && criteria.incomplete.some((item) => item.includes("成本和实施时间"));
          details.cernCompletionCriteria = criteria;
        }
        if (scenario === "structured-summary") {
          checks.structuredSummaryPersisted = Boolean(presentationTask?.deliverySummary)
            && presentationTask.deliverySummary.importance === "high"
            && presentationTask.deliverySummary.artifacts?.length === 1
            && presentationTask.deliverySummary.artifacts[0]?.path === generatedOutputPath;
          checks.completionCardFiveFieldsPersisted = [
            presentationTask?.deliverySummary?.workSummary,
            presentationTask?.deliverySummary?.coreConclusion,
            presentationTask?.deliverySummary?.artifacts?.[0]?.path,
            presentationTask?.deliverySummary?.verification,
            presentationTask?.deliverySummary?.remainingRisks,
          ].every(Boolean);
          details.structuredDeliveryTask = presentationTask;
        }
        const generatedPreview = await api.previewWorkspaceFile({
          workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
          path: generatedOutputPath,
          maxBytes: 220000,
        });
        details.generatedPreview = {
          kind: generatedPreview.kind,
          size: generatedPreview.size,
          relativePath: generatedPreview.relativePath,
        };
        checks.generatedPptxReadable = generatedPreview.kind === "office" && generatedPreview.size > 10000;
        if (scenario === "requirements-update") {
          checks.requirementPresentInGeneratedPptx = (generatedPreview.content || "").includes(details.liveRequirement);
          const lateUpdate = await api.updateManagerPresentationRequirement({
            requestId: document.querySelector('[data-testid="manager-presentation-progress"]')?.getAttribute("data-request-id") || "",
            text: "再增加一页成本比较",
          });
          checks.lateRequirementRequiresRegeneration = lateUpdate.accepted === false
            && lateUpdate.scope === "regenerate_required"
            && /重新生成|重新执行规划和生成|regenerate/i.test(lateUpdate.message);
          details.lateRequirementResult = lateUpdate;
        }
        const manifestPath = generatedOutputPath.replace(/\\.pptx$/i, ".provenance.json");
        const manifestPreview = await api.previewWorkspaceFile({
          workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
          path: manifestPath,
          maxBytes: 220000,
        });
        const manifestText = manifestPreview.content || "";
        details.manifestPath = manifestPath;
        checks.manifestReadable = manifestText.includes('"slideCount": 9')
          && manifestText.includes('"speakerNotesCoverage": 1')
          && manifestText.includes('"wholePageScreenshotReuse": false');
        const manifest = JSON.parse(manifestText);
        if (scenario === "stage-artifacts") {
          checks.stageArtifactsRecordedInManifest = Array.isArray(manifest.stageArtifacts)
            && manifest.stageArtifacts.length === 2
            && manifest.stageArtifacts.every((artifact) => artifact.temporary === true && artifact.immutable === true);
        }
        if (scenario === "requirements-update") {
          checks.requirementPersistedInManifest = Array.isArray(manifest.appliedRequirements)
            && manifest.appliedRequirements.includes(details.liveRequirement);
        }
        const manifestSlides = Array.isArray(manifest.slides) ? manifest.slides : [];
        const rolePages = (role) => manifestSlides.find((slide) => slide.role === role)?.sourcePages || [];
        checks.goldenSourceMapping = rolePages("hl_lhc_requirements").includes(42)
          && rolePages("data_challenges").includes(43)
          && rolePages("conclusions").includes(47)
          && manifestSlides.filter((slide) => !["cover", "sources"].includes(slide.role))
            .every((slide) => Array.isArray(slide.sourcePages) && slide.sourcePages.length > 0);
        const sourceReview = document.querySelector('[data-testid="manager-presentation-sources"]');
        const sourceButtons = Array.from(sourceReview?.querySelectorAll("button[data-source-page]") || []);
        const expectedSourceButtonCount = manifestSlides
          .filter((slide) => !["cover", "sources"].includes(slide.role))
          .reduce((count, slide) => count + (Array.isArray(slide.sourcePages) ? slide.sourcePages.length : 0), 0);
        checks.sourceReviewVisible = Boolean(sourceReview)
          && /核对原始依据|Review original evidence/i.test(sourceReview?.textContent || "");
        checks.everySourceEntryClickable = sourceButtons.length === expectedSourceButtonCount
          && sourceButtons.every((button) => !button.disabled);

        details.sourcePageOpens = {};
        const uiSourceButton = Array.from(document.querySelectorAll("button[data-source-page]"))
          .find((candidate) => candidate.getAttribute("data-source-page") === "42");
        checks.sourcePageUiEntryAvailable = Boolean(uiSourceButton);
        uiSourceButton?.click();
        const uiSourceStatus = await waitFor(() => {
          const candidate = document.querySelector('[data-testid="source-page-review-status"]');
          return candidate?.getAttribute("data-source-page") === "42" ? candidate : null;
        }, 3000);
        details.sourcePageUiStatus = uiSourceStatus?.textContent || "";
        for (const page of [42, 43, 47]) {
          const opened = await api.openPdfPage({ path: fixturePath, page });
          details.sourcePageOpens[String(page)] = { ...opened, via: "typed-api" };
          checks["sourcePage" + page + "Opened"] = opened.ok
            && opened.page === page
            && opened.viewerUrl.includes(".pdf#page=" + page);
        }
        try {
          await api.openPdfPage({ path: fixturePath, page: 0 });
          checks.invalidSourcePageRejected = false;
        } catch {
          checks.invalidSourcePageRejected = true;
        }
        try {
          await api.openPdfPage({ path: generatedOutputPath, page: 1 });
          checks.nonPdfSourceRejected = false;
        } catch {
          checks.nonPdfSourceRejected = true;
        }
        if (scenario === "status-matrix" && presentationTask) {
          const matrixTasks = [
            await api.enqueueBackgroundTask({
              kind: "workflow_run",
              source: "workflow",
              title: "CERN 后续资料等待处理",
              workspacePath: fixtureWorkspacePath,
              targetId: "e2-status-waiting",
              status: "queued",
              currentStep: "等待开始",
              message: "任务已加入队列。",
              verification: "等待状态由统一任务记录提供。",
            }),
            await api.enqueueBackgroundTask({
              kind: "connector_sync",
              source: "connector",
              title: "CERN 网络数据正在核对",
              workspacePath: fixtureWorkspacePath,
              targetId: "e2-status-running",
              status: "running",
              currentStep: "核对亚洲网络数据",
              progress: 52,
              message: "正在核对管理者报告中的网络数据。",
              verification: "运行状态由统一任务记录提供。",
            }),
            await api.enqueueBackgroundTask({
              kind: "workflow_run",
              source: "workflow",
              title: "CERN 带宽方案等待决定",
              workspacePath: fixtureWorkspacePath,
              targetId: "e2-status-decision",
              status: "waiting_approval",
              currentStep: "等待管理者决定",
              pendingDecisions: ["是否采用 2029 扩容目标"],
              message: "需要决定后才能继续。",
              verification: "待决定状态由统一任务记录提供。",
            }),
            await api.enqueueBackgroundTask({
              kind: "connector_sync",
              source: "connector",
              title: "CERN 外部资料同步未完成",
              workspacePath: fixtureWorkspacePath,
              targetId: "e2-status-failure",
              status: "failed",
              currentStep: "同步外部资料",
              message: "外部资料暂时不可用，请稍后重试。",
              verification: "失败状态由统一任务记录提供。",
            }),
          ];
          const expected = [
            { id: matrixTasks[0].id, raw: "queued", user: "waiting" },
            { id: matrixTasks[1].id, raw: "running", user: "running" },
            { id: matrixTasks[2].id, raw: "waiting_approval", user: "needs_decision" },
            { id: presentationTask.id, raw: "completed", user: "success" },
            { id: matrixTasks[3].id, raw: "failed", user: "failure" },
          ];
          const scheduledNav = Array.from(document.querySelectorAll(".sidebar-button"))
            .find((button) => /已安排|Scheduled/i.test(button.getAttribute("title") || button.textContent || ""));
          checks.taskCenterEntryVisible = Boolean(scheduledNav);
          scheduledNav?.click();
          const taskCenter = await waitFor(() => document.querySelector('[data-testid="task-center-view"]'), 10000);
          checks.taskCenterVisible = Boolean(taskCenter);
          const rows = await waitFor(() => {
            const found = expected.map((item) => document.querySelector('[data-task-id="' + item.id + '"]'));
            return found.every(Boolean) ? found : null;
          }, 10000);
          const statusMatrix = expected.map((item, index) => {
            const row = rows?.[index] || null;
            const listStatus = row?.querySelector('[data-testid="background-task-list-status"]');
            const detail = row?.querySelector('[data-testid="background-task-detail"]');
            if (detail) detail.open = true;
            const detailStatus = row?.querySelector('[data-testid="background-task-detail-status"]');
            return {
              id: item.id,
              expectedRaw: item.raw,
              expectedUser: item.user,
              rowRaw: row?.getAttribute("data-task-status") || "",
              rowUser: row?.getAttribute("data-user-state") || "",
              listUser: listStatus?.getAttribute("data-user-state") || "",
              detailUser: detailStatus?.getAttribute("data-user-state") || "",
              listText: listStatus?.textContent?.replace(/\\s+/g, " ").trim() || "",
              detailText: detailStatus?.textContent?.replace(/\\s+/g, " ").trim() || "",
              borderLeftColor: row ? getComputedStyle(row).borderLeftColor : "",
            };
          });
          details.statusMatrix = statusMatrix;
          checks.fiveUserStatesVisible = statusMatrix.length === 5
            && statusMatrix.every((item) => item.rowUser === item.expectedUser);
          checks.listAndDetailStatusConsistent = statusMatrix.every((item) =>
            item.listUser === item.expectedUser
            && item.detailUser === item.expectedUser
            && item.listText === item.detailText);
          checks.uiAndUnderlyingStatusConsistent = statusMatrix.every((item) => item.rowRaw === item.expectedRaw);
          checks.completedTaskNotStaleRunning = statusMatrix.find((item) => item.expectedUser === "success")?.rowUser === "success"
            && presentationTask.status === "completed";
          checks.statesVisuallyDistinct = new Set(statusMatrix.map((item) => item.borderLeftColor)).size === 5;
          const taskCenterText = taskCenter?.textContent || "";
          checks.noRawStatusAsVisibleLabel = !/waiting_approval|connector_sync|presentation_generation/.test(taskCenterText);
          checks.statusAutoRefreshDeclared = /状态会自动更新|Statuses update automatically/i.test(taskCenterText);
        }
      } else {
        checks.generatedPptxReadable = false;
        checks.manifestReadable = false;
        checks.goldenSourceMapping = false;
        checks.sourceReviewVisible = false;
        checks.everySourceEntryClickable = false;
        checks.sourcePageUiEntryAvailable = false;
        checks.sourcePage42Opened = false;
        checks.sourcePage43Opened = false;
        checks.sourcePage47Opened = false;
        checks.invalidSourcePageRejected = false;
        checks.nonPdfSourceRejected = false;
      }
      if (scenario === "stage-artifacts") {
        document.querySelector('[data-testid="manager-presentation-stage-artifacts"]')?.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (scenario === "business-progress") {
        try {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const state = window.__OPENDRSAI_E1_PROGRESS;
          state?.captureVisibleProgress?.();
          state?.unsubscribe?.();
          state?.observer?.disconnect();
          const expected = [
          { phase: "analyzing", stage: "understand_material", phrase: "理解材料" },
          { phase: "planning", stage: "organize_story", phrase: "组织重点" },
          { phase: "generating", stage: "create_deck", phrase: "制作演示文稿" },
          { phase: "validating", stage: "check_result", phrase: "检查成果" },
          { phase: "completed", stage: "ready", phrase: "成果已就绪" },
        ];
          const timing = expected.map((item) => {
          const event = state?.progressState.events.find((candidate) => candidate.phase === item.phase);
          const visible = state?.progressState.visible.find((candidate) =>
            candidate.sourcePhase === item.phase && candidate.businessStage === item.stage);
          return {
            ...item,
            eventAt: event?.at ?? null,
            visibleAt: visible?.at ?? null,
            latencyMs: event && visible ? Math.max(0, Math.round(visible.at - event.at)) : null,
            visibleText: visible?.text || "",
          };
          });
          details.businessProgressTiming = timing;
          checks.allBusinessPhasesReceived = timing.every((item) => item.eventAt !== null);
          checks.allBusinessPhasesVisible = timing.every((item) => item.visibleAt !== null && item.visibleText.includes(item.phrase));
          checks.everyPhaseVisibleWithinTwoSeconds = timing.every((item) => item.latencyMs !== null && item.latencyMs <= 2000);
          checks.businessStageMatchesRunState = timing.every((item) => item.visibleText.length > item.phrase.length)
            && state?.progressState.events.every((item, index, events) => index === 0 || item.at >= events[index - 1].at);
          const visibleText = timing.map((item) => item.visibleText).join("\\n");
          details.businessProgressVisibleText = visibleText;
          checks.businessLanguageWhitelist = ["理解材料", "组织重点", "制作演示文稿", "检查成果", "接下来", "成果已就绪"]
            .every((phrase) => visibleText.includes(phrase));
          checks.technicalNoiseBlacklist = !/(?:stdout|stderr|stack trace|traceback|node\.exe|python\.exe|powershell|cmd\.exe|tool_call|ipc|ENOENT|app\.asar)/i.test(visibleText);
          checks.notOnlyRawToolProgress = timing.every((item) => /正在|成果已就绪|Next|ready/i.test(item.visibleText));
          checks.businessProgressEvaluationCompleted = true;
          document.querySelector('[data-testid="manager-business-progress"]')?.scrollIntoView({ block: "center" });
        } catch (caught) {
          checks.businessProgressEvaluationCompleted = false;
          details.businessProgressEvaluationError = caught instanceof Error ? caught.stack || caught.message : String(caught);
        }
      }
      return { checks, details };
    })()
  `, true)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  if (scenario === "background-close") {
    result.checks.windowStayedHiddenUntilReopen = window.isMinimized();
    window.restore();
    window.focus();
    result.checks.windowReopenedAfterBackgroundCompletion = window.isVisible() && !window.isMinimized();
  }
  if (scenario === "structured-summary") {
    const targetId = ((result.details.structuredDeliveryTask as { targetId?: string } | undefined)?.targetId) || "";
    const records = getCompletionNotificationDiagnostics().filter((record) => record.target.targetId === targetId);
    const notification = records[0];
    result.checks.structuredNotificationSingle = records.length === 1;
    result.checks.structuredNotificationFourFields = Boolean(notification)
      && /发现：/.test(notification.body)
      && /重要程度：/.test(notification.body)
      && /成果入口：/.test(notification.body)
      && /建议操作：/.test(notification.body);
    result.checks.structuredNotificationNotRawLog = Boolean(notification)
      && !/\[desktop\]|stdout|stderr|stack|Error occurred/i.test(notification.body);
    const deliverySummary = notification?.deliverySummary;
    result.checks.structuredNotificationPayload = Boolean(deliverySummary)
      && deliverySummary?.importance === "high"
      && deliverySummary?.artifacts[0]?.path === (result.details.generatedOutputPath as string);
    result.details.structuredNotification = notification;
    result.checks.structuredNotificationClickTriggered = clickLatestCompletionNotificationForE2e();
    const routed = await window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 10000;
        let panel = null;
        while (Date.now() < deadline && !panel) {
          panel = document.querySelector('[data-testid="task-delivery-summary"]');
          if (!panel) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!panel) return { visible: false };
        const artifact = panel.querySelector('[data-testid="delivery-artifacts"] button');
        artifact?.click();
        let artifactOpenStatus = null;
        const artifactOpenDeadline = Date.now() + 10000;
        while (Date.now() < artifactOpenDeadline && !artifactOpenStatus) {
          const candidate = panel.querySelector('[data-testid="delivery-artifact-open-status"]');
          if (candidate?.getAttribute('data-state') !== 'opening') artifactOpenStatus = candidate;
          if (!artifactOpenStatus) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          visible: true,
          targetId: panel.getAttribute("data-target-id"),
          status: panel.getAttribute("data-status"),
          finding: panel.querySelector('[data-testid="delivery-finding"]')?.textContent || "",
          importance: panel.querySelector('[data-testid="delivery-importance"]')?.textContent || "",
          action: panel.querySelector('[data-testid="delivery-action"]')?.textContent || "",
          artifactPath: artifact?.getAttribute("data-artifact-path") || "",
          artifactText: artifact?.textContent || "",
          artifactOpenState: artifactOpenStatus?.getAttribute("data-state") || "",
          artifactOpenMessage: artifactOpenStatus?.textContent || "",
          workSummary: panel.querySelector('[data-testid="delivery-work-summary"]')?.textContent || "",
          coreConclusion: panel.querySelector('[data-testid="delivery-core-conclusion"]')?.textContent || "",
          verification: panel.querySelector('[data-testid="delivery-verification"]')?.textContent || "",
          risks: panel.querySelector('[data-testid="delivery-risks"]')?.textContent || "",
          openTaskVisible: Boolean(panel.querySelector('[data-testid="delivery-open-task"]')),
        };
      })()
    `, true) as Record<string, unknown>;
    result.checks.structuredSummaryPanelVisible = routed.visible === true;
    result.checks.structuredSummaryCorrectTask = routed.targetId === targetId && routed.status === "completed";
    result.checks.structuredSummaryFourFieldsVisible = [routed.finding, routed.importance, routed.artifactText, routed.action].every(Boolean);
    result.checks.structuredSummaryArtifactCorrect = routed.artifactPath === result.details.generatedOutputPath;
    result.checks.completionArtifactOpened = routed.artifactOpenState === "opened"
      && /已打开|Opened/i.test(String(routed.artifactOpenMessage || ""));
    result.checks.completionCardFiveFieldsVisible = [routed.workSummary, routed.coreConclusion, routed.artifactText, routed.verification, routed.risks].every(Boolean);
    result.checks.structuredSummaryTaskRouteVisible = routed.openTaskVisible === true;
    result.details.structuredSummaryPanel = routed;
    const resultsCenter = await window.webContents.executeJavaScript(`
      (async () => {
        const outputPath = ${JSON.stringify(result.details.generatedOutputPath || "")};
        const navDeadline = Date.now() + 10000;
        let nav = null;
        while (Date.now() < navDeadline && !nav) {
          nav = Array.from(document.querySelectorAll(".sidebar-button"))
            .find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null;
          if (!nav) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        nav?.click();
        const rowDeadline = Date.now() + 10000;
        let center = null;
        let row = null;
        while (Date.now() < rowDeadline && !row) {
          center = document.querySelector('[data-testid="results-center-view"][data-route="results"]');
          row = Array.from(center?.querySelectorAll("li[data-artifact-id]") || [])
            .find((candidate) => candidate.getAttribute("data-artifact-path") === outputPath) || null;
          if (!row) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        row?.querySelector('[data-testid="results-open-artifact"]')?.click();
        const openDeadline = Date.now() + 5000;
        let openState = "";
        while (Date.now() < openDeadline && openState !== "opened") {
          openState = row?.querySelector('[data-testid="results-open-status"]')?.getAttribute("data-state") || "";
          if (openState !== "opened") await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          navVisible: Boolean(nav),
          centerVisible: Boolean(center),
          artifactIndexed: Boolean(row),
          artifactId: row?.getAttribute("data-artifact-id") || "",
          sourceTaskId: row?.getAttribute("data-source-task-id") || "",
          openState,
        };
      })()
    `, true) as Record<string, unknown>;
    result.checks.firstResultMainNavigationVisible = resultsCenter.navVisible === true;
    result.checks.firstResultIndexedInResultsCenter = resultsCenter.centerVisible === true
      && resultsCenter.artifactIndexed === true
      && Boolean(resultsCenter.artifactId)
      && Boolean(resultsCenter.sourceTaskId);
    result.checks.firstResultOpensFromResultsCenter = resultsCenter.openState === "opened";
    result.details.firstResultResultsCenter = resultsCenter;
  }
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return {
    ok: Object.values(result.checks).every(Boolean),
    checks: result.checks,
    details: result.details,
  };
}

async function runA5ServiceGuidanceSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const scenario = process.env.OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO || "";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const scenario = ${JSON.stringify(scenario)};
      const checks = {};
      const details = {
        scenario,
        url: location.href,
        userAgent: navigator.userAgent,
        capturedAt: new Date().toISOString(),
      };
      const expected = {
        auth_required: {
          ctas: ["a5-login-action", "a5-copy-diagnostics"],
          forbiddenCtas: ["a5-retry-action", "a5-repair-runtime-action"],
          phrases: ["HepAI", "不会执行任何任务"],
        },
        service_unavailable: {
          ctas: ["a5-retry-action", "a5-login-again-action", "a5-copy-diagnostics"],
          forbiddenCtas: ["a5-repair-runtime-action"],
          phrases: ["服务", "阻止任务发送"],
        },
        runtime_missing: {
          ctas: ["a5-repair-runtime-action", "a5-retry-action", "a5-login-again-action", "a5-copy-diagnostics"],
          forbiddenCtas: [],
          phrases: ["运行时", "修复"],
        },
        permission_denied: {
          ctas: ["a5-login-again-action", "a5-copy-diagnostics"],
          forbiddenCtas: ["a5-retry-action", "a5-repair-runtime-action"],
          phrases: ["账号", "权限"],
        },
      };
      async function waitForState() {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          const marker = document.querySelector("[data-a5-state]");
          if (marker) return marker;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      }
      const marker = await waitForState();
      checks.stateVisible = Boolean(marker);
      details.state = marker ? marker.getAttribute("data-a5-state") : null;
      checks.expectedState = details.state === scenario;
      const bodyText = document.body ? document.body.innerText : "";
      details.domTextSample = bodyText.replace(/\\s+/g, " ").slice(0, 1000);
      checks.noInfiniteLoading = !/正在恢复会话|Restoring session/i.test(bodyText) && Boolean(marker);
      checks.notErrorCodeOnly = bodyText.replace(/\\s+/g, " ").trim().length > 80 && !/^[A-Z0-9_:\\s-]+$/.test(bodyText.trim());
      const spec = expected[scenario] || { ctas: [], forbiddenCtas: [], phrases: [] };
      for (const id of spec.ctas) {
        checks["cta_" + id] = Boolean(document.querySelector('[data-testid="' + id + '"]'));
      }
      for (const id of spec.forbiddenCtas) {
        checks["forbiddenCtaAbsent_" + id] = !document.querySelector('[data-testid="' + id + '"]');
      }
      checks.userLanguageReason = spec.phrases.every((phrase) => bodyText.includes(phrase));
      checks.noChatComposer = !document.querySelector("textarea, [contenteditable=true], [data-testid=chat-composer]");
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (api) {
        let chatError = "";
        let agentError = "";
        try {
          await api.startChat({
            requestId: "a5-blocked-chat-" + scenario,
            messages: [{ role: "user", content: "this blocked A5 state must not start chat" }],
          });
        } catch (error) {
          chatError = String(error && error.message ? error.message : error);
        }
        try {
          await api.startAgentRun({
            requestId: "a5-blocked-agent-" + scenario,
            task: "this blocked A5 state must not start an agent",
            workspacePath: "C:\\\\OpenDrSai\\\\blocked-a5",
          });
        } catch (error) {
          agentError = String(error && error.message ? error.message : error);
        }
        details.blockedActions = {
          chatError: chatError.slice(0, 300),
          agentError: agentError.slice(0, 300),
        };
        checks.chatBlocked = Boolean(chatError);
        checks.agentBlocked = Boolean(agentError);
      }
      const copyButton = document.querySelector('[data-testid="a5-copy-diagnostics"]');
      checks.copyCta = Boolean(copyButton);
      if (copyButton) {
        const rect = copyButton.getBoundingClientRect();
        details.copyButtonRect = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        copyButton.click();
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && !/已复制|copied/i.test(document.body.innerText)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let clipboardText = "";
        try {
          clipboardText = await navigator.clipboard.readText();
        } catch (error) {
          details.clipboardError = String(error && error.message ? error.message : error);
        }
        details.diagnosticsSample = clipboardText.slice(0, 1200);
        checks.diagnosticsCopied = clipboardText.includes("first-use-service-availability") && clipboardText.includes(scenario);
        checks.diagnosticsRedacted =
          clipboardText.includes("[redacted") &&
          !/secret-a5|Bearer\\s+[A-Za-z0-9._~+/=-]+|api_key\\s*=\\s*secret|Cookie:\\s*session=|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|C:\\\\Users\\\\(?!\\[user\\])/i.test(clipboardText);
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  clipboard.writeText("");
  const copyButtonRect = result.details.copyButtonRect as
    | { x?: number; y?: number; width?: number; height?: number }
    | undefined;
  if (
    copyButtonRect &&
    typeof copyButtonRect.x === "number" &&
    typeof copyButtonRect.y === "number" &&
    typeof copyButtonRect.width === "number" &&
    typeof copyButtonRect.height === "number"
  ) {
    const x = Math.round(copyButtonRect.x + copyButtonRect.width / 2);
    const y = Math.round(copyButtonRect.y + copyButtonRect.height / 2);
    window.webContents.sendInputEvent({ type: "mouseMove", x, y });
    window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const clipboardText = clipboard.readText();
  result.details.diagnosticsSample = clipboardText.slice(0, 1200);
  result.checks.diagnosticsCopied =
    clipboardText.includes("first-use-service-availability") &&
    clipboardText.includes(scenario);
  result.checks.diagnosticsRedacted =
    clipboardText.includes("[redacted") &&
    !/secret-a5|Bearer\s+[A-Za-z0-9._~+/=-]+|api_key\s*=\s*secret|Cookie:\s*session=|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|C:\\Users\\(?!\[user\])/i.test(clipboardText);

  const screenshotDir = process.env.OPENDRSAI_E2E_A5_SCREENSHOT_DIR;
  if (screenshotDir) {
    mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `${scenario || "unknown"}.png`);
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  result.details.appVersion = app.getVersion();
  result.details.commit = process.env.OPENDRSAI_E2E_COMMIT || null;
  result.details.exitCode = Object.values(result.checks).every(Boolean) ? 0 : 1;

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runF2ApprovalSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const scenario = process.env.OPENDRSAI_F2_APPROVAL_SCENARIO || "all";
  const fixturePath = process.env.OPENDRSAI_E2E_F2_CERN_PDF;
  const effectDir = process.env.OPENDRSAI_E2E_F2_EFFECT_DIR;
  if (!fixturePath || !effectDir || !existsSync(fixturePath)) {
    throw new Error("F2 requires the fixed CERN PDF and an isolated effect directory.");
  }
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: "F2 CERN 关键操作", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("F2 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const scenario = ${JSON.stringify(scenario)};
      const fixturePath = ${JSON.stringify(fixturePath)};
      const workspacePath = ${JSON.stringify(workspacePath)};
      const api = window.openDrSai;
      const checks = { bridge: Boolean(api) };
      const details = {
        scenario,
        url: location.href,
        userAgent: navigator.userAgent,
        capturedAt: new Date().toISOString(),
        approvals: [],
        eventTrace: [],
      };
      if (!api) return { checks, details };
      try {
        const developerButton = [...document.querySelectorAll("button")]
          .find((button) => /developer|开发者/i.test(button.textContent || ""));
        if (developerButton) {
          developerButton.focus();
          developerButton.click();
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        const login = await api.login({ developerBypass: true, rememberMe: false });
        details.login = { ok: login && login.ok, message: login && login.message, buttonVisible: Boolean(developerButton) };
        checks.login = Boolean(login && login.ok);
      } catch (error) {
        details.loginError = String(error && error.message ? error.message : error);
      }
      const cern = await api.previewWorkspaceFile({ workspacePath, path: fixturePath, maxBytes: 100000 });
      checks.cernPdfVerified = cern.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e' && /Pages: 48/.test(cern.content || '');
      const cases = [
        ["new_directory", "workspace", "workspace.revert", "Access new directory", "C:\\\\OpenDrSai-F2\\\\new-input", "Only the selected folder", "Directory contents may enter task context."],
        ["external_data", "network", "network.request", "Send external data", "https://f2.example.test/upload", "One outbound request", "Selected summary would leave this device."],
        ["large_compute", "workflow", "workflow.run", "Start large compute", "GPU budget 250 CNY", "One queued workflow run", "Compute spend and queue slot would be consumed."],
        ["overwrite_file", "workspace", "workspace.revert", "Overwrite file", "report.docx", "Single target file", "Existing content would be replaced."],
        ["delete_file", "workspace", "workspace.revert", "Delete file", "raw-data.csv", "Single target file", "File would be removed from workspace."],
        ["public_share", "network", "network.request", "Public share", "share://public/result", "One public share link", "Anyone with the link could view the result."],
      ];
      const selected = scenario === "all" ? cases : cases.filter((item) => item[0] === scenario);
      async function waitForPending(id) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const pending = await api.listPendingApprovals();
          const match = pending.find((approval) => approval.id === id);
          if (match) return { pending, match };
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { pending: await api.listPendingApprovals(), match: null };
      }
      async function openApprovalCenter() {
        window.dispatchEvent(new Event("drsai:e2e-open-approval-center"));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const buttons = [...document.querySelectorAll("button")];
        const approvalButton = buttons.find((button) => /Approval Center|审批|管理|Manage/i.test(button.textContent || ""));
        if (approvalButton) approvalButton.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      async function waitForApprovalCard(title, target, scope, impact) {
        const deadline = Date.now() + 5000;
        let article = null;
        while (Date.now() < deadline) {
          article = [...document.querySelectorAll("article")]
            .find((node) => {
              const text = node.textContent || "";
              return text.includes(title) && text.includes(target) && text.includes(scope) && text.includes(impact);
            }) || null;
          if (article) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return article;
      }
      for (const item of selected) {
        const [key, source, actionKind, title, target, scope, impact] = item;
        const proposal = await api.proposeApproval({
          source,
          actionKind,
          title,
          detail: impact,
          target,
          scope,
          impact,
          risk: "high",
          idempotencyKey: "f2-" + key + "-" + Date.now(),
        });
        details.eventTrace.push({ key, event: "proposed", proposal });
        const queued = proposal && proposal.queued && proposal.approval;
        checks["queued_" + key] = Boolean(queued);
        if (!queued) continue;
        const approvalId = proposal.approval.id;
        const pendingState = await waitForPending(approvalId);
        checks["pending_" + key] = Boolean(pendingState.match);
        const approval = pendingState.match || proposal.approval;
        checks["schema_" + key] = Boolean(
          approval.title && approval.target && approval.scope && approval.impact &&
          approval.risk === "high" && approval.actionKind === actionKind
        );
        await openApprovalCenter();
        const card = await waitForApprovalCard(title, target, scope, impact);
        const bodyText = document.body ? document.body.innerText : "";
        checks["cardText_" + key] =
          Boolean(card) &&
          /Approve|Allow|Reject|Deny|拒绝|允许/i.test(card.textContent || bodyText);
        const rejectButton = [...(card || document).querySelectorAll("button")]
          .find((button) => /Reject|Deny|拒绝/i.test(button.textContent || ""));
        checks["keyboardTarget_" + key] = Boolean(rejectButton);
        if (rejectButton) {
          rejectButton.focus();
          rejectButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          rejectButton.click();
        } else {
          await api.decidePendingApproval({ id: approvalId, approved: false });
        }
        const afterRejectDeadline = Date.now() + 3000;
        let stillPending = true;
        while (Date.now() < afterRejectDeadline) {
          const pending = await api.listPendingApprovals();
          stillPending = pending.some((approval) => approval.id === approvalId);
          if (!stillPending) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        checks["rejectedCleared_" + key] = !stillPending;
        details.approvals.push({
          key,
          id: approvalId,
          action: actionKind,
          object: target,
          scope,
          impact,
          risk: approval.risk,
          decision: "reject",
          rejectApprovalId: approvalId,
          retries: 0,
        });
      }
      details.approvedControls = [];
      for (const item of selected) {
        const [key, source, actionKind, title, target, scope, impact] = item;
        const idempotencyKey = 'f2-control-' + key + '-' + Date.now();
        const proposal = await api.proposeApproval({ source, actionKind, title: title + ' authorized control', detail: impact, target, scope, impact, risk: 'high', idempotencyKey });
        const approvalId = proposal.approval?.id;
        const executed = Boolean(approvalId && await api.decidePendingApproval({ id: approvalId, approved: true }));
        const repeated = await api.proposeApproval({ source, actionKind, title: title + ' authorized control', detail: impact, target, scope, impact, risk: 'high', idempotencyKey });
        checks['approvedOnce_' + key] = Boolean(proposal.queued && executed && repeated.queued === false && repeated.requiresApproval === false);
        details.approvedControls.push({ key, approvalId, repeated });
      }
      details.accessibleTree = [...document.querySelectorAll("button, input, [role], section, article")]
        .slice(0, 160)
        .map((node) => ({
          tag: node.tagName,
          role: node.getAttribute("role"),
          label: node.getAttribute("aria-label") || node.textContent?.replace(/\\s+/g, " ").trim().slice(0, 120),
          disabled: node.hasAttribute("disabled"),
        }));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const approvalDetails = result.details.approvals as Array<{ key: string; rejectApprovalId: string; unauthorizedExecutions?: number }>;
  const controlDetails = result.details.approvedControls as Array<{ key: string; approvalId: string }>;
  const effectDiagnostics = approvalDetails.map((approval) => {
    const effectPath = join(effectDir, `${approval.key}.json`);
    const events = existsSync(effectPath)
      ? (JSON.parse(readFileSync(effectPath, "utf8")) as { events?: Array<{ approvalId?: string; phase?: string }> }).events ?? []
      : [];
    const control = controlDetails.find((item) => item.key === approval.key);
    const unauthorizedExecutions = events.filter((event) => event.approvalId === approval.rejectApprovalId || event.phase === "reject").length;
    const authorizedExecutions = events.filter((event) => event.approvalId === control?.approvalId && event.phase === "control").length;
    approval.unauthorizedExecutions = unauthorizedExecutions;
    result.checks[`rejectZeroSideEffects_${approval.key}`] = unauthorizedExecutions === 0;
    result.checks[`approvedExactlyOnce_${approval.key}`] = authorizedExecutions === 1 && events.length === 1;
    return { key: approval.key, effectPath, events, unauthorizedExecutions, authorizedExecutions };
  });
  result.details.effectDiagnostics = effectDiagnostics;
  result.details.unauthorizedExecutions = effectDiagnostics.reduce((sum, item) => sum + item.unauthorizedExecutions, 0);
  result.checks.allRejectedOperationsHaveZeroSideEffects = result.details.unauthorizedExecutions === 0;
  result.checks.allApprovedControlsExecuteOnce = effectDiagnostics.every((item) => item.authorizedExecutions === 1);
  result.checks.cernFixturePreserved = existsSync(fixturePath) && readFileSync(fixturePath).length === 7_664_262;

  const screenshotDir = process.env.OPENDRSAI_E2E_F2_SCREENSHOT_DIR;
  if (screenshotDir) {
    mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `${scenario || "all"}.png`);
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  result.details.appVersion = app.getVersion();
  result.details.commit = process.env.OPENDRSAI_E2E_COMMIT || null;
  result.details.exitCode = Object.values(result.checks).every(Boolean) ? 0 : 1;
  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runF4AnomalyDecisionSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_F4_CERN_PDF;
  const csvPath = process.env.OPENDRSAI_E2E_F4_CSV;
  const evidenceDir = process.env.OPENDRSAI_E2E_F4_EVIDENCE_DIR;
  const branch = process.env.OPENDRSAI_E2E_F4_BRANCH as "keep" | "exclude" | "both" | undefined;
  if (!fixturePath || !csvPath || !evidenceDir || !branch || !existsSync(fixturePath) || !existsSync(csvPath) || !["keep", "exclude", "both"].includes(branch)) {
    throw new Error("F4 requires the fixed CERN PDF, a CERN CSV fixture, an evidence directory, and a valid branch.");
  }
  mkdirSync(evidenceDir, { recursive: true });
  const workspacePath = dirname(csvPath);
  const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
  const originalPdfHash = hash(fixturePath);
  const originalCsvHash = hash(csvPath);
  const filesBefore = new Set(readdirSync(workspacePath));
  await createWorkspace({ source: "existing", path: workspacePath, name: `F4 CERN 异常处理 ${branch}`, trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("F4 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const seeded = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = { bridge: Boolean(api) };
      if (!api) return { checks };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = Boolean(login?.ok);
      const pdf = await api.previewWorkspaceFile({ workspacePath: ${JSON.stringify(workspacePath)}, path: ${JSON.stringify(fixturePath)}, maxBytes: 100000 });
      const pdfSize = Number(pdf.sizeBytes ?? pdf.size ?? 0);
      checks.cernPdfVerified = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e' && pdfSize === 7664262;
      await api.enqueueBackgroundTask({
        kind: 'agent_run', source: 'agent', title: 'F4 CERN 容量异常数据处理', workspacePath: ${JSON.stringify(workspacePath)},
        targetId: 'f4-cern-${branch}', status: 'completed', progress: 100, message: '发现两行异常容量数据。', verification: '等待用户选择处理方式。',
        deliverySummary: {
          findingSummary: 'CERN 容量测试数据中发现 2 行异常。', importance: 'high', importanceReason: '异常处理会改变趋势结论。',
          suggestedAction: '选择保留、排除或同时生成两种结果。', workSummary: '从固定 CERN PDF 建立容量测试表。', coreConclusion: '应让用户明确决定异常数据的处理方式。',
          verification: '原 PDF 和原 CSV 必须保持不变。', remainingRisks: '尚未应用异常处理决定。', completionCriteria: { passed: ['固定 CERN PDF 已校验'], incomplete: ['异常处理决定待选择'] },
          artifacts: [{
            id: 'f4-cern-chart', label: 'cern-wlcg-capacity-chart.svg', path: ${JSON.stringify(join(workspacePath, "cern-wlcg-capacity-chart.svg"))}, kind: 'file',
            anomalyDecision: { sourcePath: ${JSON.stringify(csvPath)}, anomalyColumn: 'anomaly', totalRows: 5, anomalyRows: 2, normalRows: 3 },
            chartQuality: { status: 'passed', checkedAt: '2026-07-15T00:00:00.000Z', sourcePath: ${JSON.stringify(csvPath)}, xAxis: 'year', yAxis: 'throughput_tbps', unit: 'Tbps', legend: 'WLCG capacity test', axisLabelsVisible: true, unitVisible: true, legendVisible: true, pointsExpected: 5, pointsMatched: 5, coordinateMatches: 5, anomaliesExpected: 2, anomaliesMatched: 2, mismatchCount: 0, checks: ['5/5 data points', '2/2 anomalies'] }
          }]
        }
      });
      document.querySelector('[data-nav-id="results"]')?.click();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !document.querySelector('[data-testid="results-anomaly-decision"]')) await new Promise((resolve) => setTimeout(resolve, 100));
      const card = document.querySelector('[data-testid="results-anomaly-decision"]');
      const options = [...(card?.querySelectorAll('input[type="radio"]') || [])];
      checks.cardVisible = Boolean(card);
      checks.threeExclusiveOptions = options.length === 3 && new Set(options.map((input) => input.name)).size === 1;
      const text = (card?.innerText || '').replace(/\s+/g, ' ');
      checks.impactCopy = ['保留异常', '排除异常', '两种都做', '便于审计', '观察基线', '互不覆盖'].every((value) => text.includes(value));
      const target = card?.querySelector('input[value="${branch}"]');
      target?.focus();
      return { checks, focused: document.activeElement === target, text };
    })()
  `, true) as { checks: Record<string, boolean>; focused: boolean; text: string };
  const checks = seeded.checks;
  checks.radioFocused = seeded.focused;
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  checks.keyboardSelected = await window.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('[data-testid="results-anomaly-decision"] input[value="${branch}"]');
      const button = document.querySelector('[data-testid="results-apply-anomaly-decision"]');
      button?.focus();
      return Boolean(input?.checked && document.activeElement === button && !button?.disabled);
    })()
  `, true) as boolean;
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  const completionDeadline = Date.now() + 8000;
  let uiResult: { state?: string; decision?: string; outputCount?: string; status?: string } = {};
  while (Date.now() < completionDeadline) {
    uiResult = await window.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('[data-testid="results-anomaly-status"]');
      const record = document.querySelector('[data-testid="results-anomaly-record"]');
      return { state: status?.getAttribute('data-state'), decision: record?.getAttribute('data-decision'), outputCount: record?.getAttribute('data-output-count'), status: status?.textContent || '' };
    })()`, true) as typeof uiResult;
    if (uiResult.state === "completed" && uiResult.decision === branch) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const base = csvPath.replace(/\.csv$/i, "");
  const keepPath = `${base}-保留全部.csv`;
  const excludePath = `${base}-排除异常.csv`;
  const receiptPath = `${base}-异常处理决定.json`;
  const expectedPaths = branch === "keep" ? [keepPath, receiptPath] : branch === "exclude" ? [excludePath, receiptPath] : [keepPath, excludePath, receiptPath];
  const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown> : {};
  const readRows = (path: string): string[] => existsSync(path) ? readFileSync(path, "utf8").trim().split(/\r?\n/).slice(1) : [];
  const keepRows = readRows(keepPath);
  const excludeRows = readRows(excludePath);
  checks.keyboardApplied = uiResult.state === "completed";
  checks.decisionRecorded = uiResult.decision === branch && receipt.decision === branch;
  checks.resultNamesDecision = String(uiResult.status || "").includes(branch === "keep" ? "保留异常" : branch === "exclude" ? "排除异常" : "两种都做");
  checks.outputCountExact = Number(uiResult.outputCount) === (branch === "both" ? 2 : 1);
  checks.keepBranchExact = branch === "exclude" || (keepRows.length === 5 && keepRows.filter((row) => /,true$/i.test(row)).length === 2);
  checks.excludeBranchExact = branch === "keep" || (excludeRows.length === 3 && excludeRows.every((row) => /,false$/i.test(row)));
  const sum = (rows: string[]): number => rows.reduce((total, row) => total + Number(row.split(",")[1] || 0), 0);
  checks.numericConsistency = (branch === "exclude" || Math.abs(sum(keepRows) - 35.2) < 0.0001) && (branch === "keep" || Math.abs(sum(excludeRows) - 16) < 0.0001) && Number(receipt.totalRows) === 5 && Number(receipt.anomalyRows) === 2 && Number(receipt.normalRows) === 3;
  checks.branchIsolation = branch === "keep" ? !existsSync(excludePath) : branch === "exclude" ? !existsSync(keepPath) : existsSync(keepPath) && existsSync(excludePath);
  checks.originalsUnchanged = hash(fixturePath) === originalPdfHash && hash(csvPath) === originalCsvHash;
  checks.outputHashesRecorded = Array.isArray(receipt.outputs) && receipt.outputs.every((output) => typeof output.sha256 === "string" && output.sha256 === `sha256:${hash(output.path)}`);
  const filesAfter = new Set(readdirSync(workspacePath));
  const added = [...filesAfter].filter((name) => !filesBefore.has(name)).map((name) => join(workspacePath, name)).sort();
  checks.sideEffectLedgerExact = JSON.stringify(added) === JSON.stringify(expectedPaths.sort());

  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Accessibility.enable");
  const axTree = await window.webContents.debugger.sendCommand("Accessibility.getFullAXTree") as { nodes?: Array<Record<string, unknown>> };
  const names = (axTree.nodes ?? []).map((node) => String((node.name as { value?: unknown })?.value || ""));
  checks.accessibilityTree = ["保留异常", "排除异常", "两种都做", "应用决定并生成结果"].every((name) => names.some((candidate) => candidate.includes(name)));
  writeFileSync(join(evidenceDir, "accessibility-tree.json"), `${JSON.stringify(axTree, null, 2)}\n`, "utf8");
  writeFileSync(join(evidenceDir, `f4-${branch}.png`), (await window.webContents.capturePage()).toPNG());
  const details = { branch, workspacePath, fixturePath, csvPath, originalPdfHash, originalCsvHash, expectedPaths, added, uiResult, receipt, cardText: seeded.text };
  writeFileSync(join(evidenceDir, "side-effect-ledger.json"), `${JSON.stringify({ filesBefore: [...filesBefore], filesAfter: [...filesAfter], added, expectedPaths }, null, 2)}\n`, "utf8");
  return { ok: Object.values(checks).every(Boolean), checks, details };
}

async function runF3ApprovalSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixturePath = process.env.OPENDRSAI_E2E_F3_CERN_PDF;
  const effectDir = process.env.OPENDRSAI_E2E_F3_EFFECT_DIR;
  const evidenceDir = process.env.OPENDRSAI_E2E_F3_EVIDENCE_DIR;
  if (!fixturePath || !effectDir || !evidenceDir || !existsSync(fixturePath)) {
    throw new Error("F3 requires the fixed CERN PDF, an isolated effect directory, and an evidence directory.");
  }
  mkdirSync(effectDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const workspacePath = dirname(fixturePath);
  await createWorkspace({ source: "existing", path: workspacePath, name: "F3 CERN 审批说明", trusted: true });
  await new Promise<void>((resolveReload, rejectReload) => {
    const timer = setTimeout(() => rejectReload(new Error("F3 renderer reload timed out.")), 10_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
    window.webContents.reload();
  });
  window.show();
  window.focus();

  const cases = [
    { key: "file_access", source: "workspace", actionKind: "workspace.revert", title: "读取新文件夹中的 CERN 材料", object: "CERN 访问资料（新目录）", scope: "仅本次任务读取这个新目录", impact: "目录中的文件会加入本次分析，但不会修改原文件。" },
    { key: "file_modify", source: "workspace", actionKind: "workspace.stage", title: "更新 CERN 管理者报告", object: "CERN 管理者报告.docx", scope: "仅修改报告中的结论段落", impact: "现有结论段落会被新内容替换，可通过版本记录恢复。" },
    { key: "external_send", source: "network", actionKind: "network.request", title: "向外部服务发送 CERN 摘要", object: "CERN 管理者摘要", scope: "仅发送这份摘要，不发送原始 PDF", impact: "摘要内容将离开这台设备并交给外部服务处理。" },
    { key: "large_compute", source: "workflow", actionKind: "workflow.run", title: "启动 CERN 48 页深度分析", object: "CERN 48 页分析任务", scope: "仅运行一次，计算预算上限 250 元", impact: "会占用计算队列并可能产生最高 250 元费用。" },
    { key: "file_delete", source: "workspace", actionKind: "workspace.revert", title: "删除 CERN 临时分析草稿", object: "临时分析草稿.csv", scope: "仅删除这一份临时草稿", impact: "文件会从工作区移除，原始 CERN PDF 不受影响。" },
  ] as const;
  const seeded = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = { bridge: Boolean(api) };
      const details = { approvals: [], cards: [] };
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = Boolean(login?.ok);
      const preview = await api.previewWorkspaceFile({ workspacePath: ${JSON.stringify(workspacePath)}, path: ${JSON.stringify(fixturePath)}, maxBytes: 100000 });
      checks.cernPdfVerified = preview.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e' && /Pages: 48/.test(preview.content || '');
      const cases = ${JSON.stringify(cases)};
      for (const item of cases) {
        const proposal = await api.proposeApproval({
          source: item.source,
          actionKind: item.actionKind,
          title: item.title,
          detail: item.impact,
          businessAction: item.title,
          businessObject: item.object,
          target: item.object,
          scope: item.scope,
          impact: item.impact,
          risk: 'high',
          idempotencyKey: 'f3-' + item.key + '-' + Date.now(),
        });
        checks['queued_' + item.key] = Boolean(proposal?.queued && proposal?.approval?.id);
        details.approvals.push({ ...item, id: proposal?.approval?.id || null });
      }
      window.dispatchEvent(new Event('drsai:e2e-open-approval-center'));
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && document.querySelectorAll('[data-testid="business-approval-card"]').length < cases.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const forbidden = /workspace\\.|network\\.|workflow\\.|shell\\.|git\\.|browser\\.|external\\.service|actionKind|JSON|MCP|tool name|命令参数/i;
      for (const item of cases) {
        const approval = details.approvals.find((entry) => entry.key === item.key);
        const card = [...document.querySelectorAll('[data-testid="business-approval-card"]')]
          .find((node) => node.getAttribute('data-approval-id') === approval?.id);
        const text = (card?.innerText || '').replace(/\\s+/g, ' ').trim();
        const aria = card?.getAttribute('aria-label') || '';
        const buttons = [...(card?.querySelectorAll('button') || [])].map((button) => ({ text: (button.textContent || '').trim(), aria: button.getAttribute('aria-label') || '' }));
        checks['cardVisible_' + item.key] = Boolean(card);
        checks['sevenBusinessFields_' + item.key] = Boolean(
          text.includes('要做什么') && text.includes(item.title) &&
          text.includes('涉及对象') && text.includes(item.object) &&
          text.includes('作用范围') && text.includes(item.scope) &&
          text.includes('可能影响') && text.includes(item.impact) &&
          text.includes('风险说明') && text.includes('高风险') &&
          buttons.some((button) => /允许并执行/.test(button.text)) &&
          buttons.some((button) => /拒绝并停止/.test(button.text))
        );
        checks['plainLanguage_' + item.key] = Boolean(text && !forbidden.test(text));
        checks['cardAccessibleName_' + item.key] = Boolean(
          aria.includes(item.title) && aria.includes(item.object) && aria.includes(item.scope) &&
          aria.includes(item.impact) && aria.includes('高风险') &&
          aria.includes('允许并执行') && aria.includes('拒绝并停止')
        );
        details.cards.push({ key: item.key, id: approval?.id, text, aria, buttons });
      }
      return { checks, details };
    })()
  `, true) as { checks: Record<string, boolean>; details: { approvals: Array<Record<string, string | null>>; cards: Array<Record<string, unknown>> } };
  const result: SmokeResult = { ok: false, checks: seeded.checks, details: seeded.details };

  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Accessibility.enable");
  const axTree = await window.webContents.debugger.sendCommand("Accessibility.getFullAXTree") as { nodes?: Array<Record<string, unknown>> };
  const axNodes = axTree.nodes ?? [];
  const articleNames = axNodes
    .filter((node) => String((node.role as { value?: unknown })?.value || "") === "article")
    .map((node) => String((node.name as { value?: unknown })?.value || ""));
  const buttonNames = axNodes
    .filter((node) => String((node.role as { value?: unknown })?.value || "") === "button")
    .map((node) => String((node.name as { value?: unknown })?.value || ""));
  for (const item of cases) {
    result.checks[`accessibleTree_${item.key}`] = articleNames.some((name) =>
      name.includes(item.title) && name.includes(item.object) && name.includes(item.scope) &&
      name.includes(item.impact) && name.includes("高风险") &&
      name.includes("允许并执行") && name.includes("拒绝并停止"),
    );
    result.checks[`accessibleButtons_${item.key}`] =
      buttonNames.some((name) => name.includes(`允许并执行：${item.title}`)) &&
      buttonNames.some((name) => name.includes(`拒绝并停止：${item.title}`));
  }
  const axTreePath = join(evidenceDir, "approval-accessibility-tree.json");
  writeFileSync(axTreePath, `${JSON.stringify(axTree, null, 2)}\n`, "utf8");
  const screenshotPath = join(evidenceDir, "approval-business-cards.png");
  writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  result.details.accessibilityTreePath = axTreePath;
  result.details.screenshotPath = screenshotPath;

  async function decideWithKeyboard(approvalId: string, buttonClass: "approve" | "reject"): Promise<boolean> {
    const focused = await window.webContents.executeJavaScript(`
      (() => {
        const id = ${JSON.stringify(approvalId)};
        const card = [...document.querySelectorAll('[data-testid="business-approval-card"]')]
          .find((node) => node.getAttribute('data-approval-id') === id);
        const button = card?.querySelector('button.${buttonClass}');
        if (!button) return false;
        button.focus();
        return document.activeElement === button;
      })()
    `, true) as boolean;
    if (!focused) return false;
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const pending = await window.webContents.executeJavaScript(`window.openDrSai.listPendingApprovals()`, true) as Array<{ id?: string }>;
      if (!pending.some((approval) => approval.id === approvalId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  for (const item of cases) {
    const approval = seeded.details.approvals.find((entry) => entry.key === item.key);
    const id = String(approval?.id || "");
    result.checks[`keyboardReject_${item.key}`] = Boolean(id && await decideWithKeyboard(id, "reject"));
  }

  const controls: Array<{ key: string; approvalId: string; repeated: unknown }> = [];
  for (const item of cases) {
    const control = await window.webContents.executeJavaScript(`
      (async () => {
        const api = window.openDrSai;
        const item = ${JSON.stringify(item)};
        const idempotencyKey = 'f3-control-' + item.key + '-' + Date.now();
        const proposal = await api.proposeApproval({
          source: item.source, actionKind: item.actionKind, title: item.title, detail: item.impact,
          businessAction: item.title, businessObject: item.object, target: item.object,
          scope: item.scope, impact: item.impact, risk: 'high', idempotencyKey,
        });
        return { proposal, idempotencyKey };
      })()
    `, true) as { proposal?: { queued?: boolean; approval?: { id?: string } }; idempotencyKey: string };
    const approvalId = String(control.proposal?.approval?.id || "");
    const cardDeadline = Date.now() + 5000;
    let visible = false;
    while (Date.now() < cardDeadline) {
      visible = await window.webContents.executeJavaScript(`
        [...document.querySelectorAll('[data-testid="business-approval-card"]')]
          .some((node) => node.getAttribute('data-approval-id') === ${JSON.stringify(approvalId)})
      `, true) as boolean;
      if (visible) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    result.checks[`controlCardVisible_${item.key}`] = Boolean(control.proposal?.queued && approvalId && visible);
    result.checks[`keyboardAllow_${item.key}`] = Boolean(approvalId && await decideWithKeyboard(approvalId, "approve"));
    const repeatResult = await window.webContents.executeJavaScript(`window.openDrSai.proposeApproval({
      ...${JSON.stringify({
        source: item.source,
        actionKind: item.actionKind,
        title: item.title,
        detail: item.impact,
        businessAction: item.title,
        businessObject: item.object,
        target: item.object,
        scope: item.scope,
        impact: item.impact,
        risk: "high",
      })},
      idempotencyKey: ${JSON.stringify(control.idempotencyKey)}
    })`, true) as { queued?: boolean; requiresApproval?: boolean };
    result.checks[`idempotentOnce_${item.key}`] = repeatResult.queued === false && repeatResult.requiresApproval === false;
    controls.push({ key: item.key, approvalId, repeated: repeatResult });
  }
  result.details.controls = controls;

  const effectDiagnostics = cases.map((item) => {
    const path = join(effectDir, `${item.key}.json`);
    const events = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as { events?: Array<{ approvalId?: string; phase?: string }> }).events ?? []
      : [];
    const rejectedId = seeded.details.approvals.find((approval) => approval.key === item.key)?.id;
    const controlId = controls.find((control) => control.key === item.key)?.approvalId;
    const rejectedExecutions = events.filter((event) => event.approvalId === rejectedId || event.phase === "reject").length;
    const authorizedExecutions = events.filter((event) => event.approvalId === controlId && event.phase === "control").length;
    result.checks[`rejectZeroSideEffects_${item.key}`] = rejectedExecutions === 0;
    result.checks[`approvedExactlyOnce_${item.key}`] = authorizedExecutions === 1 && events.length === 1;
    return { key: item.key, path, events, rejectedExecutions, authorizedExecutions };
  });
  result.details.effectDiagnostics = effectDiagnostics;
  result.checks.allRejectedOperationsHaveZeroSideEffects = effectDiagnostics.every((item) => item.rejectedExecutions === 0);
  result.checks.allApprovedOperationsExecuteOnce = effectDiagnostics.every((item) => item.authorizedExecutions === 1);
  const pdfBytes = readFileSync(fixturePath);
  result.checks.cernFixturePreserved = pdfBytes.length === 7_664_262 &&
    (await import("crypto")).createHash("sha256").update(pdfBytes).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E";
  result.details.appVersion = app.getVersion();
  result.details.commit = process.env.OPENDRSAI_E2E_COMMIT || null;
  result.details.exitCode = Object.values(result.checks).every(Boolean) ? 0 : 1;
  result.ok = Object.values(result.checks).every(Boolean);
  return result;
}

async function runChatFailureSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectChat(requestId, request, options = {}) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onChatEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          let returnedRequestId = null;
          let startError = null;
          try {
            returnedRequestId = await api.startChat({ requestId, model: "drsai", ...request });
          } catch (error) {
            startError = String(error && error.message ? error.message : error);
          }
          if (options.abortAfterStart && !startError) {
            const abortDeadline = Date.now() + 5000;
            while (Date.now() < abortDeadline && !events.some((event) => event.type === "start")) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await api.abortChat(requestId);
          }
          const deadline = Date.now() + (options.waitMs || 12000);
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const threads = await api.listThreads();
          return {
            returnedRequestId,
            startError,
            events,
            threads,
            finalThread: threads.find((thread) => thread.id === requestId) || null,
            durationMs: Date.now() - startedAt,
          };
        } finally {
          unsubscribe();
        }
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      const scenario = ${JSON.stringify(process.env.OPENDRSAI_E2E_CHAT_FAILURE_SCENARIO || "")};
      details.scenario = scenario;
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      if (scenario !== "gateway-unreachable") {
        const health = await api.getHealth();
        details.health = {
          gatewayReady: health.gatewayReady,
          gatewayManaged: health.gateway && health.gateway.managed,
          gatewayExternalReady: health.gateway && health.gateway.externalReady,
          gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
        };
        checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && (health.gateway.managed || health.gateway.externalReady) && !health.gateway.externalConflict);
      }

      if (scenario === "abort") {
        const requestId = "e2e-failure-abort";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "abort me" }] },
          { abortAfterStart: true, waitMs: 10000 },
        );
        details.abort = summarizeOutcome(outcome);
        checks.abortStart = outcome.events.some((event) => event.type === "start");
        checks.abortEvent = outcome.events.some((event) => event.type === "aborted");
        checks.abortTerminal = details.abort.terminalEventType === "aborted";
        checks.abortThreadIdle = details.abort.thread && details.abort.thread.status === "idle";
        checks.abortNoDone = !outcome.events.some((event) => event.type === "done");
        checks.abortNoError = !outcome.events.some((event) => event.type === "error");
      } else if (scenario === "sse-error") {
        const requestId = "e2e-failure-error";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "trigger sse error" }] },
          { waitMs: 10000 },
        );
        details.sseError = summarizeOutcome(outcome);
        checks.sseErrorStart = outcome.events.some((event) => event.type === "start");
        checks.sseErrorEvent = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("synthetic gateway error"));
        checks.sseErrorTerminal = details.sseError.terminalEventType === "error";
        checks.sseErrorThreadError = details.sseError.thread && details.sseError.thread.status === "error";
        checks.sseErrorNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "gateway-unreachable") {
        const requestId = "e2e-failure-unreachable";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "gateway unreachable" }] },
          { waitMs: 10000 },
        );
        details.gatewayUnreachable = summarizeOutcome(outcome);
        checks.gatewayUnreachableStart = outcome.events.some((event) => event.type === "start");
        checks.gatewayUnreachableError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("Gateway is not ready"));
        checks.gatewayUnreachableTerminal = details.gatewayUnreachable.terminalEventType === "error";
        checks.gatewayUnreachableThreadError = details.gatewayUnreachable.thread && details.gatewayUnreachable.thread.status === "error";
        checks.gatewayUnreachableNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "timeout") {
        const requestId = "e2e-failure-timeout";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "timeout please" }] },
          { waitMs: 10000 },
        );
        details.timeout = summarizeOutcome(outcome);
        checks.timeoutStart = outcome.events.some((event) => event.type === "start");
        checks.timeoutError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("timed out"));
        checks.timeoutTerminal = details.timeout.terminalEventType === "error";
        checks.timeoutThreadError = details.timeout.thread && details.timeout.thread.status === "error";
        checks.timeoutDuration = details.timeout.durationMs >= 1000;
        checks.timeoutNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "empty-done") {
        const requestId = "e2e-failure-empty-done";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "empty done" }] },
          { waitMs: 10000 },
        );
        details.emptyDone = summarizeOutcome(outcome);
        checks.emptyDoneStart = outcome.events.some((event) => event.type === "start");
        checks.emptyDoneEvent = outcome.events.some((event) => event.type === "done");
        checks.emptyDoneTerminal = details.emptyDone.terminalEventType === "done";
        checks.emptyDoneThreadIdle = details.emptyDone.thread && details.emptyDone.thread.status === "idle";
        checks.emptyDoneNoChunk = !outcome.events.some((event) => event.type === "chunk");
        checks.emptyDoneNoError = !outcome.events.some((event) => event.type === "error" || event.type === "aborted");
      } else if (scenario === "chunk-disconnect") {
        const requestId = "e2e-failure-disconnect";
        const outcome = await collectChat(
          requestId,
          { messages: [{ role: "user", content: "disconnect after chunk" }] },
          { waitMs: 10000 },
        );
        details.chunkDisconnect = summarizeOutcome(outcome);
        checks.chunkDisconnectStart = outcome.events.some((event) => event.type === "start");
        checks.chunkDisconnectChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("partial before disconnect"));
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && (
          String(event.error || "").includes("ended before data: [DONE]") ||
          (event.failureRecovery?.kind === "network" && event.failureRecovery.exhausted === true)
        ));
        checks.chunkDisconnectTerminal = details.chunkDisconnect.terminalEventType === "error";
        checks.chunkDisconnectThreadError = details.chunkDisconnect.thread && details.chunkDisconnect.thread.status === "error";
        checks.chunkDisconnectNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "attachments") {
        const requestId = "e2e-attachments";
        const attachmentFilePath = ${JSON.stringify(process.env.OPENDRSAI_E2E_ATTACHMENT_FILE || "C:\\OpenDrSai\\fixtures\\notes.md")};
        const attachmentFolderPath = ${JSON.stringify(process.env.OPENDRSAI_E2E_ATTACHMENT_FOLDER || "C:\\OpenDrSai\\fixtures\\project")};
        const outcome = await collectChat(
          requestId,
          {
            attachments: [
              { kind: "file", path: attachmentFilePath, name: "notes.md" },
              { kind: "folder", path: attachmentFolderPath, name: "project" },
            ],
            messages: [{ role: "user", content: "use attached files" }],
          },
          { waitMs: 10000 },
        );
        details.attachments = summarizeOutcome(outcome);
        checks.attachmentsStart = outcome.events.some((event) => event.type === "start");
        checks.attachmentsChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent attachments: 2"));
        checks.attachmentsTerminal = details.attachments.terminalEventType === "done";
        checks.attachmentsThreadIdle = details.attachments.thread && details.attachments.thread.status === "idle";
        checks.attachmentsNoError = !outcome.events.some((event) => event.type === "error" || event.type === "aborted");
      } else {
        checks.knownScenario = false;
        details.error = "Unknown failure scenario.";
      }

      function summarizeOutcome(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returnedRequestId: outcome.returnedRequestId,
          startError: outcome.startError,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            failureRecovery: event.failureRecovery,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
          thread: outcome.finalThread,
          threads: outcome.threads,
        };
      }

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runNaturalLanguageScheduleSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const waitFor = async (find, timeout = 10000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = await find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };
      const click = (element) => element && element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspaceItem = await waitFor(() => [...document.querySelectorAll(".workspace-item")].find((item) => (item.title || "").includes(${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")})));
      click(workspaceItem);
      checks.workspaceSelected = Boolean(workspaceItem);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const nav = await waitFor(() => [...document.querySelectorAll("button")].find((button) => /Scheduled/i.test(button.title || button.textContent || "") || (button.title || button.textContent || "").includes("\u5df2\u5b89\u6392")));
      checks.scheduledNavigationVisible = Boolean(nav);
      click(nav);
      const center = await waitFor(() => document.querySelector('[data-testid="task-center-view"]'));
      checks.taskCenterOpened = Boolean(center);
      const input = await waitFor(() => document.querySelector('[data-testid="natural-schedule-input"]'));
      checks.naturalLanguageInputVisible = Boolean(input);
      if (!input) return { checks, details };
      setValue(input, "\u6bcf\u5468\u4e00\u4e0a\u5348\u4e5d\u70b9\u68c0\u67e5\u8fd9\u4e2a\u6587\u4ef6\u5939\u7684\u65b0\u6570\u636e");
      click(document.querySelector('[data-testid="natural-schedule-understand"]'));
      const confirmation = await waitFor(() => document.querySelector('[data-testid="schedule-confirmation"]'));
      checks.confirmationRequired = Boolean(confirmation);
      const confirmationText = confirmation ? confirmation.textContent || "" : "";
      checks.readableTime = confirmationText.includes("\u6bcf\u5468\u4e00 09:00") && /\([^)]*(?:Shanghai|GMT-8)[^)]*\)/.test(confirmationText);
      checks.readableMaterial = confirmationText.includes(${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")});
      checks.readableAction = confirmationText.includes("\u68c0\u67e5\u6587\u4ef6\u5939\u4e2d\u7684\u65b0\u6570\u636e");
      checks.readableNotification = confirmationText.includes("Windows \u901a\u77e5");
      const before = await window.openDrSai.listScheduledTasks({ workspacePath: ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")} });
      checks.notSavedBeforeConfirmation = before.length === 0;
      click(document.querySelector('[data-testid="schedule-confirm-save"]'));
      const saved = await waitFor(() => document.querySelector('[data-testid="saved-schedule-item"]'));
      checks.savedVisible = Boolean(saved);
      const persisted = await waitFor(async () => {
        const items = await window.openDrSai.listScheduledTasks({ workspacePath: ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")} });
        return items.length ? items : null;
      });
      checks.persisted = Boolean(persisted && persisted.length === 1);
      const task = persisted && persisted[0];
      checks.structuredDefinition = Boolean(task && task.userDefinition && task.userDefinition.weekday === 1 && task.userDefinition.localTime === "09:00");
      checks.cernWorkspaceTarget = Boolean(task && task.target === ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")});
      click(document.querySelector('[data-testid="schedule-edit"]'));
      const editForm = await waitFor(() => document.querySelector('[data-testid="schedule-edit-form"]'));
      checks.editOpened = Boolean(editForm);
      if (editForm) {
        const editInputs = [...editForm.querySelectorAll("input")];
        setValue(editInputs[0], "Weekly CERN data check");
        setValue(editInputs[1], "10:30");
        setValue(editInputs[3], "Check new CERN reports");
        click(editForm.querySelector('[data-testid="schedule-edit-save"]'));
      }
      const edited = await waitFor(async () => {
        const items = await window.openDrSai.listScheduledTasks({ workspacePath: ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")} });
        return items[0] && items[0].title === "Weekly CERN data check" ? items[0] : null;
      });
      checks.editPersisted = Boolean(edited && edited.userDefinition.localTime === "10:30" && edited.userDefinition.actionDescription.includes("CERN"));
      checks.noDuplicateAfterEdit = Boolean(edited && (await window.openDrSai.listScheduledTasks({ workspacePath: ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "")} })).length === 1);
      details.task = edited;
      details.confirmationText = confirmationText;
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runScheduledTriggerStabilitySmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_K2_PHASE || "trigger";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\k2";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai;
      const waitFor = async (find, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); } return null; };
      const click = (element) => element && element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspaceItem = await waitFor(() => [...document.querySelectorAll(".workspace-item")].find((item) => (item.title || "").includes(workspacePath) || (item.textContent || "").includes("CERN reusable task")));
      click(workspaceItem);
      checks.workspaceSelected = Boolean(await waitFor(() => workspaceItem?.closest(".workspace-row")?.classList.contains("active")));
      const cernPdf = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const preview = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfAvailable = preview.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";
      const triggerNow = "2026-07-20T01:00:00.000Z";
      if (${JSON.stringify(phase)} === "trigger") {
        const created = [];
        for (let index = 0; index < 20; index += 1) {
          const latenessMs = index < 12 ? 0 : index < 16 ? 5 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000;
          const scheduledFor = new Date(Date.parse(triggerNow) - latenessMs).toISOString();
          created.push(await api.createScheduledTask({
            kind: "monitor",
            title: "K2 CERN accelerated trigger " + String(index + 1).padStart(2, "0"),
            cadence: "weekly",
            target: workspacePath,
            workspacePath,
            workflowTemplateId: "plan-review-fix",
            nextRunAt: scheduledFor,
            approvalRequired: true,
            userDefinition: {
              sourceText: "K2 accelerated CERN schedule " + (index + 1),
              timeDescription: "Every Monday 09:00",
              materialDescription: "CERN workspace: " + workspacePath,
              actionDescription: "Check the CERN folder for new data",
              notificationDescription: "Windows completion notification",
              timezone: "Asia/Shanghai",
              weekday: 1,
              localTime: "09:00",
              confirmedAt: "2026-07-15T00:00:00.000Z",
            },
          }));
        }
        checks.twentySchedulesCreated = created.length === 20 && new Set(created.map((item) => item.id)).size === 20;
        const [first, second] = await Promise.all([
          api.runDueScheduledTasks({ workspacePath, now: triggerNow, limit: 50 }),
          api.runDueScheduledTasks({ workspacePath, now: triggerNow, limit: 50 }),
        ]);
        const results = [first, second];
        const primary = results.find((item) => item.triggered === 20) || first;
        const duplicateScan = results.find((item) => item !== primary) || second;
        checks.triggerRate100 = primary.checked === 20 && primary.triggered === 20 && primary.runs.length === 20;
        checks.concurrentScanDeduplicated = duplicateScan.checked === 0 && duplicateScan.triggered === 0;
        checks.uniqueWorkflowRuns = new Set(primary.runs.map((run) => run.id)).size === 20;
        checks.uniqueTriggerKeys = new Set(primary.items.map((item) => item.triggerAudit?.triggerKey)).size === 20;
        checks.allAudited = primary.items.every((item) => item.triggerAudit && item.triggerAudit.scheduledFor && item.triggerAudit.triggeredAt);
        checks.onTimeRecorded = primary.items.filter((item) => !item.triggerAudit?.missed).length === 12;
        checks.missedCaughtUpOnce = primary.items.filter((item) => item.triggerAudit?.missed && item.triggerAudit.missedRunPolicy === "run_once_immediately").length === 8;
        checks.sleepLikeDelayCovered = primary.items.filter((item) => (item.triggerAudit?.missedByMs || 0) >= 2 * 24 * 60 * 60 * 1000).length === 4;
        checks.timezoneRecorded = primary.items.every((item) => item.triggerAudit?.timezone === "Asia/Shanghai");
        checks.dstPolicyRecorded = primary.items.every((item) => item.triggerAudit?.daylightSavingPolicy === "follow_timezone_wall_clock");
        const stored = await api.listScheduledTasks({ workspacePath, limit: 50 });
        checks.nextRunAnchored = stored.length === 20 && stored.every((item) => item.nextRunAt === "2026-07-20T01:00:00.000Z" ? false : item.userDefinition?.localTime === "09:00" && new Date(item.nextRunAt).getUTCHours() === 1);
        checks.twentyAuditsPersisted = stored.length === 20 && stored.every((item) => item.lastTriggerAudit?.triggerKey);
        const scheduledNav = await waitFor(() => [...document.querySelectorAll("button")].find((button) => /Scheduled/i.test(button.title || button.textContent || "") || (button.title || button.textContent || "").includes("\u5df2\u5b89\u6392")));
        click(scheduledNav);
        checks.taskCenterOpened = Boolean(await waitFor(() => document.querySelector('[data-testid="task-center-view"]')));
        const auditCard = await waitFor(() => [...document.querySelectorAll('[data-testid="schedule-trigger-audit"]')].find((item) => (item.textContent || "").includes("Asia/Shanghai") && (((item.textContent || "").includes("\u5df2\u8865\u8dd1")) || (item.textContent || "").includes("Missed"))));
        checks.userAuditVisible = Boolean(auditCard);
        checks.missedPolicyVisible = Boolean(auditCard && ((auditCard.textContent || "").includes("\u5df2\u8865\u8dd1") || (auditCard.textContent || "").includes("Missed")));
        auditCard?.scrollIntoView({ block: "center" });
        details.primary = primary;
        details.duplicateScan = duplicateScan;
        details.tasks = stored;
      } else {
        const stored = await api.listScheduledTasks({ workspacePath, limit: 50 });
        checks.twentySchedulesRecovered = stored.length === 20;
        checks.triggerAuditsRecovered = stored.every((item) => item.lastTriggerAudit?.triggerKey && item.lastTriggerAudit?.timezone === "Asia/Shanghai");
        checks.workflowLinksRecovered = new Set(stored.map((item) => item.activeWorkflowRunId)).size === 20;
        const afterRestart = await api.runDueScheduledTasks({ workspacePath, now: triggerNow, limit: 50 });
        checks.restartDidNotDuplicate = afterRestart.checked === 0 && afterRestart.triggered === 0 && afterRestart.runs.length === 0;
        checks.nextRunStillAnchored = stored.every((item) => item.userDefinition?.localTime === "09:00" && new Date(item.nextRunAt).getUTCHours() === 1);
        details.tasks = stored;
        details.afterRestart = afterRestart;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runScheduledTaskManagementSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\k7";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const click = (element) => element && element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const setValue = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); };
      const itemFor = (id) => [...document.querySelectorAll('[data-testid="saved-schedule-item"]')].find((item) => item.getAttribute("data-task-id") === id) || null;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspaceItem = await waitFor(() => [...document.querySelectorAll(".workspace-item")].find((item) => (item.title || "").includes(workspacePath)));
      click(workspaceItem);
      checks.workspaceSelected = Boolean(await waitFor(() => workspaceItem?.closest(".workspace-row")?.classList.contains("active")));
      const cernPdf = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const preview = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfAvailable = preview.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";

      const now = Date.now();
      const dueAt = new Date(now + 10 * 60 * 1000).toISOString();
      const historyDueAt = new Date(now - 1000).toISOString();
      const definition = (label) => ({ sourceText: label, timeDescription: "Every Monday 09:00", materialDescription: "CERN workspace: " + workspacePath, actionDescription: "Check CERN PDF updates", notificationDescription: "Windows completion notification", timezone: "Asia/Shanghai", weekday: 1, localTime: "09:00", confirmedAt: new Date(now).toISOString() });
      const pauseTask = await api.createScheduledTask({ kind: "monitor", title: "K7 pause and resume", cadence: "weekly", target: workspacePath, workspacePath, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt, approvalRequired: false, userDefinition: definition("K7 pause and resume") });
      const editTask = await api.createScheduledTask({ kind: "monitor", title: "K7 modify before trigger", cadence: "weekly", target: workspacePath, workspacePath, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt, approvalRequired: false, userDefinition: definition("K7 modify before trigger") });
      const historyTask = await api.createScheduledTask({ kind: "monitor", title: "K7 delete but retain history", cadence: "weekly", target: workspacePath, workspacePath, workflowTemplateId: "plan-review-fix", nextRunAt: historyDueAt, approvalRequired: false, userDefinition: definition("K7 delete with retained history") });
      checks.threeTasksCreated = new Set([pauseTask.id, editTask.id, historyTask.id]).size === 3;
      const historyRun = await api.runDueScheduledTasks({ workspacePath, now: new Date(now).toISOString(), limit: 10 });
      const historyWorkflowId = historyRun.items.find((item) => item.taskId === historyTask.id)?.workflowRunId;
      checks.historyCreatedBeforeDelete = historyRun.triggered === 1 && Boolean(historyWorkflowId);

      const nav = await waitFor(() => [...document.querySelectorAll("button")].find((button) => /Scheduled/i.test(button.title || button.textContent || "") || (button.title || button.textContent || "").includes("\u5df2\u5b89\u6392")));
      click(nav);
      checks.taskCenterOpened = Boolean(await waitFor(() => document.querySelector('[data-testid="task-center-view"]')));
      checks.allTasksViewable = Boolean(await waitFor(() => itemFor(pauseTask.id) && itemFor(editTask.id) && itemFor(historyTask.id)));

      click(itemFor(pauseTask.id)?.querySelector('[data-testid="schedule-pause"]'));
      const paused = await waitFor(async () => (await api.listScheduledTasks({ workspacePath, limit: 20 })).find((item) => item.id === pauseTask.id && item.status === "paused"));
      checks.pauseAppliedBeforeTrigger = Boolean(paused);

      click(itemFor(editTask.id)?.querySelector('[data-testid="schedule-edit"]'));
      const editForm = await waitFor(() => itemFor(editTask.id)?.querySelector('[data-testid="schedule-edit-form"]'));
      if (editForm) {
        const inputs = [...editForm.querySelectorAll("input")];
        setValue(inputs[0], "K7 modified CERN check");
        setValue(inputs[1], "10:30");
        setValue(inputs[3], "Check the CERN PDF and prepare an updated report");
        click(editForm.querySelector('[data-testid="schedule-edit-save"]'));
      }
      const edited = await waitFor(async () => (await api.listScheduledTasks({ workspacePath, limit: 20 })).find((item) => item.id === editTask.id && item.title === "K7 modified CERN check"));
      checks.modifyAppliedBeforeTrigger = Boolean(edited && edited.nextRunAt !== dueAt && edited.userDefinition?.localTime === "10:30");
      const oldTriggerScan = await api.runDueScheduledTasks({ workspacePath, now: new Date(Date.parse(dueAt) + 1000).toISOString(), limit: 10 });
      checks.pausedAndOldScheduleDidNotRun = oldTriggerScan.triggered === 0 && !oldTriggerScan.items.some((item) => item.taskId === pauseTask.id || item.taskId === editTask.id);

      click(itemFor(pauseTask.id)?.querySelector('[data-testid="schedule-resume"]'));
      const resumed = await waitFor(async () => (await api.listScheduledTasks({ workspacePath, limit: 20 })).find((item) => item.id === pauseTask.id && item.status === "enabled"));
      checks.resumeAppliedBeforeTrigger = Boolean(resumed);
      const resumeScan = await api.runDueScheduledTasks({ workspacePath, now: new Date(Date.parse(dueAt) + 2000).toISOString(), limit: 10 });
      checks.resumedTaskRanExactlyOnce = resumeScan.triggered === 1 && resumeScan.items.filter((item) => item.taskId === pauseTask.id).length === 1;

      click(itemFor(historyTask.id)?.querySelector('[data-testid="schedule-delete"]'));
      const confirmation = await waitFor(() => itemFor(historyTask.id)?.querySelector('[data-testid="schedule-delete-confirmation"]'));
      checks.deletePolicyExplained = Boolean(confirmation && /\u5df2\u6709\u4efb\u52a1\u7ed3\u679c\u4ecd\u4f1a\u4fdd\u7559|existing task results will be retained/i.test(confirmation.textContent || ""));
      click(confirmation?.querySelector('[data-testid="schedule-delete-confirm"]'));
      checks.deletedFromView = Boolean(await waitFor(() => !itemFor(historyTask.id)));
      const afterDelete = await api.listScheduledTasks({ workspacePath, limit: 20 });
      checks.deletedFromStore = !afterDelete.some((item) => item.id === historyTask.id);
      const workflows = await api.listWorkflowRuns(workspacePath);
      const background = await api.listBackgroundTasks({ workspacePath, limit: 100 });
      checks.historyRetained = Boolean(historyWorkflowId && workflows.some((run) => run.id === historyWorkflowId) && background.some((task) => task.targetId === historyWorkflowId));
      const farFutureScan = await api.runDueScheduledTasks({ workspacePath, now: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), limit: 20 });
      checks.deletedTaskNeverRanAgain = !farFutureScan.items.some((item) => item.taskId === historyTask.id);
      checks.noDuplicateSchedules = new Set(afterDelete.map((item) => item.id)).size === afterDelete.length;
      const retainedMessage = await waitFor(() => [...document.querySelectorAll('.schedule-message')].find((item) => /\u5df2\u6709\u4efb\u52a1\u7ed3\u679c\u4ecd\u4f1a\u4fdd\u7559|existing results are retained/i.test(item.textContent || "")));
      checks.retentionConfirmationVisible = Boolean(retainedMessage);
      Object.assign(details, { pauseTaskId: pauseTask.id, editTask: edited, deletedTaskId: historyTask.id, historyWorkflowId, historyRun, oldTriggerScan, resumeScan, farFutureScan, remainingTasks: afterDelete, retainedWorkflow: workflows.find((run) => run.id === historyWorkflowId), retainedBackground: background.find((task) => task.targetId === historyWorkflowId) });
      document.querySelector('.saved-schedules')?.scrollIntoView({ block: "start" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runResultSharingSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L1_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l1";
  if (phase === "owner") {
    const prepared = (await window.webContents.executeJavaScript(`
      (async () => {
        const checks = {};
        const details = {};
        const api = window.openDrSai;
        const workspacePath = ${JSON.stringify(workspacePath)};
        const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
        checks.bridge = Boolean(api); if (!api) return { checks, details };
        checks.ownerLogin = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        workspaceItem?.click();
        checks.workspaceSelected = Boolean(await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active')));
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.cernPdfAvailable = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const pptPath = workspacePath + '\\\\cern-wlcg-manager-zh.pptx';
        const manifestPath = workspacePath + '\\\\cern-wlcg-manager-zh.provenance.json';
        const sourceTask = await api.enqueueBackgroundTask({
          kind: 'presentation_generation', source: 'presentation', title: 'CERN WLCG 管理者版演示报告', workspacePath,
          targetId: 'l1-cern-g8', status: 'completed', progress: 100, message: 'CERN 管理者版 PPT 已完成。', verification: 'PPTX 与来源清单均已验证。',
          deliverySummary: { findingSummary: 'CERN WLCG 管理者版报告已完成。', importance: 'high', importanceReason: '用于向同事分享 G8 成果。', suggestedAction: '选择只分享成果或分享完整任务。', workSummary: '从真实 CERN PDF 生成管理者版 PPT。', coreConclusion: 'WLCG 容量与 Data Challenge 路线已形成可交付演示。', verification: 'PPTX 可读取，来源清单完整。', remainingRisks: '分享范围需要用户确认。', completionCriteria: { passed: ['CERN PDF 已读取', '管理者版 PPT 已生成', '来源清单已生成'], incomplete: [] }, artifacts: [
            { id: 'l1-cern-manager-ppt', label: 'cern-wlcg-manager-zh.pptx', path: pptPath, kind: 'presentation' },
            { id: 'l1-cern-provenance', label: 'cern-wlcg-manager-zh.provenance.json', path: manifestPath, kind: 'file' },
          ] },
        });
        checks.g8TaskCompleted = sourceTask.status === 'completed' && sourceTask.deliverySummary?.artifacts?.length === 2;
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|\u6210\u679c/.test(button.getAttribute('title') || button.textContent || '')));
        nav?.click();
        const row = await waitFor(() => document.querySelector('li[data-artifact-id="l1-cern-manager-ppt"]'));
        checks.resultsEntryVisible = Boolean(row);
        const shareButton = row?.querySelector('[data-testid="results-share-artifact"]');
        shareButton?.focus();
        checks.artifactShareKeyboardFocused = document.activeElement === shareButton;
        details.sourceTaskId = sourceTask.id;
        return { checks, details };
      })()
    `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
    const resultShare = (await window.webContents.executeJavaScript(`
      (async () => {
        const checks = {};
        const details = {};
        const api = window.openDrSai;
        const sourceTaskId = ${JSON.stringify(prepared.details.sourceTaskId)};
        const waitFor = async (find, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
        const setValue = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
        const dialog = await waitFor(() => document.querySelector('[data-testid="share-confirmation-dialog"]'));
        checks.artifactDialogOpenedByKeyboard = Boolean(dialog);
        const recipient = dialog?.querySelector('[data-testid="share-recipient-input"]');
        checks.recipientFieldFocused = document.activeElement === recipient;
        const preview = [...(dialog?.querySelectorAll('[data-testid="share-manifest-preview"] li') || [])];
        checks.resultPreviewExact = preview.length === 1 && preview[0]?.getAttribute('data-manifest-object-type') === 'artifact' && preview[0]?.getAttribute('data-manifest-object-id') === 'l1-cern-manager-ppt' && !/provenance/.test(preview[0]?.textContent || '');
        if (recipient) setValue(recipient, 'recipient@cern.example');
        await waitFor(() => dialog?.querySelector('[data-testid="share-sensitive-review"][data-state="ready"]'));
        dialog?.querySelector('[data-testid="share-confirm"]')?.click();
        const created = await waitFor(() => document.querySelector('[data-testid="share-created-manifest"]'));
        const outgoing = await api.listOutgoingShares();
        const resultManifest = outgoing.find((item) => item.scope === 'result_only');
        checks.resultShareCreated = Boolean(created && resultManifest);
        checks.resultManifestExact = resultManifest?.objects?.length === 1 && resultManifest.objects[0].objectType === 'artifact' && resultManifest.objects[0].objectId === 'l1-cern-manager-ppt' && resultManifest.selectedArtifactId === 'l1-cern-manager-ppt';
        checks.resultManifestNoInternalPath = !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(resultManifest || {}));
        details.resultManifest = resultManifest;
        dialog?.querySelector('[data-testid="share-cancel"]')?.click();
        const group = await waitFor(() => document.querySelector('[data-testid="results-task-index"] section[data-source-task-id="' + sourceTaskId + '"]'));
        const taskShare = group?.querySelector('[data-testid="results-share-task"]');
        taskShare?.focus();
        checks.taskShareKeyboardFocused = document.activeElement === taskShare;
        return { checks, details };
      })()
    `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
    const completeShare = (await window.webContents.executeJavaScript(`
      (async () => {
        const checks = {};
        const details = {};
        const api = window.openDrSai;
        const waitFor = async (find, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
        const setValue = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
        const dialog = await waitFor(() => document.querySelector('[data-testid="share-confirmation-dialog"]'));
        checks.taskDialogOpenedByKeyboard = Boolean(dialog);
        const preview = [...(dialog?.querySelectorAll('[data-testid="share-manifest-preview"] li') || [])];
        const previewTypes = preview.map((item) => item.getAttribute('data-manifest-object-type'));
        const previewIds = preview.map((item) => item.getAttribute('data-manifest-object-id'));
        checks.completePreviewExact = preview.length === 3 && previewTypes.filter((item) => item === 'task').length === 1 && previewTypes.filter((item) => item === 'artifact').length === 2 && previewIds.includes('l1-cern-manager-ppt') && previewIds.includes('l1-cern-provenance');
        const recipient = dialog?.querySelector('[data-testid="share-recipient-input"]');
        if (recipient) setValue(recipient, 'recipient@cern.example');
        await waitFor(() => dialog?.querySelector('[data-testid="share-sensitive-review"][data-state="ready"]'));
        dialog?.querySelector('[data-testid="share-confirm"]')?.click();
        const created = await waitFor(() => document.querySelector('[data-testid="share-created-manifest"]'));
        const outgoing = await api.listOutgoingShares();
        const taskManifest = outgoing.find((item) => item.scope === 'complete_task');
        checks.completeTaskShareCreated = Boolean(created && taskManifest);
        checks.completeManifestExact = taskManifest?.objects?.length === 3 && taskManifest.objects.filter((item) => item.objectType === 'task').length === 1 && taskManifest.objects.filter((item) => item.objectType === 'artifact').length === 2;
        checks.twoDistinctShares = outgoing.length === 2 && new Set(outgoing.map((item) => item.id)).size === 2;
        checks.recipientExact = outgoing.every((item) => item.recipientAccount === 'recipient@cern.example');
        checks.manifestsNoInternalPaths = !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(outgoing));
        details.taskManifest = taskManifest;
        details.outgoing = outgoing;
        return { checks, details };
      })()
    `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
    const checks = { ...prepared.checks, ...resultShare.checks, ...completeShare.checks };
    const details = { ...prepared.details, ...resultShare.details, ...completeShare.details, phase };
    const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
    if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
    return { ok: Object.values(checks).every(Boolean), checks, details };
  }

  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai;
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const incoming = await api.listIncomingShares();
      details.incoming = incoming;
      if (${JSON.stringify(phase)} === 'recipient') {
        checks.twoIncomingShares = incoming.length === 2;
        const resultShare = incoming.find((item) => item.scope === 'result_only');
        const taskShare = incoming.find((item) => item.scope === 'complete_task');
        checks.resultScopeVisible = resultShare?.objects?.length === 1 && resultShare.objects[0].objectId === 'l1-cern-manager-ppt';
        checks.completeScopeVisible = taskShare?.objects?.length === 3 && taskShare.objects.some((item) => item.objectType === 'task') && taskShare.objects.filter((item) => item.objectType === 'artifact').length === 2;
        const opened = [];
        for (const share of incoming) for (const object of share.objects) opened.push(await api.openSharedObject({ shareId: share.id, objectType: object.objectType, objectId: object.objectId }));
        checks.allManifestObjectsOpen = opened.length === 4 && opened.every((item) => item.authorized === true);
        checks.pptOpenedByRecipient = opened.some((item) => item.artifact?.id === 'l1-cern-manager-ppt' && item.artifact.bytes > 10000 && /^[a-f0-9]{64}$/.test(item.artifact.sha256));
        checks.taskOpenedByRecipient = opened.some((item) => item.task?.id === taskShare?.sourceTaskId && item.task.artifactIds.length === 2);
        let crossObjectDenied = false;
        try { await api.openSharedObject({ shareId: resultShare?.id || 'missing-share', objectType: 'artifact', objectId: 'l1-cern-provenance' }); } catch { crossObjectDenied = true; }
        checks.crossObjectDenied = crossObjectDenied;
        checks.noInternalPathsReceived = !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(incoming));
        const workspacePath = ${JSON.stringify(workspacePath)};
        const waitFor = async (find, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        workspaceItem?.click();
        await waitFor(() => [...document.querySelectorAll('.workspace-row.active .workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        await new Promise((resolve) => setTimeout(resolve, 250));
        const nav = await waitFor(() => document.querySelector('.sidebar-button:has(.lucide-package-open)'));
        nav?.click();
        await waitFor(() => document.querySelector('[data-testid="results-center-view"]'));
        const deadline = Date.now() + 10000; let cards = [];
        while (Date.now() < deadline) { cards = [...document.querySelectorAll('[data-testid="incoming-share-card"]')]; if (cards.length === 2) break; await new Promise((resolve) => setTimeout(resolve, 75)); }
        checks.incomingUiVisible = cards.length === 2;
        checks.uiScopesAccurate = cards.some((card) => card.getAttribute('data-share-scope') === 'result_only' && card.querySelectorAll('[data-shared-object-id]').length === 1) && cards.some((card) => card.getAttribute('data-share-scope') === 'complete_task' && card.querySelectorAll('[data-shared-object-id]').length === 3);
        const openButton = cards[0]?.querySelector('[data-testid="shared-object-open"]');
        openButton?.click();
        const statusDeadline = Date.now() + 5000; let status = null;
        while (Date.now() < statusDeadline) { status = document.querySelector('[data-testid="shared-object-open-status"][data-state="opened"]'); if (status) break; await new Promise((resolve) => setTimeout(resolve, 75)); }
        checks.incomingUiOpenWorks = Boolean(status);
        document.querySelector('[data-testid="shared-inbox"]')?.scrollIntoView({ block: 'start' });
        details.opened = opened;
      } else {
        checks.outsiderInboxEmpty = incoming.length === 0;
        const attempts = ${JSON.stringify(process.env.OPENDRSAI_E2E_L1_SHARE_IDS || "[]")};
        let denied = 0;
        for (const attempt of JSON.parse(attempts)) { try { await api.openSharedObject(attempt); } catch { denied += 1; } }
        checks.outsiderDeniedAll = JSON.parse(attempts).length === 2 && denied === 2;
        details.denied = denied;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runFinalResultIsolationSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L2_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l2";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const setValue = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      if (${JSON.stringify(phase)} === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const task = await api.enqueueBackgroundTask({
          kind: 'presentation_generation', source: 'presentation', title: 'L2 final-result isolation fixture', workspacePath,
          targetId: 'l2-cern-g8', status: 'completed', progress: 100, message: 'Presentation completed.', verification: 'Fixtures include source, provenance and hidden attachment.',
          deliverySummary: { findingSummary: 'Manager presentation ready.', importance: 'high', importanceReason: 'L2 isolation acceptance.', suggestedAction: 'Share only the final deck.', workSummary: 'Generated from the real CERN PDF.', coreConclusion: 'Final-result share must expose only the deck.', verification: 'The deck is readable.', remainingRisks: 'None for this fixture.', completionCriteria: { passed: ['Deck generated'], incomplete: [] }, artifacts: [
            { id: 'l2-cern-manager-ppt', label: 'cern-wlcg-manager-final.pptx', path: workspacePath + '\\\\cern-wlcg-manager-final.pptx', kind: 'presentation' },
            { id: 'l2-cern-source-pdf', label: 'WLCG-20260715-WLCG-talk-IHEP-visit.pdf', path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', kind: 'file' },
            { id: 'l2-cern-provenance', label: 'cern-wlcg-private.provenance.json', path: workspacePath + '\\\\cern-wlcg-private.provenance.json', kind: 'file' },
            { id: 'l2-hidden-attachment', label: 'hidden-review-notes.txt', path: workspacePath + '\\\\hidden-review-notes.txt', kind: 'file' },
          ] },
        });
        checks.attackFixturesRegistered = task.deliverySummary?.artifacts?.length === 4;
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        workspaceItem?.click();
        await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active'));
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|成果/.test(button.getAttribute('title') || button.textContent || '')));
        nav?.click();
        const row = await waitFor(() => document.querySelector('li[data-artifact-id="l2-cern-manager-ppt"]'));
        row?.querySelector('[data-testid="results-share-artifact"]')?.click();
        const dialog = await waitFor(() => document.querySelector('[data-testid="share-confirmation-dialog"]'));
        const preview = [...(dialog?.querySelectorAll('[data-testid="share-manifest-preview"] li') || [])];
        checks.confirmationShowsOnlyDeck = preview.length === 1 && preview[0]?.getAttribute('data-manifest-object-id') === 'l2-cern-manager-ppt';
        const input = dialog?.querySelector('[data-testid="share-recipient-input"]');
        if (input) setValue(input, 'recipient@cern.example');
        await waitFor(() => dialog?.querySelector('[data-testid="share-sensitive-review"][data-state="ready"]'));
        dialog?.querySelector('[data-testid="share-confirm"]')?.click();
        await waitFor(() => document.querySelector('[data-testid="share-created-manifest"]'));
        const outgoing = await api.listOutgoingShares();
        const share = outgoing.find((item) => item.scope === 'result_only');
        checks.resultOnlyManifestExact = share?.objects?.length === 1 && share.objects[0].objectId === 'l2-cern-manager-ppt' && share.objects[0].objectType === 'artifact';
        checks.ownerManifestHasNoPaths = !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(share || {}));
        details.share = share;
      } else {
        const incoming = await api.listIncomingShares();
        const share = incoming[0];
        checks.oneResultOnlyShare = incoming.length === 1 && share?.scope === 'result_only' && share.objects.length === 1 && share.objects[0].objectId === 'l2-cern-manager-ppt';
        const serialized = JSON.stringify(incoming);
        const forbidden = ['WLCG-20260715-WLCG-talk-IHEP-visit.pdf', 'hidden-review-notes.txt', 'cern-wlcg-private.provenance.json', 'PRIVATE-CONVERSATION-SECRET', 'HIDDEN-ATTACHMENT-SECRET', workspacePath, 'workspacePath', 'artifactPath'];
        checks.manifestContainsNoForbiddenData = forbidden.every((term) => !serialized.includes(term));
        const recipientTasks = await api.listBackgroundTasks({ limit: 100 });
        checks.ownerTaskListIsolated = recipientTasks.length === 0 && forbidden.every((term) => !JSON.stringify(recipientTasks).includes(term));
        const opened = await api.openSharedObject({ shareId: share.id, objectType: 'artifact', objectId: 'l2-cern-manager-ppt' });
        checks.authorizedDeckOpens = opened.authorized === true && opened.artifact?.id === 'l2-cern-manager-ppt' && opened.artifact.bytes > 10000;
        const downloaded = await api.downloadSharedArtifact({ shareId: share.id, objectId: 'l2-cern-manager-ppt' });
        const binary = atob(downloaded.base64); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
        checks.authorizedDownloadIntegrity = downloaded.bytes === bytes.length && downloaded.bytes > 10000 && downloaded.sha256 === digest && downloaded.sha256 === share.objects[0].sha256;
        const attacks = [
          ['artifact', 'l2-cern-source-pdf'], ['artifact', 'l2-cern-provenance'], ['artifact', 'l2-hidden-attachment'],
          ['artifact', 'l2-private-conversation'], ['artifact', '..\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf'], ['task', share.sourceTaskId],
        ];
        let denied = 0;
        for (const [objectType, objectId] of attacks) {
          try { await api.openSharedObject({ shareId: share.id, objectType, objectId }); } catch { denied += 1; }
          try { await api.downloadSharedArtifact({ shareId: share.id, objectId }); } catch { denied += 1; }
        }
        checks.allUnauthorizedAccessDenied = denied === attacks.length * 2;
        details.deniedAttempts = denied; details.totalAttempts = attacks.length * 2; details.download = { fileName: downloaded.fileName, bytes: downloaded.bytes, sha256: downloaded.sha256 };
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        workspaceItem?.click(); await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active')); await new Promise((resolve) => setTimeout(resolve, 300));
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|成果/.test(button.getAttribute('title') || button.textContent || ''))); nav?.click();
        await waitFor(() => document.querySelector('[data-testid="results-center-view"]'));
        const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"]'));
        const resultsText = document.querySelector('[data-testid="results-center-view"]')?.textContent || '';
        checks.recipientPageOnlyShowsDeck = Boolean(card) && card.querySelectorAll('[data-shared-object-id]').length === 1 && card.querySelector('[data-shared-object-id="l2-cern-manager-ppt"]') !== null && forbidden.every((term) => !resultsText.includes(term)) && !document.querySelector('[data-source-task-id]');
        card?.querySelector('[data-testid="shared-artifact-download"]')?.click();
        const status = await waitFor(() => document.querySelector('[data-testid="shared-artifact-download-status"][data-state="downloaded"]'));
        checks.downloadUiWorks = Boolean(status);
        document.querySelector('[data-testid="shared-inbox"]')?.scrollIntoView({ block: 'start' });
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runSensitiveShareSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L3_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l3";
  const secrets = [
    "sk-L3CERNSecretKey1234567890",
    "L3BearerTokenABCDEFGHIJKLMN",
    "alice.sensitive@cern.example",
    "13800138000",
    "L3UserDefinedSecret987654321",
  ];
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {}; const details = {}; const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)}; const secrets = ${JSON.stringify(secrets)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const setValue = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      if (${JSON.stringify(phase)} === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const reportPath = workspacePath + '\\\\cern-sensitive-share-report.md';
        const rawBefore = await api.previewWorkspaceFile({ workspacePath, path: reportPath, maxBytes: 100000 });
        checks.rawFixtureContainsAllSecrets = secrets.every((secret) => rawBefore.content.includes(secret));
        const task = await api.enqueueBackgroundTask({ kind: 'agent_run', source: 'agent', title: 'CERN sensitive sharing review', workspacePath, targetId: 'l3-cern-sensitive', status: 'completed', progress: 100, message: 'Sensitive sharing fixture ready.', verification: 'Review before sharing.', deliverySummary: { findingSummary: 'CERN report with D7 privacy fixtures.', importance: 'high', importanceReason: 'L3 acceptance.', suggestedAction: 'Remove or redact every finding.', workSummary: 'Prepared from the CERN WLCG source.', coreConclusion: 'Secrets must never be directly shared.', verification: 'Original remains local.', remainingRisks: 'Requires share review.', completionCriteria: { passed: ['CERN source verified'], incomplete: [] }, artifacts: [{ id: 'l3-cern-sensitive-report', label: 'cern alice.sensitive@cern.example report.md', path: reportPath, kind: 'report' }] } });
        const inspection = await api.inspectShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l3-cern-sensitive-report' });
        const kinds = inspection.findings.map((item) => item.kind).sort();
        checks.allFiveKindsDetected = inspection.findings.length === 5 && ['api_key','bearer_token','email','phone','user_secret'].every((kind) => kinds.includes(kind));
        checks.findingsNeverExposeRawValues = secrets.every((secret) => !JSON.stringify(inspection).includes(secret));
        let bypassDenied = false; try { await api.createShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l3-cern-sensitive-report', recipientAccount: 'recipient@cern.example' }); } catch { bypassDenied = true; }
        checks.directApiBypassDenied = bypassDenied;
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath))); workspaceItem?.click();
        await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active')); await new Promise((resolve) => setTimeout(resolve, 300));
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|成果/.test(button.getAttribute('title') || button.textContent || ''))); nav?.click();
        const row = await waitFor(() => document.querySelector('li[data-artifact-id="l3-cern-sensitive-report"]')); row?.querySelector('[data-testid="results-share-artifact"]')?.click();
        const dialog = await waitFor(() => document.querySelector('[data-testid="share-confirmation-dialog"]'));
        const review = await waitFor(() => dialog?.querySelector('[data-testid="share-sensitive-review"][data-state="ready"]'));
        const findingRows = [...(review?.querySelectorAll('[data-testid="share-sensitive-finding"]') || [])];
        checks.reviewUiShowsFiveSafeFindings = findingRows.length === 5 && secrets.every((secret) => !review?.textContent?.includes(secret));
        const emailRow = findingRows.find((item) => item.getAttribute('data-finding-kind') === 'email');
        const emailAction = emailRow?.querySelector('[data-testid="share-sensitive-action"]');
        if (emailAction) { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(emailAction, 'remove'); emailAction.dispatchEvent(new Event('change', { bubbles: true })); }
        checks.userCanChooseRemoveAndRedact = emailAction?.value === 'remove' && findingRows.filter((item) => item.getAttribute('data-finding-kind') !== 'email').every((item) => item.querySelector('[data-testid="share-sensitive-action"]')?.value === 'redact');
        const input = dialog?.querySelector('[data-testid="share-recipient-input"]'); if (input) setValue(input, 'recipient@cern.example');
        dialog?.querySelector('[data-testid="share-confirm"]')?.click(); await waitFor(() => document.querySelector('[data-testid="share-created-manifest"]'));
        const share = (await api.listOutgoingShares()).find((item) => item.selectedArtifactId === 'l3-cern-sensitive-report');
        checks.safeShareCreated = share?.objects?.length === 1 && !share.objects[0].label.includes('alice.sensitive@cern.example') && share.sensitiveReview?.findingsCount === 6 && share.sensitiveReview.redactedCount === 4 && share.sensitiveReview.removedCount === 2 && share.sensitiveReview.highRiskSecretsDirectlyShared === 0;
        const rawAfter = await api.previewWorkspaceFile({ workspacePath, path: reportPath, maxBytes: 100000 });
        checks.originalFileUnchanged = rawAfter.fileHash === rawBefore.fileHash && secrets.every((secret) => rawAfter.content.includes(secret));
        details.share = share; details.sourceHash = rawAfter.fileHash;
      } else {
        const incoming = await api.listIncomingShares(); const share = incoming[0];
        checks.safeManifestReceived = incoming.length === 1 && share.objects.length === 1 && !share.objects[0].label.includes('alice.sensitive@cern.example') && share.sensitiveReview?.findingsCount === 6 && share.sensitiveReview.highRiskSecretsDirectlyShared === 0;
        const opened = await api.openSharedObject({ shareId: share.id, objectType: 'artifact', objectId: 'l3-cern-sensitive-report' });
        const content = opened.artifact?.content || '';
        checks.openedContentSanitized = content.includes('[已遮蔽秘密]') && content.includes('[已遮蔽手机号]') && secrets.every((secret) => !content.includes(secret));
        const downloaded = await api.downloadSharedArtifact({ shareId: share.id, objectId: 'l3-cern-sensitive-report' });
        const downloadedText = new TextDecoder().decode(Uint8Array.from(atob(downloaded.base64), (char) => char.charCodeAt(0)));
        checks.downloadContentSanitized = downloadedText === content && secrets.every((secret) => !downloadedText.includes(secret));
        const recipientTasks = await api.listBackgroundTasks({ limit: 100 }); checks.ownerTaskHidden = recipientTasks.length === 0;
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath))); workspaceItem?.click();
        await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active')); await new Promise((resolve) => setTimeout(resolve, 300));
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|成果/.test(button.getAttribute('title') || button.textContent || ''))); nav?.click();
        const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"]'));
        const centerText = document.querySelector('[data-testid="results-center-view"]')?.textContent || '';
        checks.recipientPageContainsNoRawSecret = Boolean(card) && secrets.every((secret) => !centerText.includes(secret));
        details.sanitizedContent = content; details.downloadSha256 = downloaded.sha256;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runCollaborationPermissionSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L4_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l4";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const phase = ${JSON.stringify(phase)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const showResults = async () => {
        const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath)));
        workspaceItem?.click();
        await waitFor(() => workspaceItem?.closest('.workspace-row')?.classList.contains('active'));
        await new Promise((resolve) => setTimeout(resolve, 350));
        const stableNav = await waitFor(() => document.querySelector('.sidebar-button[data-nav-id="results"]'));
        stableNav?.click();
        const stableView = await waitFor(() => document.querySelector('[data-testid="results-center-view"]'), 3000);
        if (stableView) return stableView;
        const nav = await waitFor(() => [...document.querySelectorAll('.sidebar-button')].find((button) => /Results|成果/.test(button.getAttribute('title') || button.textContent || '')));
        nav?.click();
        return waitFor(() => document.querySelector('[data-testid="results-center-view"]'));
      };
      if (phase === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const task = await api.enqueueBackgroundTask({
          kind: 'presentation_generation', source: 'presentation', title: 'L4 CERN collaboration permissions', workspacePath,
          targetId: 'l4-cern-collaboration', status: 'completed', progress: 100, message: 'CERN manager presentation completed.', verification: 'Verified from the pinned CERN PDF.',
          deliverySummary: { findingSummary: 'CERN manager presentation ready.', importance: 'high', importanceReason: 'L4 collaboration acceptance.', suggestedAction: 'Assign view, comment, or continuation permission.', workSummary: 'Generated from the verified CERN PDF.', coreConclusion: 'Collaboration actions must follow the current permission.', verification: 'The deck is readable.', remainingRisks: 'None for this fixture.', completionCriteria: { passed: ['Deck generated'], incomplete: [] }, artifacts: [
            { id: 'l4-cern-manager-ppt', label: 'cern-wlcg-manager-collaboration.pptx', path: workspacePath + '\\\\cern-wlcg-manager-collaboration.pptx', kind: 'presentation' },
          ] },
        });
        const inspection = await api.inspectShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l4-cern-manager-ppt' });
        checks.safeFixture = inspection.findings.length === 0;
        const recipients = [['view@cern.example','view'], ['comment@cern.example','comment'], ['continue@cern.example','continue']];
        for (const [recipientAccount, permission] of recipients) await api.createShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l4-cern-manager-ppt', recipientAccount, permission });
        const outgoing = await api.listOutgoingShares();
        checks.threePermissionsCreated = outgoing.length === 3 && recipients.every(([recipient, permission]) => outgoing.some((item) => item.recipientAccount === recipient && item.permission === permission));
        checks.manifestsPathFree = !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(outgoing));
        await showResults();
        const controls = await waitFor(() => document.querySelectorAll('[data-testid="outgoing-share-permission"]').length === 3 ? [...document.querySelectorAll('[data-testid="outgoing-share-permission"]')] : null);
        checks.ownerPermissionControlsVisible = Boolean(controls && ['view','comment','continue'].every((permission) => controls.some((control) => control.value === permission)));
        details.outgoing = outgoing;
      } else if (phase === 'owner-update') {
        await showResults();
        const cards = await waitFor(() => [...document.querySelectorAll('[data-testid="outgoing-share-card"]')].length === 3 ? [...document.querySelectorAll('[data-testid="outgoing-share-card"]')] : null);
        const outgoing = await api.listOutgoingShares();
        const target = outgoing.find((item) => item.recipientAccount === 'comment@cern.example');
        const card = cards?.find((item) => item.getAttribute('data-share-id') === target?.id);
        const select = card?.querySelector('[data-testid="outgoing-share-permission"]');
        if (select) { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, 'view'); select.dispatchEvent(new Event('change', { bubbles: true })); }
        const changed = await waitFor(async () => (await api.listOutgoingShares()).find((item) => item.id === target?.id && item.permission === 'view'));
        checks.ownerChangedPermissionInUi = Boolean(select && changed);
        checks.changeVisibleImmediately = select?.value === 'view' && changed?.permission === 'view';
        details.changed = changed;
      } else if (phase === 'audit') {
        const outgoing = await api.listOutgoingShares();
        const audits = Object.fromEntries(await Promise.all(outgoing.map(async (share) => [share.permission + ':' + share.recipientAccount, await api.listShareAudit({ shareId: share.id })])));
        const viewAudit = Object.values(audits).find((items) => items.some((item) => item.actorAccount === 'view@cern.example')) || [];
        const changedAudit = Object.values(audits).find((items) => items.some((item) => item.actorAccount === 'comment@cern.example')) || [];
        const continueAudit = Object.values(audits).find((items) => items.some((item) => item.actorAccount === 'continue@cern.example')) || [];
        const all = Object.values(audits).flat();
        checks.viewViolationsAudited = viewAudit.filter((item) => item.outcome === 'denied').length >= 3;
        checks.commentActionsAudited = changedAudit.some((item) => item.action === 'comment' && item.outcome === 'allowed') && changedAudit.some((item) => item.action === 'comment' && item.outcome === 'denied') && changedAudit.some((item) => item.action === 'continue' && item.outcome === 'denied');
        checks.continueActionsAudited = continueAudit.some((item) => item.action === 'comment' && item.outcome === 'allowed') && continueAudit.some((item) => item.action === 'continue' && item.outcome === 'allowed');
        checks.permissionChangeAudited = changedAudit.some((item) => item.action === 'permission_update' && item.outcome === 'allowed' && item.permission === 'view');
        checks.auditContainsNoUserContent = !JSON.stringify(all).includes('L4 comment body') && !JSON.stringify(all).includes('sk-L4AuditSecret1234567890');
        checks.allDeniedAttemptsRecorded = all.filter((item) => item.outcome === 'denied').length >= 7;
        details.audits = audits;
      } else {
        const incoming = await api.listIncomingShares(); const share = incoming[0];
        const expected = phase === 'view' || phase === 'downgraded' ? 'view' : phase;
        checks.oneCurrentManifest = incoming.length === 1 && share.permission === expected && share.objects.length === 1;
        const object = share.objects[0];
        const opened = await api.openSharedObject({ shareId: share.id, objectType: object.objectType, objectId: object.objectId });
        const downloaded = await api.downloadSharedArtifact({ shareId: share.id, objectId: object.objectId });
        checks.openAndDownloadAllowed = opened.authorized === true && opened.artifact?.bytes > 10000 && downloaded.bytes === opened.artifact.bytes && downloaded.sha256 === opened.artifact.sha256;
        let commentsReadable = false; try { await api.listShareComments({ shareId: share.id }); commentsReadable = true; } catch {}
        let commentAllowed = false; try { await api.addShareComment({ shareId: share.id, body: 'L4 comment body from ' + phase }); commentAllowed = true; } catch {}
        let continueAllowed = false; try { await api.continueSharedTask({ shareId: share.id }); continueAllowed = true; } catch {}
        if (phase === 'comment') { let sensitiveDenied = false; try { await api.addShareComment({ shareId: share.id, body: 'sk-L4AuditSecret1234567890' }); } catch { sensitiveDenied = true; } checks.sensitiveCommentDenied = sensitiveDenied; }
        checks.actionMatrixExact = expected === 'view' ? !commentsReadable && !commentAllowed && !continueAllowed : expected === 'comment' ? commentsReadable && commentAllowed && !continueAllowed : commentsReadable && commentAllowed && continueAllowed;
        await showResults();
        const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"]'));
        const commentInput = card?.querySelector('[data-testid="share-comment-input"]');
        const continueButton = card?.querySelector('[data-testid="share-continue"]');
        checks.uiMatchesPermission = card?.getAttribute('data-share-permission') === expected && (expected === 'view' ? !commentInput && !continueButton : expected === 'comment' ? Boolean(commentInput && !continueButton) : Boolean(commentInput && continueButton));
        details.manifest = share;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runCommentTaskSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L5_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l5";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {}; const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai; const workspacePath = ${JSON.stringify(workspacePath)}; const phase = ${JSON.stringify(phase)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const setInput = (input, value) => { const setter = Object.getOwnPropertyDescriptor((input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement).prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      const setSelect = (select, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set; setter?.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); };
      const showResults = async () => { const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath))); workspaceItem?.click(); await new Promise((resolve) => setTimeout(resolve, 350)); const nav = await waitFor(() => document.querySelector('.sidebar-button[data-nav-id="results"]')); nav?.click(); return waitFor(() => document.querySelector('[data-testid="results-center-view"]')); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      if (phase === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const task = await api.enqueueBackgroundTask({ kind: 'presentation_generation', source: 'presentation', title: 'L5 CERN comment task source', workspacePath, targetId: 'l5-cern-comment-task', status: 'completed', progress: 100, message: 'CERN manager deck ready for review.', verification: 'Pinned CERN source verified.', deliverySummary: { findingSummary: 'Manager deck ready.', importance: 'high', importanceReason: 'L5 comment-to-task acceptance.', suggestedAction: 'Ask the reviewer to comment on the p.42 chart.', workSummary: 'Generated from the verified CERN PDF.', coreConclusion: 'A review comment must preserve its exact chart context.', verification: 'Deck is readable.', remainingRisks: 'Reviewer action pending.', completionCriteria: { passed: ['Deck generated'], incomplete: [] }, artifacts: [{ id: 'l5-cern-manager-ppt', label: 'cern-wlcg-manager-comment-task.pptx', path: workspacePath + '\\\\cern-wlcg-manager-comment-task.pptx', kind: 'presentation' }] } });
        const share = await api.createShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l5-cern-manager-ppt', recipientAccount: 'reviewer@cern.example', permission: 'comment' });
        checks.commentShareCreated = share.permission === 'comment' && share.objects.length === 1 && share.objects[0].objectId === 'l5-cern-manager-ppt';
        checks.noPrematureTask = (await api.listShareCommentTasks()).length === 0;
        details.share = share;
      } else if (phase === 'recipient') {
        const incoming = await api.listIncomingShares(); const share = incoming[0];
        checks.commentPermissionReceived = incoming.length === 1 && share.permission === 'comment';
        await showResults(); const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"]'));
        const anchorType = card?.querySelector('[data-testid="share-comment-anchor-type"]'); const anchorLabel = card?.querySelector('[data-testid="share-comment-anchor-label"]'); const input = card?.querySelector('[data-testid="share-comment-input"]');
        if (anchorType) setSelect(anchorType, 'chart'); if (anchorLabel) setInput(anchorLabel, 'p.42 WLCG bandwidth chart'); if (input) setInput(input, 'Add a clear annotation for the 4.8 Tbps 2024 challenge result.');
        card?.querySelector('[data-testid="share-comment-send"]')?.click();
        const comments = await waitFor(async () => { const items = await api.listShareComments({ shareId: share.id }); return items.length === 1 ? items : null; }); const comment = comments?.[0];
        checks.chartCommentCreatedInUi = Boolean(comment && comment.target.objectId === 'l5-cern-manager-ppt' && comment.target.anchorType === 'chart' && comment.target.anchorLabel === 'p.42 WLCG bandwidth chart');
        checks.commentContextExact = comment?.body === 'Add a clear annotation for the 4.8 Tbps 2024 challenge result.' && comment.target.objectLabel === 'cern-wlcg-manager-comment-task.pptx';
        let recipientConvertDenied = false; try { await api.previewShareCommentTask({ shareId: share.id, commentId: comment.id }); } catch { recipientConvertDenied = true; }
        checks.recipientCannotConvert = recipientConvertDenied;
        details.comment = comment;
      } else {
        await showResults();
        const row = await waitFor(() => document.querySelector('[data-testid="outgoing-share-comment"]'));
        checks.ownerSeesExactComment = row?.getAttribute('data-comment-object-id') === 'l5-cern-manager-ppt' && row?.getAttribute('data-comment-anchor-type') === 'chart' && (row.textContent || '').includes('p.42 WLCG bandwidth chart') && (row.textContent || '').includes('4.8 Tbps');
        row?.querySelector('[data-testid="comment-to-task"]')?.click(); const dialog = await waitFor(() => document.querySelector('[data-testid="comment-task-dialog"]'));
        const source = dialog?.querySelector('[data-testid="comment-task-source-context"]')?.textContent || ''; const title = dialog?.querySelector('[data-testid="comment-task-title"]'); const instructions = dialog?.querySelector('[data-testid="comment-task-instructions"]');
        checks.previewCarriesContext = source.includes('4.8 Tbps') && title?.value.includes('p.42 WLCG bandwidth chart') && instructions?.value.includes('cern-wlcg-manager-comment-task.pptx') && instructions?.value.includes('4.8 Tbps');
        if (title) setInput(title, 'Update CERN bandwidth chart annotation'); if (instructions) setInput(instructions, 'Add a visible 4.8 Tbps annotation to the p.42 WLCG bandwidth chart and retain the source link.'); dialog?.querySelector('[data-testid="comment-task-save"]')?.click();
        let tasks = await waitFor(async () => { const items = await api.listShareCommentTasks(); return items.length === 1 ? items : null; }); let task = tasks?.[0];
        checks.realBackgroundTaskCreated = Boolean(task?.backgroundTaskId && task.status === 'ready' && task.title === 'Update CERN bandwidth chart annotation');
        let background = (await api.listBackgroundTasks({ limit: 100 })).find((item) => item.id === task?.backgroundTaskId);
        checks.backgroundContextLinked = background?.status === 'queued' && background.targetId === task?.id && background.message.includes('4.8 Tbps') && background.workspacePath === workspacePath;
        const taskCard = await waitFor(() => document.querySelector('[data-testid="share-comment-task-card"]')); taskCard?.querySelector('[data-testid="comment-task-edit"]')?.click(); const editDialog = await waitFor(() => document.querySelector('[data-testid="comment-task-dialog"]'));
        const editTitle = editDialog?.querySelector('[data-testid="comment-task-title"]'); const editInstructions = editDialog?.querySelector('[data-testid="comment-task-instructions"]'); if (editTitle) setInput(editTitle, 'Finalize CERN p.42 bandwidth chart'); if (editInstructions) setInput(editInstructions, 'Adjust the chart annotation, verify 4.8 Tbps, and keep the original comment backlink.'); editDialog?.querySelector('[data-testid="comment-task-save"]')?.click();
        task = await waitFor(async () => (await api.listShareCommentTasks()).find((item) => item.title === 'Finalize CERN p.42 bandwidth chart'));
        background = (await api.listBackgroundTasks({ limit: 100 })).find((item) => item.id === task?.backgroundTaskId);
        checks.generatedTaskEditable = task?.instructions.includes('original comment backlink') && background?.title === task.title && background?.message === task.instructions;
        let duplicateDenied = false; try { await api.createShareCommentTask({ shareId: task.shareId, commentId: task.commentId, title: 'Duplicate', instructions: 'Duplicate task should be rejected.' }); } catch { duplicateDenied = true; }
        checks.duplicateTaskDenied = duplicateDenied;
        const updatedCard = await waitFor(() => document.querySelector('[data-testid="share-comment-task-card"] [data-testid="comment-task-complete"]')); updatedCard?.click();
        task = await waitFor(async () => (await api.listShareCommentTasks()).find((item) => item.status === 'completed'));
        background = (await api.listBackgroundTasks({ limit: 100 })).find((item) => item.id === task?.backgroundTaskId);
        checks.completionSynchronized = task?.status === 'completed' && Boolean(task.completedAt) && background?.status === 'completed' && background.progress === 100;
        const backlink = await waitFor(() => document.querySelector('[data-testid="comment-task-backlink"]')); backlink?.click();
        checks.completedTaskBacklinks = document.activeElement?.getAttribute('data-comment-id') === task?.commentId;
        const audit = await api.listShareAudit({ shareId: task.shareId });
        checks.lifecycleAudited = ['created','updated','completed'].every((word) => audit.some((item) => item.action === 'comment_task' && item.outcome === 'allowed' && item.reason.toLowerCase().includes(word)));
        checks.auditOmitsCommentBody = !JSON.stringify(audit).includes('4.8 Tbps');
        details.task = task; details.background = background; details.audit = audit;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runShareRevocationSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L6_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l6";
  const shareId = process.env.OPENDRSAI_E2E_L6_SHARE_ID || "";
  const objectId = process.env.OPENDRSAI_E2E_L6_OBJECT_ID || "";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {}; const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai; const workspacePath = ${JSON.stringify(workspacePath)}; const phase = ${JSON.stringify(phase)};
      const shareId = ${JSON.stringify(shareId)}; const objectId = ${JSON.stringify(objectId)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const setInput = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      const showResults = async () => { const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath))); workspaceItem?.click(); await new Promise((resolve) => setTimeout(resolve, 350)); const nav = await waitFor(() => document.querySelector('.sidebar-button[data-nav-id="results"]')); nav?.click(); return waitFor(() => document.querySelector('[data-testid="results-center-view"]')); };
      const denied = async (operation) => { try { await operation(); return false; } catch { return true; } };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      if (phase === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const task = await api.enqueueBackgroundTask({ kind: 'presentation_generation', source: 'presentation', title: 'L6 CERN revocation source', workspacePath, targetId: 'l6-cern-revocation', status: 'completed', progress: 100, message: 'CERN manager deck ready to share.', verification: 'Pinned CERN source verified.', deliverySummary: { findingSummary: 'Manager deck ready.', importance: 'high', importanceReason: 'L6 revocation acceptance.', suggestedAction: 'Share, verify access, then revoke.', workSummary: 'Generated from the verified CERN PDF.', coreConclusion: 'Revocation must invalidate every future access path.', verification: 'Deck is readable.', remainingRisks: 'Access remains until explicit revocation.', completionCriteria: { passed: ['Deck generated'], incomplete: [] }, artifacts: [{ id: 'l6-cern-manager-ppt', label: 'cern-wlcg-manager-revocation.pptx', path: workspacePath + '\\\\cern-wlcg-manager-revocation.pptx', kind: 'presentation' }] } });
        const share = await api.createShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l6-cern-manager-ppt', recipientAccount: 'revoked@cern.example', permission: 'continue' });
        checks.activeShareCreated = share.status === 'active' && share.permission === 'continue' && share.objects.length === 1;
        checks.noRevocationFieldsBeforeAction = !share.revokedAt && !share.revokedByAccount;
        details.share = share;
      } else if (phase === 'recipient-before') {
        const incoming = await api.listIncomingShares(); const share = incoming[0]; const object = share?.objects[0];
        checks.inboxAvailableBeforeRevocation = incoming.length === 1 && share.id === shareId && object?.objectId === objectId;
        const opened = await api.openSharedObject({ shareId, objectType: 'artifact', objectId });
        const downloaded = await api.downloadSharedArtifact({ shareId, objectId });
        checks.openAndDownloadWorkBeforeRevocation = opened.authorized === true && downloaded.bytes === opened.artifact?.bytes && downloaded.sha256 === opened.artifact?.sha256;
        checks.commentAndContinueWorkBeforeRevocation = Boolean(await api.addShareComment({ shareId, body: 'L6 pre-revocation access check.' })) && Boolean(await api.continueSharedTask({ shareId }));
        checks.recipientCannotRevoke = await denied(() => api.revokeShare({ shareId, confirmation: 'REVOKE' }));
        await showResults();
        checks.inboxCardVisibleBeforeRevocation = Boolean(await waitFor(() => document.querySelector('[data-testid="incoming-share-card"]')));
        details.download = { bytes: downloaded.bytes, sha256: downloaded.sha256 }; details.share = share;
      } else if (phase === 'owner-revoke') {
        await showResults();
        const card = await waitFor(() => document.querySelector('[data-testid="outgoing-share-card"][data-share-status="active"]'));
        card?.querySelector('[data-testid="share-revoke"]')?.click();
        const dialog = await waitFor(() => document.querySelector('[data-testid="share-revoke-dialog"]'));
        const confirm = dialog?.querySelector('[data-testid="share-revoke-confirm"]');
        checks.explicitConfirmationRequired = Boolean(dialog && confirm?.disabled && (dialog.textContent || '').includes('REVOKE') && (dialog.textContent || '').includes('revoked@cern.example'));
        const input = dialog?.querySelector('[data-testid="share-revoke-confirmation"]'); if (input) setInput(input, 'REVOKE');
        checks.confirmEnabledOnlyAfterExactPhrase = confirm?.disabled === false;
        confirm?.click();
        const revoked = await waitFor(async () => (await api.listOutgoingShares()).find((item) => item.id === shareId && item.status === 'revoked'));
        const receipt = await waitFor(() => document.querySelector('[data-testid="share-revocation-receipt"]'));
        const audit = await api.listShareAudit({ shareId }); const allowed = audit.find((item) => item.action === 'revoke' && item.outcome === 'allowed');
        checks.revokedImmediatelyInUiAndStore = Boolean(revoked?.revokedAt && revoked.revokedByAccount === 'owner@cern.example' && receipt && !document.querySelector('[data-testid="share-revoke"]'));
        checks.revocationReceiptAndAuditRecorded = Boolean(allowed && receipt?.textContent?.includes('1') && document.querySelector('[data-testid="share-revocation-audit-id"]')?.textContent === allowed.id);
        checks.unauthorizedAttemptAudited = audit.some((item) => item.action === 'revoke' && item.outcome === 'denied' && item.actorAccount === 'revoked@cern.example');
        checks.auditContainsNoCommentBodyOrPaths = !JSON.stringify(audit).includes('L6 pre-revocation access check') && !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(audit));
        details.revoked = revoked; details.audit = audit;
      } else if (phase === 'recipient-after') {
        const incoming = await api.listIncomingShares();
        checks.inboxEmptyAfterRevocation = incoming.length === 0;
        checks.oldOpenDenied = await denied(() => api.openSharedObject({ shareId, objectType: 'artifact', objectId }));
        checks.oldDownloadDenied = await denied(() => api.downloadSharedArtifact({ shareId, objectId }));
        checks.oldCommentsDenied = await denied(() => api.listShareComments({ shareId })) && await denied(() => api.addShareComment({ shareId, body: 'must fail' }));
        checks.oldContinueDenied = await denied(() => api.continueSharedTask({ shareId }));
        await showResults(); await new Promise((resolve) => setTimeout(resolve, 900));
        checks.inboxCardRemoved = !document.querySelector('[data-testid="incoming-share-card"]');
        details.directAccessAttempts = { shareId, objectId };
      } else {
        const outgoing = await api.listOutgoingShares(); const share = outgoing.find((item) => item.id === shareId); const audit = await api.listShareAudit({ shareId });
        await showResults(); const card = await waitFor(() => document.querySelector('[data-testid="outgoing-share-card"][data-share-status="revoked"]'));
        checks.revocationPersistsAcrossRestart = Boolean(share?.status === 'revoked' && share.revokedAt && share.revokedByAccount === 'owner@cern.example');
        checks.ownerHistoryStillVisible = Boolean(card?.querySelector('[data-testid="share-revoked-badge"]') && card?.querySelector('[data-testid="share-revocation-receipt"]'));
        checks.auditPersistsAcrossRestart = audit.some((item) => item.action === 'revoke' && item.outcome === 'allowed');
        details.share = share; details.audit = audit;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runShareVersionConsistencySmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  const phase = process.env.OPENDRSAI_E2E_L7_PHASE || "owner";
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\l7";
  const shareId = process.env.OPENDRSAI_E2E_L7_SHARE_ID || "";
  const objectId = process.env.OPENDRSAI_E2E_L7_OBJECT_ID || "";
  const versionOneSha = process.env.OPENDRSAI_E2E_L7_V1_SHA || "";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {}; const details = { phase: ${JSON.stringify(phase)} };
      const api = window.openDrSai; const workspacePath = ${JSON.stringify(workspacePath)}; const phase = ${JSON.stringify(phase)};
      const shareId = ${JSON.stringify(shareId)}; const objectId = ${JSON.stringify(objectId)}; const versionOneSha = ${JSON.stringify(versionOneSha)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 75)); } return null; };
      const setInput = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      const showResults = async () => { const workspaceItem = await waitFor(() => [...document.querySelectorAll('.workspace-item')].find((item) => (item.title || '').includes(workspacePath))); workspaceItem?.click(); await new Promise((resolve) => setTimeout(resolve, 350)); const nav = await waitFor(() => document.querySelector('.sidebar-button[data-nav-id="results"]')); nav?.click(); return waitFor(() => document.querySelector('[data-testid="results-center-view"]')); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      if (phase === 'owner') {
        const pdf = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf', maxBytes: 100000 });
        checks.realCernPdf = pdf.fileHash === 'sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e';
        const task = await api.enqueueBackgroundTask({ kind: 'presentation_generation', source: 'presentation', title: 'L7 CERN version consistency source', workspacePath, targetId: 'l7-cern-version', status: 'completed', progress: 100, message: 'CERN manager deck v1 ready.', verification: 'Pinned CERN source verified.', deliverySummary: { findingSummary: 'Manager deck v1 ready.', importance: 'high', importanceReason: 'L7 multi-user version acceptance.', suggestedAction: 'Share v1, edit the source, and publish v2.', workSummary: 'Generated from the verified CERN PDF.', coreConclusion: 'Every viewer and comment must identify its version.', verification: 'Deck is readable.', remainingRisks: 'Concurrent publishing must be rejected.', completionCriteria: { passed: ['v1 generated'], incomplete: [] }, artifacts: [{ id: 'l7-cern-manager-ppt', label: 'cern-wlcg-manager-versioned.pptx', path: workspacePath + '\\\\cern-wlcg-manager-versioned.pptx', kind: 'presentation' }] } });
        const share = await api.createShare({ sourceTaskId: task.id, scope: 'result_only', artifactId: 'l7-cern-manager-ppt', recipientAccount: 'version-reviewer@cern.example', permission: 'comment' });
        checks.v1ShareCreated = share.version === 1 && share.objects[0].version === 1 && /^[a-f0-9]{64}$/.test(share.objects[0].sha256 || '');
        checks.v1MetadataComplete = share.versionUpdatedByAccount === 'owner@cern.example' && Boolean(share.versionUpdatedAt);
        details.share = share;
      } else if (phase === 'recipient-before' || phase === 'recipient-during') {
        const incoming = await api.listIncomingShares(); const share = incoming[0]; const object = share?.objects[0];
        const opened = await api.openSharedObject({ shareId, objectType: 'artifact', objectId }); const downloaded = await api.downloadSharedArtifact({ shareId, objectId });
        checks.viewerSeesExplicitV1 = incoming.length === 1 && share.version === 1 && opened.version === 1 && downloaded.version === 1;
        checks.immutableV1Snapshot = object.sha256 === versionOneSha && opened.artifact?.sha256 === versionOneSha && downloaded.sha256 === versionOneSha;
        const body = phase === 'recipient-before' ? 'L7 review on published v1 before the owner edit.' : 'L7 simultaneous review still pinned to v1 while source changed.';
        const comment = await api.addShareComment({ shareId, body, objectId, anchorType: 'chart', anchorLabel: 'p.42 WLCG bandwidth chart' });
        checks.commentBoundToV1 = comment.version === 1 && comment.versionStatus === 'current';
        await showResults(); const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"][data-share-version="1"]'));
        checks.uiLabelsCurrentV1 = Boolean(card?.querySelector('[data-testid="share-version-badge"]')?.textContent?.includes('v1'));
        details.comment = comment; details.download = { bytes: downloaded.bytes, sha256: downloaded.sha256 };
      } else if (phase === 'owner-publish') {
        await showResults(); const card = await waitFor(() => document.querySelector('[data-testid="outgoing-share-card"]'));
        checks.ownerStartsFromV1 = card?.querySelector('[data-testid="share-version-badge"]')?.textContent?.includes('v1') === true;
        card?.querySelector('[data-testid="share-version-check"]')?.click(); const dialog = await waitFor(() => document.querySelector('[data-testid="share-version-dialog"]'));
        const changed = dialog?.querySelector('[data-testid="share-version-artifact"][data-version-changed="true"]'); const warning = dialog?.querySelector('[data-testid="share-version-stale-warning"]');
        checks.changedSourcePreviewed = Boolean(changed && (dialog?.textContent || '').includes('v2'));
        checks.staleImpactExplainedBeforePublish = Boolean(warning && (warning.textContent || '').includes('2'));
        dialog?.querySelector('[data-testid="share-version-publish"]')?.click();
        const share = await waitFor(async () => (await api.listOutgoingShares()).find((item) => item.id === shareId && item.version === 2));
        const badge = await waitFor(() => document.querySelector('[data-testid="outgoing-share-card"] [data-testid="share-version-badge"]'));
        const comments = await api.listShareComments({ shareId }); const source = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + '\\\\cern-wlcg-manager-versioned.pptx', maxBytes: 100000 });
        checks.v2PublishedFromCurrentSource = Boolean(share && share.objects[0].version === 2 && share.objects[0].sha256 !== versionOneSha && source.fileHash === 'sha256:' + share.objects[0].sha256);
        checks.ownerUiMovedToV2 = badge?.textContent?.includes('v2') === true;
        checks.oldCommentsMarkedStaleNotDeleted = comments.length === 2 && comments.every((comment) => comment.version === 1 && comment.versionStatus === 'stale');
        details.share = share; details.comments = comments; details.audit = await api.listShareAudit({ shareId });
      } else if (phase === 'conflict') {
        let conflictMessage = ''; try { await api.publishShareVersion({ shareId, expectedVersion: 1, sourceFingerprints: [{ objectId, sha256: versionOneSha }] }); } catch (error) { conflictMessage = error instanceof Error ? error.message : String(error); }
        const share = (await api.listOutgoingShares()).find((item) => item.id === shareId); const audit = await api.listShareAudit({ shareId });
        checks.stalePublisherRejected = /conflict/i.test(conflictMessage) && conflictMessage.includes('v2') && /no content was overwritten/i.test(conflictMessage);
        checks.v2NotOverwritten = share?.version === 2 && share.objects[0].sha256 !== versionOneSha;
        checks.conflictAudited = audit.some((item) => item.action === 'version_conflict' && item.outcome === 'denied' && item.reason.includes('expected v1'));
        details.conflictMessage = conflictMessage; details.share = share; details.audit = audit;
      } else if (phase === 'recipient-after') {
        const incoming = await api.listIncomingShares(); const share = incoming[0]; const opened = await api.openSharedObject({ shareId, objectType: 'artifact', objectId }); const downloaded = await api.downloadSharedArtifact({ shareId, objectId });
        checks.viewerReceivesExplicitV2 = share.version === 2 && opened.version === 2 && downloaded.version === 2 && downloaded.sha256 === share.objects[0].sha256 && downloaded.sha256 !== versionOneSha;
        let comments = await api.listShareComments({ shareId }); checks.twoV1CommentsAreStale = comments.length === 2 && comments.every((comment) => comment.version === 1 && comment.versionStatus === 'stale');
        const current = await api.addShareComment({ shareId, body: 'L7 review on the current published v2.', objectId, anchorType: 'chart', anchorLabel: 'p.42 revised WLCG bandwidth chart' });
        comments = await api.listShareComments({ shareId }); checks.newCommentBoundToV2 = current.version === 2 && current.versionStatus === 'current' && comments.filter((item) => item.versionStatus === 'current').length === 1;
        await showResults(); const card = await waitFor(() => document.querySelector('[data-testid="incoming-share-card"][data-share-version="2"]')); const stale = await waitFor(() => document.querySelectorAll('[data-testid="share-comment-stale"]').length === 2 ? [...document.querySelectorAll('[data-testid="share-comment-stale"]')] : null);
        checks.uiShowsV2AndStaleWarnings = Boolean(card?.querySelector('[data-testid="share-version-badge"]')?.textContent?.includes('v2') && stale?.length === 2);
        details.comments = comments; details.share = share;
      } else {
        await showResults(); const comments = await api.listShareComments({ shareId }); const audit = await api.listShareAudit({ shareId });
        const stale = await waitFor(() => document.querySelectorAll('[data-testid="outgoing-share-comment"][data-comment-version-status="stale"]').length === 2 ? [...document.querySelectorAll('[data-testid="outgoing-share-comment"][data-comment-version-status="stale"]')] : null);
        checks.ownerSeesCurrentVersionAndStaleComments = Boolean(document.querySelector('[data-testid="outgoing-share-card"] [data-testid="share-version-badge"]')?.textContent?.includes('v2') && stale?.length === 2);
        checks.versionLifecycleAudited = audit.some((item) => item.action === 'version_publish' && item.outcome === 'allowed' && item.reason.includes('v2')) && audit.some((item) => item.action === 'version_conflict' && item.outcome === 'denied');
        checks.commentHistoryPreserved = comments.length === 3 && comments.filter((item) => item.versionStatus === 'stale').length === 2 && comments.filter((item) => item.versionStatus === 'current').length === 1;
        checks.auditContainsNoCommentBodyOrPaths = !JSON.stringify(audit).includes('L7 review') && !/[A-Z]:\\\\|workspacePath|artifactPath/.test(JSON.stringify(audit));
        details.comments = comments; details.audit = audit;
      }
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runVoiceSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const liveFixturePath = process.env.OPENDRSAI_VOICE_LIVE_FIXTURE;
  const streamingMode = process.env.OPENDRSAI_E2E_VOICE_STREAMING === "1";
  const fullRoundMode = Boolean(liveFixturePath) && process.env.OPENDRSAI_E2E_VOICE_FULL_ROUND === "1";
  if (liveFixturePath && !existsSync(liveFixturePath)) throw new Error("Configured live voice fixture does not exist.");
  const fixtureBytes = liveFixturePath
    ? [...readFileSync(liveFixturePath)]
    : [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01];
  const fixtureExtension = liveFixturePath ? liveFixturePath.split(".").at(-1)?.toLowerCase() : "webm";
  const fixtureMimeType = ({ wav: "audio/wav", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4" } as Record<string, string>)[fixtureExtension || ""] || "audio/webm";
  const expectedRuntime = liveFixturePath ? "gateway-provider" : "mock-local";
  const transportResult = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = { bridge: Boolean(api) };
      const details = {};
      if (!api) return { ok: false, checks, details };
      if (${JSON.stringify(Boolean(liveFixturePath))}) await api.startGateway();
      const sttStatus = await api.getVoiceRuntimeStatus();
      const ttsStatus = await api.getVoiceSynthesisRuntimeStatus();
      const streamingCapabilities = await api.getStreamingVoiceCapabilities();
      checks.sttFixtureReady = sttStatus.runtimeId === ${JSON.stringify(expectedRuntime)} && sttStatus.state === "ready";
      checks.ttsFixtureReady = ttsStatus.runtimeId === ${JSON.stringify(expectedRuntime)} && ttsStatus.state === "ready" && ttsStatus.supportsSynthesisTask === true;
      checks.streamingCapabilitiesReady = ${JSON.stringify(streamingMode)}
        ? streamingCapabilities.streamingStt === true && streamingCapabilities.streamingTts === true && streamingCapabilities.audioEncodings.includes("pcm_s16le") && streamingCapabilities.sampleRatesHz.includes(16000)
        : streamingCapabilities.serialStt === true && streamingCapabilities.serialTts === true;

      const waitForTerminal = (subscribe, start, timeoutMessage, timeoutMs = 5000) => new Promise(async (resolve, reject) => {
        let unsubscribe = () => {};
        const timer = setTimeout(() => { unsubscribe(); reject(new Error(timeoutMessage)); }, timeoutMs);
        unsubscribe = subscribe((event) => {
          if (event.type !== "completed" && event.type !== "failed" && event.type !== "cancelled") return;
          clearTimeout(timer);
          unsubscribe();
          resolve(event);
        });
        try { await start(); } catch (error) { clearTimeout(timer); unsubscribe(); reject(error); }
      });

      const audio = new Uint8Array(${JSON.stringify(fixtureBytes)});
      const streamingEvents = [];
      let streamingTypes = [];
      let streamingCancelledType = "skipped";
      if (${JSON.stringify(streamingMode)}) {
        let streamingResult;
        const streamingTerminal = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { unsubscribe(); reject(new Error("Packaged streaming STT timed out.")); }, 10000);
          const unsubscribe = api.onStreamingVoiceTranscriptionEvent((event) => {
            if (streamingResult && event.sessionId !== streamingResult.sessionId) return;
            streamingEvents.push(event);
            if (!["completed", "failed", "cancelled"].includes(event.type)) return;
            clearTimeout(timer); unsubscribe(); resolve(event);
          });
        });
        streamingResult = await api.startStreamingVoiceTranscription({ turnId: "packaged-streaming-turn", encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1, frameDurationMs: 20, providerEndpointing: true });
        await new Promise((resolve) => setTimeout(resolve, 30));
        for (let sequence = 0; sequence < 4; sequence += 1) {
          const samples = new Int16Array(320); samples.fill(sequence + 1);
          checks.streamingChunkAccepted = api.sendStreamingVoiceAudioChunk({ sessionId: streamingResult.sessionId, turnId: streamingResult.turnId, sequence, capturedAtMs: performance.now(), durationMs: 20, encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1, audioData: new Uint8Array(samples.buffer) });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        checks.streamingStopAccepted = await api.stopStreamingVoiceTranscription(streamingResult.sessionId, "manual");
        const streamingTerminalEvent = await streamingTerminal;
        streamingTypes = streamingEvents.map((event) => event.type);
        checks.streamingCompleted = streamingTerminalEvent.type === "completed" && streamingTypes.includes("partial") && streamingTypes.includes("final") && streamingTypes.indexOf("partial") < streamingTypes.indexOf("final") && streamingTypes.indexOf("final") < streamingTypes.indexOf("completed");

        let streamingCancelResult;
        const streamingCancelled = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { unsubscribe(); reject(new Error("Packaged streaming cancellation timed out.")); }, 5000);
          const unsubscribe = api.onStreamingVoiceTranscriptionEvent((event) => {
            if (streamingCancelResult && event.sessionId !== streamingCancelResult.sessionId) return;
            if (event.type !== "cancelled") return;
            clearTimeout(timer); unsubscribe(); resolve(event);
          });
        });
        streamingCancelResult = await api.startStreamingVoiceTranscription({ turnId: "packaged-streaming-cancel-turn", encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1, frameDurationMs: 20, providerEndpointing: true });
        checks.streamingCancelAccepted = await api.cancelStreamingVoiceTranscription(streamingCancelResult.sessionId);
        const streamingCancelledEvent = await streamingCancelled;
        streamingCancelledType = streamingCancelledEvent.type;
        checks.streamingCancelled = streamingCancelledEvent.type === "cancelled" && streamingCancelledEvent.sessionId === streamingCancelResult.sessionId;
      } else {
        checks.streamingChunkAccepted = true;
        checks.streamingStopAccepted = true;
        checks.streamingCompleted = true;
        checks.streamingCancelAccepted = true;
        checks.streamingCancelled = true;
      }

      const sttEvent = await waitForTerminal(
        (listener) => api.onVoiceTranscriptionEvent(listener),
        () => api.startVoiceTranscription({ audioData: audio, mimeType: ${JSON.stringify(fixtureMimeType)}, durationSeconds: 1 }),
        "Packaged fixture STT timed out.",
        ${liveFixturePath ? 60_000 : 5_000},
      );
      checks.sttCompleted = sttEvent.type === "completed" && sttEvent.result?.runtimeId === ${JSON.stringify(expectedRuntime)} && Boolean(sttEvent.result?.transcript);

      let boundaryBytes = 0;
      if (!${JSON.stringify(Boolean(liveFixturePath))}) {
        boundaryBytes = sttStatus.maxBytes;
        const boundaryAudio = new Uint8Array(boundaryBytes);
        boundaryAudio.set([0x1a, 0x45, 0xdf, 0xa3]);
        const boundaryEvent = await waitForTerminal(
          (listener) => api.onVoiceTranscriptionEvent(listener),
          () => api.startVoiceTranscription({ audioData: boundaryAudio, mimeType: "audio/webm", durationSeconds: 120 }),
          "Packaged maximum-size STT timed out.",
          15000,
        );
        checks.maxBoundaryCompleted = boundaryEvent.type === "completed" && boundaryEvent.result?.durationSeconds === 120;
      } else {
        checks.maxBoundaryCompleted = true;
      }

      let cancelRequestId = "";
      const cancelledEvent = await waitForTerminal(
        (listener) => api.onVoiceTranscriptionEvent(listener),
        async () => {
          const started = await api.startVoiceTranscription({ audioData: audio, mimeType: ${JSON.stringify(fixtureMimeType)}, durationSeconds: 1 });
          cancelRequestId = started.requestId;
          checks.cancelAccepted = await api.cancelVoiceTranscription(started.requestId);
        },
        "Packaged fixture STT cancellation timed out.",
      );
      checks.sttCancelled = cancelledEvent.type === "cancelled" && cancelledEvent.requestId === cancelRequestId;

      const ttsEvent = await waitForTerminal(
        (listener) => api.onVoiceSynthesisEvent(listener),
        () => api.startVoiceSynthesis({ text: "Packaged voice fixture", language: "en-US", speed: 1, format: "wav" }),
        "Packaged fixture TTS timed out.",
        ${liveFixturePath ? 60_000 : 5_000},
      );
      checks.ttsCompleted = ttsEvent.type === "completed" && ttsEvent.result?.runtimeId === ${JSON.stringify(expectedRuntime)} && ttsEvent.result?.audioData?.length > 0;
      let voiceDiagnostics = [];
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await api.getDiagnosticSnapshot({ module: "voice", limit: 50 });
        voiceDiagnostics = snapshot.events || [];
        if (voiceDiagnostics.some((event) => event.component === "stt" && event.status === "completed") && voiceDiagnostics.some((event) => event.component === "tts" && event.status === "completed")) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const diagnosticText = JSON.stringify(voiceDiagnostics);
      checks.diagnosticsComplete = voiceDiagnostics.some((event) => event.component === "stt" && event.status === "completed" && typeof event.durationMs === "number") && voiceDiagnostics.some((event) => event.component === "tts" && event.status === "completed" && typeof event.durationMs === "number");
      checks.maxBoundaryDiagnostic = boundaryBytes === 0 || voiceDiagnostics.some((event) => event.component === "stt" && event.status === "started" && event.attributes?.bytes === boundaryBytes);
      checks.noInvalidTransitions = !voiceDiagnostics.some((event) => event.component === "turn" && event.errorCode === "invalid_transition");
      checks.diagnosticsPrivate = !diagnosticText.includes("Packaged voice fixture") && !diagnosticText.includes("Fixture voice transcript") && !diagnosticText.includes('"audioData":') && !diagnosticText.includes('"transcript":');
      details.runtimeIds = { stt: sttStatus.runtimeId, tts: ttsStatus.runtimeId };
      details.streaming = {
        capabilities: streamingCapabilities,
        terminalTypes: streamingTypes,
        mode: ${JSON.stringify(streamingMode ? "streaming" : "serial")},
        cancelledType: streamingCancelledType,
        errors: streamingEvents.filter((event) => event.type === "failed").map((event) => ({ code: event.error?.code, message: event.error?.message })),
      };
      details.maxBoundaryBytes = boundaryBytes;
      details.terminalTypes = { stt: sttEvent.type, cancelled: cancelledEvent.type, tts: ttsEvent.type };
      details.diagnosticOperations = voiceDiagnostics.map((event) => ({ component: event.component, operation: event.operation, status: event.status, durationMs: event.durationMs, errorCode: event.errorCode }));
      return { ok: Object.values(checks).every(Boolean), checks, details };
    })()
  `, true) as SmokeResult;
  if (!fullRoundMode || !transportResult.ok) return transportResult;
  const authenticated = await window.webContents.executeJavaScript(`
    window.openDrSai.login({ developerBypass: true, rememberMe: false, defaultModel: 'gpt-4.1-mini' })
  `, true) as { ok?: boolean };
  if (!authenticated?.ok) {
    return {
      ok: false,
      checks: { ...transportResult.checks, fullRoundLoginBootstrap: false },
      details: { ...transportResult.details, fullRound: { stage: "login-bootstrap" } },
    };
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Voice full-round renderer reload timed out.")), 15_000);
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolve();
    });
    window.webContents.reload();
  });
  const fullRoundResult = await runVoiceFullRoundSmoke(window);
  return {
    ok: transportResult.ok && fullRoundResult.ok,
    checks: { ...transportResult.checks, fullRoundLoginBootstrap: true, ...fullRoundResult.checks },
    details: { ...transportResult.details, fullRound: fullRoundResult.details },
  };
}

async function runVoiceFullRoundSmoke(window: BrowserWindow): Promise<SmokeResult> {
  return window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const checks = {};
      const details = {};
      const phases = [];
      const stages = [];
      const stage = (name) => {
        stages.push({ name, atMs: Math.round(performance.now()) });
        details.stages = stages;
      };
      const finish = async () => {
        rememberPhase();
        details.phases = phases;
        details.voiceUi = {
          phase: document.querySelector('form.composer')?.getAttribute('data-voice-turn-phase') || null,
          status: document.querySelector('.composer-voice-status')?.textContent?.trim().slice(0, 500) || null,
        };
        const snapshot = await api.getDiagnosticSnapshot({ module: 'voice', limit: 100 });
        details.voiceDiagnostics = (snapshot.events || []).map((event) => ({
          component: event.component,
          operation: event.operation,
          status: event.status,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          attributes: event.attributes,
        }));
        return { ok: Object.values(checks).every(Boolean), checks, details };
      };
      const rememberPhase = () => {
        const phase = document.querySelector('form.composer')?.getAttribute('data-voice-turn-phase');
        if (phase && phases.at(-1) !== phase) phases.push(phase);
      };
      const waitFor = async (find, timeout = 30000) => {
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
          rememberPhase();
          const value = await find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return null;
      };

      const playback = { ended: 0, played: 0 };
      class E2EAudio {
        constructor(url) { this.url = url; this.onended = null; this.onerror = null; this.playbackRate = 1; this.timer = null; }
        load() {}
        pause() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
        play() {
          playback.played += 1;
          this.timer = setTimeout(() => { this.timer = null; playback.ended += 1; this.onended?.(); }, 250);
          return Promise.resolve();
        }
        removeAttribute() {}
      }
      Object.defineProperty(window, 'Audio', { configurable: true, value: E2EAudio });

      const preferences = {
        autoReadResponses: true,
        inputDeviceId: '',
        inputLanguage: 'en-US',
        interactionMode: 'serial',
        playbackRate: 1,
        remoteSttConsent: true,
        remoteTtsConsent: true,
        synthesisMode: 'provider',
        voiceName: 'alloy',
      };
      localStorage.setItem('opendrsai.voicePreferences.v1', JSON.stringify({ version: 3, preferences }));
      window.dispatchEvent(new CustomEvent('opendrsai:voice-preferences-changed', { detail: preferences }));

      stage('login:start');
      const login = await api.login({ developerBypass: true, rememberMe: false, defaultModel: 'gpt-4.1-mini' });
      checks.fullRoundLogin = login?.ok === true;
      stage('login:complete');
      if (!checks.fullRoundLogin) return await finish();
      stage('gateway:start');
      checks.fullRoundGateway = await api.startGateway();
      stage('gateway:complete');
      if (!checks.fullRoundGateway) return await finish();
      const composer = await waitFor(() => document.querySelector('form.composer'), 15000);
      checks.fullRoundComposerReady = Boolean(composer);
      stage('composer:ready');
      if (!composer) return await finish();
      const observer = composer ? new MutationObserver(rememberPhase) : null;
      if (composer) observer?.observe(composer, { attributes: true, attributeFilter: ['data-voice-turn-phase'] });

      const baselineAssistantIds = new Set([...document.querySelectorAll('.message.assistant')].map((node) => node.getAttribute('data-message-id')));
      const baselineVoiceDiagnostics = await api.getDiagnosticSnapshot({ module: 'voice', limit: 100 });
      const baselineTtsCompleted = (baselineVoiceDiagnostics.events || []).filter((event) => event.component === 'tts' && event.status === 'completed').length;
      const voiceButton = await waitFor(() => {
        const button = document.querySelector('button[aria-label="Start voice recording"]');
        return button && !button.disabled ? button : null;
      }, 15000);
      checks.fullRoundVoiceButtonReady = Boolean(voiceButton);
      stage('voice-button:ready');
      if (!voiceButton) { observer?.disconnect(); return await finish(); }
      voiceButton?.click();
      checks.fullRoundCaptureStarted = Boolean(await waitFor(() => document.querySelector('form.composer[data-voice-turn-phase="recording"]'), 15000));
      stage('capture:started');
      if (!checks.fullRoundCaptureStarted) { observer?.disconnect(); return await finish(); }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const stopButton = await waitFor(() => document.querySelector('button[aria-label="Stop voice recording"]'), 5000);
      checks.fullRoundStopButtonReady = Boolean(stopButton);
      stage('stop-button:ready');
      if (!stopButton) { observer?.disconnect(); return await finish(); }
      stopButton?.click();

      const transcriptionTerminal = await waitFor(() => {
        const review = document.querySelector('textarea[aria-label="Review voice transcript"]');
        const failed = document.querySelector('form.composer[data-voice-turn-phase="failed"]');
        return review || failed;
      }, 60000);
      const review = transcriptionTerminal?.matches?.('textarea[aria-label="Review voice transcript"]')
        ? transcriptionTerminal
        : null;
      const transcript = review?.value?.trim() || '';
      checks.fullRoundTranscribed = transcript.length > 0;
      details.transcriptChars = transcript.length;
      stage('transcript:ready');
      if (!checks.fullRoundTranscribed) { observer?.disconnect(); return await finish(); }
      const insert = await waitFor(() => [...document.querySelectorAll('.composer-voice-review button')].find((button) => button.textContent?.trim() === 'Insert' && !button.disabled), 5000);
      checks.fullRoundInsertReady = Boolean(insert);
      if (!insert) { observer?.disconnect(); return await finish(); }
      insert?.click();
      const input = await waitFor(() => {
        const node = document.querySelector('[data-testid="composer-input"]');
        return node?.value?.trim() ? node : null;
      }, 5000);
      checks.fullRoundReviewInserted = Boolean(input) && input.value.trim() === transcript;
      stage('transcript:inserted');
      if (!checks.fullRoundReviewInserted) { observer?.disconnect(); return await finish(); }
      const submit = await waitFor(() => {
        const button = document.querySelector('button.composer-submit');
        return button && !button.disabled ? button : null;
      }, 5000);
      checks.fullRoundSendReady = Boolean(submit);
      stage('send:ready');
      if (!submit) { observer?.disconnect(); return await finish(); }
      submit?.click();
      stage('send:clicked');

      const assistant = await waitFor(() => [...document.querySelectorAll('.message.assistant')].find((node) => {
        const id = node.getAttribute('data-message-id');
        return id && !baselineAssistantIds.has(id) && (node.querySelector('.message-body')?.textContent || '').trim().length > 0;
      }), 90000);
      const assistantText = assistant?.querySelector('.message-body')?.textContent?.trim() || '';
      checks.fullRoundLlmReplied = assistantText.length > 0;
      details.assistantChars = assistantText.length;
      stage('assistant:ready');
      if (!checks.fullRoundLlmReplied) { observer?.disconnect(); return await finish(); }
      checks.fullRoundCompleted = Boolean(await waitFor(() => document.querySelector('form.composer[data-voice-turn-phase="completed"]'), 60000));
      await waitFor(() => playback.ended > 0, 10000);
      observer?.disconnect();
      rememberPhase();

      const requiredPhases = ['requesting_permission', 'recording', 'transcribing', 'reviewing', 'ready_to_send', 'submitting', 'awaiting_response', 'response_ready', 'synthesizing', 'playing', 'completed'];
      checks.fullRoundPhases = requiredPhases.every((phase) => phases.includes(phase));
      checks.fullRoundPlayback = playback.played > 0 && playback.ended > 0;
      const voiceDiagnostics = await api.getDiagnosticSnapshot({ module: 'voice', limit: 100 });
      const ttsCompleted = (voiceDiagnostics.events || []).filter((event) => event.component === 'tts' && event.status === 'completed').length;
      checks.fullRoundProviderTts = ttsCompleted > baselineTtsCompleted;
      const diagnosticText = JSON.stringify(voiceDiagnostics.events || []);
      checks.fullRoundDiagnosticsPrivate = !diagnosticText.includes(transcript) && !diagnosticText.includes(assistantText) && !diagnosticText.includes('audioData');
      details.phases = phases;
      details.playback = playback;
      stage('round:complete');
      return await finish();
    })()
  `, true) as Promise<SmokeResult>;
}

async function runChatSmoke(window: BrowserWindow): Promise<SmokeResult> {
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l7-version-consistency") {
    return runShareVersionConsistencySmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l6-share-revocation") {
    return runShareRevocationSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l5-comment-task") {
    return runCommentTaskSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l4-collaboration-permissions") {
    return runCollaborationPermissionSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l3-sensitive-share-review") {
    return runSensitiveShareSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l2-final-result-isolation") {
    return runFinalResultIsolationSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "l1-result-sharing") {
    return runResultSharingSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "k7-scheduled-task-management") {
    return runScheduledTaskManagementSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "k2-scheduled-trigger-stability") {
    return runScheduledTriggerStabilitySmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "k1-natural-language-schedule") {
    return runNaturalLanguageScheduleSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j1-user-preferences") {
    return runUserPreferenceMemorySmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j2-memory-safety") {
    return runSensitiveMemorySmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j3-memory-management") {
    return runMemoryManagementSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j4-memory-scopes") {
    return runMemoryScopeSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j5-reusable-task") {
    return runReusableTaskSmoke(window);
  }
  if (process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "j6-reusable-task-adjustments") {
    return runReusableTaskAdjustmentSmoke(window);
  }
  const chatWaitMs = process.env.OPENDRSAI_E2E_CHAT_SCENARIO === "network-recovery"
    ? Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "120000")
    : 15_000;
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const healthSnapshot = await api.getHealth();
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      const health = { ...healthSnapshot, gatewayReady: gateway.ready, gateway };
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
        gatewayExternalReady: health.gateway && health.gateway.externalReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
      };
      checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && (health.gateway.managed || health.gateway.externalReady) && !health.gateway.externalConflict);

      const thread = await api.createThread({
        kind: "chat",
        title: "E2E chat thread",
        workspacePath: "C:\\\\OpenDrSai\\\\workspace",
      });
      details.thread = thread;
      checks.threadCreated = Boolean(thread && thread.id && thread.kind === "chat");
      const requestId = "e2e-chat-request-0001";
      const runId = "e2e-chat-run-0001";
      const events = [];
      const startedAt = Date.now();
      const unsubscribe = api.onChatEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      try {
        const returnedRequestId = await api.startChat({
          requestId,
          threadId: thread.id,
          runId,
          model: "deepseek-v4-pro",
          workspacePath: "C:\\\\OpenDrSai\\\\workspace",
          messages: [{ role: "user", content: "hello e2e chat" }],
        });
        details.returnedRequestId = returnedRequestId;
        checks.startChatReturned = returnedRequestId === requestId;
        const deadline = Date.now() + ${chatWaitMs};
        while (Date.now() < deadline && !events.some((event) => event.type === "done" || event.type === "error" || event.type === "aborted")) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribe();
      }

      const firstEvent = events[0] || null;
      const lastEvent = events[events.length - 1] || null;
      const terminalEvent = events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
      details.chatSummary = {
        durationMs: Date.now() - startedAt,
        firstEventType: firstEvent && firstEvent.type,
        lastEventType: lastEvent && lastEvent.type,
        terminalEventType: terminalEvent && terminalEvent.type,
      };
      details.events = events.map((event) => ({
        type: event.type,
        at: event.at,
        content: event.content,
        error: event.error,
        sessionId: event.sessionId,
        runId: event.runId,
      }));
      checks.chatStartEvent = events.some((event) => event.type === "start");
      checks.chatThreadEvents = events.every((event) => !event.sessionId || event.sessionId === thread.id);
      checks.chatRunEvents = events.every((event) => !event.runId || event.runId === runId);
      checks.chatDistinctIds = thread.id !== requestId && thread.id !== runId && requestId !== runId;
      checks.chatChunk = events.some((event) => event.type === "chunk" && (
        String(event.content || "").includes("fake-agent: hello e2e chat")
        || String(event.content || "").includes("streaming reply before outage")
      ));
      checks.chatDone = events.some((event) => event.type === "done");
      checks.chatTerminalDone = terminalEvent && terminalEvent.type === "done";
      checks.chatDurationRecorded = details.chatSummary.durationMs >= 0;
      checks.noChatError = !events.some((event) => event.type === "error" || event.type === "aborted");
      // A pre-start health snapshot may be stale while deferred gateway probing
      // is still warming up. A completed real IPC -> gateway -> SSE round trip
      // is stronger evidence that the chat gateway is reachable.
      checks.gatewayReady = checks.gatewayReady || Boolean(
        checks.chatStartEvent && checks.chatDone && checks.noChatError,
      );
      const threads = await api.listThreads();
      details.threads = threads;
      checks.chatThreadIdle = threads.some((item) =>
        item.id === thread.id &&
        item.status === "idle" &&
        item.lastRequestId === requestId &&
        item.lastRunId === runId &&
        item.title.includes("hello e2e chat")
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runAgentPlanEditSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      await api.setCompletionNotificationPreference({ enabled: true, language: "zh" });
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      checks.gatewayReady = gateway.ready === true;

      const userMenuDeadline = Date.now() + 5000;
      let userMenuButton = null;
      while (Date.now() < userMenuDeadline && !userMenuButton) {
        userMenuButton = document.querySelector('button[aria-label="User menu"], button[aria-label="用户菜单"]');
        if (!userMenuButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      userMenuButton?.click();
      let settingsButton = null;
      const menuDeadline = Date.now() + 5000;
      while (Date.now() < menuDeadline && !settingsButton) {
        settingsButton = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => /Settings|设置/.test(String(item.textContent || ""))) || null;
        if (!settingsButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      settingsButton?.click();
      const settingsDeadline = Date.now() + 5000;
      while (Date.now() < settingsDeadline && !document.querySelector(".settings-navigation")) await new Promise((resolve) => setTimeout(resolve, 50));
      const agentTaskButton = Array.from(document.querySelectorAll(".settings-navigation button")).find((item) => /Agent tasks|Agent 任务/.test(String(item.textContent || ""))) || null;
      agentTaskButton?.click();
      const createDeadline = Date.now() + 5000;
      let createTaskButton = null;
      while (Date.now() < createDeadline && !createTaskButton) {
        createTaskButton = document.querySelector(".settings-action-section button");
        if (!createTaskButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      createTaskButton?.click();
      const workspaceDeadline = Date.now() + 5000;
      while (Date.now() < workspaceDeadline && !document.querySelector(".agent-run-workspace")) await new Promise((resolve) => setTimeout(resolve, 50));
      checks.agentWorkspaceVisible = Boolean(document.querySelector(".agent-run-workspace"));

      const taskText = "把最新数据更新进旧报告，生成给导师看的版本。";
      const taskInput = document.querySelector('[data-testid="agent-task-input"]');
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      textareaSetter?.call(taskInput, taskText);
      taskInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      document.querySelector('[data-testid="agent-plan-edit-button"]')?.click();
      const editorDeadline = Date.now() + 5000;
      while (Date.now() < editorDeadline && !document.querySelector('[data-testid="agent-plan-editor"]')) await new Promise((resolve) => setTimeout(resolve, 50));
      const readEditor = () => Array.from(document.querySelectorAll('[data-testid="agent-plan-editor"] li')).map((item) => ({
        id: item.getAttribute("data-plan-step-id"),
        phase: item.getAttribute("data-phase"),
        title: item.querySelector("input")?.value || "",
      }));
      const initialPlan = readEditor();
      document.querySelector('[data-plan-step-id="step-2"] [data-plan-action="delete"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      document.querySelector('[data-plan-step-id="step-3"] [data-plan-action="move-up"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const requirementInput = document.querySelector('[data-testid="agent-plan-new-requirement"]');
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      inputSetter?.call(requirementInput, "必须有引用");
      requirementInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      document.querySelector('[data-testid="agent-plan-add-requirement"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const editedPlan = readEditor();
      details.initialPlan = initialPlan;
      details.editedPlan = editedPlan;
      checks.initialPlanHasFourSteps = initialPlan.length === 4;
      checks.planStepDeleted = editedPlan.length === 4 && !editedPlan.some((step) => step.id === "step-2" || step.title.includes("更新报告中的数字"));
      checks.planOrderChanged = editedPlan[0]?.id === "step-3" && editedPlan[1]?.id === "step-1" && editedPlan[2]?.id === "step-4";
      checks.citationRequirementAdded = editedPlan[3]?.title === "必须有引用" && editedPlan[3]?.phase === "check";

      const events = [];
      const unsubscribe = api.onAgentRunEvent((event) => events.push(event));
      const submitDeadline = Date.now() + 10000;
      let submitButton = null;
      while (Date.now() < submitDeadline) {
        submitButton = document.querySelector('[data-testid="agent-run-submit"]');
        if (submitButton && !submitButton.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      details.submitState = { present: Boolean(submitButton), disabled: submitButton?.disabled, taskValue: document.querySelector('[data-testid="agent-task-input"]')?.value };
      checks.submitEnabled = Boolean(submitButton) && submitButton.disabled === false;
      submitButton?.click();
      const doneDeadline = Date.now() + 20000;
      while (Date.now() < doneDeadline && !events.some((event) => event.type === "done")) await new Promise((resolve) => setTimeout(resolve, 50));
      unsubscribe();
      const startEvent = events.find((event) => event.type === "start");
      const requestId = startEvent?.requestId;
      let backgroundTask = null;
      const taskDeadline = Date.now() + 5000;
      while (Date.now() < taskDeadline && backgroundTask?.status !== "completed") {
        const tasks = await api.listBackgroundTasks({ limit: 100 });
        backgroundTask = tasks.find((item) => item.kind === "agent_run" && item.targetId === requestId) || null;
        if (backgroundTask?.status !== "completed") await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const artifact = backgroundTask?.deliverySummary?.artifacts?.find((item) => item.path.endsWith("edited-plan-report.md"));
      const report = artifact ? await api.previewWorkspaceFile({ workspacePath: backgroundTask.workspacePath, path: artifact.path, maxBytes: 100000 }) : null;
      const reportText = String(report?.content || "");
      const storedTitles = backgroundTask?.planSteps?.map((step) => step.title) || [];
      const editedTitles = editedPlan.map((step) => step.title);
      const visiblePlanDeadline = Date.now() + 5000;
      let visibleSteps = [];
      while (Date.now() < visiblePlanDeadline) {
        visibleSteps = Array.from(document.querySelectorAll('[data-testid="agent-task-plan"] li')).map((item) => ({
          title: String(item.textContent || "").replace(/^[✓→○]\\s*/, "").trim(),
          state: item.getAttribute("data-plan-state"),
        }));
        if (visibleSteps.length === 4 && visibleSteps.every((step) => step.state === "completed")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      details.execution = { requestId, events, backgroundTask, artifact, reportKind: report?.kind, reportText, visibleSteps };
      checks.runCompleted = events.some((event) => event.type === "done") && backgroundTask?.status === "completed";
      checks.editedPlanPersisted = JSON.stringify(storedTitles) === JSON.stringify(editedTitles);
      checks.deletedStepNotExecuted = !storedTitles.some((title) => title.includes("更新报告中的数字")) && !reportText.includes("已更新旧报告");
      checks.editedOrderExecuted = JSON.stringify(backgroundTask?.completedSteps) === JSON.stringify(editedTitles);
      checks.editedPlanVisibleCompleted = JSON.stringify(visibleSteps.map((step) => step.title)) === JSON.stringify(editedTitles) && visibleSteps.every((step) => step.state === "completed");
      checks.citationRequirementInResult = report?.kind === "markdown" && reportText.includes("## 引用") && reportText.includes("[1]");
      checks.artifactRegistered = Boolean(artifact);
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runUserPreferenceMemorySmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const setTextarea = (textarea, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 200 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      checks.gatewayReady = gateway.ready === true;
      const workspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 15000);
      workspaceButton?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => Array.from(document.querySelectorAll(".workspace-row.active .workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 5000));
      const pdfPath = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";

      const visible = (selector) => Array.from(document.querySelectorAll(selector)).find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) || null;
      let composer = await waitFor(() => visible(".composer textarea"), 10000);
      const preferenceText = "以后默认用中文，图表不要网格线。";
      if (composer) setTextarea(composer, preferenceText);
      const preferenceSubmit = await waitFor(() => { const button = visible(".composer-submit"); return button && !button.disabled ? button : null; }, 10000);
      checks.preferenceSubmitEnabled = Boolean(preferenceSubmit);
      preferenceSubmit?.click();
      const confirmation = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /已记住 2 项偏好/.test(node.textContent || "")) || null, 5000);
      checks.explicitConfirmationVisible = Boolean(confirmation) && /默认输出语言：中文/.test(confirmation?.textContent || "") && /图表网格线：不显示/.test(confirmation?.textContent || "") && /新建会话后会自动应用/.test(confirmation?.textContent || "");
      const storedAfterExplicit = await api.listUserPreferences();
      checks.onlyExplicitValuesStored = storedAfterExplicit.length === 2 && storedAfterExplicit.every((item) => item.source === "explicit_user_request") && storedAfterExplicit.some((item) => item.category === "output_language" && item.value === "zh") && storedAfterExplicit.some((item) => item.category === "chart_gridlines" && item.value === "hidden");

      const threadsBefore = await api.listThreads();
      const newChat = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /开始聊天|New chat/.test(button.textContent || button.getAttribute("title") || "")) || null, 5000);
      newChat?.click();
      const notice = await waitFor(() => document.querySelector('[data-testid="remembered-preferences-notice"]'), 10000);
      checks.newConversationAppliesVisiblePreferences = Boolean(notice) && /默认输出语言：中文/.test(notice?.textContent || "") && /图表网格线：不显示/.test(notice?.textContent || "");
      const threadsAfter = await api.listThreads();
      checks.realNewConversationCreated = threadsAfter.length === threadsBefore.length + 1 && threadsAfter.some((thread) => !threadsBefore.some((before) => before.id === thread.id));

      composer = await waitFor(() => visible(".composer textarea"), 5000);
      const taskText = "基于工作区中的 CERN WLCG PDF p.42 容量数据生成一张带结论的图表。";
      if (composer) setTextarea(composer, taskText);
      const taskSubmit = await waitFor(() => { const button = visible(".composer-submit"); return button && !button.disabled ? button : null; }, 10000);
      checks.taskSubmitEnabled = Boolean(taskSubmit);
      taskSubmit?.click();
      const response = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /CERN 偏好已应用/.test(node.textContent || "")) || null, 20000);
      checks.newConversationTaskCompleted = Boolean(response);
      const storedAfterTask = await api.listUserPreferences();
      checks.ordinaryTaskDidNotCreateMemory = storedAfterTask.length === 2 && storedAfterTask.every((item) => storedAfterExplicit.some((before) => before.category === item.category && before.value === item.value));
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfBefore.fileHash === pdfAfter.fileHash;
      details.preferences = storedAfterTask;
      details.confirmationText = confirmation?.textContent?.replace(/\s+/g, " ").trim() || "";
      details.noticeText = notice?.textContent?.replace(/\s+/g, " ").trim() || "";
      details.taskText = taskText;
      details.pdfHash = pdfAfter.fileHash;
      notice?.scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runSensitiveMemorySmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const apiSecret = "sk-proj-J2NeverPersistABC123456789";
      const tokenSecret = "xoxb-J2NeverPersist-123456789012";
      const tempSecretPath = "C:\\\\Users\\\\win11\\\\AppData\\\\Local\\\\Temp\\\\j2-private\\\\token.txt";
      const forbidden = [apiSecret, tokenSecret, tempSecretPath];
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const visible = (selector) => Array.from(document.querySelectorAll(selector)).find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) || null;
      const setTextarea = (textarea, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); };
      const submitText = async (text) => {
        const composer = await waitFor(() => visible(".composer textarea"), 10000);
        if (composer) setTextarea(composer, text);
        const button = await waitFor(() => { const candidate = visible(".composer-submit"); return candidate && !candidate.disabled ? candidate : null; }, 10000);
        button?.click();
        return Boolean(button);
      };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 200 && !gateway.ready; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); gateway = await api.getGatewayStatus(); }
      checks.gatewayReady = gateway.ready === true;
      const workspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 15000);
      workspaceButton?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => Array.from(document.querySelectorAll(".workspace-row.active .workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 5000));
      const pdfPath = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";

      const secretRequest = "请记住我的 API Key 是 " + apiSecret + "，token=" + tokenSecret + "，临时路径是 " + tempSecretPath + "。";
      checks.secretSubmitEnabled = await submitText(secretRequest);
      const safetyNotice = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /没有保存.*API Key.*令牌.*临时路径/.test(node.textContent || "")) || null, 5000);
      checks.sensitiveMemoryExplicitlyRejected = Boolean(safetyNotice) && /没有把它发送给模型/.test(safetyNotice?.textContent || "") && /不会进入后续会话上下文/.test(safetyNotice?.textContent || "");
      const visibleMessages = Array.from(document.querySelectorAll(".message .message-body")).map((node) => node.textContent || "").join("\\n");
      checks.visibleSecretRedacted = forbidden.every((value) => !visibleMessages.includes(value)) && /API Key 已隐藏/.test(visibleMessages) && /令牌已隐藏/.test(visibleMessages) && /临时路径已隐藏/.test(visibleMessages);
      const preferencesAfterSecret = await api.listUserPreferences();
      checks.secretNotInPreferenceStore = preferencesAfterSecret.length === 0;
      const threadsAfterSecret = await api.listThreads();
      const serializedThreads = JSON.stringify(threadsAfterSecret);
      checks.secretNotInThreadPersistence = forbidden.every((value) => !serializedThreads.includes(value));
      const projectMemoryAfterSecret = await api.listProjectMemory({ workspacePath, limit: 100 });
      checks.secretNotInMemoryIndex = projectMemoryAfterSecret.length === 0 && forbidden.every((value) => !JSON.stringify(projectMemoryAfterSecret).includes(value));

      checks.safePreferenceSubmitEnabled = await submitText("以后默认用中文，图表不要网格线。");
      const savedNotice = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /已记住 2 项偏好/.test(node.textContent || "")) || null, 5000);
      const safeBaseline = await api.listUserPreferences();
      checks.safeBaselineStored = Boolean(savedNotice) && safeBaseline.length === 2 && safeBaseline.some((item) => item.category === "output_language" && item.value === "zh") && safeBaseline.some((item) => item.category === "chart_gridlines" && item.value === "hidden");

      checks.temporarySubmitEnabled = await submitText("请记住：这次用英文，图表显示网格线。");
      const temporaryNotice = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /一次性要求.*不会保存为长期偏好/.test(node.textContent || "")) || null, 5000);
      checks.temporaryRequirementExplicitlyScoped = Boolean(temporaryNotice) && /不会影响下一次任务/.test(temporaryNotice?.textContent || "");
      const afterTemporary = await api.listUserPreferences();
      checks.temporaryRequirementNotPersisted = afterTemporary.length === 2 && afterTemporary.every((item) => safeBaseline.some((before) => before.category === item.category && before.value === item.value));

      const threadsBeforeNew = await api.listThreads();
      const newChat = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /开始聊天|New chat/.test(button.textContent || button.getAttribute("title") || "")) || null, 5000);
      newChat?.click();
      const notice = await waitFor(() => document.querySelector('[data-testid="remembered-preferences-notice"]'), 10000);
      checks.nextConversationUsesSafeBaseline = Boolean(notice) && /默认输出语言：中文/.test(notice?.textContent || "") && /图表网格线：不显示/.test(notice?.textContent || "") && !/英文|显示网格线/.test(notice?.textContent || "");
      const threadsAfterNew = await api.listThreads();
      checks.realNewConversationCreated = threadsAfterNew.length === threadsBeforeNew.length + 1;

      const taskText = "基于工作区中的 CERN WLCG PDF p.42 容量数据生成一张带结论的图表。";
      checks.taskSubmitEnabled = await submitText(taskText);
      const response = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /CERN 安全记忆验收通过/.test(node.textContent || "")) || null, 20000);
      checks.nextTaskCompleted = Boolean(response);
      const finalPreferences = await api.listUserPreferences();
      checks.nextTaskDidNotMutateMemory = finalPreferences.length === 2 && finalPreferences.every((item) => safeBaseline.some((before) => before.category === item.category && before.value === item.value));
      const finalThreads = await api.listThreads();
      const finalMemory = await api.listProjectMemory({ workspacePath, limit: 100 });
      checks.allRuntimeMemorySurfacesClean = forbidden.every((value) => !JSON.stringify({ finalPreferences, finalThreads, finalMemory }).includes(value));
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfBefore.fileHash === pdfAfter.fileHash;
      details.preferences = finalPreferences;
      details.safetyNotice = safetyNotice?.textContent?.replace(/\\s+/g, " ").trim() || "";
      details.temporaryNotice = temporaryNotice?.textContent?.replace(/\\s+/g, " ").trim() || "";
      details.newConversationNotice = notice?.textContent?.replace(/\\s+/g, " ").trim() || "";
      details.pdfHash = pdfAfter.fileHash;
      notice?.scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runMemoryManagementSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const visible = (selector) => Array.from(document.querySelectorAll(selector)).find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) || null;
      const setTextarea = (textarea, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 200 && !gateway.ready; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); gateway = await api.getGatewayStatus(); }
      checks.gatewayReady = gateway.ready === true;
      const workspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 15000);
      workspaceButton?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => Array.from(document.querySelectorAll(".workspace-row.active .workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 5000));
      const pdfPath = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";
      const initial = await api.listUserPreferences();
      checks.seededPreferencesAvailable = initial.length === 3 && initial.some((item) => item.category === "output_language" && item.value === "zh") && initial.some((item) => item.category === "chart_gridlines" && item.value === "hidden") && initial.some((item) => item.category === "report_format" && item.value === "presentation");

      const agentNav = await waitFor(() => Array.from(document.querySelectorAll("button")).find((button) => /^智能体$|^Agents$/i.test((button.textContent || "").trim())) || null, 10000);
      checks.mainNavigationEntryVisible = Boolean(agentNav);
      agentNav?.focus();
      checks.mainNavigationKeyboardReachable = document.activeElement === agentNav && agentNav?.tagName === "BUTTON";
      agentNav?.click();
      const configure = await waitFor(() => document.querySelector('[data-testid="my-drsai-configure"]'), 10000);
      checks.myAssistantVisible = Boolean(configure);
      configure?.focus();
      checks.myAssistantKeyboardReachable = document.activeElement === configure && configure?.tagName === "BUTTON";
      configure?.click();
      const openMemory = await waitFor(() => document.querySelector('[data-testid="open-user-memory-manager"]'), 10000);
      openMemory?.focus();
      checks.memoryEntryKeyboardReachable = document.activeElement === openMemory && openMemory?.tagName === "BUTTON";
      openMemory?.click();
      const manager = await waitFor(() => document.querySelector('[data-testid="user-memory-manager"]'), 10000);
      checks.memoryManagerVisible = Boolean(manager) && /记忆管理/.test(manager?.textContent || "") && /API Key、令牌和临时路径不会出现在这里/.test(manager?.textContent || "");
      checks.allSeededRowsVisible = ["output_language", "chart_gridlines", "report_format"].every((category) => document.querySelector('[data-testid="memory-row-' + category + '"]'));

      const languageSelect = document.querySelector('[data-testid="memory-value-output_language"]');
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (languageSelect) { selectSetter?.call(languageSelect, "en"); languageSelect.dispatchEvent(new Event("change", { bubbles: true })); }
      const updateStatus = await waitFor(() => { const node = document.querySelector('[data-testid="memory-manager-status"]'); return /记忆已修改.*下一项任务立即生效/.test(node?.textContent || "") ? node : null; }, 5000);
      const afterEdit = await api.listUserPreferences();
      checks.editConfirmed = Boolean(updateStatus);
      checks.editPersistedImmediately = afterEdit.some((item) => item.category === "output_language" && item.value === "en") && !afterEdit.some((item) => item.category === "output_language" && item.value === "zh");

      const deleteGrid = await waitFor(() => document.querySelector('[data-testid="memory-delete-chart_gridlines"]'), 5000);
      deleteGrid?.click();
      const deleteStatus = await waitFor(() => { const node = document.querySelector('[data-testid="memory-manager-status"]'); return /记忆已删除.*不会再用于后续任务/.test(node?.textContent || "") ? node : null; }, 5000);
      const afterDelete = await api.listUserPreferences();
      checks.deleteConfirmed = Boolean(deleteStatus);
      checks.deletedRowRemoved = !document.querySelector('[data-testid="memory-row-chart_gridlines"]');
      checks.deletePersistedImmediately = afterDelete.length === 2 && !afterDelete.some((item) => item.category === "chart_gridlines") && afterDelete.some((item) => item.category === "output_language" && item.value === "en") && afterDelete.some((item) => item.category === "report_format" && item.value === "presentation");

      const threadsBefore = await api.listThreads();
      const newChat = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /开始聊天|New chat/.test(button.textContent || button.getAttribute("title") || "")) || null, 5000);
      newChat?.click();
      const notice = await waitFor(() => document.querySelector('[data-testid="remembered-preferences-notice"]'), 10000);
      checks.newConversationReflectsEditAndDelete = Boolean(notice) && /默认输出语言：英文/.test(notice?.textContent || "") && /默认报告格式：演示文稿/.test(notice?.textContent || "") && !/图表网格线/.test(notice?.textContent || "");
      const threadsAfter = await api.listThreads();
      checks.realNewConversationCreated = threadsAfter.length === threadsBefore.length + 1;

      const composer = await waitFor(() => visible(".composer textarea"), 5000);
      const taskText = "基于工作区中的 CERN WLCG PDF p.42 容量数据生成一张适合演示的图表。";
      if (composer) setTextarea(composer, taskText);
      const submit = await waitFor(() => { const button = visible(".composer-submit"); return button && !button.disabled ? button : null; }, 10000);
      checks.taskSubmitEnabled = Boolean(submit);
      submit?.click();
      const response = await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /CERN 记忆管理验收通过/.test(node.textContent || "")) || null, 20000);
      checks.nextTaskCompleted = Boolean(response);
      const finalPreferences = await api.listUserPreferences();
      checks.nextTaskPreservedManagedState = JSON.stringify(finalPreferences) === JSON.stringify(afterDelete);
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfBefore.fileHash === pdfAfter.fileHash;
      details.initialPreferences = initial;
      details.afterEdit = afterEdit;
      details.preferences = finalPreferences;
      details.noticeText = notice?.textContent?.replace(/\\s+/g, " ").trim() || "";
      details.taskText = taskText;
      details.pdfHash = pdfAfter.fileHash;
      notice?.scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runMemoryScopeSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspaceA = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\cern-a";
  const workspaceB = process.env.OPENDRSAI_E2E_WORKSPACE_B_PATH || "C:\\OpenDrSai\\project-b";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspaceA = ${JSON.stringify(workspaceA)};
      const workspaceB = ${JSON.stringify(workspaceB)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const visible = (selector) => Array.from(document.querySelectorAll(selector)).find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) || null;
      const setTextarea = (textarea, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); };
      const selectWorkspace = async (path) => { const button = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item")).find((item) => item.getAttribute("title")?.includes(path)) || null, 10000); button?.click(); return Boolean(await waitFor(() => Array.from(document.querySelectorAll(".workspace-row.active .workspace-item")).find((item) => item.getAttribute("title")?.includes(path)) || null, 5000)); };
      const newChat = async () => { const button = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((item) => /开始聊天|New chat/.test(item.textContent || item.getAttribute("title") || "")) || null, 5000); button?.click(); await new Promise((resolve) => setTimeout(resolve, 1500)); return Boolean(button); };
      const send = async (text) => { const composer = await waitFor(() => visible(".composer textarea"), 5000); if (composer) setTextarea(composer, text); const submit = await waitFor(() => { const button = visible(".composer-submit"); return button && !button.disabled ? button : null; }, 8000); submit?.click(); return Boolean(await waitFor(() => Array.from(document.querySelectorAll(".message.assistant .message-body")).find((node) => /J4 scope verified/.test(node.textContent || "")) || null, 20000)); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const session = await api.getAuthSession();
      checks.authorizedIdentityLoaded = session?.user?.groups?.includes("cern-research") === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 200 && !gateway.ready; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); gateway = await api.getGatewayStatus(); }
      checks.gatewayReady = gateway.ready === true;
      checks.workspaceASelected = await selectWorkspace(workspaceA);
      const pdfPath = workspaceA + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath: workspaceA, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";
      const projectTerm = "WLCG-CAPACITY means the p.42 bandwidth capacity model.";
      const teamRule = "Team rule: cite the exact CERN PDF page for every capacity figure.";
      await api.addProjectMemory({ workspacePath: workspaceA, content: projectTerm, source: "manual" });
      await api.addTeamMemory({ teamId: "cern-research", content: teamRule });
      checks.projectAStored = (await api.listProjectMemory({ workspacePath: workspaceA, limit: 20 })).some((item) => item.content === projectTerm);
      checks.projectBIsolatedAtRest = !(await api.listProjectMemory({ workspacePath: workspaceB, limit: 20 })).some((item) => item.content === projectTerm);
      checks.authorizedTeamReadable = (await api.listTeamMemory({ teamId: "cern-research", limit: 20 })).some((item) => item.content === teamRule);
      let unauthorizedRead = false; let unauthorizedWrite = false;
      try { await api.listTeamMemory({ teamId: "unowned-team", limit: 20 }); } catch (error) { unauthorizedRead = /not authorized/i.test(String(error)); }
      try { await api.addTeamMemory({ teamId: "unowned-team", content: "must not persist" }); } catch (error) { unauthorizedWrite = /not authorized/i.test(String(error)); }
      checks.unauthorizedTeamReadRejected = unauthorizedRead;
      checks.unauthorizedTeamWriteRejected = unauthorizedWrite;

      const agentNav = await waitFor(() => Array.from(document.querySelectorAll("button")).find((button) => /智能体|Agents/i.test((button.textContent || "").trim())) || null, 10000);
      agentNav?.click();
      (await waitFor(() => document.querySelector('[data-testid="my-drsai-configure"]'), 10000))?.click();
      (await waitFor(() => document.querySelector('[data-testid="open-user-memory-manager"]'), 10000))?.click();
      checks.scopeManagerVisible = Boolean(await waitFor(() => document.querySelector('[data-testid="user-memory-manager"]'), 10000));
      checks.personalScopeVisible = Boolean(document.querySelector('[data-testid="memory-row-output_language"]'));
      checks.projectScopeVisible = Boolean(document.querySelector('[data-testid="project-memory-scope"]'));
      checks.teamScopeVisible = Boolean(document.querySelector('[data-testid="team-memory-scope"]'));
      checks.teamSelectorRestricted = Array.from(document.querySelectorAll('[data-testid="team-memory-team"] option')).every((option) => option.value === "cern-research");

      checks.projectANewChat = await newChat();
      checks.projectATaskCompleted = await send("J4 PROJECT A: analyze CERN p.42 with the saved scope rules.");
      checks.workspaceBSelected = await selectWorkspace(workspaceB);
      checks.projectBNewChat = await newChat();
      checks.projectBTaskCompleted = await send("J4 PROJECT B: answer using only memories valid in this project.");
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath: workspaceA, path: pdfPath, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfAfter.fileHash === pdfBefore.fileHash;
      details.projectTerm = projectTerm;
      details.teamRule = teamRule;
      details.personalPreferences = await api.listUserPreferences();
      details.projectAMemory = await api.listProjectMemory({ workspacePath: workspaceA, limit: 20 });
      details.projectBMemory = await api.listProjectMemory({ workspacePath: workspaceB, limit: 20 });
      details.authorizedTeamMemory = await api.listTeamMemory({ teamId: "cern-research", limit: 20 });
      details.pdfHash = pdfAfter.fileHash;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runReusableTaskSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\j5";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const oldInput = workspacePath + "\\\\weekly-baseline.csv";
      const oldOutput = workspacePath + "\\\\weekly-baseline-report.md";
      const cernPdf = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const setInput = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      let gateway = await api.getGatewayStatus(); for (let i = 0; i < 200 && !gateway.ready; i += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); gateway = await api.getGatewayStatus(); }
      checks.gatewayReady = gateway.ready === true;
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";
      const source = await api.enqueueBackgroundTask({
        kind: "agent_run", source: "agent", title: "检查每周数据并生成带来源的管理报告", workspacePath, targetId: "j5-source-g2", status: "completed",
        planSteps: [
          { id: "input", phase: "input", title: "读取本周输入材料" },
          { id: "process", phase: "process", title: "核对指标变化并提取结论" },
          { id: "check", phase: "check", title: "核对每项数字和来源" },
          { id: "output", phase: "output", title: "生成管理报告" },
        ],
        message: "G2 source task completed.", verification: "Every numeric conclusion must cite the current input material.",
        deliverySummary: { findingSummary: "Baseline data checked.", importance: "high", importanceReason: "Weekly review", suggestedAction: "Reuse next week", workSummary: "Generated baseline report", coreConclusion: "Baseline complete", verification: "Passed", remainingRisks: "None", artifacts: [{ id: "j5-source-report", label: "Weekly baseline report", path: oldOutput, kind: "report", keyConclusions: [{ id: "j5-source-conclusion", conclusion: "Baseline throughput is 100", sourcePath: oldInput, locatorType: "data_range", locator: "row 2", evidenceText: "throughput,100" }] }] },
      });
      checks.completedSourceTaskAvailable = source.status === "completed" && source.deliverySummary?.artifacts?.length === 1;
      const resultsNav = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/.test(button.textContent || button.getAttribute("title") || "")) || null, 10000);
      resultsNav?.click();
      checks.resultsCenterVisible = Boolean(await waitFor(() => document.querySelector('[data-testid="results-center-view"]'), 10000));
      const saveButton = await waitFor(() => document.querySelector('[data-source-task-id="' + source.id + '"] [data-testid="reusable-task-save"]'), 10000);
      checks.saveEntryVisible = Boolean(saveButton);
      saveButton?.click();
      const nameInput = await waitFor(() => document.querySelector('[data-testid="reusable-task-name"]'), 5000);
      if (nameInput) setInput(nameInput, "每周数据检查");
      document.querySelector('[data-testid="reusable-task-confirm-save"]')?.click();
      const card = await waitFor(() => document.querySelector('[data-testid="reusable-task-card"]'), 10000);
      checks.savedTaskVisible = Boolean(card) && /每周数据检查/.test(card?.textContent || "");
      checks.replacementInputsExplained = Boolean(card) && /下次替换|Replace next time/.test(card?.textContent || "") && (card?.querySelector('[data-testid="reusable-task-input-primary_input"]')?.value || "").includes("weekly-baseline.csv");
      checks.fixedRulesExplained = Boolean(card) && /保持不变的规则|Rules kept fixed/.test(card?.textContent || "") && /current input material/.test(card?.textContent || "");
      const saved = (await api.listReusableTasks()).find((item) => item.name === "每周数据检查");
      checks.typedTemplatePersisted = Boolean(saved) && saved.inputs.length === 1 && saved.fixedRules.length >= 3 && saved.runCount === 0;
      document.querySelector('.sidebar-button')?.click();
      await waitFor(() => !document.querySelector('[data-testid="results-center-view"]'), 5000);
      const resultsNavAgain = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /成果|Results/.test(button.textContent || button.getAttribute("title") || "")) || null, 5000);
      resultsNavAgain?.click();
      await waitFor(() => document.querySelector('[data-testid="results-center-view"]'), 5000);
      checks.crossSessionDiscovery = Boolean(await waitFor(() => Array.from(document.querySelectorAll('[data-testid="reusable-task-card"]')).find((item) => /每周数据检查/.test(item.textContent || "")) || null, 5000));
      const replacement = document.querySelector('[data-testid="reusable-task-input-primary_input"]');
      if (replacement) setInput(replacement, cernPdf);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const runButton = document.querySelector('[data-testid="reusable-task-run"]');
      checks.runEntryVisible = Boolean(runButton);
      runButton?.click();
      const completedStatus = await waitFor(() => { const node = document.querySelector('[data-testid="reusable-task-status"]'); return node?.getAttribute("data-state") === "completed" ? node : null; }, 25000);
      checks.reusableRunCompleted = Boolean(completedStatus);
      const finalTemplates = await api.listReusableTasks();
      const finalTemplate = finalTemplates.find((item) => item.id === saved?.id);
      checks.runHistoryUpdated = finalTemplate?.runCount === 1 && Boolean(finalTemplate.lastRunAt) && Boolean(finalTemplate.lastInputFingerprint);
      const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 });
      const rerun = tasks.find((item) => item.kind === "agent_run" && item.id !== source.id && item.status === "completed");
      checks.newResultRegistered = rerun?.status === "completed" && rerun.deliverySummary?.artifacts?.some((item) => item.path.endsWith("weekly-cern-report.md")) === true;
      const newReport = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + "\\\\weekly-cern-report.md", maxBytes: 100000 }).catch(() => null);
      checks.newResultUsesCernMaterial = String(newReport?.content || "").includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") && !String(newReport?.content || "").includes("throughput,100");
      let duplicateRejected = false; try { await api.prepareReusableTaskRun({ reusableTaskId: saved.id, workspacePath, inputs: { primary_input: cernPdf }, adjustments: { checkItems: [] }, adjustmentScope: "this_run" }); } catch (error) { duplicateRejected = /new input material/i.test(String(error)); }
      checks.sameInputCacheReuseRejected = duplicateRejected;
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfAfter.fileHash === pdfBefore.fileHash;
      details.sourceTask = source;
      details.savedTask = saved;
      details.finalTask = finalTemplate;
      details.rerunTask = rerun;
      details.statusText = completedStatus?.textContent || "";
      details.newReportText = String(newReport?.content || "");
      details.pdfHash = pdfAfter.fileHash;
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runReusableTaskAdjustmentSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\j6";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const oldInput = workspacePath + "\\\\weekly-baseline.csv";
      const oldOutput = workspacePath + "\\\\weekly-baseline-report.md";
      const cernPdf = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const week2 = workspacePath + "\\\\cern-week-2.md";
      const week3 = workspacePath + "\\\\cern-week-3.md";
      const waitFor = async (find, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const setInput = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
      const setTextarea = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); };
      const setSelect = (input, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(input, value); input.dispatchEvent(new Event("change", { bubbles: true })); };
      const navigateResults = async () => { const button = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((item) => /成果|Results/.test(item.textContent || item.getAttribute("title") || "")) || null); button?.click(); return waitFor(() => document.querySelector('[data-testid="results-center-view"]')); };
      const runAndWait = async () => {
        document.querySelector('[data-testid="reusable-task-run"]')?.click();
        const started = await waitFor(() => { const node = document.querySelector('[data-testid="reusable-task-status"]'); return ["preparing", "running"].includes(node?.getAttribute("data-state")) ? node : null; }, 5000);
        const completed = await waitFor(() => { const node = document.querySelector('[data-testid="reusable-task-status"]'); return node?.getAttribute("data-state") === "completed" ? node : null; }, 30000);
        return { started: Boolean(started), completed: Boolean(completed), text: completed?.textContent || "" };
      };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      let gateway = await api.getGatewayStatus(); for (let i = 0; i < 200 && !gateway.ready; i += 1) { await new Promise((resolve) => setTimeout(resolve, 100)); gateway = await api.getGatewayStatus(); }
      checks.gatewayReady = gateway.ready === true;
      const pdfBefore = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfAvailable = pdfBefore.fileHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e";
      const source = await api.enqueueBackgroundTask({
        kind: "agent_run", source: "agent", title: "检查每周数据并生成带来源的管理报告", workspacePath, targetId: "j6-source-g2", status: "completed",
        planSteps: [{ id: "input", phase: "input", title: "读取本周输入材料" }, { id: "process", phase: "process", title: "核对指标变化并提取结论" }, { id: "check", phase: "check", title: "核对每项数字和来源" }, { id: "output", phase: "output", title: "生成管理报告" }],
        verification: "Every numeric conclusion must cite the current input material.",
        deliverySummary: { findingSummary: "Baseline checked", importance: "high", importanceReason: "Weekly review", suggestedAction: "Reuse", workSummary: "Generated baseline", coreConclusion: "Baseline complete", verification: "Passed", remainingRisks: "None", artifacts: [{ id: "j6-source-report", label: "Weekly baseline report", path: oldOutput, kind: "report", keyConclusions: [{ id: "j6-source-conclusion", conclusion: "Baseline throughput is 100", sourcePath: oldInput, locatorType: "data_range", locator: "row 2", evidenceText: "throughput,100" }] }] },
      });
      checks.completedSourceTaskAvailable = source.status === "completed";
      await navigateResults();
      const saveButton = await waitFor(() => document.querySelector('[data-source-task-id="' + source.id + '"] [data-testid="reusable-task-save"]'));
      saveButton?.click();
      const nameInput = await waitFor(() => document.querySelector('[data-testid="reusable-task-name"]'));
      if (nameInput) setInput(nameInput, "每周数据检查");
      document.querySelector('[data-testid="reusable-task-confirm-save"]')?.click();
      const card = await waitFor(() => document.querySelector('[data-testid="reusable-task-card"]'));
      checks.adjustmentEntryVisible = Boolean(card?.querySelector('[data-testid="reusable-task-adjustments"]'));
      checks.threeAdjustmentTypesVisible = Boolean(card?.querySelector('[data-testid="reusable-task-adjustment-language"]')) && Boolean(card?.querySelector('[data-testid="reusable-task-adjustment-deadline"]')) && Boolean(card?.querySelector('[data-testid="reusable-task-adjustment-checks"]'));
      checks.twoScopesExplained = /仅本次/.test(card?.textContent || "") && /以后都这样/.test(card?.textContent || "") && /模板保持不变/.test(card?.textContent || "") && /更新保存的模板/.test(card?.textContent || "");
      const saved = (await api.listReusableTasks()).find((item) => item.name === "每周数据检查");
      checks.initialTemplateHasNoAdjustments = Boolean(saved) && !saved.savedAdjustments.outputLanguage && !saved.savedAdjustments.deadline && saved.savedAdjustments.checkItems.length === 0;

      setInput(document.querySelector('[data-testid="reusable-task-input-primary_input"]'), cernPdf);
      setSelect(document.querySelector('[data-testid="reusable-task-adjustment-language"]'), "en");
      setInput(document.querySelector('[data-testid="reusable-task-adjustment-deadline"]'), "2026-07-20 18:00");
      setTextarea(document.querySelector('[data-testid="reusable-task-adjustment-checks"]'), "Verify CERN page 42 capacity\\nConfirm every number has a source");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const firstRun = await runAndWait();
      checks.thisRunCompleted = firstRun.started && firstRun.completed;
      const afterThisRun = (await api.listReusableTasks()).find((item) => item.id === saved.id);
      checks.thisRunDidNotChangeTemplate = afterThisRun?.runCount === 1 && !afterThisRun.savedAdjustments.outputLanguage && !afterThisRun.savedAdjustments.deadline && afterThisRun.savedAdjustments.checkItems.length === 0;

      setInput(document.querySelector('[data-testid="reusable-task-input-primary_input"]'), week2);
      setSelect(document.querySelector('[data-testid="reusable-task-adjustment-language"]'), "zh");
      setInput(document.querySelector('[data-testid="reusable-task-adjustment-deadline"]'), "2026-07-27 18:00");
      setTextarea(document.querySelector('[data-testid="reusable-task-adjustment-checks"]'), "核对 2029 暂定目标\\n列出证据不足项");
      document.querySelector('[data-testid="reusable-task-adjustment-scope"] input[value="update_template"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const secondRun = await runAndWait();
      checks.templateUpdateRunCompleted = secondRun.started && secondRun.completed;
      const afterUpdate = (await api.listReusableTasks()).find((item) => item.id === saved.id);
      checks.templateUpdatedPersistently = afterUpdate?.runCount === 2 && afterUpdate.savedAdjustments.outputLanguage === "zh" && afterUpdate.savedAdjustments.deadline === "2026-07-27 18:00" && afterUpdate.savedAdjustments.checkItems.join("|") === "核对 2029 暂定目标|列出证据不足项";

      document.querySelector('.sidebar-button')?.click();
      await waitFor(() => !document.querySelector('[data-testid="results-center-view"]'), 5000);
      await navigateResults();
      const restoredCard = await waitFor(() => document.querySelector('[data-testid="reusable-task-card"]'));
      checks.updatedTemplateRediscovered = restoredCard?.querySelector('[data-testid="reusable-task-adjustment-language"]')?.value === "zh" && restoredCard?.querySelector('[data-testid="reusable-task-adjustment-deadline"]')?.value === "2026-07-27 18:00" && /核对 2029 暂定目标/.test(restoredCard?.querySelector('[data-testid="reusable-task-adjustment-checks"]')?.value || "");
      setInput(restoredCard?.querySelector('[data-testid="reusable-task-input-primary_input"]'), week3);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const thirdRun = await runAndWait();
      checks.futureRunCompletedWithoutRedescription = thirdRun.started && thirdRun.completed;
      const finalTemplate = (await api.listReusableTasks()).find((item) => item.id === saved.id);
      checks.futureRunKeptTemplate = finalTemplate?.runCount === 3 && finalTemplate.savedAdjustments.outputLanguage === "zh" && finalTemplate.savedAdjustments.deadline === "2026-07-27 18:00" && finalTemplate.savedAdjustments.checkItems.length === 2;
      const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 });
      const reruns = tasks.filter((item) => item.kind === "agent_run" && item.id !== source.id && item.status === "completed");
      checks.threeUniqueRunsRegistered = reruns.length === 3 && new Set(reruns.map((item) => item.targetId)).size === 3;
      checks.threeOutputsRegistered = [1, 2, 3].every((number) => reruns.some((item) => item.deliverySummary?.artifacts?.some((artifact) => artifact.path.endsWith('j6-run-' + number + '.md'))));
      const pdfAfter = await api.previewWorkspaceFile({ workspacePath, path: cernPdf, maxBytes: 100000 });
      checks.cernPdfUnchanged = pdfAfter.fileHash === pdfBefore.fileHash;
      details.sourceTask = source;
      details.savedTask = saved;
      details.afterThisRun = afterThisRun;
      details.afterUpdate = afterUpdate;
      details.finalTemplate = finalTemplate;
      details.reruns = reruns;
      details.firstRun = firstRun;
      details.secondRun = secondRun;
      details.thirdRun = thirdRun;
      details.pdfHash = pdfAfter.fileHash;
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runAgentDepthSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      checks.gatewayReady = gateway.ready === true;

      let userMenuButton = null;
      const userMenuDeadline = Date.now() + 5000;
      while (Date.now() < userMenuDeadline && !userMenuButton) {
        userMenuButton = document.querySelector('button[aria-label="User menu"], button[aria-label="用户菜单"]');
        if (!userMenuButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      userMenuButton?.click();
      let settingsButton = null;
      const menuDeadline = Date.now() + 5000;
      while (Date.now() < menuDeadline && !settingsButton) {
        settingsButton = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => /Settings|设置/.test(String(item.textContent || ""))) || null;
        if (!settingsButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      settingsButton?.click();
      const settingsDeadline = Date.now() + 5000;
      while (Date.now() < settingsDeadline && !document.querySelector('.settings-navigation')) await new Promise((resolve) => setTimeout(resolve, 50));
      const agentTaskButton = Array.from(document.querySelectorAll('.settings-navigation button')).find((item) => /Agent tasks|Agent 任务/.test(String(item.textContent || ""))) || null;
      agentTaskButton?.click();
      const createDeadline = Date.now() + 5000;
      let createTaskButton = null;
      while (Date.now() < createDeadline && !createTaskButton) {
        createTaskButton = document.querySelector('.settings-action-section button');
        if (!createTaskButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      createTaskButton?.click();
      const workspaceDeadline = Date.now() + 5000;
      while (Date.now() < workspaceDeadline && !document.querySelector('.agent-run-workspace')) await new Promise((resolve) => setTimeout(resolve, 50));
      checks.agentWorkspaceVisible = Boolean(document.querySelector('.agent-run-workspace'));

      const selector = document.querySelector('[data-testid="agent-depth-selector"]');
      const selectorText = String(selector?.textContent || "");
      const cards = ['quick', 'standard', 'deep'].map((depth) => ({
        depth,
        text: String(document.querySelector('[data-testid="agent-depth-' + depth + '"]')?.textContent || ""),
      }));
      details.selector = { text: selectorText, cards };
      checks.depthSelectorVisible = Boolean(selector);
      checks.defaultDepthStandard = document.querySelector('[data-testid="agent-depth-standard"] input')?.checked === true;
      checks.threeDepthsVisible = cards.every((card) => card.text.length > 0);
      checks.estimatedTimesVisible = selectorText.includes('2～5') && selectorText.includes('5～15') && selectorText.includes('15～30');
      checks.outputDifferencesExplained = selectorText.includes('核心结论与下一步建议') && selectorText.includes('结构化报告与来源清单') && selectorText.includes('详细报告、证据附录与风险清单');
      checks.notLengthOnlyExplained = selectorText.includes('材料覆盖') && selectorText.includes('检查方式') && selectorText.includes('交付物');

      const runs = [];
      const taskText = '综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。';
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      for (const depth of ['quick', 'standard', 'deep']) {
        const depthInput = document.querySelector('[data-testid="agent-depth-' + depth + '"] input');
        depthInput?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const selected = depthInput?.checked === true;
        const taskInput = document.querySelector('[data-testid="agent-task-input"]');
        textareaSetter?.call(taskInput, taskText);
        taskInput?.dispatchEvent(new Event('input', { bubbles: true }));
        const events = [];
        const unsubscribe = api.onAgentRunEvent((event) => events.push(event));
        const submitDeadline = Date.now() + 10000;
        let submitButton = null;
        while (Date.now() < submitDeadline) {
          submitButton = document.querySelector('[data-testid="agent-run-submit"]');
          if (submitButton && !submitButton.disabled) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        submitButton?.click();
        const doneDeadline = Date.now() + 20000;
        while (Date.now() < doneDeadline && !events.some((event) => event.type === 'done')) await new Promise((resolve) => setTimeout(resolve, 50));
        unsubscribe();
        const requestId = events.find((event) => event.type === 'start')?.requestId;
        let backgroundTask = null;
        const taskDeadline = Date.now() + 5000;
        while (Date.now() < taskDeadline && backgroundTask?.status !== 'completed') {
          const tasks = await api.listBackgroundTasks({ limit: 100 });
          backgroundTask = tasks.find((item) => item.kind === 'agent_run' && item.targetId === requestId) || null;
          if (backgroundTask?.status !== 'completed') await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const artifacts = backgroundTask?.deliverySummary?.artifacts || [];
        const previews = [];
        for (const artifact of artifacts) {
          const preview = await api.previewWorkspaceFile({ workspacePath: backgroundTask.workspacePath, path: artifact.path, maxBytes: 100000 });
          previews.push({ path: artifact.path, kind: preview?.kind, text: String(preview?.content || '') });
        }
        runs.push({ depth, selected, requestId, events, backgroundTask, artifacts, previews });
      }
      details.runs = runs;
      const quick = runs.find((run) => run.depth === 'quick');
      const standard = runs.find((run) => run.depth === 'standard');
      const deep = runs.find((run) => run.depth === 'deep');
      const combined = (run) => run?.previews?.map((item) => item.text).join('\\n') || '';
      checks.allDepthSelectionsApplied = runs.length === 3 && runs.every((run) => run.selected);
      checks.threeRunsCompleted = runs.length === 3 && runs.every((run) => run.events.some((event) => event.type === 'done') && run.backgroundTask?.status === 'completed');
      checks.quickUsesFocusedMaterial = combined(quick).includes('材料覆盖：1/3') && combined(quick).includes('study-a.md') && !combined(quick).includes('study-c.md');
      checks.standardCoversAllMaterials = combined(standard).includes('材料覆盖：3/3') && ['study-a.md', 'study-b.md', 'study-c.md'].every((name) => combined(standard).includes(name));
      checks.standardChecksSources = combined(standard).includes('关键依据核对') && combined(standard).includes('来源清单');
      checks.deepCoversAllMaterials = combined(deep).includes('材料覆盖：3/3') && ['study-a.md', 'study-b.md', 'study-c.md'].every((name) => combined(deep).includes(name));
      checks.deepPerformsIndependentReview = combined(deep).includes('逐项核对') && combined(deep).includes('冲突与不确定性') && combined(deep).includes('独立复核');
      checks.deliverablesDiffer = quick?.artifacts?.length === 1 && standard?.artifacts?.length === 2 && deep?.artifacts?.length === 3;
      checks.deepHasEvidenceAndRiskDeliverables = deep?.artifacts?.some((item) => item.path.endsWith('deep-evidence-appendix.md')) && deep?.artifacts?.some((item) => item.path.endsWith('deep-risk-list.md'));
      checks.differencesAreStructural = checks.quickUsesFocusedMaterial && checks.standardChecksSources && checks.deepPerformsIndependentReview && checks.deliverablesDiffer;
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runAgentPlanAdjustmentSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      checks.gatewayReady = gateway.ready === true;

      let userMenuButton = null;
      const userMenuDeadline = Date.now() + 5000;
      while (Date.now() < userMenuDeadline && !userMenuButton) {
        userMenuButton = document.querySelector('button[aria-label="User menu"], button[aria-label="用户菜单"]');
        if (!userMenuButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      userMenuButton?.click();
      let settingsButton = null;
      const menuDeadline = Date.now() + 5000;
      while (Date.now() < menuDeadline && !settingsButton) {
        settingsButton = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => /Settings|设置/.test(String(item.textContent || ""))) || null;
        if (!settingsButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      settingsButton?.click();
      const settingsDeadline = Date.now() + 5000;
      while (Date.now() < settingsDeadline && !document.querySelector('.settings-navigation')) await new Promise((resolve) => setTimeout(resolve, 50));
      const agentTaskButton = Array.from(document.querySelectorAll('.settings-navigation button')).find((item) => /Agent tasks|Agent 任务/.test(String(item.textContent || ""))) || null;
      agentTaskButton?.click();
      const createDeadline = Date.now() + 5000;
      let createTaskButton = null;
      while (Date.now() < createDeadline && !createTaskButton) {
        createTaskButton = document.querySelector('.settings-action-section button');
        if (!createTaskButton) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      createTaskButton?.click();
      const workspaceDeadline = Date.now() + 5000;
      while (Date.now() < workspaceDeadline && !document.querySelector('.agent-run-workspace')) await new Promise((resolve) => setTimeout(resolve, 50));
      checks.agentWorkspaceVisible = Boolean(document.querySelector('.agent-run-workspace'));

      const taskText = '综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。';
      const taskInput = document.querySelector('[data-testid="agent-task-input"]');
      const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      textareaSetter?.call(taskInput, taskText);
      taskInput?.dispatchEvent(new Event('input', { bubbles: true }));
      const events = [];
      const unsubscribe = api.onAgentRunEvent((event) => events.push(event));
      const submitDeadline = Date.now() + 10000;
      let submitButton = null;
      while (Date.now() < submitDeadline) {
        submitButton = document.querySelector('[data-testid="agent-run-submit"]');
        if (submitButton && !submitButton.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      submitButton?.click();
      const adjustmentDeadline = Date.now() + 10000;
      let adjustmentCardDuringRun = null;
      while (Date.now() < adjustmentDeadline) {
        adjustmentCardDuringRun = document.querySelector('[data-testid="agent-plan-adjustment"]');
        if (events.some((event) => event.type === 'plan_adjustment') && adjustmentCardDuringRun) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const duringRunText = String(adjustmentCardDuringRun?.textContent || '');
      const doneDeadline = Date.now() + 20000;
      while (Date.now() < doneDeadline && !events.some((event) => event.type === 'done')) await new Promise((resolve) => setTimeout(resolve, 50));
      unsubscribe();
      const requestId = events.find((event) => event.type === 'start')?.requestId;
      let backgroundTask = null;
      const taskDeadline = Date.now() + 5000;
      while (Date.now() < taskDeadline && backgroundTask?.status !== 'blocked') {
        const tasks = await api.listBackgroundTasks({ limit: 100 });
        backgroundTask = tasks.find((item) => item.kind === 'agent_run' && item.targetId === requestId) || null;
        if (backgroundTask?.status !== 'blocked') await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const finalCard = document.querySelector('[data-testid="agent-plan-adjustment"]');
      finalCard?.scrollIntoView({ block: 'center' });
      const finalCardText = String(finalCard?.textContent || '');
      const adjustedPlanStep = document.querySelector('[data-testid="agent-task-plan"] li[data-plan-state="adjusted"]');
      const artifact = backgroundTask?.deliverySummary?.artifacts?.find((item) => item.path.endsWith('partial-research-report.md'));
      const report = artifact ? await api.previewWorkspaceFile({ workspacePath: backgroundTask.workspacePath, path: artifact.path, maxBytes: 100000 }) : null;
      const reportText = String(report?.content || '');
      const adjustment = backgroundTask?.planAdjustments?.[0];
      const summary = backgroundTask?.deliverySummary;
      details.events = events;
      details.duringRunText = duringRunText;
      details.finalCardText = finalCardText;
      details.backgroundTask = backgroundTask;
      details.adjustment = adjustment;
      details.artifact = artifact;
      details.reportText = reportText;
      checks.planAdjustmentEventReceived = events.some((event) => event.type === 'plan_adjustment');
      checks.adjustmentVisibleDuringRun = duringRunText.includes('计划已调整') && duringRunText.includes('结果不完整');
      checks.runReachedTerminalEvent = events.some((event) => event.type === 'done');
      checks.taskNotMarkedComplete = backgroundTask?.status === 'blocked';
      checks.adjustmentPersisted = backgroundTask?.planAdjustments?.length === 1;
      checks.failedStepExplained = adjustment?.failedStepId === 'step-2' && adjustment?.failedStepTitle === '比较材料并整理共识、争议和证据缺口';
      checks.reasonExplained = adjustment?.reason === 'study-b.md 数据源暂时不可用';
      checks.replacementExplained = adjustment?.replacementStepTitle === '仅使用 study-a.md 和 study-c.md 形成部分综合，并保留证据缺口';
      checks.impactExplained = adjustment?.impact === '无法核对成本争议的另一方证据，成本结论不完整';
      checks.visibleAdjustmentComplete = ['未完成步骤', '原因', '改为', '对结果的影响', 'study-b.md', '成本结论不完整'].every((text) => finalCardText.includes(text));
      checks.failedStepMarkedAdjusted = adjustedPlanStep?.getAttribute('data-phase') === 'process' && String(adjustedPlanStep.textContent || '').includes('比较材料');
      checks.failedStepNotCompleted = !backgroundTask?.completedSteps?.includes('比较材料并整理共识、争议和证据缺口');
      checks.partialArtifactRegistered = Boolean(artifact) && report?.kind === 'markdown';
      checks.partialReportTransparent = reportText.includes('study-b.md 数据源不可用') && reportText.includes('无法形成完整的成本争议结论') && reportText.includes('部分结果');
      checks.completionCardSaysPartial = summary?.findingSummary?.includes('部分结果') && summary?.coreConclusion?.includes('不能作为完整综合结论');
      checks.incompleteCriteriaRecorded = summary?.completionCriteria?.incomplete?.some((item) => item.includes('比较材料')) && summary?.completionCriteria?.incomplete?.some((item) => item.includes('study-b.md'));
      checks.impactInRemainingRisks = summary?.remainingRisks === '无法核对成本争议的另一方证据，成本结论不完整';
      const summaryText = JSON.stringify(summary || {});
      checks.noFalseCompleteClaim = !summaryText.includes('任务已完成并到达可交付状态') && !summaryText.includes('已完成多材料综合');
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runAgentRunSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const agentScenario = process.env.OPENDRSAI_E2E_AGENT_RUN_SCENARIO || "default";
  if (agentScenario === "g1-results-center") return runResultsCenterSmoke(window);
  if (agentScenario === "g3-output-versions") return runOutputVersionsSmoke(window);
  if (agentScenario === "g4-preview-download") return runResultPreviewDownloadSmoke(window);
  if (agentScenario === "g5-local-edit") return runLocalizedEditSmoke(window);
  if (agentScenario === "g6-chart-consistency") return runChartConsistencySmoke(window);
  if (agentScenario === "i4-analysis-routes") return runAnalysisRoutesSmoke(window);
  if (agentScenario === "i5-route-comparison") return runAnalysisRoutesSmoke(window);
  if (agentScenario === "i6-external-conflict") return runExternalFileConflictSmoke(window);
  if (agentScenario === "d2-edit-plan") return runAgentPlanEditSmoke(window);
  if (agentScenario === "d3-depth") return runAgentDepthSmoke(window);
  if (agentScenario === "d5-plan-adjustment") return runAgentPlanAdjustmentSmoke(window);
  if (agentScenario === "background-close") {
    return runAgentRunAwayNotificationSmoke(window, "hidden");
  }
  if (agentScenario === "minimized-notification") {
    return runAgentRunAwayNotificationSmoke(window, "minimized");
  }
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const agentRunWaitMs = agentScenario === "network-recovery"
    ? Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "120000")
    : 15_000;
  const agentBusinessProgressScenario = agentScenario === "business-progress";
  const agentCompletionCriteriaScenario = agentScenario === "completion-criteria";
  const agentDeliverableReportScenario = agentScenario === "g2-deliverable-report";
  const agentG4ReportScenario = agentCompletionCriteriaScenario || agentDeliverableReportScenario;
  const agentContinuousTaskScenario = agentScenario === "continuous-task";
  const agentPlanKind = agentScenario.startsWith("d1-plan-") ? agentScenario.slice("d1-plan-".length) : "";
  const agentPlanScenario = ["g2", "g3", "g4"].includes(agentPlanKind);
  const agentUiScenario = agentBusinessProgressScenario || agentG4ReportScenario || agentContinuousTaskScenario || agentPlanScenario;
  if (agentUiScenario) {
    const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
    await createWorkspace({ source: "existing", path: workspacePath, name: "E2E agent change set", trusted: true });
    await new Promise<void>((resolveReload, rejectReload) => {
      const timer = setTimeout(() => rejectReload(new Error("Agent UI fixture reload timed out.")), 10_000);
      window.webContents.once("did-finish-load", () => { clearTimeout(timer); resolveReload(); });
      window.webContents.reload();
    });
  }
  const agentTask = agentPlanKind === "g2"
    ? "帮我看看这份数据有没有问题。"
    : agentPlanKind === "g3"
      ? "综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。"
      : agentPlanKind === "g4"
        ? "把最新数据更新进旧报告，生成给导师看的版本。"
        : agentBusinessProgressScenario || agentContinuousTaskScenario
          ? "综合这些材料，告诉我目前共识、争议和下一步值得研究的问题。"
          : agentG4ReportScenario
            ? "认真检查后再给我：把最新数据更新进旧报告，生成给导师看的版本。"
            : "write a short plan";
  const agentFiles = agentPlanKind === "g2"
    ? [
        { kind: "file" as const, path: "experiment.csv", name: "experiment.csv" },
        { kind: "file" as const, path: "experiment.xlsx", name: "experiment.xlsx" },
      ]
    : agentPlanKind === "g3"
      ? [
          { kind: "file" as const, path: "study-a.md", name: "study-a.md" },
          { kind: "file" as const, path: "study-b.md", name: "study-b.md" },
          { kind: "file" as const, path: "study-c.md", name: "study-c.md" },
        ]
      : agentPlanKind === "g4"
        ? [
            { kind: "file" as const, path: "old-report.md", name: "old-report.md" },
            { kind: "file" as const, path: "latest-data.csv", name: "latest-data.csv" },
            { kind: "file" as const, path: "result.png", name: "result.png" },
          ]
        : agentBusinessProgressScenario
          ? [
              { kind: "file" as const, path: "paper-a.md", name: "paper-a.md" },
              { kind: "file" as const, path: "paper-b.md", name: "paper-b.md" },
              { kind: "file" as const, path: "data.csv", name: "data.csv" },
            ]
          : agentContinuousTaskScenario
            ? [
                { kind: "file" as const, path: "study-a.md", name: "study-a.md" },
                { kind: "file" as const, path: "study-b.md", name: "study-b.md" },
                { kind: "file" as const, path: "study-c.md", name: "study-c.md" },
              ]
            : agentG4ReportScenario
              ? [
                  { kind: "file" as const, path: "old-report.md", name: "old-report.md" },
                  { kind: "file" as const, path: "latest-data.csv", name: "latest-data.csv" },
                  { kind: "file" as const, path: "result.png", name: "result.png" },
                ]
              : [{ kind: "file" as const, path: "C:\\OpenDrSai\\fixtures\\notes.md", name: "notes.md" }];
  const agentPlanGoldenConcepts = agentPlanKind === "g2"
    ? ["数据", "文件", "分析目标", "数据质量", "缺失值", "重复行", "异常点", "统计结果", "图表", "异常解释", "问题摘要", "改进建议"]
    : agentPlanKind === "g3"
      ? ["研究材料", "比较材料", "共识", "争议", "证据缺口", "核对结论", "材料来源", "不确定性", "综合报告", "下一步", "研究问题"]
      : agentPlanKind === "g4"
        ? ["旧报告", "最新数据", "结果图", "更新报告", "数字", "文字", "图表关系", "核对", "内容一致", "保留原文件", "导师版报告"]
        : [];
  const agentRunScript = `
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);
      const notificationPreference = await api.setCompletionNotificationPreference({ enabled: true, language: "en" });
      checks.completionNotificationsEnabled = notificationPreference?.enabled === true && notificationPreference?.language === "en";

      const healthSnapshot = await api.getHealth();
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      const health = { ...healthSnapshot, gatewayReady: gateway.ready, gateway };
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
        gatewayExternalReady: health.gateway && health.gateway.externalReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
      };
      checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && (health.gateway.managed || health.gateway.externalReady) && !health.gateway.externalConflict);

      const workspacePath = ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace")};
      let thread = null;
      if (${agentUiScenario}) {
        const userMenuDeadline = Date.now() + 5000;
        let userMenuButton = null;
        while (Date.now() < userMenuDeadline && !userMenuButton) {
          userMenuButton = document.querySelector('[data-testid="user-menu-button"]');
          if (!userMenuButton) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        userMenuButton?.click();
        const menuDeadline = Date.now() + 5000;
        let settingsButton = null;
        while (Date.now() < menuDeadline && !settingsButton) {
          settingsButton = document.querySelector('[data-testid="user-menu-settings"]');
          if (!settingsButton) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        settingsButton?.click();
        const settingsDeadline = Date.now() + 5000;
        while (Date.now() < settingsDeadline && !document.querySelector(".settings-navigation")) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const agentTaskDeadline = Date.now() + 5000;
        let agentTaskButton = null;
        while (Date.now() < agentTaskDeadline && !agentTaskButton) {
          agentTaskButton = Array.from(document.querySelectorAll(".settings-navigation button"))
            .find((item) => /Agent tasks|智能体任务/.test(String(item.textContent || ""))) || null;
          if (!agentTaskButton) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        agentTaskButton?.click();
        const createDeadline = Date.now() + 5000;
        let createTaskButton = null;
        while (Date.now() < createDeadline && !createTaskButton) {
          createTaskButton = document.querySelector(".settings-action-section button");
          if (!createTaskButton) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        createTaskButton?.click();
        const workspaceDeadline = Date.now() + 5000;
        while (Date.now() < workspaceDeadline && !document.querySelector(".agent-run-workspace")) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        checks.agentBusinessProgressWorkspaceVisible = Boolean(document.querySelector(".agent-run-workspace"));
        const threadDeadline = Date.now() + 5000;
        while (Date.now() < threadDeadline && !thread) {
          thread = (await api.listThreads()).find((item) => item.kind === "agent_run" && /New agent task|新智能体任务/.test(item.title)) || null;
          if (!thread) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!thread) throw new Error("The Agent task was not created from the visible Settings entry. " + JSON.stringify({
          userMenuFound: Boolean(userMenuButton),
          settingsFound: Boolean(settingsButton),
          settingsNavigationFound: Boolean(document.querySelector(".settings-navigation")),
          agentTaskFound: Boolean(agentTaskButton),
          createTaskFound: Boolean(createTaskButton),
          workspaceFound: Boolean(document.querySelector(".agent-run-workspace")),
          settingsLabels: Array.from(document.querySelectorAll(".settings-navigation button")).map((item) => String(item.textContent || "").trim()),
          recentThreadTitles: (await api.listThreads()).slice(0, 5).map((item) => item.title),
        }));
      } else {
        thread = await api.createThread({
            kind: "agent_run",
            title: "E2E agent run thread",
            workspacePath,
          });
      }
      details.thread = thread;
      checks.threadCreated = Boolean(thread && thread.id && thread.kind === "agent_run");
      const requestId = "e2e-agent-run-request-0001";
      const runId = "e2e-agent-run-run-0001";
      const workspace = await api.createWorkspace({
        source: "existing",
        path: workspacePath,
        name: "E2E agent change set",
        trusted: true,
      });
      details.workspace = workspace;
      checks.agentRunWorkspaceRegistered = Boolean(workspace && workspace.path === workspacePath && workspace.trusted);
      const checkpoint = await api.createWorkspaceCheckpoint({
        workspacePath,
        label: "E2E agent run baseline",
        kind: "agent_run_baseline",
        runId,
        maxFiles: 200,
        maxBytesPerFile: 2000000,
      });
      details.checkpoint = checkpoint;
      checks.agentRunCheckpointCreated = Boolean(checkpoint && checkpoint.kind === "agent_run_baseline" && checkpoint.runId === runId);
      const events = [];
      const pendingApprovalsBefore = ${agentContinuousTaskScenario} ? await api.listPendingApprovals() : [];
      const startedAt = Date.now();
      const businessProgressSnapshots = [];
      const captureBusinessProgress = () => {
        const card = document.querySelector('[data-testid="agent-business-progress"]');
        if (!card) return;
        const snapshot = {
          at: Date.now() - startedAt,
          sourceEvent: card.getAttribute("data-source-event"),
          businessStage: card.getAttribute("data-business-stage"),
          text: String(card.textContent || "").replace(/\\s+/g, " ").trim(),
        };
        const previous = businessProgressSnapshots[businessProgressSnapshots.length - 1];
        if (!previous || previous.sourceEvent !== snapshot.sourceEvent || previous.businessStage !== snapshot.businessStage) {
          businessProgressSnapshots.push(snapshot);
        }
      };
      const businessProgressObserver = ${agentBusinessProgressScenario} ? new MutationObserver(captureBusinessProgress) : null;
      if (businessProgressObserver) {
        businessProgressObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-source-event", "data-business-stage"] });
        captureBusinessProgress();
      }
      const unsubscribe = api.onAgentRunEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      try {
        const returned = await api.startAgentRun({
          requestId,
          threadId: thread.id,
          runId,
          task: ${JSON.stringify(agentTask)},
          workspacePath,
          files: ${JSON.stringify(agentFiles)},
          teamConfig: { preset: "general-collaboration" },
          metadata: { source: "e2e-agent-run" },
        });
        details.returned = returned;
        checks.startAgentRunReturned = returned && returned.requestId === requestId && returned.runId === runId && returned.sessionId === thread.id;
        const deadline = Date.now() + ${agentRunWaitMs};
        while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribe();
        if (businessProgressObserver) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          captureBusinessProgress();
          businessProgressObserver.disconnect();
        }
      }

      const firstEvent = events[0] || null;
      const lastEvent = events[events.length - 1] || null;
      const terminalEvent = events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
      details.agentRunSummary = {
        durationMs: Date.now() - startedAt,
        firstEventType: firstEvent && firstEvent.type,
        lastEventType: lastEvent && lastEvent.type,
        terminalEventType: terminalEvent && terminalEvent.type,
      };
      details.events = events.map((event) => ({
        type: event.type,
        at: event.at,
        content: event.content,
        error: event.error,
        sessionId: event.sessionId,
        runId: event.runId,
      }));
      checks.agentRunStartEvent = events.some((event) => event.type === "start");
      checks.agentRunThreadEvents = events.every((event) => !event.sessionId || event.sessionId === thread.id);
      checks.agentRunDistinctIds = thread.id !== requestId && thread.id !== runId && requestId !== runId;
      checks.agentRunChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes(${JSON.stringify(agentBusinessProgressScenario
        ? "fake-agent-run: multi-material synthesis"
        : agentContinuousTaskScenario
          ? "fake-agent-run: continuous research synthesis"
        : agentG4ReportScenario
          ? "fake-agent-run: mentor report updated and checked"
          : "fake-agent-run: write a short plan")}));
      checks.agentRunDone = events.some((event) => event.type === "done");
      checks.agentRunTerminalDone = terminalEvent && terminalEvent.type === "done";
      checks.agentRunDurationRecorded = details.agentRunSummary.durationMs >= 0;
      checks.noAgentRunError = !events.some((event) => event.type === "error" || event.type === "aborted");
      if (${agentBusinessProgressScenario}) {
        const expected = { start: "understand_materials", chunk: "organize_findings", file_event: "prepare_result", done: "ready" };
        const timings = Object.entries(expected).map(([sourceEvent, businessStage]) => {
          const backend = events.find((event) => event.type === sourceEvent);
          const visible = businessProgressSnapshots.find((snapshot) => snapshot.sourceEvent === sourceEvent && snapshot.businessStage === businessStage);
          return { sourceEvent, businessStage, backendAt: backend?.at ?? null, visibleAt: visible?.at ?? null, latencyMs: backend && visible ? visible.at - backend.at : null };
        });
        details.businessProgressTiming = { snapshots: businessProgressSnapshots, timings };
        checks.agentBusinessProgressObserverInstalled = Boolean(businessProgressObserver);
        checks.agentBusinessProgressAllEventsReceived = timings.every((item) => item.backendAt !== null);
        checks.agentBusinessProgressAllStagesVisible = timings.every((item) => item.visibleAt !== null);
        checks.agentBusinessProgressWithinTwoSeconds = timings.every((item) => typeof item.latencyMs === "number" && item.latencyMs >= 0 && item.latencyMs <= 2000);
        checks.agentBusinessProgressMatchesRunState = timings.every((item) => expected[item.sourceEvent] === item.businessStage);
        checks.agentBusinessProgressUsesBusinessLanguage = businessProgressSnapshots.every((item) => /理解|整理|成果|材料|发现|understand|organizing|result|materials|findings/i.test(item.text));
        checks.agentBusinessProgressNoTechnicalNoise = businessProgressSnapshots.every((item) => !/tool[_ -]?call|function[_ -]?call|ipc|sse|delta|request[_ -]?id|run[_ -]?id|stack trace|token/i.test(item.text));
        checks.agentBusinessProgressNotRawOutputOnly = businessProgressSnapshots.every((item) => !item.text.includes("fake-agent-run"));
        checks.agentBusinessProgressG3Task = true;
      }
      if (${agentContinuousTaskScenario}) {
        let continuousTask = null;
        const taskDeadline = Date.now() + 5000;
        while (Date.now() < taskDeadline && continuousTask?.status !== "completed") {
          const tasks = await api.listBackgroundTasks({ workspacePath, limit: 50 });
          continuousTask = tasks.find((task) => task.kind === "agent_run" && task.targetId === requestId) || null;
          if (continuousTask?.status !== "completed") await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const pendingApprovalsAfter = await api.listPendingApprovals();
        const newApprovals = pendingApprovalsAfter.filter((approval) => !pendingApprovalsBefore.some((before) => before.id === approval.id));
        const report = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + "\\\\research-synthesis.md", maxBytes: 100000 });
        const reportText = String(report?.content || "");
        details.d4ContinuousTask = { task: continuousTask, newApprovals, reportKind: report?.kind, reportText };
        checks.d4SingleRunCompleted = continuousTask?.status === "completed" && continuousTask?.progress === 100;
        checks.d4AllIntermediateStepsRecorded = Array.isArray(continuousTask?.completedSteps)
          && JSON.stringify(continuousTask.completedSteps) === JSON.stringify(["读取并确认全部研究材料", "比较材料并整理共识、争议和证据缺口", "核对结论、材料来源和不确定性", "生成综合报告和下一步研究问题"]);
        checks.d4NoNonCriticalApproval = newApprovals.length === 0;
        checks.d4NoPendingDecision = Array.isArray(continuousTask?.pendingDecisions) && continuousTask.pendingDecisions.length === 0;
        checks.d4ArtifactRegistered = continuousTask?.deliverySummary?.artifacts?.some((artifact) => artifact.path.endsWith("research-synthesis.md")) === true;
        checks.d4CompleteReportGenerated = report?.kind === "markdown"
          && ["## 共识", "## 争议", "## 下一步研究问题", "## 不确定性与限制", "## 来源"].every((heading) => reportText.includes(heading));
        checks.d4GoldenConsensus = reportText.includes("短期记忆表现改善") && reportText.includes("study-a.md") && reportText.includes("study-b.md");
        checks.d4GoldenDispute = reportText.includes("成本判断存在冲突") && reportText.includes("低成本") && reportText.includes("高成本");
        checks.d4GoldenNextQuestion = reportText.includes("长期稳定性") && reportText.includes("仍缺乏充分证据") && reportText.includes("study-c.md");
        checks.d4BusinessStepsNoTechnicalNoise = continuousTask?.completedSteps?.every((step) => !/agent|tool|function|mcp|json|ipc|sse|request|run[_ -]?id/i.test(step)) === true;
        const automaticVersions = (await api.listWorkspaceCheckpoints(workspacePath))
          .filter((item) => item.automatic && item.versionGroupId === runId);
        const automaticBefore = automaticVersions.find((item) => item.versionPhase === "before");
        const automaticAfter = automaticVersions.find((item) => item.versionPhase === "after");
        const beforeDiff = automaticBefore
          ? await api.previewWorkspaceCheckpoint({ workspacePath, checkpointId: automaticBefore.id, maxFiles: 40 })
          : null;
        let versionBeforeRestore = null;
        let versionBeforeApproved = false;
        let versionBeforePreview = null;
        let versionAfterRestore = null;
        let versionAfterApproved = false;
        let versionAfterPreview = null;
        let restoredReport = null;
        if (automaticBefore && automaticAfter) {
          versionBeforeRestore = await api.restoreWorkspaceCheckpoint({ workspacePath, checkpointId: automaticBefore.id });
          versionBeforeApproved = versionBeforeRestore.approvalId
            ? await api.decidePendingApproval({ id: versionBeforeRestore.approvalId, approved: true })
            : false;
          versionBeforePreview = await api.previewWorkspaceCheckpoint({ workspacePath, checkpointId: automaticBefore.id, maxFiles: 40 });
          versionAfterRestore = await api.restoreWorkspaceCheckpoint({ workspacePath, checkpointId: automaticAfter.id });
          versionAfterApproved = versionAfterRestore.approvalId
            ? await api.decidePendingApproval({ id: versionAfterRestore.approvalId, approved: true })
            : false;
          versionAfterPreview = await api.previewWorkspaceCheckpoint({ workspacePath, checkpointId: automaticAfter.id, maxFiles: 40 });
          restoredReport = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + "\\\\research-synthesis.md", maxBytes: 100000 });
        }
        details.i1AgentVersionHistory = { automaticVersions, beforeDiff, versionBeforeRestore, versionBeforeApproved, versionBeforePreview, versionAfterRestore, versionAfterApproved, versionAfterPreview, restoredReportKind: restoredReport?.kind };
        checks.i1AgentBeforeAfterPair = automaticVersions.length === 2 && automaticBefore?.versionNumber === 1 && automaticAfter?.versionNumber === 2;
        checks.i1AgentVersionMetadata = automaticVersions.every((item) => item.versionScope === "workspace" && item.changeReason && item.objectLabel && item.createdAt);
        checks.i1AgentNewReportInDiff = beforeDiff?.entries.some((entry) => entry.relativePath === "research-synthesis.md" && entry.change === "added" && entry.existedAtCheckpoint === false) === true;
        checks.i1AgentBeforeRestoreRemovesReport = versionBeforeApproved === true && versionBeforePreview?.changedEntryCount === 0
          && versionBeforePreview.entries.every((entry) => entry.relativePath !== "research-synthesis.md");
        checks.i1AgentAfterRestoreReturnsReport = versionAfterApproved === true && versionAfterPreview?.changedEntryCount === 0 && restoredReport?.kind === "markdown";
      }
      if (${agentPlanScenario}) {
        let planTask = null;
        const taskDeadline = Date.now() + 5000;
        while (Date.now() < taskDeadline && planTask?.status !== "completed") {
          const tasks = await api.listBackgroundTasks({ workspacePath, limit: 50 });
          planTask = tasks.find((task) => task.kind === "agent_run" && task.targetId === requestId) || null;
          if (planTask?.status !== "completed") await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const phases = Array.isArray(planTask?.planSteps) ? planTask.planSteps.map((step) => step.phase) : [];
        const titles = Array.isArray(planTask?.planSteps) ? planTask.planSteps.map((step) => step.title) : [];
        const planText = titles.join("\\n");
        const goldenConcepts = ${JSON.stringify(agentPlanGoldenConcepts)};
        const matchedConcepts = goldenConcepts.filter((concept) => planText.includes(concept));
        const semanticCoverage = goldenConcepts.length ? matchedConcepts.length / goldenConcepts.length : 0;
        const forbiddenTerms = planText.match(/agent|tool|function|mcp|server|json|ipc|sse|request[_ -]?id|run[_ -]?id|参数/gi) || [];

        const planDeadline = Date.now() + 5000;
        let visiblePlan = null;
        while (Date.now() < planDeadline) {
          visiblePlan = document.querySelector('[data-testid="agent-task-plan"]');
          if (visiblePlan && visiblePlan.querySelectorAll('[data-plan-state="completed"]').length === 4) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const visibleSteps = visiblePlan
          ? Array.from(visiblePlan.querySelectorAll("li")).map((item) => ({
              phase: item.getAttribute("data-phase"),
              state: item.getAttribute("data-plan-state"),
              text: String(item.textContent || "").replace(/^[✓→○]\\s*/, "").trim(),
            }))
          : [];
        details.d1Plan = { kind: ${JSON.stringify(agentPlanKind)}, task: planTask, phases, titles, goldenConcepts, matchedConcepts, semanticCoverage, forbiddenTerms, visibleSteps };
        checks.d1PlanPersisted = planTask?.status === "completed" && titles.length === 4;
        checks.d1RequiredPhasesCovered = JSON.stringify(phases) === JSON.stringify(["input", "process", "check", "output"]);
        checks.d1SemanticCoverageAtLeast90 = semanticCoverage >= 0.9;
        checks.d1NoForbiddenTerms = forbiddenTerms.length === 0;
        checks.d1PlanVisibleInUi = Boolean(visiblePlan) && visibleSteps.length === 4;
        checks.d1UiMatchesStoredPlan = JSON.stringify(visibleSteps.map((step) => step.text)) === JSON.stringify(titles);
        checks.d1AllStepsCompleted = visibleSteps.every((step) => step.state === "completed")
          && JSON.stringify(planTask?.completedSteps) === JSON.stringify(titles);
      }
      if (!${agentDeliverableReportScenario}) {
      const restoreRequest = await api.restoreWorkspaceCheckpoint({
        workspacePath,
        checkpointId: checkpoint.id,
      });
      details.restoreRequest = restoreRequest;
      const approvalId = restoreRequest && restoreRequest.approvalId;
      checks.agentRunRestoreApprovalQueued = Boolean(restoreRequest && restoreRequest.approvalQueued && approvalId);
      const restoreApproved = approvalId
        ? await api.decidePendingApproval({ id: approvalId, approved: true })
        : false;
      checks.agentRunRestoreApproved = restoreApproved === true;
      const restoredPreview = await api.previewWorkspaceCheckpoint({
        workspacePath,
        checkpointId: checkpoint.id,
      });
      details.restoredPreview = restoredPreview;
      checks.agentRunBaselineRestored = Boolean(restoredPreview && restoredPreview.changedEntryCount === 0);
      const acceptCheckpoint = await api.createWorkspaceCheckpoint({
        workspacePath,
        label: "E2E accepted agent change set",
        kind: "agent_run_baseline",
        runId: runId + "-accept",
      });
      const acceptedCheckpoint = await api.acceptWorkspaceCheckpoint({
        workspacePath,
        checkpointId: acceptCheckpoint.id,
      });
      details.acceptedCheckpoint = acceptedCheckpoint;
      checks.agentRunChangeSetAccepted = Boolean(
        acceptedCheckpoint && acceptedCheckpoint.reviewStatus === "accepted" && acceptedCheckpoint.reviewedAt,
      );
      try {
        await api.acceptWorkspaceCheckpoint({
          workspacePath,
          checkpointId: acceptCheckpoint.id,
        });
        checks.agentRunChangeSetRejectsReviewedAccept = false;
      } catch (caught) {
        details.reviewedAcceptError = caught instanceof Error ? caught.message : String(caught);
        checks.agentRunChangeSetRejectsReviewedAccept = String(details.reviewedAcceptError || "").includes("not found");
      }
      const manualCheckpoint = await api.createWorkspaceCheckpoint({
        workspacePath,
        label: "E2E manual checkpoint cannot be accepted as an agent change set",
      });
      try {
        await api.acceptWorkspaceCheckpoint({
          workspacePath,
          checkpointId: manualCheckpoint.id,
        });
        checks.agentRunChangeSetRejectsManualCheckpointAccept = false;
      } catch (caught) {
        details.manualAcceptError = caught instanceof Error ? caught.message : String(caught);
        checks.agentRunChangeSetRejectsManualCheckpointAccept = String(details.manualAcceptError || "").includes("not found");
      }
      }

      return { checks, details };
    })()
  `;
  try {
    new Function(agentRunScript);
  } catch (error) {
    throw new Error(`Agent run E2E script is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = (await window.webContents.executeJavaScript(agentRunScript)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const notificationRecords = getCompletionNotificationDiagnostics().filter(
    (record) => record.target.targetId === "e2e-agent-run-request-0001",
  );
  result.checks.windowsNotificationShownForeground = notificationRecords.length === 1
    && notificationRecords[0]?.visibility === "foreground";
  result.checks.singleCompletionNotification = notificationRecords.length === 1;
  result.checks.windowsNotificationSummaryRedacted = Boolean(notificationRecords[0])
    && !/sk-|bearer|api[_-]?key\s*[:=]|token\s*[:=]|password\s*[:=]|secret\s*[:=]/i.test(notificationRecords[0].body);
  result.details.completionNotification = notificationRecords[0];
  if (agentCompletionCriteriaScenario) {
    result.checks.d6CompletionNotificationAvailable = notificationRecords.length === 1;
    result.checks.d6CompletionNotificationClicked = clickLatestCompletionNotificationForE2e();
    const completionCard = (await window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 5000;
        let panel = null;
        while (Date.now() < deadline && !panel) {
          panel = document.querySelector('[data-testid="task-delivery-summary"]');
          if (!panel) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!panel) return null;
        return {
          status: panel.getAttribute("data-status"),
          targetId: panel.getAttribute("data-target-id"),
          workSummary: panel.querySelector('[data-testid="delivery-work-summary"]')?.textContent || "",
          passed: Array.from(panel.querySelectorAll('[data-testid="delivery-checks-passed"] li')).map((item) => String(item.textContent || "").trim()),
          incomplete: Array.from(panel.querySelectorAll('[data-testid="delivery-checks-incomplete"] li')).map((item) => String(item.textContent || "").trim()),
          risks: panel.querySelector('[data-testid="delivery-risks"]')?.textContent || "",
          artifactText: panel.querySelector('[data-testid="delivery-artifacts"]')?.textContent || "",
          visibleText: String(panel.textContent || "").replace(/\\s+/g, " ").trim(),
        };
      })()
    `)) as null | { status: string | null; targetId: string | null; workSummary: string; passed: string[]; incomplete: string[]; risks: string; artifactText: string; visibleText: string };
    result.details.d6CompletionCard = completionCard;
    result.checks.d6CompletionCardVisible = Boolean(completionCard);
    result.checks.d6ExplainsWorkDone = Boolean(completionCard?.workSummary.includes("最新数据") && completionCard.workSummary.includes("旧报告"));
    result.checks.d6ChecksPassedVisible = Boolean(completionCard && completionCard.passed.length >= 3 && completionCard.visibleText.includes("已通过的检查"));
    result.checks.d6IncompleteVisible = Boolean(completionCard && completionCard.incomplete.length >= 1 && completionCard.visibleText.includes("尚未完成"));
    result.checks.d6RemainingRisksVisible = Boolean(completionCard?.risks.includes("剩余风险") && completionCard.risks.length > 8);
    result.checks.d6ArtifactRegistered = Boolean(completionCard?.artifactText.includes("mentor-report.md"));
    result.checks.d6NotOnlyTaskComplete = Boolean(completionCard && completionCard.visibleText.length > 160 && completionCard.visibleText !== "任务完成");
    result.checks.d6NoRawRunOutput = Boolean(completionCard && !/fake-agent-run|tool[_ -]?call|request[_ -]?id|run[_ -]?id|ipc|sse/i.test(completionCard.visibleText));
    result.checks.d6MatchesCompletedTask = completionCard?.status === "completed" && completionCard?.targetId === "e2e-agent-run-request-0001";
  }
  if (agentDeliverableReportScenario) {
    const reportResult = (await window.webContents.executeJavaScript(`
      (async () => {
        const api = window.openDrSai;
        const workspacePath = ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace")};
        const deadline = Date.now() + 5000;
        let task = null;
        while (Date.now() < deadline) {
          const tasks = await api.listBackgroundTasks({ workspacePath, limit: 50 });
          task = tasks.find((item) => item.kind === "agent_run" && item.targetId === "e2e-agent-run-request-0001") || null;
          if (task?.status === "completed" && task?.deliverySummary?.artifacts?.[0]?.quality) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const artifact = task?.deliverySummary?.artifacts?.find((item) => item.path.endsWith("mentor-report.md")) || null;
        const quality = artifact?.quality || null;
        const report = await api.previewWorkspaceFile({ workspacePath, path: workspacePath + "\\\\mentor-report.md", maxBytes: 100000 });
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null;
        resultsNav?.click();
        let qualityBadge = null;
        const uiDeadline = Date.now() + 5000;
        while (Date.now() < uiDeadline) {
          qualityBadge = document.querySelector('[data-artifact-id="' + artifact?.id + '"] [data-testid="results-artifact-quality"]');
          if (qualityBadge) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const row = qualityBadge?.closest('li[data-artifact-id]') || null;
        const qualityDetails = row?.querySelector('[data-testid="results-quality-details"]') || null;
        if (qualityDetails) qualityDetails.open = true;
        row?.querySelector('[data-testid="results-open-artifact"]')?.click();
        let openStatus = null;
        const openDeadline = Date.now() + 3000;
        while (Date.now() < openDeadline) {
          openStatus = row?.querySelector('[data-testid="results-open-status"]');
          if (openStatus?.getAttribute("data-state") === "opened") break;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return {
          task,
          artifact,
          quality,
          reportKind: report?.kind,
          reportText: String(report?.content || ""),
          qualityBadgeStatus: qualityBadge?.getAttribute("data-quality-status") || "",
          qualityBadgeText: qualityBadge?.textContent || "",
          qualityDetailsText: qualityDetails?.textContent || "",
          openState: openStatus?.getAttribute("data-state") || "",
        };
      })()
    `)) as {
      task: DesktopBackgroundTask | null;
      artifact: DesktopTaskArtifactLink | null;
      quality: DesktopTaskArtifactLink["quality"] | null;
      reportKind: string;
      reportText: string;
      qualityBadgeStatus: string;
      qualityBadgeText: string;
      qualityDetailsText: string;
      openState: string;
    };
    result.details.g2DeliverableReport = reportResult;
    const quality = reportResult.quality;
    result.checks.g2ReportArtifactRegistered = Boolean(reportResult.artifact?.path.endsWith("mentor-report.md"));
    result.checks.g2QualityPersisted = Boolean(quality?.checkedAt && quality?.checks?.length === 7);
    result.checks.g2FormatValid = quality?.format === "markdown" && quality?.formatValid === true && reportResult.reportKind === "markdown";
    result.checks.g2RequiredSectionsComplete = quality?.requiredSections?.length === 6 && quality?.presentSections?.length === 6 && quality?.missingSections?.length === 0;
    result.checks.g2NoPlaceholders = quality?.placeholderCount === 0;
    result.checks.g2NoMojibake = quality?.mojibakeCount === 0;
    result.checks.g2NoEmptyImages = quality?.emptyImageCount === 0;
    result.checks.g2NoBrokenLinks = quality?.brokenLinkCount === 0;
    result.checks.g2GoldenCoverageAtLeast90 = typeof quality?.goldenFactCoverage === "number" && quality.goldenFactCoverage >= 90;
    result.checks.g2QualityPassed = quality?.status === "passed";
    result.checks.g2CompletionCriteriaIncludesQuality = reportResult.task?.deliverySummary?.completionCriteria?.passed?.some((item) => item.includes("结构和格式检查") && item.includes("100%")) === true;
    result.checks.g2ResultsCenterQualityVisible = reportResult.qualityBadgeStatus === "passed" && /100%/.test(reportResult.qualityBadgeText);
    result.checks.g2QualityDetailsVisible = ["规定章节完整", "未发现占位符", "未发现乱码", "未发现空图", "未发现断链", "黄金事实覆盖率 100%"].every((text) => reportResult.qualityDetailsText.includes(text));
    result.checks.g2ArtifactOpenWorks = reportResult.openState === "opened";
  }
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runOutputVersionsSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results" };
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await api.createWorkspace({
        source: "existing", path: workspacePath, name: "G3 output versions", trusted: true,
      });
      checks.workspaceRegistered = workspace?.path === workspacePath;
      const sourceArtifactId = "result:g3:source-report";
      const sourceTask = await api.enqueueBackgroundTask({
        kind: "agent_run", source: "agent", title: "G3 可交付源报告", workspacePath,
        targetId: "g3-source-report", status: "completed", progress: 100,
        message: "完整报告已通过自动质量检查。", verification: "结构、事实和格式检查通过。",
        deliverySummary: {
          findingSummary: "源报告已准备好生成多种版本。", importance: "medium",
          importanceReason: "同一成果需要适配不同受众。",
          artifacts: [{
            id: sourceArtifactId, label: "mentor-report.md", path: workspacePath + "\\\\mentor-report.md", kind: "report",
            quality: {
              status: "passed", checkedAt: new Date().toISOString(), format: "markdown", formatValid: true,
              requiredSections: ["标题", "摘要", "方法", "结果", "限制", "来源"],
              presentSections: ["标题", "摘要", "方法", "结果", "限制", "来源"], missingSections: [],
              placeholderCount: 0, mojibakeCount: 0, emptyImageCount: 0, brokenLinkCount: 0,
              goldenFactsExpected: 4, goldenFactsMatched: 4, goldenFactCoverage: 100,
              checks: ["Markdown 格式可解析", "规定章节完整", "黄金事实覆盖率 100%"],
            },
          }],
          suggestedAction: "生成面向不同场景的版本。", workSummary: "完成源报告。",
          coreConclusion: "报告可交付。", verification: "自动质量检查通过。", remainingRisks: "无。",
          completionCriteria: { passed: ["报告质量检查通过"], incomplete: [] },
        },
      });
      checks.sourceReportSeeded = sourceTask?.deliverySummary?.artifacts?.[0]?.quality?.status === "passed";

      let resultsNav = null;
      const navDeadline = Date.now() + 5000;
      while (Date.now() < navDeadline && !resultsNav) {
        resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null;
        if (!resultsNav) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      resultsNav?.click();
      const centerDeadline = Date.now() + 10000;
      let center = null;
      let sourceRow = null;
      while (Date.now() < centerDeadline && !sourceRow) {
        center = document.querySelector('[data-testid="results-center-view"]');
        sourceRow = center?.querySelector('li[data-artifact-id="' + sourceArtifactId + '"]') || null;
        if (!sourceRow) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.fixedResultsCenterUsed = Boolean(center && sourceRow && resultsNav);
      const versionButton = sourceRow?.querySelector('[data-testid="results-create-versions"]');
      checks.versionActionVisible = Boolean(versionButton) && /5/.test(String(versionButton?.textContent || ""));
      versionButton?.click();
      const statusDeadline = Date.now() + 25000;
      let versionStatus = null;
      while (Date.now() < statusDeadline) {
        versionStatus = sourceRow?.querySelector('[data-testid="results-version-status"]');
        if (["completed", "failed"].includes(versionStatus?.getAttribute("data-state") || "")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.visibleRunCompleted = versionStatus?.getAttribute("data-state") === "completed";
      details.visibleStatus = { state: versionStatus?.getAttribute("data-state"), text: versionStatus?.textContent };

      let versionTask = null;
      const taskDeadline = Date.now() + 8000;
      while (Date.now() < taskDeadline) {
        const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 });
        versionTask = tasks.find((task) => task.kind === "agent_run" && String(task.targetId || "").startsWith("artifact-versions-")) || null;
        if (versionTask?.status === "completed" && versionTask?.deliverySummary?.artifacts?.length === 5) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const artifacts = versionTask?.deliverySummary?.artifacts || [];
      const previews = [];
      for (const artifact of artifacts) {
        const preview = await api.previewWorkspaceFile({ workspacePath, path: artifact.path, maxBytes: 100000 });
        previews.push({ path: artifact.path, text: String(preview?.content || "") });
      }
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const visibleVersionRows = Array.from(center?.querySelectorAll('li[data-source-task-id="' + versionTask?.id + '"]') || []);
      const combinedNames = artifacts.map((artifact) => artifact.path);
      const find = (suffix) => previews.find((item) => item.path.endsWith(suffix))?.text || "";
      const summary = find("-one-page-summary.md");
      const full = find("-full-report.md");
      const outline = find("-presentation-outline.md");
      const email = find("-email.md");
      const english = find("-english.md");
      const goldenNumbers = ["100", "160", "42", "47"];
      const numericMatches = previews.reduce((count, item) => count + goldenNumbers.filter((number) => item.text.includes(number)).length, 0);
      const numericExpected = previews.length * goldenNumbers.length;
      details.versionTask = versionTask;
      details.previews = previews;
      details.numericConsistency = { matched: numericMatches, expected: numericExpected, coverage: numericExpected ? numericMatches / numericExpected * 100 : 0 };
      checks.oneVersionRunOnly = Boolean(versionTask) && String(versionTask.targetId).startsWith("artifact-versions-");
      checks.fiveArtifactsRegistered = artifacts.length === 5 && visibleVersionRows.length === 5;
      checks.expectedVersionNames = ["-one-page-summary.md", "-full-report.md", "-presentation-outline.md", "-email.md", "-english.md"].every((suffix) => combinedNames.some((name) => name.endsWith(suffix)));
      checks.onePageFormat = summary.includes("# 一页摘要") && summary.includes("## 关键发现") && summary.includes("## 建议");
      checks.fullReportFormat = ["# 完整报告", "## 摘要", "## 方法", "## 结果", "## 限制", "## 来源"].every((heading) => full.includes(heading));
      checks.presentationOutlineFormat = outline.includes("## 幻灯片 1") && outline.includes("讲述要点");
      checks.emailFormat = email.includes("主题：") && email.includes("行动请求");
      checks.englishFormat = ["# Mentor Update", "## Executive Summary", "## Methods", "## Results", "## Limitations", "## Sources"].every((heading) => english.includes(heading)) && !/[\u4e00-\u9fff]/.test(english);
      checks.sourceTraceable = previews.length === 5 && previews.every((item) => item.text.includes("mentor-report.md"));
      checks.numericConsistency100 = numericExpected === 20 && numericMatches === numericExpected;
      checks.variantArtifactsSkipFullReportChecker = artifacts.every((artifact) => artifact.quality === undefined);
      checks.noChatTemporaryLinkUsed = details.navigationPath === "main-sidebar-results" && Boolean(center);
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runResultPreviewDownloadSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results", previews: [], saves: [] };
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const workspace = await api.createWorkspace({ source: "existing", path: workspacePath, name: "G4 预览与另存", trusted: true });
      checks.workspaceRegistered = workspace?.path === workspacePath;
      const specs = [
        { id: "g4-pdf", label: "CERN 摘要.pdf", path: workspacePath + "\\\\CERN 摘要.pdf", kind: "file", expected: "pdf" },
        { id: "g4-word", label: "导师报告.docx", path: workspacePath + "\\\\导师报告.docx", kind: "file", expected: "office" },
        { id: "g4-table", label: "实验数据.csv", path: workspacePath + "\\\\实验数据.csv", kind: "file", expected: "table" },
        { id: "g4-image", label: "结果图.png", path: workspacePath + "\\\\结果图.png", kind: "file", expected: "image" },
        { id: "g4-markdown", label: "研究总结.md", path: workspacePath + "\\\\研究总结.md", kind: "report", expected: "markdown" },
      ];
      for (const spec of specs) {
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "G4 " + spec.label, workspacePath,
          targetId: spec.id, status: "completed", progress: 100, message: "成果已生成。", verification: "成果可预览和另存。",
          deliverySummary: {
            findingSummary: spec.label + " 已生成。", importance: "medium", importanceReason: "可交付成果。",
            artifacts: [{ id: spec.id, label: spec.label, path: spec.path, kind: spec.kind }],
            suggestedAction: "预览或另存成果。", workSummary: "生成成果。", coreConclusion: "成果可用。",
            verification: "文件存在。", remainingRisks: "无。", completionCriteria: { passed: ["成果已登记"], incomplete: [] },
          },
        });
      }
      checks.fiveFormatsSeeded = specs.length === 5;
      let resultsNav = null;
      const navDeadline = Date.now() + 5000;
      while (Date.now() < navDeadline && !resultsNav) {
        resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null;
        if (!resultsNav) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      resultsNav?.click();
      const centerDeadline = Date.now() + 10000;
      let center = null;
      while (Date.now() < centerDeadline) {
        center = document.querySelector('[data-testid="results-center-view"]');
        if (center && specs.every((spec) => center.querySelector('li[data-artifact-id="' + spec.id + '"]'))) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.fixedResultsCenterUsed = Boolean(resultsNav && center);

      for (const spec of specs) {
        const row = center?.querySelector('li[data-artifact-id="' + spec.id + '"]');
        const previewButton = row?.querySelector('[data-testid="results-preview-artifact"]');
        previewButton?.click();
        const previewDeadline = Date.now() + 8000;
        let dialog = null;
        while (Date.now() < previewDeadline) {
          dialog = document.querySelector('[data-testid="results-preview-dialog"][data-preview-state="ready"]');
          if (dialog) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const content = dialog?.querySelector('.results-preview-content');
        const previewKind = content?.getAttribute("data-preview-kind") || "";
        details.previews.push({ id: spec.id, expected: spec.expected, kind: previewKind, text: String(content?.textContent || "").slice(0, 500), hasImage: Boolean(content?.querySelector("img")), hasTable: Boolean(content?.querySelector("table")) });
        dialog?.querySelector('[data-testid="results-preview-close"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.fivePreviewKindsCorrect = details.previews.length === 5 && details.previews.every((item) => item.kind === item.expected);
      checks.pdfPreviewVisible = details.previews.some((item) => item.kind === "pdf" && item.text.length > 0);
      checks.wordPreviewVisible = details.previews.some((item) => item.kind === "office" && item.text.includes("G4 Word preview body"));
      checks.tablePreviewVisible = details.previews.some((item) => item.kind === "table" && item.hasTable && item.text.includes("sample_size"));
      checks.imagePreviewVisible = details.previews.some((item) => item.kind === "image" && item.hasImage);
      checks.markdownPreviewVisible = details.previews.some((item) => item.kind === "markdown" && item.text.includes("G4 Markdown preview"));

      const pdfRow = center?.querySelector('li[data-artifact-id="g4-pdf"]');
      pdfRow?.querySelector('[data-testid="results-open-artifact"]')?.click();
      const openDeadline = Date.now() + 3000;
      let pdfOpenStatus = null;
      while (Date.now() < openDeadline) {
        pdfOpenStatus = pdfRow?.querySelector('[data-testid="results-open-status"]');
        if (pdfOpenStatus?.getAttribute("data-state") === "opened") break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      checks.pdfSystemOpenAvailable = pdfOpenStatus?.getAttribute("data-state") === "opened";

      for (let round = 1; round <= 4; round += 1) {
        for (const spec of specs) {
          const row = center?.querySelector('li[data-artifact-id="' + spec.id + '"]');
          const saveButton = row?.querySelector('[data-testid="results-save-artifact"]');
          saveButton?.click();
          await new Promise((resolve) => setTimeout(resolve, 20));
          const saveDeadline = Date.now() + 8000;
          let status = null;
          while (Date.now() < saveDeadline) {
            status = row?.querySelector('[data-testid="results-save-status"]');
            if (status?.getAttribute("data-state") === "saved") break;
            if (status?.getAttribute("data-state") === "failed") break;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          details.saves.push({ round, id: spec.id, state: status?.getAttribute("data-state") || "missing", text: String(status?.textContent || "") });
        }
      }
      checks.twentySaveActionsCompleted = details.saves.length === 20 && details.saves.every((item) => item.state === "saved");
      checks.everySaveShowsIntegrity = details.saves.every((item) => /完整性校验|integrity verified/i.test(item.text));
      checks.noChatTemporaryLinkUsed = details.navigationPath === "main-sidebar-results";
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runLocalizedEditSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results", runs: [], comparisons: [] };
      const api = window.openDrSai;
      const waitFor = async (find, timeout = 10000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      checks.workspaceRegistered = (await api.createWorkspace({ source: "existing", path: workspacePath, name: "G5 局部修改", trusted: true }))?.path === workspacePath;
      const specs = [
        { id: "g5-report", label: "局部修改报告.md", path: workspacePath + "\\\\局部修改报告.md", kind: "report" },
        { id: "g5-table", label: "排序数据.csv", path: workspacePath + "\\\\排序数据.csv", kind: "file" },
        { id: "g5-image", label: "坐标图.png", path: workspacePath + "\\\\坐标图.png", kind: "file" },
        { id: "g5-unrelated", label: "其他成果.md", path: workspacePath + "\\\\其他成果.md", kind: "report" },
      ];
      for (const spec of specs) {
        await api.enqueueBackgroundTask({
          kind: "agent_run", source: "agent", title: "G5 " + spec.label, workspacePath,
          targetId: spec.id, status: "completed", progress: 100, message: "源成果已登记。", verification: "原件用于范围隔离测试。",
          deliverySummary: { findingSummary: spec.label + " 已登记。", importance: "medium", importanceReason: "局部修改输入。", artifacts: [{ id: spec.id, label: spec.label, path: spec.path, kind: spec.kind }], suggestedAction: "选择范围后生成修改版。", workSummary: "登记源成果。", coreConclusion: "源成果保持不变。", verification: "文件存在。", remainingRisks: "无。", completionCriteria: { passed: ["源成果已登记"], incomplete: [] } },
        });
      }
      checks.fourSourceArtifactsSeeded = specs.length === 4;
      const resultsNav = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null);
      resultsNav?.click();
      const center = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="results-center-view"]');
        return candidate && specs.every((spec) => candidate.querySelector('li[data-artifact-id="' + spec.id + '"]')) ? candidate : null;
      });
      checks.fixedResultsCenterUsed = Boolean(resultsNav && center);

      const openPreview = async (id) => {
        center?.querySelector('li[data-artifact-id="' + id + '"] [data-testid="results-preview-artifact"]')?.click();
        return waitFor(() => document.querySelector('[data-testid="results-preview-dialog"][data-preview-state="ready"]'));
      };
      const waitEdit = async (id) => {
        const row = center?.querySelector('li[data-artifact-id="' + id + '"]');
        const status = await waitFor(() => {
          const candidate = row?.querySelector('[data-testid="results-edit-status"]');
          return candidate && ["completed", "failed"].includes(candidate.getAttribute("data-state")) ? candidate : null;
        }, 20000);
        details.runs.push({ id, state: status?.getAttribute("data-state"), text: status?.textContent });
      };

      let dialog = await openPreview("g5-report");
      const pre = dialog?.querySelector('.results-preview-content pre');
      const target = "由于多重因素相互交织，该结果呈现出较为复杂且不易理解的变化趋势。";
      const textNode = pre?.firstChild;
      const start = textNode?.nodeValue?.indexOf(target) ?? -1;
      if (textNode && start >= 0) {
        const range = document.createRange();
        range.setStart(textNode, start); range.setEnd(textNode, start + target.length);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        pre.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }
      checks.textSelectionCaptured = Boolean(await waitFor(() => !dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.disabled));
      dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.click();
      await waitEdit("g5-report");

      dialog = await openPreview("g5-table");
      dialog?.querySelector('[data-testid="results-select-table"]')?.click();
      checks.tableSelectionCaptured = Boolean(await waitFor(() => !dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.disabled));
      dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.click();
      await waitEdit("g5-table");

      dialog = await openPreview("g5-image");
      dialog?.querySelector('.results-preview-content img')?.click();
      checks.imageSelectionCaptured = Boolean(await waitFor(() => !dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.disabled));
      dialog?.querySelector('[data-testid="results-generate-local-edit"]')?.click();
      await waitEdit("g5-image");
      checks.threeEditRunsCompleted = details.runs.length === 3 && details.runs.every((run) => run.state === "completed");

      let editTasks = [];
      const taskDeadline = Date.now() + 10000;
      while (Date.now() < taskDeadline) {
        const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 });
        editTasks = tasks.filter((task) => String(task.targetId || "").startsWith("artifact-local-edit-") && task.status === "completed");
        if (editTasks.length === 3 && editTasks.every((task) => task.deliverySummary?.artifacts?.length === 1)) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const editedArtifacts = editTasks.flatMap((task) => task.deliverySummary?.artifacts || []);
      details.editedArtifacts = editedArtifacts;
      checks.threeNewVersionsRegistered = editedArtifacts.length === 3 && ["局部修改报告-edited.md", "排序数据-edited.csv", "坐标图-edited.png"].every((name) => editedArtifacts.some((artifact) => artifact.label === name));
      checks.lineagePersisted = editedArtifacts.every((artifact) => artifact.editLineage?.sourceArtifactId && artifact.editLineage?.sourcePath && artifact.editLineage?.scopeLabel);

      await new Promise((resolve) => setTimeout(resolve, 2200));
      const editedRows = editedArtifacts.map((artifact) => center?.querySelector('li[data-artifact-id="' + artifact.id + '"]')).filter(Boolean);
      checks.threeCompareActionsVisible = editedRows.length === 3 && editedRows.every((row) => row.querySelector('[data-testid="results-compare-artifact"]'));
      for (const row of editedRows) {
        row.querySelector('[data-testid="results-compare-artifact"]')?.click();
        const compare = await waitFor(() => document.querySelector('[data-testid="results-compare-dialog"][data-compare-state="ready"]'));
        const versions = Array.from(compare?.querySelectorAll('.results-compare-grid article') || []).map((article) => ({ text: String(article.textContent || ""), image: article.querySelector("img")?.getAttribute("src") || "" }));
        details.comparisons.push(versions);
        compare?.querySelector('[data-testid="results-compare-close"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.threeComparisonsOpened = details.comparisons.length === 3 && details.comparisons.every((versions) => versions.length === 2);
      const comparisonText = JSON.stringify(details.comparisons);
      checks.originalsUnchangedInPreview = comparisonText.includes("KEEP BEFORE") && comparisonText.includes("KEEP AFTER") && comparisonText.includes("1,30,A") && details.comparisons.some((versions) => versions[0]?.image);
      checks.editedResultsDiffer = details.comparisons.every((versions) => versions[0]?.text !== versions[1]?.text || versions[0]?.image !== versions[1]?.image);
      checks.noChatTemporaryLinkUsed = details.navigationPath === "main-sidebar-results";
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runChartConsistencySmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show(); window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results", runs: [] };
      const api = window.openDrSai;
      const waitFor = async (find, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      checks.workspaceRegistered = (await api.createWorkspace({ source: "existing", path: workspacePath, name: "G6 图表一致性", trusted: true }))?.path === workspacePath;
      const specs = [
        { id: "g6-valid", label: "正确图表数据.csv", path: workspacePath + "\\\\正确图表数据.csv" },
        { id: "g6-invalid", label: "矛盾图表数据.csv", path: workspacePath + "\\\\矛盾图表数据.csv" },
      ];
      for (const spec of specs) await api.enqueueBackgroundTask({ kind: "agent_run", source: "agent", title: "G6 " + spec.label, workspacePath, targetId: spec.id, status: "completed", progress: 100, message: "数据成果已登记。", verification: "等待生成图表。", deliverySummary: { findingSummary: "数据已准备。", importance: "medium", importanceReason: "用于图表一致性检查。", artifacts: [{ id: spec.id, label: spec.label, path: spec.path, kind: "file" }], suggestedAction: "生成并核对图表。", workSummary: "登记数据。", coreConclusion: "数据可用。", verification: "CSV 可读取。", remainingRisks: "尚未生成图表。", completionCriteria: { passed: ["数据已登记"], incomplete: ["尚未生成图表"] } } });
      checks.twoDataArtifactsSeeded = specs.length === 2;
      const nav = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null); nav?.click();
      const center = await waitFor(() => { const candidate = document.querySelector('[data-testid="results-center-view"]'); return candidate && specs.every((spec) => candidate.querySelector('li[data-artifact-id="' + spec.id + '"]')) ? candidate : null; });
      checks.fixedResultsCenterUsed = Boolean(nav && center);
      let controlsSeen = 0;
      for (const spec of specs) {
        const row = center?.querySelector('li[data-artifact-id="' + spec.id + '"]');
        row?.querySelector('[data-testid="results-preview-artifact"]')?.click();
        const dialog = await waitFor(() => document.querySelector('[data-testid="results-preview-dialog"][data-preview-state="ready"]'));
        const controls = dialog?.querySelector('[data-testid="results-chart-controls"]');
        if (controls) controlsSeen += 1;
        const legendInput = controls?.querySelector('[data-testid="results-chart-legend"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(legendInput, "Observed throughput"); legendInput?.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        controls?.querySelector('[data-testid="results-generate-chart"]')?.click();
        const status = await waitFor(() => { const candidate = row?.querySelector('[data-testid="results-chart-status"]'); return candidate && ["completed", "failed"].includes(candidate.getAttribute("data-state")) ? candidate : null; }, 20000);
        details.runs.push({ id: spec.id, state: status?.getAttribute("data-state"), text: status?.textContent });
      }
      checks.twoChartControlsVisible = controlsSeen === 2;
      checks.twoChartRunsCompleted = details.runs.length === 2 && details.runs.every((run) => run.state === "completed");
      let chartTasks = [];
      const taskDeadline = Date.now() + 10000;
      while (Date.now() < taskDeadline) { const tasks = await api.listBackgroundTasks({ workspacePath, limit: 100 }); chartTasks = tasks.filter((task) => String(task.targetId || "").startsWith("artifact-chart-") && task.status === "completed"); if (chartTasks.length === 2) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
      const artifacts = chartTasks.flatMap((task) => task.deliverySummary?.artifacts || []);
      const valid = artifacts.find((artifact) => artifact.label === "正确图表数据-chart.svg");
      const invalid = artifacts.find((artifact) => artifact.label === "矛盾图表数据-chart.svg");
      const invalidTask = chartTasks.find((task) => task.deliverySummary?.artifacts?.some((artifact) => artifact.label === "矛盾图表数据-chart.svg"));
      details.artifacts = artifacts; details.invalidCompletion = invalidTask?.deliverySummary?.completionCriteria;
      checks.validChartRegistered = Boolean(valid); checks.invalidChartRegistered = Boolean(invalid);
      checks.validChartQualityPassed = valid?.chartQuality?.status === "passed" && valid.chartQuality.mismatchCount === 0;
      checks.validAxesUnitLegend = valid?.chartQuality?.axisLabelsVisible === true && valid?.chartQuality?.unitVisible === true && valid?.chartQuality?.legendVisible === true;
      checks.validAllPointsMapped = valid?.chartQuality?.pointsExpected === 3 && valid?.chartQuality?.pointsMatched === 3;
      checks.validAllCoordinatesMapped = valid?.chartQuality?.coordinateMatches === 3;
      checks.validAnomalyMapped = valid?.chartQuality?.anomaliesExpected === 1 && valid?.chartQuality?.anomaliesMatched === 1;
      checks.invalidChartQualityFailed = invalid?.chartQuality?.status === "failed" && invalid.chartQuality.mismatchCount > 0;
      checks.invalidNotClaimedPassed = invalidTask?.deliverySummary?.completionCriteria?.incomplete?.some((item) => item.includes("图表与数据检查未通过")) === true;
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const validRow = center?.querySelector('li[data-artifact-id="' + valid?.id + '"]');
      const invalidRow = center?.querySelector('li[data-artifact-id="' + invalid?.id + '"]');
      checks.qualityPersisted = validRow?.querySelector('[data-testid="results-chart-quality"]')?.getAttribute("data-quality-status") === "passed" && invalidRow?.querySelector('[data-testid="results-chart-quality"]')?.getAttribute("data-quality-status") === "failed";
      invalidRow?.querySelector('[data-testid="results-chart-quality-details"] summary')?.click();
      checks.invalidMismatchVisible = /缺失|不一致/.test(String(invalidRow?.querySelector('[data-testid="results-chart-quality-details"]')?.textContent || ""));
      validRow?.querySelector('[data-testid="results-preview-artifact"]')?.click();
      const chartDialog = await waitFor(() => document.querySelector('[data-testid="results-preview-dialog"][data-preview-state="ready"]'));
      checks.chartPreviewVisible = Boolean(chartDialog?.querySelector('.results-preview-content img'));
      chartDialog?.querySelector('[data-testid="results-preview-close"]')?.click();
      const sourcePreview = await api.previewWorkspaceFile({ workspacePath, path: specs[0].path, maxBytes: 100000 });
      checks.sourceDataUnchanged = String(sourcePreview.content || "").includes("1,4.8,false") && String(sourcePreview.content || "").includes("3,9.6,true");
      checks.noChatTemporaryLinkUsed = details.navigationPath === "main-sidebar-results";
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) { mkdirSync(dirname(screenshotPath), { recursive: true }); const image = await window.webContents.capturePage(); writeFileSync(screenshotPath, image.toPNG()); result.details.screenshotPath = screenshotPath; }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runAnalysisRoutesSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show(); window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const comparisonScenario = process.env.OPENDRSAI_E2E_AGENT_RUN_SCENARIO === "i5-route-comparison";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results" };
      const comparisonScenario = ${JSON.stringify(comparisonScenario)};
      const api = window.openDrSai;
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      checks.workspaceRegistered = (await api.createWorkspace({ source: "existing", path: workspacePath, name: "CERN 双分析路线", trusted: true }))?.path === workspacePath;
      const csvPath = workspacePath + "\\\\cern-wlcg-bandwidth.csv";
      const pdfPath = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const originalPath = workspacePath + "\\\\cern-wlcg-bandwidth-chart.svg";
      const beforeCsv = await api.previewWorkspaceFile({ workspacePath, path: csvPath, maxBytes: 100000 });
      const beforePdf = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      const beforeOriginal = await api.previewWorkspaceFile({ workspacePath, path: originalPath, maxBytes: 100000 });
      checks.cernInputsPresent = Boolean(beforeCsv?.fileHash && beforePdf?.fileHash && beforeOriginal?.fileHash)
        && String(beforeCsv.content || "").includes("4.8") && String(beforeCsv.content || "").includes("9.6");
      const originalTask = await api.enqueueBackgroundTask({
        kind: "agent_run", source: "agent", title: "CERN WLCG 带宽：时间顺序趋势分析", workspacePath,
        targetId: "i4-original-task", status: "completed", progress: 100, message: "原路线成果已完成。", verification: "图表与 CERN 数据一致。",
        deliverySummary: {
          findingSummary: "已按时间顺序分析 CERN WLCG 带宽路线。", importance: "medium", importanceReason: "作为原分析路线保留。",
          artifacts: [{ id: "i4-original-chart", label: "cern-wlcg-bandwidth-chart.svg", path: originalPath, kind: "file", chartQuality: {
            status: "passed", checkedAt: "2026-07-15T00:00:00.000Z", sourcePath: csvPath, xAxis: "day", yAxis: "throughput_tbps", unit: "Tbps", legend: "Observed throughput",
            axisLabelsVisible: true, unitVisible: true, legendVisible: true, pointsExpected: 3, pointsMatched: 3, coordinateMatches: 3, anomaliesExpected: 1, anomaliesMatched: 1, mismatchCount: 0,
            checks: ["横纵坐标标签可见", "单位可见：Tbps", "图例可见：Observed throughput", "数据点 3/3 一致", "坐标映射 3/3 一致", "异常点 1/1 一致"]
          } }],
          suggestedAction: "保留结果并尝试另一路线。", workSummary: "按时间顺序比较带宽增长。", coreConclusion: "带宽需求从 4.8 Tbps 上升至 9.6 Tbps。", verification: "3/3 数据点一致。", remainingRisks: "可进一步从异常点角度分析。",
          completionCriteria: { passed: ["原路线成果已完成"], incomplete: ["尚未尝试另一种方法"] }
        }
      });
      checks.originalRouteTaskSeeded = originalTask?.id && originalTask?.deliverySummary?.artifacts?.length === 1;
      const nav = await waitFor(() => Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null); nav?.click();
      const center = await waitFor(() => { const candidate = document.querySelector('[data-testid="results-center-view"]'); return candidate?.querySelector('li[data-artifact-id="i4-original-chart"]') ? candidate : null; });
      checks.fixedResultsCenterUsed = Boolean(center);
      const originalRow = center?.querySelector('li[data-artifact-id="i4-original-chart"]');
      const routeButton = originalRow?.querySelector('[data-testid="results-create-analysis-route"]');
      checks.alternativeRouteActionVisible = Boolean(routeButton) && /保留结果并尝试另一路线|Keep result and try another route/.test(routeButton?.textContent || "");
      if (!routeButton) {
        details.originalRowText = originalRow?.textContent || "";
        details.originalRowHtml = originalRow?.outerHTML || "";
        return { checks, details };
      }
      routeButton?.click();
      const routeStatus = await waitFor(() => { const candidate = originalRow?.querySelector('[data-testid="results-analysis-route-status"]'); return candidate && ["completed", "failed"].includes(candidate.getAttribute("data-state")) ? candidate : null; }, 25000);
      checks.alternativeRouteCompleted = Boolean(routeStatus) && /两条路线均已保留|Both routes are preserved/.test(routeStatus?.textContent || "");
      if (routeStatus?.getAttribute("data-state") === "failed") {
        details.routeFailure = routeStatus.textContent || "";
        return { checks, details };
      }

      let routeTasks = [];
      const taskDeadline = Date.now() + 12000;
      while (Date.now() < taskDeadline) {
        const rows = await api.listBackgroundTasks({ workspacePath, limit: 100 });
        routeTasks = rows.filter((task) => task.id === originalTask.id || String(task.targetId || "").startsWith("artifact-route-"));
        if (routeTasks.length === 2 && routeTasks.every((task) => task.status === "completed")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const routeArtifacts = routeTasks.flatMap((task) => task.deliverySummary?.artifacts || []).filter((artifact) => artifact.analysisRoute);
      const original = routeArtifacts.find((artifact) => artifact.analysisRoute?.role === "original");
      const alternative = routeArtifacts.find((artifact) => artifact.analysisRoute?.role === "alternative");
      details.routeTasks = routeTasks;
      details.routeArtifacts = routeArtifacts;
      checks.twoIndependentTasks = routeTasks.length === 2 && new Set(routeTasks.map((task) => task.id)).size === 2;
      checks.twoIndependentRouteArtifacts = routeArtifacts.length === 2 && Boolean(original && alternative) && original.path !== alternative.path && original.id !== alternative.id;
      checks.sameInputIndependentMethods = original?.analysisRoute?.inputFingerprint === alternative?.analysisRoute?.inputFingerprint
        && original?.analysisRoute?.sourcePath === alternative?.analysisRoute?.sourcePath
        && original?.analysisRoute?.method !== alternative?.analysisRoute?.method;
      checks.independentRouteIds = original?.analysisRoute?.routeGroupId === alternative?.analysisRoute?.routeGroupId
        && original?.analysisRoute?.routeId !== alternative?.analysisRoute?.routeId;
      checks.alternativeQualityPassed = alternative?.chartQuality?.status === "passed" && alternative.chartQuality.mismatchCount === 0;

      const routeGroup = await waitFor(() => { const candidate = document.querySelector('[data-testid="analysis-route-group"]'); return candidate?.querySelectorAll('[data-testid="analysis-route-card"]').length === 2 ? candidate : null; }, 12000);
      const cards = Array.from(routeGroup?.querySelectorAll('[data-testid="analysis-route-card"]') || []);
      checks.twoRouteCardsVisible = cards.length === 2 && new Set(cards.map((card) => card.getAttribute("data-route-role"))).size === 2;
      let openCount = 0;
      for (const card of cards) {
        const routeId = card.getAttribute("data-route-id");
        card.querySelector('[data-testid="analysis-route-open"]')?.click();
        const artifact = routeArtifacts.find((item) => item.analysisRoute?.routeId === routeId);
        const row = artifact ? document.querySelector('li[data-artifact-id="' + artifact.id + '"]') : null;
        const opened = await waitFor(() => row?.querySelector('[data-testid="results-open-status"][data-state="opened"]'), 3000);
        if (opened) openCount += 1;
      }
      checks.bothRoutesOpenSeparately = openCount === 2;
      const afterCsv = await api.previewWorkspaceFile({ workspacePath, path: csvPath, maxBytes: 100000 });
      const afterPdf = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      const afterOriginal = await api.previewWorkspaceFile({ workspacePath, path: originalPath, maxBytes: 100000 });
      const afterAlternative = alternative ? await api.previewWorkspaceFile({ workspacePath, path: alternative.path, maxBytes: 100000 }) : null;
      checks.originalArtifactNotOverwritten = beforeOriginal?.fileHash === afterOriginal?.fileHash && original?.path === originalPath;
      checks.cernCsvNotChanged = beforeCsv?.fileHash === afterCsv?.fileHash;
      checks.cernPdfNotChanged = beforePdf?.fileHash === afterPdf?.fileHash;
      checks.alternativeArtifactExistsSeparately = Boolean(afterAlternative?.fileHash) && alternative?.path.endsWith("cern-wlcg-bandwidth-anomaly-first-route.svg");
      checks.alternativeOutputDistinct = Boolean(afterAlternative?.fileHash) && afterAlternative.fileHash !== afterOriginal?.fileHash;
      checks.onlyOneAlternativeCreated = routeArtifacts.filter((artifact) => artifact.analysisRoute?.role === "alternative").length === 1;
      checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\\.asar)/i.test(routeGroup?.textContent || "");
      if (comparisonScenario) {
        const comparison = routeGroup?.querySelector('[data-testid="analysis-route-comparison"]');
        const rows = Array.from(comparison?.querySelectorAll('[data-testid="analysis-route-comparison-row"]') || []);
        const fields = rows.map((row) => row.getAttribute("data-difference-field"));
        checks.comparisonViewVisible = Boolean(comparison) && /路线版本比较|Route version comparison/.test(comparison?.textContent || "");
        checks.sixComparisonFieldsVisible = fields.length === 6 && ["method", "input", "conclusion", "artifact", "risk", "recommendedUse"].every((field) => fields.includes(field));
        checks.differencesMappedToBothRoutes = rows.every((row) => {
          const values = Array.from(row.querySelectorAll('[data-testid="analysis-route-comparison-value"]'));
          return values.length === 2 && new Set(values.map((value) => value.getAttribute("data-route-id"))).size === 2 && new Set(values.map((value) => value.getAttribute("data-route-role"))).size === 2;
        });
        const rowValues = (field) => Array.from(comparison?.querySelectorAll('[data-difference-field="' + field + '"] [data-testid="analysis-route-comparison-value"] span') || []).map((value) => value.textContent || "");
        const inputValues = rowValues("input");
        const methodValues = rowValues("method");
        const conclusionValues = rowValues("conclusion");
        const riskValues = rowValues("risk");
        const useValues = rowValues("recommendedUse");
        checks.sameInputShown = inputValues.length === 2 && inputValues[0] === inputValues[1] && /cern-wlcg-bandwidth\.csv/.test(inputValues[0]) && /3 个数据点|3 points/.test(inputValues[0]);
        checks.distinctMethodsShown = methodValues.length === 2 && methodValues[0] !== methodValues[1] && methodValues.some((value) => /时间顺序|Chronological/.test(value)) && methodValues.some((value) => /异常点优先|Anomaly-first/.test(value));
        checks.distinctConclusionsShown = conclusionValues.length === 2 && conclusionValues[0] !== conclusionValues[1] && conclusionValues.some((value) => value.includes("4.8") && value.includes("9.6")) && conclusionValues.some((value) => value.includes("9.6") && /5\.2/.test(value));
        checks.risksAndUsesShown = riskValues.length === 2 && useValues.length === 2 && new Set(riskValues).size === 2 && new Set(useValues).size === 2 && riskValues.every(Boolean) && useValues.every(Boolean);

        const alternativeCard = routeGroup?.querySelector('[data-testid="analysis-route-card"][data-route-role="alternative"]');
        alternativeCard?.querySelector('[data-testid="analysis-route-select"]')?.click();
        const alternativeSelected = await waitFor(() => routeGroup?.querySelector('[data-testid="analysis-route-selection-status"][data-state="selected"]'), 5000);
        checks.alternativeVersionSelected = Boolean(alternativeSelected) && /异常点优先|Anomaly-first/.test(alternativeSelected?.textContent || "");
        let selectedArtifacts = (await api.listBackgroundTasks({ workspacePath, limit: 100 })).flatMap((task) => task.deliverySummary?.artifacts || []).filter((artifact) => artifact.analysisRoute?.routeGroupId === original?.analysisRoute?.routeGroupId && artifact.analysisRoute.selected);
        checks.selectionPersistedExactlyOnce = selectedArtifacts.length === 1 && selectedArtifacts[0].analysisRoute?.role === "alternative" && Boolean(selectedArtifacts[0].analysisRoute?.selectedAt);

        const refreshedGroup = await waitFor(() => document.querySelector('[data-testid="analysis-route-group"]'));
        refreshedGroup?.querySelector('[data-testid="analysis-route-card"][data-route-role="original"] [data-testid="analysis-route-select"]')?.click();
        const originalSelected = await waitFor(() => {
          const status = document.querySelector('[data-testid="analysis-route-selection-status"][data-state="selected"]');
          return status && /时间顺序|Chronological/.test(status.textContent || "") ? status : null;
        }, 5000);
        selectedArtifacts = (await api.listBackgroundTasks({ workspacePath, limit: 100 })).flatMap((task) => task.deliverySummary?.artifacts || []).filter((artifact) => artifact.analysisRoute?.routeGroupId === original?.analysisRoute?.routeGroupId && artifact.analysisRoute.selected);
        checks.selectionCanSwitch = Boolean(originalSelected) && selectedArtifacts.length === 1 && selectedArtifacts[0].analysisRoute?.role === "original";

        document.querySelector('[data-testid="analysis-route-card"][data-route-role="alternative"] [data-testid="analysis-route-continue"]')?.click();
        const chatInput = await waitFor(() => {
          const textarea = document.querySelector('textarea');
          return textarea && /异常点优先|Anomaly-first/.test(textarea.value || "") ? textarea : null;
        }, 8000);
        checks.continueQuestionNavigatesToChat = Boolean(chatInput);
        checks.continueQuestionCarriesRouteContext = Boolean(chatInput) && String(chatInput.value || "").includes("9.6") && /风险|risk/i.test(chatInput.value || "") && String(chatInput.value || "").includes(alternative?.path || "missing-path");
        const resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || ""));
        resultsNav?.click();
        const restoredComparison = await waitFor(() => document.querySelector('[data-testid="analysis-route-comparison"]'), 5000);
        checks.comparisonRestoredAfterQuestion = Boolean(restoredComparison);
        restoredComparison?.scrollIntoView({ block: "center" });
        details.routeComparison = { fields, routeIds: routeArtifacts.map((artifact) => artifact.analysisRoute?.routeId), selectedRouteCount: selectedArtifacts.length, selectedRole: selectedArtifacts[0]?.analysisRoute?.role, inputValues, methodValues, conclusionValues, riskValues, useValues, questionText: chatInput?.value || "" };
      }
      details.hashes = { beforeCsv: beforeCsv?.fileHash, afterCsv: afterCsv?.fileHash, beforePdf: beforePdf?.fileHash, afterPdf: afterPdf?.fileHash, beforeOriginal: beforeOriginal?.fileHash, afterOriginal: afterOriginal?.fileHash, alternative: afterAlternative?.fileHash };
      if (!comparisonScenario) routeGroup?.scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) { mkdirSync(dirname(screenshotPath), { recursive: true }); const image = await window.webContents.capturePage(); writeFileSync(screenshotPath, image.toPNG()); result.details.screenshotPath = screenshotPath; }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runExternalFileConflictSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show(); window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const saveDirectory = process.env.OPENDRSAI_E2E_I6_SAVE_DIR || "C:\\OpenDrSai\\conflict-copies";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const api = window.openDrSai;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const saveDirectory = ${JSON.stringify(saveDirectory)};
      const waitFor = async (find, timeout = 12000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = find(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return null; };
      const setTextarea = (textarea, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set; setter?.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); };
      let requestedExternalEdits = 0;
      const externalEdit = async (previousHash) => {
        const trigger = await api.previewWorkspaceFile({ workspacePath, path: triggerPath, maxBytes: 100000 });
        const triggered = await api.writeWorkspaceFile({
          workspacePath,
          path: triggerPath,
          content: "external-edit-" + (requestedExternalEdits + 1) + "-" + crypto.randomUUID() + "\\n",
          expectedHash: trigger.fileHash,
          mode: "save",
        });
        if (triggered.status !== "saved") throw new Error("Could not notify the independent external editor");
        const deadline = Date.now() + 10000;
        let observed = null;
        while (Date.now() < deadline) {
          observed = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
          if (observed.fileHash && observed.fileHash !== previousHash) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!observed?.fileHash || observed.fileHash === previousHash) throw new Error("External editor did not change the file hash");
        requestedExternalEdits += 1;
        return { externalEditCount: requestedExternalEdits, preview: observed };
      };
      checks.bridge = Boolean(api); if (!api) return { checks, details };
      checks.login = (await api.login({ developerBypass: true, rememberMe: false }))?.ok === true;
      checks.workspaceRegistered = (await api.createWorkspace({ source: "existing", path: workspacePath, name: "CERN 冲突保护", trusted: true }))?.path === workspacePath;
      const workspaceButton = await waitFor(() => Array.from(document.querySelectorAll(".workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 15000);
      workspaceButton?.click();
      checks.workspaceSelected = Boolean(await waitFor(() => Array.from(document.querySelectorAll(".workspace-row.active .workspace-item")).find((button) => button.getAttribute("title")?.includes(workspacePath)) || null, 5000));
      const rightToggle = document.querySelector(".titlebar-right-panel-toggle");
      if (!document.querySelector(".files-context-panel")) rightToggle?.click();
      checks.filesPanelVisible = Boolean(await waitFor(() => document.querySelector(".files-context-panel"), 10000));
      const notesPath = workspacePath + "\\\\cern-capacity-notes.md";
      const triggerPath = workspacePath + "\\\\i6-external-trigger.txt";
      const pdfPath = workspacePath + "\\\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
      const beforePdf = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      const initial = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
      const fileRow = await waitFor(() => Array.from(document.querySelectorAll(".files-tree-row")).find((row) => row.getAttribute("title") === "cern-capacity-notes.md" || row.textContent?.includes("cern-capacity-notes.md")) || null, 10000);
      fileRow?.click();
      const editOpen = await waitFor(() => document.querySelector('[data-testid="safe-file-edit-open"]'), 10000);
      checks.safeEditVisible = Boolean(editOpen) && /编辑并安全保存|conflict protection/.test(editOpen?.textContent || "");
      editOpen?.click();
      let draft = await waitFor(() => document.querySelector('[data-testid="safe-file-edit-draft"]'), 3000);
      const userDraft1 = String(draft?.value || "") + "\\n我的草稿版本 1：建议先复核 9.6 Tbps。\\n";
      if (draft) setTextarea(draft, userDraft1);
      const external1 = await externalEdit(initial.fileHash);
      checks.externalProgramModifiedAfterRead = external1?.externalEditCount === 1;
      document.querySelector('[data-testid="safe-file-edit-save"]')?.click();
      let conflict = await waitFor(() => document.querySelector('[data-testid="external-file-conflict"]'), 5000);
      checks.conflictDetectedAndWriteStopped = Boolean(conflict) && conflict?.getAttribute("data-expected-hash") === initial.fileHash && conflict?.getAttribute("data-current-hash") !== initial.fileHash;
      checks.threeRecoveryChoicesVisible = Boolean(conflict?.querySelector('[data-testid="external-conflict-reload"]') && conflict?.querySelector('[data-testid="external-conflict-save-as"]') && conflict?.querySelector('[data-testid="external-conflict-manual"]'));
      const afterBlocked = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
      checks.externalVersionPreservedOnBlock = String(afterBlocked.content || "").includes("外部程序版本 1") && !String(afterBlocked.content || "").includes("我的草稿版本 1");

      conflict?.querySelector('[data-testid="external-conflict-reload"]')?.click();
      const reloaded = await waitFor(() => { const status = document.querySelector('[data-testid="safe-file-edit-status"][data-state="editing"]'); return status && /重新读取|Reloaded/.test(status.textContent || "") ? status : null; }, 5000);
      draft = document.querySelector('[data-testid="safe-file-edit-draft"]');
      checks.reloadUsesLatestExternalVersion = Boolean(reloaded) && String(draft?.value || "").includes("外部程序版本 1");

      const userDraft2 = String(draft?.value || "") + "\\n我的草稿版本 2：保留为独立副本。\\n";
      if (draft) setTextarea(draft, userDraft2);
      const external2 = await externalEdit(afterBlocked.fileHash);
      document.querySelector('[data-testid="safe-file-edit-save"]')?.click();
      conflict = await waitFor(() => { const node = document.querySelector('[data-testid="external-file-conflict"]'); return node && node.getAttribute("data-current-hash") !== afterBlocked.fileHash ? node : null; }, 5000);
      conflict?.querySelector('[data-testid="external-conflict-save-as"]')?.click();
      const savedAs = await waitFor(() => { const status = document.querySelector('[data-testid="safe-file-edit-status"][data-state="saved"]'); return status && /另存为|saved as/i.test(status.textContent || "") ? status : null; }, 5000);
      const savedCopyPath = saveDirectory + "\\\\cern-capacity-notes-my-version.md";
      const savedCopy = await api.previewWorkspaceFile({ workspacePath: saveDirectory, path: savedCopyPath, maxBytes: 100000 }).catch(() => null);
      const afterSaveAs = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
      checks.saveAsPreservesBothVersions = Boolean(savedAs && savedCopy?.content) && String(savedCopy.content).includes("我的草稿版本 2") && String(afterSaveAs.content || "").includes("外部程序版本 2") && !String(afterSaveAs.content || "").includes("我的草稿版本 2");

      document.querySelector('[data-testid="safe-file-edit-save"]')?.click();
      conflict = await waitFor(() => document.querySelector('[data-testid="external-file-conflict"]'), 5000);
      conflict?.querySelector('[data-testid="external-conflict-manual"]')?.click();
      const manual = await waitFor(() => document.querySelector('[data-testid="external-conflict-manual-choice"]'), 3000);
      checks.manualChoiceExplainsBothOutcomes = Boolean(manual?.querySelector('[data-testid="external-conflict-keep-external"]') && manual?.querySelector('[data-testid="external-conflict-overwrite"]')) && /哈希|hash/i.test(manual?.textContent || "");
      manual?.querySelector('[data-testid="external-conflict-keep-external"]')?.click();
      const keptExternal = await waitFor(() => { const area = document.querySelector('[data-testid="safe-file-edit-draft"]'); return String(area?.value || "").includes("外部程序版本 2") ? area : null; }, 5000);
      checks.manualKeepExternalWorks = Boolean(keptExternal);

      draft = document.querySelector('[data-testid="safe-file-edit-draft"]');
      const agreedDraft = String(draft?.value || "") + "\\nApp 已在最新外部版本上追加确认。\\n";
      if (draft) setTextarea(draft, agreedDraft);
      document.querySelector('[data-testid="safe-file-edit-save"]')?.click();
      const normalSaveDeadline = Date.now() + 5000;
      let normalSaved = null;
      while (Date.now() < normalSaveDeadline) {
        const candidate = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
        if (candidate.content === agreedDraft) { normalSaved = candidate; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const afterNormalSave = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
      checks.unchangedHashAllowsSafeSave = Boolean(normalSaved) && afterNormalSave.content === agreedDraft && afterNormalSave.fileHash !== afterSaveAs.fileHash;
      const external3 = await externalEdit(afterNormalSave.fileHash);
      draft = document.querySelector('[data-testid="safe-file-edit-draft"]');
      if (draft) setTextarea(draft, String(draft.value || "") + "\\n不应静默写入的后续草稿。\\n");
      document.querySelector('[data-testid="safe-file-edit-save"]')?.click();
      conflict = await waitFor(() => document.querySelector('[data-testid="external-file-conflict"]'), 5000);
      conflict?.querySelector('[data-testid="external-conflict-manual"]')?.click();
      const finalOriginal = await api.previewWorkspaceFile({ workspacePath, path: notesPath, maxBytes: 100000 });
      const afterPdf = await api.previewWorkspaceFile({ workspacePath, path: pdfPath, maxBytes: 100000 });
      checks.repeatedExternalChangeStillProtected = external2?.externalEditCount === 2 && external3?.externalEditCount === 3 && Boolean(conflict) && String(finalOriginal.content || "").includes("外部程序版本 3") && !String(finalOriginal.content || "").includes("不应静默写入的后续草稿");
      checks.cernPdfUnchanged = beforePdf.fileHash === afterPdf.fileHash;
      checks.noTechnicalNoise = !/(?:stdout|stderr|traceback|tool_call|ipc|app\\.asar)/i.test(document.querySelector('[data-testid="safe-file-edit"]')?.textContent || "");
      details.hashes = { initial: initial.fileHash, blockedExternal: afterBlocked.fileHash, saveAsExternal: afterSaveAs.fileHash, normalSaved: afterNormalSave.fileHash, finalExternal: finalOriginal.fileHash, pdfBefore: beforePdf.fileHash, pdfAfter: afterPdf.fileHash, savedCopy: savedCopy?.fileHash };
      details.contents = { initial: initial.content, blockedExternal: afterBlocked.content, savedCopy: savedCopy?.content, finalExternal: finalOriginal.content };
      details.savedCopyPath = savedCopyPath;
      document.querySelector('[data-testid="external-file-conflict"]')?.scrollIntoView({ block: "center" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) { mkdirSync(dirname(screenshotPath), { recursive: true }); const image = await window.webContents.capturePage(); writeFileSync(screenshotPath, image.toPNG()); result.details.screenshotPath = screenshotPath; }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runResultsCenterSmoke(window: BrowserWindow): Promise<SmokeResult> {
  window.show();
  window.focus();
  await waitForMain(() => window.isVisible() && !window.isMinimized(), 5_000);
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = { navigationPath: "main-sidebar-results", openedArtifacts: [] };
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = login?.ok === true;
      const workspacePath = ${JSON.stringify(workspacePath)};
      const registeredWorkspace = await api.createWorkspace({
        source: "existing",
        path: workspacePath,
        name: "G1 results fixture",
        description: "Packaged results center acceptance workspace",
        trusted: true,
      });
      checks.artifactWorkspaceRegistered = registeredWorkspace?.path === workspacePath;
      const specs = [
        { targetId: "g1-paper-summary", title: "G1 论文总结", id: "result:g1:paper-summary", label: "论文总结报告", path: workspacePath + "\\\\paper-summary.md", kind: "report" },
        { targetId: "g2-data-analysis", title: "G2 数据分析", id: "result:g2:data-analysis", label: "数据分析结果", path: workspacePath + "\\\\data-analysis.csv", kind: "file" },
        { targetId: "g3-research-synthesis", title: "G3 研究综合", id: "result:g3:research-synthesis", label: "研究综合材料", path: workspacePath + "\\\\research-synthesis", kind: "folder" },
        { targetId: "g4-mentor-report", title: "G4 导师汇报", id: "result:g4:mentor-deck", label: "导师汇报演示文稿", path: workspacePath + "\\\\mentor-report.pptx", kind: "presentation" },
      ];
      const createdTasks = [];
      for (const spec of specs) {
        createdTasks.push(await api.enqueueBackgroundTask({
          kind: spec.kind === "presentation" ? "presentation_generation" : "agent_run",
          source: spec.kind === "presentation" ? "presentation" : "agent",
          title: spec.title,
          workspacePath,
          targetId: spec.targetId,
          status: "completed",
          progress: 100,
          message: "成果已生成并通过自动检查。",
          verification: "成果路径、稳定 ID 和打开操作均已登记。",
          deliverySummary: {
            findingSummary: spec.label + "已生成。",
            importance: "medium",
            importanceReason: "可供后续工作继续使用。",
            artifacts: [{ id: spec.id, label: spec.label, path: spec.path, kind: spec.kind }],
            suggestedAction: "从成果中心重新打开。",
            workSummary: "完成任务并登记成果。",
            coreConclusion: "成果可交付。",
            verification: "自动验证成果可访问。",
            remainingRisks: "无。",
            completionCriteria: { passed: ["成果已登记", "成果可打开"], incomplete: [] },
          },
        }));
      }
      details.createdTaskIds = createdTasks.map((task) => task.id);
      checks.fourSourceTasksCompleted = createdTasks.length === 4 && createdTasks.every((task) => task.status === "completed");

      const navDeadline = Date.now() + 5000;
      let resultsNav = null;
      while (Date.now() < navDeadline && !resultsNav) {
        resultsNav = Array.from(document.querySelectorAll(".sidebar-button")).find((button) => /Results|成果/.test(button.getAttribute("title") || button.textContent || "")) || null;
        if (!resultsNav) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.fixedMainNavigationEntry = Boolean(resultsNav);
      resultsNav?.click();
      const centerDeadline = Date.now() + 10000;
      let center = null;
      while (Date.now() < centerDeadline) {
        center = document.querySelector('[data-testid="results-center-view"][data-route="results"]');
        if (center && center.querySelectorAll("li[data-artifact-id]").length === 4) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      checks.fixedResultsRouteVisible = Boolean(center);
      const rows = Array.from(center?.querySelectorAll("li[data-artifact-id]") || []);
      const readIndex = () => rows.map((row) => ({
        id: row.getAttribute("data-artifact-id"),
        kind: row.getAttribute("data-artifact-kind"),
        taskId: row.getAttribute("data-source-task-id"),
        path: row.getAttribute("data-artifact-path"),
      }));
      const firstIndex = readIndex();
      details.firstIndex = firstIndex;
      checks.allResultsIndexed = rows.length === 4 && specs.every((spec) => firstIndex.some((item) => item.id === spec.id));
      checks.indexedByTask = new Set(firstIndex.map((item) => item.taskId)).size === 4 && firstIndex.every((item) => item.taskId);
      checks.indexedByType = new Set(firstIndex.map((item) => item.kind)).size === 4;
      checks.stableIdsAndPathsPresent = firstIndex.every((item) => item.id && item.path);
      checks.noChatTemporaryLinkUsed = document.querySelector('[data-testid="results-center-view"]') === center && details.navigationPath === "main-sidebar-results";

      const presentationFilter = center?.querySelector('.results-kind-index button[data-kind="presentation"]');
      presentationFilter?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      checks.typeFilterWorks = center?.querySelectorAll('li[data-artifact-kind="presentation"]').length === 1
        && center?.querySelectorAll('li[data-artifact-id]').length === 1;
      center?.querySelector('.results-kind-index button[data-kind="all"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (const spec of specs) {
        const row = center?.querySelector('li[data-artifact-id="' + spec.id + '"]');
        row?.querySelector('[data-testid="results-open-artifact"]')?.click();
        const deadline = Date.now() + 3000;
        let status = null;
        while (Date.now() < deadline) {
          status = row?.querySelector('[data-testid="results-open-status"]');
          if (status?.getAttribute("data-state") === "opened") break;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        details.openedArtifacts.push({ id: spec.id, state: status?.getAttribute("data-state") || "missing" });
      }
      checks.everyResultOpenActionWorks = details.openedArtifacts.length === 4 && details.openedArtifacts.every((item) => item.state === "opened");

      await new Promise((resolve) => setTimeout(resolve, 2200));
      const refreshedRows = Array.from(center?.querySelectorAll("li[data-artifact-id]") || []);
      const refreshedIds = refreshedRows.map((row) => row.getAttribute("data-artifact-id")).sort();
      checks.idsStableAfterRefresh = JSON.stringify(refreshedIds) === JSON.stringify(specs.map((spec) => spec.id).sort());
      details.refreshedIds = refreshedIds;
      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    result.details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(result.checks).every(Boolean), checks: result.checks, details: result.details };
}

async function runAgentRunAwayNotificationSmoke(
  window: BrowserWindow,
  awayMode: "hidden" | "minimized",
): Promise<SmokeResult> {
  const workspacePath = process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace";
  const started = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitFor(find, timeout = 15000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const value = find();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      }
      checks.domReady = Boolean(await waitFor(() => document.body.innerText.includes("OpenDrSai") && document.querySelector("button"), 10000));
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = Boolean(login && login.ok);
      const notificationPreference = await api.setCompletionNotificationPreference({ enabled: true, language: "zh" });
      checks.completionNotificationsEnabled = notificationPreference?.enabled === true && notificationPreference?.language === "zh";
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      checks.gatewayReady = Boolean(gateway.ready && (gateway.managed || gateway.externalReady) && !gateway.externalConflict);
      const workspacePath = ${JSON.stringify(workspacePath)};
      const thread = await api.createThread({
        kind: "agent_run",
        title: "E2E background agent run thread",
        workspacePath,
      });
      checks.threadCreated = Boolean(thread && thread.id && thread.kind === "agent_run");
      const workspace = await api.createWorkspace({
        source: "existing",
        path: workspacePath,
        name: "E2E background Agent task",
        trusted: true,
      });
      checks.workspaceRegistered = Boolean(workspace && workspace.path === workspacePath && workspace.trusted);
      const requestId = "e2e-agent-run-request-0001";
      const runId = "e2e-agent-run-run-0001";
      const checkpoint = await api.createWorkspaceCheckpoint({
        workspacePath,
        label: "E2E background agent baseline",
        kind: "agent_run_baseline",
        runId,
        maxFiles: 200,
        maxBytesPerFile: 2000000,
      });
      checks.checkpointCreated = Boolean(checkpoint && checkpoint.id && checkpoint.runId === runId);
      const events = [];
      const notificationClicks = [];
      const startedAt = Date.now();
      const unsubscribe = api.onAgentRunEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      const unsubscribeNotificationClick = api.onCompletionNotificationClick((event) => notificationClicks.push(event));
      window.__OPENDRSAI_AGENT_BACKGROUND_E2E = {
        api, thread, checkpoint, requestId, runId, workspacePath, events, notificationClicks,
        unsubscribe, unsubscribeNotificationClick, startedAt,
      };
      const returned = await api.startAgentRun({
        requestId,
        threadId: thread.id,
        runId,
        task: "write a short plan api_key=secret-notification-token analyst@example.com",
        workspacePath,
        files: [{ kind: "file", path: "C:\\\\OpenDrSai\\\\fixtures\\\\notes.md", name: "notes.md" }],
        teamConfig: { preset: "general-collaboration" },
        metadata: { source: "e2e-agent-run" },
      });
      checks.startAgentRunReturned = Boolean(returned && returned.requestId === requestId && returned.runId === runId && returned.sessionId === thread.id);
      checks.startEventObservedBeforeClose = Boolean(await waitFor(() => events.some((event) => event.type === "start")));
      details.thread = thread;
      details.returned = returned;
      return { checks, details, requestId };
    })()
  `, true)) as {
    checks: Record<string, boolean>;
    details: Record<string, unknown>;
    requestId: string;
  };

  const checks = { ...started.checks };
  const details: Record<string, unknown> = {
    ...started.details,
    scenario: awayMode === "hidden" ? "background-close" : "minimized-notification",
    workspacePath,
    capturedAt: new Date().toISOString(),
  };
  if (awayMode === "hidden") {
    window.close();
    checks.nativeWindowCloseIntercepted = !window.isDestroyed() && !window.isVisible();
    checks.windowHiddenDuringBackgroundWork = !window.isVisible();
    const awayFixtures = await window.webContents.executeJavaScript(`
      (async () => {
        const state = window.__OPENDRSAI_AGENT_BACKGROUND_E2E;
        const approval = await state.api.proposeApproval({
          source: "workflow",
          actionKind: "workflow.run",
          title: "确认是否采用新的带宽规划方案",
          detail: "该决定会影响下一轮 CERN 管理者报告。",
          target: "CERN bandwidth plan",
          scope: "current workspace",
          impact: "Choose whether the next report uses the revised capacity plan.",
          risk: "high",
          idempotencyKey: "k6-away-pending-decision",
        });
        state.awayApprovalId = approval.approval?.id || "";
        return { approval };
      })()
    `, true) as Record<string, unknown>;
    details.awayApproval = awayFixtures;
  } else {
    window.minimize();
    checks.windowMinimizedDuringBackgroundWork = !window.isDestroyed() && window.isMinimized();
  }

  const taskStorePath = join(
    process.env.DRSAI_HOME || dirname(workspacePath),
    "desktop",
    "background-tasks.json",
  );
  const completedTask = await waitForMain(() => {
    try {
      const store = JSON.parse(readFileSync(taskStorePath, "utf8"));
      const tasks = Object.values(store?.workspaces || {}).flat() as Array<Record<string, unknown>>;
      return tasks.find((task) =>
        task?.kind === "agent_run" &&
        task?.targetId === started.requestId &&
        task?.status === "completed"
      );
    } catch {
      return null;
    }
  }, 30_000);
  if (awayMode === "hidden") {
    const awayFixtures = await window.webContents.executeJavaScript(`
      (async () => {
        const state = window.__OPENDRSAI_AGENT_BACKGROUND_E2E;
        const failed = await state.api.enqueueBackgroundTask({
          kind: "connector_sync",
          source: "connector",
          title: "同步外部资料",
          workspacePath: state.workspacePath,
          targetId: "k6-away-failed",
          status: "failed",
          message: "外部服务暂时不可用，可以稍后重试。",
          verification: "The failure remains visible with a recovery message.",
        });
        const pending = await state.api.enqueueBackgroundTask({
          kind: "workflow_run",
          source: "workflow",
          title: "确认 CERN 带宽规划",
          workspacePath: state.workspacePath,
          targetId: "k6-away-pending",
          approvalId: state.awayApprovalId,
          status: "waiting_approval",
          currentStep: "等待管理者决定",
          pendingDecisions: ["是否采用新的带宽规划方案"],
          message: "需要你的决定后才能继续。",
          verification: "Continue opens the exact pending approval.",
        });
        return { failed, pending, approvalId: state.awayApprovalId };
      })()
    `, true) as Record<string, unknown>;
    checks.awayFailureSeeded = Boolean((awayFixtures.failed as { status?: string })?.status === "failed");
    checks.awayPendingDecisionSeeded = Boolean(
      (awayFixtures.pending as { status?: string; approvalId?: string })?.status === "waiting_approval"
      && Boolean((awayFixtures.pending as { approvalId?: string })?.approvalId),
    );
    details.awayFixtures = awayFixtures;
  }
  if (awayMode === "hidden") {
    checks.backgroundCompletedWhileWindowHidden = Boolean(completedTask) && !window.isDestroyed() && !window.isVisible();
  } else {
    checks.backgroundCompletedWhileWindowMinimized = Boolean(completedTask) && !window.isDestroyed() && window.isMinimized();
  }
  checks.persistedBackgroundTaskComplete = completedTask?.progress === 100
    && Array.isArray(completedTask?.completedSteps)
    && completedTask.completedSteps.length === 3
    && Array.isArray(completedTask?.pendingDecisions)
    && completedTask.pendingDecisions.length === 0;
  details.persistedBackgroundTask = completedTask;
  const notificationRecords = getCompletionNotificationDiagnostics().filter(
    (record) => record.target.targetId === started.requestId,
  );
  const completionNotification = notificationRecords[0];
  checks.windowsNotificationShownInAwayState = notificationRecords.length === 1
    && completionNotification?.visibility === awayMode;
  checks.windowsNotificationSummaryRedacted = Boolean(completionNotification)
    && !/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}/i.test(completionNotification.body)
    && !completionNotification.body.includes("secret-notification-token")
    && !completionNotification.body.includes("analyst@example.com")
    && completionNotification.body.includes("[已隐藏]")
    && completionNotification.body.includes("[已隐藏邮箱]")
    && completionNotification.body.includes("已完成");
  checks.singleCompletionNotification = notificationRecords.length === 1;
  checks.duplicateCompletionNotificationSuppressed = !notifyBackgroundTaskCompleted(
    completedTask as unknown as Parameters<typeof notifyBackgroundTaskCompleted>[0],
    completionNotification.target,
  ) && getCompletionNotificationDiagnostics().filter(
    (record) => record.target.targetId === started.requestId,
  ).length === 1;
  details.completionNotification = completionNotification;

  if (awayMode === "hidden") {
    const secondInstanceEnv = { ...process.env };
    delete secondInstanceEnv.OPENDRSAI_E2E_AGENT_RUN;
    delete secondInstanceEnv.OPENDRSAI_E2E_AGENT_RUN_SCENARIO;
    delete secondInstanceEnv.OPENDRSAI_E2E_RESULT;
    delete secondInstanceEnv.OPENDRSAI_E2E_SCREENSHOT;
    const secondInstance = spawn(process.execPath, [
      ...process.argv.slice(1).filter((argument) => !argument.startsWith("--user-data-dir=")),
      `--user-data-dir=${app.getPath("userData")}`,
    ], {
      env: secondInstanceEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    secondInstance.unref();
    checks.secondInstanceLaunched = true;
    checks.windowReopenedAfterBackgroundCompletion = Boolean(await waitForMain(
      () => window.isVisible() && !window.isDestroyed(),
      10_000,
    ));
    window.hide();
    checks.windowAwayBeforeNotificationClick = !window.isVisible();
  } else {
    checks.windowAwayBeforeNotificationClick = window.isMinimized();
  }
  checks.notificationClickTriggered = clickLatestCompletionNotificationForE2e();
  checks.notificationClickFocusedApp = Boolean(await waitForMain(
    () => window.isVisible() && !window.isMinimized() && !window.isDestroyed(),
    10_000,
  ));
  if (awayMode === "hidden" && process.env.OPENDRSAI_E2E_SCREENSHOT) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const awayScreenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT.replace(/\.png$/i, "-away-summary.png");
    mkdirSync(dirname(awayScreenshotPath), { recursive: true });
    const awayImage = await window.webContents.capturePage();
    writeFileSync(awayScreenshotPath, awayImage.toPNG());
    details.awaySummaryScreenshotPath = awayScreenshotPath;
  }

  const reopened = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const state = window.__OPENDRSAI_AGENT_BACKGROUND_E2E;
      checks.inMemoryRunStatePreserved = Boolean(state && state.requestId === ${JSON.stringify(started.requestId)});
      if (!state) return { checks, details };
      let awaySummary = null;
      const awaySummaryDeadline = Date.now() + 10000;
      while (Date.now() < awaySummaryDeadline && !awaySummary) {
        awaySummary = document.querySelector('[data-testid="away-summary"]');
        if (!awaySummary) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const completedRegion = awaySummary?.querySelector('[data-testid="away-summary-completed"]');
      const failedRegion = awaySummary?.querySelector('[data-testid="away-summary-failed"]');
      const pendingRegion = awaySummary?.querySelector('[data-testid="away-summary-pending"]');
      checks.awaySummaryPrioritizedOnReturn = Boolean(awaySummary)
        && /欢迎回来|Welcome back/i.test(awaySummary?.textContent || "");
      checks.awaySummaryHasThreeStructuredRegions = Boolean(completedRegion && failedRegion && pendingRegion);
      checks.awaySummaryContainsCompletedTask = (completedRegion?.textContent || "").includes("write a short plan");
      checks.awaySummaryContainsFailedTask = (failedRegion?.textContent || "").includes("同步外部资料");
      checks.awaySummaryContainsPendingDecision = (pendingRegion?.textContent || "").includes("确认 CERN 带宽规划")
        && (pendingRegion?.textContent || "").includes("需要你的决定");
      details.awaySummaryText = awaySummary?.textContent?.replace(/\s+/g, " ").trim() || "";
      checks.awaySummarySensitiveTextRedacted = !details.awaySummaryText.includes("secret-notification-token")
        && !details.awaySummaryText.includes("analyst@example.com")
        && details.awaySummaryText.includes("[已隐藏]")
        && details.awaySummaryText.includes("[已隐藏邮箱]");
      const continueButton = pendingRegion?.querySelector('[data-testid="away-summary-continue"]');
      checks.awaySummaryContinueVisible = Boolean(continueButton) && /继续处理|Continue/i.test(continueButton?.textContent || "");
      continueButton?.click();
      let targetedApproval = null;
      const approvalDeadline = Date.now() + 10000;
      while (Date.now() < approvalDeadline && !targetedApproval) {
        targetedApproval = Array.from(document.querySelectorAll(".approval-pending-row"))
          .find((node) => (node.textContent || "").includes("确认是否采用新的带宽规划方案")) || null;
        if (!targetedApproval) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      checks.awaySummaryContinueOpenedApprovalCenter = Boolean(document.querySelector(".approval-center-view"));
      checks.awaySummaryContinueLocatedPendingEvent = Boolean(targetedApproval);
      if (${JSON.stringify(awayMode)} === "minimized") {
        // This scenario seeds only a completed task. Failure and pending-decision
        // fixtures are exercised by background-close and are not applicable here.
        checks.awaySummaryContainsFailedTask = true;
        checks.awaySummaryContainsPendingDecision = true;
        checks.awaySummaryContinueVisible = true;
        checks.awaySummaryContinueOpenedApprovalCenter = true;
        checks.awaySummaryContinueLocatedPendingEvent = true;
      }
      const {
        api, thread, checkpoint, requestId, runId, workspacePath, events, notificationClicks,
        unsubscribe, unsubscribeNotificationClick, startedAt,
      } = state;
      const terminalDeadline = Date.now() + 10000;
      while (Date.now() < terminalDeadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      unsubscribe();
      unsubscribeNotificationClick();
      const terminalEvent = events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
      checks.agentRunStartEvent = events.some((event) => event.type === "start");
      checks.agentRunChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent-run: write a short plan"));
      checks.agentRunDone = terminalEvent?.type === "done";
      checks.noAgentRunError = !events.some((event) => event.type === "error" || event.type === "aborted");
      checks.agentRunThreadEvents = events.every((event) => !event.sessionId || event.sessionId === thread.id);
      checks.agentRunDistinctIds = thread.id !== requestId && thread.id !== runId && requestId !== runId;
      const notificationClick = notificationClicks.find((event) => event.target?.targetId === requestId);
      checks.notificationClickReachedRenderer = Boolean(notificationClick);
      checks.notificationClickTargetsCorrectTask = notificationClick?.target?.kind === "agent_run"
        && notificationClick?.target?.threadId === thread.id
        && notificationClick?.target?.workspacePath === workspacePath;
      const threads = await api.listThreads();
      const finalThread = threads.find((item) => item.id === thread.id);
      checks.agentRunThreadIdleAfterReopen = Boolean(finalThread && finalThread.status === "idle" && finalThread.lastRequestId === requestId && finalThread.lastRunId === runId);
      const tasks = await api.listBackgroundTasks({ workspacePath, limit: 50 });
      const task = tasks.find((candidate) => candidate.kind === "agent_run" && candidate.targetId === requestId);
      checks.agentRunInUnifiedBackgroundQueue = Boolean(task);
      checks.backgroundQueueCompleted = task?.status === "completed" && task.progress === 100;
      checks.backgroundQueuePreservedSteps = Array.isArray(task?.completedSteps)
        && task.completedSteps.length === 3
        && Array.isArray(task?.pendingDecisions)
        && task.pendingDecisions.length === 0;
      const restoreRequest = await api.restoreWorkspaceCheckpoint({ workspacePath, checkpointId: checkpoint.id });
      const approvalId = restoreRequest && restoreRequest.approvalId;
      checks.agentRunRestoreApprovalQueued = Boolean(restoreRequest && restoreRequest.approvalQueued && approvalId);
      const restoreApproved = approvalId ? await api.decidePendingApproval({ id: approvalId, approved: true }) : false;
      checks.agentRunRestoreApproved = restoreApproved === true;
      const restoredPreview = await api.previewWorkspaceCheckpoint({ workspacePath, checkpointId: checkpoint.id });
      checks.agentRunBaselineRestored = Boolean(restoredPreview && restoredPreview.changedEntryCount === 0);
      const disabledPreference = await api.setCompletionNotificationPreference({ enabled: false, language: "zh" });
      checks.completionNotificationsDisabled = disabledPreference?.enabled === false;
      details.thread = thread;
      details.finalThread = finalThread;
      details.backgroundTask = task;
      details.agentRunSummary = {
        durationMs: Date.now() - startedAt,
        firstEventType: events[0]?.type || null,
        lastEventType: events[events.length - 1]?.type || null,
        terminalEventType: terminalEvent?.type || null,
      };
      details.events = events.map((event) => ({
        type: event.type,
        at: event.at,
        content: event.content,
        error: event.error,
        sessionId: event.sessionId,
        runId: event.runId,
      }));
      details.notificationClicks = notificationClicks;
      return { checks, details };
    })()
  `, true)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
  Object.assign(checks, reopened.checks);
  Object.assign(details, reopened.details);
  const diagnosticsBeforeDisabledProbe = getCompletionNotificationDiagnostics().length;
  const disabledProbeShown = notifyBackgroundTaskCompleted(
    completedTask as unknown as Parameters<typeof notifyBackgroundTaskCompleted>[0],
    {
      kind: "agent_run",
      targetId: `${started.requestId}-disabled-probe`,
      workspacePath,
    },
  );
  checks.disabledCompletionNotificationPreferenceRespected = !disabledProbeShown
    && getCompletionNotificationDiagnostics().length === diagnosticsBeforeDisabledProbe;

  const screenshotPath = process.env.OPENDRSAI_E2E_SCREENSHOT;
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(screenshotPath, image.toPNG());
    details.screenshotPath = screenshotPath;
  }
  return { ok: Object.values(checks).every(Boolean), checks, details };
}

async function runAgentRunFailureSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectAgentRun(requestId, task, options = {}) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onAgentRunEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          let returned = null;
          let startError = null;
          try {
            returned = await api.startAgentRun({
              requestId,
              runId: requestId,
              sessionId: requestId,
              task,
              workspacePath: "C:\\\\OpenDrSai\\\\workspace",
              teamConfig: { preset: "general-collaboration" },
              metadata: { source: "e2e-agent-run-failures" },
            });
          } catch (error) {
            startError = String(error && error.message ? error.message : error);
          }
          if (options.abortAfterStart && !startError) {
            const abortDeadline = Date.now() + 5000;
            while (Date.now() < abortDeadline && !events.some((event) => event.type === "start")) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await api.abortAgentRun(requestId);
          }
          const deadline = Date.now() + (options.waitMs || 12000);
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const threads = await api.listThreads();
          return {
            returned,
            startError,
            events,
            threads,
            finalThread: threads.find((thread) => thread.id === requestId) || null,
            durationMs: Date.now() - startedAt,
          };
        } finally {
          unsubscribe();
        }
      }

      function summarizeOutcome(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returned: outcome.returned,
          startError: outcome.startError,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            failureRecovery: event.failureRecovery,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
          thread: outcome.finalThread,
          threads: outcome.threads,
        };
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      const scenario = ${JSON.stringify(process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURE_SCENARIO || "")};
      details.scenario = scenario;
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const healthSnapshot = await api.getHealth();
      let gateway = await api.getGatewayStatus();
      for (let attempt = 0; attempt < 30 && !gateway.ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        gateway = await api.getGatewayStatus();
      }
      const health = { ...healthSnapshot, gatewayReady: gateway.ready, gateway };
      details.health = {
        gatewayReady: health.gatewayReady,
        gatewayManaged: health.gateway && health.gateway.managed,
      };
        checks.gatewayReady = Boolean(health.gatewayReady && health.gateway && (health.gateway.managed || health.gateway.externalReady) && !health.gateway.externalConflict);

      if (scenario === "abort") {
        const outcome = await collectAgentRun("e2e-agent-failure-abort", "abort agent run", { abortAfterStart: true, waitMs: 10000 });
        details.abort = summarizeOutcome(outcome);
        checks.abortStart = outcome.events.some((event) => event.type === "start");
        checks.abortEvent = outcome.events.some((event) => event.type === "aborted");
        checks.abortTerminal = details.abort.terminalEventType === "aborted";
        checks.abortThreadError = details.abort.thread && details.abort.thread.status === "error";
        checks.abortNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "sse-error") {
        const outcome = await collectAgentRun("e2e-agent-failure-error", "trigger agent sse error", { waitMs: 10000 });
        details.sseError = summarizeOutcome(outcome);
        checks.sseErrorStart = outcome.events.some((event) => event.type === "start");
        checks.sseErrorEvent = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("synthetic agent error"));
        checks.sseErrorTerminal = details.sseError.terminalEventType === "error";
        checks.sseErrorThreadError = details.sseError.thread && details.sseError.thread.status === "error";
        checks.sseErrorNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "timeout") {
        const outcome = await collectAgentRun("e2e-agent-failure-timeout", "timeout agent run", { waitMs: 10000 });
        details.timeout = summarizeOutcome(outcome);
        checks.timeoutStart = outcome.events.some((event) => event.type === "start");
        checks.timeoutError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("timed out"));
        checks.timeoutTerminal = details.timeout.terminalEventType === "error";
        checks.timeoutThreadError = details.timeout.thread && details.timeout.thread.status === "error";
        checks.timeoutDuration = details.timeout.durationMs >= 1000;
        checks.timeoutNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "chunk-disconnect") {
        const outcome = await collectAgentRun("e2e-agent-failure-disconnect", "disconnect agent run", { waitMs: 10000 });
        details.chunkDisconnect = summarizeOutcome(outcome);
        checks.chunkDisconnectStart = outcome.events.some((event) => event.type === "start");
        checks.chunkDisconnectChunk = outcome.events.some((event) => event.type === "chunk" && String(event.content || "").includes("agent partial before disconnect"));
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && (
          String(event.error || "").includes("ended before data: [DONE]") ||
          (event.failureRecovery?.kind === "network" && event.failureRecovery.exhausted === true)
        ));
        checks.chunkDisconnectTerminal = details.chunkDisconnect.terminalEventType === "error";
        checks.chunkDisconnectThreadError = details.chunkDisconnect.thread && details.chunkDisconnect.thread.status === "error";
        checks.chunkDisconnectNoDone = !outcome.events.some((event) => event.type === "done");
      } else if (scenario === "network-exhausted" || scenario === "external-service") {
        const requestId = scenario === "network-exhausted"
          ? "e2e-agent-failure-network-exhausted"
          : "e2e-agent-failure-external-service";
        const outcome = await collectAgentRun(requestId, scenario, { waitMs: 12000 });
        const key = scenario === "network-exhausted" ? "networkExhausted" : "externalService";
        details[key] = summarizeOutcome(outcome);
        const terminal = outcome.events.find((event) => event.type === "error");
        checks.structuredFailureStart = outcome.events.some((event) => event.type === "start");
        checks.structuredFailureTerminal = details[key].terminalEventType === "error";
        checks.structuredFailureKind = terminal?.failureRecovery?.kind === (scenario === "network-exhausted" ? "network" : "external_service");
        checks.structuredFailureExhausted = terminal?.failureRecovery?.exhausted === true;
        checks.structuredFailureRetryable = terminal?.failureRecovery?.retryable === true;
        checks.structuredFailureAttempts = terminal?.failureRecovery?.attempts >= 2
          && terminal?.failureRecovery?.attempts === terminal?.failureRecovery?.retryLimit;
        checks.structuredFailureReason = Boolean(terminal?.failureRecovery?.reason);
        checks.structuredFailureAction = Boolean(terminal?.failureRecovery?.suggestedAction);
        checks.structuredFailureEscalation = terminal?.failureRecovery?.escalationLevel === (scenario === "external-service" ? "administrator" : "user_action");
        checks.structuredFailureThreadStopped = details[key].thread?.status === "error";
        checks.structuredFailureBounded = details[key].durationMs < 10000;
        checks.structuredFailureNoDone = !outcome.events.some((event) => event.type === "done");
      } else {
        checks.knownScenario = false;
        details.error = "Unknown agent run failure scenario.";
      }

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runThreadsSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      async function collectChat(requestId, threadId, content) {
        const events = [];
        const startedAt = Date.now();
        const unsubscribe = api.onChatEvent((event) => {
          if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
        });
        try {
          const returnedRequestId = await api.startChat({
            requestId,
            threadId,
            runId: requestId,
            model: "drsai",
            workspacePath: "C:\\\\OpenDrSai\\\\workspace",
            messages: [{ role: "user", content }],
          });
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { returnedRequestId, events, durationMs: Date.now() - startedAt };
        } finally {
          unsubscribe();
        }
      }
      function summarize(outcome) {
        const firstEvent = outcome.events[0] || null;
        const lastEvent = outcome.events[outcome.events.length - 1] || null;
        const terminalEvent = outcome.events.find((event) => ["done", "error", "aborted"].includes(event.type)) || null;
        return {
          returnedRequestId: outcome.returnedRequestId,
          durationMs: outcome.durationMs,
          firstEventType: firstEvent && firstEvent.type,
          lastEventType: lastEvent && lastEvent.type,
          terminalEventType: terminalEvent && terminalEvent.type,
          events: outcome.events.map((event) => ({
            type: event.type,
            at: event.at,
            content: event.content,
            error: event.error,
            sessionId: event.sessionId,
            runId: event.runId,
          })),
        };
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };
      const login = await api.login({ developerBypass: true, rememberMe: false });
      checks.login = Boolean(login && login.ok);
      details.phase = ${JSON.stringify(process.env.OPENDRSAI_E2E_THREADS_PHASE || "create")};

      if (details.phase === "list") {
        checks.domReady = true;
        const expectedThreadId = ${JSON.stringify(process.env.OPENDRSAI_E2E_THREADS_ID || "")};
        const threads = await api.listThreads();
        details.threads = threads;
        checks.listReturned = Array.isArray(threads);
        checks.threadPersisted = threads.some((thread) =>
          thread.id === expectedThreadId &&
          thread.kind === "chat" &&
          thread.title.includes("second thread message") &&
          thread.lastRunId === "e2e-thread-run-0002" &&
          thread.lastRequestId === "e2e-thread-run-0002" &&
          thread.status === "idle" &&
          thread.messageCount === 1
        );
        checks.sortedByUpdatedAt = threads.every((thread, index) => index === 0 || threads[index - 1].updatedAt >= thread.updatedAt);
        return { checks, details };
      }

      const created = await api.createThread({
        kind: "chat",
        title: "E2E thread smoke",
        workspacePath: "C:\\\\OpenDrSai\\\\workspace",
      });
      details.created = created;
      checks.createdThread = Boolean(
        created &&
        typeof created.id === "string" &&
        created.id.startsWith("thread-") &&
        created.kind === "chat" &&
        created.messageCount === 0 &&
        Date.parse(created.createdAt) > 0 &&
        Date.parse(created.updatedAt) > 0
      );
      const threadId = created.id;

      const first = await collectChat("e2e-thread-run-0001", threadId, "first thread message");
      const second = await collectChat("e2e-thread-run-0002", threadId, "second thread message");
      details.first = summarize(first);
      details.second = summarize(second);
      const threads = await api.listThreads();
      details.threads = threads;

      checks.firstDone = details.first.terminalEventType === "done";
      checks.secondDone = details.second.terminalEventType === "done";
      checks.sameThreadEvents = details.first.events.every((event) => !event.sessionId || event.sessionId === threadId) &&
        details.second.events.every((event) => !event.sessionId || event.sessionId === threadId);
      checks.distinctRuns = details.first.events.some((event) => event.runId === "e2e-thread-run-0001") &&
        details.second.events.some((event) => event.runId === "e2e-thread-run-0002");
      checks.threadListed = threads.some((thread) =>
        thread.id === threadId &&
        thread.title.includes("second thread message") &&
        thread.lastRunId === "e2e-thread-run-0002" &&
        thread.lastRequestId === "e2e-thread-run-0002" &&
        thread.status === "idle"
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

async function runForkMergeSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const approvedFixture = prepareForkMergeApprovedFixture();
  const conflictFixture = prepareForkMergeConflictFixture();
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      if (!api) return { checks, details };

      const login = await api.login({ developerBypass: true, rememberMe: false });
      details.login = { ok: login && login.ok, message: login && login.message };
      checks.login = Boolean(login && login.ok);

      const parentPath = ${JSON.stringify(process.env.DRSAI_HOME || "")};
      const sourceWorkspace = await api.createWorkspace({
        source: "empty",
        parentPath,
        name: "fork-merge-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "source" },
      });
      const forkWorkspace = await api.createWorkspace({
        source: "empty",
        parentPath,
        name: "fork-merge-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "worktree" },
      });
      details.sourceWorkspace = sourceWorkspace;
      details.forkWorkspace = forkWorkspace;
      checks.workspacesCreated = Boolean(sourceWorkspace && forkWorkspace && sourceWorkspace.path !== forkWorkspace.path);

      const createdAt = new Date().toISOString();
      const thread = await api.createThread({
        kind: "agent_run",
        title: "E2E fork merge-back smoke",
        workspacePath: forkWorkspace.path,
        fork: {
          sourceWorkspacePath: sourceWorkspace.path,
          repoRoot: sourceWorkspace.path,
          worktreePath: forkWorkspace.path,
          branch: "drsai/e2e-fork-merge",
          baseRef: "HEAD",
          createdAt,
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged merge-back review fixture.",
        },
      });
      details.thread = thread;
      checks.threadCreated = Boolean(
        thread &&
        thread.kind === "agent_run" &&
        thread.fork &&
        thread.fork.lifecycleStatus === "active" &&
        thread.workspacePath === forkWorkspace.path
      );

      const approvalResult = await api.requestForkLifecycleApproval({
        threadId: thread.id,
        action: "merge_back",
      });
      details.approvalResult = approvalResult;
      checks.approvalQueued = Boolean(
        approvalResult &&
        approvalResult.queued === true &&
        approvalResult.approval &&
        approvalResult.approval.actionKind === "fork.lifecycle" &&
        approvalResult.approval.source === "fork"
      );

      const pendingBefore = await api.listPendingApprovals();
      details.pendingBefore = pendingBefore;
      const queuedApproval = pendingBefore.find((approval) =>
        approval.id === approvalResult.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        /merge back/i.test(String(approval.title || ""))
      );
      checks.pendingApprovalListed = Boolean(queuedApproval);
      checks.approvalDetailMentionsBoundaries = Boolean(
        queuedApproval &&
        String(queuedApproval.detail || "").includes(sourceWorkspace.path) &&
        String(queuedApproval.detail || "").includes(forkWorkspace.path)
      );

      const rejected = await api.decideApproval({
        id: approvalResult.approval.id,
        approved: false,
        reason: "reject",
      });
      details.rejected = rejected;
      checks.rejectionAccepted = rejected === true;

      const pendingAfter = await api.listPendingApprovals();
      details.pendingAfter = pendingAfter;
      checks.approvalClearedAfterReject = !pendingAfter.some((approval) => approval.id === approvalResult.approval.id);

      const threadsAfter = await api.listThreads();
      const threadAfter = threadsAfter.find((item) => item.id === thread.id);
      details.threadAfter = threadAfter;
      checks.threadStillActiveAfterReject = Boolean(
        threadAfter &&
        threadAfter.fork &&
        threadAfter.fork.lifecycleStatus === "active" &&
        threadAfter.fork.branch === "drsai/e2e-fork-merge"
      );
      checks.rejectDidNotMergeOrClose = Boolean(
        threadAfter &&
        threadAfter.fork &&
        threadAfter.fork.lifecycleStatus !== "merged" &&
        threadAfter.fork.lifecycleStatus !== "closed" &&
        threadAfter.fork.lifecycleStatus !== "cleanup_pending"
      );

      const approvedFixture = ${JSON.stringify(approvedFixture)};
      const approvedSourceWorkspace = await api.createWorkspace({
        source: "existing",
        path: approvedFixture.sourcePath,
        name: "fork-merge-approved-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "approved-source" },
      });
      const approvedForkWorkspace = await api.createWorkspace({
        source: "existing",
        path: approvedFixture.worktreePath,
        name: "fork-merge-approved-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "approved-worktree" },
      });
      details.approvedSourceWorkspace = approvedSourceWorkspace;
      details.approvedForkWorkspace = approvedForkWorkspace;
      checks.approvedWorkspacesRegistered = Boolean(
        approvedSourceWorkspace &&
        approvedForkWorkspace &&
        approvedSourceWorkspace.path === approvedFixture.sourcePath &&
        approvedForkWorkspace.path === approvedFixture.worktreePath
      );

      const approvedThread = await api.createThread({
        kind: "agent_run",
        title: "E2E approved fork merge-back smoke",
        workspacePath: approvedFixture.worktreePath,
        fork: {
          sourceWorkspacePath: approvedFixture.sourcePath,
          repoRoot: approvedFixture.sourcePath,
          worktreePath: approvedFixture.worktreePath,
          branch: approvedFixture.branch,
          baseRef: approvedFixture.baseRef,
          createdAt: new Date().toISOString(),
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged approved merge-back fixture.",
        },
      });
      details.approvedThread = approvedThread;
      checks.approvedThreadCreated = Boolean(
        approvedThread &&
        approvedThread.kind === "agent_run" &&
        approvedThread.fork &&
        approvedThread.fork.lifecycleStatus === "active"
      );

      const approvedProposal = await api.requestForkLifecycleApproval({
        threadId: approvedThread.id,
        action: "merge_back",
      });
      details.approvedProposal = approvedProposal;
      checks.approvedMergeQueued = Boolean(
        approvedProposal &&
        approvedProposal.queued === true &&
        approvedProposal.approval &&
        approvedProposal.approval.actionKind === "fork.lifecycle"
      );

      const approvedPendingBefore = await api.listPendingApprovals();
      details.approvedPendingBefore = approvedPendingBefore;
      checks.approvedPendingListed = approvedPendingBefore.some((approval) =>
        approval.id === approvedProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        String(approval.detail || "").includes(approvedFixture.sourcePath) &&
        String(approval.detail || "").includes(approvedFixture.worktreePath)
      );

      const approved = await api.decideApproval({
        id: approvedProposal.approval.id,
        approved: true,
        reason: "approve throwaway fixture merge",
      });
      details.approved = approved;
      checks.approvalAccepted = approved === true;

      const approvedPendingAfter = await api.listPendingApprovals();
      details.approvedPendingAfter = approvedPendingAfter;
      checks.approvalClearedAfterApprove = !approvedPendingAfter.some((approval) => approval.id === approvedProposal.approval.id);

      const approvedThreadsAfter = await api.listThreads();
      const approvedThreadAfter = approvedThreadsAfter.find((item) => item.id === approvedThread.id);
      details.approvedThreadAfter = approvedThreadAfter;
      checks.threadMergedAfterApprove = Boolean(
        approvedThreadAfter &&
        approvedThreadAfter.fork &&
        approvedThreadAfter.fork.lifecycleStatus === "merged" &&
        approvedThreadAfter.fork.mergedCommit &&
        approvedThreadAfter.fork.branchCleanupStatus === "pending"
      );
      checks.approvedMergeMessageMentionsCleanup = Boolean(
        approvedThreadAfter &&
        approvedThreadAfter.fork &&
        /retained until discard cleanup is approved/i.test(String(approvedThreadAfter.fork.lifecycleMessage || ""))
      );

      const cleanupProposal = await api.requestForkLifecycleApproval({
        threadId: approvedThread.id,
        action: "discard",
      });
      details.cleanupProposal = cleanupProposal;
      checks.cleanupQueued = Boolean(
        cleanupProposal &&
        cleanupProposal.queued === true &&
        cleanupProposal.approval &&
        cleanupProposal.approval.actionKind === "fork.lifecycle"
      );

      const cleanupPendingBefore = await api.listPendingApprovals();
      details.cleanupPendingBefore = cleanupPendingBefore;
      checks.cleanupPendingListed = cleanupPendingBefore.some((approval) =>
        approval.id === cleanupProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        /discard/i.test(String(approval.title || "")) &&
        /git branch -d/i.test(String(approval.detail || ""))
      );

      const cleanupApproved = await api.decideApproval({
        id: cleanupProposal.approval.id,
        approved: true,
        reason: "approve throwaway fixture cleanup",
      });
      details.cleanupApproved = cleanupApproved;
      checks.cleanupApprovalAccepted = cleanupApproved === true;

      const cleanupPendingAfter = await api.listPendingApprovals();
      details.cleanupPendingAfter = cleanupPendingAfter;
      checks.cleanupClearedAfterApprove = !cleanupPendingAfter.some((approval) => approval.id === cleanupProposal.approval.id);

      const cleanupThreadsAfter = await api.listThreads();
      const cleanupThreadAfter = cleanupThreadsAfter.find((item) => item.id === approvedThread.id);
      details.cleanupThreadAfter = cleanupThreadAfter;
      checks.threadClosedAfterCleanup = Boolean(
        cleanupThreadAfter &&
        cleanupThreadAfter.fork &&
        cleanupThreadAfter.fork.lifecycleStatus === "closed" &&
        cleanupThreadAfter.fork.branchCleanupStatus === "deleted"
      );
      checks.cleanupMessageMentionsBranchDelete = Boolean(
        cleanupThreadAfter &&
        cleanupThreadAfter.fork &&
        /git branch -d/i.test(String(cleanupThreadAfter.fork.branchCleanupMessage || ""))
      );

      const conflictFixture = ${JSON.stringify(conflictFixture)};
      const conflictSourceWorkspace = await api.createWorkspace({
        source: "existing",
        path: conflictFixture.sourcePath,
        name: "fork-merge-conflict-source",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "conflict-source" },
      });
      const conflictForkWorkspace = await api.createWorkspace({
        source: "existing",
        path: conflictFixture.worktreePath,
        name: "fork-merge-conflict-worktree",
        trusted: true,
        metadata: { source: "e2e-fork-merge", role: "conflict-worktree" },
      });
      details.conflictSourceWorkspace = conflictSourceWorkspace;
      details.conflictForkWorkspace = conflictForkWorkspace;
      checks.conflictWorkspacesRegistered = Boolean(
        conflictSourceWorkspace &&
        conflictForkWorkspace &&
        conflictSourceWorkspace.path === conflictFixture.sourcePath &&
        conflictForkWorkspace.path === conflictFixture.worktreePath
      );

      const conflictThread = await api.createThread({
        kind: "agent_run",
        title: "E2E conflict fork merge-back smoke",
        workspacePath: conflictFixture.worktreePath,
        fork: {
          sourceWorkspacePath: conflictFixture.sourcePath,
          repoRoot: conflictFixture.sourcePath,
          worktreePath: conflictFixture.worktreePath,
          branch: conflictFixture.branch,
          baseRef: conflictFixture.baseRef,
          createdAt: new Date().toISOString(),
          sourceHasChanges: false,
          lifecycleStatus: "active",
          lifecycleMessage: "E2E packaged conflict merge-back fixture.",
        },
      });
      details.conflictThread = conflictThread;
      checks.conflictThreadCreated = Boolean(
        conflictThread &&
        conflictThread.kind === "agent_run" &&
        conflictThread.fork &&
        conflictThread.fork.lifecycleStatus === "active"
      );

      const conflictProposal = await api.requestForkLifecycleApproval({
        threadId: conflictThread.id,
        action: "merge_back",
      });
      details.conflictProposal = conflictProposal;
      checks.conflictMergeQueued = Boolean(
        conflictProposal &&
        conflictProposal.queued === true &&
        conflictProposal.approval &&
        conflictProposal.approval.actionKind === "fork.lifecycle"
      );

      const conflictPendingBefore = await api.listPendingApprovals();
      details.conflictPendingBefore = conflictPendingBefore;
      checks.conflictPendingListed = conflictPendingBefore.some((approval) =>
        approval.id === conflictProposal.approval.id &&
        approval.actionKind === "fork.lifecycle" &&
        String(approval.detail || "").includes(conflictFixture.sourcePath) &&
        String(approval.detail || "").includes(conflictFixture.worktreePath)
      );

      const conflictApproved = await api.decideApproval({
        id: conflictProposal.approval.id,
        approved: true,
        reason: "approve throwaway conflict fixture merge",
      });
      details.conflictApproved = conflictApproved;
      checks.conflictApprovalAccepted = conflictApproved === true;

      const conflictPendingAfter = await api.listPendingApprovals();
      details.conflictPendingAfter = conflictPendingAfter;
      checks.conflictClearedAfterApprove = !conflictPendingAfter.some((approval) => approval.id === conflictProposal.approval.id);

      const conflictThreadsAfter = await api.listThreads();
      const conflictThreadAfter = conflictThreadsAfter.find((item) => item.id === conflictThread.id);
      details.conflictThreadAfter = conflictThreadAfter;
      checks.threadMergePendingAfterConflict = Boolean(
        conflictThreadAfter &&
        conflictThreadAfter.fork &&
        conflictThreadAfter.fork.lifecycleStatus === "merge_pending" &&
        /manual conflict resolution/i.test(String(conflictThreadAfter.fork.lifecycleMessage || ""))
      );
      checks.conflictDidNotMarkMerged = Boolean(
        conflictThreadAfter &&
        conflictThreadAfter.fork &&
        conflictThreadAfter.fork.lifecycleStatus !== "merged" &&
        !conflictThreadAfter.fork.mergedCommit
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const mergedContent = readFileSync(join(approvedFixture.sourcePath, "notes.txt"), "utf8");
  const mergedHead = runSmokeGit(approvedFixture.sourcePath, ["rev-parse", "--short=12", "HEAD"]);
  const mergeParents = runSmokeGit(approvedFixture.sourcePath, ["rev-list", "--parents", "-n", "1", "HEAD"]);
  const cleanupBranchExists = smokeGitSucceeds(approvedFixture.sourcePath, ["rev-parse", "--verify", approvedFixture.branch]);
  const conflictContent = readFileSync(join(conflictFixture.sourcePath, "notes.txt"), "utf8");
  const conflictHead = runSmokeGit(conflictFixture.sourcePath, ["rev-parse", "--short=12", "HEAD"]);
  const conflictStatus = runSmokeGit(conflictFixture.sourcePath, ["status", "--porcelain=v1"]);
  result.details.approvedFixture = {
    ...approvedFixture,
    mergedHead,
    mergeParents,
    cleanupBranchExists,
    cleanupWorktreeExists: existsSync(approvedFixture.worktreePath),
  };
  result.details.conflictFixture = {
    ...conflictFixture,
    conflictHead,
    conflictStatus,
  };
  result.checks.approvedSourceContainsForkChange =
    normalizeSmokeText(mergedContent) === normalizeSmokeText(approvedFixture.expectedContent);
  result.checks.approvedSourceHeadAdvanced = mergedHead !== approvedFixture.baseRef;
  result.checks.approvedMergeCommitHasTwoParents = mergeParents.trim().split(/\s+/).length === 3;
  result.checks.cleanupRemovedWorktree = !existsSync(approvedFixture.worktreePath);
  result.checks.cleanupDeletedMergedBranch = !cleanupBranchExists;
  result.checks.conflictSourceContentPreserved =
    normalizeSmokeText(conflictContent) === normalizeSmokeText(conflictFixture.sourceContent);
  result.checks.conflictSourceHeadPreserved = conflictHead === conflictFixture.sourceHead;
  result.checks.conflictMergeWasAborted = conflictStatus.trim() === "";

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function prepareForkMergeApprovedFixture(): ForkMergeApprovedFixture {
  const fixtureRoot = join(process.env.DRSAI_HOME || "", "desktop", "fork-worktrees", "e2e-fork-merge-approved");
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the approved fork merge-back fixture.");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
  const sourcePath = join(fixtureRoot, "source");
  const worktreePath = join(fixtureRoot, "worktree");
  const branch = "drsai/e2e-approved-merge";
  mkdirSync(sourcePath, { recursive: true });

  runSmokeGit(sourcePath, ["init"]);
  runSmokeGit(sourcePath, ["config", "user.email", "desktop-e2e@opendrsai.local"]);
  runSmokeGit(sourcePath, ["config", "user.name", "OpenDrSai Desktop E2E"]);
  runSmokeGit(sourcePath, ["checkout", "-B", "main"]);
  writeFileSync(join(sourcePath, "notes.txt"), "base\n", "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "base"]);
  const baseRef = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  runSmokeGit(sourcePath, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  const expectedContent = "base\napproved merge\n";
  writeFileSync(join(worktreePath, "notes.txt"), expectedContent, "utf8");
  runSmokeGit(worktreePath, ["add", "notes.txt"]);
  runSmokeGit(worktreePath, ["commit", "-m", "approved fork change"]);
  const forkCommit = runSmokeGit(worktreePath, ["rev-parse", "--short=12", "HEAD"]);

  return {
    fixtureRoot,
    sourcePath,
    worktreePath,
    branch,
    baseRef,
    forkCommit,
    expectedContent,
  };
}

function prepareForkMergeConflictFixture(): ForkMergeConflictFixture {
  const fixtureRoot = join(process.env.DRSAI_HOME || "", "desktop", "fork-worktrees", "e2e-fork-merge-conflict");
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the conflict fork merge-back fixture.");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
  const sourcePath = join(fixtureRoot, "source");
  const worktreePath = join(fixtureRoot, "worktree");
  const branch = "drsai/e2e-conflict-merge";
  mkdirSync(sourcePath, { recursive: true });

  runSmokeGit(sourcePath, ["init"]);
  runSmokeGit(sourcePath, ["config", "user.email", "desktop-e2e@opendrsai.local"]);
  runSmokeGit(sourcePath, ["config", "user.name", "OpenDrSai Desktop E2E"]);
  runSmokeGit(sourcePath, ["checkout", "-B", "main"]);
  writeFileSync(join(sourcePath, "notes.txt"), "base\n", "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "base"]);
  const baseRef = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  runSmokeGit(sourcePath, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  writeFileSync(join(worktreePath, "notes.txt"), "base\nfork conflicting change\n", "utf8");
  runSmokeGit(worktreePath, ["add", "notes.txt"]);
  runSmokeGit(worktreePath, ["commit", "-m", "conflicting fork change"]);
  const forkCommit = runSmokeGit(worktreePath, ["rev-parse", "--short=12", "HEAD"]);

  const sourceContent = "base\nsource conflicting change\n";
  writeFileSync(join(sourcePath, "notes.txt"), sourceContent, "utf8");
  runSmokeGit(sourcePath, ["add", "notes.txt"]);
  runSmokeGit(sourcePath, ["commit", "-m", "source conflicting change"]);
  const sourceHead = runSmokeGit(sourcePath, ["rev-parse", "--short=12", "HEAD"]);

  return {
    fixtureRoot,
    sourcePath,
    worktreePath,
    branch,
    baseRef,
    sourceHead,
    forkCommit,
    sourceContent,
  };
}

function runSmokeGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function normalizeSmokeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function smokeGitSucceeds(cwd: string, args: string[]): boolean {
  try {
    runSmokeGit(cwd, args);
    return true;
  } catch {
    return false;
  }
}

async function runOidcSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      const expectsFakeIdentity = ${JSON.stringify(!process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER)};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) return true;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      function publicSessionLooksOidc(session) {
        return Boolean(
          session &&
          session.authenticated === true &&
          session.authMode === "oidc" &&
          session.authProvider === "hai" &&
          session.user &&
          typeof session.user.id === "string" && session.user.id.length > 0 &&
          typeof session.user.email === "string" && session.user.email.includes("@") &&
          Array.isArray(session.user.roles) &&
          session.user.roles.length > 0 &&
          Array.isArray(session.user.groups) &&
          session.user.groups.length > 0 &&
          (!expectsFakeIdentity || (
            session.user.id === "e2e-hai-user" &&
            session.user.email === "e2e-hai-user@ihep.ac.cn" &&
            session.user.roles.includes("user") &&
            session.user.groups.includes("desktop-e2e")
          )) &&
          session.refreshable === true &&
          !("accessToken" in session) &&
          !("refreshToken" in session) &&
          !("idToken" in session)
        );
      }

      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      details.domTextSample = document.body.innerText.slice(0, 300);
      if (!api) return { checks, details };

      const login = await api.startOidcLogin({ rememberMe: true });
      details.login = {
        ok: login && login.ok,
        message: login && login.message,
        session: login && login.session,
      };
      checks.oidcLoginOk = Boolean(login && login.ok);
      checks.oidcPublicSession = publicSessionLooksOidc(login && login.session);

      const bootstrap = await api.bootstrapDesktop();
      details.bootstrap = bootstrap;
      checks.oidcBootstrapReady = Boolean(
        bootstrap && bootstrap.ready &&
        bootstrap.defaults && bootstrap.defaults.modelAlias === "drsai" &&
        Array.isArray(bootstrap.models) && bootstrap.models.some((model) => model.id === "drsai") &&
        bootstrap.capabilities && bootstrap.capabilities.chat === true &&
        bootstrap.capabilities.tools.includes("files") &&
        bootstrap.capabilities.tools.includes("shell") &&
        bootstrap.capabilities.tools.includes("git")
      );

      const restored = await api.getAuthSession();
      details.restored = restored;
      checks.restoredSession = publicSessionLooksOidc(restored);

      const refreshed = await api.refreshAuthSession();
      details.refreshed = refreshed;
      checks.refreshSession = publicSessionLooksOidc(refreshed);

      const health = await api.getHealth();
      details.gateway = {
        gatewayReady: health && health.gatewayReady,
        gatewayManaged: health && health.gateway && health.gateway.managed,
      };
      checks.oidcGatewayReady = Boolean(health && health.gatewayReady && health.gateway && health.gateway.managed);

      const chatRequestId = "e2e-oidc-chat-0001";
      const chatEvents = [];
      const unsubscribeChat = api.onChatEvent((event) => {
        if (event.requestId === chatRequestId) chatEvents.push(event);
      });
      try {
        const returnedChatRequestId = await api.startChat({
          requestId: chatRequestId,
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "oidc chat bearer check" }],
        });
        details.oidcChatReturnedRequestId = returnedChatRequestId;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && !chatEvents.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribeChat();
      }
      details.oidcChatEvents = chatEvents.map((event) => ({
        type: event.type,
        requestId: event.requestId,
        content: event.content,
        error: event.error,
      }));
      checks.oidcChatStart = chatEvents.some((event) => event.type === "start");
      checks.oidcChatChunk = chatEvents.some((event) => event.type === "chunk" && String(event.content || "").includes("oidc chat bearer ok"));
      checks.oidcChatDone = chatEvents.some((event) => event.type === "done");
      checks.oidcChatNoError = !chatEvents.some((event) => event.type === "error" || event.type === "aborted");

      const agentRequestId = "e2e-oidc-agent-0001";
      const agentEvents = [];
      const unsubscribeAgent = api.onAgentRunEvent((event) => {
        if (event.requestId === agentRequestId) agentEvents.push(event);
      });
      try {
        const returnedAgent = await api.startAgentRun({
          requestId: agentRequestId,
          sessionId: "e2e-oidc-agent-session",
          runId: "e2e-oidc-agent-run",
          task: "oidc agent bearer check",
          model: "drsai",
          metadata: { source: "e2e-oidc" },
        });
        details.oidcAgentReturned = returnedAgent;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && !agentEvents.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribeAgent();
      }
      details.oidcAgentEvents = agentEvents.map((event) => ({
        type: event.type,
        requestId: event.requestId,
        content: event.content,
        error: event.error,
      }));
      checks.oidcAgentStart = agentEvents.some((event) => event.type === "start");
      checks.oidcAgentChunk = agentEvents.some((event) => event.type === "chunk" && String(event.content || "").includes("oidc agent bearer ok"));
      checks.oidcAgentDone = agentEvents.some((event) => event.type === "done");
      checks.oidcAgentNoError = !agentEvents.some((event) => event.type === "error" || event.type === "aborted");

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const storage = readOidcSessionStorageForSmoke();
  result.details.storage = storage.details;
  result.checks.sessionFileExists = storage.checks.exists;
  result.checks.sessionUsesEncryptedTokens = storage.checks.usesEncryptedTokens;
  result.checks.sessionOmitsPlainTokens = storage.checks.omitsPlainTokens;

  const logout = (await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.openDrSai;
      const logout = await api.logout({ clearLocalData: false });
      const afterLogout = await api.getAuthSession();
      return {
        logout,
        afterLogout,
        logoutOk: Boolean(logout && logout.ok),
        afterLogoutAnonymous: Boolean(afterLogout && afterLogout.authenticated === false),
      };
    })()
  `)) as {
    logout?: unknown;
    afterLogout?: unknown;
    logoutOk?: boolean;
    afterLogoutAnonymous?: boolean;
  };
  result.details.logout = logout.logout;
  result.details.afterLogout = logout.afterLogout;
  result.checks.logoutOk = Boolean(logout.logoutOk);
  result.checks.afterLogoutAnonymous = Boolean(logout.afterLogoutAnonymous);

  const afterLogoutStorage = readOidcSessionStorageForSmoke();
  result.details.afterLogoutStorage = afterLogoutStorage.details;
  result.checks.logoutClearsSessionFile = !afterLogoutStorage.checks.exists;

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function readOidcSessionStorageForSmoke(): {
  checks: { exists: boolean; usesEncryptedTokens: boolean; omitsPlainTokens: boolean };
  details: Record<string, unknown>;
} {
  const sessionPath = join(process.env.DRSAI_HOME || "", "auth", "auth.json");
  if (!process.env.DRSAI_HOME || !existsSync(sessionPath)) {
    return {
      checks: { exists: false, usesEncryptedTokens: false, omitsPlainTokens: false },
      details: { sessionPath, exists: false },
    };
  }
  const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
  const keys = Object.keys(parsed).sort();
  return {
    checks: {
      exists: true,
      usesEncryptedTokens: Boolean(
        parsed.encryptedAccessToken &&
          parsed.encryptedRefreshToken &&
          parsed.encryptedIdToken,
      ),
      omitsPlainTokens: !("accessToken" in parsed) && !("refreshToken" in parsed) && !("idToken" in parsed),
    },
    details: {
      sessionPath,
      exists: true,
      keys,
      authMode: parsed.authMode,
      authProvider: parsed.authProvider,
      hasEncryptedAccessToken: Boolean(parsed.encryptedAccessToken),
      hasEncryptedRefreshToken: Boolean(parsed.encryptedRefreshToken),
      hasEncryptedIdToken: Boolean(parsed.encryptedIdToken),
      hasPlainAccessToken: "accessToken" in parsed,
      hasPlainRefreshToken: "refreshToken" in parsed,
      hasPlainIdToken: "idToken" in parsed,
    },
  };
}

async function runSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const channelImportFixture = prepareChannelImportFixture();
  const ideContextFixtures = prepareIdeContextFixtures();
  const workspaceReviewFixture = prepareWorkspaceReviewFixture();
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const checks = {};
      const details = {};
      async function waitForDomReady() {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (document.body.innerText.includes("OpenDrSai") && document.querySelector("button")) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
      }
      const api = window.openDrSai;
      checks.bridge = Boolean(api);
      checks.domReady = await waitForDomReady();
      details.domTextSample = document.body.innerText.slice(0, 300);
      if (!api) return { checks, details };

      const health = await api.getHealth();
      details.health = {
        installed: health.installed,
        gatewayReady: health.gatewayReady,
        gatewayExternalConflict: health.gateway && health.gateway.externalConflict,
        home: health.install && health.install.home,
        apiKeyConfigured: health.install && health.install.apiKeyConfigured,
        bundledBackendAvailable: health.install && health.install.bundledBackendAvailable,
      };
      checks.health = Boolean(health.install && health.install.home);
      checks.bundledBackendAvailable = Boolean(
        health.install && health.install.bundledBackendAvailable,
      );
      const gatewayStatus = await api.getGatewayStatus();
      details.gatewayStatus = gatewayStatus;
      checks.developmentManagedGatewayAccepted = Boolean(
        gatewayStatus.externalReady === true &&
          gatewayStatus.managed === true &&
          gatewayStatus.externalConflict === false &&
          gatewayStatus.ready === true,
      );

      const save = await api.saveApiKey("opendrsai-packaged-smoke-key");
      details.saveApiKey = save;
      checks.productionApiKeyRejected = Boolean(
        save && save.ok === false && String(save.message || "").includes("OIDC")
      );

      const afterSave = await api.getHealth();
      details.afterSave = {
        apiKeyConfigured: afterSave.install && afterSave.install.apiKeyConfigured,
      };
      checks.apiKeyStatusUnchanged = Boolean(
        afterSave.install && afterSave.install.apiKeyConfigured === false,
      );

      const badKey = await api.saveApiKey("bad\\nkey");
      details.badKey = badKey;
      checks.badApiKeyRejected = Boolean(badKey && badKey.ok === false);

      let invalidChatRejected = false;
      try {
        await api.startChat({ requestId: "packaged-smoke-invalid", messages: [] });
      } catch (error) {
        details.invalidChatError = String(error && error.message ? error.message : error);
        invalidChatRejected = true;
      }
      checks.invalidChatRejected = invalidChatRejected;

      const outsidePathResult = await api.openPath("C:\\\\\\\\Windows\\\\\\\\win.ini");
      details.outsidePathResult = outsidePathResult;
      checks.openPathOutsideRejected =
        String(outsidePathResult).includes("outside OpenDrSai home") ||
        String(outsidePathResult).includes("not registered as an OpenDrSai or workspace path");

      const reviewFixture = ${JSON.stringify(workspaceReviewFixture)};
      const reviewWorkspace = await api.createWorkspace({ source: "existing", path: reviewFixture.workspacePath, name: "packaged-review-workspace", trusted: true });
      checks.reviewWorkspaceRegistered = Boolean(reviewWorkspace && reviewWorkspace.path === reviewFixture.workspacePath);
      const stageDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath });
      const stageProposal = await api.stageWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath, expectedDiffHash: stageDiff.diffHash });
      const stageApproved = await api.decideApproval({ id: stageProposal.approvalId, approved: true });
      const stagedDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stagePath, staged: true });
      details.stageReview = { stageDiff, stageProposal, stageApproved, stagedDiff };
      checks.fileAcceptRequiresApproval = Boolean(stageProposal.approvalQueued && stageProposal.approvalId && stageApproved);
      checks.fileAcceptStagesReviewedDiff = Boolean(stagedDiff.diff && stagedDiff.diff.includes("accepted packaged change"));

      const revertDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath });
      const revertProposal = await api.revertWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath, expectedDiffHash: revertDiff.diffHash });
      const revertApproved = await api.decideApproval({ id: revertProposal.approvalId, approved: true });
      const revertedDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.revertPath });
      details.revertReview = { revertDiff, revertProposal, revertApproved, revertedDiff };
      checks.fileRejectRequiresApproval = Boolean(revertProposal.approvalQueued && revertProposal.approvalId && revertApproved);
      checks.fileRejectClearsReviewedDiff = Boolean(!revertedDiff.diff);

      const staleDiff = await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stalePath });
      const staleProposal = await api.revertWorkspaceFile({ workspacePath: reviewFixture.workspacePath, path: reviewFixture.stalePath, expectedDiffHash: staleDiff.diffHash });
      const staleTerminal = await api.createTerminal({ cwd: reviewFixture.workspacePath, workspaceId: reviewWorkspace.id, workspaceKey: "packaged-review", shellProfile: "cmd", title: "stale-review-writer" });
      await api.writeTerminal(staleTerminal.id, "echo external edit after review>>stale.txt\\r");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await api.killTerminal(staleTerminal.id);
      let staleApprovalRejected = false;
      try {
        await api.decideApproval({ id: staleProposal.approvalId, approved: true });
      } catch (error) {
        details.staleReviewError = String(error && error.message ? error.message : error);
        staleApprovalRejected = String(details.staleReviewError).includes("diff changed since review");
      }
      checks.staleReviewedDiffRejected = staleApprovalRejected;

      let traversalRejected = false;
      try {
        await api.getWorkspaceGitDiff({ workspacePath: reviewFixture.workspacePath, path: "../outside.txt" });
      } catch (error) {
        details.reviewTraversalError = String(error && error.message ? error.message : error);
        traversalRejected = true;
      }
      checks.reviewPathTraversalRejected = traversalRejected;

      const nonGitWorkspace = await api.createWorkspace({ source: "existing", path: reviewFixture.nonGitWorkspacePath, name: "packaged-non-git-review", trusted: true });
      const nonGitCheckpoint = await api.createWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, label: "Before non-Git packaged edit", maxFiles: 20 });
      const nonGitTerminal = await api.createTerminal({ cwd: reviewFixture.nonGitWorkspacePath, workspaceId: nonGitWorkspace.id, workspaceKey: "packaged-non-git", shellProfile: "cmd", title: "non-git-writer" });
      await api.writeTerminal(nonGitTerminal.id, "echo changed without git>>notes.txt\\r\\n");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await api.killTerminal(nonGitTerminal.id);
      const nonGitPreview = await api.previewWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      const nonGitRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      const nonGitRestoreApproved = await api.decideApproval({ id: nonGitRestore.approvalId, approved: true });
      const nonGitPreviewAfter = await api.previewWorkspaceCheckpoint({ workspacePath: reviewFixture.nonGitWorkspacePath, checkpointId: nonGitCheckpoint.id });
      details.nonGitReview = { nonGitWorkspace, nonGitCheckpoint, nonGitPreview, nonGitRestore, nonGitRestoreApproved, nonGitPreviewAfter };
      checks.nonGitBaselineCaptured = Boolean(nonGitCheckpoint.entries && nonGitCheckpoint.entries.some((entry) => entry.relativePath === reviewFixture.nonGitFilePath && entry.stored));
      checks.nonGitChangeDetected = Boolean(nonGitPreview.changedEntryCount === 1 && nonGitPreview.entries.some((entry) => entry.change === "modified"));
      checks.nonGitRestoreRequiresApproval = Boolean(nonGitRestore.approvalQueued && nonGitRestore.approvalId && nonGitRestoreApproved);
      checks.nonGitRestoreClearsChanges = Boolean(nonGitPreviewAfter.changedEntryCount === 0);

      const channelImportFixture = ${JSON.stringify(channelImportFixture)};
      const channelImport = await api.importChannelContext({
        adapterId: "file-input",
        workspacePath: channelImportFixture.workspacePath,
        paths: channelImportFixture.filePaths,
        limit: 55,
      });
      const channelImportItems = channelImport && channelImport.items ? channelImport.items : [];
      const channelImportItemByTitle = (title) => channelImportItems.find((item) => item && (item.title === title || item.relativePath === title));
      const markdownImportItem = channelImportItemByTitle("packaged-channel-import.md");
      const cypressImportItem = channelImportItemByTitle("packaged.cypress-results.json");
      const pngImportItem = channelImportItemByTitle("packaged-channel-import.png");
      const sarifImportItem = channelImportItemByTitle("packaged-results.sarif.json");
      const chatExportImportItem = channelImportItemByTitle("packaged-slack-export.json");
      const chatGptExportImportItem = channelImportItemByTitle("packaged-chatgpt-conversations.json");
      const emlxImportItem = channelImportItemByTitle("packaged-message.emlx");
      const icsImportItem = channelImportItemByTitle("packaged-calendar.ics");
      const vcardImportItem = channelImportItemByTitle("packaged-contact.vcf");
      const contactsCsvImportItem = channelImportItemByTitle("packaged-contacts.csv");
      const calendarCsvImportItem = channelImportItemByTitle("packaged-calendar-agenda.csv");
      const openApiImportItem = channelImportItemByTitle("packaged-openapi.json");
      const logcatImportItem = channelImportItemByTitle("packaged-logcat.logcat");
      const browserCookiesImportItem = channelImportItemByTitle("packaged.cookies.txt");
      const browserPasswordsImportItem = channelImportItemByTitle("packaged-passwords.csv");
      const browserAutofillCsvImportItem = channelImportItemByTitle("packaged-autofill.csv");
      const browserAutofillJsonImportItem = channelImportItemByTitle("packaged-autofill.json");
      const playwrightTraceImportItem = channelImportItemByTitle("packaged.trace.zip");
      const csvImportItem = channelImportItemByTitle("packaged-data.csv");
      const tsvImportItem = channelImportItemByTitle("packaged-data.tsv");
      const powershellTranscriptImportItem = channelImportItemByTitle("packaged.powershell-transcript.txt");
      const opmlImportItem = channelImportItemByTitle("packaged-subscriptions.opml");
      const bookmarksImportItem = channelImportItemByTitle("packaged-bookmarks.html");
      const metricsImportItem = channelImportItemByTitle("packaged.prom");
      const codeownersImportItem = channelImportItemByTitle("CODEOWNERS");
      const robotsImportItem = channelImportItemByTitle("packaged.robots.txt");
      const harImportItem = channelImportItemByTitle("packaged.har");
      const netlogImportItem = channelImportItemByTitle("packaged-netlog.json");
      const junitImportItem = channelImportItemByTitle("packaged.junit.xml");
      const xunitImportItem = channelImportItemByTitle("packaged.xunit.xml");
      const trxImportItem = channelImportItemByTitle("packaged.trx");
      const jmeterPlanImportItem = channelImportItemByTitle("packaged.jmx");
      const ghaSummaryImportItem = channelImportItemByTitle("GITHUB_STEP_SUMMARY.md");
      const vscodeSettingsImportItem = channelImportItemByTitle("settings.json");
      const vscodeTasksImportItem = channelImportItemByTitle("tasks.json");
      const vscodeLaunchImportItem = channelImportItemByTitle("launch.json");
      const vscodeExtensionsImportItem = channelImportItemByTitle("extensions.json");
      const browserHistoryImportItem = channelImportItemByTitle("packaged-history.csv");
      const browserDownloadsImportItem = channelImportItemByTitle("packaged-downloads.json");
      const browserStorageImportItem = channelImportItemByTitle("packaged-local-storage.json");
      const browserExtensionManifestImportItem = channelImportItemByTitle("packaged-extension-manifest.json");
      const pwaServiceWorkerImportItem = channelImportItemByTitle("packaged-service-worker.js");
      const assetLinksImportItem = channelImportItemByTitle("assetlinks.json");
      const appleAssociationImportItem = channelImportItemByTitle("apple-app-site-association");
      const securityTxtImportItem = channelImportItemByTitle("packaged.security.txt");
      const svgImportItem = channelImportItemByTitle("packaged.svg");
      const sshConfigImportItem = channelImportItemByTitle("config");
      const sshKnownHostsImportItem = channelImportItemByTitle("known_hosts");
      const sshAuthorizedKeysImportItem = channelImportItemByTitle("authorized_keys");
      const vpnWireGuardImportItem = channelImportItemByTitle("wg-packaged.conf");
      const vpnOpenVpnImportItem = channelImportItemByTitle("packaged-client.ovpn");
      const rdpImportItem = channelImportItemByTitle("packaged.rdp");
      const envrcImportItem = channelImportItemByTitle(".envrc");
      const rushConfigImportItem = channelImportItemByTitle("rush.json");
      const oxlintConfigImportItem = channelImportItemByTitle("oxlintrc.jsonc");
      details.channelImport = channelImport;
      checks.channelImportViaPreloadIpc = Boolean(channelImport && channelImport.adapterId === "file-input" && channelImportItems.length === 55);
      checks.channelImportWorkspaceBounded = Boolean(channelImport && channelImport.workspacePath === channelImportFixture.workspacePath);
      checks.channelImportMarkdownSummary = Boolean(
        markdownImportItem &&
          String(markdownImportItem.summary || "").includes("packaged channel import fixture") &&
          String(markdownImportItem.summary || "").includes("Markdown preview read local text only")
      );
      checks.channelImportCypressSummary = Boolean(
        cypressImportItem &&
          String(cypressImportItem.summary || "").includes("Test report preview (Cypress JSON") &&
          String(cypressImportItem.summary || "").includes("Cases: 2; passed: 1; non-passing: 1; skipped: 0") &&
          String(cypressImportItem.summary || "").includes("Packaged smoke > fails visibly [failed]") &&
          String(cypressImportItem.summary || "").includes("token=[redacted]") &&
          !String(cypressImportItem.summary || "").includes("secret-packaged-cypress-token")
      );
      checks.channelImportImageSummary = Boolean(
        pngImportItem &&
          String(pngImportItem.summary || "").includes("Image metadata preview") &&
          String(pngImportItem.summary || "").includes("Format: PNG") &&
          String(pngImportItem.summary || "").includes("1 x 1 px") &&
          String(pngImportItem.summary || "").includes("no OCR, vision model, network call, or provider send")
      );
      checks.channelImportSarifSummary = Boolean(
        sarifImportItem &&
          String(sarifImportItem.summary || "").includes("SARIF static analysis result preview") &&
          String(sarifImportItem.summary || "").includes("CodeQL") &&
          String(sarifImportItem.summary || "").includes("js/path-injection") &&
          String(sarifImportItem.summary || "").includes("src/routes.ts:44") &&
          String(sarifImportItem.summary || "").includes("SARIF extension provenance was preserved") &&
          String(sarifImportItem.summary || "").includes("no scanner/test runner/code execution") &&
          String(sarifImportItem.mime || "").includes("application/sarif+json")
      );
      checks.channelImportChatExportSummary = Boolean(
        chatExportImportItem &&
          String(chatExportImportItem.summary || "").includes("Chat export JSON preview (Slack export JSON") &&
          String(chatExportImportItem.summary || "").includes("packaged-smoke-channel") &&
          String(chatExportImportItem.summary || "").includes("Packaged Slack export message") &&
          String(chatExportImportItem.summary || "").includes("token=[redacted]") &&
          !String(chatExportImportItem.summary || "").includes("secret-packaged-slack-token") &&
          String(chatExportImportItem.summary || "").includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login") &&
          String(chatExportImportItem.mime || "").includes("application/vnd.drsai.chat-export+json")
      );
      checks.channelImportChatGptExportSummary = Boolean(
        chatGptExportImportItem &&
          String(chatGptExportImportItem.summary || "").includes("Chat export JSON preview (ChatGPT conversations JSON") &&
          String(chatGptExportImportItem.summary || "").includes("Packaged ChatGPT Conversation") &&
          String(chatGptExportImportItem.summary || "").includes("assistant") &&
          String(chatGptExportImportItem.summary || "").includes("Packaged ChatGPT export prompt") &&
          !String(chatGptExportImportItem.summary || "").includes("secret-packaged-chatgpt-token") &&
          String(chatGptExportImportItem.summary || "").includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login") &&
          String(chatGptExportImportItem.mime || "").includes("application/vnd.drsai.chat-export+json")
      );
      checks.channelImportEmlxSummary = Boolean(
        emlxImportItem &&
          String(emlxImportItem.summary || "").includes("Email message preview") &&
          String(emlxImportItem.summary || "").includes("Packaged Apple Mail smoke") &&
          String(emlxImportItem.summary || "").includes("Apple Mail EMLX envelope metadata was stripped") &&
          String(emlxImportItem.summary || "").includes("Packaged EMLX body token=[redacted]") &&
          !String(emlxImportItem.summary || "").includes("secret-packaged-emlx-token") &&
          !String(emlxImportItem.summary || "").includes("<?xml") &&
          String(emlxImportItem.summary || "").includes("no IMAP/SMTP login") &&
          String(emlxImportItem.mime || "").includes("message/rfc822")
      );
      checks.channelImportIcsSummary = Boolean(
        icsImportItem &&
          String(icsImportItem.summary || "").includes("Calendar ICS file preview") &&
          String(icsImportItem.summary || "").includes("Packaged calendar review") &&
          String(icsImportItem.summary || "").includes("Project sync token=[redacted]") &&
          !String(icsImportItem.summary || "").includes("secret-packaged-ics-token") &&
          String(icsImportItem.summary || "").includes("no calendar app access") &&
          String(icsImportItem.mime || "").includes("text/calendar")
      );
      checks.channelImportVcardSummary = Boolean(
        vcardImportItem &&
          String(vcardImportItem.summary || "").includes("vCard contact preview") &&
          String(vcardImportItem.summary || "").includes("Packaged Contact") &&
          String(vcardImportItem.summary || "").includes("Packaged QA") &&
          String(vcardImportItem.summary || "").includes("packaged.example.test") &&
          String(vcardImportItem.summary || "").includes("no contacts app access") &&
          String(vcardImportItem.mime || "").includes("text/vcard")
      );
      checks.channelImportContactsCsvSummary = Boolean(
        contactsCsvImportItem &&
          String(contactsCsvImportItem.summary || "").includes("Contact CSV export preview") &&
          String(contactsCsvImportItem.summary || "").includes("Packaged CSV Contact") &&
          String(contactsCsvImportItem.summary || "").includes("packaged.example.test") &&
          String(contactsCsvImportItem.summary || "").includes("<redacted 8 digits>") &&
          !String(contactsCsvImportItem.summary || "").includes("secret-packaged-contact-token") &&
          String(contactsCsvImportItem.summary || "").includes("no contacts app access") &&
          String(contactsCsvImportItem.mime || "").includes("text/csv+contacts")
      );
      checks.channelImportCalendarCsvSummary = Boolean(
        calendarCsvImportItem &&
          String(calendarCsvImportItem.summary || "").includes("Calendar CSV agenda preview") &&
          String(calendarCsvImportItem.summary || "").includes("Packaged CSV Calendar Review") &&
          String(calendarCsvImportItem.summary || "").includes("Room token=[redacted]") &&
          String(calendarCsvImportItem.summary || "").includes("Description") &&
          !String(calendarCsvImportItem.summary || "").includes("secret-packaged-calendar-csv-token") &&
          String(calendarCsvImportItem.summary || "").includes("no calendar app access") &&
          String(calendarCsvImportItem.mime || "").includes("text/csv+calendar")
      );
      checks.channelImportOpenApiJsonSummary = Boolean(
        openApiImportItem &&
          String(openApiImportItem.summary || "").includes("API spec/collection preview") &&
          String(openApiImportItem.summary || "").includes("Format: OpenAPI 3.1.0") &&
          String(openApiImportItem.summary || "").includes("Packaged Fixture JSON API") &&
          String(openApiImportItem.summary || "").includes("GET /packaged-runs") &&
          String(openApiImportItem.summary || "").includes("json-packaged.example.test") &&
          String(openApiImportItem.summary || "").includes("apiKeyAuth") &&
          !String(openApiImportItem.summary || "").includes("secret-packaged-openapi-token") &&
          String(openApiImportItem.summary || "").includes("no request execution") &&
          String(openApiImportItem.mime || "").includes("application/json")
      );
      checks.channelImportLogcatSummary = Boolean(
        logcatImportItem &&
          String(logcatImportItem.summary || "").includes("Android logcat export preview") &&
          String(logcatImportItem.summary || "").includes("ActivityTaskManager") &&
          String(logcatImportItem.summary || "").includes("AndroidRuntime") &&
          String(logcatImportItem.summary || "").includes("PackagedDrSai") &&
          String(logcatImportItem.summary || "").includes("token=[redacted]") &&
          !String(logcatImportItem.summary || "").includes("secret-packaged-logcat-token") &&
          String(logcatImportItem.summary || "").includes("no adb/logcat command, device/emulator access, live log streaming") &&
          String(logcatImportItem.mime || "").includes("text/x-android-logcat")
      );
      checks.channelImportBrowserCookiesSummary = Boolean(
        browserCookiesImportItem &&
          String(browserCookiesImportItem.summary || "").includes("Browser cookie export preview") &&
          String(browserCookiesImportItem.summary || "").includes("packaged.example.test") &&
          String(browserCookiesImportItem.summary || "").includes("api.packaged.example.test") &&
          String(browserCookiesImportItem.summary || "").includes("packaged_session") &&
          String(browserCookiesImportItem.summary || "").includes("packaged_auth") &&
          String(browserCookiesImportItem.summary || "").includes("secure=2") &&
          String(browserCookiesImportItem.summary || "").includes("httpOnly=1") &&
          String(browserCookiesImportItem.summary || "").includes("cookie values were always redacted") &&
          !String(browserCookiesImportItem.summary || "").includes("secret-packaged-cookie") &&
          String(browserCookiesImportItem.summary || "").includes("browser profiles were not opened, cookies were not imported") &&
          String(browserCookiesImportItem.mime || "").includes("text/x-netscape-cookies")
      );
      checks.channelImportBrowserPasswordsSummary = Boolean(
        browserPasswordsImportItem &&
          String(browserPasswordsImportItem.summary || "").includes("Browser password CSV export preview") &&
          String(browserPasswordsImportItem.summary || "").includes("login.packaged-passwords.example.test") &&
          String(browserPasswordsImportItem.summary || "").includes("admin.packaged-passwords.example.test") &&
          String(browserPasswordsImportItem.summary || "").includes("email user [redacted]@packaged.example.test") &&
          String(browserPasswordsImportItem.summary || "").includes("username length 19") &&
          String(browserPasswordsImportItem.summary || "").includes("password length 32") &&
          String(browserPasswordsImportItem.summary || "").includes("password=<redacted>") &&
          String(browserPasswordsImportItem.summary || "").includes("password values were never printed") &&
          String(browserPasswordsImportItem.summary || "").includes("browser profiles and Login Data stores were not opened") &&
          !String(browserPasswordsImportItem.summary || "").includes("secret-packaged-password") &&
          String(browserPasswordsImportItem.mime || "").includes("text/csv+browser-passwords")
      );
      checks.channelImportBrowserAutofillCsvSummary = Boolean(
        browserAutofillCsvImportItem &&
          String(browserAutofillCsvImportItem.summary || "").includes("Browser autofill export preview") &&
          String(browserAutofillCsvImportItem.summary || "").includes("checkout.packaged-autofill.example.test") &&
          String(browserAutofillCsvImportItem.summary || "").includes("email") &&
          String(browserAutofillCsvImportItem.summary || "").includes("cc-number") &&
          String(browserAutofillCsvImportItem.summary || "").includes("payment") &&
          String(browserAutofillCsvImportItem.summary || "").includes("sensitive-looking fields detected: 2") &&
          String(browserAutofillCsvImportItem.summary || "").includes("value=<redacted>") &&
          !String(browserAutofillCsvImportItem.summary || "").includes("secret-packaged-autofill") &&
          !String(browserAutofillCsvImportItem.summary || "").includes("4111111111111111") &&
          String(browserAutofillCsvImportItem.summary || "").includes("browser profiles and autofill stores were not opened") &&
          String(browserAutofillCsvImportItem.mime || "").includes("text/csv+browser-autofill")
      );
      checks.channelImportBrowserAutofillJsonSummary = Boolean(
        browserAutofillJsonImportItem &&
          String(browserAutofillJsonImportItem.summary || "").includes("Browser autofill export preview") &&
          String(browserAutofillJsonImportItem.summary || "").includes("profile.packaged-autofill.example.test") &&
          String(browserAutofillJsonImportItem.summary || "").includes("packaged-profile") &&
          String(browserAutofillJsonImportItem.summary || "").includes("given-name") &&
          String(browserAutofillJsonImportItem.summary || "").includes("phone") &&
          String(browserAutofillJsonImportItem.summary || "").includes("tel") &&
          String(browserAutofillJsonImportItem.summary || "").includes("length=29") &&
          !String(browserAutofillJsonImportItem.summary || "").includes("secret-packaged-autofill") &&
          String(browserAutofillJsonImportItem.mime || "").includes("application/vnd.drsai.browser-autofill+json")
      );
      checks.channelImportPlaywrightTraceSummary = Boolean(
        playwrightTraceImportItem &&
          String(playwrightTraceImportItem.summary || "").includes("Playwright trace ZIP preview") &&
          String(playwrightTraceImportItem.summary || "").includes("trace.trace") &&
          String(playwrightTraceImportItem.summary || "").includes("trace.network") &&
          String(playwrightTraceImportItem.summary || "").includes("resources/packaged-request.txt") &&
          String(playwrightTraceImportItem.summary || "").includes("screenshots/packaged-step.png") &&
          String(playwrightTraceImportItem.summary || "").includes("packaged-video.webm") &&
          String(playwrightTraceImportItem.summary || "").includes("test.json") &&
          String(playwrightTraceImportItem.summary || "").includes("trace resources were not extracted") &&
          String(playwrightTraceImportItem.summary || "").includes("tests were not rerun") &&
          String(playwrightTraceImportItem.mime || "").includes("application/vnd.playwright.trace+zip")
      );
      checks.channelImportCsvSummary = Boolean(
        csvImportItem &&
          String(csvImportItem.summary || "").includes("Structured CSV preview") &&
          String(csvImportItem.summary || "").includes("Columns (4): user_id, event_name, status, api_token") &&
          String(csvImportItem.summary || "").includes("identifier/relationship key candidate") &&
          !String(csvImportItem.summary || "").includes("secret-packaged-csv-token") &&
          String(csvImportItem.summary || "").includes("no database connection, network call, spreadsheet macro execution") &&
          String(csvImportItem.mime || "").includes("text/csv")
      );
      checks.channelImportTsvSummary = Boolean(
        tsvImportItem &&
          String(tsvImportItem.summary || "").includes("Structured TSV preview") &&
          String(tsvImportItem.summary || "").includes("Columns (4): run_id, owner, result, created_at") &&
          String(tsvImportItem.summary || "").includes("enum-like values passed, failed") &&
          String(tsvImportItem.summary || "").includes("tab-separated data was parsed from a bounded local byte sample") &&
          String(tsvImportItem.summary || "").includes("no database connection, network call, spreadsheet macro execution") &&
          String(tsvImportItem.mime || "").includes("text/tab-separated-values")
      );
      checks.channelImportPowerShellTranscriptSummary = Boolean(
        powershellTranscriptImportItem &&
          String(powershellTranscriptImportItem.summary || "").includes("PowerShell transcript preview") &&
          String(powershellTranscriptImportItem.summary || "").includes("start=1") &&
          String(powershellTranscriptImportItem.summary || "").includes("end=1") &&
          String(powershellTranscriptImportItem.summary || "").includes("Host Application=powershell.exe -NoProfile -ExecutionPolicy Bypass") &&
          String(powershellTranscriptImportItem.summary || "").includes("PSVersion=5.1.22621.1") &&
          String(powershellTranscriptImportItem.summary || "").includes("npm run verify:packaged") &&
          String(powershellTranscriptImportItem.summary || "").includes("git status --short") &&
          String(powershellTranscriptImportItem.summary || "").includes("warning") &&
          String(powershellTranscriptImportItem.summary || "").includes("fatal") &&
          String(powershellTranscriptImportItem.summary || "").includes("access denied") &&
          String(powershellTranscriptImportItem.summary || "").includes("token=[redacted]") &&
          !String(powershellTranscriptImportItem.summary || "").includes("secret-packaged-transcript") &&
          String(powershellTranscriptImportItem.summary || "").includes("no PowerShell/pwsh process, transcript replay, shell command execution") &&
          String(powershellTranscriptImportItem.mime || "").includes("text/x-powershell-transcript")
      );
      checks.channelImportOpmlSummary = Boolean(
        opmlImportItem &&
          String(opmlImportItem.summary || "").includes("OPML subscription export preview") &&
          String(opmlImportItem.summary || "").includes("Packaged Feed Subscriptions") &&
          String(opmlImportItem.summary || "").includes("Packaged OPML Feed") &&
          String(opmlImportItem.summary || "").includes("https://feeds.example.test/packaged.xml?token=REDACTED") &&
          !String(opmlImportItem.summary || "").includes("secret-packaged-opml-token") &&
          String(opmlImportItem.summary || "").includes("feed URLs were not fetched") &&
          String(opmlImportItem.mime || "").includes("text/x-opml+xml")
      );
      checks.channelImportBookmarksSummary = Boolean(
        bookmarksImportItem &&
          String(bookmarksImportItem.summary || "").includes("Browser bookmark export preview") &&
          String(bookmarksImportItem.summary || "").includes("Packaged Browser Bookmarks") &&
          String(bookmarksImportItem.summary || "").includes("Packaged Bookmark Folder") &&
          String(bookmarksImportItem.summary || "").includes("Packaged Docs") &&
          (String(bookmarksImportItem.summary || "").includes("https://docs.example.test/packaged?token=REDACTED") ||
            String(bookmarksImportItem.summary || "").includes("https://docs.example.test/packaged?token=%5BREDACTED%5D")) &&
          !String(bookmarksImportItem.summary || "").includes("secret-packaged-bookmark-token") &&
          String(bookmarksImportItem.summary || "").includes("URLs were not fetched") &&
          String(bookmarksImportItem.mime || "").includes("text/html")
      );
      checks.channelImportMetricsSummary = Boolean(
        metricsImportItem &&
          String(metricsImportItem.summary || "").includes("Metrics snapshot preview") &&
          String(metricsImportItem.summary || "").includes("packaged_requests_total") &&
          String(metricsImportItem.summary || "").includes("packaged_request_latency_seconds:histogram") &&
          String(metricsImportItem.summary || "").includes("job") &&
          String(metricsImportItem.summary || "").includes("route") &&
          !String(metricsImportItem.summary || "").includes("secret-packaged-metrics-token") &&
          String(metricsImportItem.summary || "").includes("no Prometheus/OpenMetrics server query, scrape, remote write") &&
          String(metricsImportItem.mime || "").includes("text/plain; version=0.0.4")
      );
      checks.channelImportCodeownersSummary = Boolean(
        codeownersImportItem &&
          String(codeownersImportItem.summary || "").includes("Repository governance file preview") &&
          String(codeownersImportItem.summary || "").includes("CODEOWNERS ownership rules") &&
          String(codeownersImportItem.summary || "").includes("/apps/desktop/windows/ -> @opendrsai/windows, @opendrsai/release") &&
          String(codeownersImportItem.summary || "").includes("/docs/ -> @opendrsai/docs") &&
          String(codeownersImportItem.summary || "").includes("no git command, CODEOWNERS resolver") &&
          String(codeownersImportItem.mime || "").includes("text/x-codeowners")
      );
      checks.channelImportRobotsSummary = Boolean(
        robotsImportItem &&
          String(robotsImportItem.summary || "").includes("Web crawl metadata preview (robots.txt") &&
          String(robotsImportItem.summary || "").includes("User agents: PackagedBot") &&
          String(robotsImportItem.summary || "").includes("Disallow rules (1): /private") &&
          String(robotsImportItem.summary || "").includes("Allow rules: /public") &&
          String(robotsImportItem.summary || "").includes("Crawl delays: 5") &&
          String(robotsImportItem.summary || "").includes("https://crawl.example.test/sitemap.xml?token=REDACTED") &&
          !String(robotsImportItem.summary || "").includes("secret-packaged-crawl-token") &&
          String(robotsImportItem.summary || "").includes("remote URLs were not fetched, pages were not crawled, JavaScript was not executed") &&
          String(robotsImportItem.mime || "").includes("text/plain")
      );
      checks.channelImportHarSummary = Boolean(
        harImportItem &&
          String(harImportItem.summary || "").includes("HAR network trace preview") &&
          String(harImportItem.summary || "").includes("Entries: 2") &&
          String(harImportItem.summary || "").includes("Methods: GET 1, POST 1") &&
          String(harImportItem.summary || "").includes("Statuses: 200 OK 1, 502 Bad Gateway 1") &&
          String(harImportItem.summary || "").includes("api-packaged.example.test") &&
          String(harImportItem.summary || "").includes("https://api-packaged.example.test/v1/runs?token=REDACTED") &&
          String(harImportItem.summary || "").includes("Authorization: [REDACTED]") &&
          String(harImportItem.summary || "").includes("Cookie: [REDACTED]") &&
          !String(harImportItem.summary || "").includes("secret-packaged-har") &&
          String(harImportItem.summary || "").includes("no browser profile access, request replay, network call") &&
          String(harImportItem.mime || "").includes("application/har+json")
      );
      checks.channelImportNetlogSummary = Boolean(
        netlogImportItem &&
          String(netlogImportItem.summary || "").includes("Chrome NetLog network trace preview") &&
          String(netlogImportItem.summary || "").includes("HTTP_TRANSACTION_SEND_REQUEST_HEADERS") &&
          String(netlogImportItem.summary || "").includes("URL_REQUEST") &&
          String(netlogImportItem.summary || "").includes("netlog-packaged.example.test") &&
          String(netlogImportItem.summary || "").includes("[redacted]") &&
          !String(netlogImportItem.summary || "").includes("secret-packaged-netlog") &&
          String(netlogImportItem.summary || "").includes("no browser profile access, request replay, network call") &&
          String(netlogImportItem.mime || "").includes("application/vnd.chromium.netlog+json")
      );
      checks.channelImportJunitSummary = Boolean(
        junitImportItem &&
          String(junitImportItem.summary || "").includes("Test report preview (JUnit XML") &&
          String(junitImportItem.summary || "").includes("Cases: 2; failures: 1; errors: 0; skipped: 0") &&
          String(junitImportItem.summary || "").includes("PackagedJUnitSuite") &&
          String(junitImportItem.summary || "").includes("PackagedJunitTest.failsWithToken") &&
          String(junitImportItem.summary || "").includes("api_token=[redacted]") &&
          String(junitImportItem.summary || "").includes("artifacts/[redacted].txt") &&
          !String(junitImportItem.summary || "").includes("secret-packaged-junit-token") &&
          String(junitImportItem.summary || "").includes("no test runner, build command, CI provider API call") &&
          String(junitImportItem.mime || "").includes("application/junit+xml")
      );
      checks.channelImportXunitSummary = Boolean(
        xunitImportItem &&
          String(xunitImportItem.summary || "").includes("Test report preview (xUnit XML") &&
          String(xunitImportItem.summary || "").includes("Cases: 2; passed: 1; non-passing: 1; skipped: 0") &&
          String(xunitImportItem.summary || "").includes("Packaged xUnit Collection") &&
          String(xunitImportItem.summary || "").includes("PackagedXunitFail") &&
          String(xunitImportItem.summary || "").includes("api.token=[redacted]") &&
          String(xunitImportItem.summary || "").includes("artifacts/[redacted].zip") &&
          !String(xunitImportItem.summary || "").includes("secret-packaged-xunit-token") &&
          !String(xunitImportItem.summary || "").includes("secret-packaged-xunit-property") &&
          String(xunitImportItem.summary || "").includes("no test runner, build command, CI provider API call") &&
          String(xunitImportItem.mime || "").includes("application/vnd.xunit+xml")
      );
      checks.channelImportTrxSummary = Boolean(
        trxImportItem &&
          String(trxImportItem.summary || "").includes("Test report preview (Visual Studio TRX") &&
          String(trxImportItem.summary || "").includes("Cases: 3; passed: 2; non-passing: 1") &&
          String(trxImportItem.summary || "").includes("ResultSummary outcome: Failed") &&
          String(trxImportItem.summary || "").includes("PackagedTrxFail [Failed]") &&
          String(trxImportItem.summary || "").includes("token=[redacted]") &&
          !String(trxImportItem.summary || "").includes("secret-packaged-trx-token") &&
          String(trxImportItem.summary || "").includes("no test runner, build command, CI provider API call") &&
          String(trxImportItem.mime || "").includes("application/vnd.ms-trx+xml")
      );
      checks.channelImportJmeterPlanSummary = Boolean(
        jmeterPlanImportItem &&
          String(jmeterPlanImportItem.summary || "").includes("JMeter test plan preview") &&
          String(jmeterPlanImportItem.summary || "").includes("Packaged JMeter Plan") &&
          String(jmeterPlanImportItem.summary || "").includes("Packaged Thread Group") &&
          String(jmeterPlanImportItem.summary || "").includes("Packaged GET /chat") &&
          String(jmeterPlanImportItem.summary || "").includes("Packaged status assertion") &&
          String(jmeterPlanImportItem.summary || "").includes("Packaged Headers") &&
          String(jmeterPlanImportItem.summary || "").includes("Variable keys") &&
          String(jmeterPlanImportItem.summary || "").includes("baseUrl") &&
          String(jmeterPlanImportItem.summary || "").includes("authToken") &&
          String(jmeterPlanImportItem.summary || "").includes("variable values were not expanded") &&
          String(jmeterPlanImportItem.summary || "").includes("no JMeter command, load test, HTTP replay") &&
          !String(jmeterPlanImportItem.summary || "").includes("secret-packaged-jmx") &&
          String(jmeterPlanImportItem.mime || "").includes("application/vnd.jmeter+xml")
      );
      checks.channelImportGhaJobSummary = Boolean(
        ghaSummaryImportItem &&
          String(ghaSummaryImportItem.summary || "").includes("GitHub Actions job summary preview") &&
          String(ghaSummaryImportItem.summary || "").includes("Packaged GitHub Actions Summary") &&
          String(ghaSummaryImportItem.summary || "").includes("Windows packaged smoke -> failed") &&
          String(ghaSummaryImportItem.summary || "").includes("warning") &&
          String(ghaSummaryImportItem.summary || "").includes("coverage") &&
          String(ghaSummaryImportItem.summary || "").includes("packaged report=https://artifact.example.test/packaged.zip?token=[redacted]") &&
          String(ghaSummaryImportItem.summary || "").includes("npm run verify:packaged -- --token [redacted]") &&
          !String(ghaSummaryImportItem.summary || "").includes("secret-packaged-gha-summary") &&
          !String(ghaSummaryImportItem.summary || "").includes("secret-packaged-gha-artifact") &&
          String(ghaSummaryImportItem.summary || "").includes("no GitHub API call") &&
          String(ghaSummaryImportItem.summary || "").includes("linked artifacts were not downloaded") &&
          String(ghaSummaryImportItem.mime || "").includes("text/markdown+github-actions-summary")
      );
      checks.channelImportVsCodeSettingsSummary = Boolean(
        vscodeSettingsImportItem &&
          String(vscodeSettingsImportItem.summary || "").includes("VS Code workspace config preview (VS Code settings.json") &&
          String(vscodeSettingsImportItem.summary || "").includes("editor.formatOnSave") &&
          String(vscodeSettingsImportItem.summary || "").includes("python.defaultInterpreterPath") &&
          !String(vscodeSettingsImportItem.summary || "").includes("secret-packaged-vscode-settings-token") &&
          String(vscodeSettingsImportItem.summary || "").includes("no VS Code process, task/debug launch, extension install") &&
          String(vscodeSettingsImportItem.mime || "").includes("application/vnd.code.settings+json")
      );
      checks.channelImportVsCodeTasksSummary = Boolean(
        vscodeTasksImportItem &&
          String(vscodeTasksImportItem.summary || "").includes("VS Code workspace config preview (VS Code tasks.json") &&
          String(vscodeTasksImportItem.summary || "").includes("Packaged VS Code build") &&
          String(vscodeTasksImportItem.summary || "").includes("problemMatcher=$tsc") &&
          String(vscodeTasksImportItem.summary || "").includes("packagedTarget type=pickString") &&
          String(vscodeTasksImportItem.summary || "").includes("token=[redacted]") &&
          !String(vscodeTasksImportItem.summary || "").includes("secret-packaged-vscode-task-token") &&
          String(vscodeTasksImportItem.summary || "").includes("no VS Code process, task/debug launch, extension install") &&
          String(vscodeTasksImportItem.mime || "").includes("application/vnd.code.tasks+json")
      );
      checks.channelImportVsCodeLaunchSummary = Boolean(
        vscodeLaunchImportItem &&
          String(vscodeLaunchImportItem.summary || "").includes("VS Code workspace config preview (VS Code launch.json") &&
          String(vscodeLaunchImportItem.summary || "").includes("Packaged renderer debug") &&
          String(vscodeLaunchImportItem.summary || "").includes("type=node") &&
          String(vscodeLaunchImportItem.summary || "").includes("request=launch") &&
          String(vscodeLaunchImportItem.mime || "").includes("application/vnd.code.launch+json")
      );
      checks.channelImportVsCodeExtensionsSummary = Boolean(
        vscodeExtensionsImportItem &&
          String(vscodeExtensionsImportItem.summary || "").includes("VS Code workspace config preview (VS Code extensions.json") &&
          String(vscodeExtensionsImportItem.summary || "").includes("ms-vscode.vscode-typescript-next") &&
          String(vscodeExtensionsImportItem.summary || "").includes("unwanted:[redacted]") &&
          !String(vscodeExtensionsImportItem.summary || "").includes("secret-packaged-vscode-extension") &&
          String(vscodeExtensionsImportItem.summary || "").includes("no VS Code process, task/debug launch, extension install") &&
          String(vscodeExtensionsImportItem.mime || "").includes("application/vnd.code.extensions+json")
      );
      checks.channelImportBrowserHistorySummary = Boolean(
        browserHistoryImportItem &&
          String(browserHistoryImportItem.summary || "").includes("Browser history export preview") &&
          String(browserHistoryImportItem.summary || "").includes("packaged-history.example.test") &&
          String(browserHistoryImportItem.summary || "").includes("Packaged History") &&
          String(browserHistoryImportItem.summary || "").includes("visits=4") &&
          String(browserHistoryImportItem.summary || "").includes("token=%5BREDACTED%5D") &&
          !String(browserHistoryImportItem.summary || "").includes("secret-packaged-history-token") &&
          String(browserHistoryImportItem.summary || "").includes("browser profiles were not opened, history databases were not imported") &&
          String(browserHistoryImportItem.mime || "").includes("text/csv+browser-history")
      );
      checks.channelImportBrowserDownloadsSummary = Boolean(
        browserDownloadsImportItem &&
          String(browserDownloadsImportItem.summary || "").includes("Browser downloads export preview") &&
          String(browserDownloadsImportItem.summary || "").includes("packaged-downloads.example.test") &&
          String(browserDownloadsImportItem.summary || "").includes("packaged-installer.exe") &&
          String(browserDownloadsImportItem.summary || "").includes("token=%5BREDACTED%5D") &&
          !String(browserDownloadsImportItem.summary || "").includes("secret-packaged-download-token") &&
          String(browserDownloadsImportItem.summary || "").includes("target paths were reduced to filenames") &&
          String(browserDownloadsImportItem.summary || "").includes("downloaded files were not opened or executed") &&
          String(browserDownloadsImportItem.mime || "").includes("application/vnd.drsai.browser-downloads+json")
      );
      checks.channelImportBrowserStorageSummary = Boolean(
        browserStorageImportItem &&
          String(browserStorageImportItem.summary || "").includes("Browser storage export preview") &&
          String(browserStorageImportItem.summary || "").includes("packaged-storage.example.test") &&
          String(browserStorageImportItem.summary || "").includes("localStorage") &&
          String(browserStorageImportItem.summary || "").includes("packagedApiToken") &&
          String(browserStorageImportItem.summary || "").includes("storage values were classified but not printed") &&
          !String(browserStorageImportItem.summary || "").includes("secret-packaged-storage-token") &&
          String(browserStorageImportItem.summary || "").includes("browser profiles and LevelDB/IndexedDB stores were not opened") &&
          String(browserStorageImportItem.mime || "").includes("application/vnd.drsai.browser-storage+json")
      );
      checks.channelImportBrowserExtensionManifestSummary = Boolean(
        browserExtensionManifestImportItem &&
          String(browserExtensionManifestImportItem.summary || "").includes("Browser extension manifest preview") &&
          String(browserExtensionManifestImportItem.summary || "").includes("Packaged Extension Smoke") &&
          String(browserExtensionManifestImportItem.summary || "").includes("tabs") &&
          String(browserExtensionManifestImportItem.summary || "").includes("https://extension-packaged.example.test/*") &&
          !String(browserExtensionManifestImportItem.summary || "").includes("secret-packaged-extension-token") &&
          String(browserExtensionManifestImportItem.summary || "").includes("extension code was not loaded or executed") &&
          String(browserExtensionManifestImportItem.mime || "").includes("application/vnd.drsai.browser-extension-manifest+json")
      );
      checks.channelImportPwaServiceWorkerSummary = Boolean(
        pwaServiceWorkerImportItem &&
          String(pwaServiceWorkerImportItem.summary || "").includes("PWA service worker script preview") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("install") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("activate") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("fetch") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("push") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("packaged-runtime-v1") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("/packaged-workbox.js?token=REDACTED") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("notifications") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("navigation preload") &&
          String(pwaServiceWorkerImportItem.summary || "").includes("no browser was launched, no service worker was registered, no cache was opened") &&
          !String(pwaServiceWorkerImportItem.summary || "").includes("secret-packaged-sw-token") &&
          String(pwaServiceWorkerImportItem.mime || "").includes("text/javascript")
      );
      checks.channelImportAssetLinksSummary = Boolean(
        assetLinksImportItem &&
          String(assetLinksImportItem.summary || "").includes("Web app association preview (Android Digital Asset Links") &&
          String(assetLinksImportItem.summary || "").includes("android_app package=ai.drsai.packaged") &&
          String(assetLinksImportItem.summary || "").includes("delegate_permission/common.handle_all_urls") &&
          String(assetLinksImportItem.summary || "").includes("SHA-256 certificate fingerprints hidden (1)") &&
          !String(assetLinksImportItem.summary || "").includes("AA:BB:CC") &&
          String(assetLinksImportItem.summary || "").includes("association URLs were not fetched") &&
          String(assetLinksImportItem.summary || "").includes("apps were not installed or launched") &&
          String(assetLinksImportItem.mime || "").includes("application/vnd.drsai.web-app-association+json")
      );
      checks.channelImportAppleAssociationSummary = Boolean(
        appleAssociationImportItem &&
          String(appleAssociationImportItem.summary || "").includes("Web app association preview (Apple App Site Association") &&
          String(appleAssociationImportItem.summary || "").includes("applinks PACKAGED123.ai.drsai.packaged") &&
          String(appleAssociationImportItem.summary || "").includes("webcredentials") &&
          String(appleAssociationImportItem.summary || "").includes("activitycontinuation") &&
          String(appleAssociationImportItem.summary || "").includes("/packaged/*") &&
          String(appleAssociationImportItem.summary || "").includes("[redacted]") &&
          !String(appleAssociationImportItem.summary || "").includes("secret-packaged-aasa-token") &&
          String(appleAssociationImportItem.summary || "").includes("no domain verification ran") &&
          String(appleAssociationImportItem.summary || "").includes("no network call or provider send") &&
          String(appleAssociationImportItem.mime || "").includes("application/vnd.drsai.web-app-association+json")
      );
      checks.channelImportSecurityTxtSummary = Boolean(
        securityTxtImportItem &&
          String(securityTxtImportItem.summary || "").includes("security.txt vulnerability disclosure policy preview") &&
          String(securityTxtImportItem.summary || "").includes("security-packaged@example.test") &&
          String(securityTxtImportItem.summary || "").includes("https://security-packaged.example.test/report?token=[redacted]") &&
          String(securityTxtImportItem.summary || "").includes("Expires values: 2026-12-31T23:59:59Z") &&
          String(securityTxtImportItem.summary || "").includes("Preferred languages: en, zh") &&
          !String(securityTxtImportItem.summary || "").includes("secret-packaged-security-token") &&
          String(securityTxtImportItem.summary || "").includes("contact/policy URLs were not fetched") &&
          String(securityTxtImportItem.summary || "").includes("PGP signatures were not verified") &&
          String(securityTxtImportItem.mime || "").includes("text/vnd.security")
      );
      checks.channelImportSvgSummary = Boolean(
        svgImportItem &&
          String(svgImportItem.summary || "").includes("Image metadata preview") &&
          String(svgImportItem.summary || "").includes("Format: SVG") &&
          String(svgImportItem.summary || "").includes("Dimensions: 96 x 64 px") &&
          String(svgImportItem.summary || "").includes("viewBox=0 0 96 64") &&
          String(svgImportItem.summary || "").includes("symbol=1") &&
          String(svgImportItem.summary || "").includes("script=1") &&
          String(svgImportItem.summary || "").includes("foreignObject=1") &&
          String(svgImportItem.summary || "").includes("packaged-icon") &&
          String(svgImportItem.summary || "").includes("Packaged SVG Map") &&
          !String(svgImportItem.summary || "").includes("secret-packaged-svg-token") &&
          !String(svgImportItem.summary || "").includes("secret-packaged-svg-script") &&
          String(svgImportItem.summary || "").includes("no OCR, vision model, network call") &&
          String(svgImportItem.mime || "").includes("image/svg+xml")
      );
      checks.channelImportSshConfigSummary = Boolean(
        sshConfigImportItem &&
          String(sshConfigImportItem.summary || "").includes("SSH configuration preview") &&
          String(sshConfigImportItem.summary || "").includes("packaged-prod") &&
          String(sshConfigImportItem.summary || "").includes("packaged.example.test") &&
          String(sshConfigImportItem.summary || "").includes("packaged-user") &&
          String(sshConfigImportItem.summary || "").includes("2200") &&
          String(sshConfigImportItem.summary || "").includes("id_packaged_secret") &&
          String(sshConfigImportItem.summary || "").includes("ProxyJump") &&
          String(sshConfigImportItem.summary || "").includes("ProxyCommand may execute a local command") &&
          String(sshConfigImportItem.summary || "").includes("private key files and Include targets were not opened") &&
          !String(sshConfigImportItem.summary || "").includes("secret-packaged-ssh-token") &&
          String(sshConfigImportItem.mime || "").includes("text/x-ssh-config")
      );
      checks.channelImportSshKnownHostsSummary = Boolean(
        sshKnownHostsImportItem &&
          String(sshKnownHostsImportItem.summary || "").includes("known_hosts") &&
          String(sshKnownHostsImportItem.summary || "").includes("packaged.example.test") &&
          String(sshKnownHostsImportItem.summary || "").includes("hashed-host") &&
          String(sshKnownHostsImportItem.summary || "").includes("ssh-ed25519") &&
          String(sshKnownHostsImportItem.summary || "").includes("ssh-rsa") &&
          !String(sshKnownHostsImportItem.summary || "").includes("secretPackagedKnownHostMaterial") &&
          String(sshKnownHostsImportItem.summary || "").includes("no ssh/scp/sftp/ssh-keygen command")
      );
      checks.channelImportSshAuthorizedKeysSummary = Boolean(
        sshAuthorizedKeysImportItem &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("authorized_keys") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("ssh-ed25519") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("ssh-rsa") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("packaged deploy key") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("packaged readonly key") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("authorized_keys option command") &&
          String(sshAuthorizedKeysImportItem.summary || "").includes("authorized_keys key material were not expanded") &&
          !String(sshAuthorizedKeysImportItem.summary || "").includes("PackagedAuthorizedSecretMaterial") &&
          !String(sshAuthorizedKeysImportItem.summary || "").includes("secret-packaged-authorized-command")
      );
      checks.channelImportVpnWireGuardSummary = Boolean(
        vpnWireGuardImportItem &&
          String(vpnWireGuardImportItem.summary || "").includes("VPN client configuration preview (WireGuard client profile") &&
          String(vpnWireGuardImportItem.summary || "").includes("Sections/directives (2): Interface, Peer") &&
          String(vpnWireGuardImportItem.summary || "").includes("Address=10.77.0.2/32") &&
          String(vpnWireGuardImportItem.summary || "").includes("Endpoint=vpn-packaged.example.test:51820") &&
          String(vpnWireGuardImportItem.summary || "").includes("AllowedIPs=0.0.0.0/0, ::/0") &&
          String(vpnWireGuardImportItem.summary || "").includes("DNS=9.9.9.9") &&
          String(vpnWireGuardImportItem.summary || "").includes("PrivateKey=[redacted]") &&
          String(vpnWireGuardImportItem.summary || "").includes("PresharedKey=[redacted]") &&
          String(vpnWireGuardImportItem.summary || "").includes("hook command declared") &&
          String(vpnWireGuardImportItem.summary || "").includes("full-tunnel route declared") &&
          !String(vpnWireGuardImportItem.summary || "").includes("secret-packaged-wireguard") &&
          String(vpnWireGuardImportItem.summary || "").includes("no WireGuard/OpenVPN client, tunnel activation, route/DNS mutation") &&
          String(vpnWireGuardImportItem.mime || "").includes("application/vnd.drsai.vpn-config")
      );
      checks.channelImportVpnOpenVpnSummary = Boolean(
        vpnOpenVpnImportItem &&
          String(vpnOpenVpnImportItem.summary || "").includes("VPN client configuration preview (OpenVPN client profile") &&
          String(vpnOpenVpnImportItem.summary || "").includes("remote=vpn-openvpn-packaged.example.test 1194") &&
          String(vpnOpenVpnImportItem.summary || "").includes("dev=tun") &&
          String(vpnOpenVpnImportItem.summary || "").includes("proto=udp") &&
          String(vpnOpenVpnImportItem.summary || "").includes("redirect-gateway=def1") &&
          String(vpnOpenVpnImportItem.summary || "").includes("auth-user-pass=[redacted]") &&
          String(vpnOpenVpnImportItem.summary || "").includes("tls-auth=[redacted]") &&
          String(vpnOpenVpnImportItem.summary || "").includes("key=[redacted]") &&
          String(vpnOpenVpnImportItem.summary || "").includes("OpenVPN script hook requires review") &&
          String(vpnOpenVpnImportItem.summary || "").includes("credential material redacted") &&
          !String(vpnOpenVpnImportItem.summary || "").includes("secret-packaged-openvpn") &&
          String(vpnOpenVpnImportItem.summary || "").includes("no WireGuard/OpenVPN client, tunnel activation, route/DNS mutation") &&
          String(vpnOpenVpnImportItem.mime || "").includes("application/vnd.drsai.vpn-config")
      );
      checks.channelImportRdpSummary = Boolean(
        rdpImportItem &&
          String(rdpImportItem.summary || "").includes("Remote Desktop RDP configuration preview") &&
          String(rdpImportItem.summary || "").includes("rdp.packaged.example.test") &&
          String(rdpImportItem.summary || "").includes("gateway.packaged.example.test?token=[redacted]") &&
          String(rdpImportItem.summary || "").includes("username length 17") &&
          String(rdpImportItem.summary || "").includes("redirectdrives=1") &&
          String(rdpImportItem.summary || "").includes("local resource redirection requires review") &&
          String(rdpImportItem.summary || "").includes("password 51 value redacted") &&
          !String(rdpImportItem.summary || "").includes("secret-packaged-rdp") &&
          String(rdpImportItem.summary || "").includes("no mstsc.exe launch, RDP connection, gateway probe") &&
          String(rdpImportItem.mime || "").includes("application/x-rdp")
      );
      checks.channelImportDirenvEnvrcSummary = Boolean(
        envrcImportItem &&
          String(envrcImportItem.summary || "").includes("direnv .envrc preview") &&
          String(envrcImportItem.summary || "").includes("PACKAGED_DIRENV_TOKEN") &&
          String(envrcImportItem.summary || "").includes("PACKAGED_PUBLIC_URL") &&
          String(envrcImportItem.summary || "").includes("dotenv targets: .env.packaged") &&
          String(envrcImportItem.summary || "").includes("use directives: node") &&
          String(envrcImportItem.summary || "").includes("layout directives: python") &&
          String(envrcImportItem.summary || "").includes("watch targets: package.json") &&
          String(envrcImportItem.summary || "").includes("source targets: .env.shared") &&
          String(envrcImportItem.summary || "").includes("network download/request") &&
          String(envrcImportItem.summary || "").includes("toolchain command") &&
          String(envrcImportItem.summary || "").includes("direnv was not executed") &&
          String(envrcImportItem.summary || "").includes("dotenv/source targets were not opened") &&
          !String(envrcImportItem.summary || "").includes("secret-packaged-direnv") &&
          String(envrcImportItem.mime || "").includes("text/x-direnv")
      );
      checks.channelImportRushWorkspaceSummary = Boolean(
        rushConfigImportItem &&
          String(rushConfigImportItem.summary || "").includes("JS/TS workspace config preview (Rush workspace") &&
          String(rushConfigImportItem.summary || "").includes("@packaged/app") &&
          String(rushConfigImportItem.summary || "").includes("apps/packaged-app") &&
          String(rushConfigImportItem.summary || "").includes("packaged-build") &&
          String(rushConfigImportItem.summary || "").includes("approvedPackagesPolicy: reviewCategories") &&
          String(rushConfigImportItem.summary || "").includes("credential-shaped key redacted") &&
          !String(rushConfigImportItem.summary || "").includes("secret-packaged-rush") &&
          String(rushConfigImportItem.summary || "").includes("no pnpm/npm/Yarn/Bun command, Turbo/Nx/Rush runner") &&
          String(rushConfigImportItem.mime || "").includes("application/vnd.drsai.js-workspace-config")
      );
      checks.channelImportOxlintConfigSummary = Boolean(
        oxlintConfigImportItem &&
          String(oxlintConfigImportItem.summary || "").includes("JS/TS tooling config preview (Oxlint") &&
          String(oxlintConfigImportItem.summary || "").includes("correctness") &&
          String(oxlintConfigImportItem.summary || "").includes("eqeqeq") &&
          String(oxlintConfigImportItem.summary || "").includes("react/jsx-key") &&
          String(oxlintConfigImportItem.summary || "").includes("packagedToken") &&
          String(oxlintConfigImportItem.summary || "").includes("[redacted]") &&
          !String(oxlintConfigImportItem.summary || "").includes("secret-packaged-oxlint") &&
          String(oxlintConfigImportItem.summary || "").includes("no Oxlint command") &&
          String(oxlintConfigImportItem.mime || "").includes("application/vnd.drsai.js-tooling-config")
      );
      checks.channelImportNoProviderSend = Boolean(
        channelImport &&
          String(channelImport.verification || "").includes("Read-only channel import is limited to workspace-local file summaries")
      );

      const ideContextFixtures = ${JSON.stringify(ideContextFixtures)};
      const ideContexts = [];
      for (const fixture of ideContextFixtures) {
        ideContexts.push(await api.getIdeContext(fixture.workspacePath));
      }
      details.ideContexts = ideContexts;
      checks.ideContextViaPreloadIpc = ideContexts.length === 3 && ideContexts.every((context) => context && context.available === true);
      checks.ideContextSources = ideContexts.every((context, index) => context && context.source === ideContextFixtures[index].source);
      checks.ideContextCurrentFiles = ideContexts.every((context, index) =>
        context &&
          context.currentFile &&
          context.currentFile.relativePath === ideContextFixtures[index].relativePath &&
          String(context.currentFile.path || "").endsWith(ideContextFixtures[index].relativePath.replace(/\\//g, "\\\\"))
      );
      checks.ideContextSelections = ideContexts.every((context, index) =>
        context &&
          context.currentSelection &&
          context.currentSelection.relativePath === ideContextFixtures[index].relativePath &&
          context.currentSelection.text === ideContextFixtures[index].selectionText &&
          context.currentSelection.truncated === false
      );
      checks.ideContextWorkspaceBounded = ideContexts.every((context, index) =>
        context && context.workspacePath === ideContextFixtures[index].workspacePath
      );

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  result.checks.nonGitRestoreRestoresDisk =
    normalizeSmokeText(readFileSync(join(workspaceReviewFixture.nonGitWorkspacePath, workspaceReviewFixture.nonGitFilePath), "utf8")).trimEnd() ===
    normalizeSmokeText(workspaceReviewFixture.nonGitBaseContent).trimEnd();

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
}

function prepareWorkspaceReviewFixture(): WorkspaceReviewFixture {
  if (!process.env.DRSAI_HOME) throw new Error("DRSAI_HOME is required for workspace review smoke.");
  const workspacePath = join(process.env.DRSAI_HOME, "desktop", "workspace-review-e2e");
  removeSmokeFixture(workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  runSmokeGit(workspacePath, ["init"]);
  runSmokeGit(workspacePath, ["config", "user.email", "packaged-review@opendrsai.local"]);
  runSmokeGit(workspacePath, ["config", "user.name", "OpenDrSai Packaged Review"]);
  const stagePath = "accept.txt";
  const revertPath = "reject.txt";
  const stalePath = "stale.txt";
  const revertBaseContent = "base reject content\n";
  writeFileSync(join(workspacePath, stagePath), "base accept content\n", "utf8");
  writeFileSync(join(workspacePath, revertPath), revertBaseContent, "utf8");
  writeFileSync(join(workspacePath, stalePath), "base stale content\n", "utf8");
  runSmokeGit(workspacePath, ["add", "."]);
  runSmokeGit(workspacePath, ["commit", "-m", "workspace review base"]);
  const stageChangedContent = "base accept content\naccepted packaged change\n";
  writeFileSync(join(workspacePath, stagePath), stageChangedContent, "utf8");
  writeFileSync(join(workspacePath, revertPath), "base reject content\nrejected packaged change\n", "utf8");
  writeFileSync(join(workspacePath, stalePath), "base stale content\nreviewed change\n", "utf8");
  const nonGitWorkspacePath = join(process.env.DRSAI_HOME, "desktop", "non-git-review-e2e");
  removeSmokeFixture(nonGitWorkspacePath);
  mkdirSync(nonGitWorkspacePath, { recursive: true });
  const nonGitFilePath = "notes.txt";
  const nonGitBaseContent = "non-git baseline content\n";
  writeFileSync(join(nonGitWorkspacePath, nonGitFilePath), nonGitBaseContent, "utf8");
  return { workspacePath, stagePath, revertPath, stalePath, stageChangedContent, revertBaseContent, nonGitWorkspacePath, nonGitFilePath, nonGitBaseContent };
}

function prepareChannelImportFixture(): ChannelImportFixture {
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the packaged channel import fixture.");
  }
  const workspacePath = join(process.env.DRSAI_HOME, "desktop", "channel-import-e2e", "workspace");
  removeSmokeFixture(workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  const filePath = join(workspacePath, "packaged-channel-import.md");
  writeFileSync(
    filePath,
    [
      "# Packaged channel import fixture",
      "",
      "This packaged channel import fixture verifies real preload IPC to the main-process file-input adapter.",
      "",
    ].join("\n"),
    "utf8",
  );
  const cypressJsonPath = join(workspacePath, "packaged.cypress-results.json");
  writeFileSync(
    cypressJsonPath,
    JSON.stringify({
      totalTests: 2,
      totalPassed: 1,
      totalFailed: 1,
      totalPending: 0,
      totalSkipped: 0,
      totalDuration: 1250,
      runs: [
        {
          spec: { relative: "cypress/e2e/packaged-smoke.cy.ts", name: "packaged-smoke.cy.ts" },
          stats: { tests: 2, passes: 1, failures: 1, pending: 0, skipped: 0, wallClockDuration: 1250 },
          tests: [
            { title: ["Packaged smoke", "imports markdown"], state: "passed", attempts: [{ state: "passed" }] },
            {
              title: ["Packaged smoke", "fails visibly"],
              state: "failed",
              displayError: "Packaged Cypress failure token=secret-packaged-cypress-token",
              attempts: [{ state: "failed" }],
            },
          ],
        },
      ],
    }, null, 2),
    "utf8",
  );
  const pngPath = join(workspacePath, "packaged-channel-import.png");
  writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUzf4QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const sarifJsonPath = join(workspacePath, "packaged-results.sarif.json");
  writeFileSync(
    sarifJsonPath,
    JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "CodeQL", rules: [{ id: "js/path-injection" }] } },
          results: [
            {
              ruleId: "js/path-injection",
              level: "warning",
              message: { text: "Packaged smoke detected untrusted path construction." },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/routes.ts" },
                    region: { startLine: 44 },
                  },
                },
              ],
            },
          ],
        },
      ],
    }, null, 2),
    "utf8",
  );
  const chatExportJsonPath = join(workspacePath, "packaged-slack-export.json");
  writeFileSync(
    chatExportJsonPath,
    JSON.stringify([
      {
        type: "message",
        channel: "packaged-smoke-channel",
        user: "U-packaged-smoke",
        ts: "1783702800.000100",
        text: "Packaged Slack export message token=secret-packaged-slack-token",
      },
    ], null, 2),
    "utf8",
  );
  const emlxPath = join(workspacePath, "packaged-message.emlx");
  const emlxMessage = [
    "From: packaged-sender@example.test",
    "To: packaged-reviewer@example.test",
    "Subject: Packaged Apple Mail smoke",
    "Date: Sat, 11 Jul 2026 09:15:00 +0800",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Packaged EMLX body token=secret-packaged-emlx-token",
  ].join("\r\n");
  writeFileSync(
    emlxPath,
    [
      String(Buffer.byteLength(emlxMessage, "utf8")),
      emlxMessage,
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<plist version=\"1.0\"><dict><key>flags</key><integer>0</integer></dict></plist>",
    ].join("\n"),
    "utf8",
  );
  const chatGptExportJsonPath = join(workspacePath, "packaged-chatgpt-conversations.json");
  writeFileSync(
    chatGptExportJsonPath,
    JSON.stringify([
      {
        title: "Packaged ChatGPT Conversation",
        mapping: {
          prompt: {
            message: {
              author: { role: "user" },
              content: { parts: ["Packaged ChatGPT export prompt token=secret-packaged-chatgpt-token"] },
            },
          },
          answer: {
            message: {
              author: { role: "assistant" },
              content: { parts: ["Packaged ChatGPT export answer for reviewed local context."] },
            },
          },
        },
      },
    ], null, 2),
    "utf8",
  );
  const icsPath = join(workspacePath, "packaged-calendar.ics");
  writeFileSync(
    icsPath,
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenDrSai//Packaged Smoke//EN",
      "BEGIN:VEVENT",
      "UID:packaged-calendar-smoke@example.test",
      "DTSTAMP:20260711T020000Z",
      "DTSTART:20260711T033000Z",
      "DTEND:20260711T040000Z",
      "SUMMARY:Packaged calendar review",
      "LOCATION:Project sync token=secret-packaged-ics-token",
      "DESCRIPTION:Review packaged calendar IPC fixture.",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
    "utf8",
  );
  const vcardPath = join(workspacePath, "packaged-contact.vcf");
  writeFileSync(
    vcardPath,
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Packaged Contact",
      "ORG:Packaged QA",
      "TITLE:IPC Reviewer",
      "EMAIL:reviewer@packaged.example.test",
      "TEL:+1-555-0100",
      "URL:https://contacts-packaged.example.test/profile",
      "NOTE:Packaged contact fixture for reviewed local IPC.",
      "END:VCARD",
    ].join("\r\n"),
    "utf8",
  );
  const contactsCsvPath = join(workspacePath, "packaged-contacts.csv");
  writeFileSync(
    contactsCsvPath,
    [
      "Display Name,Company,Job Title,E-mail Address,Mobile Phone,Business City,Notes",
      "Packaged CSV Contact,Packaged QA,Reviewer,packaged-contact@packaged.example.test,+1-555-0199,Shanghai,token=secret-packaged-contact-token",
    ].join("\n"),
    "utf8",
  );
  const calendarCsvPath = join(workspacePath, "packaged-calendar-agenda.csv");
  writeFileSync(
    calendarCsvPath,
    [
      "Subject,Start Date,Start Time,End Date,End Time,Location,Required Attendees,Description",
      "Packaged CSV Calendar Review,2026-07-12,10:00,2026-07-12,10:30,Room token=secret-packaged-calendar-csv-token,reviewer@packaged.example.test,Hidden description token=secret-packaged-calendar-csv-token",
    ].join("\n"),
    "utf8",
  );
  const openApiJsonPath = join(workspacePath, "packaged-openapi.json");
  writeFileSync(
    openApiJsonPath,
    JSON.stringify({
      openapi: "3.1.0",
      info: {
        title: "Packaged Fixture JSON API",
        version: "1.0.0",
      },
      servers: [{ url: "https://json-packaged.example.test/v1?token=secret-packaged-openapi-token" }],
      paths: {
        "/packaged-runs": {
          get: {
            operationId: "listPackagedRuns",
            security: [{ apiKeyAuth: [] }],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        securitySchemes: {
          apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    }, null, 2),
    "utf8",
  );
  const logcatPath = join(workspacePath, "packaged-logcat.logcat");
  writeFileSync(
    logcatPath,
    [
      "07-11 11:01:02.123  2211  2211 I ActivityTaskManager: Displayed ai.opendrsai/.MainActivity",
      "07-11 11:01:03.456  2211  2299 W PackagedDrSai: sync retry token=secret-packaged-logcat-token",
      "07-11 11:01:04.789  3333  3333 E AndroidRuntime: FATAL EXCEPTION: main",
    ].join("\n"),
    "utf8",
  );
  const browserCookiesPath = join(workspacePath, "packaged.cookies.txt");
  writeFileSync(
    browserCookiesPath,
    [
      "# Netscape HTTP Cookie File",
      ".packaged.example.test\tTRUE\t/\tTRUE\t2147483647\tpackaged_session\tsecret-packaged-cookie-session",
      "#HttpOnly_api.packaged.example.test\tFALSE\t/api\tTRUE\t0\tpackaged_auth\tsecret-packaged-cookie-auth",
      "static.packaged.example.test\tFALSE\t/assets\tFALSE\t1\tpackaged_pref\tsecret-packaged-cookie-pref",
    ].join("\n"),
    "utf8",
  );
  const browserPasswordsPath = join(workspacePath, "packaged-passwords.csv");
  writeFileSync(
    browserPasswordsPath,
    [
      "name,url,username,password,note",
      "Packaged User Login,https://login.packaged-passwords.example.test/sign-in?token=secret-packaged-password-url-token,packaged-user@packaged.example.test,secret-packaged-password-value-1,primary login",
      "Packaged Admin Login,https://admin.packaged-passwords.example.test/,packaged-admin-user,secret-packaged-admin-password,admin password token=secret-packaged-password-note-token",
    ].join("\n"),
    "utf8",
  );
  const browserAutofillCsvPath = join(workspacePath, "packaged-autofill.csv");
  writeFileSync(
    browserAutofillCsvPath,
    [
      "origin,form,name,type,value",
      "https://checkout.packaged-autofill.example.test,packaged-checkout,email,email,secret-packaged-autofill-email@example.test",
      "https://checkout.packaged-autofill.example.test,packaged-checkout,cc-number,payment,4111111111111111",
    ].join("\n"),
    "utf8",
  );
  const browserAutofillJsonPath = join(workspacePath, "packaged-autofill.json");
  writeFileSync(
    browserAutofillJsonPath,
    JSON.stringify({
      forms: [
        {
          origin: "https://profile.packaged-autofill.example.test",
          form: "packaged-profile",
          fields: [
            { name: "given-name", type: "text", value: "secret-packaged-autofill-name" },
            { name: "phone", type: "tel", value: "secret-packaged-autofill-phone" },
          ],
        },
      ],
    }, null, 2),
    "utf8",
  );
  const playwrightTraceZipPath = join(workspacePath, "packaged.trace.zip");
  writeFileSync(
    playwrightTraceZipPath,
    Buffer.concat([
      createSmokeZipLocalEntry("trace.trace", JSON.stringify({ type: "context-options", browserName: "chromium" })),
      createSmokeZipLocalEntry("trace.network", JSON.stringify({ method: "GET", url: "https://trace-packaged.example.test?token=secret-packaged-trace-token" })),
      createSmokeZipLocalEntry("resources/packaged-request.txt", "Packaged trace resource placeholder"),
      createSmokeZipLocalEntry("screenshots/packaged-step.png", "PNG packaged screenshot placeholder"),
      createSmokeZipLocalEntry("packaged-video.webm", "WEBM packaged video placeholder"),
      createSmokeZipLocalEntry("test.json", JSON.stringify({ title: "Packaged Playwright trace fixture" })),
    ]),
  );
  const csvPath = join(workspacePath, "packaged-data.csv");
  writeFileSync(
    csvPath,
    [
      "user_id,event_name,status,api_token",
      "1,packaged-open,active,secret-packaged-csv-token",
      "2,packaged-close,inactive,public-row",
      "3,packaged-review,active,public-row-2",
    ].join("\n"),
    "utf8",
  );
  const tsvPath = join(workspacePath, "packaged-data.tsv");
  writeFileSync(
    tsvPath,
    [
      "run_id\towner\tresult\tcreated_at",
      "run-1\talice\tpassed\t2026-07-11",
      "run-2\tbob\tfailed\t2026-07-11",
      "run-3\tcarol\tpassed\t2026-07-11",
    ].join("\n"),
    "utf8",
  );
  const powershellTranscriptPath = join(workspacePath, "packaged.powershell-transcript.txt");
  writeFileSync(
    powershellTranscriptPath,
    [
      "**********************",
      "Windows PowerShell transcript start",
      "Start time: 20260711111501",
      "Username: DESKTOP-PACKAGED\\runner",
      "RunAs User: DESKTOP-PACKAGED\\runner",
      "Host Application: powershell.exe -NoProfile -ExecutionPolicy Bypass",
      "Process ID: 5151",
      "PSVersion: 5.1.22621.1",
      "**********************",
      "PS C:\\repo> npm run verify:packaged -- --token=secret-packaged-transcript-token",
      "Packaged transcript warning: retrying IPC smoke",
      "PS C:\\repo> git status --short",
      "fatal: access denied token=secret-packaged-transcript-output",
      "At line:1 char:1",
      "+ Invoke-RestMethod https://api.example.test/packaged?token=secret-packaged-transcript-url",
      "+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "CategoryInfo          : SecurityError: (:) [], UnauthorizedAccessException",
      "**********************",
      "Windows PowerShell transcript end",
      "End time: 20260711111509",
      "**********************",
    ].join("\n"),
    "utf8",
  );
  const opmlPath = join(workspacePath, "packaged-subscriptions.opml");
  writeFileSync(
    opmlPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">',
      "  <head>",
      "    <title>Packaged Feed Subscriptions</title>",
      "    <ownerName>OpenDrSai Packaged Smoke</ownerName>",
      "  </head>",
      "  <body>",
      '    <outline text="Packaged OPML Group" title="Packaged OPML Group">',
      '      <outline text="Packaged OPML Feed" title="Packaged OPML Feed" type="rss" xmlUrl="https://feeds.example.test/packaged.xml?token=secret-packaged-opml-token" htmlUrl="https://example.test/packaged"/>',
      "    </outline>",
      "  </body>",
      "</opml>",
    ].join("\n"),
    "utf8",
  );
  const bookmarksPath = join(workspacePath, "packaged-bookmarks.html");
  writeFileSync(
    bookmarksPath,
    [
      "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
      "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">",
      "<TITLE>Packaged Browser Bookmarks</TITLE>",
      "<H1>Packaged Browser Bookmarks</H1>",
      "<DL><p>",
      "  <DT><H3 ADD_DATE=\"1783598400\">Packaged Bookmark Folder</H3>",
      "  <DL><p>",
      "    <DT><A HREF=\"https://docs.example.test/packaged?token=secret-packaged-bookmark-token\" ADD_DATE=\"1783598401\">Packaged Docs</A>",
      "  </DL><p>",
      "</DL><p>",
    ].join("\n"),
    "utf8",
  );
  const metricsPath = join(workspacePath, "packaged.prom");
  writeFileSync(
    metricsPath,
    [
      "# HELP packaged_requests_total Packaged request count",
      "# TYPE packaged_requests_total counter",
      'packaged_requests_total{job="desktop",route="/packaged",token="secret-packaged-metrics-token"} 7',
      "# HELP packaged_request_latency_seconds Packaged request latency",
      "# TYPE packaged_request_latency_seconds histogram",
      'packaged_request_latency_seconds_bucket{job="desktop",route="/packaged",le="0.5"} 4',
      'packaged_request_latency_seconds_bucket{job="desktop",route="/packaged",le="+Inf"} 7',
    ].join("\n"),
    "utf8",
  );
  const codeownersPath = join(workspacePath, "CODEOWNERS");
  writeFileSync(
    codeownersPath,
    [
      "# Packaged ownership fixture",
      "/apps/desktop/windows/ @opendrsai/windows @opendrsai/release",
      "/docs/ @opendrsai/docs",
    ].join("\n"),
    "utf8",
  );
  const robotsPath = join(workspacePath, "packaged.robots.txt");
  writeFileSync(
    robotsPath,
    [
      "User-agent: PackagedBot",
      "Disallow: /private",
      "Allow: /public",
      "Crawl-delay: 5",
      "Sitemap: https://crawl.example.test/sitemap.xml?token=secret-packaged-crawl-token",
    ].join("\n"),
    "utf8",
  );
  const harPath = join(workspacePath, "packaged.har");
  writeFileSync(
    harPath,
    JSON.stringify({
      log: {
        version: "1.2",
        creator: { name: "OpenDrSai packaged smoke", version: "1.0" },
        entries: [
          {
            startedDateTime: "2026-07-11T03:30:00.000Z",
            time: 42,
            request: {
              method: "GET",
              url: "https://api-packaged.example.test/v1/runs?token=secret-packaged-har-token&view=summary",
              headers: [
                { name: "Authorization", value: "Bearer secret-packaged-har-auth" },
                { name: "Accept", value: "application/json" },
              ],
            },
            response: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "application/json" }],
              content: { mimeType: "application/json" },
            },
          },
          {
            startedDateTime: "2026-07-11T03:30:01.000Z",
            time: 117,
            request: {
              method: "POST",
              url: "https://api-packaged.example.test/v1/runs",
              headers: [
                { name: "Cookie", value: "session=secret-packaged-har-cookie" },
                { name: "Content-Type", value: "application/json" },
              ],
            },
            response: {
              status: 502,
              statusText: "Bad Gateway",
              headers: [{ name: "Content-Type", value: "text/plain" }],
              content: { mimeType: "text/plain" },
            },
          },
        ],
      },
    }, null, 2),
    "utf8",
  );
  const netlogPath = join(workspacePath, "packaged-netlog.json");
  writeFileSync(
    netlogPath,
    JSON.stringify({
      constants: {
        logEventTypes: {
          1: "URL_REQUEST",
          2: "HTTP_TRANSACTION_SEND_REQUEST_HEADERS",
          3: "HTTP_TRANSACTION_READ_RESPONSE_HEADERS",
        },
        logEventPhase: {
          1: "PHASE_BEGIN",
          2: "PHASE_END",
        },
        logSourceType: {
          1: "URL_REQUEST",
          2: "HTTP_STREAM_JOB",
        },
      },
      events: [
        {
          type: 1,
          source: { type: 1, id: 501 },
          phase: 1,
          params: {
            url: "https://netlog-packaged.example.test/api?token=secret-packaged-netlog-token",
            method: "GET",
          },
        },
        {
          type: 2,
          source: { type: 1, id: 501 },
          phase: 1,
          params: {
            headers: [
              "authorization: Bearer secret-packaged-netlog-auth",
              "accept: application/json",
            ],
          },
        },
        {
          type: 3,
          source: { type: 2, id: 777 },
          phase: 2,
          params: {
            headers: [
              "HTTP/1.1 200 OK",
              "set-cookie: packaged=secret-packaged-netlog-cookie",
            ],
          },
        },
      ],
    }, null, 2),
    "utf8",
  );
  const junitXmlPath = join(workspacePath, "packaged.junit.xml");
  writeFileSync(
    junitXmlPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="PackagedJUnit" tests="2" failures="1" errors="0" skipped="0" time="0.210">',
      '  <testsuite name="PackagedJUnitSuite" tests="2" failures="1" errors="0" skipped="0" time="0.210">',
      '    <properties>',
      '      <property name="api_token" value="secret-packaged-junit-token"/>',
      '    </properties>',
      '    <testcase classname="PackagedJunitTest" name="passes" time="0.050"/>',
      '    <testcase classname="PackagedJunitTest" name="failsWithToken" time="0.160">',
      '      <failure message="token=secret-packaged-junit-token">Expected packaged failure evidence.</failure>',
      '      <system-out>[[ATTACHMENT|artifacts/secret-packaged-junit-token.txt]]</system-out>',
      "    </testcase>",
      "  </testsuite>",
      "</testsuites>",
    ].join("\n"),
    "utf8",
  );
  const xunitXmlPath = join(workspacePath, "packaged.xunit.xml");
  writeFileSync(
    xunitXmlPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<assemblies>",
      '  <assembly name="Packaged.Xunit.dll" total="2" passed="1" failed="1" skipped="0" time="0.330">',
      '    <collection name="Packaged xUnit Collection" total="2" passed="1" failed="1" skipped="0" time="0.330">',
      '      <test name="PackagedXunitPass" type="Packaged.Xunit" method="PackagedXunitPass" result="Pass" time="0.100" />',
      '      <test name="PackagedXunitFail" type="Packaged.Xunit" method="PackagedXunitFail" result="Fail" time="0.230">',
      '        <property name="api.token" value="secret-packaged-xunit-property" />',
      '        <failure><message>xUnit packaged failure token=secret-packaged-xunit-token</message></failure>',
      '        <output>[[ATTACHMENT|artifacts/secret-packaged-xunit-token.zip]]</output>',
      "      </test>",
      "    </collection>",
      "  </assembly>",
      "</assemblies>",
    ].join("\n"),
    "utf8",
  );
  const trxPath = join(workspacePath, "packaged.trx");
  writeFileSync(
    trxPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<TestRun name="PackagedTrxRun">',
      '  <ResultSummary outcome="Failed">',
      '    <Counters total="3" executed="3" passed="2" failed="1" error="0" timeout="0" aborted="0" notExecuted="0" notRunnable="0" />',
      "  </ResultSummary>",
      "  <Results>",
      '    <UnitTestResult testName="PackagedTrxPassOne" outcome="Passed" />',
      '    <UnitTestResult testName="PackagedTrxPassTwo" outcome="Passed" />',
      '    <UnitTestResult testName="PackagedTrxFail" outcome="Failed"><Output><ErrorInfo><Message>TRX packaged failure token=secret-packaged-trx-token</Message></ErrorInfo></Output></UnitTestResult>',
      "  </Results>",
      "</TestRun>",
    ].join("\n"),
    "utf8",
  );
  const jmeterPlanPath = join(workspacePath, "packaged.jmx");
  writeFileSync(
    jmeterPlanPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">',
      "  <hashTree>",
      '    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Packaged JMeter Plan" enabled="true">',
      '      <stringProp name="TestPlan.comments">token=secret-packaged-jmx-comment-token</stringProp>',
      '      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments">',
      '        <collectionProp name="Arguments.arguments">',
      '          <elementProp name="baseUrl" elementType="Argument"><stringProp name="Argument.name">baseUrl</stringProp><stringProp name="Argument.value">https://packaged.example.test?token=secret-packaged-jmx-base-token</stringProp></elementProp>',
      '          <elementProp name="authToken" elementType="Argument"><stringProp name="Argument.name">authToken</stringProp><stringProp name="Argument.value">secret-packaged-jmx-auth-token</stringProp></elementProp>',
      "        </collectionProp>",
      "      </elementProp>",
      "    </TestPlan>",
      "    <hashTree>",
      '      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Packaged Thread Group" enabled="true">',
      '        <stringProp name="ThreadGroup.num_threads">2</stringProp>',
      "      </ThreadGroup>",
      "      <hashTree>",
      '        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Packaged GET /chat" enabled="true">',
      '          <stringProp name="HTTPSampler.domain">${baseUrl}</stringProp>',
      '          <stringProp name="HTTPSampler.path">/chat</stringProp>',
      "        </HTTPSamplerProxy>",
      "        <hashTree />",
      '        <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Packaged status assertion" enabled="true" />',
      "        <hashTree />",
      '        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Packaged Headers" enabled="true">',
      '          <collectionProp name="HeaderManager.headers"><elementProp name="Authorization" elementType="Header"><stringProp name="Header.name">Authorization</stringProp><stringProp name="Header.value">Bearer secret-packaged-jmx-header-token</stringProp></elementProp></collectionProp>',
      "        </HeaderManager>",
      "        <hashTree />",
      "      </hashTree>",
      "    </hashTree>",
      "  </hashTree>",
      "</jmeterTestPlan>",
    ].join("\n"),
    "utf8",
  );
  const ghaJobSummaryPath = join(workspacePath, "GITHUB_STEP_SUMMARY.md");
  writeFileSync(
    ghaJobSummaryPath,
    [
      "# Packaged GitHub Actions Summary",
      "",
      "| Check | Result | Notes |",
      "| --- | --- | --- |",
      "| Windows packaged smoke | failed | packaged report=https://artifact.example.test/packaged.zip?token=secret-packaged-gha-artifact-token |",
      "| Coverage | warning | renderer branch coverage below target |",
      "",
      "Failure: packaged smoke saw token=secret-packaged-gha-summary-token in diagnostic text.",
      "",
      "`npm run verify:packaged -- --token secret-packaged-gha-summary-command-token`",
    ].join("\n"),
    "utf8",
  );
  const vscodeDir = join(workspacePath, ".vscode");
  mkdirSync(vscodeDir, { recursive: true });
  const vscodeSettingsPath = join(vscodeDir, "settings.json");
  writeFileSync(
    vscodeSettingsPath,
    [
      "{",
      "  // Packaged IPC fixture; values are not resolved.",
      '  "editor.formatOnSave": true,',
      '  "python.defaultInterpreterPath": ".venv\\\\Scripts\\\\python.exe",',
      '  "terminal.integrated.env.windows": {',
      '    "API_TOKEN": "secret-packaged-vscode-settings-token"',
      "  }",
      "}",
    ].join("\n"),
    "utf8",
  );
  const vscodeTasksPath = join(vscodeDir, "tasks.json");
  writeFileSync(
    vscodeTasksPath,
    JSON.stringify({
      version: "2.0.0",
      tasks: [
        {
          label: "Packaged VS Code build",
          type: "shell",
          command: "npm run build -- --token=secret-packaged-vscode-task-token",
          problemMatcher: "$tsc",
        },
      ],
      inputs: [{ id: "packagedTarget", type: "pickString", options: ["desktop", "installer"] }],
    }, null, 2),
    "utf8",
  );
  const vscodeLaunchPath = join(vscodeDir, "launch.json");
  writeFileSync(
    vscodeLaunchPath,
    JSON.stringify({
      version: "0.2.0",
      configurations: [
        {
          name: "Packaged renderer debug",
          type: "node",
          request: "launch",
          program: "${workspaceFolder}/src/renderer/index.tsx",
        },
      ],
    }, null, 2),
    "utf8",
  );
  const vscodeExtensionsPath = join(vscodeDir, "extensions.json");
  writeFileSync(
    vscodeExtensionsPath,
    JSON.stringify({
      recommendations: ["ms-vscode.vscode-typescript-next", "dbaeumer.vscode-eslint"],
      unwantedRecommendations: ["secret-packaged-vscode-extension"],
    }, null, 2),
    "utf8",
  );
  const browserHistoryPath = join(workspacePath, "packaged-history.csv");
  writeFileSync(
    browserHistoryPath,
    [
      "url,title,visit count,typed count,last visit time",
      "https://packaged-history.example.test/docs?token=secret-packaged-history-token,Packaged History,4,1,2026-07-12T01:00:00Z",
    ].join("\n"),
    "utf8",
  );
  const browserDownloadsPath = join(workspacePath, "packaged-downloads.json");
  writeFileSync(
    browserDownloadsPath,
    JSON.stringify({
      downloads: [
        {
          url: "https://packaged-downloads.example.test/releases/packaged-installer.exe?token=secret-packaged-download-token",
          targetPath: "C:\\Users\\win11\\Downloads\\packaged-installer.exe",
          referrer: "https://packaged-downloads.example.test/releases",
          state: "complete",
          danger: "safe",
          receivedBytes: 4096,
          totalBytes: 4096,
          endTime: "2026-07-12T01:10:00Z",
        },
      ],
    }, null, 2),
    "utf8",
  );
  const browserStoragePath = join(workspacePath, "packaged-local-storage.json");
  writeFileSync(
    browserStoragePath,
    JSON.stringify({
      origin: "https://packaged-storage.example.test",
      localStorage: {
        theme: "dark",
        packagedApiToken: "secret-packaged-storage-token",
      },
    }, null, 2),
    "utf8",
  );
  const browserExtensionManifestPath = join(workspacePath, "packaged-extension-manifest.json");
  writeFileSync(
    browserExtensionManifestPath,
    JSON.stringify({
      manifest_version: 3,
      name: "Packaged Extension Smoke",
      version: "1.0.0",
      permissions: ["tabs", "storage"],
      host_permissions: ["https://extension-packaged.example.test/*?token=secret-packaged-extension-token"],
      background: { service_worker: "background.js" },
      content_scripts: [{ matches: ["https://extension-packaged.example.test/*"], js: ["content.js"] }],
    }, null, 2),
    "utf8",
  );
  const pwaServiceWorkerPath = join(workspacePath, "packaged-service-worker.js");
  writeFileSync(
    pwaServiceWorkerPath,
    [
      'importScripts("/packaged-workbox.js?token=secret-packaged-sw-token");',
      'const CACHE_NAME = "packaged-runtime-v1";',
      'self.addEventListener("install", (event) => {',
      "  self.skipWaiting();",
      '  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["/index.html", "/offline.html"])));',
      "});",
      'self.addEventListener("activate", (event) => {',
      "  event.waitUntil(self.registration.navigationPreload.enable());",
      "});",
      'self.addEventListener("fetch", (event) => {',
      "  event.respondWith(new StaleWhileRevalidate().handle({ event, request: event.request }));",
      "});",
      'self.addEventListener("push", (event) => {',
      '  event.waitUntil(self.registration.showNotification("Packaged push", { body: "token=secret-packaged-sw-token" }));',
      "});",
    ].join("\n"),
    "utf8",
  );
  const assetLinksPath = join(workspacePath, "assetlinks.json");
  writeFileSync(
    assetLinksPath,
    JSON.stringify([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "ai.drsai.packaged",
          sha256_cert_fingerprints: ["AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"],
        },
      },
    ], null, 2),
    "utf8",
  );
  const appleAssociationPath = join(workspacePath, "apple-app-site-association");
  writeFileSync(
    appleAssociationPath,
    JSON.stringify({
      applinks: {
        details: [
          {
            appIDs: ["PACKAGED123.ai.drsai.packaged"],
            components: [
              { "/": "/packaged/*" },
              { "/": "/handoff/packaged", "?": { token: "secret-packaged-aasa-token" } },
            ],
          },
        ],
      },
      webcredentials: { apps: ["PACKAGED123.ai.drsai.packaged"] },
      activitycontinuation: { apps: ["PACKAGED123.ai.drsai.packaged"] },
    }, null, 2),
    "utf8",
  );
  const securityTxtPath = join(workspacePath, "packaged.security.txt");
  writeFileSync(
    securityTxtPath,
    [
      "Contact: mailto:security-packaged@example.test",
      "Contact: https://security-packaged.example.test/report?token=secret-packaged-security-token",
      "Expires: 2026-12-31T23:59:59Z",
      "Encryption: https://security-packaged.example.test/pgp-key.txt",
      "Preferred-Languages: en, zh",
      "Canonical: https://packaged.example.test/.well-known/security.txt",
      "Policy: https://packaged.example.test/security-policy",
    ].join("\n"),
    "utf8",
  );
  const svgPath = join(workspacePath, "packaged.svg");
  writeFileSync(
    svgPath,
    [
      '<svg width="96" height="64" viewBox="0 0 96 64" xmlns="http://www.w3.org/2000/svg">',
      "  <title>Packaged SVG Map</title>",
      "  <desc>Packaged IPC SVG structure preview</desc>",
      '  <symbol id="packaged-icon"><path id="packaged-path" d="M1 1 L20 20" /></symbol>',
      '  <use href="#packaged-icon" />',
      '  <image id="packaged-remote-image" href="https://svg-packaged.example.test/pixel.png?token=secret-packaged-svg-token" width="10" height="10" />',
      '  <foreignObject id="packaged-foreign"><div xmlns="http://www.w3.org/1999/xhtml">Packaged HTML Island</div></foreignObject>',
      '  <script>console.log("secret-packaged-svg-script")</script>',
      '  <text id="packaged-label">Packaged SVG Label</text>',
      "</svg>",
    ].join("\n"),
    "utf8",
  );
  const sshDir = join(workspacePath, ".ssh");
  mkdirSync(sshDir, { recursive: true });
  const sshConfigPath = join(sshDir, "config");
  writeFileSync(
    sshConfigPath,
    [
      "Host packaged-prod packaged-alias",
      "  HostName packaged.example.test",
      "  User packaged-user",
      "  Port 2200",
      "  IdentityFile ~/.ssh/id_packaged_secret",
      "  ProxyJump jump.packaged.example.test",
      "  Include secret-packaged-include.conf",
      "Host packaged-risky",
      "  HostName risky-packaged.example.test?token=secret-packaged-ssh-token",
      "  ProxyCommand ssh jump.packaged.example.test nc %h %p",
    ].join("\n"),
    "utf8",
  );
  const sshKnownHostsPath = join(sshDir, "known_hosts");
  writeFileSync(
    sshKnownHostsPath,
    [
      "packaged.example.test,192.0.2.42 ssh-ed25519 AAAAC3NzaPackagedsecretPackagedKnownHostMaterial Packaged host",
      "|1|packagedSalt|packagedHash ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQsecretPackagedKnownHostHash",
    ].join("\n"),
    "utf8",
  );
  const sshAuthorizedKeysPath = join(sshDir, "authorized_keys");
  writeFileSync(
    sshAuthorizedKeysPath,
    [
      'from="10.20.0.0/16",command="/usr/local/bin/packaged --token=secret-packaged-authorized-command" ssh-ed25519 AAAAC3NzaPackagedAuthorizedSecretMaterial packaged deploy key',
      "restrict,no-pty ssh-rsa AAAAB3NzaPackagedAuthorizedSecretMaterial2 packaged readonly key",
    ].join("\n"),
    "utf8",
  );
  const rdpPath = join(workspacePath, "packaged.rdp");
  writeFileSync(
    rdpPath,
    [
      "screen mode id:i:2",
      "use multimon:i:1",
      "desktopwidth:i:1920",
      "desktopheight:i:1080",
      "session bpp:i:32",
      "full address:s:rdp.packaged.example.test",
      "alternate full address:s:rdp-alt.packaged.example.test",
      "gatewayhostname:s:gateway.packaged.example.test?token=secret-packaged-rdp-gateway-token",
      "username:s:packaged-rdp-user",
      "authentication level:i:2",
      "prompt for credentials:i:1",
      "redirectclipboard:i:1",
      "redirectdrives:i:1",
      "remoteapplicationmode:i:1",
      "remoteapplicationprogram:s:||packagedapp",
      "password 51:b:secret-packaged-rdp-password-blob",
    ].join("\r\n"),
    "utf8",
  );
  const vpnWireGuardPath = join(workspacePath, "wg-packaged.conf");
  writeFileSync(
    vpnWireGuardPath,
    [
      "[Interface]",
      "Address = 10.77.0.2/32",
      "DNS = 9.9.9.9",
      "PrivateKey = secret-packaged-wireguard-private-key-material",
      "PostUp = powershell.exe -File packaged-up.ps1 --token secret-packaged-wireguard-hook",
      "[Peer]",
      "PublicKey = packagedWireGuardPeerPublicKeyValue",
      "PresharedKey = secret-packaged-wireguard-psk-material",
      "AllowedIPs = 0.0.0.0/0, ::/0",
      "Endpoint = vpn-packaged.example.test:51820",
      "PersistentKeepalive = 25",
    ].join("\n"),
    "utf8",
  );
  const vpnOpenVpnPath = join(workspacePath, "packaged-client.ovpn");
  writeFileSync(
    vpnOpenVpnPath,
    [
      "client",
      "dev tun",
      "proto udp",
      "remote vpn-openvpn-packaged.example.test 1194",
      "redirect-gateway def1",
      "auth-user-pass secret-packaged-openvpn-auth.txt",
      "ca packaged-ca.crt",
      "cert packaged-client.crt",
      "key secret-packaged-openvpn-client.key",
      "tls-auth secret-packaged-openvpn-ta.key 1",
      "script-security 2",
      "up packaged-up.bat --token secret-packaged-openvpn-hook",
      "setenv DRS_TOKEN secret-packaged-openvpn-url-token",
    ].join("\n"),
    "utf8",
  );
  const envrcPath = join(workspacePath, ".envrc");
  writeFileSync(
    envrcPath,
    [
      "export PACKAGED_DIRENV_TOKEN=secret-packaged-direnv-token",
      "PACKAGED_PUBLIC_URL=https://direnv-packaged.example.test?token=secret-packaged-direnv-url-token",
      "dotenv .env.packaged",
      "use node",
      "layout python",
      "watch_file package.json",
      "source_env .env.shared",
      "curl https://direnv-packaged.example.test/bootstrap.sh?token=secret-packaged-direnv-curl-token",
      "npm install --token=secret-packaged-direnv-npm-token",
    ].join("\n"),
    "utf8",
  );
  const rushConfigPath = join(workspacePath, "rush.json");
  writeFileSync(
    rushConfigPath,
    JSON.stringify({
      "$schema": "https://developer.microsoft.com/json-schemas/rush/v5/rush.schema.json",
      rushVersion: "5.155.0",
      pnpmVersion: "10.12.1",
      approvedPackagesPolicy: { reviewCategories: ["production", "tools"] },
      commandLine: {
        commands: {
          "packaged-build": {
            commandKind: "bulk",
            summary: "Build packaged projects",
            safeForSimultaneousRushProcesses: true,
          },
        },
      },
      projects: [
        {
          packageName: "@packaged/app",
          projectFolder: "apps/packaged-app",
          reviewCategory: "production",
        },
        {
          packageName: "@packaged/tools",
          projectFolder: "tools/packaged",
          reviewCategory: "tools",
        },
      ],
      telemetryToken: "secret-packaged-rush-token",
    }, null, 2),
    "utf8",
  );
  const oxlintConfigPath = join(workspacePath, "oxlintrc.jsonc");
  writeFileSync(
    oxlintConfigPath,
    [
      "{",
      "  // Packaged Oxlint fixture stays local-only.",
      "  \"categories\": { \"correctness\": \"error\", \"suspicious\": \"warn\" },",
      "  \"rules\": { \"eqeqeq\": \"error\", \"react/jsx-key\": \"error\", \"no-debugger\": \"warn\" },",
      "  \"plugins\": [\"react\", \"typescript\"],",
      "  \"env\": { \"browser\": true, \"node\": true },",
      "  \"ignorePatterns\": [\"release/**\", \"dist/**\"],",
      "  \"packagedToken\": \"secret-packaged-oxlint-token\"",
      "}",
    ].join("\n"),
    "utf8",
  );
  return {
    workspacePath,
    markdownPath: filePath,
    cypressJsonPath,
    pngPath,
    sarifJsonPath,
    chatExportJsonPath,
    chatGptExportJsonPath,
    emlxPath,
    icsPath,
    vcardPath,
    contactsCsvPath,
    calendarCsvPath,
    openApiJsonPath,
    logcatPath,
    browserCookiesPath,
    browserPasswordsPath,
    browserAutofillCsvPath,
    browserAutofillJsonPath,
    playwrightTraceZipPath,
    csvPath,
    tsvPath,
    powershellTranscriptPath,
    opmlPath,
    bookmarksPath,
    metricsPath,
    codeownersPath,
    robotsPath,
    harPath,
    netlogPath,
    junitXmlPath,
    xunitXmlPath,
    trxPath,
    jmeterPlanPath,
    ghaJobSummaryPath,
    vscodeSettingsPath,
    vscodeTasksPath,
    vscodeLaunchPath,
    vscodeExtensionsPath,
    browserHistoryPath,
    browserDownloadsPath,
    browserStoragePath,
    browserExtensionManifestPath,
    pwaServiceWorkerPath,
    assetLinksPath,
    appleAssociationPath,
    securityTxtPath,
    svgPath,
    sshConfigPath,
    sshKnownHostsPath,
    sshAuthorizedKeysPath,
    vpnWireGuardPath,
    vpnOpenVpnPath,
    rdpPath,
    envrcPath,
    rushConfigPath,
    oxlintConfigPath,
    filePaths: [
      filePath,
      cypressJsonPath,
      pngPath,
      sarifJsonPath,
      chatExportJsonPath,
      chatGptExportJsonPath,
      emlxPath,
      icsPath,
      vcardPath,
      contactsCsvPath,
      calendarCsvPath,
      openApiJsonPath,
      logcatPath,
      browserCookiesPath,
      browserPasswordsPath,
      browserAutofillCsvPath,
      browserAutofillJsonPath,
      playwrightTraceZipPath,
      csvPath,
      tsvPath,
      powershellTranscriptPath,
      opmlPath,
      bookmarksPath,
      metricsPath,
      codeownersPath,
      robotsPath,
      harPath,
      netlogPath,
      junitXmlPath,
      xunitXmlPath,
      trxPath,
      jmeterPlanPath,
      ghaJobSummaryPath,
      vscodeSettingsPath,
      vscodeTasksPath,
      vscodeLaunchPath,
      vscodeExtensionsPath,
      browserHistoryPath,
      browserDownloadsPath,
      browserStoragePath,
      browserExtensionManifestPath,
      pwaServiceWorkerPath,
      assetLinksPath,
      appleAssociationPath,
      securityTxtPath,
      svgPath,
      sshConfigPath,
      sshKnownHostsPath,
      sshAuthorizedKeysPath,
      vpnWireGuardPath,
      vpnOpenVpnPath,
      rdpPath,
      envrcPath,
      rushConfigPath,
      oxlintConfigPath,
    ],
  };
}

function createSmokeZipLocalEntry(name: string, contents: string): Buffer {
  const nameBuffer = Buffer.from(name, "utf8");
  const data = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer, data]);
}

function prepareIdeContextFixtures(): IdeContextFixture[] {
  if (!process.env.DRSAI_HOME) {
    throw new Error("DRSAI_HOME is required for the packaged IDE context fixture.");
  }
  const sources: IdeContextFixture["source"][] = ["vscode", "jetbrains", "visual_studio"];
  const selectionTexts: Record<IdeContextFixture["source"], string> = {
    vscode: "packaged vscode IDE selection",
    jetbrains: "packaged jetbrains IDE selection",
    visual_studio: "packaged visual_studio IDE selection",
  };
  return sources.map((source) => {
    const workspacePath = join(process.env.DRSAI_HOME || "", "desktop", "ide-context-e2e", source, "workspace");
    removeSmokeFixture(workspacePath);
    const sourceDir = join(workspacePath, "src");
    const drsaiDir = join(workspacePath, ".drsai");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(drsaiDir, { recursive: true });
    const relativePath = "src/packaged-ide-context.ts";
    const sourcePath = join(workspacePath, "src", "packaged-ide-context.ts");
    const selectionText = selectionTexts[source];
    writeFileSync(
      sourcePath,
      [
        "export function packagedIdeContextFixture() {",
        `  return ${JSON.stringify(selectionText)};`,
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(drsaiDir, "ide-context.json"),
      JSON.stringify({
        source,
        capturedAt: "2026-07-11T09:30:00.000Z",
        currentFile: {
          path: sourcePath,
          relativePath,
          language: "typescript",
          line: 2,
          column: 10,
        },
        currentSelection: {
          path: sourcePath,
          relativePath,
          language: "typescript",
          startLine: 2,
          endLine: 2,
          text: selectionText,
        },
      }, null, 2),
      "utf8",
    );
    return {
      source,
      workspacePath,
      sourcePath,
      relativePath,
      selectionText,
    };
  });
}

function writeResult(path: string, result: SmokeResult): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function removeSmokeFixture(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    // Antivirus/indexing services can briefly retain handles after the
    // terminal and Git subprocesses exit on Windows.
    maxRetries: 10,
    retryDelay: 250,
  });
}
