package ai.drsai.remote.remote.security

import java.io.ByteArrayInputStream
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingBytePatternScannerTest {
    @Test
    fun `detects a pattern split across every read boundary`() {
        val scanner = StreamingBytePatternScanner(listOf("secret-value".encodeToByteArray()))
        assertTrue(scanner.contains(
            ByteArrayInputStream("prefix-secret-value-suffix".encodeToByteArray()),
            bufferSize = 1,
        ))
    }

    @Test
    fun `detects overlapping prefixes and binary patterns`() {
        val scanner = StreamingBytePatternScanner(
            listOf("ababaca".encodeToByteArray(), byteArrayOf(0, 1, 0, 2)),
        )
        assertTrue(scanner.contains(ByteArrayInputStream("xxabababacayy".encodeToByteArray()), 3))
        assertTrue(scanner.contains(ByteArrayInputStream(byteArrayOf(9, 0, 1, 0, 2, 8)), 2))
    }

    @Test
    fun `clean large stream remains clean`() {
        val scanner = StreamingBytePatternScanner(listOf("not-present".encodeToByteArray()))
        val bytes = ByteArray(4 * 1024 * 1024) { (it % 251).toByte() }
        val result = scanner.scan(ByteArrayInputStream(bytes), bufferSize = 257)
        assertFalse(result.matched)
        org.junit.Assert.assertEquals(bytes.size.toLong(), result.bytesScanned)
    }

    @Test
    fun `invalid configuration fails closed`() {
        assertThrows(IllegalArgumentException::class.java) { StreamingBytePatternScanner(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) {
            StreamingBytePatternScanner(listOf(byteArrayOf()))
        }
        val scanner = StreamingBytePatternScanner(listOf(byteArrayOf(1)))
        assertThrows(IllegalArgumentException::class.java) {
            scanner.contains(ByteArrayInputStream(byteArrayOf(1)), bufferSize = 0)
        }
    }
}
