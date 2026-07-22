import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

const packageJson = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf-8"),
) as { dependencies?: Record<string, string> };
const mainSrc = readFileSync(join(ROOT, "src/main/index.ts"), "utf-8");
const terminalSrc = readFileSync(join(ROOT, "src/main/terminal.ts"), "utf-8");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const preloadTypes = readFileSync(
  join(ROOT, "src/preload/index.d.ts"),
  "utf-8",
);
const layoutSrc = readFileSync(
  join(ROOT, "src/renderer/src/screens/Layout/Layout.tsx"),
  "utf-8",
);
const panelSrc = readFileSync(
  join(ROOT, "src/renderer/src/components/TerminalPanel.tsx"),
  "utf-8",
);

describe("right sidebar terminal panel", () => {
  it("declares terminal runtime dependencies", () => {
    expect(packageJson.dependencies).toHaveProperty("@xterm/xterm");
    expect(packageJson.dependencies).toHaveProperty("@xterm/addon-fit");
    expect(packageJson.dependencies).toHaveProperty("node-pty");
  });

  it("registers terminal IPC handlers in the main process", () => {
    for (const channel of [
      "terminal-create",
      "terminal-write",
      "terminal-resize",
      "terminal-kill",
    ]) {
      expect(mainSrc).toMatch(
        new RegExp(`ipcMain\\.handle\\(\\s*"${channel}"`),
      );
      expect(preloadSrc).toMatch(
        new RegExp(`ipcRenderer\\.invoke\\(\\s*"${channel}"`),
      );
    }
  });

  it("exposes terminal data and exit event listeners through preload", () => {
    expect(preloadSrc).toContain('ipcRenderer.on("terminal-data"');
    expect(preloadSrc).toContain('ipcRenderer.on("terminal-exit"');
    expect(preloadTypes).toContain("createTerminal");
    expect(preloadTypes).toContain("onTerminalData");
    expect(preloadTypes).toContain("onTerminalExit");
  });

  it("uses node-pty with a PowerShell-first Windows shell strategy", () => {
    expect(terminalSrc).toContain('require("node-pty")');
    expect(terminalSrc).toContain('"pwsh.exe"');
    expect(terminalSrc).toContain('"powershell.exe"');
    expect(terminalSrc).toContain("nodePty.spawn");
    expect(terminalSrc).toContain("killAllTerminalSessions");
  });

  it("mounts xterm in the right side of the desktop layout", () => {
    expect(panelSrc).toContain('from "@xterm/xterm"');
    expect(panelSrc).toContain('from "@xterm/addon-fit"');
    expect(panelSrc).toContain("createTerminal");
    expect(panelSrc).toContain("writeTerminal");
    expect(panelSrc).toContain("resizeTerminal");
    expect(layoutSrc).toContain("<TerminalPanel");
    expect(layoutSrc).toContain("terminal-rail-button");
  });
});
