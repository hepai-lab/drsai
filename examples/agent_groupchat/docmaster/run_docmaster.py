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
from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage
from autogen_agentchat.base import Response
from autogen_core import CancellationToken

# Import document processing components
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))
try:
    from document_processor import DocumentProcessor, print_document_summary
    from document_skills.process_document_skill import DocumentProcessingSkill
    DOCUMENT_PROCESSING_AVAILABLE = True
except ImportError as e:
    DOCUMENT_PROCESSING_AVAILABLE = False
    print(f"⚠️ Document processing components not available: {e}")
    print("Install with: pip install python-docx PyPDF2 python-pptx pandas openpyxl")

from dotenv import load_dotenv
load_dotenv()

# 工作目录设置
HERE = Path(__file__).parent
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
    """DrSaiAssistant subclass that emits FilesEvent for generated/edited documents."""

    def __init__(self, pending_files_events: list, **kwargs):
        super().__init__(**kwargs)
        self._pending_files_events = pending_files_events

    async def on_messages_stream(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        async for event in super().on_messages_stream(messages, cancellation_token):
            yield event
            # After each event, drain any pending file events that tools may have queued
            while self._pending_files_events:
                fe_data = self._pending_files_events.pop(0)
                yield FilesEvent(
                    content=FilesContent(**fe_data),
                    source=self.name,
                )


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
                    timeout=30.0,
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
                    timeout=30.0,
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
                timeout=30.0,
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
4. 对图片、超链接、页眉页脚、复杂版式重排等高级 Word 元素，不要假装已经可靠支持；如果用户提出这类需求，可以先说明当前能力更适合文本、标题、段落、表格和字体层面的处理。

【核心工作原则】
1. 先判断任务类型，再选择工具。
2. 如果用户没有提供文件路径、文件内容或明确目标，不要猜，先提出一个简短的澄清问题。
3. 对于非简单替换类编辑请求，优先先检查文档内容或结构，再执行修改。
4. 不要声称已经完成工具未实际执行的操作。
5. 若任务超出当前工具能力，要明确说明限制，并给出最接近的可执行方案。
6. 编辑操作默认会直接覆盖原始 DOCX 文件，必要时应提醒用户这一点。

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
3. 执行后，简洁说明结果，不要长篇空话。
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
                    - {'type': 'add_bullet_list', 'items': ['要点一', '要点二'], 'position': 'end'}
                    - {'type': 'add_numbered_list', 'items': ['第一步', '第二步'], 'position': 'end'}
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
                    if edit_type == 'replace':
                        if 'target' in edit and 'replacement' in edit:
                            standardized_edits.append({
                                'type': 'replace_text',
                                'old_text': edit['target'],
                                'new_text': edit['replacement']
                            })
                            conversion_stats['llm_format'] += 1
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
                    if edit_type in ['replace_text', 'add_paragraph', 'add_heading', 'modify_style', 'add_table', 'format_text', 'format_paragraph', 'add_page_break', 'set_table_style']:
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
            
            # Add debugging info to help diagnose issues
            result['debug_info'] = {
                'original_edits_count': len(edits),
                'standardized_edits_count': len(standardized_edits),
                'conversion_stats': conversion_stats,
                'file_path': file_path,
                'file_exists': os.path.exists(file_path),
                'edits_sample': edits[:2] if edits else []
            }
            
            print(f"✅ edit_docx_tool result: {result.get('success', False)}")
            if not result.get('success', False):
                print(f"❌ Error: {result.get('error', 'Unknown error')}")
                print(f"📝 Message: {result.get('message', 'No message')}")
            else:
                fe_data = _build_files_event_data(file_path, f"Edited DOCX: {Path(file_path).name}")
                if fe_data:
                    _pending_files_events.append(fe_data)
            
            return result
        
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
            return result
        
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

            return result
        
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

            return result
        
        tools = [
            process_document,
            edit_docx_tool,
            extract_docx_content_tool,
            # New enhanced editing tools
            delete_docx_content_tool,
            modify_docx_fonts_tool,
            create_docx_with_content_tool,
            add_bullet_list_tool,
            add_numbered_list_tool
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
        skills_dir=str(Path(__file__).parent / "document_skills") if DOCUMENT_PROCESSING_AVAILABLE else os.getenv("SYSTEM_SKILLS_DIR"),
        work_dir=WORKDIR,
        only_in_workspace=True,
        
        # Tools configuration
        tools=tools,
        
        # 子智能体配置
        sub_agent_config=SUB_AGENTS,
        
        # 资源限制
        token_limit=15000,  # Set token limit below max_tokens
        
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
            description="专业的Word文档处理大师，支持上传、分析、编辑、格式化Word文档",
            version="1.0.0",
            logo="https://example.com/word-editor-logo.png",  # 需要提供logo URL

            permission='groups: drsai; users: admin, haiuser01@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: haiuser01@ihep.ac.cn',
            
            # 示例对话
            examples=[
                "DocMaster，请帮我分析这份文档的主要内容",
                "先读取这份 DOCX 的内容，再帮我润色引言部分",
                "把文档中的技术术语替换为更通俗的表达",
                "在这份 DOCX 末尾新增一个总结段落",
                "新建一份 DOCX，包含标题、正文和一个简单表格",
                "把这份 DOCX 的中文设为宋体、英文设为 Times New Roman",
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
                "capabilities": ["文档分析", "内容编辑", "格式优化", "结构重组", "专业排版"]
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
