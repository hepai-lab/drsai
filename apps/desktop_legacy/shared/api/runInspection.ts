import type { OaepItem } from "./oaep.generated";

export const RUN_INSPECTION_SCHEMA_VERSION = "opendrsai.run-inspection/1" as const;
export const RUN_MANIFEST_SCHEMA_VERSION = "opendrsai.run-manifest/1" as const;

export type RunReproducibilityLevel = "exact" | "compatible" | "partial" | "unavailable";

export interface RunReproductionManifest {
  schema_version: string;
  run_id: string;
  manifest: Record<string, unknown>;
  manifest_digest: string;
  safe_manifest_digest: string;
  reproducibility_level: RunReproducibilityLevel;
  missing_evidence: string[];
  created_at: string;
  finalized_at: string | null;
  exported_at?: string;
  privacy_notice?: string;
  integrity?: { algorithm: "sha256"; digest_scope: "safe_manifest"; digest: string };
}

export interface RunInspectionSummary {
  duration_ms: number | null;
  counts_by_item_type: Record<string, number>;
  counts_by_status: Record<string, number>;
  error: { code: string; message: string; retryable: boolean } | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  artifact_count: number;
  warning_count: number;
}

export interface RunInspectionEventRef {
  event_id: string;
  sequence: number;
}

export type RunInspectionTimelineItem = OaepItem & { event_refs: RunInspectionEventRef[] };

export interface RunInspection {
  schema_version: typeof RUN_INSPECTION_SCHEMA_VERSION;
  run: {
    run_id: string;
    session_id: string;
    workspace_id: string;
    backend_id: string;
    agent_definition: string;
    status: string;
    created_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    [key: string]: unknown;
  };
  summary: RunInspectionSummary;
  timeline: RunInspectionTimelineItem[];
  manifest: RunReproductionManifest;
  page: { next_cursor: string | null; has_more: boolean };
}

export interface RunInspectionOpenRequest {
  workspacePath: string;
  workspaceId?: string;
  runId: string;
  timelineCursor?: string;
  limit?: number;
  itemType?: string;
  status?: string;
  createExperiment?: boolean;
}

export interface RunItemLocator {
  schema_version: typeof RUN_INSPECTION_SCHEMA_VERSION;
  run_id: string;
  item_id: string;
  item_sequence: number;
  timeline_cursor: string | null;
}

export interface RunItemLocatorRequest {
  workspacePath: string;
  workspaceId?: string;
  runId: string;
  itemId: string;
  itemType?: string;
  status?: string;
}

export interface RunManifestReadRequest {
  workspacePath: string;
  workspaceId?: string;
  runId: string;
}

export interface RunManifestExportResult {
  manifest: RunReproductionManifest;
  savedPath: string | null;
  cancelled: boolean;
}

export interface SessionRunsReadRequest {
  workspacePath: string;
  workspaceId?: string;
  sessionId: string;
  cursor?: string;
  limit?: number;
  status?: string;
}

export interface SessionRunList {
  schema_version: typeof RUN_INSPECTION_SCHEMA_VERSION;
  object: "list";
  data: Array<Record<string, unknown> & {
    run_id: string;
    relation_type: "root" | "subagent" | "experiment_replay" | "retry" | "unknown";
    manifest: RunReproductionManifest;
  }>;
  next_cursor: string | null;
  has_more: boolean;
}
