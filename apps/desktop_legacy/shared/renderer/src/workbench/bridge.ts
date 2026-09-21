/**
 * The renderer's only door to the outside: `window.drsai`.
 *
 * Nothing in `src/workbench/` may import `electron`, open a socket, or read a file.  If
 * a component needs something the bridge does not expose, the answer is a new
 * method on the bridge, reviewed once in `shared/api/desktopBridge.ts` -- not a
 * new capability granted to the renderer.
 *
 * `unwrap` exists because every bridge call resolves to a tagged result rather
 * than rejecting.  Components mostly want the value or a message to show, so
 * they get `unwrap` (throws, for use inside a try) and `attempt` (returns a
 * discriminated pair, for use where a failure is an expected outcome rather than
 * an exception -- a sign-in that the user cancelled, for instance).
 */

import type {
  DesktopBridge,
  BridgeFailure,
  BridgeResult,
} from "../../../api/desktopBridge";

declare global {
  interface Window {
    drsai?: DesktopBridge;
    drsaiBridgeReady?: boolean;
  }
}

export function hasBridge(): boolean {
  // The readiness flag is set last by the preload script, so a bridge that
  // failed halfway through `exposeInMainWorld` reads as absent rather than as
  // present-but-missing-methods.
  return Boolean(window.drsaiBridgeReady && window.drsai);
}

export function bridge(): DesktopBridge {
  const value = window.drsai;
  if (!value) throw new Error("The OpenDrSai desktop bridge is unavailable.");
  return value;
}

export class BridgeError extends Error {
  readonly failure: BridgeFailure;

  constructor(failure: BridgeFailure) {
    super(failure.message);
    this.name = "BridgeError";
    this.failure = failure;
  }
}

export async function unwrap<T>(call: Promise<BridgeResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw new BridgeError(result.error);
  return result.value;
}

export async function attempt<T>(
  call: Promise<BridgeResult<T>>,
): Promise<{ value: T; error: null } | { value: null; error: BridgeFailure }> {
  const result = await call;
  return result.ok ? { value: result.value, error: null } : { value: null, error: result.error };
}

/**
 * A sentence to show the user.
 *
 * The gateway's `message` is written for a developer reading a log; a few codes
 * have a user-facing meaning worth stating plainly, and the rest fall back to the
 * server's own text rather than to a generic "something went wrong" that hides
 * what actually happened.
 */
export function describeFailure(failure: BridgeFailure): string {
  switch (failure.code) {
    case "runtime_unreachable":
      return "The OpenDrSai Runtime is not responding. It may still be starting.";
    case "runtime_timeout":
      return "The Runtime took too long to answer. It is probably busy rather than broken.";
    case "gateway_unauthorized":
      return "This desktop is not paired with the Runtime. Restart OpenDrSai.";
    case "credential_unavailable":
    case "token_expired":
      return "Your session has expired. Sign in again to continue.";
    case "not_found":
      return "That conversation no longer exists.";
    case "bridge_sender_refused":
      return "This view is not allowed to make that request.";
    default:
      return failure.message;
  }
}
