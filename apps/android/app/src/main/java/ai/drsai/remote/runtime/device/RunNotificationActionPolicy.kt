package ai.drsai.remote.runtime.device

enum class RunNotificationAction { CONTINUE, CANCEL, OPEN_APPROVAL, OPEN_RESULT }

data class RunNotificationActionScope(
    val action: RunNotificationAction,
    val accountSubject: String,
    val runId: String,
    val sessionId: String,
    val interactionId: String? = null,
) {
    init {
        require(accountSubject.isNotBlank()) { "notification_account_required" }
        require(runId.isNotBlank()) { "notification_run_required" }
        require(sessionId.isNotBlank()) { "notification_session_required" }
        if (action in setOf(RunNotificationAction.OPEN_APPROVAL, RunNotificationAction.OPEN_RESULT)) {
            require(!interactionId.isNullOrBlank()) { "notification_interaction_required" }
        }
    }
}

object RunNotificationActionPolicy {
    fun authorize(scope: RunNotificationActionScope, activeAccountSubject: String, actualRunId: String,
                  actualSessionId: String, actualInteractionId: String? = null): Boolean =
        scope.accountSubject == activeAccountSubject && scope.runId == actualRunId &&
            scope.sessionId == actualSessionId &&
            (scope.interactionId == null || scope.interactionId == actualInteractionId)
}
