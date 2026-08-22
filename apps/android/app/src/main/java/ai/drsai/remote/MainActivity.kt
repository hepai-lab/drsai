package ai.drsai.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.setContent
import ai.drsai.remote.ui.OpenDrSaiApp
import ai.drsai.remote.data.installAndroidUpdateLifecycle
import ai.drsai.remote.data.AndroidUpdateManager
import ai.drsai.remote.runtime.device.ACTION_STOP_LOCAL_RUN
import ai.drsai.remote.runtime.device.ACTION_CONTINUE_LOCAL_RUN
import ai.drsai.remote.runtime.device.EXTRA_RUN_ID
import ai.drsai.remote.runtime.device.EXTRA_SESSION_ID
import ai.drsai.remote.runtime.device.EXTRA_INTERACTION_ID
import ai.drsai.remote.runtime.device.ACTION_OPEN_OAEP_RUN
import ai.drsai.remote.runtime.reliability.ACTION_OPEN_RECOVERABLE_RUN
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.remote.device.AndroidRemoteBackgroundSync

class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installAndroidUpdateLifecycle(application)
        AndroidDevicePresence.install(application)
        AndroidRemoteBackgroundSync.install(application)
        setContent { OpenDrSaiApp(appViewModel) }
        handleViewIntent(intent)
        handleRunAction(intent)
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
        } else if (intent?.action == ACTION_STOP_LOCAL_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank()) {
            appViewModel.cancelRunFromNotification(intent.getStringExtra(EXTRA_RUN_ID)!!)
            intent.action = null
        } else if (intent?.action == ACTION_CONTINUE_LOCAL_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank()) {
            appViewModel.continueRunFromNotification(intent.getStringExtra(EXTRA_RUN_ID)!!)
            intent.action = null
        } else if (intent?.action == ACTION_OPEN_RECOVERABLE_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank()) {
            val runId = intent.getStringExtra(EXTRA_RUN_ID)!!
            val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
            if (sessionId.isNullOrBlank()) appViewModel.openRecoverableRun(runId)
            else appViewModel.openOaepRun(runId, sessionId, intent.getStringExtra(EXTRA_INTERACTION_ID))
            intent.action = null
        } else if (intent?.action == ACTION_OPEN_OAEP_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank() &&
            !intent.getStringExtra(EXTRA_SESSION_ID).isNullOrBlank()) {
            appViewModel.openOaepRun(
                intent.getStringExtra(EXTRA_RUN_ID)!!, intent.getStringExtra(EXTRA_SESSION_ID)!!,
                intent.getStringExtra(EXTRA_INTERACTION_ID),
            )
            intent.action = null
        }
    }

    private fun handleViewIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        appViewModel.handleOidcRedirect(intent.data)
        appViewModel.handleAssociationDeepLink(intent.data)
        appViewModel.handleDeepLink(intent.data)
    }
}
