/** Host-neutral OAEP P2 resource projection.
 *
 * This module deliberately imports no Desktop, Electron or filesystem API so
 * Desktop and TUI consume exactly the same validation and ordering semantics.
 */

export type ConversationResourceType =
  | "workspace" | "worktree" | "file" | "git" | "process" | "pty" | "checkpoint" | "artifact";
export type ConversationResourceRelation =
  | "input_reference" | "input_attachment" | "output_artifact" | "citation_source"
  | "file_change_target" | "derived_from" | "related";
export type ConversationResourcePresentation = "inline" | "card" | "activity";

export interface ConversationResourceKey {
  protocol: "owop/1";
  authority_id: string;
  workspace_id: string;
  resource_type: ConversationResourceType;
  resource_id: string;
  generation: number;
}

export interface ConversationResourceAssociation {
  association_id: string;
  resource: ConversationResourceKey;
  relation: ConversationResourceRelation;
  label_snapshot: string;
  presentation: ConversationResourcePresentation;
  version_snapshot?: {
    version_id: string;
    digest?: string;
    size?: number;
    mime_type?: string;
    captured_at?: string;
  };
  locator?: Record<string, string | number>;
  operation_id?: string;
}

export type ProjectedConversationPart =
  | { part_id: string; type: "text"; text: string }
  | { part_id: string; type: "resource"; association_id: string }
  | { part_id: string; type: "unsupported"; wire_type: string };

export interface ConversationResourceProjection {
  associations: ConversationResourceAssociation[];
  itemByAssociation: Record<string, string>;
  partsByItem: Record<string, ProjectedConversationPart[]>;
  diagnostics: Array<{ code: string; item_id: string; part_id?: string }>;
}

