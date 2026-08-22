package ai.drsai.remote.runtime.oaep

import android.content.Context
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.security.KeystoreWrappedRelayDeviceSigner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Account-scoped production lifecycle for the Android Agent Runtime Relay channel. */
class AndroidOaepRelayManager(
    context: Context,
    private val database: ChatDatabase,
    private val enrollments: AndroidRuntimeEnrollmentStore,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val app = context.applicationContext
    private val lock = Mutex()
    private var ownerSubject: String? = null
    private var connector: AndroidOaepRelayConnector? = null

    suspend fun startForOwner(subject: String): Boolean = lock.withLock {
        require(subject.isNotBlank()) { "oaep_relay_subject_required" }
        val enrollment = enrollments.load(subject) ?: return@withLock false
        if (ownerSubject == subject && connector != null) return@withLock true
        connector?.stop()
        val owner = AndroidOaepOwner(subject, "")
        val localStore = RoomAndroidOaepStore(database)
        val authority = RoomAndroidOaepRelayAuthority(localStore, owner, LOCAL_RUNTIME_ID)
        val cursors = SharedPreferencesAndroidOaepRelayCursorStore(app, subject, enrollment.runtimeId)
        val sessions = localStore.relaySessions(owner, LOCAL_RUNTIME_ID)
        AndroidOaepRelayBootstrap(authority, cursors).seedExistingSessions(sessions)
        connector = AndroidOaepRelayConnector(
            credential = enrollment.connectorCredential(),
            signer = KeystoreWrappedRelayDeviceSigner(app),
            protocol = AndroidOaepRelayProtocol(enrollment.runtimeId, subject, authority),
            sessions = { localStore.relaySessions(owner, LOCAL_RUNTIME_ID) },
            cursors = cursors,
            scope = scope,
        ).also(AndroidOaepRelayConnector::start)
        ownerSubject = subject
        true
    }

    suspend fun stopForOwner(subject: String? = null) = lock.withLock {
        if (subject != null && ownerSubject != subject) return@withLock
        connector?.stop()
        connector = null
        ownerSubject = null
    }

    fun close() {
        connector?.stop()
        connector = null
        ownerSubject = null
        scope.cancel()
    }

    companion object {
        const val LOCAL_RUNTIME_ID = "android-local"
    }
}
