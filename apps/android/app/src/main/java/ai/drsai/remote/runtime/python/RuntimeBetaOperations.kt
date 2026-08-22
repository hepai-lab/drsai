package ai.drsai.remote.runtime.python

enum class BetaStage(val percent: Int, val minimumObservationHours: Int, val minimumSamples: Int) {
    INTERNAL(0, 48, 20),
    CANARY(0, 72, 50),
    BETA_1(1, 72, 100),
    BETA_5(5, 120, 500),
    BETA_20(20, 168, 2_000),
    BETA_50(50, 168, 5_000),
    BETA_100(100, 336, 10_000),
}

data class BetaRuntimeMetrics(
    val samples: Int,
    val observationHours: Double,
    val crashes: Int,
    val anrs: Int,
    val recoveryAttempts: Int,
    val recoveryFailures: Int,
    val duplicateSideEffects: Int,
    val dataCorruptions: Int,
    val securityIncidents: Int,
    val resourceFailures: Int,
    val loginFailures: Int,
)

enum class BetaRolloutAction { HOLD, EXPAND, PAUSE, KILL_SWITCH }
data class BetaRolloutDecision(val action: BetaRolloutAction, val reason: String, val policyVersion: String)

object RuntimeBetaOperationsPolicy {
    fun decide(stage: BetaStage, metrics: BetaRuntimeMetrics, policyVersion: String): BetaRolloutDecision {
        require(policyVersion.isNotBlank()) { "beta_policy_version_required" }
        val hardFailure = when {
            metrics.duplicateSideEffects > 0 -> "duplicate_side_effect"
            metrics.dataCorruptions > 0 -> "data_corruption"
            metrics.securityIncidents > 0 -> "security_incident"
            else -> null
        }
        if (hardFailure != null) return BetaRolloutDecision(BetaRolloutAction.KILL_SWITCH, hardFailure, policyVersion)
        val recoveryRate = if (metrics.recoveryAttempts == 0) 0.0 else metrics.recoveryFailures.toDouble() / metrics.recoveryAttempts
        val sampleRate = { failures: Int -> if (metrics.samples == 0) 0.0 else failures.toDouble() / metrics.samples }
        val automaticPause = when {
            sampleRate(metrics.crashes) > 0.005 -> "crash_rate"
            sampleRate(metrics.anrs) > 0.003 -> "anr_rate"
            recoveryRate > 0.01 -> "recovery_failure_rate"
            sampleRate(metrics.resourceFailures) > 0.01 -> "resource_failure_rate"
            sampleRate(metrics.loginFailures) > 0.01 -> "login_failure_rate"
            else -> null
        }
        if (automaticPause != null) return BetaRolloutDecision(BetaRolloutAction.PAUSE, automaticPause, policyVersion)
        if (metrics.samples < stage.minimumSamples) return BetaRolloutDecision(BetaRolloutAction.HOLD, "minimum_samples", policyVersion)
        if (metrics.observationHours < stage.minimumObservationHours) return BetaRolloutDecision(BetaRolloutAction.HOLD, "observation_window", policyVersion)
        return BetaRolloutDecision(BetaRolloutAction.EXPAND, "stage_gates_passed", policyVersion)
    }
}

data class BetaIncident(
    val diagnosticId: String,
    val severity: String,
    val owner: String,
    val targetFixVersion: String,
    val state: String,
    val source: String = "user_feedback",
) {
    init {
        require(diagnosticId.isNotBlank() && owner.isNotBlank()) { "beta_incident_owner_required" }
        require(severity in setOf("blocker", "critical", "major", "minor")) { "beta_incident_severity_invalid" }
        require(state in setOf("open", "investigating", "fixed", "verified", "closed")) { "beta_incident_state_invalid" }
        require(targetFixVersion.isNotBlank()) { "beta_incident_fix_version_required" }
        require(source in setOf("user_feedback", "exercise")) { "beta_incident_source_invalid" }
    }
}
