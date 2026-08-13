// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

import org.json.JSONArray
import org.json.JSONObject

object RelayContractGenerated {
    const val SCHEMA_VERSION: String = "2.0.0"
    const val PROTOCOL_VERSION: String = "owop/1"
    const val SOURCE_SCHEMA_SHA256: String = "147fa8d0fbe173f492ce95257863265ec9c6f99d9e82b9b34d9e638d2b2ccf64"
    val ENDPOINTS: Map<String, String> = mapOf(
        "access_grant_create" to "POST /v1/runtimes/{runtime_id}/access-grants",
        "access_grant_read" to "GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "access_grant_revoke" to "DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "approval_decision" to "POST /v1/runtimes/{runtime_id}/approvals/{approval_id}/decision",
        "approval_decision_recovery" to "GET /v1/runtimes/{runtime_id}/idempotency/approval.decide/{idempotency_key}",
        "approval_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals",
        "association_create" to "POST /v1/associations",
        "association_device_key_rotate" to "POST /v1/associations/{runtime_id}/device-key/rotate",
        "association_push_registration_revoke" to "DELETE /v1/associations/{runtime_id}/push-registration",
        "association_push_registration_upsert" to "PUT /v1/associations/{runtime_id}/push-registration",
        "association_revoke" to "DELETE /v1/associations/{runtime_id}",
        "conversation_latency_metrics" to "GET /v1/metrics/relay-latency",
        "conversation_latency_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation",
        "conversation_latency_record" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation",
        "conversation_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot",
        "event_list" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events",
        "event_stream" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream",
        "file_raw" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw",
        "oaep_event_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events",
        "oaep_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream",
        "oaep_snapshot" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot",
        "run_cancel" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel",
        "run_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_read" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}",
        "runtime_association_authorization_shrink" to "PATCH /v1/runtimes/{runtime_id}/associations/{association_id}",
        "runtime_association_list" to "GET /v1/runtimes/{runtime_id}/associations",
        "runtime_association_revoke" to "DELETE /v1/runtimes/{runtime_id}/associations/{association_id}",
        "runtime_capabilities" to "GET /v1/runtimes/{runtime_id}/capabilities",
        "runtime_connect" to "WS /v1/runtime-connect",
        "runtime_enrollment_pause" to "POST /v1/runtimes/{runtime_id}/enrollment/pause",
        "runtime_enrollment_resume" to "POST /v1/runtimes/{runtime_id}/enrollment/resume",
        "runtime_enrollment_revoke" to "DELETE /v1/runtimes/{runtime_id}/enrollment",
        "runtime_identity" to "GET /v1/runtimes/{runtime_id}/runtime",
        "runtime_list" to "GET /v1/runtimes",
        "runtime_rename" to "PATCH /v1/runtimes/{runtime_id}",
        "session_catalog_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream",
        "session_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_event_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events",
        "session_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream",
        "session_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        "session_update" to "PATCH /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        "user_slo_first_screen_record" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/first-screen/{sample_id}",
        "user_slo_metrics" to "GET /v1/metrics/user-slo",
        "user_slo_operation_confirmation_record" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/operation-confirmation/{sample_id}",
        "user_slo_reconnect_record" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/reconnect/{sample_id}",
        "workspace_list" to "GET /v1/runtimes/{runtime_id}/workspaces",
        "workspace_sync" to "POST /v1/runtimes/{runtime_id}/workspaces/sync"
    )
    val CAPABILITIES: Set<String> = setOf(
        "approval.decide",
        "approval.list",
        "association.authorization.shrink",
        "association.device-bound",
        "association.device-key.rotate",
        "association.list",
        "association.revoke",
        "conversation.read",
        "enrollment.pause",
        "enrollment.resume",
        "enrollment.revoke",
        "event.cursor_expired",
        "event.resume",
        "event.stream",
        "file.raw.read",
        "mcp.stdio",
        "notification.push.registration",
        "oaep.session.events",
        "oaep.session.events.stream",
        "oaep.session.snapshot",
        "oaep.v1",
        "run.cancel",
        "run.create",
        "run.list",
        "run.read",
        "runtime.capabilities",
        "runtime.identity",
        "runtime.rename",
        "session.catalog.events.stream",
        "session.create",
        "session.list",
        "session.manage",
        "session.read",
        "telemetry.conversation-latency",
        "workspace.list",
        "workspace.sync"
    )
    val CAPABILITY_PROFILES: Map<String, Set<String>> = mapOf(
        "device-association/1" to setOf("association.authorization.shrink", "association.device-bound", "association.device-key.rotate", "association.list", "association.revoke"),
        "oaep.session-stream/1" to setOf("event.cursor_expired", "oaep.session.events", "oaep.session.events.stream", "oaep.session.snapshot", "oaep.v1"),
        "oaep/1" to setOf("event.cursor_expired", "oaep.session.events", "oaep.session.events.stream", "oaep.session.snapshot", "oaep.v1"),
        "push-notifications/1" to setOf("association.device-bound", "notification.push.registration"),
        "session-events/1" to setOf("conversation.snapshot", "session.event.cursor_expired", "session.event.resume", "session.event.stream")
    )
    val MINIMUM_VERSIONS: Map<String, Map<String, String>> = mapOf(
        "device-association/1" to mapOf("android" to "1.5.3", "relay" to "2.0.0", "runtime" to "1.5.3"),
        "oaep.session-stream/1" to mapOf("android" to "1.5.6", "desktop" to "1.6.0", "runtime" to "1.6.0"),
        "oaep/1" to mapOf("android" to "1.5.6", "desktop" to "1.6.0", "runtime" to "1.6.0"),
        "push-notifications/1" to mapOf("android" to "1.5.6", "relay" to "2.0.0"),
        "session-events/1" to mapOf("android" to "1.5.3", "desktop" to "1.5.3", "runtime" to "1.5.3")
    )
    val SESSION_EVENT_KINDS: Set<String> = setOf(
        "approval.created",
        "approval.decided",
        "artifact.created",
        "conversation.item.created",
        "conversation.item.delta",
        "conversation.item.upsert",
        "run.created",
        "run.state.changed",
        "session.archived",
        "session.removed",
        "session.updated",
        "tool.state.changed"
    )
    val ERROR_ACTIONS: Map<String, String> = mapOf(
        "access_denied" to "contact-admin",
        "access_grant_consumed" to "re-pair",
        "access_grant_expired" to "re-pair",
        "access_grant_invalid" to "re-pair",
        "access_grant_not_found" to "re-pair",
        "access_grant_revoked" to "re-pair",
        "agent_definition_not_found" to "contact-admin",
        "agent_version_invalid" to "contact-admin",
        "approval_decision_invalid" to "contact-admin",
        "approval_decision_ledger_invalid" to "contact-admin",
        "approval_not_found" to "contact-admin",
        "association_not_found" to "re-pair",
        "association_permissions_invalid" to "contact-admin",
        "association_required" to "re-pair",
        "association_revoked" to "re-pair",
        "attachment_reference_invalid" to "contact-admin",
        "auth_required" to "login",
        "authorization_expansion_forbidden" to "contact-admin",
        "backend_unavailable" to "retry",
        "backpressure_overflow" to "retry",
        "capability_unknown" to "update",
        "catalog_order_invalid" to "contact-admin",
        "catalog_sync_timeout" to "retry",
        "client_update_required" to "update",
        "cursor_expired" to "retry",
        "cursor_invalid" to "retry",
        "device_identity_conflict" to "re-pair",
        "device_key_conflict" to "re-pair",
        "device_name_invalid" to "contact-admin",
        "device_proof_expired" to "re-pair",
        "device_proof_invalid" to "re-pair",
        "device_proof_replay" to "re-pair",
        "device_proof_required" to "re-pair",
        "device_public_key_invalid" to "re-pair",
        "event_cursor_invalid" to "retry",
        "event_id_conflict" to "contact-admin",
        "event_sequence_gap" to "retry",
        "file_forbidden" to "contact-admin",
        "gateway_timeout" to "retry",
        "grant_forbidden" to "re-pair",
        "grant_not_found" to "re-pair",
        "grant_unavailable" to "retry",
        "heartbeat_replay" to "contact-admin",
        "host_offline" to "retry",
        "idempotency_conflict" to "contact-admin",
        "idempotency_key_invalid" to "contact-admin",
        "idempotency_key_required" to "contact-admin",
        "idempotency_operation_invalid" to "contact-admin",
        "idempotency_pending" to "retry",
        "idempotency_result_not_found" to "retry",
        "insufficient_scope" to "re-pair",
        "invalid_cursor" to "retry",
        "invalid_device_key" to "contact-admin",
        "invalid_device_proof" to "re-pair",
        "invalid_display_name" to "contact-admin",
        "invalid_idempotency_key" to "contact-admin",
        "invalid_latency_observation" to "contact-admin",
        "invalid_limit" to "contact-admin",
        "invalid_registration_code" to "contact-admin",
        "invalid_token" to "login",
        "key_rotation_invalid" to "contact-admin",
        "key_rotation_replay" to "contact-admin",
        "latency_event_not_found" to "contact-admin",
        "latency_observation_expired" to "contact-admin",
        "latency_observation_invalid" to "contact-admin",
        "latency_stage_forbidden" to "contact-admin",
        "latency_store_unavailable" to "retry",
        "oaep_event_invalid" to "contact-admin",
        "oaep_event_page_invalid" to "contact-admin",
        "oaep_frame_identity_mismatch" to "contact-admin",
        "oaep_frame_invalid" to "contact-admin",
        "oaep_identity_mismatch" to "contact-admin",
        "oaep_sequence_collision" to "contact-admin",
        "oaep_sequence_gap" to "retry",
        "oaep_snapshot_invalid" to "contact-admin",
        "oidc_auth_invalid" to "login",
        "owop_operation_forbidden" to "contact-admin",
        "owop_unavailable" to "retry",
        "owop_version_incompatible" to "update",
        "page_limit_invalid" to "contact-admin",
        "permission_denied" to "contact-admin",
        "permission_forbidden" to "contact-admin",
        "protocol_incompatible" to "update",
        "public_key_invalid" to "contact-admin",
        "push_provider_unavailable" to "retry",
        "push_registration_conflict" to "retry",
        "push_registration_not_found" to "contact-admin",
        "push_registration_stale" to "retry",
        "raw_range_invalid" to "contact-admin",
        "registration_code_invalid" to "contact-admin",
        "relay_bus_unavailable" to "retry",
        "relay_restart_in_progress" to "retry",
        "run_input_empty" to "contact-admin",
        "run_not_found" to "contact-admin",
        "run_scope_mismatch" to "contact-admin",
        "runtime_auth_invalid" to "contact-admin",
        "runtime_display_name_invalid" to "contact-admin",
        "runtime_forbidden" to "contact-admin",
        "runtime_generation_stale" to "retry",
        "runtime_id_conflict" to "contact-admin",
        "runtime_identity_mismatch" to "contact-admin",
        "runtime_invalid_catalog" to "contact-admin",
        "runtime_invalid_oaep" to "contact-admin",
        "runtime_invalid_response" to "contact-admin",
        "runtime_not_found" to "contact-admin",
        "runtime_offline" to "retry",
        "runtime_owner_unavailable" to "retry",
        "runtime_paused" to "retry",
        "runtime_permission_denied" to "contact-admin",
        "runtime_request_failed" to "contact-admin",
        "runtime_timeout" to "retry",
        "runtime_unavailable" to "retry",
        "runtime_update_required" to "update",
        "session_forbidden" to "contact-admin",
        "session_lifecycle_invalid" to "contact-admin",
        "session_not_found" to "contact-admin",
        "session_title_invalid" to "contact-admin",
        "session_update_empty" to "contact-admin",
        "signature_invalid" to "contact-admin",
        "stale_runtime_generation" to "retry",
        "ticket_expired" to "re-pair",
        "ticket_invalid" to "re-pair",
        "ticket_revoked" to "re-pair",
        "ticket_scope_mismatch" to "re-pair",
        "timeout" to "retry",
        "token_expired" to "login",
        "unsupported_protocol" to "update",
        "workspace_catalog_sync_invalid" to "retry",
        "workspace_forbidden" to "contact-admin",
        "workspace_not_found" to "contact-admin",
        "workspace_scope_invalid" to "contact-admin",
        "workspace_scope_mismatch" to "contact-admin"
    )

    fun errorAction(code: String?, retryable: Boolean = false): String =
        ERROR_ACTIONS[code.orEmpty()] ?: if (retryable) "retry" else "contact-admin"
}

