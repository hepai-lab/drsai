"""Generated from cores/protocol/owop/owop.schema.json; do not edit."""

from __future__ import annotations

from typing import Any, Literal, TypedDict
try:
    from typing import NotRequired, Required, TypeAlias
except ImportError:  # Python 3.9 compatibility for tooling hosts
    from typing_extensions import NotRequired, Required, TypeAlias

SCHEMA_SHA256 = "ebdbf06e783d100a8c49bcfc913469e102251a9e13082fba7385de13b5f0bec7"
OWOP_VERSION = '1.0'
OWOPCapability: TypeAlias = Literal['workspace', 'worktree', 'files', 'search', 'watch', 'git', 'process', 'pty', 'checkpoint', 'artifact', 'resources.v2']
OWOPBindingKind: TypeAlias = Literal['in_process', 'local_ipc', 'ssh', 'hepai_if', 'mcp', 'ddf', 'relay']
OWOPOperation: TypeAlias = Literal['workspace.describe', 'files.list', 'files.register', 'files.resolve', 'files.stat', 'files.read', 'files.write', 'files.move', 'files.remove', 'search.query', 'watch.subscribe', 'git.status', 'git.diff', 'git.file_at_ref', 'git.stage', 'git.unstage', 'git.revert', 'git.commit', 'git.worktree.list', 'git.worktree.create', 'git.worktree.describe', 'git.worktree.merge', 'git.worktree.archive', 'git.worktree.remove', 'git.worktree.prune', 'process.start', 'process.write', 'process.attach', 'process.kill', 'pty.list', 'pty.describe', 'pty.create', 'pty.write', 'pty.resize', 'pty.attach', 'pty.detach', 'pty.kill', 'checkpoint.create', 'checkpoint.preview', 'checkpoint.restore', 'checkpoint.accept', 'artifact.metadata', 'artifact.chunk', 'resources.register', 'resources.resolve_batch', 'resources.read', 'resources.preview', 'resources.download.prepare', 'resources.download.chunk', 'resources.download.cancel', 'resources.subscribe']

class OWOPWorktreeResource(TypedDict, total=False):
    worktree_id: Required[str]
    source_workspace_id: Required[str]
    workspace_id: Required[str | None]
    repo_root: Required[str]
    canonical_path: Required[str]
    branch: Required[str]
    base_commit: Required[str]
    status: Required[str]
    location: Required[str]
    source_dirty: NotRequired[bool]
    source_status_summary: NotRequired[str | None]
    created_at: Required[str]
    updated_at: Required[str]
    removed_at: NotRequired[str | None]
    last_error_code: NotRequired[str | None]
    last_error_message: NotRequired[str | None]
    head_commit: NotRequired[str | None]
    dirty: NotRequired[bool]
    ahead: NotRequired[int]
    behind: NotRequired[int]
    activity: NotRequired[dict[str, Any]]

class OWOPTerminalResource(TypedDict, total=False):
    terminal_id: Required[str]
    runtime_id: Required[str]
    workspace_id: Required[str]
    worktree_id: Required[str | None]
    cwd: Required[str]
    shell: NotRequired[str | None]
    argv: Required[list[str]]
    status: Required[str]
    generation: Required[int]
    pid: Required[int | None]
    cols: Required[int]
    rows: Required[int]
    created_at: Required[float]
    updated_at: Required[float]
    exited_at: Required[float | None]
    exit_code: Required[int | None]
    exit_signal: Required[str | None]
    last_sequence: Required[int]
    first_sequence: Required[int]
    journal_bytes: Required[int]

class OWOPTerminalOutputEvent(TypedDict, total=False):
    terminal_id: Required[str]
    runtime_id: Required[str]
    workspace_id: Required[str]
    worktree_id: Required[str | None]
    generation: Required[int]
    sequence: Required[int]
    created_at: Required[float]
    content_base64: Required[str]

class OWOPFileResource(TypedDict, total=False):
    file_id: Required[str]
    path: Required[str]
    name: Required[str]
    kind: Required[str]
    mime_type: Required[str | None]
    size: Required[int]
    modified_ns: Required[int]
    digest: Required[Any]
    state: Required[str]
    capabilities: Required[dict[str, Any]]

class OWOPResourceKey(TypedDict, total=False):
    protocol: Required[str]
    authority_id: Required[str]
    workspace_id: Required[str]
    resource_type: Required[str]
    resource_id: Required[str]
    generation: Required[int]

