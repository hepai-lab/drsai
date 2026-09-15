# OIDC Token 解密与 IHEP API 访问指南

> 适用环境：Windows 桌面版 OpenDrSai（开发模式 `OPENDRSAI_DESKTOP_DEV=1`）

## 1. OIDC 登录流程

桌面版通过浏览器 OIDC 登录 IHEP AI 平台（`https://ai-dev.ihep.ac.cn/api`），登录成功后获取 `access_token`（JWT）和 `refresh_token`，使用 Electron `safeStorage` 加密后存储在本地。

```
用户登录 → OIDC 授权 → 获取 access_token (JWT, 848字节)
         → safeStorage 加密 (AES-256-GCM)
         → 写入 ~/.drsai-dev/auth/auth.json
```

## 2. Token 存储位置

| 文件 | 路径 | 内容 |
|------|------|------|
| **Local State** | `~/.drsai-dev/electron-user-data/Local State` | AES-256 密钥（DPAPI 保护） |
| **auth.json** | `~/.drsai-dev/auth/auth.json` | 加密的 OIDC token（AES-GCM v10 格式） |

### auth.json 关键字段

```json
{
  "issuer": "https://ai-dev.ihep.ac.cn/api",
  "authMode": "oidc",
  "authProvider": "hai",
  "encryptedAccessToken": "djEw...",   // base64 编码的 AES-GCM 密文
  "encryptedRefreshToken": "djEw...",
  "encryptedIdToken": "djEw...",
  "user": { "email": "xiongdb@ihep.ac.cn" }
}
```

## 3. 解密过程

Electron `safeStorage` 在 Windows 上使用 **DPAPI + AES-256-GCM** 双层加密：

```
Local State 的 os_crypt.encrypted_key:
  base64("DPAPI" + DPAPI加密的AES密钥)
    → DPAPI CryptUnprotectData → 得到 AES-256 密钥

auth.json 的 encryptedAccessToken:
  base64("v10" + nonce(12字节) + 密文 + GCM tag(16字节))
    → AES-256-GCM 解密 → 得到 JWT access_token
```

### 解密步骤图

```
┌─────────────────────────────────────────────────────────────┐
│  Local State                                                 │
│  os_crypt.encrypted_key = base64( "DPAPI" + dpapi(AES_KEY) )│
│                          ↓ base64 decode                    │
│                          ↓ strip "DPAPI" prefix (5 bytes)   │
│                          ↓ DPAPI CryptUnprotectData()        │
│                          → AES_KEY (32 bytes)               │
├─────────────────────────────────────────────────────────────┤
│  auth.json                                                   │
│  encryptedAccessToken = base64( "v10" + nonce + ct + tag )   │
│                          ↓ base64 decode                    │
│                          ↓ strip "v10" prefix (3 bytes)     │
│                          ↓ split: nonce(12) + ct + tag(16)   │
│                          ↓ AES-256-GCM decrypt_and_verify   │
│                          → JWT access_token (明文)           │
└─────────────────────────────────────────────────────────────┘
```

## 4. API 端点

开发环境（桌面版默认）：

| 用途 | 方法 | URL |
|------|------|-----|
| 模型列表 | GET | `https://ai-dev.ihep.ac.cn/apiv2/v1/models` |
| 对话测试 | POST | `https://ai-dev.ihep.ac.cn/apiv2/v1/chat/completions` |

> 注意：开发环境签发的 token 只能访问 `ai-dev.ihep.ac.cn`，不能访问生产环境 `aiapi.ihep.ac.cn`。

## 5. 脚本使用

### 前置依赖

```bash
pip install pycryptodome
```

### 脚本说明

| 脚本 | 功能 | 用法 |
|------|------|------|
| `get_token.py` | 解密 OIDC token 并输出 | `python get_token.py` |
| `list_models.py` | 列出平台所有可用模型 | `python list_models.py` |
| `test_chat.py` | 测试指定模型的对话 | `python test_chat.py <模型名> [提示词]` |

### 使用示例

```bash
# 1. 解密并查看 token（通常不需要单独执行，其他脚本会自动调用）
python get_token.py

# 2. 列出所有可用模型
python list_models.py
# 输出示例：
#   Total: 146 models
#   deepseek-v4-flash                   (owner: hepai)
#   hepai/deepseek-v4-flash             (owner: tangzh@ihep.ac.cn)
#   ...

# 3. 测试某个模型是否可用
python test_chat.py deepseek-v4-flash
# 输出示例：
#   ✅ deepseek-v4-flash: OK
#   Reply: Hello! How can I...

# 4. 测试某个模型 + 自定义提示词
python test_chat.py deepseek-v4-flash "1+1等于几"

# 5. 批量测试多个模型（需要调用方循环）
python -c "
from test_chat import test_chat
from get_token import get_oidc_token
token = get_oidc_token()
for m in ['deepseek-v4-flash', 'hepai/deepseek-v4-flash', 'deepseek-ai/deepseek-v4-flash']:
    test_chat(token, m)
"
```

## 6. 关键发现

通过实际 API 调用测试，同一个基础模型名在不同 owner 下是**不同的模型**，可用性不同：

| 模型 ID | owned_by | 状态 | 说明 |
|---------|----------|------|------|
| `deepseek-v4-flash` | hepai | ✅ 可用 | 平台官方部署 |
| `hepai/deepseek-v4-flash` | tangzh@ihep.ac.cn | ❌ 503 | 个人部署，worker 不可用 |
| `deepseek-ai/deepseek-v4-flash` | zdzhang@ihep.ac.cn | ❌ 400 | 个人部署，无调用权限 |

> 前缀（`hepai/`、`deepseek-ai/`）是模型 ID 的一部分，标识不同的部署者，不是可随意去除的。
