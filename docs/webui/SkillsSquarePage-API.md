# 技能广场（SkillsSquarePage）API 文档

- **页面：** `apps/webui/frontend/src/pages/SkillsSquarePage.tsx`
- **前端逻辑：** `apps/webui/frontend/src/pages/skills-square/useSkillsSquarePage.ts`
- **前端 SDK：** `apps/webui/frontend/src/components/views/api/skills.ts`
- **后端挂载：** FastAPI `app.mount("/api", api)`
- **整理日期：** 2026-09-03

本文只覆盖技能广场页面实际调用的接口，不含 `/skills/catalog` 等旧目录接口。

---

## 1. 通用约定

### 1.1 Base URL

前端通过 `getServerUrl()` 拼接路径，值为：

| 环境 | Base URL |
|------|----------|
| 生产 / 反向代理 | `/api` |
| 本地开发直连后端 | `http://<host>:4291/api` |
| 显式配置 | `GATSBY_API_URL` |

下文路径均相对于站点根，例如 `GET /api/skills`。

示例主机：`https://drsaiv2.ihep.ac.cn`

### 1.2 鉴权

技能相关写/读接口使用 **HepAI 模型 API Key**：

```
Authorization: Bearer <api_key>
```

API Key 来源：用户 Settings 中 `model_configs` YAML：

```yaml
model_config:
  config:
    api_key: sk-xxxx
```

Settings 接口本身使用 **登录 JWT**：

```
Authorization: Bearer <jwt>
```

Higraf 学术组列表可选带 Cookie `access_token`；没有则后端用系统 token。

### 1.3 统一响应

JSON 接口：

```json
{
  "status": true,
  "data": {},
  "message": "optional",
  "pagination": {}
}
```

失败时 FastAPI 多为：

```json
{ "detail": "错误说明" }
```

前端会读 `detail` 或 `message`。

### 1.4 限制

| 项 | 前端 | 后端 |
|----|------|------|
| ZIP 大小 | 10 MB | 32 MB |
| 封面图 | — | 2 MB |
| 封面格式 | — | png / jpg / jpeg / gif / webp / svg |
| 文件夹打包文件数 | 200 | — |
| 公开列表每页 | 20 | 最大 200 |
| 我的技能 page_size | 200 | 最大 200 |
| slug | 小写字母数字中划线 | `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` |

ZIP 内必须包含 `SKILL.md`。

---

## 2. 页面操作 → 接口对照

| UI 操作 | 方法 | 路径 |
|---------|------|------|
| 打开页面（取 API Key） | GET | `/api/settings/?user_id={email}` |
| 是否显示「管理标签」 | GET | `/api/users/access?user_id={email}` |
| 统计卡片 | GET | `/api/skills/stats` |
| 分类筛选条 | GET | `/api/skill-tags/?operator_user_id={email}` |
| 公开技能列表 / 搜索 / 排序 / 翻页 | GET | `/api/skills?type=public` |
| 分类 = LHAASO | GET | `/api/deer-flow/skill-hub/list` |
| 我的创建 / 我的收藏 | GET | `/api/skills?type=user` |
| 技能详情 | GET | `/api/skills/{slug}` |
| 私有技能正文 | GET | `/api/skills/{slug}/skill-md` |
| 封面图 | GET | `/api/skills/{slug}/profile` |
| 发布 | POST | `/api/skills/upload` |
| 编辑 | PUT | `/api/skills/{slug}` |
| 收藏 | POST | `/api/skills/upload`（`source=imported`） |
| 取消收藏 | DELETE | `/api/skills/{slug}?intent=uncollect` |
| 删除自己的技能 | DELETE | `/api/skills/{slug}?intent=delete` |
| 公开 / 隐藏 | PUT | `/api/skills/{slug}/visibility` |
| 下载 ZIP | GET | `/api/skills/{slug}/download` |
| 创建分享 | POST | `/api/skills/{slug}/share` |
| 分享列表 | GET | `/api/skills/{slug}/shares` |
| 撤销分享 | DELETE | `/api/skills/{slug}/share/{share_id}` |
| 管理标签（admin） | POST/PUT/DELETE | `/api/skill-tags/` |

