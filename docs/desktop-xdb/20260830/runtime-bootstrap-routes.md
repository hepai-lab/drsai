# 桌面版启动运行时判断路由分析报告

> 日期: 2026-08-30
> 范围: OpenDrSai Desktop (Electron) → Gateway (Python FastAPI) 启动全链路
> 入口: `desktop:bootstrap` IPC → `bootstrapDesktop()` → 5个阶段顺序执行

## 一、总览：bootstrapDesktop() 五阶段流程

```
bootstrapDesktop()
  │
  ├─ ① requireAuthContext()           — 认证上下文加载/刷新
  │     └─ 读取 auth.json → 检查过期 → OIDC refresh（如需）
  │
  ├─ ② syncAuthIdentityToGateway()     — 身份同步到 Gateway
  │     ├─ PUT  /v1/config/user-name
  │     ├─ PUT  /v1/config/cli/user_id  (仅identity变化时)
  │     └─ POST /v1/identity/canonicalize
  │
  ├─ ③ getInstallStatus()              — 本地安装状态检查
  │     └─ 文件系统检查（无HTTP路由调用）
  │
  ├─ ④ startGateway()                  — Gateway进程启动/采纳
  │     ├─ checkGatewayReady() → probeGatewayEndpoints()
  │     │     └─ GET /health
  │     ├─ 如已就绪 → syncAuthIdentityToGateway() → return true
  │     ├─ 如端口占用但不可用 → killPortOccupant → 重试
  │     └─ spawn Python进程 → pollGatewayReady()
  │           └─ 循环 checkGatewayReady() → GET /health
  │
  └─ ⑤ discoverModelsWithRecovery()    — 模型发现（带重试）
        └─ discoverGatewayModels()
              └─ GET /v1/models  (Bearer token + OIDC mode)
```

**源码位置**: `apps/desktop/windows/src/main/bootstrap.ts`

---

## 二、各阶段详细路由分析

### 阶段①：requireAuthContext() — 认证上下文

**源码**: `apps/desktop/shared/main/auth.ts` L162-178

**作用**: 加载本地存储的认证会话，必要时刷新OIDC token

**流程**:
1. `readStoredSession()` — 读取 `~/.drsai-dev/auth/auth.json`
2. 检查 `isExpired(stored)` — 过期则清除并抛出 `AuthSessionError`
3. `refreshSsoSessionIfNeeded(stored, true)` — 如token即将过期(5分钟窗口)，用refreshToken交换新token
4. 返回 `AuthContext { session, userId, accessToken, authMode, issuer }`

**失败模式**:
| 条件 | 错误码 | 行为 |
|------|--------|------|
| auth.json 不存在/被清除 | `session_missing` | 广播 `desktop:auth-session-invalidated` |
| token 已过期 | `session_expired` | 同上 |
| refresh 失败 | `refresh_failed` | 同上 |
| 无 refreshToken | `refresh_unavailable` | 同上 |

**HTTP路由**: 无（纯本地操作 + OIDC token端点调用，不走Gateway）

---

### 阶段②：syncAuthIdentityToGateway() — 身份同步

**源码**: `apps/desktop/shared/main/gateway.ts` L198-234

**作用**: 将桌面用户ID同步到Gateway进程，确保Gateway知道当前用户身份

**调用的Gateway路由**:

| 路由 | 方法 | 源码行 | 触发条件 | 请求体 |
|------|------|--------|----------|--------|
| `/v1/config/user-name` | PUT | L217 | identity变化时 | `{ user_name: userId }` |
| `/v1/config/cli/user_id` | PUT | L222 | identity变化且previousCliUserId≠userId | `{ value: userId }` |
| `/v1/identity/canonicalize` | POST | L249 | identity变化或lastCanonicalized≠userId | `{ canonical_user_id, aliases }` |

**认证头**: `X-OpenDrSai-Gateway-Token` (instance token, 无OIDC Bearer)

**实现**: 通过 `putGatewayJson()` (L612-635) 使用 `fetch()` + 5秒超时

**Gateway端处理**: 
- `/v1/config/user-name` → 设置运行时用户名
- `/v1/config/cli/user_id` → **会驱逐用户agent池**（仅identity变化时调用）
- `/v1/identity/canonicalize` → 历史用户ID别名归并

