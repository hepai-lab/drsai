import {
  relayErrorAction,
  type RelayUserAction,
} from "./runtimeRelayErrorActions.generated";

export type { RelayUserAction } from "./runtimeRelayErrorActions.generated";

export type RelayRuntimeStatus = "online" | "degraded" | "offline";

export interface RelayActionableError {
  action: RelayUserAction;
  title: string;
  reason: string;
  actionLabel: string;
}

const RELAY_ACTION_PRESENTATION: Readonly<Record<RelayUserAction, Omit<RelayActionableError, "action">>> = {
  retry: { title: "暂时无法连接", reason: "请检查网络后重试。", actionLabel: "重试" },
  login: { title: "登录已过期", reason: "重新登录后可继续使用。", actionLabel: "重新登录" },
  "re-pair": { title: "需要重新连接设备", reason: "请生成新的二维码并重新扫码。", actionLabel: "重新扫码" },
  update: { title: "版本不兼容", reason: "请更新 OpenDrSai 后重试。", actionLabel: "检查更新" },
  "contact-admin": { title: "暂时无法完成操作", reason: "重试仍失败时，请联系管理员并提供关联编号。", actionLabel: "联系管理员" },
};

/** Maps wire errors to one safe CTA without exposing raw URL, body, path, token, or exception text. */
export function relayActionableError(code: string | null | undefined, retryable = false): RelayActionableError {
  const action = relayErrorAction(code, retryable);
  return { action, ...RELAY_ACTION_PRESENTATION[action] };
}

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
