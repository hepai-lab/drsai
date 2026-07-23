import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BrowserTaskEvent } from "../../api/browser/types";
import { parseBrowserUseWorkerEvent, serializeBrowserUseWorkerCommand, type BrowserUseWorkerCommand } from "./protocol";

export interface BrowserWorkerStartOptions {
  pythonCommand: string;
  workerPath: string;
  dataRoot: string;
  environment?: NodeJS.ProcessEnv;
}

export class BrowserUseWorkerClient extends EventEmitter {
  #worker: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = "";

  start(options: BrowserWorkerStartOptions): void {
    if (this.#worker) return;
    const workerPath = resolve(options.workerPath);
    if (!existsSync(workerPath)) throw new Error(`browser-use worker was not found: ${workerPath}`);
    const home = resolve(options.dataRoot);
    const child = spawn(options.pythonCommand, [workerPath], {
      cwd: dirname(workerPath),
      env: {
        ...process.env, ...options.environment,
        BROWSER_USE_CONFIG_DIR: join(home, "config"),
        BROWSER_USE_PROFILES_DIR: join(home, "profiles"),
        BROWSER_USE_DEFAULT_USER_DATA_DIR: join(home, "profiles", "default"),
        BH_HOME: join(home, "browser-harness"),
        BH_CONFIG_DIR: join(home, "browser-harness", "config"),
        BH_RUNTIME_DIR: join(home, "browser-harness", "runtime"),
        BH_TMP_DIR: join(home, "browser-harness", "tmp"),
        BH_AGENT_WORKSPACE: join(home, "browser-harness", "agent-workspace"),
      },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.#worker = child;
    child.stdout.on("data", (chunk) => this.#handleStdout(String(chunk)));
    child.stderr.on("data", (chunk) => this.emit("error-line", String(chunk).slice(0, 4000)));
    child.on("error", (error) => this.emit("error-line", error.message));
    child.on("exit", (code) => { if (this.#worker === child) this.#worker = null; this.emit("exit", code); });
  }
  send(command: BrowserUseWorkerCommand): void {
    if (!this.#worker?.stdin.writable) throw new Error("browser-use worker is not running.");
    this.#worker.stdin.write(serializeBrowserUseWorkerCommand(command));
  }
  stop(): void {
    const child = this.#worker;
    this.#worker = null;
    if (child && !child.killed) child.kill();
  }
  running(): boolean { return Boolean(this.#worker); }
  #handleStdout(chunk: string): void {
    this.#stdoutBuffer += chunk;
    if (this.#stdoutBuffer.length > 1_000_000) { this.#stdoutBuffer = ""; this.emit("error-line", "browser-use worker output exceeded its bound."); return; }
    let newline = this.#stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line) try { this.emit("event", parseBrowserUseWorkerEvent(line) satisfies BrowserTaskEvent); }
      catch (error) { this.emit("error-line", error instanceof Error ? error.message : String(error)); }
      newline = this.#stdoutBuffer.indexOf("\n");
    }
  }
}
