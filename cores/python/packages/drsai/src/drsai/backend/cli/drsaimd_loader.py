"""
OpenDrSai Project Instructions Loader (DRSAI.md / CLAUDE.md)

从当前工作目录向上遍历目录树，发现并加载项目级指令文件。
设计灵感来自 Claude Code 的 CLAUDE.md 机制，但适配 OpenDrSai 的架构。

核心功能:
1. 从 cwd 向上遍历发现 DRSAI.md / CLAUDE.md / AGENTS.md 等项目级指令文件
2. 支持 @path/to/file 导入语法（递归展开，最大深度 5 层）
3. 剥离 HTML 注释以节省 token
4. 行数/大小限制预警
5. /init 命令：自动生成初始项目指令文件
6. /memory 命令：查看和重新加载项目指令

文件发现优先级（每个目录层级内）:
1. .drsai/DRSAI.md          — OpenDrSai 原生格式（推荐，优先读取）
2. .drsai/CLAUDE.md         — .drsai/ 内的 Claude 兼容格式（后备）
3. .claude/CLAUDE.md        — .claude/ 内的 Claude Code 兼容格式
4. .claude/DRSAI.md         — .claude/ 内的 OpenDrSai 格式
5. DRSAI.md                  — 项目根目录直放
6. CLAUDE.md                 — Claude Code 兼容直放

.drsai/ 优先级高于 .claude/：
- 如果 .drsai/ 存在任何项目指令文件，则只从 .drsai/ 加载，完全跳过 .claude/
- 仅当 .drsai/ 不存在或无项目指令文件时，才回退到 .claude/

本地个人偏好文件（不提交到版本控制）:
- DRSAI.local.md
- CLAUDE.local.md
- 同样遵循 .drsai/ > .claude/ 的优先级

层级优先级（跨目录）:
- 路径越靠近 cwd 的文件，在 system prompt 中越靠后 → LLM 越重视
- 与 Claude Code 的加载顺序一致：父目录先读，子目录后读

System Prompt 层级架构:
    ① prefix          — session级覆盖 (plan_mode 等)
    ② developer_msg   — 硬编码基础提示词
    ③ AGENTS.md       — 全局用户级 (workspace/configs/)
    ④ DRSAI.md        — 🆕 项目级 (cwd向上遍历发现) ← 本模块负责
    ⑤ Session_ID      — 固定行
    ⑥ suffix          — session级覆盖 (/inject suffix)
"""

from __future__ import annotations

import re
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from loguru import logger


# ── 文件名定义 ──────────────────────────────────────────────────────────────

# 项目级指令文件名（优先级从高到低：同一目录内只取第一个匹配的）
# 注意：.drsai/ 整体优先级高于 .claude/，见 discover_project_md_files()
PROJECT_MD_NAMES = [
    "DRSAI.md",       # OpenDrSai 原生格式（优先）
    "CLAUDE.md",      # Claude Code 兼容格式（后备）
]

# 本地个人偏好文件名（同一目录内只取第一个匹配的）
LOCAL_MD_NAMES = [
    "DRSAI.local.md",
    "CLAUDE.local.md",
]

# HTML 注释正则（在非代码块区域剥离）
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

# @import 语法正则
IMPORT_RE = re.compile(r"@([\w./\-~]+)")

# 安全限制
MAX_IMPORT_DEPTH = 5
MAX_LINES = 500
MAX_SIZE_KB = 50

# 组织级（Managed policy）路径
ORG_MD_PATHS = {
    "linux": Path("/etc/drsai/DRSAI.md"),
    "darwin": Path("/Library/Application Support/DrSai/DRSAI.md"),
    "windows": Path("C:\\Program Files\\DrSai\\DRSAI.md"),
}


# ── HTML 注释剥离 ──────────────────────────────────────────────────────────

