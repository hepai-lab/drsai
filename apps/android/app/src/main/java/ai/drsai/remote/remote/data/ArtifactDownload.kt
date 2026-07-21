package ai.drsai.remote.remote.data

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest

data class ArtifactMetadata(val artifactId: String, val fileName: String, val mimeType: String, val size: Long,
                            val sha256: String, val runtimeId: String, val workspaceId: String, val subject: String)
fun interface ArtifactChunkSource { suspend fun read(offset: Long, length: Int): ByteArray }

class ArtifactDownloader(private val maxSize: Long = 256L * 1024 * 1024, private val chunkSize: Int = 256 * 1024) {
    suspend fun download(metadata: ArtifactMetadata, expectedSubject: String, expectedRuntime: String,
                         expectedWorkspace: String, output: OutputStream, source: ArtifactChunkSource) = withContext(Dispatchers.IO) {
        require(metadata.subject == expectedSubject && metadata.runtimeId == expectedRuntime && metadata.workspaceId == expectedWorkspace) { "artifact_scope_mismatch" }
        require(metadata.size in 0..maxSize) { "artifact_size_limit" }
        val digest = MessageDigest.getInstance("SHA-256"); var offset = 0L
        while (offset < metadata.size) {
            currentCoroutineContext().ensureActive()
            val chunk = source.read(offset, minOf(chunkSize.toLong(), metadata.size - offset).toInt())
            require(chunk.isNotEmpty() && offset + chunk.size <= metadata.size) { "artifact_chunk_invalid" }
            output.write(chunk); digest.update(chunk); offset += chunk.size
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        require(actual == metadata.sha256.lowercase()) { "artifact_digest_mismatch" }
    }
}

fun artifactOpenIntent(context: Context, file: File, mimeType: String): Intent = Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(FileProvider.getUriForFile(context, "${context.packageName}.files", file), mimeType)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
}
