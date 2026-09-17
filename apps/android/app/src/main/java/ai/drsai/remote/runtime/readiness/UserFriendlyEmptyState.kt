package ai.drsai.remote.runtime.readiness

enum class EmptyStateKind { NO_SESSIONS, NO_RESULTS, OFFLINE, NO_MODEL, CAPABILITY_CHANGED }

data class EmptyStateAction(val id: String)
data class EmptyStatePresentation(
    val kind: EmptyStateKind,
    val primaryAction: EmptyStateAction,
    val exampleIds: List<String> = emptyList(),
)

/** Semantic projection only. Compose owns all localized copy for these stable kinds and IDs. */
object UserFriendlyEmptyStatePolicy {
    fun present(kind: EmptyStateKind, availableCapabilities: Set<String> = emptySet()): EmptyStatePresentation {
        val exampleIds = buildList {
            if ("chat" in availableCapabilities) add("chat")
            if ("web_search" in availableCapabilities) add("web")
            if ("workspace_read" in availableCapabilities) add("workspace")
        }.take(3)
        val action = when (kind) {
            EmptyStateKind.NO_SESSIONS -> "new_session"
            EmptyStateKind.NO_RESULTS -> "new_task"
            EmptyStateKind.OFFLINE -> "network_settings"
            EmptyStateKind.NO_MODEL -> "configure_model"
            EmptyStateKind.CAPABILITY_CHANGED -> "review_capabilities"
        }
        return EmptyStatePresentation(kind, EmptyStateAction(action), if (kind in setOf(EmptyStateKind.NO_SESSIONS, EmptyStateKind.NO_RESULTS, EmptyStateKind.CAPABILITY_CHANGED)) exampleIds else emptyList())
    }
}
