"""Desktop Host adapters for legacy manager Tools during Kernel migration."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping

from autogen_agentchat.base import Response
from autogen_core import CancellationToken

from .desktop_kernel_coordinator import DesktopToolResult


ManagerPort = Callable[[Mapping[str, Any]], Awaitable[DesktopToolResult]]


class DesktopAgentManagerPorts:
    def __init__(self, agent: Any, cancellation_token: CancellationToken) -> None:
        self._agent = agent
        self._cancellation_token = cancellation_token

    def ports(self, visible_names: set[str]) -> dict[str, ManagerPort]:
        regression_names = {
            "regression_list_suites", "regression_list_cases", "regression_get_case",
            "regression_preflight", "regression_start", "regression_history",
            "regression_get", "regression_events", "regression_cancel",
        }
        known = {
            "Skill": self.skill,
            "TodoWrite": self.todo_write,
            "UpdateUserConfig": self.update_user_config,
            "Delegate": self.delegate,
            "ScheduledTaskManager": self.scheduled_task,
            **{name: self.regression for name in regression_names},
        }
        unknown = visible_names - set(known)
        if unknown:
            names = ",".join(sorted(unknown))

            async def unsupported(payload: Mapping[str, Any]) -> DesktopToolResult:
                raise RuntimeError(f"desktop_kernel_manager_port_unimplemented:{payload.get('name')}:{names}")

            return {**{name: known[name] for name in visible_names & set(known)}, **{name: unsupported for name in unknown}}
        return {name: known[name] for name in visible_names}

    @staticmethod
    def _arguments(payload: Mapping[str, Any]) -> tuple[str, str, dict[str, Any]]:
        call_id, name, arguments = payload.get("call_id"), payload.get("name"), payload.get("arguments")
        if not isinstance(call_id, str) or not isinstance(name, str) or not isinstance(arguments, Mapping):
            raise ValueError("desktop_manager_tool_payload_invalid")
        return call_id, name, dict(arguments)

    @staticmethod
    def _success(call_id: str, content: Any) -> DesktopToolResult:
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, default=str, sort_keys=True)
        return DesktopToolResult(call_id, True, {"content": text})

    async def skill(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, _, arguments = self._arguments(payload)
        loader = getattr(self._agent, "_cached_skills_loader", None)
        if loader is None:
            return DesktopToolResult(call_id, False, {"content": "Skills loader unavailable"}, "skill_unavailable")
        skill_name = str(arguments.get("skill") or "")
        content = loader.run_skill(skill_name)
        metadata = getattr(loader, "skills", {}).get(skill_name, {})
        required_tools = metadata.get("required_tools", []) if isinstance(metadata, Mapping) else []
        if required_tools and hasattr(self._agent, "_elevate_tools_for_skill"):
            self._agent._elevate_tools_for_skill(required_tools, skill_name)
        return self._success(call_id, f"Skill for {skill_name}:\n\n{content}")

    async def todo_write(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, _, arguments = self._arguments(payload)
        manager = getattr(self._agent, "_todo_manager", None)
        if manager is None:
            return DesktopToolResult(call_id, False, {"content": "Todo manager unavailable"}, "todo_unavailable")
        manager.update(arguments.get("items", []))
        warning = str(getattr(manager, "_last_warning", "") or "")
        content = manager.get_task_prompt()
        return self._success(call_id, f"{warning}\n\n{content}".strip())

    async def regression(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, name, arguments = self._arguments(payload)
        manager = getattr(self._agent, "_regression_manager", None)
        if manager is None:
            return DesktopToolResult(
                call_id, False, {"content": "Regression manager unavailable"},
                "regression_manager_unavailable",
            )
        runtime_workspace_path = getattr(self._agent, "_runtime_workspace_path", None)
        if isinstance(runtime_workspace_path, (str, Path)):
            # The Manager's storage root belongs to the Agent profile, while
            # preflight and execution must target the Workspace bound to the
            # current Desktop Run.  Refresh this immediately before dispatch
            # so the native Kernel port cannot observe a stale profile path.
            manager.workspace_path = Path(runtime_workspace_path).resolve()
        try:
            # Catalog and preflight adapters perform bounded filesystem and
            # loopback Gateway reads. Never block the Gateway event loop while
            # querying that same Gateway from an ordinary Agent tool call.
            result = await asyncio.to_thread(manager.execute, name, arguments)
            return self._success(call_id, result)
        except Exception as exc:
            # Preserve a stable public code while keeping arbitrary catalog or
            # filesystem exception text out of the Kernel tool envelope.
            return DesktopToolResult(
                call_id, False,
                {"error": {"code": "regression_tool_failed", "type": type(exc).__name__}},
                "regression_tool_failed",
            )

    async def update_user_config(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, _, arguments = self._arguments(payload)
        manager = getattr(self._agent, "_user_profile_manager", None)
        if manager is None:
            return DesktopToolResult(call_id, False, {"content": "User profile manager unavailable"}, "profile_unavailable")
        return self._success(call_id, manager.update_user_config(**arguments))

    async def delegate(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, _, arguments = self._arguments(payload)
        execute = getattr(self._agent, "_execute_subagent", None)
        if execute is None:
            return DesktopToolResult(call_id, False, {"content": "Subagent executor unavailable"}, "subagent_unavailable")
        result = ""
        async for message in execute(
            sub_agent_name=str(arguments.get("agent_type") or ""),
            prompt=str(arguments.get("prompt") or ""),
            context=arguments.get("context"),
            cancellation_token=self._cancellation_token,
        ):
            if isinstance(message, Response):
                result = str(message.chat_message.content)
                break
        return self._success(call_id, result or "Subagent completed without a final message.")

    async def scheduled_task(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id, _, arguments = self._arguments(payload)
        manager = getattr(self._agent, "_task_manager", None)
        if manager is None:
            return DesktopToolResult(call_id, False, {"content": "Scheduled task manager unavailable"}, "scheduler_unavailable")
        operation = str(arguments.get("operation") or "")
        if operation == "create":
            from drsai.modules.agents.skills_agent.managers import ScheduledTask, ScheduleType

            task = ScheduledTask(
                user_id=str(getattr(self._agent, "_user_id", "")),
                session_id=str(getattr(self._agent, "_thread_id", "")),
                task_name=arguments["task_name"],
                task_description=arguments.get("task_description"),
                prompt=arguments["prompt"],
                schedule_type=ScheduleType(arguments["schedule_type"]),
                schedule_config=arguments["schedule_config"],
                timeout=arguments.get("timeout", 300),
                save_history=arguments.get("save_history", True),
                execution_context={"defult_config_name": getattr(self._agent, "_defult_config_name", None)},
            )
            task_id = await manager.add_task(task)
            return self._success(call_id, {"task_id": task_id, "status": "created", "next_run": task.next_run})
        if operation == "list":
            from drsai.modules.agents.skills_agent.managers import TaskStatus

            status = TaskStatus(arguments["status"]) if arguments.get("status") else None
            tasks = await manager.list_tasks(
                user_id=str(getattr(self._agent, "_user_id", "")),
                session_id=arguments.get("session_id"), status=status,
            )
            return self._success(call_id, [self._public_task(value) for value in tasks])
        if operation == "get":
            task = await manager.get_task(arguments["task_id"])
            return self._success(call_id, None if task is None else self._public_task(task))
        if operation == "delete":
            return self._success(call_id, {"deleted": bool(await manager.remove_task(arguments["task_id"]))})
        if operation == "toggle":
            from drsai.modules.agents.skills_agent.managers import TaskStatus

            status = TaskStatus.ENABLED if arguments["enabled"] else TaskStatus.DISABLED
            await manager.update_task_status(arguments["task_id"], status)
            return self._success(call_id, {"task_id": arguments["task_id"], "status": status.value})
        if operation == "get_results":
            values = await manager.get_task_results(arguments["task_id"], limit=arguments.get("limit", 10))
            return self._success(call_id, [self._public_object(value) for value in values])
        if operation == "get_outputs":
            values = await manager.get_task_outputs(arguments["task_id"], limit=arguments.get("limit", 10))
            return self._success(call_id, values)
        if operation == "read_output":
            path = Path(str(arguments["file_path"]))
            # The task manager produced this path; arbitrary model paths remain
            # governed by the manager/approval boundary and are never expanded.
            return self._success(call_id, path.read_text(encoding="utf-8"))
        return DesktopToolResult(call_id, False, {"content": f"Unknown scheduled task operation: {operation}"}, "operation_invalid")

    @staticmethod
    def _public_task(value: Any) -> dict[str, Any]:
        fields = (
            "task_id", "task_name", "task_description", "prompt", "schedule_type",
            "schedule_config", "status", "created_at", "last_run", "next_run", "run_count", "error_count",
        )
        return {name: DesktopAgentManagerPorts._json_value(getattr(value, name, None)) for name in fields}

    @staticmethod
    def _public_object(value: Any) -> dict[str, Any]:
        if hasattr(value, "model_dump"):
            return {key: DesktopAgentManagerPorts._json_value(item) for key, item in value.model_dump().items()}
        if hasattr(value, "__dict__"):
            return {
                key: DesktopAgentManagerPorts._json_value(item)
                for key, item in vars(value).items() if not key.startswith("_")
            }
        return {"value": str(value)}

    @staticmethod
    def _json_value(value: Any) -> Any:
        if hasattr(value, "value"):
            return value.value
        if value is None or isinstance(value, (str, int, float, bool, list, dict)):
            return value
        return str(value)
