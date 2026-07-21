# Skills 公共云盘 API 接口示例

> 域名: `https://drsaiv2.ihep.ac.cn`
>
> 认证方式: API Key 通过 `?api_key=xxx` 传入，读接口可省略，写接口必须有 contributor+ 权限

---

## 1. 获取技能列表

**GET** `/api/skills/public`

无需认证，列出所有已发布的公共技能。

```bash
curl -X GET "https://drsaiv2.ihep.ac.cn/api/skills/public"
```

---

## 2. 获取技能详情

**GET** `/api/skills/public/{slug}`

返回单个技能的完整信息，包含 SKILL.md 正文、changelog、下载量等。可传 `api_key` 获取 `can_edit` 字段。

```bash
# 无需认证
curl -X GET "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill"

# 带认证（可获取 can_edit 权限标识）
curl -X GET "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill?api_key=sk-xxx"
```

---

## 3. 上传技能

**POST** `/api/skills/public/upload`

需要 contributor+ 权限。`file` 必传（zip 包），`slug` 可选（不传则自动从 SKILL.md 的 name 生成）。

```bash
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/public/upload?api_key=sk-xxx" \
  -F "file=@/path/to/your-skill.zip"

# 指定 slug
curl -X POST "https://drsaiv2.ihep.ac.cn/api/skills/public/upload?api_key=sk-xxx" \
  -F "file=@/path/to/your-skill.zip" \
  -F "slug=my-custom-slug"
```

---

## 4. 更新技能

**PUT** `/api/skills/public/{slug}`

需要是技能 owner 或 admin。所有字段可选，只传需要修改的字段即可。

```bash
# 只更新 changelog
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill?api_key=sk-xxx" \
  -F "changelog=修复了挂载路径问题"

# 更新多个元信息
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill?api_key=sk-xxx" \
  -F "name=新名称" \
  -F "description=更新后的描述" \
  -F "version=1.0.0"

# 替换 zip 包
curl -X PUT "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill?api_key=sk-xxx" \
  -F "file=@/path/to/new-skill.zip"
```

---

## 5. 删除技能

**DELETE** `/api/skills/public/{slug}`

需要是技能 owner 或 admin。

```bash
curl -X DELETE "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill?api_key=sk-xxx"
```

---

## 6. 下载技能

**GET** `/api/skills/public/{slug}/download`

直接下载 zip 包，无需认证。

```bash
curl -X GET "https://drsaiv2.ihep.ac.cn/api/skills/public/ihep-gfs-skill/download" \
  -o ihep-gfs-skill.zip
```

---

## 上传包结构要求

zip 包内必须包含 `SKILL.md`，格式如下：

```markdown
---
name: my-skill-name
description: 技能描述
icon: package
version: 1.0.0
compatibility: ">=2.0.0"
---

## 技能介绍

这里是技能正文内容...
```

> `slug` 默认从 `name` 字段自动生成（小写 + 替换特殊字符为 `-`）
