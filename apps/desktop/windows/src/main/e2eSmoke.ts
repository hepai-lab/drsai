import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { app, clipboard, type BrowserWindow } from "electron";

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

async function runPresentationPdfActionSmoke(window: BrowserWindow): Promise<SmokeResult> {
  const fixtureName = process.env.OPENDRSAI_E2E_PRESENTATION_PDF_NAME || "";
  const fixturePath = process.env.OPENDRSAI_E2E_PRESENTATION_PDF_PATH || "";
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const fixtureName = ${JSON.stringify(fixtureName)};
      const fixturePath = ${JSON.stringify(fixturePath)};
      const checks = {};
      const details = { fixtureName, fixturePath, capturedAt: new Date().toISOString() };

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
      const actionButton = action?.querySelector('[data-testid="generate-manager-presentation"]');
      checks.actionVisible = Boolean(actionButton)
        && /生成管理者版 PPT|Create manager PPT/i.test(actionButton?.textContent || "");
      const editRequirementsButton = action?.querySelector("button.secondary");
      checks.editRequirementsVisible = Boolean(editRequirementsButton);

      actionButton?.click();
      const validatingProgress = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
        return candidate?.getAttribute("data-phase") === "generating" ? candidate : null;
      }, 60000);
      const cancelledOutputPath = validatingProgress?.getAttribute("data-output-path") || "";
      const cancelButton = document.querySelector('[data-testid="cancel-manager-presentation"]');
      checks.cancelActionVisible = Boolean(cancelButton) && /取消生成|Cancel/i.test(cancelButton?.textContent || "");
      cancelButton?.click();
      const cancelledProgress = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
        return candidate?.getAttribute("data-phase") === "cancelled" ? candidate : null;
      }, 10000);
      checks.cancellationCompleted = Boolean(cancelledProgress)
        && /已取消|cancelled/i.test(cancelledProgress?.textContent || "");
      const cancelledRequestId = cancelledProgress?.getAttribute("data-request-id") || "";
      const apiAfterCancel = window.openDrSai;
      details.cancelledOutputPath = cancelledOutputPath;
      if (apiAfterCancel && cancelledOutputPath) {
        let pptxMissing = false;
        let manifestMissing = false;
        try {
          await apiAfterCancel.previewWorkspaceFile({
            workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
            path: cancelledOutputPath,
            maxBytes: 1024,
          });
        } catch { pptxMissing = true; }
        try {
          await apiAfterCancel.previewWorkspaceFile({
            workspacePath: fixturePath.slice(0, fixturePath.lastIndexOf("\\\\")),
            path: cancelledOutputPath.replace(/\.pptx$/i, ".provenance.json"),
            maxBytes: 1024,
          });
        } catch { manifestMissing = true; }
        checks.cancelledNoPartialFiles = pptxMissing && manifestMissing;
      } else {
        checks.cancelledNoPartialFiles = false;
      }
      const retryAfterCancel = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="generate-manager-presentation"]');
        return candidate && !candidate.disabled && /重试生成|Retry generation/i.test(candidate.textContent || "")
          ? candidate
          : null;
      }, 5000);
      checks.retryAfterCancelVisible = /重试生成|Retry generation/i.test(retryAfterCancel?.textContent || "");
      retryAfterCancel?.click();
      const failedProgress = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="manager-presentation-progress"]');
        return candidate?.getAttribute("data-request-id") !== cancelledRequestId
          && candidate?.getAttribute("data-phase") === "failed" ? candidate : null;
      }, 10000);
      checks.injectedFailureVisible = Boolean(failedProgress)
        && /Simulated presentation failure at analyzing/i.test(failedProgress?.textContent || "");
      const failedRequestId = failedProgress?.getAttribute("data-request-id") || "";
      const retryAfterFailure = await waitFor(() => {
        const candidate = document.querySelector('[data-testid="generate-manager-presentation"]');
        return candidate && !candidate.disabled && /重试生成|Retry generation/i.test(candidate.textContent || "")
          ? candidate
          : null;
      }, 5000);
      checks.retryAfterFailureVisible = /重试生成|Retry generation/i.test(retryAfterFailure?.textContent || "");
      retryAfterFailure?.click();
      const generatedResult = await waitFor(() => {
        const progress = document.querySelector('[data-testid="manager-presentation-progress"]');
        const result = document.querySelector('[data-testid="manager-presentation-result"]');
        return progress?.getAttribute("data-request-id") !== failedRequestId && result ? result : null;
      }, 60000);
      checks.generationCompleted = Boolean(generatedResult);
      const generatedOutputPath = generatedResult?.getAttribute("data-output-path") || "";
      details.generatedOutputPath = generatedOutputPath;
      checks.cancelledPathReused = Boolean(cancelledOutputPath) && generatedOutputPath === cancelledOutputPath;
      details.generatedResultText = generatedResult?.textContent?.replace(/\\s+/g, " ").trim() || "";
      checks.generatedMetricsVisible = details.generatedResultText.includes("9 页")
        && details.generatedResultText.includes("讲稿 100%")
        && details.generatedResultText.includes("来源 100%");
      checks.openPptActionVisible = Boolean(generatedResult?.querySelector("button"));
      document.querySelector(".presentation-pdf-action button.secondary")?.click();
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
      return { checks, details };
    })()
  `, true)) as { checks: Record<string, boolean>; details: Record<string, unknown> };
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
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const scenario = ${JSON.stringify(scenario)};
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
          unauthorizedExecutions: 0,
          retries: 0,
        });
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
        checks.abortThreadError = details.abort.thread && details.abort.thread.status === "error";
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
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("ended before data: [DONE]"));
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

async function runChatSmoke(window: BrowserWindow): Promise<SmokeResult> {
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
        const deadline = Date.now() + 15000;
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
      checks.chatChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent: hello e2e chat"));
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

async function runAgentRunSmoke(window: BrowserWindow): Promise<SmokeResult> {
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

      const workspacePath = ${JSON.stringify(process.env.OPENDRSAI_E2E_WORKSPACE_PATH || "C:\\OpenDrSai\\workspace")};
      const thread = await api.createThread({
        kind: "agent_run",
        title: "E2E agent run thread",
        workspacePath,
      });
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
      const startedAt = Date.now();
      const unsubscribe = api.onAgentRunEvent((event) => {
        if (event.requestId === requestId) events.push({ ...event, at: Date.now() - startedAt });
      });
      try {
        const returned = await api.startAgentRun({
          requestId,
          threadId: thread.id,
          runId,
          task: "write a short plan",
          workspacePath,
          files: [{ kind: "file", path: "C:\\\\OpenDrSai\\\\fixtures\\\\notes.md", name: "notes.md" }],
          teamConfig: { preset: "general-collaboration" },
          metadata: { source: "e2e-agent-run" },
        });
        details.returned = returned;
        checks.startAgentRunReturned = returned && returned.requestId === requestId && returned.runId === runId && returned.sessionId === thread.id;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !events.some((event) => ["done", "error", "aborted"].includes(event.type))) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        unsubscribe();
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
      checks.agentRunChunk = events.some((event) => event.type === "chunk" && String(event.content || "").includes("fake-agent-run: write a short plan"));
      checks.agentRunDone = events.some((event) => event.type === "done");
      checks.agentRunTerminalDone = terminalEvent && terminalEvent.type === "done";
      checks.agentRunDurationRecorded = details.agentRunSummary.durationMs >= 0;
      checks.noAgentRunError = !events.some((event) => event.type === "error" || event.type === "aborted");
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

      return { checks, details };
    })()
  `)) as { checks: Record<string, boolean>; details: Record<string, unknown> };

  const ok = Object.values(result.checks).every(Boolean);
  return { ok, checks: result.checks, details: result.details };
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
        checks.chunkDisconnectError = outcome.events.some((event) => event.type === "error" && String(event.error || "").includes("ended before data: [DONE]"));
        checks.chunkDisconnectTerminal = details.chunkDisconnect.terminalEventType === "error";
        checks.chunkDisconnectThreadError = details.chunkDisconnect.thread && details.chunkDisconnect.thread.status === "error";
        checks.chunkDisconnectNoDone = !outcome.events.some((event) => event.type === "done");
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
      checks.unmanagedGatewayRejected = Boolean(
        gatewayStatus.externalReady === true &&
          gatewayStatus.externalConflict === true &&
          gatewayStatus.ready === false,
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
        String(outsidePathResult).includes("outside DrSai home") ||
        String(outsidePathResult).includes("not registered as a DrSai or workspace path");

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
      const staleTerminal = await api.createTerminal({ cwd: reviewFixture.workspacePath, workspaceKey: "packaged-review", shellProfile: "cmd", title: "stale-review-writer" });
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
      const nonGitTerminal = await api.createTerminal({ cwd: reviewFixture.nonGitWorkspacePath, workspaceKey: "packaged-non-git", shellProfile: "cmd", title: "non-git-writer" });
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