data class GeneratedControlRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
)

data class GeneratedErrorEnvelope(
    val code: String,
    val message: String,
    val correlationId: String,
    val retryable: Boolean,
    val details: Map<String, Any?>,
    val source: String,
)

data class GeneratedRelayEvent(
    val eventId: String,
    val sequence: Long,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val timestamp: String,
    val kind: String,
    val payload: Map<String, Any?>,
)

data class GeneratedSessionConversationItem(
    val itemId: String,
    val sessionId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payload: Map<String, Any?>,
)

data class GeneratedConversationSnapshot(
    val sessionId: String,
    val snapshotSequence: Long,
    val items: List<GeneratedSessionConversationItem>,
    val nextCursor: String?,
)

data class GeneratedSessionEvent(
    val eventId: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
    val itemId: String? = null,
    val itemRevision: Long? = null,
)

data class GeneratedRuntimeSessionEventFrame(
    val type: String = "event",
    val scope: String = "session",
    val sessionId: String,
    val sessionSequence: Long,
    val event: GeneratedSessionEvent,
)

data class GeneratedSessionCreateRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String,
    val title: String,
    val agentDefinitionId: String,
    val agentDefinitionVersion: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("request_id", requestId)
        put("correlation_id", correlationId)
        put("idempotency_key", idempotencyKey)
        put("title", title)
        put("agent_definition_id", agentDefinitionId)
        put("agent_definition_version", agentDefinitionVersion)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedSessionCreateRequest {
            value.generatedRequireKeys(setOf("request_id", "correlation_id", "idempotency_key", "title", "agent_definition_id", "agent_definition_version"), setOf())
            return GeneratedSessionCreateRequest(
                requestId = value.generatedString("request_id"),
                correlationId = value.generatedString("correlation_id"),
                idempotencyKey = value.generatedString("idempotency_key"),
                title = value.generatedString("title"),
                agentDefinitionId = value.generatedString("agent_definition_id"),
                agentDefinitionVersion = value.generatedString("agent_definition_version"),
            )
        }
    }
}

