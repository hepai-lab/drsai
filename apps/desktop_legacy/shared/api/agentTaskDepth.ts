import type { AgentTaskDepth } from "./desktopApi";

export interface AgentTaskDepthDefinition {
  id: AgentTaskDepth;
  label: string;
  labelEn: string;
  estimatedTime: string;
  estimatedTimeEn: string;
  summary: string;
  summaryEn: string;
  output: string;
  outputEn: string;
}

export const AGENT_TASK_DEPTHS: readonly AgentTaskDepthDefinition[] = [
  {
    id: "quick",
    label: "快速",
    labelEn: "Quick",
    estimatedTime: "通常 2～5 分钟",
    estimatedTimeEn: "Usually 2–5 minutes",
    summary: "聚焦最相关的材料，完成一次核心检查。",
    summaryEn: "Focus on the most relevant material and perform one core check.",
    output: "交付：核心结论与下一步建议",
    outputEn: "Delivers: key findings and a next-step recommendation",
  },
  {
    id: "standard",
    label: "标准",
    labelEn: "Standard",
    estimatedTime: "通常 5～15 分钟",
    estimatedTimeEn: "Usually 5–15 minutes",
    summary: "覆盖全部已提供材料，比较主要结论并核对关键依据。",
    summaryEn: "Cover all supplied materials, compare major findings, and check key evidence.",
    output: "交付：结构化报告与来源清单",
    outputEn: "Delivers: structured report and source list",
  },
  {
    id: "deep",
    label: "深入",
    labelEn: "Deep",
    estimatedTime: "通常 15～30 分钟",
    estimatedTimeEn: "Usually 15–30 minutes",
    summary: "覆盖全部材料，逐项核对重要结论、冲突和不确定性，并独立复核。",
    summaryEn: "Cover all materials, check major claims, conflicts, and uncertainty, then verify independently.",
    output: "交付：详细报告、证据附录与风险清单",
    outputEn: "Delivers: detailed report, evidence appendix, and risk list",
  },
] as const;

export function isAgentTaskDepth(value: unknown): value is AgentTaskDepth {
  return value === "quick" || value === "standard" || value === "deep";
}

export function buildAgentTaskDepthContract(depth: AgentTaskDepth): string[] {
  if (depth === "quick") {
    return [
      "执行深度：快速。",
      "材料覆盖：只选择完成任务所必需且最相关的材料，不做无关扩展。",
      "检查深度：完成一次核心事实或一致性检查。",
      "交付物：一份核心结论与下一步建议。",
    ];
  }
  if (depth === "deep") {
    return [
      "执行深度：深入。",
      "材料覆盖：覆盖全部已提供材料，并建立主要结论与材料的对应关系。",
      "检查深度：逐项核对重要结论，明确冲突和不确定性，并采用独立方法复核。",
      "交付物：详细报告、证据附录与风险及待研究问题清单。",
    ];
  }
  return [
    "执行深度：标准。",
    "材料覆盖：覆盖全部已提供材料，并比较主要结论。",
    "检查深度：核对关键事实、来源和材料间一致性。",
    "交付物：结构化报告与来源清单。",
  ];
}
