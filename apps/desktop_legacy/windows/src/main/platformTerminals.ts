import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { DesktopTerminalService, DesktopTerminalShellProfile } from "../../../shared/api";

function onPath(command: string): boolean {
  return (process.env.PATH || "").split(delimiter).some((directory) => directory && existsSync(join(directory, command)));
}

export const WINDOWS_TERMINAL_SERVICE: DesktopTerminalService = {
  defaultShell: "powershell",
  async availableShells() {
    const shells: DesktopTerminalShellProfile[] = ["powershell", "cmd"];
    if (onPath("pwsh.exe")) shells.push("pwsh");
    if (onPath("bash.exe")) shells.push("git-bash");
    if (onPath("wsl.exe")) shells.push("wsl");
    return shells;
  },
};
