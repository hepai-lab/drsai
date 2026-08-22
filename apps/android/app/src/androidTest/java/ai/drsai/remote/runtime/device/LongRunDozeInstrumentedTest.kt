package ai.drsai.remote.runtime.device

import android.app.NotificationManager
import android.Manifest
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.FileInputStream

@RunWith(AndroidJUnit4::class)
class LongRunDozeInstrumentedTest {
    @Test
    fun foreground_long_run_keeps_user_controls_visible_during_forced_doze() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.grantRuntimePermission(
            context.packageName, Manifest.permission.POST_NOTIFICATIONS,
        )
        val runId = "p9-doze-run"
        ContextCompat.startForegroundService(
            context,
            Intent(context, LocalRunForegroundService::class.java)
                .setAction("ai.drsai.remote.action.SHOW_LOCAL_RUN")
                .putExtra(EXTRA_ACCOUNT_SUBJECT, "p9-doze-subject")
                .putExtra(EXTRA_RUN_ID, runId)
                .putExtra(EXTRA_SESSION_ID, "p9-doze-session"),
        )
        try {
            val manager = context.getSystemService(NotificationManager::class.java)
            var active = manager.activeNotifications
            repeat(20) {
                if (active.any { it.id == LocalRunNotificationController.stableNotificationId(runId) }) return@repeat
                Thread.sleep(100)
                active = manager.activeNotifications
            }
            assertRunNotification(active, runId)

            shell(automation, "dumpsys battery unplug")
            shell(automation, "cmd deviceidle force-idle")
            assertTrue("device did not enter forced idle", shell(automation, "dumpsys deviceidle").contains("mState=IDLE"))
            assertRunNotification(manager.activeNotifications, runId)
        } finally {
            shell(automation, "cmd deviceidle unforce")
            shell(automation, "dumpsys battery reset")
            context.stopService(Intent(context, LocalRunForegroundService::class.java))
        }
    }

    private fun assertRunNotification(active: Array<android.service.notification.StatusBarNotification>, runId: String) {
        assertTrue("active notification ids=${active.map { it.id }}", active.any {
            it.id == LocalRunNotificationController.stableNotificationId(runId) &&
                it.notification.actions?.size == 2 &&
                it.notification.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0
        })
    }

    private fun shell(automation: android.app.UiAutomation, command: String): String =
        automation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).bufferedReader().use { it.readText() }
        }
}
