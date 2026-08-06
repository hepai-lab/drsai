package ai.drsai.remote

import ai.drsai.remote.data.SingleFlightGate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SingleFlightGateTest {
    @Test
    fun concurrentSaveAttemptsAdmitExactlyOneTransactionUntilCompletion() {
        val gate = SingleFlightGate()
        val admitted = AtomicInteger()
        val ready = CountDownLatch(16)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(16)

        repeat(16) {
            pool.execute {
                ready.countDown()
                start.await()
                if (gate.tryEnter()) admitted.incrementAndGet()
            }
        }
        assertTrue(ready.await(2, TimeUnit.SECONDS))
        start.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(2, TimeUnit.SECONDS))

        assertEquals(1, admitted.get())
        assertTrue(gate.isEntered())
        gate.leave()
        assertFalse(gate.isEntered())
        assertTrue(gate.tryEnter())
    }
}