---

## 3. 启动依赖

### 3.1 获取用户 Settings（解析 API Key）

```
GET /api/settings/?user_id={email}
Authorization: Bearer <JWT>
```

**Query**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | 是 | 当前用户邮箱，必须等于登录用户 |

**成功**

```json
{
  "status": true,
  "data": {
    "user_id": "user@ihep.ac.cn",
    "config": {
      "model_configs": "model_config:\n  config:\n    api_key: sk-xxxx\n"
    }
  }
}
```

前端只使用 `data.config`，再从 YAML 取出 `model_config.config.api_key`。

| 状态码 | 说明 |
|--------|------|
| 403 | `user_id` 不是当前登录用户 |
| 404 | 无 settings（前端当空对象，技能接口随后会 401） |

**curl**

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/settings/?user_id=user@ihep.ac.cn" \
  -H "Authorization: Bearer <jwt>"
```

---

### 3.2 平台管理员标记

```
GET /api/users/access?user_id={email}
```

失败时前端会再试：

```
GET /api/orgs/access?user_id={email}
```

**成功**

```json
{
  "status": true,
  "data": {
    "is_platform_admin": true
  }
}
```

`is_platform_admin === true` 时，筛选栏显示「管理标签」。

---

## 4. 统计

### GET `/api/skills/stats`

公开聚合数据，**不需要鉴权**。页面进入公开 Tab 时请求，发布 / 收藏 / 删除后会刷新。

**成功**

```json
{
  "status": true,
  "data": {
    "total_skills": 120,
    "public_skills": 80,
    "total_downloads": 3500,
    "total_collects": 210
  }
}
```

页面展示三项：技能总数、总下载量、总收藏量（`public_skills` 未单独展示）。

**curl**

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills/stats"
```

---

## 5. 技能标签（分类）

所有接口都需要 `operator_user_id`。列表任意登录用户可调；写操作仅平台管理员。

### 5.1 列出标签

```
GET /api/skill-tags/?operator_user_id={email}
```

用于分类筛选条。按 `sort_order`、`name` 排序。

**成功**

```json
{
  "status": true,
  "data": [
    {
      "id": 1,
      "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "name": "科研",
      "sort_order": 0,
      "created_at": "2026-08-01T00:00:00",
      "updated_at": "2026-08-01T00:00:00"
    }
  ]
}
```

特殊分类名 `lhaaso`（大小写不敏感）不会走 `/api/skills`，而走 Higraf 代理，见第 7 节。

---

### 5.2 创建标签（admin）

