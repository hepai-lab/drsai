import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { app } from "electron";

export interface BrowserUseProcess {
  process: ChildProcessWithoutNullStreams;
  stop(): void;
}

export function getBrowserUseWorkerPath(): string {
  const unpacked = join(app.getAppPath(), "src", "python", "browser_use_worker", "worker.py");
  if (existsSync(unpacked)) return unpacked;
  return join(process.cwd(), "src", "python", "browser_use_worker", "worker.py");
}

export function startBrowserUseWorkerProcess(pythonCommand: string): BrowserUseProcess {
  const workerPath = getBrowserUseWorkerPath();
  const browserUseHome = join(app.getPath("userData"), "browser-use");
  const child = spawn(pythonCommand, [workerPath], {
    env: {
      ...process.env,
      BROWSER_USE_CONFIG_DIR:
        process.env.BROWSER_USE_CONFIG_DIR || join(browserUseHome, "config"),
      BROWSER_USE_PROFILES_DIR:
        process.env.BROWSER_USE_PROFILES_DIR || join(browserUseHome, "profiles"),
      BROWSER_USE_DEFAULT_USER_DATA_DIR:
        process.env.BROWSER_USE_DEFAULT_USER_DATA_DIR || join(browserUseHome, "profiles", "default"),
      BH_HOME: process.env.BH_HOME || join(browserUseHome, "browser-harness"),
      BH_CONFIG_DIR:
        process.env.BH_CONFIG_DIR || join(browserUseHome, "browser-harness", "config"),
      BH_RUNTIME_DIR:
        process.env.BH_RUNTIME_DIR || join(browserUseHome, "browser-harness", "runtime"),
      BH_TMP_DIR:
        process.env.BH_TMP_DIR || join(browserUseHome, "browser-harness", "tmp"),
      BH_AGENT_WORKSPACE:
        process.env.BH_AGENT_WORKSPACE || join(browserUseHome, "browser-harness", "agent-workspace"),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    process: child,
    stop: () => {
      if (!child.killed) child.kill();
    },
  };
}
