# Diagram Support

**这份文档的定位。** 本文定义 `ppt-polished-deck-collab` 中 diagram 模块的专门支持，覆盖系统架构图、dataflow、dependency map、journey、机制图和复杂 connector 页的设计与实现边界。它是 `references/modules/technical_support.md` 与 `references/design/design_support.md` 之下的专项文档。

## 目录

- 什么时候先读它
- 两种 diagram 路线
- asset slot 合同
- Diagram 选择表
- 视觉语法与 edge budget
- 当前可复用的技术能力
- Connector 调试清单
- Mermaid 的定位
- 验证要求

## 什么时候先读它

**当页面的主资产是结构图，而不是普通图表或纯文字时，先读这份文档。** 它回答的是“这页为什么该是 diagram，以及 diagram 该以什么方式落地”。

## 两种 diagram 路线

**`diagram-connector` 适合后续会继续拖动维护的复杂图。** 系统架构图、依赖图、带异常支线的数据流图，只要后续要调整节点位置、插入新节点、保留真实结构关系，就应使用真绑定 connector。

**`diagram-visual` 适合解释型结构页。** 当页面主要目的是让读者理解层次、阶段、责任边界或主路径，而不是后续继续维护复杂连线时，优先使用纯视觉箭头、层级卡片和 panel 结构。

## asset slot 合同

**connector 路线。** `module: diagram-connector`，`backend: python-pptx`，`asset_type: diagram`，`validation_mode: diagram_connector`。slot 应登记 Mermaid 草稿、节点 / 边数据、生成脚本或输入描述，并在验证阶段登记 connector report。

**visual 路线。** `module: diagram-visual`，`backend: python-pptx` 或 `mermaid`，`asset_type: diagram`，`validation_mode: diagram_visual` 或 `preview_only`。slot 应说明它不依赖真 connector，并通过 preview 和人工主路径复核验收。

**不能做什么。** 不要让 Mermaid SVG、截图或视觉假线冒充真绑定 connector。不要在一页中堆出读者无法追踪的 hairball；edge budget 超限时应拆页或改成分层表达。

## Diagram 选择表

| 结构任务 | 推荐路线 | 典型图形 | 为什么 |
| --- | --- | --- | --- |
| 系统分层、模块边界 | `diagram-visual` 或轻 connector | Layered architecture | 先保证一眼可读，再考虑局部关系 |
| 关键主路径与异常支线 | `diagram-connector` | Dataflow / process flow | 需要稳定维护边和节点 |
| roadmap 依赖 | `diagram-connector` | Dependency map | 拖动和改依赖是常态 |
| 研究机制、Agent memory 结构 | `diagram-visual` | Mechanism sketch / causal diagram | 更重解释，少量关系就够 |
| 管理层解释流程 | `diagram-visual` | Process flow / handoff flow | 阅读成本低，比真 connector 更稳 |

## 视觉语法与 edge budget

**先选视觉语法，再画边。** 分层架构图和数据流图是两种不同世界观，不应在一页里混用。

**分层架构图推荐默认走 layer card。** 用层级卡片、短箭头和局部注释表达结构，不要在总览页把所有依赖画成 hairball。

**复杂图必须有 edge budget。** 建议：
- 分层总览页：`0~3` 条边
- 主流程页：`8~12` 条边
- 角色协同页：`6~10` 条边

**每条边都必须回答一个问题。** 例如 “A 产出 X，B 消费 X”“A 触发 B”“A 约束 B”“A 反馈到 B”。说不清语义的边应先删。

## 当前可复用的技术能力

**当前 skill 内已经有 diagram 的可执行底座。**
- `scripts/check_pptx_connectors.py`
- `scripts/ppt_asset_helpers.py`

**当前最常用的 helper 如下。**
- `add_node()`：创建可被 connector 绑定的业务节点
- `add_glued_connector()`：把 connector 真正粘到两个 shape 的连接点
- `pick_contrast_text_rgb()`：为深浅不同的节点自动选择文字色

**连接点映射已经固定。** `top=0`、`left=1`、`bottom=2`、`right=3`。后续 diagram 脚本不应再自定义一套索引。

## Connector 调试清单

**拖动后散线，优先查这三件事。**
- 是否同时调用了 `begin_connect()` 与 `end_connect()`
- 是否把线绑到了业务节点，而不是 lane / cluster 外框
- 是否使用了正确的连接点索引

**当前推荐人工回归方式。** 至少拖动主图中的 5 个关键节点，确认线端点跟随移动，而且没有连错对象。

## Mermaid 的定位

**Mermaid 只属于 diagram 草稿层。** 它适合在讨论阶段快速锁定结构、命名和主路径，但不应冒充最终交付。

**当前 skill 不把 Mermaid 设为硬依赖。** 环境里如果没有 `mmdc`，diagram 模块仍然可以通过 `python-pptx` 直接构建 editable PPT。

## 验证要求

**`diagram-connector` 的最低证据是两份。**
- `connector_report.json`
- 逐页预览图

**`diagram-visual` 的最低证据是一份自动结果和一份人工判断。**
- 逐页预览图
- 对主路径、层级和视觉中心的人工复核记录

**快速命令。**

```bash
python scripts/check_pptx_connectors.py \
  --pptx <path/to/deck.pptx> \
  --slide 3 \
  --json-out <path/to/connector_report.json> \
  --min-connectors 1
```
