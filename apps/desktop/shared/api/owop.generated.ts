// Generated from cores/protocol/owop/owop.schema.json; do not edit.
export const OWOP_SCHEMA_SHA256 = "ebdbf06e783d100a8c49bcfc913469e102251a9e13082fba7385de13b5f0bec7" as const;
export const OWOP_VERSION = "1.0" as const;
export type OWOPCapability = "workspace" | "worktree" | "files" | "search" | "watch" | "git" | "process" | "pty" | "checkpoint" | "artifact" | "resources.v2";
export type OWOPBindingKind = "in_process" | "local_ipc" | "ssh" | "hepai_if" | "mcp" | "ddf" | "relay";
export type OWOPOperation = "workspace.describe" | "files.list" | "files.register" | "files.resolve" | "files.stat" | "files.read" | "files.write" | "files.move" | "files.remove" | "search.query" | "watch.subscribe" | "git.status" | "git.diff" | "git.file_at_ref" | "git.stage" | "git.unstage" | "git.revert" | "git.commit" | "git.worktree.list" | "git.worktree.create" | "git.worktree.describe" | "git.worktree.merge" | "git.worktree.archive" | "git.worktree.remove" | "git.worktree.prune" | "process.start" | "process.write" | "process.attach" | "process.kill" | "pty.list" | "pty.describe" | "pty.create" | "pty.write" | "pty.resize" | "pty.attach" | "pty.detach" | "pty.kill" | "checkpoint.create" | "checkpoint.preview" | "checkpoint.restore" | "checkpoint.accept" | "artifact.metadata" | "artifact.chunk" | "resources.register" | "resources.resolve_batch" | "resources.read" | "resources.preview" | "resources.download.prepare" | "resources.download.chunk" | "resources.download.cancel" | "resources.subscribe";

export interface OWOPWorktreeResource {
  worktree_id: string;
  source_workspace_id: string;
  workspace_id: string | null;
  repo_root: string;
  canonical_path: string;
  branch: string;
  base_commit: string;
  status: "creating" | "active" | "review" | "merge_pending" | "merged" | "archived" | "removing" | "removed";
  location: "local" | "remote";
  source_dirty?: boolean;
  source_status_summary?: string | null;
  created_at: string;
  updated_at: string;
  removed_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  head_commit?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  activity?: Record<string, unknown>;
}

export interface OWOPTerminalResource {
  terminal_id: string;
  runtime_id: string;
  workspace_id: string;
  worktree_id: string | null;
  cwd: string;
  shell?: string | null;
  argv: Array<string>;
  status: "starting" | "running" | "detached" | "reconnecting" | "exited" | "lost";
  generation: number;
  pid: number | null;
  cols: number;
  rows: number;
  created_at: number;
  updated_at: number;
  exited_at: number | null;
  exit_code: number | null;
  exit_signal: string | null;
  last_sequence: number;
  first_sequence: number;
  journal_bytes: number;
}

export interface OWOPTerminalOutputEvent {
  terminal_id: string;
  runtime_id: string;
  workspace_id: string;
  worktree_id: string | null;
  generation: number;
  sequence: number;
  created_at: number;
  content_base64: string;
}

export interface OWOPFileResource {
  file_id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
  mime_type: string | null;
  size: number;
  modified_ns: number;
  digest: unknown;
  state: "available" | "moved" | "changed" | "deleted";
  capabilities: Record<string, unknown>;
}

export interface OWOPResourceKey {
  protocol: "owop/1";
  authority_id: string;
  workspace_id: string;
  resource_type: "workspace" | "worktree" | "file" | "git" | "process" | "pty" | "checkpoint" | "artifact";
  resource_id: string;
  generation: number;
}

export interface OWOPResourceVersion {
  version_id: string;
  digest: string;
  size: number;
  mime_type: string | null;
  modified_at: string;
}

export interface OWOPResourceCapabilities {
  read_current: boolean;
  read_snapshot: boolean;
  preview: boolean;
  download: boolean;
  reveal: boolean;
  open_external: boolean;
  copy_logical_path: boolean;
}

export interface OWOPResourceDescriptor {
  resource: OWOPResourceKey;
  resolution_id: string;
  state: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported";
  display_name: string;
  logical_path?: string;
  kind: "file" | "directory" | "artifact" | "unknown";
  current_version: OWOPResourceVersion;
  observed_version?: OWOPResourceVersion;
  capabilities: OWOPResourceCapabilities;
  preview?: Record<string, unknown>;
}

export interface OWOPResourceObservation {
  association_id?: string;
  resource: OWOPResourceKey;
  observed_version_id?: string;
  requested_action?: "resolve" | "reveal" | "open_external" | "copy_logical_path" | "open_snapshot";
}

export interface OWOPResourceSafeError {
  code: "resource_not_found" | "workspace_mismatch" | "resource_version_conflict" | "preview_unsupported" | "resource_too_large" | "integrity_mismatch" | "rate_limited" | "action_cancelled" | "offline" | "unsupported";
  retryable: boolean;
  retry_after_ms?: number;
}

