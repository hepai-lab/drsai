"""
DrSaiSQLiteChatCompletionContext - SQLite-based chat completion context.

This module provides a local SQLite-based alternative to DrSaiChatCompletionContext
that stores LLMMessage directly in SessionMessage table via DatabaseManager.
It supports delayed write, FTS5 full-text search, and replaces RAGFlow vector retrieval.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, is_dataclass
from pydantic import BaseModel
from typing import (
    Any,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    TYPE_CHECKING,
    Union,
)
from datetime import datetime

from autogen_core import CancellationToken, Component, FunctionCall
from autogen_core.model_context import ChatCompletionContext
from autogen_core.models import (
    ChatCompletionClient,
    FunctionExecutionResultMessage,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    FunctionExecutionResult,
)
from loguru import logger

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy import text  # noqa: F401

# Import database models
from drsai.modules.managers.datamodel.db import SessionMessage, SessionSummary
from drsai.modules.managers.database import DatabaseManager

from ._prompt import COMPRESSION_PROMPT_EN


class DrSaiSQLiteContextConfig(BaseModel):
    """Configuration for DrSaiSQLiteChatCompletionContext."""
    thread_id: str = ""
    user_id: str = ""
    token_limit: Optional[int] = None
    compression_prompt: str = ""
    tool_schema: Optional[List[Dict[str, Any]]] = None
    initial_messages: Optional[List[Dict[str, Any]]] = None
    tool_clear_whitelist: Optional[List[str]] = None
    keep_recent_tool_results: int = 10
    min_content_length_to_clear: int = 1000


class DrSaiSQLiteChatCompletionContext(
    ChatCompletionContext,
    Component[DrSaiSQLiteContextConfig],
):
    """SQLite-based chat completion context using SessionMessage table.

    This is a drop-in replacement for DrSaiChatCompletionContext that stores
    LLMMessage directly in the SessionMessage table via DatabaseManager.

    Features:
    - Uses existing DatabaseManager + SessionMessage table (no new DB connection)
    - Stores complete LLMMessage JSON serialization
    - Delayed write to reduce DB operations
    - FTS5 full-text search for memory retrieval (replaces RAGFlow)
    - Session-based message isolation via thread_id

    Storage Architecture:
    - SessionMessage table: stores each LLMMessage as a row
    - FTS5 virtual tables: managed globally by DatabaseManager, with
      triggers for automatic incremental index maintenance
    - In-memory cache: _messages for fast LLM calls
    """

    component_config_schema = DrSaiSQLiteContextConfig
    component_provider_override = "drsai.DrSaiSQLiteChatCompletionContext"
    component_description = "A context that limits the number of tokens used by the model."

    def __init__(
        self,
        agent_name: str,
        model_client: ChatCompletionClient,
        *,
        db_manager: DatabaseManager,
        thread_id: str,
        user_id: str = "",
        token_limit: Optional[int] = None,
        compression_prompt: str = "",
        tool_schema: Optional[List[Dict[str, Any]]] = None,
        initial_messages: Optional[List[LLMMessage]] = None,
        tool_clear_whitelist: Optional[List[str]] = None,
        keep_recent_tool_results: int = 8,
        min_content_length_to_clear: int = 1000,
        max_compressed_messages: int = 1,
        save_interval_seconds: float = 5.0,  # Delay write interval
        save_message_count_threshold: int = 10,  # Or save after N messages
    ) -> None:
        """

        Args:
            agent_name: Name of the agent.
            model_client: The chat completion client for compression.
            db_manager: Existing DatabaseManager instance (reused).
            thread_id: Unique thread/session identifier.
            user_id: User identifier for memory retrieval.
            token_limit: Maximum tokens before compression.
            compression_prompt: Prompt template for LLM compression.
            tool_schema: Schema for available tools.
            initial_messages: Initial messages to start with.
            tool_clear_whitelist: Tools to clear old results for.
            keep_recent_tool_results: Number of recent results to keep.
            min_content_length_to_clear: Min content length to trigger clearing.
            max_compressed_messages: Max compressed summaries to keep.
            save_interval_seconds: Delay write interval (0 to disable).
            save_message_count_threshold: Save after N messages.
        """
        # Initialize parent with initial_messages only
        super().__init__(initial_messages=initial_messages)

        # Store configuration
        self._thread_id = thread_id
        self._user_id = user_id
        self._token_limit = token_limit
        self._compression_prompt = compression_prompt or COMPRESSION_PROMPT_EN.format(name=agent_name)
        self._tool_schema = tool_schema or []
        self._initial_messages = initial_messages or []
        self._tool_clear_whitelist = tool_clear_whitelist or []
        self._keep_recent_tool_results = keep_recent_tool_results
        self._min_content_length_to_clear = min_content_length_to_clear
        self._max_compressed_messages = max_compressed_messages

        # Store model_client as instance attribute
        self._model_client = model_client

        # Reuse existing DatabaseManager
        self._db_manager = db_manager

        # Delayed write configuration
        self._save_interval = save_interval_seconds
        self._save_count_threshold = save_message_count_threshold
        self._pending_messages: List[SessionMessage] = []
        self._last_save_time: float = time.time()
        self._message_count_since_save: int = 0

        # In-memory message cache (for LLM calls)
        self._messages: List[LLMMessage] = list(self._initial_messages)
        self._current_messages: List[LLMMessage] = []
        self._token_count: int = 0
        self._cleared_tool_results: Dict[str, int] = {}

        # FTS5 tables are managed globally by DatabaseManager._create_fts_tables().
        # No per-thread FTS tables — triggers keep the global index in sync.

    async def save_state(self) -> Mapping[str, Any]:
        """Extend parent state with _current_messages (serialized) and _cleared_tool_results."""
        state = await super().save_state()
        # Serialize LLMMessage list to dicts for safe JSON round-trip
        state["current_messages"] = [m.model_dump() for m in self._current_messages]
        state["cleared_tool_results"] = dict(self._cleared_tool_results)
        return state

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Restore parent state plus _current_messages and _cleared_tool_results."""
        await super().load_state(state)
        # Deserialize dicts back to LLMMessage objects via discriminated union
        from pydantic import TypeAdapter
        _adapter = TypeAdapter(LLMMessage)
        self._current_messages = [
            _adapter.validate_python(d)
            for d in state.get("current_messages", [])
        ]
        self._cleared_tool_results = dict(state.get("cleared_tool_results", {}))

    def _row_to_llm_message(self, row: SessionMessage) -> Optional[LLMMessage]:
        """Convert SessionMessage row back to LLMMessage, preserving original format."""
        try:
            raw = row.raw_message
            message_type = row.message_type

            if message_type == 'system':
                return SystemMessage(
                    content=raw.get('content', ''),
                    source=raw.get('source', 'system'),
                )
            elif message_type == 'user':
                content = raw.get('content', '')
                if isinstance(content, list):
                    rebuilt: List[Any] = []
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'image' and 'data_uri' in item:
                            try:
                                from autogen_core import Image as _Image
                                rebuilt.append(_Image.from_uri(item['data_uri']))
                            except Exception:
                                rebuilt.append(item.get('data_uri', ''))
                        else:
                            rebuilt.append(item)
                    content = rebuilt
                return UserMessage(
                    content=content,
                    source=raw.get('source', 'user'),
                )
            elif message_type == 'assistant':
                content = raw.get('content', '')
                if isinstance(content, list):
                    rebuilt: List[Any] = []
                    for item in content:
                        if isinstance(item, dict) and {'id', 'name', 'arguments'} <= item.keys():
                            rebuilt.append(FunctionCall(
                                id=item['id'],
                                name=item['name'],
                                arguments=item['arguments'],
                            ))
                        else:
                            rebuilt.append(item)
                    content = rebuilt
                raw_thought = raw.get('thought')
                if isinstance(raw_thought, str) and not raw_thought.strip():
                    raw_thought = None
                return AssistantMessage(
                    content=content,
                    source=raw.get('source', 'assistant'),
                    thought=raw_thought,
                )
            elif message_type == 'tool':
                # Reconstruct FunctionExecutionResultMessage
                results = raw.get('content', [])
                if isinstance(results, list) and results:
                    result = results[0]
                    return FunctionExecutionResultMessage(
                        content=[FunctionExecutionResult(
                            call_id=result.get('call_id', ''),
                            name=result.get('name', 'unknown'),
                            content=result.get('content', ''),
                            is_error=result.get('is_error', False),
                        )]
                    )
            else:
                # Fallback to UserMessage
                return UserMessage(
                    content=str(raw),
                    source=raw.get('source', 'unknown'),
                )
        except Exception as e:
            logger.warning(f"Failed to convert row to LLMMessage: {e}")
            return None

    @staticmethod
    def _serialize_content_part(item: Any) -> Any:
        """Serialize a single content item to a JSON-safe value.

        Handles autogen_core.Image (multimodal) by converting to a data URI dict.
        """
        if isinstance(item, (str, int, float, bool)) or item is None:
            return item
        if isinstance(item, dict):
            return item
        # autogen_core.Image — has .data_uri property
        if hasattr(item, "data_uri") and hasattr(item, "to_base64"):
            try:
                return {"type": "image", "data_uri": item.data_uri}
            except Exception:
                pass
        if is_dataclass(item) and not isinstance(item, type):
            return asdict(item)
        if hasattr(item, "model_dump"):
            return item.model_dump()
        return str(item)

    @classmethod
    def _serialize_content(cls, content: Any) -> Any:
        """Serialize a message content field (str or list) to JSON-safe form."""
        if isinstance(content, list):
            return [cls._serialize_content_part(p) for p in content]
        return cls._serialize_content_part(content)

    @staticmethod
    def _extract_text_from_content(content: Any) -> str:
        """Extract plain text from possibly-multimodal content for FTS column."""
        if isinstance(content, str):
            return content[:5000]
        if isinstance(content, list):
            parts = []
            for p in content:
                if isinstance(p, str):
                    parts.append(p)
                elif hasattr(p, "data_uri"):
                    parts.append("[image]")
                else:
                    parts.append(str(p))
            return " ".join(parts)[:5000]
        return str(content)[:5000]

    def _llm_message_to_session_message(self, message: LLMMessage) -> SessionMessage:
        """Convert LLMMessage to SessionMessage for storage, preserving original format."""
        now = datetime.now()

        # Build raw message dict (serializable LLMMessage)
        if isinstance(message, SystemMessage):
            raw_dict = {
                'content': message.content,
                'source': 'system',
                'type': 'SystemMessage',
            }
            return SessionMessage(
                thread_id=self._thread_id,
                user_id=self._user_id,
                message_type='system',
                source='system',
                raw_message=raw_dict,
                content=message.content,
                created_at=now,
                updated_at=now,
            )
        elif isinstance(message, UserMessage):
            serialized = self._serialize_content(message.content)
            raw_dict = {
                'content': serialized,
                'source': getattr(message, 'source', 'user'),
                'type': 'UserMessage',
            }
            return SessionMessage(
                thread_id=self._thread_id,
                user_id=self._user_id,
                message_type='user',
                source=getattr(message, 'source', 'user'),
                raw_message=raw_dict,
                content=self._extract_text_from_content(message.content),
                created_at=now,
                updated_at=now,
            )
        elif isinstance(message, AssistantMessage):
            content = message.content

            # Handle content that might be a complex object or list of objects
            if isinstance(content, list):
                # Handle list of FunctionCall (dataclass) or other objects
                serialized_content = []
                for item in content:
                    if isinstance(item, dict):
                        serialized_content.append(item)
                    elif is_dataclass(item) and not isinstance(item, type):
                        serialized_content.append(asdict(item))
                    elif hasattr(item, 'data_uri') and hasattr(item, 'to_base64'):
                        # autogen_core.Image
                        try:
                            serialized_content.append({"type": "image", "data_uri": item.data_uri})
                        except Exception:
                            serialized_content.append(str(item))
                    elif hasattr(item, 'model_dump'):
                        serialized_content.append(item.model_dump())
                    else:
                        serialized_content.append(str(item))
                content = serialized_content
            elif is_dataclass(content) and not isinstance(content, type):
                content = asdict(content)
            elif hasattr(content, 'model_dump'):
                content = content.model_dump()
            elif not isinstance(content, (str, dict)):
                content = str(content)

            raw_dict = {
                'content': content,
                'source': getattr(message, 'source', 'assistant'),
                'type': 'AssistantMessage',
                'thought': getattr(message, 'thought', None),
            }

            # For storage in content column, extract text or summarize
            if isinstance(content, str):
                content_text = content[:5000]
            elif isinstance(content, list):
                # Extract text from list, or use first item
                content_text = str(content[0])[:5000] if content else ""
            else:
                content_text = str(content)[:5000]

            return SessionMessage(
                thread_id=self._thread_id,
                user_id=self._user_id,
                message_type='assistant',
                source=getattr(message, 'source', 'assistant'),
                raw_message=raw_dict,
                content=content_text,
                created_at=now,
                updated_at=now,
            )
        elif isinstance(message, FunctionExecutionResultMessage):
            if message.content:
                result = message.content[0]
                raw_dict = {
                    'content': [{'call_id': r.call_id, 'name': r.name, 'content': r.content, 'is_error': r.is_error}
                               for r in message.content],
                    'type': 'FunctionExecutionResultMessage',
                }
                return SessionMessage(
                    thread_id=self._thread_id,
                    user_id=self._user_id,
                    message_type='tool',
                    source='tool',
                    raw_message=raw_dict,
                    content=result.content,
                    tool_name=result.name,
                    tool_call_id=result.call_id,
                    created_at=now,
                    updated_at=now,
                )

        # Fallback
        raw_dict = {
            'content': str(message),
            'source': 'unknown',
            'type': 'UnknownMessage',
        }
        return SessionMessage(
            thread_id=self._thread_id,
            user_id=self._user_id,
            message_type='unknown',
            source='unknown',
            raw_message=raw_dict,
            content=str(message)[:5000],
            created_at=now,
            updated_at=now,
        )

    def _flush_to_db(self) -> None:
        """Flush pending messages to database in a single transaction.

        FTS index is maintained by triggers on the sessionmessage table —
        no manual index rebuild needed.
        """
        if not self._pending_messages:
            return

        try:
            from sqlmodel import Session, select

            with Session(self._db_manager.engine) as session:
                for msg in self._pending_messages:
                    existing = session.exec(
                        select(type(msg)).where(type(msg).id == msg.id)
                    ).first()
                    if existing:
                        for key, value in msg.model_dump().items():
                            setattr(existing, key, value)
                        session.add(existing)
                    else:
                        session.add(msg)
                session.commit()

            self._pending_messages = []
            self._message_count_since_save = 0
            self._last_save_time = time.time()
        except Exception as e:
            logger.error(f"Failed to flush messages to DB: {e}")

    def _should_save(self) -> bool:
        """Check if we should save pending messages."""
        if not self._pending_messages:
            return False

        # Save if count threshold reached
        if self._message_count_since_save >= self._save_count_threshold:
            return True

        # Save if time interval passed
        if self._save_interval > 0:
            elapsed = time.time() - self._last_save_time
            if elapsed >= self._save_interval:
                return True

        return False

    def _queue_message(self, message: LLMMessage) -> None:
        """Add message to pending queue for delayed write."""
        session_msg = self._llm_message_to_session_message(message)
        self._pending_messages.append(session_msg)
        self._message_count_since_save += 1

        # Check if should save now
        if self._should_save():
            self._flush_to_db()

    # -------------------------------------------------------------------------
    # ChatCompletionContext Interface Implementation
    # -------------------------------------------------------------------------

    async def add_message(self, message: LLMMessage) -> None:
        """Add a message to the context and queue for database storage."""
        # Add to in-memory cache
        self._messages.append(message)
        self._current_messages.append(message)

        # Queue for delayed database write
        self._queue_message(message)

    def replace_messages(self, messages: List[LLMMessage]) -> None:
        """Replace the in-memory message list without triggering DB writes.

        This is used by ``_sanitize_api_messages`` to repair the conversation
        history (e.g. removing orphaned tool results, fixing consecutive
        user-role messages for Claude) **without** re-queuing every surviving
        message to the SessionMessage table — which would create duplicate rows.

        Only the in-memory ``_messages`` and ``_current_messages`` caches are
        updated; the underlying DB rows are left untouched.  New messages added
        after this call will still be queued normally via ``add_message``.

        Args:
            messages: The new message list to replace the current in-memory cache.
        """
        self._messages = list(messages)
        # _current_messages tracks messages from the *current* conversation turn
        # for summary/state purposes.  After sanitize, keep only those that
        # still exist in the new message list (by object identity), plus any
        # newly inserted stub messages ([Continuing] acks, stub tool results)
        # which should NOT go into _current_messages (they are ephemeral fixes).
        surviving_ids = set(id(m) for m in messages)
        self._current_messages = [
            m for m in self._current_messages if id(m) in surviving_ids
        ]

    async def get_messages(
        self,
        cancellation_token: Optional[CancellationToken] = None,
    ) -> List[LLMMessage]:
        """Get messages with automatic compression if needed."""
        # Ensure pending messages are flushed
        self._flush_to_db()

        # Layer 1: Clear old tool results
        self._compress_tool_results()

        messages = list(self._messages)

        if self._token_limit is not None:
            self._token_count = self.count_prompt_tokens()

            if self._token_count > self._token_limit:
                logger.info(f"Token count {self._token_count} exceeds limit {self._token_limit}, compressing")
                messages = await self._incremental_compress(messages, cancellation_token)

                # Update in-memory cache
                self._messages = messages
                current_set = set(id(m) for m in messages)
                self._current_messages = [m for m in self._current_messages if id(m) in current_set]
                self._token_count = self.count_prompt_tokens()

        return messages

    def count_prompt_tokens(self) -> int:
        """Count tokens in current messages."""
        return self._model_client.count_tokens(self._messages, tools=self._tool_schema)

    async def update_model_client(self, new_model_client: ChatCompletionClient) -> None:
        """Update the internal model client used for token counting and compression.

        Called by DrSaiAgent.switch_model() to keep the context's model client
        in sync with the agent's model client after a model switch.

        Args:
            new_model_client: The new ChatCompletionClient to use.
        """
        # Close old internal client to release resources
        if self._model_client is not new_model_client:
            try:
                await self._model_client.close()
            except Exception as e:
                logger.warning(f"Failed to close old context model_client: {e}")

        self._model_client = new_model_client

        # Recount tokens with the new model's tokenizer
        self._token_count = self.count_prompt_tokens()

    async def clear_messages(self) -> None:
        """Clear all messages in current context (not database)."""
        self._messages = list(self._initial_messages)
        self._current_messages = []
        self._cleared_tool_results = {}
        self._token_count = 0

    async def clear(self) -> None:
        """Clear context - implements ChatCompletionContext interface."""
        await self.clear_messages()

    def reset(self) -> None:
        """Reset context to initial state."""
        self._messages = list(self._initial_messages)
        self._current_messages = []
        self._cleared_tool_results = {}
        self._token_count = 0

    # -------------------------------------------------------------------------
    # Tool Result Compression
    # -------------------------------------------------------------------------

    def _find_history_ref(self, call_id: str) -> int:
        """Find index in messages where a tool result with the given call_id is stored."""
        for i in range(len(self._messages) - 1, -1, -1):
            msg = self._messages[i]
            if isinstance(msg, FunctionExecutionResultMessage):
                for result in msg.content:
                    if result.call_id == call_id:
                        return i
        return -1

    def _compress_tool_results(self) -> None:
        """Layer 1 compression: Clear old tool results."""
        # Find all FunctionExecutionResultMessage indices
        func_result_indices = [
            i for i, msg in enumerate(self._messages)
            if isinstance(msg, FunctionExecutionResultMessage)
        ]

        if len(func_result_indices) <= self._keep_recent_tool_results:
            return

        # Indices to compress
        indices_to_compress = func_result_indices[:-self._keep_recent_tool_results]

        for idx in indices_to_compress:
            msg = self._messages[idx]
            new_results = []
            modified = False

            for result in msg.content:
                if result.call_id in self._cleared_tool_results:
                    new_results.append(result)
                    continue

                if (result.name in self._tool_clear_whitelist
                        and len(result.content) > self._min_content_length_to_clear):
                    history_idx = self._find_history_ref(result.call_id)
                    cleared_content = (
                        f"[Tool result cleared: {result.name}(call_id={result.call_id}). "
                        f"Retrieve original via read_session_memory_by_index(index={history_idx})]"
                    )
                    new_results.append(FunctionExecutionResult(
                        content=cleared_content,
                        name=result.name,
                        call_id=result.call_id,
                        is_error=result.is_error,
                    ))
                    self._cleared_tool_results[result.call_id] = history_idx
                    modified = True
                else:
                    new_results.append(result)

            if modified:
                self._messages[idx] = FunctionExecutionResultMessage(content=new_results)

    def _find_safe_split_point(self, messages: List[LLMMessage], keep_count: int = 6) -> int:
        """Find safe split point that doesn't break tool call/result pairs."""
        count = min(keep_count, len(messages))
        idx = len(messages) - count
        while idx > 0 and isinstance(messages[idx], FunctionExecutionResultMessage):
            idx -= 1
            count += 1
        return count

    async def _incremental_compress(
        self,
        messages: List[LLMMessage],
        cancellation_token: Optional[CancellationToken] = None,
    ) -> List[LLMMessage]:
        """Layer 2: LLM compression with semantic continuity."""
        keep_count = self._find_safe_split_point(messages, keep_count=6)
        split_idx = len(messages) - keep_count
        to_compress = messages[:split_idx]
        to_keep = messages[split_idx:]

        if not to_compress:
            return messages

        messages_str = self.format_messages_str(to_compress)
        raw_content = ""

        try:
            logger.info(f"Layer 2 compression: compressing {len(to_compress)} messages")
            async for result in self._model_client.create_stream(
                messages=[UserMessage(source="user", content=self._compression_prompt + messages_str)],
                cancellation_token=cancellation_token,
            ):
                if not isinstance(result, str):
                    raw_content = result.content
                    break
        except Exception as e:
            logger.warning(f"Failed to compress conversation: {e}")
            raw_content = messages_str[:1000] + "\n...[truncated]"

        compressed_content = self._extract_summary(raw_content)

        # Store compressed summary
        await self.summry_conversation_to_memory(
            summary_content=compressed_content,
        )

        # Reassemble
        remaining = [
            UserMessage(content=f"[Compressed conversation history]\n\n{compressed_content}", source="compression")
        ] + to_keep

        return remaining

    @staticmethod
    def _extract_summary(llm_output: str) -> str:
        """Extract summary from LLM compression output."""
        match = re.search(r'<summary>(.*?)</summary>', llm_output, re.DOTALL)
        if match:
            return match.group(1).strip()
        cleaned = re.sub(r'<analysis>.*?</analysis>', '', llm_output, flags=re.DOTALL)
        return cleaned.strip()

    def format_messages_str(self, messages: List[LLMMessage]) -> str:
        """Format messages as string for compression."""
        content_str = "The conversations:\n\n"
        for message in messages:
            if isinstance(message, SystemMessage):
                content_str += f"System: {message.content}\n"
            elif isinstance(message, UserMessage):
                content_str += f"{message.source}: {message.content}\n"
            elif isinstance(message, FunctionExecutionResultMessage):
                content_str += f"Tool Results: {str([r.model_dump() for r in message.content])}\n"
            else:
                content_str += f"Assistant: {str(message.content)}\n"
        return content_str

    # -------------------------------------------------------------------------
    # Memory Operations (Replaces RAGFlow)
    # -------------------------------------------------------------------------

    # ------------------------------------------------------------------
    # FTS5 table names (globally managed by DatabaseManager)
    # ------------------------------------------------------------------
    _MSG_FTS = "session_messages_fts"
    _MSG_FTS_TRIGRAM = "session_messages_fts_trigram"
    _SUM_FTS = "session_summaries_fts"
    _SUM_FTS_TRIGRAM = "session_summaries_fts_trigram"

    @staticmethod
    def _sanitize_fts5_query(query: str) -> str:
        """Sanitize user input for safe FTS5 MATCH usage.

        FTS5 MATCH syntax treats these as special: ``AND``, ``OR``, ``NOT``,
        ``NEAR``, ``(``, ``)``, ``*``, ``"``, and leading ``^`` / trailing ``*``.

        Strategy:
          - Strip characters that are never safe inside a MATCH string.
          - Wrap each remaining token in double-quotes so FTS5 treats it as a
            literal phrase, not a column name or boolean operator.
        """
        # Remove FTS5 structural characters — keep letters, digits, whitespace,
        # CJK-range Unicode, and a few safe punctuation marks.
        cleaned = re.sub(r'[^\w\s\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af\-.]', ' ', query)
        # Collapse whitespace
        cleaned = ' '.join(cleaned.split())
        if not cleaned:
            return '""'
        # Wrap each word in double-quotes to defeat AND/OR/NOT interpretation
        tokens = ['"' + t + '"' for t in cleaned.split()]
        return ' '.join(tokens)

    async def retrieve_from_memory(
        self,
        question: str,
        page_size: int = 10,
        similarity_threshold: float = 0.2,
        metadata_condition: Optional[Dict[str, str]] = None,
    ) -> str:
        """Retrieve relevant information from SQLite memory via FTS5 search.

        Uses the global ``session_messages_fts`` table (external content,
        maintained by triggers on ``sessionmessage``) joined back to
        ``sessionmessage`` on ``rowid`` so results are filtered by
        ``thread_id``.

        Falls back to the trigram FTS table for CJK / substring queries
        when the standard tokenizer returns no results.

        This replaces RAGFlow vector retrieval for session history.
        Uses BM25 ranking for relevance scoring.
        """
        try:
            results: List[str] = []
            safe_query = self._sanitize_fts5_query(question)

            with self._db_manager.engine.connect() as conn:
                # --- Messages (standard unicode61 tokenizer) ---
                cursor = conn.execute(
                    text(f"""
                        SELECT sm.message_type, sm.content, bm25({self._MSG_FTS}) as rank
                        FROM {self._MSG_FTS}
                        JOIN sessionmessage sm ON sm.id = {self._MSG_FTS}.rowid
                        WHERE {self._MSG_FTS} MATCH :query
                          AND sm.thread_id = :thread_id
                        ORDER BY rank
                        LIMIT :limit
                    """),
                    {
                        "query": safe_query,
                        "thread_id": self._thread_id,
                        "limit": page_size,
                    },
                )

                for row in cursor.fetchall():
                    results.append(f"[Role: {row[0]}] {row[1]}")

                # --- Fallback: trigram tokenizer (CJK / substring) ---
                if not results:
                    cursor = conn.execute(
                        text(f"""
                            SELECT sm.message_type, sm.content, bm25({self._MSG_FTS_TRIGRAM}) as rank
                            FROM {self._MSG_FTS_TRIGRAM}
                            JOIN sessionmessage sm ON sm.id = {self._MSG_FTS_TRIGRAM}.rowid
                            WHERE {self._MSG_FTS_TRIGRAM} MATCH :query
                              AND sm.thread_id = :thread_id
                            ORDER BY rank
                            LIMIT :limit
                        """),
                        {
                            "query": safe_query,
                            "thread_id": self._thread_id,
                            "limit": page_size,
                        },
                    )
                    for row in cursor.fetchall():
                        results.append(f"[Role: {row[0]}] {row[1]}")

                # --- Summaries (standard tokenizer) ---
                cursor = conn.execute(
                    text(f"""
                        SELECT summary, bm25({self._SUM_FTS}) as rank
                        FROM {self._SUM_FTS}
                        WHERE {self._SUM_FTS} MATCH :query
                        ORDER BY rank
                        LIMIT :limit
                    """),
                    {
                        "query": safe_query,
                        "limit": page_size // 2,
                    },
                )
                for row in cursor.fetchall():
                    results.append(f"[Summary] {row[0]}")

                # --- Summaries trigram fallback ---
                if not any(r.startswith("[Summary]") for r in results):
                    cursor = conn.execute(
                        text(f"""
                            SELECT summary, bm25({self._SUM_FTS_TRIGRAM}) as rank
                            FROM {self._SUM_FTS_TRIGRAM}
                            WHERE {self._SUM_FTS_TRIGRAM} MATCH :query
                            ORDER BY rank
                            LIMIT :limit
                        """),
                        {
                            "query": safe_query,
                            "limit": page_size // 2,
                        },
                    )
                    for row in cursor.fetchall():
                        results.append(f"[Summary] {row[0]}")

            if results:
                return "**Relevant information:**\n\n" + "\n\n---\n\n".join(results[:page_size])
            else:
                return "No relevant information found."

        except Exception as e:
            logger.error(f"Failed to retrieve from memory: {e}")
            return f"Error retrieving memory: {e}"

    async def summry_conversation_to_memory(
        self,
        summary_content: str = None,
        keywords: Optional[List[str]] = None,
        questions: Optional[List[str]] = None,
    ) -> str:
        """Summarize current conversation and store in SQLite FTS.

        Writes a row to ``SessionSummary`` table and inserts into the
        globally-shared ``session_summaries_fts`` / ``session_summaries_fts_trigram``
        tables for full-text search.

        This replaces the RAGFlow upload for conversation summaries.

        Args:
            summary_content: Pre-generated summary (optional, will generate if not provided)
            keywords: Keywords to tag with the summary
            questions: Related questions for the summary

        Returns:
            The generated summary.
        """
        try:
            if summary_content is None:
                # Generate summary using LLM
                messages = list(self._messages)
                if not messages:
                    return "No messages to summarize."

                messages_str = self.format_messages_str(messages)
                summary_content = ""

                try:
                    async for result in self._model_client.create_stream(
                        messages=[UserMessage(
                            source="user",
                            content=f"""Summarize the following conversation concisely:

{messages_str}

Provide a brief summary covering:
1. Main topics discussed
2. Key decisions or conclusions
3. Any important information revealed

Format:
<summary>
[Your summary here]
</summary>"""
                        )],
                    ):
                        if not isinstance(result, str):
                            summary_content = result.content
                            break
                except Exception as e:
                    logger.error(f"Failed to generate summary: {e}")
                    return f"Error generating summary: {e}"

                summary_content = self._extract_summary(summary_content)

            kw_str = ", ".join(keywords) if keywords else ""

            # Store in SessionSummary table — triggers on sessionsummary now
            # keep session_summaries_fts / session_summaries_fts_trigram in sync
            # automatically (external-content pattern). No manual FTS INSERT needed.
            summary = SessionSummary(
                thread_id=self._thread_id,
                user_id=self._user_id,
                summary=summary_content,
                keywords=kw_str,
            )
            self._db_manager.upsert(summary, return_json=False)

            logger.info(f"Stored summary for thread {self._thread_id}")
            return summary_content

        except Exception as e:
            logger.error(f"Failed to store summary: {e}")
            return f"Error storing summary: {e}"

    async def read_session_memory_by_index(self, index: int) -> str:
        """Read original content from session history by index.

        Used to retrieve cleared tool results.
        """
        try:
            from sqlmodel import select

            with self._db_manager.engine.connect() as conn:
                result = conn.execute(
                    select(SessionMessage)
                    .where(SessionMessage.thread_id == self._thread_id)
                    .order_by(SessionMessage.created_at, SessionMessage.id)
                )

                rows = result.fetchall()
                if 0 <= index < len(rows):
                    row = rows[index]
                    return row.raw_message.get('content', str(row.raw_message))

            return f"Index {index} out of range."
        except Exception as e:
            return f"Error reading session memory: {e}"

    async def create_new_session_document(
        self,
        user_id: Optional[str] = None,
        dataset_id: Optional[str] = None,
        thread_id: Optional[str] = None,
        work_dir: Optional[str] = None,
        create_type: str = "session"  # or learning_memory
    ) -> str:
        """
        Create a new session document (stub for SQLite implementation).

        In the SQLite implementation, we don't need to create separate documents
        like RAGFlow does. The SessionMessage and SessionSummary tables
        automatically organize data by thread_id and user_id.

        This method is provided for API compatibility with DrSaiChatCompletionContext.

        Args:
            user_id: User identifier (defaults to self._user_id)
            dataset_id: Dataset identifier (not used in SQLite implementation)
            thread_id: Thread identifier (defaults to self._thread_id)
            work_dir: Working directory (not used in SQLite implementation)
            create_type: Type of document ("session" or "learning_memory")

        Returns:
            A document identifier string (thread_id or learning_memory_id)
        """
        user_id = user_id or self._user_id
        thread_id = thread_id or self._thread_id

        # For SQLite implementation, we don't need to create separate documents
        # Just return an identifier that can be used to track the session
        if create_type == "learning_memory":
            document_id = f"learning_{user_id}"
            logger.debug(f"Created learning memory document ID: {document_id}")
        else:
            document_id = f"session_{thread_id}"
            logger.debug(f"Created session document ID: {document_id}")

        return document_id

    def _to_config(self) -> DrSaiSQLiteContextConfig:
        """Convert to configuration object."""
        return DrSaiSQLiteContextConfig(
            thread_id=self._thread_id,
            user_id=self._user_id,
            token_limit=self._token_limit,
            compression_prompt=self._compression_prompt,
            tool_schema=self._tool_schema,
            tool_clear_whitelist=self._tool_clear_whitelist,
            keep_recent_tool_results=self._keep_recent_tool_results,
            min_content_length_to_clear=self._min_content_length_to_clear,
        )

    @classmethod
    def _from_config(
        cls,
        model_client: ChatCompletionClient,
        db_manager: DatabaseManager,
        config: DrSaiSQLiteContextConfig) -> "DrSaiSQLiteChatCompletionContext":
        """Create from configuration object."""
        return cls(
            model_client=model_client,  # Will be set externally
            db_manager=db_manager,    # Will be set externally
            thread_id=config.thread_id,
            user_id=config.user_id,
            token_limit=config.token_limit,
            compression_prompt=config.compression_prompt,
            tool_schema=config.tool_schema,
            tool_clear_whitelist=config.tool_clear_whitelist,
            keep_recent_tool_results=config.keep_recent_tool_results,
            min_content_length_to_clear=config.min_content_length_to_clear,
        )

    async def close(self) -> None:
        """Close and flush all pending messages."""
        self._flush_to_db()
