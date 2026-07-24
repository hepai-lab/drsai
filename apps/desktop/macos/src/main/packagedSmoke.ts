import { app, powerMonitor, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { getUpdateHealthConfirmation } from "./updater";
import type { NativeHelperSupervisor } from "./native/nativeHelperSupervisor";

type PackagedScenario = "smoke" | "core" | "product-state" | "approval-replay" | "restart" | "fault" | "crash-ready" | "recovery" | "stability" | "performance-ready" | "managed-process-crash" | "sleep-wake" | "tcc" | "online-update-lab";

interface PackagedScenarioConfig {
  workspacePath?: string;
  workspaceId?: string;
  threadId?: string;
  approvalId?: string;
  durationMs?: number;
  intervalMs?: number;
  targetVersion?: string;
  readyPath?: string;
}

/**
 * Executes opt-in packaged acceptance scenarios through the real preload and
 * ipcMain boundary. Normal product launches never enter this path.
 */
export function runPackagedSmokeIfRequested(window: BrowserWindow, nativeHelper: NativeHelperSupervisor): void {
  const output = process.env.OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE?.trim();
  if (!output) return;
  if (!app.isPackaged) throw new Error("macOS packaged acceptance requires a packaged application.");
  const scenario = normalizeScenario(process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO);
  const config = parseConfig(process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG);
  const execute = async () => {
    try {
      let result = scenario === "sleep-wake"
        ? await runSleepWakeScenario(window, config)
        : await window.webContents.executeJavaScript(buildScenarioScript(scenario, config), true);
      if (scenario === "managed-process-crash") {
        const gatewayBefore = (result as { gateway?: { pid?: number } }).gateway;
        const helperBefore = { ...nativeHelper.state(), pid: nativeHelper.processId() };
        if (helperBefore.status !== "ready" || !helperBefore.pid || !gatewayBefore?.pid) throw new Error("managed crash scenario requires ready Helper and Gateway processes");
        process.kill(helperBefore.pid, "SIGKILL");
        await waitUntil(() => nativeHelper.state().status === "ready" && Boolean(nativeHelper.processId()) && nativeHelper.processId() !== helperBefore.pid, 5_000, "Native Helper did not recover after SIGKILL");
        const helperAfter = { ...nativeHelper.state(), pid: nativeHelper.processId(), pong: (await nativeHelper.request("ping")).result?.pong === true };
        process.kill(gatewayBefore.pid, "SIGKILL");
        const gatewayAfter = await window.webContents.executeJavaScript(`(async () => { const api = window.openDrSai; const previousPid = ${gatewayBefore.pid}; let crashObserved = false; for (let attempt = 0; attempt < 100; attempt += 1) { const status = await api.getGatewayStatus(); if (!status.ready || status.pid !== previousPid) { crashObserved = true; break; } await new Promise((resolve) => setTimeout(resolve, 50)); } if (!crashObserved) throw new Error("Gateway crash was not observable"); if (!(await api.startGateway())) throw new Error("Gateway did not restart after SIGKILL"); const status = await api.getGatewayStatus(); if (!status.ready || !status.pid || status.pid === previousPid) throw new Error("Gateway restart did not produce a new healthy PID"); return status; })()`, true);
        result = { ...(result as object), helperBefore, helperAfter, gatewayAfter };
      }
      const updateHealth = scenario === "online-update-lab" && (result as { postUpdateHealthy?: boolean }).postUpdateHealthy
        ? getUpdateHealthConfirmation()
        : undefined;
      if (updateHealth && (!updateHealth.confirmed || updateHealth.version !== config.targetVersion)) throw new Error("updated App did not write its stable health confirmation");
      await writeFile(output, `${JSON.stringify({ ok: true, scenario, ...result, ...(updateHealth ? { updateHealth } : {}) }, null, 2)}\n`, "utf8");
      if (scenario !== "crash-ready" && !(scenario === "online-update-lab" && (result as { updateInstallRequested?: boolean }).updateInstallRequested)) app.quit();
    } catch (error) {
      await writeFile(output, `${JSON.stringify({ ok: false, scenario, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, "utf8").catch(() => undefined);
      app.exit(1);
    }
  };
  if (window.webContents.isLoading()) window.webContents.once("did-finish-load", () => { void execute(); });
  else queueMicrotask(() => { void execute(); });
}

function normalizeScenario(value: string | undefined): PackagedScenario {
  const scenario = value?.trim() || "smoke";
  if (["smoke", "core", "product-state", "approval-replay", "restart", "fault", "crash-ready", "recovery", "stability", "performance-ready", "managed-process-crash", "sleep-wake", "tcc", "online-update-lab"].includes(scenario)) return scenario as PackagedScenario;
  throw new Error(`Unsupported packaged acceptance scenario: ${scenario}`);
}

function parseConfig(raw: string | undefined): PackagedScenarioConfig {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as PackagedScenarioConfig;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Packaged scenario config must be an object.");
  return parsed;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(message);
}

async function runSleepWakeScenario(window: BrowserWindow, config: PackagedScenarioConfig): Promise<unknown> {
  if (!config.readyPath) throw new Error("sleep-wake scenario requires readyPath");
  const eventNames = ["lock-screen", "suspend", "resume", "unlock-screen"] as const;
  const observed: Array<{ type: typeof eventNames[number]; at: string; uptimeSeconds: number }> = [];
  const listeners = new Map<typeof eventNames[number], () => void>();
  const lifecycleMonitor = powerMonitor as unknown as NodeJS.EventEmitter;
  for (const type of eventNames) {
    const listener = () => { observed.push({ type, at: new Date().toISOString(), uptimeSeconds: process.uptime() }); };
    listeners.set(type, listener);
    lifecycleMonitor.on(type, listener);
  }
  try {
    const gatewayBefore = await window.webContents.executeJavaScript(`(async () => { const api = window.openDrSai; await api.startInstall({}); const install = await api.getInstallStatus(); if (!install.installed) throw new Error("sleep-wake scenario could not install the bundled Runtime"); if (!(await api.startGateway())) throw new Error("sleep-wake scenario could not start Gateway"); const status = await api.getGatewayStatus(); if (!status.ready || !status.pid) throw new Error("sleep-wake Gateway was not healthy before interruption"); return status; })()`, true);
    await writeFile(config.readyPath, `${JSON.stringify({ ready: true, scenario: "sleep-wake", appPid: process.pid, gatewayBefore, expectedEvents: eventNames }, null, 2)}\n`, "utf8");
    const timeoutMs = Math.max(60_000, Math.min(config.durationMs ?? 900_000, 1_800_000));
    await waitUntil(() => eventNames.every((type) => observed.some((event) => event.type === type)), timeoutMs, `sleep-wake did not observe all native lifecycle events: ${observed.map((event) => event.type).join(",")}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const gatewayAfter = await window.webContents.executeJavaScript(`window.openDrSai.getGatewayStatus()`, true);
    if (!gatewayAfter.ready || !gatewayAfter.pid) throw new Error("sleep-wake Gateway was not healthy after recovery");
    const indexes = Object.fromEntries(eventNames.map((type) => [type, observed.findIndex((event) => event.type === type)]));
    if (indexes.suspend > indexes.resume || indexes["lock-screen"] > indexes["unlock-screen"]) throw new Error("sleep-wake lifecycle events were out of order");
    return { gatewayBefore, gatewayAfter, events: observed, eventOrderValid: true, allExpectedEventsObserved: true };
  } finally {
    for (const [type, listener] of listeners) lifecycleMonitor.removeListener(type, listener);
  }
}

function buildScenarioScript(scenario: PackagedScenario, config: PackagedScenarioConfig): string {
  return `(() => { const terminalRoundtrip = ${terminalRoundtrip.toString()}; return (${rendererScenario.toString()})(${JSON.stringify(scenario)}, ${JSON.stringify(config)}); })()`;
}

async function rendererScenario(scenario: PackagedScenario, config: PackagedScenarioConfig): Promise<unknown> {
  const api = window.openDrSai;
  const descriptor = await api.getPlatformDescriptor();
  if (descriptor.id !== "macos") throw new Error("packaged scenario did not load the macOS platform adapter");

  if (scenario === "performance-ready") return { descriptor, interactive: true };

  if (scenario === "managed-process-crash") {
    if (!(await api.startGateway())) throw new Error("managed crash scenario could not start Gateway");
    const gateway = await api.getGatewayStatus();
    if (!gateway.ready || !gateway.pid) throw new Error("managed crash scenario Gateway did not expose a healthy PID");
    return { descriptor, gateway };
  }

  if (scenario === "smoke" || scenario === "core") {
    await api.startInstall({});
    const install = await api.getInstallStatus();
    if (!install.installed) throw new Error("bundled Runtime installation did not become ready");
    const gatewayStarts = await Promise.all([api.startGateway(), api.startGateway()]);
    if (!gatewayStarts.every(Boolean)) throw new Error("concurrent Gateway start did not converge to ready");
    const gateway = await api.getGatewayStatus();
    if (!gateway.ready || !gateway.pid) throw new Error("managed Gateway did not report a healthy PID");
    const terminal = await terminalRoundtrip(api);
    if (scenario === "smoke") return { descriptor, install, gateway, gatewayStarts, ...terminal };

    if (!config.workspacePath) throw new Error("core scenario requires workspacePath");
    let workspace = (await api.listWorkspaces()).find((item) => item.path === config.workspacePath);
    workspace ??= await api.createWorkspace({ source: "existing", path: config.workspacePath, name: "L5 packaged workspace", trusted: true });
    if (!workspace.trusted) workspace = await api.updateWorkspace({ id: workspace.id, trusted: true });
    if (!workspace.trusted) throw new Error("core scenario could not persist workspace trust");
    const thread = await api.createThread({ kind: "chat", title: "L5 packaged persistence", workspacePath: workspace.path });
    await api.upsertUserPreference({ category: "output_language", value: "zh", source: "explicit_user_request" });
    const preferences = await api.listUserPreferences();
    if (!preferences.some((item) => item.category === "output_language" && item.value === "zh")) throw new Error("preference IPC did not persist the reviewed value");
    const threads = await api.listThreads();
    if (!threads.some((item) => item.id === thread.id)) throw new Error("thread IPC did not persist the created thread");
    return { descriptor, install, gateway, gatewayStarts, ...terminal, workspace, thread, persistenceChecks: 2 };
  }

  if (scenario === "restart" || scenario === "recovery") {
    if (!config.threadId) throw new Error(`${scenario} scenario requires threadId`);
    const [threads, preferences] = await Promise.all([api.listThreads(), api.listUserPreferences()]);
    if (!threads.some((item) => item.id === config.threadId)) throw new Error("persisted thread was lost across process restart");
    if (!preferences.some((item) => item.category === "output_language" && item.value === "zh")) throw new Error("persisted preference was lost across process restart");
    if (scenario === "recovery" && config.approvalId) {
      const pending = await api.listPendingApprovals();
      if (!pending.some((item) => item.id === config.approvalId && item.source === "git")) throw new Error("pending git approval was lost across forced restart");
      if (!(await api.decideApproval({ id: config.approvalId, approved: false, reason: "reject" }))) throw new Error("recovered git approval could not be rejected");
      if ((await api.listPendingApprovals()).some((item) => item.id === config.approvalId)) throw new Error("rejected recovered approval remained pending");
      return { descriptor, threadId: config.threadId, threadRecovered: true, preferenceRecovered: true, approvalRecoveredRejected: true };
    }
    return { descriptor, threadId: config.threadId, threadRecovered: true, preferenceRecovered: true };
  }

  if (scenario === "approval-replay") {
    if (!config.workspacePath) throw new Error("approval-replay scenario requires workspacePath");
    const proposal = await api.requestGitCommitApproval({ workspacePath: config.workspacePath, message: "Packaged L5 approved commit", body: "Verify durable packaged Approval Center execution.", requestId: "packaged-l5-git-approval" });
    return { descriptor, proposal };
  }

  if (scenario === "product-state") {
    if (!config.workspacePath) throw new Error("product-state scenario requires workspacePath");
    const workspaces = await api.listWorkspaces();
    const workspace = workspaces.find((item) => (config.workspaceId ? item.id === config.workspaceId : item.path === config.workspacePath));
    if (!workspace?.trusted) {
      const install = await api.getInstallStatus();
      throw new Error(`product-state scenario requires the trusted packaged workspace (found=${Boolean(workspace)}, trusted=${workspace?.trusted ?? "missing"}, count=${workspaces.length}, home=${install.home}, repo=${install.repoPath})`);
    }
    const auth = await api.login({ developerBypass: true, rememberMe: true });
    if (!auth.ok || !auth.session?.authenticated || auth.session.user?.id !== "packaged-l5-user") throw new Error("packaged product journey did not establish its isolated E2E identity");
    if (!(await api.startGateway())) throw new Error("packaged Chat/Agent journey could not start the managed Gateway");

    const lifecycleThread = await api.createThread({ kind: "agent_run", title: "Packaged thread lifecycle", workspacePath: workspace.path });
    const boundThread = await api.updateThread({ id: lifecycleThread.id, title: "Packaged thread lifecycle updated", status: "running", lastRunId: "packaged-run-001", lastRequestId: "packaged-request-001", runtimeSessionId: "packaged-session-001", messageCount: 2 });
    if (boundThread.lastRunId !== "packaged-run-001" || boundThread.runtimeSessionId !== "packaged-session-001") throw new Error("thread run binding did not persist");
    await api.updateThreadSnapshot({ threadId: lifecycleThread.id, title: boundThread.title, messages: [{ id: "packaged-thread-user", role: "user", content: "find packaged thread marker" }, { id: "packaged-thread-assistant", role: "assistant", content: "packaged thread marker restored" }], updatedAt: Date.now(), messageCount: 2 });
    if ((await api.getThreadSnapshot(lifecycleThread.id))?.messages.length !== 2 || !(await api.searchThreadMessages({ query: "packaged thread marker", threadIds: [lifecycleThread.id] })).some((item) => item.threadId === lifecycleThread.id)) throw new Error("thread snapshot or search did not round-trip");
    const archivedThread = await api.setThreadArchived({ threadId: lifecycleThread.id, archived: true });
    if (!archivedThread.archived || !(await api.listThreads()).some((item) => item.id === lifecycleThread.id && item.archived)) throw new Error("thread archive did not persist");
    if (!(await api.deleteThread(lifecycleThread.id)) || await api.deleteThread(lifecycleThread.id) || await api.getThreadSnapshot(lifecycleThread.id) !== null) throw new Error("thread delete was not idempotent or left its snapshot behind");

    const agents = await api.listAgents();
    if (!agents.some((item) => item.id === "my-drsai" && item.source === "local")) throw new Error("local Agent was missing from the packaged catalog");
    if (!(await api.setDefaultAgent("my-drsai")).saved || !(await api.recordAgentUsage("my-drsai")).saved) throw new Error("local Agent default or usage preference did not persist");
    if ((await api.setDefaultAgent("packaged-missing-agent")).saved) throw new Error("unknown Agent was accepted as the default");

    const chatRequestId = "packaged_chat_abort_001";
    const chatThreadId = "packaged-chat-thread-001";
    const chatEvents: Array<{ type: string; seq?: number }> = [];
    let resolveChatTerminal: ((type: string) => void) | undefined;
    const chatTerminal = new Promise<string>((resolve) => { resolveChatTerminal = resolve; });
    const offChat = api.onChatEvent((event) => {
      if (event.requestId !== chatRequestId) return;
      chatEvents.push({ type: event.type, seq: event.seq });
      if (event.type === "done" || event.type === "error" || event.type === "aborted") resolveChatTerminal?.(event.type);
    });
    const startedChatId = await api.startChat({ requestId: chatRequestId, threadId: chatThreadId, sessionId: chatThreadId, runId: "packaged-chat-run-001", agentId: "my-drsai", workspacePath: workspace.path, messages: [{ role: "user", content: "Hold this packaged Chat until explicit cancellation." }] });
    if (startedChatId !== chatRequestId || !(await api.abortChat(chatRequestId))) throw new Error("packaged Chat did not start and accept explicit cancellation");
    const chatTerminalType = await Promise.race([chatTerminal, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("packaged Chat cancellation timed out")), 10_000))]);
    offChat();
    if (chatTerminalType !== "aborted" || !chatEvents.some((item) => item.type === "start") || chatEvents.some((item) => item.type === "done") || chatEvents.some((item, index) => index > 0 && Number(item.seq) <= Number(chatEvents[index - 1]?.seq))) throw new Error("packaged Chat event stream did not terminate once in monotonic aborted state");
    let recoveredChat: Awaited<ReturnType<typeof api.recoverChatRun>> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recoveredChat = await api.recoverChatRun({ requestId: chatRequestId, sessionId: chatThreadId });
      if (recoveredChat.some((item) => item.type === "aborted")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!recoveredChat.some((item) => item.type === "start") || !recoveredChat.some((item) => item.type === "aborted") || new Set(recoveredChat.map((item) => item.seq)).size !== recoveredChat.length || await api.respondChatInput(chatRequestId, "late input")) throw new Error("cancelled Chat did not recover an ordered deduplicated journal or rejected late input");

    const recoveryChatRequestId = "packaged_chat_recovery_001";
    const recoveryChatThreadId = "packaged-chat-recovery-thread-001";
    const recoveryChatEvents: Array<{ type: string; content?: string; connection?: string; seq?: number }> = [];
    let resolveRecoveryChatTerminal: ((type: string) => void) | undefined;
    const recoveryChatTerminal = new Promise<string>((resolve) => { resolveRecoveryChatTerminal = resolve; });
    const offRecoveryChat = api.onChatEvent((event) => {
      if (event.requestId !== recoveryChatRequestId) return;
      recoveryChatEvents.push({ type: event.type, content: event.content, connection: event.connection?.status, seq: event.seq });
      if (event.type === "done" || event.type === "error" || event.type === "aborted") resolveRecoveryChatTerminal?.(event.type);
    });
    const startedRecoveryChat = await api.startChat({ requestId: recoveryChatRequestId, threadId: recoveryChatThreadId, sessionId: recoveryChatThreadId, runId: "packaged-chat-recovery-run-001", agentId: "my-drsai", workspacePath: workspace.path, metadata: { packaged_recovery_fixture: true }, messages: [{ role: "user", content: "Exercise the packaged incomplete SSE recovery fixture." }] });
    if (startedRecoveryChat !== recoveryChatRequestId) throw new Error("packaged recovery Chat returned the wrong request identity");
    const recoveryChatTerminalType = await Promise.race([recoveryChatTerminal, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("packaged Chat reconnect timed out")), 15_000))]);
    offRecoveryChat();
    const liveRecoveryContent = recoveryChatEvents.filter((item) => item.type === "chunk").map((item) => item.content ?? "").join("");
    if (recoveryChatTerminalType !== "done" || !recoveryChatEvents.some((item) => item.type === "connection" && item.connection === "retrying") || !recoveryChatEvents.some((item) => item.type === "connection" && item.connection === "restored") || liveRecoveryContent !== "alpha beta" || (liveRecoveryContent.match(/alpha/g) ?? []).length !== 1 || recoveryChatEvents.some((item, index) => index > 0 && Number(item.seq) <= Number(recoveryChatEvents[index - 1]?.seq))) throw new Error("packaged Chat did not reconnect with a monotonic duplicate-free resumed stream");
    let recoveredNetworkChat: Awaited<ReturnType<typeof api.recoverChatRun>> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recoveredNetworkChat = await api.recoverChatRun({ requestId: recoveryChatRequestId, sessionId: recoveryChatThreadId });
      if (recoveredNetworkChat.some((item) => item.type === "done")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const recoveredNetworkContent = recoveredNetworkChat.filter((item) => item.type === "chunk").map((item) => item.content ?? "").join("");
    if (!recoveredNetworkChat.some((item) => item.type === "connection" && item.connection?.status === "retrying") || !recoveredNetworkChat.some((item) => item.type === "connection" && item.connection?.status === "restored") || !recoveredNetworkChat.some((item) => item.type === "done") || recoveredNetworkContent !== "alpha beta" || (recoveredNetworkContent.match(/alpha/g) ?? []).length !== 1 || new Set(recoveredNetworkChat.map((item) => item.seq)).size !== recoveredNetworkChat.length) throw new Error("recovered Chat journal lost reconnect state or reintroduced replayed content");

    const agentRequestId = "packaged_agent_abort_001";
    const agentThreadId = "packaged-agent-thread-001";
    const agentEvents: Array<{ type: string }> = [];
    let resolveAgentTerminal: ((type: string) => void) | undefined;
    const agentTerminal = new Promise<string>((resolve) => { resolveAgentTerminal = resolve; });
    const offAgent = api.onAgentRunEvent((event) => {
      if (event.requestId !== agentRequestId) return;
      agentEvents.push({ type: event.type });
      if (event.type === "done" || event.type === "error" || event.type === "aborted") resolveAgentTerminal?.(event.type);
    });
    const startedAgent = await api.startAgentRun({ requestId: agentRequestId, threadId: agentThreadId, sessionId: agentThreadId, runId: "packaged-agent-run-001", task: "Hold this packaged Agent run until explicit cancellation.", executionDepth: "quick", workspacePath: workspace.path });
    if (startedAgent.requestId !== agentRequestId || startedAgent.runId !== "packaged-agent-run-001" || !(await api.abortAgentRun(agentRequestId))) throw new Error("packaged Agent did not start and accept explicit cancellation");
    const agentTerminalType = await Promise.race([agentTerminal, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("packaged Agent cancellation timed out")), 10_000))]);
    offAgent();
    if (agentTerminalType !== "aborted" || !agentEvents.some((item) => item.type === "start") || agentEvents.some((item) => item.type === "done")) throw new Error("packaged Agent stream did not terminate once in aborted state");
    let recoveredAgent: Awaited<ReturnType<typeof api.recoverAgentRun>> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recoveredAgent = await api.recoverAgentRun(agentThreadId);
      if (recoveredAgent.some((item) => item.type === "aborted")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!recoveredAgent.some((item) => item.type === "start") || !recoveredAgent.some((item) => item.type === "aborted") || await api.abortAgentRun(agentRequestId)) throw new Error("cancelled Agent did not recover its journal or allowed duplicate cancellation");

    const gitProposal = await api.requestGitCommitApproval({ workspacePath: workspace.path, message: "Packaged L5 approved commit", body: "Verify durable packaged Approval Center execution.", requestId: "packaged-l5-git-approval" });
    if (!gitProposal.queued || !gitProposal.approval || gitProposal.alreadyExecuted) throw new Error("git commit did not stop at Approval Center");
    if (!(await api.listPendingApprovals()).some((item) => item.id === gitProposal.approval?.id && item.source === "git")) throw new Error("git approval was not visible before execution");
    if (!(await api.decideApproval({ id: gitProposal.approval.id, approved: true }))) throw new Error("approved packaged git commit did not execute");
    if ((await api.listPendingApprovals()).some((item) => item.id === gitProposal.approval?.id)) throw new Error("executed git approval remained pending");
    const replayedGitProposal = await api.requestGitCommitApproval({ workspacePath: workspace.path, message: "Packaged L5 approved commit", body: "Verify durable packaged Approval Center execution.", requestId: "packaged-l5-git-approval" });
    if (!replayedGitProposal.alreadyExecuted || replayedGitProposal.queued) throw new Error(`executed git approval was not replay-safe: ${JSON.stringify(replayedGitProposal)}`);

    const gitActionPath = `${workspace.path}/git-action.txt`;
    const gitBaseline = await api.previewWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath });
    if (!gitBaseline.fileHash || gitBaseline.content !== "version one\n") throw new Error("packaged Git baseline was unavailable");
    const secondVersion = await api.writeWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, content: "version two\n", expectedHash: gitBaseline.fileHash });
    if (secondVersion.status !== "saved") throw new Error("packaged Git fixture edit did not save");
    const unstagedGitDiff = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, path: gitActionPath });
    if (!unstagedGitDiff.diffHash || !unstagedGitDiff.diff.includes("-version one") || !unstagedGitDiff.diff.includes("+version two")) throw new Error("workspace Git diff did not describe the packaged edit");
    let staleStageRejected = false;
    try { await api.stageWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, expectedDiffHash: "0".repeat(64) }); } catch { staleStageRejected = true; }
    if (!staleStageRejected) throw new Error("workspace Git stage accepted a stale review hash");
    const stagedGitFile = await api.stageWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, expectedDiffHash: unstagedGitDiff.diffHash });
    if (!stagedGitFile.staged || (await api.getWorkspaceGitDiff({ workspacePath: workspace.path, path: gitActionPath })).diff) throw new Error("workspace Git stage did not move the reviewed diff to index");
    const stagedGitDiff = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, path: gitActionPath, staged: true });
    const headGitFile = await api.getWorkspaceGitFileAtRef({ workspacePath: workspace.path, path: gitActionPath, ref: "HEAD" });
    if (!stagedGitDiff.diffHash || !stagedGitDiff.diff.includes("+version two") || headGitFile.missing || headGitFile.content !== "version one\n") throw new Error("staged diff or HEAD content was inconsistent");
    const secondPreview = await api.previewWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath });
    if (!secondPreview.fileHash) throw new Error("second packaged Git preview lacked a hash");
    const thirdVersion = await api.writeWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, content: "version three\n", expectedHash: secondPreview.fileHash });
    if (thirdVersion.status !== "saved") throw new Error("third packaged Git version did not save");
    const thirdGitDiff = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, path: gitActionPath });
    if (!thirdGitDiff.diffHash || !thirdGitDiff.diff.includes("+version three")) throw new Error("third packaged Git diff was unavailable");
    let staleRevertRejected = false;
    try { await api.revertWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, expectedDiffHash: stagedGitDiff.diffHash }); } catch { staleRevertRejected = true; }
    if (!staleRevertRejected) throw new Error("workspace Git revert accepted a stale review hash");
    const revertedGitFile = await api.revertWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, expectedDiffHash: thirdGitDiff.diffHash });
    const revertedPreview = await api.previewWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath });
    if (!revertedGitFile.reverted || revertedPreview.content !== "version two\n" || (await api.revertWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, expectedDiffHash: thirdGitDiff.diffHash })).reverted) throw new Error("workspace Git revert was not safe and idempotent");

    const checkpoint = await api.createWorkspaceCheckpoint({ workspacePath: workspace.path, label: "Packaged L5 before rewrite", kind: "manual", includePaths: [gitActionPath] });
    if (!checkpoint.entries.some((item) => item.path === gitActionPath && item.stored) || !(await api.listWorkspaceCheckpoints(workspace.path)).some((item) => item.id === checkpoint.id)) throw new Error("workspace checkpoint did not capture and list the packaged file");
    const checkpointBase = await api.previewWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath });
    if (!checkpointBase.fileHash) throw new Error("checkpoint base preview lacked a hash");
    const laterCheckpointVersion = await api.writeWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath, content: "version four after checkpoint\n", expectedHash: checkpointBase.fileHash });
    if (laterCheckpointVersion.status !== "saved") throw new Error("post-checkpoint edit did not save");
    const checkpointPreview = await api.previewWorkspaceCheckpoint({ workspacePath: workspace.path, checkpointId: checkpoint.id });
    if (checkpointPreview.changedEntryCount !== 1 || !checkpointPreview.entries.some((item) => item.path === gitActionPath && item.change === "modified")) throw new Error("checkpoint preview did not identify the packaged change");
    const queuedRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: workspace.path, checkpointId: checkpoint.id, operationId: "packaged-l5-checkpoint-restore", includePaths: [gitActionPath] });
    if (!queuedRestore.approvalQueued || !queuedRestore.approvalId || queuedRestore.restored) throw new Error("checkpoint restore did not stop at Approval Center");
    if (!(await api.listPendingApprovals()).some((item) => item.id === queuedRestore.approvalId && item.source === "workspace")) throw new Error("checkpoint restore approval was not visible");
    if (!(await api.decideApproval({ id: queuedRestore.approvalId, approved: true }))) throw new Error("checkpoint restore approval did not execute");
    if ((await api.previewWorkspaceFile({ workspacePath: workspace.path, path: gitActionPath })).content !== "version two\n") throw new Error("approved checkpoint restore did not restore captured content");
    const replayedRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: workspace.path, checkpointId: checkpoint.id, operationId: "packaged-l5-checkpoint-restore", includePaths: [gitActionPath] });
    if (replayedRestore.approvalQueued || !replayedRestore.restored) throw new Error("checkpoint restore idempotency key did not replay safely");
    const acceptedBaseline = await api.createWorkspaceCheckpoint({ workspacePath: workspace.path, label: "Packaged L5 accepted baseline", kind: "agent_run_baseline", runId: "packaged-l5-baseline", includePaths: [gitActionPath] });
    if ((await api.acceptWorkspaceCheckpoint({ workspacePath: workspace.path, checkpointId: acceptedBaseline.id })).reviewStatus !== "accepted") throw new Error("agent baseline checkpoint was not accepted");
    let acceptedRestoreRejected = false;
    try { await api.restoreWorkspaceCheckpoint({ workspacePath: workspace.path, checkpointId: acceptedBaseline.id, operationId: "packaged-l5-accepted-restore" }); } catch { acceptedRestoreRejected = true; }
    if (!acceptedRestoreRejected) throw new Error("accepted checkpoint could still be restored");

    const forkWorktree = await api.prepareForkWorktree({ workspacePath: workspace.path, intent: "packaged-l5-worktree" });
    if (!forkWorktree.worktreeId || !forkWorktree.sourceWorkspaceId || !forkWorktree.workspaceId || forkWorktree.location !== "local") throw new Error("Runtime did not create an identified local Worktree");
    const listedWorktrees = await api.listWorktrees({ workspacePath: workspace.path, workspaceId: forkWorktree.sourceWorkspaceId });
    if (!listedWorktrees.some((item) => item.worktreeId === forkWorktree.worktreeId && item.workspaceId === forkWorktree.workspaceId && item.status === "active")) throw new Error("created Worktree was missing from Runtime inventory");
    const worktreeEvents = await api.listWorktreeEvents({ workspacePath: workspace.path, workspaceId: forkWorktree.sourceWorkspaceId, afterSequence: 0 });
    if (!worktreeEvents.events.some((item) => item.type.startsWith("worktree.") && (item.data.worktree_id === forkWorktree.worktreeId || item.data.worktreeId === forkWorktree.worktreeId)) || worktreeEvents.nextSequence < 1) throw new Error("Runtime Worktree creation event was not observable");
    const forkThread = await api.createThread({
      kind: "agent_run",
      title: "Packaged Worktree queue lifecycle",
      workspacePath: forkWorktree.worktreePath,
      fork: {
        worktreeId: forkWorktree.worktreeId,
        sourceWorkspaceId: forkWorktree.sourceWorkspaceId,
        workspaceId: forkWorktree.workspaceId,
        sourceWorkspacePath: forkWorktree.sourceWorkspacePath,
        repoRoot: forkWorktree.repoRoot,
        worktreePath: forkWorktree.worktreePath,
        branch: forkWorktree.branch,
        baseRef: forkWorktree.baseRef,
        createdAt: new Date().toISOString(),
        sourceHasChanges: forkWorktree.sourceHasChanges,
        sourceStatusSummary: forkWorktree.sourceStatusSummary,
        lifecycleStatus: "active",
        queueGroupId: "packaged-l5-worktree-queue",
        queueIndex: 1,
        queueSize: 1,
        queueStatus: "queued",
      },
    });
    const blockedDispatch = await api.dispatchForkQueue({ threadIds: [forkThread.id], selectedAgentId: "packaged-l5-agent", selectedAgentName: "Packaged L5 Agent" });
    if (!blockedDispatch.blockedThreadIds.includes(forkThread.id) || blockedDispatch.startedRuns.length) throw new Error("unapproved Worktree queue dispatch did not fail closed");
    const resetForkThread = await api.updateThread({ id: forkThread.id, fork: { ...blockedDispatch.threads[0]!.fork!, queueStatus: "queued", queueAgentId: "packaged-l5-agent", queueAgentName: "Packaged L5 Agent" } });
    const queueProposal = await api.requestForkQueueStartApproval({ threadIds: [resetForkThread.id] });
    if (!queueProposal.queued || !queueProposal.approval || queueProposal.threads[0]?.fork?.queueStatus !== "waiting_approval") throw new Error("Worktree queue did not stop at Approval Center");
    if (!(await api.decideApproval({ id: queueProposal.approval.id, approved: true }))) throw new Error("Worktree queue approval did not execute");
    const readyForkThread = (await api.listThreads()).find((item) => item.id === forkThread.id);
    if (readyForkThread?.fork?.queueStatus !== "ready") throw new Error("approved Worktree queue did not become ready");
    const dispatchedFork = await api.dispatchForkQueue({ threadIds: [forkThread.id], selectedAgentId: "packaged-l5-agent", selectedAgentName: "Packaged L5 Agent" });
    if (dispatchedFork.blockedThreadIds.length || dispatchedFork.startedRuns.length !== 1 || dispatchedFork.threads[0]?.fork?.queueStatus !== "running" || dispatchedFork.threads[0]?.fork?.queueAgentId !== "packaged-l5-agent") throw new Error("approved Worktree queue did not dispatch exactly one assigned Agent run");
    if (!(await api.abortAgentRun(dispatchedFork.startedRuns[0]!.requestId))) throw new Error("dispatched Worktree Agent run could not be aborted");
    let worktreeBecameIdle = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = (await api.listWorktrees({ workspacePath: workspace.path, workspaceId: forkWorktree.sourceWorkspaceId })).find((item) => item.worktreeId === forkWorktree.worktreeId);
      if (current?.activity.total === 0) { worktreeBecameIdle = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!worktreeBecameIdle) throw new Error("aborted Worktree Agent run did not release its Runtime resources");
    const discardProposal = await api.requestForkLifecycleApproval({ threadId: forkThread.id, action: "discard" });
    if (!discardProposal.queued || !discardProposal.approval) throw new Error("Worktree discard did not stop at Approval Center");
    if (!(await api.decideApproval({ id: discardProposal.approval.id, approved: true }))) throw new Error("approved Worktree discard did not execute");
    const closedForkThread = (await api.listThreads()).find((item) => item.id === forkThread.id);
    const removedWorktrees = await api.listWorktrees({ workspacePath: workspace.path, workspaceId: forkWorktree.sourceWorkspaceId, includeRemoved: true });
    if (closedForkThread?.fork?.lifecycleStatus !== "closed" || !removedWorktrees.some((item) => item.worktreeId === forkWorktree.worktreeId && item.status === "removed")) throw new Error("discarded Worktree did not close both Thread and Runtime state");

    const ideContext = await api.getIdeContext(workspace.path);
    if (!ideContext.available || ideContext.source !== "vscode" || ideContext.currentFile?.relativePath !== "handoff-source.ts" || ideContext.currentFile.language !== "typescript" || ideContext.currentSelection?.text !== "packagedHandoff" || ideContext.currentSelection.truncated) throw new Error("packaged IDE context did not preserve its canonical file and selection");
    const handoffSourcePath = `${workspace.path}/handoff-source.ts`;
    const fileIcon = await api.getFileIcon(handoffSourcePath);
    if (fileIcon.path !== handoffSourcePath || !fileIcon.dataUrl?.startsWith("data:image/png;base64,") || fileIcon.dataUrl.length > 1_000_000) throw new Error("macOS native file icon did not round-trip within its size bound");
    const outsideIcon = await api.getFileIcon("/etc/passwd");
    if (outsideIcon.dataUrl !== null) throw new Error("file icon lookup escaped the approved desktop roots");
    if (!(await api.performEditCommand("selectAll")) || await api.performEditCommand("invalid" as "selectAll")) throw new Error("renderer edit command whitelist did not accept/reject the expected commands");
    const pdfPath = `${workspace.path}/handoff.pdf`;
    const openedPdf = await api.openPdfPage({ path: pdfPath, page: 1 });
    if (!openedPdf.ok || openedPdf.path !== pdfPath || openedPdf.page !== 1 || !openedPdf.viewerUrl.startsWith("file://") || !openedPdf.viewerUrl.endsWith("#page=1&zoom=page-width")) throw new Error("PDF page handoff did not reach macOS LaunchServices with its bounded page fragment");
    let nonPdfRejected = false;
    try { await api.openPdfPage({ path: handoffSourcePath, page: 1 }); } catch { nonPdfRejected = true; }
    if (!nonPdfRejected) throw new Error("PDF handoff accepted a non-PDF source");

    const command = await api.upsertCustomCommand({ workspacePath: workspace.path, name: "l5-review", title: "L5 review", prompt: "Review the packaged journey state.", source: "manual" });
    if (!(await api.listCustomCommands({ workspacePath: workspace.path })).some((item) => item.id === command.id)) throw new Error("custom command did not round-trip through packaged IPC");
    const removedCommand = await api.deleteCustomCommand({ workspacePath: workspace.path, commandIdOrName: command.id });
    if (removedCommand.removedCount !== 1) throw new Error("custom command cleanup did not persist");

    const memory = await api.addProjectMemory({ workspacePath: workspace.path, content: "Packaged L5 project memory", source: "manual" });
    const updatedMemory = await api.updateProjectMemory({ workspacePath: workspace.path, entryId: memory.id, content: "Packaged L5 project memory updated", source: "manual" });
    if (!(await api.listProjectMemory({ workspacePath: workspace.path, query: "updated" })).some((item) => item.id === updatedMemory.id)) throw new Error("project memory search did not return the updated entry");
    if ((await api.clearProjectMemory({ workspacePath: workspace.path, entryId: memory.id })).removedCount !== 1) throw new Error("project memory cleanup did not persist");

    const skillDraft = await api.createProjectSkillDraft({ workspacePath: workspace.path, title: "Packaged Contract Review", content: "Validate the packaged contract and preserve verification evidence before delivery.", source: "manual" });
    if (!(await api.listProjectSkillDrafts({ workspacePath: workspace.path })).some((item) => item.id === skillDraft.id && item.skillMarkdown === skillDraft.skillMarkdown)) throw new Error("project skill draft did not round-trip through packaged IPC");
    const queuedInstall = await api.installProjectSkillDraft({ workspacePath: workspace.path, draftId: skillDraft.id });
    if (!queuedInstall.approvalQueued || !queuedInstall.approvalId || queuedInstall.installedAt || queuedInstall.installPath) throw new Error("project skill install did not stop at Approval Center");
    if (!(await api.listPendingApprovals()).some((item) => item.id === queuedInstall.approvalId)) throw new Error("project skill install approval was not visible");
    if (!(await api.decideApproval({ id: queuedInstall.approvalId, approved: true }))) throw new Error("project skill install approval was not executed");
    const installedSkill = await api.installProjectSkillDraft({ workspacePath: workspace.path, draftId: skillDraft.id });
    if (!installedSkill.alreadyInstalled || !installedSkill.installedAt || !installedSkill.installPath.endsWith("SKILL.md")) throw new Error("project skill install did not persist or was not idempotent");
    if (!(await api.listProjectSkillDrafts({ workspacePath: workspace.path })).some((item) => item.id === skillDraft.id && item.installedAt === installedSkill.installedAt && item.installPath === installedSkill.installPath)) throw new Error("installed project skill metadata did not round-trip");

    const marketplace = await api.listWorkflowMarketplace(workspace.path);
    const digestTemplate = marketplace.templates.find((item) => item.id === "connector-digest");
    if (!digestTemplate || digestTemplate.status !== "available" || digestTemplate.approvalRequired) throw new Error("connector digest workflow was not available for the packaged journey");
    const preparedWorkflow = await api.prepareWorkflowRun({ templateId: digestTemplate.id, workspacePath: workspace.path });
    if (preparedWorkflow.blocked || preparedWorkflow.queued || preparedWorkflow.recipe.status !== "ready") throw new Error("connector digest workflow recipe was not ready");
    const startedWorkflow = await api.startWorkflowRun({ recipe: preparedWorkflow.recipe });
    let workflowRun = startedWorkflow.run;
    if (workflowRun.status !== "running" || workflowRun.currentStepId !== "review-context") throw new Error("connector digest workflow did not start at review-context");
    workflowRun = (await api.dispatchWorkflowRunStep({ runId: workflowRun.id, stepId: "review-context" })).run;
    if (workflowRun.currentStepId !== "draft-brief") throw new Error("manual workflow review did not advance in strict order");
    const draftedBrief = await api.dispatchWorkflowRunStep({ runId: workflowRun.id, stepId: "draft-brief" });
    workflowRun = draftedBrief.run;
    if (!draftedBrief.dispatched || workflowRun.currentStepId !== "draft-brief" || workflowRun.steps.find((item) => item.id === "draft-brief")?.status !== "running") throw new Error("workflow Chat step was marked complete before explicit confirmation");
    workflowRun = (await api.completeWorkflowRunStep({ runId: workflowRun.id, stepId: "draft-brief", exitCode: 0, output: "Packaged fixture confirmed the reviewed digest action completed." })).run;
    if (workflowRun.currentStepId !== "verify-brief") throw new Error("confirmed workflow Chat step did not advance");
    workflowRun = (await api.dispatchWorkflowRunStep({ runId: workflowRun.id, stepId: "verify-brief" })).run;
    if (workflowRun.status !== "complete" || !(await api.listWorkflowRuns(workspace.path)).some((item) => item.id === workflowRun.id && item.status === "complete")) throw new Error("completed workflow did not persist in packaged history");

    const reusableSource = await api.enqueueBackgroundTask({ kind: "agent_run", source: "chat", title: "Analyze packaged reusable input", workspacePath: workspace.path, status: "queued", message: "Prepare reusable source task.", idempotencyKey: "packaged-l5-reusable-source", maxAttempts: 1 });
    const completedReusableSource = await api.updateBackgroundTask({ taskId: reusableSource.id, status: "completed", progress: 100, completedSteps: ["Analyze packaged reusable input"], message: "Packaged reusable source completed.", verification: "Verify packaged reusable result.", deliverySummary: { findingSummary: "Packaged reusable fixture completed.", importance: "medium", importanceReason: "Exercises packaged reusable task persistence.", suggestedAction: "Review the reusable recipe.", workSummary: "Analyzed packaged fixture input.", coreConclusion: "Reusable packaged flow is available.", verification: "Input hash and cache policy are checked.", remainingRisks: "Apple execution remains required.", artifacts: [{ id: "packaged-reusable-output", label: "Packaged reusable output", path: `${workspace.path}/reusable-output.md`, kind: "report" }] } });
    if (completedReusableSource.status !== "completed") throw new Error("reusable source task did not complete");
    const reusableTask = await api.saveReusableTask({ sourceTaskId: completedReusableSource.id, name: "Packaged L5 reusable analysis" });
    if (!reusableTask.inputs.length) throw new Error("reusable task did not infer packaged Workspace inputs");
    const reusableInputs = Object.fromEntries(reusableTask.inputs.map((input) => [input.id, input.originalValue]));
    const reusableRecipe = await api.prepareReusableTaskRun({ reusableTaskId: reusableTask.id, workspacePath: workspace.path, inputs: reusableInputs, adjustments: { outputLanguage: "en", checkItems: ["Verify input hashes", "Verify input hashes"] }, adjustmentScope: "update_template" });
    if (reusableRecipe.cachePolicy !== "force_fresh_input_read" || reusableRecipe.inputs.length !== reusableTask.inputs.length || reusableRecipe.inputs.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256)) || reusableRecipe.adjustments.checkItems.length !== 1) throw new Error("reusable task recipe did not enforce fresh hashed inputs and normalized adjustments");
    if (!(await api.listReusableTasks()).some((item) => item.id === reusableTask.id && item.runCount === 1 && item.savedAdjustments.outputLanguage === "en")) throw new Error("reusable task run metadata did not persist");

    const scheduledTask = await api.createScheduledTask({ kind: "scheduled", title: "Packaged L5 due task", cadence: "hourly", target: "Review packaged workflow state", workspacePath: workspace.path, nextRunAt: "2020-01-01T00:00:00.000Z", approvalRequired: false, verification: "Missing Workflow bindings must fail safely.", message: "Packaged scheduled task fixture." });
    if (!(await api.listScheduledTasks({ workspacePath: workspace.path })).some((item) => item.id === scheduledTask.id)) throw new Error("scheduled task did not persist through packaged IPC");
    const dueResult = await api.runDueScheduledTasks({ workspacePath: workspace.path, now: "2020-01-01T01:00:00.000Z" });
    if (!dueResult.items.some((item) => item.taskId === scheduledTask.id && item.status === "skipped" && item.reason === "missing_workflow_template")) throw new Error("unbound due task did not fail safely");
    const pausedScheduledTask = await api.updateScheduledTask({ taskId: scheduledTask.id, status: "paused", message: "Paused after packaged due check." });
    if (pausedScheduledTask.status !== "paused") throw new Error("scheduled task pause did not persist");
    const deletedScheduledTask = await api.deleteScheduledTask({ taskId: scheduledTask.id });
    if (!deletedScheduledTask.removed || (await api.listScheduledTasks({ workspacePath: workspace.path })).some((item) => item.id === scheduledTask.id)) throw new Error("scheduled task delete did not persist");

    await api.recordDiagnostic({ module: "packaged-l5", component: "product-state", operation: "roundtrip", message: "Packaged diagnostic roundtrip", status: "completed", level: "info", kind: "operation" });
    if (!(await api.getDiagnosticSnapshot({ module: "packaged-l5", limit: 20 })).events.some((item) => item.operation === "roundtrip")) throw new Error("diagnostic event did not round-trip through packaged storage");

    const backgroundRequest = { kind: "chat_run" as const, source: "chat" as const, title: "Packaged L5 background lifecycle", workspacePath: workspace.path, targetId: "packaged-l5-background", status: "queued" as const, message: "Queued by the packaged L5 journey.", idempotencyKey: "packaged-l5-background-v1", maxAttempts: 2 };
    const background = await api.enqueueBackgroundTask(backgroundRequest);
    const duplicateBackground = await api.enqueueBackgroundTask(backgroundRequest);
    if (duplicateBackground.id !== background.id) throw new Error("background task idempotency did not return the original task");
    const runningBackground = await api.updateBackgroundTask({ taskId: background.id, status: "running", progress: 25, currentStep: "packaged-ipc", message: "Running through packaged IPC." });
    if (runningBackground.status !== "running" || runningBackground.progress !== 25) throw new Error("background task update did not persist");
    const cancelledBackground = await api.cancelBackgroundTask({ taskId: background.id, reason: "Packaged L5 cancellation check" });
    if (cancelledBackground.status !== "cancelled") throw new Error("background task cancellation did not persist");
    const retriedBackground = await api.retryBackgroundTask({ taskId: background.id, reason: "Packaged L5 retry check" });
    if (retriedBackground.status !== "queued" || retriedBackground.retryOfTaskId !== background.id || retriedBackground.attempt !== 2) throw new Error("background task retry did not create the bounded next attempt");
    if (!(await api.listBackgroundTasks({ workspacePath: workspace.path })).some((item) => item.id === retriedBackground.id)) throw new Error("retried background task was not visible through packaged IPC");
    await api.cancelBackgroundTask({ taskId: retriedBackground.id, reason: "Packaged L5 cleanup" });

    const initialPolicy = await api.getInteractiveDebugPolicy();
    if (initialPolicy.enabled) await api.updateInteractiveDebugPolicy({ enabled: false, acknowledgedRisk: true });
    const enabledPolicy = await api.updateInteractiveDebugPolicy({ enabled: true, acknowledgedRisk: true });
    if (!enabledPolicy.enabled) throw new Error("interactive debug policy did not enable");
    const target = (await api.listInteractiveDebugTargets()).find((item) => item.id === "electron-renderer");
    if (!target?.available) throw new Error("packaged renderer debug target did not become available");
    const debugSession = await api.startInteractiveDebugSession({ targetId: target.id, workspaceId: workspace.id });
    const disconnected = await api.controlInteractiveDebugSession({ sessionId: debugSession.id, action: "disconnect" });
    if (disconnected.state !== "disconnected") throw new Error("packaged debug session did not detach");
    const disabledPolicy = await api.updateInteractiveDebugPolicy({ enabled: false, acknowledgedRisk: true });
    if (disabledPolicy.enabled || (await api.listInteractiveDebugTargets()).some((item) => item.available && item.id !== "electron-main")) throw new Error("interactive debugging did not fail closed after disable");

    return { descriptor, workspaceId: workspace.id, gitApprovalId: gitProposal.approval.id, threadLifecycle: true, chatAbortRecoveryLifecycle: true, chatNetworkRecoveryLifecycle: true, agentCatalogAbortRecoveryLifecycle: true, gitApprovalExecution: true, workspaceGitReviewLifecycle: true, checkpointLifecycle: true, worktreeQueueLifecycle: true, desktopHandoffLifecycle: true, customCommandCrud: true, projectMemoryCrud: true, projectSkillApprovalInstall: true, workflowLifecycle: true, reusableAndScheduledLifecycle: true, diagnosticsRoundtrip: true, backgroundTaskLifecycle: true, interactiveDebuggerRoundtrip: true };
  }

  if (scenario === "crash-ready") {
    await api.upsertUserPreference({ category: "output_language", value: "zh", source: "explicit_user_request" });
    if (!config.workspacePath) throw new Error("crash-ready scenario requires workspacePath");
    const proposal = await api.requestGitCommitApproval({ workspacePath: config.workspacePath, message: "Rejected after packaged crash", body: "This commit must never execute.", requestId: "packaged-l5-crash-approval" });
    if (!proposal.queued || !proposal.approval || proposal.alreadyExecuted) throw new Error("crash-ready git approval did not remain pending");
    return { descriptor, readyForForcedCrash: true, approvalId: proposal.approval.id };
  }

  if (scenario === "fault") {
    if (!config.workspacePath) throw new Error("fault scenario requires workspacePath");
    const rejected: string[] = [];
    try { await api.previewWorkspaceFile({ workspacePath: config.workspacePath, path: "/etc/passwd" }); } catch { rejected.push("workspace-traversal"); }
    try { await api.openExternal("javascript:alert(1)"); } catch { rejected.push("unsafe-url"); }
    try { await api.listCustomCommands({ workspacePath: `${config.workspacePath}/missing` }); } catch { rejected.push("unregistered-workspace"); }
    if (rejected.length !== 3) throw new Error(`fault injection did not fail closed: ${rejected.join(",")}`);
    return { descriptor, rejected, rejectedCount: rejected.length };
  }

  if (scenario === "tcc") {
    const before = await api.getSystemPermissions();
    const microphone = await api.requestSystemPermission("microphone");
    const automation = await api.requestSystemPermission("automation");
    const notifications = await api.requestSystemPermission("notifications");
    const filesSettingsOpened = await api.openSystemPermissionSettings("files");
    const after = await api.getSystemPermissions();
    return { descriptor, before, after, microphone, automation, notifications, filesSettingsOpened };
  }

  if (scenario === "online-update-lab") {
    if (!config.targetVersion) throw new Error("online update lab requires targetVersion");
    const checked = await api.checkForUpdates();
    if (checked.currentVersion === config.targetVersion) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return { descriptor, postUpdateHealthy: true, currentVersion: checked.currentVersion };
    }
    if (!checked.available || checked.version !== config.targetVersion) throw new Error(`signed update ${config.targetVersion} is not available from the lab feed`);
    const downloaded = await api.downloadUpdate();
    if (!downloaded.downloaded || !downloaded.canInstall) throw new Error("signed update did not download and verify");
    const installing = await api.installUpdate();
    if (installing.phase !== "installing") throw new Error("signed update installation did not start");
    return { descriptor, updateInstallRequested: true, fromVersion: checked.currentVersion, toVersion: checked.version };
  }

  const durationMs = Math.max(1_000, Math.min(7_300_000, Number(config.durationMs) || 7_200_000));
  const intervalMs = Math.max(250, Math.min(60_000, Number(config.intervalMs) || 30_000));
  const startedAt = Date.now();
  let heartbeats = 0;
  while (Date.now() - startedAt < durationMs) {
    const [nextDescriptor, preferences] = await Promise.all([api.getPlatformDescriptor(), api.listUserPreferences()]);
    if (nextDescriptor.id !== "macos" || !Array.isArray(preferences)) throw new Error("stability heartbeat returned invalid state");
    heartbeats += 1;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, durationMs - (Date.now() - startedAt))));
  }
  return { descriptor, durationMs: Date.now() - startedAt, heartbeats };
}

async function terminalRoundtrip(api: Window["openDrSai"]): Promise<{ terminal: { id: string; pid: number }; terminalOutput: string }> {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("terminal smoke timed out")), 15_000);
    let output = "";
    let terminal: { id: string; pid: number } | undefined;
    const offData = api.onTerminalData((event) => {
      if (!terminal || event.id !== terminal.id) return;
      output += event.data;
      if (!output.includes("OPENDRSAI_MACOS_PTY_OK")) return;
      clearTimeout(timeout);
      offData();
      resolve({ terminal, terminalOutput: output });
    });
    try {
      terminal = await api.createTerminal({ shellProfile: "zsh", title: "Packaged acceptance", cols: 80, rows: 24 });
      await api.resizeTerminal(terminal.id, 100, 30);
      await api.writeTerminal(terminal.id, "printf 'OPENDRSAI_MACOS_PTY_OK\\n'\\n");
    } catch (error) {
      clearTimeout(timeout);
      offData();
      reject(error);
    }
  });
}
