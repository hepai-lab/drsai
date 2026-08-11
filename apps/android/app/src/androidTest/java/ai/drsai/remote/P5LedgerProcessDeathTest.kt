package ai.drsai.remote

import ai.drsai.remote.remote.data.PendingRemoteApprovalDecision
import ai.drsai.remote.remote.data.PendingRemoteRunControl
import ai.drsai.remote.remote.data.RemoteApprovalDecisionLedger
import ai.drsai.remote.remote.data.RemoteRunControlLedger
import ai.drsai.remote.remote.data.RemoteRunControlOperation
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P5LedgerProcessDeathTest {
    @Test
    fun executeRequestedPhase() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val phase = requireNotNull(arguments.getString("ledgerPhase"))
        val nonce = requireNotNull(arguments.getString("ledgerNonce"))
        require(nonce.matches(Regex("^[a-f0-9]{32}$"))) { "p5_ledger_nonce_invalid" }
        val context = instrumentation.targetContext
        val subject = "p5-ledger-process-$nonce"
        val runLedger = RemoteRunControlLedger(context)
        val approvalLedger = RemoteApprovalDecisionLedger(context)
        val run = PendingRemoteRunControl(
            subject, "", "runtime", "workspace", "run-session", "run",
            RemoteRunControlOperation.RETRY, "retry:run", 123L,
        )
        val approval = PendingRemoteApprovalDecision(
            subject, "", "runtime", "workspace", "approval-session", "approval-run",
            "approval", "approve", "approval:approval:approve", 123L,
        )

        when (phase) {
            "write" -> {
                runLedger.clearSubject(subject)
                approvalLedger.clearSubject(subject)
                assertEquals(run, runLedger.begin(run))
                assertEquals(approval, approvalLedger.begin(approval))
            }
            "recover" -> {
                assertEquals(run, runLedger.pending(
                    subject, "", "runtime", "workspace", "run-session",
                ))
                assertEquals(approval, approvalLedger.pending(
                    subject, "", "runtime", "workspace", "approval-session",
                ))
                runLedger.clear(run)
                approvalLedger.clear(approval)
            }
            "verify-cleared" -> {
                assertNull(runLedger.pending(
                    subject, "", "runtime", "workspace", "run-session",
                ))
                assertNull(approvalLedger.pending(
                    subject, "", "runtime", "workspace", "approval-session",
                ))
            }
            else -> error("p5_ledger_phase_invalid")
        }
    }
}
