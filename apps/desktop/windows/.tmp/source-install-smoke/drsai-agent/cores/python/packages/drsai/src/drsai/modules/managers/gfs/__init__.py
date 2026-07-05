"""GFS 集成 SDK：管理面 + 数据面 + 进程级 provisioner.

模块布局
--------

- ``admin_client``：调 GFS OpenAPI 拿用户的 AKSK/bucket 信息（``X-API-Key`` 鉴权）.
- ``user_client``：用某用户的 AKSK 调 S3 endpoint 读写他自己的 bucket（boto3 包装）.
- ``provisioner``：进程级缓存 + 凭证持久化，给上层提供 ``get_user_client(email)`` 入口.

典型用法
--------

.. code-block:: python

   from drsai.modules.managers.gfs import get_user_client

   client = get_user_client("alice@ihep.ac.cn")
   client.write_text("workspace/notes.md", "hello")
   url = client.presign_get("workspace/notes.md", ttl_sec=600)

环境变量
--------

- ``GFS_OPENAPI_KEY``：管理面 X-API-Key（必需）.
- ``GFS_OPENAPI_BASE``：OpenAPI base URL，默认 ``http://gfs.ihep.ac.cn:7800``.
- ``GFS_S3_ENDPOINT``：S3 endpoint URL，默认 ``https://fgws3-gfs.ihep.ac.cn``.
- ``DRSAI_GFS_CACHE_DIR``：AKSK 缓存目录，默认 ``~/.drsai/.cache/gfs``.

详见: ``cores/python/packages/drsai/docs/gfs-integration.md``.
"""

from .admin_client import (
    DEFAULT_OPENAPI_BASE,
    DEFAULT_S3_ENDPOINT,
    ENV_OPENAPI_BASE,
    ENV_OPENAPI_KEY,
    ENV_S3_ENDPOINT,
    GfsAdminClient,
    GfsAdminError,
    GfsBucketInfo,
    GfsCredential,
    get_admin_client,
)
from .agent_tools import make_gfs_tools, make_gfs_tools_personal
from .provisioner import (
    ENV_CACHE_DIR,
    ENV_PERSONAL_ACCESS_KEY,
    ENV_PERSONAL_BUCKET,
    ENV_PERSONAL_EMAIL,
    ENV_PERSONAL_SECRET_KEY,
    GfsProvisioner,
    credential_from_env,
    get_personal_user_client,
    get_user_client,
)
from .user_client import (
    GfsObjectInfo,
    GfsUserClient,
    OUTPUTS_PREFIX,
    UPLOADS_PREFIX,
    WORKSPACE_PREFIX,
)


__all__ = [
    # admin_client
    "DEFAULT_OPENAPI_BASE",
    "DEFAULT_S3_ENDPOINT",
    "ENV_OPENAPI_BASE",
    "ENV_OPENAPI_KEY",
    "ENV_S3_ENDPOINT",
    "GfsAdminClient",
    "GfsAdminError",
    "GfsBucketInfo",
    "GfsCredential",
    "get_admin_client",
    # agent_tools
    "make_gfs_tools",
    "make_gfs_tools_personal",
    # provisioner
    "ENV_CACHE_DIR",
    "ENV_PERSONAL_ACCESS_KEY",
    "ENV_PERSONAL_BUCKET",
    "ENV_PERSONAL_EMAIL",
    "ENV_PERSONAL_SECRET_KEY",
    "GfsProvisioner",
    "credential_from_env",
    "get_personal_user_client",
    "get_user_client",
    # user_client
    "GfsObjectInfo",
    "GfsUserClient",
    "OUTPUTS_PREFIX",
    "UPLOADS_PREFIX",
    "WORKSPACE_PREFIX",
]
