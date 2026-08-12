package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.MIGRATION_8_9
import ai.drsai.remote.data.MIGRATION_9_10
import ai.drsai.remote.data.MIGRATION_10_11
import ai.drsai.remote.data.MIGRATION_11_12
import ai.drsai.remote.data.MIGRATION_12_13
import ai.drsai.remote.data.MIGRATION_13_14
import ai.drsai.remote.data.MIGRATION_14_15
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.runtime.device.SafeDeviceInfoProvider
import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.SafWorkspaceStore
import ai.drsai.remote.runtime.device.registerAndroidDeviceTools
import ai.drsai.remote.runtime.python.HaiPythonModelHostPort
import ai.drsai.remote.runtime.python.HostApprovalDecision
import ai.drsai.remote.runtime.python.HostApprovalRequest
import ai.drsai.remote.runtime.python.HostArtifactDescriptor
import ai.drsai.remote.runtime.python.HostCheckpoint
import ai.drsai.remote.runtime.python.HostModelChunk
import ai.drsai.remote.runtime.python.HostModelRequest
import ai.drsai.remote.runtime.python.HostToolCall
import ai.drsai.remote.runtime.python.HostToolResult
import ai.drsai.remote.runtime.python.PythonAgentLoopCoordinator
import ai.drsai.remote.runtime.python.PythonApprovalHostPort
import ai.drsai.remote.runtime.python.PythonArtifactHostPort
import ai.drsai.remote.runtime.python.PythonLifecycleHostPort
import ai.drsai.remote.runtime.python.PythonModelHostPort
import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeHostPorts
import ai.drsai.remote.runtime.python.PythonRuntimeLifecycleState
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.runtime.python.PythonStateStoreHostPort
import ai.drsai.remote.runtime.python.PythonToolHostPort
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in physical-device M04-F06 evidence run.
 *
 * Unlike the legacy smoke test, every prompt is natural language, the complete production catalog is
 * visible, and no implementation tool name appears in a prompt. This test deliberately writes raw,
 * non-secret observations rather than deciding the acceptance gate; the shared Python scorer owns that
 * decision so Android and Desktop cannot drift to different definitions of a successful selection.
 */
