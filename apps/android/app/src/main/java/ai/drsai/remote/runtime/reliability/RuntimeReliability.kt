package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.WorkbenchId
import kotlin.math.min

enum class FailureCategory { NETWORK, RATE_LIMIT, SERVER, AUTH, VALIDATION, TOOL_SIDE_EFFECT, CANCELLED, UNKNOWN }

data class ClassifiedFailure(
    val category: FailureCategory,
    val code: String,
    val retryable: Boolean,
    val userAction: String,
)

object RuntimeFailureCatalog {
    fun classify(httpStatus: Int?, code: String? = null, sideEffectStarted: Boolean = false): ClassifiedFailure {
        val normalized = code?.lowercase().orEmpty()
        return when {
            normalized == "cancelled" -> ClassifiedFailure(FailureCategory.CANCELLED, "cancelled", false, "重新发送")
            sideEffectStarted -> ClassifiedFailure(FailureCategory.TOOL_SIDE_EFFECT, "side_effect_unknown", false, "检查结果后手动重试")
            httpStatus == 0 || httpStatus == 408 -> ClassifiedFailure(FailureCategory.NETWORK, "network_unavailable", true, "检查网络")
            httpStatus == 401 || httpStatus == 403 -> ClassifiedFailure(FailureCategory.AUTH, "authentication_required", false, "重新登录")
            httpStatus == 429 -> ClassifiedFailure(FailureCategory.RATE_LIMIT, "rate_limited", true, "稍后重试")
            httpStatus != null && httpStatus in 500..599 -> ClassifiedFailure(FailureCategory.SERVER, "server_unavailable", true, "稍后重试")
            httpStatus != null && httpStatus in 400..499 -> ClassifiedFailure(FailureCategory.VALIDATION, normalized.ifBlank { "invalid_request" }, false, "修改请求")
            else -> ClassifiedFailure(FailureCategory.UNKNOWN, normalized.ifBlank { "unknown_error" }, false, "查看诊断信息")
        }
    }
}

data class RetryDecision(val retry: Boolean, val delayMillis: Long, val reason: String)

data class RuntimeRetryPolicy(
    val maxAttempts: Int = 3,
    val baseDelayMillis: Long = 500,
    val maxDelayMillis: Long = 8_000,
) {
    init {
        require(maxAttempts >= 1 && baseDelayMillis > 0 && maxDelayMillis >= baseDelayMillis)
    }

    fun decide(failure: ClassifiedFailure, attempt: Int, idempotencyKey: String?): RetryDecision {
        if (!failure.retryable) return RetryDecision(false, 0, failure.code)
        if (idempotencyKey.isNullOrBlank()) return RetryDecision(false, 0, "idempotency_key_required")
        if (attempt >= maxAttempts) return RetryDecision(false, 0, "retry_budget_exhausted")
        val multiplier = 1L shl attempt.coerceIn(0, 20)
        return RetryDecision(true, min(maxDelayMillis, baseDelayMillis * multiplier), failure.code)
    }
}

data class ResourceRecord(
    val id: String,
    val bytes: Long,
    val lastAccessedAt: Long,
    val pinned: Boolean = false,
    val active: Boolean = false,
)

object ResourceRetentionPolicy {
    fun evictions(records: List<ResourceRecord>, maxBytes: Long, maxItems: Int): List<ResourceRecord> {
        require(maxBytes >= 0 && maxItems >= 0)
        var bytes = records.sumOf(ResourceRecord::bytes)
        var count = records.size
        val evicted = mutableListOf<ResourceRecord>()
        records.asSequence().filterNot { it.pinned || it.active }.sortedWith(
            compareBy<ResourceRecord> { it.lastAccessedAt }.thenBy { it.id },
        ).forEach { record ->
            if (bytes > maxBytes || count > maxItems) {
                evicted += record
                bytes -= record.bytes
                count--
            }
        }
        return evicted
    }
}

enum class ThermalLevel { NORMAL, MODERATE, SEVERE, CRITICAL }
enum class ConstraintDecision { RUN, PAUSE, OFFER_HANDOFF, REQUIRE_FOREGROUND }

data class DeviceConstraints(
    val batteryPercent: Int,
    val charging: Boolean,
    val thermal: ThermalLevel,
    val lowMemory: Boolean,
    val appInForeground: Boolean,
)

object DeviceConstraintPolicy {
    fun decide(constraints: DeviceConstraints, estimatedLongRunning: Boolean): ConstraintDecision = when {
        constraints.thermal == ThermalLevel.CRITICAL || constraints.lowMemory -> ConstraintDecision.PAUSE
        estimatedLongRunning && constraints.thermal >= ThermalLevel.SEVERE -> ConstraintDecision.OFFER_HANDOFF
        estimatedLongRunning && constraints.batteryPercent < 15 && !constraints.charging -> ConstraintDecision.OFFER_HANDOFF
        estimatedLongRunning && !constraints.appInForeground -> ConstraintDecision.REQUIRE_FOREGROUND
        else -> ConstraintDecision.RUN
    }
}

data class DiagnosticBundle(
    val errorCode: String,
    val requestId: String?,
    val runId: WorkbenchId?,
    val authority: RuntimeAuthority?,
    val details: String,
)

object DiagnosticBundleFactory {
    fun create(
        error: ClassifiedFailure,
        requestId: String?,
        runId: WorkbenchId?,
        authority: RuntimeAuthority?,
        rawDetails: String,
    ) = DiagnosticBundle(error.code, requestId?.take(100), runId, authority, SensitiveDataRedactor.redact(rawDetails).take(4_000))
}

data class CursorEvent(val eventId: String, val sequence: Long)
data class CursorMergeResult(val accepted: List<CursorEvent>, val cursor: Long, val gapAt: Long?)

object EventCursorReconciler {
    fun merge(currentCursor: Long, seenIds: Set<String>, incoming: List<CursorEvent>): CursorMergeResult {
        var cursor = currentCursor
        val accepted = mutableListOf<CursorEvent>()
        val seen = seenIds.toMutableSet()
        for (event in incoming.sortedBy(CursorEvent::sequence)) {
            if (event.eventId in seen || event.sequence <= cursor) continue
            if (event.sequence != cursor + 1) return CursorMergeResult(accepted, cursor, cursor + 1)
            accepted += event
            seen += event.eventId
            cursor = event.sequence
        }
        return CursorMergeResult(accepted, cursor, null)
    }
}

object BackgroundRunKeys {
    fun uniqueWorkName(subject: String, runId: WorkbenchId): String {
        val safeSubject = subject.hashCode().toUInt().toString(16)
        return "opendrsai-run-$safeSubject-${runId.value}"
    }
}
