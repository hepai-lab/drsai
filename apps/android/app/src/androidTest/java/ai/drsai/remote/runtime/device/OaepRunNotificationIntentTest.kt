package ai.drsai.remote.runtime.device

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OaepRunNotificationIntentTest {
    @Test
    fun notification_intent_retains_session_run_and_interaction_scope() {
        val intent = oaepRunOpenIntent(
            ApplicationProvider.getApplicationContext<Context>(),
            "run-1", "session-1", "interaction-1",
        )
        assertEquals(ACTION_OPEN_OAEP_RUN, intent.action)
        assertEquals("run-1", intent.getStringExtra(EXTRA_RUN_ID))
        assertEquals("session-1", intent.getStringExtra(EXTRA_SESSION_ID))
        assertEquals("interaction-1", intent.getStringExtra(EXTRA_INTERACTION_ID))
    }

    @Test
    fun long_run_notification_has_scoped_continue_and_cancel_controls() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val continueIntent = localRunActionIntent(context, ACTION_CONTINUE_LOCAL_RUN, "run-1", "session-1")
        val cancelIntent = localRunActionIntent(context, ACTION_STOP_LOCAL_RUN, "run-1", "session-1")
        val notification = localRunNotification(context, "run-1", "session-1", "Running")

        assertEquals(ACTION_CONTINUE_LOCAL_RUN, continueIntent.action)
        assertEquals(ACTION_STOP_LOCAL_RUN, cancelIntent.action)
        listOf(continueIntent, cancelIntent).forEach {
            assertEquals("run-1", it.getStringExtra(EXTRA_RUN_ID))
            assertEquals("session-1", it.getStringExtra(EXTRA_SESSION_ID))
        }
        assertEquals(2, notification.actions.size)
        assertTrue(notification.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
    }

    @Test
    fun invalid_or_unscoped_notification_actions_fail_closed() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue(runCatching { localRunActionIntent(context, "unknown", "run-1", "session-1") }.isFailure)
        assertTrue(runCatching { localRunActionIntent(context, ACTION_STOP_LOCAL_RUN, "", "session-1") }.isFailure)
    }
}
