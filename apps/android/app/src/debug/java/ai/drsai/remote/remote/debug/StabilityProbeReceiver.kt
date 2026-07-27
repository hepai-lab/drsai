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
                JSONObject()
                    .put("nonce", nonce)
                    .put("status", "passed")
                    .put("runtime_status", target.state.name.lowercase())
                    .put("runtime_generation", target.connectionGeneration)
                    .put("workspace_count", workspaces.items.size)
                    .put("snapshot_sequence", snapshotSequence)
                    .put("conversation_item_count", conversation.size)
                    .put("transcript_sha256", sessionConversationDigest(conversation))
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
        private const val MAX_SNAPSHOT_ITEMS = 100_000
        private val NONCE = Regex("^[a-f0-9]{32}$")
    }
}
