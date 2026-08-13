package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedApprovalDecisionRecoveryResponse
import ai.drsai.remote.remote.generated.GeneratedApprovalDecisionRequest
import ai.drsai.remote.remote.generated.GeneratedApprovalProjection
import ai.drsai.remote.remote.generated.GeneratedLatencyObservationRequest
import ai.drsai.remote.remote.generated.GeneratedFirstScreenObservationRequest
import ai.drsai.remote.remote.generated.GeneratedOperationConfirmationObservationRequest
import ai.drsai.remote.remote.generated.GeneratedReconnectObservationRequest
import ai.drsai.remote.remote.generated.GeneratedUserSloObservationResponse
import ai.drsai.remote.remote.generated.GeneratedRunCreateRecoveryResponse
import ai.drsai.remote.remote.generated.GeneratedRunCreateRequest
import ai.drsai.remote.remote.generated.GeneratedRunProjection
import ai.drsai.remote.remote.generated.GeneratedSessionCreateRecoveryResponse
import ai.drsai.remote.remote.generated.GeneratedSessionCreateRequest
import ai.drsai.remote.remote.generated.GeneratedSessionProjection
import ai.drsai.remote.remote.generated.GeneratedSessionUpdateRequest
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepContract
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.authorizeRelayRequest
import ai.drsai.remote.runtime.oaep.AndroidOaepCompatibility
import ai.drsai.remote.runtime.oaep.AndroidOaepReleaseGate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.io.IOException
import java.util.concurrent.TimeUnit

data class RemoteAgentDefinition(val id: String, val version: String, val name: String, val backendId: String,
                                 val backendHealth: String, val capabilities: Set<String>)
data class RemoteProtocolSelection(
    val oaep: Boolean,
    val legacySessionEvents: Boolean,
    val owop: Boolean,
    val selected: String,
    val version: String?,
    val schemaHash: String?,
    val fallbackReason: String?,
    val upgradeAction: String?,
)
data class RemoteSessionSummary(val reference: RemoteSessionRef, val definitionId: String, val definitionVersion: String,
                                val lastRunStatus: String?, val updatedAt: String, val lifecycle: String)
data class RemoteRunSummary(val identity: RemoteRunIdentity, val status: RemoteRunStatus, val correlationId: String,
                            val createdAt: String, val message: String, val attachmentRefs: List<String>)
data class RemoteApprovalSummary(val card: RemoteApprovalCard, val status: String)
data class RemoteApprovalRecord(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val runId: RunId,
    val approvalId: ApprovalId,
    val backendId: String,
    val operation: String,
    val riskSummary: String,
    val scope: String,
    val expiresAt: String,
    val correlationId: String,
    val status: String,
)
data class RemoteAuditEntry(
    val auditId: String,
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val runId: RunId,
    val action: String,
    val actorLabel: String,
    val timestamp: String,
    val correlationId: String,
    val approvalId: ApprovalId?,
)
data class RemotePushRegistration(
    val runtimeId: RuntimeId,
    val deviceSummary: String,
    val provider: String,
    val generation: Long,
    val status: String,
    val updatedAt: String,
)

