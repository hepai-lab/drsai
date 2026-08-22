package ai.drsai.remote.remote.security

import android.os.Build
import android.content.Context
import ai.drsai.remote.BuildConfig
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okio.Buffer
import okhttp3.HttpUrl
import okhttp3.Request
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

data class RelayAssociationDevice(
    val deviceId: String,
    val deviceName: String,
    val devicePublicKey: String,
)

interface RelayDeviceSigner {
    val associationDevice: RelayAssociationDevice
    val keyCreatedAtEpochSeconds: Long
        get() = Long.MAX_VALUE
    fun sign(message: ByteArray): ByteArray
    fun beginKeyRotation(): RelayDeviceKeyRotation =
        error("relay_device_key_rotation_not_supported")
}

class RelayDeviceKeyRotation internal constructor(
    val newDevicePublicKey: String,
    private val signAction: (ByteArray) -> ByteArray = {
        error("relay_device_pending_key_not_available")
    },
    private val discardAction: () -> Unit = {},
    private val commitAction: () -> Unit,
) {
    private val settled = AtomicBoolean(false)

    fun commit() {
        check(settled.compareAndSet(false, true)) { "relay_device_key_rotation_already_settled" }
        commitAction()
    }

    fun discard() {
        if (settled.compareAndSet(false, true)) discardAction()
    }

    internal fun sign(message: ByteArray): ByteArray = signAction(message)
}

class RelayDeviceProof(
    private val signer: RelayDeviceSigner,
    private val epochSeconds: () -> Long = { Instant.now().epochSecond },
    private val nonce: () -> String = ::randomNonce,
) {
    val associationDevice: RelayAssociationDevice
        get() = signer.associationDevice

    fun beginKeyRotation(): RelayDeviceKeyRotation = signer.beginKeyRotation()

    fun isKeyRotationDue(maxAgeSeconds: Long = DEFAULT_KEY_MAX_AGE_SECONDS): Boolean {
        require(maxAgeSeconds > 0) { "relay_device_key_max_age_invalid" }
        val createdAt = signer.keyCreatedAtEpochSeconds
        return createdAt > 0 && createdAt != Long.MAX_VALUE &&
            epochSeconds() >= createdAt + maxAgeSeconds
    }

    fun authorize(request: Request, accessToken: String): Request =
        authorizeWith(request, accessToken, signer::sign)

    fun authorizeWithPendingKey(
        request: Request,
        accessToken: String,
        rotation: RelayDeviceKeyRotation,
    ): Request = authorizeWith(request, accessToken, rotation::sign)

    private fun authorizeWith(
        request: Request,
        accessToken: String,
        sign: (ByteArray) -> ByteArray,
    ): Request {
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
        val signature = base64Url(sign(canonical.toByteArray(StandardCharsets.UTF_8)))
        require(signature.length == 86) { "relay_device_signature_invalid" }
        return request.newBuilder()
            .header("X-Relay-Device-Id", associationDevice.deviceId)
            .header("X-Relay-Device-Timestamp", timestamp)
            .header("X-Relay-Device-Nonce", requestNonce)
            .header("X-Relay-Device-Signature", signature)
            .build()
    }

    companion object {
        const val DEFAULT_KEY_MAX_AGE_SECONDS: Long = 90L * 24L * 60L * 60L

        internal fun randomNonce(): String {
            val bytes = ByteArray(24)
            java.security.SecureRandom().nextBytes(bytes)
            return base64Url(bytes)
        }
    }
}

