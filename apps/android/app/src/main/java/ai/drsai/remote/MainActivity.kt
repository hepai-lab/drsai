package ai.drsai.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.setContent
import ai.drsai.remote.ui.OpenDrSaiApp
import ai.drsai.remote.ui.OpenDrSaiStartupFrame
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ai.drsai.remote.data.installAndroidUpdateLifecycle
import ai.drsai.remote.data.AndroidUpdateManager
import ai.drsai.remote.runtime.device.ACTION_STOP_LOCAL_RUN
import ai.drsai.remote.runtime.device.ACTION_CONTINUE_LOCAL_RUN
import ai.drsai.remote.runtime.device.EXTRA_RUN_ID
import ai.drsai.remote.runtime.device.EXTRA_SESSION_ID
import ai.drsai.remote.runtime.device.EXTRA_INTERACTION_ID
import ai.drsai.remote.runtime.device.EXTRA_ACCOUNT_SUBJECT
import ai.drsai.remote.runtime.device.ACTION_OPEN_OAEP_RUN
import ai.drsai.remote.runtime.device.ACTION_OPEN_RUN_APPROVAL
import ai.drsai.remote.runtime.device.ACTION_OPEN_RUN_RESULT
import ai.drsai.remote.runtime.reliability.ACTION_OPEN_RECOVERABLE_RUN
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.remote.device.AndroidRemoteBackgroundSync

class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Draw a useful branded frame before constructing the large application graph.
        // Full state/bootstrap starts immediately after that frame and remains the only runtime path.
        setContent {
            var fullUiReady by remember { mutableStateOf(false) }
            if (fullUiReady) OpenDrSaiApp(appViewModel) else OpenDrSaiStartupFrame()
            LaunchedEffect(Unit) {
                delay(STARTUP_FRAME_HOLD_MS)
                fullUiReady = true
            }
        }
        lifecycleScope.launch {
            delay(STARTUP_FRAME_HOLD_MS)
            if (!isFinishing && !isDestroyed) {
                installAndroidUpdateLifecycle(application)
                AndroidDevicePresence.install(application)
                AndroidRemoteBackgroundSync.install(application)
                handleViewIntent(intent)
                handleRunAction(intent)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleViewIntent(intent)
        handleRunAction(intent)
    }

    override fun onStop() {
        appViewModel.pauseForBackground()
        super.onStop()
    }

    private fun handleRunAction(intent: Intent?) {
        if (intent?.action == AndroidUpdateManager.ACTION_OPEN_UPDATE) {
            appViewModel.toggleProfile(true)
            intent.action = null
        } else if (intent?.action == ACTION_STOP_LOCAL_RUN && hasBoundRunScope(intent)) {
            appViewModel.cancelRunFromNotification(
                intent.getStringExtra(EXTRA_ACCOUNT_SUBJECT)!!, intent.getStringExtra(EXTRA_RUN_ID)!!,
                intent.getStringExtra(EXTRA_SESSION_ID)!!,
            )
            intent.action = null
        } else if (intent?.action == ACTION_CONTINUE_LOCAL_RUN && hasBoundRunScope(intent)) {
            appViewModel.continueRunFromNotification(
                intent.getStringExtra(EXTRA_ACCOUNT_SUBJECT)!!, intent.getStringExtra(EXTRA_RUN_ID)!!,
                intent.getStringExtra(EXTRA_SESSION_ID)!!,
            )
            intent.action = null
        } else if (intent?.action == ACTION_OPEN_RECOVERABLE_RUN && hasBoundRunScope(intent)) {
            val runId = intent.getStringExtra(EXTRA_RUN_ID)!!
            val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
            if (sessionId.isNullOrBlank()) appViewModel.openRecoverableRun(runId)
            else appViewModel.openOaepRun(intent.getStringExtra(EXTRA_ACCOUNT_SUBJECT)!!, runId, sessionId, intent.getStringExtra(EXTRA_INTERACTION_ID))
            intent.action = null
        } else if (intent != null && intent.action in setOf(ACTION_OPEN_OAEP_RUN, ACTION_OPEN_RUN_APPROVAL, ACTION_OPEN_RUN_RESULT) && hasBoundRunScope(intent)) {
            val scopedIntent = intent ?: return
            val interactionId = scopedIntent.getStringExtra(EXTRA_INTERACTION_ID)
            if (scopedIntent.action != ACTION_OPEN_OAEP_RUN && interactionId.isNullOrBlank()) return
            appViewModel.openOaepRun(
                scopedIntent.getStringExtra(EXTRA_ACCOUNT_SUBJECT)!!, scopedIntent.getStringExtra(EXTRA_RUN_ID)!!,
                scopedIntent.getStringExtra(EXTRA_SESSION_ID)!!, interactionId,
            )
            scopedIntent.action = null
        }
    }

    private fun hasBoundRunScope(intent: Intent): Boolean =
        !intent.getStringExtra(EXTRA_ACCOUNT_SUBJECT).isNullOrBlank() &&
            !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank() &&
            !intent.getStringExtra(EXTRA_SESSION_ID).isNullOrBlank()

    private fun handleViewIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        appViewModel.handleOidcRedirect(intent.data)
        appViewModel.handleAssociationDeepLink(intent.data)
        appViewModel.handleDeepLink(intent.data)
    }

    private companion object {
        const val STARTUP_FRAME_HOLD_MS = 100L
    }
}
