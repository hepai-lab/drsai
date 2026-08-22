import { app, Menu, net, powerMonitor, screen, shell } from "electron";
import { configureCompletionNotifications } from "../../../../shared/main/completionNotifications";
import { desktopDiagnostics } from "../../../../shared/main/diagnostics";
import type { InteractiveDebuggerService } from "../../../../shared/main/interactiveDebugger";
import { portForwardRegistry } from "../../../../shared/main/portForwards";
import { productionDiagnostics } from "../../../../shared/main/productionDiagnostics";
import { remoteGatewayInstaller } from "../../../../shared/main/remoteGatewayInstaller";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import type { ScheduledTaskWorker } from "../../../../shared/main/scheduledTasks";
import { managedProcessRegistry } from "../../../../shared/main/managedProcessRegistry";
import { cleanupAllVoiceTempFiles } from "../../../../shared/main/voice";
import { disposeAllDuplexVoiceSessions } from "../../../../shared/main/voice/duplex/controller";
import { getGatewayStatus, stopGateway } from "../gateway";
import type { InterruptionReason, MacosLifecycleRecoveryCoordinator } from "../lifecycleRecovery";
import { MACOS_PLATFORM_SERVICES } from "../platformServices";
import { killAllTerminalSessions } from "../terminal";

export interface MacosAppIntegrationDependencies {
  recovery: MacosLifecycleRecoveryCoordinator; interactiveDebugger: InteractiveDebuggerService;
  focusApp(): void; openSettings(): void; ensureWindowOnScreen(): void; recover(reason: InterruptionReason): void;
  getScheduledTaskWorker(): ScheduledTaskWorker | null; getWindowVisibility(): "foreground" | "minimized" | "hidden";
  reloadMainWindow(): void; publish(channel: string, event: unknown): void;
}

let packagedNetworkOnlineOverride: boolean | null = null;
function networkIsOnline(): boolean { return packagedNetworkOnlineOverride ?? net.isOnline(); }
export function setPackagedNetworkOnlineForE2e(online: boolean | null): void {
  if (process.env.OPENDRSAI_E2E_AGENT_RUN !== "1" || process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO !== "system-events") throw new Error("Packaged network override is unavailable outside the system-events acceptance scenario.");
  packagedNetworkOnlineOverride = online;
}

export function installMacosAppIntegrations(dependencies: MacosAppIntegrationDependencies): () => void {
  const { recovery } = dependencies;
  remoteGatewayInstaller.setPublisher((event) => dependencies.publish("desktop:remote-gateway-operation-event", event));
  remoteWorkspaceController.setPublisher((event) => dependencies.publish("desktop:remote-workspace-status-event", event));
  remoteWorkspaceController.setFilePublisher((event) => dependencies.publish("desktop:workspace-file-change-event", event));
  portForwardRegistry.setPublisher((event) => dependencies.publish("desktop:port-forward-event", event));
  desktopDiagnostics.setPublisher((event) => { productionDiagnostics.observeEvent(Buffer.byteLength(JSON.stringify(event), "utf8"), event.workspaceId); dependencies.publish("desktop:diagnostics-event", event); });
  dependencies.interactiveDebugger.setPublisher((event) => dependencies.publish("desktop:interactive-debug-event", event));
  configureCompletionNotifications({ notifications: MACOS_PLATFORM_SERVICES.notifications, focusApp: dependencies.focusApp, publishClick: (event) => dependencies.publish("desktop:completion-notification-click", event), getWindowVisibility: dependencies.getWindowVisibility });
  app.setName("OpenDrSai"); app.setAsDefaultProtocolClient("opendrsai");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu", submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: dependencies.openSettings }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
    { role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    { role: "help", submenu: [{ label: "OpenDrSai Documentation", click: () => { void shell.openExternal("https://github.com/hepai-lab/drsai"); } }] },
  ]));
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: "Show OpenDrSai", click: dependencies.focusApp }, { label: "Settings…", click: dependencies.openSettings }]));
  const recordInterruption = () => { disposeAllDuplexVoiceSessions(); recovery.observeInterruption(async () => (await getGatewayStatus()).ready); void portForwardRegistry.suspendAll(); };
  const recoverInterruption = (reason: "resume" | "unlock") => { dependencies.recover(reason); void portForwardRegistry.resumeAll(); void dependencies.getScheduledTaskWorker()?.runOnce(); };
  powerMonitor.on("suspend", recordInterruption);
  powerMonitor.on("lock-screen", recordInterruption);
  powerMonitor.on("resume", () => recoverInterruption("resume"));
  powerMonitor.on("unlock-screen", () => recoverInterruption("unlock"));
  powerMonitor.on("shutdown", () => { recovery.beginShutdown(); managedProcessRegistry.beginShutdown(); killAllTerminalSessions(); disposeAllDuplexVoiceSessions(); cleanupAllVoiceTempFiles(); void managedProcessRegistry.shutdownAll(); void stopGateway().catch(() => undefined); });
  const handleDisplayChange = () => { dependencies.ensureWindowOnScreen(); dependencies.recover("display-change"); };
  screen.on("display-added", handleDisplayChange); screen.on("display-removed", handleDisplayChange); screen.on("display-metrics-changed", handleDisplayChange);
  let networkOnline = networkIsOnline(); recovery.setNetworkOnline(networkOnline);
  const networkMonitor = setInterval(() => {
    const online = networkIsOnline();
    if (!online) { recovery.setNetworkOnline(false); if (networkOnline) void portForwardRegistry.suspendAll(); networkOnline = false; recovery.observeInterruption(async () => (await getGatewayStatus()).ready); return; }
    const recovered = recovery.setNetworkOnline(true); if (!networkOnline) void portForwardRegistry.resumeAll(); networkOnline = true; if (recovered) dependencies.recover("network-online");
  }, process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO === "system-events" ? 50 : 5_000);
  networkMonitor.unref?.();
  app.on("child-process-gone", (_event, details) => { if (details.type !== "GPU" || recovery.shuttingDown) return; dependencies.reloadMainWindow(); dependencies.recover("gpu-recovered"); });
  return () => { clearInterval(networkMonitor); packagedNetworkOnlineOverride = null; };
}
