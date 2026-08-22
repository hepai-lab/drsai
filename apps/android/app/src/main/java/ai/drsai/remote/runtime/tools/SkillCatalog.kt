package ai.drsai.remote.runtime.tools

import ai.drsai.remote.workbench.model.RuntimeCapability
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

enum class SkillSource { BUILT_IN, USER_DECLARATIVE, PLATFORM, REMOTE_READ_ONLY }

data class SkillDefinition(
    val id: String,
    val version: Int,
    val displayName: String,
    val source: SkillSource,
    val requiredCapabilities: Set<RuntimeCapability> = emptySet(),
    val executableOnAndroid: Boolean = source == SkillSource.BUILT_IN,
    val instructions: String = "",
    val allowedTools: Set<String> = emptySet(),
    val digest: String = SkillManifestDigest.compute(id, version, source, instructions, allowedTools, requiredCapabilities),
) {
    init {
        require(id.matches(Regex("[a-z0-9._-]{1,100}"))) { "skill_id_invalid" }
        require(version > 0 && displayName.isNotBlank()) { "skill_metadata_invalid" }
        require(source == SkillSource.BUILT_IN || !executableOnAndroid) { "external_skill_execution_forbidden" }
        require(instructions.length <= 8_000) { "skill_instructions_too_large" }
        require(allowedTools.size <= 64 && allowedTools.all { it.matches(Regex("[a-z0-9._-]{1,100}")) }) {
            "skill_allowed_tools_invalid"
        }
        require(digest.matches(Regex("[a-f0-9]{64}"))) { "skill_digest_invalid" }
        require(digest == SkillManifestDigest.compute(id, version, source, instructions, allowedTools, requiredCapabilities)) {
            "skill_digest_mismatch"
        }
    }
}

object SkillManifestDigest {
    const val VERSION = "p9-skill-manifest-v1"

    fun compute(
        id: String,
        version: Int,
        source: SkillSource,
        instructions: String,
        allowedTools: Set<String>,
        requiredCapabilities: Set<RuntimeCapability>,
    ): String = sha256(listOf(
        VERSION, id, version.toString(), source.name.lowercase(), sha256(instructions),
        allowedTools.sorted().joinToString("\n"), requiredCapabilities.map { it.name.lowercase() }.sorted().joinToString("\n"),
    ).joinToString("\u0000"))

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

data class PinnedSkillSet(val runId: String, val skills: List<SkillDefinition>)
data class SkillManifestIdentity(val version: String, val sha256: String, val count: Int)

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
    fun diagnosticIdentity(): SkillManifestIdentity {
        val values = snapshot()
        val canonical = buildList {
            add(SkillManifestDigest.VERSION)
            values.forEach { skill ->
                add(listOf(skill.source.name.lowercase(), skill.id, skill.version.toString(), skill.digest).joinToString("\u0000"))
            }
        }.joinToString("\n")
        val sha256 = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        return SkillManifestIdentity(SkillManifestDigest.VERSION, sha256, values.size)
    }

    @Synchronized
    fun pin(runId: String, availableCapabilities: Set<RuntimeCapability>): PinnedSkillSet {
        require(runId.isNotBlank()) { "skill_run_id_required" }
        return pinned.getOrPut(runId) {
            PinnedSkillSet(runId, snapshot().filter { availableCapabilities.containsAll(it.requiredCapabilities) })
        }
    }

    @Synchronized
    fun select(runId: String, availableCapabilities: Set<RuntimeCapability>, input: String): PinnedSkillSet {
        require(runId.isNotBlank()) { "skill_run_id_required" }
        return pinned.getOrPut(runId) {
            val candidates = snapshot().filter { availableCapabilities.containsAll(it.requiredCapabilities) }
            PinnedSkillSet(runId, candidates.filter { SkillTaskMatcher.matches(it, input) })
        }
    }

    @Synchronized fun release(runId: String) { pinned.remove(runId) }
}

object SkillTaskMatcher {
    private val workspace = Regex("""(?i)(\b(?:workspace|file|folder|directory|config|code|project)\b|工作区|文件|目录|配置|代码|项目)""")
    private val memory = Regex("""(?i)(\b(?:remember|memory|preference|recall)\b|记住|记忆|偏好|之前)""")
    private val device = Regex("""(?i)(\b(?:android|device|phone|tablet)\b|系统版本|设备|手机|平板)""")
    private val attachment = Regex("""(?i)(\b(?:attachment|attached|image|pdf)\b|附件|图片|文档)""")

    fun matches(skill: SkillDefinition, input: String): Boolean {
        val text = input.trim()
        if (text.contains("@${skill.id}", ignoreCase = true)) return true
        val domains = buildSet {
            val names = skill.allowedTools + skill.id
            if (names.any { it.startsWith("workspace.") || "workspace" in it }) add("workspace")
            if (names.any { "memory" in it }) add("memory")
            if (names.any { "device" in it }) add("device")
            if (names.any { "attachment" in it }) add("attachment")
        }
        return ("workspace" in domains && workspace.containsMatchIn(text)) ||
            ("memory" in domains && memory.containsMatchIn(text)) ||
            ("device" in domains && device.containsMatchIn(text)) ||
            ("attachment" in domains && attachment.containsMatchIn(text))
    }
}

object ReadOnlySkillManifestCodec {
    private val dynamicCodeFields = setOf("script", "command", "entrypoint", "executable", "code", "classpath")
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
        val values = root.optJSONArray("skills") ?: error("skill_manifest_items_required")
        val decoded = (0 until values.length()).map { index ->
            val item = values.getJSONObject(index)
            if (source == SkillSource.USER_DECLARATIVE && dynamicCodeFields.any(item::has)) {
                error("user_skill_dynamic_code_forbidden")
            }
            val requiredCapabilities = item.optJSONArray("capabilities").toStrings().mapTo(linkedSetOf()) { value ->
                RuntimeCapability.entries.firstOrNull { it.name.equals(value, ignoreCase = true) }
                    ?: error("skill_capability_unknown:$value")
            }
            if (requiredCapabilities.any { it in forbiddenExternalCapabilities }) {
                error("external_skill_capability_forbidden")
            }
            require(item.has("instructions")) { "skill_instructions_required" }
            val instructions = item.getString("instructions")
            val tools = item.optJSONArray("tools")?.toStrings()?.toSet() ?: error("skill_tools_required")
            require(item.has("digest")) { "skill_digest_required" }
            SkillDefinition(
                id = item.getString("id"),
                version = item.getInt("version"),
                displayName = item.optString("name", item.getString("id")),
                source = source,
                requiredCapabilities = requiredCapabilities,
                // Script/command fields in an external manifest are deliberately ignored.
                executableOnAndroid = false,
                instructions = instructions,
                allowedTools = tools,
                digest = item.getString("digest"),
            )
        }
        require(decoded.distinctBy { it.id }.size == decoded.size) { "skill_duplicate_id" }
        return decoded
    }

    private fun JSONArray?.toStrings(): List<String> = if (this == null) emptyList() else
        (0 until length()).map(::getString)
}
