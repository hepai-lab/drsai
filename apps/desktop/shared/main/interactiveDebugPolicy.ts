import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { replaceFileSafely } from "./atomicFileReplace";

export interface InteractiveDebugPolicy {
  enabled: boolean;
  source: "default" | "user" | "environment";
  updatedAt?: string;
  locked: boolean;
}

export interface InteractiveDebugPolicyUpdateRequest {
  enabled: boolean;
  acknowledgedRisk: true;
}

export class InteractiveDebugPolicyStore {
  #policy: InteractiveDebugPolicy = { enabled: false, source: "default", locked: false };
  #queue = Promise.resolve();

  constructor(readonly filePath: string, readonly environment = process.env) {}

  async initialize(): Promise<InteractiveDebugPolicy> {
    let stored: InteractiveDebugPolicy | undefined;
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<InteractiveDebugPolicy>;
      if (typeof value.enabled === "boolean" && (value.source === "user" || value.source === "default") && (value.updatedAt === undefined || Number.isFinite(Date.parse(value.updatedAt)))) {
        stored = { enabled: value.enabled, source: value.source, ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}), locked: false };
      }
    } catch { /* first run or invalid state: fail closed */ }
    this.#policy = stored ?? { enabled: false, source: "default", locked: false };
    if (this.environment.OPENDRSAI_DISABLE_INTERACTIVE_DEBUG === "1") this.#policy = { enabled: false, source: "environment", locked: true };
    else if (this.environment.OPENDRSAI_ENABLE_INTERACTIVE_DEBUG === "1") this.#policy = { enabled: true, source: "environment", locked: true };
    return this.get();
  }

  get(): InteractiveDebugPolicy { return { ...this.#policy }; }
  isEnabled(): boolean { return this.#policy.enabled; }

  update(raw: unknown): Promise<InteractiveDebugPolicy> {
    const run = this.#queue.catch(() => undefined).then(async () => {
      if (this.#policy.locked) throw new Error("Interactive debugging is locked by environment policy.");
      if (!raw || typeof raw !== "object") throw new Error("Interactive debug policy request is required.");
      const request = raw as Partial<InteractiveDebugPolicyUpdateRequest>;
      if (typeof request.enabled !== "boolean" || request.acknowledgedRisk !== true) throw new Error("Interactive debugging requires explicit risk acknowledgement.");
      const next: InteractiveDebugPolicy = { enabled: request.enabled, source: "user", updatedAt: new Date().toISOString(), locked: false };
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, enabled: next.enabled, source: next.source, updatedAt: next.updatedAt }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await replaceFileSafely(temporary, this.filePath);
        await chmod(this.filePath, 0o600).catch(() => undefined);
      } finally { await rm(temporary, { force: true }); }
      this.#policy = next;
      return this.get();
    });
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
