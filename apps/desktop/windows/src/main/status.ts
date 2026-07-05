import { execFile } from "child_process";
import { app } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  DesktopHealth,
  InstallStatus,
  PrerequisiteStatus,
  UpdateStatus,
} from "../shared/desktopApi";
import {
  DRSAI_CONFIG_FILE,
  DRSAI_CMD_SCRIPT,
  DRSAI_ENV_FILE,
  DRSAI_HOME,
  DRSAI_PYTHON,
  DRSAI_REPO,
  DRSAI_SCRIPT,
  getEnhancedPath,
} from "./paths";
import { getGatewayStatus } from "./gateway";
import { getUpdateStatus } from "./updates";

export async function getInstallStatus(): Promise<InstallStatus> {
  const hasPython = existsSync(DRSAI_PYTHON);
  const hasScript = existsSync(DRSAI_SCRIPT) || existsSync(DRSAI_CMD_SCRIPT);
  const hasRepo = existsSync(DRSAI_REPO);
  const prerequisites = await getPrerequisiteStatus();
  const version = hasRepo && hasPython ? await getDrsaiVersion() : null;
  const expectedVersion = getExpectedBackendVersion();
  const backendNeedsRepair = Boolean(
    expectedVersion && version && !versionsMatch(version, expectedVersion),
  );
  const missing = [
    hasRepo ? null : "repository",
    hasPython ? null : "python",
    hasScript ? null : "drsai-cli",
    version ? null : "drsai-version",
    backendNeedsRepair ? "backend-version" : null,
    prerequisites.apiKeyConfigured ? null : "api-key",
  ].filter((item): item is string => Boolean(item));

  return {
    installed: hasRepo && hasPython && hasScript && Boolean(version) && !backendNeedsRepair,
    home: DRSAI_HOME,
    repoPath: DRSAI_REPO,
    pythonPath: DRSAI_PYTHON,
    scriptPath: existsSync(DRSAI_SCRIPT) ? DRSAI_SCRIPT : DRSAI_CMD_SCRIPT,
    version,
    expectedVersion,
    backendNeedsRepair,
    bundledBackendAvailable: hasBundledBackendSource(),
    configExists: existsSync(DRSAI_CONFIG_FILE),
    envExists: existsSync(DRSAI_ENV_FILE),
    apiKeyConfigured: prerequisites.apiKeyConfigured,
    prerequisites,
    missing,
  };
}

export async function getDesktopHealth(): Promise<DesktopHealth> {
  const [install, gateway, update] = await Promise.all([
    getInstallStatus(),
    getGatewayStatus(),
    Promise.resolve(getUpdateStatus()),
  ]);

  return {
    installed: install.installed,
    gatewayReady: gateway.ready,
    mode: "local",
    version: install.version,
    install,
    gateway,
    update,
  };
}

export function fallbackUpdateStatus(error: unknown): UpdateStatus {
  return {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function getDrsaiVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      DRSAI_PYTHON,
      ["-m", "drsai.backend.run_cli", "version"],
      {
        cwd: DRSAI_REPO,
        env: {
          ...process.env,
          DRSAI_HOME,
          PATH: getEnhancedPath(),
        },
        timeout: 30000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout.toString().trim() || null);
      },
    );
  });
}

async function getPrerequisiteStatus(): Promise<PrerequisiteStatus> {
  const [python, git] = await Promise.all([
    getPythonCandidate(),
    getToolCandidate("git", ["--version"]),
  ]);
  const pythonVersion = python?.output ?? null;
  const gitVersion = git?.output ?? null;
  const apiKeyConfigured = isApiKeyConfigured();
  const problems = [
    pythonVersion ? null : "Python 3.11+ was not found on PATH.",
    isPythonVersionSupported(pythonVersion)
      ? null
      : `Python 3.11+ is required${pythonVersion ? `, found ${pythonVersion}` : ""}.`,
    gitVersion ? null : "Git was not found on PATH.",
    apiKeyConfigured ? null : "HEPAI_API_KEY is not configured.",
  ].filter((item): item is string => Boolean(item));

  return {
    pythonOnPath: Boolean(pythonVersion),
    pythonVersion,
    pythonCommand: python?.command ?? null,
    gitOnPath: Boolean(gitVersion),
    gitVersion,
    gitCommand: git?.command ?? null,
    apiKeyConfigured,
    problems,
  };
}

interface ToolCandidate {
  command: string;
  output: string;
}

async function getPythonCandidate(): Promise<ToolCandidate | null> {
  const versionArgs = [
    "-c",
    "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
  ];
  const candidates = [
    { command: "python", args: versionArgs },
    { command: "py", args: ["-3.11", ...versionArgs] },
    { command: "python3", args: versionArgs },
  ];
  let firstFound: ToolCandidate | null = null;

  for (const candidate of candidates) {
    const tool = await getToolCandidate(candidate.command, candidate.args);
    if (tool && !firstFound) firstFound = tool;
    if (tool && isPythonVersionSupported(tool.output)) return tool;
  }
  return firstFound;
}

async function getToolCandidate(
  command: string,
  args: string[],
): Promise<ToolCandidate | null> {
  const source = await getCommandSource(command);
  if (!source) return null;
  const output = await getCommandOutput(source, args);
  return output ? { command: source, output } : null;
}

async function getCommandSource(command: string): Promise<string | null> {
  if (process.platform !== "win32") return command;
  const output = await getCommandOutput("where.exe", [command]);
  if (!output) return null;
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/\\WindowsApps\\/i.test(line)) ?? null
  );
}

function getCommandOutput(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
        },
        timeout: 8000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout.toString().trim() || null);
      },
    );
  });
}

function isPythonVersionSupported(version: string | null): boolean {
  if (!version) return false;
  const [major, minor] = version.split(".").map((part) => Number(part));
  return major > 3 || (major === 3 && minor >= 11);
}

function isApiKeyConfigured(): boolean {
  if (process.env.HEPAI_API_KEY?.trim()) return true;
  if (!existsSync(DRSAI_ENV_FILE)) return false;
  const content = readFileSync(DRSAI_ENV_FILE, "utf8");
  return content
    .split(/\r?\n/)
    .some((line) => /^HEPAI_API_KEY\s*=\s*\S+/.test(line.trim()));
}

function getExpectedBackendVersion(): string | null {
  return app.isPackaged ? getBundledBackendVersion() : null;
}

function hasBundledBackendSource(): boolean {
  return Boolean(getBundledBackendManifestPath());
}

function getBundledBackendVersion(): string | null {
  const manifestPath = getBundledBackendManifestPath();
  if (!manifestPath) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

function getBundledBackendManifestPath(): string | null {
  const candidates = [
    join(process.resourcesPath, "app.asar.unpacked", "resources", "backend", "backend-source.json"),
    join(process.resourcesPath, "backend", "backend-source.json"),
    join(app.getAppPath(), "resources", "backend", "backend-source.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function versionsMatch(actual: string, expected: string): boolean {
  return extractSemanticVersion(actual) === extractSemanticVersion(expected);
}

function extractSemanticVersion(value: string): string {
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? value.trim();
}
