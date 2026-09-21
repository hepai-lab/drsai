package ai.drsai.remote

import ai.drsai.remote.runtime.security.ToolOperationOutcomePolicy
import org.junit.Assert.*
import org.junit.Test

class ToolOperationOutcomePolicyTest {
    @Test fun successWithRealWorkspaceTokenOffersSeparatelyApprovedUndo() {
        val outcome = ToolOperationOutcomePolicy.present("workspace.write", "completed", mapOf(
            "summary" to "文件已创建", "mutation_token" to "token-1",
        ))
        assertEquals("文件已创建", outcome.completed)
        assertNull(outcome.notExecuted)
        assertEquals("Undo this change", outcome.remedyLabel)
        assertTrue(outcome.remedyPrompt!!.contains("token-1"))
    }

    @Test fun partialResultSeparatesCompletedAndNotExecuted() {
        val outcome = ToolOperationOutcomePolicy.present("mcp.calendar.batch", "failed", mapOf(
            "completed" to "已创建 2 个日程", "not_executed" to "第 3 个日程未创建",
        ))
        assertTrue(outcome.partial)
        assertEquals("已创建 2 个日程", outcome.completed)
        assertEquals("第 3 个日程未创建", outcome.notExecuted)
        assertNull(outcome.remedyLabel)
        assertNotNull(outcome.irreversibleNotice)
    }

    @Test fun failureDoesNotClaimRollbackOrSideEffect() {
        val outcome = ToolOperationOutcomePolicy.present("workspace.write", "failed", null)
        assertNull(outcome.completed)
        assertTrue(outcome.notExecuted!!.contains("no new external result is confirmed"))
        assertNull(outcome.remedyLabel)
    }

    @Test fun irreversibleSuccessExplainsCompensatingActionWithoutFakeUndo() {
        val outcome = ToolOperationOutcomePolicy.present("browser.submit", "completed", "表单已提交")
        assertEquals("表单已提交", outcome.completed)
        assertNull(outcome.remedyLabel)
        assertTrue(outcome.irreversibleNotice!!.contains("irreversible"))
    }
}
