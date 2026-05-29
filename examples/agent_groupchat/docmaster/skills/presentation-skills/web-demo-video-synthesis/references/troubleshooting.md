# 常见故障排查（timeline 驱动路线）

## 1. 视频里只有一块象限有画面，其余是灰色/黑色

高概率原因：
- `viewport` / `record-size` / `deviceScaleFactor` 组合不一致，导致录制管线在 pad/crop/scale 上出现错误贴图。
- 后期又做了一次不必要的 scale/pad，叠加造成只剩“一个象限有内容”。

检查顺序：
1. 先确认录屏母带分辨率：`ffprobe` 看 `video_from_timeline*.webm` 的 `width/height`。
2. 确认 `record-size` 与最终输出比例一致（通常都用 16:9）。
3. 暂时去掉任何额外缩放滤镜，只做最小必要的转码。
4. 复查是否把 `viewport` 拉到了 4K（容易导致“网页在大画布里变小”，误判为“画面错了”）。

## 2. 从中途开始字幕消失

高概率原因：
- 字幕源混入导演提示/操作建议，导致文本异常或时间线不连续。
- `.srt` 时间戳格式错误或 `end <= start`。

检查顺序：
1. 校验 `cues.json` 是否仅包含台词（不含“Pause/Scroll/Highlight”）。
2. 用 `timeline.json` 生成 `.srt`（避免人工手写时间戳）。
3. 打开 `.srt`，确认每段 `start/end` 单调递增且间隔合理。

## 3. 字幕框超出左右边界

高概率原因：
- 单条字幕太长，超出播放器安全区。
- 字体过大，或 margin/对齐不适合当前 UI 布局。
- 页面 zoom 后，原先“刚好”的字幕样式会越界。

处理建议：
- 缩短单条字幕（拆成两段 cues，而不是硬塞一条长句）。
- 降低字体大小（例如 16 -> 13）并微调底边距（`MarginV`）。
- 显式设置左右安全区（`MarginL` / `MarginR`），竖屏时建议明显大于横屏。
- 启用自适应换行并调小每行宽度（`--subtitle-auto-wrap true --subtitle-wrap-max-units 36~46`）。
- 不要把字幕框做得太宽：宁可多换行，也别顶到左右边界。

推荐参数（竖屏）：
- `--subtitle-font-size 10~12`
- `--subtitle-margin-v 28~72`
- `--subtitle-margin-l 96~140`
- `--subtitle-margin-r 96~140`

## 3.1 横屏里“怎么调边距都不生效/还是老样子换行”

现象：
- 你调小了 `MarginL/R`，但字幕宽度看起来几乎不变，换行频率也没明显下降。

高概率原因：
- SRT 里已经写入了“硬换行”（例如之前用较小 `wrap-max-units` 生成过，或启用了 `--wrap-max-lines 2`）。
- 这种情况下播放器只能按你写死的分行显示，再大的显示区也用不上。

处理建议（按顺序）：
1. 重新生成 SRT，避免过早硬换行：
   - 用更大的 `--wrap-max-units`（如 `140~180`）
   - `--wrap-max-lines 0`
2. 再调烧录样式：减小 `MarginL/R`（如 `8~40`），`FontSize` 维持可读范围（如 `13~16`）。
3. 抽帧对比同一时刻（A/B），确认“行宽是否变长”后再跑全片，避免盲目重编码。

横屏 4K 起步值（可复用）：
- `--subtitle-font-size 14`
- `--subtitle-margin-v 24`
- `--subtitle-margin-l 8`
- `--subtitle-margin-r 8`
- `--subtitle-wrap-max-units 170`
- `--subtitle-wrap-max-lines 0`

## 4. 清晰度没有明显提升

高概率原因：
- 录制源仍是低有效像素，后期只加码率/转封装无法变清晰。
- `viewport` 拉大导致网页主体变小，看起来“更糊”。
- 输出像素高但渲染密度低（dsf 小），文字边缘仍糊。

处理建议：
1. 提高 `record-size`。
2. 提高 `deviceScaleFactor`（例如从 1 到 1.5/2）。
3. 保持 `viewport` 与演示习惯一致（通常 1920x1080），优先用 `dsf + record-size` 提升细节。
4. 确认网页内容确实填满主要可视区，而不是“小页面嵌在大画布”。
5. 若目标是真 4K，优先尝试：`viewport=1920x1080 + dsf=2 + record-size=3840x2160`。

## 5. 播放器里看着糊，但参数看起来很高

可能原因：
- 播放器缩放策略、显示器缩放、预览窗口过小导致主观模糊。
- 视频被平台二次转码，在线预览默认选择了低码率档位。

处理建议：
- 使用原始分辨率 1:1 播放检查。
- 同时对比截图（100% 缩放）观察文字边缘。
- 如果对“清晰度是否提升”仍有分歧，抽帧做 A/B 对比（同一时刻、同一显示尺寸下比较文字边缘）。

## 6. 录屏阶段叠加字幕/字幕样式不受控

现象：
- 录屏阶段就把字幕画在页面上，结果字幕被页面重绘/语言切换影响，或位置被 UI 遮挡。