def _strip_html_comments(text: str) -> str:
    """剥离 HTML 注释（<!-- ... -->），但保留代码块内的注释。

    代码块用 ``` 标记，只有在代码块内部的注释才保留。
    这样用户可以在 DRSAI.md 中用 HTML 注释给人类读者留备注，
    而不浪费 LLM 的 context token。
    """
    parts = []
    in_code_block = False
    for line in text.split("\n"):
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
            parts.append(line)
        elif in_code_block:
            # 代码块内：保留注释
            parts.append(line)
        else:
            # 非代码块：剥离注释
            parts.append(HTML_COMMENT_RE.sub("", line))
    return "\n".join(parts)


# ── @import 语法解析 ──────────────────────────────────────────────────────

def _resolve_imports(text: str, base_path: Path, depth: int = 0) -> str:
    """解析 @path/to/file 导入语法，递归展开导入的文件内容。

    支持:
    - 相对路径: @docs/api-rules.md → base_path/docs/api-rules.md
    - 绝对路径: @/etc/config.json
    - 用户目录: @~/.drsai/configs/USER.md

    递归深度限制: MAX_IMPORT_DEPTH (5 层)

    注意：先剥离 HTML 注释，再解析 @import，避免将 HTML 注释中的
    示例 @引用（如 <!-- @README -->）误解析为文件导入。
    """
    if depth >= MAX_IMPORT_DEPTH:
        logger.warning(f"Import depth exceeds {MAX_IMPORT_DEPTH}, stopping recursion")
        return text

    # 先剥离 HTML 注释，避免将注释中的 @引用误解析为导入
    if depth > 0:
        # depth==0 时由外层 load_project_instructions 剥离
        text = _strip_html_comments(text)

    def _replace_import(match: re.Match) -> str:
        import_path = match.group(1)

        # 解析路径
        if import_path.startswith("~"):
            target = Path(import_path).expanduser().resolve()
        elif import_path.startswith("/"):
            target = Path(import_path).resolve()
        else:
            target = (base_path / import_path).resolve()

        if not target.exists():
            logger.warning(f"Import file not found: {target}")
            return match.group(0)  # 保留原始 @ 引用

        if not target.is_file():
            logger.warning(f"Import path is not a file: {target}")
            return match.group(0)

        # 安全检查：不要导入二进制或超大文件
        if target.stat().st_size > 100_000:  # 100KB
            logger.warning(f"Import file too large: {target} ({target.stat().st_size / 1024:.1f}KB)")
            return match.group(0)

        try:
            content = target.read_text(encoding="utf-8")
            # 递归处理导入
            return _resolve_imports(content, target.parent, depth + 1)
        except UnicodeDecodeError:
            logger.warning(f"Import file is not UTF-8 text: {target}")
            return match.group(0)
        except Exception as e:
            logger.warning(f"Failed to read import file {target}: {e}")
            return match.group(0)

    return IMPORT_RE.sub(_replace_import, text)


# ── 文件发现 ───────────────────────────────────────────────────────────────

