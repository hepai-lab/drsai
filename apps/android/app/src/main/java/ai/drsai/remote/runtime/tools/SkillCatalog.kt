package ai.drsai.remote.runtime.tools

import ai.drsai.remote.workbench.model.RuntimeCapability
import org.json.JSONArray
import org.json.JSONObject

enum class SkillSource { BUILT_IN, PLATFORM, REMOTE_READ_ONLY }

data class SkillDefinition(
    val id: String,
    val version: Int,
    val displayName: String,
    val source: SkillSource,
    val requiredCapabilities: Set<RuntimeCapability> = emptySet(),
    val executableOnAndroid: Boolean = source == SkillSource.BUILT_IN,
) {
    init {
        require(id.matches(Regex("[a-z0-9._-]{1,100}"))) { "skill_id_invalid" }
        require(version > 0 && displayName.isNotBlank()) { "skill_metadata_invalid" }
        require(source == SkillSource.BUILT_IN || !executableOnAndroid) { "external_skill_execution_forbidden" }
    }
}

data class PinnedSkillSet(val runId: String, val skills: List<SkillDefinition>)

class SkillCatalog {
    private val definitions = linkedMapOf<Pair<SkillSource, String>, SkillDefinition>()
    private val pinned = mutableMapOf<String, PinnedSkillSet>()

    @Synchronized
    fun replace(source: SkillSource, values: List<SkillDefinition>) {
        require(values.all { it.source == source }) { "skill_source_mismatch" }
        require(values.distinctBy { it.id }.size == values.size) { "skill_duplicate_id" }
        definitions.keys.filter { it.first == source }.forEach(definitions::remove)
        values.sortedBy { it.id }.forEach { definitions[source to it.id] = it }
    }

    @Synchronized
    fun snapshot(): List<SkillDefinition> = definitions.values.sortedWith(
        compareBy<SkillDefinition>(SkillDefinition::source).thenBy { it.id },
    )

    @Synchronized
    fun pin(runId: String, availableCapabilities: Set<RuntimeCapability>): PinnedSkillSet {
        require(runId.isNotBlank()) { "skill_run_id_required" }
        return pinned.getOrPut(runId) {
            PinnedSkillSet(runId, snapshot().filter { availableCapabilities.containsAll(it.requiredCapabilities) })
        }
    }

    @Synchronized fun release(runId: String) { pinned.remove(runId) }
}

object ReadOnlySkillManifestCodec {
    private val forbiddenExternalCapabilities = setOf(
        RuntimeCapability.SAF_WRITE,
        RuntimeCapability.SHELL,
        RuntimeCapability.GIT,
        RuntimeCapability.WORKTREE,
        RuntimeCapability.CODEX,
        RuntimeCapability.MCP,
    )

    fun decode(json: String, source: SkillSource): List<SkillDefinition> {
        require(source != SkillSource.BUILT_IN) { "external_manifest_source_required" }
        val root = JSONObject(json)
        require(root.optInt("schema_version", -1) == 1) { "skill_schema_unsupported" }
        val values = root.optJSONArray("skills") ?: JSONArray()
        return (0 until values.length()).map { index ->
            val item = values.getJSONObject(index)
            val requiredCapabilities = item.optJSONArray("capabilities").toStrings().mapTo(linkedSetOf()) { value ->
                RuntimeCapability.entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
                    ?: error("skill_capability_unknown:$value")
            }
            if (requiredCapabilities.any { it in forbiddenExternalCapabilities }) {
                error("external_skill_capability_forbidden")
            }
            SkillDefinition(
                id = item.getString("id"),
                version = item.getInt("version"),
                displayName = item.optString("name", item.getString("id")),
                source = source,
                requiredCapabilities = requiredCapabilities,
                // Script/command fields in an external manifest are deliberately ignored.
                executableOnAndroid = false,
            )
        }
    }

    private fun JSONArray?.toStrings(): List<String> = if (this == null) emptyList() else
        (0 until length()).map(::getString)
}
