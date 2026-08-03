package ai.drsai.remote

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * The only exported activity. It deliberately forwards no extras or custom
 * actions, keeping notification/runtime control actions inside the app UID.
 */
class ExternalEntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val target = when {
            intent.action == Intent.ACTION_MAIN -> Intent(this, MainActivity::class.java)
            intent.action == Intent.ACTION_VIEW && allowedDeepLink(intent.data) ->
                Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(intent.data)
            else -> null
        }
        target?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (target != null) startActivity(target)
        finish()
    }

    internal companion object {
        val OPEN_DRSAI_HOSTS = setOf("associate", "remote", "workspace", "session", "run", "approval", "artifact")

        fun allowedDeepLink(uri: Uri?): Boolean {
            if (uri == null || uri.userInfo != null) return false
            return when (uri.scheme?.lowercase()) {
                "opendrsai" -> uri.host?.lowercase() in OPEN_DRSAI_HOSTS
                "ai.drsai.remote" -> uri.host.isNullOrEmpty() && uri.path == "/oauth2redirect"
                else -> false
            }
        }
    }
}
