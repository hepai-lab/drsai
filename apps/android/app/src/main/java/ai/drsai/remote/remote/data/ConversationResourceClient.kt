package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteTranscriptResource
import ai.drsai.remote.remote.model.WorkspaceId
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.Base64
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

data class AndroidResourceCapabilities(
    val readCurrent: Boolean,
    val preview: Boolean,
    val download: Boolean,
    val readSnapshot: Boolean,
    val reveal: Boolean,
    val openExternal: Boolean,
    val copyLogicalPath: Boolean,
)

data class AndroidResourceStateSemantics(
    val status: String,
    val primary: String,
    val secondary: List<String>,
    val recovery: List<String>,
)

fun androidResourceStateSemantics(
    state: String,
    capabilities: AndroidResourceCapabilities,
    hasObservedVersion: Boolean,
): AndroidResourceStateSemantics {
    val status = state.takeIf { it in setOf("available", "moved", "changed", "deleted", "offline", "unsupported") }
        ?: "unsupported"
    if (status == "offline") return AndroidResourceStateSemantics(status, "details", emptyList(), listOf("retry", "switch_runtime"))
    if (status == "unsupported") return AndroidResourceStateSemantics(status, "details", emptyList(), emptyList())
    val observed = hasObservedVersion && capabilities.readSnapshot && capabilities.preview
    val current = status != "deleted" && capabilities.readCurrent
    val primary = when {
        current && capabilities.preview -> "preview_current"
        current && capabilities.reveal -> "reveal_current"
        observed -> "preview_observed"
        else -> "details"
    }
    val secondary = buildList {
        if (observed && primary != "preview_observed") add("preview_observed")
        if (capabilities.download) add("download")
        if (current && capabilities.copyLogicalPath) add("copy_logical_path")
    }
    return AndroidResourceStateSemantics(status, primary, secondary, emptyList())
}

data class AndroidResourceDescriptor(
    val associationId: String,
    val name: String,
    val state: String,
    val mimeType: String,
    val size: Long,
    val currentVersionId: String,
    val observedVersionId: String?,
    val capabilities: AndroidResourceCapabilities,
    val previewText: String? = null,
)