**失败模式**: 错误仅记录到 `gateway.log`，不阻断bootstrap（best-effort）

---

### 阶段③：getInstallStatus() — 安装状态检查

**源码**: `apps/desktop/windows/src/main/status.ts` L22-56

**作用**: 检查本地运行时依赖是否完整

**检查项**（纯文件系统操作，无HTTP路由）:
| 检查项 | 变量 | 检查方式 |
|--------|------|----------|
| Python解释器 | `hasPython` | `existsSync(DRSAI_PYTHON)` |
| CLI脚本 | `hasScript` | `existsSync(DRSAI_SCRIPT) \|\| existsSync(DRSAI_CMD_SCRIPT)` |
| 仓库目录 | `hasRepo` | `existsSync(DRSAI_REPO)` |
| 版本信息 | `version` | `readInstalledRuntimeVersion()` \|\| `readBackendSourceVersion()` |
| 版本匹配 | `backendNeedsRepair` | `versionsMatch(version, expectedVersion)` |

**失败模式**: `install.installed === false` → 返回 `runtime_missing` blocker
- 如果 `missing` 包含 `backend-version` → diagnosticCode: `runtime-version-mismatch`
- 否则 → diagnosticCode: `runtime-missing`

**HTTP路由**: 无

---

### 阶段④：startGateway() — Gateway进程启动/采纳

**源码**: `apps/desktop/shared/main/gateway.ts` L181-585

**入口**: `startGateway()` (L181) → 委托到 `startGatewayOnce()` (L433)

#### 4.1 已有就绪Gateway的检查

**源码**: L439-444

```
invalidateGatewayObservation(true)        // 清除缓存
desktopUserId = resolveDesktopUserIdForGateway()
checkGatewayReady()                       // 检查是否已有就绪Gateway
  └─ checkGatewayEndpoints() (L167)
       └─ probeGatewayEndpoints() (L711)
            └─ probeGatewayEndpointsOnce() (L757)
                 └─ GET /health           // 唯一HTTP路由
```

**调用的Gateway路由**:

| 路由 | 方法 | 源码行 | 认证 | 超时 | 用途 |
|------|------|--------|------|------|------|
| `/health` | GET | L761 | `X-OpenDrSai-Gateway-Token` | `GATEWAY_PROBE_TIMEOUT_MS` | 进程存活+就绪检查 |

**/health响应解析** (L763-780):
- `health.ok && health.body?.status === "ok"` → `ready = true` → 直接采纳，跳到身份同步
- `health.state === "unauthorized"` (401/403) → `gateway_unauthorized` 诊断码
- `health.state === "timeout"` → `gateway_probe_timeout` 诊断码
- 不可达但端口开放 → `gateway_port_occupied`
- 完全不可达 → `gateway_unreachable`

**Gateway端**: `/health` 在 `_auth.py` 的 `PUBLIC_PATHS` 中，不需要OIDC Bearer token

#### 4.2 端口占用但Gateway不可用的处理

**源码**: L455-495

- 如果 `preflight.portOpen && !isManagedGatewayRunning()`:
  - 开发模式(`DEV_MANAGED_EXTERNAL_GATEWAY`): `pollGatewayReady()` 短轮询等待
  - 打包模式: `killPortOccupant(GATEWAY_PORT)` 清理占位进程后继续

#### 4.3 启动新Gateway进程

**源码**: L501-577

- 检查 `existsSync(GATEWAY_PYTHON)` 
- 构造启动参数: `python -m drsai.backend.desktop_gateway`
- 设置环境变量:
  - `DRSAI_HOME`, `DRSAI_API_PORT`, 
  - `OPENDRSAI_GATEWAY_INSTANCE_TOKEN` (instance token)
  - `OPENDRSAI_DESKTOP_RUNTIME=1`
  - `OPENDRSAI_GATEWAY_LOG_PATH`
  - `DRSAI_DESKTOP_USER`, `DRSAI_USER_ID` (identity)
- `spawn(GATEWAY_PYTHON, args, {...})` 启动进程
- `pollGatewayReady(gatewayProcess, GATEWAY_START_TIMEOUT_MS)`:
  - 循环 `checkGatewayReady()` → 每次调用 `GET /health`
  - 500ms间隔
  - 直到超时或成功

