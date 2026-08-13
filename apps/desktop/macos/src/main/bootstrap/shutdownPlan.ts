export interface MacosShutdownDependencies {
  closeRenderer(): void | Promise<void>;
  stopScheduledTaskWorker(): void;
  killTerminalSessions(): void;
  cleanupVoiceFiles(): void;
  cancelRuntimeInstall(): void;
  shutdownApprovalStore(): void | Promise<void>;
  shutdownInteractiveDebugger(): void | Promise<void>;
  shutdownBrowserTasks(): void | Promise<void>;
  shutdownNativeHelper(): void | Promise<void>;
  shutdownMcpSessions(): void | Promise<void>;
  shutdownPortForwards(): void | Promise<void>;
  shutdownSshHosts(): void | Promise<void>;
  shutdownRemoteGatewayInstaller(): void | Promise<void>;
  shutdownRemoteWorkspaces(): void | Promise<void>;
  closeMobilePairingControllers(): void | Promise<void>;
  shutdownAgentJournal(): void | Promise<void>;
  shutdownChatJournal(): void | Promise<void>;
  stopGateway(): void | Promise<void>;
  shutdownManagedProcesses(): void | Promise<void>;
}

export interface MacosShutdownStep { name: string; run(): void | Promise<void>; }

export function createMacosShutdownPlan(dependencies: MacosShutdownDependencies): MacosShutdownStep[] {
  return [
    // Stop renderer-originated IPC before any service it depends on is torn down.
    { name: "renderer", run: dependencies.closeRenderer },
    { name: "scheduled-task-worker", run: dependencies.stopScheduledTaskWorker },
    { name: "terminal-sessions", run: dependencies.killTerminalSessions },
    { name: "voice-files", run: dependencies.cleanupVoiceFiles },
    { name: "runtime-install", run: dependencies.cancelRuntimeInstall },
    { name: "approval-store", run: dependencies.shutdownApprovalStore },
    { name: "interactive-debugger", run: dependencies.shutdownInteractiveDebugger },
    { name: "browser-tasks", run: dependencies.shutdownBrowserTasks },
    { name: "native-helper", run: dependencies.shutdownNativeHelper },
    { name: "managed-process-registry", run: dependencies.shutdownManagedProcesses },
    { name: "mcp-sessions", run: dependencies.shutdownMcpSessions },
    { name: "port-forwards", run: dependencies.shutdownPortForwards },
    { name: "ssh-hosts", run: dependencies.shutdownSshHosts },
    { name: "remote-gateway-installer", run: dependencies.shutdownRemoteGatewayInstaller },
    { name: "remote-workspaces", run: dependencies.shutdownRemoteWorkspaces },
    { name: "mobile-pairing", run: dependencies.closeMobilePairingControllers },
    { name: "agent-journal", run: dependencies.shutdownAgentJournal },
    { name: "chat-journal", run: dependencies.shutdownChatJournal },
    // The Gateway remains available while every dependent resource drains.
    { name: "gateway", run: dependencies.stopGateway },
  ];
}
