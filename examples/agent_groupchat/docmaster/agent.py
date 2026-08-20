"""
DocMaster Agent class - filesystem-aware document processing agent.

This module provides the DocMasterAgent class that extends DrSaiAssistant
with filesystem scanning for automatic file event detection.
"""

from pathlib import Path
from typing import Sequence, AsyncGenerator
from loguru import logger

from drsai.modules.agents.skills_agent import DrSaiAssistant
from drsai.modules.managers.messages import FilesContent, FilesEvent
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    TextMessage,
    ThoughtEvent,
    ModelClientStreamingChunkEvent,
    ToolCallRequestEvent,
    ToolCallExecutionEvent,
    ToolCallSummaryMessage,
)
from autogen_agentchat.base import Response
from autogen_core import CancellationToken
from autogen_core.model_context import ChatCompletionContext
from autogen_core.models import AssistantMessage, UserMessage


def _log_event_type(event: object, turn_idx: int) -> None:
    """Emit a structured INFO log for every event yielded by on_messages_stream.

    Format:  [DocMaster|turn=N] TYPE | <detail>
    Designed to be grepped:  grep 'DocMaster|turn=' <logfile>
    """
    etype = type(event).__name__

    if isinstance(event, ModelClientStreamingChunkEvent):
        # Very chatty — log only the first chunk per turn to confirm streaming started.
        # Subsequent chunks are suppressed.
        return

    if isinstance(event, ThoughtEvent):
        preview = (event.content or "")[:120].replace("\n", " ")
        logger.info(f"[DocMaster|turn={turn_idx}] ThoughtEvent | preview={preview!r}")

    elif isinstance(event, ToolCallRequestEvent):
        calls = getattr(event, "content", []) or []
        names = [getattr(c, "name", "?") for c in calls]
        logger.info(f"[DocMaster|turn={turn_idx}] ToolCallRequestEvent | tools={names}")

    elif isinstance(event, ToolCallExecutionEvent):
        results = getattr(event, "content", []) or []
        ids = [getattr(r, "call_id", "?") for r in results]
        previews = [(getattr(r, "content", "") or "")[:80].replace("\n", " ") for r in results]
        logger.info(
            f"[DocMaster|turn={turn_idx}] ToolCallExecutionEvent | call_ids={ids} | previews={previews}"
        )

    elif isinstance(event, ToolCallSummaryMessage):
        preview = (event.content or "")[:120].replace("\n", " ")
        logger.info(f"[DocMaster|turn={turn_idx}] ToolCallSummaryMessage | preview={preview!r}")

    elif isinstance(event, TextMessage):
        meta = getattr(event, "metadata", {}) or {}
        internal = meta.get("internal", "?")
        preview = (event.content or "")[:120].replace("\n", " ")
        logger.info(
            f"[DocMaster|turn={turn_idx}] TextMessage | internal={internal} | preview={preview!r}"
        )

    elif isinstance(event, Response):
        msg = getattr(event, "chat_message", None)
        inner = getattr(event, "inner_messages", []) or []
        inner_types = [type(m).__name__ for m in inner]
        msg_type = type(msg).__name__ if msg else "None"
        msg_preview = (getattr(msg, "content", "") or "")[:80].replace("\n", " ")
        logger.info(
            f"[DocMaster|turn={turn_idx}] Response | chat_message={msg_type} "
            f"preview={msg_preview!r} | inner_types={inner_types}"
        )

    elif etype == "FilesEvent":
        content = getattr(event, "content", None)
        files = getattr(content, "files", []) if content else []
        names = [getattr(f, "name", "?") for f in files]
        logger.info(f"[DocMaster|turn={turn_idx}] FilesEvent | files={names}")

    else:
        # Catch any other event types we haven't explicitly handled
        logger.info(f"[DocMaster|turn={turn_idx}] {etype} | (unhandled type)")

# Import file event utilities
try:
    from .utils import build_files_event_data, upload_generated_to_gfs
except ImportError:
    # Fallback for testing - these will be provided at runtime
    def build_files_event_data(file_path, description):
        """Placeholder - actual implementation in utils.file_utils"""
        return None

    def upload_generated_to_gfs(user_id, local_path):
        """Placeholder - actual implementation in utils.file_utils"""
        pass


