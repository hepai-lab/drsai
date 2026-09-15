package ai.drsai.remote

import ai.drsai.remote.runtime.python.RunEnvironmentSnapshot
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunEnvironmentSnapshotTest {
    @Test fun `live changes affect next run but never mutate active run`() {
        val liveTools = JSONArray().put(JSONObject().put("name", "get_current_time"))
        val liveSkills = JSONArray().put(JSONObject().put("id", "chat"))
        val liveCapabilities = JSONArray().put("chat")
        val active = RunEnvironmentSnapshot.freeze(liveTools, liveSkills, liveCapabilities)

        liveTools.put(JSONObject().put("name", "workspace.read"))
        liveSkills.put(JSONObject().put("id", "workspace"))
        liveCapabilities.put("saf_read")
        val next = RunEnvironmentSnapshot.freeze(liveTools, liveSkills, liveCapabilities)

        assertEquals(1, active.tools.length())
        assertFalse(active.tools.toString().contains("workspace.read"))
        assertFalse(active.capabilities.toString().contains("saf_read"))
        assertEquals(2, next.tools.length())
        assertTrue(next.tools.toString().contains("workspace.read"))
        assertTrue(next.capabilities.toString().contains("saf_read"))
    }

    @Test fun `readers cannot mutate the frozen snapshot`() {
        val snapshot = RunEnvironmentSnapshot.freeze(
            JSONArray().put(JSONObject().put("name", "safe")), JSONArray(), JSONArray().put("chat"),
        )
        snapshot.tools.put(JSONObject().put("name", "injected"))
        assertEquals(1, snapshot.tools.length())
        assertFalse(snapshot.tools.toString().contains("injected"))
    }
}
