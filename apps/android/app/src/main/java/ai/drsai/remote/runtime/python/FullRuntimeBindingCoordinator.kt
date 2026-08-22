package ai.drsai.remote.runtime.python

import android.content.Context
import java.io.Closeable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

enum class FullRuntimeBindingState { UNINITIALIZED, BINDING, READY, RECOVERING, UNAVAILABLE }

data class FullRuntimeIdentity(
    val kernelId: String,
    val kernelVersion: String,
    val kernelSha256: String,
    val promptVersion: String,
    val promptSha256: String,
    val toolManifestVersion: String,
    val capabilityManifestVersion: String,
    val capabilityManifestSha256: String,
    val hostPortProtocolVersion: String = "p9-host-port-v1",
    val modelToolSnapshotVersion: String = "p9-model-tools-v1",
    val runtimeProcessName: String,
    val runtimePid: Int,
) {
    init {
        require(kernelId == "drsai-agent-kernel") { "agent_kernel_id_invalid" }
        require(kernelVersion.isNotBlank()) { "agent_kernel_version_invalid" }
        require(promptVersion.isNotBlank()) { "agent_prompt_version_invalid" }
        require(toolManifestVersion.isNotBlank()) { "tool_manifest_version_invalid" }
        require(capabilityManifestVersion.isNotBlank()) { "capability_manifest_version_invalid" }
        require(hostPortProtocolVersion.isNotBlank()) { "host_port_protocol_version_invalid" }
        require(modelToolSnapshotVersion.isNotBlank()) { "model_tool_snapshot_version_invalid" }
        require(runtimeProcessName.endsWith(":runtime")) { "runtime_process_name_invalid" }
        require(runtimePid > 0) { "runtime_pid_invalid" }
        listOf(kernelSha256, promptSha256, capabilityManifestSha256).forEach {
            require(it.matches(Regex("^[0-9a-f]{64}$"))) { "runtime_identity_digest_invalid" }
        }
    }
}

data class FullRuntimeBindingSnapshot(
    val state: FullRuntimeBindingState = FullRuntimeBindingState.UNINITIALIZED,
    val accountSubject: String? = null,
    val attempt: Int = 0,
    val latencyMs: Long? = null,
    val reason: String? = null,
    val identity: FullRuntimeIdentity? = null,
)

fun interface FullRuntimeReadiness {
    suspend fun ensureReady(accountSubject: String)

    companion object {
        val AlwaysReady = FullRuntimeReadiness { }
    }
}

interface FullRuntimeBindingListener {
    fun onConnectionLost(reason: String)
}

interface FullRuntimeBindingTransport : Closeable {
    suspend fun bind()
    fun setBindingListener(listener: FullRuntimeBindingListener?)
    fun runtimeIdentity(): FullRuntimeIdentity? = null
}

fun interface FullRuntimeBindingDiagnosticSink {
    fun record(snapshot: FullRuntimeBindingSnapshot)

    companion object {
        val None = FullRuntimeBindingDiagnosticSink { }
    }
}

class SharedPreferencesFullRuntimeBindingDiagnostics(context: Context) : FullRuntimeBindingDiagnosticSink {
    private val preferences = context.getSharedPreferences("full_runtime_binding_v1", Context.MODE_PRIVATE)

    override fun record(snapshot: FullRuntimeBindingSnapshot) {
        preferences.edit()
            .putString("state", snapshot.state.name)
            .putString("subject", snapshot.accountSubject)
            .putInt("attempt", snapshot.attempt)
            .putLong("latency_ms", snapshot.latencyMs ?: -1)
            .putString("reason", snapshot.reason)
            .putString("kernel_sha256", snapshot.identity?.kernelSha256)
            .putString("prompt_sha256", snapshot.identity?.promptSha256)
            .putString("tool_manifest_version", snapshot.identity?.toolManifestVersion)
            .putString("capability_manifest_sha256", snapshot.identity?.capabilityManifestSha256)
            .putString("host_port_protocol_version", snapshot.identity?.hostPortProtocolVersion)
            .putString("model_tool_snapshot_version", snapshot.identity?.modelToolSnapshotVersion)
            .putString("runtime_process_name", snapshot.identity?.runtimeProcessName)
            .putInt("runtime_pid", snapshot.identity?.runtimePid ?: -1)
            .putLong("recorded_at", System.currentTimeMillis())
            .apply()
    }
}

