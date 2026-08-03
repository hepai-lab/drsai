package ai.drsai.remote.remote.debug

import ai.drsai.remote.remote.data.redactRemoteSecrets
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Debug-only endpoint-local security probe.
 *
 * Canary values arrive through a private stdin-written file, never a command
 * argument. The receiver exercises the same AndroidX encrypted preference
 * primitive used by auth storage and the production remote-log redactor.
 */
class SecurityCanaryProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val nonce = intent.getStringExtra("nonce").orEmpty()
        val input = File(context.filesDir, INPUT_FILE)
        val proof = runCatching {
            require(NONCE.matches(nonce)) { "security_canary_nonce_invalid" }
            val payload = JSONObject(input.readText(Charsets.UTF_8))
            require(payload.getString("nonce") == nonce) {
                "security_canary_nonce_mismatch"
            }
            val array = payload.getJSONArray("canaries")
            val canaries = (0 until array.length()).map(array::getString)
            require(canaries.isNotEmpty() && canaries.all(CANARY::matches)) {
                "security_canary_values_invalid"
            }
            val prefs = EncryptedSharedPreferences.create(
                context,
                PREFERENCES,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            require(
                prefs.edit()
                    .putString("runtime_token", canaries.first())
                    .putString("grant_code", canaries.getOrElse(1) { canaries.first() })
                    .commit()
            ) { "security_canary_encrypted_store_failed" }
            val safeLog = redactRemoteSecrets(
                "token=${canaries.first()} " +
                    "message=${canaries.getOrElse(2) { canaries.first() }} " +
                    "command=${canaries.last()}"
            )
            require(canaries.none(safeLog::contains)) {
                "security_canary_log_redaction_failed"
            }
            Log.i(LOG_TAG, safeLog)
            require(input.delete()) { "security_canary_input_cleanup_failed" }
            JSONObject()
                .put("nonce", nonce)
                .put("status", "passed")
                .put("canary_count", canaries.size)
                .put("encrypted_store_present", true)
                .put("log_redacted", true)
                .put("input_deleted", true)
        }.getOrElse { failure ->
            input.delete()
            JSONObject()
                .put("nonce", nonce.takeIf(NONCE::matches) ?: "invalid")
                .put("status", "failed")
                .put("error_code", failure.message ?: failure::class.java.simpleName)
        }
        writeProof(context, proof)
    }

    private fun writeProof(context: Context, proof: JSONObject) {
        val output = File(context.noBackupFilesDir, PROOF_FILE)
        val temporary = File(context.noBackupFilesDir, "$PROOF_FILE.tmp")
        temporary.writeText(proof.toString(), Charsets.UTF_8)
        Files.move(
            temporary.toPath(),
            output.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    }

    companion object {
        const val ACTION = "ai.drsai.remote.debug.SECURITY_CANARY_PROBE"
        const val INPUT_FILE = "v3-security-canary-input.json"
        const val PROOF_FILE = "v3-security-canary-proof.json"
        const val PREFERENCES = "opendrsai_security_canary"
        const val LOG_TAG = "OpenDrSaiSecurity"
        private val NONCE = Regex("^[a-f0-9]{32}$")
        private val CANARY = Regex("^[A-Za-z0-9_-]{12,128}$")
    }
}
