# Skills API 文档

## 路由架构

三个 router 挂载在 `/skills` 下，一个在 `/skill-tags` 下：

| Router | 前缀 | 说明 |
|--------|------|------|
| `skills.py` | `/skills` | 技能目录 (catalog) |
| `skills_gfs/` | `/skills` | 主 CRUD（SkillMeta + GFS） |
| `skills_share.py` | `/skills` | 分享链接 |
| `skill_tags.py` | `/skill-tags` | 标签管理（管理员） |

---

## 一、技能目录 (Catalog)

### 1. GET /skills/catalog — 列出目录技能

解析配置目录下所有 `SKILL.md` 的 YAML frontmatter。

**响应：**
```json
{
  "status": true,
  "data": [{"slug": "...", "name": "...", "description": "...", "compatibility": "..."}]
}
```

### 2. POST /skills/catalog/upload — 上传目录技能

**Form 参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | .zip 文件，≤32MB，内含单目录 + SKILL.md |
| slug | string | 否 | 若 zip 根目录无 SKILL.md 则必填 |

**响应：**
```json
{"status": true, "message": "上传成功", "data": {"slug": "...", "name": "..."}}
```

### 3. GET /skills/catalog/{slug} — 获取目录技能详情

**路径参数：** `slug`

**响应：** SkillMeta 字段 + `body`（SKILL.md 正文）

### 4. GET /skills/catalog/{slug}/download — 下载目录技能 ZIP

**响应：** `application/zip` 文件流

---

## 二、技能 CRUD（GFS 存储）

### 6. GET /skills — 列出技能（带筛选/分页）

**查询参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| type | string | - | `public` 或 `user` |
| user_id | string | - | type=user 时必填，按 owner_id 过滤 |
| source | string | - | 技能来源：`user` / `higraf` |
| uskills_type | string | - | 用户技能类型：`created` / `imported` |
| page | int | 1 | 页码（1-based） |
| page_size | int | 20 | 每页条数（最大 200） |
| q | string | - | 搜索 name / author / slug |
| tags | string | - | 逗号分隔，如 `"lhasso,word"` |
| sort | string | name | 排序：`name` 或 `time` |
| visibility | string | - | 可见性：`public` / `private` / `team` |

**响应：**
```json
{
  "status": true,
  "data": [{...SkillMeta, "can_edit": true}],
  "pagination": {"page": 1, "page_size": 20, "total": 100, "total_pages": 5, "has_next": true, "has_prev": false}
}
```

### 7. GET /skills/{slug} — 获取技能详情

**路径参数：** `slug`

**响应：** SkillMeta + SkillDetail 合并，包含 `can_edit` 字段。DB 无记录时自动回退到 GFS 读取。

### 8. POST /skills/upload — 上传技能

**认证：** 需要 API Key

**Form 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | UploadFile | 是 | .zip 文件，≤32MB |
| slug | string | 否 | 技能 slug |
| display_name | string | 否 | 显示名称 |
| name | string | 否 | 技能名称 |
| icon | string | 否 | 图标 emoji |
| description | string | 否 | 描述 |
| version | string | 否 | 版本号 |
| changelog | string | 否 | 更新日志 |
| tags | string | 否 | 标签，逗号分隔 |
| visibility | string | 否 | 可见性（默认 public） |
| source | string | 否 | `"imported"` 则设置 uskills_type=imported |
| profile | UploadFile | 否 | 封面图，≤2MB，png/jpg/gif/webp/svg |

**GFS 存储路径：** `user_skills/{user_id}/{slug}.zip`

**响应：**
```json
{
  "status": true,
  "message": "Upload successful",
  "data": {"slug": "...", "name": "...", "uskills_type": "created"}
}
```

### 9. PUT /skills/{slug} — 更新技能

**认证：** 需要 API Key（owner 或 admin）

**路径参数：** `slug`

**Form 参数：** 同上传接口，所有字段均为可选。有 `file` 则重新解析 SKILL.md 并上传 GFS，无 `file` 则仅更新 DB 字段。

**响应：**
```json
{"status": true, "message": "Skill 'xxx' updated", "data": {...}}
```

### 10. DELETE /skills/{slug} — 删除技能

**认证：** 需要 API Key（owner 或 admin）

**路径参数：** `slug`

**操作：** 删除 GFS 文件（higraf 或 user_skills 路径）+ DB 中 SkillMeta 和 SkillDetail 记录。

**响应：**
```json
{"status": true, "message": "Skill 'xxx' deleted", "data": {"slug": "xxx"}}
```

### 11. PUT /skills/{slug}/visibility — 切换可见性

**认证：** 需要 API Key（owner 或 admin）

**路径参数：** `slug`

**查询参数：** `visibility` — `public` / `private` / `team`

**限制：** 不能修改 source=higraf 的同步技能

