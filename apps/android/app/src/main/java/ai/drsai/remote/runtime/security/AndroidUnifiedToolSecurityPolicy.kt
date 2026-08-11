package ai.drsai.remote.runtime.security

import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.tools.ToolDefinition
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolRisk
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.net.InetAddress
import java.net.URI
import org.json.JSONObject

/** One pre-execution security boundary shared by file, web, browser, MCP and connector tools. */
object AndroidUnifiedToolSecurityPolicy {
    const val VERSION = "p9-android-tool-security-v1"

    fun validate(
        definition: ToolDefinition,
        context: ToolExecutionContext,
        arguments: JSONObject,
        allowPrivateNetworkForTests: Boolean = false,
    ) {
        require(context.accountSubject.matches(Regex("[^\\s]{1,200}"))) { "security_subject_invalid" }
        require(definition.risk != ToolRisk.FORBIDDEN) { "security_tool_forbidden" }
        if (definition.id.startsWith("workspace.")) {
            listOf("path", "relative_path").forEach { key ->
                arguments.optString(key).takeIf(String::isNotBlank)?.let {
                    require('\\' !in it && !it.startsWith('/') && "://" !in it) { "security_path_separator_denied" }
                    SafWorkspaceGateway.safeParts(it)
                }
            }
        }
        if (definition.id in setOf("web.fetch", "browser.navigate", "browser.download")) {
            validatePublicHttpsTarget(arguments.getString("url"), allowPrivateNetworkForTests)
        }
        if (definition.source == "mcp" || definition.id.startsWith("mcp.")) {
            require(RuntimeCapability.MCP in context.runtimeCapabilities) { "security_mcp_capability_required" }
            require(context.runId?.isNotBlank() == true && context.sessionId?.isNotBlank() == true) {
                "security_mcp_run_scope_required"
            }
        }
    }

    fun validateApprovedExecution(definition: ToolDefinition, context: ToolExecutionContext) {
        if (definition.risk in setOf(ToolRisk.EXTERNAL_WRITE, ToolRisk.SENSITIVE)) {
            require(context.approved) { "security_approval_required" }
        }
    }

    internal fun validatePublicHttpsTarget(raw: String, allowPrivateForTests: Boolean = false): URI {
        val uri = runCatching { URI(raw) }.getOrElse { throw IllegalArgumentException("security_url_invalid") }
        require((uri.scheme == "https" || (allowPrivateForTests && uri.scheme == "http")) &&
            uri.userInfo == null && !uri.host.isNullOrBlank()) {
            "security_https_authority_required"
        }
        require((allowPrivateForTests || uri.port in setOf(-1, 443)) && uri.fragment == null) { "security_url_component_denied" }
        val host = uri.host.lowercase()
        require(allowPrivateForTests || (host !in setOf("localhost", "localhost.localdomain") && !host.endsWith(".local"))) {
            "security_local_target_denied"
        }
        val literal = if (host.matches(Regex("[0-9.]+")) || ':' in host) {
            runCatching { InetAddress.getByName(host) }.getOrNull()
        } else null
        require(allowPrivateForTests || literal == null || (!literal.isAnyLocalAddress && !literal.isLoopbackAddress &&
            !literal.isLinkLocalAddress && !literal.isSiteLocalAddress && !literal.isMulticastAddress)) {
            "security_private_target_denied"
        }
        return uri
    }
}
