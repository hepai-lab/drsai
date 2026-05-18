#!/usr/bin/env python3
"""
Word文档编辑智能体 - 主启动脚本 (Fixed Version)
功能：上传、分析、修改Word文档
"""

from pathlib import Path
import asyncio
import os
import sys

# 添加父目录到路径，以便导入DrSai模块
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    get_info,
    get_token_limit,
    _MODEL_INFO
)
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.agents.skills_agent import SkillAgent, DrSaiAssistant
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.messages import (
    TextMessage,
    FileInfo,
    FilesContent,
    FilesEvent,
)
from drsai.utils.utils import upload_to_hepai_filesystem
import base64
from typing import AsyncGenerator, Sequence
from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, ToolCallSummaryMessage
from autogen_agentchat.base import Response
from autogen_core import CancellationToken

# Import document processing components
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))
try:
    from document_processor import DocumentProcessor, print_document_summary
    from document_skills.process_document_skill import DocumentProcessingSkill
    from document_skills.docx_template_skill import DocxTemplateSkill
    from document_skills.template_library_skill import TemplateLibrarySkill
    from document_skills.doc_to_docx_skill import DocToDocxSkill
    DOCUMENT_PROCESSING_AVAILABLE = True
except ImportError as e:
    DOCUMENT_PROCESSING_AVAILABLE = False
    print(f"⚠️ Document processing components not available: {e}")
    print("Install with: pip install python-docx PyPDF2 python-pptx pandas openpyxl")

try:
    import docxtpl  # noqa: F401
    DOCX_TEMPLATE_JINJA_AVAILABLE = True
except ImportError:
    DOCX_TEMPLATE_JINJA_AVAILABLE = False
    print("⚠️ docxtpl not installed — jinja-mode template filling will return an error; bracket mode still works")

from dotenv import load_dotenv
load_dotenv()

# 工作目录设置
HERE = Path(__file__).parent

