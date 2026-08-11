# 案例 3：搜索并解释 HEPiX 2026

## 身份与目的

- Case ID：`tool.web.hepix`
- Revision：1
- 目的：验证时效性问题触发真实网络搜索，答案由官方来源支持，并在 OpenDrSai 中产生可交互引用。

## 已核验基准

基准于 2026-08-05 核验。HEPiX 是面向高能物理和核物理机构 IT 人员的国际交流社区，关注科学计算、数据和 IT 基础设施。

- Spring 2026：2026-04-20 至 2026-04-24，葡萄牙里斯本，ISCTE Instituto Universitário de Lisboa；
- Fall 2026：2026-10-19 至 2026-10-23，美国内布拉斯加州林肯，University of Nebraska–Lincoln。

主要来源为 HEPiX 官网，以及 CERN Indico 的 Spring 和 Fall 官方活动页。城市、国家和机构名称允许中英文及合理标点变体，日期必须准确。

## 过程要求

必须实际调用网络搜索并成功访问至少一个主要来源，优先官网和官方活动页；最多 8 次 Tool Call。不得只凭模型记忆、把搜索摘要当最终依据、执行外部写操作或产生无关 Artifact。

## 引用交互

Spring 和 Fall 官方活动页都必须成为 OAEP Citation Part。正文引用标记应定位引用卡片，卡片可打开正确 URL，并可返回正文。Spring 事实不能关联 Fall 来源，反之亦然；纯文本 URL 不算交互引用。

## 验收和维护

组织性质、两场活动的日期地点和来源关系全部正确才通过。官方网页暂时不可用应记为 `environment_failed`。若官方事实改变，必须提升 Case revision 并更新基准，不得静默放宽断言。
