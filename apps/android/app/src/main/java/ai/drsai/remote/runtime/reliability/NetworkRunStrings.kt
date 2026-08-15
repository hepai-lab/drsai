package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.R
import android.content.Context

enum class NetworkRunText { RESTRICTED, OFFLINE, ONLINE, RUNTIME_FAILED, RECONNECTING, RESTORED }
fun interface NetworkRunStrings { fun text(key: NetworkRunText): String }
class AndroidNetworkRunStrings(private val context: Context) : NetworkRunStrings {
    override fun text(key: NetworkRunText): String = context.getString(when (key) {
        NetworkRunText.RESTRICTED -> R.string.network_run_restricted
        NetworkRunText.OFFLINE -> R.string.network_run_offline
        NetworkRunText.ONLINE -> R.string.network_run_online
        NetworkRunText.RUNTIME_FAILED -> R.string.network_run_runtime_failed
        NetworkRunText.RECONNECTING -> R.string.network_run_reconnecting
        NetworkRunText.RESTORED -> R.string.network_run_restored
    })
}
object EnglishNetworkRunStrings : NetworkRunStrings {
    override fun text(key: NetworkRunText): String = when (key) {
        NetworkRunText.RESTRICTED -> "Network is restricted; progress is preserved"
        NetworkRunText.OFFLINE -> "Waiting for network; progress is preserved"
        NetworkRunText.ONLINE -> "Network connected"
        NetworkRunText.RUNTIME_FAILED -> "Network recovered, but Runtime reconnection failed"
        NetworkRunText.RECONNECTING -> "Network recovered; reconnecting Runtime"
        NetworkRunText.RESTORED -> "Resumed the same task"
    }
}
