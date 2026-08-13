
#!/usr/bin/env python3
"""
Word文档编辑智能体 - 主启动脚本

功能：上传、分析、修改Word文档
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from loguru import logger
from dotenv import load_dotenv
from drsai.modules.managers.database import DatabaseManager


def _gfs_log(level: str, step: str, user_id: str = "", **fields) -> None:
    """Emit a single-line JSON log for GFS write steps (mirrors gfs_utils._gfs_log)."""
    record: dict = {"gfs_step": step}
    if user_id:
        record["user_id"] = user_id
    record.update(fields)
    getattr(logger, level)(json.dumps(record, ensure_ascii=False))

# 添加父目录到路径，以便导入DrSai模块
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))  # repo root (for drsai)
sys.path.insert(0, str(Path(__file__).parent.parent))                        # examples/agent_groupchat (for docmaster.*)

from docmaster.constants import HERE, WORKDIR, LLM_MODE_CONFIG
from docmaster.model_config import create_model_client
from docmaster.agent import DocMasterAgent
from docmaster.tools import get_all_tools
from docmaster.system_prompt import SYSTEM_PROMPT
from docmaster.utils.deps import ensure_python_deps
from docmaster.utils.ocr import warmup_rapidocr_at_boot

load_dotenv()

# ── Auto-install missing Python dependencies ──────────────────────────────
def _ensure_python_deps():
    """Install missing Python packages from requirements.txt at startup.

    Special handling: rapidocr_onnxruntime declares opencv-python as a dependency,
    but we need opencv-python-headless on headless servers (no libGL.so.1). After
    install, we forcibly swap opencv-python → opencv-python-headless if present.
    """
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

        # Post-install fix: swap opencv-python → opencv-python-headless if pip
        # auto-installed the GUI variant as a transitive dependency.
        list_result = subprocess.run(
            ["pip", "list"], capture_output=True, text=True, timeout=30
        )
        has_gui = any(
            line.startswith("opencv-python ") for line in list_result.stdout.splitlines()
        )
        if has_gui:
            print("🔧 Detected opencv-python (GUI variant) — swapping for headless")
            subprocess.run(
                ["pip", "uninstall", "-y", "opencv-python"],
                capture_output=True, text=True, timeout=60
            )
            subprocess.run(
                ["pip", "install", "--force-reinstall", "--no-deps", "opencv-python-headless"],
                capture_output=True, text=True, timeout=120
            )
            print("✅ opencv-python-headless restored")
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

# ── Stable worker id ──────────────────────────────────────────────────────────
# HepAI's HWorker generates a fresh `wk-<random>` id on every boot
# (_worker_class.py:169-173). That makes the DDF hub treat every restart as a
# brand-new worker, which orphans in-flight routes for ~heartbeat-interval
# seconds and causes "Failed to connect to worker" until the old route times
# out. Override by setting `worker_id` on the config object *before* HWorkerAPP
# constructs the CommonWorker — _init_config_dict pulls from config.__dict__,
# and the base reads via config_dict.get("worker_id", None).
#
# Stable across restarts → the hub keeps the same route, restart-driven
# downtime drops to "however long boot takes."
_DOCMASTER_WORKER_ID = os.environ.get(
    "DOCMASTER_WORKER_ID", "wk-docmaster-stable"
)


def _install_stable_worker_id():
    """Wrap HWorkerAPP.__init__ to stamp a fixed `worker_id` onto the
    worker_config before the base worker reads it."""
    from hepai.components.haiddf.worker.worker_app import HWorkerAPP

    _original_init = HWorkerAPP.__init__

    def _patched_init(self, models, worker_config=None, *args, **kwargs):
        if worker_config is not None and not getattr(worker_config, "worker_id", None):
            setattr(worker_config, "worker_id", _DOCMASTER_WORKER_ID)
        return _original_init(self, models, worker_config=worker_config, *args, **kwargs)

    HWorkerAPP.__init__ = _patched_init


_install_stable_worker_id()


WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKSPACE / "runs"
WORKDIR.mkdir(parents=True, exist_ok=True)

# ── ppt-master skill paths ────────────────────────────────────────────────
# ppt-master is registered as a DrSai skill (its SKILL.md lives one level
# below `skills/`, at skills/ppt-master/skills/ppt-master/SKILL.md). DrSai's
# SkillLoader scans each skills_dir entry with a SINGLE-level iterdir(), so
# we register the `skills/ppt-master/skills` directory — its direct child
# `ppt-master/` is the skill folder that contains SKILL.md.
#
# The same root is also added to extra_work_dirs below: DrSai's
# only_in_workspace sandbox (operater_funs.safe_path / _check_cmd_paths)
# rejects any absolute path not under [WORKDIR] + extra_dirs. Without this,
# the agent's run_bash / run_read calls into the skill's scripts/ and
# references/ would be blocked as "Path escapes workspace".
PPT_MASTER_SKILL_ROOT = HERE / "skills" / "ppt-master" / "skills"
"""Directory whose direct children are DrSai skills (contains `ppt-master/`)."""

PPT_MASTER_DIR = PPT_MASTER_SKILL_ROOT / "ppt-master"
"""The ppt-master skill folder (contains SKILL.md, scripts/, references/, templates/)."""

PPT_MASTER_SCRIPTS_DIR = PPT_MASTER_DIR / "scripts"
"""Runnable ppt-master scripts (project_manager.py, svg_to_pptx.py, finalize_svg.py, ...)."""

# Module-global RapidOCR engine pool, shared across every session's
# extract_scanned_pdf_tool closure. The pool size caps real OCR
# parallelism — ONNX Runtime is thread-safe but a single InferenceSession
# serializes most of the pre/post-processing, so >1 concurrent caller on
# the same engine ends up roughly serial. 4 engines gives 4-way real
# parallelism at ~80MB RAM each. Populated either lazily on first OCR
# call or eagerly by _warmup_rapidocr_at_boot() — whichever runs first.
import queue as _ocr_queue
_RAPIDOCR_POOL: "_ocr_queue.Queue" = _ocr_queue.Queue()
_RAPIDOCR_POOL_SIZE = 4
_RAPIDOCR_POOL_LOCK = None  # set to a threading.Lock at module init

# Bound concurrent extract_scanned_pdf_tool invocations. The LLM routinely
# fans out 8+ scanner calls in a single turn; without this gate each call
# pins its own batch of numpy pixmaps and per-thread OCR buffers in RAM
# and we tip past PM2's memory cap. Size 2 lets two PDFs OCR in parallel
# (still useful for the common 关联业务 batch) without runaway RSS.
import threading as _ocr_threading
_OCR_TOOL_SEMAPHORE = _ocr_threading.Semaphore(2)

def _ensure_rapidocr_pool_lock():
    global _RAPIDOCR_POOL_LOCK
    if _RAPIDOCR_POOL_LOCK is None:
        import threading
        _RAPIDOCR_POOL_LOCK = threading.Lock()
    return _RAPIDOCR_POOL_LOCK

def _warmup_rapidocr_at_boot():
    """Pre-load RapidOCR ONNX models into a pool of N engines in a daemon
    thread at process start so the first 关联业务 audit doesn't burn its
    tool-call timeout on engine init. Safe to call multiple times — only
    fills the pool if it's empty.
    """
    if not _RAPIDOCR_POOL.empty():
        return
    def _do():
        try:
            from rapidocr_onnxruntime import RapidOCR
            lock = _ensure_rapidocr_pool_lock()
            with lock:
                if not _RAPIDOCR_POOL.empty():
                    return
                for _ in range(_RAPIDOCR_POOL_SIZE):
                    _RAPIDOCR_POOL.put(
                        RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
                    )
            print(
                f"[docmaster] RapidOCR warmup complete ({_RAPIDOCR_POOL_SIZE} engines)",
                flush=True,
            )
        except Exception as e:
            print(f"[docmaster] RapidOCR warmup failed: {e!r}", flush=True)
    import threading
    threading.Thread(target=_do, name="rapidocr-warmup", daemon=True).start()


# ── GFS integration helpers ───────────────────────────────────────────────
def _as_bool(value, default: bool = False) -> bool:
    """Convert env string to boolean."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "y", "on", "enable", "enabled"} or (
        default if text not in {"0", "false", "no", "n", "off", "disable", "disabled"} else False
    )


