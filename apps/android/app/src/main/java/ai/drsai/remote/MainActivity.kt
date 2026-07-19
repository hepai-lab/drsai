package ai.drsai.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.compose.setContent
import ai.drsai.remote.ui.OpenDrSaiApp
import ai.drsai.remote.data.installAndroidUpdateLifecycle

class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installAndroidUpdateLifecycle(application)
        setContent { OpenDrSaiApp(appViewModel) }
        appViewModel.handleOidcRedirect(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        appViewModel.handleOidcRedirect(intent.data)
    }

    override fun onStop() {
        appViewModel.pauseForBackground()
        super.onStop()
    }
}
