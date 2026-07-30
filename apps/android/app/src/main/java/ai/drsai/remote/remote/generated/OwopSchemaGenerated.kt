// Generated from cores/protocol/owop/owop.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object OwopSchemaGenerated {
    const val VERSION: String = "1.0"
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
"files.remove",
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
}
