package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.runtime.tools.ToolRisk

enum class RetryStage { MODEL, TOOL }
enum class SafeRetryAction { RETRY_STAGE, RESUME_BEFORE_SIDE_EFFECT, REPLAY_RECEIPT, REQUIRE_RECONCILIATION, DENY }
enum class RetryRunMode { SAME_RUN, NEW_RUN, NONE }

data class SafeRetryInput(
    val stage: RetryStage,
    val retryableFailure: Boolean,
    val toolRisk: ToolRisk? = null,
    val sideEffectStarted: Boolean = false,
    val receiptPersisted: Boolean = false,
    val originalRunRecoverable: Boolean = true,
    val userExplicitlyRequestedNewRun: Boolean = false,
)

data class SafeRetryDecision(val action: SafeRetryAction, val runMode: RetryRunMode, val reason: String)

object SafeRetryPolicy {
    fun decide(input: SafeRetryInput): SafeRetryDecision = when {
        !input.retryableFailure -> denied("failure_not_retryable")
        input.receiptPersisted -> SafeRetryDecision(SafeRetryAction.REPLAY_RECEIPT, RetryRunMode.SAME_RUN, "durable_receipt_available")
        input.sideEffectStarted -> SafeRetryDecision(SafeRetryAction.REQUIRE_RECONCILIATION, RetryRunMode.NONE, "side_effect_result_unknown")
        input.stage == RetryStage.TOOL && input.toolRisk in setOf(ToolRisk.EXTERNAL_WRITE, ToolRisk.SENSITIVE) ->
            SafeRetryDecision(SafeRetryAction.RESUME_BEFORE_SIDE_EFFECT, RetryRunMode.SAME_RUN, "side_effect_not_started")
        input.originalRunRecoverable -> SafeRetryDecision(SafeRetryAction.RETRY_STAGE, RetryRunMode.SAME_RUN, "resume_original_run")
        input.userExplicitlyRequestedNewRun -> SafeRetryDecision(SafeRetryAction.RETRY_STAGE, RetryRunMode.NEW_RUN, "explicit_new_run")
        else -> denied("new_run_requires_explicit_user_action")
    }

    private fun denied(reason: String) = SafeRetryDecision(SafeRetryAction.DENY, RetryRunMode.NONE, reason)
}
