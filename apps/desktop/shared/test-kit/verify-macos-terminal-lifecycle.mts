import assert from "node:assert/strict";

class FakePty {
  readonly pid: number;
  readonly process = "/bin/zsh";
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly kills: Array<string | undefined> = [];
  #data: Array<(data: string) => void> = [];
  #exit: Array<(event: { exitCode: number; signal?: number }) => void> = [];
  constructor(pid: number) { this.pid = pid; }
  onData(callback: (data: string) => void) { this.#data.push(callback); return { dispose() {} }; }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void) { this.#exit.push(callback); return { dispose() {} }; }
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]); }
  pause() {} resume() {} clear() {}
  kill(signal?: string) { this.kills.push(signal); this.emitExit(0); }
  emitData(data: string) { for (const callback of this.#data) callback(data); }
  emitExit(exitCode: number) { const callbacks = this.#exit.splice(0); for (const callback of callbacks) callback({ exitCode }); }
}

const terminal = await import("../../macos/src/main/terminal.ts");
const ptys: FakePty[] = [];
const spawnCalls: Array<{ file: string; args: string[] | string; options: { cwd?: string } }> = [];
terminal.configureMacosTerminalPtyFactory(((file: string, args: string[] | string, options: { cwd?: string }) => { spawnCalls.push({ file, args, options }); const pty = new FakePty(900_000 + ptys.length); ptys.push(pty); return pty; }) as never);
terminal.configureMacosRemoteTerminalResolver((options) => ({ file: "/usr/bin/ssh", args: ["-tt", options.remoteHostAlias!, "safe-command"], cwd: options.cwd! }));
const sender = (id: number) => ({ id, destroyed: false, events: [] as Array<[string, unknown]>, isDestroyed() { return this.destroyed; }, send(channel: string, value: unknown) { this.events.push([channel, value]); } });
const firstSender = sender(1); const otherSender = sender(2);
const firstEvent = { sender: firstSender } as never; const otherEvent = { sender: otherSender } as never;

try {
  const created = terminal.createTerminalSession(firstEvent, { cwd: process.cwd(), workspaceKey: "workspace-a", title: "  Test terminal  ", cols: 1, rows: 999 });
  assert.equal(created.title, "Test terminal"); assert.equal(created.shellProfile, "zsh");
  assert.equal(terminal.listTerminalSessions(otherEvent, "workspace-a").length, 0, "an active owner cannot be stolen");
  assert.equal(terminal.getTerminalBuffer(otherEvent, created.id), "", "buffer must not reveal another owner's output");
  assert.equal(terminal.writeTerminalSession(otherEvent, created.id, "secret"), false);
  assert.equal(terminal.writeTerminalSession(firstEvent, created.id, "echo ok\n"), true); assert.deepEqual(ptys[0]!.writes, ["echo ok\n"]);
  assert.equal(terminal.resizeTerminalSession(firstEvent, created.id, 1, 999), true); assert.deepEqual(ptys[0]!.resizes, [[20, 200]]);
  ptys[0]!.emitData("hello\n"); assert.equal(terminal.getTerminalBuffer(firstEvent, created.id), "hello\n");
  assert.equal(firstSender.events[0]?.[0], "desktop:terminal-data");

  terminal.detachTerminalSessionsForOwner(firstSender.id); firstSender.destroyed = true;
  assert.equal(terminal.listTerminalSessions(otherEvent).length, 0, "detached sessions require an explicit workspace scope");
  assert.equal(terminal.listTerminalSessions(otherEvent, "wrong-workspace").length, 0);
  assert.equal(terminal.listTerminalSessions(otherEvent, "workspace-a")[0]?.id, created.id, "new trusted renderer can reclaim the scoped session");
  ptys[0]!.emitData("replayed"); assert.equal(terminal.getTerminalBuffer(otherEvent, created.id), "hello\nreplayed");
  assert.equal(terminal.renameTerminalSession(otherEvent, created.id, "Recovered")?.title, "Recovered");
  assert.equal(terminal.killTerminalSession(otherEvent, created.id), true); assert.equal(terminal.killTerminalSession(otherEvent, created.id), false, "kill must be idempotent");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0)); assert.equal(terminal.listTerminalSessions(otherEvent, "workspace-a").length, 0);

  terminal.createTerminalSession(otherEvent, { cwd: process.cwd(), workspaceKey: "workspace-a", shellProfile: "bash" });
  terminal.createTerminalSession(otherEvent, { cwd: process.cwd(), workspaceKey: "workspace-a" });
  const remote = terminal.createTerminalSession(otherEvent, { cwd: "/srv/project", workspaceKey: "remote-a", workspaceId: "remote-1", remoteHostAlias: "alpha" });
  assert.equal(remote.cwd, "/srv/project"); assert.equal(spawnCalls.at(-1)?.file, "/usr/bin/ssh"); assert.deepEqual(spawnCalls.at(-1)?.args, ["-tt", "alpha", "safe-command"]); assert.equal(spawnCalls.at(-1)?.options.cwd, process.env.HOME || process.env.USERPROFILE);
  await terminal.killAllTerminalSessions(); assert.equal(terminal.listTerminalSessions(otherEvent, "workspace-a").length, 0);
  assert.equal(ptys.slice(1).every((pty) => pty.kills.length === 1), true);
  console.log("macOS PTY owner isolation, detach/reclaim, replay and process cleanup verification passed.");
} finally {
  await terminal.killAllTerminalSessions(); terminal.configureMacosTerminalPtyFactory(); terminal.configureMacosRemoteTerminalResolver();
}
