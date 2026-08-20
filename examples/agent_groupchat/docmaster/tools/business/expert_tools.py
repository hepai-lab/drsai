"""
Business Expert Tools - Expert recommendation and opinion form generation.

Provides tools for:
- recommend_experts_tool: Recommend experts based on business field query
- generate_expert_opinion_forms_tool: Generate prefilled expert opinion forms
"""

from pathlib import Path
from drsai.modules.managers.messages import FileInfo
from drsai.utils.utils import upload_to_hepai_filesystem


def get_pending_events() -> list:
    """
    Get the global list of pending file events.

    This list is appended to by tool functions and drained by the agent
    in on_messages_stream. It serves as a side-channel for file uploads
    and events that need to be communicated back to the frontend.

    Returns:
        list: The pending files events list
    """
    global _pending_files_events
    if "_pending_files_events" not in globals():
        _pending_files_events = []
    return _pending_files_events


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
            import base64
            with open(file_path, "rb") as f:
                file_bytes = f.read()
            encoded = base64.b64encode(file_bytes).decode("utf-8")
            file_info = FileInfo(
                name=file_name,
                data=encoded,
                description=description,
                download_method="base64",
                size=file_size,
                mime_type=mime_type,
                path=file_path,
            )
            print(f"📦 File encoded to base64 for FilesEvent: {file_name} ({file_size} bytes)")
        except Exception as encode_err:
            print(f"❌ Base64 encoding failed: {encode_err}")
            return None

    return {
        "source": "files",
        "content": [file_info.__dict__],
    }


def recommend_experts_tool(
    field_query: str,
    applicant_department: str = "",
    top_n: int = 5,
    include_admin: bool = True,
):
    """
    根据业务专业领域，从 04 专家清单/ 中推荐合适的关联业务评审专家。

    什么时候用：
    - 用户在「综合材料撰写」环节请求推荐评审专家。
    - 已经知道课题的专业方向（如"超导腔检修"、"软件 AI 数据分析"），
      想从所内专家库筛 3-5 位候选人。
    - 推荐结果会作为 generate_expert_opinion_forms_tool 的输入。

    Args:
        field_query: 业务专业领域描述。可以是单个关键词，也可以是空格 /
            顿号 / 逗号分隔的多个词，例如 "超导腔检修"、"软件 AI 数据分析"、
            "机械加工，真空设备"。会自动展开同义词（如 超导腔→低温/超导/
            高频/真空、AI→机器学习/数据分析/算法）。
        applicant_department: 申报人所在推荐单位，例如"加速器中心"。
            同单位的专家会有 +0.5 加分（仅作为微调，不主导排序）。可空。
        top_n: 返回的技术专家数量上限，默认 5。
        include_admin: 是否同时返回科研处 / 财务资产处的行政审核人员
            （不参与领域打分，单独列在 administrative_reviewers 字段）。
            默认 True。

    Returns dict with:
        query_terms: 用户原始查询词
        expanded_terms: 同义词展开后的查询集
        recommended_experts: 排序后的技术专家列表，每项含 name / title /
            field / department / office_phone / mobile / email / score /
            matched_terms / rationale
        administrative_reviewers: 行政审核人员列表，结构同上但不参与打分
        total_pool_size: 专家库总人数（透明度用）
    """
    from document_skills.guanlianyewu_skill import recommend_experts
    try:
        return recommend_experts(
            field_query,
            applicant_department=applicant_department,
            top_n=top_n,
            include_admin=include_admin,
        )
    except Exception as exc:  # noqa: BLE001
        import traceback
        return {
            "success": False,
            "error": str(exc),
            "traceback_tail": traceback.format_exc()[-1500:],
            "message": f"recommend_experts_tool 调用失败: {exc}",
        }


