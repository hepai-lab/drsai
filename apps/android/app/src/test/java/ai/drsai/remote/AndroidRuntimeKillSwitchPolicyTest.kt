package ai.drsai.remote

import ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitch
import ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitchSnapshot
import ai.drsai.remote.workbench.model.RuntimeCapability
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidRuntimeKillSwitchPolicyTest {
    private val all = AndroidRuntimeKillSwitchSnapshot(AndroidRuntimeKillSwitch.entries.toSet())

    @Test fun `each switch removes only its owned capability surface`() {
        val source = setOf(
            RuntimeCapability.CHAT, RuntimeCapability.WEB_SEARCH, RuntimeCapability.WEB_FETCH,
            RuntimeCapability.BROWSER_SESSION, RuntimeCapability.MCP, RuntimeCapability.MCP_STDIO,
            RuntimeCapability.SAF_READ,
        )
        val web = AndroidRuntimeKillSwitchSnapshot(setOf(AndroidRuntimeKillSwitch.WEB)).capabilities(source)
        assertFalse(RuntimeCapability.WEB_SEARCH in web)
        assertFalse(RuntimeCapability.WEB_FETCH in web)
        assertFalse(RuntimeCapability.BROWSER_SESSION in web)
        assertTrue(RuntimeCapability.MCP in web)
        val mcp = AndroidRuntimeKillSwitchSnapshot(setOf(AndroidRuntimeKillSwitch.MCP)).capabilities(source)
        assertFalse(RuntimeCapability.MCP in mcp)
        assertFalse(RuntimeCapability.MCP_STDIO in mcp)
        assertTrue(RuntimeCapability.WEB_SEARCH in mcp)
        assertTrue(RuntimeCapability.CHAT in web && RuntimeCapability.CHAT in mcp)
    }

    @Test fun `model catalog and skills fail closed for disabled tools`() {
        val source = JSONArray(listOf("web.search", "browser.navigate", "mcp.server.call", "core.data_compute", "core.text_stats")
            .map { JSONObject().put("name", it) })
        val names = all.toolSchemas(source).let { output ->
            (0 until output.length()).map { output.getJSONObject(it).getString("name") }
        }
        assertEquals(listOf("core.text_stats"), names)
        val skills = JSONArray()
            .put(JSONObject().put("id", "safe").put("tools", JSONArray().put("core.text_stats")))
            .put(JSONObject().put("id", "disabled").put("tools", JSONArray().put("core.data_compute")))
        assertEquals("safe", all.skillSchemas(skills).getJSONObject(0).getString("id"))
        assertEquals(1, all.skillSchemas(skills).length())
    }

    @Test fun `unknown switch is rejected and identity is deterministic`() {
        assertEquals(
            "runtime_kill_switch_unknown:future_surface",
            runCatching { AndroidRuntimeKillSwitchSnapshot.fromJson(JSONArray().put("future_surface")) }
                .exceptionOrNull()?.message,
        )
        val reversed = AndroidRuntimeKillSwitchSnapshot(AndroidRuntimeKillSwitch.entries.reversed().toSet())
        assertEquals(all.digest, reversed.digest)
        assertEquals("p9-android-kill-switch-v1", all.policyVersion)
    }

    @Test fun `all switches never invent a lite or alternate runtime route`() {
        assertTrue(all.isDisabled(AndroidRuntimeKillSwitch.KERNEL))
        assertTrue(all.isDisabled(AndroidRuntimeKillSwitch.REMOTE_HANDOFF))
        assertFalse(AndroidRuntimeKillSwitch.entries.any { it.wireId.contains("lite") })
        assertFalse(AndroidRuntimeKillSwitch.entries.any { it.wireId.contains("chat_only") })
    }
}
