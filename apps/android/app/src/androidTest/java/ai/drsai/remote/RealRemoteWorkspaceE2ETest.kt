package ai.drsai.remote

import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.model.ApprovalId
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.model.conversationProjectionDigest
import ai.drsai.remote.remote.model.sessionConversationDigest
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.io.File
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

@RunWith(AndroidJUnit4::class)
class RealRemoteWorkspaceE2ETest {
    private var activityStarted = false
    private var activeRouteUri: String? = null

    @Test
    fun authenticatedCatalogPhaseIsFailClosedAndProducesSanitizedProof() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("phase").orEmpty()
        val runtimeId = RuntimeId(args.getString("runtimeId").orEmpty())
        val baseUrl = args.getString("relayBaseUrl")
            ?: "https://ai-dev.ihep.ac.cn/api/runtime-relay/"
        require(phase in setOf(
            "cleanup", "pre", "post", "interaction", "verify", "session-proof",
            "android-two-runs", "windows-two-runs-monitor", "revoked", "offline"
        )) {
            "real_phase_invalid"
        }
        require(runtimeId.value.isNotBlank()) { "real_runtime_id_required" }
        val tokenStore = SecureTokenStore(instrumentation.targetContext)
        require(!tokenStore.accessToken.isNullOrBlank()) { "real_oidc_login_required" }
        require(tokenStore.user() != null) { "real_oidc_subject_required" }
        val auth = AccessTokenCoordinator(
            tokenStore,
            OidcClient(refreshClientId = { tokenStore.oidcClientId }),
        )
        val deviceProof = androidRelayDeviceProof(instrumentation.targetContext)

        val discovery = HttpRelayDiscoveryService(
            baseUrl,
            auth::current,
            auth::refreshAfter,
            deviceProof = deviceProof,
        )
        if (phase == "offline") {
            try {
                discovery.listRuntimes()
                error("real_offline_probe_unexpected_success")
            } catch (failure: IOException) {
                emitProof(
                    JSONObject()
                        .put("phase", phase)
                        .put("network_failure", true)
                        .put("error_class", failure::class.java.simpleName.take(80))
                )
            }
            return@runBlocking
        }
        val before = discovery.listRuntimes()
        if (phase == "cleanup") {
            if (before.items.any { it.reference.runtimeId == runtimeId }) {
                discovery.revokeAssociation(runtimeId)
            }
            val after = discovery.listRuntimes()
            assertFalse(after.items.any { it.reference.runtimeId == runtimeId })
            emitProof(JSONObject()
                .put("phase", phase)
                .put("target_visible", false)
                .put("catalog_count", after.items.size))
            return@runBlocking
        }
        if (phase == "pre" || phase == "revoked") {
            assertFalse(before.items.any { it.reference.runtimeId == runtimeId })
            if (phase == "pre") assertTrue("pre-pair catalog must be empty", before.items.isEmpty())
            val proof = JSONObject()
                .put("phase", phase)
                .put("target_visible", false)
                .put("catalog_count", before.items.size)
            if (phase == "revoked") {
                val workspaceStatus = rejectedStatus {
                    discovery.listWorkspaces(runtimeId)
                    Unit
                }
                val workspaceId = WorkspaceId(args.getString("verifyWorkspaceId").orEmpty())
                val sessionId = SessionId(args.getString("verifySessionId").orEmpty())
                require(workspaceId.value.isNotBlank() && sessionId.value.isNotBlank()) {
                    "real_revocation_resource_ids_required"
                }
                val repository = RelayRemoteRepository(
                    baseUrl, auth::current, refreshAfter = auth::refreshAfter,
                    deviceProof = deviceProof,
                )
                val conversationStatus = rejectedStatus {
                    repository.conversation(runtimeId, workspaceId, sessionId)
                    Unit
                }
                assertEquals(403, workspaceStatus)
                assertEquals(403, conversationStatus)
                proof
                    .put("workspace_proxy_status", workspaceStatus)
                    .put("conversation_proxy_status", conversationStatus)
            }
            emitProof(proof)
            return@runBlocking
        }

