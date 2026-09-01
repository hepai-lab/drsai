# Skills API 文档

**Base URL:** `https://drsaiv2.ihep.ac.cn/api`

**鉴权方式:** 所有接口统一通过 `Authorization` header 传递 API Key：

```
Authorization: Bearer <your_api_key>
```

---

## 1. 列出全部技能

```
GET /skills?type=public
```

**鉴权：** 需要 API Key

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 否 | `public` 或 `user` |
| `source` | string | 否 | `user` / `higraf` |
| `uskills_type` | string | 否 | `created` / `imported`（仅 source=user 时有效） |
| `tags` | string | 否 | 逗号分隔，如 `LHAASO,科研` |
| `q` | string | 否 | 搜索 name / author / slug |
| `sort` | string | 否 | `name`（默认）/ `time` |
| `visibility` | string | 否 | `public` / `private` / `team` |
| `page` | int | 否 | 页码，1-based，默认 1 |
| `page_size` | int | 否 | 每页条数，最大 200，默认 20 |

### 示例

```bash
# 基础调用
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 分页
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&page=2&page_size=5" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 按标签筛选
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&tags=LHAASO,科研" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 搜索 + 按时间排序
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&q=计算&sort=time" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 按来源过滤
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&source=user" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 全参数组合
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=public&source=user&tags=LHAASO&q=skill&sort=time&page=1&page_size=10" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool
```

### 响应

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
      "owner": "yqsun@ihep.ac.cn",
      "owner_id": "yqsun@ihep.ac.cn",
      "author": "张三",
      "visibility": "public",
      "source": "user",
      "uskills_type": "created",
      "tags": ["测试", "skill"],
      "downloads": 0,
      "profile": "/api/skills/ceshi/profile",
      "created_at": "2026-08-27T12:00:00",
      "updated_at": "2026-08-27T12:00:00",
      "can_edit": true
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
}
```

---

## 2. 列出我的技能

```
GET /skills?type=user
```

**鉴权：** 需要 API Key

> 只能查看当前 API Key 对应用户的技能，无法查看他人。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | **是** | `user` |
| `uskills_type` | string | 否 | `created` / `imported` |
| `tags` | string | 否 | 逗号分隔 |
| `q` | string | 否 | 搜索 name / author / slug |
| `sort` | string | 否 | `name` / `time` |
| `visibility` | string | 否 | `public` / `private` / `team` |
| `page` | int | 否 | 页码，默认 1 |
| `page_size` | int | 否 | 每页条数，默认 20 |

### 示例

```bash
# 列出我的全部技能
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 只看我创建的
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user&uskills_type=created" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool

# 只看我收藏的
curl -s "https://drsaiv2.ihep.ac.cn/api/skills?type=user&uskills_type=imported" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool
```

---

## 3. 上传 Skill

```
POST /skills/upload
```

**鉴权：** 需要 API Key（owner 或 admin）  
**Content-Type:** `multipart/form-data`

### 表单参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | **是** | .zip 文件，≤32MB，内含 SKILL.md |
| `slug` | string | 否 | 技能 slug，不传则从 SKILL.md 的 name 自动生成 |
| `display_name` | string | 否 | 显示名称 |
| `name` | string | 否 | 同 display_name |
| `icon` | string | 否 | 图标 emoji |
| `description` | string | 否 | 描述 |
| `version` | string | 否 | 版本号 |
| `changelog` | string | 否 | 更新日志 |
| `tags` | string | 否 | 标签，逗号分隔 |
| `visibility` | string | 否 | `public`（默认）/ `private` / `team` |
| `source` | string | 否 | `"imported"` 则标记为收藏技能 |
| `profile` | File | 否 | 封面图，≤2MB，png/jpg/gif/webp/svg |

### 示例

```bash
# 基础上传
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/upload" \
  -H "Authorization: Bearer <your_api_key>" \
  -F "file=@ceshi.zip"

# 上传 + 指定元数据
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/upload" \
  -H "Authorization: Bearer <your_api_key>" \
  -F "file=@ceshi.zip" \
  -F "slug=ceshi" \
  -F "display_name=测试技能" \
  -F "icon=package" \
  -F "description=一个测试技能" \
  -F "version=1.0.0" \
  -F "changelog=初始版本" \
  -F "tags=测试,skill" \
  -F "visibility=public" \
  -F "profile=@cover.png"
```

### 响应

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
    "tags": ["测试", "skill"],
    "visibility": "public",
    "uskills_type": "created"
  }
}
```

---

## 4. 更新 Skill

```
PUT /skills/{slug}
```

