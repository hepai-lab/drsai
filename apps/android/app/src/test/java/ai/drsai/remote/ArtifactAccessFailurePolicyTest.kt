package ai.drsai.remote

import ai.drsai.remote.data.ArtifactAccessFailurePolicy
import ai.drsai.remote.data.ArtifactPreviewKind
import ai.drsai.remote.data.LocalArtifactPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArtifactAccessFailurePolicyTest {
    @Test fun textBinaryOversizeExpiredAndDigestFailuresHaveExactOutcomes() {
        assertEquals(ArtifactPreviewKind.TEXT, LocalArtifactPolicy.previewKind("text/plain", 100))
        assertEquals(ArtifactPreviewKind.EXTERNAL, LocalArtifactPolicy.previewKind("application/octet-stream", 100))
        assertEquals(ArtifactPreviewKind.TOO_LARGE, LocalArtifactPolicy.previewKind("application/octet-stream", LocalArtifactPolicy.MAX_OPEN_BYTES + 1))
        assertEquals("Result expired", ArtifactAccessFailurePolicy.from("artifact_not_found")?.title)
        assertEquals("Integrity check failed", ArtifactAccessFailurePolicy.from("artifact_digest_mismatch")?.title)
        assertTrue(requireNotNull(ArtifactAccessFailurePolicy.from("artifact_digest_mismatch")).canRegenerate)
        assertFalse(requireNotNull(ArtifactAccessFailurePolicy.from("unknown")).canRegenerate)
    }
}
