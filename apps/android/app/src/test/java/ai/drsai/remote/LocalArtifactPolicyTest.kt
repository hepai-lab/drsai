package ai.drsai.remote

import ai.drsai.remote.data.ArtifactPreviewKind
import ai.drsai.remote.data.LocalArtifactPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class LocalArtifactPolicyTest {
    @Test fun textImagePdfAndLargeFilesHaveDeterministicPreviewPolicy() {
        assertEquals(ArtifactPreviewKind.TEXT, LocalArtifactPolicy.previewKind("text/plain", 1024))
        assertEquals(ArtifactPreviewKind.EXTERNAL, LocalArtifactPolicy.previewKind("text/plain", 2L * 1024 * 1024))
        assertEquals(ArtifactPreviewKind.IMAGE, LocalArtifactPolicy.previewKind("image/png", 2L * 1024 * 1024))
        assertEquals(ArtifactPreviewKind.PDF, LocalArtifactPolicy.previewKind("application/pdf", 2L * 1024 * 1024))
        assertEquals(
            ArtifactPreviewKind.TOO_LARGE,
            LocalArtifactPolicy.previewKind("application/octet-stream", LocalArtifactPolicy.MAX_OPEN_BYTES + 1),
        )
    }

    @Test fun displayNameNeverContainsAStoragePath() {
        val safe = LocalArtifactPolicy.safeName("C:\\private\\runtime\\report.pdf")
        assertEquals("report.pdf", safe)
        assertFalse(safe.contains("private"))
        assertFalse(safe.contains('/'))
        assertFalse(safe.contains('\\'))
    }
}
