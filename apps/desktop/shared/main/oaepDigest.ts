import { createHash } from "node:crypto";

import type { OaepItem } from "../api/oaep.generated";

const fields = ["id", "session_id", "run_id", "type", "status", "sequence", "source", "content"] as const;

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("oaep_digest_number_invalid");
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  throw new Error("oaep_digest_value_invalid");
}

export function canonicalOaepItems(items: readonly OaepItem[]): string {
  const ordered = [...items].sort((left, right) =>
    left.run_id.localeCompare(right.run_id) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  return canonical(ordered.map((item) => {
    const value: Record<string, unknown> = Object.fromEntries(
      fields.map((field) => [field, item[field]]),
    );
    const content = { ...(value.content as unknown as Record<string, unknown>) };
    if (item.type === "message" && content.citations === undefined) content.citations = [];
    // `parts` is an optional compatibility field. Generated Android models
    // emit an empty array while Runtime/Desktop may omit it; both represent
    // the same OAEP message and must produce the same transcript digest.
    if (Array.isArray(content.parts) && content.parts.length === 0) delete content.parts;
    if (["command_execution", "tool_call"].includes(item.type)
      && content.replay_policy && typeof content.replay_policy === "object"
      && !Array.isArray(content.replay_policy) && Object.keys(content.replay_policy as Record<string, unknown>).length === 0) {
      delete content.replay_policy;
    }
    if (item.type === "artifact") {
      if (content.previewable === undefined) content.previewable = false;
      if (content.downloadable === undefined) content.downloadable = false;
    }
    if (item.type === "interaction" && content.request_summary === undefined) content.request_summary = {};
    if (item.type === "notice" && content.details === undefined) content.details = {};
    value.content = content;
    return value;
  }));
}

export function oaepItemsDigest(items: readonly OaepItem[]): string {
  return createHash("sha256").update(canonicalOaepItems(items), "utf8").digest("hex");
}
