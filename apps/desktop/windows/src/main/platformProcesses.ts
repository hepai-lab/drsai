import { spawn } from "node:child_process";
import type { DesktopProcessService } from "../../../shared/api";

export const WINDOWS_PROCESS_SERVICE: DesktopProcessService = {
  terminateTree(pid) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `taskkill exited ${code ?? "without a status"}`));
      });
    });
  },
};
