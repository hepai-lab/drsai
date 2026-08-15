package ai.drsai.remote.runtime.readiness

import org.json.JSONArray
import org.json.JSONObject

enum class CapabilityAvailability {
    LOCAL_AVAILABLE,
    PERMISSION_REQUIRED,
    DESKTOP_REQUIRED,
    UNSUPPORTED,
}

data class CapabilityGuidanceItem(
    val id: String,
    val title: String,
    val availability: CapabilityAvailability,
    val guidance: String,
)

/** One projection used by both the pre-run UI and the model-visible tool boundary. */
object CapabilityGuidancePolicy {
    private val workspaceToolIds = setOf(
        "workspace.list", "workspace.read", "workspace.search", "workspace.glob", "workspace.grep",
        "workspace.write", "workspace.edit", "workspace.undo",
    )

    private fun desktopCapabilities(strings: CapabilityGuidanceStrings) = listOf(
        CapabilityGuidanceItem("desktop.shell", strings.text(CapabilityGuidanceText.SHELL), CapabilityAvailability.DESKTOP_REQUIRED, strings.text(CapabilityGuidanceText.CONNECT_DESKTOP)),
        CapabilityGuidanceItem("desktop.apps", strings.text(CapabilityGuidanceText.APPS), CapabilityAvailability.DESKTOP_REQUIRED, strings.text(CapabilityGuidanceText.CONNECT_DESKTOP)),
        CapabilityGuidanceItem("desktop.git", strings.text(CapabilityGuidanceText.GIT), CapabilityAvailability.DESKTOP_REQUIRED, strings.text(CapabilityGuidanceText.CONNECT_DESKTOP)),
    )

    fun project(
        localToolIds: Collection<String>,
        modelUnsupportedToolIds: Collection<String> = emptyList(),
        strings: CapabilityGuidanceStrings = EnglishCapabilityGuidanceStrings,
    ): List<CapabilityGuidanceItem> {
        val local = localToolIds.toSet()
        val unsupported = modelUnsupportedToolIds.toSet()
        val result = local.sorted().map { id ->
            CapabilityGuidanceItem(
                id,
                titleFor(id, strings),
                if (id in unsupported) CapabilityAvailability.UNSUPPORTED else CapabilityAvailability.LOCAL_AVAILABLE,
                if (id in unsupported) strings.text(CapabilityGuidanceText.CHANGE_MODEL) else strings.text(CapabilityGuidanceText.LOCAL_AVAILABLE),
            )
        }.toMutableList()
        workspaceToolIds.filterNot(local::contains).sorted().forEach { id ->
            result += CapabilityGuidanceItem(id, titleFor(id, strings), CapabilityAvailability.PERMISSION_REQUIRED, strings.text(CapabilityGuidanceText.AUTHORIZE_WORKSPACE))
        }
        result += desktopCapabilities(strings)
        return result.distinctBy { it.id }
    }

    fun modelVisibleSchemas(schemas: JSONArray, inventory: Collection<CapabilityGuidanceItem>): JSONArray {
        val allowed = inventory.filter { it.availability == CapabilityAvailability.LOCAL_AVAILABLE }.map { it.id }.toSet()
        return JSONArray().also { output ->
            repeat(schemas.length()) {
                val schema = schemas.getJSONObject(it)
                if (schema.optString("name") in allowed) output.put(JSONObject(schema.toString()))
            }
        }
    }

    private fun titleFor(id: String, strings: CapabilityGuidanceStrings): String = when {
        id.startsWith("workspace.") -> strings.text(CapabilityGuidanceText.WORKSPACE, id.substringAfter('.'))
        id.startsWith("web.") -> strings.text(CapabilityGuidanceText.WEB)
        id.startsWith("core.") -> strings.text(CapabilityGuidanceText.CORE)
        id == "delegate" -> strings.text(CapabilityGuidanceText.DELEGATE)
        id.contains("device") || id.contains("time") -> strings.text(CapabilityGuidanceText.DEVICE)
        id.contains("memory") -> strings.text(CapabilityGuidanceText.MEMORY)
        else -> strings.text(CapabilityGuidanceText.LOCAL_TOOL)
    }
}
