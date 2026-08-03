package ai.drsai.remote.runtime.python

import android.content.Context
import java.security.MessageDigest
import org.json.JSONObject

enum class LocalRuntimeImplementation { KOTLIN_LITE, PYTHON_SHARED_CORE }
enum class RuntimeRoute { KOTLIN_LITE, PYTHON_LOCAL, REMOTE_FULL, MANUAL_RECOVERY }

data class PythonRuntimeRolloutState(
    val buildEnabled: Boolean,
    val userEnabled: Boolean,
    val pythonHealthy: Boolean,
    val policyEnabled: Boolean = false,
    val remoteFullAvailable: Boolean = false,
    val sideEffectsCommitted: Boolean = false,
)

data class RuntimeRolloutContext(
    val versionCode: Int,
    val channel: String,
    val apiLevel: Int,
    val abi: String,
    val memoryClassMb: Int,
    val accountBucket: Int,
    val deviceBucket: Int,
    val nowEpochSeconds: Long,
)

data class RuntimeRolloutPolicyDocument(
    val policyVersion: String,
    val issuedAtEpochSeconds: Long,
    val expiresAtEpochSeconds: Long,
    val pythonEnabled: Boolean,
    val emergencyDisabled: Boolean,
    val rolloutPercent: Int,
    val minVersionCode: Int,
    val maxVersionCode: Int,
    val channels: Set<String>,
    val minApi: Int,
    val maxApi: Int,
    val abis: Set<String>,
    val minMemoryClassMb: Int,
    val decisionReason: String,
) {
    init {
        require(policyVersion.isNotBlank()) { "runtime_policy_version_required" }
        require(expiresAtEpochSeconds > issuedAtEpochSeconds) { "runtime_policy_window_invalid" }
        require(rolloutPercent in 0..100) { "runtime_policy_percent_invalid" }
        require(minVersionCode <= maxVersionCode && minApi <= maxApi) { "runtime_policy_range_invalid" }
    }

    fun permits(context: RuntimeRolloutContext): Boolean =
        pythonEnabled && !emergencyDisabled &&
            context.nowEpochSeconds in issuedAtEpochSeconds..expiresAtEpochSeconds &&
            context.versionCode in minVersionCode..maxVersionCode &&
            context.channel in channels && context.apiLevel in minApi..maxApi &&
            context.abi in abis && context.memoryClassMb >= minMemoryClassMb &&
            Math.floorMod(context.accountBucket xor context.deviceBucket, 100) < rolloutPercent

    companion object {
        fun fromJson(root: JSONObject) = RuntimeRolloutPolicyDocument(
            policyVersion = root.getString("policy_version"),
            issuedAtEpochSeconds = root.getLong("issued_at_epoch_seconds"),
            expiresAtEpochSeconds = root.getLong("expires_at_epoch_seconds"),
            pythonEnabled = root.getBoolean("python_enabled"),
            emergencyDisabled = root.getBoolean("emergency_disabled"),
            rolloutPercent = root.getInt("rollout_percent"),
            minVersionCode = root.getInt("min_version_code"),
            maxVersionCode = root.getInt("max_version_code"),
            channels = root.getJSONArray("channels").toStringSet(),
            minApi = root.getInt("min_api"),
            maxApi = root.getInt("max_api"),
            abis = root.getJSONArray("abis").toStringSet(),
            minMemoryClassMb = root.getInt("min_memory_class_mb"),
            decisionReason = root.optString("reason").ifBlank { "policy_applied" }.take(200),
        )
    }
}

fun interface RuntimePolicySignatureVerifier {
    fun verify(canonicalPayload: ByteArray, signature: ByteArray): Boolean
}

data class VerifiedRuntimePolicy(val document: RuntimeRolloutPolicyDocument, val payloadSha256: String)

object SignedRuntimeRolloutPolicy {
    fun verifyAndParse(envelope: JSONObject, verifier: RuntimePolicySignatureVerifier): VerifiedRuntimePolicy {
        require(envelope.keys().asSequence().toSet() == setOf("payload", "signature_hex")) {
            "runtime_policy_envelope_invalid"
        }
        val payload = envelope.getString("payload").encodeToByteArray()
        val signature = envelope.getString("signature_hex").hexToBytes()
        require(verifier.verify(payload, signature)) { "runtime_policy_signature_invalid" }
        return VerifiedRuntimePolicy(
            RuntimeRolloutPolicyDocument.fromJson(JSONObject(payload.decodeToString())),
            MessageDigest.getInstance("SHA-256").digest(payload).toHex(),
        )
    }
}