**鉴权：** 需要 API Key（owner 或 admin）  
**Content-Type:** `multipart/form-data`

> 所有参数均为可选，只传需要更新的字段即可。

### 表单参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 否 | 新的 .zip 文件，≤32MB |
| `display_name` | string | 否 | 显示名称 |
| `name` | string | 否 | 同 display_name |
| `icon` | string | 否 | 图标 emoji |
| `description` | string | 否 | 描述 |
| `version` | string | 否 | 版本号 |
| `changelog` | string | 否 | 更新日志 |
| `tags` | string | 否 | 标签，逗号分隔 |
| `visibility` | string | 否 | `public` / `private` / `team` |
| `profile` | File | 否 | 封面图，≤2MB |

### 示例

```bash
# 只更新标签
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi" \
  -H "Authorization: Bearer <your_api_key>" \
  -F "tags=测试,skill,新标签"

# 更新多个字段
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi" \
  -H "Authorization: Bearer <your_api_key>" \
  -F "name=新名称" \
  -F "description=新描述" \
  -F "visibility=private" \
  -F "changelog=修复了bug"

# 替换技能文件
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi" \
  -H "Authorization: Bearer <your_api_key>" \
  -F "file=@ceshi_v2.zip" \
  -F "changelog=升级到 v2.0"
```

### 响应

```json
{
  "status": true,
  "message": "Skill 'ceshi' updated",
  "data": {
    "slug": "ceshi",
    "name": "新名称",
    "icon": "package",
    "version": "1.0.0",
    "description": "新描述",
    "owner": "yqsun@ihep.ac.cn",
    "owner_id": "yqsun@ihep.ac.cn",
    "visibility": "private",
    "tags": ["测试", "skill", "新标签"],
    "updated_at": "2026-08-27T14:00:00"
  }
}
```

---

## 5. 获取 Skill 详情

```
GET /skills/{slug}
```

**鉴权：** 需要 API Key

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 否 | `public` |

### 示例

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills/ceshi?type=public" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool
```

### 响应

```json
{
  "status": true,
  "data": {
    "slug": "ceshi",
    "name": "测试技能",
    "icon": "package",
    "version": "1.0.0",
    "description": "一个测试技能",
    "owner": "yqsun@ihep.ac.cn",
    "owner_id": "yqsun@ihep.ac.cn",
    "author": "张三",
    "visibility": "public",
    "source": "user",
    "uskills_type": "created",
    "tags": ["测试", "skill"],
    "downloads": 0,
    "profile": "/api/skills/ceshi/profile",
    "created_at": "2026-08-27T12:00:00",
    "updated_at": "2026-08-27T12:00:00",
    "can_edit": true,
    "body": "# SKILL\n\n技能正文内容...",
    "changelog": "初始版本",
    "author_email": null,
    "author_id": null,
    "required_tools": [],
    "detail_raw": null
  }
}
```

---

## 6. 删除 Skill

```
DELETE /skills/{slug}
```

**鉴权：** 需要 API Key（owner 或 admin）

### 示例

```bash
curl -X DELETE "https://drsaiv2.ihep.ac.cn/api/skills/ceshi" \
  -H "Authorization: Bearer <your_api_key>"
```

### 响应

```json
{
  "status": true,
  "message": "Skill 'ceshi' deleted",
  "data": {
    "slug": "ceshi"
  }
}
```

---

## 附加接口

### 下载 Skill ZIP

```
GET /skills/{slug}/download
```

**鉴权：** 需要 API Key

```bash
curl -o ceshi.zip "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/download" \
  -H "Authorization: Bearer <your_api_key>"
```

### 切换可见性

```
PUT /skills/{slug}/visibility?visibility=public
```

**鉴权：** 需要 API Key（owner 或 admin）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `visibility` | string | **是** | `public` / `private` / `team` |

```bash
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/visibility?visibility=public" \
  -H "Authorization: Bearer <your_api_key>"
```

### 获取 SKILL.md 内容

```
GET /skills/{slug}/skill-md
```

**鉴权：** 需要 API Key

```bash
curl -s "https://drsaiv2.ihep.ac.cn/api/skills/ceshi/skill-md" \
  -H "Authorization: Bearer <your_api_key>" | python -m json.tool
```

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误（slug 格式无效、文件类型错误等） |
| 401 | 未鉴权（缺少或无效 API Key） |
| 403 | 无权限（不是 owner/admin） |
| 404 | 技能不存在 |
| 413 | 文件过大 |
| 422 | SKILL.md 格式无效 |
| 500 | 服务器内部错误 |
| 502 | API Key 验证服务不可用 |