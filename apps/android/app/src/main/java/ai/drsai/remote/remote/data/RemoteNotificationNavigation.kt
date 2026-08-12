package ai.drsai.remote.remote.data

/** Durable notification navigation is consumed only after the exact Item is visible. */
enum class RemoteNotificationNavigationPhase {
    PENDING, LOCKED, LOGIN_REQUIRED, NAVIGATING, FOCUSED,
}

data class RemoteNotificationNavigationState(
    val routePath: String? = null,
    val itemId: String? = null,
    val phase: RemoteNotificationNavigationPhase = RemoteNotificationNavigationPhase.PENDING,
) {
    val pending: Boolean get() = routePath != null && phase != RemoteNotificationNavigationPhase.FOCUSED
}

sealed interface RemoteNotificationNavigationEvent {
    data class Received(val routePath: String, val itemId: String?) : RemoteNotificationNavigationEvent
    data class ProcessStarted(val authenticated: Boolean, val locked: Boolean) : RemoteNotificationNavigationEvent
    data object Unlocked : RemoteNotificationNavigationEvent
    data object AuthenticationExpired : RemoteNotificationNavigationEvent
    data object LoginCompleted : RemoteNotificationNavigationEvent
    data object DestinationReady : RemoteNotificationNavigationEvent
    data class ItemFocused(val itemId: String) : RemoteNotificationNavigationEvent
}

class RemoteNotificationNavigationReducer {
    private var current = RemoteNotificationNavigationState()

    fun accept(event: RemoteNotificationNavigationEvent): RemoteNotificationNavigationState {
        current = when (event) {
            is RemoteNotificationNavigationEvent.Received -> {
                require(event.routePath.isNotBlank()) { "remote_notification_route_invalid" }
                RemoteNotificationNavigationState(event.routePath, event.itemId)
            }
            is RemoteNotificationNavigationEvent.ProcessStarted -> when {
                !current.pending -> current
                !event.authenticated -> current.copy(phase = RemoteNotificationNavigationPhase.LOGIN_REQUIRED)
                event.locked -> current.copy(phase = RemoteNotificationNavigationPhase.LOCKED)
                else -> current.copy(phase = RemoteNotificationNavigationPhase.NAVIGATING)
            }
            RemoteNotificationNavigationEvent.Unlocked -> if (current.pending) {
                current.copy(phase = RemoteNotificationNavigationPhase.NAVIGATING)
            } else current
            RemoteNotificationNavigationEvent.AuthenticationExpired -> if (current.pending) {
                current.copy(phase = RemoteNotificationNavigationPhase.LOGIN_REQUIRED)
            } else current
            RemoteNotificationNavigationEvent.LoginCompleted,
            RemoteNotificationNavigationEvent.DestinationReady -> if (current.pending) {
                current.copy(phase = RemoteNotificationNavigationPhase.NAVIGATING)
            } else current
            is RemoteNotificationNavigationEvent.ItemFocused -> {
                require(current.pending && current.itemId == event.itemId) {
                    "remote_notification_focus_mismatch"
                }
                current.copy(phase = RemoteNotificationNavigationPhase.FOCUSED)
            }
        }
        return current
    }
}