def generate_expert_opinion_forms_tool(
    project_info: dict,
    experts: list,
    output_dir: str = "",
    user_id: str | None = None,
    workdir: Path | None = None,
):
    """
    为每位专家生成一份预填写的「附件3 评审论证专家个人意见表」。

    什么时候用：
    - 用户已经选定了评审专家（通常来自 recommend_experts_tool 的结果）。
    - 在「综合材料撰写」环节，需要把课题基本信息填到专家意见表里，
      让用户下载、分发给专家本人填写评审意见。
    - 不要用 fill_docx_template_tool 处理这份模板——这个工具针对 附件3
      的固定结构做了精确填写，并保留了评审栏不动让专家手填。

    填写规则：
    - 模板顶部「拟委托关联业务基本情况」一栏会被填上：课题名称（含编号）、
      负责人、关联单位（含关联类型）、业务内容、合同金额。
    - 中间「评审内容和意见」5 行**完全保留模板原文不动**，由专家本人填写。
    - 底部「专家签字及签署日期」会预填专家姓名 + 留空的签字 / 日期占位。
    - 文件名格式：评审论证专家个人意见表-{专家姓名}-{课题编号}.docx

    Args:
        project_info: 项目基本信息字典，所有字段可选（缺失会显示"未填写"）：
            {
                "课题名称": str,
                "课题编号": str,
                "课题负责人": str,
                "经办人": str,           # 与课题负责人不同时才显示
                "关联单位": str,
                "关联类型": str,         # 如 "高能所投资企业，申报人无股权"
                "业务内容": str,
                "合同金额": str,         # 已格式化好的字符串，如 "19,862元"
            }
        experts: 专家列表。可以是 ["姓名1", "姓名2"] 字符串列表，也可以
            是 [{"name": "姓名1", ...}, ...] 的字典列表（直接把
            recommend_experts_tool 返回的 recommended_experts 传进来即可）。
        output_dir: 输出目录的绝对路径。留空 / 空字符串时默认写到
            WORKDIR/<user_id>/guanlianyewu/expert_forms/。
        user_id: 用户ID，用于确定默认输出目录。
        workdir: 工作目录根路径 (默认 WORKSPACE/runs)。

    Returns dict with:
        success: 是否至少生成了一份
        output_dir: 实际写入的目录绝对路径
        count: 成功生成的份数
        generated_files: [{"expert_name": str, "file_path": str}, ...]
        gfs_uploaded: [{"expert_name": str, "gfs_path": str}, ...]
            (仅当成功上传到 GFS 时才有此字段，路径格式 gfs://bucket/uploads/关联业务/xxx.docx)
        skipped: 被跳过的专家及原因（姓名为空、模板找不到等）
    """
    from document_skills.guanlianyewu_skill import (
        ProjectInfo,
        generate_expert_opinion_forms,
    )
    try:
        # Build ProjectInfo from the dict, ignoring unknown keys.
        allowed = {
            "课题名称", "课题编号", "课题负责人", "经办人",
            "关联单位", "关联类型", "业务内容", "合同金额",
        }
        clean = {k: str(v) for k, v in (project_info or {}).items() if k in allowed and v is not None}
        info = ProjectInfo(**clean)

        # Default output directory under WORKDIR/<user>/guanlianyewu/...
        if not output_dir:
            if workdir is None:
                workdir = Path(__file__).parent.parent.parent.parent / "workspace" / "runs"
            safe_user = (user_id or "anonymous").replace("/", "_")
            out = workdir / safe_user / "guanlianyewu" / "expert_forms"
        else:
            out = Path(output_dir)

        result = generate_expert_opinion_forms(
            project_info=info,
            experts=experts or [],
            output_dir=out,
        )

        # Surface each generated file via FilesEvent so the right panel
        # picks them up the same way edit_docx_tool does.
        for entry in result.get("generated_files", []):
            fe_data = _build_files_event_data(
                entry["file_path"],
                f"专家意见表: {Path(entry['file_path']).name}",
            )
            if fe_data:
                get_pending_events().append(fe_data)

        # Upload each generated file to GFS under uploads/关联业务/
        gfs_uploaded = []
        if user_id:
            try:
                from drsai.modules.managers.gfs import GfsProvisioner
                provisioner = GfsProvisioner.get()
                gfs_client = provisioner.get_user_client(user_id)
                for entry in result.get("generated_files", []):
                    local_path = entry["file_path"]
                    filename = Path(local_path).name
                    remote_path = f"uploads/关联业务/{filename}"
                    try:
                        gfs_client.upload_file(local_path, remote_path)
                        gfs_url = f"gfs://{gfs_client.bucket}/{remote_path}"
                        gfs_uploaded.append({
                            "expert_name": entry["expert_name"],
                            "gfs_path": gfs_url,
                        })
                        print(f"   📤 Uploaded to GFS: {gfs_url}")
                    except Exception as upload_exc:  # noqa: BLE001
                        print(f"   ⚠️  GFS upload failed for {filename}: {upload_exc}")
            except Exception as gfs_exc:  # noqa: BLE001
                print(f"   ⚠️  GFS provisioner unavailable: {gfs_exc}")

        # Add gfs_uploaded to result so the LLM can report the GFS paths
        if gfs_uploaded:
            result["gfs_uploaded"] = gfs_uploaded

        return result
    except Exception as exc:  # noqa: BLE001
        import traceback
        return {
            "success": False,
            "error": str(exc),
            "traceback_tail": traceback.format_exc()[-1500:],
            "message": f"generate_expert_opinion_forms_tool 调用失败: {exc}",
        }


# Global list for pending file events
_pending_files_events: list = []
