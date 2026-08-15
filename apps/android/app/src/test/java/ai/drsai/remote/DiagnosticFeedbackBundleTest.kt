package ai.drsai.remote

import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import ai.drsai.remote.data.OaepDiagnosticEventUi
import ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundleFactory
import ai.drsai.remote.runtime.reliability.DiagnosticFeedbackEnvironment
import ai.drsai.remote.runtime.reliability.DiagnosticFeedbackSecretScanner
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticFeedbackBundleTest {
    @Test fun bundleContainsRequiredMetadataAndExcludesPrivateBodiesAndSecrets() {
        val secret = "sk-p10-feedback-secret-canary"
        val bundle = DiagnosticFeedbackBundleFactory.create(
            DiagnosticFeedbackEnvironment("1.5.6", 156, "debug", "Google", "Pixel 8", 35),
            stableCode = "provider_429", runId = "run-user-private-id", runStatus = "FAILED",
            events = listOf(OaepDiagnosticEventUi(
                "event-private-id", 7, "tool.completed", "now", "run-user-private-id", "item",
                "android", "provider_429", "private prompt and $secret reasoning chain",
            )),
            runtime = FullRuntimeDiagnosticUi(
                bindingState = "READY", health = "READY", route = "Full Local",
                bindReason = "Bearer $secret", kernelSha256 = "a".repeat(64),
                skillManifestSha256 = "b".repeat(64), capabilityManifestSha256 = "c".repeat(64),
            ),
        )
        val text = bundle.text
        assertTrue(bundle.secretScanPassed)
        assertTrue(text.contains("version=1.5.6 (156)"))
        assertTrue(text.contains("device=google/pixel_8"))
        assertTrue(text.contains("android_api=35"))
        assertTrue(text.contains("stable_code=provider_429"))
        assertTrue(text.contains("event_summary=7:tool.completed:android:provider_429"))
        assertTrue(text.contains("feedback_digest=${bundle.digest}"))
        assertFalse(text.contains(secret))
        assertFalse(text.contains("private prompt"))
        assertFalse(text.contains("reasoning chain"))
        assertFalse(text.contains("run-user-private-id"))
        assertFalse(text.contains("event-private-id"))
    }

    @Test fun scannerRejectsCredentialsAndPrivateBodyFields() {
        assertFalse(DiagnosticFeedbackSecretScanner.isSafe("api_key=topsecret"))
        assertFalse(DiagnosticFeedbackSecretScanner.isSafe("reasoning=private chain"))
        assertTrue(DiagnosticFeedbackSecretScanner.isSafe("stable_code=provider_401\nevent_count=2"))
    }
}
