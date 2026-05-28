---
deck:
  title: "标准战不是技术评测 | Why Better Tech Often Loses the Standard War"
  audience: "战略负责人、投资人、研究人员与管理层"
  scenario: "管理层叙事型历史案例 deck，用三场标准战纠正对市场胜负手的误判"
  objective: "证明标准战主要由协同成本、切换风险、补充品联盟、部署速度与预期管理决定"
  theme_tokens:
    title_font_name: "Arial"
    body_font_name: "Arial"
    latin_font_name: "Arial"
    east_asia_font_name: "黑体"
    body_font_pt: 14
    left_margin_in: 0.78
    right_margin_in: 15.22
    background_rgb: [246, 244, 238]
    ink_rgb: [21, 28, 37]
    accent_rgb: [34, 78, 145]
    accent_warm_rgb: [190, 97, 47]
---

# 标准战不是技术评测 | Deck Narrative

## Global Narrative

**总体判断。** 标准不会奖励孤立的技术最优，标准奖励最容易被整个生态一起采用的方案。真正结算一场标准战的，不是一张规格表，而是协同成本、切换风险、补充品联盟、部署速度和预期管理。

**论证主线。** 先把“市场在做技术评测”的直觉摆上台面，再明确抛出三条 `claim`，随后用 Betamax vs VHS、OSI vs TCP/IP、Blu-ray vs HD DVD 三组案例逐条验证，最后把三条 `claim` 压成一个可执行的管理层判断清单。

**三条 claim。**
- `Claim 1`：任务匹配和联盟速度会压过峰值规格。
- `Claim 2`：先跑起来并得到反馈的体系会定义现实。
- `Claim 3`：补充品和 bundle 会在不透明市场替用户下注。

**风格边界。** 这套 deck 必须保留咨询式结论标题和研究式机制解释的双重气质。文字用中文，保留标准名、协议名和核心术语的英文写法。所有 case 页都要给出明确 verdict，而不是堆历史素材。

## Shared Terminology

**Installed base。** 已被用户、企业或渠道采用的既有基盘，它决定一个新标准需要克服多大的切换摩擦。

**Complements。** 内容、硬件、开发工具、渠道、租赁体系、政策支持等补充品联盟，它们决定标准是否能形成协同扩散。

**Expectation management。** 市场是否相信某个方案会成为 dominant standard。这个预期会反过来影响投资、渠道站队和用户等待行为。

## Slide Narrative

### S01 | 标准不会奖励最优技术，标准奖励最容易被生态一起采用的方案
```yaml slide_spec
title: "标准不会奖励最优技术，标准奖励最容易被生态一起采用的方案"
reader_question: "这套 deck 最核心的判断是什么？"
page_task: "persuade"
reading_mode: "scan"
archetype: "hero-statement"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "标准战的赢家通常先闭合生态协调，而不是先拿到局部性能桂冠。"
required_assets: []
```

**Narrative Role.** 这页负责定调，把整套 deck 锁在一句可以记住、也可以反复引用的总论点上。

**Content Notes.** 用一个强 headline、三条 `claim` 锚点和一句副标题建立“误判纠正”的张力，让观众知道后面不是历史课，而是逐条验证的决策课。

**Layout Notes.** 左侧是主论点和补充句，右侧用三张 case anchor card 做视觉节奏，底部只保留一句轻量 summary。

### S02 | 市场不是在做技术评测，市场是在给协同风险定价
```yaml slide_spec
title: "市场不是在做技术评测，市场是在给协同风险定价"
reader_question: "为什么技术人会系统性高估规格表，低估 adoption friction？"
page_task: "explain"
reading_mode: "decision"
archetype: "decision-logic"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "技术性能只解释局部优劣，采用风险才解释谁能成为标准。"
required_assets: []
```

**Narrative Role.** 这页负责把读者的默认直觉摆出来，再把判断轴从“性能”切到“采用风险”。

**Content Notes.** 左右两栏对照“工程师直觉”和“市场真实结算项”，并在右侧明确写出后面要验证的三条 `claim`，强调网络效应如何放大早期优势。

**Layout Notes.** 必须像一页清晰的思维校正卡，不要做成普通 bullet page。

### S03 | 标准战真正结算的是五个变量：兼容、装机基盘、补充品、部署速度和预期管理
```yaml slide_spec
title: "标准战真正结算的是五个变量：兼容、装机基盘、补充品、部署速度和预期管理"
reader_question: "应该用什么框架替代“规格表心智”去理解标准战？"
page_task: "explain"
reading_mode: "guided"
archetype: "process-flow"
asset_mode: "diagram-connector"
validation_mode: "diagram_connector"
key_message: "标准战的主变量是协同成本及其放大器，而不是单点技术最优。"
required_assets:
  - "assets/diagrams/market_vote_framework.mmd"
  - "data/processed/five_factor_framework.csv"
```

