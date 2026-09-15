package ai.drsai.remote

import ai.drsai.remote.runtime.security.ApprovalRiskSummaryPolicy
import org.junit.Assert.*
import org.junit.Test

class ApprovalRiskSummaryPolicyTest {
    @Test fun fixturesCoverReadWriteSensitiveMcpAndHandoff() {
        val read = ApprovalRiskSummaryPolicy.present("workspace.read")
        assertTrue(read.reversible)
        assertTrue(read.risk.contains("Read-only"))

        val write = ApprovalRiskSummaryPolicy.present("workspace.write")
        assertTrue(write.reversible)
        assertTrue(write.risk.contains("change"))

        val sensitive = ApprovalRiskSummaryPolicy.present("browser.submit")
        assertFalse(sensitive.reversible)
        assertTrue(sensitive.risk.contains("external effect"))

        val mcp = ApprovalRiskSummaryPolicy.present("mcp.calendar.create")
        assertFalse(mcp.reversible)
        assertEquals("connected service", mcp.objectLabel)

        val handoff = ApprovalRiskSummaryPolicy.present("core.delegate")
        assertFalse(handoff.reversible)
        assertEquals("Desktop Agent", handoff.objectLabel)
    }

    @Test fun unknownOperationFailsClosed() {
        val summary = ApprovalRiskSummaryPolicy.present("future.destructive_action")
        assertFalse(summary.reversible)
        assertTrue(summary.risk.contains("unknown operation"))
        assertFalse(summary.title.contains("future.destructive_action"))
    }
}
