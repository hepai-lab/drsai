# Image Generation Support

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 中 GPT 生图与 prompt-driven 图片资产的接入方式。它服务强风格 hero 图、场景图、产品情境图、概念主视觉和截图再设计，不替代准确图表、原生表格和业务证据。

## 什么时候先读它

**页面需要强主视觉时读它。** 例如开场 hero、章节转场、产品情境、抽象概念视觉、强风格 editorial / Swiss / launch 页面、截图再设计和封面候选图。

**页面承载精确事实时不要先读它。** 财务数字、实验结果、组织结构、路线图、复杂流程和真实 UI 文本应优先走 Office chart、Python figure、diagram、原生表格或真实截图。

## 模块接口

**统一模块名是 `image-generation`。** 它通过 `asset_slot` 接入页面，不直接成为 deck 的主流程。

```yaml
slot_id: "s05_hero_image"
page_role: "main_visual"
asset_type: "image"
content_source: "generated"
module: "image-generation"
backend: "gpt-image-api"
aspect_ratio: "16:9"
crop_policy: "cover_center_safe_area"
editable_expectation: "snapshot_allowed"
input_files:
  - "assets/images/prompts/s05_hero_image.md"
output_files:
  - "assets/images/generated/s05_hero_image_v01.png"
constraints:
  no_page_chrome: true
  no_fake_logo: true
  no_precise_numbers: true
validation_mode: "image_generated"
status: "generated"
```

**推荐目录。**

```text
assets/
  images/
    prompts/
      s05_hero_image.md
    generated/
      s05_hero_image_v01.png
validation/
  image_generation/
    s05_hero_image_review.md
```

## backend

**`gpt-image-api` 用于 agent 可直接调用 API 的场景。** 当前标准脚本是 `scripts/generate_image_asset.py`，它读取 prompt，调用 OpenAI 兼容 Images API，写出图片和同名元数据 JSON。脚本默认模型是 `gpt-image-2`，默认返回格式是 `b64_json`，并支持 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 与 `OPENAINEXT_API_KEY` / `OPENAINEXT_API_BASE`。

**API backend 只生成 slot artifact。** 它不直接改 PPT，不决定页面叙事，不替代 preview 和 visual review。生成后应把图片路径写回 `asset_slot.output_files`，把元数据 JSON 放到 `validation/image_generation/`，再由 build 脚本按 slot 插入 PPT。

**推荐命令如下。**

```bash
python scripts/generate_image_asset.py \
  --prompt-file assets/images/prompts/s05_hero_image.md \
  --out assets/images/generated/s05_hero_image_v01.png \
  --metadata-out validation/image_generation/s05_hero_image.metadata.json \
  --slot-id s05_hero_image \
  --page-role main_visual \
  --aspect-ratio 16:9 \
  --crop-policy cover_center_safe_area \
  --model gpt-image-2 \
  --size 1536x864 \
  --quality low
```

**API 配置不应进入文档或 metadata。** 密钥只从环境变量、命令行或 `.env` 读取，脚本只记录 `base_url_set` 和配置来源，不记录 value。使用中转站时优先通过 `.env` 提供 `OPENAINEXT_API_BASE` 与 `OPENAINEXT_API_KEY`。

**`manual-web` 用于用户在 ChatGPT 网页端生图的场景。** agent 写出 prompt 文档，把 slot 状态标记为 `pending_user_generation`，等用户把图片放回 `assets/images/generated/` 后，再登记 `output_files` 并继续组装 PPT。

**`external-image` 用于用户提供生成图或授权图的场景。** 这类图片仍应绑定到同一个 slot，并记录来源、授权边界、裁切策略和复核结论。

## prompt 文档

**prompt 文档应能独立执行。** 用户打开 `assets/images/prompts/<slot_id>.md` 后，应能直接复制 prompt 到网页端生成候选图。

**推荐结构如下。**

```md
# <slot_id> Image Prompt

## Slide Context
- 页面标题：
- 页面任务：
- 视觉角色：
- 目标风格：

## Prompt
<用自然语言写出画面、构图、风格、色彩、比例、安全区和禁止项。>

## Negative Constraints
- 不要生成页眉、页脚、页码、PPT 标题栏或浏览器窗口边框。
- 不要生成虚假 logo、虚假 UI、无法核验的文字和精确数字。
- 不要把大段中文或英文写进图片里；文字应由 PPT 原生文本承载。

## Output Registration
- 生成后保存到：`assets/images/generated/<slot_id>_v01.png`
- 如果有多个候选，使用 `_v02`、`_v03` 后缀。
```

## 画面约束

**比例先跟 PPT slot 对齐。** 常见值是 `16:9`、`4:3`、`1:1`、`3:2`、`21:9`。hero 背景默认用 `16:9` 或 `21:9`，卡片配图可用 `4:3` 或 `1:1`。

**安全区必须写进 prompt。** PPT 会叠加标题、数据、标签或 logo 时，prompt 应指定主体避开文字区，例如“左侧 35% 保持低纹理暗色留白”或“顶部 18% 不放主体和高对比细节”。

**裁切策略要显式。** 推荐值包括 `cover_center_safe_area`、`contain_no_crop`、`crop_top_safe`、`crop_left_safe`。需要检查最终 preview，而不是只相信图片本身。

**图片不应自带页面 chrome。** 不要生成 PPT 页眉、页脚、页码、标题栏、图例、chart、表格、浏览器边框或看似品牌模板的装饰条。页面系统由 PPT 原生对象负责。

## 事实与文字复核

**生图默认不承载事实。** 精确数字、结论、图表、财务指标、实验结果、组织名称、真实人物和真实品牌标识应由可复核来源或 PPT 原生对象承载。

**所有图中文字都要复核。** 如果图片生成了不可控文字、乱码、假 logo、虚假数字或误导性界面，应重新生成或裁切，不要把它当成可接受瑕疵。

**截图再设计必须保留来源。** 如果以真实产品截图为输入，应记录原图路径、允许变更范围和不得改动的事实区域。UI 文本需要保真时，优先用真实截图 + PPT 原生标注，而不是让模型重画全部界面。

## 验证要求

**最低证据包括四项。**
- prompt 文档路径
- backend 与参数记录
- 输出文件路径
- 事实、文字、安全区、裁切和页面 chrome 复核结论

**API backend 的最低文件证据。** `gpt-image-api` backend 至少要留下图片文件和 metadata JSON。metadata 记录 prompt、model、size、quality、output format、response source、slot id、输出路径和耗时，不记录密钥和图片正文。

**`pending_user_generation` 不是失败。** manual web backend 下，等待用户生成图片是正常中间状态，但不能把它伪装成 `generated` 或 `validated`。

**插入 PPT 后必须看 preview。** 图片本身通过不代表页面通过。最终检查应确认文字没有压在高纹理区域，主体没有被裁掉，图片边界没有触墨，画面风格与 deck profile 一致。
