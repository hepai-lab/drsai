package ai.drsai.remote.runtime.python

import android.content.Context

data class PythonRuntimeMetricSnapshot(
    val starts: Long,
    val bindAttempts: Long,
    val bindSuccesses: Long,
    val bindLatencyTotalMs: Long,
    val recoveryAttempts: Long,
    val recoverySuccesses: Long,
    val recoveryLatencyTotalMs: Long,
    val duplicateSideEffectsBlocked: Long,
    val safeFallbacks: Long,
) {
    val recoverySuccessRate: Double get() = if (recoveryAttempts == 0L) 0.0 else recoverySuccesses.toDouble() / recoveryAttempts
    val fallbackRate: Double get() = if (starts == 0L) 0.0 else safeFallbacks.toDouble() / starts
}

interface PythonRuntimeMetrics {
    fun runtimeStarted()
    fun bindFinished(latencyMs: Long, succeeded: Boolean)
    fun recoveryFinished(latencyMs: Long, succeeded: Boolean)
    fun duplicateSideEffectBlocked()
    fun safeFallback()
    fun snapshot(): PythonRuntimeMetricSnapshot
}

object NoOpPythonRuntimeMetrics : PythonRuntimeMetrics {
    override fun runtimeStarted() = Unit
    override fun bindFinished(latencyMs: Long, succeeded: Boolean) = Unit
    override fun recoveryFinished(latencyMs: Long, succeeded: Boolean) = Unit
    override fun duplicateSideEffectBlocked() = Unit
    override fun safeFallback() = Unit
    override fun snapshot() = PythonRuntimeMetricSnapshot(0, 0, 0, 0, 0, 0, 0, 0, 0)
}

class SharedPreferencesPythonRuntimeMetrics(context: Context) : PythonRuntimeMetrics {
    private val preferences = context.getSharedPreferences("python_runtime_metrics_v1", Context.MODE_PRIVATE)
    private val lock = Any()
    private fun increment(vararg updates: Pair<String, Long>): Unit = synchronized(lock) {
        preferences.edit().apply {
            updates.forEach { (key, delta) -> putLong(key, preferences.getLong(key, 0) + delta) }
        }.commit()
        Unit
    }
    override fun runtimeStarted() = increment("starts" to 1)
    override fun bindFinished(latencyMs: Long, succeeded: Boolean) = increment(
        "bind_attempts" to 1, "bind_successes" to if (succeeded) 1 else 0,
        "bind_latency_total_ms" to latencyMs.coerceAtLeast(0),
    )
    override fun recoveryFinished(latencyMs: Long, succeeded: Boolean) = increment(
        "recovery_attempts" to 1, "recovery_successes" to if (succeeded) 1 else 0,
        "recovery_latency_total_ms" to latencyMs.coerceAtLeast(0),
    )
    override fun duplicateSideEffectBlocked() = increment("duplicate_side_effects_blocked" to 1)
    override fun safeFallback() = increment("safe_fallbacks" to 1)
    override fun snapshot() = synchronized(lock) {
        PythonRuntimeMetricSnapshot(
            preferences.getLong("starts", 0), preferences.getLong("bind_attempts", 0),
            preferences.getLong("bind_successes", 0), preferences.getLong("bind_latency_total_ms", 0),
            preferences.getLong("recovery_attempts", 0), preferences.getLong("recovery_successes", 0),
            preferences.getLong("recovery_latency_total_ms", 0),
            preferences.getLong("duplicate_side_effects_blocked", 0), preferences.getLong("safe_fallbacks", 0),
        )
    }
}
