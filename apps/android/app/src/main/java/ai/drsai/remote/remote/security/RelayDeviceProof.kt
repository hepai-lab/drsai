package ai.drsai.remote.remote.security

import android.os.Build
import android.content.Context
import ai.drsai.remote.BuildConfig
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okio.Buffer
import okhttp3.HttpUrl
import okhttp3.Request
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.EdDSASecurityProvider
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.Security
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64
import java.util.Locale

data class RelayAssociationDevice(
    val deviceId: String,
    val deviceName: String,
    val devicePublicKey: String,
)

interface RelayDeviceSigner {
    val associationDevice: RelayAssociationDevice
    fun sign(message: ByteArray): ByteArray
}

class RelayDeviceProof(
    private val signer: RelayDeviceSigner,
    private val epochSeconds: () -> Long = { Instant.now().epochSecond },
    private val nonce: () -> String = ::randomNonce,
) {
    val associationDevice: RelayAssociationDevice
        get() = signer.associationDevice

    fun authorize(request: Request, accessToken: String): Request {
        require(accessToken.isNotBlank()) { "relay_device_access_token_required" }
        val timestamp = epochSeconds().toString()
        val requestNonce = nonce()
        require(requestNonce.length in 16..128) { "relay_device_nonce_invalid" }
        val body = request.body?.let {
            require(!it.isDuplex() && !it.isOneShot()) {
                "relay_device_request_body_not_replayable"
            }
            Buffer().also(it::writeTo).readByteArray()
        } ?: ByteArray(0)
        val canonical = relayDeviceCanonicalString(
            method = request.method,
            path = request.url.encodedPath,
            canonicalQuery = relayDeviceCanonicalQuery(request.url),
            bodySha256 = sha256Hex(body),
            timestamp = timestamp,
            nonce = requestNonce,
            accessTokenSha256 = sha256Hex(accessToken.toByteArray(StandardCharsets.UTF_8)),
        )
        val signature = base64Url(signer.sign(canonical.toByteArray(StandardCharsets.UTF_8)))
        require(signature.length == 86) { "relay_device_signature_invalid" }
        return request.newBuilder()
            .header("X-Relay-Device-Id", associationDevice.deviceId)
            .header("X-Relay-Device-Timestamp", timestamp)
            .header("X-Relay-Device-Nonce", requestNonce)
            .header("X-Relay-Device-Signature", signature)
            .build()
    }

    companion object {
        internal fun randomNonce(): String {
            val bytes = ByteArray(24)
            java.security.SecureRandom().nextBytes(bytes)
            return base64Url(bytes)
        }
    }
}