def discover_project_md_files(workdir: str) -> List[Tuple[Path, str]]:
    """从工作目录向上遍历，发现所有项目级指令文件。

    返回列表按「从根到工作目录」的顺序排列：
    - 父目录在前 → 在 system prompt 中先出现 → 优先级较低
    - 子目录在后 → 在 system prompt 中后出现 → 优先级较高（LLM 更重视）

    每个目录层级内，遵循 .drsai/ > .claude/ 的优先级：
    1. 优先检查 .drsai/ → DRSAI.md > CLAUDE.md（只取第一个匹配）
    2. 仅当 .drsai/ 无项目指令时 → 回退到 .claude/ → CLAUDE.md > DRSAI.md
    3. 根目录直放文件 → DRSAI.md > CLAUDE.md（只取第一个匹配）
    4. 本地偏好文件 → 跟随所在目录的优先级

    Returns:
        List of (filepath, scope_description) tuples
    """
    cwd = Path(workdir).resolve()
    discovered: List[Tuple[Path, str]] = []

    def _try_find_file(base_dir: Path, names: List[str], scope_fmt: str) -> Optional[Tuple[Path, str]]:
        """在 base_dir 中按 names 顺序查找第一个存在的文件。"""
        for name in names:
            f = base_dir / name
            if f.is_file():
                return (f, scope_fmt)
        return None

    # 向上遍历
    current = cwd
    while True:
        # ── 1. 检查隐藏子目录：.drsai/ 优先，.claude/ 作为后备 ──
        drsai_dir = current / ".drsai"
        drsai_has_project = False

        if drsai_dir.is_dir():
            # 项目指令文件：DRSAI.md > CLAUDE.md（只取第一个匹配）
            result = _try_find_file(
                drsai_dir, PROJECT_MD_NAMES,
                f"project ({current.name}/.drsai)",
            )
            if result:
                discovered.append(result)
                drsai_has_project = True

            # 本地偏好文件：DRSAI.local.md > CLAUDE.local.md（只取第一个匹配）
            result = _try_find_file(
                drsai_dir, LOCAL_MD_NAMES,
                f"local ({current.name}/.drsai)",
            )
            if result:
                discovered.append(result)

        # 仅当 .drsai/ 无项目指令时才回退到 .claude/
        if not drsai_has_project:
            claude_dir = current / ".claude"
            if claude_dir.is_dir():
                # 项目指令文件：DRSAI.md > CLAUDE.md（只取第一个匹配）
                result = _try_find_file(
                    claude_dir, PROJECT_MD_NAMES,
                    f"project ({current.name}/.claude)",
                )
                if result:
                    discovered.append(result)

                # 本地偏好文件
                result = _try_find_file(
                    claude_dir, LOCAL_MD_NAMES,
                    f"local ({current.name}/.claude)",
                )
                if result:
                    discovered.append(result)

        # ── 2. 根目录直放文件：DRSAI.md > CLAUDE.md（只取第一个匹配） ──
        result = _try_find_file(
            current, PROJECT_MD_NAMES,
            f"project ({current.name})",
        )
        if result:
            discovered.append(result)

        # ── 3. 根目录直放 local 文件：DRSAI.local.md > CLAUDE.local.md ──
        result = _try_find_file(
            current, LOCAL_MD_NAMES,
            f"local ({current.name})",
        )
        if result:
            discovered.append(result)

        # 向上一级
        parent = current.parent
        if parent == current:  # 已到文件系统根
            break
        current = parent

    # 反转顺序：父目录在前 → 子目录在后
    # Claude Code 的逻辑：越靠近 cwd 的内容越靠后（优先级越高）
    discovered.reverse()
    return discovered


def discover_org_md_file() -> Optional[Path]:
    """发现组织级（Managed policy）指令文件。

    检查平台对应的固定路径是否存在。
    """
    import platform
    system = platform.system().lower()

    path_map = {
        "linux": ORG_MD_PATHS["linux"],
        "darwin": ORG_MD_PATHS["darwin"],
    }
    # Windows 在 WSL 下也是 linux
    target = path_map.get(system)
    if target and target.exists() and target.is_file():
        return target
    return None


# ── 加载与合并 ──────────────────────────────────────────────────────────────

