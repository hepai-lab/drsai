package ai.drsai.remote.remote.debug

import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.model.sessionConversationDigest
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Debug-only stability probe. The OIDC bearer stays in Android secure storage;
 * ADB can read only the sanitized proof written to no-backup storage.
 */
class StabilityProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            val nonce = intent.getStringExtra("nonce").orEmpty()
            val proof = runCatching {
                require(NONCE.matches(nonce)) { "stability_nonce_invalid" }
                val runtimeId = RuntimeId(intent.getStringExtra("runtime_id").orEmpty())
                val workspaceId = WorkspaceId(intent.getStringExtra("workspace_id").orEmpty())
                val sessionId = SessionId(intent.getStringExtra("session_id").orEmpty())
                val requestedBase = intent.getStringExtra("relay_base_url")
                    ?.trim()?.trimEnd('/')
                    ?: BuildConfig.RELAY_BASE_URL.trimEnd('/')
                require(requestedBase == BuildConfig.RELAY_BASE_URL.trimEnd('/')) {
                    "stability_relay_url_mismatch"
                }
                val store = SecureTokenStore(context)
                requireNotNull(store.accessToken?.takeIf(String::isNotBlank)) {
                    "stability_oidc_login_required"
                }
                require(store.user() != null) { "stability_oidc_subject_required" }
                val auth = AccessTokenCoordinator(
                    store,
                    OidcClient(refreshClientId = { store.oidcClientId }),
                )
                val deviceProof = androidRelayDeviceProof(context)
                val discovery = HttpRelayDiscoveryService(
                    "$requestedBase/",
                    auth::current,
                    auth::refreshAfter,
                    deviceProof = deviceProof,
                )
                val target = discovery.listRuntimes().items.single {
                    it.reference.runtimeId == runtimeId
                }
                val workspaces = discovery.listWorkspaces(runtimeId)
                require(workspaces.items.any { it.workspaceId == workspaceId }) {
                    "stability_workspace_missing"
                }
                val repository = RelayRemoteRepository(
                    "$requestedBase/",
                    auth::current,
                    refreshAfter = auth::refreshAfter,
                    deviceProof = deviceProof,
                )
                val (snapshotSequence, conversation) = readSnapshot(
                    repository,
                    runtimeId,
                    workspaceId,
                    sessionId,
                )
                val runs = readRuns(repository, runtimeId, workspaceId, sessionId)
                val events = readSessionEvents(
                    repository,
                    runtimeId,
                    workspaceId,
                    sessionId,
                )
                val duplicateRunCount = runs.size - runs.distinct().size
                val duplicateSequenceCount = events.size -
                    events.distinct().size
                val missingSequenceCount = events.zipWithNext().sumOf { (left, right) ->
                    (right - left - 1).coerceAtLeast(0)
                }
                JSONObject()
                    .put("nonce", nonce)
                    .put("status", "passed")
                    .put("runtime_status", target.state.name.lowercase())
                    .put("runtime_generation", target.connectionGeneration)
                    .put("workspace_count", workspaces.items.size)
                    .put("snapshot_sequence", snapshotSequence)
                    .put("conversation_item_count", conversation.size)
                    .put("transcript_sha256", sessionConversationDigest(conversation))
                    .put("run_count", runs.size)
                    .put("duplicate_run_count", duplicateRunCount)
                    .put("session_event_count", events.size)
                    .put("duplicate_sequence_count", duplicateSequenceCount)
                    .put("missing_sequence_count", missingSequenceCount)
            }.getOrElse { failure ->
                JSONObject()
                    .put("nonce", nonce.takeIf(NONCE::matches) ?: "invalid")
                    .put("status", "failed")
                    .put("error_code", failure.message ?: failure::class.java.simpleName)
            }
            writeProof(context, proof)
            pending.finish()
        }
    }

    private suspend fun readSnapshot(
        repository: RelayRemoteRepository,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
    ): Pair<Long, List<GeneratedSessionConversationItem>> {
        val items = mutableListOf<GeneratedSessionConversationItem>()
        var cursor: String? = null
        var snapshotSequence: Long? = null
        do {
            val page = repository.conversationSnapshot(
                runtimeId,
                workspaceId,
                sessionId,
                cursor,
                SNAPSHOT_PAGE_SIZE,
            )
            val expected = snapshotSequence
            if (expected == null) {
                snapshotSequence = page.snapshotSequence
            } else {
                require(page.snapshotSequence == expected) {
                    "stability_snapshot_watermark_changed"
                }
            }
            items += page.items
            cursor = page.nextCursor
            require(items.size <= MAX_SNAPSHOT_ITEMS) {
                "stability_snapshot_too_large"
            }
        } while (cursor != null)
        require(items.map { it.itemId }.distinct().size == items.size) {
            "stability_snapshot_item_collision"
        }
        return requireNotNull(snapshotSequence) to items
    }

    private suspend fun readRuns(
        repository: RelayRemoteRepository,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
    ): List<String> {
        val runIds = mutableListOf<String>()
        var cursor: String? = null
        do {
            val page = repository.runs(runtimeId, workspaceId, sessionId, cursor)
            runIds += page.items.map { it.identity.runId.value }
            cursor = page.nextCursor
            require(runIds.size <= MAX_RUNS) { "stability_runs_too_large" }
        } while (cursor != null)
        return runIds
    }

    private suspend fun readSessionEvents(
        repository: RelayRemoteRepository,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        sessionId: SessionId,
    ): List<Long> {
        val sequences = mutableListOf<Long>()
        var afterSequence = 0L
        do {
            val page = repository.sessionEvents(
                runtimeId,
                workspaceId,
                sessionId,
                afterSequence,
                SESSION_EVENT_PAGE_SIZE,
            )
            val pageSequences = page.items.map { it.sessionSequence }
            require(pageSequences.zipWithNext().all { (left, right) -> left < right }) {
                "stability_session_event_order_invalid"
            }
            sequences += pageSequences
            require(sequences.size <= MAX_SESSION_EVENTS) {
                "stability_session_events_too_large"
            }
            if (pageSequences.isNotEmpty()) {
                afterSequence = pageSequences.last()
            }
        } while (page.items.size == SESSION_EVENT_PAGE_SIZE)
        return sequences
    }

    private fun writeProof(context: Context, proof: JSONObject) {
        val output = File(context.noBackupFilesDir, FILE_NAME)
        val temporary = File(context.noBackupFilesDir, "$FILE_NAME.tmp")
        temporary.writeText(proof.toString(), Charsets.UTF_8)
        Files.move(
            temporary.toPath(),
            output.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    }

    companion object {
        const val ACTION = "ai.drsai.remote.debug.STABILITY_PROBE"
        const val FILE_NAME = "remote-workspace-stability-proof.json"
        private const val SNAPSHOT_PAGE_SIZE = 500
        private const val SESSION_EVENT_PAGE_SIZE = 500
        private const val MAX_SNAPSHOT_ITEMS = 100_000
        private const val MAX_SESSION_EVENTS = 100_000
        private const val MAX_RUNS = 100_000
        private val NONCE = Regex("^[a-f0-9]{32}$")
    }
}
