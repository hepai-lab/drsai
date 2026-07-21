package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class WorkspaceReadModelsTest {
    @Test fun `file node is relative and uses opaque token`() {
        val node = RemoteFileNode("opaque-1", "src/Main.kt", "file", 12, "now", "modified")
        assertEquals("src/Main.kt", node.relativePath)
        assertFalse(node.token.contains(node.relativePath))
    }

    @Test(expected = IllegalArgumentException::class) fun `parent path is rejected`() {
        RemoteFileNode("x", "../secret", "file", 1, null, null)
    }

    @Test fun `chunk digest and cache are bounded`() {
        val bytes = "hello".encodeToByteArray()
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val verifier = ChunkDigestVerifier(10)
        assertTrue(verifier.verify(bytes, digest)); assertEquals(5, verifier.cachedBytes)
        assertFalse(verifier.verify("world".encodeToByteArray(), "0".repeat(64)))
        assertEquals(5, verifier.cachedBytes)
    }

    @Test fun `git models expose only structured read state`() {
        val status = GitStatusUi("main", "abc", listOf(GitChangeUi("a.txt", "modified")))
        val diff = BoundedDiff("@@", binary = false, truncated = true, staleRevision = false)
        assertEquals("main", status.branch); assertTrue(diff.truncated)
        assertFalse(status.toString().contains("commitControl"))
    }
}
