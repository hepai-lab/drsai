/** Platform-neutral contracts shared by every OpenDrSai desktop shell. */
export type DesktopPlatformId = "windows" | "macos";

export type DesktopTerminalShellProfile =
  | "powershell"
  | "pwsh"
  | "cmd"
  | "git-bash"
  | "wsl"
  | "zsh"
  | "bash";

export interface DesktopCapabilities {
  terminal: boolean;
  credentials: boolean;
  notifications: boolean;
  permissions: boolean;
  install: boolean;
  update: boolean;
  features: DesktopFeatureCapabilities;
}

export interface DesktopFeatureCapabilities {
  auth: boolean;
  runtime: boolean;
  chat: boolean;
  agents: boolean;
  threads: boolean;
  workspaceFiles: boolean;
  git: boolean;
  terminal: boolean;
  serialVoice: boolean;
  streamingVoice: boolean;
  approvals: boolean;
  browser: boolean;
  debugger: boolean;
  mcp: boolean;
  remoteWorkspace: boolean;
  portForwarding: boolean;
  checkpoints: boolean;
  worktrees: boolean;
  automation: boolean;
  collaboration: boolean;
  channels: boolean;
  diagnostics: boolean;
  codexBackend: boolean;
}

export const DESKTOP_FEATURE_CAPABILITY_KEYS = [
  "auth", "runtime", "chat", "agents", "threads", "workspaceFiles", "git", "terminal",
  "serialVoice", "streamingVoice", "approvals", "browser", "debugger", "mcp",
  "remoteWorkspace", "portForwarding", "checkpoints", "worktrees", "automation",
  "collaboration", "channels", "diagnostics", "codexBackend",
] as const satisfies readonly (keyof DesktopFeatureCapabilities)[];

export const FULL_DESKTOP_FEATURE_CAPABILITIES: DesktopFeatureCapabilities = Object.freeze(
  Object.fromEntries(DESKTOP_FEATURE_CAPABILITY_KEYS.map((key) => [key, true])) as unknown as DesktopFeatureCapabilities,
);

export interface DesktopPlatformDescriptor {
  id: DesktopPlatformId;
  defaultTerminalShell: DesktopTerminalShellProfile;
  capabilities: DesktopCapabilities;
}

const PLATFORM_IDS = new Set<DesktopPlatformId>(["windows", "macos"]);
const SHELL_PROFILES = new Set<DesktopTerminalShellProfile>([
  "powershell", "pwsh", "cmd", "git-bash", "wsl", "zsh", "bash",
]);

export function assertDesktopPlatformDescriptor(
  value: unknown,
): asserts value is DesktopPlatformDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("desktop_platform_descriptor_invalid");
  }
  const descriptor = value as Record<string, unknown>;
  if (!PLATFORM_IDS.has(descriptor.id as DesktopPlatformId)) {
    throw new Error("desktop_platform_id_invalid");
  }
  if (!SHELL_PROFILES.has(descriptor.defaultTerminalShell as DesktopTerminalShellProfile)) {
    throw new Error("desktop_platform_default_shell_invalid");
  }
  const capabilities = descriptor.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw new Error("desktop_platform_capabilities_invalid");
  }
  const capabilityRecord = capabilities as Record<string, unknown>;
  for (const key of ["terminal", "credentials", "notifications", "permissions", "install", "update"]) {
    if (typeof capabilityRecord[key] !== "boolean") {
      throw new Error(`desktop_platform_capability_${key}_invalid`);
    }
  }
  const features = capabilityRecord.features;
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new Error("desktop_platform_feature_capabilities_invalid");
  }
  for (const key of DESKTOP_FEATURE_CAPABILITY_KEYS) {
    if (typeof (features as Record<string, unknown>)[key] !== "boolean") {
      throw new Error(`desktop_platform_feature_capability_${key}_invalid`);
    }
  }
}
