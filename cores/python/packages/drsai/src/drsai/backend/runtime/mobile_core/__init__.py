"""Dependency-light contracts shared by Android and desktop runtimes."""

from .protocol import MessageType, RuntimeEnvelope
from .engine import DrSaiAgentKernel, MobileAgentCore, MobileRunState, RunPhase, create_mobile_agent_core
from .subagents import LogicalSubagentResult, LogicalSubagentScheduler, LogicalSubagentTask, SubagentStatus, build_subagent_scheduling_policy
from .context import assemble_mobile_context
from .factory import create_shared_mobile_core
from .ports import (
    ApprovalDecision,
    ApprovalPort,
    ApprovalRequest,
    ArtifactDescriptor,
    ArtifactPort,
    CheckpointRecord,
    LifecyclePort,
    LifecycleState,
    ModelChunk,
    ModelPort,
    ModelRequest,
    StateStorePort,
    ToolCall,
    ToolHostPort,
    ToolResult,
)

__all__ = [
    "ApprovalDecision", "ApprovalPort", "ApprovalRequest", "ArtifactDescriptor",
    "ArtifactPort", "CheckpointRecord", "LifecyclePort", "LifecycleState",
    "MessageType", "ModelChunk", "ModelPort", "ModelRequest", "RuntimeEnvelope",
    "DrSaiAgentKernel", "MobileAgentCore", "MobileRunState", "RunPhase", "StateStorePort", "ToolCall",
    "ToolHostPort", "ToolResult", "create_mobile_agent_core",
    "LogicalSubagentResult", "LogicalSubagentScheduler", "LogicalSubagentTask", "SubagentStatus", "build_subagent_scheduling_policy",
    "assemble_mobile_context",
    "create_shared_mobile_core",
]
