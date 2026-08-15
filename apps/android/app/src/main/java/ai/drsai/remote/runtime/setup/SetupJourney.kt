package ai.drsai.remote.runtime.setup

import ai.drsai.remote.runtime.readiness.AgentReadiness
import ai.drsai.remote.runtime.readiness.ReadinessKind
import android.content.Context

enum class SetupStep { WELCOME, MODEL_PROVIDER, CONNECTION_CHECK, RUNTIME_CHECK, FIRST_TASK, COMPLETE }
enum class SetupStatus { ACTIVE, SKIPPED, COMPLETE }

data class SetupJourney(
    val step: SetupStep = SetupStep.WELCOME,
    val status: SetupStatus = SetupStatus.ACTIVE,
    val updatedAt: Long = 0,
    val stableReason: String? = null,
) {
    val visible: Boolean get() = status == SetupStatus.ACTIVE && step != SetupStep.COMPLETE
}

interface SetupJourneyStore {
    fun load(accountSubject: String): SetupJourney?
    fun save(accountSubject: String, journey: SetupJourney)
    fun clear(accountSubject: String)
}

class SharedPreferencesSetupJourneyStore(context: Context) : SetupJourneyStore {
    private val preferences = context.applicationContext.getSharedPreferences("p10_setup_journey_v1", Context.MODE_PRIVATE)

    override fun load(accountSubject: String): SetupJourney? {
        val prefix = "${accountSubject.hashCode()}:"
        val step = preferences.getString(prefix + "step", null)?.let { runCatching { SetupStep.valueOf(it) }.getOrNull() } ?: return null
        val status = preferences.getString(prefix + "status", null)?.let { runCatching { SetupStatus.valueOf(it) }.getOrNull() }
            ?: SetupStatus.ACTIVE
        return SetupJourney(step, status, preferences.getLong(prefix + "updated_at", 0), preferences.getString(prefix + "reason", null))
    }

    override fun save(accountSubject: String, journey: SetupJourney) {
        val prefix = "${accountSubject.hashCode()}:"
        check(preferences.edit()
            .putString(prefix + "step", journey.step.name)
            .putString(prefix + "status", journey.status.name)
            .putLong(prefix + "updated_at", journey.updatedAt)
            .putString(prefix + "reason", journey.stableReason)
            .commit()) { "setup_journey_write_failed" }
    }

    override fun clear(accountSubject: String) {
        val prefix = "${accountSubject.hashCode()}:"
        check(preferences.edit().remove(prefix + "step").remove(prefix + "status")
            .remove(prefix + "updated_at").remove(prefix + "reason").commit()) { "setup_journey_clear_failed" }
    }
}

object SetupJourneyReducer {
    fun initial(saved: SetupJourney?, readiness: AgentReadiness, now: Long, hasExistingActivity: Boolean = false): SetupJourney {
        if (saved?.status == SetupStatus.COMPLETE) return saved
        if (saved?.status == SetupStatus.SKIPPED) return saved
        if (saved == null && hasExistingActivity && readiness.kind == ReadinessKind.READY) {
            return SetupJourney(SetupStep.COMPLETE, SetupStatus.COMPLETE, now)
        }
        val step = when (readiness.kind) {
            ReadinessKind.READY -> SetupStep.FIRST_TASK
            ReadinessKind.CHECKING -> SetupStep.RUNTIME_CHECK
            ReadinessKind.CONFIGURATION_REQUIRED -> if (
                readiness.stableReason in setOf("model_not_selected", "credential_missing", "model_tools_unsupported", "model_capability_unknown")
            ) SetupStep.MODEL_PROVIDER else SetupStep.CONNECTION_CHECK
            ReadinessKind.PERMISSION_REQUIRED -> SetupStep.FIRST_TASK
            ReadinessKind.TEMPORARILY_UNAVAILABLE -> if (readiness.stableReason.startsWith("runtime_")) SetupStep.RUNTIME_CHECK else SetupStep.CONNECTION_CHECK
        }
        return SetupJourney(step, SetupStatus.ACTIVE, now, readiness.stableReason)
    }

    fun readinessChanged(current: SetupJourney, readiness: AgentReadiness, now: Long): SetupJourney {
        if (current.status != SetupStatus.ACTIVE) return current
        if (current.step == SetupStep.FIRST_TASK && readiness.kind == ReadinessKind.READY) return current
        return initial(null, readiness, now)
    }

    fun firstTaskCompleted(current: SetupJourney, now: Long): SetupJourney =
        current.copy(step = SetupStep.COMPLETE, status = SetupStatus.COMPLETE, updatedAt = now, stableReason = null)

    fun skip(current: SetupJourney, now: Long): SetupJourney =
        current.copy(status = SetupStatus.SKIPPED, updatedAt = now)

    fun resume(current: SetupJourney, readiness: AgentReadiness, now: Long): SetupJourney =
        initial(null, readiness, now).copy(status = SetupStatus.ACTIVE)
}
