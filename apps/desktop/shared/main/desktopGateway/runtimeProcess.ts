/**
 * Owning the Runtime process: launch, pair, health-check, stop.
 *
 * The Runtime is `python -m drsai.backend.desktop_gateway` on port 28643,
 * beside the frozen legacy gateway on 28642.  Both can run at once, which is the
 * whole point of the separate port and the separate `DRSAI_DESKTOP_GATEWAY_HOME`:
 * during the migration a developer needs to compare the two surfaces against the
 * same code without either one writing the other's session database.
 *
 * ## The pairing token
 *
 * `$DRSAI_HOME/runtime/instance-token` -- note `DRSAI_HOME`, not the gateway's
 * own state home.
 * The token is a handoff between the desktop and whichever Runtime it launched,
 * not Runtime state, and both surfaces honour one token so a developer running
 * both is not managing two secrets.  It is generated here on first launch with
 * mode 0600 and passed to the child through the environment, so it never appears
 * in a command line where another process could read it from the process table.
 *
 * ## Why readiness is polled and not assumed
 *
 * The child imports the Runtime package (48k lines, SQLite migrations) before it
 * binds. On a cold filesystem that is tens of seconds. A desktop that treats
 * spawn as ready shows the user a broken chat window; one that polls `GET
 * /v1/runtime` shows a Runtime that is still starting, which is true and
 * actionable.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, getEnhancedPath } from "../paths";
import { DESKTOP_SURFACE, type RuntimeIdentity } from "../../api/desktopGateway";

export const DESKTOP_GATEWAY_HOST = process.env.DRSAI_DESKTOP_GATEWAY_HOST?.trim() || "127.0.0.1";
export const DESKTOP_GATEWAY_PORT = Number(process.env.DRSAI_DESKTOP_GATEWAY_PORT ?? "28643") || 28643;
export const DESKTOP_GATEWAY_BASE_URL = `http://${DESKTOP_GATEWAY_HOST}:${DESKTOP_GATEWAY_PORT}`;

const TOKEN_PATH = join(DRSAI_HOME, "runtime", "instance-token");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** How long to wait for the child to bind before calling the launch failed. */
const READY_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(180_000, Number(process.env.OPENDRSAI_DESKTOP_GATEWAY_START_TIMEOUT_MS ?? "90000") || 90_000),
);
const READY_POLL_MS = 750;

export type RuntimeState =
  | { status: "stopped" }
  | { status: "starting"; since: number }
  | { status: "ready"; identity: RuntimeIdentity; since: number }
  | { status: "failed"; message: string; since: number };

/**
 * Reads the pairing token, generating one if this is a first launch.
 *
 * `OPENDRSAI_GATEWAY_INSTANCE_TOKEN` wins so a developer (or the dev watcher that
 * already owns the Runtime) can pin both sides to one value.
 */
