package ai.drsai.remote.runtime.reliability

enum class BackgroundExecutionAction { CONTINUE_FOREGROUND, PAUSE_SAME_RUN, SCHEDULE_CONSTRAINED_RECOVERY }

data class BackgroundExecutionConditions(
    val appForeground: Boolean,
    val foregroundServiceActive: Boolean,
    val doze: Boolean,
    val batterySaver: Boolean,
    val backgroundRestricted: Boolean,
    val foregroundServiceTimedOut: Boolean,
)

data class BackgroundExecutionDecision(
    val action: BackgroundExecutionAction,
    val reason: String,
    val preserveRun: Boolean = true,
    val periodicWakeupMillis: Long? = null,
)

object BackgroundExecutionPolicy {
    fun decide(value: BackgroundExecutionConditions): BackgroundExecutionDecision = when {
        value.foregroundServiceTimedOut -> pause("foreground_service_timeout")
        value.backgroundRestricted -> pause("background_execution_restricted")
        value.doze -> BackgroundExecutionDecision(
            BackgroundExecutionAction.SCHEDULE_CONSTRAINED_RECOVERY, "device_doze", periodicWakeupMillis = null,
        )
        value.batterySaver && !value.appForeground -> pause("battery_saver_background")
        !value.appForeground && !value.foregroundServiceActive -> pause("foreground_service_required")
        else -> BackgroundExecutionDecision(BackgroundExecutionAction.CONTINUE_FOREGROUND, "execution_allowed")
    }

    private fun pause(reason: String) = BackgroundExecutionDecision(
        BackgroundExecutionAction.PAUSE_SAME_RUN, reason, preserveRun = true, periodicWakeupMillis = null,
    )
}
