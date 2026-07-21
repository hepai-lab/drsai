package ai.drsai.remote

import ai.drsai.remote.runtime.device.ClipboardAccessPolicy
import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream

class AndroidLocalCapabilitiesTest {
    @Test fun safRelativePathsRejectTraversalAbsoluteAndNullSegments() {
        assertEquals(listOf("docs", "a.txt"), SafWorkspaceGateway.safeParts("docs/a.txt"))
        assertEquals(emptyList<String>(), SafWorkspaceGateway.safeParts(""))
        listOf("../secret", "docs/../secret", "docs/./a", "docs/\u0000bad").forEach { path ->
            assertThrows(IllegalArgumentException::class.java) { SafWorkspaceGateway.safeParts(path) }
        }
    }

    @Test fun clipboardAccessRequiresAnExplicitUserAction() {
        ClipboardAccessPolicy.requireUserInitiated(true)
        assertThrows(IllegalArgumentException::class.java) {
            ClipboardAccessPolicy.requireUserInitiated(false)
        }
        val sanitized = ClipboardAccessPolicy.sanitizeForWrite("Bearer secret api_key=hidden", true)
        assertEquals("Bearer [REDACTED] api_key=[REDACTED]", sanitized)
    }

    @Test fun safReadsAreHardBoundedEvenWhenProviderDoesNotReportLength() {
        assertEquals(16, SafWorkspaceGateway.readBounded(ByteArrayInputStream(ByteArray(16)), 16).size)
        assertThrows(IllegalArgumentException::class.java) {
            SafWorkspaceGateway.readBounded(ByteArrayInputStream(ByteArray(17)), 16)
        }
    }
}