def _build_gfs_tools(user_id: str | None) -> list:
    """Build GFS function-calling tools for the specified user.

    Environment variables:
      - DRSAI_GFS_ENABLED (default false): master switch
      - GFS_OPENAPI_KEY: admin API key (required, read by GfsAdminClient)

    Returns empty list on failure to avoid breaking agent creation.
    """
    if not _as_bool(os.getenv("DRSAI_GFS_ENABLED"), default=False):
        return []
    if not user_id:
        return []
    try:
        # Lazy import: boto3 may not be installed in slim environments
        from drsai.modules.managers.gfs import make_gfs_tools
    except ImportError as e:
        logger.warning("DRSAI_GFS_ENABLED=true but gfs module import failed: %s", e)
        return []
    try:
        tools = make_gfs_tools(user_id)
        logger.info("GFS enabled for user %s: %d tools registered",
                    user_id, len(tools))
        return tools
    except Exception as e:
        logger.warning("make_gfs_tools(%s) failed: %s. Falling back to no GFS.",
                       user_id, e)
        return []


def create_word_editor_agent(
        api_key: str | None = None,
        thread_id: str | None = None,
        user_id: str | None = None,
        db_manager: DatabaseManager | None = None,
        default_config_name: str | None = None,
) -> DocMasterAgent:
    """创建Word文档编辑智能体

    Args:
        api_key: HepAI API密钥
        thread_id: 对话线程ID
        user_id: 用户ID
        db_manager: 数据库管理器
        default_config_name: 默认模型配置名称

    Returns:
        DocMasterAgent实例
    """
    # 初始化事件列表和模型客户端
    pending_events = []
    model_client = create_model_client(default_config_name, api_key)

    # 收集所有工具
    tools = get_all_tools(pending_events, user_id)
    tools.extend(_build_gfs_tools(user_id))

    # 创建并返回 DocMasterAgent
    return DocMasterAgent(
        pending_files_events=pending_events,
        name="DocMaster",
        model_client=model_client,
        system_message=SYSTEM_PROMPT,
        reflect_on_tool_use=False,
        model_client_stream=True,
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=lambda cfg=None: create_model_client(cfg, api_key),
        llm_mode_config=LLM_MODE_CONFIG,
        skills_dir=[
            str(HERE / "document_skills"),
            str(HERE / "skills"),
            str(PPT_MASTER_SKILL_ROOT),   # ppt-master: single-level scan finds skills/ppt-master/skills/ppt-master/SKILL.md
        ],
        work_dir=WORKDIR,
        only_in_workspace=True,
        # Let the agent run ppt-master's scripts/ and read references/ — the
        # skill root lives outside WORKDIR, so without this the sandbox would
        # reject every `python3 <skill>/scripts/*.py` / `run_read <ref>.md`.
        # Write scope stays limited to WORKDIR; this only unlocks read+exec
        # of the (read-only) skill bundle.
        extra_work_dirs=[str(PPT_MASTER_SKILL_ROOT)],
        tools=tools,
        token_limit=100000,
        rag_flow_url=os.getenv('RAGFLOW_URL'),
        rag_flow_token=os.getenv('RAGFLOW_TOKEN'),
        memory_dataset_id=os.getenv('MEMORY_DATASET_ID'),
        max_turn_count=30,
    )


