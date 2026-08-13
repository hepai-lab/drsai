package ai.drsai.remote

import ai.drsai.remote.remote.data.PendingRemoteRunControl
import ai.drsai.remote.remote.data.RemoteRunControlLedger
import ai.drsai.remote.remote.data.RemoteRunControlOperation
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteRunControlLedgerTest {
    @Test
    fun pendingCancelAndRetrySurviveRecreationWithoutContentAndStayScoped() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "ledger-${UUID.randomUUID()}"
        val first = RemoteRunControlLedger(context)
        first.clearSubject(subject)
        val cancel = record(subject, "runtime-a", "workspace-a", "session-a", "run-a",
            RemoteRunControlOperation.CANCEL)
        val retry = record(subject, "runtime-a", "workspace-a", "session-b", "run-b",
            RemoteRunControlOperation.RETRY)
        try {
            first.begin(cancel)
            first.begin(retry)
            val recreated = RemoteRunControlLedger(context)
            assertEquals(cancel, recreated.pending(
                subject, "", "runtime-a", "workspace-a", "session-a",
            ))
            assertEquals(retry, recreated.pending(
                subject, "", "runtime-a", "workspace-a", "session-b",
            ))
            assertNull(recreated.pending(
                subject, "", "runtime-a", "workspace-other", "session-a",
            ))
            recreated.clear(cancel)
            assertNull(recreated.pending(
                subject, "", "runtime-a", "workspace-a", "session-a",
            ))
            recreated.clearRuntime(subject, "runtime-a")
            assertNull(recreated.pending(
                subject, "", "runtime-a", "workspace-a", "session-b",
            ))
        } finally {
            first.clearSubject(subject)
        }
    }

    @Test
    fun idempotencyKeyCannotDriftFromOperationAndRun() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "ledger-${UUID.randomUUID()}"
        val ledger = RemoteRunControlLedger(context)
        try {
            val invalid = record(
                subject, "runtime", "workspace", "session", "run",
                RemoteRunControlOperation.RETRY,
            ).copy(idempotencyKey = "retry:different-run")
            try {
                ledger.begin(invalid)
                fail("invalid idempotency key must be rejected")
            } catch (_: IllegalArgumentException) {
                // Expected: a different key could create a duplicate replacement Run.
            }
        } finally {
            ledger.clearSubject(subject)
        }
    }

    @Test
    fun concurrentConflictingControlsCannotOverwriteTheWinningOperation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "ledger-${UUID.randomUUID()}"
        val ledgers = List(16) { RemoteRunControlLedger(context) }
        ledgers.first().clearSubject(subject)
        val cancel = record(
            subject, "runtime", "workspace", "session", "run-a",
            RemoteRunControlOperation.CANCEL,
        )
        val retry = record(
            subject, "runtime", "workspace", "session", "run-b",
            RemoteRunControlOperation.RETRY,
        )
        val start = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<Boolean>())
        val executor = Executors.newFixedThreadPool(16)
        try {
            repeat(64) { index ->
                executor.execute {
                    start.await()
                    outcomes += runCatching {
                        ledgers[index % ledgers.size].begin(if (index % 2 == 0) cancel else retry)
                    }.isSuccess
                }
            }
            start.countDown()
            executor.shutdown()
            check(executor.awaitTermination(30, TimeUnit.SECONDS))

            val stored = requireNotNull(ledgers.last().pending(
                subject, "", "runtime", "workspace", "session",
            )) { "one operation must remain recoverable" }
            assertEquals(32, outcomes.count { it })
            assertEquals(32, outcomes.count { !it })
            assertEquals(
                if (stored.operation == RemoteRunControlOperation.CANCEL) cancel.runId else retry.runId,
                stored.runId,
            )
        } finally {
            executor.shutdownNow()
            ledgers.first().clearSubject(subject)
        }
    }

    @Test
    fun delayedClearFromPriorOperationCannotDeleteItsSuccessor() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "ledger-${UUID.randomUUID()}"
        val ledger = RemoteRunControlLedger(context)
        val first = record(
            subject, "runtime", "workspace", "session", "run-a",
            RemoteRunControlOperation.CANCEL,
        )
        val successor = record(
            subject, "runtime", "workspace", "session", "run-b",
            RemoteRunControlOperation.RETRY,
        )
        try {
            ledger.begin(first)
            ledger.clear(first)
            ledger.begin(successor)
            ledger.clear(first)
            assertEquals(successor, ledger.pending(
                subject, "", "runtime", "workspace", "session",
            ))
        } finally {
            ledger.clearSubject(subject)
        }
    }

    private fun record(
        subject: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
        runId: String,
        operation: RemoteRunControlOperation,
    ) = PendingRemoteRunControl(
        subject, "", runtimeId, workspaceId, sessionId, runId, operation,
        "${operation.name.lowercase()}:$runId", 123L,
    )
}
