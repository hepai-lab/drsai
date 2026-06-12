"""Agent function-calling tools backed by GFS.

每个 ``make_gfs_tools(email)`` 调用返回一组 **闭包**：把 ``email`` 绑死，
agent 在 function calling 中无需感知用户身份，调用上看起来就是普通"无 user 参数"工具。

接入示例（``apps/webui/run_drsai_agent.py``）::

    from drsai.modules.managers.gfs import make_gfs_tools

    def create_agent(..., user_id: str | None = None, ...):
        gfs_tools = make_gfs_tools(user_id) if user_id else []
        return DrSaiAssistant(
            ...,
            tools=[*existing_tools, *gfs_tools],
            ...
        )

工具命名约定
------------

工具名以 ``gfs_`` 前缀，避免与 agent 内置的 ``run_read`` / ``run_write`` 工具冲突。
agent 可以同时拥有"本地文件工具"和"GFS 工具"，由 system prompt 引导选择。

路径语义
--------

所有 ``path`` 参数都是 **bucket 内相对路径**，**不要**以 ``/`` 开头，**不要**用 ``..``。
推荐目录约定：

- ``workspace/`` — agent 持续工作区（≈ 本地的 ``~/.drsai/workspace/runs/<user>/``）
- ``uploads/<run_id>/`` — webui 上传的附件
- ``outputs/<run_id>/`` — 本次任务产出（用户可以通过预签名 URL 分享给别人）
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Callable

from .provisioner import GfsProvisioner
from .user_client import GfsUserClient


logger = logging.getLogger(__name__)


# 读 / 写文本时的字符上限——避免 agent 一次把超大文件塞进上下文
MAX_TEXT_PREVIEW_CHARS = 64 * 1024  # 64K chars


def _format_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} TB"


def make_gfs_tools(email: str | None) -> list[Callable[..., Any]]:
    """生成一组绑定到 ``email`` 的 GFS 工具函数.

    Args:
        email: 用户邮箱（DrSai user_id）。``None`` / 空串时返回空列表（不挂工具）.

    Returns:
        可直接传给 ``DrSaiAssistant(tools=[...])`` 的函数列表.
        每个函数都有清晰的 ``Annotated`` 类型注解 + docstring，autogen 会自动转成 schema.
    """
    if not email:
        logger.info("make_gfs_tools called with empty email; returning no tools.")
        return []

    provisioner = GfsProvisioner.get()

    def _client() -> GfsUserClient:
        # 每次工具调用时再取 client（保证 cache miss / refresh 生效）
        return provisioner.get_user_client(email)

    # ------------------------------------------------------------------ #
    # 工具定义
    # ------------------------------------------------------------------ #
    def gfs_ls(
        prefix: Annotated[str, "GFS bucket 内的目录前缀，例如 'workspace/' 或 'uploads/run-42/'。空字符串 '' 表示 bucket 根目录。"] = "",
        recursive: Annotated[bool, "True 时递归列出所有子目录的文件；False（默认）只列当前层级。"] = False,
        max_items: Annotated[int, "最多返回多少条，默认 200。"] = 200,
    ) -> str:
        """列出当前用户 GFS bucket 内指定前缀下的文件 / 目录。

        返回一个易读的多行字符串。
        """
        cli = _client()
        items = cli.list_dir(prefix=prefix, recursive=recursive, max_items=max_items)
        if not items:
            return f"(empty: gfs://{cli.bucket}/{prefix or ''})"
        lines = [f"# bucket: {cli.bucket}  prefix: {prefix or '/'}", ""]
        for it in items:
            if it.is_dir:
                lines.append(f"  DIR   {it.path}")
            else:
                lines.append(f"  {_format_size(it.size):>10}  {it.path}")
        return "\n".join(lines)

    def gfs_stat(
        path: Annotated[str, "GFS bucket 内的文件路径"],
    ) -> str:
        """查看 GFS 文件元信息（大小、etag、修改时间）。文件不存在时返回 not found 提示。"""
        cli = _client()
        if not cli.exists(path):
            return f"not found: gfs://{cli.bucket}/{path}"
        info = cli.head(path)
        return json.dumps({
            "path": info.path,
            "size": info.size,
            "size_human": _format_size(info.size),
            "etag": info.etag,
            "modified_ms": info.modified_ms,
        }, ensure_ascii=False, indent=2)

    def gfs_read(
        path: Annotated[str, "GFS bucket 内的文本文件路径，例如 'uploads/run-42/data.txt'"],
    ) -> str:
        """读取 GFS bucket 内的文本文件并返回全文。

        - 二进制文件请改用 gfs_download
        - 超过 32 MB 的对象会被拒绝；超过 64K 字符会被截断
        """
        cli = _client()
        try:
            text = cli.read_text(path)
        except ValueError as e:
            return f"ERROR: {e}"
        if len(text) > MAX_TEXT_PREVIEW_CHARS:
            head = text[:MAX_TEXT_PREVIEW_CHARS]
            return (
                f"{head}\n\n[... truncated, full length = {len(text)} chars; "
                f"use gfs_download to fetch the whole file]"
            )
        return text

    def gfs_write(
        path: Annotated[str, "GFS bucket 内的目标路径，例如 'outputs/run-42/report.md'"],
        content: Annotated[str, "要写入的文本内容（UTF-8 编码）"],
    ) -> str:
        """写入文本到 GFS bucket。会覆盖同名文件。返回 etag 与路径。

        典型用法：
        - 把 agent 的产出（报告、代码、笔记）保存到 outputs/ 下，方便用户拿走
        - 把任务中间状态保存到 workspace/ 下，供后续会话使用
        """
        cli = _client()
        etag = cli.write_text(path, content)
        return f"written gfs://{cli.bucket}/{path} ({len(content)} chars, etag={etag})"

    def gfs_upload(
        local_path: Annotated[str, "本地文件系统中的源文件绝对路径"],
        remote_path: Annotated[str, "GFS bucket 内的目标路径"],
    ) -> str:
        """把本地工作目录的文件上传到 GFS bucket。大文件自动分片。"""
        cli = _client()
        cli.upload_file(local_path, remote_path)
        return f"uploaded {local_path} -> gfs://{cli.bucket}/{remote_path}"

    def gfs_download(
        remote_path: Annotated[str, "GFS bucket 内的源路径"],
        local_path: Annotated[str, "本地文件系统中的目标路径"],
    ) -> str:
        """从 GFS bucket 下载文件到本地工作目录。"""
        cli = _client()
        cli.download_file(remote_path, local_path)
        return f"downloaded gfs://{cli.bucket}/{remote_path} -> {local_path}"

    def gfs_delete(
        path: Annotated[str, "GFS bucket 内要删除的文件路径"],
    ) -> str:
        """从 GFS bucket 删除文件。**不可恢复**，请慎用。"""
        cli = _client()
        cli.delete(path)
        return f"deleted gfs://{cli.bucket}/{path}"

    def gfs_share_url(
        path: Annotated[str, "GFS bucket 内的文件路径"],
        ttl_minutes: Annotated[int, "URL 有效期（分钟），默认 60，最大 1440（24 小时）"] = 60,
    ) -> str:
        """为 GFS 文件生成一个临时预签名下载 URL。

        典型场景：agent 完成任务后，把产出文件的链接贴到回答里，用户点击就能下载。
        生成的 URL 在 ``ttl_minutes`` 后失效。
        """
        ttl_minutes = max(1, min(int(ttl_minutes), 1440))
        cli = _client()
        if not cli.exists(path):
            return f"ERROR: not found: gfs://{cli.bucket}/{path}"
        url = cli.presign_get(path, ttl_sec=ttl_minutes * 60)
        return url

    tools = [
        gfs_ls, gfs_stat, gfs_read, gfs_write,
        gfs_upload, gfs_download, gfs_delete, gfs_share_url,
    ]
    logger.info("Mounted %d GFS tools for user %s", len(tools), email)
    return tools
