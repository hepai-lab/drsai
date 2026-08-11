package ai.drsai.remote.runtime.tools

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

data class UserSkillRecord(
    val current: SkillDefinition,
    val enabled: Boolean,
    val previous: List<SkillDefinition> = emptyList(),
)

interface UserSkillPersistence {
    fun load(accountSubject: String): List<UserSkillRecord>
    fun save(accountSubject: String, records: List<UserSkillRecord>)
}

class SharedPreferencesUserSkillPersistence(context: Context) : UserSkillPersistence {
    private val preferences = context.getSharedPreferences("android-user-declarative-skills-v1", Context.MODE_PRIVATE)

    override fun load(accountSubject: String): List<UserSkillRecord> {
        val raw = preferences.getString(key(accountSubject), null) ?: return emptyList()
        val values = JSONArray(raw)
        return (0 until values.length()).map { index ->
            val item = values.getJSONObject(index)
            UserSkillRecord(
                current = item.getJSONObject("current").toDefinition(),
                enabled = item.getBoolean("enabled"),
                previous = item.optJSONArray("previous").let { history ->
                    if (history == null) emptyList() else (0 until history.length()).map { history.getJSONObject(it).toDefinition() }
                },
            )
        }.sortedBy { it.current.id }
    }

    override fun save(accountSubject: String, records: List<UserSkillRecord>) {
        val values = JSONArray(records.sortedBy { it.current.id }.map { record ->
            JSONObject()
                .put("current", record.current.toJson())
                .put("enabled", record.enabled)
                .put("previous", JSONArray(record.previous.map(SkillDefinition::toJson)))
        })
        preferences.edit().putString(key(accountSubject), values.toString()).commit()
    }

    private fun key(subject: String): String = MessageDigest.getInstance("SHA-256")
        .digest(subject.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

class UserDeclarativeSkillRepository(private val persistence: UserSkillPersistence) {
    @Synchronized
    fun install(accountSubject: String, manifest: String): List<UserSkillRecord> {
        require(accountSubject.isNotBlank()) { "skill_account_required" }
        val incoming = ReadOnlySkillManifestCodec.decode(manifest, SkillSource.USER_DECLARATIVE)
        require(incoming.isNotEmpty()) { "user_skill_manifest_empty" }
        val records = persistence.load(accountSubject).associateBy { it.current.id }.toMutableMap()
        incoming.forEach { definition ->
            val existing = records[definition.id]
            when {
                existing == null -> records[definition.id] = UserSkillRecord(definition, enabled = false)
                definition.version < existing.current.version -> error("user_skill_version_downgrade:${definition.id}")
                definition.version == existing.current.version && definition.digest == existing.current.digest -> Unit
                definition.version == existing.current.version -> error("user_skill_version_conflict:${definition.id}")
                else -> records[definition.id] = UserSkillRecord(
                    current = definition,
                    // Every content/version update requires a fresh explicit enable action.
                    enabled = false,
                    previous = (existing.previous + existing.current).takeLast(MAX_HISTORY),
                )
            }
        }
        return records.values.sortedBy { it.current.id }.also { persistence.save(accountSubject, it) }
    }

    @Synchronized
    fun setEnabled(accountSubject: String, skillId: String, enabled: Boolean): List<UserSkillRecord> =
        update(accountSubject, skillId) { it.copy(enabled = enabled) }

    @Synchronized
    fun rollback(accountSubject: String, skillId: String): List<UserSkillRecord> =
        update(accountSubject, skillId) { record ->
            val restored = record.previous.lastOrNull() ?: error("user_skill_rollback_unavailable:$skillId")
            UserSkillRecord(
                current = restored,
                enabled = false,
                previous = record.previous.dropLast(1) + record.current,
            )
        }

    @Synchronized
    fun delete(accountSubject: String, skillId: String): List<UserSkillRecord> {
        val records = persistence.load(accountSubject).filterNot { it.current.id == skillId }
        persistence.save(accountSubject, records)
        return records
    }

    fun snapshot(accountSubject: String): List<UserSkillRecord> = persistence.load(accountSubject)

    fun enabled(accountSubject: String): List<SkillDefinition> = snapshot(accountSubject)
        .filter(UserSkillRecord::enabled).map(UserSkillRecord::current)

    private fun update(
        accountSubject: String,
        skillId: String,
        transform: (UserSkillRecord) -> UserSkillRecord,
    ): List<UserSkillRecord> {
        require(accountSubject.isNotBlank()) { "skill_account_required" }
        val records = persistence.load(accountSubject).toMutableList()
        val index = records.indexOfFirst { it.current.id == skillId }
        require(index >= 0) { "user_skill_not_found:$skillId" }
        records[index] = transform(records[index])
        return records.sortedBy { it.current.id }.also { persistence.save(accountSubject, it) }
    }

    companion object { private const val MAX_HISTORY = 3 }
}

class SafUserSkillImporter(
    private val context: Context,
    private val repository: UserDeclarativeSkillRepository,
) {
    fun import(accountSubject: String, uri: Uri): List<UserSkillRecord> {
        require(uri.scheme == "content") { "user_skill_saf_uri_required" }
        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8 * 1024)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                require(total <= MAX_MANIFEST_BYTES) { "user_skill_manifest_too_large" }
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        } ?: error("user_skill_saf_read_failed")
        return repository.install(accountSubject, bytes.toString(Charsets.UTF_8))
    }

