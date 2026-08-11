package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepFileChangeContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepReasoningContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.AndroidOaepFaultInjector
import ai.drsai.remote.runtime.oaep.AndroidOaepFaultPoint
import ai.drsai.remote.runtime.oaep.AndroidOaepProjector
import ai.drsai.remote.runtime.oaep.AndroidOaepRetentionPolicy
import ai.drsai.remote.runtime.oaep.AndroidOaepReplayResult
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.BackendItemId
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.OaepNormalizingChatEngine
import ai.drsai.remote.runtime.oaep.LocalOaepLegacyProjection
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepRuntimeSink
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import ai.drsai.remote.runtime.oaep.androidOaepSnapshotDigest
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.workbench.model.RuntimeAuthority
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import org.json.JSONObject
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOaepStoreTest {
    private lateinit var database: ChatDatabase
    private val owner = AndroidOaepOwner("alice", "ihep")
    private val scope = AndroidOaepScope(
        "workspace-1", "session-1", "run-1", "android-agent", "android-local", "Chat", 1,
    )

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(), ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() = database.close()

    @Test
    fun commit_reopen_resume_preserves_identity_revision_and_watermark() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val first = AndroidOaepWriter(scope, "2026-08-04T00:00:00Z")
        store.commit(owner, scope, first.apply("ipc:1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z"))
        store.commit(owner, scope, first.apply(
            "ipc:2", NormalizedAgentEvent.ItemDelta("python-message", "text", "hello"),
            "2026-08-04T00:00:02Z",
        ))

        val reopenedState = store.load(owner, scope) ?: error("OAEP state missing")
        assertEquals(5L, reopenedState.lastSequence)
        assertEquals("run-1:item:1", reopenedState.itemBindings
            .getValue(BackendItemId.of("python-message")).value)
        val reopened = AndroidOaepWriter(scope, reopenedState.session.createdAt, reopenedState)
        val duplicate = reopened.apply("ipc:2", NormalizedAgentEvent.ItemDelta("python-message", "text", "ignored"), "2026-08-04T00:00:03Z")
        assertTrue(duplicate.duplicate)
        store.commit(owner, scope, duplicate)

        store.commit(owner, scope, reopened.apply(
            "ipc:3", NormalizedAgentEvent.ItemCompleted(
                "python-message", "message", OaepMessageContent("assistant", "hello", "final"),
            ),
            "2026-08-04T00:00:04Z",
        ))
        store.commit(owner, scope, reopened.apply("ipc:4", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:05Z"))

        val final = store.load(owner, scope) ?: error("OAEP state missing")
        assertEquals(7L, final.lastSequence)
        assertEquals("run-1:item:1", final.itemBindings
            .getValue(BackendItemId.of("python-message")).value)
        assertEquals(3L, final.itemRevisions.getValue("run-1:item:1"))
        assertEquals("completed", final.snapshot().runs.single().status)
        assertEquals("hello", (final.snapshot().items.single().content as OaepMessageContent).text)
    }

    @Test
    fun stale_writer_conflict_rolls_back_event_and_projection_together() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val winner = AndroidOaepWriter(scope, "2026-08-04T00:00:00Z")
        val stale = AndroidOaepWriter(scope, "2026-08-04T00:00:00Z")
        store.commit(owner, scope, winner.apply("winner", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z"))
        val rejected = stale.apply("stale", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:02Z")
        assertTrue(runCatching { store.commit(owner, scope, rejected) }.isFailure)

        val persisted = store.load(owner, scope) ?: error("OAEP state missing")
        assertEquals(3L, persisted.lastSequence)
        assertEquals(setOf("winner", "winner:1", "winner:2"), persisted.events.map { it.dedupeKey }.toSet())
        assertEquals("2026-08-04T00:00:01Z", persisted.run.updatedAt)
    }

    @Test
    fun runtime_sink_projects_python_flow_and_restores_complete_oaep_state() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val sink = RoomAndroidOaepRuntimeSink(
            store = store,
            organization = { "ihep" },
            workspaceId = { "workspace-1" },
            clock = { "2026-08-04T01:00:00Z" },
        )
        val request = ChatRunRequest(
            accountSubject = "alice",
            authority = RuntimeAuthority.LOCAL_DEVICE,
            conversation = Conversation("session-1", "Chat"),
            input = "hello",
            attachments = listOf(
                attachment("image", "image/png", "diagram.png", "a-image"),
                attachment("audio", "audio/mpeg", "note.mp3", "a-audio"),
                attachment("document", "application/pdf", "report.pdf", "a-file"),
            ),
            runId = "run-1",
            userMessageId = "user-message",
            assistantMessageId = "assistant-message",
        )

        suspend fun deliver(sequence: Long, kind: String, configure: JSONObject.() -> Unit = {}) {
            val envelope = PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.RUNTIME_EVENT,
                requestId = "request-$sequence",
                runId = "run-1",
                sessionId = "session-1",
                sequence = sequence,
                idempotencyKey = "python-$sequence",
                payload = JSONObject().put("kind", kind).apply(configure),
            )
            sink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
        }

        deliver(1, "run.started")
        deliver(2, "message.delta") {
            put("item_id", "python-assistant")
            put("text", "world")
        }
        deliver(3, "message.completed") {
            put("item_id", "python-assistant")
            put("text", "world")
            put("phase", "commentary")
        }
        deliver(4, "run.completed")

        val restored = store.load(owner, scope) ?: error("OAEP runtime state missing")
        assertEquals("completed", restored.run.status)
        assertEquals(8L, restored.lastSequence)
        assertEquals(
            listOf(
                "event.session.created", "event.run.created", "event.item.completed", "event.run.started",
                "event.item.started", "event.item.delta", "event.item.completed", "event.run.completed",
            ),
            restored.events.map { it.type },
        )
        val messages = restored.snapshot().items.associateBy { (it.content as OaepMessageContent).role }
        assertEquals("hello", (messages.getValue("user").content as OaepMessageContent).text)
        assertEquals("world", (messages.getValue("assistant").content as OaepMessageContent).text)
        assertEquals("commentary", (messages.getValue("assistant").content as OaepMessageContent).phase)
        val user = messages.getValue("user").content as OaepMessageContent
        assertEquals(listOf("text", "image", "audio", "file"), user.parts.map { it["type"] })
        assertEquals(setOf("a-image", "a-audio", "a-file"), user.resourceRefs.map { it.resourceId }.toSet())
        assertEquals("a-image", ((user.parts[1]["resource_ref"] as Map<*, *>)["resource_id"]))
    }

    @Test
    fun runtime_sink_keeps_one_session_with_multiple_runs_and_monotonic_event_sequence() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val sink = RoomAndroidOaepRuntimeSink(
            store, organization = { "ihep" }, workspaceId = { "workspace-1" },
            clock = { "2026-08-04T01:30:00Z" },
        )
        suspend fun execute(runId: String, input: String, messageId: String) {
            val request = ChatRunRequest(
                "alice", RuntimeAuthority.LOCAL_DEVICE, Conversation("session-1", "Chat"), input,
                emptyList(), runId, messageId, "assistant-$runId",
            )
            listOf("run.started", "run.completed").forEachIndexed { index, kind ->
                val envelope = PythonRuntimeEnvelope(
                    PythonRuntimeMessageType.RUNTIME_EVENT, "$runId-request-$index", runId, "session-1",
                    index + 1L, "$runId-event-$index", JSONObject().put("kind", kind),
                )
                sink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
            }
        }

        execute("run-1", "first", "user-1")
        execute("run-2", "second", "user-2")

        val snapshot = store.snapshot(owner, "android-local", "workspace-1", "session-1")!!
        assertEquals(listOf("run-1", "run-2"), snapshot.runs.map { it.id })
        assertTrue(snapshot.runs.all { it.status == "completed" })
        assertEquals(setOf("first", "second"), snapshot.items.map { (it.content as OaepMessageContent).text }.toSet())
        val replay = store.replay(owner, "android-local", "workspace-1", "session-1", 0, 100)
            as AndroidOaepReplayResult.Page
        assertEquals((1L..9L).toList(), replay.value.data.map { it.sequence })
        assertEquals(2, replay.value.data.count { it.type == "event.run.created" })
        assertEquals(1, database.androidOaepDao().sessionCount(owner.subject, owner.organization, "android-local", "workspace-1"))
    }

    @Test
    fun local_ui_projection_derives_paused_and_recovering_state_from_oaep_journal() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val conversationEntity = ConversationEntity(
            "session-1", "alice", "Recovery", "local:opendrsai", modelId = "m", createdAt = 1, updatedAt = 2,
        )
        database.dao().saveConversation(conversationEntity)
        val sink = RoomAndroidOaepRuntimeSink(
            store, organization = { "ihep" }, workspaceId = { "local" },
            clock = { "2026-08-04T01:45:00Z" },
        )
        val request = ChatRunRequest(
            "alice", RuntimeAuthority.LOCAL_DEVICE, Conversation("session-1", "Recovery"), "resume",
            emptyList(), "run-1", "user-message", "assistant-message",
        )
        suspend fun deliver(sequence: Long, kind: String, payload: JSONObject = JSONObject()) {
            val envelope = PythonRuntimeEnvelope(
                PythonRuntimeMessageType.RUNTIME_EVENT, "recovery-$sequence", "run-1", "session-1",
                sequence, "recovery-key-$sequence", payload.put("kind", kind),
            )
            sink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
        }

        deliver(1, "run.started")
        deliver(2, "run.waiting", JSONObject().put("reason", "paused"))
        val paused = LocalOaepLegacyProjection(database).uiProjection("alice", "ihep", conversationEntity)!!
        assertEquals("waiting", paused.runStatus)
        assertEquals("paused", paused.waitingReason)
        assertEquals("任务已暂停，可继续", paused.runtimeStatus)
        assertTrue(!paused.recovering)

        deliver(3, "run.recovered", JSONObject().put("phase", "waiting_model"))
        val recovering = LocalOaepLegacyProjection(database).uiProjection("alice", "ihep", conversationEntity)!!
        assertEquals("running", recovering.runStatus)
        assertEquals("正在恢复…", recovering.runtimeStatus)
        assertTrue(recovering.recovering)
    }

    @Test
    fun lifecycle_actions_with_same_ids_remain_legal_and_account_isolated() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val sameScope = AndroidOaepScope("local", "shared-session", "shared-run", "android-agent", "android-local")
        suspend fun commit(owner: AndroidOaepOwner, writer: AndroidOaepWriter, key: String, event: NormalizedAgentEvent) {
            store.commit(owner, sameScope, writer.apply(key, event, "2026-08-04T03:00:00Z"))
        }
        val alice = AndroidOaepOwner("alice", "")
        val bob = AndroidOaepOwner("bob", "")
        val aliceWriter = AndroidOaepWriter(sameScope, "2026-08-04T03:00:00Z")
        val bobWriter = AndroidOaepWriter(sameScope, "2026-08-04T03:00:00Z")

        commit(alice, aliceWriter, "a-start", NormalizedAgentEvent.RunStarted)
        commit(alice, aliceWriter, "a-pause", NormalizedAgentEvent.RunWaiting("paused", null))
        commit(alice, aliceWriter, "a-resume", NormalizedAgentEvent.RunResumed)
        commit(alice, aliceWriter, "a-complete", NormalizedAgentEvent.RunCompleted)
        commit(bob, bobWriter, "b-start", NormalizedAgentEvent.RunStarted)
        commit(bob, bobWriter, "b-cancel", NormalizedAgentEvent.RunCancelled)

        val aliceSnapshot = store.snapshot(alice, "android-local", "local", "shared-session")!!
        val bobSnapshot = store.snapshot(bob, "android-local", "local", "shared-session")!!
        assertEquals("completed", aliceSnapshot.runs.single().status)
        assertEquals("cancelled", bobSnapshot.runs.single().status)
        assertEquals(6L, aliceSnapshot.snapshotSequence)
        assertEquals(4L, bobSnapshot.snapshotSequence)
        assertEquals(
            listOf("event.session.created", "event.run.created", "event.run.started", "event.run.waiting", "event.run.resumed", "event.run.completed"),
            (store.replay(alice, "android-local", "local", "shared-session", 0, 20) as AndroidOaepReplayResult.Page)
                .value.data.map { it.type },
        )
    }

    @Test
    fun kotlin_compatibility_engine_normalizes_stream_before_legacy_projection_reads_it() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val delegate = object : ChatEngine {
            override val authority = RuntimeAuthority.LOCAL_DEVICE
            override fun execute(request: ChatRunRequest) = flow {
                emit(ai.drsai.remote.data.RuntimeEvent.Started(request.runId))
                emit(ai.drsai.remote.data.RuntimeEvent.TextDelta("hello "))
                emit(ai.drsai.remote.data.RuntimeEvent.ToolStarted("clock"))
                emit(ai.drsai.remote.data.RuntimeEvent.ToolFinished("clock"))
                emit(ai.drsai.remote.data.RuntimeEvent.TextDelta("world"))
                emit(ai.drsai.remote.data.RuntimeEvent.Completed)
            }
            override fun pause(runId: String) = Unit
            override fun stop(runId: String) = Unit
        }
        val engine = OaepNormalizingChatEngine(
            delegate,
            RoomAndroidOaepRuntimeSink(store, clock = { "2026-08-04T01:45:00Z" }),
        )
        val request = ChatRunRequest(
            "alice", RuntimeAuthority.LOCAL_DEVICE, Conversation("compat-session", "Compat"), "question",
            emptyList(), "compat-run", "compat-user", "compat-assistant",
        )
        database.dao().saveConversation(ConversationEntity(
            "compat-session", "alice", "Compat", "local:opendrsai", modelId = "m", createdAt = 1, updatedAt = 2,
        ))
        assertEquals(6, engine.execute(request).toList().size)

        val snapshot = store.snapshot(AndroidOaepOwner("alice", ""), "android-local", "local", "compat-session")!!
        assertEquals("completed", snapshot.runs.single().status)
        assertEquals(setOf("message", "tool_call"), snapshot.items.map { it.type }.toSet())
        assertEquals("hello world", LocalOaepLegacyProjection(database).assistantText(
            "alice", "", RuntimeAuthority.LOCAL_DEVICE, "compat-session", "compat-assistant",
        ))
        val legacyShape = LocalOaepLegacyProjection(database).messages("alice", "", "compat-session")!!
        assertEquals(listOf("question", "hello world"), legacyShape.map { it.text })

        val platformDelegate = object : ChatEngine {
            override val authority = RuntimeAuthority.REMOTE_RUNTIME
            override fun execute(request: ChatRunRequest) = flow {
                emit(ai.drsai.remote.data.RuntimeEvent.Started(request.runId))
                emit(ai.drsai.remote.data.RuntimeEvent.TextDelta("platform text"))
                emit(ai.drsai.remote.data.RuntimeEvent.Completed)
            }
            override fun pause(runId: String) = Unit
            override fun stop(runId: String) = Unit
        }
        val platformRequest = ChatRunRequest(
            "alice", RuntimeAuthority.REMOTE_RUNTIME,
            Conversation("platform-session", "Platform", agentSource = "platform"), "remote question",
            emptyList(), "platform-run", "platform-user", "platform-assistant",
        )
        OaepNormalizingChatEngine(
            platformDelegate, RoomAndroidOaepRuntimeSink(store, clock = { "2026-08-04T01:46:00Z" }),
        ).execute(platformRequest).toList()
        val platformSnapshot = store.snapshot(
            AndroidOaepOwner("alice", ""), "hai-platform", "platform", "platform-session",
        )!!
        assertEquals("completed", platformSnapshot.runs.single().status)
        assertEquals("platform text", LocalOaepLegacyProjection(database).assistantText(
            "alice", "", RuntimeAuthority.REMOTE_RUNTIME, "platform-session", "platform-assistant",
        ))
    }

    @Test
    fun journal_pages_without_gaps_and_expired_cursor_returns_authoritative_snapshot() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val writer = AndroidOaepWriter(scope, "2026-08-04T00:00:00Z")
        val initialSession = writer.state.session
        store.commit(owner, scope, writer.apply("one", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z"))
        store.commit(owner, scope, writer.apply(
            "two", NormalizedAgentEvent.ItemCompleted(
                "message", "message", OaepMessageContent("assistant", "done", "final"),
            ),
            "2026-08-04T00:00:02Z",
        ))
        store.commit(owner, scope, writer.apply("three", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:03Z"))

        val first = (store.replay(owner, "android-local", "workspace-1", "session-1", 0, 2)
            as AndroidOaepReplayResult.Page).value
        assertEquals(listOf(1L, 2L), first.data.map { it.sequence })
        assertTrue(first.hasMore)
        val second = (store.replay(owner, "android-local", "workspace-1", "session-1", first.nextSequence, 3)
            as AndroidOaepReplayResult.Page).value
        assertEquals(listOf(3L, 4L, 5L), second.data.map { it.sequence })
        assertTrue(!second.hasMore)

        val live = writer.state.snapshot()
        val replayed = AndroidOaepProjector(initialSession).applyAll(first.data + second.data).snapshot()
        val cold = store.snapshot(owner, "android-local", "workspace-1", "session-1")
            ?: error("OAEP cold snapshot missing")
        assertEquals(androidOaepSnapshotDigest(live), androidOaepSnapshotDigest(replayed))
        assertEquals(androidOaepSnapshotDigest(live), androidOaepSnapshotDigest(cold))

        val expired = store.replay(owner, "android-local", "workspace-1", "session-1", 99, 2)
            as AndroidOaepReplayResult.CursorExpired
        assertEquals(5L, expired.snapshot.snapshotSequence)
        assertEquals("completed", expired.snapshot.runs.single().status)
        assertEquals("done", (expired.snapshot.items.single().content as OaepMessageContent).text)

        database.openHelper.writableDatabase.execSQL(
            "DELETE FROM android_oaep_events WHERE eventSequence = 3",
        )
        assertEquals(
            "oaep_room_event_sequence_gap",
            runCatching {
                store.replay(owner, "android-local", "workspace-1", "session-1", 2, 10)
            }.exceptionOrNull()?.message,
        )
    }

    @Test
    fun runtime_sink_persists_and_replays_complete_structured_item_set() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val conversationEntity = ConversationEntity(
            "session-1", "alice", "Structured", "local:opendrsai", modelId = "m", createdAt = 1, updatedAt = 2,
        )
        database.dao().saveConversation(conversationEntity)
        var sink = RoomAndroidOaepRuntimeSink(
            store, organization = { "ihep" }, workspaceId = { "local" },
            clock = { "2026-08-04T02:00:00Z" },
        )
        val request = ChatRunRequest(
            "alice", RuntimeAuthority.LOCAL_DEVICE, Conversation("session-1", "Structured"), "build",
            emptyList(), "run-1", "user-message", "assistant-message",
        )
        var sequence = 0L
        suspend fun deliver(kind: String, payload: JSONObject = JSONObject()) {
            sequence += 1
            val envelope = PythonRuntimeEnvelope(
                PythonRuntimeMessageType.RUNTIME_EVENT, "structured-$sequence", "run-1", "session-1",
                sequence, "structured-key-$sequence", payload.put("kind", kind),
            )
            sink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
        }

        deliver("run.started")
        deliver("reasoning.delta", JSONObject().put("item_id", "reasoning-1").put("text", "safe summary"))
        deliver("reasoning.completed", JSONObject().put("item_id", "reasoning-1").put("segments", JSONArray().put(
            JSONObject().put("id", "summary-1").put("text", "safe summary"),
        )))
        deliver("plan.completed", JSONObject().put("item_id", "plan-1").put("text", "Implement")
            .put("steps", JSONArray().put(JSONObject().put("id", "step-1").put("title", "Code").put("status", "completed"))))
        deliver("command.started", JSONObject().put("item_id", "command-1")
            .put("command", JSONArray(listOf("git", "status"))).put("display_command", "git status").put("cwd", "workspace"))
        deliver("command.delta", JSONObject().put("item_id", "command-1").put("stream", "stdout").put("text", "clean"))
        deliver("command.completed", JSONObject().put("item_id", "command-1")
            .put("command", JSONArray(listOf("git", "status"))).put("display_command", "git status")
            .put("cwd", "workspace").put("output", "clean").put("stdout_tail", "clean").put("exit_code", 0).put("duration_ms", 9))
        deliver("file_change.completed", JSONObject().put("item_id", "file-1").put("summary", "Updated")
            .put("changes", JSONArray().put(JSONObject().put("operation", "modify").put("path", "src/App.kt"))))
        deliver("tool.started", JSONObject().put("call_id", "tool-1").put("name", "clock")
            .put("tool_kind", "host").put("arguments", JSONObject().put("zone", "UTC")))
        // Simulate process/service reconstruction between intent and durable receipt.
        sink = RoomAndroidOaepRuntimeSink(
            store, organization = { "ihep" }, workspaceId = { "local" },
            clock = { "2026-08-04T02:00:00Z" },
        )
        deliver("tool.result", JSONObject().put("call_id", "tool-1").put("name", "clock")
            .put("tool_kind", "host").put("arguments", JSONObject().put("zone", "UTC"))
            .put("result", JSONObject().put("time", "12:00")).put("duration_ms", 3))
        deliver("artifact.created", JSONObject().put("item_id", "artifact-item-1")
            .put("artifact_id", "artifact-1").put("artifact_type", "file").put("name", "report.txt")
            .put("summary", "Report").put("path", "out/report.txt").put("mime_type", "text/plain")
            .put("size", 6).put("sha256", "b".repeat(64)))
        deliver("subagent.started", JSONObject().put("subagent_id", "child-1").put("title", "Review"))
        deliver("subagent.thinking", JSONObject().put("subagent_id", "child-1").put("text", "checking"))
        deliver("subagent.completed", JSONObject().put("subagent_id", "child-1")
            .put("title", "Review").put("summary", "done").put("result", JSONObject().put("valid", true)))
        deliver("runtime.degraded", JSONObject().put("reason", "low_memory").put("max_parallel_agents", 1))
        deliver("approval.requested", JSONObject().put("approval_id", "approval-1").put("prompt", "Continue?"))
        // Rebind after the waiting state to prove resumed continues the same Run/Interaction.
        sink = RoomAndroidOaepRuntimeSink(
            store, organization = { "ihep" }, workspaceId = { "local" },
            clock = { "2026-08-04T02:00:00Z" },
        )
        deliver("approval.decided", JSONObject().put("approval_id", "approval-1").put("decision", "approved"))
        deliver("approval.decided", JSONObject().put("approval_id", "approval-1").put("decision", "rejected"))
        deliver("run.completed")

        val snapshot = store.snapshot(owner, "android-local", "local", "session-1")
            ?: error("structured OAEP snapshot missing")
        assertEquals(
            setOf(
                "message", "reasoning", "plan", "command_execution", "file_change", "tool_call",
                "artifact", "subtask", "notice", "interaction",
            ),
            snapshot.items.map { it.type }.toSet(),
        )
        assertEquals("safe summary", (snapshot.items.single { it.type == "reasoning" }.content as OaepReasoningContent).segments.single()["text"])
        assertEquals("completed", (snapshot.items.single { it.type == "plan" }.content as OaepPlanContent).steps.single()["status"])
        assertEquals(0, (snapshot.items.single { it.type == "command_execution" }.content as OaepCommandExecutionContent).exitCode)
        assertEquals("src/App.kt", (snapshot.items.single { it.type == "file_change" }.content as OaepFileChangeContent).changes.single()["path"])
        val tool = snapshot.items.single { it.type == "tool_call" }.content as OaepToolCallContent
        assertEquals("UTC", tool.arguments["zone"])
        assertEquals("12:00", (tool.result as Map<*, *>)["time"])
        val interaction = snapshot.items.single { it.type == "interaction" }.content as ai.drsai.remote.remote.generated.OaepInteractionContent
        assertEquals("approved", interaction.response)
        val localUi = LocalOaepLegacyProjection(database).uiProjection("alice", "ihep", conversationEntity)!!
        assertEquals("completed", localUi.runStatus)
        assertEquals(10, localUi.entries.map { it.kind }.toSet().size)
        assertEquals(snapshot.snapshotSequence, localUi.snapshotSequence)
        assertEquals(snapshot.items.map { it.runId }, localUi.entries.map { it.runId })

        val replay = store.replay(owner, "android-local", "local", "session-1", 0, 100)
            as AndroidOaepReplayResult.Page
        val replayed = AndroidOaepProjector(snapshot.session.copy(updatedAt = snapshot.session.createdAt))
            .applyAll(replay.value.data).snapshot()
        assertEquals(androidOaepSnapshotDigest(snapshot), androidOaepSnapshotDigest(replayed))
        val approvalSequence = replay.value.data.filter {
            it.itemId == snapshot.items.single { item -> item.type == "interaction" }.id ||
                it.type in setOf("event.run.waiting", "event.run.resumed")
        }.map { it.type }
        assertEquals(
            listOf("event.item.created", "event.run.waiting", "event.item.completed", "event.run.resumed"),
            approvalSequence,
        )
    }

    @Test
    fun oaep_fault_windows_recover_without_duplicate_events_or_poisoned_writer_state() = runBlocking {
        listOf(AndroidOaepFaultPoint.STATE_APPLIED, AndroidOaepFaultPoint.TRANSACTION_COMMITTED)
            .forEachIndexed { index, faultPoint ->
                val sessionId = "fault-session-$index"
                val runId = "fault-run-$index"
                database.dao().saveConversation(ConversationEntity(
                    sessionId, "alice", "Fault window", "local:opendrsai", modelId = "m",
                    createdAt = 1, updatedAt = 2,
                ))
                val store = RoomAndroidOaepStore(database)
                var injected = false
                val sink = RoomAndroidOaepRuntimeSink(
                    store,
                    organization = { "ihep" },
                    workspaceId = { "local" },
                    clock = { "2026-08-05T14:00:00Z" },
                    faultInjector = AndroidOaepFaultInjector { point, dedupeKey ->
                        if (!injected && point == faultPoint && dedupeKey == "$runId:runtime-event") {
                            injected = true
                            error("simulated_process_death")
                        }
                    },
                )
                val request = ChatRunRequest(
                    "alice", RuntimeAuthority.LOCAL_DEVICE, Conversation(sessionId, "Fault window"), "write",
                    emptyList(), runId, "user-$index", "assistant-$index",
                )
                val envelope = PythonRuntimeEnvelope(
                    PythonRuntimeMessageType.RUNTIME_EVENT, "fault-request-$index", runId, sessionId, 1,
                    "$runId:runtime-event", JSONObject().put("kind", "run.started"),
                )
                val events = PythonRuntimeEventMapper.decodeAll(envelope)

                assertEquals("simulated_process_death", runCatching {
                    sink.accept(request, envelope, events)
                }.exceptionOrNull()?.message)
                sink.accept(request, envelope, events)

                val snapshot = store.snapshot(AndroidOaepOwner("alice", "ihep"), "android-local", "local", sessionId)
                    ?: error("fault window snapshot missing")
                assertEquals("running", snapshot.runs.single().status)
                assertEquals(4L, snapshot.snapshotSequence)
                val replay = store.replay(AndroidOaepOwner("alice", "ihep"), "android-local", "local", sessionId, 0, 20)
                    as AndroidOaepReplayResult.Page
                assertEquals(listOf(1L, 2L, 3L, 4L), replay.value.data.map { it.sequence })
                assertEquals(1, replay.value.data.count { it.dedupeKey.startsWith("$runId:runtime-event") })
            }
    }

    @Test
    fun compaction_protects_active_runs_and_expires_only_snapshot_covered_cursors() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val writer = AndroidOaepWriter(scope, "2026-08-04T03:00:00Z")
        store.commit(owner, scope, writer.apply("start", NormalizedAgentEvent.RunStarted, "2026-08-04T03:00:01Z"))
        store.commit(owner, scope, writer.apply(
            "message", NormalizedAgentEvent.ItemCompleted(
                "message-1", "message", OaepMessageContent("assistant", "retained", "final"),
            ),
            "2026-08-04T03:00:02Z",
        ))
        assertEquals(
            "oaep_compaction_active_run",
            runCatching {
                store.compact(owner, "android-local", "workspace-1", "session-1", AndroidOaepRetentionPolicy(2))
            }.exceptionOrNull()?.message,
        )
        store.commit(owner, scope, writer.apply("complete", NormalizedAgentEvent.RunCompleted, "2026-08-04T03:00:03Z"))
        val before = store.snapshot(owner, "android-local", "workspace-1", "session-1")
            ?: error("snapshot missing before compaction")

        val compacted = store.compact(
            owner, "android-local", "workspace-1", "session-1", AndroidOaepRetentionPolicy(2),
        )
        assertEquals(3, compacted.deletedEvents)
        assertEquals(3L, compacted.compactedThrough)
        assertEquals(5L, compacted.snapshotSequence)
        val after = store.snapshot(owner, "android-local", "workspace-1", "session-1")
            ?: error("snapshot missing after compaction")
        assertEquals(androidOaepSnapshotDigest(before), androidOaepSnapshotDigest(after))

        val expired = store.replay(owner, "android-local", "workspace-1", "session-1", 0, 100)
        assertTrue(expired is AndroidOaepReplayResult.CursorExpired)
        val tail = (store.replay(owner, "android-local", "workspace-1", "session-1", 3, 100)
            as AndroidOaepReplayResult.Page).value
        assertEquals(listOf(4L, 5L), tail.data.map { it.sequence })
    }

    @Test
    fun relay_enrollment_keeps_local_database_scope_and_uses_registered_source_for_new_events() = runBlocking {
        val store = RoomAndroidOaepStore(database)
        val oldScope = AndroidOaepScope(
            "workspace-1", "session-enroll", "run-old", "android-agent", "android-local",
            runSequence = 1,
        )
        val oldWriter = AndroidOaepWriter(oldScope, "2026-08-04T04:00:00Z")
        store.commit(owner, oldScope, oldWriter.apply(
            "old-start", NormalizedAgentEvent.RunStarted, "2026-08-04T04:00:01Z",
        ))
        val enrollmentWatermark = oldWriter.state.lastSequence

        val newScope = AndroidOaepScope(
            workspaceId = "workspace-1", sessionId = "session-enroll", runId = "run-new",
            backend = "android-agent", runtimeId = "android-local", runSequence = 2,
            sourceRuntimeId = "runtime-enrolled",
        )
        val restored = store.load(owner, newScope, "2026-08-04T04:00:02Z")
        val newWriter = AndroidOaepWriter(newScope, "2026-08-04T04:00:02Z", restored)
        store.commit(owner, newScope, newWriter.apply(
            "new-start", NormalizedAgentEvent.RunStarted, "2026-08-04T04:00:03Z",
        ))

        val snapshot = store.snapshot(
            owner, "android-local", "workspace-1", "session-enroll",
        ) ?: error("snapshot missing")
        assertEquals("android-local", snapshot.runs.single { it.id == "run-old" }.source?.runtimeId)
        assertEquals("runtime-enrolled", snapshot.runs.single { it.id == "run-new" }.source?.runtimeId)
        val newEvents = (store.replay(
            owner, "android-local", "workspace-1", "session-enroll", enrollmentWatermark, 100,
        ) as AndroidOaepReplayResult.Page).value.data
        assertTrue(newEvents.isNotEmpty())
        assertTrue(newEvents.all { it.source.runtimeId == "runtime-enrolled" })
    }

    private fun attachment(kind: String, mimeType: String, name: String, id: String) = MessageAttachment(
        id = id,
        messageId = "user-message",
        conversationId = "session-1",
        name = name,
        mimeType = mimeType,
        size = 10,
        kind = kind,
        sha256 = "a".repeat(64),
    )
}
