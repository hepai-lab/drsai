package ai.drsai.remote

import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepFileChangeContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepReasoningContent
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import org.json.JSONArray
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.*
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PythonRuntimeEventMapperTest {
    private fun event(kind: String, payload: JSONObject = JSONObject()) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.RUNTIME_EVENT,
        "request-$kind",
        "run-1",
        "session-1",
        1,
        "key-$kind",
        payload.put("kind", kind),
    )

    @Test
    fun `maps shared terminal text and tool events to existing UI contract`() {
        assertEquals(RuntimeEvent.Started("run-1"), PythonRuntimeEventMapper.map(event("run.started")))
        assertEquals(RuntimeEvent.TextDelta("hello"), PythonRuntimeEventMapper.map(event("message.delta", JSONObject().put("text", "hello"))))
        assertEquals(RuntimeEvent.ToolFinished("clock"), PythonRuntimeEventMapper.map(event("tool.result", JSONObject().put("name", "clock"))))
        assertEquals(RuntimeEvent.Completed, PythonRuntimeEventMapper.map(event("run.completed")))
        assertEquals(RuntimeEvent.Cancelled, PythonRuntimeEventMapper.map(event("run.cancelled")))
        assertEquals(
            RuntimeEvent.Failed("timeout", true),
            PythonRuntimeEventMapper.map(event("run.failed", JSONObject().put("code", "timeout").put("retryable", true))),
        )
    }

    @Test
    fun `run start exposes frozen capability categories as OAEP diagnostic notice`() {
        val diagnostic = JSONObject()
            .put("available", JSONArray().put("model.chat"))
            .put("remote_required", JSONArray().put("tool.shell"))
            .put("unsupported", JSONArray().put("tool.web.search"))
            .put("blocked", JSONArray().put(JSONObject()
                .put("id", "tool.workspace.write")
                .put("reason", "saf_write_permission_missing")))
        val normalized = PythonRuntimeEventMapper.decodeAll(event("run.started", JSONObject()
            .put("capability_snapshot_version", "p9-run-capabilities-v2")
            .put("capability_snapshot_sha256", "a".repeat(64))
            .put("capability_diagnostics", diagnostic)))
        assertEquals(2, normalized.size)
        val notice = (normalized[1] as NormalizedAgentEvent.ItemCompleted).content as OaepNoticeContent
        assertEquals("run_capability_snapshot", notice.code)
        assertEquals(listOf("tool.shell"), notice.details["remote_required"])
        assertEquals("p9-run-capabilities-v2", notice.details["snapshot_version"])
    }

    @Test
    fun `run start exposes redacted prompt layer sources and digests`() {
        val layers = JSONArray().put(JSONObject()
            .put("id", "system").put("source", "kernel").put("chars", 120).put("sha256", "a".repeat(64)))
        val normalized = PythonRuntimeEventMapper.decodeAll(event("run.started", JSONObject()
            .put("prompt_layers", layers)))
        assertEquals(2, normalized.size)
        val notice = (normalized[1] as NormalizedAgentEvent.ItemCompleted).content as OaepNoticeContent
        assertEquals("prompt_layer_snapshot", notice.code)
        val mapped = notice.details["layers"].toString()
        assertTrue(mapped.contains("system"))
        assertTrue(mapped.contains("a".repeat(64)))
        assertTrue(!mapped.contains("secret") && !mapped.contains("content"))
    }

    @Test
    fun `run start maps skill manifest to OAEP without instruction content`() {
        val secret = "do-not-export-skill-instructions"
        val skills = JSONArray().put(JSONObject()
            .put("id", "research")
            .put("version", 3)
            .put("source", "user_declarative")
            .put("availability", "local")
            .put("digest", "a".repeat(64))
            .put("instructions_sha256", "b".repeat(64))
            .put("instructions", secret)
            .put("allowed_tools", JSONArray().put("web.search").put("web.fetch"))
            .put("required_capabilities", JSONArray().put("web_search")))
        val normalized = PythonRuntimeEventMapper.decodeAll(event(
            "run.started", JSONObject().put("skill_snapshot", skills),
        ))
        val notice = normalized.mapNotNull { item ->
            (item as? NormalizedAgentEvent.ItemCompleted)?.content as? OaepNoticeContent
        }.single { it.code == "skill_manifest_snapshot" }
        assertEquals(1, notice.details["count"])
        assertTrue(notice.details.toString().contains("research"))
        assertTrue(notice.details.toString().contains("b".repeat(64)))
        assertTrue(!notice.details.toString().contains(secret))
    }

    @Test
    fun `run start exports allowlisted context diagnostics without prompt text or paths`() {
        val secret = "sk-secret-value"
        val diagnostic = JSONObject()
            .put("schema_version", 1)
            .put("layers", JSONArray().put(JSONObject()
                .put("id", "project")
                .put("source", "C:\\private\\AGENTS.md")
                .put("chars", 99)
                .put("estimated_tokens", 40)
                .put("sha256", "b".repeat(64))
                .put("status", "applied")
                .put("trim_reason", "none")
                .put("content", secret)))
            .put("context", JSONObject()
                .put("policy_version", "p9-context-budget-v1")
                .put("sha256", "c".repeat(64))
                .put("context_window_tokens", 32768)
                .put("reserved_output_tokens", 4096)
                .put("input_tokens", 28672)
                .put("estimated_input_tokens", 1200)
                .put("remaining_input_tokens", 27472)
                .put("raw_prompt", secret))
            .put("history_message_count", 500)
            .put("included_history_messages", 15)
            .put("omitted_history_messages", 485)
            .put("summary_applied", true)
            .put("trim_reason", "token_or_message_budget")
            .put("absolute_path", "C:\\private\\file")
        val normalized = PythonRuntimeEventMapper.decodeAll(event("run.started", JSONObject()
            .put("context_observability", diagnostic)))
        assertEquals(2, normalized.size)
        val notice = (normalized[1] as NormalizedAgentEvent.ItemCompleted).content as OaepNoticeContent
        assertEquals("context_observability_snapshot", notice.code)
        assertEquals(485, notice.details["omitted_history_messages"])
        assertEquals("token_or_message_budget", notice.details["trim_reason"])
        val exported = notice.details.toString()
        assertTrue(!exported.contains(secret) && !exported.contains("C:\\private"))
        assertTrue(exported.contains("b".repeat(64)) && exported.contains("estimated_tokens"))
    }

    @Test
    fun `tool decision maps only redacted category and reason to OAEP notice`() {
        val normalized = PythonRuntimeEventMapper.decode(event(
            "tool.decision",
            JSONObject()
                .put("policy_version", "p9-tool-decision-v1")
                .put("requirement_sha256", "a".repeat(64))
                .put("category", "required_tool_unavailable")
                .put("reason", "required_capability_not_available")
                .put("required_domain_count", 1)
                .put("available_domain_count", 0)
                .put("selected_tool_count", 0)
                .put("tool_round_count", 0),
        )) as NormalizedAgentEvent.ItemCompleted
        val notice = normalized.content as OaepNoticeContent
        assertEquals("tool_decision", notice.code)
        assertEquals("warning", notice.level)
        assertEquals("required_tool_unavailable", notice.details["category"])
        assertEquals("required_capability_not_available", notice.details["reason"])
        assertTrue(notice.details.values.none { it.toString().contains("prompt") || it.toString().contains("secret") })
    }

    @Test
    fun `memory selection maps provenance without memory content`() {
        val secret = "prefers-secret-answer-style"
        val selection = JSONObject()
            .put("policy_version", "p9-memory-selection-v1")
            .put("sha256", "a".repeat(64))
            .put("summary", secret)
            .put("selected", JSONArray().put(JSONObject()
                .put("id", "android-memory-7")
                .put("score", 2)
                .put("sha256", "b".repeat(64))
                .put("content", secret)))
            .put("omitted", JSONArray().put(JSONObject()
                .put("id", "android-memory-8")
                .put("reason", "irrelevant")
                .put("sha256", "c".repeat(64))))
        val normalized = PythonRuntimeEventMapper.decodeAll(event(
            "run.started", JSONObject().put("memory_selection", selection),
        ))
        val notice = normalized.mapNotNull { item ->
            (item as? NormalizedAgentEvent.ItemCompleted)?.content as? OaepNoticeContent
        }.single { it.code == "memory_selection_snapshot" }

        assertEquals("p9-memory-selection-v1", notice.details["policy_version"])
        assertTrue(notice.details.toString().contains("android-memory-7"))
        assertTrue(!notice.details.toString().contains(secret))
    }

    @Test
    fun `wrong verification tool decision is a warning`() {
        val normalized = PythonRuntimeEventMapper.decode(event(
            "tool.decision",
            JSONObject()
                .put("policy_version", "p9-tool-decision-v1")
                .put("requirement_sha256", "c".repeat(64))
                .put("category", "wrong_tool_selected")
                .put("reason", "selected_tool_does_not_satisfy_required_capability"),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals("warning", (normalized.content as OaepNoticeContent).level)
    }

    @Test
    fun `verification required and unavailable are warning notices without task text`() {
        listOf("verification.required", "verification.unavailable").forEach { kind ->
            val normalized = PythonRuntimeEventMapper.decode(event(
                kind,
                JSONObject()
                    .put("code", "required_capability_unavailable")
                    .put("reason", "required_capability_not_available")
                    .put("requirement_sha256", "b".repeat(64))
                    .put("retry_count", 1),
            )) as NormalizedAgentEvent.ItemCompleted
            val notice = normalized.content as OaepNoticeContent
            assertEquals(kind.replace('.', '_'), notice.code)
            assertEquals("warning", notice.level)
            assertEquals("b".repeat(64), notice.details["requirement_sha256"])
            assertTrue(notice.details.values.none { it.toString().contains("HEPiX") || it.toString().contains("prompt") })
        }
    }

    @Test
    fun `citation provenance maps only call ids and URL digests`() {
        listOf("citation.required", "citation.verified").forEach { kind ->
            val normalized = PythonRuntimeEventMapper.decode(event(
                kind,
                JSONObject()
                    .put("citation_sha256", "a".repeat(64))
                    .put("source_call_ids", JSONArray().put("search-1"))
                    .put("source_url_sha256", JSONArray().put("b".repeat(64)))
                    .put("cited_url_sha256", JSONArray().put("b".repeat(64)))
                    .put("missing", kind == "citation.required")
                    .put("fabricated_count", 0)
                    .put("source_url", "https://secret.example/path"),
            )) as NormalizedAgentEvent.ItemCompleted
            val notice = normalized.content as OaepNoticeContent
            assertEquals(kind.replace('.', '_'), notice.code)
            assertEquals(listOf("search-1"), notice.details["source_call_ids"])
            assertEquals(listOf("b".repeat(64)), notice.details["source_url_sha256"])
            assertFalse(notice.details.toString().contains("secret.example"))
        }
    }

    @Test
    fun `completed messages preserve commentary and final OAEP phases`() {
        listOf("commentary", "final").forEach { phase ->
            val normalized = PythonRuntimeEventMapper.decode(event(
                "message.completed",
                JSONObject().put("item_id", "message-$phase").put("text", phase).put("phase", phase),
            )) as NormalizedAgentEvent.ItemCompleted
            assertEquals(phase, (normalized.content as OaepMessageContent).phase)
        }
    }

    @Test
    fun `recovered runtime resumes the waiting OAEP run`() {
        val normalized = PythonRuntimeEventMapper.decodeAll(event(
            "run.recovered", JSONObject().put("phase", "waiting_model"),
        ))
        assertEquals(
            listOf(NormalizedAgentEvent.ItemCompleted::class, NormalizedAgentEvent.RunResumed::class),
            normalized.map { it::class },
        )
    }

    @Test
    fun `approval becomes normalized interaction while legacy projection stays silent`() {
        val envelope = event("approval.requested", JSONObject()
            .put("approval_id", "approval-1")
            .put("prompt", "Allow tool?"))
        val normalized = PythonRuntimeEventMapper.decode(envelope) as NormalizedAgentEvent.ItemCreated
        assertEquals("interaction", normalized.itemType)
        assertEquals("approval-1", (normalized.content as OaepInteractionContent).approvalId)
        assertNull(PythonRuntimeEventMapper.map(envelope))
        assertEquals(
            listOf(NormalizedAgentEvent.ItemCreated::class, NormalizedAgentEvent.RunWaiting::class),
            PythonRuntimeEventMapper.decodeAll(envelope).map { it::class },
        )
    }

    @Test
    fun `unknown runtime event becomes bounded OAEP notice instead of disappearing`() {
        val normalized = PythonRuntimeEventMapper.decode(event("future.private.event"))
            as NormalizedAgentEvent.ItemCompleted
        assertEquals("notice", normalized.itemType)
        val notice = normalized.content as OaepNoticeContent
        assertEquals("unknown_runtime_event", notice.code)
        assertEquals("future.private.event", notice.details["kind"])
    }

    @Test
    fun `uncertain side effect becomes waiting reconciliation interaction`() {
        val normalized = PythonRuntimeEventMapper.decodeAll(event(
            "side_effect.reconciliation_required",
            JSONObject().put("operation_id", "call-1").put("side_effect_kind", "tool"),
        ))
        assertEquals(listOf(
            NormalizedAgentEvent.ItemCreated::class, NormalizedAgentEvent.RunWaiting::class,
        ), normalized.map { it::class })
        val interaction = (normalized.first() as NormalizedAgentEvent.ItemCreated).content as OaepInteractionContent
        assertEquals("reconciliation", interaction.interactionType)
        assertEquals("needs_reconciliation", interaction.requestSummary["state"])
    }

    @Test
    fun `checkpoint remains internal host state rather than a public semantic event`() {
        assertNull(PythonRuntimeEventMapper.decode(event("checkpoint.saved")))
    }

    @Test
    fun `subagent lifecycle retains summary and result as structured subtask`() {
        val started = PythonRuntimeEventMapper.decode(event(
            "subagent.started", JSONObject().put("subagent_id", "child-1").put("title", "Inspect protocol"),
        )) as NormalizedAgentEvent.ItemStarted
        assertEquals("Inspect protocol", (started.content as OaepSubtaskContent).title)

        val delta = PythonRuntimeEventMapper.decode(event(
            "subagent.thinking", JSONObject().put("subagent_id", "child-1").put("text", "checking"),
        )) as NormalizedAgentEvent.ItemDelta
        assertEquals("summary", delta.kind)

        val completed = PythonRuntimeEventMapper.decode(event(
            "subagent.completed", JSONObject().put("subagent_id", "child-1")
                .put("summary", "done").put("result", "valid"),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals("valid", (completed.content as OaepSubtaskContent).result)

        val failed = PythonRuntimeEventMapper.decode(event(
            "subagent.failed", JSONObject().put("subagent_id", "child-1")
                .put("title", "Inspect protocol").put("summary", "Timed out")
                .put("code", "model_timeout").put("retryable", true)
                .put("parent_run_id", "run-1").put("child_run_id", "run-1:subagent:child-1")
                .put("agent_name", "drsai-agent-kernel"),
        )) as NormalizedAgentEvent.ItemFailed
        val failedContent = failed.content as OaepSubtaskContent
        assertEquals("model_timeout", failed.error.code)
        assertEquals("run-1:subagent:child-1", failedContent.childRunId)
        assertEquals("run-1", (failedContent.result as Map<*, *>)["parent_run_id"])
    }

    @Test
    fun `reasoning plan command file and tool payloads remain fully structured`() {
        val reasoning = PythonRuntimeEventMapper.decode(event(
            "reasoning.completed", JSONObject().put("segments", JSONArray().put(
                JSONObject().put("id", "summary-1").put("text", "Checked two constraints"),
            )),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals("Checked two constraints", (reasoning.content as OaepReasoningContent).segments.single()["text"])

        val plan = PythonRuntimeEventMapper.decode(event(
            "plan.completed", JSONObject().put("text", "Implement and test").put("steps", JSONArray().put(
                JSONObject().put("id", "step-1").put("title", "Implement").put("status", "completed"),
            )),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals("completed", (plan.content as OaepPlanContent).steps.single()["status"])

        val failedPlan = PythonRuntimeEventMapper.decode(event(
            "plan.failed", JSONObject().put("text", "Implement and test").put("steps", JSONArray().put(
                JSONObject().put("id", "step-1").put("title", "Implement").put("status", "failed"),
            )),
        )) as NormalizedAgentEvent.ItemFailed
        assertEquals("plan_step_failed", failedPlan.error.code)
        assertEquals("failed", (failedPlan.content as OaepPlanContent).steps.single()["status"])

        val command = PythonRuntimeEventMapper.decode(event(
            "command.completed", JSONObject().put("item_id", "command-1")
                .put("command", JSONArray(listOf("git", "status"))).put("display_command", "git status")
                .put("cwd", "workspace").put("output", "clean").put("exit_code", 0).put("duration_ms", 12),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals(0, (command.content as OaepCommandExecutionContent).exitCode)

        val file = PythonRuntimeEventMapper.decode(event(
            "file_change.completed", JSONObject().put("item_id", "change-1").put("summary", "Updated file")
                .put("changes", JSONArray().put(JSONObject().put("operation", "modify").put("path", "src/App.kt")
                    .put("diff_summary", "+1 -1"))),
        )) as NormalizedAgentEvent.ItemCompleted
        assertEquals("src/App.kt", (file.content as OaepFileChangeContent).changes.single()["path"])

        val tool = PythonRuntimeEventMapper.decode(event(
            "tool.result", JSONObject().put("name", "shell").put("call_id", "call-1")
                .put("tool_kind", "host").put("arguments", JSONObject().put("command", "pwd"))
                .put("result", JSONObject().put("stdout", "workspace")).put("duration_ms", 4),
        )) as NormalizedAgentEvent.ItemCompleted
        val toolContent = tool.content as OaepToolCallContent
        assertEquals("pwd", toolContent.arguments["command"])
        assertEquals(4.0, toolContent.durationMs)

        val toolError = PythonRuntimeEventMapper.decode(event(
            "tool.error", JSONObject().put("name", "clock").put("call_id", "call-2")
                .put("code", "http_503").put("retryable", true)
                .put("actionable", "The provider is temporarily unavailable; retry later."),
        )) as NormalizedAgentEvent.ItemFailed
        assertEquals("http_503", toolError.error.code)
        assertEquals(true, toolError.error.retryable)
        assertEquals("The provider is temporarily unavailable; retry later.", toolError.error.message)

        val artifact = PythonRuntimeEventMapper.decode(event(
            "artifact.created", JSONObject().put("item_id", "artifact-item")
                .put("artifact_id", "opaque-1").put("name", "output.txt")
                .put("mime_type", "text/plain").put("size", 42).put("sha256", "a".repeat(64))
                .put("previewable", true).put("downloadable", true),
        )) as NormalizedAgentEvent.ItemCompleted
        val artifactContent = artifact.content as OaepArtifactContent
        assertEquals(true, artifactContent.previewable)
        assertEquals(true, artifactContent.downloadable)
        assertEquals("a".repeat(64), artifactContent.sha256)
    }

    @Test
    fun `every frozen Python semantic kind has an explicit normalized mapping`() {
        val payloads = mapOf(
            "run.started" to JSONObject(),
            "run.recovered" to JSONObject(),
            "run.completed" to JSONObject(),
            "run.cancelled" to JSONObject(),
            "run.failed" to JSONObject().put("code", "failed"),
            "runtime.degraded" to JSONObject().put("reason", "low_memory"),
            "runtime.lifecycle_changed" to JSONObject().put("state", "background"),
            "message.delta" to JSONObject().put("text", "x"),
            "message.completed" to JSONObject().put("text", "x"),
            "reasoning.delta" to JSONObject().put("text", "summary"),
            "reasoning.completed" to JSONObject().put("text", "summary"),
            "plan.started" to JSONObject().put("steps", JSONArray()),
            "plan.updated" to JSONObject().put("steps", JSONArray()),
            "plan.completed" to JSONObject().put("steps", JSONArray()),
            "command.started" to JSONObject().put("item_id", "command-1"),
            "command.delta" to JSONObject().put("item_id", "command-1").put("text", "out"),
            "command.completed" to JSONObject().put("item_id", "command-1"),
            "command.error" to JSONObject().put("item_id", "command-1").put("code", "failed"),
            "file_change.completed" to JSONObject().put("item_id", "change-1").put("changes", JSONArray()),
            "tool.started" to JSONObject().put("name", "clock").put("call_id", "call-1"),
            "tool.result" to JSONObject().put("name", "clock").put("call_id", "call-1"),
            "tool.error" to JSONObject().put("name", "clock").put("call_id", "call-1"),
            "tool.downgraded" to JSONObject().put("reason", "unsupported"),
            "approval.requested" to JSONObject().put("approval_id", "approval-1"),
            "approval.decided" to JSONObject().put("approval_id", "approval-1").put("decision", "approved"),
            "side_effect.reconciliation_required" to JSONObject().put("operation_id", "call-1"),
            "artifact.created" to JSONObject().put("item_id", "artifact-item").put("artifact_id", "artifact-1").put("name", "Report"),
            "subagent.started" to JSONObject().put("subagent_id", "child-1"),
            "subagent.thinking" to JSONObject().put("subagent_id", "child-1").put("text", "x"),
            "subagent.completed" to JSONObject().put("subagent_id", "child-1"),
            "subagent.cancelled" to JSONObject().put("subagent_id", "child-1"),
            "subagent.failed" to JSONObject().put("subagent_id", "child-1").put("code", "timeout"),
            "run.waiting" to JSONObject().put("reason", "approval"),
            "run.resumed" to JSONObject(),
            "run.paused" to JSONObject(),
        )
        payloads.forEach { (kind, payload) ->
            val mapped = PythonRuntimeEventMapper.decodeAll(event(kind, payload))
            assertTrue("$kind must map", mapped.isNotEmpty())
            assertTrue("$kind must not use unknown fallback", mapped.none {
                val content = (it as? NormalizedAgentEvent.ItemCompleted)?.content as? OaepNoticeContent
                content?.code == "unknown_runtime_event"
            })
        }
    }

    @Test
    fun `unknown event diagnostics redact paths tokens payload and sensitive text`() {
        val secrets = listOf(
            "C:\\Users\\alice\\secret.txt",
            "/data/user/0/ai.drsai/token",
            "Bearer_eyJhbGciOiJIUzI1NiJ9",
            "user secret body with spaces",
            "x".repeat(256),
        )
        secrets.forEachIndexed { index, secret ->
            val payload = JSONObject()
                .put("token", "runtime-token-$index")
                .put("path", "/private/$index")
                .put("raw_payload", JSONObject().put("message", "sensitive-$index"))
            val envelope = event("unknown.$index", payload).copy(
                payload = payload.put("kind", secret),
            )
            val mapped = PythonRuntimeEventMapper.decode(envelope)
                as NormalizedAgentEvent.ItemCompleted
            val notice = mapped.content as OaepNoticeContent
            assertEquals(
                mapOf("category" to "unsupported_event", "kind" to "redacted"),
                notice.details,
            )
            val encoded = notice.toString()
            assertTrue(secret !in encoded)
            assertTrue("runtime-token" !in encoded && "/private/" !in encoded && "sensitive-" !in encoded)
        }
    }
}
