import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";

export interface LegacyProtocolObservation {
  protocol: "oaep" | "conversation/1" | "unavailable";
  runtimeVersion?: string;
  reason: string;
  count: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

/** Bounded, content-free evidence used to decide when compatibility may retire. */
export class LegacyProtocolTelemetry {
  readonly #rows = new Map<string, LegacyProtocolObservation>();

  constructor(private readonly persistencePath?: string) {
    if (!persistencePath) return;
    try {
      const value = JSON.parse(readFileSync(persistencePath, "utf8")) as { rows?: LegacyProtocolObservation[] };
      for (const row of value.rows ?? []) {
        if (!validRow(row)) continue;
        const key = `${row.protocol}:${row.runtimeVersion}:${row.reason}`;
        this.#rows.set(key, { ...row, count: Math.min(1_000_000_000, row.count) });
      }
    } catch { /* first run or corrupt telemetry starts empty */ }
  }

  record(protocol: LegacyProtocolObservation["protocol"], reason: string, runtimeVersion?: string): void {
    const safeVersion = safeLabel(runtimeVersion || "unknown", 64);
    const safeReason = normalizeReason(reason);
    const key = `${protocol}:${safeVersion}:${safeReason}`;
    const now = new Date().toISOString();
    const current = this.#rows.get(key);
    this.#rows.set(key, current
      ? { ...current, count: current.count + 1, lastObservedAt: now }
      : { protocol, runtimeVersion: safeVersion, reason: safeReason, count: 1, firstObservedAt: now, lastObservedAt: now });
    while (this.#rows.size > 128) this.#rows.delete(this.#rows.keys().next().value as string);
    this.#persist();
  }

  snapshot(): LegacyProtocolObservation[] { return [...this.#rows.values()].map((row) => ({ ...row })); }
  reset(): void { this.#rows.clear(); this.#persist(); }

  #persist(): void {
    if (!this.persistencePath) return;
    try {
      mkdirSync(dirname(this.persistencePath), { recursive: true });
      const temporary = `${this.persistencePath}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ schema: "opendrsai.legacy-protocol-telemetry/1", rows: this.snapshot() })}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, this.persistencePath);
    } catch { /* telemetry must never break Runtime protocol selection */ }
  }
}

export const legacyProtocolTelemetry = new LegacyProtocolTelemetry(join(DRSAI_HOME, "desktop", "legacy-protocol-telemetry.json"));

export interface LegacyDeletionDecisionReport {
  schema: "opendrsai.legacy-deletion-decision/1";
  generatedAt: string;
  totals: { selections: number; oaep: number; legacy: number; unavailable: number };
  ratios: { oaep: number; legacy: number; unavailable: number; migration: number };
  versions: Record<string, Record<string, number>>;
  fallbackReasons: Record<string, number>;
  releaseCycles: number;
  observationDays: number;
  rollbackArtifactVerified: boolean;
  eligible: boolean;
  failed: string[];
}

export function buildLegacyDeletionDecisionReport(
  observations: readonly LegacyProtocolObservation[],
  context: { releaseCycles: number; observationDays: number; migrationRatio: number; rollbackArtifactVerified: boolean },
): LegacyDeletionDecisionReport {
  const totals = { selections: 0, oaep: 0, legacy: 0, unavailable: 0 };
  const versions: Record<string, Record<string, number>> = {};
  const fallbackReasons: Record<string, number> = {};
  for (const row of observations) {
    if (!validRow(row)) continue;
    totals.selections += row.count;
    if (row.protocol === "oaep") totals.oaep += row.count;
    else if (row.protocol === "conversation/1") totals.legacy += row.count;
    else totals.unavailable += row.count;
    const protocolVersions = versions[row.protocol] ??= {};
    protocolVersions[row.runtimeVersion ?? "unknown"] = (protocolVersions[row.runtimeVersion ?? "unknown"] ?? 0) + row.count;
    fallbackReasons[normalizeReason(row.reason)] = (fallbackReasons[normalizeReason(row.reason)] ?? 0) + row.count;
  }
  const denominator = Math.max(1, totals.selections);
  const ratios = {
    oaep: totals.oaep / denominator,
    legacy: totals.legacy / denominator,
    unavailable: totals.unavailable / denominator,
    migration: Math.max(0, Math.min(1, context.migrationRatio)),
  };
  const checks: Record<string, boolean> = {
    observations_present: totals.selections > 0,
    two_release_cycles: context.releaseCycles >= 2,
    fourteen_observation_days: context.observationDays >= 14,
    oaep_selection_99_9_percent: ratios.oaep >= 0.999,
    legacy_below_0_1_percent: ratios.legacy < 0.001,
    migration_complete: ratios.migration === 1,
    rollback_artifact_verified: context.rollbackArtifactVerified,
  };
  return {
    schema: "opendrsai.legacy-deletion-decision/1", generatedAt: new Date().toISOString(),
    totals, ratios, versions, fallbackReasons,
    releaseCycles: context.releaseCycles, observationDays: context.observationDays,
    rollbackArtifactVerified: context.rollbackArtifactVerified,
    eligible: Object.values(checks).every(Boolean),
    failed: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).sort(),
  };
}

export function legacyProtocolCanRetire(
  releases: readonly { version: string; legacyUses: number; supportedRuntimeRequiresLegacy: boolean }[],
): boolean {
  const latest = releases.slice(-2);
  return latest.length === 2
    && latest.every((release) => release.legacyUses === 0 && !release.supportedRuntimeRequiresLegacy);
}

function safeLabel(value: string, maxLength: number): string {
  return value.replace(/[\r\n\0]/g, " ").replace(/(token|secret|password|cookie)=[^\s]+/gi, "$1=[REDACTED]")
    .trim().slice(0, maxLength) || "unknown";
}

const ALLOWED_REASONS = new Set([
  "capability_selection", "operator_rollback", "oaep_unavailable", "legacy_unavailable",
  "schema_mismatch", "version_incompatible", "selected", "other",
]);

function normalizeReason(value: string): string {
  const safe = safeLabel(value, 120);
  return ALLOWED_REASONS.has(safe) ? safe : "other";
}

function validRow(value: unknown): value is LegacyProtocolObservation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LegacyProtocolObservation>;
  return ["oaep", "conversation/1", "unavailable"].includes(String(row.protocol))
    && typeof row.runtimeVersion === "string" && row.runtimeVersion.length <= 64
    && typeof row.reason === "string" && row.reason.length <= 120
    && Number.isSafeInteger(row.count) && Number(row.count) > 0
    && Number.isFinite(Date.parse(String(row.firstObservedAt)))
    && Number.isFinite(Date.parse(String(row.lastObservedAt)));
}