def load_project_instructions(workdir: str) -> Tuple[str, List[str], List[str]]:
    """加载并合并所有项目级指令文件的内容。

    模仿 Claude Code 的加载逻辑:
    1. 从工作目录向上遍历发现文件
    2. 按从根到工作目录的顺序合并内容
    3. 先剥离 HTML 注释（避免注释中的示例 @引用被误解析）
    4. 再处理 @import 语法
    5. 行数和大小限制预警

    Args:
        workdir: 当前工作目录

    Returns:
        Tuple of (combined_text, loaded_file_paths, warnings)
        - combined_text: 合并后的指令文本（空字符串表示无项目指令）
        - loaded_file_paths: 成功加载的文件路径列表（用于状态显示）
        - warnings: 用户可见的警告列表（超限提醒等）
    """
    sections: List[str] = []
    loaded_paths: List[str] = []
    warnings: List[str] = []

    # 1. 组织级指令（如果有）
    org_file = discover_org_md_file()
    if org_file:
        try:
            raw = org_file.read_text(encoding="utf-8")
            cleaned = _strip_html_comments(raw)
            expanded = _resolve_imports(cleaned, org_file.parent)
            if expanded.strip():
                sections.append(f"# ── Organization Instructions ──\n{expanded}")
                loaded_paths.append(str(org_file))
                logger.info(f"Loaded org instructions from {org_file}")
        except Exception as e:
            logger.warning(f"Failed to read org file {org_file}: {e}")

    # 2. 项目级指令（从 cwd 向上遍历）
    discovered = discover_project_md_files(workdir)
    for filepath, scope in discovered:
        try:
            raw = filepath.read_text(encoding="utf-8")
            cleaned = _strip_html_comments(raw)
            expanded = _resolve_imports(cleaned, filepath.parent)
            if expanded.strip():
                sections.append(f"# ── Instructions ({scope}) ──\n{expanded}")
                loaded_paths.append(str(filepath))
                logger.info(f"Loaded project instructions from {filepath} ({scope})")
        except Exception as e:
            logger.warning(f"Failed to read {filepath}: {e}")

    if not sections:
        return "", loaded_paths, warnings

    combined = "\n\n".join(sections)

    # 行数检查
    lines = combined.split("\n")
    line_count = len(lines)
    if line_count > MAX_LINES:
        msg = (
            f"⚠ 项目指令超过 {MAX_LINES} 行限制（当前 {line_count} 行）。"
            f"建议拆分为多个文件或使用 .drsai/rules/ 进行路径级规则。"
        )
        logger.warning(msg)
        warnings.append(msg)

    # 大小检查
    size_kb = len(combined.encode("utf-8")) / 1024
    if size_kb > MAX_SIZE_KB:
        msg = (
            f"⚠ 项目指令超过 {MAX_SIZE_KB}KB 限制（当前 {size_kb:.1f}KB）。"
            f"建议拆分为多个文件以节省 context token。"
        )
        logger.warning(msg)
        warnings.append(msg)

    return combined, loaded_paths, warnings


# ── /init 命令 ──────────────────────────────────────────────────────────────

