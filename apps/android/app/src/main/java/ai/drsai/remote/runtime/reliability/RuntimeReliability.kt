package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.WorkbenchId
import kotlin.math.min

enum class FailureCategory {
    NETWORK, RATE_LIMIT, SERVER, AUTH, VALIDATION, TOOL_SIDE_EFFECT, CANCELLED,
    PYTHON, BINDER, MODEL, TOOL, APPROVAL, ROOM, POLICY, RESOURCE, UNKNOWN,
}

enum class FailureUserAction { RESEND, RECONCILE_RESULT, RETRY_OR_SWITCH_RUNTIME, RECONNECT_RUNTIME, RETRY_MODEL, CHECK_TOOL_RESULT, CONFIRM_APPROVAL, EXPORT_DIAGNOSTICS, USE_SAFE_RUNTIME, RELEASE_RESOURCES, CHECK_NETWORK, SIGN_IN_AGAIN, RETRY_LATER, MODIFY_REQUEST, VIEW_DIAGNOSTICS }
data class ClassifiedFailure(val category: FailureCategory, val code: String, val retryable: Boolean, val userAction: FailureUserAction)

object RuntimeFailureCatalog {
    fun classify(httpStatus: Int?, code: String? = null, sideEffectStarted: Boolean = false): ClassifiedFailure {
        val normalized = code?.lowercase().orEmpty()
        return when {
            normalized == "cancelled" -> failure(FailureCategory.CANCELLED, "cancelled", false, FailureUserAction.RESEND)
            sideEffectStarted -> failure(FailureCategory.TOOL_SIDE_EFFECT, "side_effect_unknown", false, FailureUserAction.RECONCILE_RESULT)
            normalized.startsWith("python_") -> failure(FailureCategory.PYTHON, normalized, true, FailureUserAction.RETRY_OR_SWITCH_RUNTIME)
            normalized.startsWith("binder_") -> failure(FailureCategory.BINDER, normalized, true, FailureUserAction.RECONNECT_RUNTIME)
            normalized.startsWith("model_") -> failure(FailureCategory.MODEL, normalized, true, FailureUserAction.RETRY_MODEL)
            normalized.startsWith("tool_") -> failure(FailureCategory.TOOL, normalized, false, FailureUserAction.CHECK_TOOL_RESULT)
            normalized.startsWith("approval_") -> failure(FailureCategory.APPROVAL, normalized, false, FailureUserAction.CONFIRM_APPROVAL)
            normalized.startsWith("room_") || normalized.startsWith("journal_") ->
                failure(FailureCategory.ROOM, normalized, false, FailureUserAction.EXPORT_DIAGNOSTICS)
            normalized.startsWith("policy_") || normalized.startsWith("runtime_policy_") ->
                failure(FailureCategory.POLICY, normalized, false, FailureUserAction.USE_SAFE_RUNTIME)
            normalized.startsWith("resource_") -> failure(FailureCategory.RESOURCE, normalized, true, FailureUserAction.RELEASE_RESOURCES)
            httpStatus == 0 || httpStatus == 408 -> failure(FailureCategory.NETWORK, "network_unavailable", true, FailureUserAction.CHECK_NETWORK)
            httpStatus == 401 || httpStatus == 403 -> failure(FailureCategory.AUTH, "authentication_required", false, FailureUserAction.SIGN_IN_AGAIN)
            httpStatus == 429 -> failure(FailureCategory.RATE_LIMIT, "rate_limited", true, FailureUserAction.RETRY_LATER)
            httpStatus != null && httpStatus in 500..599 -> failure(FailureCategory.SERVER, "server_unavailable", true, FailureUserAction.RETRY_LATER)
            httpStatus != null && httpStatus in 400..499 -> failure(FailureCategory.VALIDATION, normalized.ifBlank { "invalid_request" }, false, FailureUserAction.MODIFY_REQUEST)
            else -> failure(FailureCategory.UNKNOWN, normalized.ifBlank { "unknown_error" }, false, FailureUserAction.VIEW_DIAGNOSTICS)
        }
    }

    private fun failure(category: FailureCategory, code: String, retryable: Boolean, action: FailureUserAction) =
        ClassifiedFailure(category, code, retryable, action)
}

