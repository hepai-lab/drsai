/**
 * The context bridge: `window.drsai`.
 *
 * This file is the entire boundary between the renderer and the machine.  It
 * contains no logic beyond marshalling, and that is the design: anything with a
 * decision in it belongs on the main-process side of the bridge, where the
 * renderer cannot reach it.
 *
 * Two things are deliberately *not* here:
 *
 * - **No token.**  Neither the pairing token nor the HepAI bearer crosses this
 *   bridge.  See the header of `api/desktopBridge.ts` for why -- briefly, the
 *   renderer also displays model output and previewed workspace files, and a
 *   credential in that context is a credential in reach of that content.
 * - **No `ipcRenderer`.**  Exposing it, even wrapped, would hand the renderer
 *   every channel the main process has ever registered, including the ~200
 *   legacy `desktop:*` ones. The renderer gets nineteen methods and one event
 *   channel, and cannot name anything else.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  BRIDGE_EVENT_CHANNEL,
  BRIDGE_INVOKE_CHANNEL,
  type DesktopBridge,
  type BridgeMethod,
  type BridgeResult,
  type BridgeSessionEvent,
} from "../../api/desktopBridge";

function invoke<T>(method: BridgeMethod, request?: unknown): Promise<BridgeResult<T>> {
  return ipcRenderer.invoke(BRIDGE_INVOKE_CHANNEL, method, request) as Promise<
    BridgeResult<T>
  >;
}

const bridge: DesktopBridge = {
  runtime: {
    identity: () => invoke("runtime.identity"),
  },
  auth: {
    session: () => invoke("auth.session"),
    login: () => invoke("auth.login"),
    logout: () => invoke("auth.logout"),
  },
  workspaces: {
    list: () => invoke("workspaces.list"),
    open: (input) => invoke("workspaces.open", input),
    files: (input) => invoke("workspaces.files", input),
    readFile: (input) => invoke("workspaces.readFile", input),
  },
  sessions: {
    list: (input) => invoke("sessions.list", input),
    create: (input) => invoke("sessions.create", input),
    get: (input) => invoke("sessions.get", input),
    rename: (input) => invoke("sessions.rename", input),
    archive: (input) => invoke("sessions.archive", input),
    subscribe: (input) => invoke("sessions.subscribe", input),
    unsubscribe: (input) => invoke("sessions.unsubscribe", input),
  },
  chat: {
    send: (input) => invoke("chat.send", input),
    cancel: (input) => invoke("chat.cancel", input),
  },
  models: {
    catalog: () => invoke("models.catalog"),
  },
  voice: {
    transcribe: (input) => invoke("voice.transcribe", input),
  },
  onSessionEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: BridgeSessionEvent): void => {
      // A throwing listener is the renderer's bug, but letting it escape here
      // surfaces as an unhandled error inside Electron's IPC plumbing, which is
      // reported without the component stack that would identify the cause.
      try {
        listener(payload);
      } catch (error) {
        console.error("desktop bridge session listener failed", error);
      }
    };
    ipcRenderer.on(BRIDGE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(BRIDGE_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("drsai", bridge);

// The renderer branches on this rather than on `window.drsai`, so a partially
// initialised bridge (an exception midway through `exposeInMainWorld`) reads as
// absent rather than as present-but-broken.
contextBridge.exposeInMainWorld("drsaiBridgeReady", true);
