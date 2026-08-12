package ai.drsai.remote

import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Physical, content-free proof for P5-M03-F04 Session catalog convergence. */
@RunWith(AndroidJUnit4::class)
class P5SessionCatalogRealtimeTest {
    @Test
    fun renameArchiveUnarchiveAndRollbackArriveThroughWorkspaceStream() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(
            "P5 session catalog test requires relay identifiers",
            listOf("runtimeId", "workspaceId", "sessionId", "temporaryTitle")
                .all { !arguments.getString(it).isNullOrBlank() },
        )
        val runtimeId = RuntimeId(required(arguments.getString("runtimeId"), "runtime_id"))
        val workspaceId = WorkspaceId(required(arguments.getString("workspaceId"), "workspace_id"))
        val sessionId = SessionId(required(arguments.getString("sessionId"), "session_id"))
        val temporaryTitle = required(arguments.getString("temporaryTitle"), "temporary_title")
        require(temporaryTitle.matches(Regex("P5-M03-F04-[0-9a-f]{12}"))) {
            "p5_session_catalog_temporary_title_invalid"
        }
        val timeoutMs = arguments.getString("monitorDurationMs")?.toLongOrNull() ?: 90_000L
        require(timeoutMs in 30_000L..180_000L) { "p5_session_catalog_timeout_invalid" }
        val baseUrl = arguments.getString("relayBaseUrl")
            ?: "https://ai-dev.ihep.ac.cn/api/runtime-relay/"
        val tokenStore = SecureTokenStore(context)
        require(!tokenStore.accessToken.isNullOrBlank() && tokenStore.user() != null) {
            "p5_session_catalog_login_required"
        }
        val auth = AccessTokenCoordinator(
            tokenStore,
            OidcClient(refreshClientId = { tokenStore.oidcClientId }),
        )
        val deviceProof = androidRelayDeviceProof(context)
        val repository = RelayRemoteRepository(
            baseUrl, auth::current, refreshAfter = auth::refreshAfter, deviceProof = deviceProof,
        )
        val stream = RelaySseClient(
            baseUrl, auth::current, refreshAfter = auth::refreshAfter, deviceProof = deviceProof,
        )
        val original = repository.session(runtimeId, workspaceId, sessionId)
        require(original.lifecycle == RemoteResourceLifecycle.ACTIVE) {
            "p5_session_catalog_baseline_not_active"
        }
        val ready = CompletableDeferred<Unit>()
        val signals = Channel<Unit>(Channel.CONFLATED)
        var catalogEventCount = 0
        val streamJob = launch {
            stream.workspaceSessionCatalogStream(
                runtimeId,
                workspaceId,
                onConnected = {
                    ready.complete(Unit)
                    signals.trySend(Unit)
                },
            ).collect {
                catalogEventCount += 1
                signals.trySend(Unit)
            }
        }
        val readyFile = File(context.filesDir, "p5-session-catalog-monitor-ready.json")
        val observed = mutableListOf<String>()
        var stage = 0
        try {
            withTimeout(20_000L) { ready.await() }
            readyFile.writeText(
                JSONObject().put("ready", true).put("schema", 1).toString(),
            )
            withTimeout(timeoutMs) {
                while (stage < 4) {
                    signals.receive()
                    val active = allSessions(
                        repository, runtimeId, workspaceId, RemoteResourceLifecycle.ACTIVE,
                    ).singleOrNull { it.reference.sessionId == sessionId }
                    val archived = allSessions(
                        repository, runtimeId, workspaceId, RemoteResourceLifecycle.ARCHIVED,
                    ).singleOrNull { it.reference.sessionId == sessionId }
                    when (stage) {
                        0 -> if (active?.reference?.title == temporaryTitle && archived == null) {
                            observed += "rename"
                            stage = 1
                        }
                        1 -> if (active == null && archived?.reference?.title == temporaryTitle) {
                            observed += "archive"
                            stage = 2
                        }
                        2 -> if (active?.reference?.title == temporaryTitle && archived == null) {
                            observed += "unarchive"
                            stage = 3
                        }
                        3 -> if (active?.reference?.title == original.title && archived == null) {
                            observed += "rollback"
                            stage = 4
                        }
                    }
                }
            }
            val proof = JSONObject()
                .put("schema_version", "p5-session-catalog/1")
                .put("feature_id", "P5-M03-F04")
                .put("passed", stage == 4)
                .put("physical", isPhysicalDevice())
                .put("catalog_event_count", catalogEventCount)
                .put("observed_transitions", JSONArray(observed))
                .put("manual_refresh_count", 0)
                .put("final_active", true)
                .put("title_restored", true)
                .put("lifecycle_restored", true)
            assertTrue(catalogEventCount >= 4)
            println("P5_SESSION_CATALOG_REPORT=$proof")
            instrumentation.sendStatus(
                0,
                android.os.Bundle().apply { putString("p5SessionCatalogReport", proof.toString()) },
            )
        } finally {
            readyFile.delete()
            streamJob.cancel()
            signals.close()
        }
    }

    private suspend fun allSessions(
        repository: RelayRemoteRepository,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        lifecycle: RemoteResourceLifecycle,
    ) = buildList {
        var cursor: String? = null
        do {
            val page = repository.sessions(runtimeId, workspaceId, cursor = cursor, lifecycle = lifecycle)
            addAll(page.items)
            cursor = page.nextCursor
        } while (cursor != null)
    }

    private fun required(value: String?, name: String): String = value
        ?.takeIf { it.isNotBlank() && it.length <= 500 }
        ?: error("p5_session_catalog_${name}_required")

    private fun isPhysicalDevice(): Boolean {
        val values = listOf(
            android.os.Build.FINGERPRINT,
            android.os.Build.MODEL,
            android.os.Build.PRODUCT,
            android.os.Build.HARDWARE,
        ).map(String::lowercase)
        return values.none { value ->
            value.contains("generic") || value.contains("emulator") ||
                value.contains("goldfish") || value.contains("ranchu") || value.contains("vbox")
        }
    }
}
