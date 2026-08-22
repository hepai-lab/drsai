package ai.drsai.remote.remote.data

import android.content.Context
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.PromptLayer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import org.json.JSONObject

class WorkspaceInstructionVersionStore(context: Context) {
    private val preferences = context.getSharedPreferences("remote_instruction_versions", Context.MODE_PRIVATE)

    fun accepted(subject: String, runtimeId: RuntimeId, workspaceId: WorkspaceId): Map<String, String>? =
        preferences.getString(key(subject, runtimeId, workspaceId), null)?.let { raw ->
            val json = JSONObject(raw)
            json.keys().asSequence().associateWith(json::getString)
        }

    fun accept(subject: String, runtimeId: RuntimeId, workspaceId: WorkspaceId, versions: Map<String, String>) {
        require(subject.isNotBlank()) { "instruction_subject_required" }
        require(versions.all { (source, version) -> source.isNotBlank() && version.isNotBlank() }) {
            "instruction_version_invalid"
        }
        val valueKey = key(subject, runtimeId, workspaceId)
        val subjectIndex = subjectIndex(subject)
        val runtimeIndex = runtimeIndex(subject, runtimeId)
        preferences.edit()
            .putString(valueKey, JSONObject(versions.toSortedMap()).toString())
            .putStringSet(subjectIndex, preferences.getStringSet(subjectIndex, emptySet()).orEmpty() + valueKey)
            .putStringSet(runtimeIndex, preferences.getStringSet(runtimeIndex, emptySet()).orEmpty() + valueKey)
            .apply()
    }

    fun clearSubject(subject: String) {
        val index = subjectIndex(subject)
        preferences.edit().apply {
            preferences.getStringSet(index, emptySet()).orEmpty().forEach(::remove)
            preferences.all.keys.filter { it.startsWith("runtime_index_${subjectDigest(subject)}_") }.forEach(::remove)
            remove(index)
        }.apply()
    }

    fun clearRuntime(subject: String, runtimeId: RuntimeId) {
        val runtimeIndex = runtimeIndex(subject, runtimeId)
        val subjectIndex = subjectIndex(subject)
        val removing = preferences.getStringSet(runtimeIndex, emptySet()).orEmpty()
        preferences.edit().apply {
            removing.forEach(::remove)
            putStringSet(subjectIndex, preferences.getStringSet(subjectIndex, emptySet()).orEmpty() - removing)
            remove(runtimeIndex)
        }.apply()
    }

    private fun key(subject: String, runtimeId: RuntimeId, workspaceId: WorkspaceId): String =
        MessageDigest.getInstance("SHA-256")
            .digest("$subject\u001f${runtimeId.value}\u001f${workspaceId.value}".encodeToByteArray()).hex()

    private fun subjectDigest(subject: String) = MessageDigest.getInstance("SHA-256")
        .digest(subject.encodeToByteArray()).hex()
    private fun subjectIndex(subject: String) = "subject_index_${subjectDigest(subject)}"
    private fun runtimeIndex(subject: String, runtimeId: RuntimeId) =
        "runtime_index_${subjectDigest(subject)}_${MessageDigest.getInstance("SHA-256").digest(runtimeId.value.encodeToByteArray()).hex()}"

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
}

class RemoteProjectInstructionLoader(
    private val client: RelayWorkspaceOperationsClient,
    private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun load(workspaceId: WorkspaceId): List<PromptFragment> = CANDIDATES.mapNotNull { path ->
        val stat = client.statFile(workspaceId, path, idFactory(), idFactory())
        val metadata = when (stat) {
            is OwopResult.Success -> stat.result
            is OwopResult.Failure -> {
                if (stat.code in NOT_FOUND_CODES) return@mapNotNull null
                error("remote_instruction_stat_failed:${stat.code}")
            }
        }
        val size = (metadata["size"] as? Number)?.toLong() ?: error("remote_instruction_size_missing")
        require(size in 1..MAX_BYTES) { "remote_instruction_size_invalid" }
        val expectedDigest = (metadata["digest"] as? String)?.lowercase()
            ?: error("remote_instruction_digest_missing")
        require(expectedDigest.matches(Regex("^[a-f0-9]{64}$"))) { "remote_instruction_digest_invalid" }
        val read = client.readFile(workspaceId, path, 0, size, idFactory(), idFactory())
        val payload = when (read) {
            is OwopResult.Success -> read.result
            is OwopResult.Failure -> error("remote_instruction_read_failed:${read.code}")
        }
        val encoded = payload["content_base64"] as? String ?: error("remote_instruction_content_missing")
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size.toLong() == size) { "remote_instruction_size_changed" }
        val actualDigest = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
        require(actualDigest == expectedDigest) { "remote_instruction_digest_mismatch" }
        val text = bytes.toString(StandardCharsets.UTF_8).takeIf(String::isNotBlank) ?: return@mapNotNull null
        PromptFragment(PromptLayer.PROJECT, text, "remote:$path", expectedDigest)
    }

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    companion object {
        private const val MAX_BYTES = 64L * 1024
        private val CANDIDATES = listOf("AGENTS.md", "DRSAI.md", ".drsai/DRSAI.md")
        private val NOT_FOUND_CODES = setOf("not_found", "file_not_found", "path_not_found")
    }
}
