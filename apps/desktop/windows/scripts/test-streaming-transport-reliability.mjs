import assert from "node:assert/strict";

const { StreamingTransportReliability } = await import("../../shared/main/voiceStreaming/transportReliability.ts");
const policy = { connectTimeoutMs: 100, idleTimeoutMs: 200, totalTimeoutMs: 1_000, heartbeatIntervalMs: 50, reconnectWindowMs: 150, maxReconnectAttempts: 2, supportsResume: true };
const connection = new StreamingTransportReliability(0, policy);
assert.deepEqual(connection.poll(49), { heartbeatDue: false, timeout: null });
assert.deepEqual(connection.poll(50), { heartbeatDue: true, timeout: null });
assert.equal(connection.connected(60), true);
connection.activity(100);
assert.equal(connection.setBackpressured(true, 110), true);
assert.equal(connection.snapshot.state, "backpressured");
assert.equal(connection.setBackpressured(false, 120), true);
assert.deepEqual(connection.poll(319), { heartbeatDue: true, timeout: null });
assert.deepEqual(connection.poll(320), { heartbeatDue: false, timeout: "idle" });
assert.equal(connection.finish(), false);

const connectTimeout = new StreamingTransportReliability(0, policy);
assert.deepEqual(connectTimeout.poll(100), { heartbeatDue: false, timeout: "connect" });
const totalTimeout = new StreamingTransportReliability(0, policy);
totalTimeout.connected(10);
for (let now = 100; now < 1_000; now += 100) totalTimeout.activity(now);
assert.deepEqual(totalTimeout.poll(1_000), { heartbeatDue: false, timeout: "total" });

const reconnect = new StreamingTransportReliability(0, policy);
reconnect.connected(1);
reconnect.disconnect(20);
assert.equal(await reconnect.reconnect(() => false, 30), "not_disconnected");
assert.equal(await reconnect.reconnect(() => true, 40), "reconnected");
assert.equal(reconnect.snapshot.reconnectAttempts, 2);

const exhausted = new StreamingTransportReliability(0, policy);
exhausted.connected(1);
exhausted.disconnect(20);
assert.equal(await exhausted.reconnect(() => false, 30), "not_disconnected");
assert.equal(await exhausted.reconnect(() => false, 40), "exhausted");
assert.equal(await exhausted.reconnect(() => true, 50), "exhausted");
const expired = new StreamingTransportReliability(0, policy);
expired.connected(1);
expired.disconnect(20);
assert.equal(await expired.reconnect(() => true, 171), "expired");
const unsupported = new StreamingTransportReliability(0, { ...policy, supportsResume: false });
unsupported.connected(1);
unsupported.disconnect(20);
assert.equal(await unsupported.reconnect(() => true, 30), "unsupported");
assert.throws(() => new StreamingTransportReliability(0, { ...policy, heartbeatIntervalMs: 0 }), /positive/);
assert.throws(() => new StreamingTransportReliability(0, { ...policy, idleTimeoutMs: 2_000 }), /total timeout/);

console.log("Streaming transport reliability tests passed (watermarks, heartbeat, connect/idle/total timeout, reconnect, expiry, and unsupported resume).");