object PythonRuntimeRolloutPolicy {
    fun select(state: PythonRuntimeRolloutState): LocalRuntimeImplementation =
        if (state.buildEnabled && state.userEnabled && state.pythonHealthy && state.policyEnabled) {
            LocalRuntimeImplementation.PYTHON_SHARED_CORE
        } else LocalRuntimeImplementation.KOTLIN_LITE

    fun route(
        state: PythonRuntimeRolloutState,
        context: RuntimeRolloutContext,
        verifiedPolicy: VerifiedRuntimePolicy?,
    ): RuntimeRoute {
        if (state.sideEffectsCommitted && (!state.pythonHealthy || verifiedPolicy?.document?.permits(context) != true)) {
            return RuntimeRoute.MANUAL_RECOVERY
        }
        if (state.buildEnabled && state.userEnabled && state.pythonHealthy && state.policyEnabled &&
            verifiedPolicy?.document?.permits(context) == true
        ) return RuntimeRoute.PYTHON_LOCAL
        return if (state.remoteFullAvailable) RuntimeRoute.REMOTE_FULL else RuntimeRoute.KOTLIN_LITE
    }

    fun mayFallbackToKotlin(
        pythonStartedSideEffect: Boolean,
        checkpointHasCompletedSideEffects: Boolean,
    ): Boolean = !pythonStartedSideEffect && !checkpointHasCompletedSideEffects
}

class PythonRuntimePreferenceStore(context: Context, private val defaultEnabled: Boolean) {
    private val preferences = context.getSharedPreferences("python_runtime_rollout", Context.MODE_PRIVATE)
    var enabled: Boolean
        get() = preferences.getBoolean("enabled", defaultEnabled)
        set(value) { preferences.edit().putBoolean("enabled", value).apply() }

    val policyEnabled: Boolean
        get() = preferences.getBoolean("policy_verified", false) &&
            preferences.getLong("policy_expires_at", 0) >= System.currentTimeMillis() / 1000

    fun installVerifiedPolicy(policy: VerifiedRuntimePolicy) {
        preferences.edit()
            .putBoolean("policy_verified", policy.document.pythonEnabled && !policy.document.emergencyDisabled)
            .putLong("policy_expires_at", policy.document.expiresAtEpochSeconds)
            .putString("policy_version", policy.document.policyVersion)
            .putString("policy_payload_sha256", policy.payloadSha256)
            .apply()
    }

    fun clearPolicy() {
        preferences.edit().remove("policy_verified").remove("policy_expires_at")
            .remove("policy_version").remove("policy_payload_sha256").apply()
    }

    fun recordPolicyDiagnostic(value: RuntimePolicyDiagnostic) {
        preferences.edit()
            .putString("diagnostic_status", value.status)
            .putString("diagnostic_policy_version", value.policyVersion)
            .putString("diagnostic_payload_sha256", value.payloadSha256)
            .putString("diagnostic_reason", value.reason)
            .putLong("diagnostic_recorded_at", value.recordedAtEpochSeconds)
            .apply {
                value.rolloutPercent?.let { putInt("diagnostic_rollout_percent", it) }
                value.emergencyDisabled?.let { putBoolean("diagnostic_emergency_disabled", it) }
            }
            .apply()
    }

    fun policyDiagnostic(): RuntimePolicyDiagnostic? {
        val status = preferences.getString("diagnostic_status", null) ?: return null
        return RuntimePolicyDiagnostic(
            status,
            preferences.getString("diagnostic_policy_version", null),
            preferences.getString("diagnostic_payload_sha256", null),
            preferences.getString("diagnostic_reason", null),
            preferences.getLong("diagnostic_recorded_at", 0),
            preferences.getInt("diagnostic_rollout_percent", -1).takeIf { it in 0..100 },
            if (preferences.contains("diagnostic_emergency_disabled")) {
                preferences.getBoolean("diagnostic_emergency_disabled", false)
            } else null,
        )
    }
}

private fun org.json.JSONArray.toStringSet() = buildSet { repeat(length()) { add(getString(it)) } }
private fun String.hexToBytes(): ByteArray {
    require(length % 2 == 0 && all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) { "signature_hex_invalid" }
    return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
