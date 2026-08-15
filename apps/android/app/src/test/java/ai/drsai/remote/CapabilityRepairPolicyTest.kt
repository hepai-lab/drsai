package ai.drsai.remote

import ai.drsai.remote.runtime.errors.*
import org.junit.Assert.*
import org.junit.Test

class CapabilityRepairPolicyTest {
    @Test fun safNetworkModelAndDesktopFailuresRouteToExactRepair() {
        val cases = listOf(
            Triple("saf_permission_revoked", null, CapabilityRepairAction.GRANT_WORKSPACE),
            Triple("provider_network_failed", 0, CapabilityRepairAction.OPEN_NETWORK_SETTINGS),
            Triple("model_tools_unsupported", null, CapabilityRepairAction.CHOOSE_MODEL),
            Triple("desktop_offline", null, CapabilityRepairAction.CONNECT_DESKTOP),
        )
        cases.forEach { (code, status, action) ->
            val repair = requireNotNull(CapabilityRepairPolicy.from(code, status))
            assertEquals(action, repair.action)
            assertTrue(repair.preserveOriginalRun)
            assertTrue(repair.blockRetryUntilRepaired)
            assertTrue(repair.actionLabel.isNotBlank())
        }
    }

    @Test fun unrelatedFailuresKeepNormalRetryPolicy() {
        assertNull(CapabilityRepairPolicy.from("provider_http_503", 503))
        assertNull(CapabilityRepairPolicy.from("tool_read_failed"))
    }
}
