package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PythonAgentLoopCoordinatorTest {
    @Test
    fun `normal completion releases bridge session lease`() = runTest {
        val bridge = ScriptedBridge()

        PythonAgentLoopCoordinator(bridge, fakePorts()).execute(start()).toList()

        assertEquals(listOf("session-1" to "run-1"), bridge.releasedRuns)
    }

    @Test
    fun `model request is driven through Kotlin port and events return in order`() = runTest {
        val bridge = ScriptedBridge()
        val coordinator = PythonAgentLoopCoordinator(bridge, fakePorts())

        val events = coordinator.execute(start()).toList()

        assertEquals(listOf("run.started", "message.delta", "run.completed"), events.map { it.payload.getString("kind") })
        assertEquals(
            listOf(PythonRuntimeMessageType.START_RUN, PythonRuntimeMessageType.MODEL_CHUNK, PythonRuntimeMessageType.MODEL_COMPLETED),
            bridge.commands.map(PythonRuntimeEnvelope::messageType),
        )
        assertEquals(listOf(0L, 1L, 2L), bridge.commands.map(PythonRuntimeEnvelope::sequence))
    }

    @Test
    fun `durable host receipt prevents tool side effect from executing twice after recovery`() = runTest {
        var executions = 0
        var sideEffectEvidence = 0
        val receipt = JSONObject()
            .put("call_id", "call-1")
            .put("succeeded", true)
            .put("content", JSONObject().put("time", "12:00"))
            .put("artifact_ids", JSONArray())
        val checkpoint = HostCheckpoint(
            "run-1",
            5,
            JSONObject().put("_host_tool_results", JSONObject().put("call-1", receipt)),
        )
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = Unit
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                val outbound = when (envelope.messageType) {
                    PythonRuntimeMessageType.START_RUN -> listOf(
                        PythonRuntimeEnvelope(
                            PythonRuntimeMessageType.TOOL_CALL_REQUEST,
                            "tool-request",
                            "run-1",
                            "session-1",
                            6,
                            "tool:call-1",
                            JSONObject().put("call_id", "call-1").put("name", "clock")
                                .put("arguments", JSONObject()),
                        )
                    )
                    PythonRuntimeMessageType.TOOL_RESULT -> emptyList()
                    else -> emptyList()
                }
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val base = fakePorts()
        val ports = base.copy(
            stateStore = store,
            tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    executions += 1
                    return HostToolResult(call.callId, true, JSONObject())
                }
            },
        )

        PythonAgentLoopCoordinator(bridge, ports, onSideEffectEvidence = { sideEffectEvidence += 1 })
            .execute(start()).toList()

        assertEquals(0, executions)
        assertEquals(1, sideEffectEvidence)
    }

    @Test
    fun `uncertain executing tool enters reconciliation without reexecution`() = runTest {
        var executions = 0
        var saved: HostCheckpoint? = null
        val intent = JSONObject().put("call_id", "call-1").put("name", "external.write")
            .put("idempotency_key", "tool:call-1").put("status", "executing")
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) { saved = checkpoint }
            override suspend fun loadCheckpoint(runId: String) = HostCheckpoint(
                runId, 5, JSONObject().put("_host_tool_intents", JSONObject().put("call-1", intent)),
            )
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope) = PythonRuntimeExecutionResult(
                MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready",
                if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.TOOL_CALL_REQUEST, "tool-request", "run-1", "session-1", 6,
                        "tool:call-1", JSONObject().put("call_id", "call-1").put("name", "external.write")
                            .put("arguments", JSONObject()),
                    )
                ) else emptyList(),
            )
        }
        val ports = fakePorts().copy(
            stateStore = store,
            tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    executions += 1
                    return HostToolResult(call.callId, true, JSONObject())
                }
            },
        )

        val error = try {
            PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()
            error("expected_reconciliation_failure")
        } catch (caught: IllegalStateException) {
            caught
        }
        assertEquals("python_tool_needs_reconciliation:call-1", error.message)
        assertEquals(0, executions)
        assertEquals("needs_reconciliation", saved!!.state.getJSONObject("_host_tool_intents")
            .getJSONObject("call-1").getString("status"))
    }

    @Test
    fun `tool execution emits queryable side effect audit phases in order`() = runTest {
        var checkpoint: HostCheckpoint? = null
        val phases = mutableListOf<String>()
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.TOOL_CALL_REQUEST, "tool-request", "run-1", "session-1", 1,
                        "tool:call-1", JSONObject().put("call_id", "call-1").put("name", "clock")
                            .put("arguments", JSONObject()),
                    )
                ) else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val ports = fakePorts().copy(
            stateStore = store,
            audit = object : PythonSideEffectAuditHostPort {
                override suspend fun append(record: HostSideEffectAudit) { phases += record.phase }
            },
        )

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(listOf("intent", "execution", "receipt"), phases)
    }

    @Test
    fun `read only transient tool failure retries once under runtime policy`() = runTest {
        var executions = 0
        val bridge = toolRequestBridge(
            JSONObject().put("call_id", "call-1").put("name", "clock")
                .put("arguments", JSONObject()).put("risk", "read_only")
                .put("retry_policy", JSONObject().put("max_attempts", 2)
                    .put("retryable_error_codes", JSONArray(listOf("http_503")))),
        )
        val ports = fakePorts().copy(tools = object : PythonToolHostPort {
            override suspend fun execute(call: HostToolCall): HostToolResult {
                executions += 1
                return if (executions == 1) HostToolResult(call.callId, false, JSONObject(), "http_503")
                else HostToolResult(call.callId, true, JSONObject().put("time", "12:00"))
            }
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(2, executions)
        assertEquals(true, bridge.commands.last().payload.getBoolean("succeeded"))
    }

    @Test
    fun `authorization failure and side effect are never automatically retried`() = runTest {
        for ((risk, code) in listOf("read_only" to "http_401", "external_write" to "http_503")) {
            var executions = 0
            val bridge = toolRequestBridge(
                JSONObject().put("call_id", "call-1").put("name", "tool")
                    .put("arguments", JSONObject()).put("risk", risk)
                    .put("retry_policy", JSONObject().put("max_attempts", 1)
                        .put("retryable_error_codes", JSONArray())),
            )
            val ports = fakePorts().copy(tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    executions += 1
                    return HostToolResult(call.callId, false, JSONObject(), code)
                }
            })

            PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

            assertEquals(1, executions)
            assertEquals(code, bridge.commands.last().payload.getString("error_code"))
        }
    }

    @Test
    fun `host rejects a retry policy that attempts to replay side effects`() = runTest {
        var executions = 0
        val bridge = toolRequestBridge(
            JSONObject().put("call_id", "call-1").put("name", "external.write")
                .put("arguments", JSONObject()).put("risk", "external_write")
                .put("retry_policy", JSONObject().put("max_attempts", 2)
                    .put("retryable_error_codes", JSONArray(listOf("http_503")))),
        )
        val ports = fakePorts().copy(tools = object : PythonToolHostPort {
            override suspend fun execute(call: HostToolCall): HostToolResult {
                executions += 1
                return HostToolResult(call.callId, false, JSONObject(), "http_503")
            }
        })

        val error = try {
            PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()
            error("expected_side_effect_retry_rejection")
        } catch (caught: IllegalArgumentException) {
            caught
        }

        assertEquals("tool_side_effect_retry_forbidden", error.message)
        assertEquals(0, executions)
    }

    @Test
    fun `host rejects runtime risk that disagrees with Kotlin tool registry`() = runTest {
        var executions = 0
        val bridge = toolRequestBridge(
            JSONObject().put("call_id", "call-1").put("name", "external.write")
                .put("arguments", JSONObject()).put("risk", "read_only")
                .put("retry_policy", JSONObject().put("max_attempts", 2)
                    .put("retryable_error_codes", JSONArray(listOf("http_503")))),
        )
        val ports = fakePorts().copy(tools = object : PythonToolHostPort {
            override fun authoritativeRisk(toolName: String) = "external_write"
            override suspend fun execute(call: HostToolCall): HostToolResult {
                executions += 1
                return HostToolResult(call.callId, false, JSONObject(), "http_503")
            }
        })

        val error = try {
            PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()
            error("expected_registry_drift_rejection")
        } catch (caught: IllegalArgumentException) {
            caught
        }

        assertEquals("tool_risk_registry_drift", error.message)
        assertEquals(0, executions)
    }

    @Test
    fun `tool artifact descriptor is forwarded without path or binary bytes`() = runTest {
        val bridge = toolRequestBridge(
            JSONObject().put("call_id", "call-1").put("name", "export")
                .put("arguments", JSONObject()).put("risk", "read_only")
                .put("retry_policy", JSONObject().put("max_attempts", 1)
                    .put("retryable_error_codes", JSONArray())),
        )
        val base = fakePorts()
        val ports = base.copy(
            tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall) = HostToolResult(
                    call.callId, true, JSONObject().put("binary", true), artifactIds = listOf("opaque-1"),
                )
            },
            artifacts = object : PythonArtifactHostPort {
                override suspend fun describe(artifactId: String) = HostArtifactDescriptor(
                    artifactId, "application/octet-stream", 42, "a".repeat(64),
                )
                override suspend fun readChunk(artifactId: String, offset: Long, length: Int) =
                    error("binary bytes must not be loaded into the tool result")
            },
        )

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        val payload = bridge.commands.last().payload
        val artifact = payload.getJSONArray("artifacts").getJSONObject(0)
        assertEquals("opaque-1", artifact.getString("artifact_id"))
        assertEquals("application/octet-stream", artifact.getString("mime_type"))
        assertEquals(42L, artifact.getLong("size"))
        assertEquals(false, payload.toString().contains("path"))
        assertEquals(false, payload.toString().contains("data_base64"))
    }

    @Test
    fun `durable approval is forwarded to recovered tool execution`() = runTest {
        var approved = false
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = Unit
            override suspend fun loadCheckpoint(runId: String) = HostCheckpoint(
                runId, 4, JSONObject().put("_host_approved_calls", JSONObject().put("call-1", true)),
            )
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.TOOL_CALL_REQUEST, "tool-request", "run-1", "session-1", 5,
                        "tool:call-1", JSONObject().put("call_id", "call-1").put("name", "write")
                            .put("arguments", JSONObject()),
                    )
                ) else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val ports = fakePorts().copy(
            stateStore = store,
            tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    approved = call.approved
                    return HostToolResult(call.callId, true, JSONObject())
                }
            },
        )

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(true, approved)
    }

    @Test
    fun `kernel checkpoint after approval cannot erase durable host approval`() = runTest {
        var checkpoint: HostCheckpoint? = null
        var executedWithApproval = false
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                fun out(sequence: Long, type: PythonRuntimeMessageType, payload: JSONObject) = PythonRuntimeEnvelope(
                    type, "out-$sequence", "run-1", "session-1", sequence, "out-$sequence", payload,
                )
                val outbound = when (envelope.messageType) {
                    PythonRuntimeMessageType.START_RUN -> listOf(
                        out(1, PythonRuntimeMessageType.CHECKPOINT_REQUEST,
                            JSONObject().put("state", JSONObject().put("phase", "waiting_approval"))),
                        out(2, PythonRuntimeMessageType.APPROVAL_REQUEST, JSONObject()
                            .put("approval_id", "approval:edit-1").put("call_id", "edit-1")
                            .put("risk", "external_write").put("title", "Edit")
                            .put("summary", "diff").put("name", "workspace.edit")
                            .put("arguments", JSONObject().put("path", "config/app.properties"))),
                    )
                    PythonRuntimeMessageType.APPROVAL_RESULT -> listOf(
                        out(3, PythonRuntimeMessageType.CHECKPOINT_REQUEST,
                            JSONObject().put("state", JSONObject().put("phase", "executing_tool"))),
                        out(4, PythonRuntimeMessageType.TOOL_CALL_REQUEST, JSONObject()
                            .put("call_id", "edit-1").put("name", "workspace.edit")
                            .put("arguments", JSONObject().put("path", "config/app.properties"))
                            .put("risk", "external_write").put("retry_policy", JSONObject()
                                .put("max_attempts", 1).put("retryable_error_codes", JSONArray()))),
                    )
                    PythonRuntimeMessageType.TOOL_RESULT -> listOf(
                        out(5, PythonRuntimeMessageType.RUNTIME_EVENT, JSONObject().put("kind", "run.completed")),
                    )
                    else -> emptyList()
                }
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val ports = fakePorts().copy(
            stateStore = store,
            tools = object : PythonToolHostPort {
                override fun authoritativeRisk(toolName: String) = "external_write"
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    executedWithApproval = call.approved
                    return HostToolResult(call.callId, true, JSONObject())
                }
            },
        )

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(true, executedWithApproval)
        assertEquals("executing_tool", checkpoint!!.state.getString("phase"))
        assertEquals(true, checkpoint!!.state.getJSONObject("_host_approved_calls").getBoolean("edit-1"))
    }

    @Test
    fun `artifact requests use bounded host chunks without exposing paths`() = runTest {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                commands += envelope
                val outbound = when {
                    envelope.messageType == PythonRuntimeMessageType.START_RUN -> listOf(
                        PythonRuntimeEnvelope(
                            PythonRuntimeMessageType.ARTIFACT_REQUEST, "describe", "run-1", "session-1", 1,
                            "describe-1", JSONObject().put("artifact_id", "opaque-1").put("operation", "describe"),
                        )
                    )
                    envelope.messageType == PythonRuntimeMessageType.ARTIFACT_RESULT &&
                        envelope.payload.getString("operation") == "describe" -> listOf(
                        PythonRuntimeEnvelope(
                            PythonRuntimeMessageType.ARTIFACT_REQUEST, "read", "run-1", "session-1", 2,
                            "read-1", JSONObject().put("artifact_id", "opaque-1").put("operation", "read")
                                .put("offset", 0).put("length", 5),
                        )
                    )
                    else -> emptyList()
                }
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val ports = fakePorts().copy(artifacts = object : PythonArtifactHostPort {
            override suspend fun describe(artifactId: String) =
                HostArtifactDescriptor(artifactId, "text/plain", 5, "0".repeat(64))
            override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = "hello".encodeToByteArray()
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(
            listOf(PythonRuntimeMessageType.START_RUN, PythonRuntimeMessageType.ARTIFACT_RESULT, PythonRuntimeMessageType.ARTIFACT_RESULT),
            commands.map { it.messageType },
        )
        assertEquals("aGVsbG8=", commands.last().payload.getString("data_base64"))
        assertEquals(false, commands.last().payload.toString().contains("path"))
    }

    @Test
    fun `durable artifact operation receipt prevents duplicate external mutation`() = runTest {
        var mutations = 0
        val receipt = JSONObject().put("operation_id", "op-1").put("artifact_id", "artifact-1")
            .put("succeeded", true).put("details", JSONObject())
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = Unit
            override suspend fun loadCheckpoint(runId: String) = HostCheckpoint(
                runId, 2, JSONObject().put("_host_artifact_results", JSONObject().put("op-1", receipt)),
            )
        }
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                val outbound = when (envelope.messageType) {
                    PythonRuntimeMessageType.START_RUN -> listOf(PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.ARTIFACT_REQUEST, "artifact-create", "run-1", "session-1", 3,
                        "artifact:create:op-1", JSONObject().put("operation", "create")
                            .put("operation_id", "op-1").put("mime_type", "text/plain"),
                    ))
                    PythonRuntimeMessageType.ARTIFACT_RESULT -> listOf(PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.RUNTIME_EVENT, "artifact-created", "run-1", "session-1", 4,
                        "artifact:created:op-1", JSONObject().put("kind", "artifact.created")
                            .put("item_id", "artifact:artifact-1").put("artifact_id", "artifact-1")
                            .put("artifact_type", "file").put("name", "artifact-1").put("summary", "Created"),
                    ))
                    else -> emptyList()
                }
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val base = fakePorts()
        val artifacts = object : PythonArtifactHostPort {
            override suspend fun describe(artifactId: String) = base.artifacts.describe(artifactId)
            override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = ByteArray(0)
            override suspend fun mutate(request: HostArtifactMutation): HostArtifactMutationResult {
                mutations += 1
                return HostArtifactMutationResult(request.operationId, "artifact-1", true)
            }
        }

        val events = PythonAgentLoopCoordinator(
            bridge, base.copy(stateStore = store, artifacts = artifacts),
        ).execute(start()).toList()

        assertEquals(0, mutations)
        assertEquals(listOf("artifact.created"), events.map { it.payload.getString("kind") })
        val normalized = PythonRuntimeEventMapper.decode(events.single()) as NormalizedAgentEvent.ItemCompleted
        assertEquals("artifact", normalized.itemType)
        assertEquals("artifact-1", (normalized.content as ai.drsai.remote.remote.generated.OaepArtifactContent).artifactId)
    }

    @Test
    fun `foreground host runs two logical subagent model requests concurrently`() = runTest {
        var active = 0
        var peak = 0
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf("a", "b").mapIndexed { index, id ->
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.MODEL_REQUEST, "child-$id", "run-1", "session-1", (index + 1).toLong(),
                        "child-key-$id", JSONObject().put("model_id", "model-1").put("messages", JSONArray())
                            .put("tools", JSONArray()).put("subagent_id", id),
                    )
                } else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val ports = fakePorts().copy(model = object : PythonModelHostPort {
            override fun stream(request: HostModelRequest): Flow<HostModelChunk> = flow {
                active += 1
                peak = maxOf(peak, active)
                delay(20)
                emit(HostModelChunk(request.requestId, "done", "stop"))
                active -= 1
            }
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        assertEquals(2, peak)
    }

    @Test
    fun `background low memory and thermal hosts serialize subagent model requests`() = runTest {
        listOf(
            PythonRuntimeLifecycleState.BACKGROUND,
            PythonRuntimeLifecycleState.LOW_MEMORY,
            PythonRuntimeLifecycleState.THERMAL_LIMITED,
        ).forEach { constrainedState ->
            var active = 0
            var peak = 0
            val commands = mutableListOf<PythonRuntimeEnvelope>()
            val bridge = object : PythonRuntimeBridge {
                override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                    commands += envelope
                    val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf("a", "b").mapIndexed { index, id ->
                        PythonRuntimeEnvelope(
                            PythonRuntimeMessageType.MODEL_REQUEST, "child-$id", "run-1", "session-1", (index + 1).toLong(),
                            "child-key-$id", JSONObject().put("model_id", "model-1").put("messages", JSONArray())
                                .put("tools", JSONArray()).put("subagent_id", id),
                        )
                    } else emptyList()
                    return PythonRuntimeExecutionResult(
                        MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                    )
                }
            }
            val base = fakePorts()
            val ports = base.copy(
                model = object : PythonModelHostPort {
                    override fun stream(request: HostModelRequest): Flow<HostModelChunk> = flow {
                        active += 1
                        peak = maxOf(peak, active)
                        delay(10)
                        emit(HostModelChunk(request.requestId, "done", "stop"))
                        active -= 1
                    }
                },
                lifecycle = object : PythonLifecycleHostPort {
                    override suspend fun current() = constrainedState
                },
            )

            PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

            assertEquals("$constrainedState must serialize", 1, peak)
            val started = commands.first().payload
            assertEquals(3, started.getInt("subagent_max_active"))
            assertEquals(1, started.getInt("subagent_max_parallel"))
        }
    }

    @Test
    fun `foreground degradation is reported before remaining subagents run serially`() = runTest {
        var lifecycleReads = 0
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                commands += envelope
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf("a", "b").mapIndexed { index, id ->
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.MODEL_REQUEST, "child-$id", "run-1", "session-1", (index + 1).toLong(),
                        "child-key-$id", JSONObject().put("model_id", "model-1").put("messages", JSONArray())
                            .put("tools", JSONArray()).put("subagent_id", id),
                    )
                } else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val base = fakePorts()
        val ports = base.copy(lifecycle = object : PythonLifecycleHostPort {
            override suspend fun current(): PythonRuntimeLifecycleState =
                if (lifecycleReads++ == 0) PythonRuntimeLifecycleState.FOREGROUND else PythonRuntimeLifecycleState.LOW_MEMORY
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        val lifecycle = commands.single { it.messageType == PythonRuntimeMessageType.LIFECYCLE_CHANGED }
        assertEquals("low_memory", lifecycle.payload.getString("state"))
    }

    @Test
    fun `subagent timeout becomes a scoped model failure instead of aborting the host loop`() = runTest {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                commands += envelope
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.MODEL_REQUEST, "child-a", "run-1", "session-1", 1,
                        "child-key-a", JSONObject().put("model_id", "model-1").put("messages", JSONArray())
                            .put("tools", JSONArray()).put("subagent_id", "a"),
                    ),
                ) else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val base = fakePorts()
        val ports = base.copy(model = object : PythonModelHostPort {
            override fun stream(request: HostModelRequest): Flow<HostModelChunk> = flow {
                throw java.net.SocketTimeoutException("timeout")
            }
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        val failed = commands.single { it.messageType == PythonRuntimeMessageType.MODEL_FAILED }
        assertEquals("a", failed.payload.getString("subagent_id"))
        assertEquals("model_timeout", failed.payload.getString("code"))
        assertEquals(true, failed.payload.getBoolean("retryable"))
        assertEquals("timeout", failed.payload.getString("message"))
    }

    @Test
    fun `model api failure preserves redacted provider body and stable code`() = runTest {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        val bridge = object : PythonRuntimeBridge {
            override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
                commands += envelope
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.MODEL_REQUEST, "model-request", "run-1", "session-1", 1,
                        "model-key", JSONObject().put("model_id", "model-1").put("messages", JSONArray()),
                    ),
                ) else emptyList()
                return PythonRuntimeExecutionResult(
                    MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
                )
            }
        }
        val base = fakePorts()
        val ports = base.copy(model = object : PythonModelHostPort {
            override fun stream(request: HostModelRequest): Flow<HostModelChunk> = flow {
                throw ai.drsai.remote.data.ApiException(
                    400, "provider rejected api_key=secret-value", retryable = false, code = "invalid_request",
                )
            }
        })

        PythonAgentLoopCoordinator(bridge, ports).execute(start()).toList()

        val failed = commands.single { it.messageType == PythonRuntimeMessageType.MODEL_FAILED }
        assertEquals("invalid_request", failed.payload.getString("code"))
        assertEquals(false, failed.payload.getBoolean("retryable"))
        assertTrue(failed.payload.getString("message").contains("api_key=[REDACTED]"))
        assertFalse(failed.payload.getString("message").contains("secret-value"))
    }

    @Test
    fun `process death after prepared intent resumes and executes side effect once`() = runTest {
        var checkpoint: HostCheckpoint? = null
        var executions = 0
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) {
                checkpoint = HostCheckpoint(value.runId, value.sequence, JSONObject(value.state.toString()))
            }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val base = fakePorts()
        val ports = base.copy(
            stateStore = store,
            tools = object : PythonToolHostPort {
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    executions += 1
                    return HostToolResult(call.callId, true, JSONObject().put("written", true))
                }
            },
        )
        val bridge = toolRequestBridge(JSONObject().put("call_id", "write-1").put("name", "external.write")
            .put("risk", "external_write").put("arguments", JSONObject()))

        runCatching {
            PythonAgentLoopCoordinator(bridge, ports, faultInjector = PythonSideEffectFaultInjector { point, _ ->
                if (point == PythonSideEffectFaultPoint.TOOL_INTENT_PERSISTED) error("simulated_process_death")
            }).execute(start()).toList()
        }
        assertEquals(0, executions)
        assertEquals("prepared", checkpoint!!.state.getJSONObject("_host_tool_intents")
            .getJSONObject("write-1").getString("status"))

        PythonAgentLoopCoordinator(toolRequestBridge(JSONObject().put("call_id", "write-1")
            .put("name", "external.write").put("risk", "external_write").put("arguments", JSONObject())), ports)
            .execute(start()).toList()

        assertEquals(1, executions)
        assertEquals("receipt_persisted", checkpoint!!.state.getJSONObject("_host_tool_intents")
            .getJSONObject("write-1").getString("status"))
    }

    @Test
    fun `process death after handler return reconciles without duplicate side effect`() = runTest {
        var checkpoint: HostCheckpoint? = null
        var executions = 0
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) {
                checkpoint = HostCheckpoint(value.runId, value.sequence, JSONObject(value.state.toString()))
            }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val base = fakePorts()
        val ports = base.copy(stateStore = store, tools = object : PythonToolHostPort {
            override suspend fun execute(call: HostToolCall): HostToolResult {
                executions += 1
                return HostToolResult(call.callId, true, JSONObject())
            }
        })
        fun bridge() = toolRequestBridge(JSONObject().put("call_id", "write-1").put("name", "external.write")
            .put("risk", "external_write").put("arguments", JSONObject()))

        runCatching {
            PythonAgentLoopCoordinator(bridge(), ports, faultInjector = PythonSideEffectFaultInjector { point, _ ->
                if (point == PythonSideEffectFaultPoint.TOOL_HANDLER_RETURNED) error("simulated_process_death")
            }).execute(start()).toList()
        }
        val recovered = runCatching { PythonAgentLoopCoordinator(bridge(), ports).execute(start()).toList() }

        assertEquals(1, executions)
        assertEquals("python_tool_needs_reconciliation:write-1", recovered.exceptionOrNull()?.message)
        assertEquals("needs_reconciliation", checkpoint!!.state.getJSONObject("_host_tool_intents")
            .getJSONObject("write-1").getString("status"))
    }

    @Test
    fun `process death after durable receipt replays without duplicate side effect`() = runTest {
        var checkpoint: HostCheckpoint? = null
        var executions = 0
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) {
                checkpoint = HostCheckpoint(value.runId, value.sequence, JSONObject(value.state.toString()))
            }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val base = fakePorts()
        val ports = base.copy(stateStore = store, tools = object : PythonToolHostPort {
            override suspend fun execute(call: HostToolCall): HostToolResult {
                executions += 1
                return HostToolResult(call.callId, true, JSONObject().put("written", true))
            }
        })
        fun bridge() = toolRequestBridge(JSONObject().put("call_id", "write-1").put("name", "external.write")
            .put("risk", "external_write").put("arguments", JSONObject()))

        runCatching {
            PythonAgentLoopCoordinator(bridge(), ports, faultInjector = PythonSideEffectFaultInjector { point, _ ->
                if (point == PythonSideEffectFaultPoint.TOOL_RECEIPT_PERSISTED) error("simulated_process_death")
            }).execute(start()).toList()
        }
        PythonAgentLoopCoordinator(bridge(), ports).execute(start()).toList()

        assertEquals(1, executions)
        assertTrue(checkpoint!!.state.getJSONObject("_host_tool_results").has("write-1"))
    }

    @Test
    fun `process death after rejected approval persists decision and does not prompt twice`() = runTest {
        var checkpoint: HostCheckpoint? = null
        var prompts = 0
        val store = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) {
                checkpoint = HostCheckpoint(value.runId, value.sequence, JSONObject(value.state.toString()))
            }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val base = fakePorts()
        val ports = base.copy(stateStore = store, approval = object : PythonApprovalHostPort {
            override suspend fun request(request: HostApprovalRequest): HostApprovalDecision {
                prompts += 1
                return HostApprovalDecision(request.approvalId, "rejected")
            }
        })
        fun bridge() = approvalRequestBridge()

        runCatching {
            PythonAgentLoopCoordinator(bridge(), ports, faultInjector = PythonSideEffectFaultInjector { point, _ ->
                if (point == PythonSideEffectFaultPoint.APPROVAL_DECISION_PERSISTED) error("simulated_process_death")
            }).execute(start()).toList()
        }
        PythonAgentLoopCoordinator(bridge(), ports).execute(start()).toList()

        assertEquals(1, prompts)
        assertEquals("rejected", checkpoint!!.state.getJSONObject("_host_approval_results")
            .getJSONObject("approval-1").getString("decision"))
    }

    private fun start() = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "request-0", "run-1", "session-1", 0, "start-1",
        JSONObject().put("input", "hello").put("model_id", "model-1"),
    )

    private fun toolRequestBridge(payload: JSONObject) = object : PythonRuntimeBridge {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
            commands += envelope
            val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                PythonRuntimeEnvelope(
                    PythonRuntimeMessageType.TOOL_CALL_REQUEST, "tool-request", "run-1", "session-1", 1,
                    "tool:${payload.getString("call_id")}", payload,
                )
            ) else emptyList()
            return PythonRuntimeExecutionResult(
                MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
            )
        }
    }

    private fun approvalRequestBridge() = object : PythonRuntimeBridge {
        override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
            val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                PythonRuntimeEnvelope(
                    PythonRuntimeMessageType.APPROVAL_REQUEST, "approval-request", "run-1", "session-1", 1,
                    "approval:approval-1", JSONObject().put("approval_id", "approval-1").put("call_id", "write-1")
                        .put("risk", "external_write").put("title", "Write").put("summary", "Change data")
                        .put("name", "external.write").put("arguments", JSONObject()),
                )
            ) else emptyList()
            return PythonRuntimeExecutionResult(
                MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound,
            )
        }
    }

    private class ScriptedBridge : PythonRuntimeBridge {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
        val releasedRuns = mutableListOf<Pair<String, String>>()

        override suspend fun releaseSessionRun(sessionId: String, runId: String) {
            releasedRuns += sessionId to runId
        }
        override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult {
            commands += envelope
            val outbound = when (envelope.messageType) {
                PythonRuntimeMessageType.START_RUN -> listOf(
                    out(1, PythonRuntimeMessageType.RUNTIME_EVENT, JSONObject().put("kind", "run.started")),
                    out(
                        2,
                        PythonRuntimeMessageType.MODEL_REQUEST,
                        JSONObject().put("model_id", "model-1").put("messages", JSONArray()).put("tools", JSONArray()),
                    ),
                )
                PythonRuntimeMessageType.MODEL_CHUNK -> listOf(
                    out(3, PythonRuntimeMessageType.RUNTIME_EVENT, JSONObject().put("kind", "message.delta").put("text", "hello"))
                )
                PythonRuntimeMessageType.MODEL_COMPLETED -> listOf(
                    out(4, PythonRuntimeMessageType.RUNTIME_EVENT, JSONObject().put("kind", "run.completed"))
                )
                else -> emptyList()
            }
            return PythonRuntimeExecutionResult(MailboxDecision.ACCEPTED, envelope.requestId, "accepted", "python_runtime_ready", outbound)
        }

        private fun out(sequence: Long, type: PythonRuntimeMessageType, payload: JSONObject) =
            PythonRuntimeEnvelope(type, "out-$sequence", "run-1", "session-1", sequence, "out-key-$sequence", payload)
    }

    private fun fakePorts() = PythonRuntimeHostPorts(
        model = object : PythonModelHostPort {
            override fun stream(request: HostModelRequest): Flow<HostModelChunk> =
                flowOf(HostModelChunk(request.requestId, "hello", "stop"))
        },
        stateStore = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = Unit
            override suspend fun loadCheckpoint(runId: String): HostCheckpoint? = null
        },
        tools = object : PythonToolHostPort {
            override suspend fun execute(call: HostToolCall) = HostToolResult(call.callId, true, JSONObject())
        },
        approval = object : PythonApprovalHostPort {
            override suspend fun request(request: HostApprovalRequest) = HostApprovalDecision(request.approvalId, "approved")
        },
        artifacts = object : PythonArtifactHostPort {
            override suspend fun describe(artifactId: String) = HostArtifactDescriptor(artifactId, "text/plain", 0, "0".repeat(64))
            override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = ByteArray(0)
        },
        lifecycle = object : PythonLifecycleHostPort {
            override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
        },
    )
}