@RunWith(AndroidJUnit4::class)
class P9NaturalToolSelectionInstrumentedTest {
    @Test
    fun fullRuntimeSelectsToolsForFrozenNaturalTasks(): Unit = runBlocking {
        assumeTrue(
            "P9 natural tool-selection acceptance must be explicitly enabled",
            InstrumentationRegistry.getArguments().getString(ARG_ENABLE) == "true",
        )
        val context = ApplicationProvider.getApplicationContext<Context>()
        val suite = InstrumentationRegistry.getInstrumentation().context.assets.open(FIXTURE)
            .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        val cases = suite.getJSONArray("cases")
        assertEquals(30, cases.length())
        val arguments = InstrumentationRegistry.getArguments()
        val caseFilter = arguments.getString(ARG_CASE)?.takeIf(String::isNotBlank)
        val selectedCases = (0 until cases.length())
            .map(cases::getJSONObject)
            .filter { caseFilter == null || it.getString("id") == caseFilter }
        check(selectedCases.isNotEmpty()) { "p9_case_not_found:$caseFilter" }
        val attemptsPerCase = arguments.getString(ARG_ATTEMPTS)?.toIntOrNull()
            ?: suite.getInt("minimum_attempts_per_case")
        val toolLimit = arguments.getString(ARG_TOOL_LIMIT)?.toIntOrNull()
        assertTrue(attemptsPerCase >= if (caseFilter == null && toolLimit == null) 3 else 1)

        val database = Room.databaseBuilder(context, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(
                MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
                MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9,
                MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13,
                MIGRATION_13_14, MIGRATION_14_15,
            )
            .build()
        val runtime = PythonRuntimeClient(context, idleTimeoutMs = -1)
        try {
            val credentials = ModelProviderStore(context)
            val repository = ModelProviderRepository(
                database.modelProviderDao(), credentials, credentials::providers,
            )
            repository.ensureBuiltIns(BuildConfig.MODEL_BASE_URL)
            val (providers, models) = repository.snapshot()
            val requestedModel = InstrumentationRegistry.getArguments().getString(ARG_MODEL)
                ?.takeIf(String::isNotBlank) ?: DEFAULT_MODEL
            val model = models.firstOrNull {
                it.enabled && it.upstreamId.equals(requestedModel, ignoreCase = true) && it.providerId != "hepai"
            } ?: error("p9_model_not_configured")
            val provider = providers.first { it.id == model.providerId }
            check(credentials.hasApiKey(provider.id)) { "p9_model_api_key_missing" }

            val gateway = HaiModelClient(
                SecureTokenStore(context), OidcClient(), providerStore = repository, requestTemperature = TEMPERATURE,
            )
            val modelRouteSnapshot = gateway.pinModelRoute(model.id)
            val registry = defaultLocalToolRegistry(database.dao()).also {
                registerAndroidDeviceTools(
                    it,
                    SafeDeviceInfoProvider(context),
                    SafWorkspaceGateway(context, SafWorkspaceStore(context)),
                )
            }
            // The model-visible schemas and the Run declaration must describe
            // the same executable capability set. Using every enum value here
            // exposed network tools while this frozen suite intentionally
            // declares web access unavailable, causing Core to reject START_RUN
            // before any model request was made.
            val runtimeCapabilities = HOST_CAPABILITIES.mapTo(linkedSetOf()) { capability ->
                RuntimeCapability.valueOf(capability.uppercase())
            }
            val allTools = FullRuntimeToolCatalog.schemas(
                registry.toModelSchemas(ToolExecutionContext(EVALUATION_SUBJECT, runtimeCapabilities)),
            )
            val tools = if (toolLimit == null) allTools else JSONArray().apply {
                require(toolLimit in 1..allTools.length()) { "p9_tool_limit_invalid:$toolLimit" }
                repeat(toolLimit) { index -> put(JSONObject(allTools.getJSONObject(index).toString())) }
            }
            val hostCapabilities = JSONArray(HOST_CAPABILITIES)
            val hostPortCapabilities = JSONArray(HOST_CAPABILITIES.map { capability ->
                JSONObject().put("id", capability).put("version", 1).put("required", false)
            })

            runtime.bind()
            val identity = requireNotNull(runtime.runtimeIdentity()) { "p9_runtime_identity_missing" }
            val observations = JSONArray()
            selectedCases.forEach { testCase ->
                repeat(attemptsPerCase) { attempt ->
                    val selectedTools = mutableListOf<String>()
                    val selectedToolCalls = JSONArray()
                    var terminal = "unknown"
                    var errorCode: String? = null
                    var errorDetail: String? = null
                    var failureCategory: String? = null
                    var providerError: String? = null
                    val runId = "p9-m04-f06-${UUID.randomUUID()}"
                    val stateStore = InMemoryCheckpointStore()
                    val recordingModel = RecordingModelPort(
                        HaiPythonModelHostPort(gateway), selectedTools, selectedToolCalls,
                    ) { error ->
                        errorDetail = "${error.javaClass.simpleName}:${error.message}".take(240)
                    }
                    val ports = PythonRuntimeHostPorts(
                        model = recordingModel,
                        stateStore = stateStore,
                        tools = object : PythonToolHostPort {
                            override fun authoritativeRisk(toolName: String): String? =
                                registry.definition(toolName)?.risk?.name?.lowercase()

                            override suspend fun execute(call: HostToolCall) = HostToolResult(
                                callId = call.callId,
                                succeeded = true,
                                content = stableToolResult(call.name),
                            )
                        },
                        approval = object : PythonApprovalHostPort {
                            override suspend fun request(request: HostApprovalRequest) =
                                HostApprovalDecision(request.approvalId, "approved")
                        },
                        artifacts = object : PythonArtifactHostPort {
                            override suspend fun describe(artifactId: String) =
                                HostArtifactDescriptor(artifactId, "application/octet-stream", 0, "0".repeat(64))
                            override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = ByteArray(0)
                        },
                        lifecycle = object : PythonLifecycleHostPort {
                            override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
                        },
                    )
                    try {
                        val events = PythonAgentLoopCoordinator(runtime, ports).execute(
                            startEnvelope(
                                runId = runId,
                                prompt = testCase.getString("prompt"),
                                modelId = model.id,
                                modelRouteSnapshot = modelRouteSnapshot,
                                tools = tools,
                                hostPortCapabilities = hostPortCapabilities,
                            )
                        ).toList()
                        val terminalEvent = events.lastOrNull {
                            it.messageType == PythonRuntimeMessageType.RUNTIME_EVENT
                        }
                        terminal = terminalEvent?.payload?.optString("kind").orEmpty()
                            .ifBlank { "missing_terminal" }
                        if (terminal != "run.completed" && errorDetail == null) {
                            errorDetail = terminalEvent?.payload?.toString()?.take(240)
                        }
                    } catch (error: Throwable) {
                        when (error) {
                            is ApiException -> {
                                failureCategory = "provider_http"
                                providerError = error.code ?: "provider_http_${error.status}"
                                errorCode = providerError
                            }
                            else -> {
                                failureCategory = classifyRuntimeFailure(error)
                                errorCode = "runtime_${error.javaClass.simpleName}"
                            }
                        }
                        errorDetail = error.message?.take(240)
                    }
                    observations.put(JSONObject()
                        .put("case_id", testCase.getString("id"))
                        .put("attempt", attempt + 1)
                        .put("selected_tools", JSONArray(selectedTools))
                        .put("selected_tool_calls", selectedToolCalls)
                        .put("terminal", terminal)
                        .putOpt("failure_category", failureCategory)
                        .putOpt("failure_code", errorCode)
                        .putOpt("provider_error", providerError)
                        .putOpt("error_detail", errorDetail))
                }
            }

            val evidence = JSONObject()
                .put("schema_version", "opendrsai.p9-natural-tool-selection-observations/1")
                .put("suite_id", suite.getString("suite_id"))
                .put("suite_sha256", sha256(suite.toString().toByteArray(Charsets.UTF_8)))
                .put("provider", provider.name)
                .put("provider_id", provider.id)
                .put("model", model.upstreamId)
                .put("model_id", model.id)
                .put("model_route_sha256", modelRouteSnapshot.getString("sha256"))
                .put("temperature", TEMPERATURE)
                .put("attempts_per_case", attemptsPerCase)
                .put("tool_manifest_sha256", sha256(tools.toString().toByteArray(Charsets.UTF_8)))
                .put("tool_schemas", JSONArray(tools.toString()))
                .put("host_capabilities_sha256", sha256(hostCapabilities.toString().toByteArray(Charsets.UTF_8)))
                .put("kernel_id", identity.kernelId)
                .put("kernel_version", identity.kernelVersion)
                .put("kernel_sha256", identity.kernelSha256)
                .put("prompt_version", identity.promptVersion)
                .put("prompt_sha256", identity.promptSha256)
                .put("app_version", BuildConfig.VERSION_NAME)
                .put("application_id", BuildConfig.APPLICATION_ID)
                .put("generated_at_epoch_ms", System.currentTimeMillis())
                .put("observations", observations)
            val output = File(context.filesDir, OUTPUT_FILE)
            output.writeText(evidence.toString(2), Charsets.UTF_8)
            assertEquals(selectedCases.size * attemptsPerCase, observations.length())
            assertTrue(output.isFile && output.length() > 0)
        } finally {
            runtime.close()
            database.close()
        }
    }

    private fun startEnvelope(
        runId: String,
        prompt: String,
        modelId: String,
        modelRouteSnapshot: JSONObject,
        tools: JSONArray,
        hostPortCapabilities: JSONArray,
    ) = PythonRuntimeEnvelope(
        messageType = PythonRuntimeMessageType.START_RUN,
        requestId = "$runId:host:0",
        runId = runId,
        sessionId = runId,
        sequence = 0,
        idempotencyKey = "$runId:start",
        payload = JSONObject()
            .put("input", prompt)
            .put("model_id", modelId)
            .put("model_route_snapshot", JSONObject(modelRouteSnapshot.toString()))
            .put("agent", JSONObject().put("schema_version", 1).put("prompt_version", "p9-agent-kernel-v1"))
            .put("history", JSONArray())
            .put("tools", JSONArray(tools.toString()))
            .put("skills", JSONArray())
            .put("capability_diagnostics", JSONObject())
            .put("host_port", JSONObject()
                .put("schema_version", 1)
                .put("protocol_version", "p9-host-port-v1")
                .put("surface", "android")
                .put("capabilities", JSONArray(hostPortCapabilities.toString())))
            .put("artifacts", JSONArray()),
    )

    private class RecordingModelPort(
        private val delegate: PythonModelHostPort,
        private val selectedTools: MutableList<String>,
        private val selectedToolCalls: JSONArray,
        private val onError: (Throwable) -> Unit,
    ) : PythonModelHostPort {
        override fun stream(request: HostModelRequest): Flow<HostModelChunk> = delegate.stream(request)
            .catch { error ->
                onError(IllegalStateException(
                    "tool_choice=${request.toolChoice};cause=${error.javaClass.simpleName}:${error.message}",
                    error,
                ))
                throw error
            }
            .onEach { chunk ->
                repeat(chunk.toolCalls.length()) { index ->
                    chunk.toolCalls.optJSONObject(index)?.let { call ->
                        call.optString("name").takeIf(String::isNotBlank)?.let(selectedTools::add)
                        selectedToolCalls.put(JSONObject(call.toString()))
                    }
                }
            }
    }

    private class InMemoryCheckpointStore : PythonStateStoreHostPort {
        private var checkpoint: HostCheckpoint? = null

        override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) {
            val merged = this.checkpoint?.state?.let { JSONObject(it.toString()) } ?: JSONObject()
            checkpoint.state.keys().forEach { key -> merged.put(key, checkpoint.state.get(key)) }
            this.checkpoint = HostCheckpoint(checkpoint.runId, checkpoint.sequence, merged)
        }

        override suspend fun loadCheckpoint(runId: String): HostCheckpoint? = checkpoint
            ?.takeIf { it.runId == runId }
            ?.let { HostCheckpoint(it.runId, it.sequence, JSONObject(it.state.toString())) }
    }

