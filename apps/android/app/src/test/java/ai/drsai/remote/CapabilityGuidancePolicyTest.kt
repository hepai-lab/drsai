package ai.drsai.remote

import ai.drsai.remote.runtime.readiness.CapabilityAvailability
import ai.drsai.remote.runtime.readiness.CapabilityGuidancePolicy
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CapabilityGuidancePolicyTest {
    @Test fun `inventory classifies local permission desktop and unsupported capabilities`() {
        val items = CapabilityGuidancePolicy.project(
            localToolIds = listOf("get_current_time", "web.search"),
            modelUnsupportedToolIds = listOf("web.search"),
        )

        assertEquals(CapabilityAvailability.LOCAL_AVAILABLE, items.single { it.id == "get_current_time" }.availability)
        assertEquals(CapabilityAvailability.UNSUPPORTED, items.single { it.id == "web.search" }.availability)
        assertEquals(CapabilityAvailability.PERMISSION_REQUIRED, items.single { it.id == "workspace.read" }.availability)
        assertEquals(CapabilityAvailability.DESKTOP_REQUIRED, items.single { it.id == "desktop.shell" }.availability)
        assertTrue(items.single { it.id == "workspace.read" }.guidance.contains("Authorize"))
        assertTrue(items.single { it.id == "desktop.shell" }.guidance.contains("Desktop"))
    }

    @Test fun `only locally available tools cross the model schema boundary`() {
        val schemas = JSONArray()
            .put(JSONObject().put("name", "get_current_time"))
            .put(JSONObject().put("name", "web.search"))
            .put(JSONObject().put("name", "workspace.read"))
        val inventory = CapabilityGuidancePolicy.project(
            localToolIds = listOf("get_current_time", "web.search"),
            modelUnsupportedToolIds = listOf("web.search"),
        )

        val visible = CapabilityGuidancePolicy.modelVisibleSchemas(schemas, inventory)
        assertEquals(1, visible.length())
        assertEquals("get_current_time", visible.getJSONObject(0).getString("name"))
        assertFalse(visible.toString().contains("web.search"))
        assertFalse(visible.toString().contains("workspace.read"))
    }
}