**调用的Gateway路由**: `GET /health`（每次poll一次）

#### 4.4 失败模式

| 条件 | 诊断码 | blocker kind |
|------|--------|-------------|
| Gateway未在超时内就绪 | `gateway-unavailable` | `service_unavailable` |
| 端口被非OpenDrSai进程占用 | `gateway_port_occupied` | 同上 |
| instance token不匹配 | `gateway_unauthorized` | 同上 |
| Python可执行文件不存在 | 直接返回false | 同上 |

---

### 阶段⑤：discoverModelsWithRecovery() — 模型发现

**源码**: `apps/desktop/windows/src/main/bootstrap.ts` L119-152

**作用**: 通过Gateway的 `/v1/models` 端点发现可用模型，验证认证链路端到端可用

#### 5.1 重试策略

```
retryDelays = [0, 250, 750, 1500]  // 4次重试，递增延迟

for each delay:
  wait(delay)
  discovery = discoverGatewayModels(token)
  
  if discovery.state == "auth_expired" && !refreshed:
    refreshed = true
    nextAuth = refreshAuthContextAfterUnauthorized()  // 刷新token
    discovery = discoverGatewayModels(nextAuth.accessToken)  // 用新token重试
  
  if discovery.state != "unavailable":
    return discovery  // 返回非"不可用"的结果
  
  lastResult = discovery  // 保存最后一次结果，继续重试

return lastResult  // 4次都"不可用"则返回最后结果
```

#### 5.2 discoverGatewayModels() 核心

**源码**: `apps/desktop/shared/main/gateway.ts` L905-957

**调用的Gateway路由**:

| 路由 | 方法 | 源码行 | 认证 | 超时 | 用途 |
|------|------|--------|------|------|------|
| `/v1/models` | GET | L914 | `X-OpenDrSai-Gateway-Token` + `Authorization: Bearer {accessToken}` + `X-OpenDrSai-Auth-Mode: oidc` | 15,000ms | 模型发现+认证验证 |

**请求头** (L914-918):
```http
GET http://127.0.0.1:28643/v1/models
X-OpenDrSai-Gateway-Token: {instance_token}
Authorization: Bearer {accessToken}
X-OpenDrSai-Auth-Mode: oidc
```

**响应处理** (L919-956):

| HTTP状态 | state | diagnosticCode | blocker kind |
|----------|-------|----------------|-------------|
| 200 + `data`数组 | `ready` | — | 无blocker，返回模型列表 |
| 200 + 无效响应 | `unavailable` | `model_catalog_invalid_response` | `service_unavailable` |
| 401 + `token_expired` | `auth_expired` | `token_expired` | `auth_required` (触发refresh重试) |
| 401 + 其他 | `auth_required` | error.code 或 `model_catalog_unauthorized` | `auth_required` |
| 403 | `forbidden` | error.code 或 `model_catalog_forbidden` | `permission_denied` |
| 其他错误 | `unavailable` | error.code 或 `model_catalog_{state}` | `service_unavailable` |

#### 5.3 Gateway端 /v1/models 处理

