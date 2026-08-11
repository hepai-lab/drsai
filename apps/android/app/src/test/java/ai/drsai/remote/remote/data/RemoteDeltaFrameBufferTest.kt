package ai.drsai.remote.remote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteDeltaFrameBufferTest {
    @Test fun `ten thousand deltas coalesce without loss`() {
        val buffer = RemoteDeltaFrameBuffer(maxPendingChars = 1_000_000)
        repeat(10_000) { assertTrue(buffer.offer("run-1", "x").isEmpty()) }
        val chunks = buffer.drain()
        assertEquals(1, chunks.size)
        assertEquals(10_000, chunks.single().text.length)
        assertEquals(0, buffer.sizeChars())
    }

    @Test fun `capacity forces bounded lossless drain`() {
        val buffer = RemoteDeltaFrameBuffer(maxPendingChars = 8)
        assertTrue(buffer.offer("run-1", "1234").isEmpty())
        val forced = buffer.offer("run-1", "5678")
        assertEquals("12345678", forced.single().text)
        assertEquals(0, buffer.sizeChars())
    }

    @Test fun `barrier drains all streams in insertion order`() {
        val buffer = RemoteDeltaFrameBuffer()
        buffer.offer("run-a", "a")
        buffer.offer("run-b", "b")
        assertEquals(listOf("run-a", "run-b"), buffer.drain().map { it.streamId })
    }
}