data class GeneratedSessionUpdateRequest(
    val requestId: String,
    val correlationId: String,
    val title: String? = null,
    val lifecycle: String? = null,
) {
    init {
        require(lifecycle == null || lifecycle in setOf("active", "archived", "removed")) { "generated_dto_enum_invalid" }
        require(title != null || lifecycle != null) { "generated_dto_required_alternative_missing" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("request_id", requestId)
        put("correlation_id", correlationId)
        title?.let { put("title", it) }
        lifecycle?.let { put("lifecycle", it) }
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedSessionUpdateRequest {
            value.generatedRequireKeys(setOf("request_id", "correlation_id"), setOf("title", "lifecycle"))
            return GeneratedSessionUpdateRequest(
                requestId = value.generatedString("request_id"),
                correlationId = value.generatedString("correlation_id"),
                title = value.generatedNullableString("title"),
                lifecycle = value.generatedNullableString("lifecycle"),
            )
        }
    }
}

data class GeneratedRunCreateRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String,
    val message: String,
    val sourceMessageId: String? = null,
    val attachmentRefs: List<String> = emptyList(),
    val retryOf: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("request_id", requestId)
        put("correlation_id", correlationId)
        put("idempotency_key", idempotencyKey)
        put("message", message)
        sourceMessageId?.let { put("source_message_id", it) }
        put("attachment_refs", JSONArray(attachmentRefs))
        retryOf?.let { put("retry_of", it) }
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedRunCreateRequest {
            value.generatedRequireKeys(setOf("request_id", "correlation_id", "idempotency_key", "message"), setOf("source_message_id", "attachment_refs", "retry_of"))
            return GeneratedRunCreateRequest(
                requestId = value.generatedString("request_id"),
                correlationId = value.generatedString("correlation_id"),
                idempotencyKey = value.generatedString("idempotency_key"),
                message = value.generatedString("message"),
                sourceMessageId = value.generatedNullableString("source_message_id"),
                attachmentRefs = if (value.has("attachment_refs")) value.generatedStringList("attachment_refs") else emptyList(),
                retryOf = value.generatedNullableString("retry_of"),
            )
        }
    }
}

data class GeneratedApprovalDecisionRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
    val decision: String,
) {
    init {
        require(decision in setOf("approve", "deny", "cancel")) { "generated_dto_enum_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("request_id", requestId)
        put("correlation_id", correlationId)
        idempotencyKey?.let { put("idempotency_key", it) }
        put("decision", decision)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedApprovalDecisionRequest {
            value.generatedRequireKeys(setOf("request_id", "correlation_id", "decision"), setOf("idempotency_key"))
            return GeneratedApprovalDecisionRequest(
                requestId = value.generatedString("request_id"),
                correlationId = value.generatedString("correlation_id"),
                idempotencyKey = value.generatedNullableString("idempotency_key"),
                decision = value.generatedString("decision"),
            )
        }
    }
}

data class GeneratedLatencyObservationRequest(
    val clientReceiveAtMs: Long,
    val renderAtMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("client_receive_at_ms", clientReceiveAtMs)
        put("render_at_ms", renderAtMs)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedLatencyObservationRequest {
            value.generatedRequireKeys(setOf("client_receive_at_ms", "render_at_ms"), setOf())
            return GeneratedLatencyObservationRequest(
                clientReceiveAtMs = value.generatedLong("client_receive_at_ms"),
                renderAtMs = value.generatedLong("render_at_ms"),
            )
        }
    }
}