**源码**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/models.py`

**认证中间件** (`_auth.py`):
1. `/v1/models` 不在 `PUBLIC_PATHS` 中 → 需要完整认证
2. `verify_gateway_instance()` — HMAC比较 instance token
3. `context_from_bearer()` — JWT验证:
   - HS256: `OPENDRSAI_OIDC_HS256_SECRET` env HMAC验证
   - RS256: 从OIDC issuer获取JWKS，`urllib.request.urlopen(timeout=5)`，缓存300s
4. 验证claims: `typ=access_token`, `scope含hai_api`, `sub为UUID`, `exp/nbf/aud`

**路由处理器** (`models.py list_models()`):
- `auth = get_platform_auth()` — 获取平台认证上下文
- **有auth (OIDC登录)** → `_list_platform_models(auth)`:
  - `httpx.AsyncClient(timeout=10.0)` GET `{auth.model_base_url}/models`
  - 带 `Authorization: Bearer {auth.access_token}` 头
  - 上游返回200 → 返回模型列表
  - **上游返回401** → `raise HTTPException(401, code="model_unauthorized")`
  - 超时/连接错误 → fallback到 `_list_local_models()`
- **无auth (离线)** → `_list_local_models()`:
  - 读取 `DEFAULT_LLM_MODE_CONFIG` (定义在 `run_drsai_agent_factory.py` L265)

#### 5.4 失败模式与诊断

| 根因层 | diagnosticCode | state | 用户可见信息 |
|--------|----------------|-------|-------------|
| Gateway instance token不匹配 | `gateway_unauthorized` | — (阶段④拦截) | "运行时需要修复" |
| OIDC JWT无效/过期 | `token_expired` / `invalid_token` | `auth_expired` / `auth_required` | "需要重新登录" |
| HepAI上游平台返回401 | `model_unauthorized` | `auth_required` | "需要重新登录" |
| HepAI上游平台返回403 | `model_catalog_forbidden` | `forbidden` | "账号无权限" |
| 模型列表为空 | `account-no-model-service` | — | "账号无可用服务" |
| 网络超时/不可达 | `model_catalog_timeout` / `model_catalog_unreachable` | `unavailable` | "服务暂时不可用" |

---

## 三、完整路由调用清单

### bootstrap过程中调用的所有Gateway HTTP路由

| # | 路由 | 方法 | 阶段 | 源码位置 | 认证 | 超时 | 触发条件 |
|---|------|------|------|----------|------|------|----------|
| 1 | `/v1/config/user-name` | PUT | ② | gateway.ts L217 | Gateway Token | 5s | identity变化 |
| 2 | `/v1/config/cli/user_id` | PUT | ② | gateway.ts L222 | Gateway Token | 5s | identity变化+cli_user_id变化 |
| 3 | `/v1/identity/canonicalize` | POST | ② | gateway.ts L249 | Gateway Token | 5s | identity变化 |
| 4 | `/health` | GET | ④ | gateway.ts L761 | Gateway Token | `GATEWAY_PROBE_TIMEOUT_MS` | 每次probe |
| 5 | `/v1/models` | GET | ⑤ | gateway.ts L914 | Gateway Token + Bearer + OIDC | 15s | 模型发现 |

### 非bootstrap但相关的路由

| # | 路由 | 方法 | 源码位置 | 用途 |
|---|------|------|----------|------|
| 6 | `/v1/runtime/shutdown` | POST | gateway.ts L988 | 停止Gateway（退出/修复时） |

### Gateway端PUBLIC路径（不需要认证）

**源码**: `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_auth.py`

```python
PUBLIC_PATHS = frozenset({"/v1/runtime", "/v1/capabilities", "/health"})
```

---

## 四、认证链路图

```
Electron (Node.js)
  │
  │  GET /v1/models
  │  Headers:
  │    X-OpenDrSai-Gateway-Token: {instance_token}     ─┐
  │    Authorization: Bearer {accessToken}              │ 双重认证
  │    X-OpenDrSai-Auth-Mode: oidc                      ─┘
  │
  ▼
Python Gateway (_auth.py middleware)
  │
  ├─ ① verify_gateway_instance()
  │     └─ HMAC比较 instance_token
  │        (env OPENDRSAI_GATEWAY_INSTANCE_TOKEN 或
  │         文件 $DRSAI_HOME/runtime/instance-token)
  │
  ├─ ② context_from_bearer()
  │     └─ _decode_verified_claims()
  │          ├─ HS256: HMAC secret验证
  │          └─ RS256: JWKS fetch from OIDC issuer
  │               └─ urllib.request.urlopen(timeout=5), 缓存300s
  │
  ├─ ③ Claims验证
  │     ├─ typ == "access_token"
  │     ├─ scope 包含 "hai_api"
  │     ├─ sub 为 UUID格式
  │     ├─ exp/nbf 有效
  │     └─ aud == "hai-api" (OPENDRSAI_OIDC_AUDIENCE)
  │
  ▼
models.py list_models()
  │
  ├─ auth = get_platform_auth()
  │
  ├─ 有auth → _list_platform_models(auth)
  │    └─ httpx GET {auth.model_base_url}/models
  │         Headers: Authorization: Bearer {auth.access_token}
  │         │
  │         ├─ 200 → 返回模型列表 ✅
  │         ├─ 401 → HTTPException(code="model_unauthorized") ❌
  │         └─ 超时/连接错误 → fallback到 _list_local_models()
  │
  └─ 无auth → _list_local_models()
       └─ 读取 DEFAULT_LLM_MODE_CONFIG ✅
