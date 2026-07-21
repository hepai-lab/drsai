package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

class ArtifactDownloaderTest {
    @Test fun `artifact streams bounded chunks verifies digest and scope`() = runTest {
        val content = ByteArray(700_000) { (it % 251).toByte() }
        val digest = MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it) }
        val metadata = ArtifactMetadata("a", "x.bin", "application/octet-stream", content.size.toLong(), digest, "rt", "ws", "alice")
        val output = ByteArrayOutputStream(); val lengths = mutableListOf<Int>()
        ArtifactDownloader(chunkSize = 128 * 1024).download(metadata, "alice", "rt", "ws", output) { offset, length ->
            lengths += length; content.copyOfRange(offset.toInt(), offset.toInt() + length)
        }
        assertArrayEquals(content, output.toByteArray()); assertTrue(lengths.all { it <= 128 * 1024 }); assertTrue(lengths.size > 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cross workspace artifact is rejected before reading`() = runTest {
        ArtifactDownloader().download(ArtifactMetadata("a", "x", "x", 0, "", "rt", "other", "alice"),
            "alice", "rt", "ws", ByteArrayOutputStream()) { _, _ -> error("must not read") }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `bad digest fails closed`() = runTest {
        ArtifactDownloader().download(ArtifactMetadata("a", "x", "x", 1, "0".repeat(64), "rt", "ws", "alice"),
            "alice", "rt", "ws", ByteArrayOutputStream()) { _, _ -> byteArrayOf(1) }
    }
}