class DocMasterAgent(DrSaiAssistant):
    """DrSaiAssistant subclass that emits FilesEvent for generated/edited documents.

    Uses filesystem-scanning approach: snapshots file mtimes before tool execution,
    then detects new/modified files after — works regardless of HOW files are changed
    (run_write, run_bash, python scripts, etc.).
    """

    # File extensions to track for FilesEvent registration
    # NOTE:
    # - .xml is excluded because unpacked DOCX/PPTX/XLSX files create many
    #   intermediate XML files that are internal to Office documents
    TRACKED_EXTENSIONS = {
        '.docx', '.pdf', '.pptx', '.xlsx', '.csv',
        '.txt', '.md', '.rtf', '.tex', '.json', '.yaml', '.yml',
        '.ini', '.cfg', '.conf', '.log', '.html', '.htm', '.css', '.js',
    }

    # Directories to exclude from workspace scanning
    # NOTE: skills/ and configs/ are excluded because:
    # - skills/ contains copied skill files (SKILL.md etc.) from first_time_setup
    # - configs/ contains system config files (AGENTS.md, TOOLS.md, USER.md etc.)
    # These are internal DrSai files, not user documents
    EXCLUDED_DIRS = {'skills', 'configs', 'document_skills', 'scripts', '__pycache__', '.git'}

    @staticmethod
    async def _add_messages_to_context(
        model_context: ChatCompletionContext,
        messages: Sequence[BaseChatMessage],
    ) -> None:
        """Add Desktop/WebUI history without collapsing assistant roles.

        AutoGen's ``TextMessage.to_model_message`` represents an incoming chat
        message as a UserMessage regardless of its ``source``.  That is correct
        for ordinary agent-to-agent input, but an OpenAI/OAEP history contains
        explicit ``user`` and ``assistant`` roles.  Preserve those roles here so
        Desktop history does not become a run of consecutive user messages.
        """
        for message in messages:
            model_message = message.to_model_message()
            if (
                isinstance(message, TextMessage)
                and message.source == "assistant"
                and isinstance(model_message, UserMessage)
            ):
                model_message = AssistantMessage(
                    content=model_message.content,
                    source="assistant",
                )
            await model_context.add_message(model_message)

    # Signals that an argument is about template/DOCX lookup. Keep these
    # narrow on purpose — we do NOT want to break legitimate run_bash /
    # run_glob uses (logs, code search, generic project files).
    _TEMPLATE_HUNT_TOKENS = (
        ".docx",
        ".doc",
        "template",
        "模板",
        "合同",
        "contract",
        "workspace/templates",
        "/templates/",
    )

    def __init__(self, pending_files_events: list, **kwargs):
        """Initialize DocMasterAgent.

        Args:
            pending_files_events: List to collect file events from tools.
            **kwargs: Additional arguments passed to DrSaiAssistant.
        """
        print("✨ [REFACTORED] DocMasterAgent.__init__ 被调用 (来自重构后的 agent.py)")
        # Capture user_id BEFORE super().__init__ consumes it — the base
        # DrSaiAssistant doesn't promise to keep it as an attribute, but we
        # need it later to upload generated files into the user's GFS bucket.
        self._docmaster_user_id = kwargs.get("user_id") or None
        super().__init__(**kwargs)
        self._pending_files_events = pending_files_events
        self._install_filesystem_tool_guards()
        print(f"✨ [REFACTORED] DocMasterAgent 初始化完成，user_id={self._docmaster_user_id}")

    # ---- filesystem-tool guards ------------------------------------------
    # The framework auto-registers run_bash / run_glob / run_read as basic
    # tools. Despite explicit prompt rules forbidding their use for template
    # lookup, the agent regularly reaches for run_glob to "find" a template
    # by name — bypassing the template library and sometimes picking up a
    # stale duplicate. We can't drop the basic tools without forking the
    # framework, so we wrap their underlying callables and intercept calls
    # whose arguments look like template-hunting, returning a directive
    # error that redirects to the right tool.

    @classmethod
    def _looks_like_template_hunt(cls, *args: str) -> bool:
        """Check if arguments look like a template/DOCX lookup.

        Args:
            *args: Arguments to check.

        Returns:
            True if arguments suggest template hunting, False otherwise.
        """
        blob = " ".join(a for a in args if isinstance(a, str)).lower()
        # Explicit allowlist: reads under the PPT skill directory or any deck
        # workspace are legitimate. The template-hunt heuristic exists to stop
        # DOCX template lookups via run_glob, not to block PPT artifacts that
        # happen to live in a path named "template_audit" or "templates/".
        if (
            "skills/presentation-skills" in blob
            or "ppt-polished-deck-collab" in blob
            or "/decks/" in blob              # per-user deck workspaces
            or "validation/template_audit" in blob  # audit reports under decks
        ):
            return False
        return any(tok.lower() in blob for tok in cls._TEMPLATE_HUNT_TOKENS)

    @staticmethod
    def _template_redirect_message(tool_name: str, args_blob: str) -> str:
        """Generate a redirect message for blocked template lookups.

        Args:
            tool_name: Name of the blocked tool.
            args_blob: String representation of the arguments.

        Returns:
            Redirect message to the user.
        """
        return (
            f"{tool_name} blocked: the arguments ({args_blob[:160]}) look like "
            "a template / DOCX file lookup. Filesystem tools are NOT the "
            "template entry point — they bypass the template library and "
            "regularly pick up stale duplicates. Recover with: "
            "(1) if the user named a template, call "
            "get_template_path_tool(template_ref=<user's words>); "
            "(2) to browse what's available, call "
            "list_templates_tool(category=None, query=None); "
            "(3) if the user just uploaded a file, re-read the upload event "
            "for the absolute path. To inspect DOCX content, use "
            "extract_docx_content_tool, NOT run_read."
        )

    def _install_filesystem_tool_guards(self) -> None:
        """Install guards on filesystem tools to prevent template hunting."""
        import functools

        def _wrap(orig_func, tool_name: str, arg_extractor):
            @functools.wraps(orig_func)
            async def guarded(*args, **kwargs):
                hunt_args = arg_extractor(args, kwargs)
                if self._looks_like_template_hunt(*hunt_args):
                    return self._template_redirect_message(
                        tool_name, " | ".join(str(a) for a in hunt_args)
                    )
                return await orig_func(*args, **kwargs)
            return guarded

        # Extract the user-visible arg(s) we want to sniff per tool.
        extractors = {
            "run_glob": lambda args, kwargs: (
                kwargs.get("pattern") or (args[0] if args else ""),
                kwargs.get("search_path") or (args[1] if len(args) > 1 else ""),
            ),
            "run_bash": lambda args, kwargs: (
                kwargs.get("cmd") or kwargs.get("command")
                or (args[0] if args else ""),
            ),
            "run_read": lambda args, kwargs: (
                kwargs.get("path") or kwargs.get("file_path")
                or (args[0] if args else ""),
            ),
        }

        tools_list = getattr(self, "_tools", None) or []
        for tool in tools_list:
            name = getattr(tool, "name", None) or getattr(tool, "_name", None)
            if name in extractors and hasattr(tool, "_func"):
                tool._func = _wrap(tool._func, name, extractors[name])

    @staticmethod
    async def _execute_tool_call(tool_call, workbench, handoff_tools, agent_name, cancellation_token):
        """Override autogen's _execute_tool_call to repair broken JSON before parsing.

        Autogen does json.loads(tool_call.arguments) which fails on unescaped
        quotes in Chinese text. We repair the JSON first, then delegate to the
        parent implementation.

        Args:
            tool_call: The tool call to execute.
            workbench: The workbench object.
            handoff_tools: Handoff tools.
            agent_name: Name of the agent.
            cancellation_token: Cancellation token.

        Returns:
            Result from the parent _execute_tool_call.
        """
        import json as _json
        try:
            _json.loads(tool_call.arguments)
        except _json.JSONDecodeError:
            try:
                from json_repair import repair_json
                tool_call.arguments = repair_json(tool_call.arguments, return_objects=False)
            except Exception:
                pass  # let autogen handle the error as usual
        # Call the parent (autogen) implementation with repaired arguments
        from autogen_agentchat.agents._assistant_agent import AssistantAgent
        return await AssistantAgent._execute_tool_call(
            tool_call, workbench, handoff_tools, agent_name, cancellation_token,
        )

    def _snapshot_workspace(self) -> dict[str, float]:
        """Snapshot all tracked files in the CURRENT USER's workspace only.

        Returns:
            Dictionary mapping file paths to their modification times.
        """
        print("📸 [REFACTORED] _snapshot_workspace 被调用 (文件系统扫描)")
        user_dir = self._user_profile_manager.work_dir
        snapshot: dict[str, float] = {}
        for ext in self.TRACKED_EXTENSIONS:
            for f in user_dir.rglob(f'*{ext}'):
                if f.is_file():
                    # Skip files in excluded directories (skills, configs, etc.)
                    if any(excluded in f.parts for excluded in self.EXCLUDED_DIRS):
                        continue
                    try:
                        snapshot[str(f)] = f.stat().st_mtime
                    except OSError:
                        pass
        print(f"📸 [REFACTORED] 工作区快照完成: {len(snapshot)} 个文件")
        return snapshot

    def _detect_changed_files(self, before: dict[str, float]) -> list[str]:
        """Compare current workspace state with a previous snapshot.

        Args:
            before: Previous snapshot of file mtimes.

        Returns:
            List of new or modified file paths.
        """
        after = self._snapshot_workspace()
        changed: list[str] = []
        for fpath, mtime in after.items():
            if fpath not in before or mtime > before[fpath]:
                changed.append(fpath)
        return changed

    async def on_messages_stream(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """Override on_messages_stream to detect file changes via filesystem scanning.

        Takes a snapshot before processing, then emits FilesEvent for any
        new/modified files after tool execution.

        Args:
            messages: Sequence of chat messages.
            cancellation_token: Cancellation token.

        Yields:
            Agent events and messages with FilesEvent for detected file changes.
        """
        snapshot_before = self._snapshot_workspace()
        already_emitted: set[str] = set()
        turn_idx = 0
        logger.info(f"[DocMaster|turn=START] on_messages_stream called with {len(messages)} input message(s)")

        async for event in super().on_messages_stream(messages, cancellation_token):
            _log_event_type(event, turn_idx)
            turn_idx += 1
            yield event

            # After ToolCallSummaryMessage or Response, check for changed files
            if isinstance(event, (ToolCallSummaryMessage, Response)):
                logger.debug(f"Event: {event.__class__.__name__}, pending_count={len(self._pending_files_events)}")

                # Collect pending files
                pending_files = set()
                for pe in self._pending_files_events:
                    files_list = pe.get('files', [{}])
                    for f in files_list:
                        fpath = f.get('path', '')
                        if fpath:
                            pending_files.add(fpath)

                # Detect filesystem changes
                changed_files = self._detect_changed_files(snapshot_before)
                for fpath in changed_files:
                    if fpath in pending_files or fpath in already_emitted:
                        continue
                    try:
                        desc = f"File created/modified: {Path(fpath).name}"
                        fe_data = build_files_event_data(fpath, desc)
                        if fe_data:
                            already_emitted.add(fpath)
                            try:
                                upload_generated_to_gfs(self._docmaster_user_id, fpath)
                            except Exception as e:
                                logger.debug(f"GFS: {e}")
                            logger.info(f"Scanner: {Path(fpath).name}")
                            try:
                                yield FilesEvent(
                                    content=FilesContent(**fe_data),
                                    source=self.name,
                                )
                            except Exception as e:
                                logger.error(f"FilesEvent: {e}")
                    except Exception as e:
                        logger.error(f"Changed file: {e}")

                # Update snapshot
                snapshot_before = self._snapshot_workspace()

            # Drain pending file events after each event
            while self._pending_files_events:
                try:
                    fe_data = self._pending_files_events.pop(0)
                    files_list = fe_data.get('files', [{}])
                    for f in files_list:
                        fpath = f.get('path', '')
                        if fpath:
                            already_emitted.add(fpath)
                            try:
                                upload_generated_to_gfs(self._docmaster_user_id, fpath)
                            except Exception as e:
                                logger.debug(f"GFS: {e}")
                            logger.info(f"Pending: {Path(fpath).name}")
                            try:
                                yield FilesEvent(
                                    content=FilesContent(**fe_data),
                                    source=self.name,
                                )
                            except Exception as e:
                                logger.error(f"FilesEvent: {e}")
                            break
                except Exception as e:
                    logger.error(f"Pending: {e}")
                    break
