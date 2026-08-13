import assert from "node:assert/strict";
const { PrewarmedStreamingSocketPool } = await import("../../shared/main/voiceStreaming/prewarmedSocketPool.ts");

const sockets = [];
const timers = [];
const cancelled = new Set();
const pool = new PrewarmedStreamingSocketPool({
  maxIdle: 2, idleTimeoutMs: 500,
  createSocket: (url) => { const socket = { url, readyState: 1, closed: null, close(code, reason) { this.closed = { code, reason }; } }; sockets.push(socket); return socket; },
  schedule: (callback) => { const timer = { callback }; timers.push(timer); return timer; },
  cancelSchedule: (timer) => cancelled.add(timer),
});
assert.equal(pool.prewarm("wss://one.test/stream", 3), 2, "pool must enforce the idle bound");
assert.equal(pool.acquire("wss://other.test/stream"), null, "sockets must be scoped to one upstream URL");
assert.equal(pool.acquire("wss://one.test/stream"), sockets[0], "a prewarm must be leased without opening another socket");
assert.ok(cancelled.has(timers[0]), "leasing must cancel the idle timeout");
timers[1].callback();
assert.deepEqual(sockets[1].closed, { code: 1000, reason: "prewarm idle timeout" });
assert.equal(pool.idleCount, 0);
pool.prewarm("wss://one.test/stream", 2);
pool.dispose();
assert.ok(sockets.slice(2).every((socket) => socket.closed?.reason === "prewarm pool disposed"));
console.log("Streaming socket pool tests passed (bounded prewarm, URL isolation, lease reuse, idle expiry, and disposal).");
