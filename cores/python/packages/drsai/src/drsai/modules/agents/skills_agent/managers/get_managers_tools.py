from drsai.modules.components.tool import (
    ToolSchema,
    ParametersSchema,
    )
from drsai.modules.baseagent import (
    # DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
)
from pathlib import Path
import venv
def get_agent_skills_tool(descriptions: str, strict: bool = False,) -> ToolSchema:
    """Get the skills' tools available to this agent."""
    
    parameters = ParametersSchema(
        type="object",
        properties={
            "skill": {
                    "type": "string",
                    "description": "Name of the skill to load"
                }
        },
        required=["skill"],
        additionalProperties=False,
    )
    tool_schema = ToolSchema(
        name="Skill",
        description=f"""Load a skill to gain specialized knowledge for a task.

Available skills:
{descriptions}

When to use:
- IMMEDIATELY when user task matches a skill description
- Before attempting domain-specific work (PDF, MCP, etc.)

The skill content will be injected into the conversation, giving you
detailed instructions and access to resources.""",
        parameters=parameters,
        strict=strict,
    )
    
    return tool_schema


def get_regression_read_tools(strict: bool = False) -> list[ToolSchema]:
    """Return narrow, read-only tools used by the regression-testing Skill."""
    def schema(name: str, description: str, properties: dict, required: list[str] | None = None) -> ToolSchema:
        return ToolSchema(
            name=name,
            description=description,
            parameters=ParametersSchema(
                type="object",
                properties=properties,
                required=required or [],
                additionalProperties=False,
            ),
            strict=strict,
        )

    return [
        schema("regression_list_suites", "List the current validated OpenDrSai regression suites. Use before claiming which suites exist.", {}),
        schema("regression_list_cases", "List cases in canonical Suite order with current revision and definition hash.", {"suite_id": {"type": "string"}}, ["suite_id"]),
        schema("regression_get_case", "Get the safe current input, expectations, environment and execution rules for one regression case.", {"case_id": {"type": "string"}}, ["case_id"]),
        schema("regression_preflight", "Validate an exact Suite/case selection and return missing requirements, risks, catalog revision and a scope-bound confirmation token when needed.", {"suite_id": {"type": "string"}, "case_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 100}}, ["suite_id", "case_ids"]),
        schema("regression_start", "Start one idempotent background regression evaluation after successful preflight. Risky or multi-case selections require the exact confirmation token returned by preflight.", {"suite_id": {"type": "string"}, "case_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 100}, "catalog_revision": {"type": "string"}, "options": {"type": "object", "properties": {"failure_policy": {"type": "string", "enum": ["continue", "stop"]}}, "additionalProperties": False}, "confirmation_token": {"type": "string"}}, ["suite_id", "case_ids", "catalog_revision"]),
        schema("regression_history", "Read persisted regression evaluation history.", {"limit": {"type": "integer", "minimum": 1, "maximum": 500}}),
        schema("regression_get", "Read one authoritative persisted regression evaluation.", {"evaluation_id": {"type": "string"}}, ["evaluation_id"]),
        schema("regression_events", "Read evaluation, case, Gateway Run, approval and artifact lifecycle events after a stable opaque integer cursor.", {"evaluation_id": {"type": "string"}, "after_cursor": {"type": "integer", "minimum": 0}}, ["evaluation_id"]),
        schema("regression_cancel", "Cancel an active evaluation, its current Gateway Run and Runner process while preserving partial results and evidence.", {"evaluation_id": {"type": "string"}}, ["evaluation_id"]),
    ]

def get_todo_manager_tool(strict: bool = False,) -> ToolSchema:
    parameters = ParametersSchema(
        type="object",
        properties={
            "items": {
                "type": "array",
                "description": "To-do list, must contain complete information for all tasks",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed"]
                        },
                        # "activeForm": {"type": "string"},
                    },
                    "required": ["content", "status"], # , "activeForm"
                },
            },
        },
        required=["items"],
        additionalProperties=False,
    )
    tool_schema = ToolSchema(
        name="TodoWrite",
        description="Create/Update task list.",
        parameters=parameters,
        strict=strict,
    )
    return tool_schema

def get_subagent_tools(sub_agents: list[str], description: str, strict: bool = False,) -> ToolSchema:
    parameters = ParametersSchema(
        type="object",
        properties={
            "description": {
                "type": "string",
                "description": "Short task description (3-5 words)"
            },
            "prompt": {
                "type": "string",
                "description": "The specific task. Include all necessary code, file paths, constraints. If code blocks or files need to be executed, include them in full."
            },
            "agent_type": {
                "type": "string",
                "enum": sub_agents,
                "description": "Which subagent type to use (explore=read-only search, plan=architecture design, general=full toolkit, or a custom type)."
            },
            "context": {
                "type": "string",
                "description": "Optional background context for the subagent: relevant file paths, error messages, project structure, constraints. Not the parent conversation history."
            },
            # "mode": {
            #     "type": "string",
            #     "enum": ["single", "multi"],
            #     "description": "Execution mode: 'single' = one LLM round (fast, for simple tasks), 'multi' = iterate until done (for complex multi-step tasks). Default: depends on subagent type."
            # },
        },
        required=["description", "prompt", "agent_type"],
        additionalProperties=False,
    )
    tool_schema = ToolSchema(
        name="Delegate",
        description=(
            f"Delegate a subtask to a specialized subagent. Use this when you need focused work by an agent with specific capabilities.\n\n"
            f"IMPORTANT: The subagent has its own isolated context. It CANNOT see the parent conversation history. "
            f"Provide all necessary information in the 'prompt' and 'context' fields.\n\n"
            f"Available agent types:\n{description}"
        ),
        parameters=parameters,
        strict=strict,
    )
    return tool_schema


def create_local_venv(work_dir: str|Path) -> LocalCommandLineCodeExecutor:
    work_dir = Path(work_dir)
    work_dir.mkdir(exist_ok=True)
    venv_dir = Path(work_dir) / ".venv"
    venv_builder = venv.EnvBuilder(with_pip=True)
    venv_builder.create(venv_dir)
    venv_context = venv_builder.ensure_directories(venv_dir)
    return LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)
