package ai.drsai.remote

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.PendingRemoteApprovalDecision
import ai.drsai.remote.remote.data.PendingRemoteRunControl
import ai.drsai.remote.remote.data.RemoteApprovalDecisionLedger
import ai.drsai.remote.remote.data.RemoteRunControlLedger
import ai.drsai.remote.remote.data.RemoteRunControlOperation
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteSensitiveStorageInstrumentedTest {
    @Test
    fun tokensAndRecoveryLedgersAreEncryptedAndClearableInIsolatedNamespace() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val targetContext = instrumentation.targetContext
        val prefix = "p6_sensitive_probe_"
        val redirectedNames = linkedSetOf<String>()
        // An instrumentation APK has no independently writable SharedPreferences on
        // some Samsung builds. Redirect every production preference name into an
        // isolated target-UID namespace instead; actual credential/ledger files are
        // never opened, read, cleared, or scanned.
        val context = object : ContextWrapper(targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val redirected = prefix + name
                redirectedNames += redirected
                return targetContext.getSharedPreferences(redirected, mode)
            }
        }
        val subject = "p6-sensitive-subject"
        val token = "p6-sensitive-token-canary-4c83e81c"
        val runtime = "runtime-sensitive"
        val workspace = "workspace-sensitive"
        val session = "session-sensitive"
        val run = "run-sensitive"
        val approval = "approval-sensitive"
        val tokens = SecureTokenStore(context)
        val runs = RemoteRunControlLedger(context)
        val approvals = RemoteApprovalDecisionLedger(context)
        try {
            tokens.clear()
            runs.clearSubject(subject)
            approvals.clearSubject(subject)
            tokens.accessToken = token
            tokens.refreshToken = "$token-refresh"
            tokens.relayTicket = "$token-ticket"
            runs.begin(PendingRemoteRunControl(
                subject, "organization-sensitive", runtime, workspace, session, run,
                RemoteRunControlOperation.CANCEL, "cancel:$run", 1,
            ))
            approvals.begin(PendingRemoteApprovalDecision(
                subject, "organization-sensitive", runtime, workspace, session, run,
                approval, "approve", "approval:$approval:approve", 1,
            ))

            val forbidden = listOf(token, "$token-refresh", "$token-ticket").map { it.toByteArray() }
            val preferencesRoot = File(targetContext.applicationInfo.dataDir, "shared_prefs")
            val storageFiles = redirectedNames.map { File(preferencesRoot, "$it.xml") }
                .filter(File::isFile)
            check(storageFiles.isNotEmpty()) { "p6_sensitive_storage_sources_empty" }
            storageFiles.forEach { file ->
                val bytes = file.readBytes()
                forbidden.forEach { canary -> assertFalse(bytes.containsSubsequence(canary)) }
            }
        } finally {
            tokens.clear()
            runs.clearSubject(subject)
            approvals.clearSubject(subject)
            redirectedNames.forEach(targetContext::deleteSharedPreferences)
        }
        assertNull(tokens.accessToken)
        assertNull(runs.pending(subject, "organization-sensitive", runtime, workspace, session))
        assertNull(approvals.pending(subject, "organization-sensitive", runtime, workspace, session))
    }

    private fun ByteArray.containsSubsequence(needle: ByteArray): Boolean {
        if (needle.isEmpty() || needle.size > size) return false
        return (0..size - needle.size).any { start ->
            needle.indices.all { offset -> this[start + offset] == needle[offset] }
        }
    }
}
