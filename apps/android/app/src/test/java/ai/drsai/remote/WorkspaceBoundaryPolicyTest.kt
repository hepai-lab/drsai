package ai.drsai.remote

import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.WorkspaceBoundaryPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class WorkspaceBoundaryPolicyTest {
    @Test fun absoluteUrisTraversalAndAmbiguousNamesFailClosed() {
        listOf("/etc/passwd", "C:\\Users\\alice\\secret.txt", "content://provider/tree/root", "file:///tmp/x", "../outside")
            .forEach { value -> assertThrows(IllegalArgumentException::class.java) { SafWorkspaceGateway.safeParts(value) } }
        assertThrows(IllegalArgumentException::class.java) {
            WorkspaceBoundaryPolicy.uniqueChildIndex(listOf("report.txt", "report.txt"), "report.txt")
        }
        assertEquals(1, WorkspaceBoundaryPolicy.uniqueChildIndex(listOf("a/report.txt", "report.txt"), "report.txt"))
        assertEquals(-1, WorkspaceBoundaryPolicy.uniqueChildIndex(listOf("a.txt"), "missing.txt"))
    }

    @Test fun workspaceLabelsAndModelPathsNeverExposeAbsolutePaths() {
        val label = WorkspaceBoundaryPolicy.safeWorkspaceLabel("C:\\Users\\alice\\Private\\Project")
        assertFalse(label.contains("C:\\Users"))
        assertEquals(listOf("docs", "report.txt"), SafWorkspaceGateway.safeParts("docs/report.txt"))
    }
}
