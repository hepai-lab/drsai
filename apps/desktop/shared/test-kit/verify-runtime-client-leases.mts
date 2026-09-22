import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Shared Runtime client ownership regression.
 *
 * The Desktop used to lose live conversations like this: an Agent Square /
 * workspace-catalog IPC read called `LocalRuntimeClient.connect()` and then
 * `close()` in a `finally`, aborting the shared transport of an OAEP stream that
 * was rendering an answer. Every request of that stream then failed pre-flight
 * (`runtime_client_generation_invalidated`), the subscription retried an already
 * dead client 120 times (about three and a half minutes of "Connection retry")
 * and degraded, leaving the Session outbox acknowledgement pending forever.
 *
 * This suite runs the production modules with no Runtime at all. Every Runtime
 * transport is a controlled stub, so the ownership rules can be verified
 * deterministically: reference counting on release/invalidation, generation
 * rebinding instead of blind retries, and outbox release on a degraded stream.
 */
const root = await mkdtemp(join(tmpdir(), "opendrsai-runtime-lease-"));
process.env.DRSAI_HOME = root;
// A subscription that cannot make progress must give up in seconds. Production
// keeps the documented three-minute interruption budget instead.
process.env.OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS = "1500";

const SESSION = "session-lease-1";
const SESSION_STUCK = "session-lease-stuck";

/** SSE bytes for one Session Event; the stream stays open until it is cancelled. */
function openSseStream(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
  });
}

