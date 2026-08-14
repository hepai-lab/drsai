import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

type SpawnBrowser = (executable: string, args: string[]) => Promise<void>;

export interface WindowsExternalUrlOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  spawnBrowser?: SpawnBrowser;
}

/**
 * Open an HTTP(S) URL through the registered Windows handler and fall back to
 * a known installed browser when a clean Windows image has no protocol
 * association yet. Windows Sandbox can ship Edge while shell.openExternal()
 * still fails with ERROR_NO_ASSOCIATION (0x483).
 */
export async function openExternalUrlWithBrowserFallback(
  url: string,
  openSystemExternal: (url: string) => Promise<void>,
  options: WindowsExternalUrlOptions = {},
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    await openSystemExternal(url);
    return;
  }

  try {
    await openSystemExternal(url);
    return;
  } catch (systemError) {
    if ((options.platform ?? process.platform) !== "win32") throw systemError;

    const environment = options.environment ?? process.env;
    const exists = options.exists ?? existsSync;
    const launch = options.spawnBrowser ?? spawnBrowser;
    const candidates = browserCandidates(environment).filter((candidate, index, all) =>
      all.indexOf(candidate) === index && exists(candidate),
    );
    const failures: string[] = [];
    for (const executable of candidates) {
      try {
        await launch(executable, [url]);
        return;
      } catch (error) {
        failures.push(`${executable}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const systemDetail = systemError instanceof Error ? systemError.message : String(systemError);
    const fallbackDetail = candidates.length === 0
      ? "No installed Edge or Chrome executable was found."
      : `Browser fallback failed: ${failures.join("; ")}`;
    throw new Error(`${systemDetail} ${fallbackDetail}`, { cause: systemError });
  }
}

export function browserCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = environment.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = environment["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = environment.LOCALAPPDATA || "";
  return [
    join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ...(localAppData ? [join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")] : []),
    join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    ...(localAppData ? [join(localAppData, "Google", "Chrome", "Application", "chrome.exe")] : []),
  ];
}

function spawnBrowser(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}