data class GeneratedFirstScreenObservationRequest(
    val cacheLoadAtMs: Long,
    val authorityRefreshAtMs: Long,
    val firstRenderAtMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("cache_load_at_ms", cacheLoadAtMs)
        put("authority_refresh_at_ms", authorityRefreshAtMs)
        put("first_render_at_ms", firstRenderAtMs)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedFirstScreenObservationRequest {
            value.generatedRequireKeys(setOf("cache_load_at_ms", "authority_refresh_at_ms", "first_render_at_ms"), setOf())
            return GeneratedFirstScreenObservationRequest(
                cacheLoadAtMs = value.generatedLong("cache_load_at_ms"),
                authorityRefreshAtMs = value.generatedLong("authority_refresh_at_ms"),
                firstRenderAtMs = value.generatedLong("first_render_at_ms"),
            )
        }
    }
}

data class GeneratedOperationConfirmationObservationRequest(
    val requestDispatchAtMs: Long,
    val runtimeCommitAtMs: Long,
    val confirmationRenderAtMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("request_dispatch_at_ms", requestDispatchAtMs)
        put("runtime_commit_at_ms", runtimeCommitAtMs)
        put("confirmation_render_at_ms", confirmationRenderAtMs)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedOperationConfirmationObservationRequest {
            value.generatedRequireKeys(setOf("request_dispatch_at_ms", "runtime_commit_at_ms", "confirmation_render_at_ms"), setOf())
            return GeneratedOperationConfirmationObservationRequest(
                requestDispatchAtMs = value.generatedLong("request_dispatch_at_ms"),
                runtimeCommitAtMs = value.generatedLong("runtime_commit_at_ms"),
                confirmationRenderAtMs = value.generatedLong("confirmation_render_at_ms"),
            )
        }
    }
}

data class GeneratedReconnectObservationRequest(
    val disconnectDetectAtMs: Long,
    val transportRestoreAtMs: Long,
    val replayCatchupAtMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("disconnect_detect_at_ms", disconnectDetectAtMs)
        put("transport_restore_at_ms", transportRestoreAtMs)
        put("replay_catchup_at_ms", replayCatchupAtMs)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedReconnectObservationRequest {
            value.generatedRequireKeys(setOf("disconnect_detect_at_ms", "transport_restore_at_ms", "replay_catchup_at_ms"), setOf())
            return GeneratedReconnectObservationRequest(
                disconnectDetectAtMs = value.generatedLong("disconnect_detect_at_ms"),
                transportRestoreAtMs = value.generatedLong("transport_restore_at_ms"),
                replayCatchupAtMs = value.generatedLong("replay_catchup_at_ms"),
            )
        }
    }
}

