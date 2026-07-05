import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const checks = [];

function check(name, predicate) {
  checks.push({ name, predicate });
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

check("electron-builder packages install.ps1 as extraResources", () => {
  const config = read("electron-builder.yml");
  const packageJson = read("package.json");
  return (
    config.includes("extraResources:") &&
    config.includes("../../../scripts/install.ps1") &&
    config.includes("to: install/install.ps1") &&
    config.includes("resources/**") &&
    packageJson.includes("bundle:backend") &&
    packageJson.includes("create-backend-source-archive.ps1") &&
    read("scripts/create-backend-source-archive.ps1").includes("ZipArchiveMode") &&
    read("scripts/create-backend-source-archive.ps1").includes('Join-Path $Root "cores\\VERSION"') &&
    read("scripts/create-backend-source-archive.ps1").includes("__version__") &&
    read("scripts/create-backend-source-archive.ps1").includes("1970-01-01T00:00:00.0000000Z") &&
    config.includes("icon: build/icon.ico") &&
    config.includes("target: nsis") &&
    config.includes("electronFuses:") &&
    config.includes("runAsNode: false") &&
    config.includes("enableNodeOptionsEnvironmentVariable: false") &&
    config.includes("enableNodeCliInspectArguments: false") &&
    config.includes("enableEmbeddedAsarIntegrityValidation: true") &&
    config.includes("onlyLoadAppFromAsar: true")
  );
});

check("desktop package pins top-level dependencies exactly", () => {
  const packageJson = JSON.parse(read("package.json"));
  const lockJson = JSON.parse(read("package-lock.json"));
  const ranges = [
    ...Object.values(packageJson.dependencies ?? {}),
    ...Object.values(packageJson.devDependencies ?? {}),
    ...Object.values(lockJson.packages?.[""]?.dependencies ?? {}),
    ...Object.values(lockJson.packages?.[""]?.devDependencies ?? {}),
  ];
  return ranges.every((range) => typeof range === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(range));
});

check("main process resolves packaged install resource first", () => {
  const install = read("src/main/install.ts");
  const packaged = install.indexOf('join(process.resourcesPath, "install", "install.ps1")');
  const dev = install.indexOf('join(process.cwd(), "..", "..", "scripts", "install.ps1")');
  return (
    packaged !== -1 &&
    dev !== -1 &&
    packaged < dev &&
    install.includes("const candidates = app.isPackaged ? packagedCandidates") &&
    install.includes("isUnderRealPath(candidate, process.resourcesPath)") &&
    install.includes("resolvePowerShell") &&
    install.includes('"System32"') &&
    install.includes('"WindowsPowerShell"')
  );
});

check("preload exposes install, gateway, update, and chat APIs", () => {
  const preload = read("src/preload/index.ts");
  return [
    "getInstallStatus",
    "getGatewayStatus",
    "checkForUpdates",
    "downloadUpdate",
    "installUpdate",
    "cancelInstall",
    "startChat",
    "abortChat",
    "startAgentRun",
    "abortAgentRun",
    "saveApiKey",
    "openPath",
    "onUpdateStatus",
    "onChatEvent",
    "onAgentRunEvent",
  ].every((name) => preload.includes(name));
});

check("main process gates privileged IPC to the trusted desktop renderer", () => {
  const main = read("src/main/index.ts");
  return (
    main.includes("type IpcMainInvokeEvent") &&
    main.includes("function assertTrustedSender") &&
    main.includes("function secureHandle") &&
    main.includes("event.sender !== mainWindow.webContents") &&
    main.includes("event.senderFrame?.url") &&
    main.includes("Blocked untrusted desktop IPC caller") &&
    main.includes("isAllowedDevRendererUrl") &&
    main.includes("ELECTRON_RENDERER_URL must point at localhost") &&
    main.includes('url.protocol === "https:"') &&
    main.includes("realpathSync.native") &&
    !main.includes('["https:", "http:", "mailto:"]')
  );
});

check("main chat IPC validates request shape and bounds", () => {
  const api = read("src/shared/desktopApi.ts");
  const chat = read("src/main/chat.ts");
  return (
    api.includes("ChatAttachment") &&
    api.includes("attachments?: ChatAttachment[]") &&
    chat.includes("MAX_ACTIVE_CHATS") &&
    chat.includes("MAX_MESSAGES") &&
    chat.includes("MAX_MESSAGE_CHARS") &&
    chat.includes("MAX_TOTAL_CHARS") &&
    chat.includes("MAX_ATTACHMENTS") &&
    chat.includes("MAX_ATTACHMENT_CONTEXT_FILES") &&
    chat.includes("MAX_ATTACHMENT_CONTEXT_FILE_BYTES") &&
    chat.includes("MAX_ATTACHMENT_CONTEXT_TOTAL_CHARS") &&
    chat.includes("function validateAttachments") &&
    chat.includes("function buildAttachmentContext") &&
    chat.includes("function withAttachmentContext") &&
    chat.includes("function looksBinary") &&
    chat.includes("readFile(attachment.path)") &&
    chat.includes("folder-not-inlined") &&
    chat.includes("binary-file") &&
    chat.includes("Chat attachment path is invalid") &&
    chat.includes("attachments: request.attachments || []") &&
    chat.includes("files: request.attachments || []") &&
    chat.includes("attachment_context: attachmentContext") &&
    chat.includes("messages = withAttachmentContext") &&
    chat.includes("REQUEST_ID_PATTERN") &&
    chat.includes("function validateChatRequest") &&
    chat.includes("Chat request must include messages") &&
    chat.includes("activeChats.has(requestId)") &&
    chat.includes("typeof requestId !== \"string\"") &&
    chat.includes("requireAuthContext") &&
    chat.includes("Authorization: `Bearer ${auth.accessToken}`") &&
    chat.includes("user_id: auth.userId") &&
    chat.includes("thread_id: sessionId") &&
    chat.includes("work_dir: request.workspacePath")
  );
});

check("desktop exposes authenticated agent run gateway adapter", () => {
  const api = read("src/shared/desktopApi.ts");
  const main = read("src/main/index.ts");
  const runs = read("src/main/agentRuns.ts");
  return (
    api.includes("AgentRunRequest") &&
    api.includes("AgentRunEvent") &&
    api.includes("startAgentRun") &&
    api.includes("onAgentRunEvent") &&
    main.includes("desktop:start-agent-run") &&
    main.includes("desktop:abort-agent-run") &&
    runs.includes("requireAuthContext") &&
    runs.includes("/v1/chat/completions") &&
    runs.includes("team_config") &&
    runs.includes("settings_config") &&
    runs.includes("desktop:agent-run-event") &&
    runs.includes("thread_id: sessionId") &&
    runs.includes("user_id: auth.userId")
  );
});

check("desktop persists local thread metadata through main IPC", () => {
  const api = read("src/shared/desktopApi.ts");
  const preload = read("src/preload/index.ts");
  const main = read("src/main/index.ts");
  const threads = read("src/main/threads.ts");
  const chat = read("src/main/chat.ts");
  const runs = read("src/main/agentRuns.ts");
  const app = read("src/renderer/src/App.tsx");
  const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
  const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
  const mock = read("src/renderer/src/mockDesktopApi.ts");
  return (
    api.includes("DesktopThread") &&
    api.includes("CreateThreadRequest") &&
    api.includes("UpdateThreadRequest") &&
    api.includes("listThreads(): Promise<DesktopThread[]>") &&
    api.includes("createThread(request: CreateThreadRequest)") &&
    api.includes("updateThread(request: UpdateThreadRequest)") &&
    preload.includes("desktop:list-threads") &&
    preload.includes("desktop:create-thread") &&
    preload.includes("desktop:update-thread") &&
    main.includes('secureHandle("desktop:list-threads"') &&
    main.includes('secureHandle("desktop:create-thread"') &&
    main.includes('secureHandle("desktop:update-thread"') &&
    threads.includes('join(DRSAI_HOME, "desktop", "threads.json")') &&
    threads.includes("function validateCreateThreadRequest") &&
    threads.includes("function validateUpdateThreadRequest") &&
    threads.includes("THREAD_ID_PATTERN") &&
    threads.includes("updatedAt.localeCompare") &&
    chat.includes("request.threadId || request.sessionId || requestId") &&
    chat.includes("upsertThreadFromRun") &&
    runs.includes("request.threadId || request.sessionId || requestId") &&
    runs.includes("upsertThreadFromRun") &&
    app.includes("desktopApi.listThreads()") &&
    app.includes("desktopApi.createThread") &&
    app.includes("desktopApi.updateThread") &&
    app.includes("THREAD_SNAPSHOT_STORAGE_KEY") &&
    !app.includes('id: "main-ui"') &&
    !app.includes('id: "localization"') &&
    !app.includes('id: "agent-square"') &&
    shell.includes("onThreadSelect: (threadId: string) => void") &&
    shell.includes("onClick={() => onThreadSelect(thread.id)}") &&
    chatAdapter.includes("threadId: string") &&
    chatAdapter.includes("sessionId: threadIdRef.current") &&
    mock.includes("listThreads") &&
    mock.includes("createThread") &&
    mock.includes("updateThread")
  );
});

check("auto update flow can check, download, and install", () => {
  const api = read("src/shared/desktopApi.ts");
  const updates = read("src/main/updates.ts");
  const main = read("src/main/index.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("downloadUpdate(): Promise<UpdateStatus>") &&
    api.includes("installUpdate(): Promise<void>") &&
    updates.includes("autoUpdater.downloadUpdate()") &&
    updates.includes("autoUpdater.quitAndInstall") &&
    updates.includes("download-progress") &&
    main.includes("desktop:download-update") &&
    main.includes("desktop:install-update") &&
    app.includes("Download Update") &&
    app.includes("Install Update")
  );
});

check("settings can save HEPAI_API_KEY through a narrow IPC", () => {
  const api = read("src/shared/desktopApi.ts");
  const main = read("src/main/index.ts");
  const settings = read("src/main/settings.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("SaveApiKeyResult") &&
    main.includes("desktop:save-api-key") &&
    settings.includes("HEPAI_API_KEY") &&
    settings.includes("MAX_API_KEY_CHARS") &&
    settings.includes('typeof rawApiKey !== "string"') &&
    settings.includes("upsertEnvValue") &&
    settings.includes("API key must be a single line") &&
    app.includes("Save API Key")
  );
});

check("install status accepts pip exe or script wrapper", () => {
  const paths = read("src/main/paths.ts");
  const status = read("src/main/status.ts");
  return (
    paths.includes("DRSAI_CMD_SCRIPT") &&
    status.includes("existsSync(DRSAI_SCRIPT) || existsSync(DRSAI_CMD_SCRIPT)")
  );
});

check("install status requires repository, venv python, and CLI wrapper", () => {
  const status = read("src/main/status.ts");
  return (
    status.includes("const hasRepo = existsSync(DRSAI_REPO)") &&
    status.includes("const version = hasRepo && hasPython ? await getDrsaiVersion() : null") &&
    status.includes("installed: hasRepo && hasPython && hasScript && Boolean(version) && !backendNeedsRepair")
  );
});

check("install status detects packaged backend version drift", () => {
  const api = read("src/shared/desktopApi.ts");
  const status = read("src/main/status.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("expectedVersion: string | null") &&
    api.includes("backendNeedsRepair: boolean") &&
    api.includes("bundledBackendAvailable: boolean") &&
    status.includes("hasBundledBackendSource") &&
    app.includes("Backend source:") &&
    status.includes("getExpectedBackendVersion") &&
    status.includes("getBundledBackendVersion") &&
    status.includes("backend-source.json") &&
    status.includes("versionsMatch") &&
    status.includes('"backend-version"') &&
    app.includes("后端目标版本") &&
    app.includes("Backend target") &&
    app.includes("后端修复") &&
    app.includes("Backend repair")
  );
});

check("install status reports prerequisites and API key state", () => {
  const api = read("src/shared/desktopApi.ts");
  const status = read("src/main/status.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("PrerequisiteStatus") &&
    api.includes("pythonCommand") &&
    api.includes("gitCommand") &&
    api.includes("apiKeyConfigured") &&
    status.includes("getPrerequisiteStatus") &&
    status.includes("getPythonCandidate") &&
    status.includes("WindowsApps") &&
    status.includes("HEPAI_API_KEY") &&
    app.includes("Python 路径") &&
    app.includes("Python path") &&
    app.includes("Git 路径") &&
    app.includes("Git path") &&
    app.includes("API Key")
  );
});

check("desktop installer writes persistent install logs", () => {
  const api = read("src/shared/desktopApi.ts");
  const install = read("src/main/install.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("logFile?: string") &&
    install.includes("createInstallLogFile") &&
    install.includes("desktop-install-${stamp}.log") &&
    install.includes("appendInstallLog") &&
    app.includes("日志文件") &&
    app.includes("Log file")
  );
});

check("desktop installer can be cancelled from the renderer", () => {
  const api = read("src/shared/desktopApi.ts");
  const main = read("src/main/index.ts");
  const install = read("src/main/install.ts");
  const preload = read("src/preload/index.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("cancelInstall(): Promise<boolean>") &&
    main.includes("desktop:cancel-install") &&
    install.includes("export function cancelInstall") &&
    install.includes("cancelRequested") &&
    install.includes("killInstallProcessTree") &&
    install.includes("taskkill.exe") &&
    install.includes('"/T"') &&
    install.includes('"/F"') &&
    preload.includes("desktop:cancel-install") &&
    app.includes("取消安装") &&
    app.includes("Cancel Install")
  );
});

check("packaged desktop installs version-pinned backend by default", () => {
  const install = read("src/main/install.ts");
  const installScript = read("../../../scripts/install.ps1");
  return (
    install.includes("getInstallBranch") &&
    install.includes("getExpectedBackendVersion") &&
    install.includes("resolveBundledBackendSource") &&
    install.includes("backend-source.json") &&
    install.includes("version: string | null") &&
    install.includes("bundledSource?.version ?? null") &&
    install.includes('"-SourceArchive"') &&
    install.includes('"-SourceArchiveSha256"') &&
    installScript.includes("[string]$SourceArchive") &&
    installScript.includes("[string]$SourceArchiveSha256") &&
    installScript.includes("[switch]$SourceArchiveCheckOnly") &&
    installScript.includes("function Expand-SourceArchive") &&
    installScript.includes("Source archive SHA256 mismatch") &&
    installScript.includes("Source archive check complete") &&
    installScript.includes("Expand-Archive") &&
    install.includes("DRSAI_INSTALL_BRANCH") &&
    install.includes("app.isPackaged ? `v${app.getVersion()}` : \"main\"") &&
    install.includes('"-ExpectedVersion"') &&
    install.includes('"-Branch"')
  );
});

check("install script supports check-only prerequisite validation", () => {
  const installScript = read("../../../scripts/install.ps1");
  return (
    installScript.includes("[switch]$CheckOnly") &&
    installScript.includes("Prerequisite check complete.")
  );
});

check("desktop installer can optionally bootstrap Python and Git prerequisites", () => {
  const installScript = read("../../../scripts/install.ps1");
  const desktopInstall = read("src/main/install.ts");
  return (
    installScript.includes("[switch]$InstallPrerequisites") &&
    installScript.includes("Install-WithWinget") &&
    installScript.includes("Update-ProcessPath") &&
    installScript.includes("Resolve-PyLauncherPython") &&
    installScript.includes("Python.Python.3.11") &&
    installScript.includes("Git.Git") &&
    desktopInstall.includes("options.installPrerequisites") &&
    !desktopInstall.includes('"-InstallPrerequisites",')
  );
});

check("install script fails hard when post-install smoke checks fail", () => {
  const installScript = read("../../../scripts/install.ps1");
  return (
    installScript.includes("drsai import failed after installation") &&
    installScript.includes("drsai CLI version check failed after installation") &&
    installScript.includes("CLI wrapper was not created") &&
    installScript.includes("[string]$ExpectedVersion") &&
    installScript.includes("Installed DrSai backend version") &&
    installScript.includes("does not match expected version") &&
    installScript.includes("git checkout $Branch failed") &&
    installScript.includes("git pull --ff-only origin $Branch failed") &&
    installScript.includes("git clone --branch $Branch failed") &&
    installScript.includes("function Test-SupportedPython") &&
    installScript.includes("Test-SupportedPython $path") &&
    installScript.includes("Test-SupportedPython $launcherPython")
  );
});

check("chat errors clean up active requests", () => {
  const chat = read("src/main/chat.ts");
  const runs = read("src/main/agentRuns.ts");
  return (
    chat.includes("activeChats.delete(requestId);") &&
    chat.includes("formatHttpError(response)") &&
    chat.includes('throw new Error("Chat request was aborted.")') &&
    chat.includes('throw new Error("Gateway chat stream ended before data: [DONE].")') &&
    chat.includes("if (!signal.aborted)") &&
    chat.includes('status: "error"') &&
    runs.includes('throw new Error("Agent run was aborted.")') &&
    runs.includes('throw new Error("Gateway agent stream ended before data: [DONE].")') &&
    runs.includes("if (!signal.aborted)") &&
    runs.includes('status: "error"')
  );
});

check("chat SSE parser accepts LF and CRLF frame separators", () => {
  const chat = read("src/main/chat.ts");
  const agentRuns = read("src/main/agentRuns.ts");
  const parser = read("src/main/sseParser.ts");
  const packageJson = read("package.json");
  const parserVerifier = read("scripts/verify-chat-sse-parser.mjs");
  return (
    chat.includes("buffer.split(/\\r?\\n\\r?\\n/)") &&
    chat.includes("parseChatSseFrame(buffer).forEach") &&
    chat.includes('from "./sseParser"') &&
    agentRuns.includes("parseAgentRunSseFrame(buffer).forEach") &&
    agentRuns.includes('from "./sseParser"') &&
    !agentRuns.includes("function parseFrameContent") &&
    parser.includes("export function parseCompletionSseFrame") &&
    parser.includes("export function isCompletionDoneFrame") &&
    parser.includes("export const parseChatSseFrame") &&
    parser.includes("export const parseAgentRunSseFrame") &&
    parser.includes('payload === "[DONE]"') &&
    parserVerifier.includes("done frame detector") &&
    parserVerifier.includes("delta content") &&
    parserVerifier.includes("agent run delta content") &&
    parserVerifier.includes("message content with CRLF") &&
    parserVerifier.includes("done sentinel") &&
    packageJson.includes('"verify:chat-sse": "node scripts/verify-chat-sse-parser.mjs"') &&
    chat.includes('getPositiveIntEnv("OPENDRSAI_CHAT_TIMEOUT_MS", 120_000)') &&
    chat.includes("Gateway chat timed out after ${Math.round(CHAT_TIMEOUT_MS / 1000)} seconds") &&
    chat.includes("MAX_SSE_BUFFER_CHARS") &&
    chat.includes("Gateway chat stream exceeded") &&
    chat.includes("MAX_ERROR_BODY_BYTES") &&
    chat.includes("readLimitedText")
  );
});

check("gateway smoke verifies fake backend protocol", () => {
  const packageJson = read("package.json");
  const smoke = read("scripts/verify-gateway-smoke.mjs");
  return (
    packageJson.includes('"verify:gateway-smoke": "node scripts/verify-gateway-smoke.mjs"') &&
    smoke.includes("DRSAI_GATEWAY_FAKE_AGENT") &&
    smoke.includes("/health") &&
    smoke.includes("/v1/models") &&
    smoke.includes("/v1/chat/completions") &&
    smoke.includes("fake-agent: hello gateway smoke") &&
    smoke.includes("data: [DONE]") &&
    smoke.includes("killProcessTree")
  );
});

check("gateway readiness validates DrSai-compatible endpoints", () => {
  const gateway = read("src/main/gateway.ts");
  const main = read("src/main/index.ts");
  const api = read("src/shared/desktopApi.ts");
  const app = read("src/renderer/src/App.tsx");
  const devScript = read("../windows-desktop-dev.ps1");
  return (
    gateway.includes("/health") &&
    gateway.includes("/v1/models") &&
    gateway.includes('models.body.object === "list"') &&
    gateway.includes("Array.isArray(models.body.data)") &&
    gateway.includes("requestJson") &&
    gateway.includes("function checkGatewayEndpoints") &&
    gateway.includes("function isManagedGatewayRunning") &&
    gateway.includes("Refusing to use an unmanaged service") &&
    gateway.includes("DRSAI_GATEWAY_DEV_MANAGED") &&
    gateway.includes("DRSAI_GATEWAY_HOT_RELOAD") &&
    gateway.includes("export function shutdownGateway") &&
    gateway.includes("taskkill.exe") &&
    devScript.includes("[2/3] Gateway hot reload") &&
    devScript.includes("uvicorn") &&
    devScript.includes("drsai.backend.gateway:app") &&
    devScript.includes("--reload") &&
    devScript.includes("DRSAI_GATEWAY_DEV_MANAGED") &&
    devScript.includes("DRSAI_GATEWAY_HOT_RELOAD") &&
    devScript.includes("Stop-ProcessTree") &&
    main.includes("shutdownGateway") &&
    main.includes('app.on("before-quit"') &&
    api.includes("externalConflict: boolean") &&
    app.includes("端口冲突") &&
    app.includes("Port conflict") &&
    app.includes("被其他进程占用") &&
    app.includes("occupied by another process")
  );
});

check("bootstrapper validates manifest and release hosts", () => {
  const script = read("bootstrapper/install-full-app.ps1");
  return [
    "$AllowedHosts",
    "Assert-Manifest",
    "Assert-BootstrapperVersion",
    "BootstrapperVersion",
    "minimumBootstrapperVersion",
    "Please download the latest OpenDrSai Installer",
    "Assert-AuthenticodeSignature",
    "Get-AuthenticodeSignature",
    "ExpectedSignerThumbprint",
    "ExpectedSignerSubject",
    "Normalize-Thumbprint",
    "sizeBytes",
    "Get-FileHash",
    "Tls12",
    "TimeoutSec 60",
  ].every((text) => script.includes(text));
});

check("manifest schema requires bootstrapper fields", () => {
  const schema = JSON.parse(read("bootstrapper/latest-windows.schema.json"));
  const bootstrapper = read("bootstrapper/install-full-app.ps1");
  const build = read("bootstrapper/build.ps1");
  const nsis = read("bootstrapper/OpenDrSaiInstaller.nsi");
  return (
    ["version", "channel", "minimumBootstrapperVersion", "installer", "sha256", "sizeBytes"].every((field) =>
      schema.required.includes(field),
    ) &&
    schema.properties.minimumBootstrapperVersion.pattern === "^\\d+\\.\\d+\\.\\d+$" &&
    JSON.stringify(schema.properties.channel.enum) === JSON.stringify(["stable", "beta", "dev"]) &&
    bootstrapper.includes('@("stable", "beta", "dev")') &&
    build.includes("BOOTSTRAPPER_VERSION") &&
    build.includes("package.json") &&
    nsis.includes("BOOTSTRAPPER_VERSION") &&
    nsis.includes("-BootstrapperVersion")
  );
});

check("full installer artifact can be converted into latest-windows.json", () => {
  const generator = read("scripts/create-windows-manifest.mjs");
  return (
    generator.includes("OPENDRSAI_RELEASE_BASE_URL") &&
    generator.includes("sha256") &&
    generator.includes("sizeBytes") &&
    generator.includes("OpenDrSai-${packageJson.version}-setup.exe")
  );
});

check("release artifact verifier exists", () => {
  const verifier = read("scripts/verify-windows-artifacts.mjs");
  return (
    verifier.includes("latest-windows.json sha256") &&
    verifier.includes("latest.yml sha512 does not match setup exe") &&
    verifier.includes("parseLatestYml") &&
    verifier.includes('createHash("sha512")') &&
    verifier.includes("release-summary.json") &&
    verifier.includes("manifest snapshot does not match latest-windows.json") &&
    verifier.includes("release-summary.json sha256") &&
    verifier.includes("OpenDrSai-${packageJson.version}-setup.exe")
  );
});

check("release summary is generated and uploaded with release assets", () => {
  const packageJson = read("package.json");
  const summary = read("scripts/create-release-summary.mjs");
  const checklist = read("docs/release-checklist.md");
  const workflowPath = join(root, "..", "..", "..", ".github", "workflows", "windows-desktop.yml");
  if (!existsSync(workflowPath)) return false;
  const workflow = readFileSync(workflowPath, "utf8");
  const summaryStep = workflow.indexOf("Generate release summary");
  const artifactVerify = workflow.indexOf("npm run verify:artifacts");
  return (
    packageJson.includes("summary:win") &&
    summary.includes("release-summary.json") &&
    summary.includes("publicDistributionReady") &&
    summary.includes("requiresSignedExecutables") &&
    summary.includes("Do not distribute this build publicly") &&
    summary.includes("signatureStatus") &&
    workflow.includes("Generate release summary") &&
    workflow.includes("apps/desktop/windows/release/release-summary.json") &&
    summaryStep !== -1 &&
    artifactVerify !== -1 &&
    summaryStep < artifactVerify &&
    checklist.includes("release-summary.json")
  );
});

check("public release verifier checks GitHub asset reachability and optional full download", () => {
  const packageJson = read("package.json");
  const verifier = read("scripts/verify-public-windows-release.mjs");
  const readiness = read("scripts/verify-release-readiness.mjs");
  const checklist = read("docs/release-checklist.md");
  const workflowPath = join(root, "..", "..", "..", ".github", "workflows", "windows-public-release-verify.yml");
  if (!existsSync(workflowPath)) return false;
  const workflow = readFileSync(workflowPath, "utf8");
  return (
    packageJson.includes("verify:public-release") &&
    packageJson.includes("verify:release-ready") &&
    verifier.includes("OPENDRSAI_RELEASE_BASE_URL") &&
    verifier.includes("VERIFY_PUBLIC_RELEASE_DOWNLOAD") &&
    verifier.includes("release-summary.json") &&
    verifier.includes("verifyPublicSummary") &&
    verifier.includes("publicDistributionReady") &&
    verifier.includes("unsigned executable artifacts") &&
    verifier.includes("signature status for") &&
    verifier.includes("manifest installer URL does not point at this release asset") &&
    verifier.includes("release-summary.json sha256") &&
    verifier.includes("latest-windows.json") &&
    verifier.includes("latest.yml") &&
    verifier.includes("latest.sha512") &&
    verifier.includes("verifyBootstrapper") &&
    verifier.includes("verifyDownloadedSetupSignature") &&
    verifier.includes("signature is not valid") &&
    verifier.includes("EXPECTED_WINDOWS_SIGNER_THUMBPRINT") &&
    verifier.includes("EXPECTED_WINDOWS_SIGNER_SUBJECT") &&
    verifier.includes("Set EXPECTED_WINDOWS_SIGNER_THUMBPRINT") &&
    verifier.includes("assertExpectedSignature") &&
    verifier.includes("Get-AuthenticodeSignature") &&
    verifier.includes("sha256") &&
    readiness.includes("REQUIRE_RELEASE_READY") &&
    readiness.includes("SKIP_PUBLIC_RELEASE_CHECK") &&
    readiness.includes("verify:public-release") &&
    workflow.includes("Windows Public Release Verification") &&
    workflow.includes("release:") &&
    workflow.includes("types:") &&
    workflow.includes("published") &&
    workflow.includes("npm run verify:public-release") &&
    workflow.includes("VERIFY_PUBLIC_RELEASE_DOWNLOAD") &&
    checklist.includes("SKIP_PUBLIC_RELEASE_CHECK") &&
    checklist.includes("Windows Public Release Verification") &&
    checklist.includes("npm run verify:public-release")
    && checklist.includes("npm run verify:release-ready")
  );
});

check("draft release promotion verifies signed assets before publishing", () => {
  const checklist = read("docs/release-checklist.md");
  const workflowPath = join(root, "..", "..", "..", ".github", "workflows", "windows-release-promote.yml");
  if (!existsSync(workflowPath)) return false;
  const workflow = readFileSync(workflowPath, "utf8");
  return (
    workflow.includes("Windows Release Promote") &&
    workflow.includes("workflow_dispatch") &&
    workflow.includes("promote") &&
    workflow.includes("contents: write") &&
    workflow.includes("gh release view") &&
    workflow.includes("--json isDraft,isPrerelease,tagName") &&
    workflow.includes("Release $tag is not a draft") &&
    workflow.includes("gh release download") &&
    workflow.includes('OpenDrSai Installer.exe') &&
    workflow.includes("npm run verify:manifest") &&
    workflow.includes("npm run verify:artifacts") &&
    workflow.includes("npm run verify:signatures") &&
    workflow.includes('REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1"') &&
    workflow.includes("gh release edit") &&
    workflow.includes("--draft=false") &&
    checklist.includes("Windows Release Promote") &&
    checklist.includes("promote=true") &&
    checklist.includes("verify:signatures")
  );
});

check("clean Windows smoke helper exists for end-to-end validation", () => {
  const packageJson = read("package.json");
  const smoke = read("scripts/smoke-clean-windows.ps1");
  const checklist = read("docs/release-checklist.md");
  return (
    packageJson.includes("smoke:clean-win") &&
    smoke.includes("RunBootstrapper") &&
    smoke.includes("RequireBackend") &&
    smoke.includes("backendStatusWhenMissing") &&
    smoke.includes("Find-OpenDrSaiExe") &&
    smoke.includes("WaitForGateway") &&
    smoke.includes("ExpectedVersion") &&
    smoke.includes("DrSai Python import") &&
    smoke.includes("DrSai backend version match") &&
    smoke.includes("Gateway models") &&
    smoke.includes("Public distribution summary") &&
    smoke.includes("latest-windows.json") &&
    checklist.includes("-ExpectedVersion") &&
    checklist.includes("npm run smoke:clean-win")
  );
});

check("backend installer prerequisite check is automated", () => {
  const packageJson = read("package.json");
  const checkOnly = read("scripts/verify-install-checkonly.mjs");
  const sourceArchiveCheck = read("scripts/verify-install-source-archive.mjs");
  const backendBundle = read("scripts/verify-bundled-backend-source.mjs");
  const readiness = read("scripts/verify-release-readiness.mjs");
  return (
    packageJson.includes('"verify:install-check": "node scripts/verify-install-checkonly.mjs"') &&
    packageJson.includes('"verify:install-source": "node scripts/verify-install-source-archive.mjs"') &&
    packageJson.includes('"verify:backend-bundle": "node scripts/verify-bundled-backend-source.mjs"') &&
    checkOnly.includes("install.ps1") &&
    checkOnly.includes("-CheckOnly") &&
    checkOnly.includes("Prerequisite check complete.") &&
    checkOnly.includes("[2/6] Setting up repository") &&
    checkOnly.includes("drsai-agent") &&
    sourceArchiveCheck.includes("-SourceArchiveCheckOnly") &&
    sourceArchiveCheck.includes("Source archive check complete.") &&
    sourceArchiveCheck.includes("git: not required (using source archive)") &&
    sourceArchiveCheck.includes("noGitPath") &&
    sourceArchiveCheck.includes("resolvePythonPath") &&
    sourceArchiveCheck.includes("Installing DrSai package") &&
    backendBundle.includes("opendrsai-backend-source.zip") &&
    backendBundle.includes("verifyDeterministicGeneration") &&
    backendBundle.includes("Backend archive generation is not deterministic") &&
    backendBundle.includes("cores\", \"python\", \"packages\", \"drsai\", \"pyproject.toml") &&
    readiness.includes("Backend source archive install mode") &&
    readiness.includes("verify:install-source") &&
    readiness.includes("Bundled backend source") &&
    readiness.includes("Backend installer check-only") &&
    readiness.includes("verify:install-check") &&
    readiness.includes("verify:backend-bundle")
  );
});

check("release signature verifier gates published builds", () => {
  const packageJson = read("package.json");
  const signer = read("scripts/sign-windows-bootstrapper.ps1");
  const verifier = read("scripts/verify-windows-signatures.mjs");
  const workflowPath = join(root, "..", "..", "..", ".github", "workflows", "windows-desktop.yml");
  if (!existsSync(workflowPath)) return false;
  const workflow = readFileSync(workflowPath, "utf8");
  return (
    packageJson.includes("verify:signatures") &&
    packageJson.includes("sign:bootstrapper") &&
    signer.includes("signtool") &&
    signer.includes("OpenDrSai Installer.exe") &&
    signer.includes("REQUIRE_SIGNED_WINDOWS_ARTIFACTS") &&
    read("bootstrapper/build.ps1").includes("RequireSignerPin") &&
    read("bootstrapper/build.ps1").includes("ExpectedSignerThumbprint is required") &&
    verifier.includes("Get-AuthenticodeSignature") &&
    verifier.includes("REQUIRE_SIGNED_WINDOWS_ARTIFACTS") &&
    verifier.includes("EXPECTED_WINDOWS_SIGNER_THUMBPRINT") &&
    verifier.includes("EXPECTED_WINDOWS_SIGNER_SUBJECT") &&
    verifier.includes("normalizeThumbprint") &&
    workflow.includes("Sign tiny bootstrapper") &&
    workflow.includes("-RequireSignerPin") &&
    workflow.includes("npm run sign:bootstrapper") &&
    workflow.includes("Verify Windows signatures") &&
    workflow.includes("Verify local release readiness") &&
    workflow.includes("npm run verify:release-ready") &&
    workflow.includes("REQUIRE_SIGNED_WINDOWS_ARTIFACTS") &&
    workflow.includes("WINDOWS_CERTIFICATE_THUMBPRINT") &&
    workflow.includes("WINDOWS_CERTIFICATE_SUBJECT")
  );
});

check("installer logs can be opened only through a restricted path IPC", () => {
  const api = read("src/shared/desktopApi.ts");
  const main = read("src/main/index.ts");
  const app = read("src/renderer/src/App.tsx");
  return (
    api.includes("openPath(path: string): Promise<string>") &&
    main.includes("desktop:open-path") &&
    main.includes("isAllowedLocalPath") &&
    main.includes("relative(root, target)") &&
    app.includes("Open Log")
  );
});

check("release build includes packaged install.ps1 when build:unpack has run", () => {
  const packagedScript = join(root, "release", "win-unpacked", "resources", "install", "install.ps1");
  const backendArchive = join(root, "release", "win-unpacked", "resources", "app.asar.unpacked", "resources", "backend", "opendrsai-backend-source.zip");
  const backendManifest = join(root, "release", "win-unpacked", "resources", "app.asar.unpacked", "resources", "backend", "backend-source.json");
  return !existsSync(join(root, "release", "win-unpacked")) ||
    (existsSync(packagedScript) && existsSync(backendArchive) && existsSync(backendManifest));
});

check("renderer blocks chat submission until gateway is ready", () => {
  const app = read("src/renderer/src/App.tsx");
  const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
  const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
  return (
    app.includes("canChat: Boolean(health?.installed && health?.gatewayReady)") &&
    app.includes("!chat.activeRequestId") &&
    chatAdapter.includes("submit(attachments: ChatAttachment[] = [])") &&
    chatAdapter.includes("attachments,") &&
    chatWorkspace.includes("submitWithAttachments") &&
    chatWorkspace.includes("setAttachments([])") &&
    chatWorkspace.includes('type="submit" disabled={!input.trim() || !canChat}')
  );
});

check("renderer correlates chat stream events by request id", () => {
  const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
  const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
  return (
    chatAdapter.includes("useRef<Record<string, string>>") &&
    chatAdapter.includes("streamingAssistantByRequest.current[requestId] = assistantId") &&
    chatAdapter.includes("streamingAssistantByRequest.current[event.requestId]") &&
    chatAdapter.includes("delete streamingAssistantByRequest.current[event.requestId]") &&
    chatAdapter.includes("setActiveRequestId((current) => (current === event.requestId ? null : current))") &&
    chatAdapter.includes("function appendAssistantChunk(") &&
    chatAdapter.includes("assistantId: string | undefined") &&
    chatAdapter.includes("message.id === assistantId") &&
    chatAdapter.includes("startedAt: Date.now()") &&
    chatAdapter.includes("lastEventAt: Date.now()") &&
    chatAdapter.includes("function touchStreamingAssistant") &&
    chatWorkspace.includes("startedAt?: number") &&
    chatWorkspace.includes("lastEventAt?: number") &&
    chatWorkspace.includes("function StreamingStatus") &&
    chatWorkspace.includes('aria-live="polite"') &&
    chatWorkspace.includes("window.setInterval") &&
    chatWorkspace.includes("window.clearInterval")
  );
});

check("renderer first run can bootstrap backend after full app install", () => {
  const healthAdapter = read("src/renderer/src/adapters/useDesktopHealthAdapter.ts");
  return (
    healthAdapter.includes("autoInstallStarted") &&
    healthAdapter.includes("prerequisitesReady") &&
    healthAdapter.includes("health.install.prerequisites.pythonOnPath") &&
    healthAdapter.includes("health.install.prerequisites.gitOnPath") &&
    healthAdapter.includes("health.install.bundledBackendAvailable") &&
    healthAdapter.includes("startInstall(false)")
  );
});

check("renderer uses a desktop API adapter instead of direct global calls", () => {
  const app = read("src/renderer/src/App.tsx");
  const adapter = read("src/renderer/src/desktopApi.ts");
  const healthAdapter = read("src/renderer/src/adapters/useDesktopHealthAdapter.ts");
  const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
  return (
    adapter.includes("export const desktopApi") &&
    adapter.includes("window.openDrSai") &&
    healthAdapter.includes("useDesktopHealthAdapter") &&
    healthAdapter.includes("desktopApi.onInstallProgress") &&
    healthAdapter.includes("desktopApi.onUpdateStatus") &&
    healthAdapter.includes("createFallbackHealth") &&
    chatAdapter.includes("useDesktopChatAdapter") &&
    chatAdapter.includes("desktopApi.onChatEvent") &&
    chatAdapter.includes("appendAssistantChunk") &&
    app.includes("useDesktopHealthAdapter") &&
    app.includes("useDesktopChatAdapter") &&
    app.includes('from "./desktopApi"') &&
    !app.includes("desktopApi.onChatEvent") &&
    !app.includes("desktopApi.onInstallProgress") &&
    !app.includes("desktopApi.onUpdateStatus") &&
    !app.includes("window.openDrSai")
  );
});

check("renderer chat workspace is pure and markdown capable", () => {
  const app = read("src/renderer/src/App.tsx");
  const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
  return (
    app.includes("ChatWorkspace") &&
    chatWorkspace.includes("ReactMarkdown") &&
    chatWorkspace.includes("remarkGfm") &&
    chatWorkspace.includes("onOpenExternal") &&
    !chatWorkspace.includes('from "./desktopApi"') &&
    !chatWorkspace.includes("window.openDrSai")
  );
});

check("renderer has responsive desktop layout gates", () => {
  const css = read("src/renderer/src/styles.css");
  return (
    css.includes("@media (max-width: 1180px)") &&
    css.includes("@media (max-width: 860px)") &&
    (css.includes("grid-template-columns: minmax(460px, 1fr)") ||
      css.includes("grid-template-columns: minmax(0, 1fr)"))
  );
});

check("renderer navigation follows WebUI menu identifiers", () => {
  const app = read("src/renderer/src/App.tsx");
  const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
  const navigation = read("src/renderer/src/navigation.ts");
  const navItemEnabled = (menuId) => {
    const pattern = new RegExp(`id: MENU_IDS\\.${menuId}, enabled: (true|false)`);
    return pattern.exec(navigation)?.[1] === "true";
  };
  return [
    "current_session",
    "my_agents",
    "agent_square",
    "saved_plan",
    "skills_square",
    "library",
    "profile",
    "usage_analytics",
    "channels",
    "logs",
    "agent_management",
    "user_management",
  ].every((id) => navigation.includes(id)) &&
    navigation.includes("MENU_IDS") &&
    navigation.includes("MENU_LABELS") &&
    navigation.includes("getNavSections") &&
    navigation.includes("getNavItems") &&
    navigation.includes("getRightTabs") &&
    navItemEnabled("currentSession") &&
    navItemEnabled("agentSquare") &&
    navItemEnabled("profile") &&
    !navItemEnabled("savedPlan") &&
    !navItemEnabled("myAgents") &&
    !navItemEnabled("skillsSquare") &&
    !navItemEnabled("plugins") &&
    !navItemEnabled("library") &&
    !navItemEnabled("usageAnalytics") &&
    !navItemEnabled("channels") &&
    !navItemEnabled("logs") &&
    !navItemEnabled("agentManagement") &&
    !navItemEnabled("userManagement") &&
    shell.includes("navSections.filter") &&
    shell.includes("language === \"zh\"") &&
    app.includes("getNavSections(language)") &&
    app.includes("getNavItems(language)") &&
    app.includes("getRightTabs(language)") &&
    app.includes("MENU_IDS.currentSession") &&
    app.includes("MENU_IDS.profile") &&
    app.includes('from "./navigation"');
});

check("renderer supports collapsible right workbench panel", () => {
  const app = read("src/renderer/src/App.tsx");
  const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
  const css = read("src/renderer/src/styles.css");
  return (
    app.includes("rightPanelCollapsed") &&
    shell.includes("titlebar-right-panel-toggle") &&
    shell.includes("rightPanelCollapsed") &&
    shell.includes("!rightPanelCollapsed") &&
    css.includes(".content-grid.right-collapsed")
  );
});

check("renderer shell is separated from desktop IPC adapters", () => {
  const app = read("src/renderer/src/App.tsx");
  const shell = read("src/renderer/src/components/WorkspaceShell.tsx");
  const healthAdapter = read("src/renderer/src/adapters/useDesktopHealthAdapter.ts");
  const chatAdapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
  return (
    app.includes("const mainContent") &&
    app.includes("const rightPanelContent") &&
    app.includes("WorkspaceShell") &&
    shell.includes("WorkspaceShellProps") &&
    shell.includes("main: React.ReactNode") &&
    shell.includes("rightPanel: React.ReactNode") &&
    shell.includes("onNavChange") &&
    shell.includes("onRightTabChange") &&
    !shell.includes('../desktopApi') &&
    !shell.includes('./desktopApi') &&
    !shell.includes("window.openDrSai") &&
    healthAdapter.includes("useDesktopHealthAdapter") &&
    chatAdapter.includes("useDesktopChatAdapter")
  );
});

check("renderer has mock desktop API for browser visual verification", () => {
  const main = read("src/renderer/src/main.tsx");
  const mock = read("src/renderer/src/mockDesktopApi.ts");
  return (
    main.includes("installMockDesktopApi();") &&
    mock.includes("if (window.openDrSai) return;") &&
    mock.includes("downloadUpdate") &&
    mock.includes("startChat") &&
    mock.includes("saveApiKey")
  );
});

check("renderer has production visual and interaction verification", () => {
  const packageJson = read("package.json");
  const ui = read("scripts/verify-renderer-ui.mjs");
  const mojibake = read("scripts/verify-no-mojibake.mjs");
  const visual = read("scripts/verify-renderer-visual.mjs");
  const readiness = read("scripts/verify-release-readiness.mjs");
  return (
    packageJson.includes('"verify:ui": "node scripts/verify-renderer-ui.mjs"') &&
    packageJson.includes('"verify:mojibake": "node scripts/verify-no-mojibake.mjs"') &&
    packageJson.includes('"verify:visual": "node scripts/verify-renderer-visual.mjs"') &&
    ui.includes("Renderer UI verification passed") &&
    ui.includes("chat workspace uses readable Chinese labels") &&
    ui.includes("renderer enables only completed desktop views") &&
    mojibake.includes("Mojibake verification passed") &&
    mojibake.includes("mojibakePatterns") &&
    visual.includes("Renderer visual verification passed") &&
    visual.includes("OPENDRSAI_VISUAL_ARTIFACT_DIR") &&
    visual.includes("captureVisual") &&
    visual.includes("screenshot appears blank or nearly uniform") &&
    visual.includes("out\", \"renderer\", \"index.html") &&
    visual.includes("desktop bridge is unavailable") &&
    visual.includes("0.1.1") &&
    visual.includes("chat request stayed in Stop state after stream completion") &&
    visual.includes("interaction-chat-running") &&
    visual.includes("interaction-agent-run-running") &&
    visual.includes("agent run stayed in Stop state after stream completion") &&
    visual.includes("Mock agent run complete") &&
    visual.includes("interaction-agent-run-error-running") &&
    visual.includes("synthetic visual agent error") &&
    visual.includes("hasAgentRunErrorLine") &&
    visual.includes("agent run stayed in active run label after error") &&
    visual.includes("visual agent recovery task") &&
    visual.includes("recovery agent run stayed in Stop state after completion") &&
    visual.includes("running chat did not expose Stop state") &&
    visual.includes("running chat did not expose elapsed thinking status") &&
    visual.includes("rendered placeholder navigation buttons") &&
    visual.includes("clickByText(interactive") &&
    visual.includes("fillTextarea(interactive") &&
    visual.includes("[1280, 720], [1024, 720], [860, 720]") &&
    readiness.includes("Renderer UI invariants") &&
    readiness.includes("Renderer mojibake guard") &&
    readiness.includes("Renderer visual interactions") &&
    readiness.includes("verify:ui") &&
    readiness.includes("verify:mojibake") &&
    readiness.includes("verify:visual")
  );
});
check("packaged app smoke verifies real main, preload, and IPC", () => {
  const packageJson = read("package.json");
  const main = read("src/main/index.ts");
  const smokeHook = read("src/main/e2eSmoke.ts");
  const smoke = read("scripts/verify-packaged-app-smoke.mjs");
  const e2eChat = read("scripts/verify-e2e-chat.mjs");
  const e2eFailures = read("scripts/verify-e2e-chat-failures.mjs");
  const e2eAgentRun = read("scripts/verify-e2e-agent-run.mjs");
  const e2eAgentRunFailures = read("scripts/verify-e2e-agent-run-failures.mjs");
  const e2eThreads = read("scripts/verify-e2e-threads.mjs");
  const readiness = read("scripts/verify-release-readiness.mjs");
  return (
    packageJson.includes('"verify:packaged": "node scripts/verify-packaged-app-smoke.mjs"') &&
    packageJson.includes('"verify:e2e-chat": "node scripts/verify-e2e-chat.mjs"') &&
    packageJson.includes('"verify:e2e-chat-failures": "node scripts/verify-e2e-chat-failures.mjs"') &&
    packageJson.includes('"verify:e2e-agent-run": "node scripts/verify-e2e-agent-run.mjs"') &&
    packageJson.includes('"verify:e2e-agent-run-failures": "node scripts/verify-e2e-agent-run-failures.mjs"') &&
    packageJson.includes('"verify:e2e-threads": "node scripts/verify-e2e-threads.mjs"') &&
    main.includes("maybeRunE2eSmoke(mainWindow)") &&
    smokeHook.includes("OPENDRSAI_E2E_SMOKE") &&
    smokeHook.includes("OPENDRSAI_E2E_CHAT") &&
    smokeHook.includes("OPENDRSAI_E2E_CHAT_FAILURES") &&
    smokeHook.includes("OPENDRSAI_E2E_AGENT_RUN") &&
    smokeHook.includes("OPENDRSAI_E2E_AGENT_RUN_FAILURES") &&
    smokeHook.includes("OPENDRSAI_E2E_THREADS") &&
    smokeHook.includes("OPENDRSAI_E2E_THREADS_PHASE") &&
    smokeHook.includes("api.createThread") &&
    smokeHook.includes("api.listThreads") &&
    smokeHook.includes("window.openDrSai") &&
    smokeHook.includes("api.onChatEvent") &&
    smokeHook.includes("api.onAgentRunEvent") &&
    smokeHook.includes("api.createThread") &&
    smokeHook.includes("fake-agent: hello e2e chat") &&
    smokeHook.includes("chatThreadEvents") &&
    smokeHook.includes("chatRunEvents") &&
    smokeHook.includes("chatDistinctIds") &&
    smokeHook.includes("chatThreadIdle") &&
    smokeHook.includes("fake-agent-run: write a short plan") &&
    smokeHook.includes("agentRunDistinctIds") &&
    smokeHook.includes("terminalEventType") &&
    smokeHook.includes("durationMs") &&
    smokeHook.includes("at: event.at") &&
    smokeHook.includes("e2e-failure-abort") &&
    smokeHook.includes("e2e-failure-timeout") &&
    smokeHook.includes("e2e-failure-empty-done") &&
    smokeHook.includes("e2e-failure-disconnect") &&
    smokeHook.includes("e2e-attachments") &&
    smokeHook.includes("fake-agent attachments: 2") &&
    smokeHook.includes("synthetic gateway error") &&
    smokeHook.includes("gateway-unreachable") &&
    smokeHook.includes("ended before data: [DONE]") &&
    smokeHook.includes("unmanagedGatewayRejected") &&
    smokeHook.includes("bundledBackendAvailable") &&
    smokeHook.includes("api.saveApiKey") &&
    smokeHook.includes("api.startChat") &&
    smokeHook.includes("api.openPath") &&
    smoke.includes("release\", \"win-unpacked\", \"OpenDrSai.exe") &&
    smoke.includes("startFakeGateway") &&
    smoke.includes("OPENDRSAI_PACKAGED_SMOKE_PORT") &&
    smoke.includes("OPENDRSAI_GATEWAY_PORT") &&
    smoke.includes("127.0.0.1\", () => resolve(server)") &&
    smoke.includes("DRSAI_HOME") &&
    smoke.includes("verifyEnvFile") &&
    smoke.includes("HEPAI_API_KEY=opendrsai-packaged-smoke-key") &&
    smoke.includes("Packaged app smoke passed with real main/preload/IPC") &&
    e2eChat.includes("DRSAI_GATEWAY_FAKE_AGENT") &&
    e2eChat.includes("DRSAI_GATEWAY_DEV_MANAGED") &&
    e2eChat.includes("OPENDRSAI_GATEWAY_PORT") &&
    e2eChat.includes("assertChatDiagnostics") &&
    e2eChat.includes("E2E chat did not create a real chat thread") &&
    e2eChat.includes("E2E chat emitted events for the wrong thread") &&
    e2eChat.includes("E2E chat did not return its thread to idle after completion") &&
    e2eChat.includes("terminalEventType") &&
    e2eChat.includes("durationMs") &&
    e2eChat.includes("OPENDRSAI_DEV_AUTH_BYPASS") &&
    e2eChat.includes("OPENDRSAI_E2E_CHAT") &&
    e2eChat.includes("E2E chat passed with packaged Electron + real Python fake gateway") &&
    e2eFailures.includes("OPENDRSAI_E2E_CHAT_FAILURES") &&
    e2eFailures.includes("OPENDRSAI_GATEWAY_PORT") &&
    e2eFailures.includes("assertScenarioDiagnostics") &&
    e2eFailures.includes("assertThreadPersistence") &&
    e2eFailures.includes("expectedTerminal") &&
    e2eFailures.includes("durationMs") &&
    e2eFailures.includes("abort") &&
    e2eFailures.includes("sse-error") &&
    e2eFailures.includes("gateway-unreachable") &&
    e2eFailures.includes("timeout") &&
    e2eFailures.includes("empty-done") &&
    e2eFailures.includes("chunk-disconnect") &&
    e2eFailures.includes("attachments") &&
    e2eFailures.includes("readJsonBody") &&
    e2eFailures.includes("assertAttachmentBody") &&
    e2eFailures.includes("E2E_TEXT_ATTACHMENT_SENTINEL") &&
    e2eFailures.includes("attachment_context") &&
    e2eFailures.includes("folder-not-inlined") &&
    e2eFailures.includes("threads.json left a running thread") &&
    e2eFailures.includes("OPENDRSAI_E2E_ATTACHMENT_FILE") &&
    e2eFailures.includes("OPENDRSAI_CHAT_TIMEOUT_MS") &&
    e2eFailures.includes("E2E chat failure paths passed") &&
    e2eAgentRun.includes("OPENDRSAI_E2E_AGENT_RUN") &&
    e2eAgentRun.includes("OPENDRSAI_GATEWAY_PORT") &&
    e2eAgentRun.includes("assertAgentRunBody") &&
    e2eAgentRun.includes("assertAgentRunDiagnostics") &&
    e2eAgentRun.includes("agent run thread id collapsed into request/run id") &&
    e2eAgentRun.includes("agent run request id collapsed into run id") &&
    e2eAgentRun.includes("expected exactly one gateway request") &&
    e2eAgentRun.includes('kind !== "agent_run"') &&
    e2eAgentRun.includes("e2e-agent-run-request-0001") &&
    e2eAgentRun.includes("e2e-agent-run-run-0001") &&
    e2eAgentRun.includes("general-collaboration") &&
    e2eAgentRun.includes("fake-agent-run: write a short plan") &&
    e2eAgentRun.includes("E2E agent run passed with packaged Electron + fake gateway") &&
    e2eAgentRunFailures.includes("OPENDRSAI_E2E_AGENT_RUN_FAILURES") &&
    e2eAgentRunFailures.includes("OPENDRSAI_AGENT_RUN_TIMEOUT_MS") &&
    e2eAgentRunFailures.includes("assertScenarioDiagnostics") &&
    e2eAgentRunFailures.includes("assertThreadPersistence") &&
    e2eAgentRunFailures.includes("expectedTerminal") &&
    e2eAgentRunFailures.includes("abort") &&
    e2eAgentRunFailures.includes("sse-error") &&
    e2eAgentRunFailures.includes("timeout") &&
    e2eAgentRunFailures.includes("chunk-disconnect") &&
    e2eAgentRunFailures.includes("synthetic agent error") &&
    e2eAgentRunFailures.includes("ended before data: [DONE]") &&
    e2eAgentRunFailures.includes("threads.json left a running agent thread") &&
    e2eAgentRunFailures.includes("E2E agent run failure paths passed") &&
    e2eThreads.includes("OPENDRSAI_E2E_THREADS") &&
    e2eThreads.includes("OPENDRSAI_E2E_THREADS_PHASE") &&
    e2eThreads.includes("OPENDRSAI_E2E_THREADS_ID") &&
    e2eThreads.includes("threads.json") &&
    e2eThreads.includes("assertGatewayRequests") &&
    e2eThreads.includes("thread_id") &&
    e2eThreads.includes("desktop_request_id") &&
    e2eThreads.includes("E2E threads passed with restart persistence") &&
    readiness.includes("Packaged app IPC smoke") &&
    readiness.includes("verify:packaged") &&
    readiness.includes("verify:e2e-chat") &&
    readiness.includes("verify:e2e-chat-failures") &&
    readiness.includes("verify:e2e-agent-run") &&
    readiness.includes("verify:e2e-agent-run-failures") &&
    readiness.includes("verify:e2e-threads")
  );
});

check("GitHub workflow builds installer, manifest, and bootstrapper", () => {
  const workflowPath = join(root, "..", "..", "..", ".github", "workflows", "windows-desktop.yml");
  if (!existsSync(workflowPath)) return false;
  const workflow = readFileSync(workflowPath, "utf8");
  return [
    "Resolve release coordinates",
    "OPENDRSAI_RELEASE_BASE_URL",
    "OPENDRSAI_RELEASE_TAG",
    "Release tag $tag must match package version tag $expectedTag",
    "Manual publish_release must run from main",
    "permissions:",
    "contents: write",
    "Verify backend release tag",
    "git ls-remote --exit-code --tags",
    "Verify backend release version",
    "verify-backend-release-version.ps1",
    "EXPECTED_WINDOWS_SIGNER_THUMBPRINT",
    "EXPECTED_WINDOWS_SIGNER_SUBJECT",
    "choco install nsis",
    "npm run verify",
    "npm run build:win",
    "visual-checks",
    "npm run verify:packaged",
    "npm run manifest:win",
    "npm run verify:manifest",
    "bootstrapper\\build.ps1",
    "OpenDrSai Installer.exe",
    "softprops/action-gh-release",
  ].every((text) => workflow.includes(text));
});

check("Windows icon assets are present after icon generation", () => {
  return (
    existsSync(join(root, "build", "icon.ico")) &&
    existsSync(join(root, "build", "icon.png"))
  );
});

const failures = [];
for (const item of checks) {
  let passed = false;
  try {
    passed = Boolean(item.predicate());
  } catch {
    passed = false;
  }
  if (!passed) failures.push(item.name);
}

if (failures.length) {
  console.error("Windows app verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Windows app verification passed (${checks.length} checks).`);