class OWOPResourceVersion(TypedDict, total=False):
    version_id: Required[str]
    digest: Required[str]
    size: Required[int]
    mime_type: Required[str | None]
    modified_at: Required[str]

class OWOPResourceCapabilities(TypedDict, total=False):
    read_current: Required[bool]
    read_snapshot: Required[bool]
    preview: Required[bool]
    download: Required[bool]
    reveal: Required[bool]
    open_external: Required[bool]
    copy_logical_path: Required[bool]

class OWOPResourceDescriptor(TypedDict, total=False):
    resource: Required[OWOPResourceKey]
    resolution_id: Required[str]
    state: Required[str]
    display_name: Required[str]
    logical_path: NotRequired[str]
    kind: Required[str]
    current_version: Required[OWOPResourceVersion]
    observed_version: NotRequired[OWOPResourceVersion]
    capabilities: Required[OWOPResourceCapabilities]
    preview: NotRequired[dict[str, Any]]

class OWOPResourceObservation(TypedDict, total=False):
    association_id: NotRequired[str]
    resource: Required[OWOPResourceKey]
    observed_version_id: NotRequired[str]
    requested_action: NotRequired[str]

class OWOPResourceSafeError(TypedDict, total=False):
    code: Required[str]
    retryable: Required[bool]
    retry_after_ms: NotRequired[int]

class OWOPResourceResolveResult(TypedDict, total=False):
    association_id: NotRequired[str]
    resource: Required[OWOPResourceKey]
    descriptor: NotRequired[OWOPResourceDescriptor]
    error: NotRequired[OWOPResourceSafeError]

class OWOPResourceEvent(TypedDict, total=False):
    sequence: Required[int]
    event_id: Required[str]
    dedupe_key: Required[str]
    type: Required[str]
    data: Required[dict[str, Any]]

class OWOPTerminalScreenRun(TypedDict, total=False):
    text: Required[str]
    style: Required[dict[str, Any]]

class OWOPTerminalScreenSnapshot(TypedDict, total=False):
    version: Required[int]
    snapshot_sequence: Required[int]
    generation: Required[int]
    rows: Required[int]
    cols: Required[int]
    cursor: Required[dict[str, Any]]
    alternate_screen: Required[bool]
    bracketed_paste: Required[bool]
    scrollback: Required[list[list[OWOPTerminalScreenRun]]]
    screen: Required[list[list[OWOPTerminalScreenRun]]]

class WorkspaceDescribeParams(TypedDict, total=False):
    pass

class FilesListParams(TypedDict, total=False):
    path: Required[str]
    cursor: NotRequired[str]
    depth: NotRequired[int]
    limit: Required[int]

class FilesRegisterParams(TypedDict, total=False):
    path: Required[str]
    expected_digest: NotRequired[str]

class FilesResolveParams(TypedDict, total=False):
    file_id: Required[str]
    expected_digest: NotRequired[str]

class FilesStatParams(TypedDict, total=False):
    path: Required[str]

class FilesReadParams(TypedDict, total=False):
    path: Required[str]
    offset: Required[int]
    length: Required[int]

class FilesWriteParams(TypedDict, total=False):
    path: Required[str]
    content_base64: Required[str]
    expected_digest: NotRequired[str]
    create_parents: NotRequired[bool]

class FilesMoveParams(TypedDict, total=False):
    source: Required[str]
    destination: Required[str]
    expected_digest: NotRequired[str]

class FilesRemoveParams(TypedDict, total=False):
    path: Required[str]
    expected_digest: NotRequired[str]
    recursive: NotRequired[bool]

class SearchQueryParams(TypedDict, total=False):
    query: Required[str]
    path: NotRequired[str]
    cursor: NotRequired[str]
    limit: Required[int]
    timeout_ms: NotRequired[int]
    include_ignored: NotRequired[bool]

class WatchSubscribeParams(TypedDict, total=False):
    path: NotRequired[str]
    after_sequence: Required[int]
    limit: NotRequired[int]

class GitStatusParams(TypedDict, total=False):
    pass

class GitDiffParams(TypedDict, total=False):
    path: NotRequired[str]
    staged: NotRequired[bool]

class GitFileAtRefParams(TypedDict, total=False):
    path: Required[str]
    ref: Required[str]
    max_bytes: NotRequired[int]

