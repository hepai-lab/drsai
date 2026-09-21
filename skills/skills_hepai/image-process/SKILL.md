---
name: image-process
description: 仅在没有 Host 工具 image_generation / image_edit 时，才用本技能做画图、图像生成或图像编辑。OpenDrSai Desktop 已注入上述 Host 工具时，禁止加载本技能，必须直接调用 image_generation 或 image_edit。
---

# 重要（Desktop / 已注入 Host 工具时）

若当前工具列表中已有 `image_generation` 或 `image_edit`：

1. **不要**加载本技能  
2. **不要**运行下面的 Python 脚本或自写 HTTP 调用  
3. **直接**调用 Host 工具 `image_generation` / `image_edit`（模型与凭证由 Host / Agent 设置处理）

只有在确认工具列表中**没有**这两个 Host 工具时，才使用下文脚本路径。

---

使用 `scripts/image_generation_openai.py` 进行图像生成（仅无 Host 工具时）。

## 快速使用示例

```bash
python image_generation_openai.py --prompt "一只可爱的海獭"
python image_generation_openai.py -p "日落海边" -n 2 -s 1024x1792
python image_generation_openai.py -p "科技风格logo" --quality high
```

## 查看可用模型

运行以下命令查看所有可用的图像生成模型：

```bash
python scripts/list_models.py
```

## 主要支持的图像生成模型

### OpenAI 系列
- `openai/gpt-image-1` - 基础图像生成模型
- `openai/gpt-image-1-mini` - 轻量版本
- `openai/gpt-image-1.5` - 增强版本
- `openai/gpt-image-2` - 最新版本（默认）
- `openai/chatgpt-image-latest` - 最新ChatGPT图像
- `openai/dall-e-3` - DALL-E 3

### 字节跳动豆包系列
- `bytedance/doubao-seedream-5-0-260128` - 豆包5.0图像生成
- `bytedance/doubao-seedream-4-5-251128` - 豆包4.5图像生成
- `bytedance/doubao-seedream-3-0-t2i-250415` - 豆包3.0图像生成
- `bytedance/doubao-seedream-5-0-lite-260128` - 豆包5.0轻量版
- `bytedance/doubao-seedance-2-0-260128` - 豆包视频生成2.0

### 阿里云通义系列
- `aliyun/qwen-image-2.0` - 通义2.0图像生成
- `aliyun/qwen-image-2.0-pro` - 通义专业版
- `aliyun/qwen-image-2.0-max` - 通义最大值
- `aliyun/qwen-image-2.0-plus` - 通义增强版
- `aliyun/qwen-image-edit` - 通义图像编辑
- `aliyun/qwen-image-edit-plus` - 通义图像编辑增强版

### Google Gemini 系列
- `google/gemini-2.5-flash-image` - Gemini 2.5 图像生成
- `google/gemini-3-pro-image-preview` - Gemini 3 图像预览

### xAI Grok 系列
- `xAI/grok-2-image` - Grok 2 图像生成
- `xAI/grok-imagine-image` - Grok 图像想象

## 使用不同模型生成图像

```bash
# 使用 OpenAI GPT-Image 1.5
python image_generation_openai.py -p "未来城市景观" -m "openai/gpt-image-1.5"

# 使用豆包5.0
python image_generation_openai.py -p "未来城市景观" -m "bytedance/doubao-seedream-5-0-260128"

# 使用通义专业版
python image_generation_openai.py -p "未来城市景观" -m "aliyun/qwen-image-2.0-pro"
```

## API 信息

- **图像生成端点**: `https://aiapi.ihep.ac.cn/apiv2/v1/images/generations`
- **文件上传端点**: `https://aiapi.ihep.ac.cn/apiv2`
- **环境变量**: `HEPAI_API_KEY`

## 输出格式

生成完成后，图像会自动上传到 HepAI 并提供可访问的 URL。

**必须使用以下格式输出图像，不要加```等符号：**

![图片描述](https://example.com/image.png)

## 其他参数

- `-n`: 生成图像数量 (1-10)
- `-s`: 图像尺寸 (1024x1024, 1536x1536, 1024x1792, 1792x1024)
- `-q`: 图像质量 (low, medium, high, auto)
- `-b`: 背景类型 (opaque, transparent)
- `-o`: 自定义输出文件路径
- `--no-upload`: 不上传到 HepAI（仅保存本地文件）
