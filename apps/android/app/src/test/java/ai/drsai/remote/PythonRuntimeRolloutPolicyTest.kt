package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

class PythonRuntimeRolloutPolicyTest {
    @Test
    fun `Python requires build user and health gates`() {
        assertEquals(
            LocalRuntimeImplementation.PYTHON_SHARED_CORE,
            PythonRuntimeRolloutPolicy.select(PythonRuntimeRolloutState(true, true, true, policyEnabled = true)),
        )
        listOf(
            PythonRuntimeRolloutState(false, true, true),
            PythonRuntimeRolloutState(true, false, true),
            PythonRuntimeRolloutState(true, true, false),
            PythonRuntimeRolloutState(true, true, true, policyEnabled = false),
        ).forEach {
            assertEquals(LocalRuntimeImplementation.KOTLIN_LITE, PythonRuntimeRolloutPolicy.select(it))
        }
    }

    @Test
    fun `fallback is forbidden after any side effect evidence`() {
        assertTrue(PythonRuntimeRolloutPolicy.mayFallbackToKotlin(false, false))
        assertFalse(PythonRuntimeRolloutPolicy.mayFallbackToKotlin(true, false))
        assertFalse(PythonRuntimeRolloutPolicy.mayFallbackToKotlin(false, true))
    }

    @Test
    fun `signed policy gates every production rollout dimension and kill switch fails safe`() {
        val payload = policyJson(emergencyDisabled = false).toString()
        val verified = SignedRuntimeRolloutPolicy.verifyAndParse(
            JSONObject().put("payload", payload).put("signature_hex", "0102"),
            RuntimePolicySignatureVerifier { bytes, signature -> bytes.decodeToString() == payload && signature.contentEquals(byteArrayOf(1, 2)) },
        )
        val context = RuntimeRolloutContext(200, "beta", 35, "arm64-v8a", 256, 11, 20, 1_500)
        val state = PythonRuntimeRolloutState(true, true, true, policyEnabled = true, remoteFullAvailable = true)
        assertEquals(RuntimeRoute.PYTHON_LOCAL, PythonRuntimeRolloutPolicy.route(state, context, verified))
        assertEquals(RuntimeRoute.REMOTE_FULL, PythonRuntimeRolloutPolicy.route(state, context.copy(apiLevel = 25), verified))
        assertEquals(RuntimeRoute.REMOTE_FULL, PythonRuntimeRolloutPolicy.route(state, context, null))

        val killedPayload = policyJson(emergencyDisabled = true).toString()
        val killed = SignedRuntimeRolloutPolicy.verifyAndParse(
            JSONObject().put("payload", killedPayload).put("signature_hex", "00"),
            RuntimePolicySignatureVerifier { _, _ -> true },
        )
        assertEquals(RuntimeRoute.REMOTE_FULL, PythonRuntimeRolloutPolicy.route(state, context, killed))
        assertEquals(
            RuntimeRoute.MANUAL_RECOVERY,
            PythonRuntimeRolloutPolicy.route(state.copy(sideEffectsCommitted = true), context, killed),
        )
    }

    @Test
    fun `tampered or expired policy cannot enable Python`() {
        val envelope = JSONObject().put("payload", policyJson(false).toString()).put("signature_hex", "00")
        assertEquals(
            "runtime_policy_signature_invalid",
            runCatching { SignedRuntimeRolloutPolicy.verifyAndParse(envelope, RuntimePolicySignatureVerifier { _, _ -> false }) }
                .exceptionOrNull()?.message,
        )
        val expired = VerifiedRuntimePolicy(RuntimeRolloutPolicyDocument.fromJson(policyJson(false)), "digest")
        val context = RuntimeRolloutContext(200, "beta", 35, "arm64-v8a", 256, 1, 2, 3_000)
        assertEquals(
            RuntimeRoute.KOTLIN_LITE,
            PythonRuntimeRolloutPolicy.route(PythonRuntimeRolloutState(true, true, true, policyEnabled = true), context, expired),
        )
    }

    @Test
    fun `ed25519 verifier accepts RFC vector and rejects tampering`() {
        val verifier = Ed25519RuntimePolicySignatureVerifier(
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        )
        val signature = hex(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
                "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        )
        assertTrue(verifier.verify(ByteArray(0), signature))
        assertFalse(verifier.verify(byteArrayOf(1), signature))
    }

    private fun policyJson(emergencyDisabled: Boolean) = JSONObject()
        .put("policy_version", "stage7-1")
        .put("issued_at_epoch_seconds", 1_000)
        .put("expires_at_epoch_seconds", 2_000)
        .put("python_enabled", true)
        .put("emergency_disabled", emergencyDisabled)
        .put("rollout_percent", 100)
        .put("min_version_code", 100)
        .put("max_version_code", 300)
        .put("channels", JSONArray().put("beta"))
        .put("min_api", 26)
        .put("max_api", 36)
        .put("abis", JSONArray().put("arm64-v8a"))
        .put("min_memory_class_mb", 192)

    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