推荐做法：
- 录屏输出“无字幕母带”（`--no-captions true`）。
- 最终合成阶段统一用 ffmpeg 烧录字幕（可控、可复现、可调样式）。

## 8. 页面滚动“就位”慢于语音开始（画面晚到）

现象：
- 下一段语音开始时，页面还在滚动或还没滚到对应章节（观感像“声画不同步”）。

高概率原因：
- timeline 里滚动触发点离下一段开声太近，导致页面还在滚动就开声。
- 段间缓冲（`inter_gap_sec`）或滚动后缓冲（`scroll_lag_sec`）预算过小。

处理建议：
- 优先从 timeline 入手：提高 `tts_build_workspace.py` 的 `--scroll-lag-sec` 或 `--inter-gap-sec`（让下一段开声更晚，保证滚动就位）。
- 录屏层面再补充：提高 `record_demo_from_timeline.mjs` 的 `--scroll-settle-ms`（只影响录屏等待，不改变音轨时间）。

## 7. ffmpeg 能跑但不支持字幕滤镜/MP4 参数

高概率原因：
- 使用了精简版 ffmpeg（例如某些工具自带的 ffmpeg），缺少 `libass` / `libx264` / `-preset` 等能力。

处理建议：
- 使用完整版 ffmpeg（本仓库环境可用：`conda run -n prts ffmpeg`）。

## 12. 报错“未找到 ffmpeg”，但你确信装了

现象：
- `mix_audio_from_timeline.py` 或其他步骤提示 `未找到 ffmpeg`。

高概率原因：
- 你安装了 ffmpeg，但它不在当前 shell 的 `PATH` 里（常见于 conda/自定义安装）。

处理建议：
1. 显式指定 ffmpeg 路径（推荐，最可复现）：
   - `python3 scripts/mix_audio_from_timeline.py --ffmpeg /path/to/ffmpeg ...`
   - `bash scripts/make_demo_video.sh --ffmpeg /path/to/ffmpeg ...`
2. 或把 ffmpeg 加入 PATH：
   - conda 常见：`export PATH="$CONDA_PREFIX/bin:$PATH"`

补充：
- 有些环境 `ffprobe` 也不在 PATH。若你需要看视频宽高/时长，可以：
  - 用同目录下的 `ffprobe`（如果存在），或
  - 直接 `ffmpeg -i your_video.mp4` 从输出里读取 metadata。

## 9. 成片画面是 Not Found / JSON / 不是你想录的网页

现象：
- 录出来的视频显示 `Not Found`、一段 JSON（例如 `{"detail":"Not Found"}`）、或明显不是目标网页。

高概率原因：
- `record_url` 指向了错误的服务（最常见：端口被占用，访问到了别的本地服务）。
- `record_url` 其实是一个 API endpoint，而不是页面入口（Content-Type 是 `application/json`）。
- 服务没有启动/启动失败，但 URL 仍可访问到“错误页面”（例如反向代理/默认站点）。

处理建议（推荐按强度从低到高）：
1. 先用 curl 看响应头是否像网页：
   - `curl -fsSI http://127.0.0.1:6150/demo | rg -n \"HTTP/|content-type\"`
2. 开启录屏前置校验（避免“看起来成功”）：
   - `record_demo_from_timeline.mjs` 默认 `--fail-on-json true`：如果返回 JSON 会直接失败。
   - 强烈建议加 `--expect-selector \"#step-hero\"` 或 `--expect-title-includes \"YourTitle\"`，确保确实命中目标页面。
3. SPA/持续请求页面若卡在打开阶段：
   - 改用 `--wait-until domcontentloaded`（避免 `networkidle` 等不到）。

补充检查：
- 若 `python -m http.server 6150` 启动失败 `Address already in use`，说明端口已被占用。
- 先执行 `lsof -iTCP:6150 -sTCP:LISTEN -n -P` 确认占用进程，再换成未占用端口（例如 `6277`），并同步更新 `record_url`。

## 11. 每段都在滚动，但画面看起来“没翻页”

现象：
- 语音在走、滚动也在走，但视觉上像“一屏塞了很多内容”，翻页节奏不明显。

高概率原因：
- 单个页面承载了过多内容，导致一次滚动仍然看到多个主题。
- section 高度不足（小于或接近一个屏高），页面锚点切换缺少“翻页感”。

处理建议：
1. 结构设计按“每页一主题”拆分：一段旁白对应一个 section。
2. 每个 section 至少占满一屏（常见做法：`min-height: 100vh`）。
3. 控制每页信息量：标题 + 1~3 个关键点，避免密集长段落。
4. 竖屏项目优先以移动端画幅设计，先看 9:16 再做桌面端兼容。

## 10. 没有 TTS 秘钥，如何先跑通视频流水线？

推荐优先级：
1. 优先找人类拿到先进 TTS API 的秘钥/Token（本 skill 默认提供阿里云 ISI REST 实现）。
2. 如果确实暂时拿不到，可以显式使用本地替代（例如 macOS `say`）先把录屏/字幕/合成跑通。

示例（macOS）：
- `python3 scripts/tts_build_workspace_macos_say.py --workspace-dir ... --cues-json ...`
