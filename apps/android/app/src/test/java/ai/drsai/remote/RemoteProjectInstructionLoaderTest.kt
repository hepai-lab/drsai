package ai.drsai.remote

import ai.drsai.remote.remote.data.OwopRequest
import ai.drsai.remote.remote.data.OwopResult
import ai.drsai.remote.remote.data.OwopRelayTransport
import ai.drsai.remote.remote.data.ReadOnlyWorkspaceOperation
import ai.drsai.remote.remote.data.RelayWorkspaceOperationsClient
import ai.drsai.remote.remote.data.RemoteProjectInstructionLoader
import ai.drsai.remote.remote.model.WorkspaceId
import java.security.MessageDigest
import java.util.Base64
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RemoteProjectInstructionLoaderTest {
    @Test fun remoteInstructionsAreBoundedDigestVerifiedVersionedSnapshots() = runTest {
        val text = "remote project policy"
        val bytes = text.encodeToByteArray()
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val transport = OwopRelayTransport { request ->
            val path = request.params["path"] as String
            if (path != "AGENTS.md") failure(request, "file_not_found")
            else when (request.operation) {
                ReadOnlyWorkspaceOperation.FILES_STAT -> success(request, mapOf("size" to bytes.size, "digest" to digest))
                ReadOnlyWorkspaceOperation.FILES_READ -> success(request, mapOf("content_base64" to Base64.getEncoder().encodeToString(bytes)))
                else -> error("unexpected_operation")
            }
        }
        val result = RemoteProjectInstructionLoader(RelayWorkspaceOperationsClient(transport)) { "id" }
            .load(WorkspaceId("workspace"))
        assertEquals(1, result.size)
        assertEquals("remote:AGENTS.md", result.single().source)
        assertEquals(digest, result.single().version)
        assertEquals(text, result.single().content)
    }

    @Test fun digestChangesAndNonNotFoundErrorsFailClosed() {
        val bytes = "value".encodeToByteArray()
        val mismatch = OwopRelayTransport { request ->
            when (request.operation) {
                ReadOnlyWorkspaceOperation.FILES_STAT -> success(request, mapOf("size" to bytes.size, "digest" to "0".repeat(64)))
                ReadOnlyWorkspaceOperation.FILES_READ -> success(request, mapOf("content_base64" to Base64.getEncoder().encodeToString(bytes)))
                else -> error("unexpected_operation")
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runTest { RemoteProjectInstructionLoader(RelayWorkspaceOperationsClient(mismatch)) { "id" }.load(WorkspaceId("workspace")) }
        }
        val forbidden = OwopRelayTransport { request -> failure(request, "forbidden") }
        assertThrows(IllegalStateException::class.java) {
            runTest { RemoteProjectInstructionLoader(RelayWorkspaceOperationsClient(forbidden)) { "id" }.load(WorkspaceId("workspace")) }
        }
    }

    private fun success(request: OwopRequest, value: Map<String, Any?>) = OwopResult.Success(request.requestId, value)
    private fun failure(request: OwopRequest, code: String) = OwopResult.Failure(
        request.requestId, code, code, request.correlationId, retryable = false,
    )
}
