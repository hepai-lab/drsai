/**
 * The workbench Windows shell: one window, one bridge, one Runtime.
 *
 * Compare with `index.ts`, which is 7,229 lines.  The difference is not that this
 * shell does less -- it opens a window, owns the Runtime process lifecycle,
 * enforces the navigation policy and shuts down cleanly, same as the other one.
 * The difference is that the ~200 IPC handlers that make up most of `index.ts`
 * are, here, one `ipcMain.handle` registered by `shared/main/desktopGateway`.
 *
 * Everything platform-shaped lives here and nothing else does: `verify-
 * architecture-boundaries.mjs` forbids shared code from importing a platform
 * shell, so the direction of that dependency is checked rather than trusted.
 */

// Same side-effect as legacy `index.ts`: pin DRSAI_HOME / DRSAI_REPO /
// OPENDRSAI_RUNTIME_ROOT before `paths.ts` is evaluated, so this shell finds the
// developer install's Python instead of falling back to `~/.drsai/drsai-agent`.
import "./developmentLaunchEnvironment";

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { createDesktopSurface, type DesktopSurface } from "../../../shared/main/desktopGateway";

let surface: DesktopSurface | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Set when something else already owns the desktop gateway on port 28643 -- a
 * manually started `python -m drsai.backend.desktop_gateway`, or a watcher.
 * Spawning a second uvicorn against the same SQLite file is how a session ends
 * up with interleaved writes from two journals, so the shell defers rather than
 * competing.
 *
 * Deliberately *not* `DRSAI_GATEWAY_DEV_MANAGED`: that flag means the **legacy**
 * gateway on 28642 is already up. Standing down for it would leave this shell on
 * a Runtime that does not serve any of its 17 routes.
 */
const EXTERNAL_RUNTIME = process.env.OPENDRSAI_WORKBENCH_EXTERNAL_RUNTIME === "1";

/** Isolate workbench session state from the frozen legacy gateway's SQLite. */
const WORKBENCH_STATE_HOME =
  process.env.DRSAI_DESKTOP_GATEWAY_HOME?.trim() || join(homedir(), ".drsai-workbench");

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "OpenDrSai",
    webPreferences: {
      preload: join(__dirname, "../preload/workbench.js"),
      // The three settings that make the preload bridge meaningful. With
      // `contextIsolation` off, the renderer could reach into the preload's
      // scope and call `ipcRenderer` directly, and the nineteen-method surface
      // would be a suggestion rather than a boundary.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The preview pane renders workspace files; a file that navigates or
      // opens a window must not be able to.
      webviewTag: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External links open in the user's browser, never in a window that has the
  // bridge attached.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  window.webContents.on("will-navigate", (event, url) => {
    if (is.dev && rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  if (is.dev && rendererUrl) {
    void window.loadURL(`${rendererUrl}/workbench.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/workbench.html"));
  }
  return window;
}

void app.whenReady().then(async () => {
  surface = await createDesktopSurface({
    ipcMain,
    externalRuntime: EXTERNAL_RUNTIME,
    stateHome: WORKBENCH_STATE_HOME,
    onRuntimeLog: (line) => process.stdout.write(line),
  });

  mainWindow = createWindow();
  // Registering the WebContents is what authorises it: a message from any frame
  // this shell did not register is refused by the IPC layer.
  surface.ipc.register(mainWindow.webContents);

  // Deliberately not awaited. The Runtime takes tens of seconds to import on a
  // cold filesystem, and the window shows "starting" rather than nothing --
  // `runtime.identity` reports `reachable: false` until it is up.
  void surface.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length) return;
    mainWindow = createWindow();
    surface?.ipc.register(mainWindow.webContents);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Tears down the subscriptions and the Runtime child. Without this a quit
  // while a run is streaming leaves a detached uvicorn holding the port, and the
  // next launch adopts a Runtime nobody is watching.
  surface?.dispose();
  surface = null;
});