class GitStageParams(TypedDict, total=False):
    paths: Required[list[str]]

class GitUnstageParams(TypedDict, total=False):
    paths: Required[list[str]]

class GitRevertParams(TypedDict, total=False):
    paths: Required[list[str]]
    diff_digest: Required[str]

class GitCommitParams(TypedDict, total=False):
    message: Required[str]
    diff_digest: Required[str]

class GitWorktreeListParams(TypedDict, total=False):
    include_removed: NotRequired[bool]

class GitWorktreeCreateParams(TypedDict, total=False):
    idempotency_key: Required[str]
    intent: Required[str]

class GitWorktreeDescribeParams(TypedDict, total=False):
    worktree_id: Required[str]

class GitWorktreeMergeParams(TypedDict, total=False):
    worktree_id: Required[str]
    idempotency_key: Required[str]
    expected_head: NotRequired[str]

class GitWorktreeArchiveParams(TypedDict, total=False):
    worktree_id: Required[str]
    idempotency_key: Required[str]

class GitWorktreeRemoveParams(TypedDict, total=False):
    worktree_id: Required[str]
    expected_status: Required[str]
    idempotency_key: Required[str]

class GitWorktreePruneParams(TypedDict, total=False):
    dry_run: Required[bool]
    idempotency_key: Required[str]

class ProcessStartParams(TypedDict, total=False):
    argv: Required[list[str]]
    cwd: Required[str]
    timeout_ms: NotRequired[int]
    max_output_bytes: NotRequired[int]

class ProcessWriteParams(TypedDict, total=False):
    process_id: Required[str]
    content_base64: Required[str]

class ProcessAttachParams(TypedDict, total=False):
    process_id: Required[str]
    after_offset: Required[int]

class ProcessKillParams(TypedDict, total=False):
    process_id: Required[str]
    tree: NotRequired[bool]

class PtyListParams(TypedDict, total=False):
    pass

class PtyDescribeParams(TypedDict, total=False):
    pty_id: Required[str]

class PtyCreateParams(TypedDict, total=False):
    argv: Required[list[str]]
    cwd: Required[str]
    cols: Required[int]
    rows: Required[int]
    max_buffer_bytes: NotRequired[int]

class PtyWriteParams(TypedDict, total=False):
    pty_id: Required[str]
    lease_id: Required[str]
    content_base64: Required[str]

class PtyResizeParams(TypedDict, total=False):
    pty_id: Required[str]
    lease_id: Required[str]
    cols: Required[int]
    rows: Required[int]

class PtyAttachParams(TypedDict, total=False):
    pty_id: Required[str]
    lease_id: NotRequired[str]
    client_id: Required[str]
    mode: Required[str]
    after_sequence: Required[int]
    lease_seconds: NotRequired[int]
    prefer_snapshot: NotRequired[bool]

class PtyDetachParams(TypedDict, total=False):
    pty_id: Required[str]
    lease_id: Required[str]

class PtyKillParams(TypedDict, total=False):
    pty_id: Required[str]

class CheckpointCreateParams(TypedDict, total=False):
    label: NotRequired[str]
    max_file_bytes: NotRequired[int]

class CheckpointPreviewParams(TypedDict, total=False):
    checkpoint_id: Required[str]

class CheckpointRestoreParams(TypedDict, total=False):
    checkpoint_id: Required[str]
    preview_digest: Required[str]

class CheckpointAcceptParams(TypedDict, total=False):
    checkpoint_id: Required[str]

class ArtifactMetadataParams(TypedDict, total=False):
    artifact_id: Required[str]

class ArtifactChunkParams(TypedDict, total=False):
    artifact_id: Required[str]
    offset: Required[int]
    length: Required[int]

class ResourcesRegisterParams(TypedDict, total=False):
    authority_id: Required[str]
    resource_type: Required[str]
    host_handle: NotRequired[str]
    logical_path: NotRequired[str]
    expected_digest: NotRequired[str]
    idempotency_key: Required[str]

class ResourcesResolveBatchParams(TypedDict, total=False):
    observations: Required[list[OWOPResourceObservation]]

class ResourcesReadParams(TypedDict, total=False):
    resource: Required[OWOPResourceKey]
    version_id: Required[str]
    offset: Required[int]
    length: Required[int]
    purpose: Required[str]

