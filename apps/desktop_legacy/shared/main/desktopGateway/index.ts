/**
 * The desktop main-process surface: one call to stand the whole thing up.
 *
 * ```ts
 * const desktop = await createDesktopSurface({ ipcMain });
 * app.whenReady().then(async () => {
 *   const window = new BrowserWindow({ ... });
 *   desktop.ipc.register(window.webContents);
 * });
 * ```
 *
 * Composition lives here rather than in the platform shell so Windows and macOS
 * assemble the same object graph.  `shared/test-kit/verify-architecture-
 * boundaries.mjs` forbids shared code from importing a platform shell, and this
 * module is the reason that rule costs nothing: there is nothing platform-shaped
 * left in the shell but window creation.
 */

import { DesktopGatewayClient } from "./client";
import {
  cachedIdentity,
  DesktopIdentity,
  legacyAuthBackend,
  offlineAuthBackend,
  primeIdentity,
  type AuthBackend,
} from "./identity";
import { registerBridge, type BridgeHandle, type IpcMainLike } from "./ipc";
import {
  DESKTOP_GATEWAY_BASE_URL,
  DesktopRuntimeProcess,
  resolveInstanceToken,
} from "./runtimeProcess";
import { BridgeService } from "./service";
import { SessionStreamRegistry } from "./sessionStream";

export interface CreateDesktopSurfaceOptions {
  ipcMain: IpcMainLike;
  /** Defaults to the OIDC backend in `shared/main/auth.ts`. */
  auth?: AuthBackend;
  /** Skip launching a Runtime: the dev watcher already owns one. */
  externalRuntime?: boolean;
  /** Separate state root, so this surface and the frozen gateway share no database. */
  stateHome?: string;
  baseUrl?: string;
  instanceToken?: string;
  onRuntimeLog?: (line: string) => void;
}

export interface DesktopSurface {
  client: DesktopGatewayClient;
  identity: DesktopIdentity;
  runtime: DesktopRuntimeProcess;
  service: BridgeService;
  ipc: BridgeHandle;
  /**
   * Launch (or adopt) the Runtime and warm the identity cache.  Separate from
   * construction so the window can be shown while the Runtime is still starting:
   * `runtime.identity` reports `reachable: false` until it is ready, which the
   * renderer renders as "starting", not as an error.
   */
  start(): Promise<void>;
  dispose(): void;
}

export async function createDesktopSurface(
  options: CreateDesktopSurfaceOptions,
): Promise<DesktopSurface> {
  const runtime = new DesktopRuntimeProcess({
    external: options.externalRuntime,
    stateHome: options.stateHome,
    onLog: options.onRuntimeLog,
  });
  const backend =
    options.auth ??
    (await legacyAuthBackend().catch(() => {
      // A desktop with no credential store (a dev shell, a test harness) is a
      // signed-out desktop, not a broken one -- the gateway's offline branch
      // serves it.
      return offlineAuthBackend();
    }));
  const identity = new DesktopIdentity(backend);
  const readIdentity = cachedIdentity(identity);
  const client = new DesktopGatewayClient({
    baseUrl: options.baseUrl ?? DESKTOP_GATEWAY_BASE_URL,
    instanceToken: options.instanceToken ?? resolveInstanceToken(),
    identity: readIdentity,
  });
  const service = new BridgeService({
    client,
    identity,
    runtime,
    registry: new SessionStreamRegistry(client),
  });
  const ipc = registerBridge(options.ipcMain, service);

  return {
    client,
    identity,
    runtime,
    service,
    ipc,
    start: async () => {
      await Promise.all([
        runtime.ensureReady(),
        // A signed-out desktop is a normal state; failing to read credentials
        // must not stop the Runtime from coming up.
        primeIdentity(identity, readIdentity).catch(() => undefined),
      ]);
    },
    dispose: () => {
      ipc.dispose();
      runtime.stop();
    },
  };
}

export { DesktopGatewayClient } from "./client";
export { DesktopIdentity, offlineAuthBackend, type AuthBackend } from "./identity";
export { BridgeService, BridgeConnection } from "./service";
export { SessionStreamRegistry } from "./sessionStream";
export { BoundedEventDispatcher } from "./eventDispatcher";
export {
  DESKTOP_GATEWAY_BASE_URL,
  DESKTOP_GATEWAY_HOST,
  DESKTOP_GATEWAY_PORT,
  DesktopRuntimeProcess,
  resolveInstanceToken,
} from "./runtimeProcess";
export { registerBridge, type BridgeHandle } from "./ipc";
