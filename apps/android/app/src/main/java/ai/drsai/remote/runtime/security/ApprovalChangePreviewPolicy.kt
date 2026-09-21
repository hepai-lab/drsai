package ai.drsai.remote.runtime.security

import org.json.JSONArray
import org.json.JSONObject

data class ApprovalChangePreview(
    val target: String,
    val summary: String,
    val receiptBinding: String? = null,
    val safeJson: String,
)

/** Converts tool-owned previews into bounded, credential-free data safe for Room and UI. */
object ApprovalChangePreviewPolicy {
    private const val MAX_SUMMARY = 1_200

    fun sanitize(toolId: String, rawPreview: String, strings: ApprovalPreviewStrings = EnglishApprovalPreviewStrings): ApprovalChangePreview {
        // Parse first, then project only allowlisted fields. Redacting a serialized JSON string can
        // invalidate quoting; raw values are never copied except through the bounded diff redactor.
        val json = runCatching { JSONObject(rawPreview) }.getOrNull()
        return when {
            toolId in setOf("workspace.write", "workspace.edit", "workspace.undo") && json != null -> workspace(json, strings)
            toolId.startsWith("mcp.") && json != null -> mcp(json, strings)
            json?.optJSONArray("files") != null -> multiFile(json, strings)
            else -> generic(toolId, json, strings)
        }
    }

    fun restore(toolId: String, safePreviewJson: String, strings: ApprovalPreviewStrings = EnglishApprovalPreviewStrings): ApprovalChangePreview =
        runCatching {
            val json = JSONObject(safePreviewJson)
            ApprovalChangePreview(
                target = json.optString("target", strings.text(ApprovalPreviewText.TASK_TARGET)),
                summary = json.optString("summary", strings.text(ApprovalPreviewText.APPROVED_OPERATION)),
                receiptBinding = json.optString("receipt_binding").ifBlank { null },
                safeJson = json.toString(),
            )
        }.getOrElse { sanitize(toolId, "{}", strings) }

    fun receiptMatches(preview: ApprovalChangePreview, receiptJson: String): Boolean {
        val binding = preview.receiptBinding ?: return true
        val receipt = runCatching { JSONObject(receiptJson) }.getOrNull() ?: return false
        return receipt.optString("mutation_token") == binding && receipt.optString("path") == preview.target
    }

    private fun workspace(json: JSONObject, strings: ApprovalPreviewStrings): ApprovalChangePreview {
        val path = json.optString("path", strings.text(ApprovalPreviewText.WORKSPACE_FILE)).take(240)
        val diff = SensitiveDataRedactor.redact(json.optString("diff"))
            .lineSequence().take(24).joinToString("\n").take(MAX_SUMMARY)
        val operation = json.optString("operation", if (json.optString("before_sha256") == "missing") "create" else "update")
        val summary = when (operation) {
            "create" -> strings.text(ApprovalPreviewText.CREATE_FILE, diff)
            "undo" -> strings.text(ApprovalPreviewText.UNDO_CHANGE, diff)
            else -> strings.text(ApprovalPreviewText.UPDATE_FILE, diff)
        }.trim().take(MAX_SUMMARY)
        val token = json.optString("mutation_token").takeIf { it.isNotBlank() }
        return encoded(path, summary, token)
    }

    private fun mcp(json: JSONObject, strings: ApprovalPreviewStrings): ApprovalChangePreview {
        val server = json.optString("server", strings.text(ApprovalPreviewText.CONNECTED_SERVICE)).take(120)
        val tool = json.optString("tool", strings.text(ApprovalPreviewText.SERVICE_OPERATION)).take(120)
        val keys = json.optJSONObject("arguments")?.keys()?.asSequence()?.toList()?.sorted().orEmpty()
        return encoded(server, strings.text(ApprovalPreviewText.MCP_CALL, tool, keys.joinToString().ifBlank { strings.text(ApprovalPreviewText.NONE) }), null)
    }

    private fun multiFile(json: JSONObject, strings: ApprovalPreviewStrings): ApprovalChangePreview {
        val files = json.optJSONArray("files") ?: JSONArray()
        val targets = (0 until minOf(files.length(), 20)).map { index ->
            when (val value = files.opt(index)) {
                is JSONObject -> value.optString("path", strings.text(ApprovalPreviewText.FILE, index + 1))
                else -> value?.toString().orEmpty()
            }.take(160)
        }
        return encoded(strings.text(ApprovalPreviewText.FILE_COUNT, files.length()), strings.text(ApprovalPreviewText.MODIFY_FILES, targets.joinToString(separator = ", ")).take(MAX_SUMMARY), null)
    }

    private fun generic(toolId: String, json: JSONObject?, strings: ApprovalPreviewStrings): ApprovalChangePreview {
        val keys = json?.keys()?.asSequence()?.toList()?.sorted().orEmpty()
        val summary = if (keys.isEmpty()) strings.text(ApprovalPreviewText.APPROVED_OPERATION) else strings.text(ApprovalPreviewText.FIELD_LIST, keys.joinToString())
        return encoded(
            strings.toolObject(toolId),
            summary,
            null,
        )
    }

    private fun encoded(target: String, summary: String, binding: String?): ApprovalChangePreview {
        val safe = JSONObject().put("target", target).put("summary", summary)
            .putOpt("receipt_binding", binding).toString()
        return ApprovalChangePreview(target, summary, binding, safe)
    }
}
