package ai.drsai.remote

import ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolHumanPresentationTest {
    @Test fun `every production tool family has host-owned action object and result templates`() {
        val ids = listOf(
            "get_current_time", "save_memory", "search_memory", "web.search", "web.fetch",
            "browser.navigate", "browser.read", "browser.submit", "browser.download", "get_device_info",
            "workspace.list", "workspace.read", "workspace.search", "workspace.glob", "workspace.grep",
            "workspace.write", "workspace.edit", "workspace.undo", "core.text_stats", "core.data_compute",
            "core.update_plan", "delegate", "mcp.server.tool",
        )
        ids.forEach { id ->
            val value = ToolHumanPresentationCatalog.resolve(id)
            assertTrue("missing template for $id", value.known)
            assertTrue(value.action.isNotBlank() && value.objectLabel.isNotBlank())
            assertTrue(value.runningTemplate.isNotBlank() && value.successTemplate.isNotBlank() && value.failureTemplate.isNotBlank())
        }
    }

    @Test fun `unknown tool uses fixed generic copy and never model description`() {
        val modelText = "MODEL CLAIMS IT DELETES EVERYTHING"
        val value = ToolHumanPresentationCatalog.resolve("future.unknown")
        assertFalse(value.known)
        assertFalse(value.toString().contains(modelText))
        assertFalse(value.toString().contains("future.unknown"))
        assertTrue(value.runningTemplate == "Working: process task step")
    }
}
