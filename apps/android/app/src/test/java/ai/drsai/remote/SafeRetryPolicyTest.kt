package ai.drsai.remote

import ai.drsai.remote.runtime.reliability.*
import ai.drsai.remote.runtime.tools.ToolRisk
import org.junit.Assert.assertEquals
import org.junit.Test

class SafeRetryPolicyTest {
    @Test fun modelAndReadOnlyToolRetryInsideOriginalRun() {
        listOf(
            SafeRetryInput(RetryStage.MODEL, true),
            SafeRetryInput(RetryStage.TOOL, true, ToolRisk.READ_ONLY),
        ).forEach {
            assertEquals(SafeRetryAction.RETRY_STAGE, SafeRetryPolicy.decide(it).action)
            assertEquals(RetryRunMode.SAME_RUN, SafeRetryPolicy.decide(it).runMode)
        }
    }

    @Test fun writeAndSensitiveToolsNeverBlindReplaySideEffect() {
        listOf(ToolRisk.EXTERNAL_WRITE, ToolRisk.SENSITIVE).forEach { risk ->
            val before = SafeRetryPolicy.decide(SafeRetryInput(RetryStage.TOOL, true, risk))
            assertEquals(SafeRetryAction.RESUME_BEFORE_SIDE_EFFECT, before.action)
            val unknown = SafeRetryPolicy.decide(SafeRetryInput(RetryStage.TOOL, true, risk, sideEffectStarted = true))
            assertEquals(SafeRetryAction.REQUIRE_RECONCILIATION, unknown.action)
            assertEquals(RetryRunMode.NONE, unknown.runMode)
        }
    }

    @Test fun durableReceiptIsReplayedWithoutExecutingMutation() {
        val decision = SafeRetryPolicy.decide(SafeRetryInput(
            RetryStage.TOOL, true, ToolRisk.EXTERNAL_WRITE, sideEffectStarted = true, receiptPersisted = true,
        ))
        assertEquals(SafeRetryAction.REPLAY_RECEIPT, decision.action)
        assertEquals(RetryRunMode.SAME_RUN, decision.runMode)
    }

    @Test fun terminalRunRequiresExplicitNewRun() {
        val input = SafeRetryInput(RetryStage.MODEL, true, originalRunRecoverable = false)
        assertEquals(SafeRetryAction.DENY, SafeRetryPolicy.decide(input).action)
        assertEquals(RetryRunMode.NEW_RUN, SafeRetryPolicy.decide(input.copy(userExplicitlyRequestedNewRun = true)).runMode)
    }
}
