package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteSingleFlight
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteSingleFlightTest {
    @Test fun `one hundred concurrent reads execute one authoritative operation`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger(0)
        val singleFlight = RemoteSingleFlight(this)
        val reads = (1..100).map {
            async {
                singleFlight.run("runtime-a/workspace-a") {
                    calls.incrementAndGet()
                    gate.await()
                    "authoritative"
                }
            }
        }
        while (calls.get() == 0) testScheduler.runCurrent()
        gate.complete(Unit)
        assertEquals(List(100) { "authoritative" }, reads.awaitAll())
        assertEquals(1, calls.get())
        assertEquals(0, singleFlight.activeCount())
    }

    @Test fun `different resource keys do not block each other`() = runTest {
        val calls = AtomicInteger(0)
        val singleFlight = RemoteSingleFlight(this)
        val values = listOf("a", "b").map { key ->
            async { singleFlight.run(key) { calls.incrementAndGet(); key } }
        }.awaitAll()
        assertEquals(listOf("a", "b"), values)
        assertEquals(2, calls.get())
    }
}