    companion object { private const val MAX_MANIFEST_BYTES = 128 * 1024 }
}

data class BuiltInSkillBundleAttestation(
    val signingCertificateSha256: String,
    val manifestSha256: String,
    val attestationSha256: String,
) {
    companion object {
        fun create(signingCertificateSha256: String, skills: List<SkillDefinition>): BuiltInSkillBundleAttestation {
            require(signingCertificateSha256.matches(Regex("[a-f0-9]{64}"))) { "apk_signer_digest_invalid" }
            require(skills.all { it.source == SkillSource.BUILT_IN }) { "built_in_skill_source_invalid" }
            val manifest = sha256(skills.sortedBy { it.id }.joinToString("\n") { "${it.id}:${it.version}:${it.digest}" })
            return BuiltInSkillBundleAttestation(
                signingCertificateSha256, manifest,
                sha256("android-apk-skill-bundle-v1\u0000$signingCertificateSha256\u0000$manifest"),
            )
        }

        private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

fun Context.apkSigningCertificateSha256(): String {
    val info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    val certificate = info.signingInfo?.apkContentsSigners?.singleOrNull()
        ?: error("apk_signer_unavailable")
    return MessageDigest.getInstance("SHA-256").digest(certificate.toByteArray())
        .joinToString("") { "%02x".format(it) }
}

private fun SkillDefinition.toJson() = JSONObject()
    .put("id", id).put("version", version).put("name", displayName)
    .put("source", source.name.lowercase()).put("instructions", instructions)
    .put("tools", JSONArray(allowedTools.sorted()))
    .put("capabilities", JSONArray(requiredCapabilities.map { it.name.lowercase() }.sorted()))
    .put("digest", digest)

private fun JSONObject.toDefinition(): SkillDefinition {
    val source = SkillSource.entries.firstOrNull { it.name.equals(getString("source"), ignoreCase = true) }
        ?: error("skill_source_unknown")
    val capabilities = optJSONArray("capabilities").toStringSet().mapTo(linkedSetOf()) { raw ->
        ai.drsai.remote.workbench.model.RuntimeCapability.entries.firstOrNull { it.name.equals(raw, ignoreCase = true) }
            ?: error("skill_capability_unknown:$raw")
    }
    return SkillDefinition(
        id = getString("id"), version = getInt("version"), displayName = getString("name"), source = source,
        executableOnAndroid = source == SkillSource.BUILT_IN,
        instructions = getString("instructions"), allowedTools = getJSONArray("tools").toStringSet(),
        requiredCapabilities = capabilities, digest = getString("digest"),
    )
}

private fun JSONArray?.toStringSet(): Set<String> = if (this == null) emptySet() else
    (0 until length()).mapTo(linkedSetOf()) { index -> getString(index) }
