package ai.drsai.remote.remote.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteNotificationNavigationTest {
    private fun received() = RemoteNotificationNavigationReducer().also {
        it.accept(RemoteNotificationNavigationEvent.Received("remote/r/w/sessions/s", "item-1"))
    }

    @Test fun `valid login cold start retains target until exact item focused`() {
        val reducer = received()
        assertEquals(
            RemoteNotificationNavigationPhase.NAVIGATING,
            reducer.accept(RemoteNotificationNavigationEvent.ProcessStarted(true, false)).phase,
        )
        assertTrue(reducer.accept(RemoteNotificationNavigationEvent.DestinationReady).pending)
        assertFalse(reducer.accept(RemoteNotificationNavigationEvent.ItemFocused("item-1")).pending)
    }

    @Test fun `killed process restoration and lock screen never consume target`() {
        val reducer = received()
        assertEquals(
            RemoteNotificationNavigationPhase.LOCKED,
            reducer.accept(RemoteNotificationNavigationEvent.ProcessStarted(true, true)).phase,
        )
        assertTrue(reducer.accept(RemoteNotificationNavigationEvent.Unlocked).pending)
    }

    @Test fun `expired login preserves target across successful reauthentication`() {
        val reducer = received()
        assertEquals(
            RemoteNotificationNavigationPhase.LOGIN_REQUIRED,
            reducer.accept(RemoteNotificationNavigationEvent.ProcessStarted(false, false)).phase,
        )
        assertTrue(reducer.accept(RemoteNotificationNavigationEvent.LoginCompleted).pending)
        assertFalse(reducer.accept(RemoteNotificationNavigationEvent.ItemFocused("item-1")).pending)
    }

    @Test fun `authentication expiry during navigation preserves target`() {
        val reducer = received()
        reducer.accept(RemoteNotificationNavigationEvent.ProcessStarted(true, false))
        val expired = reducer.accept(RemoteNotificationNavigationEvent.AuthenticationExpired)
        assertEquals(RemoteNotificationNavigationPhase.LOGIN_REQUIRED, expired.phase)
        assertTrue(expired.pending)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `wrong item cannot acknowledge notification`() {
        val reducer = received()
        reducer.accept(RemoteNotificationNavigationEvent.ItemFocused("different-item"))
    }
}
