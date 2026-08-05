package ai.drsai.remote.runtime.python

import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.i2p.crypto.eddsa.EdDSAEngine
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class RuntimePolicyDiagnostic(
    val status: String,
    val policyVersion: String?,
    val payloadSha256: String?,
    val reason: String?,
    val recordedAtEpochSeconds: Long,
    val rolloutPercent: Int? = null,
    val emergencyDisabled: Boolean? = null,
)

class Ed25519RuntimePolicySignatureVerifier(publicKeyHex: String) : RuntimePolicySignatureVerifier {
    private val key: EdDSAPublicKey

    init {
        val bytes = publicKeyHex.hexPolicyBytes()
        require(bytes.size == 32) { "runtime_policy_public_key_invalid" }
        val curve = EdDSANamedCurveTable.getByName("Ed25519")
        key = EdDSAPublicKey(EdDSAPublicKeySpec(bytes, curve))
    }

    override fun verify(canonicalPayload: ByteArray, signature: ByteArray): Boolean = runCatching {
        val engine = EdDSAEngine(MessageDigest.getInstance("SHA-512"))
        engine.initVerify(key)
        engine.update(canonicalPayload)
        engine.verify(signature)
    }.getOrDefault(false)
}

class RuntimeRolloutPolicyClient(
    private val endpoint: String,
    private val verifier: RuntimePolicySignatureVerifier,
    private val store: PythonRuntimePreferenceStore,
    private val http: OkHttpClient = OkHttpClient(),
    private val nowEpochSeconds: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    suspend fun refresh(): RuntimePolicyDiagnostic = withContext(Dispatchers.IO) {
        runCatching {
            require(endpoint.startsWith("https://")) { "runtime_policy_https_required" }
            val response = http.newCall(Request.Builder().url(endpoint).get().build()).execute()
            response.use {
                require(it.isSuccessful) { "runtime_policy_http_${it.code}" }
                val body = it.body?.string() ?: error("runtime_policy_body_missing")
                val policy = SignedRuntimeRolloutPolicy.verifyAndParse(JSONObject(body), verifier)
                require(nowEpochSeconds() in policy.document.issuedAtEpochSeconds..policy.document.expiresAtEpochSeconds) {
                    "runtime_policy_expired"
                }
                store.installVerifiedPolicy(policy)
                RuntimePolicyDiagnostic(
                    "applied", policy.document.policyVersion, policy.payloadSha256, policy.document.decisionReason,
                    nowEpochSeconds(), policy.document.rolloutPercent, policy.document.emergencyDisabled,
                ).also(store::recordPolicyDiagnostic)
            }
        }.getOrElse { error ->
            store.clearPolicy()
            RuntimePolicyDiagnostic(
                "fail_safe", null, null, error.message ?: "runtime_policy_unknown", nowEpochSeconds(),
            ).also(store::recordPolicyDiagnostic)
        }
    }
}

private fun String.hexPolicyBytes(): ByteArray {
    require(length % 2 == 0 && all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) {
        "runtime_policy_public_key_invalid"
    }
    return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
