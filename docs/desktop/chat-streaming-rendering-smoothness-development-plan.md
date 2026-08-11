# Desktop 聊天流式渲染丝滑度改造方案

## 1. 背景与结论

OpenDrSai 的模型输出和 IPC/SSE 吞吐并不慢，顿感主要来自展示链路：流式消息每帧变化时会重新解析当前 Markdown，消息高度随之离散增长；聊天列表随后直接修改 `scrollTop` 跳到新底部。网络分片的不均匀、Markdown 布局和硬滚动叠加后，会形成“输出很快但一顿一顿”的观感。

本方案参考 Chatbox 公开实现（研究基线：`chatboxai/chatbox@81571269`），但按 OpenDrSai 当前架构分阶段落地，不引入新的协议耦合。

## 2. 参考实现要点

Chatbox 的平滑感来自三层协作：

1. delta 先累积，再用 `requestAnimationFrame` 合并 React 状态更新；
2. 只给最近追加的文本区间应用约 300ms 的透明度和 2px 位移动画；
3. 监听内容高度增长，一帧最多重定向一次原生平滑滚动；用户主动向上滚动后立即暂停跟随，到达底部后恢复。

OpenDrSai 已有第 1 层：`useDesktopChatAdapter` 用 `pendingDeltasByRequest` 和 `requestAnimationFrame` 合并 delta。第一阶段因此聚焦第 2、3 层。

## 3. 目标与非目标

目标：消除流式期间的硬滚动跳跃；只动画新增文本；用户浏览历史时不被拉回；尊重 `prefers-reduced-motion`；保持 OAEP、SSE、IPC 和最终 Markdown 语义不变。

第一阶段不更改后端分片、不引入固定逐字延迟、不替换虚拟列表，也不拆分 Markdown 稳定区和流式尾部。

## 4. 分阶段实施

### P0：视觉和滚动平滑化

- 新增独立平滑跟随控制器；
- 基于滚动方向、内容高度和底部容差维护 following 状态；
- 高度增长时通过 RAF 合帧并使用原生 smooth scroll；
- 用户向上滚动时中止现有平滑滚动并暂停自动跟随；
- 在 Markdown HAST 中仅包装最近追加的普通文本区间；
- 新增区间使用 300ms `ease-out` 淡入和 2px 上移；
- 代码和 `pre` 节点不参与动画。

### P1：Markdown 渲染成本治理

- 将完整内容拆为稳定 Markdown 区和正在增长的 tail；
- 稳定区按完整段落、闭合代码围栏等边界提交；
- tail 使用轻量渲染，并以 50～80ms 的预算提交 Markdown；
- 流结束时执行一次权威完整渲染；
- 记录长回答下 Markdown 解析、React commit 和 layout 的 P50/P95。

### P2：显示节奏与长会话

- 仅在真实分片抖动仍明显时增加自适应显示缓冲区；
- 首字立即显示，积压越多每帧追赶越快，结束后 180ms 内排空；
- 使用 grapheme 边界；
- 评估成熟动态高度虚拟列表。

## 5. 验收标准

- 连续流式文本时，每帧最多一次消息提交、一次跟随滚动请求；
- 用户向上滚动后，后续 delta 不改变其阅读位置；
- 用户回到底部或点击“回到最新消息”后恢复跟随；
- 新内容淡入不会使旧内容重新闪烁；
- 代码块不应用逐片段淡入；
- reduced-motion 模式无淡入动画且滚动即时；
- Windows renderer TypeScript 和现有聊天验证通过。

## 6. 实施台账

| 阶段 | 项目 | 状态 |
| --- | --- | --- |
| P0 | 平滑跟随控制器 | 已实施 |
| P0 | ChatWorkspace 高度驱动滚动接入 | 已实施 |
| P0 | Markdown 新增文本区间淡入 | 已实施 |
| P0 | reduced-motion 兼容 | 已实施 |
| P0 | TypeScript 与相关验证 | 已通过（`typecheck:web`、`verify:chat-output`、`verify:structured-renderer`、`verify:architecture`、Windows production build） |
| P1 | 稳定 Markdown + streaming tail | 已实施（围栏外完整块边界） |
| P1 | 64ms Markdown 提交预算 | 已实施（首批立即显示，结束时权威内容立即排空） |
| P1 | 性能指标采集 | 已实施（Markdown render、commit-layout 有界样本及 P50/P95） |
| P2 | 自适应显示缓冲区 | 已实施（按积压动态追赶，目标 3 个预算周期内排空） |
| P2 | grapheme 安全切分 | 已实施（`Intl.Segmenter`，兼容回退） |
| P2 | 动态高度虚拟列表评估 | 已完成：保留现有 IntersectionObserver + ResizeObserver + 高度缓存方案 |

## 7. P2 虚拟列表评估结论

当前 `VirtualizedMessage` 已具备本阶段需要的三个关键能力：视口外卸载、`ResizeObserver` 动态高度测量，以及消息高度缓存占位；流式消息和末尾 12 条消息保持 pinned，避免活跃内容被卸载。引入 `react-virtuoso` 会增加依赖、滚动状态迁移和长会话回归面，却不会补上当前缺失的核心能力。因此本阶段保留现有实现，并把其结构纳入 `verify:chat-output` 回归契约；后续只有在真实 P95 数据显示虚拟化本身成为热点时才重新评估替换。

## 8. 完成状态

P0、P1、P2 均已完成。权威消息状态不经过显示缓冲；缓冲仅作用于渲染投影，因此复制、持久化、语音流、完成状态和 OAEP 顺序不受影响。流式结束或 reduced-motion 启用时直接使用权威完整内容。

### 自动滚动竞态修复

后续实机验证发现，原生 smooth scroll 的第一个中间滚动事件可能离底部仍超过 80px，被早期保护逻辑误判为用户上滑，导致 following 关闭；同时流结束时缓冲排空和代码高亮可能继续改变最后一条消息高度。现已改为显式捕获 wheel、触摸、滚动条和向上导航按键的用户意图，程序化滚动期间不再根据“首次离底部”推断用户操作；最后一条消息由 `ResizeObserver` 持续驱动跟随，并在流结束 360ms 后进行一次受 following 状态保护的精确贴底。
