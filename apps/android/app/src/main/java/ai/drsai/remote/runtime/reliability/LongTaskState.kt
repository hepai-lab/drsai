package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.runtime.v2.RunCheckpoint

/** One immutable source for both the in-app banner and the foreground notification. */
data class LongTaskSnapshot(
    val runId: String,
    val sessionId: String,
    val stepId: String,
    val stepLabel: String,
    val sequence: Long,
    val elapsedMillis: Long,
    val navigation: LongTaskNavigation,
)

data class LongTaskNavigation(val runId: String, val sessionId: String)

class LongTaskStateProjector(
    private val startedAtMillis: Long,
    private val minimumPublishIntervalMillis: Long = 15_000,
    private val strings: LongTaskStrings = EnglishLongTaskStrings,
) {
    init {
        require(startedAtMillis >= 0) { "long_task_started_at_invalid" }
        require(minimumPublishIntervalMillis >= 1_000) { "long_task_publish_interval_too_small" }
    }

    private var lastPublishedAtMillis = Long.MIN_VALUE
    private var lastSequence = -1L
    private var publishedSequence = -1L

    fun project(checkpoint: RunCheckpoint, nowMillis: Long): LongTaskSnapshot {
        require(nowMillis >= startedAtMillis) { "long_task_clock_moved_backwards" }
        require(checkpoint.lastSequence >= lastSequence) { "long_task_sequence_moved_backwards" }
        lastSequence = checkpoint.lastSequence
        val status = checkpoint.status.name
        val label = when (status) {
            "QUEUED" -> strings.text(LongTaskText.QUEUED)
            "RUNNING" -> if (checkpoint.lastSequence == 0L) strings.text(LongTaskText.PREPARING)
                else strings.text(LongTaskText.EXECUTING_STEP, checkpoint.lastSequence)
            "WAITING_APPROVAL" -> strings.text(LongTaskText.WAITING_APPROVAL)
            "PAUSED" -> strings.text(LongTaskText.PAUSED)
            "COMPLETED" -> strings.text(LongTaskText.COMPLETED)
            "CANCELLED" -> strings.text(LongTaskText.CANCELLED)
            else -> strings.text(LongTaskText.FAILED)
        }
        return LongTaskSnapshot(
            runId = checkpoint.command.runId.value,
            sessionId = checkpoint.command.sessionId.value,
            stepId = "$status:${checkpoint.lastSequence}",
            stepLabel = label,
            sequence = checkpoint.lastSequence,
            elapsedMillis = nowMillis - startedAtMillis,
            navigation = LongTaskNavigation(checkpoint.command.runId.value, checkpoint.command.sessionId.value),
        )
    }

    /** Rate limits heartbeats while always allowing a real step transition. */
    fun shouldPublish(snapshot: LongTaskSnapshot, nowMillis: Long): Boolean {
        require(nowMillis >= startedAtMillis) { "long_task_clock_moved_backwards" }
        val stepChanged = snapshot.sequence != publishedSequence
        val due = lastPublishedAtMillis == Long.MIN_VALUE || nowMillis - lastPublishedAtMillis >= minimumPublishIntervalMillis
        if (!stepChanged && !due) return false
        publishedSequence = snapshot.sequence
        lastPublishedAtMillis = nowMillis
        return true
    }
}