const RESOURCE_TYPES = new Set<ConversationResourceType>([
  "workspace", "worktree", "file", "git", "process", "pty", "checkpoint", "artifact",
]);
const RELATIONS = new Set<ConversationResourceRelation>([
  "input_reference", "input_attachment", "output_artifact", "citation_source",
  "file_change_target", "derived_from", "related",
]);
const PRESENTATIONS = new Set<ConversationResourcePresentation>(["inline", "card", "activity"]);
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function bounded(value: unknown, max: number): value is string {
  return nonEmpty(value) && value.length <= max;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function resourceKey(value: unknown): ConversationResourceKey | null {
  const raw = record(value);
  const allowed = new Set(["protocol", "authority_id", "workspace_id", "resource_type", "resource_id", "generation"]);
  if (!raw || !exactKeys(raw, allowed) || raw.protocol !== "owop/1" ||
      !bounded(raw.authority_id, 256) || !bounded(raw.workspace_id, 256) || !bounded(raw.resource_id, 256) ||
      !RESOURCE_TYPES.has(raw.resource_type as ConversationResourceType) ||
      !Number.isSafeInteger(raw.generation) || Number(raw.generation) < 1) return null;
  return {
    protocol: "owop/1", authority_id: raw.authority_id, workspace_id: raw.workspace_id,
    resource_type: raw.resource_type as ConversationResourceType,
    resource_id: raw.resource_id, generation: Number(raw.generation),
  };
}

function strictLocator(value: unknown): Record<string, string | number> | null {
  if (value === undefined) return null;
  const raw = record(value);
  if (!raw || !nonEmpty(raw.kind)) return null;
  const shapes: Record<string, string[]> = {
    text_range: ["line", "column", "end_line", "end_column"],
    page: ["page"], slide: ["slide"], sheet_cell: ["sheet", "cell"], time_range: ["start_ms", "end_ms"],
  };
  const fields = shapes[raw.kind];
  if (!fields || !exactKeys(raw, new Set(["kind", ...fields])) || fields.some((field) =>
    typeof raw[field] !== (field === "sheet" || field === "cell" ? "string" : "number"))) return null;
  if (raw.kind === "sheet_cell" && (
    String(raw.sheet).length > 255 || String(raw.cell).length > 64
  )) return null;
  return Object.fromEntries(["kind", ...fields].map((field) => [field, raw[field] as string | number]));
}

export function parseConversationResourceAssociation(value: unknown): ConversationResourceAssociation | null {
  const raw = record(value);
  const resource = resourceKey(raw?.resource);
  // The wire Schema remains strict for producers, but readers deliberately
  // project only understood optional Association metadata. This lets an older
  // client ignore a newly added display-only field without weakening the
  // exact ResourceKey, locator, Message Part, or required-enum semantics.
  if (!raw || !bounded(raw.association_id, 256) || !resource ||
      !RELATIONS.has(raw.relation as ConversationResourceRelation) || !bounded(raw.label_snapshot, 512) ||
      !PRESENTATIONS.has(raw.presentation as ConversationResourcePresentation)) return null;
  const association: ConversationResourceAssociation = {
    association_id: raw.association_id, resource,
    relation: raw.relation as ConversationResourceRelation,
    label_snapshot: raw.label_snapshot,
    presentation: raw.presentation as ConversationResourcePresentation,
  };
  if (raw.locator !== undefined) {
    const locator = strictLocator(raw.locator);
    if (!locator) return null;
    association.locator = locator;
  }
  if (raw.version_snapshot !== undefined) {
    const version = record(raw.version_snapshot);
    if (!version || !bounded(version.version_id, 256) ||
        (version.digest !== undefined && (typeof version.digest !== "string" || !DIGEST.test(version.digest))) ||
        (version.size !== undefined && (!Number.isSafeInteger(version.size) || Number(version.size) < 0)) ||
        (version.mime_type !== undefined && (typeof version.mime_type !== "string" || version.mime_type.length > 256)) ||
        (version.captured_at !== undefined && typeof version.captured_at !== "string")) return null;
    association.version_snapshot = {
      version_id: version.version_id,
      ...(typeof version.digest === "string" ? { digest: version.digest } : {}),
      ...(typeof version.size === "number" ? { size: version.size } : {}),
      ...(typeof version.mime_type === "string" ? { mime_type: version.mime_type } : {}),
      ...(typeof version.captured_at === "string" ? { captured_at: version.captured_at } : {}),
    };
  }
  if (raw.operation_id !== undefined) {
    if (!bounded(raw.operation_id, 256)) return null;
    association.operation_id = raw.operation_id;
  }
  return association;
}

/** Strictly project P2 data. P1 upgrade belongs to the compatibility adapter. */
export function projectOaepConversationResources(snapshot: unknown): ConversationResourceProjection {
  const root = record(snapshot);
  if (!root || !Array.isArray(root.items)) throw new Error("oaep_snapshot_items_invalid");
  const associations: ConversationResourceAssociation[] = [];
  const byId = new Map<string, ConversationResourceAssociation>();
  const itemByAssociation: Record<string, string> = {};
  const partsByItem: Record<string, ProjectedConversationPart[]> = {};
  const diagnostics: ConversationResourceProjection["diagnostics"] = [];

  for (const rawItem of root.items) {
    const item = record(rawItem);
    if (!item) continue;
    const itemId = nonEmpty(item.id) ? item.id : "unknown-item";
    for (const rawAssociation of Array.isArray(item.associations) ? item.associations : []) {
      const parsed = parseConversationResourceAssociation(rawAssociation);
      if (!parsed) {
        diagnostics.push({ code: "association_invalid", item_id: itemId });
        continue;
      }
      if (!byId.has(parsed.association_id)) {
        byId.set(parsed.association_id, parsed);
        associations.push(parsed);
        itemByAssociation[parsed.association_id] = itemId;
      }
    }
    const content = record(item.content);
    if (item.type !== "message" || !content || !Array.isArray(content.parts)) continue;
    partsByItem[itemId] = content.parts.map((rawPart, index): ProjectedConversationPart => {
      const part = record(rawPart);
      const partId = part && nonEmpty(part.part_id) ? part.part_id : `unsupported-${index + 1}`;
      if (part?.type === "text" && typeof part.text === "string" && exactKeys(part, new Set(["part_id", "type", "text"]))) {
        return { part_id: partId, type: "text", text: part.text };
      }
      if (part?.type === "resource" && nonEmpty(part.association_id) &&
          exactKeys(part, new Set(["part_id", "type", "association_id"])) && byId.has(part.association_id)) {
        return { part_id: partId, type: "resource", association_id: part.association_id };
      }
      diagnostics.push({ code: "part_unsupported", item_id: itemId, part_id: partId });
      return { part_id: partId, type: "unsupported", wire_type: nonEmpty(part?.type) ? part.type : "unknown" };
    });
  }
  return { associations, itemByAssociation, partsByItem, diagnostics };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const raw = record(value);
  if (!raw) return value;
  return Object.fromEntries(Object.keys(raw).sort().map((key) => [key, canonicalValue(raw[key])]));
}

export function canonicalConversationResourceJson(projection: ConversationResourceProjection): string {
  return JSON.stringify(canonicalValue(projection));
}
