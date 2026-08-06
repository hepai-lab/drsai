package ai.drsai.remote.remote.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteAuditPresentationTest {
    @Test fun `internal actions map to stable user readable labels`() {
        assertEquals("开始任务", remoteAuditActionLabel("run.created"))
        assertEquals("批准操作", remoteAuditActionLabel("approval.approved"))
        assertEquals("更新任务", remoteAuditActionLabel("internal.unknown"))
    }

    @Test fun `audit screen does not expose internal correlation or content fields`() {
        val source = java.io.File(
            "src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt",
        ).readText()
        val audit = source.substringAfter("fun RemoteAuditScreen(").substringBefore("data class RemoteMessageUi")
        assertFalse(audit.contains("correlationId"))
        assertFalse(audit.contains("command"))
        assertFalse(audit.contains("message.text"))
    }
}
