// Generated from cores/protocol/oaep/oaep.schema.json; do not edit.
export const OAEP_SCHEMA_SHA256 = "f586a6171063f0a1d1019097558b0fd8175692437fc0f685ac914710a7f15640" as const;
export const OAEP_VERSION = "1.0" as const;
export const OAEP_PROFILE = "oaep.session-stream/1" as const;
export type OaepItemType = "message" | "reasoning" | "plan" | "command_execution" | "file_change" | "tool_call" | "artifact" | "interaction" | "subtask" | "notice";
export type OaepItemStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type OaepEventType = "event.session.created" | "event.session.updated" | "event.session.archived" | "event.session.unarchived" | "event.session.deleted" | "event.run.created" | "event.run.started" | "event.run.waiting" | "event.run.resumed" | "event.run.completed" | "event.run.failed" | "event.run.cancelled" | "event.item.created" | "event.item.started" | "event.item.delta" | "event.item.updated" | "event.item.completed" | "event.item.failed" | "event.item.cancelled";
export interface OaepSource { backend: string; backend_item_id?: string; backend_event_id?: string; client?: string; message_id?: string; runtime_id?: string; backend_version?: string; adapter?: string; adapter_version?: string; mapping_version?: string; backend_run_id?: string; backend_run_index?: number; }
export interface OaepError { code: string; message: string; retryable: boolean; details?: Record<string, unknown>; }
export interface OaepOperationRef { protocol: "owop/1"; operation_id: string; workspace_id: string; operation: string; correlation_id: string; }
export interface OaepResourceRef { protocol: "owop/1"; workspace_id: string; resource_type: "workspace" | "worktree" | "file" | "git" | "process" | "pty" | "checkpoint" | "artifact"; resource_id: string; operation_id?: string; label?: string; digest?: string; }
export interface OaepContentReferences { operation_ref?: OaepOperationRef; resource_refs?: OaepResourceRef[]; }
export interface OaepMessagePart { type: "text" | "image" | "audio" | "file" | "resource_ref"; text?: string; url?: string; name?: string; mime_type?: string; resource_ref?: OaepResourceRef; }
export interface OaepMessageContent extends OaepContentReferences { role: "user" | "assistant" | "system"; text: string; phase?: "commentary" | "final"; citations?: Record<string, unknown>[]; parts?: OaepMessagePart[]; }
export interface OaepReasoningContent extends OaepContentReferences { segments: Array<{id: string; text: string; kind?: "summary" | "commentary" | "analysis"; visibility?: "user" | "diagnostic" | "hidden"; source?: "backend" | "adapter" | "runtime"}>; }
export interface OaepPlanContent extends OaepContentReferences { text: string; steps: Array<{id: string; title: string; status: string}>; explanation?: string; }
export interface OaepReplayPolicy { classification?: "pure" | "read_only_versioned" | "read_only_mutable" | "workspace_write" | "external_write" | "unknown"; tool_reference?: string; source_event_id?: string; input_digest?: string; implementation_digest?: string; schema_digest?: string; result_digest?: string; current?: Record<string, string>; }
export interface OaepCommandExecutionContent extends OaepContentReferences { command: string[]; display_command: string; cwd: string; output: string; stdout_tail?: string; stderr_tail?: string; exit_code?: number | null; duration_ms?: number | null; replay_policy?: OaepReplayPolicy; }
export interface OaepToolCallContent extends OaepContentReferences { tool_kind: string; tool_name: string; call_id: string; arguments: Record<string, unknown>; result: unknown; server?: string | null; duration_ms?: number | null; replay_policy?: OaepReplayPolicy; }
export interface OaepFileChangeContent extends OaepContentReferences { changes: Array<Record<string, unknown>>; summary: string; }
export interface OaepArtifactContent extends OaepContentReferences { artifact_id: string; artifact_type: string; name: string; summary: string; path?: string | null; mime_type?: string | null; size?: number | null; sha256?: string | null; previewable?: boolean; downloadable?: boolean; }
export interface OaepInteractionContent extends OaepContentReferences { interaction_type: string; prompt: string; options: Array<Record<string, unknown>>; approval_id?: string | null; operation?: string; request_summary?: Record<string, unknown>; related_item_id?: string | null; response?: unknown; deadline_at?: string | null; }
export interface OaepSubtaskContent extends OaepContentReferences { title: string; summary: string; agent_name?: string | null; child_run_id?: string | null; result?: unknown; }
export interface OaepNoticeContent extends OaepContentReferences { level: "info" | "warning" | "error"; code: string; message: string; error?: OaepError; details?: Record<string, unknown>; }
export type OaepItemContent = OaepMessageContent | OaepReasoningContent | OaepPlanContent | OaepCommandExecutionContent | OaepToolCallContent | OaepFileChangeContent | OaepArtifactContent | OaepInteractionContent | OaepSubtaskContent | OaepNoticeContent;
export interface OaepSession { id: string; workspace_id: string; title?: string; status: "active" | "archived" | "deleted"; backend?: string; created_at: string; updated_at: string; }
export interface OaepRun { id: string; session_id: string; parent_run_id?: string | null; sequence?: number; source?: OaepSource; status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled"; created_at: string; updated_at: string; completed_at?: string | null; }
export interface OaepItemBase { id: string; session_id: string; run_id: string; status: OaepItemStatus; sequence: number; created_at: string; updated_at: string; source: OaepSource; }
export type OaepItem =
  | (OaepItemBase & { type: "message"; content: OaepMessageContent })
  | (OaepItemBase & { type: "reasoning"; content: OaepReasoningContent })
  | (OaepItemBase & { type: "plan"; content: OaepPlanContent })
  | (OaepItemBase & { type: "command_execution"; content: OaepCommandExecutionContent })
  | (OaepItemBase & { type: "file_change"; content: OaepFileChangeContent })
  | (OaepItemBase & { type: "tool_call"; content: OaepToolCallContent })
  | (OaepItemBase & { type: "artifact"; content: OaepArtifactContent })
  | (OaepItemBase & { type: "interaction"; content: OaepInteractionContent })
  | (OaepItemBase & { type: "subtask"; content: OaepSubtaskContent })
  | (OaepItemBase & { type: "notice"; content: OaepNoticeContent });
export interface OaepDelta { kind: string; text?: string; segment_id?: string; stream?: "stdout" | "stderr" | "combined"; reasoning_kind?: "summary" | "commentary" | "analysis"; visibility?: "user" | "diagnostic" | "hidden"; reasoning_source?: "backend" | "adapter" | "runtime"; }
export interface OaepEventData { item?: OaepItem; delta?: OaepDelta; error?: OaepError; [key: string]: unknown; }
export interface OaepEvent { version: typeof OAEP_VERSION; event_id: string; session_id: string; run_id?: string; item_id?: string; sequence: number; type: OaepEventType; timestamp: string; dedupe_key: string; source: OaepSource; data: OaepEventData; }
export interface OaepSnapshotCheckpoint { sequence: number; snapshot_hash: string; item_count: number; }
export interface OaepSnapshotWindow { limit: number; has_more: boolean; next_cursor: string | null; }
export interface OaepSnapshot { version: typeof OAEP_VERSION; session: OaepSession; runs: OaepRun[]; items: OaepItem[]; snapshot_sequence: number; checkpoint?: OaepSnapshotCheckpoint; window?: OaepSnapshotWindow; }
export interface OaepEventPage { version: typeof OAEP_VERSION; object: "list"; data: OaepEvent[]; next_sequence: number; has_more: boolean; }
