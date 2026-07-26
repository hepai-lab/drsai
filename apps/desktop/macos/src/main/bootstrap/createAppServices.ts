import { app, BrowserWindow, type WebContents } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { PersistentApprovalStore } from "../../../../shared/main/approvalStore";
import { BrowserTaskService } from "../../../../shared/main/browser/browserTaskService";
import { BrowserUseWorkerClient } from "../../../../shared/main/browser/workerClient";
import { InteractiveDebuggerService } from "../../../../shared/main/interactiveDebugger";
import { InteractiveDebugPolicyStore } from "../../../../shared/main/interactiveDebugPolicy";
import { createDesktopIpcAuditWriter } from "../../../../shared/main/ipcAuditLog";
import { DRSAI_PYTHON } from "../../../../shared/main/paths";
import { getInstallStatus } from "../desktopLifecycle";
import { MACOS_USER_DATA } from "../platformServices";
import { NativeHelperSupervisor } from "../native/nativeHelperSupervisor";
import { nativeHelperExecutablePath } from "../native/nativeHelperPath";

export interface MacosAppServiceFactoryOptions {
  getMainWebContents(): WebContents | undefined;
  isAllowedDesktopPath(path: string): Promise<boolean>;
}

export function createMacosAppServices(options: MacosAppServiceFactoryOptions) {
  const interactiveDebugPolicy = new InteractiveDebugPolicyStore(join(MACOS_USER_DATA, "state", "interactive-debug-policy.json"));
  const interactiveDebugger = new InteractiveDebuggerService(options.getMainWebContents, DRSAI_PYTHON, options.isAllowedDesktopPath, () => interactiveDebugPolicy.isEnabled());
  const browserTaskService = new BrowserTaskService({
    worker: new BrowserUseWorkerClient(),
    workerOptions: async () => {
      const install = await getInstallStatus();
      const runtimeRoot = dirname(dirname(install.pythonPath));
      const browserPython = join(runtimeRoot, "browser-venv", "bin", "python");
      const browserPath = join(runtimeRoot, "browser-browsers");
      if (!process.env.OPENDRSAI_BROWSER_USE_PYTHON && !existsSync(browserPython)) throw new Error("Browser Runtime is not installed. Repair the bundled Runtime before starting a Browser task.");
      return {
        pythonCommand: process.env.OPENDRSAI_BROWSER_USE_PYTHON || browserPython,
        workerPath: app.isPackaged ? join(process.resourcesPath, "browser-use-worker", "worker.py") : join(app.getAppPath(), "..", "shared", "browser-use-worker", "worker.py"),
        dataRoot: join(MACOS_USER_DATA, "browser-use"),
        environment: { PLAYWRIGHT_BROWSERS_PATH: browserPath },
      };
    },
    traceRoot: join(MACOS_USER_DATA, "browser-use", "traces"),
    publish: (event) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("desktop:browser-task-event", event); },
    recordError: (message) => console.warn("[browser-use]", message),
  });
  return {
    interactiveDebugPolicy,
    interactiveDebugger,
    browserTaskService,
    ipcAuditWriter: createDesktopIpcAuditWriter(join(MACOS_USER_DATA, "logs", "desktop-ipc-audit.jsonl")),
    approvalStore: new PersistentApprovalStore(join(MACOS_USER_DATA, "state", "approvals.json")),
    nativeHelperSupervisor: new NativeHelperSupervisor(nativeHelperExecutablePath(), { timeoutMs: 2_000, maxRestarts: 1 }),
  };
}

export type MacosAppServices = ReturnType<typeof createMacosAppServices>;
