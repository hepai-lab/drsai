"""
Template library management tools for template catalogs.
"""

from pathlib import Path
from .. import get_pending_events

# Set by tools/__init__.py via set_template_user_id() at agent creation time.
_current_user_id: str | None = None


def set_template_user_id(user_id: str | None) -> None:
    global _current_user_id
    _current_user_id = user_id


def _template_skill():
    try:
        from document_skills.template_library_skill import TemplateLibrarySkill
    except ImportError:
        from docmaster.document_skills.template_library_skill import TemplateLibrarySkill
    return TemplateLibrarySkill(user_id=_current_user_id)


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
    try:
        skill = _template_skill()
        return skill.list(user_id=_current_user_id, category=category, query=query)
    except Exception as exc:
        return {"success": False, "shared": [], "mine": [], "message": f"模板库调用失败: {exc}"}


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
    ref = (template_ref or "").strip()
    if not ref:
        return {"success": False, "ambiguous": False, "message": "template_ref 不能为空。"}
    try:
        skill = _template_skill()
        listing = skill.list(user_id=_current_user_id)
    except Exception as exc:
        return {"success": False, "ambiguous": False, "message": f"模板库调用失败: {exc}"}
    if not listing.get("success"):
        return {"success": False, "ambiguous": False, "message": listing.get("message") or "模板库服务调用失败"}
    mine = listing.get("mine") or []
    shared = listing.get("shared") or []
    ref_lower = ref.lower()

    def _by_id(entries, rid):
        for e in entries:
            if e.get("id") == rid:
                return e
        return None

    hit_entry = None
    hit_source = None
    e = _by_id(mine, ref)
    if e:
        hit_entry, hit_source = e, "mine"
    else:
        e = _by_id(shared, ref)
        if e:
            hit_entry, hit_source = e, "shared"

    if hit_entry is None:
        # Stage 3 — exact alias
        alias_hits = []
        for src_name, entries in (("mine", mine), ("shared", shared)):
            for e in entries:
                for a in (e.get("aliases") or []):
                    sa = str(a)
                    if sa == ref or sa.lower() == ref_lower:
                        alias_hits.append((e, src_name))
                        break
        if len(alias_hits) == 1:
            hit_entry, hit_source = alias_hits[0]
        elif len(alias_hits) > 1:
            return {
                "success": False, "ambiguous": True,
                "candidates": [
                    {"id": e["id"], "name": e.get("name", ""), "source": s, "description": e.get("description", "")}
                    for e, s in alias_hits
                ],
                "message": f"匹配到 {len(alias_hits)} 个模板，请让用户从候选中挑选一个。",
            }

    if hit_entry is None:
        # Stage 4 — substring match on name / id / aliases / tags
        sub_hits = []
        for src_name, entries in (("mine", mine), ("shared", shared)):
            for e in entries:
                haystack = " ".join(
                    [str(e.get("name", "")), str(e.get("id", ""))]
                    + [str(a) for a in (e.get("aliases") or [])]
                    + [str(t) for t in (e.get("tags") or [])]
                ).lower()
                if ref_lower in haystack:
                    sub_hits.append((e, src_name))
        if len(sub_hits) == 1:
            hit_entry, hit_source = sub_hits[0]
        elif len(sub_hits) > 1:
            return {
                "success": False, "ambiguous": True,
                "candidates": [
                    {"id": e["id"], "name": e.get("name", ""), "source": s, "description": e.get("description", "")}
                    for e, s in sub_hits
                ],
                "message": f"匹配到 {len(sub_hits)} 个模板，请让用户从候选中挑选一个。",
            }

    if hit_entry is None:
        return {
            "success": False, "ambiguous": False,
            "message": (
                f"模板库里没找到匹配 '{template_ref}' 的模板。"
                " 请用 list_templates_tool 看一下可用模板，或让用户上传新模板。"
            ),
        }

    try:
        import os
        result = skill.get_path(
            hit_entry["id"],
            user_id=_current_user_id if hit_source == "mine" else None,
        )
        if not result.get("success"):
            return {"success": False, "ambiguous": False, "message": result.get("message") or "模板未找到"}
        local_path = result.get("template_path")
        if not local_path or not os.path.isfile(local_path):
            return {"success": False, "ambiguous": False, "message": "模板文件丢失"}
    except Exception as exc:
        return {"success": False, "ambiguous": False, "message": f"下载模板失败: {exc}"}
    return {
        "success": True,
        "template_path": local_path,
        "source": hit_source,
        "metadata": hit_entry,
        "message": f"已定位模板 '{hit_entry.get('name', hit_entry['id'])}'。",
    }


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
    try:
        skill = _template_skill()
        result = skill.save(
            source_path=template_path,
            user_id=_current_user_id,
            name=name,
            description=description or "",
            category=category,
            tags=list(tags) if tags else None,
            aliases=list(aliases) if aliases else None,
            template_id=None,
        )
        return {
            "success": bool(result.get("success", False)),
            "template_id": result.get("template_id"),
            "metadata": result.get("metadata"),
            "message": result.get("message", ""),
        }
    except Exception as exc:
        return {"success": False, "message": f"保存模板失败: {exc}"}


def delete_template_tool(template_id: str):
    """
    从**当前用户自己的**模板库里删除一个模板（同时移除 catalog 条目和磁盘上的 .docx）。

    什么时候用：
    - 用户明说"删掉我的 XX 模板""不要这个模板了""把 XX 模板移除"。
    - 用户先用 list_templates_tool 浏览之后明确指向某个模板要求删除。

    ⚠️ 这是**破坏性**操作，文件会被真正删掉，不可撤销。调用前必须：
    1. **先用 `get_template_path_tool` 或 `list_templates_tool` 把用户口中的
       模板解析成一个明确的 id**（确认 source="mine"）。不要凭印象猜 id。
    2. **必须先得到用户的明确确认**——念出要删除的模板名（和 id），
       让用户回答"是/确定/删"之后再调本工具。如果用户只是问"我有哪些模板"
       或泛泛抱怨，**不要**主动调用。
    3. 如果 get_template_path_tool 返回 ambiguous=True，**不要**自己挑——
       把候选念给用户，让用户确认具体是哪一个。

    限制：
    - 只能删除**当前用户自己的**模板（source="mine"）。
    - **共享模板（source="shared"）不可删除**——本工具会返回失败。
      如果用户想删共享模板，告诉他/她需要联系管理员。

    Args:
        template_id: 模板的精确 id（如 "tech-dev-3-1" 或 "cai-gou-he-tong-2"）。
            通常由 get_template_path_tool 的返回值或 list_templates_tool
            列表里的 id 字段得来。

    Returns dict with:
        success: True / False
        removed_id: 成功时返回被删除的模板 id
        message: 中文提示

    删除成功后，可以提示用户"已删除，要看看剩下的模板吗？"，
    如果用户想看再调 list_templates_tool。
    """
    try:
        skill = _template_skill()
        result = skill.delete(template_id=template_id, user_id=_current_user_id)
        return {
            "success": bool(result.get("success", False)),
            "removed_id": result.get("removed_id"),
            "message": result.get("message", ""),
        }
    except Exception as exc:
        return {"success": False, "message": f"删除模板失败: {exc}"}
