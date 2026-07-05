"""GFS 数据面客户端（S3 协议）.

每个 ``GfsUserClient`` 实例绑定 **一个用户 + 一个 bucket**，使用该用户自己的 AK/SK 调
``https://fgws3-gfs.ihep.ac.cn`` 上传/下载/列出/删除文件。

关键约束（实测）：
- 必须 ``signature_version=s3v4`` + ``addressing_style=path``，否则签名会失败。
- ``path`` 一律是 **bucket 内相对路径**，不能以 ``/`` 开头，不能包含 ``..``。
- 对象大小没有硬上限，``upload_file`` 自动走 multipart。
"""

from __future__ import annotations

import io
import logging
import os
import posixpath
from dataclasses import dataclass
from typing import Iterable

from .admin_client import GfsCredential


logger = logging.getLogger(__name__)


# 默认对外暴露的对象前缀
WORKSPACE_PREFIX = "workspace"
UPLOADS_PREFIX = "uploads"
OUTPUTS_PREFIX = "outputs"


@dataclass(frozen=True)
class GfsObjectInfo:
    """单个对象的元信息."""

    path: str           # bucket 内相对路径 e.g. "workspace/notes.md"
    size: int           # 字节
    etag: str           # 不含双引号
    modified_ms: int    # 修改时间, Unix epoch 毫秒
    is_dir: bool = False  # 是否是"目录"前缀（``list_dir`` 非递归时出现）


def _normalize_key(path: str) -> str:
    """把上层传进来的 path 规范化成可安全的 S3 key.

    规则：
    - 去掉前导 ``/`` 和重复斜杠
    - 拒绝包含 ``..`` 的段（**在 normpath 之前判断**，否则 ``a/../b`` 会被悄悄变成 ``b``）
    - 拒绝绝对路径
    """
    if not path:
        raise ValueError("path must not be empty")
    # **首先**在原始字符串里拦截 .. 段，防止 posixpath.normpath 把 traversal 抹平
    raw_parts = path.split("/")
    if any(part == ".." for part in raw_parts):
        raise ValueError(f"path traversal not allowed: {path!r}")
    p = posixpath.normpath(path).lstrip("/")
    if p in (".", ".."):
        raise ValueError(f"invalid path: {path!r}")
    return p


def _normalize_prefix(prefix: str) -> str:
    if not prefix:
        return ""
    # 同样：先在原始字符串里拦截 ..
    if any(part == ".." for part in prefix.split("/")):
        raise ValueError(f"path traversal not allowed: {prefix!r}")
    p = posixpath.normpath(prefix).lstrip("/")
    if p == "." or not p:
        return ""
    # 保留末尾斜杠（list 时表示"目录前缀"语义）
    if prefix.endswith("/") and not p.endswith("/"):
        p = p + "/"
    return p


