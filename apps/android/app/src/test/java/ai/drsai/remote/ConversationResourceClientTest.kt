package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.RemoteTranscriptResource
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.Base64
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class ConversationResourceClientTest {
    private val bytes = "hello".toByteArray()
    private val digest = "sha256:" + MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private val resource = RemoteTranscriptResource(
        id = "assoc-1", label = "报告.md", kind = "file", mimeType = "text/markdown", size = bytes.size.toLong(), digest = digest,
        authorityId = "authority-a", workspaceId = "workspace-a", resourceType = "file", resourceId = "resource-a", generation = 1,
        observedVersionId = "version-observed",
    )

    @Test fun `resolve preview and verified SAF stream use only resource identity`() = runTest {
        val operations = mutableListOf<String>()
        val transport = OwopRelayTransport { request ->
            operations += request.operation.wireName
            val result = when (request.operation.wireName) {
                "resources.resolve_batch" -> mapOf("results" to listOf(mapOf("descriptor" to mapOf(
                    "display_name" to "报告.md", "state" to "changed",
                    "current_version" to mapOf("version_id" to "version-current", "mime_type" to "text/markdown", "size" to bytes.size, "digest" to digest),
                    "observed_version" to mapOf("version_id" to "version-observed"),
                    "capabilities" to capabilities(preview = true, download = true, readSnapshot = true),
                ))))
                "resources.preview" -> mapOf("kind" to "markdown", "content_base64" to Base64.getEncoder().encodeToString(bytes))
                "resources.download.prepare" -> mapOf("download_id" to "download-1", "size" to bytes.size, "digest" to digest)
                "resources.download.chunk" -> mapOf("offset" to 0, "length" to bytes.size, "content_base64" to Base64.getEncoder().encodeToString(bytes), "chunk_digest" to digest, "eof" to true)
                else -> error("unexpected ${request.operation.wireName}")
            }
            OwopResult.Success(request.requestId, result)
        }
        val subject = ConversationResourceClient(RelayResourceOperationsClient(transport))
        val descriptor = subject.resolve(resource)
        assertEquals("changed", descriptor.state)
        assertEquals("version-observed", descriptor.observedVersionId)
        assertEquals("hello", subject.preview(resource, descriptor, observed = true).previewText)
        val output = ByteArrayOutputStream()
        val progress = mutableListOf<Pair<Long, Long>>()
        subject.download(resource, descriptor, output) { done, total -> progress += done to total }
        assertArrayEquals(bytes, output.toByteArray())
        assertEquals(listOf(0L to 5L, 5L to 5L), progress)
        assertEquals(listOf("resources.resolve_batch", "resources.preview", "resources.download.prepare", "resources.download.chunk"), operations)
    }

    @Test fun `corrupt chunk is rejected and runtime download is cancelled`() = runTest {
        var cancelled = false
        val transport = OwopRelayTransport { request ->
            val result = when (request.operation.wireName) {
                "resources.resolve_batch" -> mapOf("results" to listOf(mapOf("descriptor" to mapOf(
                    "display_name" to "报告.md", "state" to "available",
                    "current_version" to mapOf("version_id" to "version-current", "mime_type" to "text/markdown", "size" to bytes.size, "digest" to digest),
                    "capabilities" to capabilities(preview = true, download = true, readSnapshot = false),
                ))))
                "resources.download.prepare" -> mapOf("download_id" to "download-1", "size" to bytes.size, "digest" to digest)
                "resources.download.chunk" -> mapOf("offset" to 0, "length" to bytes.size, "content_base64" to Base64.getEncoder().encodeToString(bytes), "chunk_digest" to "sha256:" + "0".repeat(64))
                "resources.download.cancel" -> { cancelled = true; mapOf("cancelled" to true) }
                else -> error("unexpected ${request.operation.wireName}")
            }
            OwopResult.Success(request.requestId, result)
        }
        val subject = ConversationResourceClient(RelayResourceOperationsClient(transport))
        val descriptor = subject.resolve(resource)
        val failure = runCatching { subject.download(resource, descriptor, ByteArrayOutputStream()) { _, _ -> } }.exceptionOrNull()
        assertTrue(failure?.message?.contains("integrity_mismatch") == true)
        assertTrue(cancelled)
    }

    @Test fun `Android consumes shared resource state semantics vector`() {
        val candidates = listOf(
            File("../../../cores/protocol/owop/conversation-resource-states-p2.fixture.json"),
            File("../../cores/protocol/owop/conversation-resource-states-p2.fixture.json"),
            File("cores/protocol/owop/conversation-resource-states-p2.fixture.json"),
        )
        val fixture = JSONObject(candidates.firstOrNull(File::isFile)?.readText() ?: error("resource state fixture missing"))
        val cases = fixture.getJSONArray("cases")
        repeat(cases.length()) { index ->
            val case = cases.getJSONObject(index)
            val descriptor = case.getJSONObject("descriptor")
            val raw = descriptor.getJSONObject("capabilities")
            val semantics = androidResourceStateSemantics(
                descriptor.getString("state"),
                AndroidResourceCapabilities(
                    raw.getBoolean("read_current"), raw.getBoolean("preview"), raw.getBoolean("download"),
                    raw.getBoolean("read_snapshot"), raw.getBoolean("reveal"), raw.getBoolean("open_external"),
                    raw.getBoolean("copy_logical_path"),
                ),
                descriptor.getBoolean("has_observed_version"),
            )
            val expected = case.getJSONObject("expected")
            assertEquals("${case.getString("id")}:status", expected.getString("status"), semantics.status)
            assertEquals("${case.getString("id")}:primary", expected.getString("primary"), semantics.primary)
            assertEquals(expected.getJSONArray("secondary").toList(), semantics.secondary)
            assertEquals(expected.getJSONArray("recovery").toList(), semantics.recovery)
        }
    }

    @Test fun `missing capability fields fail closed`() = runTest {
        val transport = OwopRelayTransport { request -> OwopResult.Success(request.requestId, mapOf("results" to listOf(mapOf(
            "descriptor" to mapOf(
                "display_name" to "unsafe.txt", "state" to "available",
                "current_version" to mapOf("version_id" to "v1", "mime_type" to "text/plain", "size" to 1),
                "capabilities" to mapOf("preview" to true),
            ),
        )))) }
        val descriptor = ConversationResourceClient(RelayResourceOperationsClient(transport)).resolve(resource)
        assertEquals("unsupported", descriptor.state)
        assertFalse(descriptor.capabilities.preview)
        assertFalse(descriptor.capabilities.download)
    }

    private fun capabilities(preview: Boolean, download: Boolean, readSnapshot: Boolean) = mapOf(
        "read_current" to true, "read_snapshot" to readSnapshot, "preview" to preview, "download" to download,
        "reveal" to false, "open_external" to false, "copy_logical_path" to false,
    )
}
