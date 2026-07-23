package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.generated.OwopSchemaGenerated

val OWOP_PROTOCOL_VERSION: String = OwopSchemaGenerated.VERSION

enum class ReadOnlyWorkspaceOperation(val wireName: String) {
    WORKSPACE_DESCRIBE("workspace.describe"),
    FILES_LIST("files.list"),
    FILES_STAT("files.stat"),
    FILES_READ("files.read"),
    FILES_SEARCH("search.query"),
    GIT_STATUS("git.status"),
    GIT_DIFF("git.diff"),
    GIT_FILE_AT_REF("git.file_at_ref"),
    ARTIFACT_METADATA("artifact.metadata"),
    ARTIFACT_READ("artifact.chunk"),
    ;

    init {
        require(wireName in OwopSchemaGenerated.OPERATIONS) { "owop_operation_missing_from_schema" }
    }
}

data class OwopRequest(
    val version: String = OWOP_PROTOCOL_VERSION,
    val requestId: String,
    val workspaceId: WorkspaceId,
    val operation: ReadOnlyWorkspaceOperation,
    val params: Map<String, Any?>,
    val correlationId: String,
    val binding: String = "relay",
)

sealed interface OwopResult {
    data class Success(val requestId: String, val result: Map<String, Any?>) : OwopResult
    data class Failure(
        val requestId: String,
        val code: String,
        val message: String,
        val correlationId: String,
        val retryable: Boolean,
        val details: Map<String, Any?> = emptyMap(),
    ) : OwopResult
}

fun interface OwopRelayTransport {
    suspend fun execute(request: OwopRequest): OwopResult
}

class RelayWorkspaceOperationsClient(private val transport: OwopRelayTransport) {
    suspend fun listFiles(workspaceId: WorkspaceId, path: String, requestId: String, correlationId: String,
                          cursor: String? = null, depth: Int = 1, limit: Int = 100): OwopResult {
        require(depth in 1..4 && limit in 1..500) { "files_list_bounds_invalid" }
        return execute(workspaceId, ReadOnlyWorkspaceOperation.FILES_LIST,
            buildMap { put("path", path); put("depth", depth); put("limit", limit); cursor?.let { put("cursor", it) } },
            requestId, correlationId)
    }

    suspend fun statFile(workspaceId: WorkspaceId, path: String, requestId: String, correlationId: String): OwopResult =
        execute(workspaceId, ReadOnlyWorkspaceOperation.FILES_STAT, mapOf("path" to path), requestId, correlationId)

    suspend fun readFile(
        workspaceId: WorkspaceId,
        path: String,
        offset: Long,
        length: Long,
        requestId: String,
        correlationId: String,
    ): OwopResult {
        require(offset >= 0) { "file_offset_invalid" }
        require(length in 1..1_048_576) { "file_chunk_length_invalid" }
        return execute(
            workspaceId,
            ReadOnlyWorkspaceOperation.FILES_READ,
            mapOf("path" to path, "offset" to offset, "length" to length),
            requestId,
            correlationId,
        )
    }

    suspend fun gitStatus(workspaceId: WorkspaceId, requestId: String, correlationId: String): OwopResult =
        execute(workspaceId, ReadOnlyWorkspaceOperation.GIT_STATUS, emptyMap(), requestId, correlationId)

    suspend fun gitDiff(
        workspaceId: WorkspaceId,
        path: String?,
        requestId: String,
        correlationId: String,
    ): OwopResult = execute(
        workspaceId,
        ReadOnlyWorkspaceOperation.GIT_DIFF,
        path?.let { mapOf("path" to it) } ?: emptyMap(),
        requestId,
        correlationId,
    )

    suspend fun searchFiles(workspaceId: WorkspaceId, query: String, cursor: String?, timeoutMs: Long,
                            requestId: String, correlationId: String): OwopResult {
        require(query.isNotBlank() && query.length <= 500) { "search_query_invalid" }
        require(timeoutMs in 100..10_000) { "search_timeout_invalid" }
        return execute(workspaceId, ReadOnlyWorkspaceOperation.FILES_SEARCH,
            buildMap { put("query", query); put("limit", 500); put("timeout_ms", timeoutMs); cursor?.let { put("cursor", it) } }, requestId, correlationId)
    }

    suspend fun fileAtRef(workspaceId: WorkspaceId, relativePath: String, ref: String, maxBytes: Long,
                          requestId: String, correlationId: String): OwopResult {
        require(maxBytes in 1..1_048_576) { "git_file_limit_invalid" }
        return execute(workspaceId, ReadOnlyWorkspaceOperation.GIT_FILE_AT_REF,
            mapOf("path" to relativePath, "ref" to ref, "max_bytes" to maxBytes), requestId, correlationId)
    }

    suspend fun artifactMetadata(workspaceId: WorkspaceId, artifactId: String, requestId: String,
                                 correlationId: String): OwopResult = execute(workspaceId,
        ReadOnlyWorkspaceOperation.ARTIFACT_METADATA, mapOf("artifact_id" to artifactId), requestId, correlationId)

    suspend fun artifactChunk(workspaceId: WorkspaceId, artifactId: String, offset: Long, length: Long,
                              requestId: String, correlationId: String): OwopResult {
        require(offset >= 0 && length in 1..1_048_576) { "artifact_chunk_bounds_invalid" }
        return execute(workspaceId, ReadOnlyWorkspaceOperation.ARTIFACT_READ,
            mapOf("artifact_id" to artifactId, "offset" to offset, "length" to length), requestId, correlationId)
    }

    private suspend fun execute(
        workspaceId: WorkspaceId,
        operation: ReadOnlyWorkspaceOperation,
        arguments: Map<String, Any?>,
        requestId: String,
        correlationId: String,
    ): OwopResult {
        require(requestId.isNotBlank()) { "owop_request_id_required" }
        require(correlationId.isNotBlank()) { "owop_correlation_id_required" }
        return transport.execute(
            OwopRequest(
                requestId = requestId,
                workspaceId = workspaceId,
                operation = operation,
                params = arguments,
                correlationId = correlationId,
            )
        )
    }
}
