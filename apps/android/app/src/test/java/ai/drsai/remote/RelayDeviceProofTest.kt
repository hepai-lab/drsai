package ai.drsai.remote

import ai.drsai.remote.BuildConfig
import ai.drsai.remote.remote.security.RelayAssociationDevice
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.RelayDeviceSigner
import ai.drsai.remote.remote.security.rawEd25519PrivateSeed
import ai.drsai.remote.remote.security.rawEd25519PublicKey
import ai.drsai.remote.remote.security.authorizeRelayRequest
import ai.drsai.remote.remote.data.withRelayPath
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class RelayDeviceProofTest {
    @Test
    fun `proof matches frozen HAI canonical request contract`() {
        val signer = CapturingSigner()
        val proof = RelayDeviceProof(
            signer,
            epochSeconds = { 1_785_100_000L },
            nonce = { "nonce-0123456789abcdef" },
        )
        val request = Request.Builder()
            .url(
                "https://ai-dev.ihep.ac.cn/api/runtime-relay/v1/runtimes" +
                    "?z=2&a=hello%20world&a=&unicode=%E4%B8%AD",
            )
            .post("""{"x":1}""".toRequestBody("application/json".toMediaType()))
            .build()

        val authorized = proof.authorize(request, "access-token")

        assertEquals("android.test-device", authorized.header("X-Relay-Device-Id"))
        assertEquals("1785100000", authorized.header("X-Relay-Device-Timestamp"))
        assertEquals("nonce-0123456789abcdef", authorized.header("X-Relay-Device-Nonce"))
        assertEquals(86, authorized.header("X-Relay-Device-Signature")?.length)
        assertEquals(
            """
            hai-runtime-relay-device-v1
            POST
            /api/runtime-relay/v1/runtimes
            a=&a=hello+world&unicode=%E4%B8%AD&z=2
            5041bf1f713df204784353e82f6a4a535931cb64f1f4b4a5aeaffcb720918b22
            1785100000
            nonce-0123456789abcdef
            3f16bed7089f4653e5ef21bfd2824d7f3aaaecc7a598e7e89c580e1606a9cc52
            """.trimIndent(),
            signer.message,
        )
    }

    @Test
    fun `proof signs the exact safely encoded opaque path`() {
        val signer = CapturingSigner()
        val proof = RelayDeviceProof(
            signer,
            epochSeconds = { 1_785_100_000L },
            nonce = { "nonce-0123456789abcdef" },
        )
        val url = "https://ai-dev.ihep.ac.cn/api/runtime-relay/".toHttpUrl().withRelayPath(
            listOf("v1", "runtimes", "rt/a ?#%\u4e2d", "workspaces"),
            listOf("cursor" to "next&admin=true"),
        )

        proof.authorize(Request.Builder().url(url).build(), "access-token")

        val canonical = checkNotNull(signer.message)
        assertEquals(
            "/api/runtime-relay/v1/runtimes/rt%2Fa%20%3F%23%25%E4%B8%AD/workspaces",
            canonical.lineSequence().elementAt(2),
        )
        assertEquals("cursor=next%26admin%3Dtrue", canonical.lineSequence().elementAt(3))
    }

    @Test
    fun `extracts raw Ed25519 public key from X509 encoding`() {
        val prefix = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03,
            0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        )
        val raw = ByteArray(32) { it.toByte() }

        assertArrayEquals(raw, rawEd25519PublicKey(prefix + raw))
        assertArrayEquals(raw, rawEd25519PublicKey(raw))
    }

    @Test
    fun `legacy EdDSA PKCS8 private seed migrates without changing identity`() {
        val seed = ByteArray(32) { it.toByte() }
        val legacyPkcs8Prefix = byteArrayOf(
            0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
            0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
        )
        assertArrayEquals(seed, rawEd25519PrivateSeed(legacyPkcs8Prefix + seed))
        assertArrayEquals(seed, rawEd25519PrivateSeed(seed))
    }

    @Test
    fun `missing device proof is allowed only in debug fixtures`() {
        val request = Request.Builder().url("https://relay.invalid/v1/runtimes").build()
        if (BuildConfig.DEBUG) {
            assertSame(request, authorizeRelayRequest(null, request, "token"))
        } else {
            try {
                authorizeRelayRequest(null, request, "token")
                fail("release_client_must_fail_without_device_proof")
            } catch (expected: IllegalStateException) {
                assertEquals("relay_device_proof_required", expected.message)
            }
        }
    }

    @Test
    fun `device key rotation becomes due only after bounded age`() {
        val signer = CapturingSigner(createdAt = 1_000L)
        val before = RelayDeviceProof(signer, epochSeconds = { 1_999L })
        val due = RelayDeviceProof(signer, epochSeconds = { 2_000L })

        assertEquals(false, before.isKeyRotationDue(maxAgeSeconds = 1_000L))
        assertEquals(true, due.isKeyRotationDue(maxAgeSeconds = 1_000L))
    }

    private class CapturingSigner(
        private val createdAt: Long = Long.MAX_VALUE,
    ) : RelayDeviceSigner {
        override val associationDevice = RelayAssociationDevice(
            deviceId = "android.test-device",
            deviceName = "Android test device",
            devicePublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )
        var message: String? = null

        override val keyCreatedAtEpochSeconds: Long
            get() = createdAt

        override fun sign(message: ByteArray): ByteArray {
            this.message = message.toString(Charsets.UTF_8)
            return ByteArray(64) { it.toByte() }
        }
    }
}