try {
  const [runtime, oaep, sync, delivery, recovery, diagnostics, protocol] = await Promise.all([
    import("../main/runtimeClient.ts"),
    import("../main/oaepSessionStream.ts"),
    import("../main/sessionSyncState.ts"),
    import("../main/messageDelivery.ts"),
    import("../main/networkRecovery.ts"),
    import("../main/diagnostics.ts"),
    import("../api/oaep.generated.ts"),
  ]);

  const generationInvalidated = () => new runtime.RuntimeClientGenerationInvalidatedError();

  /**
   * One Runtime transport. `invalidate()` models the real HttpRuntimeClient:
   * the AbortController is aborted, so every later request fails before it
   * reaches the network — retrying such a client can never succeed.
   */
  function createTransport(id, options = {}) {
    const transport = {
      streamIdentity: `runtime:stub-${id}:generation-${id}`,
      location: "local",
      lifecycleState: "active",
      closed: 0,
      aborted: false,
      snapshotCalls: 0,
      close() {
        transport.closed += 1;
        transport.lifecycleState = "disposed";
      },
      invalidate() {
        transport.aborted = true;
        transport.lifecycleState = "invalidated";
      },
      async getOaepSnapshot() {
        transport.snapshotCalls += 1;
        options.onSnapshot?.(transport);
        if (transport.aborted) throw generationInvalidated();
        return {
          version: protocol.OAEP_VERSION,
          session: { id: options.sessionId ?? SESSION },
          snapshot_sequence: options.snapshotSequence ?? 0,
          runs: [],
          items: [],
        };
      },
      async listOaepEvents() {
        if (transport.aborted) throw generationInvalidated();
        return { data: options.replay ?? [], has_more: false };
      },
      async openOaepEventStream() {
        if (transport.aborted) throw generationInvalidated();
        return { events: openSseStream(options.streamFrames ?? []) };
      },
    };
    return transport;
  }

  const oaepEvent = (sequence, type, extra = {}) => ({
    version: protocol.OAEP_VERSION,
    event_id: `event-${sequence}`,
    session_id: SESSION,
    dedupe_key: `dedupe-${sequence}`,
    sequence,
    type,
    timestamp: new Date(1_700_000_000_000 + sequence).toISOString(),
    source: { backend: "stub-runtime" },
    data: {},
    ...extra,
  });

  // ---------------------------------------------------------------------------
  // A shared transport is reference counted: a released lease must not tear the
  // transport out from under another holder (catalog read vs. live OAEP stream).
  // ---------------------------------------------------------------------------
  runtime.clearRuntimeClientLifecycleLog();
  const leased = createTransport("leased");
  const registryEntryFor = (identity) => runtime.getRuntimeClientRegistryDiagnostics().find((entry) => entry.endpointKey === identity);

  const firstLease = runtime.retainRuntimeClient(leased);
  const secondLease = runtime.retainRuntimeClient(leased);
  assert.equal(registryEntryFor(leased.streamIdentity)?.references, 2, "Two holders must be recorded on one shared transport.");

  firstLease();
  assert.equal(leased.closed, 0, "Releasing one lease must not terminate a transport another holder is still using.");
  assert.equal(registryEntryFor(leased.streamIdentity)?.references, 1);
  assert.equal(registryEntryFor(leased.streamIdentity)?.retireRequested, false, "A plain release must not retire the transport.");

  secondLease();
  assert.equal(leased.closed, 1, "The last release disposes the transport exactly once.");
  assert.equal(registryEntryFor(leased.streamIdentity), undefined, "A disposed transport must leave the registry.");
  secondLease();
  assert.equal(leased.closed, 1, "Releasing the same lease twice must not close the transport twice.");
  assert.throws(
    () => runtime.retainRuntimeClient(leased),
    (error) => runtime.isRuntimeClientGenerationInvalidated(error),
    "A disposed generation must be reported as unrecoverable by retrying.",
  );
  assert.deepEqual(
    runtime.getRuntimeClientLifecycleLog().filter((record) => record.endpointKey === leased.streamIdentity).map((record) => record.action),
    ["released", "disposed"],
    "The lifecycle journal must attribute every lease release and disposal.",
  );

  // ---------------------------------------------------------------------------
  // A finite catalog read leases the shared transport and must never close it.
  // ---------------------------------------------------------------------------
  const catalogTransport = createTransport("catalog-shared");
  const streamLease = runtime.retainRuntimeClient(catalogTransport);
  const catalogLease = await runtime.acquireRuntimeClientLease(async () => ({ client: catalogTransport, workspaceId: "" }));
  assert.equal(catalogTransport.closed, 0);
  catalogLease.release();
  assert.equal(catalogTransport.closed, 0, "A finite catalog read must not close the transport a live stream is sharing.");
  assert.equal(registryEntryFor(catalogTransport.streamIdentity)?.references, 1, "The live stream must still hold the transport after the catalog read.");
  streamLease();
  assert.equal(catalogTransport.closed, 1);

  // The lease helper is the only way catalogs acquire a client, so it must also
  // survive the connect/retain race: a previous owner can release the last
  // reference between resolving and retaining.
  const racingTransport = createTransport("catalog-racing");
  let attempts = 0;
  const recoveredLease = await runtime.acquireRuntimeClientLease(async () => {
    attempts += 1;
    if (attempts < 3) throw generationInvalidated();
    return { client: racingTransport, workspaceId: "" };
  });
  assert.equal(attempts, 3, "A generation change while leasing must be retried within the documented budget.");
  recoveredLease.release();
  let failures = 0;
  await assert.rejects(
    () => runtime.acquireRuntimeClientLease(async () => { failures += 1; throw generationInvalidated(); }),
    (error) => runtime.isRuntimeClientGenerationInvalidated(error),
    "An exhausted lease retry must surface the generation change instead of handing out a dead client.",
  );
  assert.equal(failures, 3);

  // ---------------------------------------------------------------------------
  // The reported bug: a live subscription loses its Runtime generation in the
  // middle of a run (catalog close, gateway generation change). It must resolve
  // a replacement transport and resume from its own cursor, without re-running
  // the Run and without losing or duplicating an Event.
  // ---------------------------------------------------------------------------
  runtime.clearRuntimeClientLifecycleLog();
  const victim = createTransport("victim", {
    onSnapshot: () => runtime.invalidateRuntimeClientRegistry(victim.streamIdentity),
    replay: [
      oaepEvent(1, "event.run.started", { run_id: "run-1", data: { run: { id: "run-1", session_id: SESSION, status: "running" } } }),
      oaepEvent(2, "event.item.delta", { run_id: "run-1", item_id: "item-1", data: { delta: { kind: "message.delta", text: "hello" } } }),
    ],
    streamFrames: [
      oaepEvent(3, "event.item.delta", { run_id: "run-1", item_id: "item-1", data: { delta: { kind: "message.delta", text: " world" } } }),
    ],
  });
  const replacement = createTransport("replacement", {
    replay: [
      oaepEvent(1, "event.run.started", { run_id: "run-1", data: { run: { id: "run-1", session_id: SESSION, status: "running" } } }),
      oaepEvent(2, "event.item.delta", { run_id: "run-1", item_id: "item-1", data: { delta: { kind: "message.delta", text: "hello" } } }),
    ],
    streamFrames: [
      oaepEvent(3, "event.item.delta", { run_id: "run-1", item_id: "item-1", data: { delta: { kind: "message.delta", text: " world" } } }),
    ],
  });

  const delivered = [];
  let resolutions = 0;
  const subscription = await oaep.subscribeOaepSession(
    victim,
    SESSION,
    { onEvent: (event, _state, source) => delivered.push(`${source}:${event.sequence}`) },
    {
      resolveClient: async () => {
        resolutions += 1;
        return { client: replacement, release: runtime.retainRuntimeClient(replacement) };
      },
    },
  );

  // The rebind already happened when `ready` resolved (a rebound generation
  // must resnapshot and replay before the subscription is usable), and the
  // stability timer that resets `generationRebinds` only starts once the
  // long-lived stream is connected, so reading it here is deterministic.
  const rebindsAfterResume = oaep.getOaepSessionOwnershipDiagnostics().find((entry) => entry.sessionId === SESSION)?.generationRebinds;

  // Wait for the live SSE frame: replay delivery is queued on the listener chain.
  const deadline = Date.now() + 5_000;
  while (subscription.cursor < 3 && Date.now() < deadline) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));

  assert.equal(victim.snapshotCalls, 1, "An invalidated transport must be replaced, not retried.");
  assert.equal(resolutions, 1, "One invalidated generation must be replaced exactly once.");
  assert.equal(rebindsAfterResume, 1, "Replacing a dead generation must be counted as one rebind.");
  assert.deepEqual(delivered, ["replay:1", "replay:2", "stream:3"], "The resumed subscription must deliver each Event once, in order.");
  assert.equal(subscription.cursor, 3);
  assert.equal(subscription.metrics.reconnects, 1, "A generation rebind is one reconnect, not a retry storm.");
  assert.equal(subscription.metrics.degradedErrors, 0);
  assert.equal(subscription.metrics.fatalErrors, 0);
  assert.equal(subscription.terminalError, undefined, "A replaced transport must not degrade the subscription.");
  assert.equal(subscription.phase, "connected");
  assert.equal(victim.closed, 1, "The invalidated transport must be disposed once its last holder released it.");
  assert.equal(victim.lifecycleState, "disposed");

  const ownership = oaep.getOaepSessionOwnershipDiagnostics();
  assert.equal(ownership.length, 1, "The subscription must be owned by the replacement generation only.");
  assert.equal(ownership[0]?.endpointKey, replacement.streamIdentity);
  assert.equal(ownership[0]?.phase, "connected");
  const victimJournal = runtime.getRuntimeClientLifecycleLog().filter((record) => record.endpointKey === victim.streamIdentity);
  assert.deepEqual(victimJournal.map((record) => record.action), ["invalidated", "released", "disposed"]);
  assert.equal(victimJournal[0]?.references, 1, "The invalidation must record that a live holder owned the transport.");

  subscription.stop();
  await subscription.done;
  assert.equal(replacement.closed, 1, "Stopping the subscription must release and dispose its transport.");
  assert.equal(oaep.getOaepSessionOwnershipDiagnostics().length, 0);

  // ---------------------------------------------------------------------------
  // A Runtime that keeps handing out generations that die immediately must stay
  // bounded: rebinding is capped, and the subscription degrades in seconds
  // instead of burning the whole automatic retry budget.
  // ---------------------------------------------------------------------------
  const stuck = createTransport("stuck", { sessionId: SESSION_STUCK, onSnapshot: (transport) => transport.invalidate() });
  const stuckStartedAt = Date.now();
  let stuckResolutions = 0;
  const degraded = await oaep.subscribeOaepSession(
    stuck,
    SESSION_STUCK,
    { onEvent: () => undefined },
    {
      resolveClient: async () => {
        stuckResolutions += 1;
        const doomed = createTransport(`stuck-${stuckResolutions}`, {
          sessionId: SESSION_STUCK,
          onSnapshot: (transport) => transport.invalidate(),
        });
        return { client: doomed, release: runtime.retainRuntimeClient(doomed) };
      },
    },
  ).then(() => null, (error) => error);

  assert.ok(degraded, "A subscription that cannot make progress must fail instead of staying in retry forever.");
  assert.equal(degraded.name, "OaepSyncDegradedError");
  assert.equal(oaep.isOaepSyncDegradedError(degraded), true);
  assert.equal(degraded.code, "oaep_sync_degraded");
  assert.equal(stuckResolutions, oaep.MAX_GENERATION_REBINDS, "Generation rebinding must stay inside its configured bound.");
  assert.equal(stuck.snapshotCalls, 1, "The invalidated transport must never be retried again.");
  // Message-based classification cannot be trusted for a degraded stream: the
  // word "reconnect" in its message already matches the `ECONN` pattern, so a
  // caller that only consults `isRecoverableNetworkError` would keep retrying a
  // subscription that has explicitly given up. The degraded state therefore has
  // to be recognised by type or code before the generic recovery logic runs.
  assert.equal(recovery.isRecoverableNetworkError(degraded), true);
  assert.equal(oaep.isOaepSyncDegradedError(degraded), true);
  assert.ok(Date.now() - stuckStartedAt < 15_000, "A stuck subscription must degrade in seconds, not after the three-minute budget.");
  assert.equal(oaep.MAX_AUTOMATIC_RETRY_ATTEMPTS, 120, "The automatic retry budget must remain the documented three-minute tolerance.");
  const stuckOwnership = oaep.getOaepSessionOwnershipDiagnostics().find((entry) => entry.sessionId === SESSION_STUCK);
  assert.equal(stuckOwnership, undefined,
    "Initial ready rejection returns no stop handle, so it must release the failed subscription's ownership.");

  // ---------------------------------------------------------------------------
  // A Run whose Runtime acknowledgement this Desktop process can no longer
  // observe must release the Session outbox: the row is kept (the POST may have
  // been accepted) but marked failed, so the next send reconciles it instead of
  // rejecting with "Another Session message is awaiting Runtime acknowledgement."
  // ---------------------------------------------------------------------------
  const store = new sync.SessionSyncStateStore(join(root, "desktop", "session-sync-state.json"));
  const sessionId = "session-outbox-1";
  const sourceMessageId = "desktop:request-1";
  const idempotencyKey = "desktop-runtime-request-1";
  const payloadHash = sync.sessionPayloadHash({ messages: [{ role: "user", content: "hello" }] });

  await store.beginOutbox(sessionId, { sourceMessageId, idempotencyKey, payloadHash });
  await store.markOutboxDelivery(sessionId, sourceMessageId, "sending");
  await store.attachRun(sessionId, sourceMessageId, "run-42");
  await store.markOutboxDelivery(sessionId, sourceMessageId, "running");
  assert.equal((await store.get(sessionId)).outbox?.deliveryState, "running");

  assert.equal(await store.abandonOutbox(sessionId, sourceMessageId), true, "A degraded Run must release its outbox row.");
  const abandoned = (await store.get(sessionId)).outbox;
  assert.equal(abandoned?.deliveryState, "failed");
  assert.equal(abandoned?.runId, "run-42", "The Run id must survive so restart recovery can resolve that exact message.");
  assert.equal(abandoned?.idempotencyKey, idempotencyKey, "The idempotency key must survive so a resume cannot duplicate the POST.");
  assert.equal(await store.abandonOutbox(sessionId, sourceMessageId), false, "Abandoning twice must be a no-op.");
  assert.equal(await store.abandonOutbox(sessionId, "desktop:other-request"), false, "Another message must not release a different outbox row.");
  assert.equal(await store.abandonOutbox("session-outbox-missing", sourceMessageId), false, "An absent Session must not fail the release.");

  await assert.rejects(
    () => store.beginOutbox(sessionId, { sourceMessageId: "desktop:request-2", idempotencyKey: "desktop-runtime-request-2", payloadHash }),
    /awaiting Runtime acknowledgement/,
    "An unreconciled outbox row must still block a concurrent send.",
  );
  const pending = (await store.get(sessionId)).outbox;
  const stale = pending?.deliveryState === "failed" || pending?.deliveryState === "terminal";
  assert.equal(stale, true, "The abandoned row must be recognised as stale by the send path.");
  assert.equal(await store.completeOutboxIfMatches(sessionId, pending.sourceMessageId), true);
  await store.beginOutbox(sessionId, { sourceMessageId: "desktop:request-2", idempotencyKey: "desktop-runtime-request-2", payloadHash });
  assert.equal((await store.get(sessionId)).outbox?.sourceMessageId, "desktop:request-2", "The Session must accept the next message after a degraded Run.");
  assert.equal(delivery.advanceMessageDelivery("failed", "sending"), "sending", "The same message must stay retryable after an abandoned acknowledgement.");

  const terminalSessionId = "session-outbox-2";
  await store.beginOutbox(terminalSessionId, { sourceMessageId, idempotencyKey, payloadHash });
  await store.markOutboxDelivery(terminalSessionId, sourceMessageId, "sending");
  await store.attachRun(terminalSessionId, sourceMessageId, "run-43");
  await store.markOutboxDelivery(terminalSessionId, sourceMessageId, "running");
  await store.markOutboxDelivery(terminalSessionId, sourceMessageId, "terminal");
  assert.equal(await store.abandonOutbox(terminalSessionId, sourceMessageId), false, "A terminal Run must not be abandoned as degraded.");
  assert.equal((await store.get(terminalSessionId)).outbox?.deliveryState, "terminal");

  // ---------------------------------------------------------------------------
  // Catalog and configuration IPC must keep using leases: no module may close
  // the shared client or connect one behind the registry's back.
  // ---------------------------------------------------------------------------
  const entryFile = process.argv[2]
    ? resolve(process.argv[2])
    : join(process.cwd(), "shared", "test-kit", "verify-runtime-client-leases.mts");
  const mainDirectory = join(dirname(entryFile), "..", "main");
  for (const module of ["agents.ts", "workspaces.ts", "worktrees.ts"]) {
    const source = await readFile(join(mainDirectory, module), "utf8");
    assert.doesNotMatch(source, /client\.close\(\)/, `${module} must release its Runtime lease, not close the shared client.`);
    assert.doesNotMatch(source, /LocalRuntimeClient\.connect\(/, `${module} must take the Runtime client through a lease helper.`);
    const acquired = source.match(/acquireLocalRuntimeClientLease(?:IfAvailable)?\(/g) ?? [];
    const released = source.match(/\.release\(\)/g) ?? [];
    assert.ok(acquired.length > 0, `${module} must hold a lease while it uses the shared Runtime client.`);
    assert.equal(acquired.length, released.length, `${module} must release every Runtime client lease.`);
  }

  // ---------------------------------------------------------------------------
  // Killing a transport that a live holder still owns must be attributable in
  // the desktop diagnostics log, not only in the in-process journal.
  // ---------------------------------------------------------------------------
  const recorded = await Promise.all([
    pollDiagnostics(diagnostics.desktopDiagnostics, "runtime-client.invalidated"),
    pollDiagnostics(diagnostics.desktopDiagnostics, "runtime-client.disposed"),
  ]);
  const invalidated = recorded[0];
  assert.equal(invalidated?.attributes?.endpointKey, victim.streamIdentity);
  assert.equal(invalidated?.attributes?.references, 1, "The diagnostics record must carry the reference count at invalidation time.");
  assert.equal(invalidated?.status, "failed");
  assert.equal(recorded[1]?.component, "runtime-client-registry");

  console.log("Shared Runtime client lease, generation rebind, outbox release and lifecycle diagnostics verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}

async function pollDiagnostics(instance, operation) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = await instance.snapshot({ limit: 200 });
    const found = snapshot.events.find((event) => event.operation === operation);
    if (found) return found;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Diagnostics never recorded ${operation}.`);
}
