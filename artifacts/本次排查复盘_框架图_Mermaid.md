# 本次错误总结 · 框架图

配套文件：`本次排查复盘框架图.png`（示意渲染）、`本次排查复盘框架图.md`（文字版）

---

## 图 1：排查时间线（哪个环节出的错）

```mermaid
flowchart TD
    A["① 定位渲染层<br/>StructuredMessageParts / processTimelineModel"] --> B["② 找到根因<br/>updatePartWithDelta 无条件拼接"]
    B --> C["③ 查后端源头<br/>native_decoder.py 重发/重编号"]
    C --> D["④ 复现<br/>同一句 → ×3"]
    D --> E["⑤ 实现修复<br/>appendReasoningDeltaText 重叠检测"]
    E --> F["⑥ 跑测试 + typecheck<br/>全部通过"]
    F --> G["⑦ 断言『已修复』"]:::bad
    G --> H["⑧ 用户反馈仍重复 + 截图"]:::fact
    H --> I["⑨ 推论：跑的是旧 bundle"]:::bad
    I --> J["⑩ 读 dev.ps1<br/>脚本只切端点，仍走 Vite dev"]:::fact
    J --> K["⑪ 实测 dev server 模块<br/>HTTP 200 且含修复"]:::fact
    K --> L["⑫ 归因未定<br/>待 Ctrl+R 验证"]

    classDef bad fill:#d1495b,color:#fff,stroke:#8c1c2b
    classDef fact fill:#2a9d8f,color:#fff,stroke:#1b6b61
```

## 图 2：核心错误 —— 验证层级错位

```mermaid
flowchart LR
    subgraph M["我改的 + 我测的"]
        direction TB
        S1["shared/api/structuredConversation.ts<br/>（源文件）"]
        S2["shared/test-kit/*.mts<br/>（直接读源文件）"]
        S1 --> S2
    end

    subgraph R["用户实际在跑的"]
        direction TB
        R1["Vite dev server<br/>127.0.0.1:5173"]
        R2["Electron renderer"]
        R1 --> R2
    end

    M -.->|"❌ 缺这一层验证"| R

    style M fill:#e8f5f3,stroke:#2a9d8f
    style R fill:#fdf1e0,stroke:#e9a03b
```

**关键**：Node 侧测试通过 ⇒ **源逻辑正确**；
但它**推不出**「用户界面已生效」。中间那道虚线必须实测。

## 图 3：错误归类

```mermaid
mindmap
  root((本次错误))
    A 验证层级错位
      测源文件≠测运行产物
      测试通过 ≠ 界面生效
    B 推论当事实
      用 13:15 时间戳推断
      未先确认该产物是否被加载
    C 命名误导
      *-production.cmd 实为端点配置
      未读脚本就按名字判断
```

## 图 4：根因结构（两个重复轴）

```mermaid
flowchart TD
    P["现象：思考内容重复显示 2~3 次"] --> AX1
    P --> AX2

    AX1["轴 1 · part 内重复"] --> A1["reasoning.append 被当纯增量拼接<br/>后端实际会重发 / 重编号"]
    A1 --> A2["已修：appendReasoningDeltaText<br/>+ reasoningPushIsRedundant"]

    AX2["轴 2 · 跨 part 重复"] --> B1["同一文本既投 reasoning part<br/>又投 markdown part"]
    B1 --> B2["嫌疑点（未验证）：<br/>oaepPresentationProjector.presentationDelta"]
    B2 --> B3["getAssistantSpeechText 走 markdown<br/>StructuredReasoning 走 reasoning"]

    style P fill:#1f3a5f,color:#fff
    style A2 fill:#2a9d8f,color:#fff
    style B2 fill:#e9a03b,color:#fff
```

---

## 待验证分支

```mermaid
flowchart TD
    T["Ctrl+R 重载 Desktop 后复现"] --> Q{重复是否消失?}
    Q -->|消失| Y["热更新未生效<br/>问题闭环，无需改代码"]
    Q -->|仍重复| N["轴 2 成立<br/>查 oaepPresentationProjector<br/>的 part 投影逻辑"]

    style T fill:#1f3a5f,color:#fff
    style Y fill:#2a9d8f,color:#fff
    style N fill:#e9a03b,color:#fff
```