/** Owns the only local Agent Runtime binding for one authenticated account. */
class FullRuntimeBindingCoordinator(
    private val scope: CoroutineScope,
    private val transport: FullRuntimeBindingTransport,
    private val diagnostics: FullRuntimeBindingDiagnosticSink = FullRuntimeBindingDiagnosticSink.None,
    private val maxAttempts: Int = 2,
    // Transport binding includes one-time Python extraction after install/data
    // clear. Performance is measured separately; this deadline prevents a hung
    // bind without cancelling a healthy cold start and forcing it to begin again.
    private val bindTimeoutMs: Long = 45_000,
    private val retryDelayMs: Long = 100,
) : FullRuntimeReadiness, Closeable {
    private val lock = Mutex()
    private val mutableState = MutableStateFlow(FullRuntimeBindingSnapshot())
    val state: StateFlow<FullRuntimeBindingSnapshot> = mutableState.asStateFlow()

    init {
        require(maxAttempts > 0) { "full_runtime_attempts_invalid" }
        transport.setBindingListener(object : FullRuntimeBindingListener {
            override fun onConnectionLost(reason: String) {
                val subject = mutableState.value.accountSubject ?: return
                publish(FullRuntimeBindingSnapshot(FullRuntimeBindingState.RECOVERING, subject, reason = reason))
                scope.launch { runCatching { bindInternal(subject, recovering = true) } }
            }
        })
    }

    suspend fun bind(accountSubject: String) {
        require(accountSubject.isNotBlank()) { "full_runtime_subject_required" }
        bindInternal(accountSubject, recovering = false)
    }

    override suspend fun ensureReady(accountSubject: String) {
        if (mutableState.value.let { it.state == FullRuntimeBindingState.READY && it.accountSubject == accountSubject }) return
        bind(accountSubject)
        check(mutableState.value.let { it.state == FullRuntimeBindingState.READY && it.accountSubject == accountSubject }) {
            "full_runtime_unavailable"
        }
    }

    suspend fun release(accountSubject: String) = lock.withLock {
        if (mutableState.value.accountSubject != accountSubject) return@withLock
        transport.close()
        publish(FullRuntimeBindingSnapshot())
    }

    override fun close() {
        transport.setBindingListener(null)
        transport.close()
        publish(FullRuntimeBindingSnapshot())
    }

    private suspend fun bindInternal(accountSubject: String, recovering: Boolean) = lock.withLock {
        val current = mutableState.value
        if (current.state == FullRuntimeBindingState.READY && current.accountSubject == accountSubject) return@withLock
        if (current.accountSubject != null && current.accountSubject != accountSubject) {
            transport.close()
            publish(FullRuntimeBindingSnapshot())
        }
        var lastError: Throwable? = null
        repeat(maxAttempts) { index ->
            val attempt = index + 1
            val started = System.nanoTime()
            publish(FullRuntimeBindingSnapshot(
                if (recovering) FullRuntimeBindingState.RECOVERING else FullRuntimeBindingState.BINDING,
                accountSubject,
                attempt,
            ))
            try {
                withTimeout(bindTimeoutMs) { transport.bind() }
                publish(FullRuntimeBindingSnapshot(
                    FullRuntimeBindingState.READY,
                    accountSubject,
                    attempt,
                    (System.nanoTime() - started) / 1_000_000,
                    identity = transport.runtimeIdentity(),
                ))
                return@withLock
            } catch (error: Throwable) {
                lastError = error
                if (attempt < maxAttempts) delay(retryDelayMs)
            }
        }
        val reason = lastError?.message?.take(160) ?: "full_runtime_bind_failed"
        publish(FullRuntimeBindingSnapshot(
            FullRuntimeBindingState.UNAVAILABLE, accountSubject, maxAttempts, reason = reason,
        ))
        throw IllegalStateException("full_runtime_unavailable:$reason", lastError)
    }

    private fun publish(snapshot: FullRuntimeBindingSnapshot) {
        mutableState.value = snapshot
        diagnostics.record(snapshot)
    }
}
