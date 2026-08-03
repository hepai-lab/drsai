package ai.drsai.remote

import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.parseAccessGrantCode
import ai.drsai.remote.remote.model.ApprovalId
import android.os.Bundle
import android.content.pm.ApplicationInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient

@RunWith(AndroidJUnit4::class)
class LocalRemoteWorkspaceE2ETest {
    @Test
    fun registrationAssociationBrowseRunAndApprovalUseTheRealLocalRelay() = runBlocking {
        val arguments = InstrumentationRegistry.getArguments()
        val baseUrl = arguments.getString("relayBaseUrl").orEmpty()
        val bearer = arguments.getString("relayBearer").orEmpty()
        val grantCode = arguments.getString("relayGrantCode").orEmpty()
        val approveCanary = arguments.getString("approveCanary").orEmpty()
        val rejectCanary = arguments.getString("rejectCanary").orEmpty()
        val messageCanary = arguments.getString("messageCanary").orEmpty()
        val approveCanaryPath = arguments.getString("approveCanaryPath").orEmpty()
        val rejectCanaryPath = arguments.getString("rejectCanaryPath").orEmpty()
        assumeTrue("local Relay arguments were not supplied", baseUrl.isNotBlank())
        require(
            bearer.isNotBlank() && grantCode.isNotBlank() &&
                approveCanary.isNotBlank() && rejectCanary.isNotBlank() && messageCanary.isNotBlank() &&
                approveCanaryPath.isNotBlank() && rejectCanaryPath.isNotBlank()
        )

        val issuer = "https://ai-dev.ihep.ac.cn"
        val payload = "opendrsai://associate?v=1&environment=development" +
            "&issuer=${java.net.URLEncoder.encode(issuer, Charsets.UTF_8.name())}&code=$grantCode"
        val scannedCode = parseAccessGrantCode(payload, issuer)
        val discovery = HttpRelayDiscoveryService(baseUrl, { bearer })
        val runtimeId = discovery.associate(scannedCode)
        val runtimes = discovery.listRuntimes()
        assertEquals(listOf(runtimeId), runtimes.items.map { it.reference.runtimeId })
        assertEquals("online", runtimes.items.single().state.name.lowercase())

        val workspaces = discovery.listWorkspaces(runtimeId)
        assertEquals(1, workspaces.items.size)
        val workspace = workspaces.items.single()
        val droppedRunResponse = AtomicBoolean(false)
        val droppedApprovalResponse = AtomicBoolean(false)
        val faultInjectingHttp = OkHttpClient.Builder().addInterceptor { chain ->
            val response = chain.proceed(chain.request())
            val path = chain.request().url.encodedPath
            val dropRun = chain.request().method == "POST" && path.endsWith("/runs") &&
                droppedRunResponse.compareAndSet(false, true)
            val dropApproval = chain.request().method == "POST" && path.endsWith("/decision") &&
                droppedApprovalResponse.compareAndSet(false, true)
            if (dropRun || dropApproval) {
                response.close()
                throw SocketTimeoutException("injected_response_loss_after_runtime_commit")
            }
            response
        }.build()
        val repository = RelayRemoteRepository(baseUrl, { bearer }, faultInjectingHttp)
        val definitions = repository.agentDefinitions(runtimeId)
        val definition = definitions.single { it.id == "android-local-e2e-approve" }
        val session = repository.createSession(
            runtimeId,
            workspace.workspaceId,
            "Android Emulator Local Relay E2E",
            definition,
            "android-emulator-session",
        )
        val run = repository.createRun(
            session,
            "execute controlled local acceptance message=$messageCanary",
            emptyList(),
            "android-emulator-run",
        )

        var approval = repository.approvals(runtimeId, workspace.workspaceId)
            .firstOrNull { it.runId == run.runId }
        repeat(100) {
            if (approval != null) return@repeat
            delay(50)
            approval = repository.approvals(runtimeId, workspace.workspaceId)
                .firstOrNull { it.runId == run.runId }
        }
        requireNotNull(approval)
        assertEquals(
            "approved",
            repository.decide(runtimeId, ApprovalId(approval!!.approvalId.value), "approve"),
        )

        var terminal = repository.getRun(runtimeId, run.runId).second
        repeat(100) {
            if (terminal == "completed") return@repeat
            delay(50)
            terminal = repository.getRun(runtimeId, run.runId).second
        }
        assertEquals("completed", terminal)
        val events = repository.events(run, 0, 500).items
        assertTrue(events.any { it.event.type == "message.delta" })
        assertTrue(events.any { it.event.type == "tool.finished" })
        assertTrue(events.any { it.event.type == "artifact.created" })
        val rejectDefinition = definitions.single { it.id == "android-local-e2e-reject" }
        val rejectSession = repository.createSession(
            runtimeId,
            workspace.workspaceId,
            "Android Emulator Rejection E2E",
            rejectDefinition,
            "android-emulator-reject-session",
        )
        val rejectRun = repository.createRun(
            rejectSession, "execute controlled rejection", emptyList(), "android-emulator-reject-run",
        )
        var rejectApproval = repository.approvals(runtimeId, workspace.workspaceId)
            .firstOrNull { it.runId == rejectRun.runId }
        repeat(100) {
            if (rejectApproval != null) return@repeat
            delay(50)
            rejectApproval = repository.approvals(runtimeId, workspace.workspaceId)
                .firstOrNull { it.runId == rejectRun.runId }
        }
        requireNotNull(rejectApproval)
        assertEquals(
            "denied",
            repository.decide(runtimeId, ApprovalId(rejectApproval!!.approvalId.value), "deny"),
        )
        var rejectTerminal = repository.getRun(runtimeId, rejectRun.runId).second
        repeat(100) {
            if (rejectTerminal == "cancelled") return@repeat
            delay(50)
            rejectTerminal = repository.getRun(runtimeId, rejectRun.runId).second
        }
        assertEquals("cancelled", rejectTerminal)
        val rejectEvents = repository.events(rejectRun, 0, 500).items
        assertTrue(rejectEvents.any { it.event.type == "approval.denied" })
        assertTrue(rejectEvents.none { it.event.type == "tool.finished" })
        val rejectAudit = repository.audit(runtimeId, workspace.workspaceId, rejectRun.runId)
        assertTrue(rejectAudit.any { it.action == "approval.denied" })
        val scanProof = scanAndroidStorage(
            listOf(
                bearer, grantCode, messageCanary,
                approveCanary, rejectCanary, approveCanaryPath, rejectCanaryPath,
            ),
        )
        val canonicalEvents = events.map { row ->
            canonicalJson(JSONObject()
                    .put("event_id", row.event.eventId.value)
                    .put("sequence", row.event.sequence)
                    .put("kind", row.event.type)
                    .put("payload", row.payload))
        }
        val transcriptHash = sha256(canonicalEvents.joinToString("\n"))
        val proof = JSONObject()
            .put("run_id", run.runId.value)
            .put("event_count", events.size)
            .put("sha256", transcriptHash)
            .put("event_sha256", JSONArray(canonicalEvents.map(::sha256)))
            .put("canonical_events", JSONArray(canonicalEvents))
            .put("approval_branches", JSONObject()
                .put("approved_terminal", terminal)
                .put("rejected_terminal", rejectTerminal)
                .put("rejected_tool_finished", false)
                .put("rejected_audit", true))
            .put("transport_faults", JSONObject()
                .put("run_response_dropped", droppedRunResponse.get())
                .put("approval_response_dropped", droppedApprovalResponse.get()))
            .put("android_storage_scan", scanProof)
            .toString()
        println("OPENDRSAI_TRANSCRIPT_PROOF=$proof")
        InstrumentationRegistry.getInstrumentation().sendStatus(
            0,
            Bundle().apply { putString("transcriptProof", proof) },
        )
    }

