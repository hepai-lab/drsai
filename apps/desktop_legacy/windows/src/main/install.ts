import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";
import { app } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { WebContents } from "electron";
import { DRSAI_HOME, getEnhancedPath } from "./paths";
import type { InstallProgress, StartInstallOptions } from "../shared/desktopApi";

let installing = false;
let installProc: ChildProcessWithoutNullStreams | null = null;
let cancelRequested = false;

export function cancelInstall(): boolean {
  if (!installProc || installProc.killed) return false;
  cancelRequested = true;
  killInstallProcessTree(installProc);
  return true;
}

export function startInstall(
  webContents: WebContents,
  options: StartInstallOptions = {},
): Promise<void> {
  if (installing) {
    emit(webContents, {
      phase: "running",
      message: "Installation is already running.",
      log: "",
    });
    return Promise.resolve();
  }

  const script = resolveInstallScript();
  if (!script) {
    const message = "Cannot find scripts/install.ps1 from the Windows desktop app.";
    emit(webContents, { phase: "error", message, log: message, exitCode: 1 });
    return Promise.reject(new Error(message));
  }
  const powershell = resolvePowerShell();

  installing = true;
  cancelRequested = false;
  let log = "";
  const logFile = createInstallLogFile();
  emit(webContents, {
    phase: "running",
    message: "Starting OpenDrSai installation...",
    log,
    logFile,
  });
  appendInstallLog(logFile, `OpenDrSai install started at ${new Date().toISOString()}\n`);
  const branch = getInstallBranch();
  const bundledSource = resolveBundledBackendSource();
  const expectedVersion = getExpectedBackendVersion(bundledSource);
  appendInstallLog(logFile, `Backend branch: ${branch}\n`);
  if (bundledSource) appendInstallLog(logFile, `Bundled backend source: ${bundledSource.archivePath}\n`);
  if (expectedVersion) appendInstallLog(logFile, `Expected backend version: ${expectedVersion}\n`);

  return new Promise((resolve, reject) => {
    const proc = spawn(
      powershell,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-SkipSetup",
        ...(options.installPrerequisites ? ["-InstallPrerequisites"] : []),
        "-DrsaiHome",
        DRSAI_HOME,
        "-Branch",
        branch,
        ...(bundledSource
          ? [
              "-SourceArchive",
              bundledSource.archivePath,
              "-SourceArchiveSha256",
              bundledSource.sha256,
            ]
          : []),
        ...(expectedVersion ? ["-ExpectedVersion", expectedVersion] : []),
      ],
      {
        env: {
          ...process.env,
          DRSAI_HOME,
          PATH: getEnhancedPath(),
        },
        windowsHide: true,
      },
    );
    installProc = proc;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      log += text;
      appendInstallLog(logFile, text);
      emit(webContents, {
        phase: "running",
        message: "Installing OpenDrSai...",
        log,
        logFile,
      });
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      log += text;
      appendInstallLog(logFile, text);
      emit(webContents, {
        phase: "running",
        message: "Installing OpenDrSai...",
        log,
        logFile,
      });
    });
    proc.on("error", (error) => {
      installing = false;
      installProc = null;
      appendInstallLog(logFile, `\nInstaller process failed: ${error.message}\n`);
      emit(webContents, {
        phase: "error",
        message: error.message,
        log,
        logFile,
        exitCode: 1,
      });
      reject(error);
    });
    proc.on("close", (code) => {
      installing = false;
      installProc = null;
      if (cancelRequested) {
        const message = "Installation cancelled.";
        appendInstallLog(logFile, `\n${message}\n`);
        emit(webContents, {
          phase: "error",
          message,
          log,
          logFile,
          exitCode: code ?? 1,
        });
        reject(new Error(message));
        cancelRequested = false;
        return;
      }
      appendInstallLog(logFile, `\nOpenDrSai install exited with code ${code ?? 1}.\n`);
      if (code === 0) {
        emit(webContents, {
          phase: "complete",
          message: "Installation complete.",
          log,
          logFile,
          exitCode: 0,
        });
        resolve();
        return;
      }
      const error = new Error(`Installer exited with code ${code ?? 1}.`);
      emit(webContents, {
        phase: "error",
        message: error.message,
        log,
        logFile,
        exitCode: code ?? 1,
      });
      reject(error);
    });
  });
}

function createInstallLogFile(): string {
  const logDir = join(DRSAI_HOME, "logs");
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(logDir, `desktop-install-${stamp}.log`);
  writeFileSync(logFile, "", "utf8");
  return logFile;
}

function appendInstallLog(logFile: string, text: string): void {
  appendFileSync(logFile, text, "utf8");
}

function killInstallProcessTree(proc: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  proc.kill();
}

function getInstallBranch(): string {
  if (process.env.DRSAI_INSTALL_BRANCH?.trim()) {
    return process.env.DRSAI_INSTALL_BRANCH.trim();
  }
  return app.isPackaged ? `v${app.getVersion()}` : "main";
}

function getExpectedBackendVersion(bundledSource: BundledBackendSource | null): string | null {
  return app.isPackaged ? bundledSource?.version ?? null : null;
}

interface BundledBackendSource {
  archivePath: string;
  sha256: string;
  version: string | null;
}

function resolveBundledBackendSource(): BundledBackendSource | null {
  const manifestCandidates = [
    join(process.resourcesPath, "app.asar.unpacked", "resources", "backend", "backend-source.json"),
    join(process.resourcesPath, "backend", "backend-source.json"),
    join(app.getAppPath(), "resources", "backend", "backend-source.json"),
  ];
  for (const manifestPath of manifestCandidates) {
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        archive?: unknown;
        sha256?: unknown;
        version?: unknown;
      };
      if (typeof manifest.archive !== "string" || typeof manifest.sha256 !== "string") {
        continue;
      }
      const archivePath = join(dirname(manifestPath), manifest.archive);
      if (!existsSync(archivePath) || !/^[a-fA-F0-9]{64}$/.test(manifest.sha256)) {
        continue;
      }
      return {
        archivePath,
        sha256: manifest.sha256,
        version: typeof manifest.version === "string" ? manifest.version : null,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function emit(webContents: WebContents, progress: InstallProgress): void {
  webContents.send("desktop:install-progress", progress);
}

function resolveInstallScript(): string | null {
  const packagedCandidates = [
    join(process.resourcesPath, "install", "install.ps1"),
    join(app.getAppPath(), "resources", "install", "install.ps1"),
  ];
  const devCandidates = [
    join(process.cwd(), "..", "..", "scripts", "install.ps1"),
    join(process.cwd(), "..", "..", "..", "scripts", "install.ps1"),
    join(__dirname, "..", "..", "..", "..", "scripts", "install.ps1"),
  ];
  const candidates = app.isPackaged ? packagedCandidates : [...packagedCandidates, ...devCandidates];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (app.isPackaged && !isUnderRealPath(candidate, process.resourcesPath)) continue;
    return candidate;
  }
  return null;
}

function resolvePowerShell(): string {
  if (process.platform !== "win32") return "powershell";
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const powershell = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return existsSync(powershell) ? powershell : "powershell.exe";
}

function isUnderRealPath(targetPath: string, rootPath: string): boolean {
  try {
    const target = realpathSync.native(targetPath).toLowerCase();
    const root = realpathSync.native(rootPath).toLowerCase();
    return target === root || target.startsWith(`${root}\\`);
  } catch {
    return false;
  }
}