**Narrative Role.** 这页给出全套理论框架，是三组案例的共同解释器。

**Content Notes.** 用一个带真实 connector 的五节点主图，把“局部技术优势”导向“市场采用结果”的路径讲清楚；右侧补充每个因素压的是什么风险。

**Layout Notes.** 主图必须是页面主中心，右侧只做简洁解释，避免 diagram 和长文案抢焦点。

### S04 | Betamax 输掉的不是画质，它先输给了家庭任务匹配和联盟扩张速度
```yaml slide_spec
title: "Betamax 输掉的不是画质，它先输给了家庭任务匹配和联盟扩张速度"
reader_question: "为什么更被技术圈偏爱的 Betamax 没能成为家庭录像标准？"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "客厅先为“能不能录完整场比赛”投票，然后才轮到规格表发言。"
required_assets:
  - "data/processed/case_milestones.csv"
```

**Narrative Role.** 这页负责把 VHS/Betamax 从“画质神话”拉回家庭任务、制造成本和授权策略。

**Content Notes.** 上半部是 case verdict 和两个关键事实，下半部用事件带和 task/cost/alliance 三张卡片讲清楚为何 VHS 更容易被家庭和厂商同时采用。

**Layout Notes.** 这是第一个案例页，画面必须非常利落，让观众立刻感受到“历史细节被压成了结构”。

### S05 | VHS 形成了更低风险的集体下注路径，所以规格劣势没有妨碍它成为标准
```yaml slide_spec
title: "VHS 形成了更低风险的集体下注路径，所以规格劣势没有妨碍它成为标准"
reader_question: "Betamax vs VHS 这场战争给了管理层什么可复用的判断？"
page_task: "persuade"
reading_mode: "decision"
archetype: "board-memo"
asset_mode: "mixed"
validation_mode: "chart_editable"
key_message: "先满足用户任务、再形成制造联盟、再扩大 installed base，才是标准化闭环。"
required_assets:
  - "data/processed/home_video_scorecard.csv"
```

**Narrative Role.** 这页把第一个 case 抽象成可复用的 lesson，而不是继续堆事实。

**Content Notes.** 用“协调闭环”小图、两条 takeaway 和一张原生条形图，把任务匹配、制造经济性和联盟速度的差异显式画出来。

**Layout Notes.** 页面要像一页真正的管理层总结，不要像历史课课后题。

### S06 | OSI 输掉的不是理想性，它输给了太慢、太贵、太难落地
```yaml slide_spec
title: "OSI 输掉的不是理想性，它输给了太慢、太贵、太难落地"
reader_question: "为什么设计更完整的 OSI 最终没有成为互联网现实标准？"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "mixed"
validation_mode: "chart_image"
key_message: "机房会奖励能更快部署、免费实现、先获得反馈的协议栈。"
required_assets:
  - "data/processed/case_milestones.csv"
  - "data/processed/networking_scorecard.csv"
  - "build/rendered/python_figures/networking_factor_heatmap.png"
```

**Narrative Role.** 这页负责把 OSI 的失败讲成时间窗口与实现成本问题，而不是“技术人不懂理论”的情绪化结论。

**Content Notes.** 左侧用 time strip 讲关键节点，并用一张 Python heatmap 把四个因素的强弱差异显式化；右侧做 OSI / TCP-IP 的落地对照，页面主 message 仍然是“时间窗口决定现实路径”。

**Layout Notes.** 与 S04 保持同家族语言，但更偏组织与部署视角。

### S07 | 先跑起来的协议会反过来定义现实，架构完整性不会自动转化成标准地位
```yaml slide_spec
title: "先跑起来的协议会反过来定义现实，架构完整性不会自动转化成标准地位"
reader_question: "OSI vs TCP/IP 这场战争背后的管理含义是什么？"
page_task: "compare"
reading_mode: "decision"
archetype: "comparison-matrix"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "部署速度、获取成本和诊断可用性，往往比理论完整性更先决定 adoption。"
required_assets: []
```

**Narrative Role.** 这页把第二个案例压缩成一张比较页，直接回答“为什么现实会站在 TCP/IP 一边”。

**Content Notes.** 用一张原生表格做主对照，右侧三条 lesson card 把“完整体系”与“可运行体系”的差异压成更可执行的判断。

**Layout Notes.** 一页只做比较，不再重复叙事。

