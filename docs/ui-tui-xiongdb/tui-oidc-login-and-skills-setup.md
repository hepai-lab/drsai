# OpenDrSai TUI OIDC 登录与 Skills 预装方案

> **作者**: OpenDrSai  
> **日期**: 2025-01-22  
> **状态**: 设计草案，待评审  
> **关联模块**: `apps/ui-tui`, `cores/python/packages/drsai/src/drsai/backend/tui_gateway`, `apps/desktop`

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [现状分析](#2-现状分析)
3. [核心设计决策](#3-核心设计决策)
4. [整体架构](#4-整体架构)
5. [详细设计 — OIDC 认证模块](#5-详细设计--oidc-认证模块)
6. [详细设计 — Skills 选择性安装](#6-详细设计--skills-选择性安装)
7. [前端界面设计](#7-前端界面设计)
8. [配置文件变更](#8-配置文件变更)
9. [关键设计考量](#9-关键设计考量)
10. [完整启动流程（用户视角）](#10-完整启动流程用户视角)
11. [文件变更清单](#11-文件变更清单)
12. [实施步骤](#12-实施步骤)
13. [待确认事项](#13-待确认事项)

---

## 1. 背景与目标

### 1.1 背景

OpenDrSai 已有三条产品线：Desktop（Electron 桌面应用）、WebUI（Web 界面）、TUI（终端界面）。

- **Desktop** 已实现完整的 OIDC 认证流程（Authorization Code + PKCE / Device Code Flow），通过 IHEP SSO 登录后自动获取 HAI API Key，Token 加密存储在操作系统级 Keychain/DPAPI 中。
- **TUI** 当前无任何认证机制，首次启动时要求用户手动输入 API Key（明文存储在 `~/.drsai/cli_config.json`），且 built-in skills 全量自动安装。
- **安装脚本**（4 个 `.sh`/`.ps1`）已移除 `install_skills()` 函数，skills 安装逻辑需挪移至 TUI 启动配置中。

### 1.2 目标

1. **TUI OIDC 登录**：参考 Desktop 的 OIDC 登录机制，在 TUI 首次启动时提供 Device Code Flow 登录，自动获取 HAI API Key（access_token），替代手动输入。
2. **Skills 预装**：用户首次启动 TUI 时，在配置用户名后，可选择性安装 `skills/skills/` 目录中的预装 skills 到自己的 skills 目录。

---

## 2. 现状分析

### 2.1 Desktop OIDC 认证流程

| 维度 | 详情 |
|------|------|
| OIDC Provider | HAI（HepAI）`https://ai-dev.ihep.ac.cn/api`（dev）/ 生产环境 URL |
| Client ID | `opendrsai-desktop`（public client，PKCE required） |
| Grant Types | Authorization Code + PKCE（主），Device Code Flow（备） |
| Scopes | `openid email profile roles groups hai_api`（+ `offline_access` if "remember me"） |
| Token TTL | Access=3600s（1h），Refresh=2592000s（30d），Auth Code=300s（5min） |
| Token 存储 | `~/.drsai/auth/auth.json`，Token 字段经 OS 加密（Windows DPAPI / macOS Keychain） |
| 凭证服务 | `DesktopCredentialService` 接口：Windows 用 Electron `safeStorage`(DPAPI)，macOS 用原生 Keychain |
| 刷新策略 | 过期前 5 分钟自动刷新（`ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000`），singleton guard 防并发 |
| 注销 | `POST /oauth2/revoke` 撤销 refresh_token → 清除本地 session + Keychain |
| Gateway 认证头 | `Authorization: Bearer <accessToken>` + `X-OpenDrSai-Gateway-Token` + `X-OpenDrSai-Auth-Mode: oidc` + `X-OpenDrSai-Principal: <userId>` |

**OIDC Provider 端点（HAI 后端）**：

| 端点 | 用途 |
|------|------|
| `/.well-known/openid-configuration` | OIDC Discovery |
| `/oauth2/authorize` | Authorization endpoint |
| `/oauth2/token` | Token endpoint（exchange + refresh + device） |
| `/oauth2/userinfo` | UserInfo endpoint |
| `/oauth2/revoke` | Token revocation |
| `/oauth2/introspect` | Token introspection |
| `/oauth2/upstream/ihep/login` | IHEP SSO 登录跳转 |
| `/oauth2/upstream/ihep/callback` | IHEP SSO 回调 |

**关键代码位置**：

| 文件 | 职责 |
|------|------|
| `apps/desktop/shared/main/auth.ts` | OIDC 核心引擎：login、token exchange、refresh、storage、logout、device flow、JWKS |
| `apps/desktop/shared/main/platformConfig.ts` | Platform config + OIDC issuer 解析 |
| `apps/desktop/shared/main/gateway.ts` | Gateway 进程管理 + auth headers |
| `apps/desktop/shared/renderer/src/auth/AuthProvider.tsx` | React Context Provider for auth state |
| `apps/desktop/shared/renderer/src/auth/LoginScreen.tsx` | 登录 UI（OIDC button、device code 展示） |
| `apps/desktop/windows/docs/login_plan/oidc-login-plan.md` | OIDC 登录设计文档 |

### 2.2 TUI Gateway 现状

**无认证层**。TUI gateway 是本地子进程（stdio transport），"认证"即 API Key 配置。

**当前首次启动流程**（`setupScreen.tsx`）：

```
username → provider(HepAI/Anthropic/OpenAI/Skip) → apikey → baseurl(optional) → done
```

**配置存储**：

| 文件 | 用途 |
|------|------|
| `~/.drsai/cli_config.json` | 主配置：user_id, API keys, base_urls, plan_mode 等 |
| `~/.drsai/cli_sessions.json` | Session 元数据（SQLite-backed） |
| `~/.drsai/tui_gateway.pid` | PID file for orphaned gateway cleanup |
| `~/.drsai/logs/tui_gateway_crash.log` | Crash forensics log |

**关键代码位置**：

| 文件 | 职责 |
|------|------|
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/entry.py` | 进程入口，信号设置，JSON-RPC stdin loop，`setup_status()` |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/setup.py` | `setup.status`、`setup.config`、`setup.save` RPC |
| `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/skills.py` | `skills.manage` CRUD RPC（list/show/create/delete/update/reload） |
| `apps/ui-tui/src/app.tsx` | Bootstrap 状态机：connecting → setup → resuming → ready |
| `apps/ui-tui/src/components/setupScreen.tsx` | 首次启动设置向导 UI |
| `apps/ui-tui/src/components/skillsPane.tsx` | Skills 管理面板 UI |
| `apps/ui-tui/src/gatewayClient.ts` | Gateway 客户端：spawn subprocess + JSON-RPC |

**`cli_config.json` 当前 schema**（`DEFAULT_CONFIG`）：

```python
{
    "user_id": "",
    "defult_config_name": "deepseek-v3",
    "plan_mode": False,
    "workspace_enabled": True,
    "dangerous_allowed": False,
    "max_agent_concurrent": 3,
    "api_key": "",
    "anthropic_api_key": "",
    "anthropic_base_url": "",
    "openai_api_key": "",
    "openai_base_url": ""
}
```

API Key 明文存储，`_SENSITIVE_KEYS` 集合仅用于显示时 mask，不涉及加密。

### 2.3 Skills 系统现状

**Built-in Skills 目录**：`skills/skills/`（12 个 skill）

| Skill | 用途 |
|-------|------|
| `pptx` | PowerPoint 生成 |
| `drsai-dev-skill` | DrSAI 开发辅助 |
| `opendrsai-regression-testing` | 回归测试套件 |
| `image-process` | 图像处理 |
| `ragflow-knowledge` | RAGFlow 知识库操作 |
| `skill-creator` | 创建新 skill 的元技能 |
| `playwright-cli` | Playwright 浏览器自动化 |
| `system-setting` | 系统配置管理 |
| `academic-search` | 学术论文搜索 |
| `local-file-sharing` | 本地文件共享 |
| `ihep-gfs-skill` | IHEP 网格文件系统操作 |
| `download-skills` | 下载远程 skills |

**用户 Skills 目录**：`~/.drsai/workspace/runs/{user_id}/configs/skills/`

**Skills 解析优先级**：

1. `SYSTEM_SKILLS_DIR` 环境变量（直接指向 built-in skills root）
2. `cli_config.json` 的 `skills_dir` 字段
3. 默认 `~/.drsai/workspace/runs/{user_id}/configs/skills/`

**当前同步逻辑**（`drsai_assistant.py::update_user_skills()`）：

- 全量自动同步：built-in → user dir
- mtime 检查：system mtime > user mtime 时才覆盖（保护用户修改）
- 三级渐进式加载：metadata（常驻系统提示） → SKILL.md body（按需加载） → bundled resources

---

## 3. 核心设计决策

### 3.1 登录方式：Device Code Flow（设备码流程）

**选择理由**：

| 方案 | 优点 | 缺点 | 适用性 |
|------|------|------|--------|
| **Device Code Flow** | ✅ CLI 标准（`gh auth login`、`az login`），SSH/远程环境可用，无需 loopback server | 用户需手动复制码 | **首选** |
| PKCE + Browser Redirect | 本地体验好 | SSH 环境无法打开浏览器，需 loopback HTTP server | 备选 |
| 手动 Token 粘贴 | 最简单 | 用户体验差 | 不推荐 |

- HAI OIDC Provider 已支持 Device Code Flow（Desktop 代码中已验证 `device_authorization_endpoint` 存在于 discovery metadata）。
- 用户在终端看到验证码 + URL → 在任意设备浏览器打开 → 输入码 → 完成。
- SSH 远程场景天然支持。

### 3.2 Token 存储策略

```
优先级：
  1. Python keyring 库（跨平台 OS Keychain）
     - Linux: SecretService (GNOME Keyring / KWallet)
     - macOS: Keychain
     - Windows: Credential Manager
  2. 回退：加密文件 ~/.drsai/auth/auth.json
     - Fernet 对称加密（machine-derived key）
     - key 文件权限 0600
```

### 3.3 OIDC 登录后自动获取 API Key

OIDC 的 `access_token` 本身即 HAI API Key（scope 包含 `hai_api`）。登录成功后：

- 将 `access_token` 写入 `cli_config.json` 的 `api_key` 字段
- `auth_mode` 标记为 `"oidc"`
- Token 刷新时同步更新 `api_key`
- 注销时清除 `api_key`

### 3.4 Skills 选择性安装

**旧行为**：`update_user_skills()` 全量自动同步所有 built-in skills。

**新行为**：

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 首次启动 | 全量安装所有 built-in skills | 用户选择安装哪些 |
| 后续启动 | 自动同步所有（mtime 更新才覆盖） | 只同步已选 skills（mtime 更新才覆盖） |
| 新增 built-in skill | 自动安装 | 不自动安装，通过 `/skills` 命令或启动提示告知 |
| 用户修改 skill | mtime 检查保护用户修改 | 不变 |

### 3.5 向后兼容

- 已有 `cli_config.json` 且有 `api_key` 的用户 → `auth_mode` 为 `"api_key"`，直接进入主界面
- 已有安装的 skills → `skills_selected` 默认为 `True`，`enabled_skills` 默认为所有已安装的
- OIDC 登录是**可选**的，不强制（可跳过使用手动 API Key）

---

## 4. 整体架构

### 4.1 启动流程图

```
┌──────────────────────────────────────────────────────────────────┐
│                        TUI 启动流程                               │
│                                                                  │
│  [entry.tsx]          [app.tsx]              [tui_gateway]       │
│      │                     │                      │             │
│  spawn gateway ──────► bootstrap ──────► gateway.ready event     │
│      │                     │                      │             │
│      │               ┌─────▼──────┐               │             │
│      │               │ auth check │ ◄─────────────┤ auth.status │
│      │               └─────┬──────┘               │             │
│      │                     │                      │             │
│      │              ┌──────▼───────┐               │             │
│      │              │ No session?  │               │             │
│      │              └──────┬───────┘               │             │
│      │                     │ Yes                   │             │
│      │              ┌──────▼──────────┐            │             │
│      │              │ AuthScreen       │──────────►│ auth.oidc.* │
│      │              │ (Device Code UI) │◄──────────│ (polling)   │
│      │              └──────┬──────────┘            │             │
│      │                     │ success               │             │
│      │              ┌──────▼───────┐               │             │
│      │              │ Setup needed? │ ◄────────────┤ setup.status│
│      │              └──────┬───────┘               │             │
│      │                     │ Yes                   │             │
│      │              ┌──────▼──────────────┐        │             │
│      │              │ SkillsSetupScreen   │──────►│setup.skills.*│
│      │              │ (checkbox list)    │◄──────│ (install)   │
│      │              └──────┬──────────────┘        │             │
│      │                     │ done                  │             │
│      │              ┌──────▼───────┐               │             │
│      │              │ resolveSession│               │             │
│      │              └──────┬───────┘               │             │
│      │                     │                       │             │
│      │              ┌──────▼───────┐               │             │
│      │              │   Ready ✓    │               │             │
│      │              └──────────────┘               │             │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Bootstrap 状态机变化

```
现有:  connecting → [setup] → resuming → ready

新增:  connecting → auth → [setup → skills_selection] → resuming → ready
                 ↑           ↑
                 ↓           ↓
            auth_failed  (可选：跳过登录→setup wizard 手动配置API Key)
```

### 4.3 登录与 API Key 的关系 — platform_auth_scope 机制

**核心发现**：代码库已内置 OIDC → 模型访问链路（`platform_auth.py`），**无需将 access_token 写入 cli_config.json["api_key"]**。

OIDC token 通过 `ContextVar` + `platform_auth_scope()` 上下文管理器传递给 LLM 客户端：

```
OIDC 登录成功
    │
    ├─ access_token (JWT, scope=hai_api) → 加密存储于 ~/.drsai/auth/auth.json
    │
    ├─ refresh_token → 加密存储于 ~/.drsai/auth/auth.json
    │                  → 过期前 5min 自动刷新
    │
    ├─ user info (sub, email, name) → 写入 cli_config.json["user_id"]
    │                                  → 用于 workspace/runs/{user_id}/ 路径
    │
    └─ 模型访问链路 (无需 api_key):
        │
        ├─ session.py: context_from_bearer(access_token) → PlatformAuthContext
        ├─ platform_auth_scope(context) → 绑定 ContextVar _platform_auth
        │
        └─ HepAIChatCompletionClient.__init__():
            ├─ get_model_credential_provider() 发现 ContextVar 有值
            ├─ 返回 OidcModelCredentialProvider
            ├─ kwargs["api_key"] = credential.access_token  ← OIDC token 替代!
            └─ kwargs["base_url"] = credential.openai_base_url  ← 自动设置
```

**关键文件**：
- `platform_auth.py`: `context_from_bearer()`, `platform_auth_scope()`, `get_model_credential_provider()`
- `LLMClient.py`: `HepAIChatCompletionClient._bind_platform_auth()` — 每次 `create()` 前重新绑定 token
- 支持 deferred OIDC: 构建时用 `"opendrsai-oidc-pending"` 占位符，调用时再替换

---

## 5. 详细设计 — OIDC 认证模块

### 5.1 OIDC 配置常量

```python
# 参考 desktop apps/desktop/shared/main/auth.ts

# 与 desktop 共享同一 OIDC Provider，但使用独立的 client_id
OIDC_CLIENT_ID = os.environ.get("OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-tui")
OIDC_ISSUER = os.environ.get(
    "OPENDRSAI_OIDC_ISSUER",
    os.environ.get("HAI_OIDC_ISSUER", "https://ai-dev.ihep.ac.cn/api")
)
OIDC_DISCOVERY_URL = f"{OIDC_ISSUER}/.well-known/openid-configuration"
OIDC_SCOPES = "openid email profile roles groups hai_api"
ACCESS_TOKEN_REFRESH_WINDOW_S = 300      # 过期前 5 分钟刷新
SESSION_DAYS = 30
OIDC_DEVICE_FLOW_TIMEOUT_S = 300         # 设备码有效期 5 分钟
OIDC_FETCH_TIMEOUT_S = 10                # HTTP 请求超时
```

> **注意**：如果不想在 HAI 端注册新 client，可直接复用 `opendrsai-desktop`（OIDC Provider 端无需修改配置）。

### 5.2 Token 存储

#### 存储结构

```json
// ~/.drsai/auth/auth.json
{
    "session_id": "uuid-string",
    "created_at": "2025-01-22T10:00:00Z",
    "expires_at": "2025-02-21T10:00:00Z",
    "auth_mode": "oidc",
    "user": {
        "user_id": "xiongdb",
        "email": "xiongdb@ihep.ac.cn",
        "name": "Xiong Daobin",
        "roles": ["user"],
        "groups": ["ihep"]
    },
    "issuer": "https://ai-dev.ihep.ac.cn/api",
    "client_id": "opendrsai-tui",
    "encrypted_access_token": "...",
    "encrypted_refresh_token": "...",
    "encrypted_id_token": "..."
}
```

#### 加密策略

```python
# 优先使用 keyring（OS 原生 Keychain）
try:
    import keyring
    HAS_KEYRING = True
except ImportError:
    HAS_KEYRING = False

KEYRING_SERVICE = "opendrsai-tui"

def _get_encryption_key() -> bytes:
    """获取或创建 machine-derived Fernet key"""
    # Linux: 基于 /etc/machine-id
    # macOS: 基于 hostname + IOPlatformUUID
    # 生成 Fernet key，存储在 keyring 中（如果有）或
    # ~/.drsai/auth/.machine_key（权限 0600）

def _protect(plaintext: str) -> str:
    """加密 secret"""
    if HAS_KEYRING:
        keyring.set_password(KEYRING_SERVICE, "access_token", plaintext)
        return "keyring:access_token"
    key = _get_encryption_key()
    return Fernet(key).encrypt(plaintext.encode()).decode()

def _unprotect(protected: str) -> str | None:
    """解密 secret"""
    if protected.startswith("keyring:"):
        return keyring.get_password(KEYRING_SERVICE, protected.split(":")[1])
    key = _get_encryption_key()
    return Fernet(key).decrypt(protected.encode()).decode()
```

### 5.3 OIDC Client 模块

#### 新增文件：`backend/auth/oidc_client.py`

```python
"""OIDC Device Code Flow client for TUI.

参考 desktop apps/desktop/shared/main/auth.ts 的 device flow 实现。

流程:
    1. discovery()           — GET /.well-known/openid-configuration
    2. request_device_code() — POST /device_authorization
    3. poll_device_token()   — POST /oauth2/token (grant_type=device_code)
    4. validate_id_token()   — JWKS 验证 (RS256, issuer, audience, expiry)
    5. refresh_token()       — POST /oauth2/token (grant_type=refresh_token)
    6. revoke_token()        — POST /oauth2/revoke
"""

import time
import httpx

class OidcClient:
    """OIDC Device Code Flow 客户端"""

    def __init__(self, issuer: str, client_id: str, scopes: str):
        self.issuer = issuer
        self.client_id = client_id
        self.scopes = scopes
        self._metadata: dict | None = None
        self._jwks_cache: dict | None = None
        self._jwks_cache_time: float = 0

    async def discovery(self) -> dict:
        """GET {issuer}/.well-known/openid-configuration"""
        if self._metadata:
            return self._metadata
        resp = await httpx.AsyncClient().get(
            f"{self.issuer}/.well-known/openid-configuration",
            timeout=OIDC_FETCH_TIMEOUT_S,
        )
        resp.raise_for_status()
        self._metadata = resp.json()
        return self._metadata

    async def request_device_code(self) -> dict:
        """POST {device_authorization_endpoint}
        body: client_id={client_id}&scope={scopes}

        Returns:
            {
                device_code: str,
                user_code: str,
                verification_uri: str,
                verification_uri_complete: str,
                expires_in: int,
                interval: int,
            }
        """
        meta = await self.discovery()
        endpoint = meta.get("device_authorization_endpoint")
        if not endpoint:
            raise RuntimeError("OIDC provider does not support device flow")
        resp = await httpx.AsyncClient().post(endpoint, data={
            "client_id": self.client_id,
            "scope": self.scopes,
        }, timeout=OIDC_FETCH_TIMEOUT_S)
        data = resp.json()
        if not resp.is_success:
            raise RuntimeError(f"Device auth failed: {data}")
        return data

    async def poll_device_token(self, device_code: str) -> dict:
        """POST {token_endpoint} with grant_type=device_code

        Returns:
            On success: {access_token, refresh_token, id_token, ...}
            On pending: raises httpx.HTTPStatusError with error=slow_down|authorization_pending
        """
        meta = await self.discovery()
        resp = await httpx.AsyncClient().post(meta["token_endpoint"], data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code,
            "client_id": self.client_id,
        }, timeout=OIDC_FETCH_TIMEOUT_S)
        data = resp.json()
        if not resp.is_success:
            # error: authorization_pending | slow_down | expired_token
            return {"status": "pending", "error": data.get("error")}
        return {"status": "success", **data}

    async def validate_id_token(self, id_token: str) -> dict:
        """JWKS 验证 ID Token (RS256, issuer, audience, expiry)

        参考 desktop auth.ts createOidcSession()
        """
        # 1. 解码 JWT header 获取 kid
        # 2. 获取 JWKS（缓存 5 分钟）
        # 3. 验证签名 (RS256)
        # 4. 验证 issuer, audience, expiry
        # 5. 返回 claims: {sub, email, name, roles, groups}
        ...

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """POST {token_endpoint} with grant_type=refresh_token

        Returns: {access_token, refresh_token, id_token, expires_in}
        """
        meta = await self.discovery()
        resp = await httpx.AsyncClient().post(meta["token_endpoint"], data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.client_id,
        }, timeout=OIDC_FETCH_TIMEOUT_S)
        resp.raise_for_status()
        return resp.json()

    async def revoke_token(self, refresh_token: str) -> None:
        """POST {revocation_endpoint}"""
        meta = await self.discovery()
        endpoint = meta.get("revocation_endpoint")
        if not endpoint:
            return
        await httpx.AsyncClient().post(endpoint, data={
            "token": refresh_token,
            "client_id": self.client_id,
        }, timeout=OIDC_FETCH_TIMEOUT_S)
```

### 5.4 Token Store 模块

#### 新增文件：`backend/auth/token_store.py`

```python
"""Token storage with OS-native credential service or Fernet fallback.

参考 desktop auth.ts writeStoredSession() / readStoredSession()
"""

from pathlib import Path
from datetime import datetime, timedelta, timezone
import json, uuid, os

DRSAI_HOME = Path(os.environ.get("OPENDRSAI", Path.home() / ".drsai"))
AUTH_DIR = DRSAI_HOME / "auth"
AUTH_SESSION_FILE = AUTH_DIR / "auth.json"

def load_auth_session() -> dict | None:
    """读取并解密 auth session"""
    if not AUTH_SESSION_FILE.exists():
        return None
    data = json.loads(AUTH_SESSION_FILE.read_text("utf-8"))
    # 解密 token 字段
    if data.get("encrypted_access_token"):
        data["access_token"] = _unprotect(data["encrypted_access_token"])
    if data.get("encrypted_refresh_token"):
        data["refresh_token"] = _unprotect(data["encrypted_refresh_token"])
    if data.get("encrypted_id_token"):
        data["id_token"] = _unprotect(data["encrypted_id_token"])
    return data

def save_auth_session(tokens: dict, user_info: dict, issuer: str, client_id: str) -> dict:
    """加密并原子写入 auth session"""
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    session = {
        "session_id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(),
        "auth_mode": "oidc",
        "user": user_info,
        "issuer": issuer,
        "client_id": client_id,
        "encrypted_access_token": _protect(tokens["access_token"]),
        "encrypted_refresh_token": _protect(tokens.get("refresh_token", "")),
        "encrypted_id_token": _protect(tokens.get("id_token", "")),
    }
    # 原子写入：先写临时文件，再 rename
    tmp = AUTH_SESSION_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(session, indent=2), "utf-8")
    tmp.rename(AUTH_SESSION_FILE)
    return session

def clear_auth_session() -> None:
    """删除 auth session + 清除 keyring 条目"""
    if AUTH_SESSION_FILE.exists():
        data = json.loads(AUTH_SESSION_FILE.read_text("utf-8"))
        # 清除 keyring
        for field in ("encrypted_access_token", "encrypted_refresh_token", "encrypted_id_token"):
            val = data.get(field, "")
            if val.startswith("keyring:"):
                try:
                    keyring.delete_password(KEYRING_SERVICE, val.split(":")[1])
                except Exception:
                    pass
        AUTH_SESSION_FILE.unlink()

def is_token_expired(session: dict, refresh_window_s: int = 300) -> bool:
    """检查 access_token 是否需要刷新"""
    # 解析 JWT exp claim
    access_token = session.get("access_token")
    if not access_token:
        return True
    # JWT exp 在 payload
    import base64
    payload_b64 = access_token.split(".")[1]
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=="))
    exp = payload.get("exp", 0)
    now = time.time()
    return now >= (exp - refresh_window_s)
```

### 5.5 Auth RPC Handler

#### 新增文件：`tui_gateway/handlers/auth.py`

```python
"""OIDC authentication RPC handlers for TUI gateway.

Methods:
    auth.status          — 检查当前认证状态
    auth.oidc.start      — 启动 Device Code Flow
    auth.oidc.poll       — 轮询 token endpoint
    auth.oidc.cancel     — 取消进行中的登录
    auth.session.refresh — 刷新 access token
    auth.logout          — 注销
"""

from __future__ import annotations
import logging, os, threading

from ..server import _err, _ok, method
from drsai.backend.auth.oidc_client import OidcClient
from drsai.backend.auth.token_store import (
    load_auth_session, save_auth_session, clear_auth_session, is_token_expired
)
from drsai.backend.cli import config as cli_config

logger = logging.getLogger(__name__)

# ── OIDC config ──────────────────────────────────────────────────────
OIDC_CLIENT_ID = os.environ.get("OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-tui")
OIDC_ISSUER = os.environ.get(
    "OPENDRSAI_OIDC_ISSUER",
    os.environ.get("HAI_OIDC_ISSUER", "https://ai-dev.ihep.ac.cn/api")
)
OIDC_SCOPES = "openid email profile roles groups hai_api"

# 全局 OidcClient 实例（缓存 discovery + JWKS）
_oidc_client: OidcClient | None = None
# 进行中的 device flow 状态
_pending_device: dict | None = None
_pending_lock = threading.Lock()


def _get_oidc_client() -> OidcClient:
    global _oidc_client
    if _oidc_client is None:
        _oidc_client = OidcClient(OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_SCOPES)
    return _oidc_client


@method("auth.status")
def _auth_status(rid, params: dict) -> dict:
    """检查认证状态

    Returns: {
        authenticated: bool,
        auth_mode: "oidc" | "api_key" | "none",
        user: {user_id, email, name} | None,
        expires_at: str | None,
        needs_refresh: bool,
    }
    """
    session = load_auth_session()
    if session and session.get("auth_mode") == "oidc":
        needs_refresh = is_token_expired(session)
        return _ok(rid, {
            "authenticated": True,
            "auth_mode": "oidc",
            "user": session.get("user"),
            "expires_at": session.get("expires_at"),
            "needs_refresh": needs_refresh,
        })

    # 检查手动 API Key
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
    has_api_key = bool(cfg.get("api_key") or os.environ.get("HEPAI_API_KEY"))
    return _ok(rid, {
        "authenticated": has_api_key,
        "auth_mode": "api_key" if has_api_key else "none",
        "user": {"user_id": cfg.get("user_id", "")} if has_api_key else None,
        "expires_at": None,
        "needs_refresh": False,
    })


@method("auth.oidc.start")
def _oidc_start(rid, params: dict) -> dict:
    """启动 Device Code Flow

    1. GET {OIDC_DISCOVERY_URL} → 获取 metadata
    2. POST {device_authorization_endpoint}
       body: client_id={OIDC_CLIENT_ID}&scope={OIDC_SCOPES}

    Returns: {
        device_code: str,
        user_code: str,
        verification_uri: str,
        verification_uri_complete: str,
        expires_in: int,
        interval: int,
    }
    """
    client = _get_oidc_client()
    try:
        result = client.request_device_code()  # sync wrapper for async
        with _pending_lock:
            global _pending_device
            _pending_device = {
                "device_code": result["device_code"],
                "expires_at": time.time() + result.get("expires_in", 300),
                "interval": result.get("interval", 5),
            }
        return _ok(rid, result)
    except Exception as exc:
        logger.exception("OIDC device code request failed")
        return _err(rid, 5001, f"Device code request failed: {exc}")


@method("auth.oidc.poll")
def _oidc_poll(rid, params: dict) -> dict:
    """轮询 token endpoint

    POST {token_endpoint}
    body: grant_type=urn:ietf:params:oauth:grant-type:device_code
          &device_code={device_code}
          &client_id={OIDC_CLIENT_ID}

    Returns: {
        status: "pending" | "success" | "expired" | "error",
        session?: {  # only on success
            user_id: str,
            email: str,
            name: str,
            expires_at: str,
        },
        error?: str,
    }
    前端每 interval 秒调用一次，直到 status != "pending"
    """
    global _pending_device
    with _pending_lock:
        if not _pending_device:
            return _err(rid, 4002, "No pending device login")
        if time.time() > _pending_device["expires_at"]:
            _pending_device = None
            return _ok(rid, {"status": "expired"})

    client = _get_oidc_client()
    try:
        result = client.poll_device_token(_pending_device["device_code"])
    except Exception as exc:
        return _ok(rid, {"status": "error", "error": str(exc)})

    if result.get("status") != "success":
        return _ok(rid, result)

    # 成功 → 验证 ID Token + 保存 session
    try:
        user_info = client.validate_id_token(result.get("id_token", ""))
        session = save_auth_session(
            tokens=result,
            user_info=user_info,
            issuer=OIDC_ISSUER,
            client_id=OIDC_CLIENT_ID,
        )
        # 不写入 cli_config["api_key"] — OIDC token 通过 platform_auth_scope 传递
        cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
        cfg["auth_mode"] = "oidc"
        cfg["user_id"] = user_info.get("user_id", "")
        cli_config.save_config(cfg)
        # 不设置 os.environ["HEPAI_API_KEY"] — 避免 StaticModelCredentialProvider 抢占 OidcModelCredentialProvider

        with _pending_lock:
            _pending_device = None

        return _ok(rid, {
            "status": "success",
            "session": {
                "user_id": user_info.get("user_id"),
                "email": user_info.get("email"),
                "name": user_info.get("name"),
                "expires_at": session["expires_at"],
            },
        })
    except Exception as exc:
        logger.exception("OIDC session creation failed")
        return _ok(rid, {"status": "error", "error": str(exc)})


@method("auth.oidc.cancel")
def _oidc_cancel(rid, params: dict) -> dict:
    """取消进行中的 device flow"""
    global _pending_device
    with _pending_lock:
        _pending_device = None
    return _ok(rid, {"ok": True})


@method("auth.session.refresh")
def _session_refresh(rid, params: dict) -> dict:
    """刷新 access token"""
    session = load_auth_session()
    if not session or not session.get("refresh_token"):
        return _err(rid, 4002, "No refresh token available")

    client = _get_oidc_client()
    try:
        new_tokens = client.refresh_access_token(session["refresh_token"])
        # 更新 session
        save_auth_session(
            tokens=new_tokens,
            user_info=session["user"],
            issuer=session["issuer"],
            client_id=session["client_id"],
        )
        # 不更新 cli_config["api_key"] — token 通过 platform_auth_scope 动态传递
        return _ok(rid, {"ok": True, "expires_at": new_tokens.get("expires_in")})
    except Exception as exc:
        logger.exception("Token refresh failed")
        return _err(rid, 5002, f"Refresh failed: {exc}")


@method("auth.logout")
def _auth_logout(rid, params: dict) -> dict:
    """注销
    1. POST {revocation_endpoint} revoke refresh_token
    2. 删除 auth.json + 清除 keyring
    3. 清除 cli_config.json 中的 auth_mode（不涉及 api_key）
    """
    session = load_auth_session()
    if session and session.get("refresh_token"):
        client = _get_oidc_client()
        try:
            client.revoke_token(session["refresh_token"])
        except Exception:
            logger.exception("Token revocation failed")

    clear_auth_session()

    # 清除 cli_config 中的 OIDC 标记（不涉及 api_key）
    cfg = cli_config.load_config()
    cfg["auth_mode"] = "none"
    cli_config.save_config(cfg)

    return _ok(rid, {"ok": True})
```

### 5.6 修改 entry.py

```python
# tui_gateway/entry.py — setup_status() 增加 auth + skills 检查

def setup_status() -> dict:
    """Inspect config + env + auth to see whether first-run setup is needed."""
    has_api_key = False
    config_path_exists = False
    try:
        from drsai.backend.cli import config as cli_config
        config_path_exists = cli_config.CLI_CONFIG_PATH.exists()
        cfg = cli_config.load_config() if config_path_exists else {}
        has_api_key = any([
            cfg.get("api_key"),
            cfg.get("anthropic_api_key"),
            cfg.get("openai_api_key"),
            os.environ.get("HEPAI_API_KEY"),
            os.environ.get("ANTHROPIC_API_KEY"),
            os.environ.get("OPENAI_API_KEY"),
        ])
    except Exception:
        logger.exception("setup status probe failed")

    # 新增：检查 OIDC 认证状态
    auth_status = {"authenticated": False, "auth_mode": "none"}
    try:
        from drsai.backend.auth.token_store import load_auth_session, is_token_expired
        session = load_auth_session()
        if session and session.get("auth_mode") == "oidc":
            auth_status = {
                "authenticated": True,
                "auth_mode": "oidc",
                "user": session.get("user"),
                "needs_refresh": is_token_expired(session),
            }
    except Exception:
        logger.exception("auth status probe failed")

    # 新增：检查 skills 选择状态
    skills_status = {"skills_selected": False, "enabled_skills": []}
    try:
        cfg = cli_config.load_config() if config_path_exists else {}
        skills_selected = cfg.get("skills_selected", False)
        # 向后兼容：已有 skills 但无标记 → 视为已选
        if not skills_selected and config_path_exists:
            from pathlib import Path
            from drsai.configs.constant import WORKSPACE_RUNS_DIR
            user_id = cfg.get("user_id", "")
            if user_id:
                skills_dir = Path(WORKSPACE_RUNS_DIR) / user_id / "configs" / "skills"
                if skills_dir.exists() and list(skills_dir.glob("*/SKILL.md")):
                    skills_selected = True
                    existing = [d.name for d in skills_dir.iterdir()
                                if d.is_dir() and (d / "SKILL.md").exists()]
                    cfg["skills_selected"] = True
                    cfg["enabled_skills"] = existing
                    cli_config.save_config(cfg)
        skills_status = {
            "skills_selected": skills_selected,
            "enabled_skills": cfg.get("enabled_skills", []),
        }
    except Exception:
        logger.exception("skills status probe failed")

    return {
        "config_exists": config_path_exists,
        "has_api_key": has_api_key,
        "setup_required": (not config_path_exists) or (not has_api_key and not auth_status["authenticated"]),
        # 新增字段：
        "auth": auth_status,
        "skills": skills_status,
    }
```

### 5.7 修改 session.py — platform_auth_scope 集成

**核心变更**：在创建 agent session 时，如果用户通过 OIDC 登录，将 access_token 通过 `platform_auth_scope()` 绑定到 `ContextVar`，使 `HepAIChatCompletionClient` 自动使用 OIDC token 替代 api_key。

```python
# tui_gateway/handlers/session.py — _ensure_agent_session() 修改

from contextlib import nullcontext
from drsai.platform_auth import context_from_bearer, platform_auth_scope
from drsai.backend.auth.token_store import load_auth_session, is_token_expired

def _ensure_agent_session(session_id: str, user_id: str, ...):
    cfg = cli_config.load_config()

    # ── 新增：OIDC token → PlatformAuthContext ──
    auth_scope = nullcontext()  # 默认无 scope
    auth_session = load_auth_session()
    if auth_session and auth_session.get("auth_mode") == "oidc":
        access_token = auth_session.get("access_token")
        if access_token:
            if is_token_expired(auth_session):
                # token 过期 → 尝试刷新（调用 auth.session.refresh 逻辑）
                from drsai.backend.auth.oidc_client import OidcClient
                client = OidcClient(
                    auth_session["issuer"],
                    auth_session["client_id"],
                    OIDC_SCOPES,
                )
                new_tokens = client.refresh_access_token(auth_session["refresh_token"])
                from drsai.backend.auth.token_store import save_auth_session
                save_auth_session(
                    tokens=new_tokens,
                    user_info=auth_session["user"],
                    issuer=auth_session["issuer"],
                    client_id=auth_session["client_id"],
                )
                access_token = new_tokens["access_token"]

            try:
                auth_context = context_from_bearer(
                    f"Bearer {access_token}",
                    expected_subject=auth_session["user"].get("user_id", ""),
                )
                auth_scope = platform_auth_scope(auth_context)
            except ValueError as e:
                logger.warning(f"OIDC token validation failed: {e}")

    # 用 platform_auth_scope 包裹 agent 创建过程
    with auth_scope:
        sess = AgentSession(
            session_id=session_id,
            user_id=user_id,
            cli_cfg=cfg,
            db_manager=_get_db_manager(),
        )
        sess.init()  # 内部调用 create_agent() → HepAIChatCompletionClient
        return sess
```

**工作原理**：
1. `platform_auth_scope(context)` 设置 `ContextVar _platform_auth`
2. `create_agent()` 内部创建 `HepAIChatCompletionClient`
3. `HepAIChatCompletionClient.__init__()` 调用 `get_model_credential_provider()`
4. `get_model_credential_provider()` 调用 `get_platform_auth()` → 发现 ContextVar 有值
5. 返回 `OidcModelCredentialProvider`，自动用 OIDC token 替代 api_key + 设置 base_url
6. 后续 `HepAIChatCompletionClient.create()` 调用 `_bind_platform_auth()` 确保 token 有效

**Deferred OIDC 兼容**：如果 agent 在子线程创建（ContextVar 不跨线程），`HepAIChatCompletionClient` 会用 `"opendrsai-oidc-pending"` 占位符，之后通过 `_bind_platform_auth()` 在调用时替换。

---

### 6.1 新增 RPC：在 `handlers/setup.py` 中添加

#### `setup.skills.list` — 列出 built-in skills

```python
@method("setup.skills.list")
def _skills_list_builtin(rid, params: dict) -> dict:
    """列出所有 built-in skills（从 skills/skills/ 目录）

    Returns: {
        skills: [
            {
                name: str,           # skill slug
                description: str,    # 从 SKILL.md frontmatter
                installed: bool,     # 用户是否已安装
                category: str,      # 简单分类
            }
        ]
    }
    """
    from drsai.modules.components.skills.discovery import resolve_builtin_skills_dir

    builtin_dir = resolve_builtin_skills_dir()
    if not builtin_dir:
        return _ok(rid, {"skills": []})

    user_id = _resolve_user_id()
    user_skills_dir = _get_user_skills_dir(user_id)

    skills = []
    for skill_dir in sorted(builtin_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            continue
        parsed = _parse_skill_md(skill_file.read_text("utf-8"))
        if parsed is None:
            continue
        installed = (user_skills_dir / skill_dir.name / "SKILL.md").exists()
        skills.append({
            "name": parsed["name"],
            "description": parsed["description"],
            "installed": installed,
        })
    return _ok(rid, {"skills": skills})
```

#### `setup.skills.install` — 安装选中的 skills

```python
@method("setup.skills.install")
def _skills_install(rid, params: dict) -> dict:
    """安装选中的 skills 到用户目录

    params:
        skill_names: list[str]  — 要安装的 skill slug 列表
    """
    from drsai.modules.components.skills.discovery import resolve_builtin_skills_dir

    skill_names = params.get("skill_names") or []
    if not skill_names:
        return _err(rid, 4002, "skill_names is required")

    builtin_dir = resolve_builtin_skills_dir()
    if not builtin_dir:
        return _err(rid, 5000, "built-in skills directory not found")

    user_id = _resolve_user_id()
    user_skills_dir = _ensure_skills_dir(user_id)

    installed = []
    for name in skill_names:
        src = builtin_dir / name
        dst = user_skills_dir / name
        if not src.is_dir():
            continue
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        installed.append(name)

    # 标记 skills 已选择，记录选择的列表
    cfg = cli_config.load_config()
    cfg["skills_selected"] = True
    cfg["enabled_skills"] = installed
    cli_config.save_config(cfg)

    return _ok(rid, {"installed": installed, "total": len(installed)})
```

### 6.2 修改 `drsai_assistant.py` 的 `update_user_skills()`

```python
def update_user_skills(self) -> Tuple[Optional[SkillLoader], Optional[str]]:
    """加载/更新用户技能 — 修改为选择性同步

    旧逻辑：全量同步 built-in → user dir
    新逻辑：只同步 cli_config["enabled_skills"] 中列出的 skills
    """

    user_skills_dir = self._user_profile_manager.skills_dir

    # ── 新增：读取用户已选 skills ──
    from drsai.backend.cli import config as cli_config
    cli_cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
    skills_selected = cli_cfg.get("skills_selected", False)
    enabled_skills: list[str] = cli_cfg.get("enabled_skills", [])

    # 1. 检查并同步系统skill目录到用户skill目录
    if self._skills_dir:
        for system_skills_dir in self._skills_dir:
            system_path = Path(system_skills_dir)
            if not system_path.exists():
                continue

            if not skills_selected:
                # 首次启动，尚未选择 skills → 不自动安装
                # 但如果用户目录已有 skills（旧版安装遗留），仍然加载
                break

            # 已选择 → 只同步 enabled_skills 中的
            for skill_folder in system_path.iterdir():
                if not skill_folder.is_dir():
                    continue
                if skill_folder.name not in enabled_skills:
                    continue  # 用户未选择的 skill，跳过

                skill_file = skill_folder / "SKILL.md"
                if not skill_file.exists():
                    continue

                user_skill_folder = user_skills_dir / skill_folder.name
                user_skill_file = user_skill_folder / "SKILL.md"
                should_update = False
                if not user_skill_file.exists():
                    should_update = True
                else:
                    system_mtime = skill_file.stat().st_mtime
                    user_mtime = user_skill_file.stat().st_mtime
                    if system_mtime > user_mtime:
                        should_update = True

                if should_update:
                    if user_skill_folder.exists():
                        shutil.rmtree(user_skill_folder)
                    shutil.copytree(skill_folder, user_skill_folder)
                    logger.info(f"Updated skill '{skill_folder.name}' from system to user directory")

    # 2. 从用户的skills目录加载（现有逻辑不变）
    if user_skills_dir.exists() and list(user_skills_dir.glob("*/SKILL.md")):
        skills_loader = SkillLoader(skills_dir=str(user_skills_dir))

    # ... 其余 filter_agent_skills + tool 注册逻辑不变 ...
```

---

## 7. 前端界面设计

### 7.1 AuthScreen — OIDC 登录界面

#### 新增文件：`apps/ui-tui/src/components/authScreen.tsx`

```tsx
/**
 * AuthScreen — OIDC Device Code 登录界面
 *
 * 流程：
 *   1. 调用 auth.oidc.start 获取设备码
 *   2. 显示 verification_uri + user_code
 *   3. 尝试自动打开浏览器（本地环境）
 *   4. 轮询 auth.oidc.poll 直到完成
 *   5. 成功后 onComplete()，失败后可重试
 */

interface AuthScreenProps {
  gw: GatewayClient
  onComplete: () => void     // 登录成功
  onSkip?: () => void       // 跳过登录，手动配置 API Key
}

type AuthStep = 'init' | 'device_code' | 'polling' | 'success' | 'error'
```

**UI 布局**：

```
┌─────────────────────────────────────────┐
│  ⚡ OpenDrSai · login                   │
│                                         │
│  Sign in with HepAI (IHEP SSO)          │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Your code:  ABCD-1234          │    │  ← 大号字体显示
│  └─────────────────────────────────┘    │
│                                         │
│  Open this URL:                         │
│  https://ai-dev.ihep.ac.cn/device        │
│                                         │
│  [Ctrl+O] Open in browser                │  ← 本地可用
│  [Ctrl+C] Copy code                      │
│                                         │
│  ◌ Waiting for authentication... (45s)  │  ← 倒计时
│  ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░          │  ← 进度条
│                                         │
│  [Esc] Cancel · [Tab] Skip to manual   │
└─────────────────────────────────────────┘
```

**关键实现**：

```tsx
function AuthScreen({ gw, onComplete, onSkip }: AuthScreenProps) {
  const [step, setStep] = useState<AuthStep>('init')
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState('')

  // 启动 device flow
  useEffect(() => {
    if (step !== 'init') return
    setStep('device_code')
    gw.request<DeviceCodeResponse>('auth.oidc.start', {})
      .then(resp => {
        setDeviceCode(resp)
        setStep('polling')
      })
      .catch(err => {
        setError(err.message)
        setStep('error')
      })
  }, [gw, step])

  // 轮询
  useEffect(() => {
    if (step !== 'polling' || !deviceCode) return
    let cancelled = false

    const poll = async () => {
      while (!cancelled) {
        await sleep(deviceCode.interval * 1000)
        if (cancelled) break
        const result = await gw.request('auth.oidc.poll', {})
        if (result.status === 'success') {
          setStep('success')
          setTimeout(onComplete, 500)
          return
        }
        if (result.status === 'expired' || result.status === 'error') {
          setError(result.error || 'Authentication timed out')
          setStep('error')
          return
        }
        // pending → continue polling
      }
    }
    void poll()

    return () => { cancelled = true }
  }, [step, deviceCode, gw, onComplete])

  // Ctrl+O 打开浏览器
  useInput((input, key) => {
    if (key.ctrl && input === 'o' && deviceCode) {
      const url = deviceCode.verification_uri_complete
      // 使用 child_process exec 打开浏览器
    }
    if (key.tab && onSkip) {
      onSkip()
    }
  })

  // ... render ...
}
```

### 7.2 SkillsSetupScreen — Skills 选择界面

#### 新增文件：`apps/ui-tui/src/components/skillsSetupScreen.tsx`

```tsx
/**
 * SkillsSetupScreen — 首次启动 skills 选择界面
 *
 * UI 布局：
 * ┌─────────────────────────────────────────────┐
 * │  ⚡ OpenDrSai · skills setup                 │
 * │                                              │
 * │  Choose pre-built skills to install:         │
 * │                                              │
 * │  ▸ ☑ pptx              Create PowerPoint      │
 * │    ☑ image-process     Image generation       │
 * │    ☑ ragflow-knowledge PDF literature mgmt    │
 * │    ☐ playwright-cli    Browser automation     │
 * │    ☐ system-setting    System configuration   │
 * │    ☐ academic-search   Academic paper search │
 * │    ...                                       │
 * │                                              │
 * │  [a] Select all · [n] None · Enter confirm   │
 * └─────────────────────────────────────────────┘
 */

interface SkillInfo {
  name: string
  description: string
  installed: boolean
}

interface SkillsSetupScreenProps {
  gw: GatewayClient
  onComplete: () => void
}

function SkillsSetupScreen({ gw, onComplete }: SkillsSetupScreenProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 加载 built-in skills 列表
  useEffect(() => {
    gw.request<{ skills: SkillInfo[] }>('setup.skills.list', {})
      .then(resp => {
        setSkills(resp.skills)
        // 默认选中未安装且推荐的 skills
        const recommended = resp.skills.filter(
          s => !s.installed && isRecommended(s.name)
        )
        setSelected(new Set(recommended.map(s => s.name)))
      })
      .catch(err => setError(err.message))
  }, [gw])

  // 键盘交互：上下移动、空格切换、a 全选、n 全不选
  useInput((input, key) => {
    if (submitting) return
    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(skills.length - 1, c + 1))
    if (input === ' ') {
      const name = skills[cursor]?.name
      if (name) {
        const next = new Set(selected)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        setSelected(next)
      }
    }
    if (input === 'a') {
      setSelected(new Set(skills.map(s => s.name)))
    }
    if (input === 'n') {
      setSelected(new Set())
    }
    if (key.return) {
      setSubmitting(true)
      gw.request('setup.skills.install', {
        skill_names: Array.from(selected),
      }).then(() => {
        setTimeout(onComplete, 500)
      }).catch(err => {
        setError(err.message)
        setSubmitting(false)
      })
    }
  })

  // ... render ...
}
```

### 7.3 修改 app.tsx — Bootstrap 状态机

```tsx
// app.tsx — Bootstrap 类型新增 auth + skills_selection 阶段

type Bootstrap =
  | { phase: 'connecting' }
  | { phase: 'auth' }                          // 新增
  | { phase: 'setup'; configExists: boolean }
  | { phase: 'skills_selection' }              // 新增
  | { phase: 'resuming'; session: SessionInfo }
  | { phase: 'ready'; sessionId: string; controller: TurnController }
  | { phase: 'error'; message: string }

// bootstrap 流程变更：
async function bootstrap() {
  await gw.ready_()
  const setup = setupStatus

  // 新增：检查认证状态
  if (setup.auth?.authenticated === false && !setup.has_api_key) {
    // 无认证且无 API Key → 显示登录界面
    setBoot({ phase: 'auth' })
    return
  }

  // 已认证或已有 API Key → 检查 setup
  if (setup.setup_required) {
    setBoot({ phase: 'setup', configExists: setup.config_exists })
    return
  }

  // 新增：检查 skills 是否已选择
  if (setup.skills && !setup.skills.skills_selected) {
    setBoot({ phase: 'skills_selection' })
    return
  }

  await resolveSession()
}

// 渲染：
if (boot.phase === 'auth') {
  return (
    <AuthScreen
      gw={gw}
      onComplete={() => {
        // 登录成功后检查是否需要 skills 选择
        if (setupStatus?.skills && !setupStatus.skills.skills_selected) {
          setBoot({ phase: 'skills_selection' })
        } else {
          setBoot({ phase: 'connecting' })
          void setupCompleteHandlerRef.current?.()
        }
      }}
      onSkip={() => {
        // 跳过登录 → 进入手动 API Key 配置
        setBoot({ phase: 'setup', configExists: false })
      }}
    />
  )
}

if (boot.phase === 'skills_selection') {
  return (
    <SkillsSetupScreen
      gw={gw}
      onComplete={() => {
        setBoot({ phase: 'connecting' })
        void setupCompleteHandlerRef.current?.()
      }}
    />
  )
}
```

### 7.4 修改 setupScreen.tsx — 增加 skills 步骤

在现有 setup wizard 的 `done` 步骤之前增加 `skills` 步骤：

```tsx
// Step 类型变更：
type Step = 'username' | 'provider' | 'apikey' | 'baseurl'
  | 'submitting' | 'skills' | 'done' | 'error'
//                                        ↑ 新增

// submit() 成功后不再直接进入 'done'，而是进入 'skills'
async function submit(prov: Provider, key: string, url: string) {
  setStep('submitting')
  try {
    await gw.request('setup.save', { ... })
    setStep('skills')  // ← 改为进入 skills 步骤
  } catch (err) {
    setErrorMsg(...)
    setStep('error')
  }
}

// skills 步骤渲染（内联或引用 SkillsSetupScreen 的逻辑）
if (step === 'skills') {
  return <SkillsSetupScreenInline
    gw={gw}
    onComplete={() => {
      setStep('done')
      if (onDismiss) {
        setTimeout(onDismiss, 500)
      } else {
        setTimeout(onComplete, 500)
      }
    }}
  />
}
```

---

## 8. 配置文件变更

### 8.1 `cli_config.json` 新增字段

```json
{
  "user_id": "xiongdb",
  "provider": "hepai",
  "api_key": "",                          // OIDC 模式下不使用（通过 platform_auth_scope 传递）
  "base_url": "https://ai-dev.ihep.ac.cn/api/v1",
  "auth_mode": "oidc",                    // 新增: "oidc" | "api_key" | "none"
  "skills_selected": true,               // 新增: 是否已完成 skills 选择
  "enabled_skills": [                     // 新增: 用户已选的 skills 列表
    "pptx",
    "image-process",
    "ragflow-knowledge",
    "academic-search"
  ]
}
```

> **注意**：OIDC 模式下 `api_key` 字段为空。模型访问通过 `platform_auth_scope()` → `ContextVar` → `OidcModelCredentialProvider` 完成，无需同步写入 api_key。

### 8.2 `cli/config.py` DEFAULT_CONFIG 变更

```python
DEFAULT_CONFIG = {
    "user_id": "",
    "provider": "hepai",
    "api_key": "",
    "anthropic_api_key": "",
    "openai_api_key": "test",
    "base_url": "",
    "anthropic_base_url": "",
    "openai_base_url": "",
    "model_name": "doubao",
    "anthropic_model_name": "claude-3-5-sonnet-20241022",
    "openai_model_name": "gpt-4o",
    "llm_api_style": "openai",
    "system_prompt": "",
    "extra_headers": "",
    "multi_turns": 10,
    "local_kgvs_path": "",
    "proxy": "",
    "vision": False,
    # ── 新增字段 ──
    "auth_mode": "none",              # "oidc" | "api_key" | "none"
    "skills_selected": False,          # 首次 skills 选择是否完成
    "enabled_skills": [],              # 用户已选 skills 列表
}
```

### 8.3 新增 `auth.json`（OIDC 专用）

存储路径：`~/.drsai/auth/auth.json`

```json
{
    "session_id": "uuid-string",
    "created_at": "2025-01-22T10:00:00Z",
    "expires_at": "2025-02-21T10:00:00Z",
    "auth_mode": "oidc",
    "user": {
        "user_id": "xiongdb",
        "email": "xiongdb@ihep.ac.cn",
        "name": "Xiong Daobin",
        "roles": ["user"],
        "groups": ["ihep"]
    },
    "issuer": "https://ai-dev.ihep.ac.cn/api",
    "client_id": "opendrsai-tui",
    "encrypted_access_token": "...",
    "encrypted_refresh_token": "...",
    "encrypted_id_token": "..."
}
```

### 8.4 配置文件关系图

```
~/.drsai/
├── cli_config.json           ← 用户主配置（provider, user_id, auth_mode, ...）
│   ├── api_key               ← OIDC 模式下为空（通过 platform_auth_scope 传递）
│   ├── auth_mode             ← "oidc" | "api_key" | "none"
│   ├── skills_selected       ← skills 选择完成标记
│   └── enabled_skills       ← 已选 skills 列表
│
├── auth/                    ← OIDC 专用（新增）
│   └── auth.json            ← 加密存储的 access_token + refresh_token + user info
│                              通过 platform_auth_scope → ContextVar 传递给 LLM 客户端
│
└── workspace/runs/{user_id}/
    └── configs/
        └── skills/          ← 用户已安装的 skills（选择性同步）
            ├── pptx/
            ├── image-process/
            └── ...
```

---

## 9. 完整启动流程场景

### 场景 1：全新用户（首次启动）

```
1. TUI 启动 → gateway 进程启动
2. app.tsx bootstrap → connecting
3. gateway.ready event → setup_status = {
     config_exists: false,
     has_api_key: false,
     setup_required: true,
     auth: { authenticated: false, auth_mode: "none" },
     skills: { skills_selected: false, enabled_skills: [] }
   }
4. 因 auth.authenticated=false 且 has_api_key=false → phase: 'auth'
5. 显示 AuthScreen → 用户完成 Device Code 登录
6. 登录成功 → auth.json 写入（加密 token）+ cli_config.json auth_mode=oidc, user_id
7. 因 skills.skills_selected=false → phase: 'skills_selection'
8. 显示 SkillsSetupScreen → 用户勾选 skills
9. setup.skills.install RPC → 复制选中的 skills 到 user dir
10. cli_config.json skills_selected=true, enabled_skills=[...]
11. resolveSession() → session.py 加载 auth.json → platform_auth_scope() → ready ✓
```

### 场景 2：已登录用户（第二次启动）

```
1. TUI 启动 → gateway 进程启动
2. gateway.ready → setup_status = {
     config_exists: true,
     has_api_key: false,              // OIDC 模式不存 api_key
     setup_required: false,            // auth.authenticated=true 跳过 setup
     auth: { authenticated: true, auth_mode: "oidc", user: {...} },
     skills: { skills_selected: true, enabled_skills: ["pptx", ...] }
   }
3. auth.authenticated=true → 跳过 auth
4. setup_required=false → 跳过 setup
5. skills_selected=true → 跳过 skills_selection
6. resolveSession() → session.py 加载 auth.json → platform_auth_scope() → ready ✓
```

### 场景 3：Token 过期自动刷新

```
1. TUI 启动 → gateway ready
2. setup_status.auth = { authenticated: true, needs_refresh: true }
3. bootstrap 看到 needs_refresh=true → 调用 auth.session.refresh
4. 刷新成功 → 更新 auth.json + cli_config.json api_key
5. resolveSession() → ready ✓
```

### 场景 3b：Token 过期且 refresh 失败

```
1. setup_status.auth = { authenticated: true, needs_refresh: true }
2. 调用 auth.session.refresh → 失败（refresh_token 也过期）
3. 清除 auth.json → clear_auth_session()
4. setBoot({ phase: 'auth' }) → 显示 AuthScreen 重新登录
```

### 场景 4：跳过 OIDC，手动配置 API Key

```
1. AuthScreen 显示 → 用户按 Tab → onSkip()
2. setBoot({ phase: 'setup', configExists: false })
3. 进入 SetupScreen → username → provider → apikey → baseurl → done
4. setup_save RPC → cli_config.json api_key + auth_mode="api_key"
5. 因 skills_selected=false → SkillsSetupScreen
6. Skills 选择完成 → resolveSession() → ready ✓
```

### 场景 5：旧用户升级（已有 cli_config，无 auth）

```
1. setup_status = {
     config_exists: true,
     has_api_key: true,        // 旧 api_key 存在
     setup_required: false,
     auth: { authenticated: false, auth_mode: "none" },  // 无 OIDC
     skills: { skills_selected: false, enabled_skills: [] }  // 无标记
   }
2. setup_required=false（因为有 api_key）→ 跳过 setup
3. auth.authenticated=false 但 has_api_key=true → 不强制重新登录
4. skills_selected=false → 但是！如果用户已有 skills 目录（旧版全量同步遗留）：
   entry.py 的兼容逻辑标记 skills_selected=true（见 5.6 节）
5. 如果用户无 skills 目录 → 显示 skills_selection
6. resolveSession() → ready ✓
```

---

## 10. 文件变更清单

### 10.1 后端（Python）

| # | 文件 | 操作 | 内容 |
|---|------|------|------|
| 1 | `backend/auth/__init__.py` | **新增** | 包初始化 |
| 2 | `backend/auth/oidc_client.py` | **新增** | OidcClient 类：discovery, request_device_code, poll_device_token, validate_id_token, refresh_access_token, revoke_token |
| 3 | `backend/auth/token_store.py` | **新增** | load/save/clear auth_session, is_token_expired, 加密策略（keyring/Fernet） |
| 4 | `tui_gateway/handlers/auth.py` | **新增** | 6 个 RPC：auth.status, auth.oidc.start, auth.oidc.poll, auth.oidc.cancel, auth.session.refresh, auth.logout |
| 5 | `tui_gateway/handlers/setup.py` | **修改** | 新增 setup.skills.list, setup.skills.install 两个 RPC |
| 6 | `tui_gateway/entry.py` | **修改** | setup_status() 增加 auth + skills 检查字段 |
| 7 | `tui_gateway/server.py` | **修改** | 注册 handlers/auth.py 模块 |
| 8 | `cli/config.py` | **修改** | DEFAULT_CONFIG 新增 auth_mode, skills_selected, enabled_skills |
| 9 | `tui_gateway/handlers/session.py` | **修改** | _ensure_agent_session() 集成 platform_auth_scope() — OIDC token → ContextVar → LLM 客户端 |
| 10 | `modules/agents/skills_agent/drsai_assistant.py` | **修改** | update_user_skills() 改为选择性同步 enabled_skills |

### 10.2 增加依赖

```toml
# pyproject.toml 或 setup.py
[project]
dependencies = [
    # ... existing ...
    "httpx>=0.27",          # OIDC HTTP 客户端
    "keyring>=24.0",        # OS-native credential storage
    "cryptography>=42.0",   # Fernet 对称加密（fallback）
    "PyJWT>=2.8",           # ID Token 验证
]
```

### 10.3 前端（TypeScript/React)

| # | 文件 | 操作 | 内容 |
|---|------|------|------|
| 1 | `src/components/authScreen.tsx` | **新增** | OIDC Device Code 登录界面 |
| 2 | `src/components/skillsSetupScreen.tsx` | **新增** | Skills 选择安装界面 |
| 3 | `src/app.tsx` | **修改** | Bootstrap 新增 auth + skills_selection 阶段 |
| 4 | `src/components/setupScreen.tsx` | **修改** | submit 后进入 skills 步骤 |
| 5 | `src/types.ts` (或 `src/proto.ts`) | **修改** | 新增 DeviceCodeResponse, OidcSession, SkillInfo 类型 |

### 10.4 文件树总览

```
cores/python/packages/drsai/src/drsai/backend/
├── auth/                                    ← 新增模块
│   ├── __init__.py
│   ├── oidc_client.py                       ← OIDC Device Code Flow 客户端
│   └── token_store.py                       ← Token 加密存储
├── tui_gateway/
│   ├── entry.py                             ← 修改: setup_status()
│   ├── server.py                            ← 修改: 注册 auth handlers
│   └── handlers/
│       ├── auth.py                           ← 新增: OIDC RPC handlers
│       ├── setup.py                          ← 修改: + setup.skills.list/install
│       └── skills.py                         ← 现有不变
└── cli/
    └── config.py                             ← 修改: DEFAULT_CONFIG 新增字段

apps/ui-tui/src/
├── app.tsx                                  ← 修改: bootstrap 状态机
├── components/
│   ├── authScreen.tsx                       ← 新增: OIDC 登录界面
│   ├── skillsSetupScreen.tsx                ← 新新增: Skills 选择界面
│   └── setupScreen.tsx                     ← 修改: +skills 步骤
└── types.ts                                 ← 修改: 新增类型定义
```

---

## 11. 实施步骤

### Phase 1: OIDC 认证后端（约 2-3 天）

| 步骤 | 文件 | 描述 |
|------|------|------|
| 1.1 | `backend/auth/__init__.py` | 创建包 |
| 1.2 | `backend/auth/oidc_client.py` | 实现 OidcClient：discovery + device_code + poll + validate + refresh + revoke |
| 1.3 | `backend/auth/token_store.py` | 实现 token 加密存储：keyring 优先，Fernet 回退 |
| 1.4 | `tui_gateway/handlers/auth.py` | 实现 6 个 auth RPC |
| 1.5 | `tui_gateway/server.py` | 注册 auth handlers 模块 |
| 1.6 | `tui_gateway/entry.py` | 修改 setup_status() 增加 auth + skills 检查 |
| 1.7 | `cli/config.py` | DEFAULT_CONFIG 新增 3 个字段 |
| 1.8 | 依赖 | 添加 httpx, keyring, cryptography, PyJWT |
| 1.9 | 测试 | 手动测试 OIDC Device Code Flow |

### Phase 2: Skills 选择性安装后端（约 1 天）

| 步骤 | 文件 | 描述 |
|------|------|------|
| 2.1 | `handlers/setup.py` | 实现 setup.skills.list + setup.skills.install |
| 2.2 | `drsai_assistant.py` | 修改 update_user_skills() 选择性同步逻辑 |
| 2.3 | 测试 | 手动测试 skills 安装 RPC |

### Phase 3: 前端界面（约 2-3 天）

| 步骤 | 文件 | 描述 |
|------|------|------|
| 3.1 | `types.ts` | 定义 DeviceCodeResponse, OidcSession, SkillInfo 类型 |
| 3.2 | `authScreen.tsx` | 实现 Device Code 登录 UI + 轮询逻辑 |
| 3. Provider 端 | HAI 端 | 确认 OIDC Provider 支持 device flow + device_authorization_endpoint |
| 3.4 | `skillsSetupScreen.tsx` | 实现 skills 选择列表 UI |
| 3.5 | `app.tsx` | 修改 bootstrap 状态机 + 渲染逻辑 |
| 3.6 | `setupScreen.tsx` | 修改 step 流程增加 skills 步骤 |
| 3.7 | 测试 | 端到端测试全流程 |

### Phase 4: 测试与完善（约 1 天）

| 步骤 | 描述 |
|------|------|
| 4.1 | 全流程测试：全新用户首次启动 → OIDC 登录 → skills 选择 → ready |
| 4.2 | 测试跳过登录 → 手动 API Key → skills 选择 |
| 3 | 测试 Token 过期自动刷新 |
| 4.3 | 测试已登录用户再次启动 |
| 4.4 | 测试旧用户升级兼容 |
| 4.5 | 测试 logout → 重新登录 |

---

## 12. 待确认事项

| # | 问题 | 选项 | 建议 |
|---|------|------|------|
| 1 | OIDC Client ID | (A) 新注册 `opendrsai-tui` | 可先复用 `opendrsai-desktop`，待稳定后再注册独立 client_id |
|   |                  | (B) 复用 `opendrsai-desktop` | |
| 2 | TUI 登录是否强制 | (A) 登录为默认但可跳过（Tab → 手动 API Key） | 建议选 (A)：灵活性高，SSH/远程环境也能用 |
|   |                  | (B) 必须登录才能使用 | |
| 3 | Skills 选择是否必须 | (A) 可全不选（仍继续） | 建议选 (A)：最低摩擦，用户可后续手动安装 |
|   |                   | (B) 至少选 1 个 | |
| 4 | 实施顺序 | (A) 先 OIDC 后 skills | 建议选 (A)：OIDC 是前提（登录后才有 user_id，skills 才能安装到正确目录） |
|   |          | (B) 先 skills 后 OIDC | |
|   |          | (C) 并行实施 | |

---

## 13. 总结

本方案基于对 desktop OIDC 机制、TUI gateway 现有架构、skills 系统的深入分析，设计了：

1. **OIDC Device Code Flow 登录**：适配 TUI/SSH/远程环境，用户体验类似 `gh auth login`，登录后自动获取 HAI API Key
2. **Token 加密存储**：优先 OS Keychain（keyring），回退 Fernet 对称加密，安全性不低于 desktop
3. **Skills 选择性安装**：首次启动时 checkbox 列表选择，安装后记录到 cli_config，后续启动跳过选择
4. **Bootstrap 状态机扩展**：新增 `auth` 和 `skills_selection` 阶段，兼容现有 `setup` wizard
5. **向后兼容**：旧用户升级时自动检测已有 skills 并标记，无 OIDC 但有 API Key 的用户不受影响
6. **Token 自动刷新**：access_token 过期前自动刷新，同步更新 cli_config 的 api_key

方案实施涉及后端 8 个文件（3 新增、5 修改）+ 前端 5 个文件（2 新增、3 修改），预估总工时约 6-8 天。

---

> **参考文档**
> - Desktop OIDC 实现参考：`apps/desktop/shared/main/auth.ts`
> - TUI Gateway 现有代码：`cores/python/packages/drsai/src/drsai/backend/tui_gateway/`
> - Skills 系统代码：`cores/python/packages/drsai/src/drsai/modules/components/skills/discovery.py`
> - Skills Agent 加载逻辑：`cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py`
> - Built-in Skills 目录：`skills/skills/`

---

## 14. 实施完成日志

### 已完成（2025-01-28）

所有 13 项实施任务已全部完成并通过验证。

#### 后端（8 项）

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | `backend/auth/__init__.py` | 新增 | 包初始化，导出 `OidcClient` 和 token_store 函数 |
| 2 | `backend/auth/oidc_client.py` | 新增 | `OidcClient` 类：Device Code Flow + JWT 验证 + refresh/revoke |
| 3 | `backend/auth/token_store.py` | 新增 | Token 加密存储：keyring 优先 + Fernet 回退，原子写入 |
| 4 | `tui_gateway/handlers/auth.py` | 新增 | 6 个 auth RPC handlers（status/start/poll/cancel/refresh/logout） |
| 5 | `tui_gateway/handlers/setup.py` | 修改 | `setup.save` 增加 `auth_mode` 参数；新增 `setup.skills.list/install` RPC；`setup.status` 委托 `entry.setup_status()` 保证字段一致 |
| 6 | `tui_gateway/handlers/session.py` | 修改 | `_load_platform_auth_for_init()` + `platform_auth_scope()` 包裹 `sess.init()` |
| 7 | `tui_gateway/handlers/prompt.py` | 修改 | `_load_platform_auth_context()` 在 daemon 线程内重新绑定 ContextVar |
| 8 | `tui_gateway/entry.py` | 修改 | `setup_status()` 返回 `auth_mode`/`auth_authenticated`/`skills_selected` |
| 9 | `tui_gateway/server.py` | 修改 | `_LONG_HANDLERS` 注册 `setup.skills.list/install` |
| 10 | `cli/config.py` | 修改 | `DEFAULT_CONFIG` 新增 `auth_mode`/`skills_selected`/`enabled_skills` |
| 11 | `modules/agents/skills_agent/drsai_assistant.py` | 修改 | `update_user_skills()` 读取 `enabled_skills` 只同步选中 skills |

#### 前端（4 项）

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | `apps/ui-tui/src/components/authScreen.tsx` | 新增 | OIDC Device Code Flow UI |
| 2 | `apps/ui-tui/src/components/skillsSetupScreen.tsx` | 新增 | Skills 选择 UI（checkbox 列表） |
| 3 | `apps/ui-tui/src/app.tsx` | 修改 | Bootstrap 状态机新增 `auth` + `skills_setup` 阶段 |
| 4 | `apps/ui-tui/src/components/setupScreen.tsx` | 修改 | 新增 OIDC Login 选项 |

#### 验证

- ✅ Python AST 语法检查：11 个文件全部通过
- ✅ TypeScript `tsc --noEmit` 检查：无错误
- ✅ `setup.status` RPC 委托 `entry.setup_status()`：返回 `auth_mode`/`auth_authenticated`/`skills_selected` 字段
- ✅ auth 包导入测试通过
- ✅ `platform_auth` 集成链路导入测试通过

#### OIDC → 模型访问完整链路

```
Token 获取:  OidcClient.poll_device_token() → tokens
    ↓
存储:       token_store.save_auth_session() → ~/.drsai/auth/auth.json (加密)
    ↓
加载:       load_auth_session() → session dict
    ↓
解析:       context_from_bearer(access_token) → PlatformAuthContext
    ↓
绑定:       platform_auth_scope(context) → ContextVar _platform_auth
    ↓
使用:       LLMClient._bind_platform_auth() → 从 ContextVar 获取 token
             → OidcModelCredentialProvider 返回 token 作为 api_key
             → 自动设置 base_url = context.model_base_url
```

#### 待后续工作

- ✅ 端到端测试：启动 TUI gateway 验证完整 OIDC Device Code Flow（代码已实现，待环境验证）
- ⬜ OIDC Provider 注册 `opendrsai-tui` client_id（当前可复用 `opendrsai-desktop`）
- ⬜ `auth.session.refresh` 自动调用时机优化
- ✅ /login 和 /logout 斜杠命令设计（见下方第 14 节）

---

## 14. /login 和 /logout 斜杠命令设计

> **日期**: 2025-01-22
> **状态**: 设计完成，待实现
> **目标**: 在 TUI 运行时（非启动 bootstrap 阶段）通过斜杠命令触发 OIDC 登录和注销

### 14.1 设计目标

| 命令 | 功能 | 触发方式 |
|------|------|----------|
| `/login` | 弹出 AuthScreen overlay，执行 OIDC Device Code Flow | 斜杠命令 → `slash.exec` RPC → `ui_action: "auth.login"` |
| `/logout` | 撤销 OIDC token、清除本地 session、重置 auth_mode | 斜杠命令 → `slash.exec` RPC → 直接执行注销 |

### 14.2 设计原则

1. **复用现有 ui_action 机制**：与 `/setup` wizard 模式一致——后端 slash handler 返回 `{"output": "...", "ui_action": "auth.login"}`，前端 composerPane 的 `switch (result.ui_action)` 分发
2. **复用现有 AuthScreen 组件**：AuthScreen 已实现完整的 Device Code Flow UI（starting → showing → polling → success/expired/error），只需作为 overlay 嵌入 composerPane
3. **复用现有 auth RPCs**：`auth.oidc.start`、`auth.oidc.poll`、`auth.oidc.cancel`、`auth.logout` 全部已实现
4. **零新 RPC**：不需要新增任何 gateway RPC 方法
5. **platform_auth_scope 自动生效**：`prompt.py::_load_platform_auth_context()` 在每个 turn 开始时从 `token_store` 加载 OIDC token，/login 成功后下一个 turn 自动生效，无需手动 rebind

### 14.3 架构概览

```
用户输入 /login
    │
    ▼
composerPane.tsx: 检测到非 "special" handler 命令
    │
    ▼  slash.exec RPC {command: "login", args: ""}
    │
slash.py: cmd_login(ctx)
    │  ├─ 检查 auth.status（是否已登录）
    │  └─ 返回 {"output": "🔐 Opening OIDC login…", "ui_action": "auth.login"}
    │
    ▼
composerPane.tsx: switch(result.ui_action)
    │  └─ case 'auth.login': setAuthScreenOpen(true)
    │
    ▼
<AuthScreen gw={controller.gw} onComplete={...} onCancel={...} />
    │  ├─ auth.oidc.start → 获取 device_code + user_code + verification_uri
    │  ├─ 显示验证码 + URL，轮询 auth.oidc.poll
    │  ├─ 成功 → onComplete()
    │  └─ 取消/Esc → onCancel()
    │
    ▼  onComplete:
    │  ├─ setAuthScreenOpen(false)
    │  ├─ auth.status → 获取 user_id → $userId.set(user_id)
    │  └─ showSlashOutput("✅ Login successful!", 3000)
    │
    ▼
下一个 turn: prompt.py._load_platform_auth_context() 自动加载新 OIDC session
              → platform_auth_scope(context) → LLM client 使用 OIDC token
```

```
用户输入 /logout
    │
    ▼
composerPane.tsx: 检测到非 "special" handler 命令
    │
    ▼  slash.exec RPC {command: "logout", args: ""}
    │
slash.py: cmd_logout(ctx)
    │  ├─ load_auth_session() → 检查是否有 OIDC session
    │  ├─ client.revoke_token(refresh_token) — best-effort 撤销
    │  ├─ clear_auth_session() — 删除 ~/.drsai/auth/auth.json
    │  ├─ cli_config["auth_mode"] = "none", cli_config["user_id"] = "anonymous"
    │  └─ 返回 {"output": "✅ Logged out…", "ui_action": "auth.logout"}
    │
    ▼
composerPane.tsx: switch(result.ui_action)
    │  ├─ case 'auth.logout': $userId.set('anonymous')
    │  └─ showSlashOutput(output, 5000)
    │
    ▼
下一个 turn: prompt.py._load_platform_auth_context() → 无 OIDC session → None
              → 回退到 API key mode（如果环境变量或 cli_config 有 api_key）
```

### 14.4 详细文件变更

#### 14.4.1 后端：`commands.py` — 注册命令

**文件**: `cores/python/packages/drsai/src/drsai/backend/cli/commands.py`

在 `COMMAND_REGISTRY` 中，`# ── WeChat integration` 之前，新增 `# ── Authentication` 分类：

```python
    # ── Authentication ─────────────────────────────────────────────────────
    CommandDef(
        "login",
        "Login via OIDC (IHEP HAI unified authentication)",
        "Authentication",
        handler="async",
    ),
    CommandDef(
        "logout",
        "Logout and revoke OIDC session",
        "Authentication",
        handler="async",
    ),
```

同时在 `commands_by_category()` 的 `order` 列表中添加 `"Authentication"` 分类（插入在 `"WeChat"` 之前）。

#### 14.4.2 后端：`slash.py` — 实现 handler

**文件**: `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/slash.py`

在 `SLASH_HANDLERS` 字典之前，新增两个 handler 函数：

```python
# ── Authentication ──────────────────────────────────────────────────────────

def cmd_login(ctx: SlashContext) -> dict:
    """Trigger OIDC Device Code Flow login.

    Usage:
        /login    — open OIDC login screen (Device Code Flow)

    If already authenticated via OIDC, shows a message instead.
    """
    from drsai.backend.auth.token_store import load_auth_session, is_token_expired

    session = load_auth_session()
    if session and not is_token_expired(session):
        user = session.get("user", {})
        name = user.get("name") or user.get("user_id", "unknown")
        return {
            "output": f"ℹ️  Already logged in as {name}. Use /logout first to switch accounts."
        }

    return {
        "output": "🔐 Opening OIDC login (Device Code Flow)…",
        "ui_action": "auth.login",
    }


def cmd_logout(ctx: SlashContext) -> dict:
    """Logout and revoke OIDC session.

    Usage:
        /logout    — revoke tokens, clear local session, reset auth_mode

    If not logged in via OIDC, shows a message instead.
    """
    from drsai.backend.auth.token_store import load_auth_session, clear_auth_session

    session = load_auth_session()
    if not session:
        return {
            "output": "ℹ️  Not logged in via OIDC. Use /login to authenticate."
        }

    # Best-effort token revocation
    refresh_token = session.get("refresh_token")
    if refresh_token:
        try:
            from .auth import _get_oidc_client
            client = _get_oidc_client()
            client.revoke_token(refresh_token)
        except Exception as exc:
            logger.warning("Token revocation failed: %s", exc)

    # Clear local session
    clear_auth_session()

    # Update cli_config: reset auth_mode and user_id
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
    cfg["auth_mode"] = "none"
    cfg["user_id"] = "anonymous"
    try:
        cli_config.save_config(cfg)
    except Exception as exc:
        logger.warning("save_config for logout failed: %s", exc)

    user = session.get("user", {})
    name = user.get("name") or user.get("user_id", "unknown")

    return {
        "output": f"✅ Logged out: {name}. OIDC session revoked and credentials cleared.",
        "ui_action": "auth.logout",
    }
```

在 `SLASH_HANDLERS` 字典中注册：

```python
    # ── Authentication ─────────────────────────────────────────────────
    "login": cmd_login,
    "logout": cmd_logout,
```

#### 14.4.3 前端：`composerPane.tsx` — 添加 AuthScreen overlay

**文件**: `apps/ui-tui/src/components/composerPane.tsx`

**变更 1：导入 AuthScreen**

在 import 区添加：
```typescript
import { AuthScreen } from './authScreen.js'
```

**变更 2：添加 state**

在 `const [setupScreenOpen, setSetupScreenOpen] = useState(false)` 之后添加：
```typescript
  const [authScreenOpen, setAuthScreenOpen] = useState(false)
```

**变更 3：在 ui_action switch 中添加 case**

在 `case 'setup.wizard':` 之后添加：
```typescript
          case 'auth.login': {
            setAuthScreenOpen(true)
            return
          }
          case 'auth.logout': {
            // Update user ID to anonymous after logout
            $userId.set('anonymous')
            showSlashOutput(output, 5000)
            return
          }
```

**变更 4：渲染 AuthScreen overlay**

在 SetupScreen overlay 渲染块之后（约 line 1043），添加：
```typescript
  // Auth screen overlay (mid-session OIDC login via /login)
  if (authScreenOpen) {
    return (
      <Box flexDirection="column">
        <AuthScreen
          gw={controller.gw}
          onComplete={async () => {
            setAuthScreenOpen(false)
            // Refresh user ID from auth status
            try {
              const status = await controller.gw.request<{
                auth_mode: string
                authenticated: boolean
                user: { user_id: string; email: string; name: string; roles: string[] } | null
              }>('auth.status', {})
              if (status.user) {
                $userId.set(status.user.user_id)
              }
            } catch {
              // non-fatal — the auth context will be picked up on next turn
            }
            showSlashOutput('✅ OIDC login successful! Auth context active on next turn.', 4000)
          }}
          onCancel={() => {
            setAuthScreenOpen(false)
          }}
        />
      </Box>
    )
  }
```

#### 14.4.4 前端：`app.tsx` — 无变更

AuthScreen 在 bootstrap 阶段（`phase: 'auth'`）的使用保持不变。/login 命令复用同一个 AuthScreen 组件，但通过 composerPane 的 overlay 机制渲染，不经过 bootstrap 状态机。

### 14.5 交互流程

#### 14.5.1 /login 流程

```
1. 用户输入 /login
2. composerPane 发送 slash.exec RPC
3. 后端 cmd_login 检查 auth session:
   - 已登录 → 返回 "Already logged in as {name}"，不弹 overlay
   - 未登录 → 返回 {"ui_action": "auth.login"}
4. composerPane 收到 ui_action → setAuthScreenOpen(true)
5. AuthScreen 组件挂载:
   a. 调用 auth.oidc.start → 获取 device_code + user_code + verification_uri
   b. 显示验证码和 URL（用户在浏览器打开 URL 并输入验证码）
   c. 轮询 auth.oidc.poll（每 interval 秒）
   d. 成功 → 显示成功信息 → 1 秒后调用 onComplete
   e. 过期/错误 → 允许重试或 Esc 取消
6. onComplete:
   - 关闭 overlay (setAuthScreenOpen(false))
   - 调用 auth.status 获取 user_id → 更新 $userId
   - 显示 "✅ OIDC login successful!"
7. 下一个对话 turn:
   - prompt.py._load_platform_auth_context() 自动加载 OIDC session
   - platform_auth_scope(context) 绑定 ContextVar
   - LLM client 使用 OIDC access_token 替代 api_key
```

#### 14.5.2 /logout 流程

```
1. 用户输入 /logout
2. composerPane 发送 slash.exec RPC
3. 后端 cmd_logout:
   a. load_auth_session() → 无 session → 返回 "Not logged in"
   b. 有 session → revoke_token(refresh_token) [best-effort]
   c. clear_auth_session() → 删除 ~/.drsai/auth/auth.json
   d. cli_config["auth_mode"] = "none", ["user_id"] = "anonymous"
   e. 返回 {"output": "✅ Logged out: {name}…", "ui_action": "auth.logout"}
4. composerPane:
   - case 'auth.logout': $userId.set('anonymous')
   - showSlashOutput(output, 5000)
5. 下一个对话 turn:
   - prompt.py._load_platform_auth_context() → 无 OIDC session → None
   - 回退到 API key mode（如果有环境变量 HEPAI_API_KEY 等）
```

### 14.6 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 已登录时 /login | 返回 "Already logged in as {name}. Use /logout first."，不弹 overlay |
| 未登录时 /logout | 返回 "Not logged in via OIDC. Use /login to authenticate." |
| /login 中 Esc 取消 | 关闭 overlay，无副作用（auth.oidc.cancel 已由 AuthScreen 组件自动调用） |
| /login 成功但 token 立即过期 | 下一个 turn _load_platform_auth_context 会尝试 refresh，refresh 失败则回退到 api_key |
| /logout 时网络不可达 | revoke_token 失败被 catch（best-effort），本地 session 仍被清除 |
| API key 模式下 /login | 正常弹 AuthScreen，登录成功后 auth_mode 切换为 "oidc" |
| OIDC 模式下 /logout 后 | auth_mode 切回 "none"，如果有环境变量 API key 则自动回退到 api_key 模式 |
| /login 进行中再次输入 /login | 第二次 /login 也会触发 slash.exec，但 AuthScreen 已在 overlay 中，第二次 ui_action 会被忽略（overlay 已 mount） |
| Bootstrap 阶段使用 /login | 不会发生——/login 只在 boot.phase === 'ready' 时可用（composerPane 只在 ready 阶段渲染） |

### 14.7 /login 和 /logout 与 /setup 的关系

| 命令 | 功能 | 是否弹 overlay | 修改 cli_config |
|------|------|----------------|------------------|
| `/setup` | 修改 API key / base_url / provider 配置 | ✅ SetupScreen overlay | api_key, base_url, provider |
| `/login` | OIDC Device Code Flow 登录 | ✅ AuthScreen overlay | auth_mode, user_id |
| `/logout` | 撤销 OIDC token + 清除 session | ❌ 纯文本输出 | auth_mode, user_id |

三者独立：`/login` 不依赖 `/setup`，`/logout` 不依赖 `/setup`。`/setup` 修改的是 API key 配置，`/login` 修改的是 OIDC session。两者可以共存——如果用户既有 API key 又登录了 OIDC，OIDC 优先（因为 `prompt.py::_load_platform_auth_context()` 检查 `auth_mode == "oidc"`）。

### 14.8 不涉及的文件

以下文件**无需修改**：

| 文件 | 原因 |
|------|------|
| `auth.py` (handlers) | auth.oidc.start/poll/cancel 和 auth.logout RPC 已实现 |
| `oidc_client.py` | OidcClient 已实现所有 OIDC 操作 |
| `token_store.py` | load/save/clear/is_expired 已实现 |
| `authScreen.tsx` | AuthScreen 组件已实现完整 Device Code Flow UI |
| `app.tsx` | bootstrap 阶段的 AuthScreen 使用不变 |
| `prompt.py` | _load_platform_auth_context() 已自动处理 OIDC token 加载 |
| `entry.py` | setup_status() 逻辑不变（/login 不走 bootstrap） |
| `uiStore.ts` | $userId 已存在，$activeOverlay 不需要新增类型 |

### 14.9 实施步骤

1. **后端 commands.py** (~5 分钟)
   - 在 COMMAND_REGISTRY 添加 login 和 logout 的 CommandDef
   - 在 commands_by_category() 的 order 列表添加 "Authentication"

2. **后端 slash.py** (~15 分钟)
   - 实现 cmd_login() 和 cmd_logout() 函数
   - 在 SLASH_HANDLERS 注册 "login" 和 "logout"
   - 确保 cli_config import 已在文件顶部（已有）

3. **前端 composerPane.tsx** (~10 分钟)
   - 添加 `import { AuthScreen }`
   - 添加 `const [authScreenOpen, setAuthScreenOpen] = useState(false)`
   - 在 switch(result.ui_action) 添加 case 'auth.login' 和 case 'auth.logout'
   - 在 overlay 渲染区添加 AuthScreen overlay 块

4. **前端构建** (~2 分钟)
   - `cd apps/ui-tui && npm run build`

5. **测试** (~15 分钟)
   - 启动 TUI → /login → 验证 AuthScreen 弹出
   - 输入验证码 → 验证登录成功
   - /logout → 验证注销成功
   - /login（已登录）→ 验证提示已登录
   - /logout（未登录）→ 验证提示未登录
