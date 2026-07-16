"""Generated from protocol/owop/owop.schema.json; do not edit."""

from __future__ import annotations

from typing import Any, Literal, NotRequired, Required, TypedDict, TypeAlias

SCHEMA_SHA256 = "5bf676a8c35d9c7fe111f948aa8e309b73651e4e737807420ac920a1a8c7d1f7"
OWOP_VERSION = '1.0'
OWOPCapability: TypeAlias = Literal['workspace', 'files', 'search', 'watch', 'git', 'process', 'pty', 'checkpoint', 'artifact']
OWOPBindingKind: TypeAlias = Literal['in_process', 'local_ipc', 'ssh', 'hepai_if', 'mcp', 'ddf']
OWOPOperation: TypeAlias = Literal['workspace.describe', 'files.list', 'files.stat', 'files.read', 'files.write', 'files.move', 'files.remove', 'search.query', 'watch.subscribe', 'git.status', 'git.diff', 'git.file_at_ref', 'git.stage', 'git.unstage', 'git.revert', 'git.commit', 'process.start', 'process.write', 'process.attach', 'process.kill', 'pty.create', 'pty.write', 'pty.resize', 'pty.attach', 'pty.kill', 'checkpoint.create', 'checkpoint.preview', 'checkpoint.restore', 'checkpoint.accept', 'artifact.metadata', 'artifact.chunk']

class WorkspaceDescribeParams(TypedDict, total=False):
    pass

class FilesListParams(TypedDict, total=False):
    path: Required[str]
    cursor: NotRequired[str]
    limit: Required[int]

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

class PtyCreateParams(TypedDict, total=False):
    argv: Required[list[str]]
    cwd: Required[str]
    cols: Required[int]
    rows: Required[int]
    max_buffer_bytes: NotRequired[int]

class PtyWriteParams(TypedDict, total=False):
    pty_id: Required[str]
    content_base64: Required[str]

class PtyResizeParams(TypedDict, total=False):
    pty_id: Required[str]
    cols: Required[int]
    rows: Required[int]

class PtyAttachParams(TypedDict, total=False):
    pty_id: Required[str]
    after_offset: Required[int]

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

OWOP_PARAMS_BY_OPERATION: dict[str, type[TypedDict]] = {
    'workspace.describe': WorkspaceDescribeParams,
    'files.list': FilesListParams,
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
    'process.start': ProcessStartParams,
    'process.write': ProcessWriteParams,
    'process.attach': ProcessAttachParams,
    'process.kill': ProcessKillParams,
    'pty.create': PtyCreateParams,
    'pty.write': PtyWriteParams,
    'pty.resize': PtyResizeParams,
    'pty.attach': PtyAttachParams,
    'pty.kill': PtyKillParams,
    'checkpoint.create': CheckpointCreateParams,
    'checkpoint.preview': CheckpointPreviewParams,
    'checkpoint.restore': CheckpointRestoreParams,
    'checkpoint.accept': CheckpointAcceptParams,
    'artifact.metadata': ArtifactMetadataParams,
    'artifact.chunk': ArtifactChunkParams,
}
