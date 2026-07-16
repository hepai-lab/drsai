"use strict";

// Runtime-owned ConPTY bridge. Stdout is reserved for newline-delimited JSON.
const readline = require("readline");
const crypto = require("crypto");
const modulePath = process.env.OWOP_NODE_PTY_MODULE;
const nodePty = modulePath ? require(modulePath) : require("node-pty");
const sessions = new Map();

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function reply(requestId, result, error) {
  send(error ? { kind: "response", requestId, error } : { kind: "response", requestId, result });
}
function session(id) {
  const value = sessions.get(id);
  if (!value) throw new Error(`Unknown PTY session: ${id}`);
  return value;
}

function command(message) {
  const { requestId, method, params = {} } = message;
  try {
    if (method === "create") {
      const id = `pty-${crypto.randomUUID()}`;
      const argv = params.argv;
      const pty = nodePty.spawn(argv[0], argv.slice(1), {
        name: "xterm-256color", cols: params.cols, rows: params.rows,
        cwd: params.cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      const state = { pty, active: false, pending: [], exited: null };
      sessions.set(id, state);
      pty.onData((data) => {
        if (!state.active) state.pending.push(data);
        else send({ kind: "event", event: "data", id,
          content_base64: Buffer.from(data, "utf8").toString("base64") });
      });
      pty.onExit(({ exitCode, signal }) => {
        state.exited = { exitCode, signal };
        if (state.active) {
          sessions.delete(id);
          send({ kind: "event", event: "exit", id, exit_code: exitCode, signal });
        }
      });
      reply(requestId, { pty_id: id, pid: pty.pid });
    } else if (method === "activate") {
      const state = session(params.pty_id);
      state.active = true;
      for (const data of state.pending) send({ kind: "event", event: "data", id: params.pty_id,
        content_base64: Buffer.from(data, "utf8").toString("base64") });
      state.pending.length = 0;
      if (state.exited) {
        sessions.delete(params.pty_id);
        send({ kind: "event", event: "exit", id: params.pty_id,
          exit_code: state.exited.exitCode, signal: state.exited.signal });
      }
      reply(requestId, { activated: true });
    } else if (method === "write") {
      const content = Buffer.from(params.content_base64, "base64");
      session(params.pty_id).pty.write(content.toString("utf8"));
      reply(requestId, { written: content.length });
    } else if (method === "resize") {
      session(params.pty_id).pty.resize(params.cols, params.rows);
      reply(requestId, { cols: params.cols, rows: params.rows });
    } else if (method === "kill") {
      session(params.pty_id).pty.kill();
      reply(requestId, { killed: true });
    } else if (method === "close") {
      for (const state of sessions.values()) try { state.pty.kill(); } catch (_) { /* gone */ }
      sessions.clear();
      reply(requestId, { closed: true });
      setImmediate(() => process.exit(0));
    } else {
      throw new Error(`Unknown method: ${method}`);
    }
  } catch (error) {
    reply(requestId, null, { code: "pty_provider_error", message: String(error && error.message || error) });
  }
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  try { command(JSON.parse(line)); }
  catch (error) { send({ kind: "fatal", message: String(error && error.message || error) }); }
});
process.stdin.on("end", () => {
  for (const state of sessions.values()) try { state.pty.kill(); } catch (_) { /* gone */ }
  process.exit(0);
});