class KeystoreWrappedRelayDeviceSigner(
    context: Context,
) : RelayDeviceSigner {
    init {
        ensureEdDsaProvider()
    }
    private val prefs = EncryptedSharedPreferences.create(
        context.applicationContext,
        "opendrsai_relay_device_identity",
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val keyPair by lazy(::loadOrCreate)
    private val privateKey: PrivateKey
        get() = keyPair.first
    private val publicKey: PublicKey
        get() = keyPair.second

    override val associationDevice: RelayAssociationDevice
        get() {
            val raw = rawEd25519PublicKey(publicKey)
            val encoded = base64Url(raw)
            val identityDigest = sha256Hex(raw).take(32)
            val name = listOf(Build.MANUFACTURER, Build.MODEL)
                .joinToString(" ")
                .replace(Regex("\\s+"), " ")
                .trim()
                .ifBlank { "Android device" }
                .take(128)
            return RelayAssociationDevice(
                deviceId = "android.$identityDigest",
                deviceName = name,
                devicePublicKey = encoded,
            )
        }

    override fun sign(message: ByteArray): ByteArray {
        ensureEdDsaProvider()
        return Signature.getInstance(SIGNATURE_ALGORITHM, SOFTWARE_PROVIDER).run {
            initSign(privateKey)
            update(message)
            sign()
        }.also {
            require(it.size == 64) { "relay_device_signature_invalid" }
        }
    }

    private fun loadOrCreate(): Pair<PrivateKey, PublicKey> = synchronized(KEYPAIR_LOCK) {
        ensureEdDsaProvider()
        val factory = KeyFactory.getInstance(KEY_ALGORITHM, SOFTWARE_PROVIDER)
        val privateEncoded = prefs.getString(PRIVATE_KEY, null)
        val publicEncoded = prefs.getString(PUBLIC_KEY, null)
        if (privateEncoded != null || publicEncoded != null) {
            if (privateEncoded != null && publicEncoded != null) runCatching {
                factory.generatePrivate(
                    PKCS8EncodedKeySpec(Base64.getUrlDecoder().decode(privateEncoded)),
                ) to factory.generatePublic(
                    X509EncodedKeySpec(Base64.getUrlDecoder().decode(publicEncoded)),
                )
            }.getOrNull()?.takeIf(::validEd25519KeyPair)?.let { return@synchronized it }
            check(prefs.edit().remove(PRIVATE_KEY).remove(PUBLIC_KEY).commit()) {
                "relay_device_invalid_keypair_cleanup_failed"
            }
        }
        val generated = KeyPairGenerator.getInstance(KEY_ALGORITHM, SOFTWARE_PROVIDER)
            .generateKeyPair()
        val pair = generated.private to generated.public
        check(validEd25519KeyPair(pair)) { "relay_device_keypair_self_test_failed" }
        check(
            prefs.edit()
                .putString(PRIVATE_KEY, base64Url(generated.private.encoded))
                .putString(PUBLIC_KEY, base64Url(generated.public.encoded))
                .commit()
        ) { "relay_device_keypair_store_failed" }
        pair
    }

    private fun validEd25519KeyPair(pair: Pair<PrivateKey, PublicKey>): Boolean =
        runCatching {
            val probe = "opendrsai-relay-device-self-test".toByteArray()
            val signed = Signature.getInstance(SIGNATURE_ALGORITHM, SOFTWARE_PROVIDER).run {
                initSign(pair.first)
                update(probe)
                sign()
            }
            signed.size == 64 && Signature.getInstance(SIGNATURE_ALGORITHM, SOFTWARE_PROVIDER).run {
                initVerify(pair.second)
                update(probe)
                verify(signed)
            }
        }.getOrDefault(false)

    companion object {
        private val SOFTWARE_PROVIDER = EdDSASecurityProvider.PROVIDER_NAME
        private const val KEY_ALGORITHM = "EdDSA"
        private const val SIGNATURE_ALGORITHM = "NONEwithEdDSA"
        private const val PRIVATE_KEY = "private_pkcs8"
        private const val PUBLIC_KEY = "public_x509"
        private val KEYPAIR_LOCK = Any()

        private fun ensureEdDsaProvider() {
            if (Security.getProvider(SOFTWARE_PROVIDER) == null) {
                Security.addProvider(EdDSASecurityProvider())
            }
        }
    }
}

fun androidRelayDeviceProof(context: Context): RelayDeviceProof =
    RelayDeviceProof(KeystoreWrappedRelayDeviceSigner(context))

/**
 * Nullable proofs are retained only for legacy JVM/debug fixtures. Release clients fail closed;
 * every production wiring site supplies the Android Keystore-backed proof explicitly.
 */
fun authorizeRelayRequest(
    deviceProof: RelayDeviceProof?,
    request: Request,
    accessToken: String,
): Request {
    if (deviceProof != null) return deviceProof.authorize(request, accessToken)
    check(BuildConfig.DEBUG) { "relay_device_proof_required" }
    return request
}

fun relayAssociationDevice(deviceProof: RelayDeviceProof?): RelayAssociationDevice {
    if (deviceProof != null) return deviceProof.associationDevice
    check(BuildConfig.DEBUG) { "relay_device_proof_required" }
    return RelayAssociationDevice(
        deviceId = "android.debug-fixture",
        deviceName = "Android debug fixture",
        devicePublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    )
}

internal fun relayDeviceCanonicalString(
    method: String,
    path: String,
    canonicalQuery: String,
    bodySha256: String,
    timestamp: String,
    nonce: String,
    accessTokenSha256: String,
): String = listOf(
    "hai-runtime-relay-device-v1",
    method.uppercase(Locale.ROOT),
    path,
    canonicalQuery,
    bodySha256,
    timestamp,
    nonce,
    accessTokenSha256,
).joinToString("\n")

internal fun relayDeviceCanonicalQuery(url: HttpUrl): String =
    (0 until url.querySize)
        .map { index ->
            url.queryParameterName(index) to (url.queryParameterValue(index) ?: "")
        }
        .sortedWith(compareBy<Pair<String, String>> { it.first }.thenBy { it.second })
        .joinToString("&") { (name, value) ->
            "${pythonQuotePlus(name)}=${pythonQuotePlus(value)}"
        }

private fun pythonQuotePlus(value: String): String = buildString {
    value.toByteArray(StandardCharsets.UTF_8).forEach { byte ->
        val unsigned = byte.toInt() and 0xff
        when {
            unsigned == 0x20 -> append('+')
            unsigned in 'a'.code..'z'.code ||
                unsigned in 'A'.code..'Z'.code ||
                unsigned in '0'.code..'9'.code ||
                unsigned in setOf('-'.code, '.'.code, '_'.code, '~'.code) ->
                append(unsigned.toChar())
            else -> {
                append('%')
                append(unsigned.toString(16).uppercase(Locale.ROOT).padStart(2, '0'))
            }
        }
    }
}

internal fun rawEd25519PublicKey(encoded: ByteArray): ByteArray {
    if (encoded.size == 32) return encoded.copyOf()
    val ed25519Oid = byteArrayOf(0x06, 0x03, 0x2b, 0x65, 0x70)
    val rawBitString = byteArrayOf(0x03, 0x21, 0x00)
    val bitStringOffset = encoded.size - 35
    require(
        bitStringOffset >= 0 &&
            encoded.containsSubsequence(ed25519Oid) &&
            encoded.copyOfRange(bitStringOffset, bitStringOffset + 3)
                .contentEquals(rawBitString)
    ) { "relay_device_public_key_encoding_invalid" }
    return encoded.copyOfRange(encoded.size - 32, encoded.size)
}

private fun rawEd25519PublicKey(publicKey: PublicKey): ByteArray {
    if (publicKey is EdDSAPublicKey) return publicKey.abyte.copyOf()
    require(
        publicKey.algorithm.equals("Ed25519", ignoreCase = true) ||
            publicKey.algorithm.equals("EdDSA", ignoreCase = true)
    ) { "relay_device_public_key_algorithm_invalid" }
    val encoded = requireNotNull(publicKey.encoded) {
        "relay_device_public_key_encoding_missing"
    }
    require(encoded.size >= 32) { "relay_device_public_key_encoding_invalid" }
    // AndroidOpenSSL Ed25519 SPKI ends in the fixed 32-byte compressed public key.
    return encoded.copyOfRange(encoded.size - 32, encoded.size)
}

private fun ByteArray.containsSubsequence(needle: ByteArray): Boolean =
    indices.any { start ->
        start + needle.size <= size &&
            copyOfRange(start, start + needle.size).contentEquals(needle)
    }

internal fun sha256Hex(value: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(value)
        .joinToString("") { "%02x".format(it) }

internal fun base64Url(value: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(value)