def init_project_instructions(workdir: str) -> Tuple[str, bool]:
    """在当前项目目录生成一个初始的 DRSAI.md 文件。

    如果文件已存在，返回路径但不覆盖（用户应手动编辑）。

    Args:
        workdir: 当前工作目录

    Returns:
        Tuple of (filepath, is_new)
        - filepath: 生成的文件路径
        - is_new: True 表示新建，False 表示已存在
    """
    cwd = Path(workdir).resolve()

    # 优先放在 .drsai/ 目录下
    drsai_dir = cwd / ".drsai"
    target = drsai_dir / "DRSAI.md"

    # 如果已存在，返回但不覆盖
    if target.exists():
        return str(target), False

    # 也检查根目录直放的 DRSAI.md
    root_target = cwd / "DRSAI.md"
    if root_target.exists():
        return str(root_target), False

    # 创建 .drsai/ 目录和文件
    drsai_dir.mkdir(exist_ok=True)

    # 分析项目目录结构，生成更智能的初始内容
    project_name = cwd.name
    has_git = (cwd / ".git").exists()
    has_pyproject = (cwd / "pyproject.toml").exists() or (cwd / "setup.py").exists()
    has_makefile = (cwd / "Makefile").exists()
    has_docker = (cwd / "Dockerfile").exists() or (cwd / "docker-compose.yml").exists()
    has_package_json = (cwd / "package.json").exists()

    # 尝试检测项目类型
    project_type = "general"
    if has_pyproject:
        project_type = "python"
    elif has_package_json:
        project_type = "javascript/typescript"

    content = f"""# Project Instructions: {project_name}

<!-- This file contains project-level instructions for OpenDrSai. -->
<!-- It is loaded at the start of every session and injected into the system prompt. -->
<!-- HTML comments like this one are stripped before injection, saving context tokens. -->
<!-- Edit this file to add project-specific instructions that OpenDrSai should follow. -->

## Project Overview
- **Project name:** {project_name}
- **Working directory:** {cwd}
- **Project type:** {project_type}
- **Version control:** {'git' if has_git else 'none detected'}

## Build & Test Commands
<!-- Add the exact commands OpenDrSai should use for building, testing, and running your project. -->
<!-- Be specific: "Run `pytest tests/` before committing" instead of "Test your changes". -->
{'- Build: `pip install -e .`' if has_pyproject else '- Build: (add your build command)'}
{'- Test: `pytest`' if has_pyproject else '- Test: (add your test command)'}
{'- Lint: `ruff check .` or `flake8`' if has_pyproject else '- Lint: (add your lint command)'}
- Run: (add your run command)

## Coding Standards
<!-- Write concrete, verifiable rules. -->
- Use consistent naming conventions matching existing code patterns
- Follow the project's existing code style (indentation, quotes, etc.)
- Do not add features, refactoring, or "improvements" beyond what was asked
- Prefer tools over prose; act, don't just explain

## Architecture & Key Decisions
<!-- Describe important architectural decisions that new team members (or OpenDrSai) need to know. -->
<!-- Example: "API handlers live in src/api/handlers/" instead of "Keep files organized" -->
- Key directories:

## Common Workflows
<!-- Document workflows that are repeated frequently. -->
<!-- When OpenDrSai makes the same mistake twice, add a rule here. -->

## Import Example
<!-- You can import other files using @path syntax. These are expanded at load time. -->
<!-- See @README for project overview and @package.json for available commands. -->
"""

    target.write_text(content, encoding="utf-8")
    logger.info(f"Created initial DRSAI.md at {target}")

    # 如果有 .git，建议用户把 .drsai/ 加入版本控制
    if has_git:
        gitignore = cwd / ".gitignore"
        # DRSAI.md 应该提交到版本控制（团队共享）
        # DRSAI.local.md 应该加入 .gitignore（个人偏好）
        local_entries = ["DRSAI.local.md", ".drsai/DRSAI.local.md"]
        if gitignore.exists():
            existing = gitignore.read_text(encoding="utf-8")
            for entry in local_entries:
                if entry not in existing:
                    existing += f"\n{entry}"
            gitignore.write_text(existing, encoding="utf-8")

    return str(target), True


# ── /memory 命令辅助 ───────────────────────────────────────────────────────

def get_memory_status(workdir: str) -> Dict[str, Any]:
    """获取项目指令加载状态（用于 /memory show 命令）。

    Returns:
        Dict with keys: org_file, project_files, total_lines, total_size_kb
    """
    status: Dict[str, Any] = {
        "org_file": None,
        "project_files": [],
        "total_lines": 0,
        "total_size_kb": 0.0,
    }

    # 组织级
    org_file = discover_org_md_file()
    if org_file:
        try:
            text = org_file.read_text(encoding="utf-8")
            status["org_file"] = {
                "path": str(org_file),
                "lines": len(text.split("\n")),
            }
        except Exception:
            pass

    # 项目级
    discovered = discover_project_md_files(workdir)
    for filepath, scope in discovered:
        try:
            text = filepath.read_text(encoding="utf-8")
            lines = len(text.split("\n"))
            size_kb = len(text.encode("utf-8")) / 1024
            status["project_files"].append({
                "path": str(filepath),
                "scope": scope,
                "lines": lines,
                "size_kb": round(size_kb, 1),
            })
            status["total_lines"] += lines
            status["total_size_kb"] += size_kb
        except Exception:
            pass

    status["total_size_kb"] = round(status["total_size_kb"], 1)
    return status
