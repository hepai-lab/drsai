package ai.drsai.remote

import android.app.Application
import android.app.NotificationManager
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.work.WorkManager
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.AssociationState
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.AgentRepository
import ai.drsai.remote.data.ApprovalUiItem
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentProcessor
import ai.drsai.remote.data.AttachmentRepository
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.MemorySettingsStore
import ai.drsai.remote.data.ModelProviderConfig
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelConfigurationMessageKind
import ai.drsai.remote.data.ModelProviderDraftClient
import ai.drsai.remote.data.ModelRecommendationPolicy
import ai.drsai.remote.data.ProviderVerification
import ai.drsai.remote.data.ProviderVerificationPolicy
import ai.drsai.remote.data.ProviderVerificationStore
import ai.drsai.remote.data.SingleFlightGate
import ai.drsai.remote.data.selectAvailableConfiguredModel
import ai.drsai.remote.data.MemoryUiItem
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
import ai.drsai.remote.data.MIGRATION_15_16
import ai.drsai.remote.workbench.data.WorkbenchProjectionRepository
import ai.drsai.remote.workbench.data.UnifiedWorkbenchRepository
import ai.drsai.remote.workbench.data.SessionMutationResult
import ai.drsai.remote.data.WorkbenchSessionItem
import ai.drsai.remote.data.WorkbenchWorkspaceItem
import ai.drsai.remote.data.WorkbenchSearchItem
import ai.drsai.remote.data.WorkbenchArtifactItem
import ai.drsai.remote.data.DesktopHandoffUi
import ai.drsai.remote.data.LocalArtifactMaterializer
import ai.drsai.remote.data.localArtifactIntent
import ai.drsai.remote.data.SkillUiItem
import ai.drsai.remote.data.ConnectorUiItem
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.MAX_ATTACHMENT_TOTAL_BYTES
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.OidcLoginSession
import ai.drsai.remote.data.OidcTransactionStore
import ai.drsai.remote.data.OIDC_LEGACY_CLIENT_ID
import ai.drsai.remote.data.RuntimeDiagnosticUi
import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import ai.drsai.remote.data.ApiException
import ai.drsai.remote.runtime.python.requireRunSupport
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.data.PlatformAgentClient
import ai.drsai.remote.data.AndroidPlatformAgentStrings
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.sanitizeLegacyAssistantText
import ai.drsai.remote.data.localAgentFor
import ai.drsai.remote.data.selectLocalModelForAttachments
import ai.drsai.remote.data.retainDefaultHepaiModels
import ai.drsai.remote.data.orderPreferredDeepseekModels
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteSubscriptionRegistry
import ai.drsai.remote.remote.data.WorkspaceInstructionVersionStore
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.AssociationDeepLinkDecision
import ai.drsai.remote.remote.data.AssociationDeepLinkGate
import ai.drsai.remote.remote.navigation.WorkbenchDeepLinkParser
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.coordinator.ChatExecutionRouter
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.coordinator.DesktopHandoffPlanner
import ai.drsai.remote.runtime.coordinator.DesktopHandoffState
import ai.drsai.remote.runtime.coordinator.HandoffAttachment
import ai.drsai.remote.runtime.coordinator.HandoffPackage
import ai.drsai.remote.runtime.coordinator.HandoffPackageFactory
import ai.drsai.remote.runtime.coordinator.RuntimeCapabilityCodec
import ai.drsai.remote.runtime.coordinator.RuntimeDescriptor
import ai.drsai.remote.runtime.coordinator.JournaledChatExecutionCoordinator
import ai.drsai.remote.runtime.security.ApprovalBinding
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.security.ApprovalRepository
import ai.drsai.remote.runtime.security.CreateApprovalCommand
import ai.drsai.remote.runtime.security.RoomToolApprovalGateway
import ai.drsai.remote.runtime.device.SafeDeviceInfoProvider
import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.SafWorkspaceStore
import ai.drsai.remote.runtime.device.SafProjectInstructionPayload
import ai.drsai.remote.runtime.device.registerAndroidDeviceTools
import ai.drsai.remote.runtime.device.LocalRunNotificationController
import ai.drsai.remote.runtime.reliability.RunRecoveryScheduler
import ai.drsai.remote.runtime.reliability.ResourceRecord
import ai.drsai.remote.runtime.reliability.ResourceRetentionPolicy
import ai.drsai.remote.runtime.reliability.RuntimeFailureCatalog
import ai.drsai.remote.runtime.reliability.DiagnosticBundleFactory
import ai.drsai.remote.runtime.readiness.AgentReadiness
import ai.drsai.remote.runtime.readiness.AgentReadinessInput
import ai.drsai.remote.runtime.readiness.AgentReadinessPolicy
import ai.drsai.remote.runtime.readiness.localRunAdmission
import ai.drsai.remote.runtime.setup.SetupJourneyReducer
import ai.drsai.remote.runtime.setup.SharedPreferencesSetupJourneyStore
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.runtime.tools.RoomToolOutputArtifactSink
import ai.drsai.remote.runtime.tools.RoomToolAuditSink
import ai.drsai.remote.runtime.tools.SkillCatalog
import ai.drsai.remote.runtime.tools.SkillDefinition
import ai.drsai.remote.runtime.tools.SkillSource
import ai.drsai.remote.runtime.tools.BuiltInSkillBundleAttestation
import ai.drsai.remote.runtime.tools.SafUserSkillImporter
import ai.drsai.remote.runtime.tools.SharedPreferencesUserSkillPersistence
import ai.drsai.remote.runtime.tools.UserDeclarativeSkillRepository
import ai.drsai.remote.runtime.tools.apkSigningCertificateSha256
import ai.drsai.remote.runtime.tools.AndroidMcpToolManager
import ai.drsai.remote.runtime.tools.McpSecureConfigStore
import ai.drsai.remote.runtime.tools.McpServerEndpoint
import ai.drsai.remote.runtime.tools.McpConnectorScope
import ai.drsai.remote.runtime.tools.McpStreamableHttpClient
import ai.drsai.remote.workbench.data.WorkbenchApprovalEntity
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.UUID
import java.io.File
import java.io.IOException

private const val WORKBENCH_SESSION_PAGE_SIZE = 40
private const val WORKBENCH_SESSION_MAX_VISIBLE = 1_000

