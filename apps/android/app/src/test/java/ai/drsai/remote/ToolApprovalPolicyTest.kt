package ai.drsai.remote

import ai.drsai.remote.runtime.security.ApprovalBinding
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.security.ApprovalRequestState
import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import ai.drsai.remote.runtime.tools.ToolDefinition
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.ToolRegistry
import ai.drsai.remote.runtime.tools.ToolRisk
import ai.drsai.remote.runtime.tools.ToolOutputArtifactSink
import ai.drsai.remote.runtime.tools.ToolAuditSink
import ai.drsai.remote.workbench.model.ApprovalStatus
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.WorkbenchId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolApprovalPolicyTest {
    @Test fun registryRejectsDuplicatesInvalidArgumentsAndMissingCapabilities() = runTest {
        val registry = ToolRegistry()
        val definition = ToolDefinition(
            "files.write", 1, "Write file", ToolRisk.EXTERNAL_WRITE,
            requiredArguments = setOf("path"), requiredCapabilities = setOf(RuntimeCapability.SAF_WRITE),
        )
        registry.register(definition) { _, _ -> "ok" }
        assertThrows(IllegalArgumentException::class.java) { registry.register(definition) { _, _ -> "again" } }
        val noCapability = ToolExecutionContext("alice", emptySet())
        assertTrue(registry.execute(noCapability, "files.write", "{}").let { it is ToolExecutionOutcome.Rejected })
        val capable = ToolExecutionContext("alice", setOf(RuntimeCapability.SAF_WRITE))
        assertTrue(registry.execute(capable, "files.write", "{}").let { it is ToolExecutionOutcome.Rejected })
        assertTrue(registry.execute(capable, "files.write", "{\"path\":\"a\"}").let { it is ToolExecutionOutcome.ApprovalRequired })
        assertEquals(
            ToolExecutionOutcome.Success("ok"),
            registry.execute(capable.copy(approved = true), "files.write", "{\"path\":\"a\"}"),
        )
    }

    @Test fun forbiddenToolsAreNeverVisibleOrExecutable() = runTest {
        val registry = ToolRegistry()
        registry.register(ToolDefinition("shell.execute", 1, "Shell", ToolRisk.FORBIDDEN)) { _, _ -> "bad" }
        val context = ToolExecutionContext("alice", RuntimeCapability.entries.toSet(), approved = true)
        assertTrue(registry.definitions(context).isEmpty())
        assertTrue(registry.execute(context, "shell.execute", "{}").let { it is ToolExecutionOutcome.Rejected })
    }

    @Test fun largeToolOutputIsPersistedAsAnArtifactAndModelReceivesABoundedSummary() = runTest {
        var persisted = ""
        val registry = ToolRegistry(maxOutputChars = 512, artifactSink = ToolOutputArtifactSink { context, definition, output ->
            assertEquals("run", context.runId)
            assertEquals("large.read", definition.id)
            persisted = output
            "artifact-1"
        })
        registry.register(ToolDefinition("large.read", 1, "Large output", ToolRisk.READ_ONLY)) { _, _ -> "x".repeat(5_000) }
        val result = registry.execute(
            ToolExecutionContext("alice", emptySet(), runId = "run", sessionId = "session", toolCallId = "call"),
            "large.read", "{}",
        ) as ToolExecutionOutcome.Success
        assertTrue(result.truncated)
        assertEquals("artifact-1", result.artifactId)
        assertEquals(5_000, persisted.length)
        assertTrue(result.output.length <= 512)
        assertTrue(result.output.contains("artifact-1"))
    }

    @Test fun approvalBindsCanonicalArgumentsAndIsSingleDecision() {
        val run = WorkbenchId("run")
        val binding = ApprovalBinding.create(run, "call", "files.write", "{\"b\":2,\"a\":1}", "once")
        val same = ApprovalBinding.create(run, "call", "files.write", "{\"a\":1,\"b\":2}", "once")
        assertEquals(binding, same)
        val request = ApprovalRequestState(WorkbenchId("approval"), binding, expiresAtMillis = 100)
        val approved = request.decide(same, ApprovalDecision.ALLOW_ONCE, 50)
        assertEquals(ApprovalStatus.APPROVED, approved.status)
        assertThrows(IllegalArgumentException::class.java) {
            approved.decide(same, ApprovalDecision.DECLINE, 60)
        }
        assertThrows(IllegalArgumentException::class.java) {
            request.decide(same.copy(toolCallId = "other"), ApprovalDecision.ALLOW_ONCE, 50)
        }
        assertEquals(ApprovalStatus.EXPIRED, request.expire(101).status)
    }

    @Test fun diagnosticRedactionRemovesCredentialsAndPrivateKeys() {
        val raw = "Bearer abc.def {\"access_token\":\"secret\",\"password\":\"pw\"} -----BEGIN PRIVATE KEY----- key -----END PRIVATE KEY-----"
        val redacted = SensitiveDataRedactor.redact(raw)
        assertFalse("secret" in redacted)
        assertFalse("abc.def" in redacted)
        assertFalse(" key " in redacted)
        assertTrue("[REDACTED]" in redacted)
    }

    @Test fun toolExecutionAppendsStartedTerminalAndRejectedAuditEvents() = runTest {
        val events = mutableListOf<String>()
        val audit = ToolAuditSink { _, toolId, action, outcome, _ -> events += "$toolId:$action:$outcome" }
        val registry = ToolRegistry(auditSink = audit)
        registry.register(ToolDefinition("safe.read", 1, "Read", ToolRisk.READ_ONLY)) { _, _ -> "ok" }
        registry.register(ToolDefinition("broken.read", 1, "Broken", ToolRisk.READ_ONLY)) { _, _ -> error("failed") }
        val context = ToolExecutionContext("alice", emptySet(), runId = "run", sessionId = "session", toolCallId = "call")

        assertEquals(ToolExecutionOutcome.Success("ok"), registry.execute(context, "safe.read", "{}"))
        assertTrue(registry.execute(context, "broken.read", "{}").let { it is ToolExecutionOutcome.Rejected })
        assertTrue(registry.execute(context, "missing.read", "{}").let { it is ToolExecutionOutcome.Rejected })
        assertEquals(
            listOf(
                "safe.read:started:RUNNING", "safe.read:completed:SUCCEEDED",
                "broken.read:started:RUNNING", "broken.read:failed:FAILED",
                "missing.read:rejected:REJECTED",
            ),
            events,
        )
    }
}
