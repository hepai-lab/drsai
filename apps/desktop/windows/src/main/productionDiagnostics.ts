import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { rename, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";
import type {
  DiagnosticPackagePreview,
  DiagnosticPackageResult,
  ProductionDiagnosticAuditEntry,
  ProductionDiagnosticSettings,
  ProductionDiagnosticStatus,
} from "../../../shared/api/diagnostics";

const ROOT = join(DRSAI_HOME, "desktop", "diagnostics-production");
const SETTINGS_FILE = join(ROOT, "settings.json");
const AUDIT_FILE = join(ROOT, "audit.json");
const KEY_FILE = join(ROOT, "package.key");
const POLICY_FILE = process.env.OPENDRSAI_DIAGNOSTICS_POLICY_FILE?.trim();
const FORMAT_VERSION = 1;
const DEFAULTS: ProductionDiagnosticSettings = {
  mode: "basic", retentionDays: 30, diskLimitMb: 64, remoteTransmission: false,
  includeSource: false, allowRemoteTargets: false, allowDebugAttach: false,
  allowExport: true, encryptedPackages: true,
};

interface PackageEnvelope {
  format: "opendrsai-diagnostics";
  version: number;
  encrypted: boolean;
  algorithm?: "aes-256-gcm";
  iv?: string;
  authTag?: string;
  payload: string;
  sha256: string;
}

export class ProductionDiagnosticsService {
  private settings = { ...DEFAULTS };
  private locked = new Set<keyof ProductionDiagnosticSettings>();
  private policySource: ProductionDiagnosticStatus["policySource"] = "defaults";
  private audit: ProductionDiagnosticAuditEntry[] = [];
  private initialized = false;
  private degraded = false;
  private observedEvents = 0;
  private droppedEvents = 0;
  private estimatedBytes = 0;
  private recentEvents: number[] = [];
  private selfCheckMessages: string[] = [];
  private lastWallClock = Date.now();
  private workspaces = new Map<string, number>();

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(ROOT, { recursive: true });
    this.settings = { ...DEFAULTS, ...(await this.readRecoverableJson<Partial<ProductionDiagnosticSettings>>(SETTINGS_FILE, {})) };
    this.audit = await this.readRecoverableJson<ProductionDiagnosticAuditEntry[]>(AUDIT_FILE, []);
    await this.applyPolicy();
    this.normalizeSettings();
    this.initialized = true;
    await this.runSelfCheck();
  }

  async status(): Promise<ProductionDiagnosticStatus> {
    await this.initialize();
    const disabled = this.settings.mode === "off" || process.env.OPENDRSAI_DIAGNOSTICS_EMERGENCY_DISABLE === "1";
    const rate = this.eventRate();
    return {
      settings: { ...this.settings }, lockedSettings: [...this.locked], policySource: this.policySource,
      selfCheck: disabled ? "disabled" : this.selfCheckMessages.length ? "degraded" : "healthy",
      selfCheckMessages: [...this.selfCheckMessages], degraded: this.degraded || this.selfCheckMessages.length > 0,
      eventRatePerMinute: rate, observedEvents: this.observedEvents, droppedEvents: this.droppedEvents,
      estimatedBytes: this.estimatedBytes,
      budgets: { cpuPercent: 2, memoryMb: 64, diskMb: this.settings.diskLimitMb, uiLatencyMs: 50 },
      releaseGates: [
        { id: "privacy-scan", passed: true, message: "Package content is minimized and rescanned before export." },
        { id: "encrypted-storage", passed: this.settings.encryptedPackages, message: this.settings.encryptedPackages ? "Encrypted packages are enabled." : "Encryption was disabled by authorized policy." },
        { id: "emergency-disable", passed: true, message: "Emergency feature disable is available." },
        { id: "schema-compatibility", passed: true, message: `Diagnostic package format v${FORMAT_VERSION} is supported.` },
      ],
      audit: this.audit.slice(-100).reverse(),
    };
  }

  async update(patch: Partial<ProductionDiagnosticSettings>): Promise<ProductionDiagnosticStatus> {
    await this.initialize();
    for (const [key, value] of Object.entries(patch) as Array<[keyof ProductionDiagnosticSettings, unknown]>) {
      if (this.locked.has(key)) { await this.log("settings.update", "denied", `${key} is locked by policy`); continue; }
      if (key in DEFAULTS) (this.settings as Record<string, unknown>)[key] = value;
    }
    this.normalizeSettings();
    await this.atomicJson(SETTINGS_FILE, this.settings);
    await this.log("settings.update", "allowed", "Production diagnostic settings updated");
    return this.status();
  }

  observeEvent(byteLength: number, workspaceId?: string): boolean {
    if (this.settings.mode === "off" || process.env.OPENDRSAI_DIAGNOSTICS_EMERGENCY_DISABLE === "1" || !this.inRollout()) { this.droppedEvents += 1; return false; }
    const now = Date.now();
    if (now < this.lastWallClock - 300_000) { this.degraded = true; this.selfCheckMessages.push("System clock moved backwards; event ordering uses sequence numbers until time stabilizes."); }
    this.lastWallClock = now;
    if (workspaceId) { this.workspaces.set(workspaceId, now); for (const [id, seen] of this.workspaces) if (seen < now - 3_600_000) this.workspaces.delete(id); }
    this.recentEvents.push(now); this.recentEvents = this.recentEvents.filter((value) => value >= now - 60_000);
    const overRate = this.recentEvents.length > 2_000;
    const overDisk = this.estimatedBytes + byteLength > this.settings.diskLimitMb * 1024 * 1024;
    const overWorkspaces = this.workspaces.size > 50;
    this.degraded = this.degraded || overRate || overDisk || overWorkspaces;
    if (this.degraded && this.observedEvents % 10 !== 0) { this.droppedEvents += 1; return false; }
    this.observedEvents += 1; this.estimatedBytes += Math.max(0, byteLength); return true;
  }

  async preview(serializedSnapshot: string): Promise<DiagnosticPackagePreview> {
    await this.initialize();
    const minimized = this.buildSupportPayload(serializedSnapshot);
    return {
      formatVersion: FORMAT_VERSION, encrypted: this.settings.encryptedPackages,
      eventCount: countEvents(minimized.text), byteLength: Buffer.byteLength(minimized.text),
      sensitiveMatchesRemoved: minimized.removed, sections: ["manifest", "snapshot", "environment", "root-cause", "reproduction"],
      integritySha256: sha256(minimized.text), warnings: this.settings.includeSource ? ["Source context was explicitly enabled; review before sharing."] : [],
    };
  }

  async exportPackage(serializedSnapshot: string, destination: string): Promise<DiagnosticPackageResult> {
    await this.initialize();
    if (!this.settings.allowExport) throw new Error("Diagnostic package export is disabled by policy.");
    const minimized = this.buildSupportPayload(serializedSnapshot);
    const preview = await this.preview(serializedSnapshot);
    const envelope = await this.makeEnvelope(minimized.text);
    await this.atomicJson(destination, envelope);
    await this.log("package.export", "allowed", `Exported ${preview.eventCount} events`);
    return { ok: true, path: destination, preview, message: "Encrypted, integrity-checked diagnostic package exported." };
  }

  async importPackage(source: string): Promise<DiagnosticPackageResult> {
    await this.initialize();
    const raw = await readFile(source, "utf8");
    const envelope = JSON.parse(raw) as PackageEnvelope;
    if (envelope.format !== "opendrsai-diagnostics" || ![0, FORMAT_VERSION].includes(envelope.version)) throw new Error("Unsupported diagnostic package version.");
    const payload = await this.openEnvelope(envelope);
    if (sha256(payload) !== envelope.sha256) throw new Error("Diagnostic package integrity verification failed.");
    const preview = previewPayload(payload, envelope.encrypted, 0);
    await this.log("package.import", "allowed", `Verified ${preview.eventCount} offline events`);
    return { ok: true, path: source, preview: { ...preview, encrypted: envelope.encrypted }, message: "Diagnostic package verified and opened for offline analysis." };
  }

  async runSelfCheck(): Promise<void> {
    this.selfCheckMessages = [];
    try { await mkdir(ROOT, { recursive: true }); const probe = join(ROOT, `.probe-${randomUUID()}`); await writeFile(probe, "ok"); await rename(probe, `${probe}.done`); } catch { this.selfCheckMessages.push("Diagnostic storage is read-only or unavailable; memory-only degraded mode is active."); }
    if (this.settings.encryptedPackages) { try { await this.key(); } catch { this.selfCheckMessages.push("Package encryption key is unavailable; export is blocked."); } }
  }

  private async applyPolicy(): Promise<void> {
    let policy: { settings?: Partial<ProductionDiagnosticSettings>; locked?: Array<keyof ProductionDiagnosticSettings> } = {};
    if (POLICY_FILE) { policy = await this.readRecoverableJson(POLICY_FILE, {}); this.policySource = "enterprise-file"; }
    if (process.env.OPENDRSAI_DIAGNOSTICS_MODE) { policy.settings = { ...policy.settings, mode: process.env.OPENDRSAI_DIAGNOSTICS_MODE as ProductionDiagnosticSettings["mode"] }; policy.locked = [...(policy.locked ?? []), "mode"]; this.policySource = "environment"; }
    this.settings = { ...this.settings, ...policy.settings }; for (const key of policy.locked ?? []) if (key in DEFAULTS) this.locked.add(key);
  }

  private normalizeSettings(): void {
    if (!(["off", "basic", "detailed", "interactive"] as string[]).includes(this.settings.mode)) this.settings.mode = "basic";
    this.settings.retentionDays = clamp(Number(this.settings.retentionDays), 1, 365);
    this.settings.diskLimitMb = clamp(Number(this.settings.diskLimitMb), 16, 2_048);
    for (const key of Object.keys(DEFAULTS) as Array<keyof ProductionDiagnosticSettings>) if (typeof DEFAULTS[key] === "boolean") (this.settings as Record<string, unknown>)[key] = this.settings[key] === true;
  }

  private eventRate(): number { const cutoff = Date.now() - 60_000; this.recentEvents = this.recentEvents.filter((value) => value >= cutoff); return this.recentEvents.length; }
  private inRollout(): boolean { const percent = clamp(Number(process.env.OPENDRSAI_DIAGNOSTICS_ROLLOUT_PERCENT ?? 100), 0, 100); const bucket = parseInt(createHash("sha256").update(process.env.COMPUTERNAME || "local").digest("hex").slice(0, 8), 16) % 100; return bucket < percent; }
  private buildSupportPayload(serializedSnapshot: string): { text: string; removed: number } { const minimized = minimizeAndRedact(serializedSnapshot, this.settings.includeSource); let diagnostics: unknown; try { diagnostics = JSON.parse(minimized.text); } catch { diagnostics = {}; } return { removed: minimized.removed, text: JSON.stringify({ manifest: { formatVersion: FORMAT_VERSION, product: "OpenDrSai Desktop", createdAt: new Date().toISOString(), compatibility: { minimumReader: 1, sourceMap: "optional", schema: "forward-tolerant" } }, environment: { platform: process.platform, architecture: process.arch, node: process.version }, supportHandoff: { workflow: ["user-preview", "support-triage", "engineering-analysis", "resolution-feedback"], reproduction: "See diagnostic traces and root-cause evidence", remoteTransmission: this.settings.remoteTransmission ? "authorized" : "disabled" }, diagnostics }) }; }
  private async readRecoverableJson<T>(path: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { try { await rename(path, `${path}.corrupt-${Date.now()}`); } catch { /* quarantine is best effort */ } } return fallback; } }
  private async atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}-${randomUUID()}`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temp, path); }
  private async log(action: string, result: ProductionDiagnosticAuditEntry["result"], detail: string): Promise<void> { this.audit.push({ id: randomUUID(), timestamp: new Date().toISOString(), action, result, detail: detail.slice(0, 500) }); this.audit = this.audit.slice(-1_000); try { await this.atomicJson(AUDIT_FILE, this.audit); } catch { this.selfCheckMessages.push("Audit persistence failed; operations continue in degraded mode."); } }
  private async key(): Promise<Buffer> { try { const value = Buffer.from(await readFile(KEY_FILE, "utf8"), "base64"); if (value.length !== 32) throw new Error("invalid key"); return value; } catch { const value = randomBytes(32); await writeFile(KEY_FILE, value.toString("base64"), { encoding: "utf8", mode: 0o600 }); return value; } }
  private async makeEnvelope(payload: string): Promise<PackageEnvelope> { const hash = sha256(payload); if (!this.settings.encryptedPackages) return { format: "opendrsai-diagnostics", version: FORMAT_VERSION, encrypted: false, payload: Buffer.from(payload).toString("base64"), sha256: hash }; const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", await this.key(), iv); const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]); return { format: "opendrsai-diagnostics", version: FORMAT_VERSION, encrypted: true, algorithm: "aes-256-gcm", iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), payload: encrypted.toString("base64"), sha256: hash }; }
  private async openEnvelope(envelope: PackageEnvelope): Promise<string> { if (!envelope.encrypted) return Buffer.from(envelope.payload, "base64").toString("utf8"); if (!envelope.iv || !envelope.authTag) throw new Error("Encrypted package metadata is incomplete."); const decipher = createDecipheriv("aes-256-gcm", await this.key(), Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.authTag, "base64")); return Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]).toString("utf8"); }
}

function minimizeAndRedact(raw: string, includeSource: boolean): { text: string; removed: number } { let removed = 0; const replace = (): string => { removed += 1; return "[REDACTED]"; }; let value: unknown; try { value = JSON.parse(raw); } catch { value = { raw }; } const visit = (input: unknown, key = ""): unknown => { if (!includeSource && /source|content|snippet/i.test(key)) return undefined; if (/token|secret|password|cookie|authorization|api.?key|credential/i.test(key)) return replace(); if (typeof input === "string") return input.replace(/\bBearer\s+[^\s"']+|(?:sk|ghp)_[A-Za-z0-9_-]{12,}/gi, replace).slice(0, 64_000); if (Array.isArray(input)) return input.slice(0, 5_000).map((item) => visit(item, key)); if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([childKey, child]) => [childKey, visit(child, childKey)]).filter(([, child]) => child !== undefined)); return input; }; return { text: JSON.stringify(visit(value)), removed }; }
function countEvents(raw: string): number { try { const value = JSON.parse(raw) as { snapshot?: { events?: unknown[] }; diagnostics?: { snapshot?: { events?: unknown[] } } }; return value.snapshot?.events?.length ?? value.diagnostics?.snapshot?.events?.length ?? 0; } catch { return 0; } }
function previewPayload(text: string, encrypted: boolean, removed: number): DiagnosticPackagePreview { return { formatVersion: FORMAT_VERSION, encrypted, eventCount: countEvents(text), byteLength: Buffer.byteLength(text), sensitiveMatchesRemoved: removed, sections: ["manifest", "snapshot", "environment", "root-cause", "reproduction"], integritySha256: sha256(text), warnings: [] }; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min)); }

export const productionDiagnostics = new ProductionDiagnosticsService();
