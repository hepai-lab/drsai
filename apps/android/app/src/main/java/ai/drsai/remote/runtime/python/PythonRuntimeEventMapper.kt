package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepError
import ai.drsai.remote.remote.generated.OaepFileChangeContent
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepReasoningContent
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.OaepDiagnosticMetadata
import org.json.JSONObject

object PythonRuntimeEventMapper {
    /** Compatibility projection. New persistence and UI code must consume [decode]. */
    fun map(envelope: PythonRuntimeEnvelope): RuntimeEvent? {
        return when (val event = decode(envelope)) {
            null -> null
            NormalizedAgentEvent.RunStarted -> RuntimeEvent.Started(envelope.runId)
            is NormalizedAgentEvent.ItemDelta -> if (event.kind == "text") RuntimeEvent.TextDelta(event.text) else null
            is NormalizedAgentEvent.ItemCreated -> null
            is NormalizedAgentEvent.ItemStarted -> when (val content = event.content) {
                is OaepToolCallContent -> RuntimeEvent.ToolStarted(content.toolName)
                else -> null
            }
            is NormalizedAgentEvent.ItemCompleted -> when (val content = event.content) {
                is OaepToolCallContent -> RuntimeEvent.ToolFinished(content.toolName)
                else -> null
            }
            is NormalizedAgentEvent.ItemFailed -> when (val content = event.content) {
                is OaepToolCallContent -> RuntimeEvent.ToolFailed(content.toolName, event.error.code)
                else -> RuntimeEvent.Failed(event.error.message, event.error.retryable)
            }
            NormalizedAgentEvent.RunCompleted -> RuntimeEvent.Completed
            NormalizedAgentEvent.RunCancelled -> RuntimeEvent.Cancelled
            is NormalizedAgentEvent.RunFailed -> RuntimeEvent.Failed(event.error.message, event.error.retryable)
            is NormalizedAgentEvent.RunWaiting -> RuntimeEvent.Paused
            NormalizedAgentEvent.RunResumed,
            is NormalizedAgentEvent.ItemUpdated,
            is NormalizedAgentEvent.ItemCancelled -> null
        }
    }

    fun decode(envelope: PythonRuntimeEnvelope): NormalizedAgentEvent? = decodeAll(envelope).firstOrNull()

