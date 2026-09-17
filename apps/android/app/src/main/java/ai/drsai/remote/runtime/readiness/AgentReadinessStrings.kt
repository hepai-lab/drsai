package ai.drsai.remote.runtime.readiness

import ai.drsai.remote.R
import android.content.Context

enum class AgentReadinessText { MODEL, CREDENTIAL, NETWORK, PROVIDER, TOOLS, PREPARING, RUNTIME, SMOKE, WORKSPACE, READY }
data class AgentReadinessCopy(val title: String, val summary: String)
interface AgentReadinessStrings { fun copy(key: AgentReadinessText): AgentReadinessCopy }
class AndroidAgentReadinessStrings(private val context: Context) : AgentReadinessStrings {
    override fun copy(key: AgentReadinessText): AgentReadinessCopy {
        val ids = when (key) {
            AgentReadinessText.MODEL -> R.string.readiness_model_title to R.string.readiness_model_summary
            AgentReadinessText.CREDENTIAL -> R.string.readiness_credential_title to R.string.readiness_credential_summary
            AgentReadinessText.NETWORK -> R.string.readiness_network_title to R.string.readiness_network_summary
            AgentReadinessText.PROVIDER -> R.string.readiness_provider_title to R.string.readiness_provider_summary
            AgentReadinessText.TOOLS -> R.string.readiness_tools_title to R.string.readiness_tools_summary
            AgentReadinessText.PREPARING -> R.string.readiness_preparing_title to R.string.readiness_preparing_summary
            AgentReadinessText.RUNTIME -> R.string.readiness_runtime_title to R.string.readiness_runtime_summary
            AgentReadinessText.SMOKE -> R.string.readiness_smoke_title to R.string.readiness_smoke_summary
            AgentReadinessText.WORKSPACE -> R.string.readiness_workspace_title to R.string.readiness_workspace_summary
            AgentReadinessText.READY -> R.string.readiness_ready_title to R.string.readiness_ready_summary
        }
        return AgentReadinessCopy(context.getString(ids.first), context.getString(ids.second))
    }
}
object EnglishAgentReadinessStrings : AgentReadinessStrings {
    override fun copy(key: AgentReadinessText): AgentReadinessCopy = when (key) {
        AgentReadinessText.MODEL -> AgentReadinessCopy("Choose a model", "First choose a model that supports Agent tools.")
        AgentReadinessText.CREDENTIAL -> AgentReadinessCopy("Add a model credential", "The credential is stored only in Android encrypted storage.")
        AgentReadinessText.NETWORK -> AgentReadinessCopy("Waiting for network", "Continue the current setup or task after reconnecting.")
        AgentReadinessText.PROVIDER -> AgentReadinessCopy("Check the model connection", "Verify the credential, service address, and model availability.")
        AgentReadinessText.TOOLS -> AgentReadinessCopy("Choose a tool-capable model", "The current model cannot yet perform complete Agent tasks.")
        AgentReadinessText.PREPARING -> AgentReadinessCopy("Preparing Agent", "Starting Android Full Agent Runtime.")
        AgentReadinessText.RUNTIME -> AgentReadinessCopy("Agent is temporarily unavailable", "Restart Runtime; the app will not switch to Lite mode.")
        AgentReadinessText.SMOKE -> AgentReadinessCopy("Check Agent functionality", "Complete a no-side-effect tool check before starting a task.")
        AgentReadinessText.WORKSPACE -> AgentReadinessCopy("Choose a workspace", "Authorize only the folder required by this task.")
        AgentReadinessText.READY -> AgentReadinessCopy("Agent is ready", "The model, Runtime, and current task capabilities are ready.")
    }
}
