package ai.drsai.remote.data

import android.content.Context
import org.json.JSONObject

data class AndroidUpdateCheckRecord(
    val checkedAtEpochMs: Long,
    val result: String,
    val source: AndroidUpdateSource?,
    val targetVersion: String?,
    val targetVersionCode: Long?,
    val failureCode: String?,
)

class AndroidUpdateStore(context: Context) {
    private val preferences =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun recordCheck(state: AndroidUpdateState, nowEpochMs: Long = System.currentTimeMillis()) {
        val record = when (state) {
            is AndroidUpdateState.Available -> AndroidUpdateCheckRecord(
                checkedAtEpochMs = nowEpochMs,
                result = "available",
                source = state.update.source,
                targetVersion = state.update.version,
                targetVersionCode = state.update.versionCode,
                failureCode = null,
            )
            is AndroidUpdateState.Failed -> AndroidUpdateCheckRecord(
                checkedAtEpochMs = nowEpochMs,
                result = "failed",
                source = null,
                targetVersion = state.update?.version,
                targetVersionCode = state.update?.versionCode,
                failureCode = state.code,
            )
            AndroidUpdateState.Idle -> AndroidUpdateCheckRecord(
                checkedAtEpochMs = nowEpochMs,
                result = "current",
                source = null,
                targetVersion = null,
                targetVersionCode = null,
                failureCode = null,
            )
            else -> return
        }
        preferences.edit().putString(LAST_CHECK, encode(record)).apply()
    }

    fun lastCheck(): AndroidUpdateCheckRecord? =
        preferences.getString(LAST_CHECK, null)
            ?.let { raw -> runCatching { decode(raw) }.getOrNull() }

    private fun encode(record: AndroidUpdateCheckRecord): String = JSONObject().apply {
        put("checkedAtEpochMs", record.checkedAtEpochMs)
        put("result", record.result)
        record.source?.let { put("source", it.name) }
        record.targetVersion?.let { put("targetVersion", it) }
        record.targetVersionCode?.let { put("targetVersionCode", it) }
        record.failureCode?.let { put("failureCode", it) }
    }.toString()

    private fun decode(raw: String): AndroidUpdateCheckRecord {
        val json = JSONObject(raw)
        return AndroidUpdateCheckRecord(
            checkedAtEpochMs = json.getLong("checkedAtEpochMs"),
            result = json.getString("result"),
            source = json.optString("source").takeIf(String::isNotBlank)
                ?.let(AndroidUpdateSource::valueOf),
            targetVersion = json.optString("targetVersion").takeIf(String::isNotBlank),
            targetVersionCode = json.optLong("targetVersionCode", -1L).takeIf { it >= 0 },
            failureCode = json.optString("failureCode").takeIf(String::isNotBlank),
        )
    }

    private companion object {
        const val PREFERENCES = "android_update_v2"
        const val LAST_CHECK = "last_check"
    }
}
