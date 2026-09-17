package ai.drsai.remote.runtime.readiness

enum class ReadinessKind { READY, CHECKING, CONFIGURATION_REQUIRED, PERMISSION_REQUIRED, TEMPORARILY_UNAVAILABLE }

enum class ReadinessAction { NONE, CHOOSE_MODEL, ADD_CREDENTIAL, TEST_CONNECTION, RUN_RUNTIME_CHECK, RETRY_RUNTIME, ENABLE_NETWORK, GRANT_WORKSPACE }

data class AgentReadinessInput(
    val modelSelected: Boolean,
    val credentialAvailable: Boolean,
    val providerVerified: Boolean,
    val modelSupportsTools: Boolean?,
    val runtimeState: String,
    val networkAvailable: Boolean,
    val workspaceRequired: Boolean = false,
    val workspaceGranted: Boolean = false,
    val functionalSmokeVerified: Boolean = true,
)

data class AgentReadiness(
    val kind: ReadinessKind,
    val title: String,
    val summary: String,
    val primaryAction: ReadinessAction,
    val canStartAgentRun: Boolean,
    val stableReason: String,
)

object AgentReadinessPolicy {
    fun evaluate(input: AgentReadinessInput, strings: AgentReadinessStrings = EnglishAgentReadinessStrings): AgentReadiness = when {
        !input.modelSelected -> blocked(
            ReadinessKind.CONFIGURATION_REQUIRED, AgentReadinessText.MODEL,
            ReadinessAction.CHOOSE_MODEL, "model_not_selected",
            strings,
        )
        !input.credentialAvailable -> blocked(
            ReadinessKind.CONFIGURATION_REQUIRED, AgentReadinessText.CREDENTIAL,
            ReadinessAction.ADD_CREDENTIAL, "credential_missing",
            strings,
        )
        !input.networkAvailable -> blocked(
            ReadinessKind.TEMPORARILY_UNAVAILABLE, AgentReadinessText.NETWORK,
            ReadinessAction.ENABLE_NETWORK, "network_unavailable",
            strings,
        )
        !input.providerVerified -> blocked(
            ReadinessKind.CONFIGURATION_REQUIRED, AgentReadinessText.PROVIDER,
            ReadinessAction.TEST_CONNECTION, "provider_not_verified",
            strings,
        )
        input.modelSupportsTools != true -> blocked(
            ReadinessKind.CONFIGURATION_REQUIRED, AgentReadinessText.TOOLS,
            ReadinessAction.CHOOSE_MODEL, if (input.modelSupportsTools == false) "model_tools_unsupported" else "model_capability_unknown",
            strings,
        )
        input.runtimeState in setOf("UNINITIALIZED", "BINDING", "RECOVERING") -> result(
            ReadinessKind.CHECKING, AgentReadinessText.PREPARING, ReadinessAction.NONE,
            false, "runtime_${input.runtimeState.lowercase()}", strings,
        )
        input.runtimeState != "READY" -> blocked(
            ReadinessKind.TEMPORARILY_UNAVAILABLE, AgentReadinessText.RUNTIME,
            ReadinessAction.RETRY_RUNTIME, "runtime_unavailable",
            strings,
        )
        !input.functionalSmokeVerified -> blocked(
            ReadinessKind.CONFIGURATION_REQUIRED, AgentReadinessText.SMOKE,
            ReadinessAction.RUN_RUNTIME_CHECK, "runtime_smoke_required",
            strings,
        )
        input.workspaceRequired && !input.workspaceGranted -> blocked(
            ReadinessKind.PERMISSION_REQUIRED, AgentReadinessText.WORKSPACE,
            ReadinessAction.GRANT_WORKSPACE, "workspace_permission_required",
            strings,
        )
        else -> result(ReadinessKind.READY, AgentReadinessText.READY, ReadinessAction.NONE, true, "ready", strings)
    }

    private fun blocked(
        kind: ReadinessKind,
        text: AgentReadinessText,
        action: ReadinessAction,
        reason: String,
        strings: AgentReadinessStrings,
    ) = result(kind, text, action, false, reason, strings)

    private fun result(kind: ReadinessKind, text: AgentReadinessText, action: ReadinessAction, canStart: Boolean, reason: String, strings: AgentReadinessStrings): AgentReadiness =
        strings.copy(text).let { AgentReadiness(kind, it.title, it.summary, action, canStart, reason) }
}
