from drsai.modules.components.tool import (
    ToolSchema,
    ParametersSchema,
    )

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

def get_todo_manager_tool(strict: bool = False,) -> ToolSchema:
    parameters = ParametersSchema(
        type="object",
        properties={
            "items": {
                "type": "array",
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
                },
            },
        },
        required=["content", "status"], # , "activeForm"
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
                "description":  "Short task description (3-5 words)"
            },
            "prompt": {
                "type": "string",
                "description": "The specific tasks that need to be executed by the sub agent. If the tasks include code blocks, files, etc. that need to be executed, they must be filled in completely."
            },
            "agent_type": {
                "type": "string",
                "enum": sub_agents
            },
        },
        required=["description", "prompt", "agent_type"],
        additionalProperties=False,
    )
    tool_schema = ToolSchema(
        name="Task",
        description=f"Spawn a subagent for a focused subtask.\n\nAgent types:\n{description}",
        parameters=parameters,
        strict=strict,
    )
    return tool_schema