    fun decodeAll(envelope: PythonRuntimeEnvelope): List<NormalizedAgentEvent> {
        val primary = decodeOne(envelope) ?: return emptyList()
        return when (envelope.payload.getString("kind")) {
            "run.started" -> {
                val diagnostic = envelope.payload.optJSONObject("capability_diagnostics")
                val events = mutableListOf(primary)
                if (diagnostic != null) events += NormalizedAgentEvent.ItemCompleted(
                        "${envelope.runId}:notice:capabilities",
                        "notice",
                        OaepNoticeContent(
                            "info",
                            "run_capability_snapshot",
                            "Run capability snapshot frozen",
                            details = mapOf(
                                "snapshot_version" to envelope.payload.optString("capability_snapshot_version"),
                                "snapshot_sha256" to envelope.payload.optString("capability_snapshot_sha256"),
                                "available" to diagnostic.optJSONArray("available")?.strings().orEmpty(),
                                "remote_required" to diagnostic.optJSONArray("remote_required")?.strings().orEmpty(),
                                "unsupported" to diagnostic.optJSONArray("unsupported")?.strings().orEmpty(),
                                "blocked" to diagnostic.optJSONArray("blocked")?.objects()?.map(::jsonMap).orEmpty(),
                            ),
                        ),
                    )
                val promptLayers = envelope.payload.optJSONArray("prompt_layers")?.objects()?.map(::promptLayerDiagnostic).orEmpty()
                if (promptLayers.isNotEmpty()) events += NormalizedAgentEvent.ItemCompleted(
                    "${envelope.runId}:notice:prompt-layers",
                    "notice",
                    OaepNoticeContent(
                        "info", "prompt_layer_snapshot", "Prompt layer snapshot frozen",
                        details = mapOf("layers" to promptLayers),
                    ),
                )
                envelope.payload.optJSONObject("context_observability")?.let { diagnostic ->
                    events += NormalizedAgentEvent.ItemCompleted(
                        "${envelope.runId}:notice:context-observability",
                        "notice",
                        OaepNoticeContent(
                            "info", "context_observability_snapshot", "Context budget and trimming snapshot frozen",
                            details = contextObservabilityDiagnostic(diagnostic),
                        ),
                    )
                }
                envelope.payload.optJSONObject("memory_selection")?.let { selection ->
                    events += NormalizedAgentEvent.ItemCompleted(
                        "${envelope.runId}:notice:memory-selection",
                        "notice",
                        OaepNoticeContent(
                            "info", "memory_selection_snapshot", "Relevant memory selection frozen",
                            details = mapOf(
                                "policy_version" to selection.optString("policy_version"),
                                "sha256" to selection.optString("sha256"),
                                "selected" to selection.optJSONArray("selected")?.objects()?.map { item -> mapOf(
                                    "id" to item.optString("id"),
                                    "score" to item.optInt("score"),
                                    "sha256" to item.optString("sha256"),
                                ) }.orEmpty(),
                                "omitted" to selection.optJSONArray("omitted")?.objects()?.map { item -> mapOf(
                                    "id" to item.optString("id"),
                                    "reason" to item.optString("reason"),
                                    "sha256" to item.optString("sha256"),
                                ) }.orEmpty(),
                            ),
                        ),
                    )
                }
                val skills = envelope.payload.optJSONArray("skill_snapshot")?.objects()?.map(::skillDiagnostic).orEmpty()
                if (skills.isNotEmpty()) events += NormalizedAgentEvent.ItemCompleted(
                    "${envelope.runId}:notice:skills",
                    "notice",
                    OaepNoticeContent(
                        "info", "skill_manifest_snapshot", "Run skill manifest frozen",
                        details = mapOf("skills" to skills, "count" to skills.size),
                    ),
                )
                events
            }
            "run.recovered" -> listOf(primary, NormalizedAgentEvent.RunResumed)
            "approval.requested", "side_effect.reconciliation_required" -> listOf(
                primary,
                NormalizedAgentEvent.RunWaiting(
                    if (envelope.payload.getString("kind") == "approval.requested") "approval" else "side_effect_reconciliation",
                    (primary as NormalizedAgentEvent.ItemCreated).itemId,
                ),
            )
            "approval.decided" -> if (envelope.payload.optString("decision") == "approved") {
                listOf(primary, NormalizedAgentEvent.RunResumed)
            } else listOf(primary)
            else -> listOf(primary)
        }
    }

    private fun promptLayerDiagnostic(value: JSONObject): Map<String, Any?> = mapOf(
        "id" to value.optString("id").take(80),
        "source" to safeSource(value.optString("source")),
        "chars" to value.optInt("chars").coerceAtLeast(0),
        "estimated_tokens" to value.optInt("estimated_tokens").coerceAtLeast(0),
        "sha256" to value.optString("sha256").takeIf { it.matches(Regex("[0-9a-f]{64}")) }.orEmpty(),
        "status" to value.optString("status").takeIf { it in setOf("applied", "absent") }.orEmpty(),
        "trim_reason" to value.optString("trim_reason").takeIf {
            it in setOf("none", "not_configured", "token_or_message_budget")
        }.orEmpty(),
    )

