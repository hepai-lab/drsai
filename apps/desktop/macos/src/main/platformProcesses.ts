import type { DesktopProcessService } from "../../../shared/api";

export const MACOS_PROCESS_SERVICE: DesktopProcessService = {
  async terminateTree(pid) {
    const group = -Math.abs(pid);
    try {
      process.kill(-Math.abs(pid), "SIGTERM");
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch { return; }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    try { process.kill(group, 0); } catch { return; }
    try { process.kill(group, "SIGKILL"); } catch {
      try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
    }
  },
};
