import { access } from "node:fs/promises";
import type { DesktopTerminalService, DesktopTerminalShellProfile } from "../../../shared/api";

export const MACOS_TERMINAL_SERVICE: DesktopTerminalService = {
  defaultShell: "zsh",
  async availableShells() {
    const shells: DesktopTerminalShellProfile[] = [];
    for (const [profile, executable] of [["zsh", "/bin/zsh"], ["bash", "/bin/bash"]] as const) {
      if (await access(executable).then(() => true, () => false)) shells.push(profile);
    }
    return shells.length ? shells : ["zsh"];
  },
};
