export type RelayRuntimeStatus = "online" | "degraded" | "offline";

export interface RelayRuntimeDirectoryIdentity {
  runtime_id: string;
  instance_id: string;
  version: string;
  protocol_version: "owop/1";
  status: RelayRuntimeStatus;
  connection_generation: number;
  last_seen_at: string | null;
}

export interface RelayRuntimeDirectorySummary {
  runtime: RelayRuntimeDirectoryIdentity;
  display_name: string;
  capabilities: string[];
}

export interface RelayRuntimeDirectoryPage {
  items: RelayRuntimeDirectorySummary[];
  next_cursor: string | null;
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(code);
}

function nonEmpty(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

export function parseRelayRuntimeDirectoryPage(value: unknown): RelayRuntimeDirectoryPage {
  const page = object(value, "relay_runtime_page_invalid");
  exactKeys(page, ["items", "next_cursor"], "relay_runtime_page_invalid");
  if (!Array.isArray(page.items)) throw new Error("relay_runtime_page_invalid");
  const items = page.items.map((raw): RelayRuntimeDirectorySummary => {
    const summary = object(raw, "relay_runtime_summary_invalid");
    exactKeys(
      summary,
      ["runtime", "display_name", "capabilities"],
      "relay_runtime_summary_invalid",
    );
    const identity = object(summary.runtime, "relay_runtime_identity_invalid");
    exactKeys(identity, [
      "runtime_id", "instance_id", "version", "protocol_version", "status",
      "connection_generation", "last_seen_at",
    ], "relay_runtime_identity_invalid");
    const status = nonEmpty(identity.status, "relay_runtime_status_invalid");
    if (!["online", "degraded", "offline"].includes(status)) {
      throw new Error("relay_runtime_status_invalid");
    }
    if (
      identity.protocol_version !== "owop/1"
      || !Number.isSafeInteger(identity.connection_generation)
      || Number(identity.connection_generation) < 1
      || !(identity.last_seen_at === null || typeof identity.last_seen_at === "string")
      || !Array.isArray(summary.capabilities)
      || summary.capabilities.some((item) => typeof item !== "string")
    ) {
      throw new Error("relay_runtime_identity_invalid");
    }
    return {
      runtime: {
        runtime_id: nonEmpty(identity.runtime_id, "relay_runtime_identity_invalid"),
        instance_id: nonEmpty(identity.instance_id, "relay_runtime_identity_invalid"),
        version: nonEmpty(identity.version, "relay_runtime_identity_invalid"),
        protocol_version: "owop/1",
        status: status as RelayRuntimeStatus,
        connection_generation: Number(identity.connection_generation),
        last_seen_at: identity.last_seen_at as string | null,
      },
      display_name: nonEmpty(summary.display_name, "relay_runtime_summary_invalid"),
      capabilities: [...summary.capabilities] as string[],
    };
  });
  if (!(page.next_cursor === null || typeof page.next_cursor === "string")) {
    throw new Error("relay_runtime_page_invalid");
  }
  return { items, next_cursor: page.next_cursor as string | null };
}