class ConversationResourceClient(private val client: RelayResourceOperationsClient) {
    suspend fun resolve(resource: RemoteTranscriptResource): AndroidResourceDescriptor {
        val workspace = resource.requireWorkspace()
        val result = client.resolveBatch(workspace, listOf(buildMap {
            put("association_id", resource.id)
            put("resource", resource.resourceKey())
            resource.observedVersionId?.let { put("observed_version_id", it) }
        }), UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
        val descriptor = (result["results"] as? List<*>)?.firstOrNull().record()?.get("descriptor").record()
            ?: error("resource_descriptor_missing")
        val state = descriptor["state"] as? String ?: "unsupported"
        val current = descriptor["current_version"].record() ?: error("resource_current_version_missing")
        val observed = descriptor["observed_version"].record()
        val capabilities = descriptor["capabilities"].record() ?: emptyMap()
        val capabilityNames = setOf("read_current", "read_snapshot", "preview", "download", "reveal", "open_external", "copy_logical_path")
        val capabilitiesValid = capabilities.keys == capabilityNames && capabilities.values.all { it is Boolean }
        val safeCapabilities = if (capabilitiesValid) capabilities else capabilityNames.associateWith { false }
        val safeState = state.takeIf {
            capabilitiesValid && it in setOf("available", "moved", "changed", "deleted", "offline", "unsupported")
        } ?: "unsupported"
        return AndroidResourceDescriptor(
            associationId = resource.id,
            name = (descriptor["display_name"] as? String)?.take(512) ?: resource.label.take(512),
            state = safeState,
            mimeType = current["mime_type"] as? String ?: resource.mimeType,
            size = (current["size"] as? Number)?.toLong() ?: resource.size ?: 0,
            currentVersionId = current["version_id"] as? String ?: error("resource_version_missing"),
            observedVersionId = (observed?.get("version_id") as? String).takeIf { safeCapabilities["read_snapshot"] == true },
            capabilities = AndroidResourceCapabilities(
                readCurrent = safeCapabilities["read_current"] == true,
                preview = safeCapabilities["preview"] == true,
                download = safeCapabilities["download"] == true,
                readSnapshot = safeCapabilities["read_snapshot"] == true,
                reveal = safeCapabilities["reveal"] == true,
                openExternal = safeCapabilities["open_external"] == true,
                copyLogicalPath = safeCapabilities["copy_logical_path"] == true,
            ),
        )
    }

    suspend fun preview(resource: RemoteTranscriptResource, descriptor: AndroidResourceDescriptor, observed: Boolean = false): AndroidResourceDescriptor {
        require(descriptor.capabilities.preview || observed && descriptor.capabilities.readSnapshot) { "resource_preview_unavailable" }
        val version = if (observed) descriptor.observedVersionId else descriptor.currentVersionId
        require(!version.isNullOrBlank()) { "resource_version_unavailable" }
        val result = client.preview(resource.requireWorkspace(), resource.resourceKey(), version, 1_048_576,
            UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
        val kind = result["kind"] as? String
        val text = if (kind in setOf("text", "markdown", "json")) {
            val encoded = result["content_base64"] as? String ?: ""
            String(strictBase64(encoded), Charsets.UTF_8)
        } else null
        return descriptor.copy(previewText = text)
    }

    suspend fun download(resource: RemoteTranscriptResource, descriptor: AndroidResourceDescriptor, output: OutputStream, onProgress: (Long, Long) -> Unit) {
        val retainedDeleted = descriptor.state == "deleted" && descriptor.capabilities.readSnapshot && descriptor.observedVersionId != null
        require(descriptor.capabilities.download && (descriptor.state !in setOf("deleted", "offline", "unsupported") || retainedDeleted)) { "resource_download_unavailable" }
        val downloadVersion = if (retainedDeleted) descriptor.observedVersionId!! else descriptor.currentVersionId
        val workspace = resource.requireWorkspace()
        val prepared = client.prepareDownload(workspace, resource.resourceKey(), downloadVersion, descriptor.name,
            UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
        val downloadId = prepared["download_id"] as? String ?: error("resource_download_id_missing")
        val total = (prepared["size"] as? Number)?.toLong() ?: error("resource_download_size_missing")
        val expectedDigest = prepared["digest"] as? String ?: error("resource_download_digest_missing")
        val digest = MessageDigest.getInstance("SHA-256")
        var offset = 0L
        try {
            onProgress(0, total)
            while (offset < total) {
                coroutineContext.ensureActive()
                val requested = minOf(1_048_576L, total - offset).coerceAtLeast(65_536L)
                val chunk = client.downloadChunk(workspace, downloadId, offset, requested,
                    UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
                require((chunk["offset"] as? Number)?.toLong() == offset) { "resource_download_offset_invalid" }
                val bytes = strictBase64(chunk["content_base64"] as? String ?: "")
                require(bytes.isNotEmpty() && bytes.size <= requested) { "resource_download_chunk_invalid" }
                val chunkDigest = "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes).toHex()
                require(chunkDigest == chunk["chunk_digest"]) { "resource_download_chunk_integrity_mismatch" }
                output.write(bytes)
                digest.update(bytes)
                offset += bytes.size
                onProgress(offset, total)
            }
            require(offset == total && "sha256:" + digest.digest().toHex() == expectedDigest) { "resource_download_digest_mismatch" }
        } catch (failure: Throwable) {
            runCatching { client.cancelDownload(workspace, downloadId, UUID.randomUUID().toString(), UUID.randomUUID().toString()) }
            throw failure
        }
    }
}

private fun RemoteTranscriptResource.requireWorkspace(): WorkspaceId = WorkspaceId(workspaceId ?: error("resource_workspace_missing"))
private fun RemoteTranscriptResource.resourceKey(): Map<String, Any?> = mapOf(
    "protocol" to "owop/1", "authority_id" to (authorityId ?: error("resource_authority_missing")),
    "workspace_id" to (workspaceId ?: error("resource_workspace_missing")),
    "resource_type" to (resourceType ?: kind), "resource_id" to (resourceId ?: error("resource_id_missing")),
    "generation" to (generation ?: error("resource_generation_missing")),
)
private fun Any?.record(): Map<String, Any?>? = this as? Map<String, Any?>
private fun OwopResult.success(): Map<String, Any?> = when (this) {
    is OwopResult.Success -> result
    is OwopResult.Failure -> error(code)
}
private fun strictBase64(value: String): ByteArray {
    require(value.length % 4 == 0 && Regex("^[A-Za-z0-9+/]*={0,2}$").matches(value)) { "resource_base64_invalid" }
    return Base64.getDecoder().decode(value).also { require(Base64.getEncoder().encodeToString(it) == value) { "resource_base64_invalid" } }
}
private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