    private fun canonicalJson(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(
            prefix = "{", postfix = "}", separator = ",",
        ) { key -> JSONObject.quote(key) + ":" + canonicalJson(value.get(key)) }
        is JSONArray -> (0 until value.length()).joinToString(
            prefix = "[", postfix = "]", separator = ",",
        ) { index -> canonicalJson(value.get(index)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun scanAndroidStorage(forbidden: List<String>): JSONObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val contexts = listOf(instrumentation.targetContext)
        val roots = linkedMapOf<String, File>()
        val forbiddenVariants = forbidden.flatMap(::secretVariants).distinct()
        contexts.forEachIndexed { index, context ->
            val prefix = "target"
            roots["$prefix-files"] = context.filesDir
            roots["$prefix-cache"] = context.cacheDir
            roots["$prefix-no-backup"] = context.noBackupFilesDir
            roots["$prefix-databases"] = context.getDatabasePath("opendrsai.db").parentFile
                ?: error("android_scan_database_parent_missing")
            if (index == 0) {
                val externalFiles = context.getExternalFilesDirs(null).filterNotNull()
                val externalCaches = context.externalCacheDirs.filterNotNull()
                val externalTest = context.getExternalFilesDir("m08-test-scan")
                require(externalFiles.isNotEmpty() && externalCaches.isNotEmpty() && externalTest != null) {
                    "android_scan_external_roots_missing"
                }
                externalFiles.forEachIndexed { rootIndex, file ->
                    roots["$prefix-external-files-$rootIndex"] = file
                }
                externalCaches.forEachIndexed { rootIndex, file ->
                    roots["$prefix-external-cache-$rootIndex"] = file
                }
                roots["target-external-test"] = externalTest
            }
        }
        // Test preparation is explicit and separate from scanning. Every expected
        // category receives a benign sentinel so an empty directory cannot pass.
        roots.forEach { (label, root) ->
            require(root.exists() || root.mkdirs()) { "android_scan_prepare_failed:$label" }
            require(root.isDirectory && root.canWrite()) { "android_scan_prepare_unwritable:$label" }
            File(root, ".m08-scan-sentinel").writeText("prepared:$label", Charsets.UTF_8)
        }
        var filesScanned = 0
        val categoryCounts = JSONObject()
        roots.forEach { (label, root) ->
            require(root.exists()) { "android_scan_root_missing:$label" }
            require(root.isDirectory && root.canRead()) { "android_scan_root_unreadable:$label" }
            var categoryFiles = 0
            root.walkTopDown().forEach { file ->
                if (!file.isFile) return@forEach
                filesScanned += 1
                categoryFiles += 1
                val bytes = file.readBytes()
                forbiddenVariants.forEach { value ->
                    require(!bytes.containsSubsequence(value.toByteArray(Charsets.UTF_8))) {
                        "android_windows_canary_leak:$label"
                    }
                }
            }
            require(categoryFiles > 0) { "android_scan_category_empty:$label" }
            categoryCounts.put(label, categoryFiles)
        }
        val apk = File(instrumentation.targetContext.applicationInfo.sourceDir)
        require(apk.isFile && apk.canRead() && apk.length() > 0L) { "android_scan_apk_missing" }
        val apkBytes = apk.readBytes()
        forbiddenVariants.forEach { value ->
            require(!apkBytes.containsSubsequence(value.toByteArray(Charsets.UTF_8))) {
                "android_windows_canary_leak:target-apk"
            }
        }
        filesScanned += 1
        categoryCounts.put("target-apk", 1)
        require(filesScanned > 0) { "android_scan_no_files" }
        return JSONObject()
            .put("root_count", roots.size + 1)
            .put("file_count", filesScanned)
            .put("forbidden_count", forbidden.size)
            .put("variant_count", forbiddenVariants.size)
            .put("prepared_root_count", roots.size)
            .put("immutable_root_count", 1)
            .put(
                "backup_disabled",
                (instrumentation.targetContext.applicationInfo.flags and
                    ApplicationInfo.FLAG_ALLOW_BACKUP) == 0,
            )
            .put("category_file_counts", categoryCounts)
            .put("result", "zero_matches")
    }

    private fun secretVariants(value: String): List<String> {
        val bytes = value.toByteArray(Charsets.UTF_8)
        return listOf(
            value,
            value.lowercase(),
            java.net.URLEncoder.encode(value, Charsets.UTF_8.name()),
            java.util.Base64.getEncoder().encodeToString(bytes),
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),
            bytes.joinToString("") { "%02x".format(it) },
        )
    }

    private fun ByteArray.containsSubsequence(needle: ByteArray): Boolean {
        if (needle.isEmpty() || size < needle.size) return false
        for (start in 0..size - needle.size) {
            var match = true
            for (offset in needle.indices) {
                if (this[start + offset] != needle[offset]) {
                    match = false
                    break
                }
            }
            if (match) return true
        }
        return false
    }
}