class GfsUserClient:
    """GFS S3 数据面客户端（绑定单个用户）.

    Args:
        credential: 由 ``GfsAdminClient.get_user_credential(email)`` 拿到的凭证.
        max_inline_read: ``read_bytes`` / ``read_text`` 单次允许加载到内存的最大字节数,
            超过则报 ``ValueError`` 提示改用 ``presign_get`` 或分块下载.
    """

    DEFAULT_MAX_INLINE_READ = 32 * 1024 * 1024  # 32 MB

    def __init__(
        self,
        credential: GfsCredential,
        *,
        max_inline_read: int | None = None,
    ) -> None:
        try:
            import boto3
            from botocore.config import Config
        except ImportError as e:
            raise ImportError(
                "GfsUserClient requires boto3; install with `pip install boto3`."
            ) from e

        self.credential = credential
        self.bucket = credential.bucket
        self.email = credential.email
        self.max_inline_read = max_inline_read or self.DEFAULT_MAX_INLINE_READ

        self._s3 = boto3.client(
            "s3",
            aws_access_key_id=credential.access_key,
            aws_secret_access_key=credential.secret_key,
            endpoint_url=credential.s3_endpoint,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    # ------------------------------------------------------------------ #
    # 探测 / 列表
    # ------------------------------------------------------------------ #
    def healthcheck(self) -> bool:
        """轻量验证 client 可用（list 0 个对象）."""
        try:
            self._s3.list_objects_v2(Bucket=self.bucket, MaxKeys=1)
            return True
        except Exception as e:
            logger.warning("GFS healthcheck failed for %s: %s", self.email, e)
            return False

    def exists(self, path: str) -> bool:
        from botocore.exceptions import ClientError
        key = _normalize_key(path)
        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code")
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def list_dir(
        self,
        prefix: str = "",
        *,
        recursive: bool = False,
        max_items: int | None = None,
    ) -> list[GfsObjectInfo]:
        """列出 bucket 内某前缀下的对象.

        Args:
            prefix: bucket 内的前缀；``""`` = bucket 根.
            recursive: ``False`` 时模拟目录层级（用 Delimiter='/'）.
            max_items: 最多返回多少项（不传 = 无限制）.
        """
        norm = _normalize_prefix(prefix)
        if prefix and not norm.endswith("/"):
            norm = norm + "/"
        kw = {"Bucket": self.bucket, "Prefix": norm}
        if not recursive:
            kw["Delimiter"] = "/"

        out: list[GfsObjectInfo] = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(**kw):
            # 子"目录"前缀
            for cp in page.get("CommonPrefixes", []) or []:
                out.append(GfsObjectInfo(
                    path=cp["Prefix"], size=0, etag="", modified_ms=0, is_dir=True
                ))
                if max_items and len(out) >= max_items:
                    return out
            for obj in page.get("Contents", []) or []:
                key = obj["Key"]
                # S3 会把"目录占位对象"（key 以 / 结尾）也返回，跳过
                if key.endswith("/") and obj["Size"] == 0:
                    continue
                out.append(GfsObjectInfo(
                    path=key,
                    size=obj["Size"],
                    etag=obj["ETag"].strip('"'),
                    modified_ms=int(obj["LastModified"].timestamp() * 1000),
                ))
                if max_items and len(out) >= max_items:
                    return out
        return out

    def head(self, path: str) -> GfsObjectInfo:
        key = _normalize_key(path)
        h = self._s3.head_object(Bucket=self.bucket, Key=key)
        return GfsObjectInfo(
            path=key,
            size=int(h["ContentLength"]),
            etag=h["ETag"].strip('"'),
            modified_ms=int(h["LastModified"].timestamp() * 1000),
        )

    # ------------------------------------------------------------------ #
    # 读
    # ------------------------------------------------------------------ #
    def read_bytes(self, path: str) -> bytes:
        key = _normalize_key(path)
        # 先 head 看大小
        h = self._s3.head_object(Bucket=self.bucket, Key=key)
        size = int(h["ContentLength"])
        if size > self.max_inline_read:
            raise ValueError(
                f"object {path!r} is {size} bytes, exceeds max_inline_read "
                f"{self.max_inline_read}. Use download_file or presign_get instead."
            )
        resp = self._s3.get_object(Bucket=self.bucket, Key=key)
        return resp["Body"].read()

    def read_text(self, path: str, encoding: str = "utf-8") -> str:
        return self.read_bytes(path).decode(encoding)

    def download_file(self, remote_path: str, local_path: str) -> None:
        key = _normalize_key(remote_path)
        os.makedirs(os.path.dirname(os.path.abspath(local_path)) or ".", exist_ok=True)
        self._s3.download_file(self.bucket, key, local_path)

    # ------------------------------------------------------------------ #
    # 写
    # ------------------------------------------------------------------ #
    def write_bytes(
        self,
        path: str,
        data: bytes,
        *,
        content_type: str | None = None,
    ) -> str:
        """写一个对象，返回 etag（不含双引号）."""
        key = _normalize_key(path)
        kw = {"Bucket": self.bucket, "Key": key, "Body": data}
        if content_type:
            kw["ContentType"] = content_type
        r = self._s3.put_object(**kw)
        return r["ETag"].strip('"')

    def write_text(
        self,
        path: str,
        text: str,
        *,
        encoding: str = "utf-8",
    ) -> str:
        return self.write_bytes(
            path,
            text.encode(encoding),
            content_type=f"text/plain; charset={encoding}",
        )

    def upload_file(self, local_path: str, remote_path: str) -> None:
        """上传本地文件到 GFS，自动 multipart（适用于大文件）."""
        key = _normalize_key(remote_path)
        self._s3.upload_file(local_path, self.bucket, key)

    def upload_stream(
        self,
        stream: io.IOBase,
        remote_path: str,
        *,
        content_type: str | None = None,
    ) -> None:
        """从流式输入上传。``stream`` 必须 readable."""
        key = _normalize_key(remote_path)
        extra = {"ContentType": content_type} if content_type else None
        self._s3.upload_fileobj(stream, self.bucket, key, ExtraArgs=extra)

    # ------------------------------------------------------------------ #
    # 删
    # ------------------------------------------------------------------ #
    def delete(self, path: str) -> None:
        key = _normalize_key(path)
        self._s3.delete_object(Bucket=self.bucket, Key=key)

    def delete_many(self, paths: Iterable[str]) -> list[str]:
        """批量删除，返回成功的 key 列表."""
        keys = [_normalize_key(p) for p in paths]
        if not keys:
            return []
        r = self._s3.delete_objects(
            Bucket=self.bucket,
            Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
        )
        # 失败的在 r["Errors"]
        errs = r.get("Errors") or []
        failed = {e["Key"] for e in errs}
        return [k for k in keys if k not in failed]

    # ------------------------------------------------------------------ #
    # 预签名 URL
    # ------------------------------------------------------------------ #
    def presign_get(self, path: str, ttl_sec: int = 3600) -> str:
        key = _normalize_key(path)
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=int(ttl_sec),
        )

    def presign_put(self, path: str, ttl_sec: int = 3600) -> str:
        key = _normalize_key(path)
        return self._s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=int(ttl_sec),
        )

    # ------------------------------------------------------------------ #
    # repr 安全
    # ------------------------------------------------------------------ #
    def __repr__(self) -> str:
        return (
            f"<GfsUserClient email={self.email!r} bucket={self.bucket!r} "
            f"ak={self.credential.access_key[:8]}...>"
        )
