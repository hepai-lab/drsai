package ai.drsai.remote.runtime.readiness

enum class LocalRunAdmission { ADMIT, DEFER_WITHOUT_RUN }

fun AgentReadiness.localRunAdmission(): LocalRunAdmission =
    if (canStartAgentRun) LocalRunAdmission.ADMIT else LocalRunAdmission.DEFER_WITHOUT_RUN
