import type { DesktopPlatformId, DesktopTerminalShellProfile } from "./platform";

export interface DesktopPathLayout {
  home: string;
  repository: string;
  virtualEnvironment: string;
  pythonExecutable: string;
  cliExecutable: string;
  commandExecutable: string;
  environmentFile: string;
  configurationFile: string;
  enhancedPathEntries: readonly string[];
}

export interface DesktopPathService {
  readonly layout: DesktopPathLayout;
  enhancedPath(currentPath?: string): string;
}

export interface DesktopTerminalService {
  readonly defaultShell: DesktopTerminalShellProfile;
  availableShells(): Promise<readonly DesktopTerminalShellProfile[]>;
}

export interface DesktopCredentialService {
  available(): boolean;
  protect(secret: string): string | undefined;
  unprotect(protectedSecret: string | undefined): string | undefined;
  remove?(protectedSecret: string | undefined): boolean;
}

export interface DesktopNotificationService {
  supported(): boolean;
  create(input: { title: string; body: string; silent?: boolean }): DesktopNotificationHandle;
}

export interface DesktopNotificationHandle {
  once(event: "click" | "close", listener: () => void): void;
  emit(event: "click" | "close"): boolean;
  show(): void;
}

export interface DesktopProcessService {
  terminateTree(pid: number): Promise<void>;
}

export interface DesktopPlatformServices {
  readonly platform: DesktopPlatformId;
  readonly paths: DesktopPathService;
  readonly terminal: DesktopTerminalService;
  readonly credentials: DesktopCredentialService;
  readonly notifications: DesktopNotificationService;
  readonly processes: DesktopProcessService;
}
