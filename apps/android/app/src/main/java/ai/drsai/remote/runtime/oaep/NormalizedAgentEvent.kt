package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.remote.generated.OaepError
import ai.drsai.remote.remote.generated.OaepItemContent

/**
 * Backend-neutral semantic boundary consumed by the Android OAEP writer.
 *
 * Runtime IPC envelopes and backend-private event names must be decoded into
 * this union before they may affect persistence, replay, relay or UI state.
 */
sealed interface NormalizedAgentEvent {
    data object RunStarted : NormalizedAgentEvent
    data class RunWaiting(val reason: String, val interactionItemId: String?) : NormalizedAgentEvent
    data object RunResumed : NormalizedAgentEvent
    data object RunCompleted : NormalizedAgentEvent
    data class RunFailed(val error: OaepError) : NormalizedAgentEvent
    data object RunCancelled : NormalizedAgentEvent

    data class ItemCreated(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
        val status: String = "pending",
    ) : NormalizedAgentEvent

    data class ItemStarted(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
    ) : NormalizedAgentEvent

    data class ItemDelta(
        val itemId: String,
        val kind: String,
        val text: String,
        val itemType: String? = null,
    ) : NormalizedAgentEvent

    data class ItemUpdated(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
        val status: String,
    ) : NormalizedAgentEvent

    data class ItemCompleted(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
    ) : NormalizedAgentEvent

    data class ItemFailed(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
        val error: OaepError,
    ) : NormalizedAgentEvent

    data class ItemCancelled(
        val itemId: String,
        val itemType: String,
        val content: OaepItemContent,
    ) : NormalizedAgentEvent
}