    private fun contextObservabilityDiagnostic(value: JSONObject): Map<String, Any?> {
        val context = value.optJSONObject("context") ?: JSONObject()
        return mapOf(
            "schema_version" to value.optInt("schema_version", 1),
            "layers" to value.optJSONArray("layers")?.objects()?.map(::promptLayerDiagnostic).orEmpty(),
            "policy_version" to context.optString("policy_version").take(64),
            "policy_sha256" to context.optString("sha256").takeIf { it.matches(Regex("[0-9a-f]{64}")) }.orEmpty(),
            "context_window_tokens" to context.optInt("context_window_tokens").coerceAtLeast(0),
            "reserved_output_tokens" to context.optInt("reserved_output_tokens").coerceAtLeast(0),
            "input_token_limit" to context.optInt("input_tokens").coerceAtLeast(0),
            "estimated_input_tokens" to context.optInt("estimated_input_tokens").coerceAtLeast(0),
            "remaining_input_tokens" to context.optInt("remaining_input_tokens").coerceAtLeast(0),
            "history_message_count" to value.optInt("history_message_count").coerceAtLeast(0),
            "included_history_messages" to value.optInt("included_history_messages").coerceAtLeast(0),
            "omitted_history_messages" to value.optInt("omitted_history_messages").coerceAtLeast(0),
            "summary_applied" to value.optBoolean("summary_applied"),
            "trim_reason" to value.optString("trim_reason").takeIf {
                it in setOf("none", "token_or_message_budget")
            }.orEmpty(),
        )
    }

    private fun safeSource(value: String): String = value.takeIf { source ->
        source.length <= 80 && !source.startsWith("/") && !source.startsWith("\\") &&
            !source.matches(Regex("^[A-Za-z]:[\\\\/].*")) && ".." !in source
    }.orEmpty()

    private fun skillDiagnostic(value: JSONObject): Map<String, Any?> = mapOf(
        "id" to value.optString("id").take(100),
        "version" to value.optInt("version").coerceAtLeast(0),
        "source" to value.optString("source").takeIf {
            it in setOf("built_in", "user_declarative", "platform", "remote_read_only")
        }.orEmpty(),
        "availability" to value.optString("availability").takeIf {
            it in setOf("local", "remote-required", "unsupported")
        }.orEmpty(),
        "digest" to value.optString("digest").takeIf { it.matches(Regex("[0-9a-f]{64}")) }.orEmpty(),
        "instructions_sha256" to value.optString("instructions_sha256").takeIf {
            it.matches(Regex("[0-9a-f]{64}"))
        }.orEmpty(),
        "allowed_tool_count" to value.optJSONArray("allowed_tools")?.length().orZero(),
        "required_capabilities" to value.optJSONArray("required_capabilities")?.strings().orEmpty(),
    )

    private fun Int?.orZero(): Int = this ?: 0

