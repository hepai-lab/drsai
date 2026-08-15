package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.R
import android.content.Context

enum class LongTaskText { QUEUED, PREPARING, EXECUTING_STEP, WAITING_APPROVAL, PAUSED, COMPLETED, CANCELLED, FAILED }
fun interface LongTaskStrings { fun text(key: LongTaskText, vararg arguments: Any): String }

class AndroidLongTaskStrings(private val context: Context) : LongTaskStrings {
    override fun text(key: LongTaskText, vararg arguments: Any): String = context.getString(
        when (key) {
            LongTaskText.QUEUED -> R.string.long_task_queued
            LongTaskText.PREPARING -> R.string.long_task_preparing
            LongTaskText.EXECUTING_STEP -> R.string.long_task_executing_step
            LongTaskText.WAITING_APPROVAL -> R.string.long_task_waiting_approval
            LongTaskText.PAUSED -> R.string.long_task_paused
            LongTaskText.COMPLETED -> R.string.long_task_completed
            LongTaskText.CANCELLED -> R.string.long_task_cancelled
            LongTaskText.FAILED -> R.string.long_task_failed
        },
        *arguments,
    )
}

object EnglishLongTaskStrings : LongTaskStrings {
    override fun text(key: LongTaskText, vararg arguments: Any): String = when (key) {
        LongTaskText.QUEUED -> "Waiting to start"
        LongTaskText.PREPARING -> "Preparing"
        LongTaskText.EXECUTING_STEP -> "Executing step ${arguments.first()}"
        LongTaskText.WAITING_APPROVAL -> "Waiting for your approval"
        LongTaskText.PAUSED -> "Task paused"
        LongTaskText.COMPLETED -> "Task completed"
        LongTaskText.CANCELLED -> "Task cancelled"
        LongTaskText.FAILED -> "Task failed"
    }
}
