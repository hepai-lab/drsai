package ai.drsai.remote

import ai.drsai.remote.remote.data.PendingRemoteApprovalDecision
import ai.drsai.remote.remote.data.RemoteApprovalDecisionLedger
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteApprovalDecisionLedgerTest {
    @Test
    fun decisionSurvivesRecreationAndIsScopedWithoutContent() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "approval-ledger-${UUID.randomUUID()}"
        val first = RemoteApprovalDecisionLedger(context)
        first.clearSubject(subject)
        val pending = record(subject, "approve")
        try {
            first.begin(pending)
            val recreated = RemoteApprovalDecisionLedger(context)
            assertEquals(pending, recreated.pending(
                subject, "", "runtime", "workspace", "session",
            ))
            assertNull(recreated.pending(
                subject, "", "runtime", "other-workspace", "session",
            ))
        } finally {
            first.clearSubject(subject)
        }
    }

    @Test
    fun concurrentOppositeDecisionsCannotReplaceUnknownOutcome() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "approval-ledger-${UUID.randomUUID()}"
        val ledgers = List(16) { RemoteApprovalDecisionLedger(context) }
        ledgers.first().clearSubject(subject)
        val approve = record(subject, "approve")
        val deny = record(subject, "deny")
        val start = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<Boolean>())
        val executor = Executors.newFixedThreadPool(16)
        try {
            repeat(64) { index ->
                executor.execute {
                    start.await()
                    outcomes += runCatching {
                        ledgers[index % ledgers.size].begin(if (index % 2 == 0) approve else deny)
                    }.isSuccess
                }
            }
            start.countDown()
            executor.shutdown()
            check(executor.awaitTermination(30, TimeUnit.SECONDS))
            val stored = requireNotNull(ledgers.last().pending(
                subject, "", "runtime", "workspace", "session",
            ))
            assertEquals(32, outcomes.count { it })
            assertEquals(32, outcomes.count { !it })
            assertEquals(stored.decision, stored.idempotencyKey.substringAfterLast(':'))
        } finally {
            executor.shutdownNow()
            ledgers.first().clearSubject(subject)
        }
    }

    @Test
    fun delayedClearCannotDeleteSuccessorDecision() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val subject = "approval-ledger-${UUID.randomUUID()}"
        val ledger = RemoteApprovalDecisionLedger(context)
        val first = record(subject, "approve", approvalId = "approval-one")
        val successor = record(subject, "deny", approvalId = "approval-two")
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
        decision: String,
        approvalId: String = "approval",
    ) = PendingRemoteApprovalDecision(
        subject, "", "runtime", "workspace", "session", "run",
        approvalId, decision, "approval:$approvalId:$decision", 123L,
    )
}