### S08 | Blu-ray 赢的不是一项单点参数，它赢在内容联盟、PS3 装机与预期锚定
```yaml slide_spec
title: "Blu-ray 赢的不是一项单点参数，它赢在内容联盟、PS3 装机与预期锚定"
reader_question: "为什么消费者不容易感知技术差距时，联盟和捆绑会主导结果？"
page_task: "explain"
reading_mode: "guided"
archetype: "research-note"
asset_mode: "mixed"
validation_mode: "preview_only"
key_message: "当用户看不懂单点性能时，内容生态、默认装机和渠道信号会替他们投票。"
required_assets:
  - "data/processed/case_milestones.csv"
```

**Narrative Role.** 这页把第三个案例的胜负手定位在 complementors 和 installed base，而不是光盘格式参数。

**Content Notes.** 用 ecosystem board 呈现 studio、console、retail 和 consumer 四类角色，再用时间节点把 PS3 和 Toshiba 退出串起来。

**Layout Notes.** 视觉上要比前两个案例更“董事会”和“生态”，少一点工程味。

### S09 | 当用户看不懂技术差距，补充品和捆绑会替市场做决定
```yaml slide_spec
title: "当用户看不懂技术差距，补充品和捆绑会替市场做决定"
reader_question: "Blu-ray vs HD DVD 给今天的平台与标准竞争什么启示？"
page_task: "persuade"
reading_mode: "decision"
archetype: "decision-logic"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "晚期标准战里，补充品 gatekeeper 和 bundle engine 往往比核心规格更能改写结果。"
required_assets: []
```

**Narrative Role.** 这页把第三个 case 抽象成一个现代平台战规律。

**Content Notes.** 用三段逻辑链说明“内容联盟 -> 默认装机 -> dominant standard 预期”的自强化关系。

**Layout Notes.** 结构需要非常清晰，像一页简短有力的投资备忘录。

### S10 | 三个案例的共同点很稳定：输家优化局部性能，赢家先闭合生态协调
```yaml slide_spec
title: "三个案例的共同点很稳定：输家优化局部性能，赢家先闭合生态协调"
reader_question: "把三场战争放在一起看，真正重复出现的模式是什么？"
page_task: "compare"
reading_mode: "reference"
archetype: "comparison-matrix"
asset_mode: "table-native"
validation_mode: "preview_only"
key_message: "跨行业重复出现的胜利模式，是更低的集体下注风险，而不是更高的局部技术峰值。"
required_assets:
  - "data/processed/comparison_matrix.csv"
```

**Narrative Role.** 这页是三案合并页，用显式矩阵把重复规律锁定下来。

**Content Notes.** 行是六个关键维度，列是三场战争；右下角补一个总括，点明输赢模式的可迁移性。

**Layout Notes.** 这页必须读起来像真正的 matrix，不要退化成普通列表。

### S11 | 判断一场标准战，先问五个会让管理层真正下注的问题
```yaml slide_spec
title: "判断一场标准战，先问五个会让管理层真正下注的问题"
reader_question: "如果把历史压成今天能直接使用的框架，应该怎么问？"
page_task: "persuade"
reading_mode: "guided"
archetype: "process-flow"
asset_mode: "diagram-visual"
validation_mode: "diagram_visual"
key_message: "好的标准判断框架，必须直接回答 installed base、联盟、成本、预期和渠道杠杆。"
required_assets:
  - "assets/diagrams/management_questions.mmd"
  - "data/processed/five_factor_framework.csv"
```

**Narrative Role.** 这页把历史材料转成方法论，是 deck 的真正业务出口。

**Content Notes.** 用五个 question card 组成一个 reading path，并在右侧放“投资/产品/平台”三类适用场景。

**Layout Notes.** 这页需要明显体现“拿来就能用”的气质，不要再回到案例叙事。

### S12 | 更好的技术，只有在它同时更容易被一起采用时，才更可能成为标准
```yaml slide_spec
title: "更好的技术，只有在它同时更容易被一起采用时，才更可能成为标准"
reader_question: "这套 deck 最后应该把什么结论留给观众？"
page_task: "persuade"
reading_mode: "scan"
archetype: "hero-statement"
asset_mode: "text-layout-native"
validation_mode: "preview_only"
key_message: "市场不奖励孤立的技术优雅，市场奖励被整个生态低风险采纳的能力。"
required_assets: []
```

**Narrative Role.** 这页负责收尾，把三场历史战争转成一句今天仍然成立的判断。

**Content Notes.** 用终局 statement、三条被重新点名的 `claim` 和一个简短 closing line 收束全套 deck，形成明确的总分总回扣。

**Layout Notes.** 结束页必须有余味和力度，留白要足，文字要狠。
