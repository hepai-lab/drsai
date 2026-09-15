package ai.drsai.remote

import ai.drsai.remote.runtime.security.ApprovalChangePreviewPolicy
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ApprovalChangePreviewPolicyTest {
    @Test fun createAndUpdateExposeTargetBoundedDiffAndReceiptBinding() {
        val createRaw = JSONObject().put("operation", "create").put("path", "notes/new.txt")
            .put("before_sha256", "missing").put("diff", "+hello")
            .put("mutation_token", "token-create").toString()
        val create = ApprovalChangePreviewPolicy.sanitize("workspace.write", createRaw)
        assertEquals("notes/new.txt", create.target)
        assertTrue(create.summary.contains("Create file"))
        assertTrue(ApprovalChangePreviewPolicy.receiptMatches(create,
            JSONObject().put("path", "notes/new.txt").put("mutation_token", "token-create").toString()))
        assertFalse(ApprovalChangePreviewPolicy.receiptMatches(create,
            JSONObject().put("path", "other.txt").put("mutation_token", "token-create").toString()))

        val update = ApprovalChangePreviewPolicy.sanitize("workspace.edit", JSONObject(createRaw)
            .put("operation", "edit").put("before_sha256", "a".repeat(64)).toString())
        assertTrue(update.summary.contains("Update file"))
    }

    @Test fun settingAndMultiFileFixturesShowStructureWithoutValues() {
        val setting = ApprovalChangePreviewPolicy.sanitize("settings.update",
            """{"theme":"dark","api_key":"sk-secret-secret"}""")
        assertTrue(setting.summary.contains("theme"))
        assertFalse(setting.safeJson.contains("dark"))
        assertFalse(setting.safeJson.contains("sk-secret"))

        val multi = ApprovalChangePreviewPolicy.sanitize("workspace.batch", JSONObject().put("files", JSONArray()
            .put(JSONObject().put("path", "a.txt")).put(JSONObject().put("path", "b.txt"))).toString())
        assertEquals("2 files", multi.target)
        assertTrue(multi.summary.contains("a.txt"))
        assertTrue(multi.summary.contains("b.txt"))
    }

    @Test fun mcpPreviewPersistsOnlyServerToolAndArgumentNames() {
        val preview = ApprovalChangePreviewPolicy.sanitize("mcp.calendar.create", JSONObject()
            .put("server", "calendar").put("tool", "create_event")
            .put("arguments", JSONObject().put("title", "private meeting").put("authorization", "Bearer secret"))
            .toString())
        assertEquals("calendar", preview.target)
        assertTrue(preview.summary.contains("authorization"))
        assertFalse(preview.safeJson.contains("private meeting"))
        assertFalse(preview.safeJson.contains("Bearer"))
    }
}