**响应：**
```json
{"status": true, "message": "Skill 'xxx' visibility set to 'public'", "data": {"slug": "xxx", "visibility": "public"}}
```

### 12. GET /skills/{slug}/download — 下载技能 ZIP

**路径参数：** `slug`

**逻辑：** 从 SkillMeta 读取 source 和 owner_id，解析 GFS 路径后下载。异步增加下载计数。

**响应：** `application/zip` 文件流

### 13. GET /skills/{slug}/profile — 获取封面图

**路径参数：** `slug`

**逻辑：** 依次尝试 user_skills → higraf → public_skills，检查所有允许的扩展名。

**响应：** 图片文件

### 14. GET /skills/{slug}/skill-md — 获取 SKILL.md 内容

**路径参数：** `slug`

**响应：**
```json
{"status": true, "data": {"content": "# SKILL\n\n..."}}
```

---

## 三、技能分享

### 15. POST /skills/{slug}/share — 创建分享链接

**认证：** owner

**路径参数：** `slug`

**查询参数：** `user_id`（必填）

**Form 参数：**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| password | string | - | 访问密码（SHA-256 哈希存储） |
| expires_in_hours | int | 24 | 有效期（1-8760 小时） |

**响应：**
```json
{
  "status": true,
  "data": {"share_id": "...", "has_password": true, "expires_at": "2026-08-26T...", "created_at": "..."}
}
```

### 16. DELETE /skills/{slug}/share/{share_id} — 撤销分享

**认证：** owner

**路径参数：** `slug`, `share_id`

**查询参数：** `user_id`（必填）

**响应：**
```json
{"status": true, "data": {"share_id": "..."}}
```

### 17. GET /skills/{slug}/shares — 列出分享链接

**认证：** owner

**查询参数：** `user_id`（必填）

**响应：**
```json
{
  "status": true,
  "data": [{"share_id": "...", "has_password": true, "expires_at": "...", "expired": false, "access_count": 5}]
}
```

### 18. GET /skills/share/{share_id} — 获取分享技能信息（公开）

**无认证**

**路径参数：** `share_id`

**响应：** 返回技能元数据。过期则 410。

### 19. POST /skills/share/{share_id}/verify — 验证密码（公开）

**无认证**

**Form 参数：** `password`（string）

**响应：** 
```json
{"status": true, "data": {"token": "..."}}
```
返回 HMAC 签名下载 token（有效期 1 小时）。无密码的分享直接返回 token。

### 20. GET /skills/share/{share_id}/download — 下载分享技能（公开）

**查询参数：** `token`（必填，从 /verify 获取）

**响应：** `application/zip` 文件流。异步增加访问计数。

---

## 四、标签管理（管理员）

### 21. GET /skill-tags/ — 列出所有标签

**查询参数：** `operator_user_id`（必填，任意用户）

**响应：**
```json
{"status": true, "data": [{"id": 1, "name": "lhasso", "sort_order": 0}]}
```

### 22. POST /skill-tags/ — 创建标签

**认证：** 管理员

**查询参数：** `operator_user_id`（必填）, `name`（必填）, `sort_order`（默认 0）

**响应：** 返回创建的 SkillTag 对象。重名返回 409。

### 23. PUT /skill-tags/{tag_id} — 更新标签

**认证：** 管理员

**路径参数：** `tag_id`

**查询参数：** `operator_user_id`, `name`（可选）, `sort_order`（可选）

### 24. DELETE /skill-tags/{tag_id} — 删除标签

**认证：** 管理员

**路径参数：** `tag_id`

**查询参数：** `operator_user_id`

---

## 数据模型

### SkillMeta（统一技能元数据表）

| 字段 | 类型 | 说明 |
|------|------|------|
| slug | string | 唯一标识符，如 `my-skill` |
| name | string | 显示名称 |
| icon | string | 图标 emoji |
| version | string | 版本号 |
| description | string | 描述 |
| owner_id | string | 所有者用户 ID |
| author | string | 作者名 |
| visibility | string | public / private / team |
| source | string | user / higraf |
| source_ref | string | 来源引用 |
| uskills_type | string\|null | created / imported / null（仅 source=user 时有效） |
| imported_ref | dict\|null | 收藏引用：`{"origin":"higraf","owner":"...","version":"..."}` |
| tags | string[] | 标签列表 |
| download_count | int | 下载次数 |
| collector_ids | string[] | 收藏者 ID 列表 |
| profile | string | 封面图 URL |

### GFS 存储布局

```
higraf/{slug}.zip              — HiGraf 同步技能（只读）
user_skills/{user_id}/{slug}.zip  — 用户创建/收藏的技能
```

- **公开技能**：通过 `SkillMeta` 查询，下载时按 owner_id 从 `user_skills/{owner_id}/{slug}.zip` 读取
- **收藏技能**：`uskills_type=imported`，`imported_ref` 记录来源信息，不重复存储 ZIP
- **下载计数**：异步更新，不阻塞下载响应