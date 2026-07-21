import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codexBin = process.env.CODEX_BIN || "codex";
const model = process.env.CODEX_TEST_MODEL || "gpt-5.4";
const marker = "CODEX_APP_SERVER_SMOKE_OK";
const timeoutMs = Number(process.env.CODEX_TEST_TIMEOUT_MS || 120_000);

const childCommand = process.platform === "win32" && !process.env.CODEX_BIN ? "powershell.exe" : codexBin;
const childArguments = process.platform === "win32" && !process.env.CODEX_BIN
  ? ["-NoProfile", "-NonInteractive", "-Command", "codex app-server --listen stdio://"]
  : ["app-server", "--listen", "stdio://"];

const child = spawn(childCommand, childArguments, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let nextId = 1;
let threadId = null;
let turnId = null;
let content = "";
const notificationMethods = [];
const stderrLines = [];
let finished = false;

function send(method, params = {}) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
  return id;
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ method, params })}\n`);
}

function stop(exitCode, detail) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  if (!child.killed) child.kill();
  const result = {
    ok: exitCode === 0,
    model,
    threadId,
    turnId,
    content,
    notificationMethods: [...new Set(notificationMethods)],
    stderrTail: stderrLines.slice(-10),
    detail,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = exitCode;
}

const timer = setTimeout(() => stop(1, "Timed out waiting for turn/completed."), timeoutMs);

child.on("error", (error) => stop(1, `Failed to start Codex App Server: ${error.message}`));
child.on("exit", (code, signal) => {
  if (!finished) stop(1, `Codex App Server exited early: code=${code}, signal=${signal}`);
});

createInterface({ input: child.stderr }).on("line", (line) => {
  stderrLines.push(line.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"));
});

const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    stop(1, `Non-JSON stdout from App Server: ${error.message}`);
    return;
  }

  if (message.error) {
    stop(1, `JSON-RPC error: ${JSON.stringify(message.error)}`);
    return;
  }

  if (message.id === 1 && message.result) {
    notify("initialized");
    send("thread/start", {
      cwd: process.cwd(),
      model,
      ephemeral: true,
      developerInstructions: `Do not call tools or inspect files. Reply with exactly: ${marker}`,
    });
    return;
  }

  if (message.id === 2 && message.result?.thread?.id) {
    threadId = message.result.thread.id;
    send("turn/start", {
      threadId,
      input: [{ type: "text", text: `Reply with exactly: ${marker}` }],
    });
    return;
  }

  if (message.id === 3 && message.result?.turn?.id) {
    turnId = message.result.turn.id;
    return;
  }

  if (!message.method) return;
  notificationMethods.push(message.method);
  const params = message.params || {};

  if (message.method === "item/agentMessage/delta") {
    content += params.delta || "";
  }

  if (message.method === "turn/completed") {
    const completedTurnId = params.turn?.id;
    const status = params.turn?.status;
    if (turnId && completedTurnId !== turnId) return;
    const ok = status === "completed" && content.includes(marker);
    stop(ok ? 0 : 1, `Turn completed with status=${status}.`);
  }
});

send("initialize", {
  clientInfo: {
    name: "opendrsai_codex_adapter_spike",
    title: "OpenDrSai Codex Adapter Spike",
    version: "0.1.0",
  },
});
