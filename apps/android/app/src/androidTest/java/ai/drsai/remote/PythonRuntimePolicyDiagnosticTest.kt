package ai.drsai.remote

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.runtime.python.PythonRuntimePreferenceStore
import ai.drsai.remote.runtime.python.RuntimePolicyDiagnostic
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimePolicyDiagnosticTest {
    @Test fun rolloutVersionPercentAndReasonRemainAvailableForDiagnostics() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("python_runtime_rollout", Context.MODE_PRIVATE).edit().clear().commit()
        val store = PythonRuntimePreferenceStore(context, false)
        store.recordPolicyDiagnostic(RuntimePolicyDiagnostic(
            status = "applied", policyVersion = "policy-42", payloadSha256 = "a".repeat(64),
            reason = "canary_expand", recordedAtEpochSeconds = 1234,
            rolloutPercent = 5, emergencyDisabled = false,
        ))

        val value = store.policyDiagnostic()!!
        assertEquals("policy-42", value.policyVersion)
        assertEquals("canary_expand", value.reason)
        assertEquals(5, value.rolloutPercent)
        assertEquals(false, value.emergencyDisabled)
    }
}