```
POST /api/skill-tags/?operator_user_id={email}&name={name}&sort_order={n}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `operator_user_id` | string | 是 | 操作者邮箱 |
| `name` | string | 是 | 标签名，全局唯一 |
| `sort_order` | int | 否 | 默认 0 |

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 operator_user_id |
| 403 | 非平台管理员 |
| 409 | 名称已存在 |
| 422 | 名称为空 |

---

### 5.3 更新标签（admin）

```
PUT /api/skill-tags/{tag_id}?operator_user_id={email}&name={name}&sort_order={n}
```

`name`、`sort_order` 均可选，只更新传入字段。

---

### 5.4 删除标签（admin）

```
DELETE /api/skill-tags/{tag_id}?operator_user_id={email}
```

**成功**

```json
{
  "status": true,
  "data": { "id": 1 }
}
```

---

## 6. 列出技能

### 6.1 公开技能广场

```
GET /api/skills?type=public
Authorization: Bearer <api_key>
```

页面：搜索 300ms debounce；分类 / 排序变化重拉第一页；底部 IntersectionObserver 翻页。

**Query**

| 参数 | 类型 | 必填 | 页面取值 | 说明 |
|------|------|------|----------|------|
| `type` | string | 否 | `public` | 公开列表。后端会默认 `visibility=public` |
| `page` | int | 否 | 1, 2, … | 1-based，默认 1 |
| `page_size` | int | 否 | 20 | 最大 200，默认 20 |
| `q` | string | 否 | 搜索框 | 匹配 name / author / slug |
| `tags` | string | 否 | 当前分类名 | 逗号分隔，与技能 tags 求交集 |
| `sort` | string | 否 | `time`（默认） | `name` / `time` / `downloads` / `collects` |
| `source` | string | 否 | 不传 | `user` / `higraf` |
| `visibility` | string | 否 | 不传 | `public` / `private` / `team` |

无 API Key → **401** `API key required`。

**成功**

```json
{
  "status": true,
  "data": [
    {
      "slug": "ceshi",
      "name": "测试技能",
      "icon": "package",
      "version": "1.0.0",
      "description": "一个测试技能",
      "owner": "张三",
      "owner_id": "user@ihep.ac.cn",
      "author": "张三",
      "visibility": "public",
      "source": "user",
      "source_ref": null,
      "uskills_type": "created",
      "imported_ref": null,
      "tags": ["科研"],
      "downloads": 12,
      "collects": 3,
      "collector_ids": ["a@ihep.ac.cn"],
      "agent_ids": [],
      "team_ids": [],
      "is_collected": false,
      "profile": "/api/skills/ceshi/profile",
      "created_at": "2026-08-27T12:00:00",
      "updated_at": "2026-08-27T12:00:00",
      "can_edit": false
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 80,
    "total_pages": 4,
    "has_next": true,
    "has_prev": false
  }
}
```

**列表项字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `slug` | string | 唯一标识 |
| `name` | string | 显示名 |
| `icon` | string | emoji 或图标名，默认 `package` |
| `version` | string | 版本 |
| `description` | string | 简介 |
| `owner` | string | 展示名，优先 `author` |
| `owner_id` | string | 所有者邮箱 |
| `author` | string | 作者展示名 |
| `visibility` | string | `public` / `private` / `team` |
| `source` | string | `user` / `higraf` |
| `uskills_type` | string \| null | `created` / `imported` |
| `tags` | string[] | 标签 |
| `downloads` | int | 下载次数（`download_count`） |
| `collects` | int | `collector_ids` 长度 |
| `collector_ids` | string[] | 收藏者 user_id |
| `is_collected` | bool | 当前用户是否已收藏 |
| `profile` | string | 封面路径，多为 `/api/skills/{slug}/profile` |
| `can_edit` | bool | 当前用户是否可编辑 |
| `created_at` / `updated_at` | string | ISO 时间 |

**curl**

```bash
# 第一页
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&page=1&page_size=20&sort=time" \
  -H "Authorization: Bearer <api_key>"

# 搜索 + 标签 + 按下载量
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&q=计算&tags=科研&sort=downloads" \
  -H "Authorization: Bearer <api_key>"
```

---

### 6.2 我的技能

```
GET /api/skills?type=user&page_size=200
Authorization: Bearer <api_key>
```

只能看到 **当前 API Key 对应用户** 创建或收藏的技能。

页面不把「创建 / 收藏」拆成两次请求，而是一次拉全量，前端用：

- **我的创建：** `owner_id === 当前邮箱` 且 `uskills_type !== imported` 且未收藏
- **我的收藏：** `is_collected` 或 `collector_ids` 含当前邮箱

搜索、按名称/时间排序也在前端完成。

后端补充：`type=user` 且 `uskills_type=created` 时会限定 `source=user`；`uskills_type=imported` 时按收藏者过滤。本页未传 `uskills_type`。

若 `page_size` 仍是默认 20，后端会抬到 200。本页显式传 200。

**curl**

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user&page_size=200" \
  -H "Authorization: Bearer <api_key>"

# 仅创建（后端支持，本页未用）
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user&uskills_type=created" \
  -H "Authorization: Bearer <api_key>"

# 仅收藏（后端支持，本页未用）
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user&uskills_type=imported" \
  -H "Authorization: Bearer <api_key>"
```

---

## 7. 学术组技能（Higraf 代理）

分类名属于 `ACADEMIC_GROUP_TAGS`（目前仅 `lhaaso`）时，公开列表改走：

```
GET /api/deer-flow/skill-hub/list?visibility=group&academicGroupId=lhaaso
```

可选 Cookie：`access_token`；或 Header：`X-Access-Token`。都没有则用系统级 Higraf token。

后端再请求：

```
GET {higraf}/agent/api/v1/skill-hub/list
```

**本页 Query**

| 参数 | 值 |
|------|-----|
| `visibility` | `group` |
| `academicGroupId` | 分类名小写，如 `lhaaso` |

后端还透传 `categoryL2`、`kind`、`search` 等，本页未用。

**包装响应**

```json
{
  "status": true,
  "data": [ ]
}
```

`data` 为 Higraf 原始 body。前端映射：

| Higraf | 广场列表项 |
|--------|------------|
| `skillId` / `id` | `slug` |
| `name` / `skillName` | `name` |
| `description` | `description` |
| `emoji` | `icon`（缺省 `package`） |
| `version` / `currentVersion` | `version` |
| `authorName` | `owner` |
| `updatedAt` / `updated_at` | `updated_at` |
| `callCount` | `downloads` |
| `tags` | `tags` |
| — | `source: "higraf"` |
| `academicGroupId` | `academicGroupId` |

此列表 **无分页**。

| 状态码 | 说明 |
|--------|------|
| 401 | 无 Higraf token |
| 502 | Higraf 请求失败 |
| 504 | Higraf 超时 |

---

## 8. 技能详情

URL 出现 `?skill={slug}` 时加载详情。

### 8.1 公开详情

```
GET /api/skills/{slug}?type=public
Authorization: Bearer <api_key>
```

前端会带 `type=public`，后端 **GET `/{slug}` 实际忽略 type**。

在列表字段基础上合并 `SkillDetail`：

```json
{
  "status": true,
  "data": {
    "slug": "ceshi",
    "name": "测试技能",
    "icon": "package",
    "version": "1.0.0",
    "description": "一个测试技能",
    "owner": "user@ihep.ac.cn",
    "owner_id": "user@ihep.ac.cn",
    "author": "张三",
    "visibility": "public",
    "source": "user",
    "uskills_type": "created",
    "tags": ["测试"],
    "downloads": 0,
    "collects": 0,
    "profile": "/api/skills/ceshi/profile",
    "created_at": "2026-08-27T12:00:00",
    "updated_at": "2026-08-27T12:00:00",
    "can_edit": true,
    "body": "# SKILL\n\n技能正文...",
    "changelog": "初始版本",
    "author_email": null,
    "author_id": null,
    "required_tools": [],
    "detail_raw": null
  }
}
```

DB 没有记录时，会尝试从 GFS ZIP 读 `SKILL.md` 并回填。

| 状态码 | 说明 |
|--------|------|
| 400 | slug 非法 |
| 404 | 技能不存在 |
| 422 | SKILL.md 格式无效 |

**curl**

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills/ceshi?type=public" \
  -H "Authorization: Bearer <api_key>"
```

---

### 8.2 读取 SKILL.md（私有 Tab 优先）

```
GET /api/skills/{slug}/skill-md
Authorization: Bearer <api_key>
```

```json
{
  "status": true,
  "data": {
    "content": "# SKILL\n\n..."
  }
}
```

私有 Tab 先调此接口拼详情；ZIP 不存在则回退到 8.1。

**curl**

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/skill-md" \
  -H "Authorization: Bearer <api_key>"
```

---

### 8.3 封面图

```
GET /api/skills/{slug}/profile
```

返回图片二进制。无封面 → 404。

列表/详情里的 `profile` 若以 `/api/` 开头，前端会拼成 `getServerUrl() + path.slice(4)`。

---

## 9. 上传 / 更新

### 9.1 上传（发布 / 收藏）

```
POST /api/skills/upload
Authorization: Bearer <api_key>
Content-Type: multipart/form-data
```

前端会带 `?type=public` 或 `?type=user`，**后端上传接口不读 type**。可见性看 form 字段 `visibility`；不传则新建默认为 **`public`**。私有技能需再调第 11 节切换可见性。

**表单字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 普通发布必填 | `.zip`，≤32MB（前端限制 10MB），内含 SKILL.md |
| `slug` | string | 否 | 不传则从 SKILL.md 的 name 生成 |
| `display_name` | string | 否 | 显示名 |
| `name` | string | 否 | 同 `display_name` |
| `icon` | string | 否 | 图标 |
| `description` | string | 否 | 描述 |
| `version` | string | 否 | 版本 |
| `changelog` | string | 否 | 更新日志 |
| `tags` | string | 否 | 逗号分隔，如 `科研,测试` |
| `visibility` | string | 否 | `public` / `private` / `team`，默认 `public` |
| `source` | string | 否 | `imported` 表示收藏，不写 GFS |
| `owner` | string | 否 | 收藏时保留原作者展示名 |
| `owner_id` | string | 否 | 收藏时保留原作者 id |
| `profile` | File | 否 | 封面，≤2MB |

**收藏路径：** `source=imported` 时不要求真实 ZIP。会把当前用户写入该 slug 的 `collector_ids`。本页调用时还会带上公开技能的 `display_name`、`icon`、`description`、`version`、`tags`、`owner`、`owner_id`、`changelog`。

**普通上传成功**

```json
{
  "status": true,
  "message": "Upload successful",
  "data": {
    "slug": "ceshi",
    "name": "测试技能",
    "description": "一个测试技能",
    "version": "1.0.0",
    "icon": "package",
    "changelog": "初始版本",
    "profile": "/api/skills/ceshi/profile",
    "tags": ["测试"],
    "visibility": "public",
    "uskills_type": "created"
  }
}
```

**收藏成功** `message` 为 `Import successful`，`uskills_type` 为 `imported`。

**curl**

```bash
# 发布
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/upload" \
  -H "Authorization: Bearer <api_key>" \
  -F "file=@ceshi.zip" \
  -F "slug=ceshi" \
  -F "display_name=测试技能" \
  -F "icon=package" \
  -F "version=1.0.0" \
  -F "changelog=初始版本" \
  -F "tags=测试,科研" \
  -F "visibility=public" \
  -F "profile=@cover.png"

# 收藏
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/upload" \
  -H "Authorization: Bearer <api_key>" \
  -F "file=@empty.ref" \
  -F "slug=ceshi" \
  -F "source=imported" \
  -F "display_name=测试技能" \
  -F "owner_id=author@ihep.ac.cn"
```

| 状态码 | 说明 |
|--------|------|
| 400 | slug 缺失（收藏）、无 SKILL.md、非法 ZIP、封面格式错误 |
| 401 | 缺少 API Key |
| 403 | 覆盖他人技能 |
| 413 | ZIP 或封面超限 |
| 422 | SKILL.md 无效 |

---

### 9.2 更新

```
PUT /api/skills/{slug}
Authorization: Bearer <api_key>
Content-Type: multipart/form-data
```

须为 owner 或平台管理员。所有字段可选，只更新传入的。

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | 新 ZIP |
| `display_name` / `name` | string | 显示名 |
| `icon` | string | 图标 |
| `description` | string | 描述 |
| `version` | string | 版本 |
| `changelog` | string | 更新日志 |
| `tags` | string | 逗号分隔 |
| `visibility` | string | `public` / `private` / `team` |
| `profile` | File | 新封面 |

前端公开编辑用 `name`，用户技能编辑用 `display_name`。

**curl**

```bash
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi" \
  -H "Authorization: Bearer <api_key>" \
  -F "name=新名称" \
  -F "version=1.1.0" \
  -F "changelog=修复 bug" \
  -F "tags=测试,科研"
```

---

## 10. 删除 / 取消收藏

```
DELETE /api/skills/{slug}?intent={delete|uncollect}
Authorization: Bearer <api_key>
```

前端还会带 `type=user`，后端删除接口只认 `intent` + API Key 身份。

| intent | 行为 |
|--------|------|
| `delete` | 创建者：删除 GFS ZIP、SkillMeta、SkillDetail |
| `uncollect` | 仅从 `collector_ids` 移除当前用户 |

如果当前用户只是收藏者，即使用 `intent=delete`，后端也会按取消收藏处理。

**成功**

```json
{
  "status": true,
  "message": "Skill 'ceshi' deleted",
  "data": { "slug": "ceshi" }
}
```

取消收藏时 `message` 为 `Uncollected skill 'ceshi'`。

**curl**

```bash
# 删除自己创建的技能
curl -X DELETE "https://drsaiv2.ihep.ac.cn/api/skills/ceshi?intent=delete" \
  -H "Authorization: Bearer <api_key>"

# 取消收藏
curl -X DELETE "https://drsaiv2.ihep.ac.cn/api/skills/ceshi?intent=uncollect" \
  -H "Authorization: Bearer <api_key>"
```

---

## 11. 切换可见性

```
PUT /api/skills/{slug}/visibility?visibility={public|private|team}
Authorization: Bearer <api_key>
```

仅 owner 或平台管理员。`source=higraf` 的同步技能不能改。

前端还会带 `type=user&user_id=`，后端 **只认** `visibility` 和 API Key。

**成功**

```json
{
  "status": true,
  "message": "Skill 'ceshi' visibility set to 'public'",
  "data": {
    "slug": "ceshi",
    "visibility": "public"
  }
}
```

**curl**

```bash
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/visibility?visibility=public" \
  -H "Authorization: Bearer <api_key>"

curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/visibility?visibility=private" \
  -H "Authorization: Bearer <api_key>"
```

---

## 12. 下载 ZIP

```
GET /api/skills/{slug}/download
```

返回 `application/zip`，文件名 `{slug}.zip`。成功后后端异步 `download_count + 1`。

前端会带 `?type=public`，后端忽略。按 SkillMeta 的 `source` / `owner_id` 解析 GFS 路径。

**curl**

```bash
curl -o ceshi.zip \
  "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/download" \
  -H "Authorization: Bearer <api_key>"
```

---

## 13. 技能分享

仅「我的创建」详情可打开分享弹窗。落地页 `/share/skill/{share_id}` 不在本页，但消费下列公开接口。

创建 / 列表 / 撤销用 Query `user_id` 校验所有权（`SkillMeta.owner_id`），不走 API Key。

### 13.1 创建分享（本页）

```
POST /api/skills/{slug}/share?user_id={email}
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `password` | string | 否 | 访问密码 |
| `expires_in_hours` | int | 否 | 默认 24，范围 1–8760（最长 1 年） |

页面预设：1 小时 / 24 小时 / 7 天 / 30 天 / 自定义小时数。

**成功**

```json
{
  "status": true,
  "message": "Share link created",
  "data": {
    "share_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "skill_slug": "ceshi",
    "has_password": true,
    "expires_at": "2026-09-04T01:00:00+00:00",
    "created_at": "2026-09-03T01:00:00+00:00"
  }
}
```

前端分享链接：`{origin}/share/skill/{share_id}`。

**curl**

```bash
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/share?user_id=user@ihep.ac.cn" \
  -F "password=secret" \
  -F "expires_in_hours=24"
```

---

### 13.2 列出分享（本页）

```
GET /api/skills/{slug}/shares?user_id={email}
```

```json
{
  "status": true,
  "data": [
    {
      "share_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "has_password": true,
      "expires_at": "2026-09-04T01:00:00+00:00",
      "expired": false,
      "created_at": "2026-09-03T01:00:00+00:00",
      "access_count": 3
    }
  ]
}
```

---

### 13.3 撤销分享（本页）

```
DELETE /api/skills/{slug}/share/{share_id}?user_id={email}
```

```json
{
  "status": true,
  "message": "Share revoked",
  "data": { "share_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
}
```

---

### 13.4 公开消费（分享落地页，本页不调用）

无需登录。

**元信息**

```
GET /api/skills/share/{share_id}
```

```json
{
  "status": true,
  "data": {
    "share_id": "...",
    "has_password": true,
    "expires_at": "...",
    "skill": {
      "slug": "ceshi",
      "name": "测试技能",
      "description": "...",
      "icon": "package",
      "version": "1.0.0",
      "owner": "张三",
      "profile": "",
      "changelog": ""
    }
  }
}
```

过期 → **410**。

**校验密码，换下载 token**

```
POST /api/skills/share/{share_id}/verify
Content-Type: multipart/form-data

password=
```

无密码时直接返回 token。密码错误 → **403**。

```json
{
  "status": true,
  "data": { "token": "<share_id>:<expiry>:<hmac>" }
}
```

**下载**

```
GET /api/skills/share/{share_id}/download?token={token}
```

返回 ZIP。token 无效或过期 → **403**。每次成功下载 `access_count + 1`。

---

## 14. 错误码汇总

| HTTP | 含义 |
|------|------|
| 200 | 成功 |
| 400 | 参数错误（slug、文件类型、过期小时数等） |
| 401 | 缺少或无效 API Key / Higraf token |
| 403 | 非 owner/admin；分享密码错误；越权读 settings |
| 404 | 技能 / 标签 / 分享 / 封面 / settings 不存在 |
| 409 | 标签名重复 |
| 410 | 分享链接已过期 |
| 413 | ZIP 或封面过大 |
| 422 | SKILL.md 或标签名无效 |
| 500 | 服务器 / GFS 错误 |
| 502 | Higraf 代理失败 |
| 504 | Higraf 超时 |

---

## 15. 前端 SDK 方法对照

文件：`apps/webui/frontend/src/components/views/api/skills.ts`

| 方法 | 接口 |
|------|------|
| `settingsAPI.getSettings` | `GET /settings/` |
| `userAPI.getAccess` | `GET /users/access`（失败再试 `/orgs/access`） |
| `skillsAPI.getStats` | `GET /skills/stats` |
| `skillsAPI.listPublicSkillsPage` | `GET /skills?type=public` |
| `skillsAPI.listUserSkills` | `GET /skills?type=user` |
| `skillsAPI.getPublicSkill` | `GET /skills/{slug}` |
| `skillsAPI.getUserSkillMd` | `GET /skills/{slug}/skill-md` |
| `skillsAPI.uploadPublicSkill` | `POST /skills/upload` |
| `skillsAPI.uploadUserSkill` | `POST /skills/upload` |
| `skillsAPI.updatePublicSkill` | `PUT /skills/{slug}` |
| `skillsAPI.updateUserSkill` | `PUT /skills/{slug}` |
| `skillsAPI.importPublicSkill` | `POST /skills/upload` + `source=imported` |
| `skillsAPI.deleteUserSkill` | `DELETE /skills/{slug}` |
| `skillsAPI.toggleSkillVisibility` | `PUT /skills/{slug}/visibility` |
| `skillsAPI.downloadPublicSkill` | `GET /skills/{slug}/download` |
| `skillsAPI.createSkillShare` | `POST /skills/{slug}/share` |
| `skillsAPI.listSkillShares` | `GET /skills/{slug}/shares` |
| `skillsAPI.revokeSkillShare` | `DELETE /skills/{slug}/share/{id}` |
| `skillTagAPI.listTags` | `GET /skill-tags/` |
| `skillTagAPI.createTag` | `POST /skill-tags/` |
| `skillTagAPI.updateTag` | `PUT /skill-tags/{id}` |
| `skillTagAPI.deleteTag` | `DELETE /skill-tags/{id}` |
| `fetchHigrafGroupSkills` | `GET /deer-flow/skill-hub/list` |

本页 **未调用：** `listCatalog`、`getCatalogEntry`、`uploadCatalogZip`、`downloadCatalogArchive`、`deletePublicSkill`、`downloadUserSkill`、`listPublicSkills`（全量循环）。

---

## 16. 实现备注

1. 上传/更新/下载上的 `?type=public|user` 多为前端历史参数，对应后端路由并不读取。
2. `toggleSkillVisibility`、`deleteUserSkill` 上的 `user_id` Query 同样被后端忽略，身份以 API Key 为准。
3. 分享创建/列表/撤销相反：用 `user_id` Query，不用 API Key。
4. 普通上传默认 `visibility=public`。页面「私有发布」若未传 `visibility=private`，需要再调可见性接口。
5. 统计接口不鉴权，数据来自全部 `SkillMeta` 行，不是当前页。
6. 封面路径存的是 `/api/skills/{slug}/profile`，不是对象存储直链。
