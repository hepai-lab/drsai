package ai.drsai.remote.workbench.model

data class SessionModelSwitchDecision(
    val activeRunModelId: String?,
    val nextRunModelId: String,
    val historyReplayUnchanged: Boolean,
    val userMessage: String,
)

object SessionModelSwitchPolicy {
    fun switch(activeRunModelId: String?, selectedModelId: String, userMessage: String = "The model will apply to the next message; history remains unchanged"): SessionModelSwitchDecision {
        require(selectedModelId.isNotBlank()) { "session_model_required" }
        return SessionModelSwitchDecision(
            activeRunModelId = activeRunModelId,
            nextRunModelId = selectedModelId,
            historyReplayUnchanged = true,
            userMessage = userMessage,
        )
    }
}
