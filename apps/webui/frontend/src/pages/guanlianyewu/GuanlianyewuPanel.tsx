/**
 * 关联业务审核 — Step 1: 申请材料完整性审核
 *
 * Design principle: we don't classify files by name. We collect whatever the
 * user uploads, let them optionally tag each file, then fire a single structured
 * prompt into DocMaster. The LLM reads each file's content (docx via
 * extract_docx_content_tool, pdf via run_read) and decides what it is, then
 * audits against the fixed 关联业务 checklist.
 */
import React from "react";
import {
  Upload,
  X,
  FileText,
  FileSearch,
  CheckCircle2,
  Info,
} from "lucide-react";
import { appContext } from "../../hooks/provider";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UploadedFile {
  /** Unique id for react key */
  id: string;
  name: string;
  /** Path on server after upload, used in the prompt */
  serverPath: string;
  /** Optional user tag — shown as a chip, editable */
  tag: string;
  sizeMb: number;
}

type Step = "upload" | "review" | "auditing";

interface GuanlianyewuPanelProps {
  /** Called when user hits "开始审核". Fires the prompt into the chat. */
  onSubmitAudit: (prompt: string) => void;
  /** Called by parent after files are uploaded to server — provides server paths */
  uploadedFiles?: UploadedFile[];
  onRequestUpload: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onUpdateTag: (id: string, tag: string) => void;
  auditRunning?: boolean;
}

// ─── Tag options (fuzzy — user can override) ─────────────────────────────────

const SUGGESTED_TAGS = [
  "关联业务申报书",
  "关联业务承诺书",
  "三家报价单",
  "关联方资质证明",
  "合同",
  "采购审批表",
  "专家评审意见",
  "其他",
];

// ─── Audit prompt builder ─────────────────────────────────────────────────────

export function buildAuditPrompt(files: UploadedFile[]): string {
  const fileList = files
    .map((f, i) => {
      const tag = f.tag ? `（用户标注：${f.tag}）` : "（未标注，请自行判断）";
      return `  ${i + 1}. 文件名：${f.name}${tag}\n     服务器路径：${f.serverPath}`;
    })
    .join("\n");

  return `请帮我对以下关联业务申请材料进行完整性审核。

## 上传的文件（共 ${files.length} 份）
${fileList}

**重要：这些文件路径都是 GFS 路径（以 \`gfs://\` 开头）。在读取任何文件之前，必须先用 \`gfs_download\` 下载到本地 workspace，拿到本地绝对路径后再用对应的读取工具。不要直接对 GFS 路径调 \`run_read\` 或 \`extract_docx_content_tool\`——那些工具只认本地文件系统路径。**

建议批量下载：一次性把所有文件都下载下来（可以并行调多个 \`gfs_download\`），拿到本地路径列表后再进入第一步。

## 审核任务

**第一步：识别每份文件的类型**

**强制规则：禁止以"无法提取文本"为由跳过审核。** 任何 PDF / 图片文件如果第一次读取返回为空、乱码或明显缺内容（典型场景：扫描件、盖章件、手机拍照导出 PDF、营业执照影印件、承诺书签字页），**必须**调用 \`extract_scanned_pdf_tool\` 重新读取后再判断。只有在 OCR 工具也返回 success: false 或者 full_text 仍然为空时，才可以标注为"无法验证"。

对每个文件路径，按以下规则读取内容并判断材料类型：
- **DOCX 文件** → \`extract_docx_content_tool\`
- **PDF 文件** → 先用 \`run_read\` 尝试。若返回 < 100 字符、乱码、或读出来全是页码 / 水印 / 二维码标记（"扫描全能王"等），**立刻**改调 \`extract_scanned_pdf_tool(file_path=...)\`，由它内部自动判断逐页是否 OCR。**不要**先把这份文件标成"无法提取"再继续——OCR 工具就是为这种情况准备的。
- **图片文件**（.png / .jpg / .jpeg / .bmp 等）→ 直接调 \`extract_scanned_pdf_tool\`，**不要**用 run_read。

读完之后，根据实际内容判断该文件属于以下哪种材料类型：
- 关联业务申报书（附件1）
- 关联业务承诺书（附件2）
- 三家报价单
- 关联方资质证明（营业执照/法人证书/资质证书等）
- 合同或补充协议
- 采购审批表
- 专家评审意见表
- 公示相关材料
- 其他（请说明）

如果 \`extract_scanned_pdf_tool\` 返回了 \`low_confidence: true\` 或者某一页 warnings 非空，在第三步报告里**显式提示**该文件 OCR 置信度低，建议人工复核——但**仍然要**用 OCR 出来的文本完成审核，不要因为置信度低就跳过。

**第二步：逐项审核材料完整性**
按以下清单逐项检查，对每项给出 ✅通过 / ⚠️需补充 / ❌缺失 的判断，并说明具体问题：

1. **申报书（附件1）**
   - 申报人姓名（含课题负责人/经办人两者）
   - 所在单位、联系电话、邮箱
   - 关联类型（至少填写一项，需说明申报人是否持股/任职）
   - 关联业务内容（含关联方名称、价格明细：品名/规格/单价/数量/总价）
   - 关联业务的必要性（业务本身必要性 + 选择该关联方的理由）
   - 价格公允性（三家报价情况，关联方是否最低或有说明）
   - 关联单位资质和能力说明（经营范围、资质证书、承担能力）

2. **承诺书（附件2）**
   - 课题来源、课题编号、课题名称
   - 关联单位名称、委托事项、金额是否填写
   - 签字栏是否有实际签名（非空白）

3. **三家报价单**
   - 是否提供了三家报价文件
   - 关联方报价是否为最低，或有合理说明

4. **关联方资质证明**
   - 是否提供营业执照或法人证书
   - 证件有效期是否清晰且在有效期内

5. **合同**
   - 是否已上传合同文件
   - 合同中是否载明课题名称或编号
   - 合同要素是否完整（标的、数量、质量标准、履行期限、价款）

6. **一致性核查**
   - 申报书与承诺书中的关联单位名称是否一致
   - 申报书与承诺书中的业务金额是否一致
   - 申报书与承诺书中的课题名称/编号是否一致

7. **专家评审**
   - 若合同金额≥10万元，是否已安排或提交专家评审材料

**第三步：汇总审核报告**
最后给出一个清晰的汇总，包括：
- 已具备的材料
- 缺失或需补充的具体内容
- 优先补充建议（按重要程度排序）

请用中文输出，格式清晰，方便申报人按照报告逐项补充材料。`;
}

