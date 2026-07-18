import { EventEmitter } from "events";
import type { BrowserTaskEvent } from "../../../shared/browser/types";
import {
  BrowserUseWorkerCommand,
  parseBrowserUseWorkerEvent,
  serializeBrowserUseWorkerCommand,
} from "./protocol";
import { BrowserUseProcess, startBrowserUseWorkerProcess } from "./processManager";

export class BrowserUseWorkerClient extends EventEmitter {
  private worker: BrowserUseProcess | null = null;
  private stdoutBuffer = "";

  start(pythonCommand: string): void {
    if (this.worker) return;
    this.worker = startBrowserUseWorkerProcess(pythonCommand);
    this.worker.process.stdout.on("data", (chunk) => {
      this.handleStdout(chunk.toString());
    });
    this.worker.process.stderr.on("data", (chunk) => {
      this.emit("error-line", chunk.toString());
    });
    this.worker.process.on("exit", (code) => {
      this.worker = null;
      this.emit("exit", code);
    });
  }

  send(command: BrowserUseWorkerCommand): void {
    if (!this.worker) {
      throw new Error("browser-use worker is not running.");
    }
    this.worker.process.stdin.write(serializeBrowserUseWorkerCommand(command));
  }

  stop(): void {
    this.worker?.stop();
    this.worker = null;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          this.emit("event", parseBrowserUseWorkerEvent(line) satisfies BrowserTaskEvent);
        } catch (error) {
          this.emit("error-line", error instanceof Error ? error.message : String(error));
        }
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }
}
