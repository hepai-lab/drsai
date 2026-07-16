// Generated from protocol/owop/owop.schema.json; do not edit.
export const OWOP_SCHEMA_SHA256 = "5bf676a8c35d9c7fe111f948aa8e309b73651e4e737807420ac920a1a8c7d1f7" as const;
export const OWOP_VERSION = "1.0" as const;
export type OWOPCapability = "workspace" | "files" | "search" | "watch" | "git" | "process" | "pty" | "checkpoint" | "artifact";
export type OWOPBindingKind = "in_process" | "local_ipc" | "ssh" | "hepai_if" | "mcp" | "ddf";
export type OWOPOperation = "workspace.describe" | "files.list" | "files.stat" | "files.read" | "files.write" | "files.move" | "files.remove" | "search.query" | "watch.subscribe" | "git.status" | "git.diff" | "git.file_at_ref" | "git.stage" | "git.unstage" | "git.revert" | "git.commit" | "process.start" | "process.write" | "process.attach" | "process.kill" | "pty.create" | "pty.write" | "pty.resize" | "pty.attach" | "pty.kill" | "checkpoint.create" | "checkpoint.preview" | "checkpoint.restore" | "checkpoint.accept" | "artifact.metadata" | "artifact.chunk";

export interface WorkspaceDescribeParams {
}

export interface FilesListParams {
  path: string;
  cursor?: string;
  limit: number;
}

export interface FilesStatParams {
  path: string;
}

export interface FilesReadParams {
  path: string;
  offset: number;
  length: number;
}

export interface FilesWriteParams {
  path: string;
  content_base64: string;
  expected_digest?: string;
  create_parents?: boolean;
}

export interface FilesMoveParams {
  source: string;
  destination: string;
  expected_digest?: string;
}

export interface FilesRemoveParams {
  path: string;
  expected_digest?: string;
  recursive?: boolean;
}

export interface SearchQueryParams {
  query: string;
  path?: string;
  cursor?: string;
  limit: number;
  include_ignored?: boolean;
}

export interface WatchSubscribeParams {
  path?: string;
  after_sequence: number;
  limit?: number;
}

export interface GitStatusParams {
}

export interface GitDiffParams {
  path?: string;
  staged?: boolean;
}

export interface GitFileAtRefParams {
  path: string;
  ref: string;
}

export interface GitStageParams {
  paths: Array<string>;
}

export interface GitUnstageParams {
  paths: Array<string>;
}

export interface GitRevertParams {
  paths: Array<string>;
  diff_digest: string;
}

export interface GitCommitParams {
  message: string;
  diff_digest: string;
}

export interface ProcessStartParams {
  argv: Array<string>;
  cwd: string;
  timeout_ms?: number;
  max_output_bytes?: number;
}

export interface ProcessWriteParams {
  process_id: string;
  content_base64: string;
}

export interface ProcessAttachParams {
  process_id: string;
  after_offset: number;
}

export interface ProcessKillParams {
  process_id: string;
  tree?: boolean;
}

export interface PtyCreateParams {
  argv: Array<string>;
  cwd: string;
  cols: number;
  rows: number;
  max_buffer_bytes?: number;
}

export interface PtyWriteParams {
  pty_id: string;
  content_base64: string;
}

export interface PtyResizeParams {
  pty_id: string;
  cols: number;
  rows: number;
}

export interface PtyAttachParams {
  pty_id: string;
  after_offset: number;
}

export interface PtyKillParams {
  pty_id: string;
}

export interface CheckpointCreateParams {
  label?: string;
  max_file_bytes?: number;
}

export interface CheckpointPreviewParams {
  checkpoint_id: string;
}

export interface CheckpointRestoreParams {
  checkpoint_id: string;
  preview_digest: string;
}

export interface CheckpointAcceptParams {
  checkpoint_id: string;
}

export interface ArtifactMetadataParams {
  artifact_id: string;
}

export interface ArtifactChunkParams {
  artifact_id: string;
  offset: number;
  length: number;
}

export interface OWOPParamsByOperation {
  "workspace.describe": WorkspaceDescribeParams;
  "files.list": FilesListParams;
  "files.stat": FilesStatParams;
  "files.read": FilesReadParams;
  "files.write": FilesWriteParams;
  "files.move": FilesMoveParams;
  "files.remove": FilesRemoveParams;
  "search.query": SearchQueryParams;
  "watch.subscribe": WatchSubscribeParams;
  "git.status": GitStatusParams;
  "git.diff": GitDiffParams;
  "git.file_at_ref": GitFileAtRefParams;
  "git.stage": GitStageParams;
  "git.unstage": GitUnstageParams;
  "git.revert": GitRevertParams;
  "git.commit": GitCommitParams;
  "process.start": ProcessStartParams;
  "process.write": ProcessWriteParams;
  "process.attach": ProcessAttachParams;
  "process.kill": ProcessKillParams;
  "pty.create": PtyCreateParams;
  "pty.write": PtyWriteParams;
  "pty.resize": PtyResizeParams;
  "pty.attach": PtyAttachParams;
  "pty.kill": PtyKillParams;
  "checkpoint.create": CheckpointCreateParams;
  "checkpoint.preview": CheckpointPreviewParams;
  "checkpoint.restore": CheckpointRestoreParams;
  "checkpoint.accept": CheckpointAcceptParams;
  "artifact.metadata": ArtifactMetadataParams;
  "artifact.chunk": ArtifactChunkParams;
}

export interface OWOPRequest<K extends OWOPOperation = OWOPOperation> {
  version: typeof OWOP_VERSION;
  request_id: string;
  correlation_id: string;
  workspace_id: string;
  operation: K;
  params: OWOPParamsByOperation[K];
  binding: { kind: OWOPBindingKind; endpoint?: string; host_alias?: string; socket_path?: string };
}

export interface OWOPError { code: string; message: string; correlation_id: string; retryable: boolean; details: Record<string, unknown> }
export type OWOPResponse =
  | { version: typeof OWOP_VERSION; request_id: string; correlation_id: string; ok: true; result: Record<string, unknown> }
  | { version: typeof OWOP_VERSION; request_id: string; correlation_id: string; ok: false; error: OWOPError };
