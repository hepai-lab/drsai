package ai.drsai.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.setContent
import ai.drsai.remote.ui.OpenDrSaiApp
import ai.drsai.remote.data.installAndroidUpdateLifecycle
import ai.drsai.remote.runtime.device.ACTION_STOP_LOCAL_RUN
import ai.drsai.remote.runtime.device.EXTRA_RUN_ID
import ai.drsai.remote.runtime.reliability.ACTION_OPEN_RECOVERABLE_RUN

class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installAndroidUpdateLifecycle(application)
        setContent { OpenDrSaiApp(appViewModel) }
        appViewModel.handleOidcRedirect(intent?.data)
        appViewModel.handleDeepLink(intent?.data)
        handleRunAction(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        appViewModel.handleOidcRedirect(intent.data)
        appViewModel.handleDeepLink(intent.data)
        handleRunAction(intent)
    }

    override fun onStop() {
        appViewModel.pauseForBackground()
        super.onStop()
    }

    private fun handleRunAction(intent: Intent?) {
        if (intent?.action == ACTION_STOP_LOCAL_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank()) {
            appViewModel.stop()
            intent.action = null
        } else if (intent?.action == ACTION_OPEN_RECOVERABLE_RUN && !intent.getStringExtra(EXTRA_RUN_ID).isNullOrBlank()) {
            appViewModel.openRecoverableRun(intent.getStringExtra(EXTRA_RUN_ID)!!)
            intent.action = null
        }
    }
}