data class GeneratedSessionProjection(
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val title: String,
    val lifecycle: String,
    val updatedAt: String,
    val agentDefinitionId: String? = null,
    val agentDefinitionVersion: String? = null,
    val backendId: String? = null,
    val lastRunStatus: String? = null,
) {
    init {
        require(lifecycle in setOf("active", "archived", "removed")) { "generated_dto_enum_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("runtime_id", runtimeId)
        put("workspace_id", workspaceId)
        put("session_id", sessionId)
        put("title", title)
        put("lifecycle", lifecycle)
        put("updated_at", updatedAt)
        agentDefinitionId?.let { put("agent_definition_id", it) }
        agentDefinitionVersion?.let { put("agent_definition_version", it) }
        backendId?.let { put("backend_id", it) }
        lastRunStatus?.let { put("last_run_status", it) }
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedSessionProjection {
            value.generatedRequireKeys(setOf("runtime_id", "workspace_id", "session_id", "title", "lifecycle", "updated_at"), setOf("agent_definition_id", "agent_definition_version", "backend_id", "last_run_status"))
            return GeneratedSessionProjection(
                runtimeId = value.generatedString("runtime_id"),
                workspaceId = value.generatedString("workspace_id"),
                sessionId = value.generatedString("session_id"),
                title = value.generatedString("title"),
                lifecycle = value.generatedString("lifecycle"),
                updatedAt = value.generatedString("updated_at"),
                agentDefinitionId = value.generatedNullableString("agent_definition_id"),
                agentDefinitionVersion = value.generatedNullableString("agent_definition_version"),
                backendId = value.generatedNullableString("backend_id"),
                lastRunStatus = value.generatedNullableString("last_run_status"),
            )
        }
    }
}

data class GeneratedRunProjection(
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val backendId: String,
    val status: String,
    val correlationId: String,
    val createdAt: String,
    val retryOf: String? = null,
    val message: String,
    val attachmentRefs: List<String>,
) {
    init {
        require(status in setOf("queued", "running", "waiting_approval", "completed", "failed", "cancelled")) { "generated_dto_enum_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("runtime_id", runtimeId)
        put("workspace_id", workspaceId)
        put("session_id", sessionId)
        put("run_id", runId)
        put("backend_id", backendId)
        put("status", status)
        put("correlation_id", correlationId)
        put("created_at", createdAt)
        retryOf?.let { put("retry_of", it) }
        put("message", message)
        put("attachment_refs", JSONArray(attachmentRefs))
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedRunProjection {
            value.generatedRequireKeys(setOf("runtime_id", "workspace_id", "session_id", "run_id", "backend_id", "status", "correlation_id", "created_at", "message", "attachment_refs"), setOf("retry_of"))
            return GeneratedRunProjection(
                runtimeId = value.generatedString("runtime_id"),
                workspaceId = value.generatedString("workspace_id"),
                sessionId = value.generatedString("session_id"),
                runId = value.generatedString("run_id"),
                backendId = value.generatedString("backend_id"),
                status = value.generatedString("status"),
                correlationId = value.generatedString("correlation_id"),
                createdAt = value.generatedString("created_at"),
                retryOf = value.generatedNullableString("retry_of"),
                message = value.generatedString("message"),
                attachmentRefs = value.generatedStringList("attachment_refs"),
            )
        }
    }
}

data class GeneratedApprovalProjection(
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val approvalId: String,
    val agentDefinitionId: String,
    val backendId: String,
    val operation: String,
    val riskSummary: String,
    val scope: String,
    val expiresAt: String,
    val correlationId: String,
    val status: String,
) {
    init {
        require(status in setOf("pending", "approved", "denied", "cancelled", "expired")) { "generated_dto_enum_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("runtime_id", runtimeId)
        put("workspace_id", workspaceId)
        put("session_id", sessionId)
        put("run_id", runId)
        put("approval_id", approvalId)
        put("agent_definition_id", agentDefinitionId)
        put("backend_id", backendId)
        put("operation", operation)
        put("risk_summary", riskSummary)
        put("scope", scope)
        put("expires_at", expiresAt)
        put("correlation_id", correlationId)
        put("status", status)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedApprovalProjection {
            value.generatedRequireKeys(setOf("runtime_id", "workspace_id", "session_id", "run_id", "approval_id", "agent_definition_id", "backend_id", "operation", "risk_summary", "scope", "expires_at", "correlation_id", "status"), setOf())
            return GeneratedApprovalProjection(
                runtimeId = value.generatedString("runtime_id"),
                workspaceId = value.generatedString("workspace_id"),
                sessionId = value.generatedString("session_id"),
                runId = value.generatedString("run_id"),
                approvalId = value.generatedString("approval_id"),
                agentDefinitionId = value.generatedString("agent_definition_id"),
                backendId = value.generatedString("backend_id"),
                operation = value.generatedString("operation"),
                riskSummary = value.generatedString("risk_summary"),
                scope = value.generatedString("scope"),
                expiresAt = value.generatedString("expires_at"),
                correlationId = value.generatedString("correlation_id"),
                status = value.generatedString("status"),
            )
        }
    }
}

data class GeneratedApprovalDecisionProjection(
    val runtimeId: String,
    val approvalId: String,
    val status: String,
) {
    init {
        require(status in setOf("approved", "denied", "cancelled", "expired")) { "generated_dto_enum_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("runtime_id", runtimeId)
        put("approval_id", approvalId)
        put("status", status)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedApprovalDecisionProjection {
            value.generatedRequireKeys(setOf("runtime_id", "approval_id", "status"), setOf())
            return GeneratedApprovalDecisionProjection(
                runtimeId = value.generatedString("runtime_id"),
                approvalId = value.generatedString("approval_id"),
                status = value.generatedString("status"),
            )
        }
    }
}

data class GeneratedLatencyObservationResponse(
    val ready: Boolean,
    val stagesPresent: List<String>,
    val latenciesMs: Map<String, Long>?,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("ready", ready)
        put("stages_present", JSONArray(stagesPresent))
        put("latencies_ms", latenciesMs?.let(::JSONObject) ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedLatencyObservationResponse {
            value.generatedRequireKeys(setOf("ready", "stages_present", "latencies_ms"), setOf())
            return GeneratedLatencyObservationResponse(
                ready = value.generatedBoolean("ready"),
                stagesPresent = value.generatedStringList("stages_present"),
                latenciesMs = value.generatedNullableLongMap("latencies_ms"),
            )
        }
    }
}

data class GeneratedUserSloObservationResponse(
    val ready: Boolean,
    val stagesPresent: List<String>,
    val latenciesMs: Map<String, Long>?,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("ready", ready)
        put("stages_present", JSONArray(stagesPresent))
        put("latencies_ms", latenciesMs?.let(::JSONObject) ?: JSONObject.NULL)
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedUserSloObservationResponse {
            value.generatedRequireKeys(setOf("ready", "stages_present", "latencies_ms"), setOf())
            return GeneratedUserSloObservationResponse(
                ready = value.generatedBoolean("ready"),
                stagesPresent = value.generatedStringList("stages_present"),
                latenciesMs = value.generatedNullableLongMap("latencies_ms"),
            )
        }
    }
}

data class GeneratedSessionCreateRecoveryResponse(
    val status: String,
    val operation: String,
    val resource: GeneratedSessionProjection,
) {
    init {
        require(status == "succeeded") { "generated_dto_constant_invalid" }
        require(operation == "session.create") { "generated_dto_constant_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("status", status)
        put("operation", operation)
        put("resource", resource.toJson())
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedSessionCreateRecoveryResponse {
            value.generatedRequireKeys(setOf("status", "operation", "resource"), setOf())
            return GeneratedSessionCreateRecoveryResponse(
                status = value.generatedString("status"),
                operation = value.generatedString("operation"),
                resource = GeneratedSessionProjection.fromJson(value.generatedObject("resource")),
            )
        }
    }
}

data class GeneratedRunCreateRecoveryResponse(
    val status: String,
    val operation: String,
    val resource: GeneratedRunProjection,
) {
    init {
        require(status == "succeeded") { "generated_dto_constant_invalid" }
        require(operation == "run.create") { "generated_dto_constant_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("status", status)
        put("operation", operation)
        put("resource", resource.toJson())
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedRunCreateRecoveryResponse {
            value.generatedRequireKeys(setOf("status", "operation", "resource"), setOf())
            return GeneratedRunCreateRecoveryResponse(
                status = value.generatedString("status"),
                operation = value.generatedString("operation"),
                resource = GeneratedRunProjection.fromJson(value.generatedObject("resource")),
            )
        }
    }
}

data class GeneratedApprovalDecisionRecoveryResponse(
    val status: String,
    val operation: String,
    val resource: GeneratedApprovalDecisionProjection,
) {
    init {
        require(status == "succeeded") { "generated_dto_constant_invalid" }
        require(operation == "approval.decide") { "generated_dto_constant_invalid" }
    }
    fun toJson(): JSONObject = JSONObject().apply {
        put("status", status)
        put("operation", operation)
        put("resource", resource.toJson())
    }

    companion object {
        fun fromJson(value: JSONObject): GeneratedApprovalDecisionRecoveryResponse {
            value.generatedRequireKeys(setOf("status", "operation", "resource"), setOf())
            return GeneratedApprovalDecisionRecoveryResponse(
                status = value.generatedString("status"),
                operation = value.generatedString("operation"),
                resource = GeneratedApprovalDecisionProjection.fromJson(value.generatedObject("resource")),
            )
        }
    }
}

private fun JSONObject.generatedRequireKeys(required: Set<String>, optional: Set<String>) {
    val actual = keys().asSequence().toSet()
    require(actual.containsAll(required) && actual.all { it in required || it in optional }) {
        "generated_dto_shape_invalid"
    }
}

private fun JSONObject.generatedString(name: String): String =
    get(name).let { require(it is String) { "generated_dto_type_invalid" }; it }

private fun JSONObject.generatedNullableString(name: String): String? =
    if (!has(name) || isNull(name)) null else generatedString(name)

private fun JSONObject.generatedLong(name: String): Long = get(name).let {
    require(it is Byte || it is Short || it is Int || it is Long) { "generated_dto_type_invalid" }
    (it as Number).toLong()
}

private fun JSONObject.generatedNullableLong(name: String): Long? =
    if (!has(name) || isNull(name)) null else generatedLong(name)

private fun JSONObject.generatedDouble(name: String): Double = get(name).let {
    require(it is Number) { "generated_dto_type_invalid" }
    it.toDouble().also { value -> require(value.isFinite()) { "generated_dto_type_invalid" } }
}

private fun JSONObject.generatedNullableDouble(name: String): Double? =
    if (!has(name) || isNull(name)) null else generatedDouble(name)

private fun JSONObject.generatedBoolean(name: String): Boolean =
    get(name).let { require(it is Boolean) { "generated_dto_type_invalid" }; it }

private fun JSONObject.generatedNullableBoolean(name: String): Boolean? =
    if (!has(name) || isNull(name)) null else generatedBoolean(name)

private fun JSONObject.generatedObject(name: String): JSONObject =
    get(name).let { require(it is JSONObject) { "generated_dto_type_invalid" }; it }

private fun JSONObject.generatedNullableObject(name: String): JSONObject? =
    if (!has(name) || isNull(name)) null else generatedObject(name)

private fun JSONObject.generatedStringList(name: String): List<String> =
    get(name).let { value ->
        require(value is JSONArray) { "generated_dto_type_invalid" }
        List(value.length()) { index ->
            value.get(index).let { item -> require(item is String) { "generated_dto_type_invalid" }; item }
        }
    }

private fun JSONObject.generatedNullableStringList(name: String): List<String>? =
    if (!has(name) || isNull(name)) null else generatedStringList(name)

private fun JSONObject.generatedLongMap(name: String): Map<String, Long> = generatedObject(name).let { value ->
    value.keys().asSequence().associateWith { key -> value.generatedLong(key) }
}

private fun JSONObject.generatedNullableLongMap(name: String): Map<String, Long>? =
    if (!has(name) || isNull(name)) null else generatedLongMap(name)
