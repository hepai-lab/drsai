package ai.drsai.remote.runtime.oaep

import android.content.Context
import android.os.Build
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ai.drsai.remote.remote.security.RelayDeviceSigner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID

data class StoredAndroidRuntimeEnrollment(
    val relayHttpsUrl: String,
    val runtimeId: String,
    val registrationToken: String,
    val instanceId: String,
    val ownerSubject: String,
    val version: String,
) {
    init {
        require(relayHttpsUrl.startsWith("https://") || relayHttpsUrl.startsWith("http://")) {
            "relay_registration_url_invalid"
        }
        require(runtimeId.isNotBlank() && registrationToken.isNotBlank()) { "relay_credential_invalid" }
        require(instanceId.isNotBlank() && ownerSubject.isNotBlank()) { "relay_enrollment_scope_invalid" }
    }

    fun connectorCredential() = AndroidOaepRelayCredential(
        wssUrl = relayHttpsUrl.trimEnd('/').replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + "/v1/runtime-connect",
        runtimeId = runtimeId,
        registrationToken = registrationToken,
        instanceId = instanceId,
        version = version,
    )
}

interface AndroidRuntimeEnrollmentStore {
    fun load(ownerSubject: String): StoredAndroidRuntimeEnrollment?
    fun save(value: StoredAndroidRuntimeEnrollment)
    fun clear(ownerSubject: String)
}

class EncryptedAndroidRuntimeEnrollmentStore(context: Context) : AndroidRuntimeEnrollmentStore {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "android_agent_runtime_enrollment_v1",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun load(ownerSubject: String): StoredAndroidRuntimeEnrollment? {
        require(ownerSubject.isNotBlank()) { "relay_enrollment_subject_required" }
        val raw = preferences.getString(key(ownerSubject), null) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            StoredAndroidRuntimeEnrollment(
                json.getString("relay_https_url"), json.getString("runtime_id"),
                json.getString("registration_token"), json.getString("instance_id"),
                json.getString("owner_subject"), json.getString("version"),
            ).also { require(it.ownerSubject == ownerSubject) { "relay_enrollment_subject_mismatch" } }
        }.getOrElse {
            preferences.edit().remove(key(ownerSubject)).commit()
            null
        }
    }

    override fun save(value: StoredAndroidRuntimeEnrollment) {
        val json = JSONObject()
            .put("relay_https_url", value.relayHttpsUrl)
            .put("runtime_id", value.runtimeId)
            .put("registration_token", value.registrationToken)
            .put("instance_id", value.instanceId)
            .put("owner_subject", value.ownerSubject)
            .put("version", value.version)
        check(preferences.edit().putString(key(value.ownerSubject), json.toString()).commit()) {
            "relay_enrollment_store_failed"
        }
    }

    override fun clear(ownerSubject: String) {
        check(preferences.edit().remove(key(ownerSubject)).commit()) { "relay_enrollment_clear_failed" }
    }

    private fun key(subject: String) = "owner.${subject.length}.${subject}"
}

class AndroidRuntimeEnrollmentClient(
    private val http: OkHttpClient = OkHttpClient(),
    private val requestId: () -> String = { UUID.randomUUID().toString() },
    private val instanceId: () -> String = {
        "android-${Build.MODEL.orEmpty().take(32)}-${UUID.randomUUID()}"
    },
) {
    suspend fun enroll(
        relayHttpsUrl: String,
        registrationCode: String,
        ownerSubject: String,
        displayName: String,
        version: String,
        signer: RelayDeviceSigner,
        store: AndroidRuntimeEnrollmentStore,
    ): StoredAndroidRuntimeEnrollment = withContext(Dispatchers.IO) {
        require(relayHttpsUrl.startsWith("https://") || relayHttpsUrl.startsWith("http://")) {
            "relay_registration_url_invalid"
        }
        require(registrationCode.length in 8..256) { "relay_registration_code_invalid" }
        require(ownerSubject.isNotBlank() && displayName.isNotBlank()) { "relay_enrollment_scope_invalid" }
        require(Regex("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$").matches(version)) {
            "runtime_version_invalid"
        }
        val id = requestId()
        val body = JSONObject()
            .put("request_id", id)
            .put("correlation_id", "android-$id")
            .put("idempotency_key", "android-runtime-$id")
            .put("display_name", displayName.take(128))
            .put("version", version)
            .put("public_key", signer.associationDevice.devicePublicKey)
        val request = Request.Builder()
            .url(relayHttpsUrl.trimEnd('/') + "/v1/runtimes/register")
            .header("X-Registration-Code", registrationCode)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "runtime_registration_failed:${response.code}" }
            val result = JSONObject(response.body?.string() ?: error("runtime_registration_empty"))
            StoredAndroidRuntimeEnrollment(
                relayHttpsUrl.trimEnd('/'), result.getString("runtime_id"),
                result.getString("registration_token"),
                instanceId = instanceId(),
                ownerSubject = ownerSubject,
                version = version,
            ).also(store::save)
        }
    }
}
