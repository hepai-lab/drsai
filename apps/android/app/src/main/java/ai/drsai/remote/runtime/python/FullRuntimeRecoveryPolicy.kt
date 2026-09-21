package ai.drsai.remote.runtime.python

enum class FullRuntimeRecoveryAction { PAUSE_AND_RESUME, RECONCILE_SIDE_EFFECT, FAIL }

/** Fail-closed recovery decision for loss of the isolated :runtime process. */
object FullRuntimeRecoveryPolicy {
    private val interruptionTokens = listOf(
        "binder_died", "binder_dead", "dead_object", "deadobject", "service_disconnected",
        "runtime_process_lost", "runtime_disconnected", "connection_lost",
    )

    fun decide(failure: String, sideEffectObserved: Boolean): FullRuntimeRecoveryAction {
        val interrupted = interruptionTokens.any { failure.lowercase().contains(it) }
        return when {
            !interrupted -> FullRuntimeRecoveryAction.FAIL
            sideEffectObserved -> FullRuntimeRecoveryAction.RECONCILE_SIDE_EFFECT
            else -> FullRuntimeRecoveryAction.PAUSE_AND_RESUME
        }
    }
}
