// Generated from cores/protocol/owop/owop.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object OwopSchemaGenerated {
    const val VERSION: String = "1.0"
    const val SCHEMA_SHA256: String = "f2b57650032e7a19e1c0d788b28436607728361f10ab2c41617cac2117af56b5"
    val OPERATIONS: Set<String> = setOf(
        "artifact.chunk",
        "artifact.metadata",
        "checkpoint.accept",
        "checkpoint.create",
        "checkpoint.preview",
        "checkpoint.restore",
        "files.list",
        "files.move",
        "files.read",
        "files.register",
        "files.remove",
        "files.resolve",
        "files.stat",
        "files.write",
        "git.commit",
        "git.diff",
        "git.file_at_ref",
        "git.revert",
        "git.stage",
        "git.status",
        "git.unstage",
        "git.worktree.archive",
        "git.worktree.create",
        "git.worktree.describe",
        "git.worktree.list",
        "git.worktree.merge",
        "git.worktree.prune",
        "git.worktree.remove",
        "process.attach",
        "process.kill",
        "process.start",
        "process.write",
        "pty.attach",
        "pty.create",
        "pty.describe",
        "pty.detach",
        "pty.kill",
        "pty.list",
        "pty.resize",
        "pty.write",
        "resources.download.cancel",
        "resources.download.chunk",
        "resources.download.prepare",
        "resources.preview",
        "resources.read",
        "resources.register",
        "resources.resolve_batch",
        "resources.subscribe",
        "search.query",
        "watch.subscribe",
        "workspace.describe"
    )
    val BINDINGS: Set<String> = setOf(
        "ddf",
        "hepai_if",
        "in_process",
        "local_ipc",
        "mcp",
        "relay",
        "ssh"
    )
    val CAPABILITIES: Set<String> = setOf(
        "artifact",
        "checkpoint",
        "files",
        "git",
        "process",
        "pty",
        "resources.v2",
        "search",
        "watch",
        "workspace",
        "worktree"
    )
}

data class OwopResourceKey(val protocol: String = "owop/1", val authorityId: String, val workspaceId: String, val resourceType: String, val resourceId: String, val generation: Long)
data class OwopResourceVersion(val versionId: String, val digest: String, val size: Long, val mimeType: String?, val modifiedAt: String)
data class OwopResourceCapabilities(val readCurrent: Boolean, val readSnapshot: Boolean, val preview: Boolean, val download: Boolean, val reveal: Boolean, val openExternal: Boolean, val copyLogicalPath: Boolean)
data class OwopResourceDescriptor(val resource: OwopResourceKey, val resolutionId: String, val state: String, val displayName: String, val logicalPath: String?, val kind: String, val currentVersion: OwopResourceVersion, val observedVersion: OwopResourceVersion?, val capabilities: OwopResourceCapabilities)
