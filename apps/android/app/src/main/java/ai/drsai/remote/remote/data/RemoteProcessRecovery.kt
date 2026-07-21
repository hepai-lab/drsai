package ai.drsai.remote.remote.data

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.Job

data class RecoverableRemoteRun(val identity: RemoteRunIdentity, val cachedStatus: RemoteRunStatus,
                                val lastSequence: Long, val lastSyncedAt: Long, val authoritative: Boolean = false)

class RemoteProcessRecovery(private val database: ChatDatabase, private val repository: RelayRemoteRepository) {
    suspend fun cached(subject: String, organization: String): List<RecoverableRemoteRun> {
        return runCatching {
            database.remoteDao().recoverableRuns(subject, organization).map { row ->
                RecoverableRemoteRun(RemoteRunIdentity(RuntimeId(row.runtimeId), WorkspaceId(row.workspaceId),
                    SessionId(row.sessionId), RunId(row.runId), row.backendId),
                    RemoteRunStatus.valueOf(row.status.uppercase()),
                    row.lastSequence, row.lastSyncedAt, authoritative = false)
            }
        }.getOrElse {
            // Remote projections are explicitly non-authoritative. A malformed projection is
            // removed account-locally and rebuilt from Runtime authority on the next refresh.
            RemoteCacheRepository(database).clearAccount(subject, organization)
            emptyList()
        }
    }

    suspend fun reauthenticateHandshakeAndQuery(cached: RecoverableRemoteRun): Pair<RemoteRunIdentity, String> {
        val authoritative = repository.getRun(cached.identity.runtimeId, cached.identity.runId)
        cached.identity.requireSameScope(authoritative.first)
        return authoritative
    }
}

class RemoteRunLifecycleObserver(
    private val stopSse: () -> Unit,
    private val queryAndResume: () -> Job,
) : DefaultLifecycleObserver {
    private var resumeJob: Job? = null
    override fun onStop(owner: LifecycleOwner) { stopSse(); resumeJob?.cancel(); resumeJob = null }
    override fun onStart(owner: LifecycleOwner) { resumeJob?.cancel(); resumeJob = queryAndResume() }
}
