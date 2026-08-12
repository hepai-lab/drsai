package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import java.util.ArrayDeque
import java.util.Base64
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

private data class ModelHostOutcome(
    val subagentId: String?,
    val deltas: List<String>,
    val finishReason: String?,
    val toolCalls: JSONArray,
    val reasoningSummaries: List<String>,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val errorRetryable: Boolean = false,
    val errorStatus: Int? = null,
)

enum class PythonSideEffectFaultPoint {
    TOOL_INTENT_PERSISTED,
    TOOL_EXECUTION_MARKED,
    TOOL_HANDLER_RETURNED,
    TOOL_RECEIPT_PERSISTED,
    ARTIFACT_INTENT_PERSISTED,
    ARTIFACT_EXECUTION_MARKED,
    ARTIFACT_HANDLER_RETURNED,
    ARTIFACT_RECEIPT_PERSISTED,
    APPROVAL_DECISION_PERSISTED,
}

fun interface PythonSideEffectFaultInjector {
    fun hit(point: PythonSideEffectFaultPoint, operationId: String)
}

/** Drives Python Core requests through Android-owned host adapters. */
class PythonAgentLoopCoordinator(
    private val bridge: PythonRuntimeBridge,
    private val ports: PythonRuntimeHostPorts,
    private val maxHostSteps: Int = 64,
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val onSideEffectEvidence: () -> Unit = {},
    private val faultInjector: PythonSideEffectFaultInjector = PythonSideEffectFaultInjector { _, _ -> },
) {
    init { require(maxHostSteps > 0) { "max_host_steps_invalid" } }

    fun execute(start: PythonRuntimeEnvelope): Flow<PythonRuntimeEnvelope> = flow {
        require(start.messageType in setOf(PythonRuntimeMessageType.START_RUN, PythonRuntimeMessageType.RESUME_RUN)) {
            "start_or_resume_run_required"
        }
        val queue = ArrayDeque<PythonRuntimeEnvelope>()
        var inboundSequence = start.sequence
        var hostSteps = 0
        val auditedOperations = linkedMapOf<String, String>()
        var lifecycleState = ports.lifecycle.current()
        fun maxSubagentParallel() = if (lifecycleState == PythonRuntimeLifecycleState.FOREGROUND) 2 else 1
        val checkpointMutex = Mutex()

        fun mergeHostState(target: JSONObject, source: JSONObject): JSONObject {
            source.keys().forEach { key ->
                if (!key.startsWith("_host_")) return@forEach
                val incoming = source.optJSONObject(key)
                val current = target.optJSONObject(key)
                if (incoming != null && current != null) {
                    incoming.keys().forEach { nested -> current.put(nested, incoming.get(nested)) }
                } else {
                    target.put(key, source.get(key))
                }
            }
            return target
        }

        suspend fun persistHostState(sequence: Long, patch: JSONObject) = checkpointMutex.withLock {
            val saved = ports.stateStore.loadCheckpoint(start.runId)
            val state = saved?.state?.let { JSONObject(it.toString()) } ?: JSONObject()
            ports.stateStore.saveCheckpoint(HostCheckpoint(
                start.runId, maxOf(saved?.sequence ?: 0, sequence), mergeHostState(state, patch),
            ))
        }

        suspend fun persistCoreState(sequence: Long, coreState: JSONObject) = checkpointMutex.withLock {
            val saved = ports.stateStore.loadCheckpoint(start.runId)
            val state = JSONObject(coreState.toString())
            saved?.state?.let { mergeHostState(state, it) }
            ports.stateStore.saveCheckpoint(HostCheckpoint(start.runId, sequence, state))
        }

        suspend fun send(command: PythonRuntimeEnvelope) {
            // Streaming text/reasoning chunks are transport fragments, not agent
            // turns. Counting each token-sized chunk made ordinary long answers
            // exhaust the host-step budget before MODEL_COMPLETED arrived.
            if (command.messageType != PythonRuntimeMessageType.MODEL_CHUNK) {
                hostSteps += 1
                check(hostSteps <= maxHostSteps) { "python_runtime_host_step_limit" }
            }
            val result = bridge.execute(command)
            check(result.decision == MailboxDecision.ACCEPTED) { "python_runtime_bridge_${result.code}" }
            check(result.status == "python_runtime_ready") {
                "python_runtime_unavailable:${command.messageType.wireName}:${result.status ?: "missing_status"}:${result.error ?: result.code}"
            }
            result.outbound.forEach(queue::addLast)
        }

        fun response(type: PythonRuntimeMessageType, payload: JSONObject, suffix: String): PythonRuntimeEnvelope {
            inboundSequence += 1
            return PythonRuntimeEnvelope(
                messageType = type,
                requestId = "${start.runId}:host:$inboundSequence",
                runId = start.runId,
                sessionId = start.sessionId,
                sequence = inboundSequence,
                idempotencyKey = "${start.runId}:host:$inboundSequence:$suffix",
                payload = payload,
            )
        }

        suspend fun audit(operationId: String, kind: String, phase: String, outcome: String) {
            if (phase in setOf("intent", "approval", "execution", "receipt", "replay", "reconciliation")) {
                onSideEffectEvidence()
            }
            if (phase != "terminal") auditedOperations[operationId] = kind
            ports.audit.append(HostSideEffectAudit(start.runId, operationId, kind, phase, outcome))
        }

        suspend fun collectModel(outbound: PythonRuntimeEnvelope): ModelHostOutcome {
            val payload = outbound.payload
            val request = HostModelRequest(
                requestId = outbound.requestId,
                modelId = payload.getString("model_id"),
                messages = payload.getJSONArray("messages"),
                tools = payload.optJSONArray("tools") ?: JSONArray(),
                toolChoice = payload.optJSONObject("tool_choice") ?: JSONObject()
                    .put("policy_version", "p9-tool-choice-v1")
                    .put("mode", "auto"),
                modelRouteSnapshot = payload.optJSONObject("model_route_snapshot"),
            )
            val deltas = mutableListOf<String>()
            var finishReason: String? = null
            var toolCalls = JSONArray()
            val reasoningSummaries = mutableListOf<String>()
            var errorCode: String? = null
            var errorMessage: String? = null
            var errorRetryable = false
            var errorStatus: Int? = null
            try {
                ports.model.stream(request).collect { chunk ->
                    if (chunk.delta.isNotEmpty()) deltas += chunk.delta
                    if (chunk.finishReason != null) finishReason = chunk.finishReason
                    if (chunk.toolCalls.length() > 0) toolCalls = chunk.toolCalls
                    if (chunk.reasoningSummary.isNotEmpty()) reasoningSummaries += chunk.reasoningSummary
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                val name = error::class.simpleName.orEmpty().lowercase()
                val api = error as? ApiException
                errorCode = api?.code?.takeIf(String::isNotBlank)
                    ?: api?.status?.takeIf { it > 0 }?.let { "provider_http_$it" }
                    ?: if ("timeout" in name) "model_timeout" else "model_transport_failed"
                errorMessage = SensitiveDataRedactor.redact(
                    error.message?.trim().orEmpty().ifBlank { errorCode.orEmpty() },
                ).take(1000)
                errorRetryable = api?.retryable ?: ("timeout" in name)
                errorStatus = api?.status?.takeIf { it > 0 }
            }
            return ModelHostOutcome(
                payload.optString("subagent_id").ifBlank { null }, deltas, finishReason, toolCalls,
                reasoningSummaries, errorCode, errorMessage, errorRetryable, errorStatus,
            )
        }

        suspend fun deliverModel(outcome: ModelHostOutcome) {
            if (outcome.errorCode != null) {
                send(response(
                    PythonRuntimeMessageType.MODEL_FAILED,
                    JSONObject().put("code", outcome.errorCode)
                        .put("message", outcome.errorMessage ?: outcome.errorCode)
                        .put("retryable", outcome.errorRetryable)
                        .apply { if (outcome.errorStatus != null) put("status", outcome.errorStatus) }
                        .apply { if (outcome.subagentId != null) put("subagent_id", outcome.subagentId) },
                    "model_failed",
                ))
                return
            }
            outcome.deltas.forEach { delta ->
                send(
                    response(
                        PythonRuntimeMessageType.MODEL_CHUNK,
                        JSONObject().put("delta", delta).apply {
                            if (outcome.subagentId != null) put("subagent_id", outcome.subagentId)
                        },
                        "model_chunk",
                    )
                )
            }
            outcome.reasoningSummaries.forEach { summary ->
                send(response(
                    PythonRuntimeMessageType.MODEL_CHUNK,
                    JSONObject().put("reasoning_summary", summary),
                    "reasoning_summary",
                ))
            }
            send(
                response(
                    PythonRuntimeMessageType.MODEL_COMPLETED,
                    JSONObject()
                        .put("content", outcome.deltas.joinToString(""))
                        .put("finish_reason", outcome.finishReason)
                        .put("tool_calls", outcome.toolCalls)
                        .put("reasoning_summary", outcome.reasoningSummaries.joinToString(""))
                        .apply { if (outcome.subagentId != null) put("subagent_id", outcome.subagentId) },
                    "model_completed",
                )
            )
        }

        start.payload.put("lifecycle_state", lifecycleState.name.lowercase())
            .put("subagent_max_active", 3)
            .put("subagent_max_parallel", maxSubagentParallel())
        try {
        send(start)
        while (queue.isNotEmpty()) {
            val outbound = queue.removeFirst()
            when (outbound.messageType) {
                PythonRuntimeMessageType.RUNTIME_EVENT -> {
                    val eventKind = outbound.payload.optString("kind")
                    if (eventKind in setOf("run.completed", "run.cancelled", "run.failed")) {
                        auditedOperations.toMap().forEach { (operationId, kind) ->
                            audit(operationId, kind, "terminal", eventKind.removePrefix("run."))
                        }
                    }
                    emit(outbound)
                }
                PythonRuntimeMessageType.MODEL_REQUEST -> {
                    if (outbound.payload.optString("subagent_id").isNotBlank()) {
                        val currentLifecycle = ports.lifecycle.current()
                        if (currentLifecycle != lifecycleState) {
                            lifecycleState = currentLifecycle
                            send(response(
                                PythonRuntimeMessageType.LIFECYCLE_CHANGED,
                                JSONObject().put("state", lifecycleState.name.lowercase()),
                                "lifecycle_changed:${lifecycleState.name.lowercase()}",
                            ))
                        }
                        val parallelLimit = maxSubagentParallel()
                        val batch = mutableListOf(outbound)
                        while (queue.firstOrNull()?.messageType == PythonRuntimeMessageType.MODEL_REQUEST &&
                            queue.firstOrNull()?.payload?.optString("subagent_id")?.isNotBlank() == true &&
                            batch.size < parallelLimit
                        ) batch += queue.removeFirst()
                        coroutineScope { batch.map { request -> async { collectModel(request) } }.awaitAll() }
                            .forEach { deliverModel(it) }
                    } else deliverModel(collectModel(outbound))
                }
                PythonRuntimeMessageType.TOOL_CALL_REQUEST -> {
                    val payload = outbound.payload
                    val saved = ports.stateStore.loadCheckpoint(start.runId)
                    val approvedCalls = saved?.state?.optJSONObject("_host_approved_calls") ?: JSONObject()
                    val retryPolicy = payload.optJSONObject("retry_policy") ?: JSONObject()
                    val reportedRisk = payload.optString("risk", "sensitive")
                    val authoritativeRisk = ports.tools.authoritativeRisk(payload.getString("name"))
                    require(authoritativeRisk == null || authoritativeRisk == reportedRisk) { "tool_risk_registry_drift" }
                    val risk = authoritativeRisk ?: reportedRisk
                    val maxAttempts = retryPolicy.optInt("max_attempts", 1)
                    require(maxAttempts in 1..2) { "tool_retry_attempts_invalid" }
                    require(maxAttempts == 1 || risk == "read_only") { "tool_side_effect_retry_forbidden" }
                    val retryableCodes = retryPolicy.optJSONArray("retryable_error_codes")
                        ?.let { array -> (0 until array.length()).map(array::getString).toSet() }
                        ?: emptySet()
                    val call = HostToolCall(
                        callId = payload.getString("call_id"),
                        name = payload.getString("name"),
                        arguments = payload.getJSONObject("arguments"),
                        idempotencyKey = outbound.idempotencyKey,
                        approved = approvedCalls.optBoolean(payload.getString("call_id"), false),
                        risk = risk,
                        maxAttempts = maxAttempts,
                        retryableErrorCodes = retryableCodes,
                    )
                    val receipts = saved?.state?.optJSONObject("_host_tool_results") ?: JSONObject()
                    val intents = saved?.state?.optJSONObject("_host_tool_intents") ?: JSONObject()
                    val existingIntent = intents.optJSONObject(call.callId)
                    val durableReceipt = receipts.optJSONObject(call.callId)
                    if (durableReceipt != null) {
                        metrics.duplicateSideEffectBlocked()
                        audit(call.callId, "tool", "replay", "receipt_replayed")
                    }
                    val result = durableReceipt?.toHostToolResult()
                        ?: if (existingIntent?.optString("status") == "executing") {
                            intents.put(call.callId, existingIntent.put("status", "needs_reconciliation"))
                            persistHostState(outbound.sequence, JSONObject().put("_host_tool_intents", intents))
                            audit(call.callId, "tool", "reconciliation", "needs_reconciliation")
                            error("python_tool_needs_reconciliation:${call.callId}")
                        } else {
                            audit(call.callId, "tool", "intent", "persisting")
                            intents.put(
                                call.callId,
                                JSONObject()
                                    .put("call_id", call.callId)
                                    .put("idempotency_key", call.idempotencyKey)
                                    .put("name", call.name)
                                    .put("status", "prepared"),
                            )
                            persistHostState(outbound.sequence, JSONObject().put("_host_tool_intents", intents))
                            faultInjector.hit(PythonSideEffectFaultPoint.TOOL_INTENT_PERSISTED, call.callId)
                            intents.put(call.callId, intents.getJSONObject(call.callId).put("status", "executing"))
                            persistHostState(outbound.sequence, JSONObject().put("_host_tool_intents", intents))
                            faultInjector.hit(PythonSideEffectFaultPoint.TOOL_EXECUTION_MARKED, call.callId)
                            var attempt = 0
                            var executed: HostToolResult
                            do {
                                attempt += 1
                                audit(call.callId, "tool", "execution", "attempt:$attempt")
                                executed = ports.tools.execute(call)
                            } while (
                                !executed.succeeded &&
                                attempt < call.maxAttempts &&
                                executed.errorCode?.lowercase() in call.retryableErrorCodes
                            )
                            faultInjector.hit(PythonSideEffectFaultPoint.TOOL_HANDLER_RETURNED, call.callId)
                            receipts.put(call.callId, executed.toJson())
                            intents.put(call.callId, intents.getJSONObject(call.callId).put("status", "receipt_persisted"))
                            persistHostState(outbound.sequence, JSONObject()
                                .put("_host_tool_intents", intents)
                                .put("_host_tool_results", receipts))
                            faultInjector.hit(PythonSideEffectFaultPoint.TOOL_RECEIPT_PERSISTED, call.callId)
                            audit(call.callId, "tool", "receipt", if (executed.succeeded) "succeeded" else "failed")
                            executed
                        }
                    val artifactRefs = JSONArray()
                    result.artifactIds.distinct().forEach { artifactId ->
                        val descriptor = ports.artifacts.describe(artifactId)
                        require(descriptor.artifactId == artifactId) { "tool_artifact_identity_mismatch" }
                        require(descriptor.size >= 0L) { "tool_artifact_size_invalid" }
                        require(descriptor.sha256.matches(Regex("^[a-fA-F0-9]{64}$"))) { "tool_artifact_digest_invalid" }
                        artifactRefs.put(JSONObject()
                            .put("artifact_id", descriptor.artifactId)
                            .put("mime_type", descriptor.mimeType)
                            .put("size", descriptor.size)
                            .put("sha256", descriptor.sha256.lowercase()))
                    }
                    send(
                        response(
                            PythonRuntimeMessageType.TOOL_RESULT,
                            JSONObject()
                                .put("call_id", result.callId)
                                .put("succeeded", result.succeeded)
                                .put("content", result.content)
                                .put("error_code", result.errorCode)
                                .put("artifact_ids", JSONArray(result.artifactIds))
                                .put("artifacts", artifactRefs),
                            "tool_result:${result.callId}",
                        )
                    )
                }
                PythonRuntimeMessageType.APPROVAL_REQUEST -> {
                    val payload = outbound.payload
                    val approvalId = payload.getString("approval_id")
                    val callId = payload.getString("call_id")
                    val saved = ports.stateStore.loadCheckpoint(start.runId)
                    val durableDecisions = saved?.state?.optJSONObject("_host_approval_results") ?: JSONObject()
                    val existingDecision = durableDecisions.optJSONObject(approvalId)
                    require(existingDecision == null || existingDecision.getString("call_id") == callId) {
                        "approval_replay_binding_mismatch"
                    }
                    val decision = existingDecision?.let {
                        HostApprovalDecision(approvalId, it.getString("decision"))
                    } ?: ports.approval.request(
                        HostApprovalRequest(
                            approvalId = approvalId,
                            callId = callId,
                            risk = payload.getString("risk"),
                            title = payload.getString("title"),
                            summary = payload.getString("summary"),
                            name = payload.getString("name"),
                            arguments = payload.getJSONObject("arguments"),
                        )
                    ).also { completed ->
                        require(completed.approvalId == approvalId) { "approval_result_identity_mismatch" }
                        require(completed.decision in setOf("approved", "rejected")) { "approval_decision_invalid" }
                        durableDecisions.put(approvalId, JSONObject()
                            .put("approval_id", approvalId)
                            .put("call_id", callId)
                            .put("decision", completed.decision))
                        val patch = JSONObject().put("_host_approval_results", durableDecisions)
                        if (completed.decision == "approved") {
                            patch.put("_host_approved_calls", JSONObject().put(callId, true))
                        }
                        persistHostState(outbound.sequence, patch)
                        faultInjector.hit(PythonSideEffectFaultPoint.APPROVAL_DECISION_PERSISTED, approvalId)
                    }
                    audit(approvalId, "approval", "approval", decision.decision)
                    if (decision.decision == "approved") {
                        persistHostState(outbound.sequence, JSONObject().put(
                            "_host_approved_calls", JSONObject().put(callId, true),
                        ))
                    }
                    send(
                        response(
                            PythonRuntimeMessageType.APPROVAL_RESULT,
                            JSONObject()
                                .put("approval_id", decision.approvalId)
                                .put("call_id", callId)
                                .put("decision", decision.decision),
                            "approval_result:${decision.approvalId}",
                        )
                    )
                }
                PythonRuntimeMessageType.CHECKPOINT_REQUEST -> {
                    persistCoreState(outbound.sequence, outbound.payload.getJSONObject("state"))
                }
                PythonRuntimeMessageType.ARTIFACT_REQUEST -> {
                    val payload = outbound.payload
                    when (val operation = payload.getString("operation")) {
                        "describe" -> {
                            val artifactId = payload.getString("artifact_id")
                            val descriptor = ports.artifacts.describe(artifactId)
                            send(
                                response(
                                    PythonRuntimeMessageType.ARTIFACT_RESULT,
                                    JSONObject().put("artifact_id", artifactId).put("operation", operation)
                                        .put("mime_type", descriptor.mimeType).put("size", descriptor.size)
                                        .put("sha256", descriptor.sha256),
                                    "artifact_describe:$artifactId",
                                )
                            )
                        }
                        "read" -> {
                            val artifactId = payload.getString("artifact_id")
                            val offset = payload.getLong("offset")
                            val length = payload.getInt("length")
                            require(offset >= 0 && length in 0..65_536) { "artifact_chunk_invalid" }
                            val bytes = ports.artifacts.readChunk(artifactId, offset, length)
                            check(bytes.size <= length) { "artifact_chunk_oversized" }
                            send(
                                response(
                                    PythonRuntimeMessageType.ARTIFACT_RESULT,
                                    JSONObject().put("artifact_id", artifactId).put("operation", operation)
                                        .put("offset", offset)
                                        .put("data_base64", Base64.getEncoder().encodeToString(bytes)),
                                    "artifact_read:$artifactId:$offset",
                                )
                            )
                        }
                        "create", "write", "share" -> {
                            val operationId = payload.getString("operation_id")
                            require(operationId.isNotBlank()) { "artifact_operation_id_required" }
                            val saved = ports.stateStore.loadCheckpoint(start.runId)
                            val intents = saved?.state?.optJSONObject("_host_artifact_intents") ?: JSONObject()
                            val receipts = saved?.state?.optJSONObject("_host_artifact_results") ?: JSONObject()
                            val existing = receipts.optJSONObject(operationId)
                            if (existing != null) audit(operationId, "artifact", "replay", "receipt_replayed")
                            val result = if (existing != null) existing.toHostArtifactMutationResult() else {
                                val intent = intents.optJSONObject(operationId)
                                if (intent?.optString("status") == "executing") {
                                    intents.put(operationId, intent.put("status", "needs_reconciliation"))
                                    persistHostState(outbound.sequence, JSONObject().put("_host_artifact_intents", intents))
                                    audit(operationId, "artifact", "reconciliation", "needs_reconciliation")
                                    error("artifact_needs_reconciliation:$operationId")
                                }
                                audit(operationId, "artifact", "intent", "persisting")
                                intents.put(operationId, JSONObject()
                                    .put("operation_id", operationId).put("operation", operation)
                                    .put("status", "prepared"))
                                persistHostState(outbound.sequence, JSONObject().put("_host_artifact_intents", intents))
                                faultInjector.hit(PythonSideEffectFaultPoint.ARTIFACT_INTENT_PERSISTED, operationId)
                                intents.put(operationId, intents.getJSONObject(operationId).put("status", "executing"))
                                persistHostState(outbound.sequence, JSONObject().put("_host_artifact_intents", intents))
                                faultInjector.hit(PythonSideEffectFaultPoint.ARTIFACT_EXECUTION_MARKED, operationId)
                                audit(operationId, "artifact", "execution", "started")
                                ports.artifacts.mutate(HostArtifactMutation(
                                    operationId, operation, payload.optString("artifact_id").ifBlank { null }, payload,
                                )).also { completed ->
                                    faultInjector.hit(PythonSideEffectFaultPoint.ARTIFACT_HANDLER_RETURNED, operationId)
                                    receipts.put(operationId, completed.toJson())
                                    intents.put(operationId, intents.getJSONObject(operationId).put("status", "receipt_persisted"))
                                    persistHostState(outbound.sequence, JSONObject()
                                        .put("_host_artifact_intents", intents)
                                        .put("_host_artifact_results", receipts))
                                    faultInjector.hit(PythonSideEffectFaultPoint.ARTIFACT_RECEIPT_PERSISTED, operationId)
                                    audit(operationId, "artifact", "receipt", if (completed.succeeded) "succeeded" else "failed")
                                }
                            }
                            send(response(
                                PythonRuntimeMessageType.ARTIFACT_RESULT,
                                result.toJson().put("operation", operation),
                                "artifact_mutation:$operationId",
                            ))
                        }
                        else -> error("artifact_operation_invalid:$operation")
                    }
                }
                else -> error("python_runtime_outbound_type_invalid:${outbound.messageType.wireName}")
            }
        }
        } finally {
            // Terminal runtime events are outbound from Python and therefore do not pass
            // through PythonRuntimeMailbox.submit(). Always release the bridge-side
            // single-flight lease when this host loop exits, including normal completion.
            runCatching { bridge.releaseSessionRun(start.sessionId, start.runId) }
        }
    }
}

private fun HostToolResult.toJson() = JSONObject()
    .put("call_id", callId)
    .put("succeeded", succeeded)
    .put("content", content)
    .put("error_code", errorCode)
    .put("artifact_ids", JSONArray(artifactIds))

private fun JSONObject.toHostToolResult() = HostToolResult(
    callId = getString("call_id"),
    succeeded = getBoolean("succeeded"),
    content = getJSONObject("content"),
    errorCode = optString("error_code").ifBlank { null },
    artifactIds = optJSONArray("artifact_ids")?.let { values ->
        buildList { repeat(values.length()) { add(values.getString(it)) } }
    }.orEmpty(),
)

private fun HostArtifactMutationResult.toJson() = JSONObject()
    .put("operation_id", operationId)
    .put("artifact_id", artifactId)
    .put("succeeded", succeeded)
    .put("details", details)

private fun JSONObject.toHostArtifactMutationResult() = HostArtifactMutationResult(
    operationId = getString("operation_id"),
    artifactId = getString("artifact_id"),
    succeeded = getBoolean("succeeded"),
    details = optJSONObject("details") ?: JSONObject(),
)