// ─── Component ───────────────────────────────────────────────────────────────

const GuanlianyewuPanel: React.FC<GuanlianyewuPanelProps> = ({
  onSubmitAudit,
  uploadedFiles = [],
  onRequestUpload,
  onRemoveFile,
  onUpdateTag,
  auditRunning = false,
}) => {
  const { darkMode } = React.useContext(appContext);
  const isDark = darkMode === "dark";
  const dropRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [step, setStep] = React.useState<Step>("upload");
  const [dragging, setDragging] = React.useState(false);
  const [editingTagId, setEditingTagId] = React.useState<string | null>(null);

  // Reset to upload step when all files removed
  React.useEffect(() => {
    if (uploadedFiles.length === 0) setStep("upload");
    else setStep("review");
  }, [uploadedFiles.length]);

  // ── Drag-and-drop ──
  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onRequestUpload(files);
    },
    [onRequestUpload]
  );

  const handleFileInput = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onRequestUpload(files);
      e.target.value = "";
    },
    [onRequestUpload]
  );

  const handleAudit = React.useCallback(() => {
    if (uploadedFiles.length === 0) return;
    setStep("auditing");
    onSubmitAudit(buildAuditPrompt(uploadedFiles));
  }, [uploadedFiles, onSubmitAudit]);

  const border = isDark ? "border-white/10" : "border-gray-200";
  const bg = isDark ? "bg-white/[0.03]" : "bg-gray-50/60";
  const textPrimary = isDark ? "text-white" : "text-gray-900";
  const textSecondary = isDark ? "text-white/50" : "text-gray-500";
  const chipBase = isDark
    ? "bg-white/[0.07] hover:bg-white/[0.13] text-white/70"
    : "bg-gray-100 hover:bg-gray-200 text-gray-600";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`flex-shrink-0 px-2 pt-2 pb-2 border-b ${border}`}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <FileSearch className="w-3 h-3 text-accent shrink-0" />
          <span className={`text-[11px] font-semibold ${textPrimary}`}>关联业务审核</span>
        </div>
        <p className={`text-[10px] ${textSecondary} leading-relaxed`}>
          上传材料后将逐项核查完整性
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">

        {/* Drop zone — always visible so user can add more files */}
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed cursor-pointer transition-colors py-3 ${
            dragging
              ? "border-accent bg-accent/10"
              : isDark
                ? "border-white/15 hover:border-white/30 hover:bg-white/[0.04]"
                : "border-gray-300 hover:border-accent/50 hover:bg-accent/[0.03]"
          }`}
        >
          <Upload className={`w-4 h-4 ${dragging ? "text-accent" : textSecondary}`} />
          <p className={`text-[11px] text-center ${dragging ? "text-accent font-medium" : textSecondary}`}>
            {dragging ? "释放以上传" : "拖拽或点击上传"}
          </p>
          <p className={`text-[9px] ${textSecondary}`}>DOCX / PDF / 图片</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".docx,.doc,.pdf,.png,.jpg,.jpeg,.xlsx,.xls"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* File list */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-1.5">
            <p className={`text-[10px] font-medium uppercase tracking-wide ${textSecondary}`}>
              已上传 {uploadedFiles.length} 份
            </p>
            {uploadedFiles.map((f) => (
              <div
                key={f.id}
                className={`rounded-md border ${border} ${bg} px-2 py-1.5`}
              >
                {/* Filename + remove */}
                <div className="flex items-start gap-1.5">
                  <FileText className={`w-3 h-3 mt-0.5 shrink-0 ${textSecondary}`} />
                  <span className={`text-[11px] flex-1 min-w-0 break-words ${textPrimary}`}>
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(f.id)}
                    className={`shrink-0 p-0.5 rounded hover:bg-red-500/20 ${textSecondary} hover:text-red-400 transition-colors`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Tag chips */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {editingTagId === f.id ? (
                    // Expanded tag selector
                    <div className="flex flex-wrap gap-1">
                      {SUGGESTED_TAGS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            onUpdateTag(f.id, tag);
                            setEditingTagId(null);
                          }}
                          className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                            f.tag === tag
                              ? "bg-accent text-white"
                              : chipBase
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setEditingTagId(null)}
                        className={`rounded-full px-2 py-0.5 text-[10px] ${textSecondary} hover:text-primary transition-colors`}
                      >
                        收起
                      </button>
                    </div>
                  ) : (
                    // Single current tag + edit trigger
                    <button
                      type="button"
                      onClick={() => setEditingTagId(f.id)}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                        f.tag
                          ? "bg-accent/15 text-accent hover:bg-accent/25"
                          : chipBase
                      }`}
                    >
                      {f.tag || "标注文件类型（可选）"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info note — only in upload/review step */}
        {step !== "auditing" && (
          <div
            className={`flex gap-1.5 rounded-md px-2 py-1.5 text-[10px] ${
              isDark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-700"
            }`}
          >
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <p className="leading-snug">
              DocMaster 会读取每份文件内容来判断类型。标注仅供参考。
            </p>
          </div>
        )}

        {/* Auditing state */}
        {step === "auditing" && (
          <div
            className={`flex gap-1.5 rounded-md px-2 py-1.5 text-[10px] ${
              isDark ? "bg-green-500/10 text-green-300" : "bg-green-50 text-green-700"
            }`}
          >
            <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
            <p className="leading-snug">
              审核任务已发送，请查看对话。
            </p>
          </div>
        )}
      </div>

      {/* Footer action */}
      <div className={`flex-shrink-0 px-2 py-2 border-t ${border}`}>
        <button
          type="button"
          disabled={uploadedFiles.length === 0 || auditRunning}
          onClick={handleAudit}
          className={`w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold transition-all ${
            uploadedFiles.length === 0 || auditRunning
              ? isDark
                ? "bg-white/5 text-white/25 cursor-not-allowed"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-accent text-white hover:bg-accent/90 active:scale-[0.98]"
          }`}
        >
          <FileSearch className="w-4 h-4" />
          {auditRunning ? "审核中…" : "开始审核材料完整性"}
        </button>
        {uploadedFiles.length === 0 && (
          <p className={`text-center text-[10px] mt-1.5 ${textSecondary}`}>
            请先上传至少一份材料
          </p>
        )}
      </div>
    </div>
  );
};

export default GuanlianyewuPanel;
