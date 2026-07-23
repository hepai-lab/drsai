import type { DesktopTaskPlanStep } from "./desktopApi";

export function buildAgentTaskPlan(task: string): DesktopTaskPlanStep[] {
  const titles = isDataQualityTask(task)
    ? [
        "读取并确认数据文件和分析目标",
        "检查数据质量、缺失值、重复行和异常点",
        "核对统计结果、图表和异常解释",
        "生成数据问题摘要和改进建议",
      ]
    : isMultiMaterialSynthesisTask(task)
      ? [
          "读取并确认全部研究材料",
          "比较材料并整理共识、争议和证据缺口",
          "核对结论、材料来源和不确定性",
          "生成综合报告和下一步研究问题",
        ]
      : isReportUpdateTask(task)
        ? [
            "读取旧报告、最新数据和结果图",
            "更新报告中的数字、文字和图表关系",
            "核对新数据、结果图与报告内容一致",
            "生成保留原文件的导师版报告",
          ]
        : [
            "确认任务目标和输入材料",
            "完成任务所需的分析与处理",
            "检查结果是否符合任务目标",
            "整理并交付最终成果",
          ];
  const phases = ["input", "process", "check", "output"] as const;
  return titles.map((title, index) => ({ id: `step-${index + 1}`, phase: phases[index], title }));
}

export function isDataQualityTask(task: string): boolean {
  return /这份数据/.test(task) && /有没有问题|是否有问题|检查/.test(task);
}

export function isMultiMaterialSynthesisTask(task: string): boolean {
  return /综合这些材料/.test(task) && /共识/.test(task) && /争议/.test(task);
}

export function isReportUpdateTask(task: string): boolean {
  return /最新数据.*旧报告|旧报告.*最新数据/.test(task);
}