class RelayRemoteRepository(
    baseUrl: String,
    private val accessToken: () -> String,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(60, TimeUnit.SECONDS)
        .build(),
    private val refreshAfter: suspend (String) -> String? = { null },
    private val deviceProof: RelayDeviceProof? = null,
    private val time: RemoteTimeScheduler = RemoteTimeScheduler(),
) : PushRegistrationClient, PushReadinessClient {
    private val root = baseUrl.trimEnd('/').toHttpUrl()
    private val json = "application/json".toMediaType()
    private fun segments(vararg values: String): List<String> = values.toList()

    override suspend fun upsertPushRegistration(
        runtimeId: RuntimeId,
        provider: String,
        token: String,
        generation: Long,
    ): RemotePushRegistration {
        require(provider.matches(Regex("^[a-z][a-z0-9_-]{1,31}$"))) { "push_provider_invalid" }
        require(token.length in 32..4096 && token.any { !it.isWhitespace() }) { "push_token_invalid" }
        require(generation >= 1) { "push_generation_invalid" }
        val row = put(
            segments("v1", "associations", runtimeId.value, "push-registration"),
            JSONObject().put("provider", provider).put("token", token).put("generation", generation),
        )
        return decodePushRegistration(row, runtimeId)
    }

    override suspend fun revokePushRegistration(runtimeId: RuntimeId): RemotePushRegistration =
        decodePushRegistration(
            delete(segments("v1", "associations", runtimeId.value, "push-registration")), runtimeId,
        )

    override suspend fun pushReadiness(): RemotePushReadiness {
        val row = get(segments("v1", "push", "readiness"))
        require(row.keys().asSequence().toSet() == setOf("ready", "providers", "worker_running")) {
            "push_readiness_fields_invalid"
        }
        require(row.get("ready") is Boolean && row.get("worker_running") is Boolean) {
            "push_readiness_type_invalid"
        }
        val providers = row.optJSONObject("providers")
            ?: throw IllegalArgumentException("push_readiness_providers_invalid")
        require(providers.keys().asSequence().toSet() == setOf("fcm") && providers.get("fcm") is Boolean) {
            "push_readiness_providers_invalid"
        }
        val result = RemotePushReadiness(
            ready = row.getBoolean("ready"),
            fcm = providers.getBoolean("fcm"),
            workerRunning = row.getBoolean("worker_running"),
        )
        require(result.ready == (result.fcm && result.workerRunning)) {
            "push_readiness_inconsistent"
        }
        return result
    }

    suspend fun protocolSelection(runtimeId: RuntimeId): RemoteProtocolSelection {
        val result = get(segments("v1", "runtimes", runtimeId.value, "capabilities"))
        val capabilities = result.optJSONArray("capabilities")?.strings().orEmpty()
        val profiles = result.optJSONArray("profiles")?.strings().orEmpty()
        val protocols = result.optJSONObject("protocols")
        val oaepProtocol = protocols?.optJSONObject("oaep")
        val oaepProfiles = oaepProtocol?.optJSONArray("profiles")?.strings().orEmpty()
        val oaepSignals = capabilities.any { it.startsWith("oaep.") } ||
            "oaep/1" in profiles || "oaep.session-stream/1" in profiles || oaepProtocol != null
        val legacy = "session-events/1" in profiles || setOf(
            "conversation.snapshot", "session.event.resume", "session.event.stream",
        ).all { it in capabilities }
        val compatibility = AndroidOaepReleaseGate.negotiate(
            androidRuntimeVersion = AndroidOaepReleaseGate.ANDROID_AGENT_RUNTIME_VERSION,
            protocolVersion = oaepProtocol?.optString("version")?.takeIf(String::isNotBlank),
            profiles = oaepProfiles.toSet(),
            capabilities = capabilities.toSet(),
            legacyRemoteAvailable = legacy,
        )
        require(!oaepSignals || compatibility != AndroidOaepCompatibility.REJECT) {
            "oaep_capability_partial"
        }
        require(compatibility != AndroidOaepCompatibility.REJECT) {
            "remote_session_protocol_unavailable"
        }
        val oaep = compatibility == AndroidOaepCompatibility.FULL_OAEP
        val owop = protocols?.optJSONObject("owop")?.optString("version") == "1.0"
        return RemoteProtocolSelection(
            oaep = oaep,
            legacySessionEvents = legacy,
            owop = owop,
            selected = if (oaep) "oaep" else "legacy",
            version = if (oaep) OaepContract.VERSION else "1",
            schemaHash = if (oaep) OaepContract.SCHEMA_SHA256 else null,
            fallbackReason = if (oaep) null else "oaep_unavailable",
            upgradeAction = if (oaep) null else "upgrade_runtime",
        )
    }

    suspend fun agentDefinitions(runtimeId: RuntimeId): List<RemoteAgentDefinition> =
        get(segments("v1", "runtimes", runtimeId.value, "agent-definitions")).array("items") { row ->
            RemoteAgentDefinition(row.getString("definition_id"), row.getString("version"), row.getString("display_name"),
                row.getString("backend_id"), row.getString("backend_health"), row.getJSONArray("capabilities").strings())
        }

    suspend fun sessions(runtimeId: RuntimeId, workspaceId: WorkspaceId, cursor: String? = null,
                         query: String? = null,
                         lifecycle: RemoteResourceLifecycle = RemoteResourceLifecycle.ACTIVE): Page<RemoteSessionSummary> {
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value, "sessions"),
            cursor,
            query,
            extraQuery = "lifecycle" to lifecycle.toWire(),
        )

        val items = result.array("items") { row ->
            val projection = GeneratedSessionProjection.fromJson(row)
            RemoteSessionSummary(
                decodeSession(projection, runtimeId, workspaceId),
                projection.agentDefinitionId.orEmpty(),
                projection.agentDefinitionVersion.orEmpty(),
                projection.lastRunStatus,
                projection.updatedAt,
                projection.lifecycle,
            )
        }.filter { it.reference.lifecycle == lifecycle }
        return Page(items, result.nullableString("next_cursor"))
    }

    suspend fun createSession(runtimeId: RuntimeId, workspaceId: WorkspaceId, title: String,
                              definition: RemoteAgentDefinition, idempotencyKey: String): RemoteSessionRef {
        require(definition.version != "latest" && definition.backendHealth == "healthy") { "agent_definition_unavailable" }
        val body = GeneratedSessionCreateRequest(
            requestId = UUID.randomUUID().toString(),
            correlationId = UUID.randomUUID().toString(),
            idempotencyKey = idempotencyKey,
            title = title,
            agentDefinitionId = definition.id,
            agentDefinitionVersion = definition.version,
        ).toJson()
        val projection = try {
            GeneratedSessionProjection.fromJson(post(
                segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value, "sessions"), body,
            ))
        } catch (uncertain: IOException) {
            GeneratedSessionCreateRecoveryResponse.fromJson(get(
                segments("v1", "runtimes", runtimeId.value, "idempotency", "session.create", idempotencyKey),
            )).resource
        }
        return decodeSession(projection, runtimeId, workspaceId)
    }

    suspend fun session(runtimeId: RuntimeId, workspaceId: WorkspaceId, sessionId: SessionId): RemoteSessionRef =
        decodeSession(get(segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
            "sessions", sessionId.value)),
            runtimeId, workspaceId).also { require(it.sessionId == sessionId) { "remote_session_scope_mismatch" } }

    suspend fun updateSession(
        reference: RemoteSessionRef,
        title: String? = null,
        lifecycle: RemoteResourceLifecycle? = null,
    ): RemoteSessionRef {
        val normalizedTitle = title?.trim()
        require(normalizedTitle == null || normalizedTitle.isNotEmpty() && normalizedTitle.length <= 200 &&
            normalizedTitle.none { it == '\u0000' || it == '\r' || it == '\n' }) { "session_title_invalid" }
        require(normalizedTitle != null || lifecycle != null) { "session_update_empty" }
        val body = GeneratedSessionUpdateRequest(
            requestId = UUID.randomUUID().toString(),
            correlationId = UUID.randomUUID().toString(),
            title = normalizedTitle,
            lifecycle = lifecycle?.toWire(),
        ).toJson()
        return decodeSession(GeneratedSessionProjection.fromJson(patch(
            segments("v1", "runtimes", reference.runtimeId.value, "workspaces", reference.workspaceId.value,
                "sessions", reference.sessionId.value),
            body,
        )), reference.runtimeId, reference.workspaceId)
    }

    suspend fun conversation(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        cursor: String? = null,
        limit: Int = 100,
    ): RemoteConversationProjection {
        require(limit in 1..500) { "conversation_limit_invalid" }
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "conversation"),
            cursor = cursor,
            extraQuery = "limit" to limit.toString(),
        )
        val items = result.array("items") { row ->
            RemoteConversationItem(
                eventId = row.getString("item_id"),
                sequence = row.getLong("sequence"),
                kind = row.getString("kind"),
                timestamp = row.getString("timestamp"),
                payload = row.getJSONObject("payload").toMap(),
            )
        }
        return RemoteConversationProjection(items, result.nullableString("next_cursor"))
    }

    suspend fun conversationSnapshot(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        cursor: String? = null,
        limit: Int = 100,
    ): GeneratedConversationSnapshot {
        require(limit in 1..500) { "conversation_limit_invalid" }
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "oaep-snapshot"),
            cursor = cursor,
            extraQuery = "limit" to limit.toString(),
        )
        require(result.getString("session_id") == sessionId.value) { "remote_session_scope_mismatch" }
        return GeneratedConversationSnapshot(
            sessionId = sessionId.value,
            snapshotSequence = result.getLong("snapshot_sequence"),
            items = result.array("items", ::decodeConversationItem),
            nextCursor = result.nullableString("next_cursor"),
        )
    }

    suspend fun oaepSnapshot(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        cursor: String? = null,
        limit: Int = 100,
    ): OaepSnapshot {
        require(limit in 1..500) { "oaep_snapshot_limit_invalid" }
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "oaep-snapshot"),
            cursor = cursor,
            extraQuery = "limit" to limit.toString(),
        )
        return OaepJsonCodec.snapshot(result).also { snapshot ->
            require(snapshot.session.id == sessionId.value) { "remote_session_scope_mismatch" }
            require(snapshot.session.workspaceId == workspaceId.value) { "remote_workspace_scope_mismatch" }
        }
    }

    suspend fun oaepEvents(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
        limit: Int = 500,
    ): OaepEventPage {
        require(afterSequence >= 0 && limit in 1..500)
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "oaep-events"),
            extraQueries = listOf(
                "after_sequence" to afterSequence.toString(),
                "limit" to limit.toString(),
            ),
        )
        return OaepJsonCodec.eventPage(result).also { page ->
            require(page.data.all { it.sessionId == sessionId.value }) {
                "remote_session_event_scope_mismatch"
            }
        }
    }

    suspend fun recordConversationLatency(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        eventId: String,
        clientReceiveAtMs: Long,
        renderAtMs: Long,
    ) {
        require(
            eventId.isNotBlank() && clientReceiveAtMs >= 0 && renderAtMs >= clientReceiveAtMs
        ) {
            "latency_observation_invalid"
        }
        val body = GeneratedLatencyObservationRequest(
            clientReceiveAtMs = clientReceiveAtMs,
            renderAtMs = renderAtMs,
        ).toJson()
        post(
            listOf(
                "v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "events", eventId, "latency-observation",
            ),
            body,
        )
    }

    suspend fun recordFirstScreenSlo(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        sampleId: String,
        cacheLoadAtMs: Long,
        authorityRefreshAtMs: Long,
        firstRenderAtMs: Long,
    ): GeneratedUserSloObservationResponse {
        validateSloObservation(sampleId, cacheLoadAtMs, authorityRefreshAtMs, firstRenderAtMs)
        return GeneratedUserSloObservationResponse.fromJson(post(
            sloPath(runtimeId, workspaceId, sessionId, "first-screen", sampleId),
            GeneratedFirstScreenObservationRequest(
                cacheLoadAtMs, authorityRefreshAtMs, firstRenderAtMs,
            ).toJson(),
        ))
    }

    suspend fun recordOperationConfirmationSlo(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        sampleId: String,
        requestDispatchAtMs: Long,
        runtimeCommitAtMs: Long,
        confirmationRenderAtMs: Long,
    ): GeneratedUserSloObservationResponse {
        validateSloObservation(sampleId, requestDispatchAtMs, runtimeCommitAtMs, confirmationRenderAtMs)
        return GeneratedUserSloObservationResponse.fromJson(post(
            sloPath(runtimeId, workspaceId, sessionId, "operation-confirmation", sampleId),
            GeneratedOperationConfirmationObservationRequest(
                requestDispatchAtMs, runtimeCommitAtMs, confirmationRenderAtMs,
            ).toJson(),
        ))
    }

    suspend fun recordReconnectSlo(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        sampleId: String,
        disconnectDetectAtMs: Long,
        transportRestoreAtMs: Long,
        replayCatchupAtMs: Long,
    ): GeneratedUserSloObservationResponse {
        validateSloObservation(sampleId, disconnectDetectAtMs, transportRestoreAtMs, replayCatchupAtMs)
        return GeneratedUserSloObservationResponse.fromJson(post(
            sloPath(runtimeId, workspaceId, sessionId, "reconnect", sampleId),
            GeneratedReconnectObservationRequest(
                disconnectDetectAtMs, transportRestoreAtMs, replayCatchupAtMs,
            ).toJson(),
        ))
    }

    private fun sloPath(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        journey: String,
        sampleId: String,
    ): List<String> = segments(
        "v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
        "sessions", sessionId.value, "slo", journey, sampleId,
    )

    private fun validateSloObservation(sampleId: String, first: Long, second: Long, third: Long) {
        require(sampleId.matches(Regex("^[A-Za-z0-9._:-]{8,500}$"))) { "slo_sample_id_invalid" }
        require(first >= 0 && first <= second && second <= third && third - first <= 300_000) {
            "slo_timestamps_invalid"
        }
    }

    suspend fun sessionEvents(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        afterSequence: Long,
        limit: Int = 500,
    ): Page<GeneratedSessionEvent> {
        require(afterSequence >= 0 && limit in 1..500)
        val result = get(
            segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
                "sessions", sessionId.value, "oaep-events"),
            extraQueries = listOf(
                "after_sequence" to afterSequence.toString(),
                "limit" to limit.toString(),
            ),
        )
        return Page(
            result.array("items") { decodeSessionEvent(it, runtimeId, workspaceId, sessionId) },
            result.nullableString("next_cursor"),
        )
    }

    suspend fun runs(runtimeId: RuntimeId, workspaceId: WorkspaceId, sessionId: SessionId,
                     cursor: String? = null): Page<RemoteRunSummary> {
        val result = get(segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value,
            "sessions", sessionId.value, "runs"), cursor)
        return Page(result.array("items") { row ->
            val projection = GeneratedRunProjection.fromJson(row)
            val identity = projection.toIdentity()
            require(identity.runtimeId == runtimeId) { "remote_run_runtime_scope_mismatch" }
            require(identity.workspaceId == workspaceId) { "remote_run_workspace_scope_mismatch" }
            require(identity.sessionId == sessionId) { "remote_run_session_scope_mismatch" }
            RemoteRunSummary(identity, RemoteRunStatus.valueOf(projection.status.uppercase()),
                projection.correlationId, projection.createdAt, projection.message,
                projection.attachmentRefs)
        }, result.nullableString("next_cursor"))
    }

    suspend fun events(identity: RemoteRunIdentity, afterSequence: Long = 0, limit: Int = 500): Page<RelayStreamEvent> {
        require(afterSequence >= 0 && limit in 1..500)
        val result = get(segments("v1", "runtimes", identity.runtimeId.value, "runs",
            identity.runId.value, "events"),
            extraQueries = listOf("after_sequence" to afterSequence.toString(), "limit" to limit.toString()))
        return Page(result.array("items") { row ->
            val returned = RemoteRunIdentity(RuntimeId(row.getString("runtime_id")), WorkspaceId(row.getString("workspace_id")),
                SessionId(row.getString("session_id")), RunId(row.getString("run_id")), identity.backendId)
            identity.requireSameScope(returned)
            val payload = row.getJSONObject("payload")
            val status = payload.optString("status").takeIf(String::isNotBlank)
                ?.let { runCatching { RemoteRunStatus.valueOf(it.uppercase()) }.getOrNull() }
            RelayStreamEvent(RemoteRuntimeEvent(EventId(row.getString("event_id")), returned, row.getLong("sequence"),
                row.getString("kind"), row.getString("timestamp"), status), payload)
        }, result.nullableString("next_cursor"))
    }

    suspend fun createRun(session: RemoteSessionRef, message: String, attachmentRefs: List<String>,
                          idempotencyKey: String, retryOf: RunId? = null,
                          sourceMessageId: String = idempotencyKey): RemoteRunIdentity {
        RemoteRunRequest(session.runtimeId, session.workspaceId, session.sessionId, message, attachmentRefs, idempotencyKey, retryOf)
        val body = GeneratedRunCreateRequest(
            requestId = UUID.randomUUID().toString(),
            correlationId = UUID.randomUUID().toString(),
            idempotencyKey = idempotencyKey,
            message = message,
            sourceMessageId = sourceMessageId,
            attachmentRefs = attachmentRefs,
            retryOf = retryOf?.value,
        ).toJson()
        val projection = try {
            GeneratedRunProjection.fromJson(post(
                segments("v1", "runtimes", session.runtimeId.value, "workspaces",
                    session.workspaceId.value, "sessions", session.sessionId.value, "runs"), body,
            ))
        } catch (uncertain: Throwable) {
            val outcomeUnknown = uncertain is IOException ||
                uncertain is RelayHttpException && uncertain.status >= 500
            if (!outcomeUnknown) throw uncertain
            var recovered: RemoteRunIdentity? = null
            for (waitMillis in RUN_RECOVERY_RETRY_MILLIS) {
                recovered = recoverRun(
                    session.runtimeId, session.workspaceId, session.sessionId, idempotencyKey,
                )
                if (recovered != null) return recovered
                time.waitFor(waitMillis)
            }
            throw uncertain
        }
        return projection.toIdentity().also {
                require(it.runtimeId == session.runtimeId) { "remote_run_runtime_scope_mismatch" }
                require(it.workspaceId == session.workspaceId) { "remote_run_workspace_scope_mismatch" }
                require(it.sessionId == session.sessionId) { "remote_run_session_scope_mismatch" }
            }
    }

    suspend fun recoverRun(
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
        idempotencyKey: String,
    ): RemoteRunIdentity? {
        val response = try {
            get(segments("v1", "runtimes", runtimeId.value, "idempotency", "run.create", idempotencyKey))
        } catch (failure: RelayHttpException) {
            if (failure.status == 404 || failure.status >= 500 ||
                failure.errorCode == "idempotency_result_not_found") return null
            throw failure
        }
        return GeneratedRunCreateRecoveryResponse.fromJson(response).resource.toIdentity().also {
            require(it.runtimeId == runtimeId) { "remote_run_runtime_scope_mismatch" }
            require(it.workspaceId == workspaceId) { "remote_run_workspace_scope_mismatch" }
            require(it.sessionId == sessionId) { "remote_run_session_scope_mismatch" }
        }
    }

    suspend fun cancel(identity: RemoteRunIdentity): String {
        val row = GeneratedRunProjection.fromJson(post(
            segments("v1", "runtimes", identity.runtimeId.value, "workspaces", identity.workspaceId.value,
                "runs", identity.runId.value, "cancel"),
            JSONObject(),
        ))
        require(row.runtimeId == identity.runtimeId.value) { "remote_run_runtime_scope_mismatch" }
        require(row.workspaceId == identity.workspaceId.value) { "remote_run_workspace_scope_mismatch" }
        require(row.runId == identity.runId.value) { "remote_run_id_scope_mismatch" }
        return row.status
    }

    suspend fun getRun(runtimeId: RuntimeId, runId: RunId): Pair<RemoteRunIdentity, String> {
        val row = GeneratedRunProjection.fromJson(get(segments("v1", "runtimes", runtimeId.value, "runs", runId.value)))
        val identity = row.toIdentity()
        require(identity.runtimeId == runtimeId) { "remote_run_runtime_scope_mismatch" }
        require(identity.runId == runId) { "remote_run_id_scope_mismatch" }
        return identity to row.status
    }

    suspend fun decide(runtimeId: RuntimeId, approvalId: ApprovalId, decision: String): String {
        val idempotencyKey = "approval:${approvalId.value}:$decision"
        val path = segments("v1", "runtimes", runtimeId.value, "approvals", approvalId.value, "decision")
        var lastFailure: Throwable? = null
        repeat(APPROVAL_DECISION_ATTEMPTS) { attempt ->
            try {
                return GeneratedApprovalProjection.fromJson(post(
                    path,
                    GeneratedApprovalDecisionRequest(
                        requestId = UUID.randomUUID().toString(),
                        correlationId = UUID.randomUUID().toString(),
                        idempotencyKey = idempotencyKey,
                        decision = decision,
                    ).toJson(),
                )).status
            } catch (uncertain: Throwable) {
                val outcomeUnknown = uncertain is IOException ||
                    uncertain is RelayHttpException && uncertain.status >= 500
                if (!outcomeUnknown) throw uncertain
                lastFailure = uncertain
                recoverApprovalDecision(runtimeId, approvalId, decision)?.let { return it }
                if (attempt + 1 < APPROVAL_DECISION_ATTEMPTS) {
                    time.waitFor(APPROVAL_DECISION_RETRY_MILLIS[attempt])
                }
            }
        }
        throw checkNotNull(lastFailure)
    }

    suspend fun recoverApprovalDecision(
        runtimeId: RuntimeId,
        approvalId: ApprovalId,
        decision: String,
    ): String? {
        val idempotencyKey = "approval:${approvalId.value}:$decision"
        val response = try {
            get(segments("v1", "runtimes", runtimeId.value, "idempotency", "approval.decide", idempotencyKey))
        } catch (failure: RelayHttpException) {
            if (failure.status == 404 || failure.status >= 500 ||
                failure.errorCode == "idempotency_result_not_found") return null
            throw failure
        }
        val row = GeneratedApprovalDecisionRecoveryResponse.fromJson(response).resource
        require(row.runtimeId == runtimeId.value) {
            "remote_approval_runtime_scope_mismatch"
        }
        require(row.approvalId == approvalId.value) {
            "remote_approval_id_scope_mismatch"
        }
        return row.status
    }

    suspend fun approvals(runtimeId: RuntimeId, workspaceId: WorkspaceId): List<RemoteApprovalRecord> =
        get(segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value, "approvals"))
            .array("items") { row ->
            val projection = GeneratedApprovalProjection.fromJson(row)
            val record = RemoteApprovalRecord(
                runtimeId = RuntimeId(projection.runtimeId),
                workspaceId = WorkspaceId(projection.workspaceId),
                sessionId = SessionId(projection.sessionId),
                runId = RunId(projection.runId),
                approvalId = ApprovalId(projection.approvalId),
                backendId = projection.backendId,
                operation = projection.operation,
                riskSummary = projection.riskSummary,
                scope = projection.scope,
                expiresAt = projection.expiresAt,
                correlationId = projection.correlationId,
                status = projection.status,
            )
            require(record.runtimeId == runtimeId && record.workspaceId == workspaceId) { "remote_approval_scope_mismatch" }
            record
        }

    suspend fun audit(runtimeId: RuntimeId, workspaceId: WorkspaceId, runId: RunId? = null): List<RemoteAuditEntry> {
        val path = segments("v1", "runtimes", runtimeId.value, "workspaces", workspaceId.value, "audit")
        val result = get(path, extraQuery = runId?.let { "run_id" to it.value })
        return result.array("items") { row ->
            val entry = RemoteAuditEntry(
                auditId = row.getString("audit_id"), runtimeId = RuntimeId(row.getString("runtime_id")),
                workspaceId = WorkspaceId(row.getString("workspace_id")), sessionId = SessionId(row.getString("session_id")),
                runId = RunId(row.getString("run_id")), action = row.getString("action"),
                actorLabel = row.optString("actor_label", "已授权设备"),
                timestamp = row.getString("timestamp"), correlationId = row.getString("correlation_id"),
                approvalId = row.optString("approval_id").takeIf { it.isNotBlank() && it != "null" }?.let(::ApprovalId),
            )
            require(entry.runtimeId == runtimeId && entry.workspaceId == workspaceId) { "remote_audit_scope_mismatch" }
            if (runId != null) require(entry.runId == runId) { "remote_audit_run_mismatch" }
            entry
        }
    }

    private suspend fun get(path: String, cursor: String? = null, query: String? = null,
                            extraQuery: Pair<String, String>? = null,
                            extraQueries: List<Pair<String, String>> = emptyList()): JSONObject = withContext(Dispatchers.IO) {
        val url = root.newBuilder().addPathSegments(path).apply { cursor?.let { addQueryParameter("cursor", it) };
            query?.let { addQueryParameter("query", it) }; extraQuery?.let { addQueryParameter(it.first, it.second) };
            extraQueries.forEach { addQueryParameter(it.first, it.second) } }.build()
        execute(Request.Builder().url(url).get().build())
    }
    private suspend fun get(path: List<String>, cursor: String? = null, query: String? = null,
                            extraQuery: Pair<String, String>? = null,
                            extraQueries: List<Pair<String, String>> = emptyList()): JSONObject =
        withContext(Dispatchers.IO) {
            val queries = buildList {
                cursor?.let { add("cursor" to it) }
                query?.let { add("query" to it) }
                extraQuery?.let(::add)
                addAll(extraQueries)
            }
            execute(Request.Builder().url(root.withRelayPath(path, queries)).get().build())
        }
    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.newBuilder().addPathSegments(path).build()).post(body.toString().toRequestBody(json)).build())
    }
    private suspend fun post(path: List<String>, body: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            execute(Request.Builder().url(root.withRelayPath(path))
                .post(body.toString().toRequestBody(json)).build())
        }
    private suspend fun patch(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.newBuilder().addPathSegments(path).build())
            .patch(body.toString().toRequestBody(json)).build())
    }
    private suspend fun patch(path: List<String>, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.withRelayPath(path))
            .patch(body.toString().toRequestBody(json)).build())
    }
    private suspend fun put(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.newBuilder().addPathSegments(path).build())
            .put(body.toString().toRequestBody(json)).build())
    }
    private suspend fun put(path: List<String>, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.withRelayPath(path))
            .put(body.toString().toRequestBody(json)).build())
    }
    private suspend fun delete(path: String): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.newBuilder().addPathSegments(path).build()).delete().build())
    }
    private suspend fun delete(path: List<String>): JSONObject = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(root.withRelayPath(path)).delete().build())
    }
    private suspend fun execute(request: Request): JSONObject {
        var networkAttempt = 0
        while (true) {
            val initialToken = accessToken()
            fun call(token: String) = http.newCall(
                authorizeRelayRequest(
                    deviceProof,
                    request.newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build(),
                    token,
                )
            ).execute()
            try {
                var response = call(initialToken)
                if (response.code == 401) {
                    response.close()
                    val refreshed = refreshAfter(initialToken)
                    if (refreshed.isNullOrBlank()) throw RelayHttpException(401, null, "oidc_auth_invalid")
                    response = call(refreshed)
                }
                return response.use {
                    if (!it.isSuccessful) throw relayHttpException(it)
                    JSONObject(it.body?.string() ?: error("relay_empty_response"))
                }
            } catch (failure: IOException) {
                // Snapshot/catalog reads are safe to replay after a mobile
                // handover or an HTTP/2 stream reset.  Writes are deliberately
                // excluded here and retain their operation-specific
                // idempotency recovery paths.
                if (request.method != "GET" || networkAttempt >= 1) throw failure
                networkAttempt += 1
                http.connectionPool.evictAll()
                time.waitFor(250)
            }
        }
    }

    private fun decodeSession(row: JSONObject, runtimeId: RuntimeId, workspaceId: WorkspaceId): RemoteSessionRef =
        decodeSession(GeneratedSessionProjection.fromJson(row), runtimeId, workspaceId)

    private fun decodeSession(
        row: GeneratedSessionProjection,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
    ): RemoteSessionRef {
        val session = RemoteSessionRef(RuntimeId(row.runtimeId), WorkspaceId(row.workspaceId),
            SessionId(row.sessionId), row.title,
            row.backendId ?: "opendrsai",
            RemoteResourceLifecycle.fromWire(row.lifecycle),
            row.updatedAt)
        require(session.runtimeId == runtimeId && session.workspaceId == workspaceId) { "remote_session_scope_mismatch" }
        return session
    }

    private fun GeneratedRunProjection.toIdentity(): RemoteRunIdentity = RemoteRunIdentity(
        RuntimeId(runtimeId),
        WorkspaceId(workspaceId),
        SessionId(sessionId),
        RunId(runId),
        backendId,
    )

    private fun decodeConversationItem(row: JSONObject) = GeneratedSessionConversationItem(
        itemId = row.getString("item_id"),
        sessionId = row.getString("session_id"),
        runId = row.nullableString("run_id"),
        kind = row.getString("kind"),
        role = row.nullableString("role"),
        revision = row.getLong("revision"),
        sessionSequence = row.getLong("session_sequence"),
        sourceClient = row.getString("source_client"),
        sourceMessageId = row.nullableString("source_message_id"),
        createdAt = row.getString("created_at"),
        updatedAt = row.getString("updated_at"),
        payload = row.getJSONObject("payload").toMap(),
    )

    private fun decodeSessionEvent(
        row: JSONObject,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
    ) = GeneratedSessionEvent(
        eventId = row.getString("event_id"),
        runtimeId = row.getString("runtime_id"),
        workspaceId = row.getString("workspace_id"),
        sessionId = row.getString("session_id"),
        runId = row.nullableString("run_id"),
        itemId = row.nullableString("item_id"),
        itemRevision = row.optLongOrNull("item_revision"),
        sessionSequence = row.getLong("session_sequence"),
        kind = row.getString("kind"),
        timestamp = row.getString("timestamp"),
        payload = row.getJSONObject("payload").toMap(),
    ).also {
        require(it.runtimeId == runtimeId.value && it.workspaceId == workspaceId.value &&
            it.sessionId == sessionId.value) { "remote_session_event_scope_mismatch" }
    }
    private companion object {
        const val APPROVAL_DECISION_ATTEMPTS = 4
        val APPROVAL_DECISION_RETRY_MILLIS = longArrayOf(100, 250, 500)
        val RUN_RECOVERY_RETRY_MILLIS = longArrayOf(100, 250, 500, 1_000)
    }

    private fun decodePushRegistration(row: JSONObject, runtimeId: RuntimeId): RemotePushRegistration =
        RemotePushRegistration(
            runtimeId = RuntimeId(row.getString("runtime_id")),
            deviceSummary = row.getString("device_summary"),
            provider = row.getString("provider"),
            generation = row.getLong("generation"),
            status = row.getString("status"),
            updatedAt = row.getString("updated_at"),
        ).also {
            require(it.runtimeId == runtimeId) { "push_registration_scope_mismatch" }
            require(it.deviceSummary.matches(Regex("^dev_[0-9a-f]{12}$"))) {
                "push_registration_device_invalid"
            }
            require(it.status == "active" || it.status == "revoked") {
                "push_registration_status_invalid"
            }
        }
}

private inline fun <T> JSONObject.array(name: String, decode: (JSONObject) -> T): List<T> =
    getJSONArray(name).let { array -> List(array.length()) { decode(array.getJSONObject(it)) } }
private fun JSONArray.strings(): Set<String> = (0 until length()).map(::getString).toSet()
private fun JSONObject.nullableString(name: String): String? = optString(name).takeIf { it.isNotBlank() && it != "null" }
private fun JSONObject.optLongOrNull(name: String): Long? =
    if (has(name) && !isNull(name)) getLong(name) else null
private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key ->
    when (val value = get(key)) {
        JSONObject.NULL -> null
        is JSONObject -> value.toMap()
        is JSONArray -> (0 until value.length()).map { index ->
            when (val nested = value.get(index)) {
                JSONObject.NULL -> null
                is JSONObject -> nested.toMap()
                else -> nested
            }
        }
        else -> value
    }
}
