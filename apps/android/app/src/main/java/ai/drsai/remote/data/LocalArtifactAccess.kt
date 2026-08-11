package ai.drsai.remote.data

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class ArtifactPreviewKind { TEXT, IMAGE, PDF, EXTERNAL, TOO_LARGE }

data class LocalArtifactHandle(
    val artifactId: String,
    val displayName: String,
    val mimeType: String,
    val size: Long,
    val sha256: String,
    internal val file: File,
)

object LocalArtifactPolicy {
    const val MAX_OPEN_BYTES = 256L * 1024 * 1024
    private const val MAX_INLINE_TEXT_BYTES = 1L * 1024 * 1024

    fun previewKind(mimeType: String, size: Long): ArtifactPreviewKind = when {
        size !in 0..MAX_OPEN_BYTES -> ArtifactPreviewKind.TOO_LARGE
        mimeType.startsWith("text/") && size <= MAX_INLINE_TEXT_BYTES -> ArtifactPreviewKind.TEXT
        mimeType.startsWith("image/") -> ArtifactPreviewKind.IMAGE
        mimeType == "application/pdf" -> ArtifactPreviewKind.PDF
        else -> ArtifactPreviewKind.EXTERNAL
    }

    fun safeName(value: String): String = AttachmentPolicy.sanitizeName(File(value.replace('\\', '/')).name)
        .ifBlank { "artifact" }.take(180)

    fun digest(file: File): String = MessageDigest.getInstance("SHA-256").let { digest ->
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }
}

/** Recreates a verified app-private artifact after process restart without exposing its storage path. */
class LocalArtifactMaterializer(private val context: Context, private val dao: ChatDao) {
    suspend fun prepare(subject: String, artifactId: String, source: String): LocalArtifactHandle =
        withContext(Dispatchers.IO) {
            require(subject.isNotBlank()) { "artifact_subject_required" }
            when (source) {
                "attachment" -> attachment(subject, artifactId)
                "tool" -> toolOutput(subject, artifactId)
                else -> error("artifact_source_invalid")
            }
        }

    private suspend fun attachment(subject: String, artifactId: String): LocalArtifactHandle {
        val row = dao.allAttachmentsForUser(subject).firstOrNull { it.id == artifactId }
            ?: error("artifact_not_found")
        val path = requireNotNull(row.localPath) { "artifact_local_content_unavailable" }
        require(!path.startsWith("content://")) { "artifact_internal_uri_invalid" }
        val source = File(path).canonicalFile
        require(source.isFile && allowed(source)) { "artifact_path_outside_app_storage" }
        require(source.length() == row.size && row.size in 0..LocalArtifactPolicy.MAX_OPEN_BYTES) {
            "artifact_size_mismatch"
        }
        val actual = LocalArtifactPolicy.digest(source)
        val expected = row.sha256.lowercase().takeIf { it.matches(Regex("^[a-f0-9]{64}$")) }
        require(expected == null || expected == actual) { "artifact_digest_mismatch" }
        return materialize(row.id, row.name, row.mimeType, source, actual)
    }

    private suspend fun toolOutput(subject: String, artifactId: String): LocalArtifactHandle {
        val row = dao.allToolArtifacts(subject).firstOrNull { it.id == artifactId }
            ?: error("artifact_not_found")
        val bytes = row.content.encodeToByteArray()
        require(bytes.size.toLong() <= LocalArtifactPolicy.MAX_OPEN_BYTES) { "artifact_size_limit" }
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val directory = File(context.cacheDir, "workbench/artifacts").apply { mkdirs() }
        val target = File(directory, "$digest-${LocalArtifactPolicy.safeName(row.toolId)}-output.txt")
        if (!target.isFile || target.length() != bytes.size.toLong() || LocalArtifactPolicy.digest(target) != digest) {
            val temporary = File(directory, ".${target.name}.tmp")
            temporary.outputStream().buffered().use { it.write(bytes) }
            require(temporary.renameTo(target) || runCatching {
                temporary.copyTo(target, overwrite = true); temporary.delete(); true
            }.getOrDefault(false)) { "artifact_materialize_failed" }
        }
        return handle(row.id, target.name, "text/plain", target, digest)
    }

    private fun materialize(
        id: String, name: String, mimeType: String, source: File, digest: String,
    ): LocalArtifactHandle {
        val directory = File(context.cacheDir, "workbench/artifacts").apply { mkdirs() }
        val target = File(directory, "$digest-${LocalArtifactPolicy.safeName(name)}")
        if (!target.isFile || target.length() != source.length() || LocalArtifactPolicy.digest(target) != digest) {
            source.inputStream().buffered().use { input ->
                target.outputStream().buffered().use { output -> input.copyTo(output) }
            }
        }
        require(LocalArtifactPolicy.digest(target) == digest) { "artifact_digest_mismatch" }
        return handle(id, name, mimeType, target, digest)
    }

    private fun handle(id: String, name: String, mimeType: String, file: File, digest: String) = LocalArtifactHandle(
        id, LocalArtifactPolicy.safeName(name), mimeType.ifBlank { "application/octet-stream" }, file.length(), digest, file,
    )

    private fun allowed(file: File): Boolean = listOf(context.cacheDir, context.filesDir).any { root ->
        val prefix = root.canonicalFile.path.trimEnd(File.separatorChar) + File.separator
        file.path.startsWith(prefix)
    }
}

fun localArtifactIntent(context: Context, handle: LocalArtifactHandle, share: Boolean): Intent {
    require(handle.size in 0..LocalArtifactPolicy.MAX_OPEN_BYTES) { "artifact_size_limit" }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", handle.file)
    return if (share) Intent(Intent.ACTION_SEND).apply {
        type = handle.mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newUri(context.contentResolver, handle.displayName, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    } else Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, handle.mimeType)
        clipData = ClipData.newUri(context.contentResolver, handle.displayName, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