    private fun stableToolResult(name: String): JSONObject = when (name) {
        "get_current_time" -> JSONObject().put("time", "2026-08-05T12:00:00+08:00[Asia/Shanghai]")
        "get_device_info" -> JSONObject().put("sdk", 35).put("locale", "zh-CN")
            .put("time_zone", "Asia/Shanghai").put("network_type", "wifi")
        "save_memory" -> JSONObject().put("saved", true).put("id", 1)
        "search_memory" -> JSONObject().put("items", JSONArray())
        "workspace.list" -> JSONObject().put("items", JSONArray())
        "workspace.read" -> JSONObject().put("text", "fixture content")
        "workspace.search" -> JSONObject().put("matches", JSONArray())
        "workspace.write" -> JSONObject().put("written", true)
        else -> JSONObject().put("ok", true)
    }

    private fun classifyRuntimeFailure(error: Throwable): String {
        val message = generateSequence(error) { it.cause }
            .mapNotNull { it.message }
            .joinToString(":")
            .lowercase()
        return when {
            listOf("saf_", "workspace_", "approval_", "artifact_", "tool_execution").any(message::contains) ->
                "host_execution"
            listOf("oaep_", "event_", "projection_", "terminal_").any(message::contains) ->
                "oaep_projection"
            else -> "runtime_policy"
        }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    companion object {
        private const val ARG_ENABLE = "runP9NaturalToolSelection"
        private const val ARG_MODEL = "p9Model"
        private const val ARG_CASE = "p9Case"
        private const val ARG_ATTEMPTS = "p9Attempts"
        private const val ARG_TOOL_LIMIT = "p9ToolLimit"
        private const val DEFAULT_MODEL = "deepseek-v4-flash"
        private const val TEMPERATURE = 0.0
        private const val FIXTURE = "p9-natural-tool-selection-v1.json"
        private const val OUTPUT_FILE = "p9-m04-f06-natural-tool-selection-observations.json"
        private const val EVALUATION_SUBJECT = "p9-acceptance"
        private val HOST_CAPABILITIES = listOf(
            "chat", "streaming", "local_memory", "attachment_input", "safe_device_info",
            "saf_read", "saf_write", "approvals", "artifacts", "project_files", "background_runs",
        )
    }
}