class ResourcesPreviewParams(TypedDict, total=False):
    resource: Required[OWOPResourceKey]
    version_id: Required[str]
    accept_kinds: Required[list[str]]
    max_bytes: Required[int]

class ResourcesDownloadPrepareParams(TypedDict, total=False):
    resource: Required[OWOPResourceKey]
    version_id: Required[str]
    suggested_name: NotRequired[str]
    resume_offset: NotRequired[int]

class ResourcesDownloadChunkParams(TypedDict, total=False):
    download_id: Required[str]
    offset: Required[int]
    length: Required[int]

class ResourcesDownloadCancelParams(TypedDict, total=False):
    download_id: Required[str]

class ResourcesSubscribeParams(TypedDict, total=False):
    after_sequence: Required[int]
    resource_ids: NotRequired[list[str]]
    limit: NotRequired[int]

OWOP_PARAMS_BY_OPERATION: dict[str, type[TypedDict]] = {
    'workspace.describe': WorkspaceDescribeParams,
    'files.list': FilesListParams,
    'files.register': FilesRegisterParams,
    'files.resolve': FilesResolveParams,
    'files.stat': FilesStatParams,
    'files.read': FilesReadParams,
    'files.write': FilesWriteParams,
    'files.move': FilesMoveParams,
    'files.remove': FilesRemoveParams,
    'search.query': SearchQueryParams,
    'watch.subscribe': WatchSubscribeParams,
    'git.status': GitStatusParams,
    'git.diff': GitDiffParams,
    'git.file_at_ref': GitFileAtRefParams,
    'git.stage': GitStageParams,
    'git.unstage': GitUnstageParams,
    'git.revert': GitRevertParams,
    'git.commit': GitCommitParams,
    'git.worktree.list': GitWorktreeListParams,
    'git.worktree.create': GitWorktreeCreateParams,
    'git.worktree.describe': GitWorktreeDescribeParams,
    'git.worktree.merge': GitWorktreeMergeParams,
    'git.worktree.archive': GitWorktreeArchiveParams,
    'git.worktree.remove': GitWorktreeRemoveParams,
    'git.worktree.prune': GitWorktreePruneParams,
    'process.start': ProcessStartParams,
    'process.write': ProcessWriteParams,
    'process.attach': ProcessAttachParams,
    'process.kill': ProcessKillParams,
    'pty.list': PtyListParams,
    'pty.describe': PtyDescribeParams,
    'pty.create': PtyCreateParams,
    'pty.write': PtyWriteParams,
    'pty.resize': PtyResizeParams,
    'pty.attach': PtyAttachParams,
    'pty.detach': PtyDetachParams,
    'pty.kill': PtyKillParams,
    'checkpoint.create': CheckpointCreateParams,
    'checkpoint.preview': CheckpointPreviewParams,
    'checkpoint.restore': CheckpointRestoreParams,
    'checkpoint.accept': CheckpointAcceptParams,
    'artifact.metadata': ArtifactMetadataParams,
    'artifact.chunk': ArtifactChunkParams,
    'resources.register': ResourcesRegisterParams,
    'resources.resolve_batch': ResourcesResolveBatchParams,
    'resources.read': ResourcesReadParams,
    'resources.preview': ResourcesPreviewParams,
    'resources.download.prepare': ResourcesDownloadPrepareParams,
    'resources.download.chunk': ResourcesDownloadChunkParams,
    'resources.download.cancel': ResourcesDownloadCancelParams,
    'resources.subscribe': ResourcesSubscribeParams,
}

class FilesRegisterResult(TypedDict, total=False):
    resource: Required[OWOPFileResource]

class FilesResolveResult(TypedDict, total=False):
    resource: Required[OWOPFileResource]

class ResourcesRegisterResult(TypedDict, total=False):
    resource: Required[OWOPResourceKey]
    version: Required[OWOPResourceVersion]

class ResourcesResolveBatchResult(TypedDict, total=False):
    results: Required[list[OWOPResourceResolveResult]]

class ResourcesReadResult(TypedDict, total=False):
    content_base64: Required[str]
    offset: Required[int]
    length: Required[int]
    eof: Required[bool]
    version_id: Required[str]
    chunk_digest: Required[str]

