package ai.drsai.remote.runtime.security

import ai.drsai.remote.workbench.model.RuntimeCapability
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/** Signed operational controls may only remove Android Full Runtime capabilities. */
enum class AndroidRuntimeKillSwitch(val wireId: String) {
    WEB("web"),
    MCP("mcp"),
    SANDBOX("sandbox"),
    KERNEL("kernel"),
    REMOTE_HANDOFF("remote_handoff");

    companion object {
        fun parse(value: String): AndroidRuntimeKillSwitch = entries.firstOrNull { it.wireId == value }
            ?: throw IllegalArgumentException("runtime_kill_switch_unknown:$value")
    }
}

data class AndroidRuntimeKillSwitchSnapshot(
    val disabled: Set<AndroidRuntimeKillSwitch> = emptySet(),
) {
    val policyVersion: String = "p9-android-kill-switch-v1"
    val digest: String by lazy {
        val canonical = disabled.map { it.wireId }.sorted().joinToString(",")
        MessageDigest.getInstance("SHA-256").digest(canonical.encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    fun isDisabled(value: AndroidRuntimeKillSwitch): Boolean = value in disabled

    fun capabilities(source: Set<RuntimeCapability>): Set<RuntimeCapability> = source.filterTo(linkedSetOf()) {
        when (it) {
            RuntimeCapability.WEB_SEARCH,
            RuntimeCapability.WEB_FETCH,
            RuntimeCapability.BROWSER_SESSION -> !isDisabled(AndroidRuntimeKillSwitch.WEB)
            RuntimeCapability.MCP,
            RuntimeCapability.MCP_STDIO -> !isDisabled(AndroidRuntimeKillSwitch.MCP)
            else -> true
        }
    }

    fun toolSchemas(source: JSONArray): JSONArray = JSONArray().also { output ->
        repeat(source.length()) { index ->
            val schema = source.getJSONObject(index)
            if (allowsTool(schema.getString("name"))) output.put(JSONObject(schema.toString()))
        }
    }

    fun skillSchemas(source: JSONArray): JSONArray = JSONArray().also { output ->
        repeat(source.length()) { index ->
            val skill = source.getJSONObject(index)
            val tools = skill.optJSONArray("tools") ?: JSONArray()
            val allowed = (0 until tools.length()).all { allowsTool(tools.getString(it)) }
            if (allowed) output.put(JSONObject(skill.toString()))
        }
    }

    fun allowsTool(name: String): Boolean = when {
        isDisabled(AndroidRuntimeKillSwitch.WEB) &&
            (name.startsWith("web.") || name.startsWith("browser.")) -> false
        isDisabled(AndroidRuntimeKillSwitch.MCP) && name.startsWith("mcp.") -> false
        isDisabled(AndroidRuntimeKillSwitch.SANDBOX) && name == "core.data_compute" -> false
        else -> true
    }

    companion object {
        val NONE = AndroidRuntimeKillSwitchSnapshot()

        fun fromJson(values: JSONArray): AndroidRuntimeKillSwitchSnapshot =
            AndroidRuntimeKillSwitchSnapshot(buildSet {
                repeat(values.length()) { add(AndroidRuntimeKillSwitch.parse(values.getString(it))) }
            })
    }
}