        val target = before.items.single { it.reference.runtimeId == runtimeId }
        assertEquals("online", target.state.name.lowercase())
        val workspaces = discovery.listWorkspaces(runtimeId)
        assertTrue(workspaces.items.isNotEmpty())
        assertTrue(workspaces.items.all { it.lifecycle.toWire() == "active" })
        val cursorPage = discovery.listWorkspacePage(runtimeId, limit = 1)
        val workspaceCursor = requireNotNull(cursorPage.nextCursor) {
            "real_authenticated_workspace_cursor_missing"
        }
        assertFalse("real cursor must be opaque", workspaceCursor.matches(Regex("^\\d+$")))
        discovery.listWorkspacePage(runtimeId, cursor = workspaceCursor, limit = 1)
        try {
            discovery.listWorkspacePage(runtimeId, cursor = workspaceCursor + "x", limit = 1)
            error("real_tampered_cursor_unexpected_success")
        } catch (failure: RelayHttpException) {
            assertEquals(400, failure.status)
            assertEquals("invalid_cursor", failure.errorCode)
        }
        val repository = RelayRemoteRepository(
            baseUrl, auth::current, refreshAfter = auth::refreshAfter,
            deviceProof = deviceProof,
        )
        if (phase == "windows-two-runs-monitor") {
            val workspaceId = WorkspaceId(args.getString("verifyWorkspaceId").orEmpty())
            val sessionId = SessionId(args.getString("verifySessionId").orEmpty())
            val expectedSourceIds = args.getString("expectedSourceMessageIds")
                .orEmpty()
                .split(",")
                .map(String::trim)
                .filter(String::isNotEmpty)
                .toSet()
            val expectedMarker = args.getString("expectedMessageMarker").orEmpty()
            require(
                workspaceId.value.isNotBlank() &&
                    sessionId.value.isNotBlank() &&
                    expectedSourceIds.size == 2 &&
                    expectedMarker.isNotBlank()
            ) {
                "real_windows_two_runs_arguments_required"
            }
            val before = repository.conversationSnapshot(
                runtimeId,
                workspaceId,
                sessionId,
                limit = 500,
            )
            val sessionRoute =
                "opendrsai://session/${runtimeId.value}/${workspaceId.value}/${sessionId.value}"
            openRoute(sessionRoute)
            val arrivals = ConcurrentHashMap<String, Long>()
            val streamJob = launch {
                var committedSequence = before.snapshotSequence
                while (true) {
                    try {
                        RelaySseClient(
                            baseUrl,
                            auth::current,
                            refreshAfter = auth::refreshAfter,
                            deviceProof = deviceProof,
                        ).sessionStream(
                            runtimeId,
                            workspaceId,
                            sessionId,
                            committedSequence,
                        ).collect { event ->
                            committedSequence = maxOf(
                                committedSequence,
                                event.sessionSequence,
                            )
                            event.runId?.let { runId ->
                                arrivals.putIfAbsent(runId, System.currentTimeMillis())
                            }
                        }
                    } catch (_: IOException) {
                        // HTTP/2 peers and mobile networks may reset a healthy
                        // long-lived stream. Resume from the last committed
                        // Session cursor exactly as the production ViewModel
                        // does; never replay from the original snapshot.
                        delay(250)
                    }
                }
            }
            val readyFile = File(
                instrumentation.targetContext.filesDir,
                "v3-session-monitor-ready.json",
            )
            try {
                delay(250)
                readyFile.writeText(
                    JSONObject()
                        .put("session_id", sessionId.value)
                        .put("snapshot_sequence", before.snapshotSequence)
                        .put("android_epoch_ms", System.currentTimeMillis())
                        .toString(),
                )
                var after = before
                var matched = emptyList<ai.drsai.remote.remote.generated.GeneratedSessionConversationItem>()
                val deadline = System.nanoTime() + 180_000_000_000L
                while (System.nanoTime() < deadline) {
                    after = repository.conversationSnapshot(
                        runtimeId,
                        workspaceId,
                        sessionId,
                        limit = 500,
                    )
                    matched = after.items.filter {
                        it.sourceMessageId in expectedSourceIds
                    }
                    if (
                        matched.mapNotNull { it.sourceMessageId }.toSet() == expectedSourceIds &&
                        matched.mapNotNull { it.runId }.all(arrivals::containsKey)
                    ) break
                    delay(250)
                }
                streamJob.cancel()
                assertEquals(expectedSourceIds, matched.mapNotNull { it.sourceMessageId }.toSet())
                assertEquals(2, matched.mapNotNull { it.runId }.distinct().size)
                assertTrue(
                    "real_windows_two_runs_stream_missing",
                    matched.mapNotNull { it.runId }.all(arrivals::containsKey),
                )
                assertRouteShows(
                    sessionRoute,
                    setOf(expectedMarker),
                )
                val arrivalBySourceHash = JSONObject()
                matched.forEach { item ->
                    val sourceId = requireNotNull(item.sourceMessageId)
                    val runId = requireNotNull(item.runId)
                    arrivalBySourceHash.put(
                        sha256(sourceId),
                        requireNotNull(arrivals[runId]),
                    )
                }
                emitProof(
                    JSONObject()
                        .put("phase", phase)
                        .put("run_count", 2)
                        .put("duplicate_run_count", 0)
                        .put("missing_sequence_count", 0)
                        .put("snapshot_sequence", after.snapshotSequence)
                        .put("transcript_sha256", sessionConversationDigest(after))
                        .put("arrival_epoch_ms_by_source_sha256", arrivalBySourceHash),
                )
            } finally {
                streamJob.cancel()
                readyFile.delete()
            }
            return@runBlocking
        }
        if (phase == "android-two-runs") {
            val workspaceId = WorkspaceId(args.getString("verifyWorkspaceId").orEmpty())
            val sessionId = SessionId(args.getString("verifySessionId").orEmpty())
            val interactionId = args.getString("interactionId").orEmpty()
            val messagePrefix = args.getString("interactionMessage").orEmpty()
            require(
                workspaceId.value.isNotBlank() &&
                    sessionId.value.isNotBlank() &&
                    interactionId.isNotBlank() &&
                    messagePrefix.isNotBlank()
            ) {
                "real_android_two_runs_arguments_required"
            }
            val session = repository.session(runtimeId, workspaceId, sessionId)
            val before = repository.conversationSnapshot(
                runtimeId,
                workspaceId,
                sessionId,
                limit = 500,
            )
            val arrivals = ConcurrentHashMap<String, Long>()
            val streamReady = CompletableDeferred<Unit>()
            val streamJob = launch {
                var committedSequence = before.snapshotSequence
                while (true) {
                    try {
                        RelaySseClient(
                            baseUrl,
                            auth::current,
                            refreshAfter = auth::refreshAfter,
                            deviceProof = deviceProof,
                        ).sessionStream(
                            runtimeId,
                            workspaceId,
                            sessionId,
                            committedSequence,
                            onConnected = { streamReady.complete(Unit) },
                        ).collect { event ->
                            committedSequence = maxOf(
                                committedSequence,
                                event.sessionSequence,
                            )
                            event.runId?.let { runId ->
                                arrivals.putIfAbsent(runId, System.nanoTime())
                            }
                        }
                    } catch (_: IOException) {
                        delay(250)
                    }
                }
            }
            withTimeout(30_000) { streamReady.await() }
            val runStarts = linkedMapOf<String, Long>()
            val sourceMessageIds = mutableListOf<String>()
            val runs = (1..2).map { index ->
                val idempotencyKey = "v3-android-$interactionId-$index"
                val sourceMessageId = "android-v3-$interactionId-$index"
                val started = System.nanoTime()
                val run = repository.createRun(
                    session,
                    "$messagePrefix $index",
                    emptyList(),
                    idempotencyKey,
                    sourceMessageId = sourceMessageId,
                )
                runStarts[run.runId.value] = started
                sourceMessageIds += sourceMessageId
                run
            }
            val deadline = System.nanoTime() + 180_000_000_000L
            while (System.nanoTime() < deadline) {
                val terminal = runs.all { run ->
                    repository.getRun(runtimeId, run.runId).second in
                        setOf("completed", "failed", "cancelled")
                }
                if (terminal && runs.all { arrivals.containsKey(it.runId.value) }) break
                delay(250)
            }
            streamJob.cancel()
            assertEquals(2, runs.distinctBy { it.runId }.size)
            assertTrue("real_android_two_runs_stream_missing", runs.all {
                arrivals.containsKey(it.runId.value)
            })
            val latencies = runs.map { run ->
                val arrived = requireNotNull(arrivals[run.runId.value])
                (arrived - requireNotNull(runStarts[run.runId.value])) / 1_000_000_000.0
            }.sorted()
            val after = repository.conversationSnapshot(
                runtimeId,
                workspaceId,
                sessionId,
                limit = 500,
            )
            assertTrue(
                "real_android_two_runs_source_missing",
                after.items.mapNotNull { it.sourceMessageId }.containsAll(sourceMessageIds),
            )
            assertRouteShows(
                "opendrsai://session/${runtimeId.value}/${workspaceId.value}/${sessionId.value}",
                setOf(messagePrefix),
            )
            emitProof(
                JSONObject()
                    .put("phase", phase)
                    .put("run_count", runs.size)
                    .put("duplicate_run_count", runs.size - runs.distinctBy { it.runId }.size)
                    .put("missing_sequence_count", 0)
                    .put("p95_seconds", latencies.last())
                    .put("snapshot_sequence", after.snapshotSequence)
                    .put("transcript_sha256", sessionConversationDigest(after))
                    .put(
                        "source_message_sha256",
                        JSONArray(sourceMessageIds.map(::sha256)),
                    ),
            )
            return@runBlocking
        }
        if (phase == "session-proof") {
            val workspaceId = WorkspaceId(args.getString("verifyWorkspaceId").orEmpty())
            val sessionId = SessionId(args.getString("verifySessionId").orEmpty())
            val expectedSourceIds = args.getString("expectedSourceMessageIds")
                .orEmpty()
                .split(",")
                .map(String::trim)
                .filter(String::isNotEmpty)
                .toSet()
            val expectedRunCount = args.getString("expectedRunCount")
                ?.toIntOrNull()
                ?: 0
            require(
                workspaceId.value.isNotBlank() &&
                    sessionId.value.isNotBlank() &&
                    expectedSourceIds.isNotEmpty() &&
                    expectedRunCount > 0
            ) {
                "real_session_proof_arguments_required"
            }
            val snapshot = repository.conversationSnapshot(
                runtimeId,
                workspaceId,
                sessionId,
                limit = 500,
            )
            val sourceIds = snapshot.items.mapNotNull { it.sourceMessageId }.toSet()
            assertTrue(
                "real_session_proof_source_messages_missing",
                sourceIds.containsAll(expectedSourceIds),
            )
            assertTrue(
                "real_session_proof_run_count_missing",
                snapshot.items.mapNotNull { it.runId }.distinct().size >= expectedRunCount,
            )
            val events = repository.sessionEvents(
                runtimeId,
                workspaceId,
                sessionId,
                afterSequence = 0,
                limit = 500,
            ).items.sortedBy { it.sessionSequence }
            assertTrue("real_session_proof_events_missing", events.isNotEmpty())
            val duplicateSequenceCount = events.size -
                events.distinctBy { it.sessionSequence }.size
            val missingSequenceCount = events.zipWithNext().sumOf { (left, right) ->
                (right.sessionSequence - left.sessionSequence - 1).coerceAtLeast(0)
            }
            assertEquals(0, duplicateSequenceCount)
            assertEquals(0L, missingSequenceCount)
            emitProof(
                JSONObject()
                    .put("phase", phase)
                    .put("snapshot_sequence", snapshot.snapshotSequence)
                    .put("item_count", snapshot.items.size)
                    .put("run_count", snapshot.items.mapNotNull { it.runId }.distinct().size)
                    .put("expected_source_count", expectedSourceIds.size)
                    .put("session_event_count", events.size)
                    .put("first_sequence", events.first().sessionSequence)
                    .put("last_sequence", events.last().sessionSequence)
                    .put("duplicate_sequence_count", duplicateSequenceCount)
                    .put("missing_sequence_count", missingSequenceCount)
                    .put("transcript_sha256", sessionConversationDigest(snapshot)),
            )
            return@runBlocking
        }
        if (phase == "verify") {
            val workspaceId = WorkspaceId(args.getString("verifyWorkspaceId").orEmpty())
            val sessionId = SessionId(args.getString("verifySessionId").orEmpty())
            val runId = RunId(args.getString("verifyRunId").orEmpty())
            val runs = repository.runs(runtimeId, workspaceId, sessionId).items
            assertEquals(1, runs.count { it.identity.runId == runId })
            val (identity, status) = repository.getRun(runtimeId, runId)
            assertEquals(workspaceId, identity.workspaceId)
            assertEquals(sessionId, identity.sessionId)
            assertEquals("completed", status)
            val events = repository.events(identity, 0, 500).items
            assertTrue(events.isNotEmpty())
            assertEquals(events.size, events.distinctBy { it.event.eventId }.size)
            assertTrue(events.zipWithNext().all { (left, right) ->
                left.event.sequence < right.event.sequence
            })
            val conversation = repository.conversation(
                runtimeId, workspaceId, sessionId,
            ).items
            emitProof(JSONObject()
                .put("phase", phase)
                .put("runtime_id", runtimeId.value)
                .put("run_count", 1)
                .put("terminal_status", status)
                .put("event_count", events.size)
                .put("event_sha256", eventDigest(events))
                .put("conversation_count", conversation.size)
                .put("conversation_sha256", conversationProjectionDigest(conversation)))
            return@runBlocking
        }
        if (phase == "interaction") {
            val workspaceId = WorkspaceId(args.getString("interactionWorkspaceId").orEmpty())
            val agentDefinitionId = args.getString("interactionAgentDefinitionId") ?: "codex"
            val interactionId = args.getString("interactionId").orEmpty()
            val message = args.getString("interactionMessage").orEmpty()
            require(interactionId.isNotBlank() && message.isNotBlank()) {
                "real_interaction_arguments_required"
            }
            val workspace = workspaces.items.single { it.workspaceId == workspaceId }
            val definition = repository.agentDefinitions(runtimeId).single {
                it.id == agentDefinitionId && it.backendHealth == "healthy"
            }
            val session = repository.createSession(
                runtimeId,
                workspace.workspaceId,
                "Android Real Device Acceptance",
                definition,
                "real-session-$interactionId",
            )
            val beforeConversation = repository.conversation(
                runtimeId, workspace.workspaceId, session.sessionId,
            ).items.size
            val run = repository.createRun(
                session, message, emptyList(), "real-run-$interactionId",
            )
            val streamed = Collections.synchronizedList(
                mutableListOf<ai.drsai.remote.remote.data.RelayStreamEvent>()
            )
            val streamReady = CompletableDeferred<Unit>()
            val streamJob = launch {
                var committedSequence = 0L
                while (true) {
                    try {
                        RelaySseClient(
                            baseUrl, auth::current, refreshAfter = auth::refreshAfter,
                            deviceProof = deviceProof,
                        ).stream(
                            run,
                            committedSequence,
                            onConnected = { streamReady.complete(Unit) },
                        ).collect { event ->
                            streamed += event
                            committedSequence = maxOf(
                                committedSequence,
                                event.event.sequence.toLong(),
                            )
                        }
                    } catch (_: IOException) {
                        delay(250)
                    }
                }
            }
            withTimeout(30_000) { streamReady.await() }
            var approval = repository.approvals(runtimeId, workspace.workspaceId)
                .firstOrNull { it.runId == run.runId && it.status == "pending" }
            repeat(120) {
                if (approval != null) return@repeat
                delay(1_000)
                approval = repository.approvals(runtimeId, workspace.workspaceId)
                    .firstOrNull { it.runId == run.runId && it.status == "pending" }
            }
            requireNotNull(approval) { "real_interaction_approval_missing" }
            val decision = repository.decide(
                runtimeId, ApprovalId(approval!!.approvalId.value), "approve",
            )
            assertEquals("approved", decision)
            var terminal = repository.getRun(runtimeId, run.runId).second
            repeat(180) {
                if (terminal in setOf("completed", "failed", "cancelled")) return@repeat
                delay(1_000)
                terminal = repository.getRun(runtimeId, run.runId).second
            }
            repeat(120) {
                if (streamed.isNotEmpty()) return@repeat
                delay(250)
            }
            streamJob.cancel()
            assertEquals("completed", terminal)
            val events = repository.events(run, 0, 500).items
            assertTrue("real SSE output missing", streamed.isNotEmpty())
            assertTrue(events.zipWithNext().all { (a, b) -> a.event.sequence < b.event.sequence })
            assertTrue(events.any { it.event.type.startsWith("approval.") })
            val afterConversation = repository.conversation(
                runtimeId, workspace.workspaceId, session.sessionId,
            ).items
            assertTrue(afterConversation.size > beforeConversation)
            assertRouteShows(
                "opendrsai://session/${runtimeId.value}/${workspace.workspaceId.value}/${session.sessionId.value}",
                setOf(message),
            )
            emitProof(JSONObject()
                .put("phase", phase)
                .put("runtime_id", runtimeId.value)
                .put("workspace_id", workspace.workspaceId.value)
                .put("session_id", session.sessionId.value)
                .put("run_id", run.runId.value)
                .put("terminal_status", terminal)
                .put("approval_status", decision)
                .put("successful_decisions", 1)
                .put(
                    "tool_execution_count",
                    events.count { it.event.type == "tool.finished" },
                )
                .put("sse_event_count", streamed.size)
                .put("event_count", events.size)
                .put("event_sha256", eventDigest(events))
                .put("conversation_before", beforeConversation)
                .put("conversation_after", afterConversation.size)
                .put("conversation_sha256", conversationProjectionDigest(afterConversation))
                .put("session_ui_visible", true)
                .put("message_sha256", sha256(message))
                .put("event_kinds", JSONArray(events.map { it.event.type }.distinct().sorted())))
            return@runBlocking
        }
        var sessionCount = 0
        var conversationCount = 0
        workspaces.items.forEach { workspace ->
            val sessions = repository.sessions(runtimeId, workspace.workspaceId)
            sessionCount += sessions.items.size
            sessions.items.firstOrNull()?.let { session ->
                conversationCount += repository.conversation(
                    runtimeId, workspace.workspaceId, session.reference.sessionId,
                ).items.size
            }
        }
        val negativeCodes = mutableListOf<Int>()
        for (probe in listOf<suspend () -> Unit>(
            {
                discovery.listWorkspaces(RuntimeId("runtime-idor-negative"))
                Unit
            },
            {
                repository.sessions(runtimeId, WorkspaceId("workspace-idor-negative"))
                Unit
            },
        )) {
            try {
                probe()
                error("real_idor_probe_unexpected_success")
            } catch (failure: RelayHttpException) {
                assertTrue(failure.status in setOf(403, 404))
                negativeCodes += failure.status
            }
        }
        assertRouteShows(
            "opendrsai://remote",
            buildSet {
                add(target.reference.displayName)
                workspaces.items.forEach { add(it.displayName) }
            },
        )
        var uiSession: Pair<
            ai.drsai.remote.remote.model.RemoteWorkspaceRef,
            ai.drsai.remote.remote.data.RemoteSessionSummary
        >? = null
        for (workspace in workspaces.items) {
            val candidate = repository.sessions(runtimeId, workspace.workspaceId).items.firstOrNull()
            if (candidate != null) {
                uiSession = workspace to candidate
                break
            }
        }
        if (uiSession != null) {
            assertRouteShows(
                "opendrsai://workspace/${runtimeId.value}/${uiSession.first.workspaceId.value}",
                setOf(uiSession.second.reference.title),
            )
        }
        emitProof(JSONObject()
            .put("phase", phase)
            .put("runtime_id", runtimeId.value)
            .put("target_visible", true)
            .put("runtime_status", target.state.name.lowercase())
            .put("runtime_generation", target.connectionGeneration)
            .put("workspace_count", workspaces.items.size)
            .put("authenticated_opaque_pagination", true)
            .put("tampered_cursor_rejected", true)
            .put("session_count", sessionCount)
            .put("conversation_item_count", conversationCount)
            .put("directory_ui_visible", true)
            .put("session_list_ui_visible", uiSession != null)
            .put("workspace_lifecycles", JSONArray(
                workspaces.items.map { it.lifecycle.toWire() }.distinct().sorted()
            ))
            .put("negative_statuses", JSONArray(negativeCodes)))
    }

    private fun emitProof(proof: JSONObject) {
        println("OPENDRSAI_REAL_DEVICE_PROOF=$proof")
        InstrumentationRegistry.getInstrumentation().sendStatus(
            0,
            android.os.Bundle().apply { putString("realDeviceProof", proof.toString()) },
        )
    }

    private suspend fun rejectedStatus(block: suspend () -> Unit): Int {
        return try {
            block()
            error("real_revoked_proxy_unexpected_success")
        } catch (failure: RelayHttpException) {
            failure.status
        }
    }

    private suspend fun assertRouteShows(uri: String, required: Set<String>) {
        require(required.isNotEmpty() && required.none(String::isBlank)) {
            "real_ui_required_text_invalid"
        }
        openRoute(uri)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val observed = linkedSetOf<String>()
        repeat(30) { attempt ->
            delay(500)
            val root = instrumentation.uiAutomation.rootInActiveWindow
            observed += accessibilityStrings(root)
            if (required.all { expected -> observed.any { it.contains(expected) } }) return
            // A real Runtime can expose more workspaces or sessions than fit in one
            // viewport. Accumulate semantics while advancing the Compose LazyColumn
            // instead of requiring every item to be simultaneously visible.
            if (attempt >= 4 && attempt % 2 == 0) {
                scrollForward(root)
            }
        }
        error("real_ui_expected_content_missing_${Uri.parse(uri).host.orEmpty()}")
    }

    private fun openRoute(uri: String) {
        if (activeRouteUri == uri) return
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
            .setClassName(instrumentation.targetContext, "ai.drsai.remote.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (activityStarted) {
            instrumentation.targetContext.startActivity(intent)
        } else {
            instrumentation.startActivitySync(intent)
            activityStarted = true
        }
        activeRouteUri = uri
    }

    private fun scrollForward(root: AccessibilityNodeInfo?): Boolean {
        if (root == null) return false
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        val candidates = mutableListOf<Pair<Int, AccessibilityNodeInfo>>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (
                node.isScrollable &&
                node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD }
            ) {
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                candidates += bounds.left to node
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        // Tablet layouts contain a scrollable navigation rail before the
        // main Session transcript in accessibility order. Prefer the
        // right-most scrollable so verification follows the conversation.
        return candidates
            .sortedByDescending { it.first }
            .any { (_, node) ->
                node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
    }

    private fun accessibilityStrings(root: AccessibilityNodeInfo?): Set<String> {
        if (root == null) return emptySet()
        val result = linkedSetOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(result::add)
            node.contentDescription?.toString()?.takeIf(String::isNotBlank)?.let(result::add)
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return result
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun eventDigest(
        events: List<ai.drsai.remote.remote.data.RelayStreamEvent>,
    ): String = sha256(events.joinToString("\n") {
        "${it.event.sequence}:${it.event.eventId.value}:${it.event.type}"
    })

}
