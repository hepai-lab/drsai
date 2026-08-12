package ai.drsai.remote

import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RemoteUserSloDiagnostics
import ai.drsai.remote.remote.data.RemoteUserSloJourney
import ai.drsai.remote.remote.data.RemoteUserSloLifecycleDiagnostics
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest

/** Opt-in production physical proof. It never creates Runs or reads transcript bodies. */
@RunWith(AndroidJUnit4::class)
class P6UserSloPhysicalTest {
    @Test fun twentyRealFirstScreensReachProductionSloAggregate() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("p6UserSloPhysical") == "true")
        val baseUrl = args.getString("relayBaseUrl")
            ?: "https://ai-dev.ihep.ac.cn/api/runtime-relay/"
        val iterations = args.getString("p6Iterations")?.toIntOrNull() ?: 20
        val settleMs = args.getString("p6SettleMs")?.toLongOrNull() ?: 10_000L
        require(iterations in 1..20) { "p6_user_slo_iterations_invalid" }
        require(settleMs in 3_000L..20_000L) { "p6_user_slo_settle_invalid" }
        val target = instrumentation.targetContext
        val tokens = SecureTokenStore(target)
        require(!tokens.accessToken.isNullOrBlank() && tokens.user() != null) {
            "p6_user_slo_login_required"
        }
        val auth = AccessTokenCoordinator(tokens, OidcClient(refreshClientId = { tokens.oidcClientId }))
        val proof = androidRelayDeviceProof(target)
        val discovery = HttpRelayDiscoveryService(
            baseUrl, auth::current, auth::refreshAfter, deviceProof = proof,
        )
        val repository = RelayRemoteRepository(
            baseUrl, auth::current, refreshAfter = auth::refreshAfter, deviceProof = proof,
        )
        val runtimes = discovery.listRuntimes().items
        require(runtimes.isNotEmpty()) { "p6_user_slo_runtime_catalog_empty" }
        val runtimeProjection = runtimes.firstOrNull { it.state.name.lowercase() == "online" }
            ?: error(
                "p6_user_slo_runtime_not_online:" +
                    runtimes.joinToString(",") {
                        val summary = MessageDigest.getInstance("SHA-256")
                            .digest(it.reference.runtimeId.value.toByteArray())
                            .joinToString("") { byte -> "%02x".format(byte) }.take(12)
                        "${it.state.name.lowercase()}:$summary"
                    }
            )
        val runtime = runtimeProjection.reference.runtimeId
        val workspace = discovery.listWorkspaces(runtime).items.first { it.lifecycle.toWire() == "active" }
            .workspaceId
        val session = repository.sessions(runtime, workspace).items.first().reference.sessionId
        suspend fun requireStage(stage: String, block: suspend () -> Unit) {
            runCatching { block() }.getOrElse { failure ->
                val category = when (failure) {
                    is RelayHttpException -> "http_${failure.status}_${failure.errorCode ?: "none"}"
                    is java.io.IOException -> "io"
                    is IllegalArgumentException -> failure.message
                        ?.takeIf { it.matches(Regex("[a-z][a-z0-9_]{2,96}")) }
                        ?.let { "validation_$it" }
                        ?: "validation"
                    is IllegalStateException -> "state"
                    else -> "other"
                }
                throw AssertionError("p6_preflight_${stage}_$category")
            }
        }
        requireStage("session") { repository.session(runtime, workspace, session) }
        val selection = runCatching { repository.protocolSelection(runtime) }
            .getOrElse { throw AssertionError("p6_preflight_capabilities") }
        if (selection.oaep) {
            requireStage("oaep_snapshot") { repository.oaepSnapshot(runtime, workspace, session) }
        }
        requireStage("runs") { repository.runs(runtime, workspace, session) }
        requireStage("approvals") { repository.approvals(runtime, workspace) }
        val before = RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN)
        val lifecycleBefore = RemoteUserSloLifecycleDiagnostics.snapshot()
        repeat(iterations) { index ->
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(
                "opendrsai://session/${runtime.value}/${workspace.value}/${session.value}"
            )).setClass(target, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                var activityReady = false
                scenario.onActivity { activity ->
                    activityReady = !activity.isFinishing && !activity.isDestroyed
                }
                assertTrue("p6_first_screen_activity_unavailable", activityReady)
                val expected = before.succeeded + index + 1
                val deadline = System.currentTimeMillis() + settleMs
                while (
                    RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN).succeeded < expected &&
                    System.currentTimeMillis() < deadline
                ) delay(100)
                val current = RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN)
                if (current.attempted < expected) {
                    val lifecycle = RemoteUserSloLifecycleDiagnostics.snapshot()
                    val reason = when {
                        lifecycle.cacheLoaded <= lifecycleBefore.cacheLoaded -> "cache_not_loaded"
                        lifecycle.refreshFailed > lifecycleBefore.refreshFailed -> "refresh_failed"
                        lifecycle.refreshSuperseded > lifecycleBefore.refreshSuperseded -> "refresh_superseded"
                        lifecycle.authorityRefreshed <= lifecycleBefore.authorityRefreshed -> "authority_not_refreshed"
                        lifecycle.renderCallback <= lifecycleBefore.renderCallback -> "render_not_called"
                        else -> "observation_not_created"
                    }
                    throw AssertionError("p6_first_screen_$reason")
                }
                assertEquals("p6_first_screen_observation_failed", before.failed, current.failed)
                assertTrue("p6_first_screen_observation_timeout", current.succeeded >= expected)
            }
        }
        val after = RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN)
        val sanitized = JSONObject()
            .put("schema_version", "p6-android-user-slo-physical/1")
            .put("physical", true)
            .put("journey", "first_screen")
            .put("ui_iterations", iterations)
            .put("observation_success_delta", after.succeeded - before.succeeded)
            .put("aggregate_verification", "server_side_delta_required")
            .put("content_free", true)
        val encoded = Base64.encodeToString(
            sanitized.toString().toByteArray(), Base64.NO_WRAP or Base64.URL_SAFE,
        )
        println("P6_USER_SLO_PROOF_BASE64=$encoded")
    }
}
