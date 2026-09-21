package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.R
import android.content.Context

enum class LegacyRuntimeStatusText { QUEUED, RECOVERING, WAITING_APPROVAL, RECONCILING, PAUSED, FAILED, CANCELLED }
fun interface LegacyRuntimeStatusStrings { fun text(key: LegacyRuntimeStatusText): String }

class AndroidLegacyRuntimeStatusStrings(private val context: Context) : LegacyRuntimeStatusStrings {
    override fun text(key: LegacyRuntimeStatusText): String = context.getString(when (key) {
        LegacyRuntimeStatusText.QUEUED -> R.string.legacy_runtime_queued
        LegacyRuntimeStatusText.RECOVERING -> R.string.legacy_runtime_recovering
        LegacyRuntimeStatusText.WAITING_APPROVAL -> R.string.legacy_runtime_waiting_approval
        LegacyRuntimeStatusText.RECONCILING -> R.string.legacy_runtime_reconciling
        LegacyRuntimeStatusText.PAUSED -> R.string.legacy_runtime_paused
        LegacyRuntimeStatusText.FAILED -> R.string.legacy_runtime_failed
        LegacyRuntimeStatusText.CANCELLED -> R.string.legacy_runtime_cancelled
    })
}

object EnglishLegacyRuntimeStatusStrings : LegacyRuntimeStatusStrings {
    override fun text(key: LegacyRuntimeStatusText): String = when (key) {
        LegacyRuntimeStatusText.QUEUED -> "Task queued"
        LegacyRuntimeStatusText.RECOVERING -> "Recovering…"
        LegacyRuntimeStatusText.WAITING_APPROVAL -> "Waiting for approval"
        LegacyRuntimeStatusText.RECONCILING -> "Side-effect result needs confirmation"
        LegacyRuntimeStatusText.PAUSED -> "Task paused; you can continue"
        LegacyRuntimeStatusText.FAILED -> "Task failed"
        LegacyRuntimeStatusText.CANCELLED -> "Task cancelled"
    }
}
