import type { DesktopProcessService } from "../../../shared/api";

export const MACOS_PROCESS_SERVICE: DesktopProcessService = {
  async terminateTree(pid) {
    try {
      process.kill(-Math.abs(pid), "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  },
};
