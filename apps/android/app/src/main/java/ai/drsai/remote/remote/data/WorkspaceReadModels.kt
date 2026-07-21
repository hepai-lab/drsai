package ai.drsai.remote.remote.data

import java.security.MessageDigest

data class RemoteFileNode(val token: String, val relativePath: String, val type: String, val size: Long?,
                          val modifiedAt: String?, val gitStatus: String?, val truncated: Boolean = false) {
    init { require(token.isNotBlank() && !relativePath.startsWith('/') && !relativePath.contains("..")) { "file_node_invalid" } }
}
data class GitChangeUi(val relativePath: String, val status: String)
data class GitStatusUi(val branch: String?, val revision: String, val changes: List<GitChangeUi>)
data class BoundedDiff(val text: String?, val binary: Boolean, val truncated: Boolean, val staleRevision: Boolean)

class ChunkDigestVerifier(private val maxCachedBytes: Int = 2 * 1024 * 1024) {
    private var cached = 0
    fun verify(chunk: ByteArray, expectedSha256: String): Boolean {
        require(chunk.size <= 1_048_576 && cached + chunk.size <= maxCachedBytes) { "chunk_cache_limit_exceeded" }
        val digest = MessageDigest.getInstance("SHA-256").digest(chunk).joinToString("") { "%02x".format(it) }
        if (digest != expectedSha256.lowercase()) return false
        cached += chunk.size
        return true
    }
    fun clear() { cached = 0 }
    val cachedBytes: Int get() = cached
}
