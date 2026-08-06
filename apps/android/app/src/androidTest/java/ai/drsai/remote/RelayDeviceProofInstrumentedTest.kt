package ai.drsai.remote

import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import ai.drsai.remote.remote.security.relayDeviceCanonicalQuery
import ai.drsai.remote.remote.security.relayDeviceCanonicalString
import ai.drsai.remote.remote.security.sha256Hex
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.util.Base64
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
class RelayDeviceProofInstrumentedTest {
    @Test
    fun keystoreIdentityIsStableAndSignatureVerifies() {
        val context = androidx.test.platform.app.InstrumentationRegistry
            .getInstrumentation().targetContext
        val first = androidRelayDeviceProof(context)
        val second = androidRelayDeviceProof(context)
        assertEquals(first.associationDevice, second.associationDevice)
        assertEquals(43, first.associationDevice.devicePublicKey.length)
        println(
            "OPENDRSAI_DEVICE_SUMMARY=" +
                sha256Hex(first.associationDevice.deviceId.toByteArray()).take(16),
        )

        val request = Request.Builder()
            .url("https://ai-dev.ihep.ac.cn/api/runtime-relay/v1/runtimes?limit=20")
            .get()
            .build()
        val authorized = first.authorize(request, "instrumentation-token")
        val timestamp = requireNotNull(authorized.header("X-Relay-Device-Timestamp"))
        val nonce = requireNotNull(authorized.header("X-Relay-Device-Nonce"))
        val signature = Base64.getUrlDecoder().decode(
            requireNotNull(authorized.header("X-Relay-Device-Signature")),
        )
        val canonical = relayDeviceCanonicalString(
            method = authorized.method,
            path = authorized.url.encodedPath,
            canonicalQuery = relayDeviceCanonicalQuery(authorized.url),
            bodySha256 = sha256Hex(ByteArray(0)),
            timestamp = timestamp,
            nonce = nonce,
            accessTokenSha256 = sha256Hex("instrumentation-token".toByteArray()),
        )

        val raw = Base64.getUrlDecoder().decode(first.associationDevice.devicePublicKey)
        val canonicalBytes = canonical.toByteArray()
        val verified = Ed25519Signer().run {
            init(false, Ed25519PublicKeyParameters(raw, 0))
            update(canonicalBytes, 0, canonicalBytes.size)
            verifySignature(signature)
        }

        assertTrue(verified)
    }

    @Test
    fun concurrentClientsConvergeOnOneStoredDeviceIdentity() {
        val context = androidx.test.platform.app.InstrumentationRegistry
            .getInstrumentation().targetContext
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results = pool.invokeAll(
                (1..32).map { index ->
                    Callable {
                        val proof = androidRelayDeviceProof(context)
                        val request = Request.Builder()
                            .url(
                                "https://ai-dev.ihep.ac.cn/api/runtime-relay/v1/runtimes" +
                                    "?request=$index",
                            )
                            .build()
                        val authorized = proof.authorize(request, "concurrency-token")
                        proof.associationDevice.deviceId to
                            requireNotNull(authorized.header("X-Relay-Device-Signature"))
                    }
                },
            ).map { it.get() }

            assertEquals(1, results.map { it.first }.toSet().size)
            assertEquals(32, results.map { it.second }.toSet().size)
        } finally {
            pool.shutdownNow()
        }
    }
}