export interface OWOPResourceResolveResult {
  association_id?: string;
  resource: OWOPResourceKey;
  descriptor?: OWOPResourceDescriptor;
  error?: OWOPResourceSafeError;
}

export interface OWOPResourceEvent {
  sequence: number;
  event_id: string;
  dedupe_key: string;
  type: string;
  data: Record<string, unknown>;
}

export interface OWOPTerminalScreenRun {
  text: string;
  style: Record<string, unknown>;
}

export interface OWOPTerminalScreenSnapshot {
  version: number;
  snapshot_sequence: number;
  generation: number;
  rows: number;
  cols: number;
  cursor: Record<string, unknown>;
  alternate_screen: boolean;
  bracketed_paste: boolean;
  scrollback: Array<Array<OWOPTerminalScreenRun>>;
  screen: Array<Array<OWOPTerminalScreenRun>>;
}

export interface WorkspaceDescribeParams {
}

export interface FilesListParams {
  path: string;
  cursor?: string;
  depth?: number;
  limit: number;
}

export interface FilesRegisterParams {
  path: string;
  expected_digest?: string;
}

export interface FilesResolveParams {
  file_id: string;
  expected_digest?: string;
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
  timeout_ms?: number;
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
  max_bytes?: number;
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

export interface GitWorktreeListParams {
  include_removed?: boolean;
}

export interface GitWorktreeCreateParams {
  idempotency_key: string;
  intent: string;
}

export interface GitWorktreeDescribeParams {
  worktree_id: string;
}

export interface GitWorktreeMergeParams {
  worktree_id: string;
  idempotency_key: string;
  expected_head?: string;
}

export interface GitWorktreeArchiveParams {
  worktree_id: string;
  idempotency_key: string;
}

export interface GitWorktreeRemoveParams {
  worktree_id: string;
  expected_status: "merged" | "archived";
  idempotency_key: string;
}

export interface GitWorktreePruneParams {
  dry_run: boolean;
  idempotency_key: string;
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

export interface PtyListParams {
}

export interface PtyDescribeParams {
  pty_id: string;
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
  lease_id: string;
  content_base64: string;
}

export interface PtyResizeParams {
  pty_id: string;
  lease_id: string;
  cols: number;
  rows: number;
}

export interface PtyAttachParams {
  pty_id: string;
  lease_id?: string;
  client_id: string;
  mode: "reader" | "writer";
  after_sequence: number;
  lease_seconds?: number;
  prefer_snapshot?: boolean;
}

export interface PtyDetachParams {
  pty_id: string;
  lease_id: string;
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

export interface ResourcesRegisterParams {
  authority_id: string;
  resource_type: "file" | "artifact";
  host_handle?: string;
  logical_path?: string;
  expected_digest?: string;
  idempotency_key: string;
}

export interface ResourcesResolveBatchParams {
  observations: Array<OWOPResourceObservation>;
}

export interface ResourcesReadParams {
  resource: OWOPResourceKey;
  version_id: string;
  offset: number;
  length: number;
  purpose: "preview" | "download" | "open_snapshot";
}

export interface ResourcesPreviewParams {
  resource: OWOPResourceKey;
  version_id: string;
  accept_kinds: Array<string>;
  max_bytes: number;
}

export interface ResourcesDownloadPrepareParams {
  resource: OWOPResourceKey;
  version_id: string;
  suggested_name?: string;
  resume_offset?: number;
}

export interface ResourcesDownloadChunkParams {
  download_id: string;
  offset: number;
  length: number;
}

export interface ResourcesDownloadCancelParams {
  download_id: string;
}

export interface ResourcesSubscribeParams {
  after_sequence: number;
  resource_ids?: Array<string>;
  limit?: number;
}

export interface OWOPParamsByOperation {
  "workspace.describe": WorkspaceDescribeParams;
  "files.list": FilesListParams;
  "files.register": FilesRegisterParams;
  "files.resolve": FilesResolveParams;
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
  "git.worktree.list": GitWorktreeListParams;
  "git.worktree.create": GitWorktreeCreateParams;
  "git.worktree.describe": GitWorktreeDescribeParams;
  "git.worktree.merge": GitWorktreeMergeParams;
  "git.worktree.archive": GitWorktreeArchiveParams;
  "git.worktree.remove": GitWorktreeRemoveParams;
  "git.worktree.prune": GitWorktreePruneParams;
  "process.start": ProcessStartParams;
  "process.write": ProcessWriteParams;
  "process.attach": ProcessAttachParams;
  "process.kill": ProcessKillParams;
  "pty.list": PtyListParams;
  "pty.describe": PtyDescribeParams;
  "pty.create": PtyCreateParams;
  "pty.write": PtyWriteParams;
  "pty.resize": PtyResizeParams;
  "pty.attach": PtyAttachParams;
  "pty.detach": PtyDetachParams;
  "pty.kill": PtyKillParams;
  "checkpoint.create": CheckpointCreateParams;
  "checkpoint.preview": CheckpointPreviewParams;
  "checkpoint.restore": CheckpointRestoreParams;
  "checkpoint.accept": CheckpointAcceptParams;
  "artifact.metadata": ArtifactMetadataParams;
  "artifact.chunk": ArtifactChunkParams;
  "resources.register": ResourcesRegisterParams;
  "resources.resolve_batch": ResourcesResolveBatchParams;
  "resources.read": ResourcesReadParams;
  "resources.preview": ResourcesPreviewParams;
  "resources.download.prepare": ResourcesDownloadPrepareParams;
  "resources.download.chunk": ResourcesDownloadChunkParams;
  "resources.download.cancel": ResourcesDownloadCancelParams;
  "resources.subscribe": ResourcesSubscribeParams;
}

export interface FilesRegisterResult {
  resource: OWOPFileResource;
}

export interface FilesResolveResult {
  resource: OWOPFileResource;
}

export interface ResourcesRegisterResult {
  resource: OWOPResourceKey;
  version: OWOPResourceVersion;
}

export interface ResourcesResolveBatchResult {
  results: Array<OWOPResourceResolveResult>;
}

export interface ResourcesReadResult {
  content_base64: string;
  offset: number;
  length: number;
  eof: boolean;
  version_id: string;
  chunk_digest: string;
}

export interface ResourcesPreviewResult {
  kind: string;
  version_id: string;
  mime_type?: string;
  content_base64?: string;
  preview_handle?: string;
  digest?: string;
  expires_at?: string;
}

export interface ResourcesDownloadPrepareResult {
  download_id: string;
  version_id: string;
  size: number;
  digest: string;
  transport: "owop_chunks" | "https";
  url?: string;
  expires_at: string;
}

export interface ResourcesDownloadChunkResult {
  download_id: string;
  content_base64: string;
  offset: number;
  length: number;
  eof: boolean;
  chunk_digest: string;
}

export interface ResourcesDownloadCancelResult {
  cancelled: boolean;
}

export interface ResourcesSubscribeResult {
  subscription_id: string;
  cursor: string;
  events?: Array<OWOPResourceEvent>;
}

export interface GitWorktreeListResult {
  worktrees: Array<OWOPWorktreeResource>;
}

export interface GitWorktreeCreateResult {
  worktree: OWOPWorktreeResource;
}

export interface GitWorktreeDescribeResult {
  worktree: OWOPWorktreeResource;
}

export interface GitWorktreeMergeResult {
  worktree: OWOPWorktreeResource;
}

export interface GitWorktreeArchiveResult {
  worktree: OWOPWorktreeResource;
}

export interface GitWorktreeRemoveResult {
  worktree: OWOPWorktreeResource;
}

export interface GitWorktreePruneResult {
  candidates: Array<string>;
  pruned: boolean;
}

export interface PtyListResult {
  terminals: Array<OWOPTerminalResource>;
}

export interface PtyDescribeResult {
  terminal: OWOPTerminalResource;
}

export interface PtyCreateResult {
  terminal: OWOPTerminalResource;
}

export interface PtyWriteResult {
  pty_id: string;
  written: number;
}

export interface PtyResizeResult {
  terminal: OWOPTerminalResource;
}

export interface PtyAttachResult {
  lease_id: string;
  mode: "reader" | "writer";
  expires_at: number;
  terminal: OWOPTerminalResource;
  snapshot_required: boolean;
  snapshot?: OWOPTerminalScreenSnapshot;
  events: Array<OWOPTerminalOutputEvent>;
  last_sequence: number;
}

export interface PtyDetachResult {
  terminal: OWOPTerminalResource;
}

export interface PtyKillResult {
  terminal: OWOPTerminalResource;
}

export interface OWOPResultsByOperation {
  "files.register": FilesRegisterResult;
  "files.resolve": FilesResolveResult;
  "resources.register": ResourcesRegisterResult;
  "resources.resolve_batch": ResourcesResolveBatchResult;
  "resources.read": ResourcesReadResult;
  "resources.preview": ResourcesPreviewResult;
  "resources.download.prepare": ResourcesDownloadPrepareResult;
  "resources.download.chunk": ResourcesDownloadChunkResult;
  "resources.download.cancel": ResourcesDownloadCancelResult;
  "resources.subscribe": ResourcesSubscribeResult;
  "git.worktree.list": GitWorktreeListResult;
  "git.worktree.create": GitWorktreeCreateResult;
  "git.worktree.describe": GitWorktreeDescribeResult;
  "git.worktree.merge": GitWorktreeMergeResult;
  "git.worktree.archive": GitWorktreeArchiveResult;
  "git.worktree.remove": GitWorktreeRemoveResult;
  "git.worktree.prune": GitWorktreePruneResult;
  "pty.list": PtyListResult;
  "pty.describe": PtyDescribeResult;
  "pty.create": PtyCreateResult;
  "pty.write": PtyWriteResult;
  "pty.resize": PtyResizeResult;
  "pty.attach": PtyAttachResult;
  "pty.detach": PtyDetachResult;
  "pty.kill": PtyKillResult;
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
