package ai.drsai.remote.runtime.python

import org.json.JSONArray

/** Immutable per-Run boundary. Live capability changes are observed by the next Run only. */
class RunEnvironmentSnapshot private constructor(
    private val toolsJson: String,
    private val skillsJson: String,
    private val capabilitiesJson: String,
) {
    val tools: JSONArray get() = JSONArray(toolsJson)
    val skills: JSONArray get() = JSONArray(skillsJson)
    val capabilities: JSONArray get() = JSONArray(capabilitiesJson)

    companion object {
        fun freeze(tools: JSONArray, skills: JSONArray, capabilities: JSONArray) = RunEnvironmentSnapshot(
            tools.toString(), skills.toString(), capabilities.toString(),
        )
    }
}