data class RetryDecision(val retry: Boolean, val delayMillis: Long, val reason: String)
data class RuntimeRetryPolicy(val maxAttempts: Int = 3, val baseDelayMillis: Long = 500, val maxDelayMillis: Long = 8_000) {
    init { require(maxAttempts >= 1 && baseDelayMillis > 0 && maxDelayMillis >= baseDelayMillis) }
    fun decide(failure: ClassifiedFailure, attempt: Int, idempotencyKey: String?): RetryDecision {
        if (!failure.retryable) return RetryDecision(false, 0, failure.code)
        if (idempotencyKey.isNullOrBlank()) return RetryDecision(false, 0, "idempotency_key_required")
        if (attempt >= maxAttempts) return RetryDecision(false, 0, "retry_budget_exhausted")
        return RetryDecision(true, min(maxDelayMillis, baseDelayMillis * (1L shl attempt.coerceIn(0, 20))), failure.code)
    }
}

data class ResourceRecord(val id: String, val bytes: Long, val lastAccessedAt: Long, val pinned: Boolean = false, val active: Boolean = false)
object ResourceRetentionPolicy {
    fun evictions(records: List<ResourceRecord>, maxBytes: Long, maxItems: Int): List<ResourceRecord> {
        require(maxBytes >= 0 && maxItems >= 0)
        var bytes = records.sumOf(ResourceRecord::bytes)
        var count = records.size
        val result = mutableListOf<ResourceRecord>()
        records.asSequence().filterNot { it.pinned || it.active }
            .sortedWith(compareBy<ResourceRecord> { it.lastAccessedAt }.thenBy { it.id }).forEach { record ->
                if (bytes > maxBytes || count > maxItems) {
                    result += record
                    bytes -= record.bytes
                    count--
                }
            }
        return result
    }
}

enum class ThermalLevel { NORMAL, MODERATE, SEVERE, CRITICAL }
enum class ConstraintDecision { RUN, PAUSE, OFFER_HANDOFF, REQUIRE_FOREGROUND }
data class DeviceConstraints(
    val batteryPercent: Int, val charging: Boolean, val thermal: ThermalLevel,
    val lowMemory: Boolean, val appInForeground: Boolean,
)
object DeviceConstraintPolicy {
    fun decide(value: DeviceConstraints, estimatedLongRunning: Boolean): ConstraintDecision = when {
        value.thermal == ThermalLevel.CRITICAL || value.lowMemory -> ConstraintDecision.PAUSE
        estimatedLongRunning && value.thermal >= ThermalLevel.SEVERE -> ConstraintDecision.OFFER_HANDOFF
        estimatedLongRunning && value.batteryPercent < 15 && !value.charging -> ConstraintDecision.OFFER_HANDOFF
        estimatedLongRunning && !value.appInForeground -> ConstraintDecision.REQUIRE_FOREGROUND
        else -> ConstraintDecision.RUN
    }
}

data class RuntimeResourceDecision(
    val maxParallelAgents: Int, val releaseRuntimeWhenIdle: Boolean, val route: String, val reason: String,
)
object RuntimeResourcePolicy {
    fun decide(value: DeviceConstraints, memoryClassMb: Int, artifactBytes: Long): RuntimeResourceDecision = when {
        artifactBytes > 64L * 1024 * 1024 -> RuntimeResourceDecision(0, true, "full_runtime_blocked", "resource_artifact_limit")
        value.lowMemory || memoryClassMb < 192 -> RuntimeResourceDecision(0, true, "full_runtime_blocked", "resource_low_memory")
        value.thermal >= ThermalLevel.SEVERE -> RuntimeResourceDecision(1, true, "remote_full_offer", "resource_thermal")
        else -> RuntimeResourceDecision(2, true, "python_local", "resource_healthy")
    }
}

data class DiagnosticBundle(
    val errorCode: String, val requestId: String?, val runId: WorkbenchId?,
    val authority: RuntimeAuthority?, val details: String,
)
object DiagnosticBundleFactory {
    fun create(
        error: ClassifiedFailure, requestId: String?, runId: WorkbenchId?,
        authority: RuntimeAuthority?, rawDetails: String,
    ) = DiagnosticBundle(error.code, requestId?.take(100), runId, authority, sanitize(rawDetails))

    private fun sanitize(value: String) = SensitiveDataRedactor.redact(value)
        .replace(Regex("(?i)https?://\\S+"), "[URI]")
        .replace(Regex("(?:[A-Za-z]:\\\\|/)(?:[^\\s]+[/\\\\])+[^\\s]+"), "[PATH]")
        .take(4_000)
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
    fun uniqueWorkName(subject: String, runId: WorkbenchId): String =
        "opendrsai-run-${subject.hashCode().toUInt().toString(16)}-${runId.value}"
}
