import { app, powerMonitor, screen, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { connect as connectTcp } from "node:net";
import { getUpdateHealthConfirmation } from "./updater";
import { stopGateway } from "./gateway";
import type { NativeHelperSupervisor } from "./native/nativeHelperSupervisor";
import { clickLatestCompletionNotificationForE2e } from "../../../shared/main/completionNotifications";
import { setPackagedNetworkOnlineForE2e } from "./bootstrap/installAppIntegrations";

type PackagedScenario = "smoke" | "core" | "product-state" | "approval-replay" | "restart" | "fault" | "crash-ready" | "recovery" | "stability" | "performance-ready" | "managed-process-crash" | "system-events" | "sleep-wake" | "tcc" | "online-update-lab" | "ssh-loopback";

interface PackagedScenarioConfig {
  workspacePath?: string;
  workspaceId?: string;
  threadId?: string;
  approvalId?: string;
  remotePort?: number;
  remoteWorkspacePath?: string;
  gatewayArtifacts?: Array<{ version: string; artifactPath: string; artifactSha256: string; artifactPublisher: string; artifactSignature: string; incompatible?: boolean; cancel?: boolean }>;
  restartPhase?: "prepare" | "restore";
  scheduledTaskId?: string;
  scheduledRunId?: string;
  activeChatRequestId?: string;
  activeChatThreadId?: string;
  activeAgentThreadId?: string;
  durationMs?: number;
  intervalMs?: number;
  warmupMs?: number;
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
        : scenario === "system-events"
          ? await runSystemEventsScenario(window)
        : await window.webContents.executeJavaScript(buildScenarioScript(scenario, config), true);
      if (scenario === "ssh-loopback") result = await verifyPackagedSshForward(window, result);
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
      if (scenario === "product-state") {
        // The native protocol deliberately limits Keychain accounts to opaque UUIDs.
        // Exercise the same identifier shape used by the production credential adapter.
        const account = randomUUID();
        const value = `packaged-keychain-${process.pid}`;
        const put = await nativeHelper.request("keychain.put", undefined, { account, service: "ai.drsai.desktop", value });
        const get = await nativeHelper.request("keychain.get", undefined, { account, service: "ai.drsai.desktop" });
        const removed = await nativeHelper.request("keychain.delete", undefined, { account, service: "ai.drsai.desktop" });
        const removedAgain = await nativeHelper.request("keychain.delete", undefined, { account, service: "ai.drsai.desktop" });
        if (put.result?.stored !== true || get.result?.value !== value || removed.result?.deleted !== true || removedAgain.result?.deleted !== false) throw new Error("packaged Native Helper Keychain CRUD/idempotent delete failed");
        if (!clickLatestCompletionNotificationForE2e()) throw new Error("packaged completion notification did not expose a clickable native handle");
        result = { ...(result as object), nativeKeychainLifecycle: true, notificationClickLifecycle: true };
      }
      const updateHealth = scenario === "online-update-lab" && (result as { postUpdateHealthy?: boolean }).postUpdateHealthy
        ? getUpdateHealthConfirmation()
        : undefined;
      if (updateHealth && (!updateHealth.confirmed || updateHealth.version !== config.targetVersion)) throw new Error("updated App did not write its stable health confirmation");
      await writeFile(output, `${JSON.stringify({ ok: true, scenario, ...result, ...(updateHealth ? { updateHealth } : {}) }, null, 2)}\n`, "utf8");
      if (scenario !== "crash-ready" && !(scenario === "online-update-lab" && (result as { updateInstallRequested?: boolean }).updateInstallRequested)) app.quit();
    } catch (error) {
      await writeFile(output, `${JSON.stringify({ ok: false, scenario, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, "utf8").catch(() => undefined);
      await Promise.allSettled([stopGateway(), nativeHelper.stop()]);
      app.exit(1);
    }
  };
  if (window.webContents.isLoading()) window.webContents.once("did-finish-load", () => { void execute(); });
  else queueMicrotask(() => { void execute(); });
}

function normalizeScenario(value: string | undefined): PackagedScenario {
  const scenario = value?.trim() || "smoke";
  if (["smoke", "core", "product-state", "approval-replay", "restart", "fault", "crash-ready", "recovery", "stability", "performance-ready", "managed-process-crash", "system-events", "sleep-wake", "tcc", "online-update-lab", "ssh-loopback"].includes(scenario)) return scenario as PackagedScenario;
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
    const gatewayBefore = await window.webContents.executeJavaScript(`(async () => { const api = window.openDrSai; await api.startInstall({}); const install = await api.getInstallStatus(); if (!install.installed) throw new Error("sleep-wake scenario could not install the bundled Runtime"); await api.startGateway(); for (let attempt = 0; attempt < 60; attempt += 1) { const status = await api.getGatewayStatus(); if (status.ready && status.pid) return status; await new Promise((resolve) => setTimeout(resolve, 1000)); } throw new Error("sleep-wake Gateway was not healthy before interruption"); })()`, true);
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

async function runSystemEventsScenario(window: BrowserWindow): Promise<unknown> {
  const gateway = await window.webContents.executeJavaScript(`(async () => {
    const api = window.openDrSai;
    if (!(await api.startGateway())) throw new Error("system-events could not start Gateway");
    const status = await api.getGatewayStatus();
    if (!status.ready || !status.pid) throw new Error("system-events Gateway was not healthy before interruption");
    return status;
  })()`, true);
  const observation = window.webContents.executeJavaScript(`(() => {
    const api = window.openDrSai;
    return new Promise((resolve, reject) => {
      const events = [];
      const timeout = setTimeout(() => { off(); reject(new Error("system-events did not observe display and network recovery")); }, 10000);
      const off = api.onLifecycleEvent((event) => {
        events.push(event);
        if (events.some((item) => item.reason === "display-change") && events.some((item) => item.reason === "network-online")) {
          clearTimeout(timeout); off(); resolve({ events, displayRecovered: true, networkRecovered: events.some((item) => item.reason === "network-online" && item.recoveredGateway === true) });
        }
      });
    });
  })()`, true) as Promise<{ events: Array<{ reason: string; recoveredGateway: boolean }>; displayRecovered: boolean; networkRecovered: boolean }>;
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    (screen as unknown as NodeJS.EventEmitter).emit("display-metrics-changed");
    setPackagedNetworkOnlineForE2e(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    setPackagedNetworkOnlineForE2e(true);
    const result = await observation;
    if (!result.displayRecovered || !result.networkRecovered) throw new Error(`system-events recovery was incomplete: ${JSON.stringify(result)}`);
    return { gateway, ...result };
  } finally {
    setPackagedNetworkOnlineForE2e(null);
  }
}

function buildScenarioScript(scenario: PackagedScenario, config: PackagedScenarioConfig): string {
  return `(() => { const terminalRoundtrip = ${terminalRoundtrip.toString()}; return (${rendererScenario.toString()})(${JSON.stringify(scenario)}, ${JSON.stringify(config)}); })()`;
}

async function verifyPackagedSshForward(window: BrowserWindow, raw: unknown): Promise<unknown> {
  const result = raw as { restartPhase?: "prepare" | "restore"; hostAlias?: string; workspace?: { id?: string }; worktree?: { workspaceId?: string }; portForward?: { portForwardId?: string; localPort?: number } };
  const id = result.portForward?.portForwardId;
  const port = result.portForward?.localPort;
  if (!id || !Number.isInteger(port)) throw new Error("packaged SSH scenario did not return an active Port Forward");
  const payload = `opendrsai-packaged-ssh-${randomUUID()}`;
  const echoed = await tcpRoundtrip(port!, payload);
  if (echoed !== payload) throw new Error("packaged SSH Port Forward corrupted its TCP payload");
  if (result.restartPhase === "prepare") return { ...result, tcpRoundtrip: true, persistedForRestart: true };
  if (result.restartPhase === "restore") {
    const cleanup = await window.webContents.executeJavaScript(`(async () => { const api = window.openDrSai; const removed = await api.removePortForward(${JSON.stringify(id)}); const workspaceDisconnected = await api.disconnectRemoteWorkspace(${JSON.stringify(result.workspace?.id)}); const disconnected = await api.disconnectSshHost(${JSON.stringify(result.hostAlias)}); return { removed, workspaceDisconnected, disconnected }; })()`, true) as { removed?: boolean; workspaceDisconnected?: boolean; disconnected?: { changed?: boolean } };
    if (!cleanup.removed || !cleanup.workspaceDisconnected || !cleanup.disconnected?.changed) throw new Error("restored packaged SSH resources did not cleanly shut down");
    return { ...result, tcpRoundtrip: true, restoredAfterRestart: true, cleanup: true };
  }
  const cleanup = await window.webContents.executeJavaScript(`(async () => { const api = window.openDrSai; const removed = await api.removePortForward(${JSON.stringify(id)}); const worktreeDisconnected = await api.disconnectRemoteWorkspace(${JSON.stringify(result.worktree?.workspaceId)}); const workspaceDisconnected = await api.disconnectRemoteWorkspace(${JSON.stringify(result.workspace?.id)}); const disconnected = await api.disconnectSshHost(${JSON.stringify(result.hostAlias)}); return { removed, worktreeDisconnected, workspaceDisconnected, disconnected }; })()`, true) as { removed?: boolean; worktreeDisconnected?: boolean; workspaceDisconnected?: boolean; disconnected?: { changed?: boolean } };
  if (!cleanup.removed || !cleanup.worktreeDisconnected || !cleanup.workspaceDisconnected || !cleanup.disconnected?.changed) throw new Error("packaged SSH resources did not cleanly shut down");
  return { ...result, tcpRoundtrip: true, cleanup: true };
}

function tcpRoundtrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: "127.0.0.1", port }); let output = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("packaged SSH Port Forward roundtrip timed out")); }, 5_000);
    socket.setEncoding("utf8");
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(payload));
    socket.on("data", (chunk) => { output += chunk; if (output.length >= payload.length) { clearTimeout(timer); socket.end(); resolve(output); } });
  });
}

async function rendererScenario(scenario: PackagedScenario, config: PackagedScenarioConfig): Promise<unknown> {
  const api = window.openDrSai;
  const descriptor = await api.getPlatformDescriptor();
  if (descriptor.id !== "macos") throw new Error("packaged scenario did not load the macOS platform adapter");

  if (scenario === "performance-ready") return { descriptor, interactive: true };

  if (scenario === "ssh-loopback") {
    const phase = (name: string) => console.info(`[packaged-ssh-loopback] ${name}`);
    if (!config.remotePort || !config.remoteWorkspacePath) throw new Error("ssh-loopback scenario requires remotePort and remoteWorkspacePath");
    if (config.restartPhase === "prepare") {
      const host = (await api.listSshHosts()).find((item) => item.alias === "loopback-opendrsai"); if (!host) throw new Error("restart prepare SSH host is missing");
      if ((await api.diagnoseSshHost(host.alias)).state !== "reachable") throw new Error("restart prepare could not reuse the approved Host Key");
      await api.connectSshHost(host.alias);
      const workspace = await api.connectRemoteWorkspace({ hostAlias: host.alias, path: config.remoteWorkspacePath, name: "Packaged restart Remote Workspace", trusted: true });
      const authorization = { permissionGranted: true as const, approvalId: "approval:00000000-0000-4000-8000-000000000011", operationId: "packaged-restart-forward", correlationId: "packaged-restart-forward" };
      const portForward = await api.createPortForward({ hostAlias: host.alias, workspaceId: workspace.id, remotePort: config.remotePort, reconnectPolicy: "automatic", authorization });
      if (portForward.status !== "active") throw new Error("restart prepare Port Forward was not active");
      return { descriptor, restartPhase: "prepare", hostAlias: host.alias, workspace, portForward };
    }
    if (config.restartPhase === "restore") {
      let portForward; for (let attempt = 0; attempt < 200; attempt += 1) { portForward = (await api.listPortForwards({ hostAlias: "loopback-opendrsai" }))[0]; if (portForward?.status === "active") break; await new Promise((resolve) => setTimeout(resolve, 50)); }
      if (!portForward || portForward.status !== "active") throw new Error("Port Forward Registry did not restore after App restart");
      const workspace = (await api.listWorkspaces()).find((item) => item.id === portForward.workspaceId && item.remote?.hostAlias === "loopback-opendrsai");
      if (!workspace) throw new Error("restored Port Forward lost its Remote Workspace owner");
      let workspaceReady = false; for (let attempt = 0; attempt < 200; attempt += 1) { const status = await api.getRemoteWorkspaceStatus(workspace.id); if (status.connected && status.gatewayReady) { workspaceReady = true; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
      if (!workspaceReady) throw new Error("Remote Workspace did not reconnect after App restart");
      return { descriptor, restartPhase: "restore", hostAlias: "loopback-opendrsai", workspace, portForward };
    }
    phase("inventory");
    const hosts = await api.listSshHosts();
    const host = hosts.find((item) => item.alias === "loopback-opendrsai");
    if (!host) throw new Error("packaged SSH inventory did not resolve the loopback host");
    const beforeApproval = await api.diagnoseSshHost(host.alias);
    if (beforeApproval.state === "reachable") throw new Error("unapproved Host Key unexpectedly allowed packaged SSH access");
    const keys = await api.inspectSshHostKeys(host.alias);
    if (!keys.length || !keys.every((key) => key.fingerprint)) throw new Error("packaged Host Key review did not return fingerprints");
    if (!(await api.approveSshHostKey(host.alias))) throw new Error("packaged Host Key approval failed");
    phase("host-key-approved");
    const afterApproval = await api.diagnoseSshHost(host.alias);
    if (afterApproval.state !== "reachable") throw new Error(`approved packaged SSH host was not reachable: ${afterApproval.state}`);
    const preflight = await api.preflightRemoteGateway(host.alias);
    if (!preflight.pythonVersion || !preflight.operatingSystem || !preflight.architecture || !Array.isArray(preflight.issues)) throw new Error("packaged Remote Gateway preflight was incomplete");
    await api.connectSshHost(host.alias);
    phase("ssh-connected");
    const workspace = await Promise.race([
      api.connectRemoteWorkspace({ hostAlias: host.alias, path: config.remoteWorkspacePath, name: "Packaged Remote Workspace", trusted: true }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("packaged Remote Workspace connect exceeded 45 seconds")), 45_000)),
    ]);
    phase("workspace-connected");
    const workspaceStatus = await api.getRemoteWorkspaceStatus(workspace.id);
    if (!workspaceStatus.connected || !workspaceStatus.gatewayReady || !workspaceStatus.runtimeId || !workspaceStatus.instanceId) throw new Error("packaged Remote Workspace handshake was incomplete");
    const localGatewayBeforeMobile = await api.getGatewayStatus();
    const mobileReadiness = await api.getMobilePairingReadiness({ workspaceId: workspace.id, workspacePath: workspace.path });
    const localGatewayAfterMobile = await api.getGatewayStatus();
    if (mobileReadiness.gateway_runtime_id !== workspaceStatus.runtimeId) throw new Error("mobile pairing did not target the selected Remote Workspace Runtime");
    if (localGatewayBeforeMobile.ready || localGatewayAfterMobile.ready) throw new Error("remote mobile pairing unexpectedly started or used the local Runtime");
    const files = await api.listWorkspaceFiles({ workspacePath: workspace.path, workspaceId: workspace.id, maxDepth: 2 });
    if (!files.nodes.some((node) => node.relativePath === "remote.txt")) throw new Error("packaged Remote Workspace file tree omitted remote.txt");
    const preview = await api.previewWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (preview.content !== "packaged remote workspace\n") throw new Error(`packaged Remote Workspace preview was invalid: ${JSON.stringify(preview)}`);
    if (!preview.fileHash) throw new Error("packaged Remote Workspace preview omitted its concurrency hash");
    const externalWrite = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "packaged external update\n", expectedHash: "", mode: "overwrite" });
    if (externalWrite.status !== "saved") throw new Error("packaged Remote Workspace external-update fixture failed");
    const conflict = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "stale desktop update\n", expectedHash: preview.fileHash });
    if (conflict.status !== "conflict" || !conflict.currentHash || conflict.currentHash === preview.fileHash) throw new Error(`packaged Remote Workspace did not reject a stale file write: ${JSON.stringify(conflict)}`);
    const saved = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "packaged remote workspace updated\n", expectedHash: "", mode: "overwrite" });
    if (saved.status !== "saved") throw new Error(`packaged Remote Workspace write failed: ${saved.status}`);
    const git = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (!git.diff.includes("packaged remote workspace updated")) throw new Error("packaged Remote Workspace Git diff omitted the remote change");
    if (!git.diffHash) throw new Error("packaged Remote Workspace Git diff omitted its review hash");
    const staged = await api.stageWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, expectedDiffHash: git.diffHash });
    if (!staged.staged) throw new Error("packaged Remote Workspace Git stage failed");
    const stagedDiff = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, staged: true });
    if (!stagedDiff.diff.includes("packaged remote workspace updated")) throw new Error("packaged Remote Workspace staged diff omitted the reviewed change");
    const commitProposal = await api.requestGitCommitApproval({ workspacePath: workspace.path, message: "Packaged remote approved commit", requestId: "packaged-remote-approved-commit" });
    if (!commitProposal.queued || !commitProposal.approval || !(await api.decideApproval({ id: commitProposal.approval.id, approved: true }))) throw new Error("packaged Remote Workspace Git commit approval failed");
    const afterCommit = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (afterCommit.diff) throw new Error("packaged Remote Workspace Git commit left an unstaged diff");
    const revertCandidate = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "packaged remote revert candidate\n", expectedHash: "", mode: "overwrite" });
    if (revertCandidate.status !== "saved") throw new Error("packaged Remote Workspace revert candidate write failed");
    const revertDiff = await api.getWorkspaceGitDiff({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (!revertDiff.diffHash) throw new Error("packaged Remote Workspace revert review hash is missing");
    const reverted = await api.revertWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, expectedDiffHash: revertDiff.diffHash });
    if (!reverted.reverted) throw new Error("packaged Remote Workspace Git revert failed");
    const afterRevert = await api.previewWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (afterRevert.content !== "packaged remote workspace updated\n") throw new Error("packaged Remote Workspace Git revert did not restore committed content");
    const checkpointBaseline = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "packaged remote checkpoint baseline\n", expectedHash: "", mode: "overwrite" });
    if (checkpointBaseline.status !== "saved") throw new Error("packaged Remote Workspace checkpoint baseline write failed");
    const threads = await api.listRemoteThreads(workspace.id);
    if (!Array.isArray(threads)) throw new Error("packaged Remote Workspace Thread listing failed");
    const auth = await api.login({ developerBypass: true, rememberMe: false });
    if (!auth.ok || auth.session?.user?.id !== "packaged-l5-user") throw new Error("packaged Remote Thread fixture did not establish its isolated identity");
    const remoteChatRequestId = "packaged_chat_recovery_001";
    const remoteChatThreadId = "packaged-remote-chat-thread-001";
    const remoteChatEvents: Array<{ type: string; content?: string }> = [];
    let resolveRemoteChat: ((type: string) => void) | undefined;
    const remoteChatTerminal = new Promise<string>((resolve) => { resolveRemoteChat = resolve; });
    const offRemoteChat = api.onChatEvent((event) => {
      if (event.requestId !== remoteChatRequestId) return;
      remoteChatEvents.push({ type: event.type, content: event.content });
      if (event.type === "done" || event.type === "error" || event.type === "aborted") resolveRemoteChat?.(event.type);
    });
    const startedRemoteChat = await api.startChat({ requestId: remoteChatRequestId, threadId: remoteChatThreadId, sessionId: remoteChatThreadId, runId: "packaged-remote-chat-run-001", agentId: "my-drsai", workspacePath: workspace.path, workspaceId: workspace.id, metadata: { packaged_recovery_fixture: true }, messages: [{ role: "user", content: "Find packaged remote thread marker." }] });
    if (startedRemoteChat !== remoteChatRequestId) throw new Error("packaged Remote Thread chat returned the wrong request identity");
    const remoteChatTerminalType = await Promise.race([remoteChatTerminal, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("packaged Remote Thread chat timed out")), 20_000))]);
    offRemoteChat();
    if (remoteChatTerminalType !== "done" || !remoteChatEvents.some((event) => event.type === "chunk" && event.content?.includes("beta"))) throw new Error("packaged Remote Thread stream did not recover to a completed response");
    const remoteThread = (await api.listThreads()).find((thread) => thread.id === remoteChatThreadId);
    if (!remoteThread?.runtimeSessionId) throw new Error("packaged Remote Thread did not persist its Runtime Session identity");
    const remoteSnapshot = await api.getThreadSnapshot(remoteChatThreadId);
    if (!remoteSnapshot?.messages.some((message) => message.content.includes("beta"))) throw new Error("packaged Remote Thread snapshot omitted the remote response");
    const remoteSearch = await api.searchThreadMessages({ query: "beta", threadIds: [remoteChatThreadId], limit: 5 });
    if (!remoteSearch.some((item) => item.threadId === remoteChatThreadId)) throw new Error("packaged Remote Thread search omitted the remote Runtime result");
    let resolveSnapshotEvent: (() => void) | undefined;
    const snapshotEvent = new Promise<void>((resolve) => { resolveSnapshotEvent = resolve; });
    const offSnapshot = api.onThreadSnapshot((event) => { if (event.threadId === remoteChatThreadId && event.snapshot.messages.some((message) => message.content.includes("beta"))) resolveSnapshotEvent?.(); });
    if (!(await api.subscribeThreadSnapshot(remoteChatThreadId))) throw new Error("packaged Remote Thread live subscription was rejected");
    await Promise.race([snapshotEvent, new Promise<void>((_, reject) => setTimeout(() => reject(new Error("packaged Remote Thread live snapshot timed out")), 10_000))]);
    if (!(await api.unsubscribeThreadSnapshot(remoteChatThreadId))) throw new Error("packaged Remote Thread live subscription did not stop");
    offSnapshot();
    const checkpoint = await api.createWorkspaceCheckpoint({ workspacePath: workspace.path, workspaceId: workspace.id, label: "Packaged remote checkpoint" });
    if (!checkpoint.id || checkpoint.changedFileCount < 1) throw new Error("packaged Remote Workspace checkpoint did not capture the changed file");
    const changedAgain = await api.writeWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt`, content: "packaged remote workspace after checkpoint\n", expectedHash: "", mode: "overwrite" });
    if (changedAgain.status !== "saved") throw new Error("packaged Remote Workspace post-checkpoint write failed");
    const checkpointPreview = await api.previewWorkspaceCheckpoint({ workspacePath: workspace.path, workspaceId: workspace.id, checkpointId: checkpoint.id });
    if (checkpointPreview.changedEntryCount < 1) throw new Error("packaged Remote Workspace checkpoint preview omitted the changed file");
    const queuedRestore = await api.restoreWorkspaceCheckpoint({ workspacePath: workspace.path, workspaceId: workspace.id, checkpointId: checkpoint.id, operationId: "packaged-remote-checkpoint-restore" });
    if (!queuedRestore.approvalQueued || !queuedRestore.approvalId || !(await api.decideApproval({ id: queuedRestore.approvalId, approved: true }))) throw new Error("packaged Remote Workspace checkpoint restore approval failed");
    const restoredPreview = await api.previewWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/remote.txt` });
    if (restoredPreview.content !== "packaged remote checkpoint baseline\n") throw new Error("packaged Remote Workspace checkpoint did not restore content");
    const worktree = await api.prepareForkWorktree({ workspacePath: workspace.path, intent: "packaged remote worktree" });
    if (worktree.location !== "remote" || worktree.transport !== "ssh" || !worktree.workspaceId || !worktree.worktreePath) throw new Error("packaged remote Worktree did not inherit the SSH Runtime");
    const worktreeFiles = await api.listWorkspaceFiles({ workspacePath: worktree.worktreePath, workspaceId: worktree.workspaceId, maxDepth: 2 });
    if (!worktreeFiles.nodes.some((node) => node.relativePath === "remote.txt")) throw new Error("packaged remote Worktree files were unavailable through the parent Runtime");
    const authorization = { permissionGranted: true as const, approvalId: "approval:00000000-0000-4000-8000-000000000008", operationId: "packaged-ssh-forward", correlationId: "packaged-ssh-forward" };
    const created = await api.createPortForward({ hostAlias: host.alias, workspaceId: workspace.id, remotePort: config.remotePort, reconnectPolicy: "automatic", authorization });
    if (created.status !== "active") throw new Error(`packaged Port Forward was not active: ${created.status}`);
    const paused = await api.pausePortForward(created.portForwardId);
    if (paused.status !== "paused") throw new Error("packaged Port Forward did not pause");
    const resumed = await api.resumePortForward(created.portForwardId);
    if (resumed.status !== "active") throw new Error("packaged Port Forward did not resume");
    const artifactResults: Array<{ version: string; outcome: string }> = [];
    const installArtifact = async (artifact: NonNullable<PackagedScenarioConfig["gatewayArtifacts"]>[number], action: "install" | "upgrade") => {
      const proposal = await api.requestRemoteGatewayInstallApproval({ hostAlias: host.alias, action, version: artifact.version, artifactPath: artifact.artifactPath, artifactSha256: artifact.artifactSha256, artifactPublisher: artifact.artifactPublisher, artifactSignature: artifact.artifactSignature });
      if (!proposal.queued || !proposal.approval) throw new Error(`Remote Gateway ${action} did not stop at Approval Center`);
      if (artifact.cancel) {
        const events: Array<{ state: string; phase: string }> = []; const unsubscribe = api.onRemoteGatewayOperation((event) => events.push(event));
        const decision = api.decideApproval({ id: proposal.approval.id, approved: true });
        for (let attempt = 0; attempt < 100 && !events.some((event) => event.state === "running"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        if (!(await api.cancelRemoteGatewayOperation(host.alias))) throw new Error("active Remote Gateway transaction could not be cancelled");
        let rejected = false; try { await decision; } catch { rejected = true; } finally { unsubscribe(); }
        if (!rejected || !events.some((event) => event.state === "cancelled")) throw new Error("cancelled Remote Gateway transaction did not fail closed");
        artifactResults.push({ version: artifact.version, outcome: "cancelled" }); return;
      }
      let rejected = false; try { await api.decideApproval({ id: proposal.approval.id, approved: true }); } catch { rejected = true; }
      if (artifact.incompatible) { if (!rejected) throw new Error("incompatible Remote Gateway artifact was accepted"); artifactResults.push({ version: artifact.version, outcome: "rejected" }); return; }
      if (rejected) throw new Error(`Remote Gateway ${action} failed`);
      artifactResults.push({ version: artifact.version, outcome: "installed" });
    };
    const artifacts = config.gatewayArtifacts ?? [];
    if (artifacts.length) {
      await installArtifact(artifacts[0], "install");
      await installArtifact(artifacts[1], "upgrade");
      const upgraded = await api.preflightRemoteGateway(host.alias);
      if (upgraded.currentRelease !== artifacts[1].version || upgraded.previousRelease !== artifacts[0].version) throw new Error("Remote Gateway upgrade did not preserve the previous release");
      await installArtifact(artifacts[2], "upgrade");
      const afterFailure = await api.preflightRemoteGateway(host.alias);
      if (afterFailure.currentRelease !== artifacts[1].version) throw new Error("failed Remote Gateway upgrade damaged current release");
      await installArtifact(artifacts[3], "upgrade");
      const afterCancel = await api.preflightRemoteGateway(host.alias);
      if (afterCancel.currentRelease !== artifacts[1].version) throw new Error("cancelled Remote Gateway upgrade damaged current release");
      const rollback = await api.requestRemoteGatewayInstallApproval({ hostAlias: host.alias, action: "rollback" });
      if (!rollback.queued || !rollback.approval || !(await api.decideApproval({ id: rollback.approval.id, approved: true }))) throw new Error("Remote Gateway rollback approval failed");
      const rolledBack = await api.preflightRemoteGateway(host.alias);
      if (rolledBack.currentRelease !== artifacts[0].version || rolledBack.previousRelease !== artifacts[1].version) throw new Error("Remote Gateway rollback state is invalid");
    }
    phase("journey-complete");
    return { descriptor, hostAlias: host.alias, beforeApproval, afterApproval, preflight, workspace, worktree, workspaceStatus, mobileReadiness, mobileSameRuntime: true, fileTree: true, filePreview: true, fileConflict: true, fileWrite: true, gitDiff: true, gitStageRevertCommitApproval: true, threadList: true, remoteThreadStreamSnapshotSearch: true, checkpointLifecycle: true, remoteWorktreeLifecycle: true, gatewayInstallMatrix: artifacts.length === 4, artifactResults, hostKeyCount: keys.length, portForward: resumed };
  }

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
    if (scenario === "restart" && config.scheduledTaskId) {
      if (!config.workspacePath || !(await api.listScheduledTasks({ workspacePath: config.workspacePath })).some((item) => item.id === config.scheduledTaskId && item.status === "paused")) throw new Error("paused scheduled task was lost across process restart");
      if (!config.scheduledRunId || !(await api.listWorkflowRuns(config.workspacePath)).some((item) => item.id === config.scheduledRunId)) throw new Error("scheduled Workflow run was lost across process restart");
    }
    let activeRunsRecovered = false;
    if (scenario === "recovery" && config.activeChatRequestId && config.activeChatThreadId && config.activeAgentThreadId) {
      const recoveredChat = await api.recoverChatRun({ requestId: config.activeChatRequestId, sessionId: config.activeChatThreadId });
      const recoveredChatContent = recoveredChat.filter((item) => item.type === "chunk").map((item) => item.content ?? "").join("");
      const recoveredAgent = await api.recoverAgentRun(config.activeAgentThreadId);
      if (recoveredChatContent !== "preserved before crash" || !recoveredChat.some((item) => item.type === "error") || recoveredChat.some((item) => item.type === "done") || !recoveredAgent.some((item) => item.type === "start") || !recoveredAgent.some((item) => item.type === "error" && /interrupted/i.test(item.error ?? "")) || recoveredAgent.some((item) => item.type === "done")) throw new Error("active Chat/Agent runs were not recovered into explicit reviewable terminal states after forced App crash");
      activeRunsRecovered = true;
    }
    if (scenario === "recovery" && config.approvalId) {
      const pending = await api.listPendingApprovals();
      if (!pending.some((item) => item.id === config.approvalId && item.source === "git")) throw new Error("pending git approval was lost across forced restart");
      if (!(await api.decideApproval({ id: config.approvalId, approved: false, reason: "reject" }))) throw new Error("recovered git approval could not be rejected");
      if ((await api.listPendingApprovals()).some((item) => item.id === config.approvalId)) throw new Error("rejected recovered approval remained pending");
      return { descriptor, threadId: config.threadId, threadRecovered: true, preferenceRecovered: true, approvalRecoveredRejected: true, activeRunsRecovered };
    }
    return { descriptor, threadId: config.threadId, threadRecovered: true, preferenceRecovered: true, scheduledTaskRecovered: Boolean(config.scheduledTaskId) };
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
    const acceptedLateChatInput = await api.respondChatInput(chatRequestId, "late input");
    if (!recoveredChat.some((item) => item.type === "start") || !recoveredChat.some((item) => item.type === "aborted") || new Set(recoveredChat.map((item) => item.seq)).size !== recoveredChat.length || acceptedLateChatInput) {
      throw new Error(`cancelled Chat did not recover an ordered deduplicated journal or rejected late input: ${JSON.stringify({ events: recoveredChat.map((item) => ({ type: item.type, seq: item.seq, runId: item.runId })), acceptedLateChatInput })}`);
    }

    const recoveryChatRequestId = "packaged_chat_recovery_001";
    const recoveryChatThreadId = "packaged-chat-recovery-thread-001";
    const recoveryChatEvents: Array<{ type: string; content?: string; error?: string; connection?: string; seq?: number }> = [];
    let resolveRecoveryChatTerminal: ((type: string) => void) | undefined;
    const recoveryChatTerminal = new Promise<string>((resolve) => { resolveRecoveryChatTerminal = resolve; });
    const offRecoveryChat = api.onChatEvent((event) => {
      if (event.requestId !== recoveryChatRequestId) return;
      recoveryChatEvents.push({ type: event.type, content: event.content, error: event.error, connection: event.connection?.status, seq: event.seq });
      if (event.type === "done" || event.type === "error" || event.type === "aborted") resolveRecoveryChatTerminal?.(event.type);
    });
    const startedRecoveryChat = await api.startChat({ requestId: recoveryChatRequestId, threadId: recoveryChatThreadId, sessionId: recoveryChatThreadId, runId: "packaged-chat-recovery-run-001", agentId: "my-drsai", workspacePath: workspace.path, metadata: { packaged_recovery_fixture: true }, messages: [{ role: "user", content: "Exercise the packaged incomplete SSE recovery fixture." }] });
    if (startedRecoveryChat !== recoveryChatRequestId) throw new Error("packaged recovery Chat returned the wrong request identity");
    const recoveryChatTerminalType = await Promise.race([recoveryChatTerminal, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("packaged Chat reconnect timed out")), 15_000))]);
    offRecoveryChat();
    const liveRecoveryContent = recoveryChatEvents.filter((item) => item.type === "chunk").map((item) => item.content ?? "").join("");
    if (recoveryChatTerminalType !== "done" || !recoveryChatEvents.some((item) => item.type === "connection" && item.connection === "retrying") || !recoveryChatEvents.some((item) => item.type === "connection" && item.connection === "restored") || liveRecoveryContent !== "alpha beta" || (liveRecoveryContent.match(/alpha/g) ?? []).length !== 1 || recoveryChatEvents.some((item, index) => index > 0 && Number(item.seq) <= Number(recoveryChatEvents[index - 1]?.seq))) throw new Error(`packaged Chat did not reconnect with a monotonic duplicate-free resumed stream: ${JSON.stringify({ terminal: recoveryChatTerminalType, content: liveRecoveryContent, events: recoveryChatEvents })}`);
    let recoveredNetworkChat: Awaited<ReturnType<typeof api.recoverChatRun>> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      recoveredNetworkChat = await api.recoverChatRun({ requestId: recoveryChatRequestId, sessionId: recoveryChatThreadId });
      if (recoveredNetworkChat.some((item) => item.type === "done")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const recoveredNetworkContent = recoveredNetworkChat.filter((item) => item.type === "chunk").map((item) => item.content ?? "").join("");
    if (!recoveredNetworkChat.some((item) => item.type === "connection" && item.connection?.status === "retrying") || !recoveredNetworkChat.some((item) => item.type === "connection" && item.connection?.status === "restored") || !recoveredNetworkChat.some((item) => item.type === "done") || recoveredNetworkContent !== "alpha beta" || (recoveredNetworkContent.match(/alpha/g) ?? []).length !== 1 || new Set(recoveredNetworkChat.map((item) => item.seq)).size !== recoveredNetworkChat.length) throw new Error(`recovered Chat journal lost reconnect state or reintroduced replayed content: ${JSON.stringify({ content: recoveredNetworkContent, events: recoveredNetworkChat.map((item) => ({ type: item.type, seq: item.seq, content: item.content, connection: item.connection?.status })) })}`);

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

    const scheduledTask = await api.createScheduledTask({ kind: "scheduled", title: "Packaged L5 due task", cadence: "hourly", target: "Review packaged workflow state", workspacePath: workspace.path, workflowTemplateId: digestTemplate.id, nextRunAt: "2020-01-01T00:00:00.000Z", approvalRequired: false, verification: "The bound Workflow must start once and survive restart.", message: "Packaged scheduled task fixture." });
    if (!(await api.listScheduledTasks({ workspacePath: workspace.path })).some((item) => item.id === scheduledTask.id)) throw new Error("scheduled task did not persist through packaged IPC");
    const dueResult = await api.runDueScheduledTasks({ workspacePath: workspace.path, now: "2020-01-01T01:00:00.000Z" });
    const scheduledRun = dueResult.runs.find((item) => dueResult.items.some((result) => result.taskId === scheduledTask.id && result.status === "started" && result.workflowRunId === item.id));
    if (dueResult.triggered !== 1 || !scheduledRun) throw new Error("bound due task did not start exactly one Workflow run");
    const duplicateDueResult = await api.runDueScheduledTasks({ workspacePath: workspace.path, now: "2020-01-01T01:00:00.000Z" });
    if (duplicateDueResult.items.some((item) => item.taskId === scheduledTask.id) || (await api.listWorkflowRuns(workspace.path)).filter((item) => item.id === scheduledRun.id).length !== 1) throw new Error("scheduled task repeated the same due occurrence");
    const pausedScheduledTask = await api.updateScheduledTask({ taskId: scheduledTask.id, status: "paused", message: "Paused after packaged due check." });
    if (pausedScheduledTask.status !== "paused") throw new Error("scheduled task pause did not persist");

    const presentationSourcePath = `${workspace.path}/presentation-source.pdf`;
    const presentationEvents: Array<{ requestId: string; phase: string }> = [];
    const offPresentation = api.onManagerPresentationProgress((event) => { presentationEvents.push({ requestId: event.requestId, phase: event.phase }); });
    const waitForPresentationPhase = async (requestId: string, phases: string[], timeoutMs = 30_000): Promise<string> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = presentationEvents.findLast((event) => event.requestId === requestId && phases.includes(event.phase));
        if (found) return found.phase;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`presentation ${requestId} did not reach ${phases.join("/")}`);
    };
    try {
      const cancelRequestId = "packaged-l5-presentation-cancel";
      const cancelledGeneration = api.generateManagerPresentation({ requestId: cancelRequestId, workspacePath: workspace.path, sourcePath: presentationSourcePath, audience: "non_expert_managers" });
      await waitForPresentationPhase(cancelRequestId, ["analyzing"]);
      if (!(await api.pauseManagerPresentation({ requestId: cancelRequestId })).accepted) throw new Error("packaged presentation pause was not accepted");
      await waitForPresentationPhase(cancelRequestId, ["paused"]);
      const pausedRecovery = await api.getManagerPresentationRecovery({ workspacePath: workspace.path, sourcePath: presentationSourcePath });
      if (pausedRecovery?.requestId !== cancelRequestId || pausedRecovery.phase !== "paused") throw new Error("packaged presentation pause was not recoverable");
      if (!(await api.resumeManagerPresentation({ requestId: cancelRequestId })).accepted) throw new Error("packaged presentation resume was not accepted");
      await waitForPresentationPhase(cancelRequestId, ["resuming", "analyzing"]);
      if (!(await api.cancelManagerPresentation({ requestId: cancelRequestId })).accepted) throw new Error("packaged presentation cancel was not accepted");
      let cancellationRejected = false;
      try { await cancelledGeneration; } catch { cancellationRejected = true; }
      if (!cancellationRejected || await waitForPresentationPhase(cancelRequestId, ["cancelled"]) !== "cancelled") throw new Error("packaged presentation cancellation did not cleanly reject and publish cancellation");

      const retryRequestId = "packaged-l5-presentation-failure";
      let failed = false;
      try { await api.generateManagerPresentation({ requestId: retryRequestId, workspacePath: workspace.path, sourcePath: presentationSourcePath, audience: "non_expert_managers", requirements: ["Preserve source evidence."] }); } catch { failed = true; }
      if (!failed || await waitForPresentationPhase(retryRequestId, ["failed"]) !== "failed") throw new Error("packaged presentation failure did not publish its retryable terminal state");
      const retriedPresentation = await api.generateManagerPresentation({ requestId: retryRequestId, workspacePath: workspace.path, sourcePath: presentationSourcePath, audience: "non_expert_managers", requirements: ["Preserve source evidence."] });
      if (!retriedPresentation.quality.ok || retriedPresentation.slideCount < 6 || retriedPresentation.sourcePageCoverage !== 1 || retriedPresentation.speakerNotesCoverage !== 1) throw new Error("packaged presentation retry did not produce a verified editable deck");
    } finally { offPresentation(); }

    await api.recordDiagnostic({ module: "packaged-l5", component: "product-state", operation: "roundtrip", message: "Packaged diagnostic roundtrip", status: "completed", level: "info", kind: "operation" });
    if (!(await api.getDiagnosticSnapshot({ module: "packaged-l5", limit: 20 })).events.some((item) => item.operation === "roundtrip")) throw new Error("diagnostic event did not round-trip through packaged storage");
    const diagnosticSource = await api.getDiagnosticSourceContext({ source: { file: handoffSourcePath, line: 1, column: 1, language: "typescript" }, workspaceId: workspace.id, contextLines: 2 });
    if (!diagnosticSource.available || !diagnosticSource.canOpen || diagnosticSource.location.file !== handoffSourcePath || !diagnosticSource.content?.includes("packagedHandoff")) throw new Error("diagnostic source navigation did not resolve the packaged Workspace source");
    const diagnosticPackage = await api.previewDiagnosticPackage();
    if (!diagnosticPackage.encrypted || diagnosticPackage.eventCount < 1 || !/^[a-f0-9]{64}$/.test(diagnosticPackage.integritySha256)) throw new Error("production diagnostic package preview was not encrypted or integrity-bound");

    await api.setCompletionNotificationPreference({ enabled: true, language: "zh" });
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
    await api.updateBackgroundTask({ taskId: retriedBackground.id, status: "running", progress: 75, currentStep: "packaged-retry", message: "Retry is running through packaged IPC." });
    const completedBackground = await api.updateBackgroundTask({ taskId: retriedBackground.id, status: "completed", progress: 100, currentStep: "completed", message: "Packaged retry completed." });
    if (completedBackground.status !== "completed" || completedBackground.progress !== 100) throw new Error("retried background task did not complete through packaged IPC");

    const shareInspection = await api.inspectShare({ sourceTaskId: completedReusableSource.id, scope: "result_only", artifactId: "packaged-reusable-output" });
    if (shareInspection.requiresResolution || shareInspection.scannedArtifactCount !== 1) throw new Error("packaged result share inspection did not produce a clean single-artifact review");
    const share = await api.createShare({ sourceTaskId: completedReusableSource.id, scope: "result_only", artifactId: "packaged-reusable-output", recipientAccount: "packaged-recipient@example.test", permission: "view" });
    const shareArtifact = share.objects.find((item) => item.objectType === "artifact");
    if (!shareArtifact || share.version !== 1 || share.permission !== "view" || !(await api.listOutgoingShares()).some((item) => item.id === share.id)) throw new Error("packaged result share did not persist its first immutable version");
    let ownerOpenRejected = false; let ownerDownloadRejected = false;
    try { await api.openSharedObject({ shareId: share.id, objectType: "artifact", objectId: shareArtifact.objectId }); } catch { ownerOpenRejected = true; }
    try { await api.downloadSharedArtifact({ shareId: share.id, objectId: shareArtifact.objectId }); } catch { ownerDownloadRejected = true; }
    if (!ownerOpenRejected || !ownerDownloadRejected) throw new Error("packaged share owner bypassed recipient-only object access");
    const shareSourcePreview = await api.previewWorkspaceFile({ workspacePath: workspace.path, path: `${workspace.path}/reusable-output.md` });
    if (!shareSourcePreview.fileHash || (await api.writeWorkspaceFile({ workspacePath: workspace.path, path: `${workspace.path}/reusable-output.md`, content: "# Packaged reusable result v2\n", expectedHash: shareSourcePreview.fileHash })).status !== "saved") throw new Error("packaged share source could not advance to a second version");
    const versionInspection = await api.inspectShareVersion({ shareId: share.id });
    if (!versionInspection.hasChanges || versionInspection.nextVersion !== 2 || versionInspection.sourceFingerprints.length !== 1) throw new Error("packaged share did not detect its changed source artifact");
    const publishedVersion = await api.publishShareVersion({ shareId: share.id, expectedVersion: 1, sourceFingerprints: versionInspection.sourceFingerprints });
    if (publishedVersion.currentVersion !== 2 || publishedVersion.manifest.objects.some((item) => item.version !== 2)) throw new Error("packaged share did not atomically publish version two");
    const revokedShare = await api.revokeShare({ shareId: share.id, confirmation: "REVOKE" });
    if (revokedShare.status !== "revoked" || revokedShare.objectsInvalidated !== 1) throw new Error("packaged share revocation did not invalidate its artifact");
    let revokedOpenRejected = false;
    try { await api.openSharedObject({ shareId: share.id, objectType: "artifact", objectId: shareArtifact.objectId }); } catch { revokedOpenRejected = true; }
    if (!revokedOpenRejected) throw new Error("revoked packaged share remained readable");

    const initialPolicy = await api.getInteractiveDebugPolicy();
    if (initialPolicy.enabled) await api.updateInteractiveDebugPolicy({ enabled: false, acknowledgedRisk: true });
    const enabledPolicy = await api.updateInteractiveDebugPolicy({ enabled: true, acknowledgedRisk: true });
    if (!enabledPolicy.enabled) throw new Error("interactive debug policy did not enable");
    const target = (await api.listInteractiveDebugTargets()).find((item) => item.id === "electron-renderer");
    if (!target?.available) throw new Error("packaged renderer debug target did not become available");
    const debugSession = await api.startInteractiveDebugSession({ targetId: target.id, workspaceId: workspace.id });
    const breakpointSession = await api.setInteractiveDebugBreakpoint({ sessionId: debugSession.id, source: { file: handoffSourcePath, line: 1, column: 1, language: "typescript" }, condition: "true" });
    if (!breakpointSession.breakpoints.some((item) => item.source.file === handoffSourcePath && item.source.line === 1)) throw new Error("packaged CDP session did not retain its Workspace breakpoint");
    const disconnected = await api.controlInteractiveDebugSession({ sessionId: debugSession.id, action: "disconnect" });
    if (disconnected.state !== "disconnected") throw new Error("packaged debug session did not detach");
    const pythonTarget = (await api.listInteractiveDebugTargets()).find((item) => item.id === "python-local");
    if (!pythonTarget?.available) throw new Error(`packaged Python DAP target was unavailable: ${pythonTarget?.reason ?? "missing"}`);
    const pythonProgram = `${workspace.path}/debug-target.py`;
    const pythonSession = await api.startInteractiveDebugSession({ targetId: pythonTarget.id, workspaceId: workspace.id, program: pythonProgram, cwd: workspace.path, stopOnEntry: true });
    const waitForPythonPause = async (line?: number): Promise<Awaited<ReturnType<typeof api.listInteractiveDebugSessions>>[number]> => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const current = (await api.listInteractiveDebugSessions()).find((item) => item.id === pythonSession.id);
        if (current?.state === "paused" && (!line || current.stackFrames.some((frame) => frame.source?.file === pythonProgram && frame.source.line === line))) return current;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`packaged Python DAP session did not pause${line ? ` at line ${line}` : " on entry"}`);
    };
    const entryPause = await waitForPythonPause();
    const pythonBreakpoint = await api.setInteractiveDebugBreakpoint({ sessionId: pythonSession.id, source: { file: pythonProgram, line: 4, column: 1, language: "python" } });
    if (!pythonBreakpoint.breakpoints.some((item) => item.source.file === pythonProgram && item.source.line === 4 && item.verified)) throw new Error("packaged Python DAP breakpoint was not verified");
    await api.controlInteractiveDebugSession({ sessionId: pythonSession.id, action: "continue", threadId: entryPause.activeThreadId });
    const breakpointPause = await waitForPythonPause(4);
    const frame = breakpointPause.stackFrames.find((item) => item.source?.file === pythonProgram && item.source.line === 4);
    if (!frame) throw new Error("packaged Python DAP breakpoint did not expose its stack frame");
    const scopes = await api.getInteractiveDebugScopes(pythonSession.id, frame.id);
    const localScope = scopes.find((item) => /local/i.test(item.name)) ?? scopes[0];
    if (!localScope) throw new Error("packaged Python DAP did not expose scopes");
    const variables = await api.getInteractiveDebugVariables(pythonSession.id, localScope.variablesReference);
    if (!variables.some((item) => item.name === "value" && item.value === "41") || !variables.some((item) => item.name === "secret_token" && item.value === "[REDACTED]")) throw new Error("packaged Python DAP variables were incomplete or leaked a secret");
    const evaluated = await api.evaluateInteractiveDebugExpression({ sessionId: pythonSession.id, frameId: frame.id, expression: "value + 1" });
    if (!evaluated.safe || evaluated.result !== "42") throw new Error("packaged Python DAP read-only evaluation failed");
    const terminatedPython = await api.controlInteractiveDebugSession({ sessionId: pythonSession.id, action: "terminate", threadId: breakpointPause.activeThreadId });
    if (terminatedPython.state !== "disconnected") throw new Error("packaged Python DAP session did not terminate cleanly");
    const errorProgram = `${workspace.path}/debug-error.py`;
    const failedPythonSession = await api.startInteractiveDebugSession({ targetId: pythonTarget.id, workspaceId: workspace.id, program: errorProgram, cwd: workspace.path });
    const failedDeadline = Date.now() + 15_000;
    let observedFailedPython: Awaited<ReturnType<typeof api.listInteractiveDebugSessions>>[number] | undefined;
    while (Date.now() < failedDeadline) {
      observedFailedPython = (await api.listInteractiveDebugSessions()).find((item) => item.id === failedPythonSession.id);
      if (observedFailedPython?.state === "stopped") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (observedFailedPython?.state !== "stopped" || !/terminated|exited/i.test(observedFailedPython.message)) throw new Error("packaged Python DAP did not surface abnormal debuggee exit");
    if ((await api.controlInteractiveDebugSession({ sessionId: failedPythonSession.id, action: "disconnect" })).state !== "disconnected") throw new Error("packaged failed Python DAP adapter did not detach");
    const disabledPolicy = await api.updateInteractiveDebugPolicy({ enabled: false, acknowledgedRisk: true });
    if (disabledPolicy.enabled || (await api.listInteractiveDebugTargets()).some((item) => item.available && item.id !== "electron-main")) throw new Error("interactive debugging did not fail closed after disable");
    if (!(await api.stopGateway())) throw new Error("packaged product journey could not stop its managed Gateway");
    if ((await api.getGatewayStatus()).ready) throw new Error("packaged product journey Gateway remained healthy after explicit stop");

    return { descriptor, workspaceId: workspace.id, scheduledTaskId: scheduledTask.id, scheduledRunId: scheduledRun.id, gitApprovalId: gitProposal.approval.id, threadLifecycle: true, chatAbortRecoveryLifecycle: true, chatNetworkRecoveryLifecycle: true, agentCatalogAbortRecoveryLifecycle: true, gitApprovalExecution: true, workspaceGitReviewLifecycle: true, checkpointLifecycle: true, worktreeQueueLifecycle: true, desktopHandoffLifecycle: true, customCommandCrud: true, projectMemoryCrud: true, projectSkillApprovalInstall: true, workflowLifecycle: true, reusableAndScheduledLifecycle: true, managerPresentationLifecycle: true, diagnosticsRoundtrip: true, diagnosticSourceAndPackage: true, backgroundTaskLifecycle: true, resultShareVersionLifecycle: true, interactiveDebuggerRoundtrip: true, pythonDebuggerRoundtrip: true };
  }

  if (scenario === "crash-ready") {
    await api.upsertUserPreference({ category: "output_language", value: "zh", source: "explicit_user_request" });
    if (!config.workspacePath) throw new Error("crash-ready scenario requires workspacePath");
    const proposal = await api.requestGitCommitApproval({ workspacePath: config.workspacePath, message: "Rejected after packaged crash", body: "This commit must never execute.", requestId: "packaged-l5-crash-approval" });
    if (!proposal.queued || !proposal.approval || proposal.alreadyExecuted) throw new Error("crash-ready git approval did not remain pending");
    const activeChatRequestId = "packaged_chat_crash_001";
    const activeChatThreadId = "packaged-chat-crash-thread-001";
    let resolveCrashChatReady: (() => void) | undefined;
    const crashChatReady = new Promise<void>((resolve) => { resolveCrashChatReady = resolve; });
    const offCrashChat = api.onChatEvent((event) => { if (event.requestId === activeChatRequestId && event.type === "chunk" && event.content === "preserved before crash") resolveCrashChatReady?.(); });
    if (await api.startChat({ requestId: activeChatRequestId, threadId: activeChatThreadId, sessionId: activeChatThreadId, runId: "packaged-chat-crash-display-run", agentId: "my-drsai", workspacePath: config.workspacePath, messages: [{ role: "user", content: "Remain active until the packaged App process is forcibly terminated." }] }) !== activeChatRequestId) throw new Error("crash-ready Chat did not start");
    await Promise.race([crashChatReady, new Promise<void>((_, reject) => setTimeout(() => reject(new Error("crash-ready Chat did not emit active Runtime output before forced exit")), 5_000))]);
    offCrashChat();
    const activeAgentRequestId = "packaged_agent_crash_001";
    const activeAgentThreadId = "packaged-agent-crash-thread-001";
    await api.startAgentRun({ requestId: activeAgentRequestId, threadId: activeAgentThreadId, sessionId: activeAgentThreadId, runId: "packaged-agent-crash-run-001", task: "Remain active until the packaged App process is forcibly terminated.", executionDepth: "quick", workspacePath: config.workspacePath, metadata: { packaged_crash_fixture: true } });
    let agentJournalReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await api.recoverAgentRun(activeAgentThreadId)).some((item) => item.type === "start")) { agentJournalReady = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!agentJournalReady) throw new Error("crash-ready Agent did not persist its active start event before forced exit");
    return { descriptor, readyForForcedCrash: true, approvalId: proposal.approval.id, managedChildrenActive: true, activeChatRequestId, activeChatThreadId, activeAgentThreadId };
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
  const warmupMs = Math.max(0, Math.min(120_000, Number(config.warmupMs) || 0));
  if (!(await api.startGateway())) throw new Error("stability scenario could not start Gateway before its idle window");
  const gateway = await api.getGatewayStatus();
  if (!gateway.ready || !gateway.pid) throw new Error("stability scenario Gateway was not healthy before its idle window");
  if (warmupMs) await new Promise((resolve) => setTimeout(resolve, warmupMs));
  const startedAt = Date.now();
  let heartbeats = 0;
  while (Date.now() - startedAt < durationMs) {
    const [nextDescriptor, preferences] = await Promise.all([api.getPlatformDescriptor(), api.listUserPreferences()]);
    if (nextDescriptor.id !== "macos" || !Array.isArray(preferences)) throw new Error("stability heartbeat returned invalid state");
    heartbeats += 1;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, durationMs - (Date.now() - startedAt))));
  }
  return { descriptor, durationMs: Date.now() - startedAt, warmupMs, gatewayReadyBeforeIdle: true, heartbeats };
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
