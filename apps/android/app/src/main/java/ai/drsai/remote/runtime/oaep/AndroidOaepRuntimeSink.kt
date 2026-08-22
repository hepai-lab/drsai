package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepResourceRef
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

fun interface AndroidOaepNormalizedSink {
    suspend fun accept(
        request: ChatRunRequest,
        envelope: PythonRuntimeEnvelope,
        events: List<NormalizedAgentEvent>,
    )
}

enum class AndroidOaepFaultPoint { STATE_APPLIED, TRANSACTION_COMMITTED }

fun interface AndroidOaepFaultInjector {
    fun hit(point: AndroidOaepFaultPoint, dedupeKey: String)
}

class RoomAndroidOaepRuntimeSink(
    private val store: RoomAndroidOaepStore,
    private val organization: (ChatRunRequest) -> String = { "" },
    private val workspaceId: (ChatRunRequest) -> String = {
        if (it.authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "local" else "platform"
    },
    private val runtimeId: (ChatRunRequest) -> String = {
        if (it.authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "android-local" else "hai-platform"
    },
    private val sourceRuntimeId: (ChatRunRequest) -> String = runtimeId,
    private val backend: (ChatRunRequest) -> String = {
        if (it.authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "android-agent" else "platform-agent"
    },
    private val clock: () -> String = { Instant.now().toString() },
    private val faultInjector: AndroidOaepFaultInjector = AndroidOaepFaultInjector { _, _ -> },
) : AndroidOaepNormalizedSink {
    private val writers = ConcurrentHashMap<String, AndroidOaepWriter>()
    private val locks = ConcurrentHashMap<String, Mutex>()

    override suspend fun accept(
        request: ChatRunRequest,
        envelope: PythonRuntimeEnvelope,
        events: List<NormalizedAgentEvent>,
    ) {
        if (events.isEmpty()) return
        require(envelope.runId == request.runId && envelope.sessionId == request.conversation.id) {
            "oaep_runtime_envelope_scope_mismatch"
        }
        val owner = AndroidOaepOwner(request.accountSubject, organization(request))
        val scope = AndroidOaepScope(
            workspaceId = workspaceId(request),
            sessionId = request.conversation.id,
            runId = request.runId,
            backend = backend(request),
            runtimeId = runtimeId(request),
            sessionTitle = request.conversation.title,
            sourceRuntimeId = sourceRuntimeId(request),
        )
        val writerKey = listOf(owner.subject, owner.organization, scope.runtimeId, scope.sessionId, scope.runId)
            .joinToString("\u0000")
        locks.computeIfAbsent(writerKey) { Mutex() }.withLock {
            var writer = writers[writerKey] ?: run {
                val restored = store.load(owner, scope)
                AndroidOaepWriter(scope, restored?.session?.createdAt ?: clock(), restored).also {
                    writers[writerKey] = it
                }
            }

            suspend fun commitCandidate(
                dedupeKey: String,
                transition: (AndroidOaepWriter) -> AndroidOaepWriteResult,
            ) {
                val candidate = AndroidOaepWriter(scope, writer.state.session.createdAt, writer.state)
                val result = transition(candidate)
                faultInjector.hit(AndroidOaepFaultPoint.STATE_APPLIED, dedupeKey)
                try {
                    store.commit(owner, scope, result)
                    faultInjector.hit(AndroidOaepFaultPoint.TRANSACTION_COMMITTED, dedupeKey)
                } catch (error: Throwable) {
                    // A failed or interrupted commit must never leave the cached Writer
                    // ahead of Room. The next attempt reconstructs from durable authority.
                    writers.remove(writerKey)
                    throw error
                }
                writer = candidate
                writers[writerKey] = candidate
            }
            if ("${request.runId}:user-input" !in writer.state.acceptedDedupeKeys) {
                val resources = request.attachments.map { attachment ->
                    OaepResourceRef(
                        workspaceId = scope.workspaceId,
                        resourceType = "artifact",
                        resourceId = attachment.id,
                        label = attachment.name,
                        digest = attachment.sha256.lowercase().takeIf { it.matches(Regex("^[a-f0-9]{64}$")) },
                    )
                }
                val inputDedupeKey = "${request.runId}:user-input"
                commitCandidate(inputDedupeKey) { candidate -> candidate.apply(
                    inputDedupeKey, NormalizedAgentEvent.ItemCompleted(
                        request.userMessageId,
                        "message",
                        OaepMessageContent(
                            role = "user",
                            text = request.input,
                            phase = "final",
                            parts = listOfNotNull(request.input.takeIf(String::isNotEmpty)?.let { text ->
                                mapOf("type" to "text", "text" to text)
                            }) + request.attachments.zip(resources).map { (attachment, resource) ->
                                mapOf(
                                    "type" to when {
                                        attachment.kind == "image" || attachment.mimeType.startsWith("image/") -> "image"
                                        attachment.kind == "audio" || attachment.mimeType.startsWith("audio/") -> "audio"
                                        else -> "file"
                                    },
                                    "name" to attachment.name,
                                    "mime_type" to attachment.mimeType,
                                    "resource_ref" to mapOf(
                                        "protocol" to resource.protocol,
                                        "workspace_id" to resource.workspaceId,
                                        "resource_type" to resource.resourceType,
                                        "resource_id" to resource.resourceId,
                                        "label" to resource.label,
                                        "digest" to resource.digest,
                                    ).filterValues { it != null },
                                )
                            },
                            resourceRefs = resources,
                        ),
                    ),
                    clock(),
                ) }
            }
            commitCandidate(envelope.idempotencyKey) { candidate ->
                candidate.applyAll(envelope.idempotencyKey, events, clock())
            }
            if (writer.state.run.status in setOf("completed", "failed", "cancelled")) {
                writers.remove(writerKey, writer)
                locks.remove(writerKey)
            }
        }
    }
}