```

---

## 五、关键诊断文件

| 文件 | 位置 | 内容 |
|------|------|------|
| `model-catalog-status.json` | `~/.drsai-dev/logs/model-catalog-status.json` | bootstrap最终诊断结果 |
| `gateway.log` | `~/.drsai-dev/logs/gateway.log` | Python gateway访问日志 |
| `auth.json` | `~/.drsai-dev/auth/auth.json` | OIDC token信息（加密存储） |
| `instance-token` | `~/.drsai-dev/runtime/instance-token` | Gateway实例token |

### model-catalog-status.json 示例

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-30T04:25:29Z",
  "authMode": "oidc",
  "state": "auth_required",         // ready | auth_required | auth_expired | forbidden | unavailable
  "diagnosticCode": "model_unauthorized",
  "modelCount": 0
}
```

### /health 检查命令

```powershell
$t = (Get-Content "$env:USERPROFILE\.drsai-dev\runtime\instance-token" -Raw).Trim()
Invoke-RestMethod "http://127.0.0.1:28643/health" -Headers @{ "X-OpenDrSai-Gateway-Token" = $t } -TimeoutSec 5
```

---

## 六、已知问题与根因

### 问题：`model_unauthorized` 诊断码

**根因**: `model_unauthorized` 码**只来自** `models.py` 的 `_list_platform_models()` 函数（L100），意味着：

1. ✅ Gateway认证中间件通过（instance token HMAC比较成功）
2. ✅ OIDC JWT验证通过（RS256/HS256签名验证、claims检查通过）
3. ❌ **HepAI上游平台** `{auth.model_base_url}/models` 返回了401

即：Gateway本地认证全通过，但HepAI平台拒绝了token。

**可能原因**:
- accessToken在HepAI平台侧已失效（虽然本地未过期）
- HepAI平台token验证服务异常
- `model_base_url` 配置错误

**建议修复**: 在 `models.py` 的 `_list_platform_models()` 中，当上游返回401/403时**回退到 `_list_local_models()`** 而非抛出异常，因为用户已在 `DEFAULT_LLM_MODE_CONFIG` 中配置了本地模型。

---

## 七、源码文件索引

| 文件 | 路径 | 关键行 |
|------|------|--------|
| bootstrap入口 | `apps/desktop/windows/src/main/bootstrap.ts` | L18 `bootstrapDesktop()` |
| Gateway实现 | `apps/desktop/shared/main/gateway.ts` | L181 `startGateway()`, L433 `startGatewayOnce()`, L711 `probeGatewayEndpoints()`, L757 `probeGatewayEndpointsOnce()`, L811 `requestJson()`, L905 `discoverGatewayModels()` |
| 认证 | `apps/desktop/shared/main/auth.ts` | L162 `requireAuthContext()`, L993 `refreshAuthContextAfterUnauthorized()` |
| 安装状态 | `apps/desktop/windows/src/main/status.ts` | L22 `getInstallStatus()` |
| IPC注册 | `apps/desktop/windows/src/main/index.ts` | L4705 `desktop:bootstrap` |
| Python认证 | `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/_auth.py` | `PUBLIC_PATHS`, `verify_gateway_instance()`, `context_from_bearer()` |
| Python模型路由 | `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/models.py` | `list_models()`, `_list_platform_models()`, `_list_local_models()` |
| JWT验证 | `cores/python/packages/drsai/src/drsai/platform_auth.py` | `_decode_verified_claims()`, `_verify_rs256()` |
| 本地模型配置 | `cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py` | L265 `DEFAULT_LLM_MODE_CONFIG` |
| 前端认证 | `apps/desktop/shared/renderer/src/auth/AuthProvider.tsx` | L133 `onAuthSessionInvalidated`, L155 `onAuthSessionRestored`, L170 auto-retry |
| Preload桥接 | `apps/desktop/shared/main/preload.ts` | L392 `onAuthSessionInvalidated`, L398 `onAuthSessionRestored` |
| API接口 | `apps/desktop/shared/api/desktopApi.ts` | L5635-5636 |
| 开发启动脚本 | `apps/desktop/windows-desktop-dev.cmd` | `DRSAI_HOME`, `DRSAI_GATEWAY_DEV_MANAGED` |
