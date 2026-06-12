"""GFS OpenAPI 管理面客户端.

只封装 DrSai 实际会用到的端点。所有调用通过 ``X-API-Key`` 鉴权。

实测发现（截至 2026-06-11，详见 ``test/task/task-20260610/gfs-api-finding.md``）：

* ``user_id`` 在请求路径中可以直接传邮箱（如 ``alice@ihep.ac.cn``），无需做 sanitize。
* ``GET /v1/users/{user_id}/credentials`` 会返回 **明文** ``access_key`` / ``secret_key``，
  这是 DrSai 拿用户凭证的主路径。
* ``POST /v1/users/{user_id}/credentials`` 实测只返回 ``{"code":200,"message":"ok"}``，
  body 中没有 AK/SK；POST 之后必须再 ``GET`` 一次确认列表变化。
* 凭证里的 ``resources`` 字段可能缺失/为空，业务侧无法据此推断 ``ro/rw``，
  只能通过实际 PUT 试探。
* ``expiration`` 字段可能是 ``-1`` 或 ``9999999999``，两者都视为"永不过期"。

线程安全：``GfsAdminClient`` 复用 ``httpx.Client``，``httpx.Client`` 本身线程安全。
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any

import httpx


DEFAULT_OPENAPI_BASE = "http://gfs.ihep.ac.cn:7800"
DEFAULT_S3_ENDPOINT = "https://fgws3-gfs.ihep.ac.cn"

# admin api key 推荐通过环境变量传入
ENV_OPENAPI_KEY = "GFS_OPENAPI_KEY"
ENV_OPENAPI_BASE = "GFS_OPENAPI_BASE"
ENV_S3_ENDPOINT = "GFS_S3_ENDPOINT"


class GfsAdminError(Exception):
    """GFS OpenAPI 返回的业务错误."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        data: dict | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status = status
        self.data = data
        super().__init__(f"[GFS {status}] {code}: {message}")


@dataclass(frozen=True)
class GfsBucketInfo:
    """单个 bucket 元信息（OpenAPI ``items[i]`` 的结构化版本）."""

    bucket_name: str           # 完整桶名 e.g. "20235-xiongdb"
    short_name: str            # 短桶名 e.g. "xiongdb"
    owner_id: str              # GFS 内部数字 user_id
    quota_mb: int
    used_bytes: int = 0
    file_num: int = 0
    mtime: int = 0


@dataclass(frozen=True)
class GfsCredential:
    """完整可用的 S3 凭证（拼好了一个用户在 DrSai 侧需要的所有字段）."""

    access_key: str
    secret_key: str
    bucket: str                # 完整桶名
    s3_endpoint: str           # S3 endpoint URL（数据面）
    email: str                 # DrSai 这一层的用户标识（邮箱）
    owner_id: str              # GFS 内部数字 user_id
    expiration: int = -1       # 时间戳，-1 / 9999999999 都视为永不过期
    status: str = "active"
    resources: list[dict] = field(default_factory=list)

    @property
    def never_expires(self) -> bool:
        return self.expiration in (-1, 9999999999) or self.expiration <= 0

    def masked(self) -> dict[str, Any]:
        """日志安全的字典视图，SK 永不出现在 ``repr`` 里."""
        return {
            "email": self.email,
            "bucket": self.bucket,
            "owner_id": self.owner_id,
            "access_key": self.access_key[:8] + "..." + self.access_key[-4:],
            "secret_key": "***",
            "expiration": self.expiration,
            "status": self.status,
        }