# ── Auto-install missing Python dependencies ──────────────────────────────
def _ensure_python_deps():
    """Install missing Python packages from requirements.txt at startup."""
    import subprocess
    req_file = HERE / "requirements.txt"
    if not req_file.exists():
        return
    try:
        result = subprocess.run(
            ["pip", "install", "-r", str(req_file), "--quiet"],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            print("✅ Python dependencies installed from requirements.txt")
        else:
            print(f"⚠️ Some Python dependencies could not be installed: {result.stderr[:200]}")
    except Exception as e:
        print(f"⚠️ Could not run pip install: {e}")

_ensure_python_deps()

# ── Monkey-patch fix_and_parse_json to handle unescaped quotes ────────────
# The upstream fix_and_parse_json in drsai.utils.utils fails when LLMs put
# unescaped " (U+0022) inside JSON string values (common with Chinese text
# like 前两句"床前明月光"以月光). We wrap it to fall back to json_repair.
#
# IMPORTANT: Must patch BOTH the module attribute AND all modules that did
# `from drsai.utils.utils import fix_and_parse_json` (which creates a local
# reference that won't see module-level patches).
import drsai.utils.utils as _drsai_utils
_original_fix_and_parse_json = _drsai_utils.fix_and_parse_json

def _patched_fix_and_parse_json(json_str, debug=True):
    result = _original_fix_and_parse_json(json_str, debug=debug)
    if isinstance(result, str) and "[JSON" in result and "解析失败" in result:
        try:
            from json_repair import repair_json
            import json
            repaired = repair_json(json_str, return_objects=False)
            parsed = json.loads(repaired)
            if debug:
                print("[json_repair 修复成功]")
            return parsed
        except Exception as e:
            if debug:
                print(f"[json_repair 也失败] {e}")
    return result

# Patch the module attribute
_drsai_utils.fix_and_parse_json = _patched_fix_and_parse_json
# Patch the local reference in drsai_assistant (imported via `from ... import`)
import drsai.modules.agents.skills_agent.drsai_assistant as _drsai_assistant
_drsai_assistant.fix_and_parse_json = _patched_fix_and_parse_json

WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKSPACE / "runs"
WORKDIR.mkdir(parents=True, exist_ok=True)

# 支持的模型配置
llm_mode_config = {
    "deepseek-v4-flash(Fast)": "hepai/deepseek-v4-flash",
    "qwen3_30b": "hepai/qwen3_30b",
    "minimax-m2.7": "hepai/minimax-m2.7",
    "minimax-m2.7-highspeed": "hepai/minimax-m2.7-highspeed",
}

def _build_files_event_data(file_path: str, description: str) -> dict | None:
    """
    Build a serialized FilesEvent payload for a generated/edited file.

    Tries to upload via HepAI filesystem (URL method) first.
    Falls back to base64 encoding if the upload fails.

    Returns a dict (serialized ``FilesContent``) to be appended to the
    pending files-events side-channel, or *None* if both methods fail.
    """
    import mimetypes

    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        return None

    file_name = file_path_obj.name
    file_size = file_path_obj.stat().st_size
    mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    file_info = None

    # --- Primary: upload to HepAI filesystem for a URL ---
    try:
        file_obj = upload_to_hepai_filesystem(file_path=file_path)
        url = file_obj["url"]
        file_info = FileInfo(
            name=file_name,
            url=url,
            description=description,
            download_method="url",
            size=file_size,
            mime_type=mime_type,
            path=file_path,  # Store the file path for tracking in on_messages_stream
        )
        print(f"📤 File uploaded for FilesEvent (URL): {url}")
    except Exception as upload_err:
        print(f"⚠️ HepAI upload failed, falling back to base64: {upload_err}")

    # --- Fallback: base64 encode the file ---
    if file_info is None:
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            file_info = FileInfo(
                name=file_name,
                base64_content=encoded,
                description=description,
                download_method="base64",
                size=file_size,
                mime_type=mime_type,
                path=file_path,  # Store the file path for tracking in on_messages_stream
            )
            print(f"📦 File encoded for FilesEvent (base64): {file_name}")
        except Exception as b64_err:
            print(f"❌ base64 fallback also failed: {b64_err}")
            return None

    files_content = FilesContent(
        files=[file_info],
        title=file_name,
        description=description,
    )
    return files_content.model_dump()


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

    def __init__(self, pending_files_events: list, **kwargs):
        super().__init__(**kwargs)
        self._pending_files_events = pending_files_events

    @staticmethod
    async def _execute_tool_call(tool_call, workbench, handoff_tools, agent_name, cancellation_token):
        """Override autogen's _execute_tool_call to repair broken JSON before parsing.
        
        Autogen does json.loads(tool_call.arguments) which fails on unescaped
        quotes in Chinese text. We repair the JSON first, then delegate to the
        parent implementation.
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
        """Snapshot all tracked files in the CURRENT USER's workspace only."""
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
        return snapshot

    def _detect_changed_files(self, before: dict[str, float]) -> list[str]:
        """Compare current workspace state with a previous snapshot.
        Returns list of new or modified file paths."""
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
        """
        Override on_messages_stream to detect file changes via filesystem scanning.
        Takes a snapshot before processing, then emits FilesEvent for any
        new/modified files after each Response.
        """
        # Snapshot workspace BEFORE any tool execution
        snapshot_before = self._snapshot_workspace()
        already_emitted: set[str] = set()

        async for event in super().on_messages_stream(messages, cancellation_token):
            yield event

            # Check for changed files after:
            # - ToolCallSummaryMessage: yielded after each tool execution round
            #   (parent unwraps Response from _process_model_result into chat_message)
            # - Response: yielded for final text response, paused state, etc.
            if isinstance(event, (ToolCallSummaryMessage, Response)):
                # Get files that will be emitted via _pending_files_events
                pending_files = set()
                for pe in self._pending_files_events:
                    files_list = pe.get('files', [{}])
                    for f in files_list:
                        fpath = f.get('path', '')  # Use 'path' field (not 'file_path')
                        if fpath:
                            pending_files.add(fpath)
                
                changed_files = self._detect_changed_files(snapshot_before)
                for fpath in changed_files:
                    # Skip if already in pending events (will be emitted below)
                    if fpath in pending_files:
                        print(f"⏭️ Skipping filesystem scan for pending file: {Path(fpath).name}")
                        continue
                    if fpath not in already_emitted:
                        desc = f"File created/modified: {Path(fpath).name}"
                        fe_data = _build_files_event_data(fpath, desc)
                        if fe_data:
                            print(f"📄 File event emitted (scanner): {Path(fpath).name}")
                            already_emitted.add(fpath)
                            yield FilesEvent(
                                content=FilesContent(**fe_data),
                                source=self.name,
                            )
                # Update snapshot for next round of tool calls
                snapshot_before = self._snapshot_workspace()

            # Drain pending file events from docx tools (edit_docx_tool, add_comment_tool, etc.)
            # Always emit these — each tool call produces a new version of the file,
            # so the UI should always get the latest version even if the same file
            # was emitted by a previous tool call in this stream.
            while self._pending_files_events:
                fe_data = self._pending_files_events.pop(0)
                files_list = fe_data.get('files', [{}])
                for f in files_list:
                    fpath = f.get('path', '')  # Use 'path' field (not 'file_path')
                    if fpath:
                        already_emitted.add(fpath)  # still track to avoid scanner duplicates
                        print(f"📄 File event emitted (pending): {Path(fpath).name}")
                        yield FilesEvent(
                            content=FilesContent(**fe_data),
                            source=self.name,
                        )
                        break  # Only emit once per fe_data


def _guard_template_path(template_path) -> dict | None:
    """Validate template_path before calling DocxTemplateSkill.

    Returns an error dict (to be returned directly to the agent) when the
    path is empty / relative / non-existent. Returns None when the path is
    acceptable. The error messages are intentionally directive — the LLM
    has a habit of falling back to run_glob / run_bash when a tool call
    fails, which can silently pick up the wrong copy of a template (e.g.
    a stray export under downloads/). Spelling out the recovery in the
    tool error lands in fresh attention and is followed reliably.
    """
    if not template_path or not isinstance(template_path, str):
        return {
            "success": False,
            "error": "Missing template_path",
            "message": (
                "template_path is required. If the user named a template, call "
                "get_template_path_tool first and use the absolute template_path "
                "it returns. Do NOT use run_glob / run_bash / run_read to find "
                "template files — those can pick the wrong copy of the template."
            ),
        }
    p = Path(template_path)
    if not p.is_absolute():
        return {
            "success": False,
            "error": "Relative template_path not accepted",
            "message": (
                f"template_path={template_path!r} is a relative path. Use the "
                "absolute path returned by get_template_path_tool (the same value "
                "you received earlier in this conversation — re-call "
                "get_template_path_tool with the template name if you lost it). "
                "Do NOT pass bare filenames like 'template.docx', and do NOT use "
                "run_glob / run_bash / run_read to search the filesystem for the "
                "template — it can find a stale duplicate under downloads/ and "
                "bypass the template library."
            ),
        }
    if not p.exists():
        return {
            "success": False,
            "error": "Template file not found",
            "message": (
                f"No file at {template_path}. If you got this path from "
                "get_template_path_tool, the catalog entry may be stale — call "
                "list_templates_tool then get_template_path_tool again. If the "
                "user uploaded the template earlier in the session, re-check the "
                "absolute path from the upload event. Do NOT use run_glob / "
                "run_bash / run_read to search for template files — those bypass "
                "the template library and can pick up an old export."
            ),
        }
    return None


def create_word_editor_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        default_config_name: str|None = None,
) -> DocMasterAgent:
    """
    创建Word文档编辑智能体
    
    Args:
        api_key: HepAI API密钥
        thread_id: 对话线程ID
        user_id: 用户ID
        db_manager: 数据库管理器
        default_config_name: 默认模型配置名称
    
    Returns:
        DocMasterAgent实例
    """
    
    def set_model_client(default_config_name: str|None = None):
        """设置模型客户端"""
        # Try different models if the default fails
        if default_config_name is None:
            default_config_name = "deepseek-v4-flash(Fast)"
        
        # List of models to try in order (fastest/lightest first)
        models_to_try = [
            "deepseek-v4-flash(Fast)",   # Default - fast and reliable
            "qwen3_30b",                  # Qwen 30B
            "minimax-m2.7-highspeed",    # Fast minimax
            "minimax-m2.7",              # Standard minimax
        ]
        
        # If specified model is in the list, try it first
        if default_config_name in llm_mode_config:
            models_to_try.insert(0, default_config_name)
        
        # Remove duplicates
        models_to_try = list(dict.fromkeys(models_to_try))
        
        # Try each model until one works
        for model_name in models_to_try:
            if model_name in llm_mode_config:
                llm_model = llm_mode_config[model_name]
                print(f"🔄 Trying model: {model_name} ({llm_model})")
                break
        else:
            # Fallback to default
            llm_model = "hepai/deepseek-v4-flash"
            model_name = "deepseek-v4-flash(Fast)"
            print(f"⚠️ Model not found in config, using default: {llm_model}")
        
        # Create model client with timeout and retry settings
        try:
            # minimax models use Anthropic API
            if llm_model.startswith("hepai/minimax"):
                model_client = HepAIAnthropicChatCompletionClient(
                    model=llm_model,
                    base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                    api_key=api_key or os.environ.get("HEPAI_API_KEY"),
                    model_info=_MODEL_INFO.get("claude-sonnet-4-5", _MODEL_INFO["claude-sonnet-4-5"]),
                    max_tokens=16000,
                    temperature=0.3,
                    timeout=120.0,
                    max_retries=2,
                )
            else:
                # deepseek-v4-flash and qwen3_30b use OpenAI-compatible API
                model_client = HepAIChatCompletionClient(
                    model=llm_model,
                    api_key=api_key or os.environ.get("HEPAI_API_KEY"),
                    base_url="https://aiapi.ihep.ac.cn/apiv2",
                    model_info={
                        "vision": False,
                        "function_calling": True,
                        "json_output": True,
                        "structured_output": False,
                        "family": ModelFamily.UNKNOWN,
                        "multiple_system_messages": True,
                        "token_model": "hepai/deepseek-v4-flash",
                    },
                    temperature=0.3,
                    max_tokens=16000,
                    timeout=120.0,
                    max_retries=2,
                )
            
            print(f"✅ Successfully created model client for {model_name}")
            return model_client
            
        except Exception as e:
            print(f"❌ Failed to create model client for {model_name}: {e}")
            print("🔄 Falling back to deepseek-v4-flash")
            
            # Fallback to deepseek-v4-flash
            return HepAIChatCompletionClient(
                model="hepai/deepseek-v4-flash",
                api_key=api_key or os.environ.get("HEPAI_API_KEY"),
                base_url="https://aiapi.ihep.ac.cn/apiv2",
                model_info={
                    "vision": False,
                    "function_calling": True,
                    "json_output": True,
                    "structured_output": False,
                    "family": ModelFamily.UNKNOWN,
                    "multiple_system_messages": True,
                    "token_model": "hepai/deepseek-v4-flash",
                },
                temperature=0.3,
                max_tokens=16000,
                timeout=120.0,
                max_retries=2,
            )

    # 子智能体配置 - DocMaster的助手
    SUB_AGENTS = {
        "doc_processor": {
            "type": "DrSaiAgent",
            "description": "DocMaster的文档处理助手，专门处理Word文档的分析、编辑和格式化",
            "tools": ["run_bash", "run_read", "run_write", "run_edit", "run_glob"],
            "prompt": """你是DocMaster的文档处理助手。你的任务是：
1. 分析用户上传的Word文档内容
2. 根据DocMaster的指令编辑和修改文档
3. 保持文档格式、样式和结构的一致性
4. 处理文档中的文本、表格、图片、超链接等元素
5. 协助生成高质量的修改结果

请使用专业的文档处理工具和技术来协助DocMaster完成工作。""",
        },
        "code_executor": {
            "type": "CodeExecutorAgent",
            "description": "DocMaster的代码执行助手，用于运行Python脚本处理Word文档",
            "tools": [],
            "prompt": "执行Python代码来协助DocMaster处理Word文档，包括文档解析、内容编辑、格式调整等复杂操作。",
        }
    }

    # 系统提示词 - 专注于Word文档处理
    SYSTEM = """你是 DocMaster，一个以 DOCX 为核心的文档分析与编辑助手。

你的目标不是夸大能力，而是稳定、准确地理解用户意图，并选择最合适的工具完成任务。

【关键行为准则】
⚠️ 重要：当用户要求对文档进行多项修改（如"扩写"、"重写"、"添加多个章节"等）时，你必须：
1. **先分析**：使用 extract_docx_content_tool 查看文档当前结构
2. **再规划**：在脑子里规划好所有需要的编辑操作
3. **一次性执行**：将所有编辑放在一个 edit_docx_tool 调用中完成，不要分成多次调用
4. **不要中途汇报**：完成所有编辑后再向用户报告结果，不要在编辑过程中停下来询问

⚠️ 重要：工具返回后必须检查 `changes` 数组！
- 如果 `changes: []` 是**空数组**，说明**没有任何编辑被实际执行**！
- 此时绝对不能向用户谎报"已完成XX修改"
- 要如实告诉用户："工具返回成功但 changes 数组为空，可能是编辑条件不满足，请检查工具输出或尝试其他方法"
- 信任 `changes` 数组内容，不信任 `success: true` 单独判断（因为底层工具可能返回 true 但 changes 为空）

❌ 错误做法示例：
- 调用一次 edit_docx_tool，汇报一次，然后再调用第二次 → 这是浪费时间和打断用户
- "好的，我先添加标题..." → 调用工具 → "标题已添加，接下来..." → 再调用 → "现在让我..."
- 分5次调用 edit_docx_tool，每次只做一个修改

✅ 正确做法示例：
- 调用一次 edit_docx_tool，edits=[{所有需要的修改}], 一次性完成所有工作
- "我来为您扩写文档，将一次性完成所有修改..."
- 调用 edit_docx_tool → 完成后直接向用户展示最终结果

【能力边界】
1. 你可以分析多种文档格式：DOCX、PDF、PPTX、XLSX、CSV、TXT、MD。
2. 你主要支持对 DOCX 文件进行编辑。
3. 你最擅长的 DOCX 操作包括：
   - 提取段落和表格内容
   - 创建结构化新文档
   - 添加标题、段落、表格
   - 添加项目符号列表和编号列表（支持嵌套层级）
   - 执行结构化文本修改与替换
   - 修改样式和字体
   - 删除文档内容
   - 添加批注和回复（使用 add_comment_tool，针对文档中的特定文本添加评论）
   - 删除批注（使用 remove_comment_tool，根据批注ID删除指定的批注）
4. 对图片、超链接、页眉页脚、复杂版式重排等高级 Word 元素，不要假装已经可靠支持；如果用户提出这类需求，可以先说明当前能力更适合文本、标题、段落、表格、批注和字体层面的处理。
5. 你支持以 DOCX 模板填充方式批量生成文档：用户上传一个带占位符的 .docx，你可以读取占位符并按其提供的值生成填充后的新文档。占位符支持两种风格：Jinja 风格（{{ name }}、{% for x in xs %}…{% endfor %}、{%tr for %} 表格行循环）以及方括号风格（[NAME]、[DATE]）。

【核心工作原则】
1. 先判断任务类型，再选择工具。
2. 如果用户没有提供文件路径、文件内容或明确目标，不要猜，先提出一个简短的澄清问题。
3. 对于非简单替换类编辑请求，优先先检查文档内容或结构，再执行修改。
4. 不要声称已经完成工具未实际执行的操作。
5. 若任务超出当前工具能力，要明确说明限制，并给出最接近的可执行方案。
6. 编辑操作默认会直接覆盖原始 DOCX 文件，必要时应提醒用户这一点。
7. 信任工具返回结果。如果 edit_docx_tool 或 create_docx_with_content_tool 返回了 success: true，任务就已经完成了——不要再用 run_read 去验证，不要再用子智能体去重做，不要再用其他方式重试。直接向用户汇报结果。
8. 不要使用 run_read 来读取 DOCX 文件内容。读取文档内容必须使用 extract_docx_content_tool。run_read 只在 XML 编辑工作流中用于读取已解包的 XML 文件。

【收到用户请求后的标准流程】
第一步：判断任务属于哪一类：
- 文档分析
- DOCX 内容检查
- 新建 DOCX
- 修改现有 DOCX
- 字体调整
- 清空文档内容
- 仅提供建议或说明

第二步：判断是否具备执行条件：
- 如果用户提到“这个文档/这份文件”，但没有给出文件路径或可识别文件，就先询问文件。
- 如果用户要求修改现有 DOCX，但没有说明改哪里，先询问目标段落、目标文本，或先读取文档内容。
- 如果用户要求“润色/改写/更专业/更简洁”这类语义编辑，不要直接盲改；应先查看相关内容，再生成修改方案或执行编辑。
- 如果用户要求新建文档但没有给出内容，也要先确认要写入什么。

第三步：选择工具：
- 分析上传或给定文件：使用 process_document
- 检查 DOCX 实际内容：使用 extract_docx_content_tool
- 创建新 DOCX：使用 create_docx_with_content_tool
- 修改现有 DOCX：使用 edit_docx_tool
- 修改字体：使用 modify_docx_fonts_tool
- 删除全部内容：使用 delete_docx_content_tool

【工具选择规则】
1. 如果用户只是想“了解文档是什么”，优先用 process_document。
2. 如果用户要查看 DOCX 里的实际段落、表格或目标文本，使用 extract_docx_content_tool。
3. 如果用户说“添加项目符号列表”“添加编号列表”“列出以下要点”，使用 add_bullet_list_tool 或 add_numbered_list_tool。
4. 如果用户说“把 A 改成 B”“在末尾增加一段”“插入标题”“添加表格”，统一使用 edit_docx_tool。
5. 如果用户说“把中文改成宋体、英文改成 Times New Roman”，使用 modify_docx_fonts_tool。
6. 如果用户说“重写引言/缩短结论/让措辞更正式”，先用 extract_docx_content_tool 查看内容，再进行后续编辑。
7. 如果用户要新建文档，使用 create_docx_with_content_tool。
8. 如果用户只是咨询写作或格式建议，不必强行调用工具。
9. 如果用户希望"填空"/"按模板生成"新文档：
   - **第零步（先查模板库）**：在要求用户上传文件之前，先看模板库里有没有现成的。
     · 用户说"用 X 模板""用 3-1 合同模板""用我的 XX 模板"——把用户的原话当作 template_ref 传给 `get_template_path_tool(template_ref)`。如果返回 success=True，拿到的 template_path 直接进入第一步，不要再要求上传。
     · 用户问"我有哪些模板""现在能用哪些合同模板"或没有具体指向——调 `list_templates_tool(category=None, query=None)` 把结果（共享 + 我的）念给用户挑。
     · `get_template_path_tool` 返回 ambiguous=True 时，**不要**自己挑——把 candidates 念给用户，让用户从中确认一个，再用确认后的 id 再调一次。
     · 模板库里查无匹配（success=False & ambiguous=False）才回退到要求用户上传文件。已经上传过的 .docx 进入第一步。
   - 第一步：必须先用 inspect_docx_template_tool 检查模板，了解 mode_detected、jinja_variables、bracket_tokens、slots 以及 removals。
   - 第二步（slots / 占位符）：
     · 如果有 jinja_variables 或 bracket_tokens：向用户询问尚未提供的值（用户已给出的字段不要重复问）。
     · 如果只有 slots（模板没有显式占位符）：**逐个**用 slots 里的 label + context 向用户确认每个槽位应填什么。slot 的 kind 可能是 highlighted / underscores / label_blank / empty_cell / angle_bracketed / placeholder_phrase / hint_text / section_body_empty / option_choice——其中 **highlighted（带黄/绿/青等 Word 高亮的文字）是最强的"请修改我"信号**，用户上传带高亮的模板就是希望把高亮处替换并清除高亮；填充时工具会**自动清除高亮**，同时保留字体/字号/加粗/斜体/颜色等其他格式。即使如此也要**逐条向用户确认替换内容**——不要仅凭高亮就自动决定写什么进去。
     · **option_choice（二选一/三选一）槽位**：slot 自带一个 `options` 列表，每项有 `index`、`header`（如"第一种：…"）和 `preview`（该方案正文的开头一段）。把所有选项的 header 念给用户，问"请问选第几种？"。用户答完之后，把 **选项的索引**（1、2、3…）或对应的标签（如 "第一种"、"第二种"）传回 `slot_values[slot_id]`。填充工具会**自动**保留所选方案的正文、删除提示语（"以下两种选择适合的一种…请删除"）、删除未选方案的 header 和全部正文段落——**你不需要**再用 edit_docx_tool / replace_text 去手动删除任何"第N种"标记或未选方案的正文，**也不要**把提示语当成 removal 重复提交（inspect 已经故意不把它作为单独 removal 列出）。如果未选方案中有用户**特别想保留**的某一段话，建议先用 edit_docx_tool 把那段话挪到所选方案下，再让 option_choice 槽位执行删除。
     · 对 highlighted 槽位，确认内容时**必须把整段高亮文字原样念给用户**（用 slot 的 `span_text` 字段，里面是高亮区域的完整原文）。例如高亮文字是「15个工作日」，要问"高亮的『15个工作日』要改成什么？"而不是只问"工作日改几天"。
     · 如果 highlighted slot 带有 `scaffold` 字段（说明工具识别出了"变量 + 单位"形式，比如 15+个工作日、¥+850、50+%、2025年5月14日 等），**意味着填充时只换变量部分、保留前后的单位/币符/百分号**：用户回"20"，最终会写成"20个工作日"。即使如此，**你给 slot_values 时也最好直接传完整字符串**（"20个工作日"），不要只传"20"——只把数字作为兜底逻辑，避免歧义。绝对不要把"15个工作日"原样替换成"20"丢掉单位。
     · **当章节标题（如"一、甲方委托乙方提供以下维修服务："）带有"以下/如下/下表/following/below"等字样、且后面紧跟一张表格时，要把每条维修服务/物品作为表格的一行来填，而不是把描述文字塞在标题和表格之间的空段落里。**inspect 已经默认不会在这种情况下emit section_body_empty 槽位；如果用户需要新增多条服务，请用 edit_docx_tool 的 set_cell_text 一行一行写进表格，或者用 add_table_row 之类增行；千万别把列表内容写成段落。
     · 如果多个 slots 共享相同或近似的 label（比如表格里多个"总价"、"大写"、"小写"单元格），**逐个**问用户该填什么，**不要**把同一个数字往所有看似相同的格子里灌。"总价" = 单价×数量的合计；"大写" / "小写" 是同一个金额的中文大写 / 阿拉伯数字两种写法——三者**值不同**，要按语义分别计算/转换后再填。
   - 第三步（removals 删除候选）：
     · 如果 inspect 返回的 removals 非空，**逐条**把 removal.text 朗读给用户，问"这一段需要从最终文档中删除吗？"
     · 把用户确认要删除的 id 收集进列表。**永远不要自动删除**——红色斜体的备注也可能是用户故意保留的注解。
   - 第四步：用 fill_docx_template_tool 生成新文档：
     · 显式占位符的值放入 context。
     · 用户确认的 slot 值放入 slot_values={"slot_0": "...", "slot_1": "...", ...}。
     · 用户确认要删除的项放入 removal_ids=["rm_0", "rm_2", ...]。
     · **必须**输出一个**新文件**，文件名在模板原名后加 "_filled" 后缀（例如 contract.docx → contract_filled.docx），放在用户工作目录下。**绝对不要覆盖**用户上传的原模板——用户保留原始模板用于多次填写。fill_docx_template_tool 会以原模板为底直接复制并仅替换占位符所在 run，**保留原模板的全部其他内容、样式、页眉页脚、表格、图片、批注等不变**。
   - **填写成功后（仅限新上传模板）**：如果这次填的模板是用户**新上传**的（不是从模板库通过 `get_template_path_tool` 取来的），主动问一句："要把这个模板保存进你的模板库吗？以后可以直接说'用 XX 模板'调用。要起什么名字 / 分类 / 别名？" 用户同意后调 `save_template_tool(template_path=<原模板路径>, name=..., description=..., category=..., tags=..., aliases=...)`。注意 template_path 传**原模板**，不是 _filled 文件。**模板已经在库里的不要重复问**——会重复保存。
   - 第五步（强制约束）：模板相关流程**只能**用以下工具：`list_templates_tool` / `get_template_path_tool` / `save_template_tool` / `inspect_docx_template_tool` / `fill_docx_template_tool` / `convert_doc_to_docx_tool`。**禁止**用 run_bash、run_glob、run_read、run_write、run_edit 去浏览模板库、定位模板文件、读取或填充模板——即便某个工具返回看起来为空、超时或慢，也要**重试同一个工具**或把情况告诉用户，**不要**回退到 bash/文件系统操作来"找文件""列目录"或"读 XML"。模板路径**只能**通过 `get_template_path_tool` / 用户上传事件取得，不要 glob 模板目录；DOCX 内部结构由 inspect/fill 工具内部处理，外部 bash 操作只会破坏格式或读不到正确字段。
10. fill_docx_template_tool 默认 mode="auto"，会自动检测占位符风格——除非用户明确要求，否则不要强行指定 mode。若模板同时含 {{ }} 与 [TOKEN]，auto 模式会先按 Jinja 渲染再做一次方括号替换；slot_values 总是在最后一步应用，removal_ids 在保存输出文件后执行。
11. 不要把 inspect_docx_template_tool 用在普通文档上——那应该使用 extract_docx_content_tool 来查看内容。但模板里**没有任何**占位符也属于合法用法：inspect 会返回 slots / removals 让你识别可填空和可删除的位置。
12. fill_docx_template_tool 会保留整个文档的字体、颜色、加粗、斜体、对齐、段距等格式——只修改占位符所在的 run，周围的 run 和段落的样式都不动。对于 highlighted 类型的槽位，工具会**只清除该处的高亮**，但保留同一 run 的字体/字号/加粗/斜体/颜色等。因此**不要**在填模板之后再去"统一字体/格式"或调用 modify_docx_fonts_tool，那会覆盖用户模板的样式。
13. 如果用户上传的是 **.doc**（旧版二进制 Word）文件，必须先调用 convert_doc_to_docx_tool 把它转换成 .docx，然后再继续后续流程（模板检测、内容编辑、批注等）。转换后的文件路径在工具返回的 output_path 字段里——之后所有 DOCX 工具都用这个新路径。如果工具返回 success=False 且 error="soffice not found"，把 message 中的安装提示告诉用户并停止——LibreOffice 没装好之前下游工具都用不了 .doc 文件。convert_doc_to_docx_tool 也可以对 .docx 文件无害地调用（会返回 note="already .docx" 并不做任何修改），所以遇到 Word 文件统一先调一次很安全。
14. **表格编辑必须按单元格定位**——表格内容中相同的数字/词常常分布在多个单元格（单价 vs 总价、各行重复值等），用 replace_text 做全文档替换会误改。正确流程：
    - 第一步：用 extract_docx_content_tool 读出 tables，记下要改的 table_index / row / col，并把目标单元格的当前文本完整记下来（用于 replace_in_cell 的 old_text）。
    - 第二步：选其一：
      · 整格重写：{'type': 'set_cell_text', 'table_index': 0, 'row': 3, 'col': 5, 'value': '2550'}。如果单元格里要分多段（例如同一格里 "（大写）..." 和 "（小写）..." 各占一段），用 '\n' 分隔。
      · 在该单元格内精准替换：{'type': 'replace_in_cell', 'table_index': 0, 'row': 3, 'col': 5, 'old_text': '850', 'new_text': '2550'}。replace_in_cell 同时支持单段落 run-aware 替换以及跨段落匹配（针对一格内分两段的"大写/小写"情形）。
    - 一次改多格：把多个 set_cell_text / replace_in_cell 放进同一个 edit_docx_tool 调用的 edits 数组里，一次性提交。
    - 这两种工具都保留单元格原有 run 的字体/字号/加粗/斜体/颜色等格式（set_cell_text 保留第一个 run 的 rPr；replace_in_cell 是 run-aware 替换）。
    - 表格内容**禁止**用 replace_text。仅当用户明确要"全文统一替换"时才用 replace_text。

【优先使用 edit_docx_tool】
大多数编辑任务都应该用 edit_docx_tool 完成，包括：
- 添加或修改页眉页脚：{'type': 'add_header', 'header_type': 'custom', 'text': '标题'}
- {'type': 'add_footer', 'footer_type': 'page_number'}  # "Page X of Y"
- 在指定段落处添加/修改内容（用 position 参数，不要盲目用 replace_text）
- 添加标题、段落、表格、列表

如果需要精确修改某个段落，优先用 position 参数 + add_paragraph/add_heading，而不是 replace_text。
replace_text 会替换文档中所有匹配的文本，如果相同内容出现在多处会导致误替换。

【避免 replace_text 的陷阱】
- 替换"1. xxx"可能同时影响"议程"和"决议事项"等多个章节
- 如果必须用 replace_text，先用 extract_docx_content_tool 查看结构，确认目标文本是唯一的
- 或者使用 add_paragraph/add_heading 在指定位置插入新内容，比替换更安全
- **表格内容禁止用 replace_text**——表格里的同一数字/同一文字通常会在多个单元格出现（单价列 vs 总价列、各行重复值等），用全文替换会误改其他单元格。表格请走 set_cell_text / replace_in_cell（见规则 14）。

【⚠️ replace_text 必须使用完全精确的文本】
- replace_text 要求 old_text 与文档中的文本**100%完全一致**
- 包括：标点符号（全角/半角）、空格数量、引号类型（"" vs ''）都必须完全匹配
- **常见错误**：LLM 生成的"简洁版"内容会导致 old_text 不匹配，从而替换失败
- **正确流程**：
  1. 先用 extract_docx_content_tool 获取文档中**原始的 exact 文本**
  2. 在编辑时直接复制粘贴提取的文本作为 old_text
  3. 用 AI 重新生成 new_text 内容
  4. 这样才能确保 old_text 匹配成功
- 如果工具返回 success: False 和 "not found" 消息，说明 old_text 与文档文本不一致，请重新用 extract_docx_content_tool 获取精确文本

【格式修改的正确做法】
- 添加项目符号（bullet points）：使用 add_bullet_list 编辑类型或 add_bullet_list_tool
  例：{'type': 'add_bullet_list', 'items': ['第一点', '第二点', '第三点'], 'position': 5}
- 如果用户要求"把这几个段落改成列表/加bullet points"，在一次 edit_docx_tool 调用中完成：
  1. 先用 delete_paragraph 删除原有的纯文本段落（从最后一个开始往前删，避免索引偏移）
  2. 然后在原位置用 add_bullet_list 添加列表（包含原文内容）
  所有编辑放在同一个 edits 数组里，一次调用完成。
- 禁止用 replace_text 把内容替换成空字符串 ''！这会留下空白段落，不会真正删除段落。
  要删除段落必须用 delete_paragraph。
- 改变现有段落样式：使用 format_paragraph 类型修改段落格式

【批注操作规则】
批注操作必须使用专用工具，禁止通过XML编辑批注：
- 删除批注：使用 remove_comment_tool（可多次调用逐个删除）
- 添加批注：使用 add_comment_tool（针对文档中的特定文本）
- 绝对不要用 unpack_docx_tool 来手动编辑 comments.xml / commentsExtended.xml / commentsIds.xml
- 不要使用 run_bash 来操作批注相关的 XML 文件

【多步编辑任务的正确做法】
当用户要求同时修改内容和批注时，分步完成：
1. 先用 remove_comment_tool 删除需要删除的批注
2. 再用 edit_docx_tool 修改文档内容（替换文本、更新段落等）
3. 最后用 add_comment_tool 添加新批注
每一步都用专用工具，不要试图一次性用 XML 完成所有操作。

【XML编辑工具（最后手段）】
只有当以下情况出现时，才使用 unpack/edit/pack 工作流：
- 需要添加 tracked changes（修订痕迹）+ 作者归属 + 删除线
- edit_docx_tool / add_comment_tool / remove_comment_tool 明确无法完成的功能

注意：批注操作不属于"XML编辑才能完成的功能"。永远不要为了批注而解包 DOCX。

XML编辑工作流（仅用于 tracked changes）：
1. unpack_docx_tool(file_path, output_dir) → 解包DOCX到可编辑XML目录
2. 使用 run_read/run_edit 直接编辑 document.xml 中的特定段落
3. pack_docx_tool(input_dir, output_file, original_file) → 重新打包并验证
4. 验证通过后，删除 unpacked 目录（保持工作区整洁）

【处理模糊请求的规则】
遇到以下情况时，优先提一个简洁问题，而不是直接行动：
- 不知道要操作哪个文件
- 不知道要修改哪一段内容
- 用户要求“优化一下”“改得更好”但没有说明目标
- 用户要求的操作可能覆盖原文件且风险较高

你的澄清问题应尽量短，例如：
- “请提供要处理的 DOCX 文件路径。”
- “你是想修改内容、格式，还是两者都改？”
- “请指出要改写的段落，或让我先读取文档内容。”

【语义编辑规则】
当用户要求润色、改写、缩写、专业化、通俗化时，按以下方式处理：
1. 先确定目标文件和目标段落/章节。
2. 如果目标内容不明确，先读取文档内容。
3. 先基于原文生成合适的新文本，再执行替换或结构化编辑。
4. 完成后简要说明你改了什么。

【edit_docx_tool 的编辑格式】
使用 edit_docx_tool 时，edits 参数应为列表，每个元素是一个字典。常见格式如下：
- 替换文本：{'type': 'replace_text', 'old_text': '原文本', 'new_text': '新文本'}
- 也可使用等价替换格式：{'type': 'replace', 'target': '原文本', 'replacement': '新文本'}
- 添加段落：{'type': 'add_paragraph', 'content': '段落内容', 'position': 'end'}
- 添加标题：{'type': 'add_heading', 'content': '标题内容', 'level': 1}，其中 level=0 可作为 Title，level=2/3 适合子标题
- 修改样式：{'type': 'modify_style', 'style_name': 'Normal', 'font_name': '宋体', 'font_size': 12, 'bold': True, 'italic': False, 'underline': False, 'color': '1F1F1F', 'alignment': 'justify', 'spacing_before': 6, 'spacing_after': 6}
- 设置局部文字格式：{'type': 'format_text', 'target_text': '关键词', 'bold': True, 'italic': True, 'underline': True, 'font_size': 13, 'color': 'C00000'}
- 设置段落格式：{'type': 'format_paragraph', 'position': 3, 'alignment': 'center', 'spacing_before': 6, 'spacing_after': 6, 'line_spacing': 1.5}
- 插入分页符：{'type': 'add_page_break', 'position': 'end'}
- 添加表格：{'type': 'add_table', 'data': [['A', 'B'], ['1', '2']], 'table_style': 'Table Grid'}
- 设置表格样式：{'type': 'set_table_style', 'table_index': 0, 'table_style': 'Light Grid Accent 1'}
- 添加项目符号列表：{'type': 'add_bullet_list', 'items': ['第一点', '第二点', '第三点'], 'position': 'end'}
  也支持嵌套层级：{'type': 'add_bullet_list', 'items': ['主项', {'text': '子项1', 'level': 1}, {'text': '子项2', 'level': 1}], 'position': 'end'}
- 添加编号列表：{'type': 'add_numbered_list', 'items': ['第一步', '第二步', '第三步'], 'position': 'end'}
  也支持嵌套层级：{'type': 'add_numbered_list', 'items': ['步骤一', {'text': '子步骤A', 'level': 1}], 'position': 'end'}
- 注意：add_paragraph 的 position 支持整数索引；'end' 表示追加到文档末尾；嵌套列表的 level 从 0 开始

【输出风格】
1. 回答要专业、直接、清楚。
2. 执行工具前，内部先判断是否真的需要工具。
3. ⚠️ 对于多步骤编辑任务，**不要在中间步骤汇报**，等所有步骤完成后再统一报告最终结果。
4. 如果失败，明确说明失败原因和下一步建议。

记住：你的重点是正确理解用户对文档的真实意图，并以最小、最可靠的步骤完成任务。"""

    # Define document processing tools - define as actual functions
    # Side-channel for file events: tool functions append here,
    # DocMasterAgent.on_messages_stream drains it.
    _pending_files_events: list = []

    tools = []
    
    if DOCUMENT_PROCESSING_AVAILABLE:
        # Define document processing function - SIMPLIFIED
        def process_document(file_path: str):
            """
            Analyze a document file and return a machine-readable summary.

            Use this when the user wants to understand a file rather than edit it,
            for example: summarize the document, identify its type, inspect its
            structure, preview its contents, or extract high-level metadata.

            Best for:
            - DOCX, PDF, PPTX, XLSX, CSV, TXT, MD analysis
            - first-pass inspection before deciding what to edit
            - requests like "analyze this file", "what is in this document?",
              "summarize this report"

            Not for directly editing DOCX content.

            Args:
                file_path: Path to the input file.
            """
            processor = DocumentProcessor(str(WORKSPACE))
            return processor.process_uploaded_file(file_path)
        
        # Define DOCX editing function
        def edit_docx_tool(file_path: str, edits: list):
            """
            Apply one or more structured edits to an existing DOCX file.

            This is the single general-purpose DOCX editing tool. Use it for
            exact replacements, semantic rewrites after inspection, adding
            headings or paragraphs, inserting tables, and style-related changes.

            Best for:
            - replace one phrase with another
            - append or insert new content
            - add headings or tables
            - run several planned edits in one call
            - execute semantic edits after reading the target content first

            This tool overwrites the original DOCX file.

            Args:
                file_path: Path to the DOCX file.
                edits: List of edit operations. Accepted examples:
                    - {'type': 'replace_text', 'old_text': 'old', 'new_text': 'new'}
                    - {'type': 'replace', 'target': 'old', 'replacement': 'new'}
                    - {'type': 'add_paragraph', 'content': 'text', 'position': 'end', 'alignment': 'justify', 'spacing_after': 6}
                    - {'type': 'add_heading', 'content': 'Section 2', 'level': 2, 'bold': True, 'color': '1F4E79'}
                    - {'type': 'modify_style', 'style_name': 'Heading 2', 'font_name': 'Calibri', 'font_size': 14, 'bold': True, 'spacing_before': 12, 'spacing_after': 6}
                    - {'type': 'format_text', 'target_text': 'important', 'bold': True, 'italic': True, 'underline': True, 'color': 'C00000'}
                    - {'type': 'format_paragraph', 'position': 3, 'alignment': 'center', 'line_spacing': 1.5}
                    - {'type': 'add_page_break', 'position': 'end'}
                    - {'type': 'add_table', 'data': [['A', 'B'], ['1', '2']], 'table_style': 'Table Grid'}
                    - {'type': 'set_table_style', 'table_index': 0, 'table_style': 'Light Grid Accent 1'}
                    - {'type': 'set_cell_text', 'table_index': 0, 'row': 3, 'col': 5, 'value': '2550'}   # overwrite one cell; '\\n' splits paragraphs
                    - {'type': 'replace_in_cell', 'table_index': 0, 'row': 3, 'col': 5, 'old_text': '850', 'new_text': '2550'}   # scoped find/replace inside one cell (cross-paragraph aware)
                    - {'type': 'add_bullet_list', 'items': ['要点一', '要点二'], 'position': 'end'}
                    - {'type': 'add_numbered_list', 'items': ['第一步', '第二步'], 'position': 'end'}
                    - {'type': 'insert_image', 'image_path': '/abs/path/to/image.png', 'position': 0, 'width_inches': 5.0}
                    - {'type': 'add_footer', 'footer_type': 'page_number'}   # adds "Page X of Y" centered footer
                    - {'type': 'add_footer', 'footer_type': 'page_x'}        # adds "Page X" centered footer
                    - {'type': 'add_footer', 'footer_type': 'custom', 'text': 'Confidential'}  # custom text footer
                    - {'type': 'add_header', 'header_type': 'custom', 'text': 'Document Title'}  # custom text header
                    - {'type': 'add_header', 'header_type': 'title'}         # document title from file properties
                    - {'type': 'add_header', 'header_type': 'filename', 'text': 'filename.docx'}  # filename header
            """
            import os
            import json
            
            # Log the incoming request for debugging
            print(f"🔧 edit_docx_tool called with:")
            print(f"   File: {file_path}")
            print(f"   Edits count: {len(edits)}")
            print(f"   First edit sample: {json.dumps(edits[0] if edits else {}, ensure_ascii=False, indent=2)[:200]}...")
            
            # Check if file exists
            if not os.path.exists(file_path):
                error_msg = f"File not found: {file_path}"
                print(f"❌ {error_msg}")
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': error_msg,
                    'debug_info': {
                        'file_path': file_path,
                        'file_exists': os.path.exists(file_path)
                    }
                }
            
            # Convert LLM format to standard format if needed
            standardized_edits = []
            conversion_stats = {'llm_format': 0, 'standard_format': 0, 'unknown': 0}
            
            for i, edit in enumerate(edits):
                if isinstance(edit, dict):
                    edit_type = edit.get('type', '')
                    
                    # Handle LLM format: 'replace' -> 'replace_text'
                    # Supports both 'target'/'replacement' and 'old_text'/'new_text' variants
                    if edit_type == 'replace':
                        if 'target' in edit and 'replacement' in edit:
                            standardized_edits.append({
                                'type': 'replace_text',
                                'old_text': edit['target'],
                                'new_text': edit['replacement']
                            })
                            conversion_stats['llm_format'] += 1
                            continue
                        elif 'old_text' in edit and 'new_text' in edit:
                            # Model is using old_text/new_text with type 'replace'
                            standardized_edits.append({
                                'type': 'replace_text',
                                'old_text': edit['old_text'],
                                'new_text': edit['new_text']
                            })
                            conversion_stats['llm_format'] += 1
                            continue
                    
                    # Handle 'replace_text' type with old_text/new_text (also common LLM format)
                    if edit_type == 'replace_text' and 'old_text' in edit and 'new_text' in edit:
                        standardized_edits.append(edit)
                        conversion_stats['standard_format'] += 1
                        continue
                    
                    # Handle other potential LLM format variations
                    if edit_type == 'add':
                        if 'content' in edit:
                            standardized_edits.append({
                                'type': 'add_paragraph',
                                'content': edit['content'],
                                'position': edit.get('position', 'end')
                            })
                            conversion_stats['llm_format'] += 1
                            continue
                    
                    # If it's already in standard format
                    if edit_type in ['replace_text', 'add_paragraph', 'add_heading', 'modify_style', 'add_table', 'format_text', 'format_paragraph', 'add_page_break', 'set_table_style', 'insert_image', 'add_footer', 'add_header', 'add_bullet_list', 'add_numbered_list', 'delete_text', 'delete_paragraph']:
                        standardized_edits.append(edit)
                        conversion_stats['standard_format'] += 1
                    else:
                        # Unknown format, try to use as-is
                        standardized_edits.append(edit)
                        conversion_stats['unknown'] += 1
                        print(f"⚠️ Unknown edit format at index {i}: {edit_type}")
                else:
                    # If edit is not a dict, keep it as-is
                    standardized_edits.append(edit)
                    conversion_stats['unknown'] += 1
            
            print(f"📊 Edit conversion stats: {conversion_stats}")
            print(f"📝 Standardized edits count: {len(standardized_edits)}")
            
            processor = DocumentProcessor(str(WORKSPACE))
            result = processor.edit_docx(file_path, standardized_edits, overwrite_original=True)
            
            print(f"✅ edit_docx_tool result: {result.get('success', False)}")
            if not result.get('success', False):
                print(f"❌ Error: {result.get('error', 'Unknown error')}")
                print(f"📝 Message: {result.get('message', 'No message')}")
            else:
                fe_data = _build_files_event_data(file_path, f"Edited DOCX: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)
            
            # Trim result to avoid flooding the context window.
            # The raw result repeats change details 3x (document_info.changes_made,
            # changes, debug_info.edits_sample). Keep only what the agent needs.
            def _truncate(s, maxlen=80):
                return s[:maxlen] + '...' if len(s) > maxlen else s
            
            changes_raw = result.get('changes', result.get('document_info', {}).get('changes_made', []))
            trimmed_changes = [_truncate(c) for c in changes_raw] if isinstance(changes_raw, list) else changes_raw
            
            return {
                'success': result.get('success', False),
                'message': result.get('message', ''),
                'file_path': result.get('file_path', file_path),
                'paragraph_count': result.get('document_info', {}).get('paragraph_count'),
                'table_count': result.get('document_info', {}).get('table_count'),
                'changes': trimmed_changes,
            }
        
        # Define DOCX content extraction function
        def extract_docx_content_tool(file_path: str):
            """
            Extract detailed DOCX content for inspection before editing.

            Use this when you need the actual document text or structure, not
            just metadata. This is the preferred inspection tool before nontrivial
            rewrite, polish, shorten, reorganize, or section-level edits.

            Best for:
            - reading paragraphs and tables from a DOCX
            - locating target text before semantic edits
            - understanding document structure before applying changes

            Not for editing by itself.

            Args:
                file_path: Path to the DOCX file.
            """
            processor = DocumentProcessor(str(WORKSPACE))
            result = processor.extract_docx_content(file_path)
            return result
        
        # ============ NEW ENHANCED EDITING TOOLS ============
        
        def delete_docx_content_tool(file_path: str):
            """
            Remove all content from an existing DOCX document.

            Use this only when the user clearly wants the document emptied,
            cleared, or reset. This is a destructive operation on the target file.

            Best for:
            - "clear this document"
            - "delete all text/content"
            - preparing an existing DOCX to be rebuilt

            Args:
                file_path: Path to the DOCX file.
            """
            processor = DocumentProcessor(str(WORKSPACE))
            result = processor.delete_docx_content(file_path)
            if result.get('success', False):
                fe_data = _build_files_event_data(file_path, f"Cleared DOCX: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)
            return result
        
        def modify_docx_fonts_tool(file_path: str, font_rules: dict = None):
            """
            Change DOCX fonts according to language or content-type rules.

            Use this when the request is specifically about typography rather than
            wording, for example changing Chinese text to 宋体 and English text to
            Times New Roman.

            Best for:
            - document-wide font normalization
            - Chinese/English font separation
            - formatting requests focused on font family rules

            Not for rewriting content.

            Args:
                file_path: Path to the DOCX file.
                font_rules: Mapping of content categories to fonts, e.g.
                    {'chinese': '宋体', 'english': 'Times New Roman'}
            """
            processor = DocumentProcessor(str(WORKSPACE))
            result = processor.modify_docx_fonts(file_path, font_rules)
            if result.get('success', False):
                fe_data = _build_files_event_data(file_path, f"Font-modified DOCX: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)
            return result
        
        def create_docx_with_content_tool(output_path: str, content: list):
            """
            Create a new DOCX file from structured content elements.

            This is the single document-creation tool. Use it whenever the user
            wants a new Word document, whether simple or structured. If the user
            only gives plain text, convert it into a reasonable structured content
            list before calling this tool.

            Best for:
            - creating a new report or letter
            - building a document from headings and paragraphs
            - generating a formatted DOCX from an outline or structured data

            Args:
                output_path: Path where the new DOCX should be saved.
                content: List of structured content items, for example:
                    - {'type': 'heading', 'text': 'Document Title', 'level': 0}
                    - {'type': 'heading', 'text': 'Introduction', 'level': 1}
                    - {'type': 'subheading', 'text': 'Background', 'level': 2}
                    - {'type': 'paragraph', 'text': 'Body text', 'font_name': 'Times New Roman', 'font_size': 12, 'alignment': 'justify', 'spacing_after': 6}
                    - {'type': 'page_break'}
                    - {'type': 'table', 'data': [['A', 'B'], ['1', '2']], 'table_style': 'Table Grid'}
                    Optional fields may include font/font_name, bold, italic, underline, font_size, color, alignment, and spacing.
            """
            processor = DocumentProcessor(str(WORKSPACE))
            result = processor.create_docx_with_content(output_path, content)
            if result.get('success', False):
                fe_data = _build_files_event_data(output_path, f"Created DOCX: {Path(output_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)
            
            # Trim verbose result for context window
            doc_info = result.get('document_info', {})
            elements = doc_info.get('created_elements', result.get('elements_created', []))
            return {
                'success': result.get('success', False),
                'message': result.get('message', ''),
                'file_path': result.get('file_path', output_path),
                'paragraph_count': doc_info.get('paragraph_count'),
                'table_count': doc_info.get('table_count'),
                'elements_created': len(elements),
            }

        def convert_doc_to_docx_tool(file_path: str):
            """
            Convert a legacy Word .doc file to modern .docx via LibreOffice headless.

            Call this FIRST whenever the user uploads a .doc file — python-docx
            and every other DOCX tool here cannot read the legacy binary format.
            The result includes `output_path`; use that path for any follow-up
            tool calls (inspect_docx_template_tool, edit_docx_tool, etc.).

            If the input is already .docx, returns success with note="already .docx"
            and the same path — safe to call on any uploaded Word file.

            Requires `soffice` (LibreOffice) on PATH. If missing, returns a clear
            error with install instructions; stop and tell the user.

            Args:
                file_path: Path to the uploaded .doc (or .docx) file.

            Returns dict with: success, input_path, output_path, soffice_used,
                message. On failure: success=False, error=<reason>, message=<hint>.
            """
            skill = DocToDocxSkill(str(WORKSPACE))
            result = skill.convert(file_path)
            if (
                result.get('success')
                and result.get('soffice_used')
                and result.get('output_path') != file_path
            ):
                fe_data = _build_files_event_data(
                    result['output_path'],
                    f"Converted to DOCX: {Path(result['output_path']).name}",
                )
                if fe_data:
                    _pending_files_events.append(fe_data)
            return result

        def inspect_docx_template_tool(template_path: str):
            """
            Inspect a DOCX template and discover its placeholders and fillable slots.

            Use this BEFORE asking the user to provide values for a template.
            Returns the detected placeholder style and the list of variables /
            tokens found, plus heuristic "slots" for templates that do not use
            any explicit placeholder syntax (e.g. underscore lines `_____`,
            "Label:" with empty tail, empty table cells under a header).

            Best for:
            - "I uploaded a template, what fields does it have?"
            - planning a conversational fill flow before generating a document
            - filling user-uploaded templates that don't use {{ }} or [TOKEN]

            Args:
                template_path: Path to the .docx template file.

            Returns a dict with:
                mode_detected: 'jinja' (uses {{ name }}), 'bracket' (uses [NAME]),
                    'both', or 'none'
                jinja_variables: list of top-level Jinja variable names
                bracket_tokens: list of bracket tokens (without the brackets)
                has_loops, has_conditionals: True if {% for %} / {% if %} present
                slots: list of {id, kind, label, context, ...} dicts where kind
                    is one of:
                      - 'highlighted'         — run(s) with a Word highlight
                                                (yellow/green/cyan/…); the
                                                strongest fill signal. On fill
                                                the text is replaced AND the
                                                highlight is cleared. Extra
                                                fields on this kind:
                                                  • span_text: full original
                                                    highlighted text — show it
                                                    to the user verbatim when
                                                    asking what to fill.
                                                  • scaffold (optional): when
                                                    the span looks like
                                                    "<variable><unit>"
                                                    (15个工作日, ¥850, 50%,
                                                    2025年5月14日, 10kg, …),
                                                    a {kind, prefix, variable,
                                                    suffix} dict. If the
                                                    slot_values reply is a
                                                    bare number, prefix+suffix
                                                    are auto-reattached on
                                                    fill so "20" becomes
                                                    "20个工作日". The agent
                                                    SHOULD still pass the full
                                                    intended string when it
                                                    can — auto-reattach is a
                                                    safety net.
                      - 'underscores'         — run of 3+ underscores
                      - 'label_blank'         — paragraph ending in "Label:"
                      - 'empty_cell'          — empty table cell under a header
                      - 'angle_bracketed'     — <token> or 《占位符》
                      - 'placeholder_phrase'  — "your text here", "请填写", "TBD"…
                      - 'hint_text'           — italic/grey instructional run
                      - 'section_body_empty'  — empty body under a Heading
                      - 'option_choice'       — 二选一 / 三选一 pattern: an
                                                instruction paragraph
                                                ("以下两种选择适合的一种…请删除")
                                                followed by two or more
                                                "第N种" option headers, each
                                                with its own body paragraphs.
                                                Extra fields on this kind:
                                                  • options: list of
                                                    {index, header, preview}
                                                    describing each branch.
                                                  • fill_policy: instructions
                                                    on what value to pass.
                                                Ask the user which option
                                                ("请问选第几种？") and pass
                                                the chosen index back as
                                                slot_values[slot_id] = 1
                                                (or "第二种" / "first" /
                                                "2" — all accepted). The
                                                fill tool then keeps only
                                                the chosen option's body
                                                and deletes the prompt +
                                                all other options.
                                                **Do NOT also pass the
                                                instruction prompt as a
                                                removal_id** — its
                                                deletion is owned by the
                                                slot fill, and it is
                                                deliberately not emitted
                                                as a separate removal.
                  label = best-guess field name (may be None for stray cases).
                  context = surrounding snippet for disambiguation.
                  Pass the slot ids back via fill_docx_template_tool's
                  slot_values argument once the user confirms each.
                removals: list of {id, kind, text, reason} dicts of paragraphs/
                    runs that look like template instructions to be deleted
                    before publishing (e.g. "Delete this before submitting",
                    "Note to author: ...", "请删除本段"). kind is
                    'instruction_paragraph' (whole paragraph removed) or
                    'instruction_run' (just one run blanked). NEVER auto-
                    delete: read each entry to the user, get confirmation,
                    then pass approved ids via fill_docx_template_tool's
                    removal_ids argument.
                warnings: notes (e.g. mixed-mode template, ambiguous slots,
                    removal candidates present)
            """
            guard = _guard_template_path(template_path)
            if guard is not None:
                return guard
            skill = DocxTemplateSkill(str(WORKSPACE))
            return skill.inspect_template(template_path)

        def fill_docx_template_tool(
            template_path: str,
            output_path: str,
            context: dict = None,
            mode: str = "auto",
            slot_values: dict = None,
            removal_ids: list = None,
        ):
            """
            Fill a DOCX template with values and save to a new DOCX file.

            Supports three input styles, freely combinable:
            - Jinja (docxtpl): {{ name }}, {% for x in xs %}…{% endfor %},
              {%tr for row in rows %}…{%tr endtr %} for table rows.
              `context` is a regular nested dict matching the variables.
            - Bracket: [NAME], [DATE] — literal substitution across paragraphs,
              tables, and headers/footers. `context` keys are the token names
              without brackets, e.g. {"NAME": "Alice"} fills [NAME]. Bracket
              tokens must be uppercase-leading (alnum, underscore, dash).
            - Heuristic slots: for templates without placeholder syntax. Call
              inspect_docx_template_tool first to discover slot ids, confirm
              what each holds with the user, then pass
              slot_values={"slot_0": "Alice", "slot_1": "2026-05-13", ...}.

            Run-level formatting (bold/italic/color/font) in the template is
            preserved — only the runs that span the matched placeholder text
            are edited; other runs in the same paragraph are left untouched.

            Use mode='auto' (default) to let the tool detect from the template.
            Force 'jinja' or 'bracket' only when the user explicitly asks.
            For mixed templates ({{ }} AND [TOKEN]) in auto mode, Jinja renders
            first, then a bracket pass runs over the rendered output. Slot
            fills always run last, on the rendered document.

            Best for:
            - "Fill this template with these values"
            - generating one or more documents from an uploaded template
            - filling templates whose authors didn't add placeholders

            Args:
                template_path: Path to the .docx template.
                output_path: Where to write the filled .docx. Use a different
                    path from template_path to preserve the original (a
                    `_filled.docx` suffix is conventional).
                context: Mapping of placeholder values (Jinja vars or bracket
                    tokens). May be omitted/None if you're only filling slots.
                mode: 'auto' (default), 'jinja', or 'bracket'.
                slot_values: Optional {slot_id: value} from
                    inspect_docx_template_tool's `slots` list.
                removal_ids: Optional list of `id`s from inspect's `removals`
                    list. Each id corresponds to a paragraph or run that the
                    user confirmed should be DELETED from the final document
                    (template instructions, "Delete this before submitting"
                    notes, etc.). Removals run last, after all fill passes,
                    on the saved output file. Pass None or [] to keep all
                    template prose intact.
            """
            guard = _guard_template_path(template_path)
            if guard is not None:
                return guard
            skill = DocxTemplateSkill(str(WORKSPACE))
            result = skill.fill_template(
                template_path,
                output_path,
                context=context or {},
                mode=mode,
                slot_values=slot_values or {},
                removal_ids=removal_ids or [],
            )
            if result.get('success', False):
                fe_data = _build_files_event_data(
                    output_path,
                    f"Template-filled DOCX: {Path(output_path).name}",
                )
                if fe_data:
                    _pending_files_events.append(fe_data)
            return result

        # ---------------------------------------------------------------- #
        # Template library — shared + per-user .docx template catalog       #
        # ---------------------------------------------------------------- #

        def list_templates_tool(category: str = None, query: str = None):
            """
            列出当前用户可用的 DOCX 模板（共享库 + 用户自己保存的模板）。

            什么时候用：
            - 用户问"我有哪些模板？""现在能用哪些合同模板？"
            - 用户没有上传文件但提到要用某种模板，**先**调这个工具看看有没有；
              不要直接要求用户上传。
            - 用户要按类别浏览（如"看看采购合同类的模板"）—— 用 category 参数。
            - 用户给的是关键词（如"含'保密'的模板"）—— 用 query 参数。

            Args:
                category: 可选，按类别过滤（如 "合同/采购"）。匹配前缀，
                    所以 "合同" 也会命中 "合同/采购" 与 "合同/技术开发"。
                query: 可选，关键词子串匹配 name / description / id / tags /
                    aliases（大小写不敏感）。

            Returns dict with:
                shared: 共享库里的模板列表，每项含 id / name / description /
                    category / tags / aliases / source="shared"
                mine:   当前用户自己保存的模板，结构同上，source="mine"
                message: 简要中文摘要

            注意：返回的是元数据，不含模板文件本身。要打开/填一个模板，请把
            id（或 alias / name）传给 get_template_path_tool 拿到具体路径，
            再用 inspect_docx_template_tool / fill_docx_template_tool。
            """
            skill = TemplateLibrarySkill(str(WORKSPACE))
            return skill.list(user_id=user_id, category=category, query=query)

        def get_template_path_tool(template_ref: str):
            """
            根据 id / alias / 模板名（支持模糊子串）定位模板库里的模板，返回
            它的本地路径，方便接下来用 inspect_docx_template_tool /
            fill_docx_template_tool 进行检查和填写。

            什么时候用：
            - 用户说"用 3-1 模板""用 技术开发合同 模板""用我的采购合同模板"
              —— 把用户说的字符串原样传进 template_ref。
            - 模板填写流程的**第零步**：先尝试在模板库里找，找到就用，
              找不到再回退到要求上传。

            解析顺序：
              1. 用户自己库里的精确 id
              2. 共享库里的精确 id
              3. 别名（aliases）精确匹配（用户优先于共享）
              4. 在 name / id / aliases / tags 上做子串匹配（用户优先于共享）

            Args:
                template_ref: 用户口中的"模板名"——可以是 id（如 "tech-dev-3-1"）、
                    别名（如 "3-1"）、或显示名的一部分（如 "技术开发"）。

            Returns dict with:
                success: True / False
                template_path: 命中时返回模板 .docx 的绝对路径
                source: "mine" 或 "shared"
                metadata: 命中模板的完整元数据
                ambiguous: True 表示匹配到多个候选 → candidates 字段里给出
                    候选列表，让用户挑一个
                message: 中文提示

            如果 ambiguous=True，**不要**自己挑—— 把 candidates 念给用户，
            让用户确认是哪一个，再用确认后的 id 再调一次 get_template_path_tool。
            """
            skill = TemplateLibrarySkill(str(WORKSPACE))
            return skill.get_path(template_ref, user_id=user_id)

        def save_template_tool(
            template_path: str,
            name: str,
            description: str,
            category: str = None,
            tags: list = None,
            aliases: list = None,
        ):
            """
            把一份用户**新上传**的 .docx 模板保存进当前用户的模板库，下次
            可以直接通过 list_templates_tool / get_template_path_tool 调用。

            什么时候用：
            - 用户成功用 fill_docx_template_tool 填完一份**新上传**的模板后，
              询问用户"要把这个模板存进你的模板库吗？要起什么名字、分类、别名？"
              用户同意后调本工具。
            - 用户明说"把这个模板保存起来"。
            - **不要**在用户从模板库里取出的模板上重复调本工具——会出现重复
              条目。

            Args:
                template_path: 用户上传的 .docx 文件路径（**模板原件**，不是填写后的 _filled 文件）。
                name: 中文显示名，用户能一眼认出（如 "技术开发合同（3-1）"）。
                description: 一句话说明用途（如 "科技部印制的技术开发委托合同模板"）。
                category: 可选，分类路径（如 "合同/技术开发"）。建议两级，
                    用 / 分隔。
                tags: 可选，关键词列表（如 ["合同", "技术开发", "科技部"]）。
                aliases: 可选，用户日常口语里的别名（如 ["3-1", "3-1技术开发"]），
                    会被 get_template_path_tool 拿来做精确匹配，**强烈建议
                    填几个常用别名**。

            Returns dict with success / template_id / template_path / metadata /
            message。文件会被复制到用户私有库里（不影响原始上传文件）。
            """
            skill = TemplateLibrarySkill(str(WORKSPACE))
            return skill.save(
                source_path=template_path,
                user_id=user_id,
                name=name,
                description=description,
                category=category,
                tags=tags,
                aliases=aliases,
            )

        def add_bullet_list_tool(file_path: str, items: list, position: int | str = "end", style: str = "List Bullet"):
            """
            Add a bullet list to an existing DOCX file.

            Use this when the user wants to add a bulleted list — for example a list
            of key points, requirements, features, or any collection of items that
            should be visually grouped.

            Best for:
            - "add a bullet list of ..."
            - "insert a list of items"
            - "list the following points"
            - adding structured list content to a document

            Args:
                file_path: Path to the DOCX file.
                items: List of item strings, or list of dicts with 'text' and optional
                       'level' (0=normal, 1+=nested), e.g.
                       ['Item one', {'text': 'Item two', 'level': 1}, 'Item three']
                position: Integer index to insert before that paragraph, or 'end'
                          to append at the end of the document.
                style: Base list style to use; defaults to 'List Bullet'.
            """
            import os
            import json

            print(f"🔧 add_bullet_list_tool called:")
            print(f"   File: {file_path}")
            print(f"   Items: {json.dumps(items[:3], ensure_ascii=False)}...")

            if not os.path.exists(file_path):
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }

            processor = DocumentProcessor(str(WORKSPACE))
            edits = [{
                'type': 'add_bullet_list',
                'items': items,
                'position': position,
                'style': style,
            }]
            result = processor.edit_docx(file_path, edits, overwrite_original=True)

            if result.get('success', False):
                fe_data = _build_files_event_data(file_path, f"Bullet list added to: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)

            return {
                'success': result.get('success', False),
                'message': result.get('message', ''),
                'file_path': file_path,
                'items_added': len(items),
            }
        
        def add_numbered_list_tool(file_path: str, items: list, position: int | str = "end", style: str = "List Number"):
            """
            Add a numbered list to an existing DOCX file.

            Use this when the user wants an ordered, sequential list — for example
            steps in a process, a ranked list, or an enumerated set of items.

            Best for:
            - "add a numbered list of ..."
            - "list the steps in order"
            - "add these items as a numbered sequence"
            - "insert a numbered sequence"

            Args:
                file_path: Path to the DOCX file.
                items: List of item strings, or list of dicts with 'text' and optional
                       'level' (0=normal, 1+=nested), e.g.
                       ['Step 1: Do X', {'text': 'Step 2: Do Y', 'level': 1}, 'Step 3: Do Z']
                position: Integer index to insert before that paragraph, or 'end'
                          to append at the end of the document.
                style: Base list style to use; defaults to 'List Number'.
            """
            import os
            import json

            print(f"🔧 add_numbered_list_tool called:")
            print(f"   File: {file_path}")
            print(f"   Items: {json.dumps(items[:3], ensure_ascii=False)}...")

            if not os.path.exists(file_path):
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }

            processor = DocumentProcessor(str(WORKSPACE))
            edits = [{
                'type': 'add_numbered_list',
                'items': items,
                'position': position,
                'style': style,
            }]
            result = processor.edit_docx(file_path, edits, overwrite_original=True)

            if result.get('success', False):
                fe_data = _build_files_event_data(file_path, f"Numbered list added to: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)

            return {
                'success': result.get('success', False),
                'message': result.get('message', ''),
                'file_path': file_path,
                'items_added': len(items),
            }
        
        def add_comment_tool(
            file_path: str,
            comments: str = None,
            # Legacy single-comment parameters (for backward compatibility)
            target_text: str = None,
            comment_text: str = None,
            comment_id: int = 0,
            author: str = "DocMaster",
            initials: str = "DM",
            parent_comment_id: int | None = None,
        ):
            """
            Add one or more comments to a DOCX document, attached to specific text ranges.

            Uses a direct zipfile + lxml approach for reliable XML manipulation.
            ALL comments are processed in a SINGLE pass, and ONE file event is emitted
            at the end containing the complete document with all comments.

            Best for:
            - "add comments to ..."
            - "add multiple comments/annotations"
            - "add feedback to this essay"
            - "comment on all sections"
            - "annotate [text] with [comments]"

            Args:
                file_path: Path to the DOCX file to add comment to.
                comments: JSON string or list of comment dicts. Each dict should have:
                    - target_text: The exact text string in the document to attach to
                    - comment_text: The content of the comment
                    - comment_id: Unique integer ID for this comment (0, 1, 2, ...)
                    - author: (optional) Author name, defaults to "DocMaster"
                    - initials: (optional) Author initials, defaults to "DM"
                    - parent_comment_id: (optional) If set, this is a reply to that comment
                    Example: '[{"target_text": "Introduction", "comment_text": "Great intro!", "comment_id": 0}]'
                target_text: (Legacy) Target text for single comment
                comment_text: (Legacy) Comment text for single comment  
                comment_id: (Legacy) Comment ID for single comment
                author: (Legacy) Author for single comment
                initials: (Legacy) Initials for single comment
                parent_comment_id: (Legacy) Parent comment ID for reply
            """
            import json
            import re
            import zipfile
            from lxml import etree
            from datetime import datetime, timezone
            import random

            # Handle batch comments - support both JSON string and list
            if comments is not None:
                if isinstance(comments, str):
                    # Try to parse as JSON, handling curly quotes
                    try:
                        # First, normalize curly quotes to regular quotes for JSON parsing
                        normalized = comments.replace('\u201c', '"').replace('\u201d', '"').replace('\u2018', "'").replace('\u2019', "'")
                        comment_list = json.loads(normalized)
                    except json.JSONDecodeError as e:
                        return {
                            'success': False,
                            'error': f'Invalid JSON in comments parameter: {e}',
                            'message': 'Failed to parse comments JSON. Make sure to use regular double quotes.'
                        }
                elif isinstance(comments, list):
                    comment_list = comments
                else:
                    return {
                        'success': False,
                        'error': 'Invalid comments format',
                        'message': 'comments must be a JSON string or a list'
                    }
            elif target_text is not None and comment_text is not None:
                # Legacy single comment - convert to list format
                comment_list = [{
                    "target_text": target_text,
                    "comment_text": comment_text,
                    "comment_id": comment_id,
                    "author": author,
                    "initials": initials,
                    "parent_comment_id": parent_comment_id,
                }]
            else:
                return {
                    'success': False,
                    'error': 'Invalid arguments',
                    'message': 'Either provide a "comments" list OR both "target_text" and "comment_text"'
                }

            print(f"🔧 add_comment_tool called:")
            print(f"   File: {file_path}")
            print(f"   Comments to add: {len(comment_list)}")

            if not os.path.exists(file_path):
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }

            # Namespace definitions
            NSMAP = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
                'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
                'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
                'w16cid': 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
                'w16cex': 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
                'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
            }

            def qn(tag):
                """Resolve a qualified name like 'w:body' to '{ns}body'."""
                prefix, local = tag.split(':')
                return f'{{{NSMAP[prefix]}}}{local}'

            def _generate_hex_id():
                """Generate a unique hex ID for paraId/durableId."""
                return f"{random.randint(1, 0x7FFFFFFE):08X}"

            def _sanitize_text(text):
                """Replace curly/smart quotes with regular quotes to prevent JSON parsing issues."""
                if not isinstance(text, str):
                    return text
                # Replace curly quotes with regular quotes
                return text.replace('\u201c', '"').replace('\u201d', '"').replace('\u2018', "'").replace('\u2019', "'")

            try:
                # Step 0: Sanitize all comment texts to remove curly quotes
                for comment_spec in comment_list:
                    if 'target_text' in comment_spec:
                        comment_spec['target_text'] = _sanitize_text(comment_spec['target_text'])
                    if 'comment_text' in comment_spec:
                        comment_spec['comment_text'] = _sanitize_text(comment_spec['comment_text'])

                # Step 1: Read the DOCX as a zip file (once)
                with zipfile.ZipFile(file_path, 'r') as zin:
                    doc_xml = zin.read('word/document.xml')
                    has_comments = 'word/comments.xml' in zin.namelist()
                    comments_xml = zin.read('word/comments.xml') if has_comments else None
                    has_comments_extended = 'word/commentsExtended.xml' in zin.namelist()
                    comments_extended_xml = zin.read('word/commentsExtended.xml') if has_comments_extended else None
                    has_comments_ids = 'word/commentsIds.xml' in zin.namelist()
                    comments_ids_xml = zin.read('word/commentsIds.xml') if has_comments_ids else None
                    has_comments_extensible = 'word/commentsExtensible.xml' in zin.namelist()
                    comments_extensible_xml = zin.read('word/commentsExtensible.xml') if has_comments_extensible else None
                    rels_xml = zin.read('word/_rels/document.xml.rels')
                    content_types_xml = zin.read('[Content_Types].xml')
                    
                    other_files = {}
                    for name in zin.namelist():
                        if name not in ('word/document.xml', 'word/comments.xml', 'word/commentsExtended.xml',
                                       'word/commentsIds.xml', 'word/commentsExtensible.xml',
                                       'word/_rels/document.xml.rels', '[Content_Types].xml'):
                            other_files[name] = zin.read(name)

                # Step 2: Parse document.xml and build paragraph text index
                doc_tree = etree.fromstring(doc_xml)
                body = doc_tree.find(qn('w:body'))
                paragraphs = body.findall(qn('w:p'))
                
                # Build a map of paragraph text -> paragraph element for fast lookup
                para_by_text = {}
                for p in paragraphs:
                    texts = list(p.itertext())
                    full_text = ''.join(texts).strip()
                    if full_text:
                        para_by_text[full_text] = p
                        # Also store first 100 chars for partial matching
                        short_text = full_text[:100]
                        if short_text not in para_by_text:
                            para_by_text[short_text] = p

                # Step 3: Process each comment
                added_comments = []
                errors = []
                comment_para_ids = {}  # Maps comment_id -> para_id for reply support
                
                for comment_spec in comment_list:
                    c_target = comment_spec.get('target_text')
                    c_text = comment_spec.get('comment_text')
                    c_id = comment_spec.get('comment_id', 0)
                    c_author = comment_spec.get('author', author)
                    c_initials = comment_spec.get('initials', initials)
                    c_parent = comment_spec.get('parent_comment_id')
                    
                    print(f"   Processing comment #{c_id}: {c_target[:40]}..." if c_target else f"   Processing comment #{c_id}")
                    
                    # Find the target paragraph
                    target_para = None
                    
                    # Try exact match first
                    if c_target in para_by_text:
                        target_para = para_by_text[c_target]
                    else:
                        # Try partial match - look for target text within any paragraph
                        for p in paragraphs:
                            texts = list(p.itertext())
                            full_text = ''.join(texts)
                            if c_target in full_text:
                                target_para = p
                                break
                    
                    if target_para is None:
                        errors.append(f"Comment #{c_id}: Target text not found: '{c_target[:50]}...'")
                        continue

                    # Get runs for inserting markers
                    runs = target_para.findall(qn('w:r'))
                    if not runs:
                        errors.append(f"Comment #{c_id}: No runs in target paragraph")
                        continue

                    first_run = runs[0]
                    para_id = _generate_hex_id()
                    comment_para_ids[c_id] = para_id
                    
                    # Create comment markers
                    comment_range_start = etree.Element(qn('w:commentRangeStart'))
                    comment_range_start.set(qn('w:id'), str(c_id))

                    comment_range_end = etree.Element(qn('w:commentRangeEnd'))
                    comment_range_end.set(qn('w:id'), str(c_id))

                    comment_ref = etree.Element(qn('w:r'))
                    rPr = etree.SubElement(comment_ref, qn('w:rPr'))
                    rStyle = etree.SubElement(rPr, qn('w:rStyle'))
                    rStyle.set(qn('w:val'), 'CommentReference')
                    comment_ref_elem = etree.SubElement(comment_ref, qn('w:commentReference'))
                    comment_ref_elem.set(qn('w:id'), str(c_id))

                    # Insert commentRangeStart before the first run
                    target_para.insert(list(target_para).index(first_run), comment_range_start)

                    # Append commentRangeEnd and commentReference at the end
                    target_para.append(comment_range_end)
                    target_para.append(comment_ref)
                    
                    added_comments.append({
                        'comment_id': c_id,
                        'target_text': c_target,
                        'comment_text': c_text,
                        'author': c_author,
                        'para_id': para_id,
                    })
                    
                    print(f"      ✓ Added markers for comment #{c_id}")

                # Step 4: Update comments.xml (main comment storage)
                if has_comments and comments_xml:
                    comments_tree = etree.fromstring(comments_xml)
                else:
                    comments_tree = etree.Element(qn('w:comments'))
                    for prefix, uri in NSMAP.items():
                        etree.register_namespace(prefix, uri)

                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                
                for added in added_comments:
                    # Create comment element
                    new_comment = etree.SubElement(comments_tree, qn('w:comment'))
                    new_comment.set(qn('w:id'), str(added['comment_id']))
                    new_comment.set(qn('w:author'), added['author'])
                    new_comment.set(qn('w:initials'), added.get('initials', initials))
                    new_comment.set(qn('w:date'), timestamp)

                    # Create paragraph inside comment
                    comment_p = etree.SubElement(new_comment, qn('w:p'))
                    comment_p.set(qn('w14:paraId'), added['para_id'])
                    comment_p.set(qn('w14:textId'), '77777777')
                    
                    comment_r = etree.SubElement(comment_p, qn('w:r'))
                    comment_t = etree.SubElement(comment_r, qn('w:t'))
                    comment_t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                    comment_t.text = added['comment_text']

                new_comments_xml = etree.tostring(comments_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 5: Update commentsExtended.xml (for reply threading and done status)
                if has_comments_extended and comments_extended_xml:
                    ext_tree = etree.fromstring(comments_extended_xml)
                else:
                    ext_tree = etree.Element(qn('w15:commentsEx'))
                    etree.register_namespace('w15', NSMAP['w15'])

                for added in added_comments:
                    # Find parent para_id if this is a reply
                    parent_para = None
                    for spec in comment_list:
                        if spec.get('comment_id') == spec.get('parent_comment_id'):
                            parent_para = comment_para_ids.get(spec.get('comment_id'))
                            break
                    
                    comment_ex = etree.SubElement(ext_tree, qn('w15:commentEx'))
                    comment_ex.set(qn('w15:paraId'), added['para_id'])
                    if parent_para:
                        comment_ex.set(qn('w15:paraIdParent'), parent_para)
                    comment_ex.set(qn('w15:done'), '0')

                new_comments_extended_xml = etree.tostring(ext_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 6: Update commentsIds.xml (for comment identity tracking)
                if has_comments_ids and comments_ids_xml:
                    ids_tree = etree.fromstring(comments_ids_xml)
                else:
                    ids_tree = etree.Element(qn('w16cid:commentsIds'))
                    etree.register_namespace('w16cid', NSMAP.get('w16cid', 'http://schemas.microsoft.com/office/word/2016/wordml/cid'))

                for added in added_comments:
                    durable_id = _generate_hex_id()
                    comment_id_elem = etree.SubElement(ids_tree, qn('w16cid:commentId'))
                    comment_id_elem.set(qn('w16cid:paraId'), added['para_id'])
                    comment_id_elem.set(qn('w16cid:durableId'), durable_id)

                new_comments_ids_xml = etree.tostring(ids_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 7: Update commentsExtensible.xml (for Office 365 collaboration)
                if has_comments_extensible and comments_extensible_xml:
                    ext2_tree = etree.fromstring(comments_extensible_xml)
                else:
                    ext2_tree = etree.Element(qn('w16cex:commentsExtensible'))
                    etree.register_namespace('w16cex', NSMAP.get('w16cex', 'http://schemas.microsoft.com/office/word/2018/wordml/cex'))

                for added in added_comments:
                    comment_ext = etree.SubElement(ext2_tree, qn('w16cex:commentExtensible'))
                    durable_id = _generate_hex_id()
                    comment_ext.set(qn('w16cex:durableId'), durable_id)
                    comment_ext.set(qn('w16cex:dateUtc'), timestamp)

                new_comments_extensible_xml = etree.tostring(ext2_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 8: Update relationships
                rels_tree = etree.fromstring(rels_xml)
                
                # Check which comment relationships already exist
                existing_targets = {rel.get('Target') for rel in rels_tree}
                
                if 'comments.xml' not in existing_targets:
                    max_id = 0
                    for rel in rels_tree:
                        rid = rel.get('Id', '')
                        if rid.startswith('rId'):
                            try:
                                max_id = max(max_id, int(rid[3:]))
                            except ValueError:
                                pass
                    
                    comment_rels = [
                        ('comments', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'),
                        ('commentsExtended', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'),
                        ('commentsIds', 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds'),
                        ('commentsExtensible', 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible'),
                    ]
                    
                    for name, rel_type in comment_rels:
                        new_rid = f'rId{max_id + 1}'
                        new_rel = etree.SubElement(rels_tree, 'Relationship')
                        new_rel.set('Id', new_rid)
                        new_rel.set('Type', rel_type)
                        new_rel.set('Target', f'{name}.xml')
                        max_id += 1

                new_rels_xml = etree.tostring(rels_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 9: Update [Content_Types].xml
                ct_tree = etree.fromstring(content_types_xml)
                ns_ct = 'http://schemas.openxmlformats.org/package/2006/content-types'
                existing_parts = {child.get('PartName') for child in ct_tree}
                
                if '/word/comments.xml' not in existing_parts:
                    overrides = [
                        ('/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'),
                        ('/word/commentsExtended.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'),
                        ('/word/commentsIds.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml'),
                        ('/word/commentsExtensible.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml'),
                    ]
                    
                    for part_name, content_type in overrides:
                        override = etree.SubElement(ct_tree, f'{{{ns_ct}}}Override')
                        override.set('PartName', part_name)
                        override.set('ContentType', content_type)

                new_content_types_xml = etree.tostring(ct_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 10: Write document.xml back
                new_doc_xml = etree.tostring(doc_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 11: Write back to docx (ONE file write)
                tmp_path = file_path + '.tmp'
                with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                    zout.writestr('word/document.xml', new_doc_xml)
                    zout.writestr('word/comments.xml', new_comments_xml)
                    zout.writestr('word/commentsExtended.xml', new_comments_extended_xml)
                    zout.writestr('word/commentsIds.xml', new_comments_ids_xml)
                    zout.writestr('word/commentsExtensible.xml', new_comments_extensible_xml)
                    zout.writestr('word/_rels/document.xml.rels', new_rels_xml)
                    zout.writestr('[Content_Types].xml', new_content_types_xml)
                    for name, data in other_files.items():
                        zout.writestr(name, data)

                # Replace original
                os.replace(tmp_path, file_path)
                
                print(f"   ✅ Added {len(added_comments)} comment(s) successfully!")

                # Step 12: Emit SINGLE file event after ALL comments are added
                fe_data = _build_files_event_data(file_path, f"Comments added to: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)

                return {
                    'success': len(errors) == 0,
                    'message': f'Added {len(added_comments)} comment(s) to document',
                    'comments_added': len(added_comments),
                    'errors': errors if errors else None,
                    'file_path': file_path
                }

            except Exception as e:
                import traceback
                traceback.print_exc()
                return {
                    'success': False,
                    'error': str(e),
                    'message': f'Failed to add comments: {e}'
                }

        def remove_comment_tool(
            file_path: str,
            comment_ids: list = None,
            # Legacy single comment_id parameter
            comment_id: int = None,
        ):
            """
            Remove one or more comments from a DOCX document.

            This tool removes the comment(s) with the specified ID(s) from the document,
            including:
            - Comment markers from document.xml (commentRangeStart, commentRangeEnd, commentReference)
            - The comment entry from comments.xml, commentsExtended.xml, commentsIds.xml, commentsExtensible.xml
            - Cleanup of relationships and content types if no comments remain

            ALL comments are processed in a SINGLE pass, and ONE file event is emitted
            at the end after all comments are removed.

            Best for:
            - "remove all comments"
            - "clear all annotations"
            - "delete comments #0, #1, #2"
            - "清除所有批注"
            - "删除第N条批注"

            Args:
                file_path: Path to the DOCX file to remove comment from.
                comment_ids: List of comment IDs to remove. Example: [0, 1, 2] removes comments with IDs 0, 1, and 2.
                    Use "all" as a special value to remove all comments.
                comment_id: (Legacy) Single comment ID to remove.
            """
            import zipfile
            from lxml import etree

            # Handle batch comment IDs
            remove_all = False
            ids_to_remove = []
            
            if comment_ids is not None:
                # Normalize to handle various input types
                if isinstance(comment_ids, str):
                    if comment_ids.lower() == "all":
                        remove_all = True
                        print(f"   Mode: Remove ALL comments")
                    else:
                        # Single ID as string
                        ids_to_remove = [comment_ids]
                elif isinstance(comment_ids, list):
                    if len(comment_ids) == 0:
                        return {
                            'success': False,
                            'error': 'Empty list',
                            'message': 'comment_ids list is empty'
                        }
                    ids_to_remove = [str(i) for i in comment_ids]
                else:
                    ids_to_remove = [str(comment_ids)]
            elif comment_id is not None:
                ids_to_remove = [str(comment_id)]
            else:
                return {
                    'success': False,
                    'error': 'Invalid arguments',
                    'message': 'Either provide "comment_ids" list or "comment_id"'
                }

            print(f"🔧 remove_comment_tool called:")
            print(f"   File: {file_path}")
            print(f"   remove_all: {remove_all}")
            print(f"   ids_to_remove: {ids_to_remove}")

            if not os.path.exists(file_path):
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }

            # Namespace definitions
            NSMAP = {
                'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
                'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
                'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
                'w16cid': 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
                'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
            }

            def qn(tag):
                """Resolve a qualified name like 'w:body' to '{ns}body'."""
                prefix, local = tag.split(':')
                return f'{{{NSMAP[prefix]}}}{local}'

            try:
                # Step 1: Read the DOCX as a zip file (once)
                with zipfile.ZipFile(file_path, 'r') as zin:
                    has_comments = 'word/comments.xml' in zin.namelist()
                    has_comments_extended = 'word/commentsExtended.xml' in zin.namelist()
                    has_comments_ids = 'word/commentsIds.xml' in zin.namelist()
                    has_comments_extensible = 'word/commentsExtensible.xml' in zin.namelist()
                    
                    if not has_comments:
                        return {
                            'success': False,
                            'error': 'No comments in document',
                            'message': 'The document has no comments to remove'
                        }
                    
                    doc_xml = zin.read('word/document.xml')
                    comments_xml = zin.read('word/comments.xml')
                    comments_extended_xml = zin.read('word/commentsExtended.xml') if has_comments_extended else None
                    comments_ids_xml = zin.read('word/commentsIds.xml') if has_comments_ids else None
                    comments_extensible_xml = zin.read('word/commentsExtensible.xml') if has_comments_extensible else None
                    rels_xml = zin.read('word/_rels/document.xml.rels')
                    content_types_xml = zin.read('[Content_Types].xml')
                    
                    other_files = {}
                    for name in zin.namelist():
                        if name not in ('word/document.xml', 'word/comments.xml', 'word/commentsExtended.xml',
                                       'word/commentsIds.xml', 'word/commentsExtensible.xml',
                                       'word/_rels/document.xml.rels', '[Content_Types].xml'):
                            other_files[name] = zin.read(name)

                # Step 2: If removing all, get all comment IDs first
                if remove_all:
                    comments_tree = etree.fromstring(comments_xml)
                    all_comments = comments_tree.findall(qn('w:comment'))
                    print(f"   Found {len(all_comments)} comments in document")
                    for c in all_comments:
                        cid = c.get(qn('w:id'))
                        print(f"      - Comment ID: {cid}")
                        ids_to_remove.append(cid)
                    print(f"   ids_to_remove populated: {ids_to_remove}")

                # Step 3: Parse and clean document.xml - remove comment markers for ALL IDs
                doc_tree = etree.fromstring(doc_xml)
                
                removed_markers = 0
                for c_id in ids_to_remove:
                    # Remove commentRangeStart elements
                    for elem in doc_tree.findall(f'.//{qn("w:commentRangeStart")}'):
                        if elem.get(qn('w:id')) == c_id:
                            # Find parent paragraph and remove
                            for para in doc_tree.findall(f'.//{qn("w:p")}'):
                                if elem in list(para):
                                    para.remove(elem)
                                    removed_markers += 1
                                    break
                    
                    # Remove commentRangeEnd elements
                    for elem in doc_tree.findall(f'.//{qn("w:commentRangeEnd")}'):
                        if elem.get(qn('w:id')) == c_id:
                            for para in doc_tree.findall(f'.//{qn("w:p")}'):
                                if elem in list(para):
                                    para.remove(elem)
                                    removed_markers += 1
                                    break
                    
                    # Remove commentReference runs (entire w:r containing the reference)
                    for para in doc_tree.findall(f'.//{qn("w:p")}'):
                        for run in list(para.findall(qn('w:r'))):
                            comment_ref = run.find(qn('w:commentReference'))
                            if comment_ref is not None and comment_ref.get(qn('w:id')) == c_id:
                                para.remove(run)
                                removed_markers += 1

                new_doc_xml = etree.tostring(doc_tree, xml_declaration=True, encoding='UTF-8', standalone=True)
                print(f"   Removed {removed_markers} comment marker(s) from document.xml")

                # Step 4: Parse comments.xml and remove all target comments
                comments_tree = etree.fromstring(comments_xml)
                removed_comments = []
                
                print(f"   Step 4: Looking for comment IDs: {ids_to_remove}")
                
                for comment in list(comments_tree.findall(qn('w:comment'))):
                    c_id = comment.get(qn('w:id'))
                    if c_id in ids_to_remove:
                        # Get paraId before removing for later use in extended files
                        para_elem = comment.find(qn('w:p'))
                        para_id = para_elem.get(qn('w14:paraId')) if para_elem is not None else None
                        
                        comments_tree.remove(comment)
                        removed_comments.append({'id': c_id, 'para_id': para_id})
                        print(f"   Removed comment #{c_id} from comments.xml")

                if not removed_comments:
                    return {
                        'success': False,
                        'error': 'Comment not found',
                        'message': f'Comment(s) not found in document'
                    }

                new_comments_xml = etree.tostring(comments_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 5: Update commentsExtended.xml
                new_comments_extended_xml = None
                if has_comments_extended and comments_extended_xml:
                    ext_tree = etree.fromstring(comments_extended_xml)
                    for para_id in [c['para_id'] for c in removed_comments if c['para_id']]:
                        for ex in ext_tree.findall(qn('w15:commentEx')):
                            if ex.get(qn('w15:paraId')) == para_id:
                                ext_tree.remove(ex)
                                break
                    new_comments_extended_xml = etree.tostring(ext_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 6: Update commentsIds.xml
                new_comments_ids_xml = None
                if has_comments_ids and comments_ids_xml:
                    ids_tree = etree.fromstring(comments_ids_xml)
                    for c in removed_comments:
                        for cid in list(ids_tree.findall(qn('w16cid:commentId'))):
                            if cid.get(qn('w16cid:paraId')) == c['para_id']:
                                ids_tree.remove(cid)
                                break
                    new_comments_ids_xml = etree.tostring(ids_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 7: Update commentsExtensible.xml
                new_comments_extensible_xml = None
                if has_comments_extensible and comments_extensible_xml:
                    ext2_tree = etree.fromstring(comments_extensible_xml)
                    # Remove all extensible entries for removed comments (we need durableId matching which is complex)
                    # For simplicity, we'll just regenerate if empty
                    if len(ext2_tree) == 0:
                        new_comments_extensible_xml = None
                        has_comments_extensible = False

                # Step 8: Check if there are any remaining comments
                remaining_comments = comments_tree.findall(qn('w:comment'))
                
                if remaining_comments:
                    # There are still comments, keep all comment XML files
                    keep_comments = True
                else:
                    # No more comments, remove all comment XML files and clean up
                    keep_comments = False
                    print(f"   No more comments, will clean up all comment files")

                # Step 9: Update relationships if removing comments entirely
                rels_tree = etree.fromstring(rels_xml)
                comment_rel_types = [
                    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
                    'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
                    'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
                    'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
                ]
                
                if not keep_comments:
                    # Remove all comment relationships
                    for rel in list(rels_tree):
                        if rel.get('Type', '') in comment_rel_types:
                            rels_tree.remove(rel)
                    print(f"   Removed all comment relationships")
                
                new_rels_xml = etree.tostring(rels_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 10: Update [Content_Types].xml
                ct_tree = etree.fromstring(content_types_xml)
                ns_ct = 'http://schemas.openxmlformats.org/package/2006/content-types'
                
                comment_parts = [
                    '/word/comments.xml',
                    '/word/commentsExtended.xml',
                    '/word/commentsIds.xml',
                    '/word/commentsExtensible.xml',
                ]
                
                if not keep_comments:
                    # Remove all comment content types
                    for child in list(ct_tree):
                        if child.get('PartName') in comment_parts:
                            ct_tree.remove(child)
                    print(f"   Removed all comment content types")
                
                new_content_types_xml = etree.tostring(ct_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

                # Step 11: Write back to docx (ONE file write)
                tmp_path = file_path + '.tmp'
                with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                    zout.writestr('word/document.xml', new_doc_xml)
                    if keep_comments:
                        zout.writestr('word/comments.xml', new_comments_xml)
                        if new_comments_extended_xml:
                            zout.writestr('word/commentsExtended.xml', new_comments_extended_xml)
                        if new_comments_ids_xml:
                            zout.writestr('word/commentsIds.xml', new_comments_ids_xml)
                    zout.writestr('word/_rels/document.xml.rels', new_rels_xml)
                    zout.writestr('[Content_Types].xml', new_content_types_xml)
                    for name, data in other_files.items():
                        zout.writestr(name, data)

                os.replace(tmp_path, file_path)
                print(f"   ✅ Removed {len(removed_comments)} comment(s) successfully!")

                # Step 12: Emit SINGLE file event after all comments removed
                fe_data = _build_files_event_data(file_path, f"Comments removed from: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)

                return {
                    'success': True,
                    'message': f'Removed {len(removed_comments)} comment(s) from document',
                    'comments_removed': len(removed_comments),
                    'file_path': file_path
                }

            except Exception as e:
                import traceback
                traceback.print_exc()
                return {
                    'success': False,
                    'error': str(e),
                    'message': f'Failed to remove comment(s): {e}'
                }

        # ============ DOCX SKILL TOOLS (XML-level, formatting-safe) ============
        # These tools wrap the scripts in skills/docx/scripts/ and provide
        # a formatting-preserving workflow: unpack → edit XML → repack.

        _SKILL_SCRIPTS_DIR = Path(__file__).parent / "skills" / "docx" / "scripts"
        _OFFICE_SCRIPTS_DIR = _SKILL_SCRIPTS_DIR / "office"

        def unpack_docx_tool(file_path: str, output_dir: str, merge_runs: bool = True, simplify_redlines: bool = True):
            """
            Unpack a DOCX file into a directory of editable XML files.

            This is the first step of the formatting-safe editing workflow.
            It extracts the ZIP archive, pretty-prints XML, merges adjacent
            runs with identical formatting, simplifies tracked changes, and
            escapes smart quotes for safe editing.

            Use this when you need to make advanced edits that python-docx
            cannot handle without formatting loss, such as:
            - Complex tracked changes (deletions + insertions with author attribution)
            - Advanced comments via the comment.py script
            - Preserving every formatting detail during text edits

            After unpacking, edit the XML files in output_dir/word/ directly,
            then use pack_docx_tool to reassemble.

            Args:
                file_path: Path to the DOCX file to unpack.
                output_dir: Directory to extract into (will be created).
                merge_runs: Merge adjacent runs with identical formatting (default True).
                simplify_redlines: Simplify adjacent tracked changes from same author (default True).
            """
            import sys as _sys
            _saved = _sys.path[:]
            _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
            try:
                from unpack import unpack
                _, message = unpack(file_path, output_dir, merge_runs=merge_runs, simplify_redlines=simplify_redlines)
                success = "Error" not in message
                return {'success': success, 'message': message, 'output_dir': output_dir}
            except Exception as e:
                return {'success': False, 'error': str(e), 'message': f'Failed to unpack: {e}'}
            finally:
                _sys.path[:] = _saved

        def pack_docx_tool(input_dir: str, output_file: str, original_file: str = None, validate: bool = True):
            """
            Pack an unpacked directory back into a DOCX file.

            This is the final step of the formatting-safe editing workflow.
            It validates the XML with auto-repair, condenses formatting, and
            creates the output DOCX.

            Auto-repair fixes:
            - durableId values that exceed OOXML limits (regenerates valid IDs)
            - Missing xml:space="preserve" on <w:t> elements with whitespace

            Args:
                input_dir: Path to the unpacked directory (from unpack_docx_tool).
                output_file: Path for the output DOCX file.
                original_file: (Optional) Path to the original DOCX for validation comparison.
                validate: Run schema validation with auto-repair (default True).
            """
            import sys as _sys
            _saved = _sys.path[:]
            _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
            try:
                from pack import pack
                _, message = pack(input_dir, output_file, original_file=original_file, validate=validate)
                success = "Error" not in message
                if success:
                    fe_data = _build_files_event_data(output_file, f"Packed DOCX: {Path(output_file).name}")
                    if fe_data:
                        _pending_files_events.append(fe_data)
                return {'success': success, 'message': message, 'output_file': output_file}
            except Exception as e:
                return {'success': False, 'error': str(e), 'message': f'Failed to pack: {e}'}
            finally:
                _sys.path[:] = _saved

        def validate_docx_tool(path: str, original: str = None, auto_repair: bool = True):
            """
            Validate a DOCX file or unpacked directory against OOXML schemas.

            Can validate either a packed .docx file or an unpacked directory.
            Optionally compares against the original file to check for
            tracked-change consistency.

            Args:
                path: Path to the unpacked directory or packed DOCX file.
                original: (Optional) Path to the original DOCX for comparison.
                auto_repair: Automatically repair common issues (default True).
            """
            import sys as _sys
            import tempfile
            import zipfile
            _saved = _sys.path[:]
            _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
            try:
                from validators import DOCXSchemaValidator, RedliningValidator
                unpacked_dir = Path(path)
                original_file = Path(original) if original else None

                # If path is a .docx file, unpack to temp dir
                if unpacked_dir.is_file() and unpacked_dir.suffix.lower() == '.docx':
                    temp_dir = tempfile.mkdtemp()
                    with zipfile.ZipFile(unpacked_dir, 'r') as zf:
                        zf.extractall(temp_dir)
                    unpacked_dir = Path(temp_dir)

                validators = [DOCXSchemaValidator(unpacked_dir, original_file)]
                if original_file and original_file.exists():
                    validators.append(RedliningValidator(unpacked_dir, original_file, author="DocMaster"))

                output_lines = []
                if auto_repair:
                    total_repairs = sum(v.repair() for v in validators)
                    if total_repairs:
                        output_lines.append(f"Auto-repaired {total_repairs} issue(s)")

                success = all(v.validate() for v in validators)
                if success:
                    output_lines.append("All validations PASSED!")

                return {'success': success, 'message': '\n'.join(output_lines)}
            except Exception as e:
                return {'success': False, 'error': str(e), 'message': f'Validation failed: {e}'}
            finally:
                _sys.path[:] = _saved

        def accept_tracked_changes_tool(input_file: str, output_file: str):
            """
            Accept all tracked changes in a DOCX file using LibreOffice.

            Produces a clean document with all insertions accepted and
            deletions removed. Requires LibreOffice to be installed.

            Args:
                input_file: Path to the DOCX file with tracked changes.
                output_file: Path for the clean output DOCX.
            """
            import sys as _sys
            _saved = _sys.path[:]
            _sys.path.insert(0, str(_SKILL_SCRIPTS_DIR))
            _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
            try:
                from accept_changes import accept_changes
                _, message = accept_changes(input_file, output_file)
                success = "Error" not in message
                if success:
                    fe_data = _build_files_event_data(output_file, f"Tracked changes accepted: {Path(output_file).name}")
                    if fe_data:
                        _pending_files_events.append(fe_data)
                return {'success': success, 'message': message, 'output_file': output_file}
            except Exception as e:
                return {'success': False, 'error': str(e), 'message': f'Failed to accept changes: {e}'}
            finally:
                _sys.path[:] = _saved

        def add_xml_comment_tool(unpacked_dir: str, comment_id: int, text: str, author: str = "DocMaster", initials: str = "DM", parent_id: int = None):
            """
            Add a comment to an unpacked DOCX directory (XML-level).

            This handles all the boilerplate across comments.xml,
            commentsExtended.xml, commentsIds.xml, and commentsExtensible.xml.

            After calling this, you still need to add markers to document.xml:
              <w:commentRangeStart w:id="ID"/>
              ...commented runs...
              <w:commentRangeEnd w:id="ID"/>
              <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="ID"/></w:r>

            Args:
                unpacked_dir: Path to the unpacked DOCX directory.
                comment_id: Unique integer ID for this comment.
                text: Comment text (should be pre-escaped XML).
                author: Author name (default "DocMaster").
                initials: Author initials (default "DM").
                parent_id: (Optional) Parent comment ID for replies.
            """
            import sys as _sys
            _saved = _sys.path[:]
            _sys.path.insert(0, str(_SKILL_SCRIPTS_DIR))
            _sys.path.insert(0, str(_OFFICE_SCRIPTS_DIR))
            try:
                from comment import add_comment
                para_id, message = add_comment(unpacked_dir, comment_id, text, author, initials, parent_id)
                success = "Error" not in message
                result = {'success': success, 'message': message, 'para_id': para_id}
                if parent_id is not None:
                    result['marker_hint'] = f'Nest markers: commentRangeStart id="{parent_id}" then id="{comment_id}"'
                else:
                    result['marker_hint'] = f'Add markers: commentRangeStart/End id="{comment_id}" around target text'
                return result
            except Exception as e:
                return {'success': False, 'error': str(e), 'message': f'Failed to add comment: {e}'}
            finally:
                _sys.path[:] = _saved

        tools = [
            process_document,
            edit_docx_tool,
            extract_docx_content_tool,
            # New enhanced editing tools
            delete_docx_content_tool,
            modify_docx_fonts_tool,
            create_docx_with_content_tool,
            # Legacy .doc → .docx conversion (call first for any uploaded .doc)
            convert_doc_to_docx_tool,
            # Template-fill tools (uploaded .docx as template)
            inspect_docx_template_tool,
            fill_docx_template_tool,
            # Template library — shared + per-user persistent catalog
            list_templates_tool,
            get_template_path_tool,
            save_template_tool,
            add_bullet_list_tool,
            add_numbered_list_tool,
            add_comment_tool,
            remove_comment_tool,
            # XML-level formatting-safe tools (from docx skill)
            unpack_docx_tool,
            pack_docx_tool,
            validate_docx_tool,
            accept_tracked_changes_tool,
            add_xml_comment_tool,
        ]
    
    return DocMasterAgent(
        pending_files_events=_pending_files_events,
        name="DocMaster",
        model_client=set_model_client(default_config_name),
        system_message=SYSTEM,
        reflect_on_tool_use=False,  # Disable reflection to simplify
        model_client_stream=True,  # Disable streaming to avoid timeout issues
        
        # DrSaiAgent特定配置
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=set_model_client,
        llm_mode_config=llm_mode_config,
        
        # 技能和工作目录
        skills_dir=[
            str(Path(__file__).parent / "document_skills") if DOCUMENT_PROCESSING_AVAILABLE else os.getenv("SYSTEM_SKILLS_DIR"),
            str(Path(__file__).parent / "skills"),
        ],
        work_dir=WORKDIR,
        only_in_workspace=True,
        
        # Tools configuration
        tools=tools,
        
        # 子智能体配置
        sub_agent_config=SUB_AGENTS,
        
        # 资源限制
        token_limit=60000,  # deepseek-v4-flash supports 128k context
        
        # RAG集成（可选）
        rag_flow_url=os.getenv('RAGFLOW_URL'),
        rag_flow_token=os.getenv('RAGFLOW_TOKEN'),
        memory_dataset_id=os.getenv('MEMORY_DATASET_ID'),
        
        # 额外配置
        max_turn_count=30,
    )

def main():
    """主函数：启动Word文档编辑智能体"""
    from drsai.backend import run_worker, run_console
    
    # 方式1：作为Worker服务运行（注册到HepAI平台）
    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="DocMaster",
            author="haiuser01@ihep.ac.cn",  # 改成你的邮箱
            description="专业的Word文档处理大师，支持上传、分析、编辑、格式化Word文档，支持添加和删除批注和评论",
            version="1.0.0",
            logo="docmaster_logo.png",  # 需要提供logo URL

            permission='groups: drsai; users: admin, haiuser01@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: haiuser01@ihep.ac.cn',
            
            # 示例对话
            examples=[
                "DocMaster，请帮我分析这份文档的主要内容",
                "先读取这份 DOCX 的内容，再帮我润色引言部分",
                "把文档中的技术术语替换为更通俗的表达",
                "在这份 DOCX 末尾新增一个总结段落",
                "新建一份 DOCX，包含标题、正文和一个简单表格",
                "把这份 DOCX 的中文设为宋体、英文设为 Times New Roman",
                "这是一份合同模板，请按以下信息填充并生成新文档：甲方=张三，乙方=李四，日期=2026-05-13",
                "我上传了一份带 {{ name }}、{{ date }} 占位符的模板，请帮我填充",
            ],
            
            # 模型配置
            agent_config=llm_mode_config,
            default_config_name="deepseek-v4-flash(Fast)",
            
            # 智能体工厂
            agent_factory=create_word_editor_agent,
            
            # 服务配置
            port=42819,  # 选择一个未使用的端口
            no_register=False,  # 注册到HepAI平台
            enable_openwebui_pipeline=True,
            history_mode="backend",
            
            # 其他配置
            join_topics=["document-processing", "office-tools"],
            metadata={
                "category": "文档处理大师",
                "tags": ["docmaster", "word", "文档编辑", "办公自动化", "专业文档"],
                "capabilities": ["文档分析", "内容编辑", "格式优化", "结构重组", "专业排版"],
                "dependencies": {
                    "python": ["python-docx", "PyPDF2", "python-pptx", "pandas", "openpyxl"],
                    "system": ["pandoc", "libreoffice", "poppler-utils (pdftoppm)"],
                    "npm": ["docx"],
                    "install_system": "sudo apt install pandoc libreoffice poppler-utils && npm install -g docx",
                }
            },
        )
    )
    
    # 方式2：控制台测试（取消注释以使用）
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_word_editor_agent,
    #         task="请帮我分析这个Word文档"
    #     )
    # )

if __name__ == "__main__":
    main()
# __DRSAI_CWD__:/aifs/user/home/haiuser01/drsai_code/workspace/runs
