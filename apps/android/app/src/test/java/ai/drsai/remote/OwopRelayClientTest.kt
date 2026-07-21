package ai.drsai.remote

import ai.drsai.remote.remote.RemoteArchitecturePolicy
import ai.drsai.remote.remote.data.OWOP_PROTOCOL_VERSION
import ai.drsai.remote.remote.data.OwopRelayTransport
import ai.drsai.remote.remote.data.OwopRequest
import ai.drsai.remote.remote.data.OwopResult
import ai.drsai.remote.remote.data.ReadOnlyWorkspaceOperation
import ai.drsai.remote.remote.data.RelayWorkspaceOperationsClient
import ai.drsai.remote.remote.generated.OwopSchemaGenerated
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class OwopRelayClientTest {
    @Test
    fun typedReadUsesStableOwopOperationAndBoundedChunk() = runTest {
        var captured: OwopRequest? = null
        val client = RelayWorkspaceOperationsClient(OwopRelayTransport { request ->
            captured = request
            OwopResult.Success(request.requestId, mapOf("eof" to true))
        })
        client.readFile(WorkspaceId("workspace-a"), "src/app.py", 0, 1_048_576, "req-1", "corr-1")
        assertEquals(OWOP_PROTOCOL_VERSION, captured?.version)
        assertEquals(ReadOnlyWorkspaceOperation.FILES_READ, captured?.operation)
        assertEquals("relay", captured?.binding)
        assertEquals("src/app.py", captured?.params?.get("path"))
        assertEquals(1_048_576L, captured?.params?.get("length"))
    }

    @Test
    fun androidV1SurfaceContainsNoWriteOperation() {
        RemoteArchitecturePolicy.allowedWorkspaceOperations.forEach(RemoteArchitecturePolicy::requireAllowedOperation)
        assertEquals(true, RemoteArchitecturePolicy.allowedWorkspaceOperations.all { it in OwopSchemaGenerated.OPERATIONS })
        assertEquals(true, "relay" in OwopSchemaGenerated.BINDINGS)
        assertFalse(RemoteArchitecturePolicy.allowedWorkspaceOperations.any { it in RemoteArchitecturePolicy.forbiddenWriteOperations })
    }

    @Test(expected = IllegalArgumentException::class)
    fun writeOperationFailsClosed() {
        RemoteArchitecturePolicy.requireAllowedOperation("files.write")
    }

    @Test
    fun associationOnlyAcceptsOpaqueGrantForRegisteredRuntime() {
        RemoteArchitecturePolicy.requireAssociationGrant(
            alreadyRegistered = true,
            opaqueCode = "opaque-association-code-12345",
            containsNetworkCoordinates = false,
            containsLongLivedCredential = false,
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun androidCannotUseQrToRegisterUnknownRuntime() {
        RemoteArchitecturePolicy.requireAssociationGrant(
            alreadyRegistered = false,
            opaqueCode = "opaque-association-code-12345",
            containsNetworkCoordinates = false,
            containsLongLivedCredential = false,
        )
    }
}
