# DrSai TUI — UX 问题清单与实验方案

> 本文档以 **TUI 终端用户的真实使用体验** 为出发点，梳理当前 `apps/ui-tui` 在交互、流畅度、可达性、终端兼容性等方面存在的问题，并给出每个问题的：
>
> 1. **复现路径**：用户在什么场景下能感知到？
> 2. **根因定位**：在哪一段代码、哪一个机制层（Ink / Node / 终端 emulator）导致？
> 3. **影响等级**：P0 致命 / P1 严重 / P2 一般 / P3 优化
> 4. **实验方案**：可独立执行验证的改造步骤、A/B 对照、度量指标
>
> 所有方案均围绕 React + Ink 6 + Node 20 现有技术栈展开，不引入新的渲染库。
>
> 文档面向：TUI 维护者、做体验回归的同学、参与 P1/P2 改造的开发者。

---

## 目录

- [一、问题总览](#一问题总览)
- [二、用户主诉问题](#二用户主诉问题)
  - [P1-01 流式输出期间，向上拖动终端滚动条会被强制弹回底部](#p1-01-流式输出期间向上拖动终端滚动条会被强制弹回底部)
  - [P1-02 上一轮回答结束后立即输入，前几个字符"飘"在外面、确认后才被吸入输入框](#p1-02-上一轮回答结束后立即输入前几个字符飘在外面确认后才被吸入输入框)
  - [P1-03 输入光标不闪烁，无法判断焦点是否在 TUI](#p1-03-输入光标不闪烁无法判断焦点是否在-tui)
- [三、补充发掘的问题](#三补充发掘的问题)
  - [P0-04 启动时整屏清屏，破坏用户终端 scrollback](#p0-04-启动时整屏清屏破坏用户终端-scrollback)
  - [P1-05 多个 useInput 同时存活，按键被多个监听器收到](#p1-05-多个-useinput-同时存活按键被多个监听器收到)
  - [P1-06 终端 resize 不触发组件重渲染，markdown 表格宽度不更新](#p1-06-终端-resize-不触发组件重渲染markdown-表格宽度不更新)
  - [P2-07 streaming "…thinking…" 静态占位，无法分辨"卡死"还是"在思考"](#p2-07-streaming-thinking-静态占位无法分辨卡死还是在思考)
  - [P2-08 placeholder 文案过长，<= 80 列终端被截断/换行](#p2-08-placeholder-文案过长-80-列终端被截断换行)
  - [P2-09 Alt+Enter / Shift+Enter 在常见终端上不可靠](#p2-09-altenter--shiftenter-在常见终端上不可靠)
  - [P2-10 Ctrl+C 二义性：流式中是 cancel，空闲时未约束](#p2-10-ctrlc-二义性流式中是-cancel空闲时未约束)
  - [P2-11 SecretOverlay 输入未掩码，密钥明文显示](#p2-11-secretoverlay-输入未掩码密钥明文显示)
  - [P2-12 ToolCallLine 单行截断 60/80 字符，长路径/JSON 看不全](#p2-12-toolcallline-单行截断-6080-字符长路径json-看不全)
  - [P3-13 颜色不可读 / 暗色主题硬编码 / 不识别 NO_COLOR](#p3-13-颜色不可读--暗色主题硬编码--不识别-no_color)
  - [P3-14 历史虚拟化窗口固定 50，长会话被静默截断](#p3-14-历史虚拟化窗口固定-50长会话被静默截断)
  - [P3-15 长流式输出无法主动滚动浏览](#p3-15-长流式输出无法主动滚动浏览)
  - [P1-16 拖动窗口宽度时 banner（或其它静态行）被复印多份（P1-06 回归）](#p1-16-拖动窗口宽度时-banner或其它静态行被复印多份p1-06-回归)
  - [P1-17 鼠标离开终端窗口时光标仍在闪烁](#p1-17-鼠标离开终端窗口时光标仍在闪烁)
  - [P1-18 `/dg_global off` 重启后失效（key 名分裂）+ 危险命令缺审批](#p1-18-dg_global-off-重启后失效key-名分裂--危险命令缺审批)
- [四、统一改造路线图](#四统一改造路线图)
- [五、度量指标 & 验收标准](#五度量指标--验收标准)
- [六、参考资料](#六参考资料)

---

## 一、问题总览

| ID | 标题 | 等级 | 影响面 | 主要文件 |
|----|------|------|--------|----------|
| P1-01 | 流式中拖动滚动条被弹回底部 | P1 | 所有用户 | `streamingAssistant.tsx`, `transcriptPane.tsx` |
| P1-02 | 二次输入字符"飘"在外面 | P1 | 所有用户 | `composerPane.tsx`, `textInput.tsx`, `entry.tsx` |
| P1-03 | 输入光标不闪烁 | P1 | 所有用户 | `textInput.tsx`, Ink 6 默认隐藏硬光标 |
| P0-04 | 启动清屏破坏 scrollback | P0 | 所有用户 | `entry.tsx:74` |
| P1-05 | 多 useInput 互相收串 | P1 | 弹窗/补全场景 | 全部覆盖层组件 |
| P1-06 | resize 不重渲 | P1 | 表格、长行 | `markdownRenderer.tsx:46` |
| P2-07 | thinking 占位无动画 | P2 | 长 prompt | `streamingAssistant.tsx:66` |
| P2-08 | placeholder 过长 | P2 | 窄屏 | `composerPane.tsx:760` |
| P2-09 | Alt+Enter 不一致 | P2 | Win/tmux 用户 | `textInput.tsx:300` |
| P2-10 | Ctrl+C 语义二义 | P2 | 习惯用户 | `composerPane.tsx:280`, `entry.tsx` |
| P2-11 | 密钥明文回显 | P2 | 安全敏感 | `prompts.tsx:140` |
| P2-12 | ToolCallLine 截断 | P2 | 工具输出多 | `toolCallLine.tsx` |
| P3-13 | 主题不可配置 | P3 | 浅色用户/A11y | `theme.ts` |
| P3-14 | 历史窗 50 静默 | P3 | 长会话 | `useVirtualHistory.ts` |
| P3-15 | 流式无法回看 | P3 | 长输出 | `streamingAssistant.tsx` |
| P1-16 | banner resize 短暂残影（Ink 6 已知行为） | P3 | resize 用户 | `appLayout.tsx` |
| P1-17 | 终端失焦后光标仍闪烁 | P1 | 多窗口用户 | `textInput.tsx`, `entry.tsx`, `app.tsx`, `uiStore.ts` |
| P1-18 | `/dg_global off` 重启失效 + 危险命令缺审批 | P1 | 安全敏感 | `slash.py` (gateway), `operater_funs.py`, `drsai_cli_assistant.py` |

---

## 二、用户主诉问题

### P1-01 流式输出期间，向上拖动终端滚动条会被强制弹回底部

#### 复现路径
1. 启动 `drsai-tui`，发送一段会触发长输出的 prompt（比如让模型写 200 行代码）。
2. 模型还在 streaming 时，鼠标拖动终端滚动条（或按 Shift+PageUp）查看上方历史。
3. **每当 `message.delta` 事件到达**，视图被强制滚回最底（伴随明显跳动）。

#### 根因定位

Ink 的渲染机制：

```
React reconciler 计算 frame N+1 的差异
  └─ log-update.js
     ├─ ansiEscapes.eraseLines(previousLineCount)   ← 抹掉旧帧
     ├─ stream.write(newFrame)                       ← 重写新帧
     └─ previousLineCount = newLines.length
```

对应代码片段 (Ink 6.8 `log-update.js:39-52`)：

```js
const returnPrefix = buildReturnToBottomPrefix(...)
stream.write(
  returnPrefix +
  ansiEscapes.eraseLines(previousLineCount) +
  newFrame
)
```

`eraseLines` 内部使用 `\x1b[2K\x1b[1A` 序列向上抹除 N 行。**绝大多数终端（kitty/Alacritty/iTerm2/Windows Terminal/VSCode）** 在收到 `\x1b[1A` 移光标向上时，会**触发 "scroll-bottom anchor reset"**——这是 xterm 的默认行为，目的是让交互式程序（vi、less）收到键盘输入时，把视图自动滚回光标处。

因此每次 streaming chunk 到达：

1. `$current.text` 更新 → React re-render → Ink frame 增长 1~N 行
2. Ink 写入 `eraseLines(previousLineCount) + newFrame`
3. 终端检测到 cursor-move 序列 → reset scroll anchor → 视图回到底部

虽然 `transcriptPane.tsx` 已经把**完成的轮次**用 `<Static>` 隔离（一次写入永不重绘），但 **streamingAssistant + composerPane + statusBar** 整体仍然属于 dynamic frame，每一次 delta 都会引起这部分行被全部 eraseLines + 重写。

#### 影响等级
**P1（严重）** — 用户在长流式响应里完全无法回看上方内容；这是终端 chat 客户端最常见的反馈痛点。

#### 实验方案

**方向 A：把已完成的工具行迁进 `<Static>`** ❌ **已尝试，失败**

实施了一个 `$streamingCommits` atom：tool.complete 时把工具行 push 到 atom，TranscriptPane 的 `<Static>` items 把它们与历史 turn 一同渲染；finalize 时清空 atom，依赖 Ink Static 的"items 缩短不重写已写部分"语义无缝交接。

**实测结果**：
1. **滑动跳顶比 baseline 更严重**：每个 tool.complete 触发 2 次 setState（`commitStreamingTool` + `updateCurrent`）+ Static 内部 `useLayoutEffect` 又触发一次 setState，单事件内 3-4 次完整 re-render，重写频率比之前更高。
2. **finalize 后 turn 内容直接从屏幕消失**：原以为"items.length 缩短 → Ink 不再渲染新增项 → 已写部分留在 scrollback"。事实是 Ink Static 是 `position: 'absolute'` 的 Yoga 布局节点，**children tree 一变 Ink 就重写整个 Static 区域**——已经写出的 commits 全被擦掉。

**根本误区**：Ink `<Static>` 的"append-only"语义只在 items 数组**单调增长**时成立。一旦数组有任何缩短，整个 Static 都会被重新计算 + 重写。同时 commit 引发的额外 setState 路径让 dynamic frame 重写频率反而上升。

**已回滚**——所有相关改动 (turnStore.ts / createGatewayEventHandler.ts / turnController.ts / streamingAssistant.tsx / transcriptPane.tsx / app.tsx) 已恢复到 baseline。

**方向 A'：增加 delta flush 节流**（已采用，作为兜底）

把 `DRSAI_TUI_FLUSH_MS` 默认值从 80 调到 **160**：
- stdout 重写频率从 12.5 fps 减半到 6.25 fps
- 用户主动 scroll-up 的有效保持时长翻倍（80 ms → 160 ms）
- 仍远低于 250 ms "feels laggy" 阈值，主观流式速度感知近乎不变
- 单点修改、零回归风险
- 用户可通过 `DRSAI_TUI_FLUSH_MS=240` 进一步换取更长的 scroll 时长

只能**缓解**——单纯减半 flush 频率，scroll-anchor reset 仍按节奏触发。

**方向 D：启用 Ink incremental rendering** ❌ **已尝试，失败**

调研 Claude Code 的渲染策略时发现 Ink 6.8 自带 opt-in 的增量渲染模式 (`render.js:17` 的 `incrementalRendering: false` 是默认值)：

| 模式 | 实现 | 行为 |
|------|------|------|
| `createStandard`（默认） | `eraseLines(N) + write(整帧)` | 整个 dynamic frame 重写 |
| `createIncremental`（opt-in） | 行 diff，只重写变化的行 | 未变行只 `cursorNextLine` |

来源：`node_modules/.pnpm/ink@6.8.0_*/node_modules/ink/build/log-update.js` 的 `createIncremental`，`render.d.ts:58-64` 的 `incrementalRendering` 选项。

**应用尝试**：

```ts
inkInstance = render(<App gw={gw} />, {
  exitOnCtrlC: false,
  incrementalRendering: true,
})
```

**实测失败**：启动后输入框 placeholder 行**每隔 530 ms 在屏幕上 append 一行**，10 秒内堆出 6+ 个 `›  type a message …`。

**根因**：P1-03 加的光标闪烁 (`useCursorBlink`) 每 530 ms toggle 一次 React state；toggle 改的是光标 inverse 标志，**这导致 placeholder 行字符串字节身份变化**。incremental diff 看到 `prevLines[last] !== nextLines[last]` → 决定重写最后一行。但它的 cursor 定位逻辑 (`cursorNextLine + cursorTo(0)`) 在我们 dynamic frame 高度恰好与上一帧相同时会算错落点——结果是新行被写在前一帧的最后一行**下方**而非覆盖。

具体路径：
1. blink toggle → React re-render
2. incremental 计算 diff：`previousLines = [..., promptRow_inverseOn]`、`nextLines = [..., promptRow_inverseOff]`
3. 它沿 cursorNextLine 走到最后一行
4. `cursorTo(0) + nextLines[last] + eraseEndLine` 本应覆盖最后一行
5. **但**前一帧 cursor 已经下行至 below-last-line（因为 streaming text 也在变高），incremental 没有 cursorUp 把 cursor 拉回真正的 last-line 起点
6. 写入位置整体下移 → 屏幕 append 出新一行

这是 Ink upstream incremental 模式在 "光标常变化 + 内容长度不定" 双重动态场景下的已知不足。**已立即回滚**（`entry.tsx` 不传 `incrementalRendering`，走默认 `createStandard`）。

**未来重新尝试 D 的条件**：
1. 把光标块从 placeholder 行拆出去（单独 Box，避免污染父行字符串）
2. 或者 Ink upstream 修复 incremental 的 cursor accounting
3. 或者用更激进的"光标根本不闪"方案

**最终采用方案**：方向 A'（仅节流）+ 长期留给方向 B（alt screen，与 P3-15 合并）。



---

### P1-02 上一轮回答结束后立即输入，前几个字符"飘"在外面、确认后才被吸入输入框

#### 复现路径
1. 发送 prompt → 等待 streaming → 看到 `⏳ streaming…`。
2. **streaming 还没完成时就开始打字**（最常见：连贯思考下输入下一条）。
3. message.complete 触发，`⏳` 消失、`<TextInput>` 挂载。
4. 用户已经按下的字符**先以裸字符的形式出现在终端某一行**（位置不确定，常在 streaming text 末尾）。
5. 0.1~0.5s 后，Ink 重绘 TextInput，那些"飘字符"被 `eraseLines` 抹掉，原文进入输入框（看起来像是被"覆盖"）。

#### 根因定位

`composerPane.tsx:755-770` 的关键三态切换：

```jsx
{isStreaming ? (
  <Box>
    <Text color={theme.warn}>⏳ </Text>
    <Text color={theme.muted}>streaming… (Ctrl+C to cancel)</Text>
  </Box>
) : (
  <TextInput .../>
)}
```

streaming 期间渲染的是 `<Text>` 而非 `<TextInput>`，**没有任何 `useInput` 钩子在监听 stdin**（除了顶层 `useInput((_,k)=>{ if(streaming && Ctrl+C)…})`，它只关心 Ctrl+C，普通字符不消费）。

Node 把 stdin 设为 raw mode 后，**字符不会自动被吃掉**——它们会进入 stdin 的内部 buffer。问题是：

1. **Ink 不会主动 clear stdin buffer**。
2. 终端在 raw mode 下默认仍可能 echo（不同终端表现不一）；**特别是 streaming 期间 Ink 重绘频繁，每次 frame 写出后游标停在 streaming 末尾**——此时 stdin 已 buffered 的字符会**被终端"惯性显示"在光标位置**（虽然 Node 不 echo，但是部分终端 emulator 在大量重绘 + raw mode 切换之间存在边界 race）。

更准确的根因（推断 + 实测路径）：
- `setRawMode(true)` 时终端确实关 echo，但 Ink 6 的实现里 raw mode 是**进程级**而非组件级；
- `<Text>` → `<TextInput>` 切换的 0.1s 内，Ink 完成一次 reconciliation；这一帧渲染**到 `eraseLines + write` 之间**会有微小的 stdin drain；
- 在某些终端（VSCode integrated terminal、Windows Terminal 早期版本）上，**raw mode 下仍会执行 \r 回响**，导致 buffered 字符在 cursor 当前行被打印；
- Ink 下一帧的 `eraseLines(previousLineCount)` 抹的是"上一帧 React 已知的行数"，**它不知道终端中途自己 echo 的字符所占的行**——于是这些字符被遗留，直到 TextInput mount 后下一次重绘才被覆盖。

辅证：placeholder 文字 `type a message (Alt+Enter/...)` 长度 ~70 字符在 80 列终端会换行，进一步增加错帧概率。

#### 影响等级
**P1（严重）** — 几乎人人会在第二次输入时遇到，给人"丢字符"的错觉，严重打击信任。

#### 实验方案

**方向 A：streaming 期间挂载 disabled TextInput**（推荐）

把三态：

```
streaming?  Text占位 : TextInput
```

改为：

```jsx
<TextInput
  prompt=" › "
  disabled={isStreaming}
  placeholder={isStreaming
    ? "⏳ streaming… (Ctrl+C to cancel)"
    : "type a message ..."}
  onSubmit={handleSubmit}
  ...
/>
```

并修改 `textInput.tsx`：当 `disabled` 时，仍调用 `useInput`，但所有键位走 no-op（除 Ctrl+C 透传）。这样：
- stdin 始终被 useInput 消费，不会有 buffered 字符泄漏到终端；
- DOM 节点不重新挂载，Ink frame 行数稳定；
- placeholder 自然显示 streaming 状态。

**方向 B：在 streaming 期间显式 drain stdin**

- 在 `$isStreaming.subscribe(false → true)` 处主动 `process.stdin.read()` 把 buffer 吃掉；
- 切回 false 时若有残留 buffer 也丢弃。
- 缺点：会丢失用户在 streaming 期间已敲的字符，与 A 相比交互差。

**方向 C：在切换边界写入 `\x1b[K`（清除当前行）**

- streaming → idle 切换时 entry.tsx 监听 `$isStreaming` 变化，注入 `\x1b[2K\r`；
- 仅治标，与 Ink 内部状态有冲突风险。

**A/B 对照度量**：

| 指标 | 方法 | 基线 | 目标 |
|------|------|------|------|
| streaming 末尾出现"飘字符"的概率 | 自动化：用 `node-pty` spawn TUI，模拟用户在 streaming 80% 时点 5 个字，回看屏幕 buffer | ~80%（任意终端） | 0% |
| 字符到达输入框的延迟 | streaming → idle 后第一次 keypress 进 input value 的时长 | 100~500ms | < 30ms |
| stdin buffer 残留字节数 | 在 useInput handler 加 metric | 0~5 | 0 |

**验证场景**：
- 短 prompt（streaming < 1s）→ 用户在 streaming 末打字
- 长 prompt（streaming > 30s）→ 用户在 streaming 中段打字（边看边打）
- streaming 中 cancel（Ctrl+C）→ 立即打字

---

### P1-03 输入光标不闪烁，无法判断焦点是否在 TUI

#### 复现路径
1. 启动 `drsai-tui`，进入空闲状态，输入框显示 placeholder。
2. 切换到其他窗口再切回；或在 tmux pane 之间跳转。
3. 用户**无法判断**当前 keystroke 会进入 TUI 还是别处——光标静止不动。

#### 根因定位

两层因素叠加：

1. **Ink 6 默认隐藏硬件光标**：`render.js` 启动时调用 `log-update.js` 的 `createStandard(stream, { showCursor: false })`，写入 `\x1b[?25l`。
   - 见 `node_modules/.../ink/build/log-update.js:113`：`if (!showCursor && !hasHiddenCursor) stream.write(hideCursorEscape)`。

2. **TextInput 用反色字符模拟光标**：`textInput.tsx:283`

   ```jsx
   {!disabled && <Text color={theme.text} inverse>{at}</Text>}
   ```

   反色块是**静态字符**，不会闪烁；它的位置 + 颜色取决于 React state，不靠终端原生光标行为。

结合 P1-02 的 disabled 三态切换，反色块在 streaming 时还会消失（连静态指示都没有）。

终端用户长期形成的认知是"闪烁光标 = 我现在能输入"——**没有这个反馈，用户必然会反复试探性敲键**。

#### 影响等级
**P1（严重）** — 既影响日常使用流畅度，也对 a11y 用户（屏幕放大镜、低对比度需求）尤其不友好。

#### 实验方案

**方向 A：手动驱动反色光标的可见性闪烁**（最小侵入）

```jsx
// 新 hook
function useCursorBlink(intervalMs = 530): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const t = setInterval(() => setOn(o => !o), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return on
}
```

在 `textInput.tsx` 渲染：

```jsx
const blinkOn = useCursorBlink()
...
{!disabled && (blinkOn
  ? <Text color={theme.text} inverse>{at}</Text>
  : <Text color={theme.text}>{at}</Text>
)}
```

注意：
- **节流要求**：`setState` 530ms 一次，配合 React 19 的 transition 不会卡顿；但要做基线测量（见下）。
- **副作用**：每次 setState 都会让整个 dynamic frame 重写一次（与 P1-01 冲突）；解决：把光标块隔离到独立的 `<Text>`，并尽量限制重渲染（`memo` + `useMemo`）。

**方向 B：恢复终端硬件光标**

- entry.tsx 启动后立即 `process.stdout.write('\x1b[?25h')`；
- 关闭 Ink 的隐藏行为：现在 Ink 6 没有公开 API，但可以 fork 或在 render 后立刻覆盖 `\x1b[?25h`；需要 hack。
- 必须同时提供精确的 `\x1b[<row>;<col>H` 让硬光标停在 input 的 cursorCol——这等于自己实现 cursor positioning，工作量大。

**方向 C：纯视觉提示**——在 prompt 前加变色三角 `▶`/`▷` 交替闪。

- 兼容性最好，最易实现；
- 视觉冲击与传统光标差别大，但用户能很快适应。

**推荐组合**：A + C 双保险。

**度量**：

| 指标 | 方法 | 基线 | 目标 |
|------|------|------|------|
| 闪烁频率稳定性 | 录像逐帧统计 ON/OFF 分布 | N/A（不闪） | 530ms ± 50ms |
| 光标处终端字节数/秒 | tee stdout 统计 | 0 | < 100 byte/s（仅光标节点重绘） |
| 焦点切换后用户首次正确输入时长 | 用户测试，10 人 × 5 任务 | 1.5s | < 0.5s |
| CPU 使用率 idle | `top -p $TUI_PID` 60s | < 1% | < 2%（接受小幅升高） |

---

## 三、补充发掘的问题

### P0-04 启动时整屏清屏，破坏用户终端 scrollback

#### 复现路径
1. 在终端里执行 `ls / pwd / git status` 等命令，留下若干输出。
2. 执行 `drsai-tui`。
3. **终端 scrollback 的所有内容被清空**——只剩 TUI 界面。
4. 退出 TUI 后，scrollback 仍是空的（取决于终端，部分会保留）。

#### 根因定位

`entry.tsx:74`：

```ts
process.stdout.write('\x1b[2J\x1b[H')
```

这是 ED2 (erase entire display) + cursor home。许多终端把 `\x1b[2J` 实现为"把所有可见行+部分 scrollback 清空"。

这是不必要的——Ink 渲染不依赖空白屏幕。看上去像是 Phase 0 遗留代码。

#### 影响等级
**P0（致命）** — 用户终端是工作台、不是黑板，TUI **绝不应该清空 scrollback**。这是 CLI 工具最常见的设计错误之一（参考 Claude Code 早期版本曾出现同类 bug）。

#### 实验方案

**修改**（一行）：

```ts
// entry.tsx:74 - 删除整屏清屏
- process.stdout.write('\x1b[2J\x1b[H')
+ // 不清屏：Ink 自己会管理 dynamic frame，append-only 写入即可。
```

如果未来需要"全屏 TUI"体验：

- 进入 alternate screen buffer：`process.stdout.write('\x1b[?1049h')` (启动)，`'\x1b[?1049l'` (退出)。
- alternate screen 是终端原生支持的"全屏模式"——退出后 scrollback **完全恢复**。
- 与 P3-15 合并实施。

**度量**：

| 指标 | 方法 | 基线 | 目标 |
|------|------|------|------|
| 启动后用户原 scrollback 保留率 | `tput lines` × `script(1)` 抓取，对比启动前后 | 0% | 100% |
| 退出后 prompt 立即可见之前命令 | 手动验证 | 否 | 是 |

---

### P1-05 多个 useInput 同时存活，按键被多个监听器收到

#### 复现路径
1. 弹出 SessionPicker（输入 `/sessions`）。
2. **同时** TextInput 还在 `disabled=false` 但被 cover；composerPane 顶层 useInput 也在跑。
3. 按数字 `1` → SessionPicker 选中 + TextInput 把 `1` 插入 value。
4. 按 ESC → 多处都会响应。

#### 根因定位

Ink 的 `useInput` 默认不带 `isActive` 控制：

```ts
// 在 Ink 中，多个组件 mount 时调用 useInput，每个都会被 stdin 通知。
// 必须显式用 useFocus + isActive 才能隔离。
```

代码里没有任何 `useFocus`/`isActive` 出现（已 grep 验证），所有 useInput hook **同时存活**。靠 React 条件渲染（卸载弹窗时 useInput 才解绑）只能减轻不能根治——比如 `composerPane` 内部 useInput 即使弹窗在也仍然在跑。

#### 影响等级
**P1（严重）** — 弹窗用户最容易踩雷。

#### 实验方案

**方向 A：FocusManager + useFocus**（已采用，简化版）

实测发现："弹窗"在我们的代码里分两类：

1. **替换式 overlay**（SessionPicker / SkillsPane / ModelPicker / ModelEditor / SlashOutputOverlay）：composerPane 走 `if (cond) return <Overlay/>` —— TextInput 根本不挂载，自然不会冲突。
2. **叠加式 overlay**（PromptsOverlay 的 ApprovalOverlay / ClarifyOverlay / SecretOverlay / SudoOverlay）：永远挂在 `<AppLayout>` 顶层，与 ComposerPane 并存——按 `1` 接受 approval 时，**TextInput 也会收到 `1`** 并插入到输入框。这才是真实冲突。

所以方案聚焦到**叠加式 overlay**：

- 新增 `$activeOverlay` atom (`uiStore.ts`)，可选值 `'approval' | 'clarify' | 'secret' | 'sudo' | null`。
- 一个共用 hook `useClaimActiveOverlay(name)`（`prompts.tsx`）：sub-overlay 挂载时设置 atom，卸载时清除。
- `<TextInput>` 增加 `isActive` prop（默认 true），透传给 Ink 的 `useInput(handler, { isActive })`。`isActive=false` 时 Ink 原生跳过 listener 注册——这是 Ink 6 官方支持的方式，比自己在 handler 里早 return 更彻底（连 raw mode 切换都不会触发）。
- `composerPane` 订阅 `$activeOverlay`，传 `isActive={activeOverlay === null}` 给 TextInput。

`disabled` 与 `isActive` 的区别（已写进 TextInput 的 prop docstring）：
- `disabled=true`：useInput 仍挂载，所有键被吃掉但 stdin 被消费 → 防 ghost char（P1-02）
- `isActive=false`：useInput 完全不挂载 → 当其他 overlay 在消费 stdin 时使用

**为什么没用 Ink 的 `useFocus`**：useFocus 是为"Tab 在多个 focusable 之间切换"设计的，需要用户主动 Tab 切。我们的场景是 overlay 应**抢占式**接管键盘，不需要用户 Tab。直接用 `isActive` 更准确。

**未处理的并发**：替换式 overlay 内的 useInput（如 `sessionPicker.tsx` 的 useInput）仍是 broadcast 收到，但因为 TextInput 此时已经 `return` 不挂载，没有冲突。**未来如果引入新的"叠加式"overlay**，必须：
1. 给它一个 `ActiveOverlay` 字符串值
2. 在它内部 `useClaimActiveOverlay('newName')`

**方向 B：单一根级 useInput dispatcher**

只在 entry/AppLayout 注册一个 useInput，所有键位走 store-driven 状态机分发。

- 优点：彻底排除冲突；
- 缺点：Ink 哲学上反模式，组件的局部交互全要"上提"，工程量大。
- 现在不做。

#### 度量

| 指标 | 方法 | 改造前 | 改造后 |
|------|------|--------|--------|
| approval 显示时按 `1` 是否同时插入到输入框 | 手动 | 是 | 否 |
| clarify (numeric choices) 同理 | 手动 | 是 | 否 |
| sub-overlay 卸载后 textInput 是否恢复响应 | 手动 | n/a | ✅ |
| 替换式 overlay（session/skills 等）行为是否变化 | 手动 | n/a | 无变化（不依赖 atom） |

**度量**：键位"双响应"故障数（人工测试矩阵 7×7）。

---

### P1-06 终端 resize 不触发组件重渲染，markdown 表格宽度不更新

#### 复现路径
1. 启动 TUI，发送 prompt 让模型返回 markdown 表格。
2. 拖动终端窗口宽度。
3. 表格宽度仍按启动时的 `process.stdout.columns` 渲染——超出屏幕时换行错乱。

#### 根因定位

`markdownRenderer.tsx:46`：

```ts
function getTerminalWidth(): number {
  return process.stdout.columns || 80
}
```

这是**调用时快照**，React 不订阅 stdout 的 `'resize'` 事件。

Ink 提供 `useStdout` hook，可订阅 resize 通知；当前未使用。

#### 影响等级
**P1（严重）** — 多任务用户经常 resize 终端；现在改大改小都不会更新。

#### 实验方案

**改造**：

```ts
// 新 hook
function useTerminalWidth(fallback = 80): number {
  const { stdout } = useStdout()
  const [w, setW] = useState(stdout.columns ?? fallback)
  useEffect(() => {
    const update = () => setW(stdout.columns ?? fallback)
    stdout.on('resize', update)
    return () => { stdout.off('resize', update) }
  }, [stdout])
  return w
}

// markdownRenderer 内
const width = useTerminalWidth()
```

注意：
- 受 P1-01 限制，resize 一次会重写整个 dynamic frame；用户手动 resize 时这是预期行为。
- 给 resize 加 100ms 节流，避免拖动时 30 FPS re-render。

**度量**：

| 指标 | 方法 | 基线 | 目标 |
|------|------|------|------|
| resize 后表格宽度更新延迟 | 录像 | 永不（必须重启 TUI） | < 200ms |
| resize 中重绘 FPS | 用 `tee` 统计 stdout flush 次数 | 0 | ≤ 10 |

---

### P2-07 streaming "…thinking…" 静态占位，无法分辨"卡死"还是"在思考"

#### 复现路径
1. 发送一个 reasoning model 的 prompt（如 GPT-5、Claude 3.7 thinking）。
2. 模型先思考 10~60s 才输出第一个 token。
3. 屏幕上**只有 `…thinking…` 三个字静止不动**——分不清是 TUI 卡了、网络断了、还是模型在想。

#### 根因定位

`streamingAssistant.tsx:66`：

```jsx
{cur.status === 'streaming' && !cleanText && cur.tools.length === 0 && (
  <Text color={theme.muted} dimColor>  …thinking…</Text>
)}
```

纯静态文本，无 spinner、无心跳。同时 reasoning.delta 事件（如有）也没有可视化。

#### 影响等级
**P2** — 高级用户可以容忍，但新手会以为程序挂了；reasoning model 时代越来越常见。

#### 实验方案（已采用）

实施在 `streamingAssistant.tsx` 加了 `useThinkingPulse(active, startedAt)` hook：

- **spinner**：10 帧 Braille rotor `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`，100 ms 一帧
- **计时**：从 `cur.startedAt` 到现在的秒数，1 s tick
- **显示**：`⠹ thinking… 12s`（dim 灰色，1 行）

**关键节流策略**（避开 P1-01 整帧重写问题）：
1. **只在"完全没动静"时才转**：`cur.status === 'streaming' && !cleanText && cur.tools.length === 0`。一旦第一个 tool 启动或第一个 text token 到达，spinner 立刻消失，dynamic frame 不再被它的 100ms 节奏 churn。
2. **失焦时停止动画 + 改静态 `○`**：通过 `$terminalFocused` atom（P1-17 引入）判断。失焦窗口的伪光标都不闪了，spinner 当然也不应该转。同时不挂 setInterval，CPU 归零。
3. **dynamic frame 此时只有 1~2 行**（header + 这一行 hint），重写也轻量。

**为什么选 10 帧不是 4 帧**：4 帧动画在 100ms 间隔下"跳"得明显，10 帧（每帧旋转 36°）在同样间隔下视觉是连续转动，更接近用户对 spinner 的肌肉记忆。10 帧的 string 长度仍是 1 字符，与 frame 数无关。

**未实施的 reasoning preview 切换**：原方案说 "若 `reasoning.delta` 已有 token，则切到 reasoning preview"。代码里 reasoning preview 已经独立渲染（`showReasoning && cur.reasoning.trim()` 分支），与 thinking spinner 的可见性条件天然互斥（reasoning 出现时也不再属于"完全没动静"）。所以无需额外切换逻辑。

#### 度量

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| reasoning model 长思考时用户主观判断"agent 还活着" | 不能（看死字符串） | 能（动画 + 计时） |
| dynamic frame 整帧重写频率（streaming 已开始 token 后） | 不变 | 不变（spinner 已消失） |
| 失焦时 CPU 占用 | spinner 仍跑 → 1-2% | spinner 停 → 0% |

---

### P2-08 placeholder 文案过长，<= 80 列终端被截断/换行

#### 复现路径
1. 终端宽度 80 列。
2. 输入框 placeholder：

   ```
   type a message (Alt+Enter/Ctrl+O newline, / commands, Tab complete, ↑/↓ history)
   ```

3. 文字长度 ~80 chars，加上 ` › ` prompt 共 83 字符 → **换行 + 第二行被 statusBar 覆盖**。

#### 根因定位

`composerPane.tsx:760`：

```jsx
placeholder="type a message (Alt+Enter/Ctrl+O newline, / commands, Tab complete, ↑/↓ history)"
```

这是设计阶段为了"给新手讲明白"塞进去的提示，但和 80 列底线冲突。

#### 影响等级
**P2** — 80 列窗口（笔记本双开/远程 SSH）很常见。

#### 实验方案

1. 缩短为 `"输入消息 · / 命令 · Tab 补全"`（≤ 30 字符，CJK 友好）。
2. 把详细键位移到 `/help` slash command。
3. 多次启动后自动隐藏 placeholder（仅前 3 次显示）。

实施成本：低。

---

### P2-09 Alt+Enter / Shift+Enter 在常见终端上不可靠

#### 现象矩阵

| 终端 | Alt+Enter | Shift+Enter | Ctrl+O |
|------|-----------|-------------|--------|
| iTerm2 (default) | ✅ | ❌ (与 Enter 同) | ✅ |
| macOS Terminal.app | ❌ (发 ESC) | ❌ | ✅ |
| Alacritty (default) | ✅ | ❌ | ✅ |
| kitty | ✅ | ✅ (kitty keyboard protocol) | ✅ |
| Windows Terminal | ❌ (Alt 触发菜单) | ❌ | ✅ |
| VSCode terminal | ❌ | ❌ | ✅ |
| tmux (default) | ❌ (发 ESC 序列) | ❌ | ✅ |

#### 根因定位

`textInput.tsx:300`：

```ts
if (key.meta || key.shift || pendingEscapeRef.current || inPasteBurst) {
  insertNewline()
}
```

依赖 Ink 的 key 解码，Ink 又依赖 `node-pty`/raw stdin 字节。Alt 在大多数终端发为 ESC 前缀，Ink 6 解析为 `key.meta` 但 `meta` 也包含 ESC 单独按键——不可靠。

注释里已经写 "Esc then Enter" 是兼容做法（`pendingEscapeRef`），但用户**完全不知道**这个 fallback。

#### 影响等级
**P2** — 已经有 Ctrl+O 全平台兜底，但 placeholder 没强调，新用户会先试 Alt+Enter 失败后放弃。

#### 实验方案

1. **唯一推荐 Ctrl+O 写新行**：placeholder 改成 `Ctrl+O 换行`，去掉 Alt+Enter 提示。
2. 仍接受 Alt/Shift+Enter 作为锦上添花，但不在 UI 文案里宣传。
3. 在 `/help` 里展示完整键位 + 终端兼容性注脚。
4. 检测 kitty keyboard protocol（启动时 `\x1b[>1u`），若可用则启用 Shift+Enter。

---

### P2-10 Ctrl+C 二义性：流式中是 cancel，空闲时未约束

#### 现象

- streaming 中：`composerPane.tsx:280` 捕获 Ctrl+C → cancel turn。
- 空闲时：`entry.tsx:78` 注册 `exitOnCtrlC: false`，但根级 useInput 不处理 Ctrl+C → **fallthrough 到 Node 默认 SIGINT** → 进程退出（但已被 `exitOnCtrlC:false` 屏蔽？依赖 Ink 内部行为）。

实测：
- streaming 中 Ctrl+C → cancel ✅
- 空闲 Ctrl+C → 进程**不退出**（被 `exitOnCtrlC:false` 屏蔽），但也无明显反馈。
- 空闲 Ctrl+D → 走 graceful shutdown 流程。

用户预期：
- Ctrl+C 一次：清空当前输入（参考 readline / Python REPL 行为）。
- Ctrl+C 两次：退出。
- Ctrl+D：退出（已实现）。

#### 影响等级
**P2** — 资深用户的肌肉记忆受挫。

#### 实验方案

1. 空闲 Ctrl+C：清空 TextInput value（已有 Ctrl+U 但用户少用）。
2. 200ms 内连按两次 Ctrl+C：触发与 Ctrl+D 相同的 graceful shutdown。
3. statusBar 提示：`Ctrl+C 清空 · Ctrl+C×2 / Ctrl+D 退出`。

实现：在 `app.tsx` 顶层 useInput 增加 Ctrl+C 计数 + 100ms 防抖。

---

### P2-11 SecretOverlay 输入未掩码，密钥明文显示

#### 现象

`prompts.tsx:140` SecretOverlay：

```jsx
<TextInput
  prompt=" › "
  placeholder="(input shown — terminal does not mask in this build)"
  ...
/>
```

注释已自承"未掩码"，密钥/Token 在终端原文显示。

#### 影响等级
**P2** — 屏幕共享、录屏、肩窥场景下泄漏；终端 scrollback 也会留痕。

#### 实验方案

修改 `textInput.tsx`：

```tsx
interface TextInputProps {
  ...
  /** 用 ●/* 替代实际字符显示（仍正常 onSubmit 提交真值） */
  mask?: boolean | string  // true → ●，string → 自定义字符
}

// 渲染时
const displayed = mask ? (typeof mask === 'string' ? mask : '●').repeat(line.length) : line
```

SecretOverlay 传 `mask` prop。Submit 后立即 `setValue('')` 防止 history 落库。

附加：
- `promptHistory` 不存储 mask=true 的输入。
- statusBar 不显示密钥相关 statusLine。

---

### P2-12 ToolCallLine 单行截断 60/80 字符，长路径/JSON 看不全

#### 现象

`toolCallLine.tsx`：

```ts
return head.length > 60 ? head.slice(0, 57) + '…' : head
return first.length > 80 ? first.slice(0, 77) + '…' : first
```

复杂参数（Bash 命令、JSON 配置、长 grep pattern）被裁短，调试时无法对照。

#### 影响等级
**P2** — 工具用得多的用户/开发者最先遇到。

#### 实验方案（已采用）

1. 默认仍单行截断（保持紧凑）。
2. 按 `Ctrl+T` 切换 detailed 模式（store atom `$toolDetail = 'compact' | 'expanded'`）。
3. expanded 模式下：参数完整显示（多行），结果显示前 5 行 + "…+N more lines" 计数。
4. ~~`/tool <id>` slash 命令查看任意工具的完整参数+结果。~~ 未实施 — `Ctrl+T` 切到 expanded 后所有 tool 一起展开，比单个查询更方便（已完成轮次在 `<Static>` 内不会重画 — 切换只影响未来 turn 和当前未完成 turn）。

**改动**：
- `uiStore.ts`：新增 `$toolDetail: ToolDetailMode` atom，默认 `'compact'`。
- `toolCallLine.tsx`：用 `useStore($toolDetail)` 选择两套渲染逻辑；compact 与原来字节级等价。
- `app.tsx`：顶层 `useInput` 监听 `Ctrl+T`，toggle atom + 2 秒 status hint。

**度量**：

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 看到完整 bash 命令 / grep pattern 需要的步骤 | 只能等模型重新执行 / 改源码 | 按 Ctrl+T |
| compact 模式视觉是否变化 | n/a | 0（字节级一致） |

---

### P3-13 颜色不可读 / 暗色主题硬编码 / 不识别 NO_COLOR

#### 现象

- `theme.ts` 只有 `DARK_THEME`，浅色背景终端用户看不清（gold/cornsilk 在白底无对比）。
- 不识别 `NO_COLOR=1` 环境变量（POSIX 标准）。
- 不识别 `COLORFGBG`（终端报告自身前/背景色）。
- 屏幕阅读器、低视力用户无适配。

#### 实验方案

1. 引入 `LIGHT_THEME`，启动时按 `COLORFGBG` 的 BG 值 / `process.env.COLORFGBG` 自动选择。
2. 支持 `NO_COLOR`：所有 `color={...}` 退化为 default。
3. `/theme dark|light|auto` slash 命令手动切换。
4. 保证 contrast ratio ≥ 4.5:1（WCAG AA）。

详见 technical-roadmap "Phase 4 主题"已规划。

---

### P3-14 历史虚拟化窗口固定 50，长会话被静默截断

#### 现象

`useVirtualHistory.ts:30`：`windowSize = 50`。超过 50 轮的会话，老的 turn 被推到 scrollback（且 `<Static>` 已写入），但 hidden marker 只显示 `── 25 earlier turns hidden ──` 一行。

`/clear` 后只清前端，DB 仍保留——用户不可见。

#### 影响等级
**P3** — 长会话用户。

#### 实验方案

1. 提供 `/scrollback N` 命令临时增大 windowSize。
2. hidden marker 增加 hint：`scroll up in terminal | press PageUp to load more`。
3. PageUp 触发 `windowSize += 50`（dynamic 增加，已有 turns 仍用 Static）。

---

### P3-15 长流式输出无法主动滚动浏览

#### 现象

streaming 期间，`<Static>` 不重写但占终端 scrollback；用户上滑被 P1-01 弹回。即使 P1-01 修好，TUI 也没有内置 viewer 来浏览**当前正在流式的回答**——streaming 的内容完全靠"看着它输出"。

#### 实验方案

P1-01 修复后，引入：
- streaming 中按 `Ctrl+L`（"lock" view）→ 进入 alt-screen 浏览模式，停止自动追加，等用户主动按 End 跳回底；
- 或单独的"output buffer"窗口，可 PageUp/PageDown。

---

### P1-16 拖动窗口宽度时 banner 短暂出现多份（Ink 6 已知行为）

#### 复现路径
1. 启动 TUI（已经引入 `useTerminalWidth`，订阅了 resize 事件）。
2. **快速** 拖动终端窗口边缘**变宽**（缩窄不会出现，因为 Ink 缩窄时会自动 `log.clear()`）。
3. 拖动期间屏幕上短暂出现 2~3 个 `⚡ DrSai`，停手后 ~0.5 s 自动恢复成 1 个。

#### 根因定位

阅读 Ink 6.8 源码 `node_modules/.../ink/build/ink.js:204`：

```js
resized = () => {
  const currentWidth = this.getTerminalWidth()
  if (currentWidth < this.lastTerminalWidth) {
    // We clear the screen when decreasing terminal width to prevent
    // duplicate overlapping re-renders.
    this.log.clear()
    this.lastOutput = ''
    this.lastOutputToRender = ''
  }
  this.calculateLayout()
  this.onRender()
  this.lastTerminalWidth = currentWidth
}
```

- **缩窄**：Ink 主动 clear → 不出残影。
- **变宽**：Ink 不 clear，直接 `onRender()` → `eraseLines(previousLineCount) + write(newFrame)`。
  - `previousLineCount` 是按旧（窄）宽度算出的行数；新帧按宽宽度排版只占更少行；抹的行数 < 旧帧实际占用 → 顶部 1~2 行（包括 banner）残留。

这是 Ink 6 的**有意设计折衷**——避免每次 resize 都闪一下整屏；只在缩窄时 clear。

#### 影响等级
**P3（轻微）** — 仅在快速拖窗口变宽期间可见，停下后 < 0.5 s 自动恢复（光标闪烁触发 re-render 即清掉残影）。

#### 设计选择记录

考虑过的方案 + 为什么没有采用：

| 方案 | 否决原因 |
|------|----------|
| ❌ 把 banner 放进 `<Static>` | Static 是 append-only：resize 后 banner 会**永久消失** |
| ❌ 监听 resize 主动 `inkInstance.clear()` | 会清掉用户原 scrollback，违反 P0-04 |
| ❌ 每次 resize 都 clear 整屏 | 体验差，闪屏明显 |
| ✅ **接受短暂残影** | 残影持续 < 0.5 s 且自动恢复，符合 Ink 6 上游设计 |

#### 通用规则（沉淀到约定）

> **`<Static>` 只能装"append-only" 内容**——比如已完成的对话轮次、不会再变的日志条目。
> **任何"启动到退出整段时间内必须可见"的内容都不能放进 Static**——banner、status bar、composer、placeholder 全部留在 dynamic frame。

如果未来对 banner 残影零容忍，唯一彻底方案是**进入 alternate screen**（与 P3-15 合并），代价是失去 scrollback。

---

### P1-17 鼠标离开终端窗口时光标仍在闪烁

#### 复现路径
1. TUI 启动后空闲。
2. 把鼠标 / 焦点移到其他应用（浏览器、IDE、Slack）。
3. 看 TUI 窗口角落——**输入框的伪光标仍然每 530 ms 闪一下**。

#### 根因定位

P1-03 实现的 `useCursorBlink` 是一个简单的 `setInterval`，**完全不知道终端窗口的焦点状态**——只要 React 树挂载，定时器就跑。

真实终端硬件光标的行为是：**窗口失焦时停止闪烁**（多数终端把光标变成空心方框 / 隐藏）。我们的伪光标如果一直闪，给人一种"窗口在后台还活跃地等输入"的错觉，反而比不闪更分散注意。

#### 影响等级
**P1（严重）** — 任何多窗口工作流（IDE + TUI 并排）都会持续看到这个伪闪烁，且伴随每次闪烁的 stdout 写入（与 P1-01 的 frame 重写互相加重）。

#### 实验方案（已采用）

利用 **XTerm Focus Reporting**（`\x1b[?1004`）协议：

1. 启动时 `entry.tsx` 写 `\x1b[?1004h` 启用 focus reporting。退出时 `restoreTerminal()` 写 `\x1b[?1004l` 关闭。
2. 终端在窗口获焦/失焦时向 stdin 发送 `\x1b[I` / `\x1b[O`。
3. `<App>` 顶层的 `useInput((input)=>...)` 收到这两个字符串（Ink 把 ESC 前缀剥掉后变成 `'[I'` / `'[O'`），更新 `$terminalFocused` atom。
4. `useCursorBlink(active)` 通过 `useStore($terminalFocused)` 订阅；只在 `active && termFocused` 时启动定时器。
5. 失焦时 `setOn(true)` 把光标固定在 "可见" 状态——这样既能看到光标位置又不闪。

**终端兼容矩阵**：

| 终端 | focus reporting 支持 | 行为 |
|------|---------------------|------|
| iTerm2 | ✅ | 失焦立刻停闪 |
| Alacritty | ✅ | 失焦立刻停闪 |
| kitty | ✅ | 失焦立刻停闪 |
| Windows Terminal | ✅ | 失焦立刻停闪 |
| GNOME Terminal | ✅ | 失焦立刻停闪 |
| VSCode integrated | ✅ | 失焦立刻停闪 |
| tmux | ⚠️ 需 `set -g focus-events on` | 启用后正常；否则一直闪（与 macOS Terminal 同） |
| GNU screen | ❌ | 一直闪 |
| macOS Terminal.app | ❌ | 一直闪 |

**降级行为**：不支持的终端永远不发 `\x1b[I` / `\x1b[O` → `$terminalFocused` 保持初始值 `true` → 光标一直闪，回到 P1-17 修复前的状态。零回归。

**`'[I'` / `'[O'` 与人手输入的歧义**：理论上用户可以按 Alt+`[` 再按 `I`，但 Ink 的 `useInput` 一次只处理一个 keypress，所以 `'[I'` 必然是单一序列（即 focus event）。安全。

**关键退出清理**：必须在退出前关闭 focus reporting，否则下一个 shell prompt 在每次切窗口时都会收到 `\x1b[I` / `\x1b[O` 字面字符出现在命令行里——这是用户最讨厌的"TUI 不收拾终端"行为之一。已在 `restoreTerminal()` 中处理。

#### 实施陷阱（已踩，记录沉淀）

第一版只在 `<App>` 顶层 `useInput` 里识别 `'[I'` / `'[O'` 并 `return`。**用户切窗口时输入框里出现了 `[O[I[O[I...`**。

根因：**Ink `useInput` 是广播模式** — 任何 stdin chunk 都会调用**所有**已挂载的 `useInput` 监听器，没有 stopPropagation 机制。`<App>` 的"识别后 return"只阻止了**自己**这一个 handler 处理，无法阻止 `<TextInput>` 等其他组件把 `'[I'` 当作普通文本插入。

**唯一可靠的修法**：每个 `useInput` 调用点**都**要在第一行 sniff focus event 并 `return`。已经做了：

- 新增 `src/app/focusEvents.ts` 共享 `isTerminalFocusEvent(input)` helper + 两个常量
- 11 个 `useInput` 调用点（textInput / composerPane / app / modelPicker / sessionPicker / skillsPane / modelEditor / prompts ×2 / slashOutputOverlay / setupScreen）全部加 `if (isTerminalFocusEvent(input)) return`

教训：

> **任何无法被某种"事件传播阻断"机制保护的全局信号，都必须在所有消费点防御**。Ink 的 useInput 没有 stopPropagation，所以共享辅助函数 + 调用点纪律是唯一保障。

> 添加新的 `useInput` callsite 时，**第一行必须是** `if (isTerminalFocusEvent(input)) return`。这条已写进 `focusEvents.ts` 的文件 docstring 顶部，作为代码内规范。

#### 度量

| 指标 | 方法 | 改造前 | 改造后 |
|------|------|--------|--------|
| 失焦后 CPU 使用率 | `top -p $PID` 60s | ~1-2% | 0% |
| 失焦后 stdout 字节/秒 | tee 统计 | ~200 b/s | 0 |
| 用户观察"光标活跃感"与实际焦点匹配率 | 主观验证 | 0%（永远闪） | 100%（支持的终端） |
| 切窗口时输入框被污染字符数 | 重启 TUI → 切窗口 ×5 → 计数 | 10（每次 2 字符） | 0 |

---

### P1-18 `/dg_global off` 重启后失效（key 名分裂）+ 危险命令缺审批

#### 复现路径
1. TUI 中输入 `/dg_global off`，看到 "Dangerous commands blocked (session + global, saved)"。
2. 退出 TUI，重新启动。
3. statusBar 仍然显示与重启前不一致的状态；让 agent 跑 `rm -rf` —— 直接执行，**完全没有 ApprovalOverlay 弹出**。

#### 根因定位

两个独立 bug 叠加成一个症状。

**Bug 1：cli_config.json 的 key 名在写入侧与读取侧不一致**

| 路径 | key 名 | 角色 |
|------|--------|------|
| `cli/config.py:33` schema 默认值 | `dangerous_allowed` | 默认 |
| `run_drsai_agent_factory.py:798` | `dangerous_allowed` | **冷启动读** ← 唯一真相源 |
| `slash.py:cmd_dg_global` (修复前) | `allow_dangerous_commands` ⚠️ | 写 |

`/dg_global off` 写的是 `cfg["allow_dangerous_commands"] = false`；下次启动 factory 读 `cfg.get("dangerous_allowed", False)` —— **完全不读你刚写的字段**，依然按旧值（甚至 schema 默认）放行。

实测：用户的 `cli_config.json` 因长期使用积累出**两个键共存**的乱状态：
```json
"dangerous_allowed": true,
"allow_dangerous_commands": false
```
factory 看到 `dangerous_allowed: true` → 给 agent 传 `allolow_dangrous_cmd=True` → operater_funs 跳过所有危险检测。

**Bug 2：危险命令完全没有审批回调**（已在前序提交中修）

`run_bash` / `run_bash_background` / `run_powershell` 的 `_DANGEROUS_RE.search` 命中分支以前是 `return Error: ...`，从来没调用 TUI 已有的 `approval_callback`。所以即使 key 名一致、`dangerous_allowed` 真的是 `false`，用户也只能看到 "Error: Dangerous command detected" —— 没机会单次授权。

#### 影响等级
**P1（严重）** — 安全敏感：用户以为已经关闭"危险命令放行"，实际仍然放行。

#### 修复

**Bug 1**: `slash.py:cmd_dg_global` 改写 / 读 / 弃用：

```python
cfg["dangerous_allowed"] = True/False         # 写：用 factory 读的同一个 key
cfg.pop("allow_dangerous_commands", None)     # 清掉历史 mismatched key
# 读 status 时 prefer canonical，fallback 到 legacy：
global_dg = cfg.get("dangerous_allowed", cfg.get("allow_dangerous_commands", False))
```

参考 `cmd_ws_global`：早就在做 `cfg.pop("only_in_workspace", None)` 同类清理；只有 `cmd_dg_global` 历史漏了。

**Bug 2**: `operater_funs.py` 加 `_request_dangerous_approval(cmd, kind)` async helper：

```python
async def _request_dangerous_approval(cmd, kind) -> bool:
    try:
        from drsai.backend.tui_gateway.adapter.callbacks import approval_callback
    except Exception:
        return False  # No TUI bound (legacy CLI / tests) → fail closed
    response = await asyncio.to_thread(
        approval_callback,
        command=cmd,
        description=f"{kind} flagged …",
        choices=["approve", "deny"],
        timeout=300,
    )
    return response == "approve"
```

3 处危险检测（`run_bash` / `run_bash_background` / `run_powershell`）从 `return Error` 改成"调审批 → 用户 approve 才放行"。

**配套修复**：`drsai_cli_assistant.__init__` 同步 `self._allow_dangerous_commands = kwargs.get("allolow_dangrous_cmd", False)` —— 之前 attribute 根本没设，statusBar 永远显示 `safe-cmd` 即使实际允许。

**用户行动**：用户的 `cli_config.json` 已被一次性脚本规范化（`dangerous_allowed: false`，删除 legacy 键）。新逻辑对未来用户的 config 自动迁移。

#### 度量

| 指标 | 方法 | 修复前 | 修复后 |
|------|------|--------|--------|
| `/dg_global off` 重启后是否生效 | 手动 | 否 | 是 |
| dangerous_allowed=false 时 rm -rf 行为 | 手动 | 直接执行（Bug 2） | 弹 ApprovalOverlay |
| statusBar `safe-cmd` 与实际行为是否一致 | 手动 | 否（永远 safe-cmd） | 是 |
| cli_config.json 中 key 同时存在两份的概率 | 重启数次 | 100%（漂移积累） | 0%（每次写都 pop legacy） |

#### 通用规则（沉淀到约定）

> **所有 `cfg[xxx] = ...` 写入必须用 factory 启动时读取的同一个 key 名**。
> 用 `cfg.pop("legacy_name", None)` 清理 mismatched key，避免 config 文件长期使用积累出"两个 key 共存语义不一致"的乱状态。
> 新增 slash 命令读写持久 cfg 时，**对照 `run_drsai_agent_factory.py` 的 `cli_cfg.get(...)` 列表**做 grep 验证，是 PR review 必查项。

#### Bug 3 后续 — ApprovalOverlay 不弹，命令静默被 deny（ContextVar 跨线程不传播）

接通审批回调（Bug 2）后实测：`safe-cmd` 模式下让 agent 执行 `rm -rf` —— 工具立刻返回 "命令被拒绝"，**ApprovalOverlay 从未弹出**。

根因：`callbacks._resolve_sid` 通过 `_current_session_id` ContextVar 找当前 session。`handle_prompt_submit` 在 RPC handler 线程里 `bind_session(session_id)` —— 但 `_run_turn_in_background` 用 **裸 `threading.Thread`** 启动 daemon thread，**ContextVar 不会跨 raw thread 传播**（只有 `contextvars.copy_context().run(...)` 或 `asyncio.to_thread` 自带的 copy 才会）。daemon thread 里 `_current_session_id` 是 default `None` → `_resolve_sid()` 返回 `""` → `approval_callback` 看到没 sid 立刻 return `"deny"` + warning log。

**修复**：
1. `callbacks.py` 加 `bind_thread_session` / `unbind_thread_session` + 一个 `{thread_id: sid}` 全局 map（带锁）。`_resolve_sid` 走 explicit arg → ContextVar → thread-map 三级 fallback。
2. `prompt._run_turn_in_background` 在 daemon thread **顶部** 重新 `bind_session(session_id) + bind_thread_session(session_id)` —— 这样：
   - 同线程同步代码：靠 contextvar
   - `asyncio.to_thread(approval_callback)`：靠 contextvar 自动 copy（stdlib 实现）
   - 任何意外跨线程：靠 thread-map fallback
3. `finally` 调 `unbind_thread_session()` 防泄漏（daemon thread 短命但 ident 会被复用）。

**为什么不能只用 thread-map**：tools 内部用 `asyncio.to_thread` 跑 sync callback —— pool worker 的 thread id 与 daemon thread 不同，单靠 thread-map 也找不到。三级 fallback 是为了在两种跨线程模式下都能 work。

**自验单元测试**（callbacks.py）：

```python
def worker():
    bind_thread_session('thread-sid')
    assert _resolve_sid(None) == 'thread-sid'
    unbind_thread_session()
    assert _resolve_sid(None) == ''
threading.Thread(target=worker).start()
```

通过。

---

## 四、统一改造路线图

按依赖关系排序（虚线表示无强依赖）：

```
P0-04 移除清屏 (1h, 立即)
  │
  ▼
P1-02 streaming 期间 disabled TextInput (3-5h)
  │   ├── 解决"飘字符"
  │   └── 修复后顺手处理 P1-03 (光标闪烁，2h)
  ▼
P1-01 dynamic frame 行数最小化 (5-8h)
  │   ├── 工具行进 Static
  │   └── 与 P2-07 spinner 协调
  ▼
P1-05 useFocus + isActive 隔离 (4h, 渐进)
  │
  ▼
P1-06 useStdout resize hook (1h)
  │
  ▼
P2-* 一系列优化 (各 1-3h)
  │
  ▼
P3-* 体验增强 (按需排期)
```

里程碑：

- **M1**（1 周）：P0-04 + P1-02 + P1-03 + P0/P1 验收。
- **M2**（2 周）：P1-01 + P1-05 + P1-06 + P2-08/09/10。
- **M3**（按需）：P2-07/11/12，P3 系列。

---

## 五、度量指标 & 验收标准

### 5.1 自动化测试基础设施

引入 `node-pty` + 终端 buffer 抓取：

```ts
// scripts/ux-test.mjs（新增）
import * as pty from 'node-pty'
const term = pty.spawn('node', ['dist/entry.mjs'], { cols: 80, rows: 24 })
const frames: string[] = []
term.onData(d => frames.push(d))
// 模拟键盘输入，等待事件，diff terminal buffer
```

每个 P1 问题有对应的回归用例：
- `tests/ux/p1-01-streaming-scroll.spec.mjs`
- `tests/ux/p1-02-ghost-input.spec.mjs`
- `tests/ux/p1-03-cursor-blink.spec.mjs`
- `tests/ux/p0-04-no-clear-scrollback.spec.mjs`

### 5.2 验收标准

每个改造 PR 必须：

1. ✅ **不引入新依赖**（除非 dev-only 测试工具）。
2. ✅ **覆盖度量指标的 A/B 对照数据**（在 PR description 里）。
3. ✅ **手动跑过 7 终端矩阵**（iTerm2 / Alacritty / kitty / Windows Terminal / VSCode / tmux / GNU screen）。
4. ✅ **headless smoke test 通过**（CI）。
5. ✅ **CPU idle < 2%、memory < 100MB**（一致性回归）。

### 5.3 体验问卷

每个里程碑结束做内部问卷（10 人样本）：
- streaming 期间能否舒适地查看历史？1~5 分。
- 二次输入丢字符的频率？从不/偶尔/经常。
- 整体流畅度评分？1~5 分。

目标：从 P0+P1 修复前的基线提升 ≥ 1 分。

---

## 六、参考资料

- Ink 6 源码 — `node_modules/.../ink/build/log-update.js`：理解 frame 重写机制。
- Anthropic Claude Code 体验改进 commit log（公开） — 同类问题的解决思路。
- xterm Control Sequences — `https://invisible-island.net/xterm/ctlseqs/ctlseqs.html`，alt screen / cursor / SGR 完整规范。
- WCAG 2.1 AA 颜色对比度 — `https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html`。
- POSIX `NO_COLOR` 提案 — `https://no-color.org/`。
- node-pty — `https://github.com/microsoft/node-pty`，自动化 TUI 测试基础。

---

> 维护者：本文档每完成一个 P 项后，请回填**实测度量数字**和**链接到 PR**。  
> 最后更新：（此处填写当前日期）