    private fun decodeOne(envelope: PythonRuntimeEnvelope): NormalizedAgentEvent? {
        require(envelope.messageType == PythonRuntimeMessageType.RUNTIME_EVENT) { "runtime_event_required" }
        val payload = envelope.payload
        return when (payload.getString("kind")) {
            "run.started" -> NormalizedAgentEvent.RunStarted
            "run.recovered" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:recovered:${envelope.sequence}"),
                "notice",
                OaepNoticeContent(
                    "info", "runtime_recovered", "Android Agent Runtime recovered from durable checkpoint",
                    details = mapOf("phase" to payload.optString("phase", "unknown").take(64)),
                ),
            )
            "message.delta" -> NormalizedAgentEvent.ItemDelta(
                payload.optString("item_id", "${envelope.runId}:assistant"), "text", payload.optString("text"), "message",
            )
            "message.completed" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:assistant"),
                "message",
                OaepMessageContent(
                    payload.optString("role", "assistant"), payload.optString("text"),
                    payload.optString("phase", "final"),
                    payload.optJSONArray("citations")?.objects()?.map(::jsonMap).orEmpty(),
                    payload.optJSONArray("parts")?.objects()?.map(::jsonMap).orEmpty(),
                ),
            )
            "reasoning.delta" -> NormalizedAgentEvent.ItemDelta(
                payload.optString("item_id", "${envelope.runId}:reasoning"), "reasoning",
                payload.getString("text"), "reasoning",
            )
            "reasoning.completed" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:reasoning"), "reasoning",
                OaepReasoningContent(reasoningSegments(payload)),
            )
            "plan.started", "plan.updated" -> NormalizedAgentEvent.ItemUpdated(
                payload.optString("item_id", "${envelope.runId}:plan"), "plan", planContent(payload),
                if (payload.getString("kind") == "plan.started") "running" else payload.optString("status", "running"),
            )
            "plan.completed" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:plan"), "plan", planContent(payload),
            )
            "plan.failed" -> NormalizedAgentEvent.ItemFailed(
                payload.optString("item_id", "${envelope.runId}:plan"), "plan", planContent(payload),
                error(payload, "plan_step_failed"),
            )
            "command.started" -> NormalizedAgentEvent.ItemStarted(
                payload.getString("item_id"), "command_execution", commandContent(payload),
            )
            "command.delta" -> NormalizedAgentEvent.ItemDelta(
                payload.getString("item_id"), payload.optString("stream", "combined"),
                payload.getString("text"), "command_execution",
            )
            "command.completed" -> NormalizedAgentEvent.ItemCompleted(
                payload.getString("item_id"), "command_execution", commandContent(payload),
            )
            "command.error" -> NormalizedAgentEvent.ItemFailed(
                payload.getString("item_id"), "command_execution", commandContent(payload), error(payload, "command_failed"),
            )
            "file_change.completed" -> NormalizedAgentEvent.ItemCompleted(
                payload.getString("item_id"), "file_change",
                OaepFileChangeContent(
                    payload.getJSONArray("changes").objects().map(::jsonMap), payload.optString("summary"),
                ),
            )
            "tool.started" -> NormalizedAgentEvent.ItemStarted(
                payload.optString("item_id", "${envelope.runId}:tool:${payload.getString("name")}"),
                "tool_call",
                toolContent(payload, result = null),
            )
            "tool.result" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:tool:${payload.getString("name")}"),
                "tool_call",
                toolContent(payload, result = payload.opt("result")),
            )
            "tool.error" -> NormalizedAgentEvent.ItemFailed(
                payload.optString("item_id", "${envelope.runId}:tool:${payload.getString("name")}"),
                "tool_call",
                toolContent(payload, result = payload.opt("result")),
                error(payload, "tool_failed"),
            )
            "tool.downgraded" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:tool-downgraded"),
                "notice",
                OaepNoticeContent("warning", "tool_downgraded", payload.getString("reason")),
            )
            "tool.decision" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:tool-decision:${payload.optInt("tool_round_count")}"),
                "notice",
                OaepNoticeContent(
                    level = if (payload.optString("category") in setOf(
                            "required_tool_omitted", "required_tool_unavailable", "wrong_tool_selected",
                        )) {
                        "warning"
                    } else "info",
                    code = "tool_decision",
                    message = "Agent tool decision recorded",
                    details = mapOf(
                        "policy_version" to payload.optString("policy_version"),
                        "requirement_sha256" to payload.optString("requirement_sha256"),
                        "category" to payload.optString("category"),
                        "reason" to payload.optString("reason"),
                        "required_domain_count" to payload.optInt("required_domain_count"),
                        "available_domain_count" to payload.optInt("available_domain_count"),
                        "selected_tool_count" to payload.optInt("selected_tool_count"),
                        "tool_round_count" to payload.optInt("tool_round_count"),
                    ),
                ),
            )
            "verification.required", "verification.unavailable" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:${payload.getString("kind").replace('.', '-')}:${envelope.sequence}"),
                "notice",
                OaepNoticeContent(
                    level = "warning",
                    code = payload.getString("kind").replace('.', '_'),
                    message = if (payload.getString("kind") == "verification.required") {
                        "Verification tool use is required before answering"
                    } else "Required verification capability is unavailable on this runtime",
                    details = mapOf(
                        "code" to payload.optString("code"),
                        "reason" to payload.optString("reason"),
                        "requirement_sha256" to payload.optString("requirement_sha256"),
                        "retry_count" to payload.optInt("retry_count", 0),
                    ),
                ),
            )
            "citation.required", "citation.verified" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:${payload.getString("kind").replace('.', '-')}:${envelope.sequence}"),
                "notice",
                OaepNoticeContent(
                    level = if (payload.getString("kind") == "citation.required") "warning" else "info",
                    code = payload.getString("kind").replace('.', '_'),
                    message = if (payload.getString("kind") == "citation.required") {
                        "Answer citations must match retrieved source URLs"
                    } else "Answer citations verified against retrieval receipts",
                    details = mapOf(
                        "citation_sha256" to payload.optString("citation_sha256"),
                        "source_call_ids" to payload.optJSONArray("source_call_ids")?.strings().orEmpty(),
                        "source_url_sha256" to payload.optJSONArray("source_url_sha256")?.strings().orEmpty(),
                        "cited_url_sha256" to payload.optJSONArray("cited_url_sha256")?.strings().orEmpty(),
                        "missing" to payload.optBoolean("missing", false),
                        "fabricated_count" to payload.optInt("fabricated_count", 0),
                        "retry_count" to payload.optInt("retry_count", 0),
                    ),
                ),
            )
            "runtime.degraded", "runtime.lifecycle_changed" -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:${envelope.sequence}"),
                "notice",
                OaepNoticeContent(
                    level = "warning",
                    code = payload.getString("kind").replace('.', '_'),
                    message = payload.optString("reason", payload.optString("state", "Runtime capability changed")),
                    details = mapOf("max_parallel_agents" to payload.optInt("max_parallel_agents", 1)),
                ),
            )
            "subagent.started" -> {
                val id = payload.getString("subagent_id")
                NormalizedAgentEvent.ItemStarted(
                    payload.optString("item_id", "${envelope.runId}:subtask:$id"), "subtask",
                    OaepSubtaskContent(
                        title = payload.optString("title", "Delegated task"),
                        summary = payload.optString("summary"), agentName = payload.optString("agent_name").takeIf(String::isNotBlank),
                        childRunId = payload.optString("child_run_id").takeIf(String::isNotBlank),
                    ),
                )
            }
            "subagent.thinking" -> {
                val id = payload.getString("subagent_id")
                NormalizedAgentEvent.ItemDelta(
                    payload.optString("item_id", "${envelope.runId}:subtask:$id"), "summary", payload.optString("text"),
                )
            }
            "subagent.completed" -> {
                val id = payload.getString("subagent_id")
                NormalizedAgentEvent.ItemCompleted(
                    payload.optString("item_id", "${envelope.runId}:subtask:$id"), "subtask",
                    OaepSubtaskContent(
                        title = payload.optString("title", "Delegated task"),
                        summary = payload.optString("summary"), agentName = payload.optString("agent_name").takeIf(String::isNotBlank),
                        childRunId = payload.optString("child_run_id").takeIf(String::isNotBlank),
                        result = payload.opt("result"),
                    ),
                )
            }
            "subagent.cancelled" -> {
                val id = payload.getString("subagent_id")
                NormalizedAgentEvent.ItemCancelled(
                    payload.optString("item_id", "${envelope.runId}:subtask:$id"), "subtask",
                    OaepSubtaskContent(payload.optString("title", "Delegated task"), payload.optString("summary", "Cancelled")),
                )
            }
            "subagent.failed" -> {
                val id = payload.getString("subagent_id")
                val code = payload.optString("code", "subagent_failed")
                NormalizedAgentEvent.ItemFailed(
                    payload.optString("item_id", "${envelope.runId}:subtask:$id"), "subtask",
                    OaepSubtaskContent(
                        title = payload.optString("title", "Delegated task"),
                        summary = payload.optString("summary", "Subagent failed"),
                        agentName = payload.optString("agent_name").takeIf(String::isNotBlank),
                        childRunId = payload.optString("child_run_id").takeIf(String::isNotBlank),
                        result = mapOf("parent_run_id" to payload.optString("parent_run_id"), "status" to "failed"),
                    ),
                    OaepError(code, payload.optString("summary", code), payload.optBoolean("retryable", false)),
                )
            }
            "artifact.created" -> NormalizedAgentEvent.ItemCompleted(
                payload.getString("item_id"), "artifact",
                OaepArtifactContent(
                    artifactId = payload.getString("artifact_id"),
                    artifactType = payload.optString("artifact_type", "file"),
                    name = payload.getString("name"),
                    summary = payload.optString("summary"),
                    path = payload.optString("path").takeIf(String::isNotBlank),
                    mimeType = payload.optString("mime_type").takeIf(String::isNotBlank),
                    size = payload.optLong("size", -1).takeIf { it >= 0 },
                    sha256 = payload.optString("sha256").takeIf(String::isNotBlank),
                    previewable = payload.optBoolean("previewable", false),
                    downloadable = payload.optBoolean("downloadable", false),
                ),
            )
            "approval.requested" -> {
                val approvalId = payload.optString("approval_id").ifBlank { payload.getString("call_id") }
                val itemId = payload.optString("item_id", "${envelope.runId}:interaction:$approvalId")
                NormalizedAgentEvent.ItemCreated(
                    itemId, "interaction",
                    OaepInteractionContent(
                        interactionType = "approval",
                        prompt = payload.optString("prompt", "Approval required"),
                        options = listOf(
                            mapOf("id" to "accept", "label" to "Allow"),
                            mapOf("id" to "decline", "label" to "Decline"),
                        ),
                        approvalId = approvalId,
                        operation = payload.optString("operation").takeIf(String::isNotBlank),
                    ), status = "waiting",
                )
            }
            "side_effect.reconciliation_required" -> {
                val operationId = payload.getString("operation_id")
                NormalizedAgentEvent.ItemCreated(
                    payload.optString("item_id", "${envelope.runId}:reconciliation:$operationId"),
                    "interaction",
                    OaepInteractionContent(
                        interactionType = "reconciliation",
                        prompt = payload.optString("prompt", "Confirm the external operation result before continuing"),
                        options = listOf(
                            mapOf("id" to "completed", "label" to "Operation completed"),
                            mapOf("id" to "retry", "label" to "Retry safely"),
                            mapOf("id" to "cancel", "label" to "Cancel run"),
                        ),
                        operation = payload.optString("operation", "side_effect.reconcile"),
                        requestSummary = mapOf(
                            "side_effect_kind" to payload.optString("side_effect_kind", "tool"),
                            "state" to "needs_reconciliation",
                        ),
                    ),
                    status = "waiting",
                )
            }
            "approval.decided" -> {
                val approvalId = payload.optString("approval_id", payload.optString("call_id", "${envelope.runId}:approval"))
                NormalizedAgentEvent.ItemCompleted(
                    payload.optString("item_id", "${envelope.runId}:interaction:$approvalId"),
                    "interaction",
                    OaepInteractionContent(
                        interactionType = "approval",
                        prompt = payload.optString("prompt", "Approval required"),
                        options = emptyList(),
                        approvalId = approvalId,
                        response = payload.getString("decision"),
                    ),
                )
            }
            "run.waiting", "run.paused" -> NormalizedAgentEvent.RunWaiting(
                payload.optString("reason", "paused"), payload.optString("interaction_item_id").takeIf(String::isNotBlank),
            )
            "run.resumed" -> NormalizedAgentEvent.RunResumed
            "run.completed" -> NormalizedAgentEvent.RunCompleted
            "run.cancelled" -> NormalizedAgentEvent.RunCancelled
            "run.failed" -> NormalizedAgentEvent.RunFailed(error(payload, "python_runtime_failed"))
            "checkpoint.saved" -> null // Durable host state, not a public OAEP semantic event.
            else -> NormalizedAgentEvent.ItemCompleted(
                payload.optString("item_id", "${envelope.runId}:notice:${envelope.sequence}"),
                "notice",
                OaepNoticeContent(
                    "warning", "unknown_runtime_event", "Unsupported Android Agent Runtime event",
                    details = OaepDiagnosticMetadata.unknownEvent(payload.getString("kind")),
                ),
            )
        }
    }

    private fun toolContent(payload: org.json.JSONObject, result: Any?): OaepToolCallContent =
        OaepToolCallContent(
            toolKind = payload.optString("tool_kind", "host"),
            toolName = payload.getString("name"),
            callId = payload.optString("call_id", payload.optString("item_id", payload.getString("name"))),
            arguments = payload.optJSONObject("arguments")?.let(::jsonMap).orEmpty(),
            result = jsonValue(result),
            server = payload.optString("server").takeIf(String::isNotBlank),
            durationMs = payload.optDouble("duration_ms", Double.NaN).takeUnless(Double::isNaN),
        )

    private fun reasoningSegments(payload: org.json.JSONObject): List<Map<String, String>> =
        payload.optJSONArray("segments")?.objects()?.mapIndexed { index, value ->
            mapOf(
                "id" to value.optString("id", "segment-${index + 1}"),
                "text" to value.getString("text"),
            )
        } ?: listOf(mapOf("id" to payload.optString("segment_id", "summary-1"), "text" to payload.optString("text")))

    private fun planContent(payload: org.json.JSONObject) = OaepPlanContent(
        text = payload.optString("text"),
        steps = payload.optJSONArray("steps")?.objects()?.map(::jsonMap).orEmpty(),
        explanation = payload.optString("explanation").takeIf(String::isNotBlank),
    )

    private fun commandContent(payload: org.json.JSONObject) = OaepCommandExecutionContent(
        command = payload.optJSONArray("command")?.strings().orEmpty(),
        displayCommand = payload.optString("display_command"),
        cwd = payload.optString("cwd", "."),
        output = payload.optString("output"),
        stdoutTail = payload.optString("stdout_tail").takeIf(String::isNotBlank),
        stderrTail = payload.optString("stderr_tail").takeIf(String::isNotBlank),
        exitCode = if (payload.has("exit_code") && !payload.isNull("exit_code")) payload.getInt("exit_code") else null,
        durationMs = payload.optDouble("duration_ms", Double.NaN).takeUnless(Double::isNaN),
    )

    private fun jsonMap(value: org.json.JSONObject): Map<String, Any?> =
        value.keys().asSequence().associateWith { key -> jsonValue(value.get(key)) }

    private fun jsonValue(value: Any?): Any? = when (value) {
        org.json.JSONObject.NULL -> null
        is org.json.JSONObject -> jsonMap(value)
        is org.json.JSONArray -> (0 until value.length()).map { jsonValue(value.get(it)) }
        else -> value
    }

    private fun org.json.JSONArray.objects(): List<org.json.JSONObject> =
        (0 until length()).map { getJSONObject(it) }

    private fun org.json.JSONArray.strings(): List<String> =
        (0 until length()).map { getString(it) }

    private fun error(payload: org.json.JSONObject, fallbackCode: String): OaepError = OaepError(
        code = payload.optString("code").ifBlank { fallbackCode },
        message = payload.optString("actionable").ifBlank {
            payload.optString("message").ifBlank {
                payload.optString("code").ifBlank { fallbackCode }
            }
        },
        retryable = payload.optBoolean("retryable", true),
        details = buildMap {
            if (payload.has("status") && !payload.isNull("status")) put("status", payload.getInt("status"))
        },
    )
}