class KeystoreWrappedRelayDeviceSigner(
    context: Context,
    preferencesName: String = DEFAULT_PREFERENCES_NAME,
) : RelayDeviceSigner {
    init {
        require(preferencesName.matches(Regex("^[A-Za-z0-9._-]{8,128}$"))) {
            "relay_device_preferences_name_invalid"
        }
    }
    private val prefs = EncryptedSharedPreferences.create(
        context.applicationContext,
        preferencesName,
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    @Volatile private var keyPair = loadOrCreate()
    @Volatile private var keyCreatedAt = loadOrCreateKeyCreatedAt()
    private val stableDeviceId = loadOrCreateDeviceId()
    private val privateKey: Ed25519PrivateKeyParameters
        get() = keyPair.first
    private val publicKey: Ed25519PublicKeyParameters
        get() = keyPair.second

    override val associationDevice: RelayAssociationDevice
        get() {
            val raw = publicKey.encoded
            val encoded = base64Url(raw)
            val name = listOf(Build.MANUFACTURER, Build.MODEL)
                .joinToString(" ")
                .replace(Regex("\\s+"), " ")
                .trim()
                .ifBlank { "Android device" }
                .take(128)
            return RelayAssociationDevice(
                deviceId = stableDeviceId,
                deviceName = name,
                devicePublicKey = encoded,
            )
        }

    override val keyCreatedAtEpochSeconds: Long
        get() = keyCreatedAt

    override fun sign(message: ByteArray): ByteArray {
        return Ed25519Signer().run {
            init(true, privateKey)
            update(message, 0, message.size)
            generateSignature()
        }.also {
            require(it.size == 64) { "relay_device_signature_invalid" }
        }
    }

    override fun beginKeyRotation(): RelayDeviceKeyRotation {
        val replacement = synchronized(KEYPAIR_LOCK) {
            loadPendingKeyPair() ?: run {
                val replacementPrivate = Ed25519PrivateKeyParameters(java.security.SecureRandom())
                val generated = replacementPrivate to replacementPrivate.generatePublicKey()
                check(validEd25519KeyPair(generated)) { "relay_device_keypair_self_test_failed" }
                check(
                    prefs.edit()
                        .putString(PENDING_PRIVATE_KEY, base64Url(generated.first.encoded))
                        .putString(PENDING_PUBLIC_KEY, base64Url(generated.second.encoded))
                        .commit()
                ) { "relay_device_pending_key_store_failed" }
                generated
            }
        }
        return RelayDeviceKeyRotation(
            newDevicePublicKey = base64Url(replacement.second.encoded),
            commitAction = {
                synchronized(KEYPAIR_LOCK) {
                    val rotatedAt = Instant.now().epochSecond
                    check(
                        prefs.edit()
                            .putString(PRIVATE_KEY, base64Url(replacement.first.encoded))
                            .putString(PUBLIC_KEY, base64Url(replacement.second.encoded))
                            .putLong(KEY_CREATED_AT, rotatedAt)
                            .remove(PENDING_PRIVATE_KEY)
                            .remove(PENDING_PUBLIC_KEY)
                            .commit()
                    ) { "relay_device_key_rotation_store_failed" }
                    keyPair = replacement
                    keyCreatedAt = rotatedAt
                }
            },
            signAction = { message ->
                Ed25519Signer().run {
                    init(true, replacement.first)
                    update(message, 0, message.size)
                    generateSignature()
                }
            },
            discardAction = {
                synchronized(KEYPAIR_LOCK) {
                    check(
                        prefs.edit().remove(PENDING_PRIVATE_KEY).remove(PENDING_PUBLIC_KEY).commit()
                    ) { "relay_device_pending_key_cleanup_failed" }
                }
            },
        )
    }

    private fun loadPendingKeyPair(): Pair<Ed25519PrivateKeyParameters, Ed25519PublicKeyParameters>? {
        val privateEncoded = prefs.getString(PENDING_PRIVATE_KEY, null)
        val publicEncoded = prefs.getString(PENDING_PUBLIC_KEY, null)
        if (privateEncoded == null && publicEncoded == null) return null
        val pair = if (privateEncoded != null && publicEncoded != null) runCatching {
            val privateSeed = rawEd25519PrivateSeed(Base64.getUrlDecoder().decode(privateEncoded))
            val publicRaw = rawEd25519PublicKey(Base64.getUrlDecoder().decode(publicEncoded))
            Ed25519PrivateKeyParameters(privateSeed, 0) to Ed25519PublicKeyParameters(publicRaw, 0)
        }.getOrNull()?.takeIf(::validEd25519KeyPair) else null
        if (pair != null) return pair
        check(prefs.edit().remove(PENDING_PRIVATE_KEY).remove(PENDING_PUBLIC_KEY).commit()) {
            "relay_device_invalid_pending_key_cleanup_failed"
        }
        return null
    }

    private fun loadOrCreateKeyCreatedAt(): Long = synchronized(KEYPAIR_LOCK) {
        prefs.getLong(KEY_CREATED_AT, 0L).takeIf { it > 0 }?.let { return@synchronized it }
        val createdAt = Instant.now().epochSecond
        check(prefs.edit().putLong(KEY_CREATED_AT, createdAt).commit()) {
            "relay_device_key_created_at_store_failed"
        }
        createdAt
    }

    private fun loadOrCreate(): Pair<Ed25519PrivateKeyParameters, Ed25519PublicKeyParameters> = synchronized(KEYPAIR_LOCK) {
        val privateEncoded = prefs.getString(PRIVATE_KEY, null)
        val publicEncoded = prefs.getString(PUBLIC_KEY, null)
        if (privateEncoded != null || publicEncoded != null) {
            if (privateEncoded != null && publicEncoded != null) runCatching {
                val privateSeed = rawEd25519PrivateSeed(Base64.getUrlDecoder().decode(privateEncoded))
                val publicRaw = rawEd25519PublicKey(Base64.getUrlDecoder().decode(publicEncoded))
                Ed25519PrivateKeyParameters(privateSeed, 0) to Ed25519PublicKeyParameters(publicRaw, 0)
            }.getOrNull()?.takeIf(::validEd25519KeyPair)?.let { return@synchronized it }
            check(prefs.edit().remove(PRIVATE_KEY).remove(PUBLIC_KEY).commit()) {
                "relay_device_invalid_keypair_cleanup_failed"
            }
        }
        val privateKey = Ed25519PrivateKeyParameters(java.security.SecureRandom())
        val pair = privateKey to privateKey.generatePublicKey()
        check(validEd25519KeyPair(pair)) { "relay_device_keypair_self_test_failed" }
        check(
            prefs.edit()
                .putString(PRIVATE_KEY, base64Url(pair.first.encoded))
                .putString(PUBLIC_KEY, base64Url(pair.second.encoded))
                .commit()
        ) { "relay_device_keypair_store_failed" }
        pair
    }

    private fun loadOrCreateDeviceId(): String = synchronized(KEYPAIR_LOCK) {
        prefs.getString(DEVICE_ID, null)?.takeIf {
            it.length in 16..128 && it.matches(Regex("^[A-Za-z0-9._-]+$"))
        }?.let { return@synchronized it }
        // Migration preserves the identity already enrolled by previous
        // builds, whose device id was derived from the then-current key.
        val migrated = "android.${sha256Hex(keyPair.second.encoded).take(32)}"
        check(prefs.edit().putString(DEVICE_ID, migrated).commit()) {
            "relay_device_id_store_failed"
        }
        migrated
    }

    private fun validEd25519KeyPair(pair: Pair<Ed25519PrivateKeyParameters, Ed25519PublicKeyParameters>): Boolean =
        runCatching {
            val probe = "opendrsai-relay-device-self-test".toByteArray()
            val signed = Ed25519Signer().run {
                init(true, pair.first)
                update(probe, 0, probe.size)
                generateSignature()
            }
            signed.size == 64 && Ed25519Signer().run {
                init(false, pair.second)
                update(probe, 0, probe.size)
                verifySignature(signed)
            }
        }.getOrDefault(false)

    companion object {
        const val DEFAULT_PREFERENCES_NAME = "opendrsai_relay_device_identity"
        private const val PRIVATE_KEY = "private_pkcs8"
        private const val PUBLIC_KEY = "public_x509"
        private const val DEVICE_ID = "stable_device_id"
        private const val KEY_CREATED_AT = "key_created_at_epoch_seconds"
        private const val PENDING_PRIVATE_KEY = "pending_private_seed"
        private const val PENDING_PUBLIC_KEY = "pending_public_raw"
        private val KEYPAIR_LOCK = Any()
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

internal fun rawEd25519PrivateSeed(encoded: ByteArray): ByteArray {
    if (encoded.size == 32) return encoded.copyOf()
    val ed25519Oid = byteArrayOf(0x06, 0x03, 0x2b, 0x65, 0x70)
    require(encoded.size >= 32 && encoded.containsSubsequence(ed25519Oid)) {
        "relay_device_private_key_encoding_invalid"
    }
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
