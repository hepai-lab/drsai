import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  connectAuthoritativeRuntimeClient,
  createRuntimeEndpointKey,
  invalidateRuntimeClientRegistry,
  promoteRuntimeAccess,
  type RuntimeAccess,
  type RuntimeClient,
  type RuntimeIdentity,
} from "../../shared/main/runtimeClient";
import { getSessionHistorySyncDiagnostics, invalidateSessionHistorySync, syncSessionHistorySingleflight } from "../../shared/main/sessionHistorySync";
import { ThreadSnapshotCoordinator } from "../../shared/renderer/src/threadSnapshotCoordinator";

const root = resolve(process.cwd(), "../../..");
const identity: RuntimeIdentity = {
  runtime_id: "runtime-authoritative",
  instance_id: "instance-a",
  version: "p9",
  protocol_version: 2,
  platform: "test",
};
const access: RuntimeAccess = {
  baseUrl: "http://127.0.0.1:18642",
  headers: { "X-OpenDrSai-Gateway-Token": "test-token" },
  identity: { location: "local", routeId: "pid:42" },
};

const promoted = promoteRuntimeAccess(access, identity);
assert.equal(promoted.identity?.routeId, "pid:42");
assert.equal(promoted.identity?.runtimeId, identity.runtime_id);
assert.equal(promoted.identity?.instanceId, identity.instance_id);
assert.notEqual(createRuntimeEndpointKey(promoted), createRuntimeEndpointKey(access));
assert.notEqual(
  createRuntimeEndpointKey(promoteRuntimeAccess(access, { ...identity, instance_id: "instance-b" })),
  createRuntimeEndpointKey(promoted),
  "Runtime restart must create a distinct stream generation",
);
assert.notEqual(createRuntimeEndpointKey({ ...access, identity: { ...access.identity, authGeneration: "tunnel-a" } }),
  createRuntimeEndpointKey({ ...access, identity: { ...access.identity, authGeneration: "tunnel-b" } }),
  "Remote retunnel generation must rotate the client identity even when a loopback port is reused");

let handshakes = 0;
let invalidations = 0;
const factory = (resolved: RuntimeAccess): RuntimeClient => ({
  location: "local",
  streamIdentity: createRuntimeEndpointKey(resolved),
  lifecycleState: "active",
  invalidate: () => { invalidations += 1; },
  close: () => undefined,
  getRuntime: async () => { handshakes += 1; await Promise.resolve(); return identity; },
} as unknown as RuntimeClient);
const [first, second] = await Promise.all([
  connectAuthoritativeRuntimeClient(access, factory),
  connectAuthoritativeRuntimeClient(access, factory),
]);
assert.equal(first, second, "Concurrent connects must share the authoritative client");
assert.equal(handshakes, 1, "Concurrent connects must perform one Runtime handshake");
assert.equal(first.streamIdentity, createRuntimeEndpointKey(promoted));
assert.equal(invalidations, 1, "Promotion must invalidate exactly the provisional generation");
assert.equal(await connectAuthoritativeRuntimeClient(access, factory), first, "Sequential connects must reuse the authoritative generation");
assert.equal(handshakes, 1, "Sequential reuse must not recreate a provisional client and invalidate active streams");
invalidateRuntimeClientRegistry();

