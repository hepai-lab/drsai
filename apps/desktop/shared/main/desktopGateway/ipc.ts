/**
 * The Electron binding: one `ipcMain.handle`, one connection per window.
 *
 * Everything that could be tested without Electron already was, in `service.ts`.
 * What is left here is the part that genuinely needs the framework -- deciding
 * whether a message may be served at all.
 *
 * ## Sender validation
 *
 * `ipcMain.handle` is reachable from any frame in any window, including an
 * `<iframe>` the file-preview pane rendered from workspace content.  A method
 * table that answers whoever asks would let a previewed HTML file call
 * `workspaces.readFile` on any path in the workspace and post the result out.
 *
 * So each `WebContents` must be registered by the code that created the window,
 * and a message from an unregistered sender -- or from a subframe rather than the
 * main frame -- is refused rather than served.  This is the same rule the legacy
 * shell applies; it is short here only because this surface has one channel
 * instead of two hundred.
 */

import {
  BRIDGE_EVENT_CHANNEL,
  BRIDGE_INVOKE_CHANNEL,
  isBridgeMethod,
  type BridgeResult,
} from "../../api/desktopBridge";
import type { BridgeConnection, BridgeService } from "./service";

/** The slice of Electron this module uses, named so it can be faked in tests. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcInvokeEventLike, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface IpcInvokeEventLike {
  readonly sender: WebContentsLike;
  /** Present on real Electron events; absent means "not from a frame we trust". */
  readonly senderFrame?: { readonly parent: unknown } | null;
}

export interface WebContentsLike {
  readonly id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): void;
}

const REFUSED: BridgeResult<never> = {
  ok: false,
  error: {
    code: "bridge_sender_refused",
    message: "This frame is not allowed to call the OpenDrSai desktop bridge.",
    retryable: false,
    status: 0,
  },
};

export interface BridgeHandle {
  /** Call for each window whose renderer is allowed to use the bridge. */
  register(contents: WebContentsLike): BridgeConnection;
  unregister(contents: WebContentsLike): void;
  dispose(): void;
}

export function registerBridge(
  ipcMain: IpcMainLike,
  service: BridgeService,
): BridgeHandle {
  const connections = new Map<number, BridgeConnection>();

  const unregister = (contents: WebContentsLike): void => {
    connections.get(contents.id)?.dispose();
    connections.delete(contents.id);
  };

  const register = (contents: WebContentsLike): BridgeConnection => {
    const existing = connections.get(contents.id);
    if (existing) return existing;
    const connection = service.createConnection({
      send: (channel, payload) => {
        // Between the dispatcher's flush and here, the window may have gone.
        if (!contents.isDestroyed()) contents.send(channel, payload);
      },
      isDestroyed: () => contents.isDestroyed(),
    });
    connections.set(contents.id, connection);
    // A reload destroys the WebContents; without this the connection would keep
    // a session subscription alive for a window that no longer exists.
    contents.once("destroyed", () => unregister(contents));
    return connection;
  };

  ipcMain.handle(BRIDGE_INVOKE_CHANNEL, async (event, ...args) => {
    const connection = connections.get(event.sender?.id ?? -1);
    if (!connection) return REFUSED;
    // `senderFrame.parent === null` identifies the top-level frame. An
    // unavailable senderFrame is treated as untrusted rather than assumed safe.
    if (event.senderFrame !== undefined && event.senderFrame?.parent !== null) return REFUSED;
    const [method, request] = args;
    if (!isBridgeMethod(method)) {
      return {
        ok: false,
        error: {
          code: "bridge_unknown_method",
          message: `Unknown bridge method: ${String(method)}`,
          retryable: false,
          status: 0,
        },
      } satisfies BridgeResult<never>;
    }
    return connection.invoke(method, request);
  });

  return {
    register,
    unregister,
    dispose: () => {
      for (const connection of connections.values()) connection.dispose();
      connections.clear();
      ipcMain.removeHandler(BRIDGE_INVOKE_CHANNEL);
      service.dispose();
    },
  };
}

export { BRIDGE_EVENT_CHANNEL, BRIDGE_INVOKE_CHANNEL };
