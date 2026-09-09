# CSNS 免密登录对接说明

适用环境：`https://drsaiv2.ihep.ac.cn/`

CSNS 服务端用 `access_token` 换一次性登录票，再让用户浏览器跳转到返回的 `login_url`。`access_token` 只在双方服务器之间传递，不进浏览器地址栏。

```
CSNS 服务端
  POST /api/auth/user-agent/exchange   { access_token }
        │
        ▼
OpenDrSai 后端
  POST https://user.csns.ihep.ac.cn/api/token/verify
       token=...&key=3a4dec8389aa11e899fffa163e84aab7
  只认 result/data.cstnetId
  用户入库
  签发一次性 ticket（默认 90 秒，单次使用）
        │
        ▼
返回 { login_url, expires_in, user_id }

CSNS 让用户浏览器跳转到 login_url
  https://drsaiv2.ihep.ac.cn/?user_source=user_agent&ticket=...
        │
        ▼
用户浏览器（我们前端）
  POST /api/auth/user-agent/consume?ticket=...
  建立本系统会话，跳到 iPanda 聊天页
```

---

## 1. 换票（CSNS 服务端调用）

`POST https://drsaiv2.ihep.ac.cn/api/auth/user-agent/exchange`

`Content-Type: application/json`

请求：

```json
{
  "access_token": "7b2fefc56a2332eef4da7e510738fd1e"
}
```

也接受 form 字段 `access_token`。不要把 token 放在 URL query 上（会进网关 access log）。

成功 `200`：

```json
{
  "status": true,
  "data": {
    "login_url": "https://drsaiv2.ihep.ac.cn/?user_source=user_agent&ticket=...",
    "expires_in": 90,
    "user_id": "guantz@ihep.ac.cn"
  }
}
```

| 字段 | 含义 |
|------|------|
| `login_url` | 让 **用户自己的浏览器** 打开这个地址（页面跳转 / iframe 改 `location`）。不要用 CSNS 服务器去 GET 它。 |
| `expires_in` | ticket 有效秒数，默认 90 |
| `user_id` | 来自 CSNS `token/verify` 的 `cstnetId`，仅供对账 |

失败：

| HTTP | 原因 |
|------|------|
| 400 | 缺少 `access_token` |
| 401 | token 无效，或响应里没有 `cstnetId` |
| 502 | 我们调 CSNS `token/verify` 失败 |

curl 示例：

```bash
curl -sS -X POST 'https://drsaiv2.ihep.ac.cn/api/auth/user-agent/exchange' \
  -H 'Content-Type: application/json' \
  -d '{"access_token":"<CSNS_ACCESS_TOKEN>"}'
```

---

## 2. CSNS 侧必须做的事

1. 用 **服务端** 调 `/exchange`，不要从用户浏览器调。
2. 校验 `status === true` 且 `data.login_url` 非空。
3. 拿到 `login_url` 后，让用户浏览器跳转过去（整页跳转，或 iframe 里改 `location`）。CSNS 用自己框架里的 redirect 即可。
4. `login_url` 只能给用户浏览器打开。CSNS 后台不要用 curl/HttpClient 自己去访问它，否则登录会落在他们服务器上，用户页面还是未登录。
5. 若仍是 iframe 嵌入，`login_url` 必须是 `drsaiv2.ihep.ac.cn`（已允许 `user.csns.ihep.ac.cn` / `login.csns.ihep.ac.cn` 作为 frame ancestor）。

用户打开 `login_url` 后，前端会立刻消费 ticket 并跳到：

```
/?menu=current_session&view=chat&share_agent=true&agentName=iPanda
```

ticket 只在地址栏短暂出现，过期或用过即失效。

---

## 3. 我们如何校验 token

我们服务端请求：

```bash
curl -X POST https://user.csns.ihep.ac.cn/api/token/verify \
  -d "token=<CSNS_ACCESS_TOKEN>" \
  -d "key=3a4dec8389aa11e899fffa163e84aab7"
```

`key` 是 CSNS 分配的固定值，可用环境变量 `USER_AGENT_VERIFY_KEY` 覆盖。

成功示例：

```json
{
  "result": { "cstnetId": "guantz@ihep.ac.cn" },
  "code": 200,
  "stauts": "success"
}
```

规则：

- `code` 必须是 `200`（兼容 `0`）
- `stauts` / `status` 为 success（兼容 CSNS 拼写）
- **登录身份只取 `cstnetId`**（`result` 或 `data`）
- `result`/`data` 为空视为失败

通过后写入本系统用户（`user_id` = 小写 `cstnetId`，`user_source=user_agent`），并种默认智能体（含 iPanda）。

---

## 4. 浏览器消费 ticket（我们前端，CSNS 不用调）

`POST https://drsaiv2.ihep.ac.cn/api/auth/user-agent/consume?ticket=...`

成功后返回本系统 JWT，并设置 HttpOnly `refresh-token` cookie。ticket 一次性使用：第一次消费成功后，前端会立刻跳到不含 ticket 的聊天页。之后用户刷新聊天页走正常会话，不受影响。

只有再打开**同一条还带着 ticket 的 `login_url`**（浏览器后退、收藏后再点、把同一条链接再跳一次）才会 401。这是防链接被转发/重放，不是禁止刷新页面。

---

## 5. 联调清单

1. CSNS 服务端能访问 `https://drsaiv2.ihep.ac.cn/api/auth/user-agent/exchange`
2. 我们后端能访问 `https://user.csns.ihep.ac.cn/api/token/verify`
3. 用真实 token 换票，确认返回的 `user_id` 等于 `cstnetId`
4. 浏览器打开 `login_url`，进入 iPanda 聊天页；地址栏应变为不含 ticket 的业务 URL，此时刷新聊天页应仍保持登录
5. 再访问同一条带 ticket 的 `login_url`（不要刷新已经跳转成功的聊天页）应失败
