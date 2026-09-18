import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LatestOperationGate } from "../renderer/src/auth/latestOperationGate.ts";
import { broadcastAuthSessionRestored } from "../../windows/src/main/authSessionBroadcast.ts";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const first = deferred<boolean>();
const second = deferred<boolean>();
const gate = new LatestOperationGate<boolean>();
const firstTicket = gate.start(async () => first.promise);
gate.invalidate();
const secondTicket = gate.start(async () => second.promise);

first.resolve(true);
assert.equal(await firstTicket.promise, true);
assert.equal(firstTicket.isCurrent(), false, "Replaced bootstrap must be stale.");
assert.equal(firstTicket.release(), false, "Stale cleanup must not release the replacement bootstrap.");
assert.equal(gate.current, secondTicket.promise);

second.resolve(true);
assert.equal(await secondTicket.promise, true);
assert.equal(secondTicket.isCurrent(), true);
assert.equal(secondTicket.release(), true);
assert.equal(gate.current, null);

function renderer(destroyed = false) {
  const channels: string[] = [];
  return {
    channels,
    isDestroyed: () => destroyed,
    send: (channel: string) => channels.push(channel),
  };
}

const initiating = renderer();
const peer = renderer();
const destroyedRenderer = renderer(true);
const destroyedWindowRenderer = renderer();
broadcastAuthSessionRestored([
  { isDestroyed: () => false, webContents: initiating },
  { isDestroyed: () => false, webContents: peer },
  { isDestroyed: () => false, webContents: destroyedRenderer },
  { isDestroyed: () => true, webContents: destroyedWindowRenderer },
], initiating);

assert.deepEqual(initiating.channels, [], "The IPC caller must consume its login result without a duplicate event.");
assert.deepEqual(peer.channels, ["desktop:auth-session-restored"]);
assert.deepEqual(destroyedRenderer.channels, []);
assert.deepEqual(destroyedWindowRenderer.channels, []);

const windowsMainSource = await readFile(
  new URL("../../windows/src/main/index.ts", import.meta.url),
  "utf8",
);
const callerExcludedBroadcasts = windowsMainSource.match(
  /broadcastAuthSessionRestored\(BrowserWindow\.getAllWindows\(\), event\.sender\)/g,
) ?? [];
assert.equal(
  callerExcludedBroadcasts.length,
  2,
  "Password and OIDC login handlers must both exclude their initiating renderer.",
);

console.log("Desktop auth/bootstrap coordination verification passed.");
