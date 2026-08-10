/**
 * 关联业务 — Step 2: 综合材料撰写 (Expert Recommendation + 附件3 generation)
 *
 * Reuses the SAME `uploadedFiles` state as 申请资料审查 — user uploads once,
 * the panel below the audit tab simply consumes the existing files and fires
 * a structured prompt that walks DocMaster through:
 *   1. extract project_info from 申报书 / 承诺书
 *   2. call recommend_experts_tool
 *   3. show ranked experts to the user, await selection
 *   4. call generate_expert_opinion_forms_tool with the selected list
 */
import React from "react";
import {
  FileText,
  Users,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { appContext } from "../../hooks/provider";
import type { UploadedFile } from "./GuanlianyewuPanel";

// ─── Props ───────────────────────────────────────────────────────────────────

interface ZongheCailiaoPanelProps {
  /** Files already uploaded in step 1 — shared, never re-uploaded here. */
  uploadedFiles?: UploadedFile[];
  /** Fires the assembled prompt into the chat. */
  onSubmit: (prompt: string) => void;
  /** True while the chat is processing — disables the button. */
  running?: boolean;
}

// ─── Department list (matches 04 专家清单/ recommending units) ────────────────
//
// Used as a quick-pick for `applicant_department`. The Python side does a
// dept-boost (+0.5) when this matches — so it's just a soft signal, free-text
// also works.

const DEPARTMENTS = [
  "加速器中心",
  "实验物理中心",
  "多学科中心",
  "粒子天体中心",
  "核技术应用研究中心",
  "理论室",
  "东莞研究部",
  "计算中心",
  "大装置管理中心",
  "通用运行部",
  "行政处",
  "技术发展与经营管理处",
];

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildZongheCailiaoPrompt(
  files: UploadedFile[],
  fieldQuery: string,
  applicantDept: string,
  numExperts: number,
): string {
  const fileList = files
    .map((f, i) => {
      const tag = f.tag ? `（用户标注：${f.tag}）` : "（未标注）";
      return `  ${i + 1}. ${f.name}${tag} — ${f.serverPath}`;
    })
    .join("\n");

  const fieldHint = fieldQuery.trim()
    ? `用户已指定专业领域：「${fieldQuery.trim()}」。`
    : `用户没有指定专业领域，请你**先**从申报书 / 承诺书的"关联业务内容"和"必要性"段落里**自动识别**业务专业领域（例如"超导腔检修服务"、"软件开发"、"机械加工"），再传给 recommend_experts_tool。`;

  const deptHint = applicantDept.trim()
    ? `申报人所在推荐单位：「${applicantDept.trim()}」（用作同单位 +0.5 加分）。`
    : `用户没有指定申报人所在单位。从申报书"申报人所在单位"字段里读出来，作为 applicant_department 传入。读不到就传空字符串。`;

  return `请帮我完成「关联业务 — 综合材料撰写」步骤：根据已上传的申请材料，推荐评审专家并生成预填写的「附件3 评审论证专家个人意见表」。

## 已上传的文件（共 ${files.length} 份，来自上一步「申请资料审查」）
${fileList}

**重要：这些文件路径都是 GFS 路径（\`gfs://\` 开头）。在读取之前先用 \`gfs_download\` 下载到本地，拿到本地绝对路径后再调 \`extract_docx_content_tool\` 等读取工具。建议批量下载所有文件再进入第一步。**

## 任务流程（请严格按顺序执行）

### 第一步：提取课题基本信息
用 \`extract_docx_content_tool\` 读取**关联业务申报书**（附件1）和**关联业务承诺书**（附件2）。需要拿到以下字段（缺哪个就写明缺哪个，不要编造）：
- 课题名称
- 课题编号
- 课题负责人 / 经办人
- 申报人所在单位
- 关联单位名称
- 关联类型 / 关联关系（如"高能所投资企业，申报人无股权"）
- 关联业务内容（一句话概括即可，不要原样拷贝整段）
- 合同金额（含大写）

### 第二步：推荐评审专家
${fieldHint}

${deptHint}

调用 \`recommend_experts_tool\`：
\`\`\`
recommend_experts_tool(
    field_query="<上一步识别 / 用户给的领域文本>",
    applicant_department="<申报人单位，没有就空字符串>",
    top_n=${numExperts},
    include_admin=True,
)
\`\`\`

把返回的 \`recommended_experts\` 用表格 / 清单形式展示给用户：每行包括姓名、职称、专业领域、推荐单位、邮箱、匹配理由（rationale）。**同时**展示 \`administrative_reviewers\`（行政审核人员，作为流程必经环节，与技术专家分开列出）。

### 第三步：等用户确认要邀请哪几位
不要自己拍板。问用户："以上候选您要邀请哪几位？默认会用前 3 位 + 全部行政审核人员，如需修改请直接回复姓名或编号。"

### 第四步：生成意见表
拿到用户确认后，调用 \`generate_expert_opinion_forms_tool\`：
\`\`\`
generate_expert_opinion_forms_tool(
    project_info={
        "课题名称": "...",
        "课题编号": "...",
        "课题负责人": "...",
        "经办人": "...",
        "关联单位": "...",
        "关联类型": "...",
        "业务内容": "...",
        "合同金额": "...",
    },
    experts=[<用户选定的姓名列表，或直接传 recommended_experts 的子集字典列表>],
)
\`\`\`

工具会自动把每份意见表通过 FilesEvent 推到前端（用户能直接下载）。返回结果里的 \`generated_files\` 列出每份文件的路径和对应专家姓名。

### 第五步：汇总
在对话里向用户报告：
- 已生成 N 份意见表（列出每位专家 + 文件名）
- 这些专家的联系方式（从第二步结果里抄过来，方便用户直接联系）
- 下一步建议：把意见表分别发给各位专家填写，等收齐后即可进入「公示信息生成」步骤

⚠️ **关键约束**：
- **不要**用 fill_docx_template_tool 处理附件3——专用工具已处理好结构。
- **不要**在第二步推荐结果出来后直接跳到第四步，必须先停下让用户选人。
- **不要**编造课题信息——读不到的字段就如实说"申报书里未填写"。`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const ZongheCailiaoPanel: React.FC<ZongheCailiaoPanelProps> = ({
  uploadedFiles = [],
  onSubmit,
  running = false,
}) => {
  const { darkMode } = React.useContext(appContext);
  const isDark = darkMode === "dark";

  const [fieldQuery, setFieldQuery] = React.useState("");
  const [applicantDept, setApplicantDept] = React.useState("");
  const [numExperts, setNumExperts] = React.useState(5);

  const border = isDark ? "border-white/10" : "border-gray-200";
  const bg = isDark ? "bg-white/[0.03]" : "bg-gray-50/60";
  const textPrimary = isDark ? "text-white" : "text-gray-900";
  const textSecondary = isDark ? "text-white/50" : "text-gray-500";
  const inputBg = isDark
    ? "bg-white/[0.05] border-white/10 text-white placeholder:text-white/30"
    : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-400";

  const canSubmit = uploadedFiles.length > 0 && !running;

  const handleSubmit = React.useCallback(() => {
    if (!canSubmit) return;
    onSubmit(
      buildZongheCailiaoPrompt(uploadedFiles, fieldQuery, applicantDept, numExperts)
    );
  }, [canSubmit, onSubmit, uploadedFiles, fieldQuery, applicantDept, numExperts]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`flex-shrink-0 px-2 pt-2 pb-2 border-b ${border}`}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <Users className="w-3 h-3 text-accent shrink-0" />
          <span className={`text-[11px] font-semibold ${textPrimary}`}>
            综合材料撰写
          </span>
        </div>
        <p className={`text-[10px] ${textSecondary} leading-relaxed`}>
          推荐评审专家并生成预填写的「附件3 专家个人意见表」
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {/* No-files state */}
        {uploadedFiles.length === 0 ? (
          <div
            className={`flex gap-1.5 rounded-md px-2 py-2 text-[10px] ${
              isDark
                ? "bg-amber-500/10 text-amber-300"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <p className="leading-snug">
              请先在「申请资料审查」里上传申报书与承诺书。这里会复用同一份文件，无需重复上传。
            </p>
          </div>
        ) : (
          <>
            {/* Reused files preview */}
            <div className="space-y-1.5">
              <p
                className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}
              >
                复用上一步的 {uploadedFiles.length} 份文件
              </p>
              <div className={`rounded-md border ${border} ${bg} px-2 py-1.5 space-y-1`}>
                {uploadedFiles.slice(0, 4).map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5">
                    <FileText className={`w-3 h-3 shrink-0 ${textSecondary}`} />
                    <span className={`text-[10px] flex-1 truncate ${textPrimary}`}>
                      {f.name}
                    </span>
                    {f.tag && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent shrink-0">
                        {f.tag}
                      </span>
                    )}
                  </div>
                ))}
                {uploadedFiles.length > 4 && (
                  <p className={`text-[9px] ${textSecondary} pl-4`}>
                    …还有 {uploadedFiles.length - 4} 份
                  </p>
                )}
              </div>
            </div>

            {/* Optional: field query override */}
            <div className="space-y-1">
              <label
                className={`text-[10px] font-medium ${textSecondary}`}
              >
                专业领域 <span className="opacity-60">（留空让 DocMaster 自动识别）</span>
              </label>
              <input
                type="text"
                value={fieldQuery}
                onChange={(e) => setFieldQuery(e.target.value)}
                placeholder="如：超导腔检修服务"
                className={`w-full rounded-md border px-2 py-1 text-[11px] outline-none focus:border-accent transition-colors ${inputBg}`}
              />
            </div>

            {/* Optional: applicant dept */}
            <div className="space-y-1">
              <label className={`text-[10px] font-medium ${textSecondary}`}>
                申报人所在单位 <span className="opacity-60">（用于同单位加分）</span>
              </label>
              <select
                value={applicantDept}
                onChange={(e) => setApplicantDept(e.target.value)}
                className={`w-full rounded-md border px-2 py-1 text-[11px] outline-none focus:border-accent transition-colors ${inputBg}`}
              >
                <option value="">— 自动从申报书读取 —</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Top-N control */}
            <div className="space-y-1">
              <label className={`text-[10px] font-medium ${textSecondary}`}>
                推荐人数：<span className={textPrimary}>{numExperts}</span>
              </label>
              <input
                type="range"
                min={3}
                max={10}
                value={numExperts}
                onChange={(e) => setNumExperts(Number(e.target.value))}
                className="w-full accent-[var(--color-accent,#3b82f6)]"
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className={`flex-shrink-0 px-2 py-2 border-t ${border}`}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={`w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold transition-all ${
            !canSubmit
              ? isDark
                ? "bg-white/5 text-white/25 cursor-not-allowed"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-accent text-white hover:bg-accent/90 active:scale-[0.98]"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          {running ? "处理中…" : "推荐专家并生成意见表"}
        </button>
        {uploadedFiles.length === 0 && (
          <p className={`text-center text-[10px] mt-1.5 ${textSecondary}`}>
            等待上一步上传完成
          </p>
        )}
      </div>
    </div>
  );
};

export default ZongheCailiaoPanel;
