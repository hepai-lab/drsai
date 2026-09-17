package ai.drsai.remote

import ai.drsai.remote.runtime.readiness.*
import org.junit.Assert.*
import org.junit.Test

class AgentReadinessTest {
    private val ready = AgentReadinessInput(true, true, true, true, "READY", true)

    @Test fun `ready requires model credential provider tool capability runtime and network`() {
        assertTrue(AgentReadinessPolicy.evaluate(ready).canStartAgentRun)
        assertEquals("ready", AgentReadinessPolicy.evaluate(ready).stableReason)
        val blocked = listOf(
            ready.copy(modelSelected = false) to ReadinessAction.CHOOSE_MODEL,
            ready.copy(credentialAvailable = false) to ReadinessAction.ADD_CREDENTIAL,
            ready.copy(networkAvailable = false) to ReadinessAction.ENABLE_NETWORK,
            ready.copy(providerVerified = false) to ReadinessAction.TEST_CONNECTION,
            ready.copy(modelSupportsTools = false) to ReadinessAction.CHOOSE_MODEL,
            ready.copy(runtimeState = "UNAVAILABLE") to ReadinessAction.RETRY_RUNTIME,
        )
        blocked.forEach { (input, action) ->
            val result = AgentReadinessPolicy.evaluate(input)
            assertFalse(result.canStartAgentRun)
            assertEquals(action, result.primaryAction)
        }
    }

    @Test fun `runtime transitional states are checking rather than errors`() {
        listOf("UNINITIALIZED", "BINDING", "RECOVERING").forEach { state ->
            val result = AgentReadinessPolicy.evaluate(ready.copy(runtimeState = state))
            assertEquals(ReadinessKind.CHECKING, result.kind)
            assertEquals(ReadinessAction.NONE, result.primaryAction)
        }
    }

    @Test fun `workspace permission is task scoped and evaluated after runtime readiness`() {
        val result = AgentReadinessPolicy.evaluate(ready.copy(workspaceRequired = true, workspaceGranted = false))
        assertEquals(ReadinessKind.PERMISSION_REQUIRED, result.kind)
        assertEquals(ReadinessAction.GRANT_WORKSPACE, result.primaryAction)
        assertTrue(AgentReadinessPolicy.evaluate(ready.copy(workspaceRequired = true, workspaceGranted = true)).canStartAgentRun)
    }

    @Test fun `agent availability requires functional smoke evidence`() {
        val input = AgentReadinessInput(
            modelSelected = true, credentialAvailable = true, providerVerified = true,
            modelSupportsTools = true, runtimeState = "READY", networkAvailable = true,
            functionalSmokeVerified = false,
        )
        val blocked = AgentReadinessPolicy.evaluate(input)
        assertEquals(ReadinessAction.RUN_RUNTIME_CHECK, blocked.primaryAction)
        assertEquals("runtime_smoke_required", blocked.stableReason)
        assertFalse(blocked.canStartAgentRun)

        val ready = AgentReadinessPolicy.evaluate(input.copy(functionalSmokeVerified = true))
        assertEquals(ReadinessKind.READY, ready.kind)
        assertTrue(ready.canStartAgentRun)
    }
}
