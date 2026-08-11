package ai.drsai.remote.remote.data

import android.app.Application
import androidx.room.Room
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.ChatDatabase
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
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Process-owned dependency graph for the mobile remote workspace.
 *
 * ViewModels borrow these resources and must never close them. This prevents
 * page navigation from creating competing Room instances, connection pools,
 * token refresh coordinators, and device-proof identities.
 */
class RemoteWorkspaceContainer private constructor(private val app: Application) {
    val tokenStore: SecureTokenStore = SecureTokenStore(app)
    val auth: AccessTokenCoordinator = AccessTokenCoordinator(
        tokenStore,
        OidcClient(refreshClientId = { tokenStore.oidcClientId }),
    )
    val deviceProof: RelayDeviceProof = androidRelayDeviceProof(app)
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    val database: ChatDatabase = Room.databaseBuilder(app, ChatDatabase::class.java, DATABASE_NAME)
        .addMigrations(
            MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
            MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9,
            MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13,
            MIGRATION_13_14,
        )
        .build()
    val repository = RelayRemoteRepository(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        http,
        auth::refreshAfter,
        deviceProof,
    )
    val stream = RelaySseClient(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        http,
        auth::refreshAfter,
        deviceProof,
    )
    val oaepSessions = OaepSessionRepository(repository, stream)
    val legacyConversations = LegacyConversationAdapter(repository, stream)
    val relayDiscovery: RelayDiscoveryService = HttpRelayDiscoveryService(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        auth::refreshAfter,
        http,
        deviceProof,
    )
    val connectivity = AndroidRemoteConnectivity(app)
    val cache = RemoteCacheRepository(database)
    val directoryCache = RoomRemoteDirectoryCache(database)
    val singleFlight = RemoteSingleFlight()
    val resourceLeases = RemoteResourceLeaseRegistry()
    val drafts = RemoteDraftStore(app)
    val unifiedSearch = RemoteUnifiedSearch(database)
    val activity = RemoteActivityStore(app)
    val runControls = RemoteRunControlLedger(app)
    val approvalDecisions = RemoteApprovalDecisionLedger(app)
    val protocolTelemetry = RemoteProtocolTelemetry(app)

    fun workspace(runtimeId: RuntimeId): RelayWorkspaceOperationsClient = RelayWorkspaceOperationsClient(
        HttpOwopRelayTransport(BuildConfig.RELAY_BASE_URL, runtimeId, auth::current, http, deviceProof),
    )

    companion object {
        private const val DATABASE_NAME = "opendrsai.db"
        @Volatile private var instance: RemoteWorkspaceContainer? = null

        fun get(app: Application): RemoteWorkspaceContainer = instance ?: synchronized(this) {
            instance ?: RemoteWorkspaceContainer(app).also { instance = it }
        }

        internal fun identityForTests(app: Application): Triple<ChatDatabase, OkHttpClient, AccessTokenCoordinator> {
            val value = get(app)
            return Triple(value.database, value.http, value.auth)
        }
    }
}