class GfsAdminClient:
    """GFS OpenAPI 管理面客户端.

    Args:
        base_url: OpenAPI base, 默认 ``http://gfs.ihep.ac.cn:7800``.
        api_key: ``X-API-Key`` 值, 默认读取环境变量 ``GFS_OPENAPI_KEY``.
        s3_endpoint: 数据面 S3 endpoint, 默认 ``https://fgws3-gfs.ihep.ac.cn``.
        timeout: HTTP 单次调用超时（秒）.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        s3_endpoint: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = (base_url or os.environ.get(ENV_OPENAPI_BASE, DEFAULT_OPENAPI_BASE)).rstrip("/")
        self.api_key = api_key or os.environ.get(ENV_OPENAPI_KEY)
        if not self.api_key:
            raise RuntimeError(
                f"GFS admin api key 未设置；请通过参数 ``api_key`` 或环境变量 "
                f"``{ENV_OPENAPI_KEY}`` 提供。"
            )
        self.s3_endpoint = s3_endpoint or os.environ.get(ENV_S3_ENDPOINT, DEFAULT_S3_ENDPOINT)
        self._http = httpx.Client(
            timeout=timeout,
            headers={
                "X-API-Key": self.api_key,
                "Content-Type": "application/json",
            },
        )

    # ------------------------------------------------------------------ #
    # 低阶: 统一调用与错误处理
    # ------------------------------------------------------------------ #
    def _call(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
    ) -> dict:
        url = f"{self.base_url}{path}"
        try:
            resp = self._http.request(method, url, json=json_body)
        except httpx.HTTPError as e:
            raise GfsAdminError("HTTP_ERROR", str(e), status=0)

        try:
            body = resp.json() if resp.content else {}
        except ValueError:
            body = {"code": "INVALID_JSON", "message": resp.text[:500]}

        code = body.get("code")
        if resp.status_code >= 400 or (isinstance(code, str) and code != "200" and code != 200):
            raise GfsAdminError(
                code=str(code) if code is not None else str(resp.status_code),
                message=body.get("message", resp.text[:300] if resp.text else ""),
                status=resp.status_code,
                data=body.get("data"),
            )
        return body.get("data") or {}

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "GfsAdminClient":
        return self

    def __exit__(self, *a) -> None:
        self.close()

    # ------------------------------------------------------------------ #
    # 端点
    # ------------------------------------------------------------------ #
    def healthz(self) -> dict:
        return self._call("GET", "/healthz")

    def list_buckets(self, email: str) -> list[GfsBucketInfo]:
        """``GET /v1/users/{email}/buckets``.

        实测：``email`` 直接当 user_id 用即可。
        """
        data = self._call("GET", f"/v1/users/{email}/buckets")
        return [
            GfsBucketInfo(
                bucket_name=item["bucket_name"],
                short_name=item["short_name"],
                owner_id=str(item["owner_id"]),
                quota_mb=int(item.get("quota_mb", 0)),
                used_bytes=int(item.get("used_bytes", 0)),
                file_num=int(item.get("file_num", 0)),
                mtime=int(item.get("mtime", 0)),
            )
            for item in (data.get("items") or [])
        ]

    def list_credentials(self, email: str) -> list[dict]:
        """``GET /v1/users/{email}/credentials``.

        返回的 dict 至少有 ``access_key`` / ``secret_key`` / ``status``，
        可能还有 ``resources`` / ``expiration``。
        """
        data = self._call("GET", f"/v1/users/{email}/credentials")
        return list(data.get("items") or [])

    def create_credential(self, email: str, permission: str = "rw") -> dict:
        """``POST /v1/users/{email}/credentials``.

        实测响应里没有 AK/SK，调用方应在调用后再 ``list_credentials`` 拉新列表对比。
        """
        if permission not in ("ro", "rw"):
            raise ValueError(f"permission must be ro/rw, got {permission}")
        return self._call(
            "POST",
            f"/v1/users/{email}/credentials",
            json_body={"permission": permission},
        )

    def delete_credential(self, email: str, access_key: str) -> dict:
        return self._call(
            "DELETE", f"/v1/users/{email}/credentials/{access_key}"
        )

    # ------------------------------------------------------------------ #
    # 高阶：组合操作
    # ------------------------------------------------------------------ #
    def get_user_credential(
        self,
        email: str,
        *,
        require_writable: bool = True,
    ) -> GfsCredential:
        """幂等地拿到一对可用的 ``GfsCredential``.

        策略：
        1. ``list_buckets`` 选 default bucket（取列表第一个，与 short_name == username 对齐）。
        2. ``list_credentials`` 拿现有 AKSK，挑选 ``status='active'`` 的一对。
        3. 若现有列表为空，``create_credential('rw')`` 创建后再 ``list_credentials``。
        4. 三层 fallback 都拿不到时，抛 ``GfsAdminError("NO_CREDENTIAL", ...)``。

        Args:
            email: 用户邮箱（DrSai user_id）。
            require_writable: 当 ``True`` 时，凡 ``resources`` 明确表明只读的凭证一律排除；
                ``resources`` 缺失/为空时仍接受（GFS 实测中常见，多数情况下等价于全权限）。

        Raises:
            GfsAdminError: 当 OpenAPI 调用失败或用户没有可用 bucket / 凭证时。
        """
        buckets = self.list_buckets(email)
        if not buckets:
            raise GfsAdminError(
                "NO_BUCKET",
                f"user {email!r} has no bucket; "
                "请先在 https://gfs.ihep.ac.cn 网页端开通账号。",
                status=404,
            )
        bucket = buckets[0]  # default bucket（short_name 通常 == username）

        cred_dict = self._pick_usable_credential(
            self.list_credentials(email), require_writable
        )
        if cred_dict is None:
            # 现有列表里没有可用的，尝试新建一对
            try:
                self.create_credential(email, "rw")
            except GfsAdminError:
                # POST 不可用也没关系，下面再 list 一次
                pass
            cred_dict = self._pick_usable_credential(
                self.list_credentials(email), require_writable
            )

        if cred_dict is None:
            raise GfsAdminError(
                "NO_CREDENTIAL",
                f"user {email!r} has no active credential; "
                "请去 https://gfs.ihep.ac.cn 网页端密钥管理页检查。",
                status=500,
            )

        return GfsCredential(
            access_key=cred_dict["access_key"],
            secret_key=cred_dict["secret_key"],
            bucket=bucket.bucket_name,
            s3_endpoint=self.s3_endpoint,
            email=email,
            owner_id=bucket.owner_id,
            expiration=int(cred_dict.get("expiration", -1)),
            status=cred_dict.get("status", "active"),
            resources=list(cred_dict.get("resources") or []),
        )

    # ------------------------------------------------------------------ #
    # 内部：从 list_credentials 结果中挑一对
    # ------------------------------------------------------------------ #
    @staticmethod
    def _pick_usable_credential(
        items: list[dict],
        require_writable: bool,
    ) -> dict | None:
        rw_active: dict | None = None
        any_active: dict | None = None
        for c in items:
            ak = c.get("access_key")
            sk = c.get("secret_key")
            if not (ak and sk):
                continue
            if c.get("status") != "active":
                continue
            actions: list[str] = []
            for r in c.get("resources") or []:
                actions.extend(r.get("Actions") or r.get("actions") or [])
            if "Write" in actions:
                rw_active = c
                break
            if not actions:
                any_active = any_active or c
        if rw_active is not None:
            return rw_active
        if not require_writable:
            return any_active
        # resources 为空时也接受（GFS 实测中常见，多数情况下等价全权限）
        return any_active


# ---------------------------------------------------------------------- #
# 进程级单例
# ---------------------------------------------------------------------- #
_admin_singleton: GfsAdminClient | None = None
_admin_lock = threading.Lock()


def get_admin_client(*, refresh: bool = False) -> GfsAdminClient:
    """返回进程级 ``GfsAdminClient`` 单例.

    所有 DrSai 模块都应通过本函数获取 admin client，避免多份连接池。
    """
    global _admin_singleton
    if refresh or _admin_singleton is None:
        with _admin_lock:
            if refresh and _admin_singleton is not None:
                _admin_singleton.close()
                _admin_singleton = None
            if _admin_singleton is None:
                _admin_singleton = GfsAdminClient()
    return _admin_singleton