private data class PendingDesktopHandoffDraft(
    val sourceRunId: WorkbenchId,
    val handoffId: String,
    val targets: List<RuntimeDescriptor>,
    val prompt: String,
    val attachments: List<HandoffAttachment>,
    val kind: ai.drsai.remote.runtime.coordinator.DesktopHandoffKind,
    val resourceId: String?,
    val oaepRequest: ChatRunRequest,
    val target: RuntimeDescriptor? = null,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private fun text(resourceId: Int, vararg arguments: Any): String =
        getApplication<Application>().getString(resourceId, *arguments)
    private val tokenStore by lazy { SecureTokenStore(app) }
    private val deepLinkStore = app.getSharedPreferences("remote-notification-navigation", Application.MODE_PRIVATE)
    private val notificationNavigation = ai.drsai.remote.remote.data.RemoteNotificationNavigationReducer()
    private val oidcTransactions by lazy { OidcTransactionStore(app) }
    private val database by lazy {
        Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13, MIGRATION_13_14, MIGRATION_14_15, MIGRATION_15_16)
            .build()
    }
    private val oidcClient by lazy {
        OidcClient(
            refreshClientId = { tokenStore.oidcClientId },
            strings = ai.drsai.remote.data.AndroidOidcStrings(getApplication()),
        )
    }
    private val modelCredentialStore by lazy { ModelProviderStore(app) }
    private val modelProviderStore by lazy {
        ModelProviderRepository(
            database.modelProviderDao(),
            modelCredentialStore,
            modelCredentialStore::providers,
            ai.drsai.remote.data.AndroidModelProviderStoreStrings(getApplication()),
        )
    }
    private val modelClient by lazy { HaiModelClient(tokenStore, oidcClient, providerStore = modelProviderStore, strings = ai.drsai.remote.data.AndroidModelGatewayStrings(getApplication())) }
    private val modelProviderDraftClient by lazy { ModelProviderDraftClient(strings = ai.drsai.remote.data.AndroidProviderDraftStrings(getApplication())) }
    private val providerVerificationStore = ProviderVerificationStore(app)
    private val modelProviderSaveInFlight = SingleFlightGate()
    private var draftVerification: ProviderVerification? = null
    private val setupJourneyStore = SharedPreferencesSetupJourneyStore(app)
    private val platformAgentStrings by lazy { AndroidPlatformAgentStrings(getApplication()) }
    private val tokenCoordinator by lazy { AccessTokenCoordinator(tokenStore, oidcClient, platformAgentStrings) }
    private val relayDeviceProof by lazy { androidRelayDeviceProof(app) }
    private val relayDiscovery by lazy {
        HttpRelayDiscoveryService(
            BuildConfig.RELAY_BASE_URL,
            tokenCoordinator::current,
            tokenCoordinator::refreshAfter,
            deviceProof = relayDeviceProof,
        )
    }
    private val associationIssuer by lazy {
        java.net.URI(BuildConfig.RELAY_BASE_URL).let { "${it.scheme}://${it.host}" }
    }
    private val associationGate by lazy { AssociationDeepLinkGate(associationIssuer) }
    private val platformClient by lazy { PlatformAgentClient(tokenCoordinator, strings = platformAgentStrings) }
    private val agentRepository by lazy { AgentRepository(platformClient, database.dao(), platformAgentStrings) }
    private val platformRuntime by lazy { PlatformAgentRuntime(tokenCoordinator, database.dao(), strings = platformAgentStrings) }
    private val attachmentProcessor by lazy { AttachmentProcessor(app) }
    private val attachmentRepository by lazy { AttachmentRepository(tokenCoordinator, strings = ai.drsai.remote.data.AndroidAttachmentStrings(getApplication())) }
    private val safWorkspaceStore by lazy { SafWorkspaceStore(app) }
    private val memorySettings by lazy { MemorySettingsStore(app) }
    private val safWorkspaceGateway by lazy { SafWorkspaceGateway(app, safWorkspaceStore) }
    private val runNotifications by lazy { LocalRunNotificationController(app) }
    private val runRecoveryScheduler by lazy { RunRecoveryScheduler(WorkManager.getInstance(app)) }
    private val recoveryCenterRepository by lazy { ai.drsai.remote.runtime.reliability.RecoveryCenterRepository(database, strings = ai.drsai.remote.runtime.reliability.AndroidRecoveryCenterStrings(getApplication())) }
    private val productionToolRegistry by lazy {
        defaultLocalToolRegistry(
            database.dao(),
            RoomToolOutputArtifactSink(database.dao()),
            RoomToolAuditSink(database.workbenchDao()),
        ).also {
            registerAndroidDeviceTools(it, SafeDeviceInfoProvider(app), safWorkspaceGateway)
        }
    }
    private val localTools by lazy {
        ai.drsai.remote.data.LocalToolRegistry(
            database.dao(),
            productionToolRegistry,
            capabilities = ::fullLocalRuntimeCapabilities,
            approvals = RoomToolApprovalGateway(database, approvalRepository),
            strings = ai.drsai.remote.data.AndroidLocalToolExecutionStrings(getApplication()),
        )
    }
    private val mcpSecureConfigStore by lazy { McpSecureConfigStore(app) }
    private val mcpToolManager by lazy { AndroidMcpToolManager(productionToolRegistry, mcpSecureConfigStore) }
    private val workbenchProjection by lazy { WorkbenchProjectionRepository(database.workbenchDao()) }
    private val unifiedWorkbench by lazy { UnifiedWorkbenchRepository(database) }
    private val localOaepLegacyProjection by lazy {
        ai.drsai.remote.runtime.oaep.LocalOaepLegacyProjection(
            database,
            presentationStrings = ai.drsai.remote.remote.model.AndroidOaepPresentationStrings(getApplication()),
            runtimeStatusStrings = ai.drsai.remote.runtime.oaep.AndroidLegacyRuntimeStatusStrings(getApplication()),
        )
    }
    private val runtimeV2Recorder by lazy { RuntimeV2EventRecorder(RoomRunJournal(database)) }
    private val pythonRuntimeMetrics by lazy { ai.drsai.remote.runtime.python.SharedPreferencesPythonRuntimeMetrics(app) }
    private val androidRuntimeEnrollmentStore by lazy {
        ai.drsai.remote.runtime.oaep.EncryptedAndroidRuntimeEnrollmentStore(app)
    }
    private val androidOaepRelayManager by lazy {
        ai.drsai.remote.runtime.oaep.AndroidOaepRelayManager(
            app, database, androidRuntimeEnrollmentStore,
        )
    }
    private val pythonRuntimeClient by lazy { ai.drsai.remote.runtime.python.PythonRuntimeClient(app, pythonRuntimeMetrics) }
    private val fullRuntimeBinding by lazy {
        ai.drsai.remote.runtime.python.FullRuntimeBindingCoordinator(
            viewModelScope,
            pythonRuntimeClient,
            ai.drsai.remote.runtime.python.SharedPreferencesFullRuntimeBindingDiagnostics(app),
        )
    }
    private val pythonRuntimePreference by lazy {
        ai.drsai.remote.runtime.python.PythonRuntimePreferenceStore(app, BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED)
    }
    private val runtimePolicyClient by lazy {
        BuildConfig.RUNTIME_POLICY_PUBLIC_KEY.takeIf(String::isNotBlank)?.let { publicKey ->
            ai.drsai.remote.runtime.python.RuntimeRolloutPolicyClient(
                BuildConfig.RUNTIME_POLICY_URL,
                ai.drsai.remote.runtime.python.Ed25519RuntimePolicySignatureVerifier(publicKey),
                pythonRuntimePreference,
            )
        }
    }
    private val oaepNormalizedSink by lazy {
        ai.drsai.remote.runtime.oaep.RoomAndroidOaepRuntimeSink(
            ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore(database),
            sourceRuntimeId = { request ->
                androidRuntimeEnrollmentStore.load(request.accountSubject)?.runtimeId ?: when (request.authority) {
                    ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE -> "android-local"
                    else -> "hai-platform"
                }
            },
        )
    }
    private val pythonChatEngine by lazy {
        ai.drsai.remote.runtime.python.PythonSharedCoreChatEngine(
            bridge = pythonRuntimeClient,
            modelGateway = modelClient,
            dao = database.dao(),
            portsFactory = ai.drsai.remote.runtime.python.PythonHostPortsFactory { request ->
                val approvalGrants = ai.drsai.remote.runtime.python.PythonApprovalGrantTracker()
                ai.drsai.remote.runtime.python.PythonRuntimeHostPorts(
                    model = ai.drsai.remote.runtime.python.HaiPythonModelHostPort(modelClient) { modelId ->
                        mutableState.value.models.firstOrNull { it.id == modelId }?.let { selected ->
                            val wireApi = mutableState.value.modelProviders
                                .firstOrNull { it.id == selected.providerId }?.wireApi ?: "openai"
                            ai.drsai.remote.runtime.python.ModelRuntimeCapabilities.configured(selected, wireApi)
                        }
                    },
                    stateStore = ai.drsai.remote.runtime.python.OaepBoundPythonCheckpointStore(
                        database = database,
                        delegate = ai.drsai.remote.runtime.python.RoomPythonCheckpointStore(database),
                        subject = request.accountSubject,
                        organization = "",
                        runtimeId = "android-local",
                        sessionId = request.conversation.id,
                        runId = request.runId,
                    ),
                    tools = ai.drsai.remote.runtime.python.AndroidPythonToolHostPort(
                        ai.drsai.remote.runtime.python.LocalToolRegistryPythonExecutor(
                            localTools, request.accountSubject, request.runId, request.conversation.id, approvalGrants,
                        ),
                        riskResolver = { toolName -> localTools.risk(request.accountSubject, toolName) },
                    ),
                    approval = ai.drsai.remote.runtime.python.LocalToolRegistryPythonApprovalPort(
                        localTools, request.accountSubject, request.runId, request.conversation.id, approvalGrants,
                    ),
                    artifacts = ai.drsai.remote.runtime.python.ScopedPythonArtifactHostPort(
                        database.dao(), request.accountSubject, request.runId, request.conversation.id, request.attachments,
                    ),
                    lifecycle = ai.drsai.remote.runtime.python.AndroidPythonLifecycleHostPort(app),
                    audit = ai.drsai.remote.runtime.python.RoomPythonSideEffectAudit(database),
                )
            },
            toolSchemas = { subject ->
                val schemas = ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog.schemas(localTools.modelSchemas(subject))
                val inventory = ai.drsai.remote.runtime.readiness.CapabilityGuidancePolicy.project(
                    (0 until schemas.length()).map { schemas.getJSONObject(it).getString("name") },
                    strings = ai.drsai.remote.runtime.readiness.AndroidCapabilityGuidanceStrings(getApplication()),
                )
                ai.drsai.remote.runtime.readiness.CapabilityGuidancePolicy.modelVisibleSchemas(schemas, inventory)
            },
            skillSchemas = { request ->
                org.json.JSONArray(skillCatalog.select(request.runId, fullLocalRuntimeCapabilities(request.accountSubject), request.input).skills.map { skill ->
                    org.json.JSONObject()
                        .put("id", skill.id)
                        .put("version", skill.version)
                        .put("name", skill.displayName)
                        .put("source", skill.source.name.lowercase())
                        .put("digest", skill.digest)
                        .put("instructions", skill.instructions)
                        .put("tools", org.json.JSONArray(skill.allowedTools.sorted()))
                        .put("capabilities", org.json.JSONArray(skill.requiredCapabilities.map { it.name.lowercase() }))
                        .put("availability", when {
                            skill.executableOnAndroid || skill.source == SkillSource.USER_DECLARATIVE -> "local"
                            skill.source == SkillSource.PLATFORM || skill.source == SkillSource.REMOTE_READ_ONLY -> "remote-required"
                            else -> "unsupported"
                        })
                })
            },
            hostCapabilities = { subject ->
                org.json.JSONArray(fullLocalRuntimeCapabilities(subject).map { it.name.lowercase() }.sorted())
            },
            capabilityDiagnostics = { request ->
                val safGranted = safWorkspaceStore.hasReadGrant(request.accountSubject)
                ai.drsai.remote.runtime.python.RunCapabilityDiagnostics.snapshot(
                    safReadAvailable = safGranted,
                    safWriteAvailable = safGranted,
                    networkAvailable = androidNetworkAvailable(),
                    remoteRuntimeAvailable = false,
                )
            },
            projectInstructions = { request ->
                SafProjectInstructionPayload.authorized(
                    granted = safWorkspaceStore.hasReadGrant(request.accountSubject),
                ) { safWorkspaceGateway.projectInstructions(request.accountSubject) }
            },
            memoryEnabled = { request -> memorySettings.enabled(request.accountSubject) },
            onFailure = { },
            metrics = pythonRuntimeMetrics,
            normalizedSink = oaepNormalizedSink,
            readiness = fullRuntimeBinding,
            killSwitchSnapshot = { pythonRuntimePreference.killSwitchSnapshot() },
        )
    }
    private val chatExecution by lazy {
        ChatExecutionRouter(
            listOf(
                pythonChatEngine,
                ai.drsai.remote.runtime.oaep.OaepNormalizingChatEngine(
                    ai.drsai.remote.runtime.coordinator.PlatformChatEngine(platformRuntime), oaepNormalizedSink,
                ),
            )
        )
    }
    private val journaledChatExecution by lazy { JournaledChatExecutionCoordinator(chatExecution, runtimeV2Recorder) }
    private val skillCatalog = SkillCatalog()
    private val userSkillRepository by lazy {
        UserDeclarativeSkillRepository(SharedPreferencesUserSkillPersistence(app))
    }
    private val userSkillImporter by lazy { SafUserSkillImporter(app, userSkillRepository) }
    @Volatile private var builtInSkillAttestation: BuiltInSkillBundleAttestation? = null
    private val approvalRepository by lazy {
        ApprovalRepository(
            database,
            previewStrings = ai.drsai.remote.runtime.security.AndroidApprovalPreviewStrings(getApplication()),
        )
    }
    private val mutableState = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutableState.asStateFlow()

    private var loginJob: Job? = null
    private var pendingAssociationCode: String? = null
    private var associationJob: Job? = null
    private var oidcSession: OidcLoginSession? = null
    private var runJob: Job? = null
    private var approvalJob: Job? = null
    private var workbenchSearchJob: Job? = null
    private var workbenchSearchGeneration: Long = 0
    private var activeRunId: String? = null
    private var activeOaepRequest: ChatRunRequest? = null
    @Volatile private var cancelInProgress = false
    private var activeRunAuthority: RuntimeAuthority = RuntimeAuthority.LOCAL_DEVICE
    private var recoverableRun: RunCheckpoint? = null
    private var pendingApprovalEntities: Map<String, WorkbenchApprovalEntity> = emptyMap()
    private var pendingDesktopHandoffDraft: PendingDesktopHandoffDraft? = null
    private var confirmedDesktopHandoff: HandoffPackage? = null
    private var networkRunContinuity: ai.drsai.remote.runtime.reliability.NetworkRunContinuity? = null
    private val networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: android.net.Network) { refreshLiveCapabilityState(); refreshActiveRunNetworkState() }
        override fun onLost(network: android.net.Network) { refreshLiveCapabilityState(); refreshActiveRunNetworkState() }
        override fun onCapabilitiesChanged(network: android.net.Network, capabilities: android.net.NetworkCapabilities) {
            refreshLiveCapabilityState(); refreshActiveRunNetworkState()
        }
    }
    private val databaseFailureHandler = CoroutineExceptionHandler { _, error ->
        val diagnostic = ai.drsai.remote.runtime.security.SensitiveDataRedactor.redact(
            error.message ?: error::class.java.simpleName,
        ).take(400)
        update {
            it.copy(
                loading = false,
                streaming = false,
                runtimeStatus = null,
                error = text(R.string.local_data_upgrade_failed, diagnostic),
            )
        }
    }

    init {
        viewModelScope.launch {
            fullRuntimeBinding.state.collect(::publishFullRuntimeDiagnostic)
        }
        viewModelScope.launch(Dispatchers.IO) { attachmentProcessor.cleanupOrphans() }
        getApplication<Application>().getSystemService(android.net.ConnectivityManager::class.java)
            ?.registerDefaultNetworkCallback(networkCallback)
        bootstrap()
    }

    private fun refreshLiveCapabilityState() {
        viewModelScope.launch {
            publishFullRuntimeDiagnostic(fullRuntimeBinding.state.value)
        }
    }

    private fun refreshActiveRunNetworkState() {
        val continuity = networkRunContinuity ?: return
        val manager = getApplication<Application>().getSystemService(android.net.ConnectivityManager::class.java)
        val capabilities = manager?.activeNetwork?.let(manager::getNetworkCapabilities)
        val kind = when {
            capabilities == null || !capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) ->
                ai.drsai.remote.runtime.reliability.RunNetworkKind.OFFLINE
            !capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) ->
                ai.drsai.remote.runtime.reliability.RunNetworkKind.RESTRICTED
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) ->
                ai.drsai.remote.runtime.reliability.RunNetworkKind.CELLULAR
            else -> ai.drsai.remote.runtime.reliability.RunNetworkKind.WIFI
        }
        val snapshot = runCatching { continuity.observe(kind, System.currentTimeMillis()) }.getOrNull() ?: return
        if (snapshot.phase != ai.drsai.remote.runtime.reliability.NetworkRunPhase.ONLINE) {
            update { it.copy(runtimeStatus = snapshot.userMessage) }
        }
    }

    private fun update(transform: (AppState) -> AppState) {
        mutableState.update { previous ->
            val next = transform(previous)
            if (next.error != previous.error && next.diagnostic == previous.diagnostic) {
                next.copy(diagnostic = null)
            } else next
        }
    }

    fun bootstrap() = viewModelScope.launch(Dispatchers.IO) {
        update { it.copy(
            destination = AppDestination.Splash,
            error = null,
            requestedRoutePath = it.requestedRoutePath
                ?: deepLinkStore.getString("route_path", null),
            requestedRemoteItemId = it.requestedRemoteItemId
                ?: deepLinkStore.getString("item_id", null),
        ) }
        runtimePolicyClient?.refresh() ?: pythonRuntimePreference.clearPolicy()
        val policyDiagnostic = pythonRuntimePreference.policyDiagnostic()
        update { state -> state.copy(runtimePolicyDiagnostic = policyDiagnostic?.let {
            ai.drsai.remote.data.RuntimePolicyDiagnosticUi(
                it.status, it.policyVersion, it.reason, it.rolloutPercent,
                it.emergencyDisabled, it.recordedAtEpochSeconds,
            )
        }) }
        val user = tokenStore.user()
        notificationNavigation.accept(
            ai.drsai.remote.remote.data.RemoteNotificationNavigationEvent.ProcessStarted(
                authenticated = !tokenStore.accessToken.isNullOrBlank() && user != null,
                locked = false,
            )
        )
        if (tokenStore.accessToken.isNullOrBlank() || user == null) {
            update { it.copy(destination = AppDestination.Login) }
            return@launch
        }
        // Tokens created by versions before native redirect support always used the desktop client.
        if (tokenStore.oidcClientId.isNullOrBlank()) tokenStore.oidcClientId = OIDC_LEGACY_CLIENT_ID
        loadWorkspace(user)
    }

    fun login() {
        if (loginJob?.isActive == true) return
        loginJob = viewModelScope.launch {
            update { it.copy(
                destination = AppDestination.Login,
                loading = true,
                waitingForLogin = false,
                loginUrl = null,
                error = null,
            ) }
            runCatching { oidcClient.startLogin() }
                .onSuccess { session ->
                    oidcSession = session
                    if (session.usesNativeRedirect) oidcTransactions.save(session.transaction)
                    update { it.copy(loading = false, waitingForLogin = true, loginUrl = session.authorizationUrl) }
                    if (!session.usesNativeRedirect) completeOidcLogin(session)
                }
                .onFailure { error -> update { it.copy(loading = false, waitingForLogin = false, error = error.message) } }
        }
    }

    fun loginUrlOpened() = update { it.copy(loginUrl = null) }

    fun handleOidcRedirect(uri: Uri?) {
        if (uri == null || !uri.scheme.equals("ai.drsai.remote", ignoreCase = true) || uri.path != "/oauth2redirect") return
        val transaction = oidcTransactions.load()
        if (transaction == null) {
            if (mutableState.value.user != null) return
            update {
                it.copy(
                    destination = AppDestination.Login,
                    loading = false,
                    waitingForLogin = false,
                    error = text(R.string.login_state_lost),
                )
            }
            return
        }
        loginJob?.cancel()
        loginJob = viewModelScope.launch {
            update { it.copy(destination = AppDestination.Login, loading = true, waitingForLogin = true, error = null) }
            val session = oidcSession?.takeIf { it.transaction == transaction }
                ?: oidcClient.restoreSession(transaction)
            completeOidcLogin(session, uri)
        }
    }

    private suspend fun completeOidcLogin(session: OidcLoginSession, redirect: Uri? = null) {
        runCatching { oidcClient.finishLogin(session, redirect) }
            .onSuccess { auth ->
                oidcTransactions.clear()
                oidcSession = null
                tokenStore.save(auth)
                tokenStore.oidcClientId = session.transaction.clientId
                AndroidDevicePresence.authenticationChanged()
                notificationNavigation.accept(
                    ai.drsai.remote.remote.data.RemoteNotificationNavigationEvent.LoginCompleted
                )
                loadWorkspace(auth.user)
                consumePendingAssociation()
            }
            .onFailure { error ->
                oidcTransactions.clear()
                oidcSession = null
                update { it.copy(loading = false, waitingForLogin = false, loginUrl = null, error = error.message) }
            }
    }

    fun cancelLogin() {
        oidcClient.cancel(oidcSession)
        oidcTransactions.clear()
        loginJob?.cancel()
        loginJob = null
        oidcSession = null
        update { it.copy(loading = false, waitingForLogin = false, loginUrl = null, error = text(R.string.login_cancelled)) }
    }

    private fun loadWorkspace(user: ai.drsai.remote.data.User) = viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
        update { it.copy(destination = AppDestination.Chat, user = user, loading = true, waitingForLogin = false, error = null) }
        runCatching { fullRuntimeBinding.bind(user.id) }.onFailure { error ->
            val runtimeLabel = if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) "Android Full Agent Runtime" else "Android Agent Runtime Preview"
                update { it.copy(runtimeStatus = text(R.string.runtime_unavailable_reason, runtimeLabel, error.message.orEmpty().take(160))) }
        }
        val modelResult = runCatching { modelClient.listModels() }
        val catalog = agentRepository.load(user.id)
        modelProviderStore.ensureBuiltIns(BuildConfig.MODEL_BASE_URL)
        val persisted = modelProviderStore.snapshot()
        val customProviders = verifiedProviders(persisted.first, persisted.second)
        val hepaiModels = retainDefaultHepaiModels(modelResult.getOrDefault(emptyList()))
            .map { it.copy(providerId = "hepai") }
        val configuredModels = persisted.first.filter { it.id != "hepai" }.flatMap { provider ->
            orderPreferredDeepseekModels(persisted.second.filter { it.providerId == provider.id && it.enabled })
        }
        val models = hepaiModels + configuredModels
        val selected = ModelRecommendationPolicy.select(models, customProviders, tokenStore.selectedModelId)
        selected?.let { tokenStore.selectedModelId = it.id }
        val localAgent = configuredLocalAgent(user.id, models)
        val agents = listOf(localAgent) + catalog.agents
        val entities = database.dao().conversationSnapshot(user.id)
        workbenchProjection.projectLocalConversations(user.id, entities)
        runCatching { androidOaepRelayManager.startForOwner(user.id) }
        val workbenchTree = loadWorkbenchTree(user.id)
        refreshSkillCatalog(agents, hasRemoteWorkspace = workbenchTree.any { !it.local })
        val archivedSessions = loadArchivedSessions(user.id)
        val memories = database.dao().memorySnapshot(user.id).map { MemoryUiItem(it.id, it.content) }
        val artifacts = loadWorkbenchArtifacts(user.id)
        val conversations = loadConversations(user.id, entities)
        val current = conversations.firstOrNull()
        val messages = current?.let { loadMessages(user.id, it.id) }.orEmpty()
        val oaepUi = current?.let { loadOaepUi(user.id, it.id) }
        val pythonCheckpointStore = ai.drsai.remote.runtime.python.RoomPythonCheckpointStore(database)
        val recoveredRuns = runtimeV2Recorder.recover(user.id).mapNotNull { checkpoint ->
            val isInterruptedLocal = checkpoint.command.binding.authority == RuntimeAuthority.LOCAL_DEVICE &&
                checkpoint.status == ai.drsai.remote.workbench.model.WorkbenchRunStatus.PAUSED
            val pythonCheckpoint = if (isInterruptedLocal) runCatching {
                pythonCheckpointStore.loadCheckpoint(checkpoint.command.runId.value)
            } else null
            val incompatibleFailure = pythonCheckpoint?.exceptionOrNull()?.let {
                ai.drsai.remote.runtime.python.PythonCheckpointMigrationPolicy.terminalFailureCode(it)
                    ?: throw it
            }
            if (isInterruptedLocal && (pythonCheckpoint?.getOrNull() == null || incompatibleFailure != null)) {
                // v1.5.5 Kotlin-Lite checkpoints have no shared-Core state/receipt watermark.
                // Known corrupt/future Full Runtime checkpoints are also terminal: neither
                // category may replay a side effect under a different runtime contract.
                runtimeV2Recorder.failUnrecoverable(
                    checkpoint.command.runId,
                    incompatibleFailure ?: "legacy_kotlin_checkpoint_unrecoverable",
                )
                null
            } else checkpoint
        }
        recoveredRuns.forEach { runRecoveryScheduler.schedule(user.id, it.command.runId) }
        val recoveryRuns = recoveryCenterRepository.candidates(user.id, System.currentTimeMillis())
        update { state -> state.copy(recoveryRuns = recoveryRuns) }
        pruneRuntimeCaches(user.id, recoveredRuns.map { it.command.runId.value }.toSet())
        recoverableRun = current?.let { selected ->
            recoveredRuns.lastOrNull { it.command.sessionId.value == selected.id }
        }
        val approvals = approvalRepository.pending(user.id)
        pendingApprovalEntities = approvals.associateBy(WorkbenchApprovalEntity::approvalId)
        approvalJob?.cancel()
        approvalJob = viewModelScope.launch(Dispatchers.IO) {
            database.workbenchDao().pendingApprovalsFlow(user.id).collect { pending ->
                pendingApprovalEntities = pending.associateBy(WorkbenchApprovalEntity::approvalId)
                update { state -> state.copy(pendingApprovals = pending.map { it.toApprovalUiItem() }) }
            }
        }
        val selectedAgent = current?.let { conversation ->
            agents.firstOrNull { it.id == conversation.agentId } ?: Agent(
                id = conversation.agentId,
                name = conversation.agentName,
                source = conversation.agentSource,
                mode = conversation.agentSource,
                available = false,
                chatSupported = false,
                        description = text(R.string.session_agent_missing_from_catalog),
            )
        }
            ?: tokenStore.selectedAgentId?.let { saved -> agents.firstOrNull { it.id == saved } }
            ?: agents.firstOrNull { it.isDefault && it.chatSupported }
            ?: localAgent
        tokenStore.selectedAgentId = selectedAgent.id
        val modelError = if (selected == null && selectedAgent.source == "local") {
                    modelResult.exceptionOrNull()?.message ?: text(R.string.no_hai_model_local_unavailable)
        } else null
        update {
            it.copy(
                agents = agents,
                selectedAgent = selectedAgent,
                models = models,
                modelProviders = customProviders.map { provider ->
                    if (provider.id == "hepai") provider.copy(modelIds = models.filter { it.providerId == "hepai" }.map { it.id }) else provider
                },
                configuredProviderModels = persisted.second,
                selectedModel = selected,
                conversations = conversations,
                currentConversation = current,
                messages = messages,
                oaepTranscript = oaepUi?.entries.orEmpty(),
                oaepTimeline = oaepUi?.timeline.orEmpty(),
                oaepRunStatus = oaepUi?.runStatus,
                oaepActiveRunId = oaepUi?.activeRunId,
                oaepSnapshotSequence = oaepUi?.snapshotSequence ?: 0,
                agentCatalogStatus = catalog.status,
                loading = false,
                error = oaepUi?.errorMessage ?: modelError,
                    runtimeStatus = oaepUi?.runtimeStatus ?: recoverableRun?.let { text(R.string.paused_task_found_retry) },
                recovering = oaepUi?.recovering ?: false,
                pendingApprovals = approvals.map { it.toApprovalUiItem() },
                localWorkspaceGranted = safWorkspaceStore.hasReadGrant(user.id),
                localWorkspaceName = safWorkspaceStore.displayName(user.id),
                workbenchWorkspaces = workbenchTree,
                memories = memories,
                memoryEnabled = memorySettings.enabled(user.id),
                archivedSessions = archivedSessions,
                workbenchArtifacts = artifacts,
                skills = skillUiItems(user.id),
                connectors = connectorUiItems(user.id),
            )
        }
        publishProductReadiness(user.id)
        if (oaepUi == null) update { state -> state.copy(runtimeStatus = recoverableRun?.let(::recoveryUiStatus)) }
        restoreMcpConnectors(user.id)
        // Full Runtime initialization and workspace hydration are both allocation
        // heavy one-shot phases. Release their temporary graphs once the stable UI
        // state has been published so the main + :runtime foreground budget is met.
        System.gc()
        viewModelScope.launch {
            kotlinx.coroutines.delay(5_000)
            System.gc()
        }
    }

    fun handleDeepLink(uri: Uri?) {
        val route = uri?.toString()?.let(WorkbenchDeepLinkParser::route) ?: return
        val rawItemId = uri.getQueryParameter("item_id")
        val itemId = rawItemId?.takeIf {
            it.matches(Regex("^[A-Za-z0-9_.:-]{1,200}$")) && it != "." && it != ".."
        }
        if (rawItemId != null && itemId == null) return
        notificationNavigation.accept(
            ai.drsai.remote.remote.data.RemoteNotificationNavigationEvent.Received(route.path, itemId)
        )
        check(deepLinkStore.edit().putString("route_path", route.path)
            .putString("item_id", itemId).commit()) { "remote_notification_navigation_write_failed" }
        update { it.copy(requestedRoutePath = route.path, requestedRemoteItemId = itemId) }
    }

    fun handleAssociationDeepLink(uri: Uri?) {
        if (uri == null || uri.scheme != "opendrsai" || uri.host != "associate") return
        val code = when (val decision = associationGate.evaluate(uri.toString())) {
            is AssociationDeepLinkDecision.Accept -> decision.code
            AssociationDeepLinkDecision.Duplicate -> return
            AssociationDeepLinkDecision.Reject -> {
                update { state ->
                    state.copy(
                        associationState = AssociationState.FAILED,
                    error = text(R.string.invalid_association_qr),
                    )
                }
                return
            }
        }
        pendingAssociationCode = code
        if (tokenStore.user() == null || tokenStore.accessToken.isNullOrBlank()) {
            update {
                it.copy(
                    destination = AppDestination.Login,
                    associationState = AssociationState.PENDING_LOGIN,
                )
            }
            return
        }
        consumePendingAssociation()
    }

    private fun consumePendingAssociation() {
        val code = pendingAssociationCode ?: return
        if (associationJob?.isActive == true) return
        associationJob = viewModelScope.launch(Dispatchers.IO) {
            update { it.copy(associationState = AssociationState.ASSOCIATING, error = null) }
            runCatching { relayDiscovery.associate(code) }
                .onSuccess { runtimeId ->
                    runCatching { relayDiscovery.recordPresence(runtimeId) }
                    pendingAssociationCode = null
                    update {
                        it.copy(
                            associationState = AssociationState.ASSOCIATED,
                            requestedRoutePath = ai.drsai.remote.remote.navigation.AppRoute.RemoteHome.path,
                        )
                    }
                }
                .onFailure { failure ->
                    if (failure is RelayHttpException && failure.status == 401) {
                        update {
                            it.copy(
                                destination = AppDestination.Login,
                                associationState = AssociationState.AUTH_REQUIRED,
                            error = text(R.string.remote_error_sign_in_expired),
                            )
                        }
                    } else {
                        pendingAssociationCode = null
                        update {
                            it.copy(
                                associationState = AssociationState.FAILED,
                            error = text(R.string.remote_association_failed_refresh_qr),
                            )
                        }
                    }
                }
        }
    }

    fun consumeRequestedRoute(focusedItemId: String? = null) {
        val current = mutableState.value
        val route = current.requestedRoutePath?.let(ai.drsai.remote.remote.navigation.AppRoute::parse)
        if (route is ai.drsai.remote.remote.navigation.AppRoute.RemoteSession &&
            current.requestedRemoteItemId != null
        ) {
            require(focusedItemId == current.requestedRemoteItemId) {
                "remote_notification_focus_required"
            }
            notificationNavigation.accept(
                ai.drsai.remote.remote.data.RemoteNotificationNavigationEvent.ItemFocused(focusedItemId)
            )
        }
        check(deepLinkStore.edit().clear().commit()) { "remote_notification_navigation_clear_failed" }
        update { it.copy(requestedRoutePath = null, requestedRemoteItemId = null) }
    }

    fun send(text: String) = sendMessage(text)

    fun skipSetupJourney() {
        val user = mutableState.value.user ?: return
        val next = SetupJourneyReducer.skip(mutableState.value.setupJourney, System.currentTimeMillis())
        setupJourneyStore.save(user.id, next)
        update { it.copy(setupJourney = next) }
    }
    private val fullRuntimeSmokeStore by lazy {
        ai.drsai.remote.runtime.python.FullRuntimeSmokeStore(app)
    }
    private val fullRuntimeSmokeRunner by lazy {
        ai.drsai.remote.runtime.python.FullRuntimeSmokeRunner(
            pythonRuntimeClient,
            ai.drsai.remote.runtime.python.HaiPythonModelHostPort(modelClient) { modelId ->
                mutableState.value.models.firstOrNull { it.id == modelId }?.let { selected ->
                    val wireApi = mutableState.value.modelProviders
                        .firstOrNull { it.id == selected.providerId }?.wireApi ?: "openai"
                    ai.drsai.remote.runtime.python.ModelRuntimeCapabilities.configured(selected, wireApi)
                }
            },
        )
    }

    fun resumeSetupJourney() {
        val user = mutableState.value.user ?: return
        val readiness = calculateAgentReadiness(mutableState.value)
        val next = SetupJourneyReducer.resume(mutableState.value.setupJourney, readiness, System.currentTimeMillis())
        setupJourneyStore.save(user.id, next)
        update { it.copy(agentReadiness = readiness, setupJourney = next) }
    }

    fun runFullRuntimeSmoke() {
        val snapshot = mutableState.value
        val subject = snapshot.user?.id ?: return
        val model = snapshot.selectedModel ?: return
        val provider = snapshot.modelProviders.firstOrNull { it.id == model.providerId } ?: return
        val identity = fullRuntimeSmokeIdentity(subject, provider, model)
        update { it.copy(runtimeStatus = text(R.string.checking_agent_features), error = null) }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            runCatching {
                fullRuntimeBinding.bind(subject)
                val report = fullRuntimeSmokeRunner.run(model.id)
                require(report.passed) { "full_runtime_smoke_incomplete" }
                fullRuntimeSmokeStore.saveVerified(identity, report, System.currentTimeMillis())
                report
            }.onSuccess {
                update { it.copy(runtimeStatus = text(R.string.agent_features_check_passed)) }
                publishProductReadiness(subject)
            }.onFailure { error ->
                update { it.copy(
                    runtimeStatus = null,
                    error = modelConfigurationError(error, text(R.string.agent_features_check_failed)),
                ) }
                publishProductReadiness(subject)
            }
        }
    }

    fun decideDesktopHandoff(confirmed: Boolean) {
        val draft = pendingDesktopHandoffDraft
        if (draft == null) {
            update { it.copy(pendingDesktopHandoff = null) }
            return
        }
        if (!confirmed) {
            pendingDesktopHandoffDraft = null
            viewModelScope.launch(Dispatchers.IO) {
                runCatching {
                    persistOaepEvents(
                        draft.oaepRequest, "handoff-declined:${draft.handoffId}",
                        ai.drsai.remote.runtime.coordinator.DesktopHandoffOaep.declined(
                            draft.sourceRunId.value, draft.handoffId,
                        ),
                    )
                    refreshOaepUi(draft.oaepRequest.accountSubject, draft.oaepRequest.conversation.id)
                }.onSuccess {
                    update { it.copy(pendingDesktopHandoff = null) }
                }.onFailure { error ->
                    update { it.copy(error = error.message ?: "handoff_oaep_persist_failed") }
                }
            }
            return
        }
        val target = draft.target ?: run {
            update { it.copy(error = text(R.string.choose_online_computer_first)) }
            return
        }
        pendingDesktopHandoffDraft = null
        val handoffPackage = HandoffPackageFactory.create(
            draft.sourceRunId, target.binding.runtimeId, draft.prompt, emptyList(), draft.attachments,
            confirmed = true, kind = draft.kind, resourceId = draft.resourceId,
        )
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                persistOaepEvents(
                    draft.oaepRequest, "handoff-accepted:${draft.handoffId}",
                    ai.drsai.remote.runtime.coordinator.DesktopHandoffOaep.accepted(
                        draft.sourceRunId.value, draft.handoffId, handoffPackage,
                    ),
                )
                refreshOaepUi(draft.oaepRequest.accountSubject, draft.oaepRequest.conversation.id)
            }.onSuccess {
                confirmedDesktopHandoff = handoffPackage
                update { state -> state.copy(
                    pendingDesktopHandoff = null,
                    requestedRoutePath = ai.drsai.remote.remote.navigation.AppRoute.RemoteHome.path,
                    requestedRemoteItemId = target.binding.runtimeId.value,
                    fullRuntimeDiagnostic = state.fullRuntimeDiagnostic.copy(route = "Desktop Handoff"),
                    runtimeStatus = text(R.string.desktop_handoff_created_choose_workspace, handoffPackage.digest.take(12)),
                ) }
            }.onFailure { error ->
                update { it.copy(error = error.message ?: "handoff_oaep_persist_failed") }
            }
        }
    }

    fun selectDesktopHandoffTarget(runtimeId: String) {
        val draft = pendingDesktopHandoffDraft ?: return
        val target = runCatching {
            ai.drsai.remote.runtime.coordinator.DesktopHandoffTargetSelector.select(draft.targets, runtimeId)
        }.getOrNull() ?: return
        pendingDesktopHandoffDraft = draft.copy(target = target)
        update { state -> state.copy(
            error = null,
            pendingDesktopHandoff = state.pendingDesktopHandoff?.copy(
                targetRuntimeId = runtimeId, targetName = target.displayName,
            ),
        ) }
    }

    private suspend fun interceptDesktopExclusiveRequest(
        subject: String, prompt: String, drafts: List<AttachmentDraft>, oaepRequest: ChatRunRequest,
    ): Boolean {
        val remotes = database.remoteDao().runtimes(subject, "").map { row ->
            RuntimeDescriptor(
                RuntimeBinding(WorkbenchId(row.runtimeId), RuntimeAuthority.REMOTE_RUNTIME),
                row.displayName, row.version,
                row.connectionState.lowercase() in setOf("online", "connected", "ready"),
                RuntimeCapabilityCodec.decode(row.capabilitiesJson),
            )
        }
        val decision = DesktopHandoffPlanner.plan(
            prompt,
            remotes,
            ai.drsai.remote.runtime.coordinator.AndroidHybridRuntimeStrings(getApplication()),
        )
        if (decision.state != DesktopHandoffState.NOT_REQUIRED &&
            pythonRuntimePreference.killSwitchSnapshot().isDisabled(
                ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitch.REMOTE_HANDOFF,
            )
        ) {
            update { it.copy(
                streaming = false,
                runtimeStatus = null,
                error = "android_full_runtime_remote_handoff_disabled",
            ) }
            return true
        }
        return when (decision.state) {
            DesktopHandoffState.NOT_REQUIRED -> false
            DesktopHandoffState.UNAVAILABLE -> {
                update { it.copy(streaming = false, runtimeStatus = null, error = decision.message) }
                true
            }
            DesktopHandoffState.OFFER -> {
                val targets = decision.targets
                require(targets.isNotEmpty()) { "handoff_targets_required" }
                val id = UUID.randomUUID().toString()
                pendingDesktopHandoffDraft = PendingDesktopHandoffDraft(
                    sourceRunId = WorkbenchId(oaepRequest.runId), handoffId = id, targets = targets, prompt = prompt,
                    attachments = drafts.map { attachment ->
                        require(attachment.sha256.matches(Regex("^[a-fA-F0-9]{64}$"))) {
                            "handoff_attachment_digest_invalid:${attachment.id}"
                        }
                        HandoffAttachment(attachment.id, attachment.sha256, attachment.mimeType, attachment.size)
                    }, kind = decision.kind, resourceId = decision.resourceId, oaepRequest = oaepRequest,
                )
                persistOaepEvents(
                    oaepRequest, "handoff-offered:$id",
                    ai.drsai.remote.runtime.coordinator.DesktopHandoffOaep.offered(
                        oaepRequest.runId, id, decision,
                    ),
                )
                refreshOaepUi(subject, oaepRequest.conversation.id)
                update { it.copy(
                    streaming = false, runtimeStatus = null, error = null,
                    pendingDesktopHandoff = DesktopHandoffUi(
                        id, null, null,
                        decision.required.map { value -> value.name }.sorted(), decision.message,
                        executionLocation = decision.executionLocation,
                        transport = if (decision.kind == ai.drsai.remote.runtime.coordinator.DesktopHandoffKind.MCP_STDIO) "stdio" else null,
                        resourceId = decision.resourceId,
                        targets = targets.map { ai.drsai.remote.data.DesktopHandoffTargetUi(
                            it.binding.runtimeId.value, it.displayName, it.online,
                        ) },
            transferSummary = text(R.string.handoff_transfer_detail, drafts.size),
                    ),
                ) }
                true
            }
        }
    }

    fun decideApproval(id: String, decision: ApprovalDecision) {
        val user = mutableState.value.user ?: return
        val entity = pendingApprovalEntities[id] ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val binding = ApprovalBinding(
                WorkbenchId(entity.runId), entity.toolCallId, entity.operation,
                entity.argumentsDigest, entity.scope,
            )
            val command = CreateApprovalCommand(
                user.id, entity.organization, WorkbenchId(entity.runtimeId), WorkbenchId(entity.sessionId),
                WorkbenchId(entity.approvalId), binding, entity.expiresAt.toLongOrNull() ?: Long.MAX_VALUE,
            )
            runCatching { approvalRepository.decide(command, decision, System.currentTimeMillis()) }
            .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.approval_failed)) } }
            refreshApprovals(user.id)
        }
    }

    fun grantLocalWorkspace(uri: Uri) {
        val user = mutableState.value.user ?: return
        val pendingRunId = mutableState.value.workspaceAuthorization.runId
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { safWorkspaceStore.grant(user.id, uri) }
                .onSuccess {
                    val local = configuredLocalAgent(user.id, mutableState.value.models)
                    update { state ->
                        state.copy(
                            agents = state.agents.map { if (it.source == "local") local else it },
                            selectedAgent = if (state.selectedAgent?.source == "local") local else state.selectedAgent,
                            localWorkspaceGranted = true,
                            localWorkspaceName = safWorkspaceStore.displayName(user.id),
                            error = null,
                            capabilityRepair = null,
                            workspaceAuthorization = state.workspaceAuthorization.granted(),
                        )
                    }
                    refreshLiveCapabilityState()
                    pendingRunId?.let { pending ->
                        runtimeV2Recorder.recover(user.id)
                            .firstOrNull { it.command.runId.value == pending }
                            ?.let { continueRunFromNotification(user.id, pending, it.command.sessionId.value) }
                    }
                }
            .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.local_workspace_authorization_failed)) } }
        }
    }

    fun clearLocalWorkspace() {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            safWorkspaceStore.clear(user.id)
            val local = configuredLocalAgent(user.id, mutableState.value.models)
            update { state ->
                state.copy(
                    agents = state.agents.map { if (it.source == "local") local else it },
                    selectedAgent = if (state.selectedAgent?.source == "local") local else state.selectedAgent,
                    localWorkspaceGranted = false,
                    localWorkspaceName = null,
                )
            }
            refreshLiveCapabilityState()
        }
    }

    fun addAttachment(uri: Uri, fallbackName: String? = null) {
        val snapshot = mutableState.value
        if (snapshot.streaming) return
        if (snapshot.attachmentDrafts.size >= MAX_ATTACHMENTS) {
            update { it.copy(error = text(R.string.max_five_attachments)) }
            return
        }
        viewModelScope.launch {
            runCatching { attachmentProcessor.prepare(uri, fallbackName) }
                .onSuccess { draft ->
                    val current = mutableState.value.attachmentDrafts
                    if (current.sumOf(AttachmentDraft::size) + draft.size > MAX_ATTACHMENT_TOTAL_BYTES) {
                        attachmentProcessor.delete(draft)
            update { it.copy(error = text(R.string.attachment_total_limit)) }
                    } else if (current.any { it.sha256 == draft.sha256 }) {
                        attachmentProcessor.delete(draft)
            update { it.copy(error = text(R.string.attachment_already_added)) }
                    } else {
                        update { it.copy(attachmentDrafts = it.attachmentDrafts + draft, error = null) }
                    }
                }
            .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.attachment_read_failed)) } }
        }
    }

    fun removeAttachment(id: String) {
        val draft = mutableState.value.attachmentDrafts.firstOrNull { it.id == id } ?: return
        update { it.copy(attachmentDrafts = it.attachmentDrafts.filterNot { item -> item.id == id }) }
        attachmentProcessor.delete(draft)
        draft.remoteId?.let { remote -> viewModelScope.launch { runCatching { attachmentRepository.delete(remote) } } }
    }

    fun retryAttachment(id: String) = update { state ->
        state.copy(
            attachmentDrafts = state.attachmentDrafts.map {
                if (it.id == id) it.copy(status = AttachmentStatus.READY, progress = 0, error = null, remoteId = null) else it
            },
            error = null,
        )
    }

    private fun sendMessage(
        text: String,
        resumeCheckpoint: RunCheckpoint? = null,
        resumedAttachments: List<MessageAttachment> = emptyList(),
    ) {
        val clean = text.trim()
        val snapshot = mutableState.value
        val user = snapshot.user ?: return
        val agent = snapshot.selectedAgent ?: return
        val drafts = snapshot.attachmentDrafts
        val hasImages = drafts.any { it.kind == "image" } || resumedAttachments.any { it.kind == "image" }
        val model = when {
            agent.source != "local" -> snapshot.selectedModel
            else -> selectLocalModelForAttachments(
                snapshot.models,
                snapshot.selectedModel,
                snapshot.currentConversation?.modelId,
                hasImages,
            )
        }
        if ((clean.isEmpty() && drafts.isEmpty() && resumedAttachments.isEmpty()) || snapshot.streaming ||
            (snapshot.recovering && resumeCheckpoint == null)) return
        if (agent.source == "local" && resumeCheckpoint == null) {
            val readiness = calculateAgentReadiness(snapshot)
            if (readiness.localRunAdmission() == ai.drsai.remote.runtime.readiness.LocalRunAdmission.DEFER_WITHOUT_RUN) {
                update { it.copy(agentReadiness = readiness, runtimeStatus = readiness.summary, error = null) }
                return
            }
            refreshLiveCapabilityState()
        }
        if (!agent.available || !agent.chatSupported) {
            update { it.copy(error = text(R.string.agent_android_chat_unsupported, agent.name)) }
            return
        }
        if (agent.source == "local" && model == null) {
            val message = if (hasImages) text(R.string.no_vision_model_for_images) else text(R.string.no_hai_model_local_unavailable)
            update { it.copy(error = message) }
            return
        }
        if (clean.length > 16_000) {
            update { it.copy(error = text(R.string.message_character_limit)) }
            return
        }
        if (drafts.isNotEmpty() && agent.source == "platform" && "attachment-upload" !in snapshot.agentCatalogStatus.capabilities) {
            update { it.copy(error = text(R.string.hai_attachment_upload_unavailable)) }
            return
        }
        if ((drafts.any { it.kind == "image" } || resumedAttachments.any { it.kind == "image" }) && "image-input" !in agent.capabilities) {
            update { it.copy(error = text(R.string.agent_image_input_unsupported, agent.name)) }
            return
        }
        if ((drafts.any { it.kind != "image" } || resumedAttachments.any { it.kind != "image" }) && "document-input" !in agent.capabilities) {
            update { it.copy(error = text(R.string.agent_document_input_unsupported, agent.name)) }
            return
        }
        if (agent.source == "local" && model != null) {
            val provider = snapshot.modelProviders.firstOrNull { it.id == model.providerId }
            val profile = ai.drsai.remote.runtime.python.ModelRuntimeCapabilities.configured(
                model, provider?.wireApi ?: "openai",
            )
            val toolCount = ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
                .schemas(localTools.modelSchemas(user.id)).length()
            val incompatibility = runCatching { profile.requireRunSupport(toolCount) }.exceptionOrNull()
            update { state -> state.copy(
                fullRuntimeDiagnostic = state.fullRuntimeDiagnostic.copy(
                    modelCapabilityStatus = profile.status,
                    modelCapabilitySource = profile.source,
                    modelCapabilityDigest = profile.digest,
                    modelSupportsTools = profile.tools,
                    modelSupportsParallelTools = profile.parallelTools,
                    modelSupportsReasoning = profile.reasoning,
                ),
            ) }
            if (incompatibility != null) {
                update { state -> state.copy(
                    error = when ((incompatibility as? ApiException)?.code) {
                "model_tools_unsupported" -> text(R.string.model_full_runtime_tools_unsupported)
                else -> text(R.string.model_capability_unconfirmed)
                    },
                ) }
                return
            }
        }
        if (agent.source == "local" && model != snapshot.selectedModel) {
            tokenStore.selectedModelId = model?.id
            update { it.copy(selectedModel = model, capabilityRepair = null, error = null) }
        }
        runJob = viewModelScope.launch {
            var attemptedRunId: String? = resumeCheckpoint?.command?.runId?.value
            var coordinatorLease = false
            try {
        update { it.copy(streaming = true, recovering = false, runtimeStatus = if (drafts.isNotEmpty()) text(R.string.uploading_attachments) else null, error = null) }
                var conversation = snapshot.currentConversation
                if (conversation == null) {
                    val now = System.currentTimeMillis()
                    val title = clean.ifBlank { drafts.first().name }.replace('\n', ' ').take(32)
                    conversation = Conversation(
                        id = UUID.randomUUID().toString(), title = title, agentId = agent.id, agentName = agent.name,
                        agentSource = agent.source, modelId = if (agent.source == "local") model?.id.orEmpty() else "", updatedAt = now,
                    )
                    val entity = toEntity(conversation, user.id, now)
                    database.dao().saveConversation(entity)
                    workbenchProjection.projectLocalConversation(entity)
                    val tree = loadWorkbenchTree(user.id)
                    update { it.copy(currentConversation = conversation, conversations = listOf(conversation) + it.conversations, workbenchWorkspaces = tree) }
                } else if (agent.source == "local" && model != null && conversation.modelId != model.id) {
                    val now = System.currentTimeMillis()
                    val switched = conversation.copy(modelId = model.id, updatedAt = now)
                    conversation = switched
                    val entity = toEntity(switched, user.id, now)
                    database.dao().saveConversation(entity)
                    workbenchProjection.projectLocalConversation(entity)
                    update { state ->
                        state.copy(
                            currentConversation = switched,
                            selectedModel = model,
                            conversations = state.conversations.map { item -> if (item.id == switched.id) switched else item },
                        )
                    }
                }
                val activeConversation = conversation ?: return@launch
                require(resumeCheckpoint == null || resumeCheckpoint.command.sessionId.value == activeConversation.id) {
                    "resume_session_mismatch"
                }
                val runId = resumeCheckpoint?.command?.runId?.value ?: UUID.randomUUID().toString()
                attemptedRunId = runId
                val userMessageId = resumeCheckpoint?.command?.idempotencyKey ?: UUID.randomUUID().toString()
                val assistantMessageId = UUID.randomUUID().toString()
                if (resumeCheckpoint == null && agent.source == "local" && clean.isNotBlank()) {
                    val handoffRequest = ChatRunRequest(
                        accountSubject = user.id,
                        authority = RuntimeAuthority.LOCAL_DEVICE,
                        conversation = activeConversation,
                        input = clean,
                        attachments = drafts.map { draft -> MessageAttachment(
                            id = draft.id, messageId = userMessageId, conversationId = activeConversation.id,
                            remoteId = draft.remoteId, name = draft.name, mimeType = draft.mimeType,
                            size = draft.size, kind = draft.kind, localPath = draft.localPath,
                            thumbnailPath = draft.thumbnailPath, sha256 = draft.sha256, status = "pending",
                        ) },
                        runId = runId,
                        userMessageId = userMessageId,
                        assistantMessageId = assistantMessageId,
                    )
                    if (interceptDesktopExclusiveRequest(user.id, clean, drafts, handoffRequest)) return@launch
                }
                coordinatorLease = ai.drsai.remote.runtime.coordinator.RunCoordinatorLeaseRegistry.acquire(user.id, runId)
                if (!coordinatorLease) {
                    refreshOaepUi(user.id, activeConversation.id)
                    return@launch
                }
                val semaphore = Semaphore(2)
                val uploaded = coroutineScope {
                    drafts.map { draft ->
                        async {
                            semaphore.withPermit {
                                draft.remoteId?.let { remote ->
                                    return@withPermit draft.copy(remoteId = remote, status = AttachmentStatus.UPLOADED, progress = 100)
                                }
                                updateDraft(draft.id) { it.copy(status = AttachmentStatus.UPLOADING, progress = 0, error = null) }
                                try {
                                    val remote = attachmentRepository.upload(draft, activeConversation.id, runId, draft.id) { progress ->
                                        updateDraft(draft.id) { it.copy(status = AttachmentStatus.UPLOADING, progress = progress) }
                                    }
                                    draft.copy(remoteId = remote.id, status = AttachmentStatus.UPLOADED, progress = 100)
                                        .also { complete -> updateDraft(draft.id) { complete } }
                                } catch (error: Throwable) {
                                    updateDraft(draft.id) { it.copy(status = AttachmentStatus.FAILED, error = error.message, progress = 0) }
                                    throw error
                                }
                            }
                        }
                    }.awaitAll()
                }
                val messageText = clean.ifBlank { text(R.string.analyze_these_attachments) }
                val messageAttachments = if (resumeCheckpoint != null) resumedAttachments else uploaded.map { draft ->
                    MessageAttachment(
                        id = draft.id, messageId = userMessageId, conversationId = activeConversation.id,
                        remoteId = draft.remoteId, name = draft.name, mimeType = draft.mimeType, size = draft.size,
                        kind = draft.kind, localPath = draft.localPath, thumbnailPath = draft.thumbnailPath,
                        sha256 = draft.sha256, status = "sent",
                    )
                }
                val optimisticUser = ChatMessage(userMessageId, activeConversation.id, "user", clean, attachments = messageAttachments)
                val optimisticAssistant = ChatMessage(assistantMessageId, activeConversation.id, "assistant", "", status = "streaming")
                update {
                    it.copy(
                        messages = it.messages + if (resumeCheckpoint == null) {
                            listOf(optimisticUser, optimisticAssistant)
                        } else listOf(optimisticAssistant),
                        attachmentDrafts = emptyList(),
                        runtimeStatus = null,
                    )
                }
                activeRunAuthority = if (activeConversation.agentSource == "platform") {
                    RuntimeAuthority.REMOTE_RUNTIME
                } else RuntimeAuthority.LOCAL_DEVICE
                val visibleRoute = if (activeRunAuthority == RuntimeAuthority.REMOTE_RUNTIME) {
                    "Remote Platform"
                } else if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) {
                    "Full Local"
                } else {
                    "Local Preview"
                }
                update { state ->
                    state.copy(fullRuntimeDiagnostic = state.fullRuntimeDiagnostic.copy(route = visibleRoute))
                }
                val runtimeBinding = if (activeConversation.agentSource == "platform") {
                    RuntimeBinding(WorkbenchId("hai-platform"), RuntimeAuthority.REMOTE_RUNTIME)
                } else RuntimeBinding.AndroidLocal
                val runtimeCapabilities = if (activeConversation.agentSource == "platform") {
                    setOf(
                        ai.drsai.remote.workbench.model.RuntimeCapability.CHAT,
                        ai.drsai.remote.workbench.model.RuntimeCapability.STREAMING,
                    )
                } else {
                    fullLocalRuntimeCapabilities(user.id)
                }
                val pinnedSkills = skillCatalog.select(runId, runtimeCapabilities, messageText)
                val runCommand = resumeCheckpoint?.command ?: RunCommand(
                        accountSubject = user.id,
                        organization = "",
                        binding = runtimeBinding,
                        workspaceId = WorkbenchId(if (activeConversation.agentSource == "platform") "platform" else "local"),
                        sessionId = WorkbenchId(activeConversation.id),
                        runId = WorkbenchId(runId),
                        backendId = if (activeConversation.agentSource == "platform") "hai-agent" else "opendrsai",
                        idempotencyKey = userMessageId,
                        input = messageText.ifBlank { "[attachment]" },
                        skillVersions = pinnedSkills.skills.associate { it.id to it.version },
                    )
                val oaepRequest = ChatRunRequest(
                        accountSubject = user.id,
                        authority = activeRunAuthority,
                        conversation = activeConversation,
                        input = messageText,
                        attachments = messageAttachments,
                        runId = runId,
                        userMessageId = userMessageId,
                        assistantMessageId = assistantMessageId,
                    )
                activeOaepRequest = oaepRequest
                val events = journaledChatExecution.execute(runCommand, oaepRequest)
                activeRunId = runId
                networkRunContinuity = ai.drsai.remote.runtime.reliability.NetworkRunContinuity(
                    runId, 0, strings = ai.drsai.remote.runtime.reliability.AndroidNetworkRunStrings(getApplication()),
                )
                val longTaskState = ai.drsai.remote.runtime.reliability.LongTaskStateProjector(
                    startedAtMillis = System.currentTimeMillis(),
                    strings = ai.drsai.remote.runtime.reliability.AndroidLongTaskStrings(getApplication()),
                )
                runNotifications.show(user.id, runId, activeConversation.id, text(R.string.thinking))
                events.collect { journaled ->
                    val checkpoint = journaled.checkpoint
                    val now = System.currentTimeMillis()
                    networkRunContinuity?.let { continuity ->
                        val manager = getApplication<Application>().getSystemService(android.net.ConnectivityManager::class.java)
                        val capabilities = manager?.activeNetwork?.let(manager::getNetworkCapabilities)
                        val networkKind = when {
                            capabilities == null || !capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) -> ai.drsai.remote.runtime.reliability.RunNetworkKind.OFFLINE
                            !capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED) -> ai.drsai.remote.runtime.reliability.RunNetworkKind.RESTRICTED
                            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> ai.drsai.remote.runtime.reliability.RunNetworkKind.CELLULAR
                            else -> ai.drsai.remote.runtime.reliability.RunNetworkKind.WIFI
                        }
                        continuity.observe(networkKind, now, checkpoint.lastSequence)
                    }
                    val longTaskSnapshot = longTaskState.project(checkpoint, now)
                    if (longTaskState.shouldPublish(longTaskSnapshot, now)) {
                        runNotifications.show(user.id, longTaskSnapshot)
                    }
                    update { it.copy(runtimeStatus = longTaskSnapshot.stepLabel) }
                    journaled.artifact?.let { receiveArtifact(activeConversation.id, assistantMessageId, it) }
                    when (journaled.lifecycle) {
                        ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal.ACTIVE -> Unit
                        ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal.COMPLETED -> { skillCatalog.release(runId); runNotifications.dismiss(runId); runRecoveryScheduler.cancel(user.id, WorkbenchId(runId)); recoverableRun = null; finishRun(activeConversation.id) }
                        ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal.CANCELLED -> { skillCatalog.release(runId); runNotifications.dismiss(runId); runRecoveryScheduler.cancel(user.id, WorkbenchId(runId)); recoverableRun = null; reloadMessages(activeConversation.id) }
                        ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal.PAUSED -> { runNotifications.dismiss(runId); recoverableRun = checkpoint; reloadMessages(activeConversation.id) }
                        ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal.FAILED -> {
                            skillCatalog.release(runId)
                            runNotifications.dismiss(runId)
                            reloadMessages(activeConversation.id)
                        }
                    }
                    refreshOaepUi(user.id, activeConversation.id)
                }
            } catch (error: kotlinx.coroutines.CancellationException) {
                update { it.copy(streaming = false, recovering = cancelInProgress, runtimeStatus = if (cancelInProgress) text(R.string.stopping) else null) }
            } catch (error: Throwable) {
                attemptedRunId?.let(skillCatalog::release)
                reportRuntimeFailure(error, attemptedRunId, activeRunAuthority)
            } finally {
                if (coordinatorLease) attemptedRunId?.let {
                    ai.drsai.remote.runtime.coordinator.RunCoordinatorLeaseRegistry.release(user.id, it)
                }
                activeRunId = null
                networkRunContinuity = null
                activeOaepRequest = null
                activeRunAuthority = RuntimeAuthority.LOCAL_DEVICE
            }
        }
    }

    private fun updateDraft(id: String, transform: (AttachmentDraft) -> AttachmentDraft) = update { state ->
        state.copy(attachmentDrafts = state.attachmentDrafts.map { if (it.id == id) transform(it) else it })
    }

    private fun runtimeFailureAction(action: ai.drsai.remote.runtime.reliability.FailureUserAction): String = text(when (action) {
        ai.drsai.remote.runtime.reliability.FailureUserAction.RESEND -> R.string.failure_action_resend
        ai.drsai.remote.runtime.reliability.FailureUserAction.RECONCILE_RESULT -> R.string.failure_action_reconcile
        ai.drsai.remote.runtime.reliability.FailureUserAction.RETRY_OR_SWITCH_RUNTIME -> R.string.failure_action_retry_switch_runtime
        ai.drsai.remote.runtime.reliability.FailureUserAction.RECONNECT_RUNTIME -> R.string.failure_action_reconnect_runtime
        ai.drsai.remote.runtime.reliability.FailureUserAction.RETRY_MODEL -> R.string.failure_action_retry_model
        ai.drsai.remote.runtime.reliability.FailureUserAction.CHECK_TOOL_RESULT -> R.string.failure_action_check_tool
        ai.drsai.remote.runtime.reliability.FailureUserAction.CONFIRM_APPROVAL -> R.string.failure_action_confirm_approval
        ai.drsai.remote.runtime.reliability.FailureUserAction.EXPORT_DIAGNOSTICS -> R.string.failure_action_export_diagnostics
        ai.drsai.remote.runtime.reliability.FailureUserAction.USE_SAFE_RUNTIME -> R.string.failure_action_safe_runtime
        ai.drsai.remote.runtime.reliability.FailureUserAction.RELEASE_RESOURCES -> R.string.failure_action_release_resources
        ai.drsai.remote.runtime.reliability.FailureUserAction.CHECK_NETWORK -> R.string.failure_action_check_network
        ai.drsai.remote.runtime.reliability.FailureUserAction.SIGN_IN_AGAIN -> R.string.failure_action_sign_in
        ai.drsai.remote.runtime.reliability.FailureUserAction.RETRY_LATER -> R.string.failure_action_retry_later
        ai.drsai.remote.runtime.reliability.FailureUserAction.MODIFY_REQUEST -> R.string.failure_action_modify_request
        ai.drsai.remote.runtime.reliability.FailureUserAction.VIEW_DIAGNOSTICS -> R.string.failure_action_view_diagnostics
    })

    private fun reportRuntimeFailure(
        error: Throwable,
        runId: String?,
        authority: RuntimeAuthority,
        displayMessage: String? = error.message,
        failureCode: String? = null,
        httpStatusOverride: Int? = null,
    ) {
        val classified = RuntimeFailureCatalog.classify(
            httpStatus = httpStatusOverride ?: (error as? ApiException)?.status ?: if (error is IOException) 0 else null,
            code = failureCode ?: (error as? ApiException)?.code,
        )
        val bundle = DiagnosticBundleFactory.create(
            classified,
            requestId = extractRequestId(error.message),
            runId = runId?.let(::WorkbenchId),
            authority = authority,
            rawDetails = error.stackTraceToString(),
        )
        val userAction = runtimeFailureAction(classified.userAction)
        update { state ->
            val modelUnsupported = (error as? ApiException)?.code == "model_tools_unsupported"
            val capabilityRepair = ai.drsai.remote.runtime.errors.CapabilityRepairPolicy.from(
                failureCode ?: (error as? ApiException)?.code,
                httpStatusOverride ?: (error as? ApiException)?.status ?: if (error is IOException) 0 else null,
                ai.drsai.remote.runtime.errors.AndroidCapabilityRepairStrings(getApplication()),
            )
            state.copy(
                streaming = false,
                recovering = false,
                runtimeStatus = null,
                error = "${displayMessage ?: text(R.string.run_failed)} · $userAction",
                capabilityRepair = capabilityRepair,
                diagnostic = RuntimeDiagnosticUi(
                    bundle.errorCode,
                    userAction,
                    bundle.runId?.value,
                    bundle.requestId,
                    bundle.details,
                ),
                fullRuntimeDiagnostic = state.fullRuntimeDiagnostic.copy(
                    modelUnsupportedTools = if (modelUnsupported) {
                        state.fullRuntimeDiagnostic.availableTools
                    } else state.fullRuntimeDiagnostic.modelUnsupportedTools,
                ),
            )
        }
    }

    private fun extractRequestId(value: String?): String? = value?.let {
        Regex("(?i)(?:request[_ -]?id|trace[_ -]?id)[:=\\s]+([A-Za-z0-9._:-]{4,100})")
            .find(it)?.groupValues?.getOrNull(1)
    }

    private suspend fun receiveArtifact(
        conversationId: String,
        messageId: String,
        remote: ai.drsai.remote.data.RemoteAttachment,
    ) {
        val safeName = ai.drsai.remote.data.AttachmentPolicy.sanitizeName(remote.name)
        val target = File(getApplication<Application>().cacheDir, "attachments/results/${remote.id}-$safeName")
        val attachment = runCatching { attachmentRepository.download(remote.id, target) }.fold(
            onSuccess = { file ->
                MessageAttachment(
                    remote.id, messageId, conversationId, remote.id, remote.name, remote.mimeType,
                    remote.size, remote.kind, file.absolutePath, null, remote.sha256, "downloaded",
                )
            },
            onFailure = {
                MessageAttachment(
                    remote.id, messageId, conversationId, remote.id, remote.name, remote.mimeType,
                    remote.size, remote.kind, null, null, remote.sha256, "download_failed",
                )
            },
        )
        database.dao().saveAttachments(listOf(ai.drsai.remote.data.MessageAttachmentEntity(
            attachment.id, attachment.messageId, attachment.conversationId, attachment.remoteId,
            attachment.name, attachment.mimeType, attachment.size, attachment.kind, attachment.localPath,
            attachment.thumbnailPath, attachment.sha256, attachment.status, attachment.createdAt,
        )))
        val artifacts = mutableState.value.user?.id?.let { loadWorkbenchArtifacts(it) }.orEmpty()
        update { state ->
            state.copy(messages = state.messages.map { message ->
                if (message.id == messageId) {
                    message.copy(attachments = message.attachments.filterNot { it.id == attachment.id } + attachment)
                } else message
            }, workbenchArtifacts = artifacts)
        }
    }

    fun retryResultAttachment(messageId: String, attachmentId: String) {
        val message = mutableState.value.messages.firstOrNull { it.id == messageId } ?: return
        val attachment = message.attachments.firstOrNull { it.id == attachmentId } ?: return
        val remoteId = attachment.remoteId ?: return
        viewModelScope.launch {
            receiveArtifact(
                message.conversationId,
                messageId,
                ai.drsai.remote.data.RemoteAttachment(
                    remoteId, attachment.name, attachment.kind, attachment.mimeType, attachment.size,
                    attachment.sha256, "ready",
                ),
            )
        }
    }

    private suspend fun finishRun(conversationId: String) {
        reloadMessages(conversationId)
        val user = mutableState.value.user
        val artifacts = user?.id?.let { loadWorkbenchArtifacts(it) }.orEmpty()
        val setup = mutableState.value.setupJourney.let { current ->
            if (current.visible && current.step == ai.drsai.remote.runtime.setup.SetupStep.FIRST_TASK) {
                SetupJourneyReducer.firstTaskCompleted(current, System.currentTimeMillis()).also { completed ->
                    user?.id?.let { setupJourneyStore.save(it, completed) }
                }
            } else current
        }
        update { it.copy(
            streaming = false, recovering = false, runtimeStatus = null,
            workbenchArtifacts = artifacts, setupJourney = setup,
        ) }
    }

    fun revokeApprovalGrant(stableId: String) {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            approvalRepository.sessionGrants(user.id).firstOrNull {
                "${it.organization}|${it.runtimeId}|${it.sessionId}|${it.toolId}" == stableId
            }?.let { approvalRepository.revokeSessionGrant(it) }
            refreshApprovals(user.id)
        }
    }

    fun requestLocalWorkspaceForCurrentTask() = update { state ->
        state.copy(workspaceAuthorization = state.workspaceAuthorization.request(recoverableRun?.command?.runId?.value))
    }

    fun openLocalWorkspacePicker() = update { state ->
        state.copy(workspaceAuthorization = state.workspaceAuthorization.openPicker())
    }

    fun denyLocalWorkspaceRequest() = update { state ->
        state.copy(
            workspaceAuthorization = state.workspaceAuthorization.denied(),
            error = text(R.string.workspace_permission_denied_task_preserved),
        )
    }

    private suspend fun loadWorkbenchArtifacts(subject: String): List<WorkbenchArtifactItem> {
        val attachments = database.dao().allAttachmentsForUser(subject).map { item ->
            WorkbenchArtifactItem(
                item.id, item.name, item.mimeType, item.size, item.conversationId,
                source = "attachment",
            )
        }
        val toolOutputs = database.dao().allToolArtifacts(subject).map { item ->
            WorkbenchArtifactItem(
                item.id, "${item.toolId}-output.txt", "text/plain", item.content.encodeToByteArray().size.toLong(),
                item.sessionId, item.runId, "tool",
            )
        }
        return attachments + toolOutputs
    }

    fun openWorkbenchArtifact(artifactId: String, source: String, share: Boolean = false) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch {
            runCatching {
                LocalArtifactMaterializer(getApplication(), database.dao()).prepare(subject, artifactId, source)
            }.onSuccess { handle ->
                getApplication<Application>().startActivity(localArtifactIntent(getApplication(), handle, share))
            }.onFailure { failure ->
                val code = failure.message ?: "artifact_open_failed"
                val presentation = ai.drsai.remote.data.ArtifactAccessFailurePolicy.from(code, ai.drsai.remote.data.AndroidArtifactAccessStrings(getApplication()))
                update { state -> state.copy(
                    runtimeStatus = presentation?.detail ?: code,
                    workbenchArtifacts = state.workbenchArtifacts.map {
                        if (it.id == artifactId && it.source == source) it.copy(failureCode = code) else it
                    },
                ) }
            }
        }
    }

    private suspend fun pruneRuntimeCaches(subject: String, activeRunIds: Set<String>) {
        val rows = database.dao().allToolArtifacts(subject)
        val evictions = ResourceRetentionPolicy.evictions(
            rows.map { row ->
                ResourceRecord(
                    row.id,
                    row.content.encodeToByteArray().size.toLong(),
                    row.createdAt,
                    active = row.runId in activeRunIds,
                )
            },
            maxBytes = 16L * 1024 * 1024,
            maxItems = 200,
        )
        if (evictions.isNotEmpty()) database.dao().deleteToolArtifacts(subject, evictions.map { it.id })
    }

    private fun refreshSkillCatalog(agents: List<Agent>, hasRemoteWorkspace: Boolean) {
        val builtInSkills = listOf(
            SkillDefinition(
                "device.info", 1, text(R.string.skill_safe_device_info), SkillSource.BUILT_IN,
                setOf(ai.drsai.remote.workbench.model.RuntimeCapability.SAFE_DEVICE_INFO),
                instructions = "Use get_device_info only when Android environment details materially help the task. Do not infer identifying device data.",
                allowedTools = setOf("get_device_info"),
            ),
            SkillDefinition(
                "memory.local", 1, text(R.string.skill_local_memory), SkillSource.BUILT_IN,
                setOf(ai.drsai.remote.workbench.model.RuntimeCapability.LOCAL_MEMORY),
                instructions = "Use search_memory when prior user preferences or facts may help. Use save_memory only for an explicit durable-memory request and avoid sensitive data.",
                allowedTools = setOf("search_memory", "save_memory"),
            ),
            SkillDefinition(
                "attachments", 1, text(R.string.skill_attachment_handling), SkillSource.BUILT_IN,
                setOf(ai.drsai.remote.workbench.model.RuntimeCapability.ATTACHMENT_INPUT),
                instructions = "Inspect the supplied opaque artifacts when the request depends on attachments. Never invent attachment contents.",
                allowedTools = emptySet(),
            ),
            SkillDefinition(
                "workspace.saf", 1, text(R.string.skill_saf_workspace), SkillSource.BUILT_IN,
                setOf(
                    ai.drsai.remote.workbench.model.RuntimeCapability.SAF_READ,
                    ai.drsai.remote.workbench.model.RuntimeCapability.SAF_WRITE,
                ),
                instructions = "Use workspace.list, workspace.glob, workspace.grep, workspace.search, and workspace.read to inspect the user-granted workspace. Before workspace.write, workspace.edit, or workspace.undo, show the Host-prepared target and diff and obtain approval. Stay within granted relative paths.",
                allowedTools = setOf(
                    "workspace.list", "workspace.glob", "workspace.grep", "workspace.search", "workspace.read",
                    "workspace.write", "workspace.edit", "workspace.undo",
                ),
            ),
        )
        skillCatalog.replace(
            SkillSource.BUILT_IN,
            builtInSkills,
        )
        builtInSkillAttestation = BuiltInSkillBundleAttestation.create(
            getApplication<Application>().apkSigningCertificateSha256(), builtInSkills,
        )
        tokenStore.userId?.let { subject ->
            skillCatalog.replace(SkillSource.USER_DECLARATIVE, userSkillRepository.enabled(subject))
        } ?: skillCatalog.replace(SkillSource.USER_DECLARATIVE, emptyList())
        skillCatalog.replace(
            SkillSource.PLATFORM,
            agents.filter { it.source == "platform" }.map { agent ->
                SkillDefinition(
                    stableSkillId("platform", agent.id), 1, agent.name, SkillSource.PLATFORM,
                    executableOnAndroid = false,
                )
            },
        )
        skillCatalog.replace(
            SkillSource.REMOTE_READ_ONLY,
            if (hasRemoteWorkspace) listOf(
                SkillDefinition(
                    "remote.workspace", 1, text(R.string.skill_remote_workspace), SkillSource.REMOTE_READ_ONLY,
                    executableOnAndroid = false,
                ),
            ) else emptyList(),
        )
    }

    private fun stableSkillId(prefix: String, value: String): String {
        val normalized = value.lowercase().replace(Regex("[^a-z0-9._-]+"), "-").trim('-').take(70)
        return "$prefix.${normalized.ifBlank { value.hashCode().toUInt().toString(16) }}"
    }

    private fun toSkillUiItem(skill: SkillDefinition) = SkillUiItem(
        skill.id,
        skill.displayName,
        skill.version,
        when (skill.source) {
            SkillSource.BUILT_IN -> text(R.string.android_built_in)
            SkillSource.USER_DECLARATIVE -> text(R.string.user_saf_declaration)
            SkillSource.PLATFORM -> text(R.string.hepai_platform)
            SkillSource.REMOTE_READ_ONLY -> text(R.string.remote_read_only)
        },
        available = true,
        permissions = skill.requiredCapabilities.joinToString { it.name }.ifBlank {
            if (skill.executableOnAndroid) text(R.string.android_permission_approval_constrained)
            else text(R.string.declaration_only_no_android_script)
        },
        userManaged = skill.source == SkillSource.USER_DECLARATIVE,
        enabled = true,
    )

    private fun skillUiItems(subject: String): List<SkillUiItem> {
        val catalogItems = skillCatalog.snapshot()
            .filterNot { it.source == SkillSource.USER_DECLARATIVE }
            .map(::toSkillUiItem)
        val userItems = userSkillRepository.snapshot(subject).map { record ->
            toSkillUiItem(record.current).copy(available = record.enabled, enabled = record.enabled)
        }
        return (catalogItems + userItems).sortedWith(compareBy<SkillUiItem>(SkillUiItem::source).thenBy { it.id })
    }

    private suspend fun reloadMessages(conversationId: String) {
        val subject = mutableState.value.user?.id ?: return
        val messages = loadMessages(subject, conversationId)
        val oaepUi = loadOaepUi(subject, conversationId)
        update { it.copy(
            messages = messages,
            oaepTranscript = oaepUi?.entries.orEmpty(),
            oaepTimeline = oaepUi?.timeline.orEmpty(),
            oaepRunStatus = oaepUi?.runStatus,
            oaepActiveRunId = oaepUi?.activeRunId,
            oaepSnapshotSequence = oaepUi?.snapshotSequence ?: 0,
            runtimeStatus = oaepUi?.runtimeStatus ?: it.runtimeStatus,
            recovering = oaepUi?.recovering ?: false,
            error = oaepUi?.errorMessage ?: if (oaepUi?.runStatus in setOf("completed", "cancelled")) null else it.error,
        ) }
    }

    fun stop() {
        val active = activeRunId
        val runId = active ?: recoverableRun?.command?.runId?.value
        val oaepRequest = activeOaepRequest ?: recoverableOaepRequest()
        active?.let {
            chatExecution.stop(activeRunAuthority, it)
        }
        runJob?.cancel()
        cancelInProgress = runId != null
        update { it.copy(recovering = runId != null, runtimeStatus = if (runId == null) null else text(R.string.stopping)) }
        if (runId != null) viewModelScope.launch(Dispatchers.IO) {
            try {
                runCatching { runtimeV2Recorder.cancel(WorkbenchId(runId)) }
                oaepRequest?.takeIf { it.runId == runId }?.let { request ->
                    persistOaepLifecycle(
                        request, "ui-stop", ai.drsai.remote.runtime.oaep.NormalizedAgentEvent.RunCancelled,
                    )
                }
                skillCatalog.release(runId)
                runNotifications.dismiss(runId)
                mutableState.value.user?.id?.let { runRecoveryScheduler.cancel(it, WorkbenchId(runId)) }
                recoverableRun = null
            } finally {
                cancelInProgress = false
                mutableState.value.user?.id?.let { subject ->
                    mutableState.value.currentConversation?.id?.let { refreshOaepUi(subject, it) }
                }
            }
        }
    }

    fun pauseForBackground() {
        if (!mutableState.value.streaming) return
        val runId = activeRunId ?: return
        val oaepRequest = activeOaepRequest
        // A user-visible foreground service owns the execution while the UI is
        // backgrounded. If Android kills the process, the durable checkpoint is
        // discovered by bootstrap and offered for explicit, idempotent resume.
        if (runNotifications.isActive(runId)) return
        chatExecution.pause(activeRunAuthority, runId)
        runJob?.cancel()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { runtimeV2Recorder.pause(WorkbenchId(runId)) }
                .onSuccess { checkpoint ->
                    recoverableRun = checkpoint
                    mutableState.value.user?.id?.let { runRecoveryScheduler.schedule(it, checkpoint.command.runId) }
                    oaepRequest?.takeIf { it.runId == runId }?.let { request ->
                        persistOaepLifecycle(
                            request, "ui-pause",
                            ai.drsai.remote.runtime.oaep.NormalizedAgentEvent.RunWaiting("paused", null),
                        )
                    }
                    mutableState.value.user?.id?.let { subject ->
                        mutableState.value.currentConversation?.id?.let { refreshOaepUi(subject, it) }
                    }
                }
        }
    }

    fun retry() {
        if (mutableState.value.streaming || mutableState.value.recovering) return
        if (mutableState.value.capabilityRepair?.blockRetryUntilRepaired == true) return
        if (mutableState.value.diagnostic?.code.orEmpty().contains("side_effect", ignoreCase = true) && recoverableRun == null) return
        val paused = recoverableRun
        val current = mutableState.value.currentConversation
        if (paused != null && current?.id == paused.command.sessionId.value) {
            viewModelScope.launch(Dispatchers.IO) {
                update { it.copy(recovering = true, runtimeStatus = text(R.string.recovering), error = null) }
                val attachments = database.dao().attachmentSnapshot(current.id)
                    .filter { it.messageId == paused.command.idempotencyKey }
                    .map { it.toMessageAttachment() }
                runCatching { runtimeV2Recorder.resume(paused.command.runId) }
                    .onSuccess { sendMessage(paused.command.input, paused, attachments) }
                    .onFailure { error ->
                        update { it.copy(
                            streaming = false,
                            recovering = false,
                            runtimeStatus = text(R.string.recovery_failed),
                            error = text(R.string.recovery_failed_retry_or_cancel, error.message ?: "unknown"),
                        ) }
                    }
            }
            return
        }
        val message = mutableState.value.messages.lastOrNull { it.role == "user" } ?: return
        val drafts = message.attachments.mapNotNull { attachment ->
            val path = attachment.localPath?.takeIf { File(it).isFile } ?: return@mapNotNull null
            AttachmentDraft(
                id = UUID.randomUUID().toString(), name = attachment.name, mimeType = attachment.mimeType,
                size = attachment.size, kind = attachment.kind, localPath = path,
                thumbnailPath = attachment.thumbnailPath, sha256 = attachment.sha256,
                remoteId = attachment.remoteId, status = AttachmentStatus.UPLOADED, progress = 100,
            )
        }
        update { it.copy(error = null, capabilityRepair = null, attachmentDrafts = drafts, runtimeStatus = text(R.string.creating_new_run_retry)) }
        sendMessage(message.text)
    }

    fun newConversation() {
        if (mutableState.value.streaming || mutableState.value.recovering) return
        mutableState.value.attachmentDrafts.forEach(attachmentProcessor::delete)
        recoverableRun = null
        update { it.copy(
            currentConversation = null, messages = emptyList(), oaepTranscript = emptyList(), oaepTimeline = emptyList(),
            oaepRunStatus = null, oaepActiveRunId = null, oaepSnapshotSequence = 0,
            attachmentDrafts = emptyList(), historyOpen = false, error = null,
            runtimeStatus = null, recovering = false, toolDowngraded = false,
        ) }
    }

    fun selectAgent(id: String) {
        val snapshot = mutableState.value
        if (snapshot.streaming || snapshot.recovering) return
        val agent = snapshot.agents.firstOrNull { it.id == id } ?: return
        if (!agent.available || !agent.chatSupported) {
            update { it.copy(error = text(R.string.agent_android_chat_unsupported, agent.name)) }
            return
        }
        tokenStore.selectedAgentId = agent.id
        update {
            if (it.selectedAgent?.id == agent.id) it.copy(error = null)
            else it.copy(
                selectedAgent = agent,
                currentConversation = null,
                messages = emptyList(),
                oaepTranscript = emptyList(),
                oaepTimeline = emptyList(),
                oaepRunStatus = null,
                oaepActiveRunId = null,
                oaepSnapshotSequence = 0,
                historyOpen = false,
                error = null,
                toolDowngraded = false,
            )
        }
    }

    fun refreshAgents() {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            update { it.copy(agentCatalogStatus = it.agentCatalogStatus.copy(state = "loading", message = text(R.string.refreshing_platform_agents))) }
            val catalog = agentRepository.load(user.id, refresh = true)
            val localAgent = configuredLocalAgent(user.id, mutableState.value.models)
            val agents = listOf(localAgent) + catalog.agents
            val current = mutableState.value.currentConversation
            val selected = current?.let { conversation ->
                agents.firstOrNull { it.id == conversation.agentId } ?: Agent(
                    id = conversation.agentId,
                    name = conversation.agentName,
                    source = conversation.agentSource,
                    mode = conversation.agentSource,
                    available = false,
                    chatSupported = false,
                    description = text(R.string.session_agent_missing_from_catalog),
                )
            } ?: agents.firstOrNull { it.id == mutableState.value.selectedAgent?.id }
                ?: agents.firstOrNull { it.isDefault && it.chatSupported }
                ?: localAgent
            tokenStore.selectedAgentId = selected.id
            refreshSkillCatalog(agents, mutableState.value.workbenchWorkspaces.any { !it.local })
            update {
                it.copy(
                    agents = agents,
                    selectedAgent = selected,
                    agentCatalogStatus = catalog.status,
                    skills = skillUiItems(user.id),
                )
            }
        }
    }

    fun importUserSkill(uri: Uri) {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { userSkillImporter.import(user.id, uri) }
                .onSuccess {
                    refreshSkillCatalog(mutableState.value.agents, mutableState.value.workbenchWorkspaces.any { !it.local })
                    update { state -> state.copy(
                        skills = skillUiItems(user.id),
                        runtimeStatus = text(R.string.user_skill_imported_disabled),
                        error = null,
                    ) }
                }
                .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.user_skill_import_failed)) } }
        }
    }

    fun connectMcpServer(
        serverId: String,
        endpointUrl: String,
        bearerToken: String,
        allowWrite: Boolean,
        expiryHours: Long,
    ) {
        val user = mutableState.value.user ?: return
        val normalizedServerId = serverId.trim().lowercase()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val endpoint = McpServerEndpoint(normalizedServerId, endpointUrl.trim())
                require(expiryHours in 1..(24L * 90L)) { "mcp_expiry_hours_invalid" }
                val scopes = buildSet {
                    add(McpConnectorScope.DISCOVER.wireName)
                    add(McpConnectorScope.CALL_READ.wireName)
                    if (allowWrite) add(McpConnectorScope.CALL_WRITE.wireName)
                }
                mcpSecureConfigStore.save(
                    user.id,
                    endpoint,
                    bearerToken,
                    scopes = scopes,
                    expiresAtEpochMs = System.currentTimeMillis() + expiryHours * 60L * 60L * 1_000L,
                )
                mcpToolManager.connect(
                    user.id,
                    McpStreamableHttpClient(endpoint, user.id, mcpSecureConfigStore),
                )
            }.onSuccess { tools ->
                update { it.copy(
                    runtimeStatus = text(R.string.mcp_connected_tools_approval, tools.size),
                    error = null,
                    connectors = connectorUiItems(user.id),
                ) }
            }.onFailure { error ->
                runCatching { mcpToolManager.disconnect(user.id, normalizedServerId) }
                runCatching { mcpSecureConfigStore.revoke(user.id, normalizedServerId) }
                update { it.copy(error = ai.drsai.remote.runtime.security.SensitiveDataRedactor.redact(
                    error.message ?: text(R.string.mcp_connection_failed),
                ), connectors = connectorUiItems(user.id)) }
            }
        }
    }

    private fun restoreMcpConnectors(subject: String) {
        viewModelScope.launch(Dispatchers.IO) {
            mcpSecureConfigStore.list(subject)
                .filter { it.enabled && mcpSecureConfigStore.isActive(subject, it.id) }
                .forEach { summary ->
                    runCatching {
                        val endpoint = McpServerEndpoint(summary.id, summary.url)
                        mcpToolManager.connect(
                            subject,
                            McpStreamableHttpClient(endpoint, subject, mcpSecureConfigStore),
                        )
                    }
                }
            update { it.copy(connectors = connectorUiItems(subject)) }
        }
    }

    fun revokeMcpServer(serverId: String) {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                mcpSecureConfigStore.revoke(user.id, serverId)
                mcpToolManager.disconnect(user.id, serverId)
            }.onSuccess {
                update { it.copy(
                    connectors = connectorUiItems(user.id),
                    runtimeStatus = text(R.string.mcp_connector_revoked),
                    error = null,
                ) }
            }.onFailure { error ->
                update { it.copy(error = error.message ?: text(R.string.mcp_connector_revoke_failed)) }
            }
        }
    }

    private fun connectorUiItems(subject: String): List<ConnectorUiItem> =
        mcpSecureConfigStore.list(subject).map { summary ->
            ConnectorUiItem(
                summary.id,
                summary.url,
                summary.enabled && (summary.expiresAtEpochMs == null || System.currentTimeMillis() < summary.expiresAtEpochMs),
                summary.scopes.sorted(),
                summary.expiresAtEpochMs,
            )
        }

    fun setUserSkillEnabled(skillId: String, enabled: Boolean) = mutateUserSkill { subject ->
        userSkillRepository.setEnabled(subject, skillId, enabled)
    }

    fun rollbackUserSkill(skillId: String) = mutateUserSkill { subject ->
        userSkillRepository.rollback(subject, skillId)
    }

    fun deleteUserSkill(skillId: String) = mutateUserSkill { subject ->
        userSkillRepository.delete(subject, skillId)
    }

    private fun mutateUserSkill(action: (String) -> Unit) {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { action(user.id) }
                .onSuccess {
                    refreshSkillCatalog(mutableState.value.agents, mutableState.value.workbenchWorkspaces.any { !it.local })
                    update { it.copy(skills = skillUiItems(user.id), error = null) }
                }
                .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.user_skill_update_failed)) } }
        }
    }

    fun searchWorkbench(query: String) {
        val subject = mutableState.value.user?.id ?: return
        val generation = ++workbenchSearchGeneration
        workbenchSearchJob?.cancel()
        if (query.isBlank()) {
            update { it.copy(workbenchSearchResults = emptyList()) }
            return
        }
        workbenchSearchJob = viewModelScope.launch(Dispatchers.IO) {
            kotlinx.coroutines.delay(180)
            val result = unifiedWorkbench.search(subject, query)
            val dao = database.workbenchDao()
            val sessionRows = result.sessions.associateBy { it.sessionId }.toMutableMap()
            result.messages.forEach { message ->
                if (message.conversationId !in sessionRows) {
                    dao.session(subject, message.conversationId)?.let { sessionRows[it.sessionId] = it }
                }
            }
            val titleItems = result.sessions.map { row ->
                WorkbenchSearchItem(row.toUiItem(), row.title, messageMatch = false)
            }
            val messageItems = result.messages.mapNotNull { message ->
                sessionRows[message.conversationId]?.let { row ->
                    WorkbenchSearchItem(row.toUiItem(), message.content.take(160), messageMatch = true)
                }
            }
            if (generation == workbenchSearchGeneration) {
                update { it.copy(workbenchSearchResults = (titleItems + messageItems).distinctBy { item ->
                    "${item.messageMatch}:${item.session.sessionId}:${item.snippet}"
                }.take(100)) }
            }
        }
    }

    fun loadMoreWorkbenchSessions(workspaceKey: String) {
        val subject = mutableState.value.user?.id ?: return
        val workspace = mutableState.value.workbenchWorkspaces.firstOrNull { it.key == workspaceKey } ?: return
        if (!workspace.sessionHasMore) return
        val current = mutableState.value.workbenchSessionLimits[workspaceKey] ?: WORKBENCH_SESSION_PAGE_SIZE
        update { it.copy(workbenchSessionLimits = it.workbenchSessionLimits + (workspaceKey to current + WORKBENCH_SESSION_PAGE_SIZE)) }
        viewModelScope.launch(Dispatchers.IO) {
            val tree = loadWorkbenchTree(subject)
            update { it.copy(workbenchWorkspaces = tree) }
        }
    }

    fun projectRemoteWorkspaces(items: List<Pair<String, ai.drsai.remote.remote.model.RemoteWorkspaceRef>>) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            workbenchProjection.projectRemoteWorkspaces(subject, items, System.currentTimeMillis())
            val tree = loadWorkbenchTree(subject)
            refreshSkillCatalog(mutableState.value.agents, hasRemoteWorkspace = tree.any { !it.local })
            update { it.copy(workbenchWorkspaces = tree, skills = skillUiItems(subject)) }
        }
    }

    fun projectRemoteSessions(items: List<ai.drsai.remote.remote.model.RemoteSessionRef>) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            workbenchProjection.projectRemoteSessions(subject, items, System.currentTimeMillis())
            val tree = loadWorkbenchTree(subject)
            update { it.copy(workbenchWorkspaces = tree) }
        }
    }

    fun openConversation(id: String) = viewModelScope.launch(Dispatchers.IO) {
        if (mutableState.value.streaming || mutableState.value.recovering) return@launch
        val subject = mutableState.value.user?.id ?: return@launch
        val conversation = mutableState.value.conversations.firstOrNull { it.id == id } ?: return@launch
        val messages = loadMessages(subject, id)
        val oaepUi = loadOaepUi(subject, id)
        mutableState.value.user?.let { database.workbenchDao().setSessionUnread(it.id, id, false) }
        val tree = mutableState.value.user?.let { loadWorkbenchTree(it.id) }.orEmpty()
        recoverableRun = mutableState.value.user?.let { user ->
            runtimeV2Recorder.recover(user.id).lastOrNull { it.command.sessionId.value == id }
        }
        val agent = mutableState.value.agents.firstOrNull { it.id == conversation.agentId }
            ?: Agent(
                id = conversation.agentId,
                name = conversation.agentName,
                source = conversation.agentSource,
                mode = conversation.agentSource,
                available = false,
                chatSupported = false,
                        description = text(R.string.session_agent_missing_from_catalog),
            )
        update { state ->
            state.copy(
                currentConversation = conversation,
                selectedAgent = agent,
                messages = messages,
                oaepTranscript = oaepUi?.entries.orEmpty(),
                oaepTimeline = oaepUi?.timeline.orEmpty(),
                oaepRunStatus = oaepUi?.runStatus,
                oaepActiveRunId = oaepUi?.activeRunId,
                oaepSnapshotSequence = oaepUi?.snapshotSequence ?: 0,
                historyOpen = false,
                error = oaepUi?.errorMessage,
                    runtimeStatus = oaepUi?.runtimeStatus ?: recoverableRun?.let { text(R.string.paused_task_found_retry) },
                recovering = oaepUi?.recovering ?: false,
                workbenchWorkspaces = tree,
            )
        }
        if (oaepUi == null) update { state -> state.copy(runtimeStatus = recoverableRun?.let(::recoveryUiStatus)) }
    }

    fun toggleHistory(open: Boolean) = update { it.copy(historyOpen = open) }
    fun toggleProfile(open: Boolean) {
        if (open) publishFullRuntimeDiagnostic(fullRuntimeBinding.state.value)
        update { it.copy(profileOpen = open) }
    }

    fun retryFullRuntimeBinding() {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { fullRuntimeBinding.bind(subject) }
                .onFailure { error ->
                    val runtimeLabel = if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) "Android Full Agent Runtime" else "Android Agent Runtime Preview"
                update { it.copy(runtimeStatus = text(R.string.runtime_unavailable_reason, runtimeLabel, error.message.orEmpty().take(160))) }
                }
        }
    }

    fun setMemoryEnabled(enabled: Boolean) {
        val subject = mutableState.value.user?.id ?: return
        memorySettings.setEnabled(subject, enabled)
        update { it.copy(memoryEnabled = enabled) }
    }

    fun openRecoverableRun(runId: String) = viewModelScope.launch(Dispatchers.IO) {
        val user = tokenStore.user() ?: return@launch
        val recovered = runtimeV2Recorder.recover(user.id).firstOrNull { it.command.runId.value == runId }
            ?: return@launch
        state.filter { it.user?.id == user.id && !it.loading }.first()
        openConversation(recovered.command.sessionId.value)
    }

    fun continueRunFromNotification(runId: String) = viewModelScope.launch(Dispatchers.IO) {
        val user = tokenStore.user() ?: return@launch
        val checkpoint = runtimeV2Recorder.recover(user.id).firstOrNull { it.command.runId.value == runId } ?: return@launch
        continueRunFromNotification(user.id, runId, checkpoint.command.sessionId.value)
    }

    fun continueRunFromNotification(subject: String, runId: String, sessionId: String) = viewModelScope.launch(Dispatchers.IO) {
        if (subject.isBlank() || runId.isBlank() || sessionId.isBlank() || mutableState.value.streaming || mutableState.value.recovering) return@launch
        val user = tokenStore.user() ?: return@launch
        if (user.id != subject) return@launch
        val checkpoint = runtimeV2Recorder.recover(user.id)
            .firstOrNull { it.command.runId.value == runId && it.command.sessionId.value == sessionId } ?: return@launch
        state.filter { it.user?.id == user.id && !it.loading }.first()
        openConversation(checkpoint.command.sessionId.value).join()
        recoverableRun = checkpoint
        val current = mutableState.value.currentConversation
            ?.takeIf { it.id == checkpoint.command.sessionId.value } ?: return@launch
                update { it.copy(recovering = true, runtimeStatus = text(R.string.recovering), error = null) }
        val attachments = database.dao().attachmentSnapshot(current.id)
            .filter { it.messageId == checkpoint.command.idempotencyKey }
            .map { it.toMessageAttachment() }
        runCatching { runtimeV2Recorder.resume(checkpoint.command.runId) }
            .onSuccess {
                runRecoveryScheduler.cancel(user.id, checkpoint.command.runId)
                sendMessage(checkpoint.command.input, checkpoint, attachments)
            }
            .onFailure { error -> update { it.copy(
                            streaming = false, recovering = false, runtimeStatus = text(R.string.recovery_failed),
                            error = text(R.string.recovery_failed_retry_or_cancel, error.message ?: "unknown"),
            ) } }
    }

    fun cancelRunFromNotification(runId: String) = viewModelScope.launch(Dispatchers.IO) {
        val user = tokenStore.user() ?: return@launch
        val activeSession = activeOaepRequest?.conversation?.id
        val sessionId = activeSession ?: runtimeV2Recorder.recover(user.id)
            .firstOrNull { it.command.runId.value == runId }?.command?.sessionId?.value ?: return@launch
        cancelRunFromNotification(user.id, runId, sessionId)
    }

    fun cancelRunFromNotification(subject: String, runId: String, sessionId: String) = viewModelScope.launch(Dispatchers.IO) {
        if (subject.isBlank() || runId.isBlank() || sessionId.isBlank()) return@launch
        val user = tokenStore.user() ?: return@launch
        if (user.id != subject) return@launch
        if (activeRunId == runId) {
            if (activeOaepRequest?.conversation?.id != sessionId) return@launch
            stop()
            return@launch
        }
        val checkpoint = runtimeV2Recorder.recover(user.id)
            .firstOrNull { it.command.runId.value == runId && it.command.sessionId.value == sessionId } ?: return@launch
        openConversation(checkpoint.command.sessionId.value).join()
        recoverableRun = checkpoint
        val request = recoverableOaepRequest()
        runtimeV2Recorder.cancel(checkpoint.command.runId)
        request?.let { persistOaepLifecycle(
            it, "notification-cancel", ai.drsai.remote.runtime.oaep.NormalizedAgentEvent.RunCancelled,
        ) }
        runRecoveryScheduler.cancel(user.id, checkpoint.command.runId)
        runNotifications.dismiss(runId)
        recoverableRun = null
        refreshOaepUi(user.id, checkpoint.command.sessionId.value)
        refreshRecoveryCenter(user.id)
    }

    fun archiveRecoveryRun(runId: String) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            recoveryCenterRepository.archive(subject, runId, System.currentTimeMillis())
            refreshRecoveryCenter(subject)
        }
    }

    private suspend fun refreshRecoveryCenter(subject: String) {
        val recoveryRuns = recoveryCenterRepository.candidates(subject, System.currentTimeMillis())
        update { it.copy(recoveryRuns = recoveryRuns) }
    }

    fun deleteMemory(id: Long) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            database.dao().deleteMemory(subject, id)
            val memories = database.dao().memorySnapshot(subject).map { MemoryUiItem(it.id, it.content) }
            update { it.copy(memories = memories) }
        }
    }

    fun renameSession(sessionId: String, title: String) = mutateSession { subject ->
        unifiedWorkbench.rename(subject, sessionId, title, System.currentTimeMillis())
    }

    fun setSessionPinned(sessionId: String, pinned: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setPinned(subject, sessionId, pinned, System.currentTimeMillis())
    }

    fun setSessionArchived(sessionId: String, archived: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setArchived(subject, sessionId, archived, System.currentTimeMillis())
    }

    fun setSessionUnread(sessionId: String, unread: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setUnread(subject, sessionId, unread)
    }

    fun deleteSession(sessionId: String) = mutateSession { subject ->
        unifiedWorkbench.delete(subject, sessionId)
    }

    private fun mutateSession(block: suspend (String) -> SessionMutationResult) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            when (block(subject)) {
                SessionMutationResult.Applied -> {
                    val entities = database.dao().conversationSnapshot(subject)
                    val tree = loadWorkbenchTree(subject)
                    val archived = loadArchivedSessions(subject)
                    val conversations = loadConversations(subject, entities)
                    update { it.copy(
                        conversations = conversations,
                        currentConversation = it.currentConversation?.let { current ->
                            conversations.firstOrNull { row -> row.id == current.id }
                        },
                        workbenchWorkspaces = tree,
                        archivedSessions = archived,
                    ) }
                }
                SessionMutationResult.NotFound -> update { it.copy(error = text(R.string.session_missing_or_removed)) }
                SessionMutationResult.RemoteAuthorityRequired -> update { it.copy(error = text(R.string.remote_session_authority_required)) }
                SessionMutationResult.ActiveRun -> update { it.copy(error = text(R.string.session_has_active_run)) }
            }
        }
    }
    fun setTheme(value: Boolean?) = update { it.copy(darkTheme = value) }

    fun logout() {
        AndroidDevicePresence.logout()
        deepLinkStore.edit().clear().apply()
        getApplication<Application>().getSystemService(NotificationManager::class.java)?.cancelAll()
        update { it.copy(requestedRoutePath = null, requestedRemoteItemId = null) }
        val remoteSubject = mutableState.value.user?.id
        remoteSubject?.let(RemoteSubscriptionRegistry::cancelSubject)
        remoteSubject?.let(mcpToolManager::disconnectAll)
        activeRunId?.let { runId ->
            chatExecution.stop(activeRunAuthority, runId)
            skillCatalog.release(runId)
        }
        runJob?.cancel()
        approvalJob?.cancel()
        approvalJob = null
        runJob = null
        activeRunId = null
        remoteSubject?.let { subject -> viewModelScope.launch { fullRuntimeBinding.release(subject) } }
        oidcClient.cancel(oidcSession)
        oidcTransactions.clear()
        loginJob?.cancel()
        mutableState.value.attachmentDrafts.forEach(attachmentProcessor::delete)
        viewModelScope.launch {
            remoteSubject?.let { androidOaepRelayManager.stopForOwner(it) }
            mutableState.value.attachmentDrafts.mapNotNull { it.remoteId }.forEach { remote ->
                runCatching { attachmentRepository.delete(remote) }
            }
            runCatching { modelClient.logout() }
            remoteSubject?.let { subject ->
                runtimeV2Recorder.recover(subject).forEach { checkpoint ->
                    runCatching { runtimeV2Recorder.cancel(checkpoint.command.runId) }
                    runRecoveryScheduler.cancel(subject, checkpoint.command.runId)
                }
                safWorkspaceStore.clear(subject)
                WorkspaceInstructionVersionStore(getApplication()).clearSubject(subject)
            }
            pythonRuntimePreference.clearPolicy()
            remoteSubject?.let { runCatching { RemoteCacheRepository(database).clearSubject(it) } }
            remoteSubject?.let { subject ->
                val remote = ai.drsai.remote.remote.data.RemoteWorkspaceContainer.get(getApplication())
                runCatching { remote.drafts.clearSubject(subject) }
                runCatching { remote.activity.clearSubject(subject) }
                runCatching { remote.boundaries.run.controls.clearSubject(subject) }
                runCatching { remote.boundaries.approval.decisions.clearSubject(subject) }
            }
            tokenStore.clear()
            update { AppState(destination = AppDestination.Login) }
        }
    }

    private suspend fun refreshApprovals(subject: String) {
        val approvals = approvalRepository.pending(subject)
        val grants = approvalRepository.sessionGrants(subject)
        pendingApprovalEntities = approvals.associateBy(WorkbenchApprovalEntity::approvalId)
        update { state -> state.copy(
            pendingApprovals = approvals.map { item -> item.toApprovalUiItem() },
            approvalGrants = grants.map { item ->
                val summary = ai.drsai.remote.runtime.security.ApprovalRiskSummaryPolicy.present(item.toolId, ai.drsai.remote.runtime.security.AndroidApprovalRiskStrings(getApplication()))
                ai.drsai.remote.data.ApprovalGrantUiItem(
                    stableId = "${item.organization}|${item.runtimeId}|${item.sessionId}|${item.toolId}",
                    title = summary.title,
                    objectLabel = summary.objectLabel,
                    runtimeId = item.runtimeId,
                    sessionId = item.sessionId,
                    toolId = item.toolId,
                )
            },
        ) }
    }

    private fun configuredLocalAgent(subject: String, models: List<ai.drsai.remote.data.ModelInfo>): Agent {
        val base = localAgentFor(models)
        return if (!safWorkspaceStore.hasReadGrant(subject)) base else base.copy(
            capabilities = base.capabilities + setOf("saf-read", "saf-write", "project-instructions"),
        )
    }

    private fun WorkbenchApprovalEntity.toApprovalUiItem(): ApprovalUiItem {
        val summary = ai.drsai.remote.runtime.security.ApprovalRiskSummaryPolicy.present(operation, ai.drsai.remote.runtime.security.AndroidApprovalRiskStrings(getApplication()))
        val preview = ai.drsai.remote.runtime.security.ApprovalChangePreviewPolicy.restore(
            operation,
            previewJson,
            ai.drsai.remote.runtime.security.AndroidApprovalPreviewStrings(getApplication()),
        )
        return ApprovalUiItem(
            id = approvalId,
            operation = operation,
            scope = scope,
            runtimeId = runtimeId,
            sessionId = sessionId,
            expiresAt = expiresAt,
            title = summary.title,
            reason = summary.reason,
            objectLabel = preview.target,
            changeSummary = preview.summary,
            riskSummary = summary.risk,
            reversibleLabel = summary.reversibleLabel,
            advancedDetail = "Tool: $operation · Approval: $approvalId · Runtime: $runtimeId · Session: $sessionId",
        )
    }

    private suspend fun loadMessages(subject: String, id: String): List<ChatMessage> {
        val conversation = database.dao().conversationSnapshot(subject).firstOrNull { it.id == id }
        if (conversation != null) localOaepLegacyProjection.messages(subject, "", conversation)?.let { return it }
        val attachments = database.dao().attachmentSnapshot(id).groupBy { it.messageId }
        return database.dao().visibleMessageSnapshot(id).map {
        ChatMessage(
            it.id,
            it.conversationId,
            it.role,
            sanitizeLegacyAssistantText(it.role, it.content),
            it.createdAt,
            it.status,
            attachments[it.id].orEmpty().map { item ->
                MessageAttachment(
                    id = item.id,
                    messageId = item.messageId,
                    conversationId = item.conversationId,
                    remoteId = item.remoteId,
                    name = item.name,
                    mimeType = item.mimeType,
                    size = item.size,
                    kind = item.kind,
                    localPath = item.localPath,
                    thumbnailPath = item.thumbnailPath,
                    sha256 = item.sha256,
                    status = item.status,
                    createdAt = item.createdAt,
                )
            },
        )
        }
    }

    private fun ai.drsai.remote.data.MessageAttachmentEntity.toMessageAttachment() = MessageAttachment(
        id = id,
        messageId = messageId,
        conversationId = conversationId,
        remoteId = remoteId,
        name = name,
        mimeType = mimeType,
        size = size,
        kind = kind,
        localPath = localPath,
        thumbnailPath = thumbnailPath,
        sha256 = sha256,
        status = status,
        createdAt = createdAt,
    )

    private fun toConversation(entity: ConversationEntity) = Conversation(
        id = entity.id,
        title = entity.title,
        updatedAt = entity.updatedAt,
        agentId = entity.agentId,
        agentName = entity.agentName,
        agentSource = entity.agentSource,
        modelId = entity.modelId,
    )

    private suspend fun loadWorkbenchTree(subject: String): List<WorkbenchWorkspaceItem> {
        val dao = database.workbenchDao()
        val latestRuns = dao.allRuns(subject)
            .distinctBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
            .associateBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
        val now = System.currentTimeMillis()
        return dao.allWorkspaces(subject).map { workspace ->
            val local = workspace.authority == RuntimeAuthority.LOCAL_DEVICE.name
            val key = "${workspace.organization}:${workspace.runtimeId}:${workspace.workspaceId}"
            val limit = mutableState.value.workbenchSessionLimits[key] ?: WORKBENCH_SESSION_PAGE_SIZE
            val sessionCount = dao.sessionCount(subject, workspace.organization, workspace.runtimeId, workspace.workspaceId)
            val sessions = dao.sessionPage(
                subject, workspace.organization, workspace.runtimeId, workspace.workspaceId,
                limit = limit.coerceIn(WORKBENCH_SESSION_PAGE_SIZE, WORKBENCH_SESSION_MAX_VISIBLE), offset = 0,
            )
            WorkbenchWorkspaceItem(
                key = key,
                runtimeId = workspace.runtimeId,
                workspaceId = workspace.workspaceId,
                displayName = workspace.displayName,
                local = local,
                sessions = sessions.map { session ->
                    WorkbenchSessionItem(
                        session.sessionId, session.runtimeId, session.workspaceId, session.title,
                        local, session.pinned, session.unread, session.updatedAt,
                        latestRuns[Triple(session.runtimeId, session.workspaceId, session.sessionId)]?.status ?: "IDLE",
                    )
                },
                connectionStatus = when {
                    local -> "local"
                    now - workspace.lastSyncedAt <= 2 * 60 * 1_000 -> "online"
                    else -> "stale"
                },
                sessionHasMore = sessions.size < sessionCount && sessions.size < WORKBENCH_SESSION_MAX_VISIBLE,
            )
        }
    }

    private suspend fun loadArchivedSessions(subject: String): List<WorkbenchSessionItem> =
        database.workbenchDao().allSessions(subject, archived = true).map { session ->
            session.toUiItem()
        }

    private fun ai.drsai.remote.workbench.data.WorkbenchSessionEntity.toUiItem() = WorkbenchSessionItem(
        sessionId, runtimeId, workspaceId, title,
        authority == RuntimeAuthority.LOCAL_DEVICE.name, pinned, unread, updatedAt, "IDLE",
    )

    private fun toEntity(conversation: Conversation, userId: String, createdAt: Long) = ConversationEntity(
        id = conversation.id,
        userId = userId,
        title = conversation.title,
        agentId = conversation.agentId,
        agentName = conversation.agentName,
        agentSource = conversation.agentSource,
        modelId = conversation.modelId,
        createdAt = createdAt,
        updatedAt = conversation.updatedAt,
    )

    private fun recoveryUiStatus(checkpoint: RunCheckpoint): String = when {
            checkpoint.failureCode == "side_effect_unknown" -> text(R.string.side_effect_result_confirmation_required)
            checkpoint.status.name == "WAITING_APPROVAL" -> text(R.string.awaiting_approval)
            checkpoint.status.name == "RUNNING" || checkpoint.status.name == "QUEUED" -> text(R.string.task_recoverable)
            checkpoint.status.name == "PAUSED" -> text(R.string.task_paused_can_continue)
            else -> text(R.string.recovery_failed)
    }

    fun selectModel(modelId: String) {
        val model = mutableState.value.models.firstOrNull { it.id == modelId } ?: return
        tokenStore.selectedModelId = model.id
        val snapshot = mutableState.value
        val conversation = snapshot.currentConversation
        val userId = snapshot.user?.id
        if (conversation == null || conversation.agentSource != "local" || userId == null || conversation.modelId == model.id) {
            update { it.copy(selectedModel = model) }
            return
        }
        val now = System.currentTimeMillis()
        val switchDecision = ai.drsai.remote.workbench.model.SessionModelSwitchPolicy.switch(
            activeOaepRequest?.conversation?.modelId, model.id, text(R.string.model_switch_next_message),
        )
        val switched = conversation.copy(modelId = model.id, updatedAt = now)
        update { state ->
            state.copy(
                currentConversation = switched,
                selectedModel = model,
                capabilityRepair = null,
                error = null,
                runtimeStatus = switchDecision.userMessage,
                conversations = state.conversations.map { item -> if (item.id == switched.id) switched else item },
            )
        }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            val changed = database.dao().updateConversationModel(switched.id, userId, model.id, now)
            check(changed == 1) { "conversation_model_update_failed" }
            database.dao().conversationSnapshot(userId).firstOrNull { it.id == switched.id }?.let { entity ->
                workbenchProjection.projectLocalConversation(entity)
            }
        }
    }

    fun addModelProvider(name: String, baseUrl: String, apiKey: String, modelIds: List<String>) {
        if (name.isBlank() || baseUrl.isBlank() || apiKey.isBlank() || modelIds.none { it.isNotBlank() }) {
            update { it.copy(error = text(R.string.complete_provider_api_key_model_fields)) }
            return
        }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            runCatching {
                modelProviderStore.save(null, "custom", name, baseUrl, "openai", apiKey, modelIds.map(String::trim).filter(String::isNotBlank).distinct().map { ModelInfo("", it, upstreamId = it) })
                refreshModelProviderState()
            }.onFailure { error -> update { it.copy(error = error.message ?: text(R.string.model_provider_save_failed)) } }
        }
    }

    fun deleteModelProvider(providerId: String) {
        if (providerId == "hepai") return
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            runCatching { modelProviderStore.delete(providerId); providerVerificationStore.clear(providerId); refreshModelProviderState() }
                .onFailure { error -> update { it.copy(error = error.message ?: text(R.string.model_provider_delete_failed)) } }
        }
    }

    fun saveModelProvider(
        providerId: String?,
        presetId: String?,
        name: String,
        baseUrl: String,
        wireApi: String,
        apiKey: String,
        models: List<ModelInfo>,
        expectedRevision: Long?,
    ) {
        if (!modelProviderSaveInFlight.tryEnter()) return
        update { it.copy(modelConfigurationBusy = true, modelConfigurationMessage = null, modelConfigurationMessageKind = null) }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            try {
                runCatching {
                    val savedId = modelProviderStore.save(providerId, presetId, name, baseUrl, wireApi, apiKey, models, expectedRevision)
                    refreshModelProviderState()
                    val saved = mutableState.value.modelProviders.firstOrNull { it.id == savedId }
                    val draft = draftVerification
                    val enabled = models.filter(ModelInfo::enabled).map(ModelInfo::upstreamId).toSet()
                    if (saved != null && draft != null && draft.baseUrl.trimEnd('/') == saved.baseUrl.trimEnd('/') &&
                        draft.wireApi == saved.wireApi && draft.verifiedModels.containsAll(enabled)
                    ) {
                        providerVerificationStore.save(draft.copy(providerId = savedId, revision = saved.revision))
                        draftVerification = null
                        refreshModelProviderState()
                    }
                }.onSuccess {
                    update { it.copy(modelConfigurationBusy = false, modelConfigurationMessage = text(R.string.model_provider_saved), modelConfigurationMessageKind = ModelConfigurationMessageKind.SUCCESS) }
                }.onFailure { error ->
                    update { it.copy(modelConfigurationBusy = false, modelConfigurationMessage = modelConfigurationError(error, text(R.string.save_failed)), modelConfigurationMessageKind = ModelConfigurationMessageKind.ERROR) }
                }
            } finally {
                modelProviderSaveInFlight.leave()
            }
        }
    }

    fun discoverProviderModels(providerId: String?, baseUrl: String, wireApi: String, apiKey: String) {
        update { it.copy(modelConfigurationBusy = true, modelConfigurationMessage = null, modelConfigurationMessageKind = null, discoveredProviderModels = emptyList()) }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            runCatching { modelProviderDraftClient.discover(baseUrl.trim().trimEnd('/'), wireApi, apiKey.ifBlank { providerId?.let(modelProviderStore::apiKey).orEmpty() }) }
                .onSuccess { models -> update { it.copy(modelConfigurationBusy = false, discoveredProviderModels = models, modelConfigurationMessage = text(R.string.models_fetched_count, models.size), modelConfigurationMessageKind = ModelConfigurationMessageKind.INFO) } }
                .onFailure { error -> update { it.copy(modelConfigurationBusy = false, modelConfigurationMessage = modelConfigurationError(error, text(R.string.model_fetch_failed)), modelConfigurationMessageKind = ModelConfigurationMessageKind.ERROR) } }
        }
    }

    fun testProviderConnection(
        providerId: String?, baseUrl: String, wireApi: String, apiKey: String,
        expectedModels: List<String> = emptyList(),
    ) {
        update { it.copy(modelConfigurationBusy = true, modelConfigurationMessage = null, modelConfigurationMessageKind = null) }
        viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
            runCatching { modelProviderDraftClient.testConnection(
                baseUrl.trim().trimEnd('/'), wireApi,
                apiKey.ifBlank { providerId?.let(modelProviderStore::apiKey).orEmpty() },
                expectedModels,
            ) }
                .onSuccess { report ->
                    val now = System.currentTimeMillis()
                    val current = providerId?.let { id -> mutableState.value.modelProviders.firstOrNull { it.id == id } }
                    val verification = ProviderVerification(
                        providerId.orEmpty(), current?.revision ?: 0, baseUrl.trimEnd('/'), wireApi,
                        report.discoveredModels.toSet(), now,
                    )
                    if (current != null) providerVerificationStore.save(verification) else draftVerification = verification
                    update { state -> state.copy(
                    modelConfigurationBusy = false,
                    modelConfigurationMessage = text(R.string.connection_models_check_success),
                    modelConfigurationMessageKind = ModelConfigurationMessageKind.SUCCESS,
                    modelProviders = state.modelProviders.map { provider ->
                        if (provider.id == providerId) provider.copy(connectionStatus = "AVAILABLE", lastCheckedAt = now) else provider
                    },
                ) }
                    mutableState.value.user?.id?.let(::publishProductReadiness)
                }
                .onFailure { error -> update { state -> state.copy(
                    modelConfigurationBusy = false,
                    modelConfigurationMessage = modelConfigurationError(error, text(R.string.connection_check_failed)),
                    modelConfigurationMessageKind = ModelConfigurationMessageKind.ERROR,
                    modelProviders = state.modelProviders.map { provider ->
                        if (provider.id == providerId) provider.copy(connectionStatus = "FAILED", lastCheckedAt = System.currentTimeMillis()) else provider
                    },
                ) } }
        }
    }

    fun clearModelConfigurationMessage() {
        update { it.copy(modelConfigurationMessage = null, modelConfigurationMessageKind = null, discoveredProviderModels = emptyList()) }
    }

    private fun modelConfigurationError(error: Throwable, fallback: String): String = when {
        error.message == "config_conflict" -> text(R.string.provider_config_conflict)
        error is ApiException -> {
            val failure = ai.drsai.remote.runtime.errors.UserFacingFailureMapper.map(
                ai.drsai.remote.runtime.errors.FailureSignal(
                    error.code, error.status, error.retryable, "provider", error.message,
                ),
                ai.drsai.remote.runtime.errors.AndroidUserFacingFailureStrings(getApplication()),
            )
            val action = when (failure.primaryAction) {
                    ai.drsai.remote.runtime.errors.FailureAction.UPDATE_CREDENTIAL -> text(R.string.update_api_key)
                    ai.drsai.remote.runtime.errors.FailureAction.RETRY_LATER -> text(R.string.check_again_later)
                    ai.drsai.remote.runtime.errors.FailureAction.CHECK_NETWORK -> text(R.string.check_network_api_host)
                    ai.drsai.remote.runtime.errors.FailureAction.CHOOSE_MODEL -> text(R.string.check_model_id)
                    ai.drsai.remote.runtime.errors.FailureAction.CHECK_PROVIDER_ACCESS -> text(R.string.check_model_permission)
                    ai.drsai.remote.runtime.errors.FailureAction.CHECK_PROVIDER_ACCOUNT -> text(R.string.check_balance_billing)
                    else -> text(R.string.check_current_configuration)
            }
                text(R.string.provider_failure_next_step, failure.title, failure.summary, action, failure.stableCode)
        }
        error is org.json.JSONException -> text(R.string.provider_model_data_unparseable)
        !error.message.isNullOrBlank() -> error.message!!
        else -> fallback
    }

    private suspend fun refreshModelProviderState() {
        val persisted = modelProviderStore.snapshot()
        update { state ->
            val hepai = state.models.filter { it.providerId == "hepai" }
            val configuredModels = persisted.first.filter { it.id != "hepai" }.flatMap { provider ->
                orderPreferredDeepseekModels(persisted.second.filter { it.providerId == provider.id && it.enabled })
            }
            val allModels = hepai + configuredModels
            val providers = verifiedProviders(persisted.first, persisted.second)
            val selected = ModelRecommendationPolicy.select(allModels, providers, state.selectedModel?.id ?: tokenStore.selectedModelId)
            tokenStore.selectedModelId = selected?.id
            state.copy(
                modelProviders = providers.map { provider -> if (provider.id == "hepai") provider.copy(modelIds = hepai.map { it.id }) else provider },
                models = allModels,
                configuredProviderModels = persisted.second,
                selectedModel = selected,
                error = null,
            )
        }
        mutableState.value.user?.id?.let(::publishProductReadiness)
        refreshLiveCapabilityState()
    }

    private fun verifiedProviders(providers: List<ModelProviderConfig>, models: List<ModelInfo>): List<ModelProviderConfig> =
        providers.map { provider ->
            if (provider.id == "hepai") provider.copy(connectionStatus = "AVAILABLE")
            else providerVerificationStore.load(provider.id)?.takeIf {
                ProviderVerificationPolicy.isCurrent(it, provider, models)
            }?.let { provider.copy(connectionStatus = "AVAILABLE", lastCheckedAt = it.checkedAt) }
                ?: provider.copy(connectionStatus = "UNCHECKED", lastCheckedAt = null)
        }

    private fun calculateAgentReadiness(state: AppState): AgentReadiness {
        val model = state.selectedModel
        val provider = model?.let { selected -> state.modelProviders.firstOrNull { it.id == selected.providerId } }
        val credentialAvailable = when (provider?.id) {
            null -> false
            "hepai" -> !tokenStore.accessToken.isNullOrBlank()
            else -> provider.hasApiKey
        }
        val smokeVerified = if (provider != null && state.user != null) {
            fullRuntimeSmokeStore.isVerified(fullRuntimeSmokeIdentity(state.user.id, provider, requireNotNull(model)))
        } else false
        return AgentReadinessPolicy.evaluate(AgentReadinessInput(
            modelSelected = model != null,
            credentialAvailable = credentialAvailable,
            providerVerified = provider?.id == "hepai" || provider?.connectionStatus == "AVAILABLE",
            modelSupportsTools = model?.tools,
            runtimeState = state.fullRuntimeDiagnostic.bindingState,
            networkAvailable = androidNetworkAvailable(),
            functionalSmokeVerified = smokeVerified,
        ), ai.drsai.remote.runtime.readiness.AndroidAgentReadinessStrings(getApplication()))
    }

    private fun fullRuntimeSmokeIdentity(
        subject: String,
        provider: ModelProviderConfig,
        model: ModelInfo,
    ) = ai.drsai.remote.runtime.python.FullRuntimeSmokeIdentity(
        subject, provider.id, provider.revision, model.id, BuildConfig.VERSION_NAME,
        provider.lastCheckedAt ?: 0,
    )

    private fun publishProductReadiness(subject: String) {
        val readiness = calculateAgentReadiness(mutableState.value)
        val current = setupJourneyStore.load(subject)
        val journey = SetupJourneyReducer.initial(
            current, readiness, System.currentTimeMillis(),
            hasExistingActivity = mutableState.value.conversations.isNotEmpty(),
        )
        if (journey != current) setupJourneyStore.save(subject, journey)
        update { it.copy(agentReadiness = readiness, setupJourney = journey) }
    }

    private fun fullLocalRuntimeCapabilities(subject: String) =
        pythonRuntimePreference.killSwitchSnapshot().capabilities(buildSet {
        add(ai.drsai.remote.workbench.model.RuntimeCapability.CHAT)
        add(ai.drsai.remote.workbench.model.RuntimeCapability.ATTACHMENT_INPUT)
        if (memorySettings.enabled(subject)) {
            add(ai.drsai.remote.workbench.model.RuntimeCapability.LOCAL_MEMORY)
        }
        add(ai.drsai.remote.workbench.model.RuntimeCapability.SAFE_DEVICE_INFO)
        add(ai.drsai.remote.workbench.model.RuntimeCapability.APPROVALS)
        add(ai.drsai.remote.workbench.model.RuntimeCapability.ARTIFACTS)
        add(ai.drsai.remote.workbench.model.RuntimeCapability.BACKGROUND_RUNS)
        if (androidNetworkAvailable()) {
            add(ai.drsai.remote.workbench.model.RuntimeCapability.WEB_SEARCH)
            add(ai.drsai.remote.workbench.model.RuntimeCapability.WEB_FETCH)
            add(ai.drsai.remote.workbench.model.RuntimeCapability.BROWSER_SESSION)
            if (mcpToolManager.hasConnected(subject)) {
                add(ai.drsai.remote.workbench.model.RuntimeCapability.MCP)
            }
        }
        if (safWorkspaceStore.hasReadGrant(subject)) {
            add(ai.drsai.remote.workbench.model.RuntimeCapability.PROJECT_FILES)
            add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_READ)
            add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_WRITE)
        }
        })

    private fun androidNetworkAvailable(): Boolean {
        val manager = getApplication<Application>()
            .getSystemService(android.net.ConnectivityManager::class.java) ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun publishFullRuntimeDiagnostic(
        binding: ai.drsai.remote.runtime.python.FullRuntimeBindingSnapshot,
    ) {
        val subject = mutableState.value.user?.id
        val metrics = pythonRuntimeMetrics.snapshot()
        val availableTools = if (subject == null) emptyList() else {
            val schemas = pythonRuntimePreference.killSwitchSnapshot().toolSchemas(
                ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog.schemas(localTools.modelSchemas(subject)),
            )
            (0 until schemas.length()).map { schemas.getJSONObject(it).getString("name") }.sorted()
        }
        val workspaceTools = listOf(
            "workspace.list", "workspace.read", "workspace.search", "workspace.glob", "workspace.grep",
            "workspace.write", "workspace.edit", "workspace.undo",
        )
        val capabilities = subject?.let(::fullLocalRuntimeCapabilities).orEmpty()
        val skills = skillCatalog.snapshot()
        val skillManifestIdentity = skillCatalog.diagnosticIdentity()
        val availableSkills = skills.filter { capabilities.containsAll(it.requiredCapabilities) }.map { it.id }.sorted()
        val permissionRequiredSkills = skills.filterNot { capabilities.containsAll(it.requiredCapabilities) }.map { it.id }.sorted()
        val safeReason = binding.reason?.let {
            ai.drsai.remote.runtime.security.SensitiveDataRedactor.redact(it).take(160)
        }
        update { state ->
            val guidance = ai.drsai.remote.runtime.readiness.CapabilityGuidancePolicy.project(
                availableTools, state.fullRuntimeDiagnostic.modelUnsupportedTools,
                ai.drsai.remote.runtime.readiness.AndroidCapabilityGuidanceStrings(getApplication()),
            )
            state.copy(fullRuntimeDiagnostic = FullRuntimeDiagnosticUi(
                buildEnabled = BuildConfig.FULL_AGENT_RUNTIME_ENABLED && BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED,
                desktopParityComplete = BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE,
                bindingState = binding.state.name,
                health = if (binding.state == ai.drsai.remote.runtime.python.FullRuntimeBindingState.READY) "READY" else "NOT_READY",
            process = binding.identity?.let { "${it.runtimeProcessName} · pid ${it.runtimePid}" } ?: text(R.string.runtime_process_unbound),
                bindReason = safeReason,
                bindLatencyMs = binding.latencyMs,
                starts = metrics.starts,
                bindAttempts = metrics.bindAttempts,
                bindSuccesses = metrics.bindSuccesses,
                safeFallbacks = metrics.safeFallbacks,
                route = state.fullRuntimeDiagnostic.route,
                availableTools = availableTools,
                permissionRequiredTools = workspaceTools.filterNot(availableTools::contains),
                modelUnsupportedTools = state.fullRuntimeDiagnostic.modelUnsupportedTools.filter(availableTools::contains),
                availableSkills = availableSkills,
                permissionRequiredSkills = permissionRequiredSkills,
                kotlinFallbackAvailable = false,
                kernelVersion = binding.identity?.kernelVersion,
                kernelSha256 = binding.identity?.kernelSha256,
                promptVersion = binding.identity?.promptVersion,
                promptSha256 = binding.identity?.promptSha256,
                toolManifestVersion = binding.identity?.toolManifestVersion,
                skillManifestVersion = skillManifestIdentity.version,
                skillManifestSha256 = skillManifestIdentity.sha256,
                capabilityManifestVersion = binding.identity?.capabilityManifestVersion,
                capabilityManifestSha256 = binding.identity?.capabilityManifestSha256,
                hostPortProtocolVersion = binding.identity?.hostPortProtocolVersion,
                modelToolSnapshotVersion = binding.identity?.modelToolSnapshotVersion,
            ), capabilityGuidance = guidance)
        }
        subject?.let(::publishProductReadiness)
    }

    fun enrollAndroidAgentRuntime(registrationCode: String) = viewModelScope.launch(Dispatchers.IO) {
        val user = tokenStore.user() ?: return@launch
        update { it.copy(runtimeStatus = "registering-android-runtime", error = null) }
        runCatching {
            ai.drsai.remote.runtime.oaep.AndroidRuntimeEnrollmentClient().enroll(
                relayHttpsUrl = BuildConfig.RELAY_BASE_URL,
                registrationCode = registrationCode.trim(),
                ownerSubject = user.id,
                displayName = "Android Agent Runtime",
                version = BuildConfig.VERSION_NAME,
                signer = ai.drsai.remote.remote.security.KeystoreWrappedRelayDeviceSigner(getApplication()),
                store = androidRuntimeEnrollmentStore,
            )
            androidOaepRelayManager.startForOwner(user.id)
        }.onSuccess {
            update { it.copy(runtimeStatus = "android-runtime-online") }
        }.onFailure { error ->
            update { it.copy(runtimeStatus = "android-runtime-registration-failed", error = error.message) }
        }
    }

    override fun onCleared() {
        runCatching {
            getApplication<Application>().getSystemService(android.net.ConnectivityManager::class.java)
                ?.unregisterNetworkCallback(networkCallback)
        }
        androidOaepRelayManager.close()
        super.onCleared()
    }

    fun openOaepRun(subject: String, runId: String, sessionId: String, interactionId: String? = null) =
        viewModelScope.launch(Dispatchers.IO) {
            if (subject.isBlank() || runId.isBlank() || sessionId.isBlank()) return@launch
            val user = tokenStore.user() ?: return@launch
            if (user.id != subject) return@launch
            state.filter { it.user?.id == user.id && !it.loading }.first()
            val entity = database.dao().conversationSnapshot(user.id).firstOrNull { it.id == sessionId }
                ?: return@launch
            val runtimeId = if (entity.agentSource == "platform") "hai-platform" else "android-local"
            val workspaceId = if (entity.agentSource == "platform") "platform" else "local"
            val snapshot = ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore(database).snapshot(
                ai.drsai.remote.runtime.oaep.AndroidOaepOwner(user.id, ""), runtimeId, workspaceId, sessionId,
            ) ?: return@launch
            if (snapshot.runs.none { it.id == runId }) return@launch
            if (!interactionId.isNullOrBlank() && snapshot.items.none { it.id == interactionId && it.runId == runId && it.type == "interaction" }) {
                return@launch
            }
            openConversation(sessionId)
        }

    private suspend fun loadConversations(
        subject: String,
        entities: List<ConversationEntity>,
    ): List<Conversation> = entities.map { entity ->
        localOaepLegacyProjection.conversation(subject, "", entity) ?: toConversation(entity)
    }

    private suspend fun loadOaepUi(
        subject: String,
        conversationId: String,
    ): ai.drsai.remote.runtime.oaep.LocalOaepLegacyProjection.UiProjection? {
        val entity = database.dao().conversationSnapshot(subject).firstOrNull { it.id == conversationId }
            ?: return null
        return localOaepLegacyProjection.uiProjection(subject, "", entity)
    }

    private suspend fun refreshOaepUi(subject: String, conversationId: String) {
        val projection = loadOaepUi(subject, conversationId) ?: return
        val active = projection.runStatus in setOf("queued", "running", "waiting")
        update { state -> state.copy(
            oaepTranscript = projection.entries,
            oaepTimeline = projection.timeline,
            oaepRunStatus = projection.runStatus,
            oaepActiveRunId = projection.activeRunId,
            oaepSnapshotSequence = projection.snapshotSequence,
            oaepDiagnosticEvents = projection.diagnosticEvents,
            streaming = active,
            recovering = projection.recovering,
            runtimeStatus = projection.runtimeStatus,
            toolDowngraded = projection.entries.any { it.kind == "notice" && it.title == "tool_downgraded" },
            error = when (projection.runStatus) {
                "failed" -> projection.errorMessage ?: "Android Agent Run failed"
                "completed", "cancelled" -> null
                else -> state.error
            },
        ) }
    }

    private suspend fun persistOaepLifecycle(
        request: ChatRunRequest,
        suffix: String,
        event: ai.drsai.remote.runtime.oaep.NormalizedAgentEvent,
    ) {
        val envelope = ai.drsai.remote.runtime.python.PythonRuntimeEnvelope(
            messageType = ai.drsai.remote.runtime.python.PythonRuntimeMessageType.RUNTIME_EVENT,
            requestId = "$suffix:${request.runId.take(100)}",
            runId = request.runId,
            sessionId = request.conversation.id,
            sequence = 0,
            idempotencyKey = "${request.runId}:$suffix",
            payload = org.json.JSONObject().put("kind", suffix),
        )
        runCatching { oaepNormalizedSink.accept(request, envelope, listOf(event)) }
    }

    private suspend fun persistOaepEvents(
        request: ChatRunRequest,
        suffix: String,
        events: List<ai.drsai.remote.runtime.oaep.NormalizedAgentEvent>,
    ) {
        val envelope = ai.drsai.remote.runtime.python.PythonRuntimeEnvelope(
            messageType = ai.drsai.remote.runtime.python.PythonRuntimeMessageType.RUNTIME_EVENT,
            requestId = "$suffix:${request.runId.take(100)}",
            runId = request.runId,
            sessionId = request.conversation.id,
            sequence = 0,
            idempotencyKey = "${request.runId}:$suffix",
            payload = org.json.JSONObject().put("kind", suffix),
        )
        oaepNormalizedSink.accept(request, envelope, events)
    }

    private fun recoverableOaepRequest(): ChatRunRequest? {
        val checkpoint = recoverableRun ?: return null
        val user = mutableState.value.user ?: return null
        val conversation = mutableState.value.currentConversation
            ?.takeIf { it.id == checkpoint.command.sessionId.value } ?: return null
        return ChatRunRequest(
            accountSubject = user.id,
            authority = checkpoint.command.binding.authority,
            conversation = conversation,
            input = checkpoint.command.input,
            attachments = emptyList(),
            runId = checkpoint.command.runId.value,
            userMessageId = checkpoint.command.idempotencyKey,
            assistantMessageId = "${checkpoint.command.runId.value}:assistant",
        )
    }

    private fun toolLabel(name: String) = when (name) {
        "get_current_time" -> text(R.string.reading_current_time)
        "save_memory" -> text(R.string.saving_local_memory)
        "search_memory" -> text(R.string.searching_local_memory)
        else -> text(R.string.using_local_tool)
    }
}
