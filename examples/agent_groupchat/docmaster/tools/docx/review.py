"""
Contract review and analysis tools.
"""

from pathlib import Path
from .. import get_pending_events


def _build_files_event_data(file_path: str, description: str) -> dict | None:
    """
    Build a serialized FilesEvent payload for a generated/edited file.

    Tries to upload via HepAI filesystem (URL method) first.
    Falls back to base64 encoding if the upload fails.

    Returns a dict (serialized ``FilesContent``) to be appended to the
    pending files-events side-channel, or *None* if both methods fail.
    """
    import mimetypes
    import base64
    from drsai.modules.managers.messages import FileInfo, FilesContent
    from drsai.utils.utils import upload_to_hepai_filesystem

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
            path=file_path,
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
                path=file_path,
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


# Tool functions - Note: The full review_contract_tool implementation requires
# integration with document_skills/contract_review_skill.py and LLM capabilities.
# A simplified version is shown here. For production, import ContractReviewSkill
# and set_model_client from the run_docmaster module.

def review_contract_tool(file_path: str, annotate: bool = True):
    """
    合同审查工具：对一份 .docx 合同做四方面体检并（可选）输出带批注的副本。

    审查维度：
      1. 格式：字体/字号一致性、中英文混排、半角/全角标点、条款编号风格统一。
      2. 填写缺失：未替换的 ____、{{...}}、**XX**、空白字段（甲方:）、空白日期。
      3. 内容一致性：大写/小写金额对账、条款编号连续性、对『第X条』/『附件X』
         的悬空引用、甲乙方主体名称在全文中是否一致。
      4. 法律风险：用模型做红线扫描（缺失条款、不公平条款、模糊措辞、合规问题）。
         fail-soft —— 若 LLM 30s 内未返回，仅返回前三类启发式结果，并在
         summary 中注明。

    产物：
      - 一份结构化的中文报告（issues 列表 + stats + summary）；
      - 当 annotate=True 时，把 issues 转为 Word 批注，写到一份新文件
        `<原名>_审查.docx`（不覆盖原文件），并发出 FilesEvent 让用户下载。

    适用场景：
      - "帮我审查这份合同 / 帮我看看这份合同"
      - "检查格式问题"
      - "合同里有没有空着的字段 / 大小写金额对不对"

    Args:
        file_path: 合同 .docx 路径（必须在工作区内）。
        annotate:  是否同时输出带 Word 批注的副本，默认 True。
    """
    src = Path(file_path)
    if not src.is_file():
        return {"success": False, "message": f"文件不存在: {file_path}"}
    if src.suffix.lower() != ".docx":
        return {"success": False, "message": f"仅支持 .docx 文件（当前 {src.suffix}）。"}

    try:
        from document_skills.contract_review_skill import ContractReviewSkill
        from run_docmaster import WORKSPACE
    except ImportError:
        return {"success": False, "message": "Contract review skill not available"}

    # Lazy LLM call setup - returns heuristic results if LLM unavailable
    def _llm_call(prompt: str) -> str:
        try:
            import asyncio
            from autogen_core.models import UserMessage
            from run_docmaster import set_model_client, default_config_name

            client = set_model_client(default_config_name)
            LLM_TIMEOUT = 90.0

            async def _run():
                result = await client.create([UserMessage(content=prompt, source="docmaster")])
                content = getattr(result, "content", "") or ""
                if isinstance(content, list):
                    parts = []
                    for c in content:
                        if isinstance(c, str):
                            parts.append(c)
                        elif isinstance(c, dict) and "text" in c:
                            parts.append(c["text"])
                    content = "".join(parts)
                return str(content or "")

            def _invoke_sync():
                try:
                    return asyncio.run(asyncio.wait_for(_run(), timeout=LLM_TIMEOUT))
                except RuntimeError:
                    import concurrent.futures
                    def _bg():
                        loop = asyncio.new_event_loop()
                        try:
                            return loop.run_until_complete(
                                asyncio.wait_for(_run(), timeout=LLM_TIMEOUT)
                            )
                        finally:
                            loop.close()
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                        return ex.submit(_bg).result(timeout=LLM_TIMEOUT + 5.0)

            try:
                return _invoke_sync()
            except asyncio.TimeoutError:
                raise RuntimeError(f"timeout after {LLM_TIMEOUT}s")
        except Exception as exc:
            msg = str(exc) or type(exc).__name__
            raise RuntimeError(f"{type(exc).__name__}: {msg}") from exc

    skill = ContractReviewSkill(str(WORKSPACE))
    result = skill.review(str(src), llm_call=_llm_call)
    if not result.get("success"):
        return result

    issues = result.get("issues") or []
    annotated_path = None
    annotate_note = ""

    if annotate and issues:
        # Generate annotated copy with issues as comments
        from .comment import add_comment_tool
        import shutil

        target = src.parent / f"{src.stem}_审查{src.suffix}"
        try:
            shutil.copyfile(src, target)
        except Exception as exc:
            annotate_note = f"复制副本失败，未生成带批注文档: {exc}"
            target = None

        if target is not None:
            comments_payload = []
            cid = 0
            for it in issues:
                ct = (it.get("comment_target") or "").strip()
                if not ct or not ct.strip():
                    continue
                sev_tag = {"high": "高", "medium": "中", "low": "低"}.get(
                    it.get("severity", "medium"), "中"
                )
                body = f"[{sev_tag}/{it.get('category', '')}] {it.get('message', '')}"
                suggestion = (it.get("suggestion") or "").strip()
                if suggestion:
                    body += f"\n建议：{suggestion}"
                comments_payload.append({
                    "target_text": ct,
                    "comment_text": body,
                    "comment_id": cid,
                    "author": "DocMaster",
                    "initials": "DM",
                })
                cid += 1

            if comments_payload:
                ac_result = add_comment_tool(
                    file_path=str(target),
                    comments=comments_payload,
                )
                added = ac_result.get("comments_added", 0) or 0
                if target.exists():
                    annotated_path = str(target)
                    if not ac_result.get("success"):
                        fe_data = _build_files_event_data(
                            str(target),
                            f"Contract review (annotated): {target.name}",
                        )
                        if fe_data:
                            get_pending_events().append(fe_data)
                    total = len(comments_payload)
                    if added < total:
                        annotate_note = (
                            f"已写入 {added}/{total} 条批注，剩余 "
                            f"{total - added} 条因原文未匹配到对应文本而跳过。"
                        )
                else:
                    annotate_note = f"批注写入失败：{ac_result.get('message', '未知错误')}"
            else:
                fe_data = _build_files_event_data(
                    str(target), f"Contract review copy: {target.name}"
                )
                if fe_data:
                    get_pending_events().append(fe_data)
                annotated_path = str(target)

    out = {
        "success": True,
        "summary": result.get("summary", ""),
        "stats": result.get("stats", {}),
        "issues": issues,
        "annotated_path": annotated_path,
        "source_path": str(src),
    }
    if annotate_note:
        out["annotate_note"] = annotate_note
    return out
