import { app, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";

export function runPackagedSmokeIfRequested(window: BrowserWindow): void {
  const output = process.env.OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE?.trim();
  if (!output) return;
  if (!app.isPackaged) throw new Error("macOS packaged smoke requires a packaged application.");
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("terminal smoke timed out")), 15000);
        try {
          const api = window.openDrSai;
          const descriptor = await api.getPlatformDescriptor();
          await api.startInstall({});
          const install = await api.getInstallStatus();
          if (!install.installed) throw new Error("bundled Runtime installation did not become ready");
          let terminalOutput = "";
          let terminal;
          const offData = api.onTerminalData((event) => {
            if (!terminal || event.id !== terminal.id) return;
            terminalOutput += event.data;
            if (terminalOutput.includes("OPENDRSAI_MACOS_PTY_OK")) {
              clearTimeout(timeout);
              offData();
              Promise.resolve(api.killTerminal(terminal.id)).then(() => resolve({ descriptor, install, terminal, terminalOutput }));
            }
          });
          terminal = await api.createTerminal({ shellProfile: "zsh", title: "Packaged smoke", cols: 80, rows: 24 });
          await api.writeTerminal(terminal.id, "printf 'OPENDRSAI_MACOS_PTY_OK\\n'\\n");
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      })`, true);
      await writeFile(output, `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`, "utf8");
      app.exit(0);
    } catch (error) {
      await writeFile(output, `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, "utf8").catch(() => undefined);
      app.exit(1);
    }
  });
}
