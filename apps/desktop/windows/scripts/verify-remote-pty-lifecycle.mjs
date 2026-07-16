import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temporary = join(root, ".cache", "remote-pty-lifecycle-test");
const bundle = join(temporary, "remotePtyLifecycle.mjs");
mkdirSync(temporary, { recursive: true });

class FakeSocket {
  constructor(throwOnSend = false) { this.throwOnSend = throwOnSend; }
  sent = [];
  closed = 0;
  listeners = new Set();
  send(value) { if (this.throwOnSend) throw new Error("send failed"); this.sent.push(value); }
  close() { this.closed += 1; }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
  emit(value) { for (const listener of [...this.listeners]) listener({ data: JSON.stringify(value) }); }
}

try {
  await build({ entryPoints: [join(root, "src", "main", "remotePtyLifecycle.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const { requestRemotePtyKill } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);

  const acknowledged = new FakeSocket();
  requestRemotePtyKill(acknowledged, "pty-1", 500);
  assert(acknowledged.sent.length === 1 && JSON.parse(acknowledged.sent[0]).type === "kill", "kill frame was not sent");
  assert(acknowledged.closed === 0, "socket closed before Runtime acknowledgement");
  acknowledged.emit({ type: "data", id: "pty-1" });
  assert(acknowledged.closed === 0, "unrelated message closed the socket");
  acknowledged.emit({ type: "killed", id: "other" });
  assert(acknowledged.closed === 0, "wrong PTY acknowledgement closed the socket");
  acknowledged.emit({ type: "killed", id: "pty-1" });
  assert(acknowledged.closed === 1 && acknowledged.listeners.size === 0, "matching acknowledgement did not close and detach once");

  const timedOut = new FakeSocket();
  requestRemotePtyKill(timedOut, "pty-2", 10);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  assert(timedOut.closed === 1 && timedOut.listeners.size === 0, "missing acknowledgement did not use bounded cleanup");

  const failedSend = new FakeSocket(true);
  requestRemotePtyKill(failedSend, "pty-3", 500);
  assert(failedSend.closed === 1 && failedSend.listeners.size === 0, "send failure did not clean up the socket");
  console.log("Remote PTY lifecycle passed: ack ordering, ID isolation, timeout and send-failure cleanup.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function assert(condition, message) { if (!condition) throw new Error(message); }
