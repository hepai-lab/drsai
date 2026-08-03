package ai.drsai.remote.runtime.python

import java.util.ArrayDeque
import java.util.Base64
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONArray
import org.json.JSONObject

private data class ModelHostOutcome(
    val subagentId: String?,
    val deltas: List<String>,
    val finishReason: String?,
    val toolCalls: JSONArray,
)

/** Drives Python Core requests through Android-owned host adapters. */
class PythonAgentLoopCoordinator(
    private val bridge: PythonRuntimeBridge,
    private val ports: PythonRuntimeHostPorts,
    private val maxHostSteps: Int = 64,
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val onSideEffectEvidence: () -> Unit = {},
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
        val lifecycleState = ports.lifecycle.current()
        val maxSubagentParallel = if (lifecycleState == PythonRuntimeLifecycleState.FOREGROUND) 2 else 1

        suspend fun send(command: PythonRuntimeEnvelope) {
            hostSteps += 1
            check(hostSteps <= maxHostSteps) { "python_runtime_host_step_limit" }
            val result = bridge.execute(command)
            check(result.decision == MailboxDecision.ACCEPTED) { "python_runtime_bridge_${result.code}" }
            check(result.status == "python_runtime_ready") { "python_runtime_unavailable" }
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
            )
            val deltas = mutableListOf<String>()
            var finishReason: String? = null
            var toolCalls = JSONArray()
            ports.model.stream(request).collect { chunk ->
                if (chunk.delta.isNotEmpty()) deltas += chunk.delta
                if (chunk.finishReason != null) finishReason = chunk.finishReason
                if (chunk.toolCalls.length() > 0) toolCalls = chunk.toolCalls
            }
            return ModelHostOutcome(
                payload.optString("subagent_id").ifBlank { null }, deltas, finishReason, toolCalls,
            )
        }

        suspend fun deliverModel(outcome: ModelHostOutcome) {
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
            send(
                response(
                    PythonRuntimeMessageType.MODEL_COMPLETED,
                    JSONObject()
                        .put("content", outcome.deltas.joinToString(""))
                        .put("finish_reason", outcome.finishReason)
                        .put("tool_calls", outcome.toolCalls)
                        .apply { if (outcome.subagentId != null) put("subagent_id", outcome.subagentId) },
                    "model_completed",
                )
            )
        }

        start.payload.put("lifecycle_state", lifecycleState.name.lowercase())
            .put("subagent_max_active", 3)
            .put("subagent_max_parallel", maxSubagentParallel)
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
                        val batch = mutableListOf(outbound)
                        while (queue.firstOrNull()?.messageType == PythonRuntimeMessageType.MODEL_REQUEST &&
                            batch.size < maxSubagentParallel
                        ) batch += queue.removeFirst()
                        coroutineScope { batch.map { request -> async { collectModel(request) } }.awaitAll() }
                            .forEach { deliverModel(it) }
                    } else deliverModel(collectModel(outbound))
                }
                PythonRuntimeMessageType.TOOL_CALL_REQUEST -> {
                    val payload = outbound.payload
                    val saved = ports.stateStore.loadCheckpoint(start.runId)
                    val approvedCalls = saved?.state?.optJSONObject("_host_approved_calls") ?: JSONObject()
                    val call = HostToolCall(
                        callId = payload.getString("call_id"),
                        name = payload.getString("name"),
                        arguments = payload.getJSONObject("arguments"),
                        idempotencyKey = outbound.idempotencyKey,
                        approved = approvedCalls.optBoolean(payload.getString("call_id"), false),
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
                            ports.stateStore.saveCheckpoint(
                                HostCheckpoint(
                                    start.runId,
                                    maxOf(saved?.sequence ?: 0, outbound.sequence),
                                    JSONObject().put("_host_tool_intents", intents),
                                )
                            )
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
                                    .put("status", "executing"),
                            )
                            ports.stateStore.saveCheckpoint(
                                HostCheckpoint(
                                    start.runId,
                                    maxOf(saved?.sequence ?: 0, outbound.sequence),
                                    JSONObject().put("_host_tool_intents", intents),
                                )
                            )
                            audit(call.callId, "tool", "execution", "started")
                            ports.tools.execute(call).also { executed ->
                            receipts.put(call.callId, executed.toJson())
                            intents.put(call.callId, intents.getJSONObject(call.callId).put("status", "receipt_persisted"))
                            ports.stateStore.saveCheckpoint(
                                HostCheckpoint(
                                    start.runId,
                                    maxOf(saved?.sequence ?: 0, outbound.sequence),
                                    JSONObject()
                                        .put("_host_tool_intents", intents)
                                        .put("_host_tool_results", receipts),
                                )
                            )
                            audit(call.callId, "tool", "receipt", if (executed.succeeded) "succeeded" else "failed")
                        }
                        }
                    send(
                        response(
                            PythonRuntimeMessageType.TOOL_RESULT,
                            JSONObject()
                                .put("call_id", result.callId)
                                .put("succeeded", result.succeeded)
                                .put("content", result.content)
                                .put("error_code", result.errorCode)
                                .put("artifact_ids", JSONArray(result.artifactIds)),
                            "tool_result:${result.callId}",
                        )
                    )
                }
                PythonRuntimeMessageType.APPROVAL_REQUEST -> {
                    val payload = outbound.payload
                    val decision = ports.approval.request(
                        HostApprovalRequest(
                            approvalId = payload.getString("approval_id"),
                            callId = payload.getString("call_id"),
                            risk = payload.getString("risk"),
                            title = payload.getString("title"),
                            summary = payload.getString("summary"),
                            name = payload.getString("name"),
                            arguments = payload.getJSONObject("arguments"),
                        )
                    )
                    audit(payload.getString("approval_id"), "approval", "approval", decision.decision)
                    if (decision.decision == "approved") {
                        val saved = ports.stateStore.loadCheckpoint(start.runId)
                        val approvedCalls = saved?.state?.optJSONObject("_host_approved_calls") ?: JSONObject()
                        approvedCalls.put(payload.getString("call_id"), true)
                        ports.stateStore.saveCheckpoint(
                            HostCheckpoint(
                                start.runId,
                                maxOf(saved?.sequence ?: 0, outbound.sequence),
                                JSONObject().put("_host_approved_calls", approvedCalls),
                            )
                        )
                    }
                    send(
                        response(
                            PythonRuntimeMessageType.APPROVAL_RESULT,
                            JSONObject()
                                .put("approval_id", decision.approvalId)
                                .put("call_id", payload.getString("call_id"))
                                .put("decision", decision.decision),
                            "approval_result:${decision.approvalId}",
                        )
                    )
                }
                PythonRuntimeMessageType.CHECKPOINT_REQUEST -> {
                    ports.stateStore.saveCheckpoint(
                        HostCheckpoint(start.runId, outbound.sequence, outbound.payload.getJSONObject("state"))
                    )
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
                                    ports.stateStore.saveCheckpoint(HostCheckpoint(
                                        start.runId, maxOf(saved?.sequence ?: 0, outbound.sequence),
                                        JSONObject().put("_host_artifact_intents", intents),
                                    ))
                                    audit(operationId, "artifact", "reconciliation", "needs_reconciliation")
                                    error("artifact_needs_reconciliation:$operationId")
                                }
                                audit(operationId, "artifact", "intent", "persisting")
                                intents.put(operationId, JSONObject()
                                    .put("operation_id", operationId).put("operation", operation)
                                    .put("status", "executing"))
                                ports.stateStore.saveCheckpoint(HostCheckpoint(
                                    start.runId, maxOf(saved?.sequence ?: 0, outbound.sequence),
                                    JSONObject().put("_host_artifact_intents", intents),
                                ))
                                audit(operationId, "artifact", "execution", "started")
                                ports.artifacts.mutate(HostArtifactMutation(
                                    operationId, operation, payload.optString("artifact_id").ifBlank { null }, payload,
                                )).also { completed ->
                                    receipts.put(operationId, completed.toJson())
                                    intents.put(operationId, intents.getJSONObject(operationId).put("status", "receipt_persisted"))
                                    ports.stateStore.saveCheckpoint(HostCheckpoint(
                                        start.runId, maxOf(saved?.sequence ?: 0, outbound.sequence),
                                        JSONObject().put("_host_artifact_intents", intents)
                                            .put("_host_artifact_results", receipts),
                                    ))
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
