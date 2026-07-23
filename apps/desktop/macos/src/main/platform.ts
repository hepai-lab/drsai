import { assertDesktopPlatformDescriptor, type DesktopPlatformDescriptor } from "../../../shared/api";

export const MACOS_PLATFORM_DESCRIPTOR: DesktopPlatformDescriptor = {
  id: "macos",
  defaultTerminalShell: "zsh",
  capabilities: {
    terminal: true,
    credentials: true,
    notifications: true,
    permissions: true,
    install: true,
    update: true,
    features: {
      auth: true, runtime: true, chat: true, agents: true, threads: true,
      workspaceFiles: true, git: true, terminal: true, serialVoice: true,
      streamingVoice: true, approvals: true, browser: true, debugger: true,
      mcp: true, remoteWorkspace: true, portForwarding: true, checkpoints: true,
      worktrees: true, automation: true, collaboration: true, channels: true,
      diagnostics: true, codexBackend: true,
    },
  },
};

assertDesktopPlatformDescriptor(MACOS_PLATFORM_DESCRIPTOR);
