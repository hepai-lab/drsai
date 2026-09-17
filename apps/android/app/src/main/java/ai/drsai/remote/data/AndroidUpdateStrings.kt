package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class AndroidUpdateText { MANIFEST_FAILED, DOWNLOAD_TIMEOUT, DOWNLOAD_FAILED }
fun interface AndroidUpdateStrings { fun text(key: AndroidUpdateText, vararg arguments: Any): String }
class LocalizedAndroidUpdateStrings(private val context: Context) : AndroidUpdateStrings {
    override fun text(key: AndroidUpdateText, vararg arguments: Any): String = context.getString(when (key) {
        AndroidUpdateText.MANIFEST_FAILED -> R.string.update_manifest_sources_failed
        AndroidUpdateText.DOWNLOAD_TIMEOUT -> R.string.update_download_timeout
        AndroidUpdateText.DOWNLOAD_FAILED -> R.string.update_download_sources_failed
    }, *arguments)
}
object EnglishAndroidUpdateStrings : AndroidUpdateStrings {
    override fun text(key: AndroidUpdateText, vararg arguments: Any): String = when (key) {
        AndroidUpdateText.MANIFEST_FAILED -> "Could not fetch the update from CDN or GitHub. Check the network and try again (${arguments.first()})"
        AndroidUpdateText.DOWNLOAD_TIMEOUT -> "Download timed out. The downloaded portion was preserved; retry to continue"
        AndroidUpdateText.DOWNLOAD_FAILED -> "Neither CDN nor GitHub could complete the download and verification (${arguments.first()})"
    }
}
