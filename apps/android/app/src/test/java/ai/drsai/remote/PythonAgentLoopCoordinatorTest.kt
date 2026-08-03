package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PythonAgentLoopCoordinatorTest {
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
                val outbound = if (envelope.messageType == PythonRuntimeMessageType.START_RUN) listOf(
                    PythonRuntimeEnvelope(
                        PythonRuntimeMessageType.ARTIFACT_REQUEST, "artifact-create", "run-1", "session-1", 3,
                        "artifact:create:op-1", JSONObject().put("operation", "create")
                            .put("operation_id", "op-1").put("mime_type", "text/plain"),
                    )
                ) else emptyList()
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

        PythonAgentLoopCoordinator(bridge, base.copy(stateStore = store, artifacts = artifacts)).execute(start()).toList()

        assertEquals(0, mutations)
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

    private fun start() = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "request-0", "run-1", "session-1", 0, "start-1",
        JSONObject().put("input", "hello").put("model_id", "model-1"),
    )

    private class ScriptedBridge : PythonRuntimeBridge {
        val commands = mutableListOf<PythonRuntimeEnvelope>()
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
