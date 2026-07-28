import type { DesktopProcessService } from "../../../shared/api";

export const MACOS_PROCESS_SERVICE: DesktopProcessService = {
  async terminateTree(pid) {
    const group = -Math.abs(pid);
    let signalledGroup = true;
    try {
      process.kill(group, "SIGTERM");
    } catch {
      signalledGroup = false;
      try { process.kill(pid, "SIGTERM"); } catch { return; }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const target = signalledGroup ? group : pid;
    try { process.kill(target, 0); } catch { return; }
    try { process.kill(target, "SIGKILL"); } catch { /* already exited */ }
  },
};
