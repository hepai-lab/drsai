# 远程 Agent Skill Proxy 对接说明

WebUI 负责下载并缓存 skill。远程 DrSai worker **不要读本地 skill 文件**，用 `user_id` + 内部 token 调 WebUI 接口拿全文。

> 身份是 `user_id`（读谁的缓存）；鉴权是 `X-Skill-Proxy-Token`，对应 `DRSAI_SKILL_PROXY_TOKEN`。没有 token 会 401。

## 数据从哪来

与 `attached_files` 相同：挂在**用户消息的 `metadata`** 上（JSON 字符串），**不**放在 `run_info`。

`a_chat_completions` / `run_stream` 收到的 user message 形如：

```json
{
  "source": "user",
  "content": "用这个 skill 写一篇文章",
  "metadata": {
    "attached_files": "[]",
    "attached_skills": "[{\"name\": \"academic-pipeline\", \"slug\": \"skill-9b868179b82a\", \"source\": \"higraf\", \"description\": \"...\"}]",
    "skill_proxy": "{\"base_url\": \"https://<当前访问域名>/api/agent/skills\", \"public_origin\": \"https://<当前访问域名>\", \"user_id\": \"yqsun@ihep.ac.cn\", \"run_id\": 354, \"token\": \"<DRSAI_SKILL_PROXY_TOKEN>\"}"
  }
}
```

解析示例（与 files 同级）：

```python
import json

skill_proxy = json.loads(msg.metadata.get("skill_proxy") or "{}")
attached_skills = json.loads(msg.metadata.get("attached_skills") or "[]")
```

- `user_id`：与 `skill_proxy.user_id` / 用户邮箱一致  
- `token`：与 WebUI 环境变量 `DRSAI_SKILL_PROXY_TOKEN` 一致，请求时放到 `X-Skill-Proxy-Token`  
- `attached_skills`：**本次消息**用户在 UI 勾选的 skill（不是全库；全库用 `GET /attached`）  
- `base_url` / `public_origin`：来自用户打开页面时的 `Host` / `X-Forwarded-Host`（经 nginx 时优先）；若无请求头则 fallback 到 `DRSAI_UI_PUBLIC_URL`

本地 `DrSaiAgent.run_stream` 可按 files 同样方式从 `msg.metadata` 读出（由 DrSai 侧自行实现；WebUI 只负责写入 metadata）。

## 接口

`user_id` 任选其一传递：

- Query：`?user_id=yqsun@ihep.ac.cn`
- Header：`X-User-Id: yqsun@ihep.ac.cn`
- Body（仅 POST）：`"user_id": "..."`

**必须**带内部 token：

- Header：`X-Skill-Proxy-Token: <DRSAI_SKILL_PROXY_TOKEN>`

### 列出已安装 skill

```http
GET {base_url}/attached?user_id=yqsun@ihep.ac.cn
X-Skill-Proxy-Token: <token>
```

### 加载 skill 全文

```http
POST {base_url}/load
Content-Type: application/json
X-User-Id: yqsun@ihep.ac.cn
X-Skill-Proxy-Token: <token>

{ "skill": "academic-paper-reviewer" }
```

或：

```json
{ "skill": "academic-paper-reviewer", "user_id": "yqsun@ihep.ac.cn" }
```

`skill` 用 frontmatter `name`，也可用 `slug`。

返回：

```json
{
  "status": true,
  "data": {
    "name": "academic-paper-reviewer",
    "slug": "skill-5f39b24ad838",
    "content": "<skill-loaded name=\"academic-paper-reviewer\">\n    ...\n    </skill-loaded>\n\n    Follow the instructions..."
  }
}
```

把 `data.content` **原样**当作 `Skill` 工具的 tool result。

## Agent 侧（最小）

```python
import httpx

def run_skill(name: str, skill_proxy: dict) -> str:
    r = httpx.post(
        f"{skill_proxy['base_url']}/load",
        headers={
            "X-User-Id": skill_proxy["user_id"],
            "X-Skill-Proxy-Token": skill_proxy["token"],
        },
        json={"skill": name},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["data"]["content"]
```

有 `msg.metadata["skill_proxy"]`（或 `self._skill_proxy`）时走上面；没有则继续读本地 `skills_dir`。

## 错误

| HTTP | 含义 |
|------|------|
| 401 | 缺少 / 错误的 `X-Skill-Proxy-Token`，或缺少 `user_id` |
| 404 | 该用户缓存里没有这个 skill |

## WebUI 日志

搜 `[skill handoff]` / `[agent_skills]`。日志里的 `token` 会打成 `***`。
