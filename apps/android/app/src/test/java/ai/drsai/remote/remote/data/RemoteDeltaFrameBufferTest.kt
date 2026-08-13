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

    @Test fun `delta arriving during projection render schedules a following frame`() {
        val mailbox = LatestFrameMailbox<String>()
        assertTrue(mailbox.offer("first"))
        assertEquals("first", mailbox.take())

        // The worker is still rendering the first Room projection. A newer
        // delta must keep that worker alive instead of being cleared by it.
        assertTrue(!mailbox.offer("during-render"))
        assertTrue(!mailbox.finishCycle())
        assertEquals("during-render", mailbox.take())
        assertTrue(mailbox.finishCycle())

        // Once the worker has atomically transitioned to idle, the next event
        // owns a new worker.
        assertTrue(mailbox.offer("after-idle"))
        assertEquals("after-idle", mailbox.take())
        assertTrue(mailbox.finishCycle())
    }

    @Test fun `cancel drops pending render and permits a clean restart`() {
        val mailbox = LatestFrameMailbox<String>()
        assertTrue(mailbox.offer("stale"))
        mailbox.cancel()
        assertTrue(!mailbox.hasPending())
        assertTrue(mailbox.offer("fresh"))
        assertEquals("fresh", mailbox.take())
        assertTrue(mailbox.finishCycle())
    }
}
