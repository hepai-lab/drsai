package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.R
import android.content.Context

enum class RecoveryCenterText { FAILED, WAITING_APPROVAL, INTERRUPTED, PAUSED, RECOVERABLE }
fun interface RecoveryCenterStrings { fun text(key: RecoveryCenterText): String }
class AndroidRecoveryCenterStrings(private val context: Context) : RecoveryCenterStrings {
    override fun text(key: RecoveryCenterText): String = context.getString(when (key) {
        RecoveryCenterText.FAILED -> R.string.recovery_item_failed
        RecoveryCenterText.WAITING_APPROVAL -> R.string.recovery_item_waiting_approval
        RecoveryCenterText.INTERRUPTED -> R.string.recovery_item_interrupted
        RecoveryCenterText.PAUSED -> R.string.recovery_item_paused
        RecoveryCenterText.RECOVERABLE -> R.string.recovery_item_recoverable
    })
}
object EnglishRecoveryCenterStrings : RecoveryCenterStrings {
    override fun text(key: RecoveryCenterText): String = when (key) {
        RecoveryCenterText.FAILED -> "Failed task"
        RecoveryCenterText.WAITING_APPROVAL -> "Task waiting for confirmation"
        RecoveryCenterText.INTERRUPTED -> "Recovered from an interruption"
        RecoveryCenterText.PAUSED -> "Paused task"
        RecoveryCenterText.RECOVERABLE -> "Recoverable task"
    }
}
