package ai.drsai.remote.remote.data

import android.content.Context
import ai.drsai.remote.remote.model.RuntimeId
import java.security.MessageDigest

data class ProviderPushToken(
    val provider: String,
    val value: String,
)

data class PushRegistrationCheckpoint(
    val provider: String,
    val tokenDigest: String,
    val generation: Long,
)

data class RemotePushReadiness(
    val ready: Boolean,
    val fcm: Boolean,
    val workerRunning: Boolean,
)

interface PushReadinessClient {
    suspend fun pushReadiness(): RemotePushReadiness
}

interface PushRegistrationClient {
    suspend fun upsertPushRegistration(
        runtimeId: RuntimeId,
        provider: String,
        token: String,
        generation: Long,
    ): RemotePushRegistration

    suspend fun revokePushRegistration(runtimeId: RuntimeId): RemotePushRegistration
}

interface PushRegistrationStateStore {
    fun read(runtimeId: RuntimeId): PushRegistrationCheckpoint?
    fun write(runtimeId: RuntimeId, checkpoint: PushRegistrationCheckpoint)
    fun clear(runtimeId: RuntimeId)
}

class SharedPreferencesPushRegistrationStateStore(
    context: Context,
    private val accountScope: String,
) : PushRegistrationStateStore {
    init {
        require(accountScope.isNotBlank()) { "push_account_scope_required" }
    }
    private val preferences = context.applicationContext.getSharedPreferences(
        "remote_push_registration_v1", Context.MODE_PRIVATE,
    )

    override fun read(runtimeId: RuntimeId): PushRegistrationCheckpoint? {
        val prefix = runtimeId.storagePrefix()
        val provider = preferences.getString("$prefix.provider", null) ?: return null
        val digest = preferences.getString("$prefix.digest", null) ?: return null
        val generation = preferences.getLong("$prefix.generation", 0L)
        return if (generation >= 1 && digest.matches(Regex("^[0-9a-f]{64}$"))) {
            PushRegistrationCheckpoint(provider, digest, generation)
        } else {
            clear(runtimeId)
            null
        }
    }

    override fun write(runtimeId: RuntimeId, checkpoint: PushRegistrationCheckpoint) {
        require(checkpoint.generation >= 1 && checkpoint.tokenDigest.matches(Regex("^[0-9a-f]{64}$"))) {
            "push_checkpoint_invalid"
        }
        val prefix = runtimeId.storagePrefix()
        check(preferences.edit()
            .putString("$prefix.provider", checkpoint.provider)
            .putString("$prefix.digest", checkpoint.tokenDigest)
            .putLong("$prefix.generation", checkpoint.generation)
            .commit()) { "push_checkpoint_write_failed" }
    }

    override fun clear(runtimeId: RuntimeId) {
        val prefix = runtimeId.storagePrefix()
        check(preferences.edit()
            .remove("$prefix.provider")
            .remove("$prefix.digest")
            .remove("$prefix.generation")
            .commit()) { "push_checkpoint_clear_failed" }
    }

    private fun RuntimeId.storagePrefix(): String = "$accountScope\n$value".sha256()

    private fun String.sha256(): String = MessageDigest.getInstance("SHA-256")
        .digest(toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

/**
 * Bridges a provider SDK token to each device-bound Runtime association.
 *
 * The raw provider token is held only for the duration of the HTTPS request.
 * Local durable state contains a SHA-256 digest and a monotonic generation so
 * retries are idempotent and rotations cannot move backwards.
 */
class RemotePushRegistrationCoordinator(
    private val client: PushRegistrationClient,
    private val state: PushRegistrationStateStore,
) {
    suspend fun synchronize(
        runtimeIds: Collection<RuntimeId>,
        token: ProviderPushToken,
    ): List<RemotePushRegistration> {
        require(token.provider.matches(Regex("^[a-z][a-z0-9_-]{1,31}$"))) {
            "push_provider_invalid"
        }
        require(token.value.length in 32..4096 && token.value.any { !it.isWhitespace() }) {
            "push_token_invalid"
        }
        val digest = token.value.sha256()
        return runtimeIds.distinct().map { runtimeId ->
            val previous = state.read(runtimeId)
            val unchanged = previous?.provider == token.provider && previous.tokenDigest == digest
            val generation = if (unchanged) previous.generation else (previous?.generation ?: 0L) + 1L
            val result = client.upsertPushRegistration(
                runtimeId, token.provider, token.value, generation,
            )
            require(result.runtimeId == runtimeId && result.status == "active" &&
                result.provider == token.provider && result.generation == generation) {
                "push_registration_result_invalid"
            }
            state.write(
                runtimeId,
                PushRegistrationCheckpoint(token.provider, digest, generation),
            )
            result
        }
    }

    suspend fun revoke(runtimeId: RuntimeId): RemotePushRegistration {
        val result = client.revokePushRegistration(runtimeId)
        require(result.runtimeId == runtimeId && result.status == "revoked") {
            "push_registration_revoke_invalid"
        }
        state.clear(runtimeId)
        return result
    }

    private fun String.sha256(): String = MessageDigest.getInstance("SHA-256")
        .digest(toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
