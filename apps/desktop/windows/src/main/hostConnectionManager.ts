import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";

export type HostConnectionState =
  | "disconnected"
  | "resolving"
  | "authenticating"
  | "connecting"
  | "runtime_check"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "failed";

export interface HostProfile {
  profileId: string;
  alias: string;
  hostname: string;
  port: number;
  user?: string;
  configSource: string;
  authPreference: "system_config" | "ssh_agent" | "identity_file";
  identityFiles: string[];
  proxyJump?: string;
  knownHostFingerprint?: string;
  updatedAt: string;
}

export interface HostActivity {
  workspaces: number;
  ptys: number;
  portForwards: number;
}

export interface HostConnectionDiagnostic {
  state: HostConnectionState;
  phase: string;
  failureCategory?: "dns" | "host_key" | "authentication" | "transport" | "runtime" | "policy";
  lastSuccessAt?: string;
  retryAt?: string;
  stderr?: string;
}

const TRANSITIONS: Record<HostConnectionState, ReadonlySet<HostConnectionState>> = {
  disconnected: new Set(["resolving", "connecting"]),
  resolving: new Set(["authenticating", "failed", "disconnected"]),
  authenticating: new Set(["connecting", "failed", "disconnected"]),
  connecting: new Set(["runtime_check", "reconnecting", "failed", "disconnected"]),
  runtime_check: new Set(["ready", "degraded", "reconnecting", "failed", "disconnected"]),
  ready: new Set(["degraded", "reconnecting", "disconnected"]),
  reconnecting: new Set(["connecting", "runtime_check", "ready", "failed", "disconnected"]),
  degraded: new Set(["runtime_check", "ready", "reconnecting", "failed", "disconnected"]),
  failed: new Set(["resolving", "connecting", "reconnecting", "disconnected"]),
};

export function canTransitionHostConnection(from: HostConnectionState, to: HostConnectionState): boolean {
  return from === to || TRANSITIONS[from].has(to);
}

export function transitionHostConnection(from: HostConnectionState, to: HostConnectionState): HostConnectionState {
  if (!canTransitionHostConnection(from, to)) throw new Error(`Invalid Host Connection transition: ${from} -> ${to}`);
  return to;
}

export function redactSshDiagnostic(value: string): string {
  return value
    .replace(/(password|passphrase|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted private key]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 4_000);
}

export function assertHostCanBeRemoved(activity: HostActivity): void {
  if (activity.workspaces || activity.ptys || activity.portForwards) {
    throw new Error(`Host has active resources (workspaces=${activity.workspaces}, ptys=${activity.ptys}, portForwards=${activity.portForwards}).`);
  }
}

export function makeHostProfile(input: Omit<HostProfile, "profileId" | "updatedAt">): HostProfile {
  if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(input.alias)) throw new Error("Host alias is invalid.");
  if (!input.hostname || /[\r\n\0]/.test(input.hostname)) throw new Error("Host name is invalid.");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("Host port is invalid.");
  if (Object.keys(input).some((key) => /password|passphrase|privatekey|token|secret/i.test(key))) throw new Error("Host Profile must not contain plaintext secrets.");
  return {
    ...input,
    identityFiles: [...new Set(input.identityFiles)].slice(0, 32),
    profileId: `host_${createHash("sha256").update(input.alias).digest("hex").slice(0, 20)}`,
    updatedAt: new Date().toISOString(),
  };
}

export class HostProfileStore {
  constructor(private readonly filePath = join(DRSAI_HOME, "desktop", "host-profiles.json")) {}

  async list(): Promise<HostProfile[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { profiles?: HostProfile[] };
      return Array.isArray(parsed.profiles) ? parsed.profiles.filter(isHostProfile).sort((a, b) => a.alias.localeCompare(b.alias)) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async upsert(profile: HostProfile): Promise<HostProfile> {
    if (!isHostProfile(profile)) throw new Error("Host Profile is invalid.");
    const profiles = await this.list();
    const next = [profile, ...profiles.filter((item) => item.profileId !== profile.profileId && item.alias !== profile.alias)];
    await this.save(next);
    return profile;
  }

  async remove(profileId: string, activity: HostActivity): Promise<boolean> {
    assertHostCanBeRemoved(activity);
    const profiles = await this.list();
    const next = profiles.filter((item) => item.profileId !== profileId);
    if (next.length === profiles.length) return false;
    await this.save(next);
    return true;
  }

  private async save(profiles: HostProfile[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.filePath);
  }
}

function isHostProfile(value: unknown): value is HostProfile {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HostProfile>;
  return typeof item.profileId === "string" && typeof item.alias === "string" && typeof item.hostname === "string"
    && Number.isInteger(item.port) && typeof item.configSource === "string" && Array.isArray(item.identityFiles)
    && ["system_config", "ssh_agent", "identity_file"].includes(String(item.authPreference))
    && typeof item.updatedAt === "string";
}