class ResourcesPreviewResult(TypedDict, total=False):
    kind: Required[str]
    version_id: Required[str]
    mime_type: NotRequired[str]
    content_base64: NotRequired[str]
    preview_handle: NotRequired[str]
    digest: NotRequired[str]
    expires_at: NotRequired[str]

class ResourcesDownloadPrepareResult(TypedDict, total=False):
    download_id: Required[str]
    version_id: Required[str]
    size: Required[int]
    digest: Required[str]
    transport: Required[str]
    url: NotRequired[str]
    expires_at: Required[str]

class ResourcesDownloadChunkResult(TypedDict, total=False):
    download_id: Required[str]
    content_base64: Required[str]
    offset: Required[int]
    length: Required[int]
    eof: Required[bool]
    chunk_digest: Required[str]

class ResourcesDownloadCancelResult(TypedDict, total=False):
    cancelled: Required[bool]

class ResourcesSubscribeResult(TypedDict, total=False):
    subscription_id: Required[str]
    cursor: Required[str]
    events: NotRequired[list[OWOPResourceEvent]]

class GitWorktreeListResult(TypedDict, total=False):
    worktrees: Required[list[OWOPWorktreeResource]]

class GitWorktreeCreateResult(TypedDict, total=False):
    worktree: Required[OWOPWorktreeResource]

class GitWorktreeDescribeResult(TypedDict, total=False):
    worktree: Required[OWOPWorktreeResource]

class GitWorktreeMergeResult(TypedDict, total=False):
    worktree: Required[OWOPWorktreeResource]

class GitWorktreeArchiveResult(TypedDict, total=False):
    worktree: Required[OWOPWorktreeResource]

class GitWorktreeRemoveResult(TypedDict, total=False):
    worktree: Required[OWOPWorktreeResource]

class GitWorktreePruneResult(TypedDict, total=False):
    candidates: Required[list[str]]
    pruned: Required[bool]

class PtyListResult(TypedDict, total=False):
    terminals: Required[list[OWOPTerminalResource]]

class PtyDescribeResult(TypedDict, total=False):
    terminal: Required[OWOPTerminalResource]

class PtyCreateResult(TypedDict, total=False):
    terminal: Required[OWOPTerminalResource]

class PtyWriteResult(TypedDict, total=False):
    pty_id: Required[str]
    written: Required[int]

class PtyResizeResult(TypedDict, total=False):
    terminal: Required[OWOPTerminalResource]

class PtyAttachResult(TypedDict, total=False):
    lease_id: Required[str]
    mode: Required[str]
    expires_at: Required[float]
    terminal: Required[OWOPTerminalResource]
    snapshot_required: Required[bool]
    snapshot: NotRequired[OWOPTerminalScreenSnapshot]
    events: Required[list[OWOPTerminalOutputEvent]]
    last_sequence: Required[int]

class PtyDetachResult(TypedDict, total=False):
    terminal: Required[OWOPTerminalResource]

class PtyKillResult(TypedDict, total=False):
    terminal: Required[OWOPTerminalResource]

OWOP_RESULTS_BY_OPERATION: dict[str, type[TypedDict]] = {
    'files.register': FilesRegisterResult,
    'files.resolve': FilesResolveResult,
    'resources.register': ResourcesRegisterResult,
    'resources.resolve_batch': ResourcesResolveBatchResult,
    'resources.read': ResourcesReadResult,
    'resources.preview': ResourcesPreviewResult,
    'resources.download.prepare': ResourcesDownloadPrepareResult,
    'resources.download.chunk': ResourcesDownloadChunkResult,
    'resources.download.cancel': ResourcesDownloadCancelResult,
    'resources.subscribe': ResourcesSubscribeResult,
    'git.worktree.list': GitWorktreeListResult,
    'git.worktree.create': GitWorktreeCreateResult,
    'git.worktree.describe': GitWorktreeDescribeResult,
    'git.worktree.merge': GitWorktreeMergeResult,
    'git.worktree.archive': GitWorktreeArchiveResult,
    'git.worktree.remove': GitWorktreeRemoveResult,
    'git.worktree.prune': GitWorktreePruneResult,
    'pty.list': PtyListResult,
    'pty.describe': PtyDescribeResult,
    'pty.create': PtyCreateResult,
    'pty.write': PtyWriteResult,
    'pty.resize': PtyResizeResult,
    'pty.attach': PtyAttachResult,
    'pty.detach': PtyDetachResult,
    'pty.kill': PtyKillResult,
}