def main():
    """启动Word文档编辑智能体"""
    from drsai.backend import run_worker

    warmup_rapidocr_at_boot()
    
    asyncio.run(
        run_worker(
            # ── Worker 展示信息（→ _info）──
            worker_info={
                "name": "DocMaster",
                "description": 
                    '{"en":"V1.0: A professional Word document processing tool, supporting the uploading, analyzing, editing, and formatting of Word documents, as well as the addition and deletion of annotations and comments","zh":"V1.0: 专业的Word文档处理大师，支持上传、分析、编辑、格式化Word文档，支持添加和删除批注和评论"}',
                "version": "0.1.0",
                "author": "juzy@ihep.ac.cn",
                "logo": "https://note.ihep.ac.cn/uploads/8d373a0f-0248-4b43-9747-73f15de3445b.png",
                "examples": [
                    {"en": "DocMaster, please help me analyze the main content of this document", "zh": "DocMaster，请帮我分析这份文档的主要内容"},
                    {"en": "First read the content of this DOCX, then help me polish the introduction", "zh": "先读取这份 DOCX 的内容，再帮我润色引言部分"},
                    {"en": "Replace technical terms in the document with more accessible expressions", "zh": "把文档中的技术术语替换为更通俗的表达"},
                    {"en": "Add a summary paragraph at the end of this DOCX", "zh": "在这份 DOCX 末尾新增一个总结段落"},
                    {"en": "Create a new DOCX with a title, body text, and a simple table", "zh": "新建一份 DOCX，包含标题、正文和一个简单表格"},
                    {"en": "Set Chinese font to SimSun and English font to Times New Roman in this DOCX", "zh": "把这份 DOCX 的中文设为宋体、英文设为 Times New Roman"},
                    {"en": "This is a contract template, please fill in the following info and generate a new document: Party A=Zhang San, Party B=Li Si, Date=2026-05-13", "zh": "这是一份合同模板，请按以下信息填充并生成新文档：甲方=张三，乙方=李四，日期=2026-05-13"},
                    {"en": "I uploaded a template with {{ name }}, {{ date }} placeholders, please help me fill it in", "zh": "我上传了一份带 {{ name }}、{{ date }} 占位符的模板，请帮我填充"},
                    {"en": "Help me create a 6-page PPT on the topic '2026 Q2 Security Compliance Quarterly Report', targeting institute leadership", "zh": "帮我做一份 6 页的 PPT，主题是『2026 Q2 安全合规季报』，目标读者是所领导"},
                    {"en": "Create a 4-page product weekly report deck, with a trend chart page, a solution comparison matrix page, and a conclusion page", "zh": "做一份 4 页的产品周报 deck，包含一页趋势图、一页方案对比矩阵、一页结论页"},
                    {"en": "I have a reference pptx template, please create a report following its page system", "zh": "我有一份参考 pptx 模板，请按它的页面系统做一份汇报"},
                ],
                "agent_config": LLM_MODE_CONFIG,
                "defult_config_name": "hepai/deepseek-v4-flash",
                "announcements": [
                    {"en": "OpenDrSai is ready to serve you!", "zh": "OpenDrSai 已准备好为您服务！"},
                    {"en": "reasoning is coming!", "zh": "推理功能即将上线！"},
                    {"en": "try the latest Dr.Sai features today!", "zh": "尝试今天最新的Dr.Sai功能！"},
                ],
            },
            # ── 权限配置 ──
            permission="groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, juzy@ihep.ac.cn, ddf_free; owner: juzy@ihep.ac.cn",
            # ── 智能体实体 ──
            agent_factory=create_word_editor_agent,
            # ── 后端服务配置 ──
            # controller_address = "http://127.0.0.1:42501",
            port=42819,
            no_register=False,
            # drsai_dir=DATASET,
            enable_openwebui_pipeline=False,
            history_mode="backend",
            # use_api_key_mode = "backend",
            # join_topics = ["drsai-agent"],
            # metadata={"others": "drsai-agent"},
            link_wechat=False,
        )
    )
    # asyncio.run(
    #     run_worker(
    #         agent_name="DocMaster",
    #         author="haiuser03@ihep.ac.cn",
    #         description="V1.0: 专业的Word文档处理大师，支持上传、分析、编辑、格式化Word文档，支持添加和删除批注和评论",
    #         version="1.0.0",
    #         logo="docmaster_logo.png",
    #         permission='groups: drsai; users: admin, haiuser01@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: haiuser01@ihep.ac.cn',
    #         examples=[
    #             "DocMaster，请帮我分析这份文档的主要内容",
    #             "先读取这份 DOCX 的内容，再帮我润色引言部分",
    #             "把文档中的技术术语替换为更通俗的表达",
    #             "在这份 DOCX 末尾新增一个总结段落",
    #             "新建一份 DOCX，包含标题、正文和一个简单表格",
    #             "把这份 DOCX 的中文设为宋体、英文设为 Times New Roman",
    #             "这是一份合同模板，请按以下信息填充并生成新文档：甲方=张三，乙方=李四，日期=2026-05-13",
    #             "我上传了一份带 {{ name }}、{{ date }} 占位符的模板，请帮我填充",
    #             "帮我做一份 6 页的 PPT，主题是『2026 Q2 安全合规季报』，目标读者是所领导",
    #             "做一份 4 页的产品周报 deck，包含一页趋势图、一页方案对比矩阵、一页结论页",
    #             "我有一份参考 pptx 模板，请按它的页面系统做一份汇报",
    #         ],
    #         agent_config=LLM_MODE_CONFIG,
    #         defult_config_name="deepseek-v4-pro",
    #         agent_factory=create_word_editor_agent,
    #         port=42819,
    #         no_register=False,
    #         enable_openwebui_pipeline=True,
    #         history_mode="backend",
    #         join_topics=["document-processing", "office-tools"],
    #         metadata={
    #             "category": "文档处理大师",
    #             "tags": ["docmaster", "word", "文档编辑", "办公自动化", "专业文档"],
    #             "capabilities": ["文档分析", "内容编辑", "格式优化", "结构重组", "专业排版"],
    #             "dependencies": {
    #                 "python": ["python-docx", "PyPDF2", "python-pptx", "pandas", "openpyxl"],
    #                 "system": ["pandoc", "libreoffice", "poppler-utils (pdftoppm)"],
    #                 "npm": ["docx"],
    #                 "install_system": "sudo apt install pandoc libreoffice poppler-utils && npm install -g docx",
    #             }
    #         },
    #     )
    # )


if __name__ == "__main__":
    main()
