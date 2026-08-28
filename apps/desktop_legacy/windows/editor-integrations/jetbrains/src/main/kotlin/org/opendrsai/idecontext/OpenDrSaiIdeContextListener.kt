package org.opendrsai.idecontext

import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VirtualFile
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant

private const val CONTEXT_RELATIVE_PATH = ".drsai/ide-context.json"
private const val MAX_SELECTION_CHARS = 12000

class OpenDrSaiIdeContextListener : FileEditorManagerListener {
  override fun selectionChanged(event: FileEditorManagerEvent) {
    captureIdeContext(event.manager.project)
  }
}

fun captureIdeContext(project: Project) {
  val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
  val file = FileEditorManager.getInstance(project).selectedFiles.firstOrNull() ?: return
  val workspaceRoot = resolveWorkspaceRoot(project, file) ?: return
  val filePath = Path.of(file.path).toAbsolutePath().normalize()
  if (!isInsidePath(workspaceRoot, filePath)) return
  val relativePath = workspaceRoot.relativize(filePath).toString().replace('\\', '/')
  val payload = buildPayload(editor, file, filePath, relativePath)
  writeWorkspaceContext(workspaceRoot, payload)
}

private fun resolveWorkspaceRoot(project: Project, file: VirtualFile): Path? {
  val contentRoot = ProjectRootManager.getInstance(project)
    .fileIndex
    .getContentRootForFile(file)
    ?.path
  val basePath = contentRoot ?: project.basePath ?: return null
  return Path.of(basePath).toAbsolutePath().normalize()
}

private fun buildPayload(
  editor: Editor,
  file: VirtualFile,
  filePath: Path,
  relativePath: String,
): String {
  val document = editor.document
  val caret = editor.caretModel.primaryCaret
  val language = file.extension ?: "text"
  val line = caret.logicalPosition.line + 1
  val column = caret.logicalPosition.column + 1
  val selectedText = caret.selectedText?.replace("\u0000", "")?.trim().orEmpty()
  val truncated = selectedText.length > MAX_SELECTION_CHARS
  val selectionJson = if (selectedText.isBlank()) {
    ""
  } else {
    val startLine = document.getLineNumber(caret.selectionStart) + 1
    val endLine = document.getLineNumber(caret.selectionEnd) + 1
    """
  ,
  "currentSelection": {
    "path": "${json(filePath.toString())}",
    "relativePath": "${json(relativePath)}",
    "text": "${json(selectedText.take(MAX_SELECTION_CHARS))}",
    "startLine": $startLine,
    "endLine": $endLine,
    "language": "${json(language)}",
    "truncated": $truncated
  }
""".trimEnd()
  }
  return """
{
  "source": "jetbrains",
  "capturedAt": "${Instant.now()}",
  "currentFile": {
    "path": "${json(filePath.toString())}",
    "relativePath": "${json(relativePath)}",
    "language": "${json(language)}",
    "line": $line,
    "column": $column
  }$selectionJson
}
""".trimIndent() + "\n"
}

private fun writeWorkspaceContext(workspaceRoot: Path, payload: String) {
  val contextPath = workspaceRoot.resolve(CONTEXT_RELATIVE_PATH).normalize()
  if (!isInsidePath(workspaceRoot, contextPath)) return
  Files.createDirectories(contextPath.parent)
  val tempPath = contextPath.resolveSibling("${contextPath.fileName}.${ProcessHandle.current().pid()}.tmp")
  Files.writeString(tempPath, payload, StandardCharsets.UTF_8)
  Files.move(tempPath, contextPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
}

private fun isInsidePath(parentPath: Path, childPath: Path): Boolean {
  val normalizedParent = parentPath.toAbsolutePath().normalize()
  val normalizedChild = childPath.toAbsolutePath().normalize()
  return normalizedChild != normalizedParent && normalizedChild.startsWith(normalizedParent)
}

private fun json(value: String): String = value
  .replace("\\", "\\\\")
  .replace("\"", "\\\"")
  .replace("\r", "\\r")
  .replace("\n", "\\n")