export function resolveInstanceToken(): string {
  const configured = process.env.OPENDRSAI_GATEWAY_INSTANCE_TOKEN?.trim();
  if (configured) return configured;
  try {
    const existing = readFileSync(TOKEN_PATH, "utf8").trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch {
    // First launch, or an unreadable file we are about to replace.
  }
  const generated = randomBytes(32).toString("base64url");
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
}

export interface RuntimeProcessOptions {
  /**
   * When the developer's watcher already owns the Runtime, this process must not
   * start a second one: two uvicorn processes on one SQLite file is how a
   * session ends up with interleaved writes from two journals.
   */
  external?: boolean;
  /** Separate state root so this surface and the frozen gateway share no database. */
  stateHome?: string;
  onLog?: (line: string) => void;
}

export class DesktopRuntimeProcess {
  private child: ChildProcess | null = null;
  private state: RuntimeState = { status: "stopped" };
  private starting: Promise<RuntimeState> | null = null;
  private readonly options: RuntimeProcessOptions;

  constructor(options: RuntimeProcessOptions = {}) {
    this.options = options;
  }

  get current(): RuntimeState {
    return this.state;
  }

  /** Idempotent: concurrent callers share one launch, not one launch each. */
  async ensureReady(): Promise<RuntimeState> {
    if (this.state.status === "ready") return this.state;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(): Promise<RuntimeState> {
    this.state = { status: "starting", since: Date.now() };

    // Adopt an already-running Runtime before spawning one. The dev watcher, a
    // previous desktop session with a persisted Runtime, and a manually started
    // uvicorn all land here -- and adopting is always better than failing on a
    // port conflict the user cannot see.
    const existing = await probeIdentity();
    if (existing) return this.ready(existing);

    if (this.options.external) {
      return this.fail(
        `No Runtime is listening on ${DESKTOP_GATEWAY_BASE_URL} and this process is configured not to start one.`,
      );
    }
    if (!existsSync(DRSAI_PYTHON)) {
      return this.fail(`The Runtime interpreter is missing: ${DRSAI_PYTHON}`);
    }

    const token = resolveInstanceToken();
    this.child = spawn(DRSAI_PYTHON, ["-m", "drsai.backend.desktop_gateway"], {
      cwd: existsSync(DRSAI_REPO) ? DRSAI_REPO : undefined,
      env: {
        ...process.env,
        DRSAI_HOME,
        ...(this.options.stateHome ? { DRSAI_DESKTOP_GATEWAY_HOME: this.options.stateHome } : {}),
        DRSAI_DESKTOP_GATEWAY_HOST: DESKTOP_GATEWAY_HOST,
        DRSAI_DESKTOP_GATEWAY_PORT: String(DESKTOP_GATEWAY_PORT),
        // Passed through the environment, never argv: a command line is visible
        // to every other process on the machine.
        OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token,
        OPENDRSAI_DESKTOP_RUNTIME: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        PATH: getEnhancedPath(),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const log = (chunk: Buffer) => this.options.onLog?.(chunk.toString("utf8"));
    this.child.stdout?.on("data", log);
    this.child.stderr?.on("data", log);

    let exitMessage: string | null = null;
    this.child.once("exit", (code, signal) => {
      exitMessage = `The Runtime exited (code ${code ?? "null"}, signal ${signal ?? "null"}).`;
      this.child = null;
    });
    this.child.once("error", (error) => {
      exitMessage = `The Runtime could not be started: ${error.message}`;
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // Check the child before the port: a crashed import loop would otherwise
      // keep us polling a socket nothing will ever bind, for the full timeout.
      if (exitMessage) return this.fail(exitMessage);
      const identity = await probeIdentity();
      if (identity) return this.ready(identity);
      await delay(READY_POLL_MS);
    }
    return this.fail(`The Runtime did not become ready within ${READY_TIMEOUT_MS} ms.`);
  }

  private ready(identity: RuntimeIdentity): RuntimeState {
    this.state = { status: "ready", identity, since: Date.now() };
    return this.state;
  }

  private fail(message: string): RuntimeState {
    this.state = { status: "failed", message, since: Date.now() };
    return this.state;
  }

  /** Re-probes and downgrades a stale `ready`. Cheap enough to call per request. */
  async refresh(): Promise<RuntimeState> {
    const identity = await probeIdentity();
    if (identity) return this.ready(identity);
    if (this.state.status === "ready") {
      this.state = { status: "stopped" };
    }
    return this.state;
  }

  stop(): void {
    this.state = { status: "stopped" };
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    child.kill();
  }
}

async function probeIdentity(): Promise<RuntimeIdentity | null> {
  try {
    const response = await fetch(`${DESKTOP_GATEWAY_BASE_URL}/v1/runtime`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const identity = (await response.json()) as RuntimeIdentity;
    // Guard against adopting the *legacy* gateway if it ever moved onto this
    // port: it answers /v1/runtime too, with a different surface name, and its
    // session routes would then 404 in ways that look like data loss.
    return identity.surface === DESKTOP_SURFACE ? identity : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