// Cancellation is physical: when the final waiter leaves, the shared backend
// request receives AbortSignal rather than merely having its result discarded.
let backendSignal: AbortSignal | undefined;
let rejectBackend: ((error: unknown) => void) | undefined;
const historyClient = {
  streamIdentity: "history-client",
  syncBackendSessionHistory: (_sessionId: string, signal?: AbortSignal) => {
    backendSignal = signal;
    return new Promise((_resolve, reject) => { rejectBackend = reject; signal?.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  },
} as unknown as RuntimeClient;
const controller = new AbortController();
const pending = syncSessionHistorySingleflight(historyClient, "session", { signal: controller.signal });
controller.abort(new DOMException("cancel test", "AbortError"));
await assert.rejects(pending, /cancel test|AbortError/);
assert.equal(backendSignal?.aborted, true, "Backend hydration request must be aborted");
rejectBackend = undefined;
invalidateSessionHistorySync();

const pendingHistory = new Map<string, { resolve(value: unknown): void; signal?: AbortSignal }>();
const pressureClient = {
  streamIdentity: "history-pressure",
  syncBackendSessionHistory: (sessionId: string, signal?: AbortSignal) => new Promise((resolve, reject) => {
    pendingHistory.set(sessionId, { resolve, signal });
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }),
} as unknown as RuntimeClient;
const pressurePromises = Array.from({ length: 140 }, (_, index) => syncSessionHistorySingleflight(pressureClient, `s-${index}`));
assert.deepEqual(getSessionHistorySyncDiagnostics(), { entries: 140, active: 140, recent: 0, waiters: 140 },
  "Active syncs must never be evicted by the recent-cache limit");
invalidateSessionHistorySync(pressureClient, "s-0");
assert.equal(pendingHistory.get("s-0")?.signal?.aborted, true);
for (let index = 1; index < 140; index += 1) pendingHistory.get(`s-${index}`)?.resolve({ backend_id: "codex", imported: 0, total: 0 });
await Promise.allSettled(pressurePromises);
assert.equal(getSessionHistorySyncDiagnostics().active, 0);
assert.ok(getSessionHistorySyncDiagnostics().entries <= 128, "Recent-success cache must be bounded after active work settles");
invalidateSessionHistorySync();

const cursor = new ThreadSnapshotCoordinator();
const envelope = { version: 1 as const, projection: "oaep/1" as const, threadId: "thread", runtimeSessionId: "session",
  generation: 4, sessionSequence: 10, snapshot: { threadId: "thread", title: "test", messages: [], updatedAt: new Date().toISOString() } };
let contentVersion = 0;
assert.equal(cursor.commitEnvelope(envelope, () => { contentVersion = 1; }), true);
assert.deepEqual(cursor.get("thread"), { generation: 4, appliedSequence: 10, acceptedSequence: 10,
  consecutiveResyncFailures: 0, actionRequired: false });
assert.throws(() => cursor.commitEnvelope({ ...envelope, sessionSequence: 11 }, () => { throw new Error("projection failed"); }));
assert.equal(cursor.get("thread")?.appliedSequence, 10, "Failed projection must roll back its cursor atomically");
assert.equal(cursor.acceptPatch({ version: 1, projection: "oaep/1", threadId: "thread", runtimeSessionId: "session",
  generation: 4, baseSequence: 10, sessionSequence: 11, patch: { kind: "connection.state", connectionState: "connected" } }), true);
assert.equal(cursor.acceptPatch({ version: 1, projection: "oaep/1", threadId: "thread", runtimeSessionId: "session",
  generation: 4, baseSequence: 13, sessionSequence: 14, patch: { kind: "connection.state", connectionState: "connected" } }), false);
cursor.noteResyncFailure("thread"); cursor.noteResyncFailure("thread"); cursor.noteResyncFailure("thread");
assert.equal(cursor.canResync("thread"), false, "Resync must become action-required after a bounded failure count");

const app = readFileSync(resolve(root, "apps/desktop/shared/renderer/src/App.tsx"), "utf8");
const preload = readFileSync(resolve(root, "apps/desktop/shared/main/preload.ts"), "utf8");
const windowsMain = readFileSync(resolve(root, "apps/desktop/windows/src/main/index.ts"), "utf8");
const remoteWorkspace = readFileSync(resolve(root, "apps/desktop/windows/src/main/remoteWorkspace.ts"), "utf8");
assert.match(app, /cancelThreadSnapshotHydration\(active\.requestId\)/);
assert.match(preload, /desktop:cancel-thread-snapshot-hydration/);
assert.match(windowsMain, /controller\.abort\(new DOMException\("Hydration cancelled\./);
assert.match(windowsMain, /controller\.signal\.aborted && error instanceof Error && error\.name === "AbortError"\) return null/);
assert.match(remoteWorkspace, /authGeneration: `\$\{host\.alias\}:\$\{host\.createdAt\}:\$\{host\.reconnectCount\}:\$\{host\.instanceTracker\.generation\}`/);

console.log(JSON.stringify({ passed: true, handshakes, authoritativeIdentity: first.streamIdentity,
  physicalHydrationCancellation: true, atomicWaterline: contentVersion === 1, boundedResync: true,
  activeSyncPressure: 140, recentCacheBounded: true }));
