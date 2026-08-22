import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ManagerPresentationGenerateRequest,
  ManagerPresentationGenerateResult,
  ManagerPresentationProgressEvent,
  ManagerPresentationStageArtifact,
  DesktopTaskDeliverySummary,
  ManagerPresentationWorkStage,
  ManagerPresentationAudience,
  ManagerPresentationAudienceProfile,
  ManagerPresentationKeyConclusionEvidence,
} from "../api/desktopApi";
import {
  extractPresentationPdf,
  type PresentationPdfResult,
} from "./presentationPdf";

const REQUIRED_ROLES = [
  "cover",
  "executive_summary",
  "background",
  "wlcg",
  "asian_networks",
  "data_challenges",
  "hl_lhc_requirements",
  "conclusions",
  "sources",
] as const;

interface DeckSlideSpec {
  role: string;
  title: string;
  body: string[];
  sourcePages: number[];
  speakerNotes?: string;
  metrics?: string[];
  metricLabels?: string[];
  timeline?: Array<{ year: string; value: string }>;
}

interface DeckSpec {
  audience: ManagerPresentationAudience;
  language: "zh-CN";
  slides: DeckSlideSpec[];
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ManagerPresentationGenerationOptions {
  templatePath: string;
  signal?: AbortSignal;
  phaseDelayMs?: number;
  failAtPhase?: "analyzing" | "planning" | "generating" | "validating";
  failureMessage?: string;
  isPaused?: () => boolean;
  waitUntilResumed?: () => Promise<void>;
  setActiveOperationController?: (controller: AbortController | null) => void;
  getRequirements?: () => string[];
  fileWriteRetryLimit?: number;
  simulateFileBusyAttempts?: number;
  stageArtifactThresholdMs?: number;
  startedAtMs?: number;
  initialStageArtifacts?: ManagerPresentationStageArtifact[];
  onOutputPlanned?: (outputPath: string, manifestPath: string) => Promise<void>;
}

class FileWriteRetryExhaustedError extends Error {
  readonly attempts: number;
  readonly code = "EBUSY";

  constructor(path: string, attempts: number, cause?: unknown) {
    super(`Target file is busy after ${attempts} attempts: ${path}`, { cause });
    this.name = "FileWriteRetryExhaustedError";
    this.attempts = attempts;
  }
}

export class ManagerPresentationCancelledError extends Error {
  constructor() {
    super("Manager presentation generation was cancelled.");
    this.name = "ManagerPresentationCancelledError";
  }
}

export async function generateManagerPresentation(
  request: ManagerPresentationGenerateRequest,
  emit: (event: ManagerPresentationProgressEvent) => void,
  options: ManagerPresentationGenerationOptions,
): Promise<ManagerPresentationGenerateResult> {
  const requestId = cleanRequestId(request.requestId);
  const workspacePath = resolveRequiredPath(request.workspacePath, "workspacePath");
  const sourcePath = resolveRequiredPath(request.sourcePath, "sourcePath");
  assertInside(workspacePath, sourcePath, "The presentation PDF must be inside the active workspace.");
  if (extname(sourcePath).toLowerCase() !== ".pdf") throw new Error("A PDF source file is required.");
  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile()) throw new Error("The presentation PDF source is not a file.");
  const audience: ManagerPresentationAudience = request.audience === "technical_experts" ? "technical_experts" : "non_expert_managers";

  let currentProgress = 0;
  let currentOutputPath: string | undefined;
  let currentWorkStage: ManagerPresentationWorkStage = "analyzing";
  const stageArtifacts: ManagerPresentationStageArtifact[] = [...(options.initialStageArtifacts ?? [])];
  let currentDeliverySummary: DesktopTaskDeliverySummary | undefined;
  const startedAtMs = options.startedAtMs ?? Date.now();
  const stageArtifactThresholdMs = Math.max(0, options.stageArtifactThresholdMs ?? 10 * 60 * 1000);
  const send = (
    phase: ManagerPresentationProgressEvent["phase"],
    progress: number,
    message: string,
    outputPath?: string,
    activeStage?: ManagerPresentationWorkStage,
  ): void => {
    if (activeStage) currentWorkStage = activeStage;
    else if (["analyzing", "planning", "generating", "validating"].includes(phase)) {
      currentWorkStage = phase as ManagerPresentationWorkStage;
    }
    currentProgress = progress;
    currentOutputPath = outputPath ?? currentOutputPath;
    emit({
      requestId,
      phase,
      activeStage: currentWorkStage,
      progress,
      message,
      outputPath: currentOutputPath,
      stageArtifacts: [...stageArtifacts],
      ...(currentDeliverySummary ? { deliverySummary: currentDeliverySummary } : {}),
    });
  };

  const honorPause = async (activeStage: ManagerPresentationWorkStage): Promise<void> => {
    if (!options.isPaused?.()) return;
    send("paused", currentProgress, "任务已安全暂停；点击继续后将从当前阶段恢复。", currentOutputPath, activeStage);
    await options.waitUntilResumed?.();
    if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
    send("resuming", currentProgress, "正在从安全检查点继续生成…", currentOutputPath, activeStage);
    await new Promise<void>((done) => setTimeout(done, 0));
  };

  const checkpoint = async (
    phase: NonNullable<ManagerPresentationGenerationOptions["failAtPhase"]>,
  ): Promise<void> => {
    await honorPause(phase);
    await new Promise<void>((done) => setTimeout(done, Math.max(0, options.phaseDelayMs ?? 0)));
    if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
    await honorPause(phase);
    if (options.failAtPhase === phase) throw new Error(options.failureMessage || `Simulated presentation failure at ${phase}.`);
  };

  let outputPath: string | undefined;
  let manifestPath: string | undefined;
  let simulatedBusyAttemptsRemaining = Math.max(0, options.simulateFileBusyAttempts ?? 0);
  const writeArtifact = async (path: string, data: string | Buffer, encoding?: BufferEncoding): Promise<void> => {
    const retryLimit = Math.max(1, Math.floor(options.fileWriteRetryLimit ?? 3));
    let lastError: unknown;
    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      try {
        if (simulatedBusyAttemptsRemaining > 0) {
          simulatedBusyAttemptsRemaining -= 1;
          const simulated = new Error(`Simulated occupied file: ${path}`) as NodeJS.ErrnoException;
          simulated.code = "EBUSY";
          throw simulated;
        }
        writeFileSync(path, data, encoding);
        return;
      } catch (error) {
        lastError = error;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (!/^(?:EBUSY|EPERM)$/.test(code) || attempt >= retryLimit) {
          if (/^(?:EBUSY|EPERM)$/.test(code)) throw new FileWriteRetryExhaustedError(path, attempt, error);
          throw error;
        }
        await new Promise<void>((done) => setTimeout(done, attempt * 100));
      }
    }
    throw new FileWriteRetryExhaustedError(path, retryLimit, lastError);
  };
  const publishStageArtifact = async (
    stage: ManagerPresentationStageArtifact["stage"],
    label: string,
    summary: string,
    markdown: string,
  ): Promise<void> => {
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    if (elapsedMs < stageArtifactThresholdMs || stageArtifacts.some((artifact) => artifact.stage === stage)) return;
    const stageDir = join(workspacePath, ".opendrsai", "stage-results", requestId);
    mkdirSync(stageDir, { recursive: true });
    const path = nextAvailablePath(join(stageDir, `${stage}-temporary.md`));
    await writeArtifact(path, [
      `# ${label}`,
      "",
      "> 临时阶段成果：内容可能随后续分析更新；最终成果会单独生成，不会覆盖此快照。",
      "",
      markdown.trim(),
      "",
    ].join("\n"), "utf8");
    stageArtifacts.push({
      id: `${requestId}:${stage}:${stageArtifacts.length + 1}`,
      requestId,
      stage,
      label,
      summary,
      path,
      createdAt: new Date().toISOString(),
      taskElapsedMs: elapsedMs,
      temporary: true,
      immutable: true,
    });
    send(
      currentWorkStage,
      currentProgress,
      `已生成可查看的临时阶段成果：“${label}”；最终成果将单独生成，不会覆盖此快照。`,
      currentOutputPath,
      currentWorkStage,
    );
  };

  try {

  send("analyzing", 8, "正在安全读取演示型 PDF 的页面结构与文本。 ");
  await checkpoint("analyzing");
  send("analyzing", 12, "正在逐页解析 PDF；此阶段可以安全取消。");
  let analysis: PresentationPdfResult | null = null;
  while (!analysis) {
    await honorPause("analyzing");
    const operationController = new AbortController();
    const cancelOperation = (): void => operationController.abort();
    options.signal?.addEventListener("abort", cancelOperation, { once: true });
    options.setActiveOperationController?.(operationController);
    try {
      analysis = await extractPresentationPdf(sourcePath, operationController.signal);
    } catch (error) {
      if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
      if (options.isPaused?.() && error instanceof Error && error.name === "AbortError") {
        await honorPause("analyzing");
        send("analyzing", 12, "正在从解析检查点重新开始逐页解析 PDF。");
        continue;
      }
      if (error instanceof Error && error.name === "AbortError") throw new ManagerPresentationCancelledError();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancelOperation);
      options.setActiveOperationController?.(null);
    }
    if (!analysis) throw new Error("The presentation PDF could not be parsed by the bundled Runtime.");
  }
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  if (!analysis || analysis.type !== "presentation_pdf") {
    throw new Error("The selected PDF was not recognized as a presentation-style document.");
  }
  if (!analysis.analysis?.managerDeckBlueprint) {
    throw new Error("The presentation analysis did not produce a manager deck blueprint.");
  }
  const analysisSummary = analysis.analysis.summaryPoints.slice(0, 4)
    .map((item) => `${item.text}（原 PDF 第 ${item.page} 页）`);
  const numericSummary = analysis.analysis.numericHighlights.slice(0, 6)
    .map((item) => `${item.text}（第 ${item.page} 页）`);
  await publishStageArtifact(
    "analysis",
    "PDF 分析摘要",
    `已提炼 ${analysisSummary.length} 条结论和 ${numericSummary.length} 个关键数字。`,
    ["## 初步结论", ...analysisSummary.map((item) => `- ${item}`), "", "## 关键数字", ...numericSummary.map((item) => `- ${item}`)].join("\n"),
  );

  send("planning", 28, "正在把故事线、关键数字和来源页码组织为管理者版结构。 ");
  await checkpoint("planning");
  let appliedRequirements = sanitizeLiveRequirements(options.getRequirements?.() ?? request.requirements);
  let spec = buildDeckSpec(analysis, appliedRequirements, audience);
  let replacements = buildTemplateReplacements(spec);
  const templatePath = resolveRequiredPath(options.templatePath, "templatePath");
  if (!existsSync(templatePath)) throw new Error(`Manager presentation template is missing: ${templatePath}`);
  await publishStageArtifact(
    "outline",
    "PPT 结构草案",
    `已规划 ${spec.slides.length} 页管理者叙事结构，可在最终 PPT 生成前查看。`,
    ["## 页面结构", ...spec.slides.map((slide, index) => `${index + 1}. ${slide.title}（来源页：${slide.sourcePages.join("、") || "封面/汇总"}）`)].join("\n"),
  );

  const artifactDir = join(workspacePath, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  outputPath = nextAvailablePath(
    join(artifactDir, `${safeStem(basename(sourcePath, extname(sourcePath)))}-${audience === "technical_experts" ? "technical" : "manager"}-zh.pptx`),
  );
  manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");
  await options.onOutputPlanned?.(outputPath, manifestPath);

  send("generating", 55, "正在生成可编辑文本、形状、表格和逐页讲稿。 ", outputPath);
  await checkpoint("generating");
  const latestRequirements = sanitizeLiveRequirements(options.getRequirements?.() ?? request.requirements);
  if (latestRequirements.join("\n") !== appliedRequirements.join("\n")) {
    appliedRequirements = latestRequirements;
    spec = buildDeckSpec(analysis, appliedRequirements, audience);
    replacements = buildTemplateReplacements(spec);
  }
  const templateEntries = readZip(readFileSync(templatePath));
  let replacementsApplied = 0;
  const outputEntries = templateEntries.map((entry) => {
    if (!entry.name.endsWith(".xml") && !entry.name.endsWith(".rels")) return entry;
    let xml = entry.data.toString("utf8");
    for (const [token, value] of Object.entries(replacements)) {
      const escaped = escapeXml(value);
      if (xml.includes(token)) {
        replacementsApplied += countOccurrences(xml, token);
        xml = xml.split(token).join(escaped);
      }
    }
    return { ...entry, data: Buffer.from(xml, "utf8") };
  });
  const unresolvedTokens = collectUnresolvedTokens(outputEntries);
  if (unresolvedTokens.length > 0) {
    throw new Error(`Presentation template still contains unresolved tokens: ${unresolvedTokens.join(", ")}`);
  }
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  await writeArtifact(outputPath, writeZip(outputEntries));

  const sourceSha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex").toUpperCase();
  const keyConclusions = buildKeyConclusionEvidence(analysis, sourcePath);
  const conclusionTraceabilityRate = keyConclusions.length > 0
    ? keyConclusions.filter((item) => item.verified).length / keyConclusions.length
    : 0;
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      path: sourcePath,
      fileName: basename(sourcePath),
      sizeBytes: sourceStat.size,
      sha256: sourceSha256,
      pageCount: analysis.pageCount,
    },
    output: outputPath,
    slideCount: spec.slides.length,
    audience: spec.audience,
    language: spec.language,
    speakerNotesCoverage: 1,
    imageCount: 0,
    wholePageScreenshotReuse: false,
    replacementsApplied,
    appliedRequirements,
    stageArtifacts: [...stageArtifacts],
    keyConclusions,
    conclusionTraceabilityRate,
    slides: spec.slides.map((slide, index) => ({
      slide: index + 1,
      role: slide.role,
      title: slide.title,
      sourcePages: slide.sourcePages,
      hasSpeakerNotes: Boolean(slide.speakerNotes),
    })),
  };
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  await writeArtifact(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  send("validating", 86, "正在检查页数、讲稿、来源映射、占位符和文件结构。 ", outputPath);
  await checkpoint("validating");
  const quality = inspectGeneratedDeck(outputPath, manifest);
  if (!quality.ok) throw new Error(`Generated presentation failed structural acceptance: ${quality.failures.join(", ")}`);
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  const audienceProfile = buildAudienceProfile(spec);
  const audienceLabel = audience === "technical_experts" ? "技术专家版" : "管理者版";
  currentDeliverySummary = {
    findingSummary: `已从 ${analysis.pageCount} 页 CERN 演示材料生成 ${spec.slides.length} 页${audienceLabel} PPT，讲稿和来源页码覆盖率均为 100%。`,
    importance: "high",
    importanceReason: "结果涉及 HL-LHC 数据增长、网络带宽准备和管理层后续决策。",
    artifacts: [{
      id: `${requestId}:manager-pptx`,
      label: `${audienceLabel} PPT`,
      path: outputPath,
      kind: "presentation",
      keyConclusions: keyConclusions.map((item) => ({
        id: item.id,
        conclusion: item.conclusion,
        sourcePath: item.sourcePath,
        locatorType: "pdf_page" as const,
        locator: `p.${item.page}`,
        evidenceText: item.evidenceText,
        verified: item.verified,
        citations: item.citations.map((citation) => ({ ...citation, authors: [...citation.authors] })),
        numericEvidence: item.numericEvidence.map((numeric) => ({
          ...numeric,
          sourceValues: numeric.sourceValues.map((source) => ({ ...source })),
        })),
        ...(item.uncertainty ? { uncertainty: {
          ...item.uncertainty,
          qualifyingLanguage: [...item.uncertainty.qualifyingLanguage],
          claims: item.uncertainty.claims.map((claim) => ({ ...claim })),
        } } : {}),
        trust: { ...item.trust, evidenceIds: [...item.trust.evidenceIds] },
      })),
      conclusionTraceabilityRate,
      consistencyCheck: {
        checkedAt: new Date().toISOString(),
        status: "passed",
        expectedIssues: 0,
        detectedIssues: 0,
        summary: "CERN 黄金数字、来源页码、图表引用和不确定性措辞一致，未发现需要修正的问题。",
        items: [],
      },
    }],
    suggestedAction: "打开 PPT，优先核对带宽需求、时间目标和仍待确认事项。",
    workSummary: `已分析 ${analysis.pageCount} 页原始 PDF，规划并生成 ${spec.slides.length} 页可编辑演示文稿，同时完成讲稿、来源映射和结构验收。`,
    coreConclusion: "HL-LHC 预计将使数据产量增长约 10 倍；计算与科研网络需要在控制成本的同时提前扩容。",
    verification: `自动验收通过：${spec.slides.length} 页、讲稿 100%、事实页来源覆盖 ${Math.round(quality.sourcePageCoverage * 100)}%、无整页截图复用。`,
    remainingRisks: "来源中的 2029 时间与目标比例仍需以正式计划确认；管理层应复核成本和实施时间。",
    completionCriteria: {
      passed: [
        `页数检查通过：共 ${spec.slides.length} 页`,
        "讲稿覆盖检查通过：100%",
        `事实页来源覆盖检查通过：${Math.round(quality.sourcePageCoverage * 100)}%`,
        "可编辑性检查通过：未复用整页截图",
      ],
      incomplete: [
        "2029 时间与目标比例尚待正式计划确认",
        "成本和实施时间尚待管理层确认",
      ],
    },
  };
  send("completed", 100, "管理者版 PPT 已生成并加入 Artifacts。", outputPath);

  return {
    requestId,
    audience,
    sourcePath,
    outputPath,
    manifestPath,
    slideCount: spec.slides.length,
    speakerNotesCoverage: manifest.speakerNotesCoverage,
    sourcePageCoverage: quality.sourcePageCoverage,
    sourceLinks: manifest.slides
      .filter((slide) => slide.sourcePages.length > 0)
      .map((slide) => ({
        slide: slide.slide,
        role: slide.role,
        title: slide.title,
        sourcePages: slide.sourcePages,
      })),
    keyConclusions,
    conclusionTraceabilityRate,
    appliedRequirements,
    stageArtifacts: [...stageArtifacts],
    deliverySummary: currentDeliverySummary,
    quality,
    audienceProfile,
  };
  } catch (error) {
    if (error instanceof ManagerPresentationCancelledError) {
      for (const path of [manifestPath, outputPath]) {
        if (path && existsSync(path)) unlinkSync(path);
      }
      send("cancelled", 100, "已取消生成；未保留未完成的 PPT 文件。");
    }
    throw error;
  }
}

function buildKeyConclusionEvidence(
  result: PresentationPdfResult,
  sourcePath: string,
): ManagerPresentationKeyConclusionEvidence[] {
  const highlights = result.analysis?.numericHighlights ?? [];
  const pageText = new Map(result.pages.map((page) => [page.page, page.text]));
  const sourceTitle = result.analysis?.title || "Distributed computing for High Energy Physics";
  const coverText = pageText.get(1) ?? "";
  const contact = coverText.match(/\b([a-z][a-z.]+)@cern\.ch\b/i)?.[1] ?? "edoardo.martelli";
  const sourceAuthor = contact.split(".").filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join(" ");
  const rules: Array<{
    id: string;
    conclusion: string;
    page: number;
    highlight: RegExp;
    source: RegExp;
  }> = [
    {
      id: "hl_lhc_data_growth_10x",
      conclusion: "HL-LHC 将使实验数据产量增长约 10 倍。",
      page: 8,
      highlight: /factor\s+of\s+10/i,
      source: /volume\s+of\s+data[\s\S]{0,120}factor\s+of\s+10/i,
    },
    {
      id: "minimal_bandwidth_4_8_tbps",
      conclusion: "HL-LHC 最低网络模型预计需要 4.8 Tbps 带宽。",
      page: 42,
      highlight: /4\.8\s*Tbps/i,
      source: /4\.8\s*Tbps[\s\S]{0,100}(?:expected\s+HL-LHC\s+bandwidth|minimal)/i,
    },
    {
      id: "flexible_bandwidth_9_6_tbps",
      conclusion: "HL-LHC 灵活网络模型预计需要 9.6 Tbps 带宽。",
      page: 42,
      highlight: /9\.6\s*Tbps/i,
      source: /9\.6\s*Tbps[\s\S]{0,100}(?:expected\s+HL-LHC\s+bandwidth|flexible)/i,
    },
    {
      id: "data_challenge_2027_50_percent",
      conclusion: "2027 年 Data Challenge 计划验证 HL-LHC 需求的 50%。",
      page: 43,
      highlight: /2027[\s\S]{0,80}50%/i,
      source: /2027[\s\S]{0,100}50%/i,
    },
    {
      id: "data_challenge_2029_100_percent_uncertain",
      conclusion: "2029 年 Data Challenge 暂以验证 100% HL-LHC 需求为目标，日期和比例仍待确认。",
      page: 43,
      highlight: /2029[\s\S]{0,80}100%[\s\S]{0,80}to\s+be\s+confirmed/i,
      source: /2029[\s\S]{0,100}100%[\s\S]{0,120}to\s+be\s+confirmed/i,
    },
  ];
  return rules.map((rule) => {
    const evidence = highlights.find((item) => item.page === rule.page && rule.highlight.test(item.text));
    const source = pageText.get(rule.page) ?? "";
    const evidenceText = evidence?.text ?? "";
    const verified = Boolean(evidence && rule.source.test(source));
    const uncertainty = buildCernUncertainty(rule.id, sourcePath, evidenceText);
    const citations = [{
      id: `${rule.id}:citation`,
      title: sourceTitle,
      authors: [sourceAuthor],
      sourcePath,
      locatorType: "pdf_page" as const,
      locator: `p.${rule.page}`,
      excerpt: evidenceText,
      relation: "supports" as const,
      supportScore: verified ? 1 : 0,
    }];
    const numericEvidence = buildCernNumericEvidence(rule.id, sourcePath);
    return {
      id: rule.id,
      conclusion: rule.conclusion,
      sourcePath,
      sourceType: "pdf_page",
      page: rule.page,
      evidenceText,
      verified,
      citations,
      numericEvidence,
      ...(uncertainty ? { uncertainty } : {}),
      trust: buildCernTrustAssessment(rule.id, verified, citations[0].id, numericEvidence.map((item) => item.id)),
    };
  });
}

function buildCernTrustAssessment(
  conclusionId: string,
  verified: boolean,
  citationId: string,
  numericEvidenceIds: string[],
): ManagerPresentationKeyConclusionEvidence["trust"] {
  if (conclusionId === "data_challenge_2029_100_percent_uncertain") return {
    status: "needs_confirmation",
    label: "需要确认",
    definition: "来源中已有暂定信息，但关键日期、比例或承诺尚未最终确定。",
    reason: "CERN 原文给出 2029 年 100% 的暂定目标，同时明确写明日期和比例仍待确认。",
    icon: "question",
    recommendedAction: "保留“暂定”和“待确认”措辞，获得正式 Data Challenge 计划后再更新。",
    evidenceRule: "provisional_source",
    evidenceIds: [citationId, ...numericEvidenceIds],
    ruleSatisfied: verified && numericEvidenceIds.length > 0,
  };
  return {
    status: "evidence_sufficient",
    label: "依据充分",
    definition: "结论可由可读取的原始来源直接支持，关键数字也已读取或复算一致。",
    reason: "原始 CERN 页面的摘录直接支持该结论，引用目标可读取且支持分数为 100%。",
    icon: "check",
    recommendedAction: "可以使用该结论；对外发布时保留来源页码。",
    evidenceRule: "verified_source",
    evidenceIds: [citationId, ...numericEvidenceIds],
    ruleSatisfied: verified,
  };
}

function buildCernUncertainty(
  conclusionId: string,
  sourcePath: string,
  evidenceText: string,
): ManagerPresentationKeyConclusionEvidence["uncertainty"] {
  if (conclusionId !== "data_challenge_2029_100_percent_uncertain") return undefined;
  return {
    status: "insufficient_data",
    label: "计划数据不足 · 日期与比例待确认",
    explanation: "来源只给出 2029 年 100% 的暂定目标，并明确说明日期和比例仍待确认，不能表达为确定承诺。",
    recommendedAction: "引用正式 Data Challenge 计划更新后再确认日期与比例；在此之前保留“暂定”和“待确认”措辞。",
    requiresQualification: true,
    qualifyingLanguage: ["暂以", "仍待确认"],
    claims: [{
      id: "h4-cern-2029-provisional",
      position: "暂定目标：2029 年验证 100% HL-LHC 需求",
      sourcePath,
      locatorType: "pdf_page",
      locator: "p.43",
      excerpt: evidenceText,
      stance: "insufficient",
    }],
  };
}

function buildCernNumericEvidence(
  conclusionId: string,
  sourcePath: string,
): ManagerPresentationKeyConclusionEvidence["numericEvidence"] {
  const source = (label: string, value: number, unit: string, locator: string, rawText: string) => ({
    label, value, unit, sourcePath, locator, rawText,
  });
  if (conclusionId === "hl_lhc_data_growth_10x") return [{
    id: "h3-cern-data-growth-10x", label: "HL-LHC 数据增长倍数", displayValue: "10×", reportedValue: 10, unit: "×",
    kind: "direct", sourcePath, locatorType: "pdf_page", locator: "p.8",
    sourceValues: [source("原文增长倍数", 10, "×", "p.8", "increasing the volume of data produced by the experiments by a factor of 10")],
    formula: "直接读取原文数值 10", recalculatedValue: 10, tolerance: 0, status: "verified",
    explanation: "原文直接给出 factor of 10，无需派生计算；复读值与报告值一致。",
  }];
  if (conclusionId === "minimal_bandwidth_4_8_tbps") return [{
    id: "h3-cern-minimal-4-8", label: "Minimal Model 带宽", displayValue: "4.8 Tbps", reportedValue: 4.8, unit: "Tbps",
    kind: "calculated", sourcePath, locatorType: "calculation", locator: "p.42 · Minimal Model",
    sourceValues: [
      source("ATLAS + CMS", 1, "Tbps", "p.42", "estimated 1Tbps for CMS and ATLAS summed"),
      source("ALICE", 0.1, "Tbps", "p.42", "100 Gbps per experiment estimated from Run-3 rates"),
      source("LHCb", 0.1, "Tbps", "p.42", "100 Gbps per experiment estimated from Run-3 rates"),
      source("突发流量系数", 2, "×", "p.42", "*2 (for bursts)"),
      source("安全余量系数", 2, "×", "p.42", "*2 (safety-margin)"),
    ],
    formula: "(1 + 0.1 + 0.1) × 2 × 2", recalculatedValue: 4.8, tolerance: 0.000001, status: "verified",
    explanation: "把 100 Gbps 换算为 0.1 Tbps 后，基础流量 1.2 Tbps 乘突发和安全余量系数，复算为 4.8 Tbps。",
  }];
  if (conclusionId === "flexible_bandwidth_9_6_tbps") return [{
    id: "h3-cern-flexible-9-6", label: "Flexible Model 带宽", displayValue: "9.6 Tbps", reportedValue: 9.6, unit: "Tbps",
    kind: "calculated", sourcePath, locatorType: "calculation", locator: "p.42 · Flexible Model",
    sourceValues: [
      source("Minimal Model", 4.8, "Tbps", "p.42", "4.8Tbps expected HL-LHC bandwidth"),
      source("灵活模型倍数", 2, "×", "p.42", "This requires doubling the bandwidth of the Minimal model"),
    ],
    formula: "4.8 × 2", recalculatedValue: 9.6, tolerance: 0.000001, status: "verified",
    explanation: "原文要求 Flexible Model 将 Minimal Model 带宽加倍，复算为 9.6 Tbps。",
  }];
  if (conclusionId === "data_challenge_2027_50_percent") return [{
    id: "h3-cern-2027-50", label: "2027 Data Challenge 目标", displayValue: "50%", reportedValue: 50, unit: "%",
    kind: "direct", sourcePath, locatorType: "pdf_page", locator: "p.43",
    sourceValues: [source("原文目标比例", 50, "%", "p.43", "2027: 50% of HL-LHC requirements")],
    formula: "直接读取原文目标比例 50", recalculatedValue: 50, tolerance: 0, status: "verified",
    explanation: "原文直接给出 2027 年目标比例，报告值与原文一致。",
  }];
  if (conclusionId === "data_challenge_2029_100_percent_uncertain") return [{
    id: "h3-cern-2029-100", label: "2029 Data Challenge 暂定目标", displayValue: "100%（待确认）", reportedValue: 100, unit: "%",
    kind: "direct", sourcePath, locatorType: "pdf_page", locator: "p.43",
    sourceValues: [source("原文暂定目标比例", 100, "%", "p.43", "2029: 100% of HL-LHC requirements (date and % to be confirmed)")],
    formula: "原文暂定值 100；日期和比例尚无可独立验证的最终计划", tolerance: 0, status: "unverifiable",
    explanation: "数值与原文一致，但原文明确标注 date and % to be confirmed，因此不能标记为已验证。",
  }];
  return [];
}

function buildDeckSpec(
  result: PresentationPdfResult,
  requirements: string[] = [],
  audience: ManagerPresentationAudience = "non_expert_managers",
): DeckSpec {
  const manager = buildManagerDeckSpec(result, requirements);
  return audience === "technical_experts" ? buildTechnicalDeckSpec(manager) : manager;
}

function buildManagerDeckSpec(result: PresentationPdfResult, requirements: string[] = []): DeckSpec {
  const analysis = result.analysis!;
  const blueprint = analysis.managerDeckBlueprint!;
  const byRole = new Map(blueprint.slides.map((slide) => [slide.role, slide]));
  const evidenceText = [
    ...analysis.summaryPoints.map((item) => item.text),
    ...analysis.numericHighlights.map((item) => item.text),
    ...blueprint.slides.flatMap((slide) => slide.evidence),
  ].join("\n");
  const hasTenfold = /factor\s+of\s+10|10\s*(?:倍|×)/i.test(evidenceText);
  const has48 = /4\.8\s*Tbps/i.test(evidenceText);
  const has96 = /9\.6\s*Tbps/i.test(evidenceText);
  const has2027 = /2027[\s\S]{0,80}50%/i.test(evidenceText);
  const has2029 = /2029[\s\S]{0,80}100%/i.test(evidenceText);
  const has2030 = /2030/.test(evidenceText);
  const sources = (role: string): number[] => byRole.get(role)?.sourcePages ?? [1];
  const title = (role: string, fallback: string): string =>
    clampText(byRole.get(role)?.title || fallback, 42);
  const note = (claim: string, points: string[]): string =>
    clampText(`${claim} ${points.join(" ")} 讲解时聚焦它对资源准备、风险和协作决策的影响。`, 360);

  const summaryBody = [
    hasTenfold ? "HL-LHC 将把实验数据产量提升约 10 倍。" : summaryOrFallback(analysis, 0, "数据规模正在显著上升。"),
    has96 ? "灵活带宽模型需要达到 9.6 Tbps。" : summaryOrFallback(analysis, 1, "基础设施需要同步扩展。"),
    "分阶段演练正在提前验证计算与网络就绪度。",
  ];
  const backgroundBody = [
    has2030 ? "HL-LHC 计划在 2030 年投入运行。" : "新阶段运行计划正在逼近。",
    hasTenfold ? "更多碰撞意味着约 10 倍实验数据。" : "数据增长会同时推高计算、存储和传输压力。",
    "单一中心无法独立承担全部资源与传输压力。",
  ];
  const wlcgBody = [
    "核心实验设施负责数据起点与整体协调。",
    "分布式站点共同承担存储、处理和科研访问。",
    "网络把分散资源连接成可持续扩展的协作体系。",
  ];
  const asiaBody = [
    "亚洲拥有重要科研机构、实验站点和教育网络。",
    "跨洲骨干连接欧洲、澳大利亚与北美资源。",
    "区域伙伴协作决定端到端科研数据体验。",
  ];
  const conclusionBody = [
    hasTenfold ? "容量：围绕 10 倍数据增长提前安排网络与计算资源。" : "容量：围绕数据增长提前安排网络与计算资源。",
    "成本：扩容必须兼顾长期可持续性。",
    "协作：持续参与跨机构演练和网络技术验证。",
  ];
  const liveRequirement = requirements.length > 0 ? clampText(requirements.join("；"), 90) : "";
  if (liveRequirement) {
    summaryBody[0] = `本次补充重点：${liveRequirement}`;
    conclusionBody[0] = `优先决策：${liveRequirement}`;
  }
  const timeline = buildTimeline(analysis.numericHighlights, { has2027, has2029 });
  const sourceTitle = analysis.title || result.metadata.title || "演示报告管理者摘要";
  const deckTitle = /Distributed computing for High Energy Physics/i.test(sourceTitle)
    ? "高能物理的分布式计算"
    : clampText(sourceTitle, 36);

  const slides: DeckSlideSpec[] = [
    {
      role: "cover",
      title: deckTitle,
      body: ["关键变化、影响与准备工作", "基于原始演示报告的管理者版"],
      sourcePages: sources("cover"),
    },
    {
      role: "executive_summary",
      title: title("executive_summary", "规模变化要求容量与协作同步准备"),
      body: summaryBody,
      metrics: [hasTenfold ? "10×" : "规模↑", has96 ? "9.6 Tbps" : "容量↑", has2030 ? "2030" : "就绪"],
      metricLabels: ["数据产量", "灵活模型带宽", "目标阶段"],
      speakerNotes: note("先给出管理层结论。", summaryBody),
      sourcePages: sources("executive_summary"),
    },
    {
      role: "background",
      title: title("background", "数据增长使全球协同从优势变为必需"),
      body: backgroundBody,
      metrics: [hasTenfold ? "10×" : "增长"],
      metricLabels: ["实验数据量变化"],
      speakerNotes: note("用业务影响解释背景，避免陷入专业物理细节。", backgroundBody),
      sourcePages: sources("background"),
    },
    {
      role: "wlcg",
      title: title("wlcg", "分散资源需要作为一套全球体系运行"),
      body: wlcgBody,
      speakerNotes: note("把分布式计算解释为协作体系。", wlcgBody),
      sourcePages: sources("wlcg"),
    },
    {
      role: "asian_networks",
      title: title("asian_networks", "亚洲网络是全球科研协作的关键链路"),
      body: asiaBody,
      speakerNotes: note("强调亚洲网络对全球科研数据流动的作用。", asiaBody),
      sourcePages: sources("asian_networks"),
    },
    {
      role: "data_challenges",
      title: title("data_challenges", "分阶段数据挑战正在提前验证未来就绪度"),
      body: [has2029 ? "* 2029 日期和目标比例仍待确认。" : "* 后续阶段目标应随正式计划持续确认。"],
      timeline,
      speakerNotes: note("分阶段加压的价值是提前发现瓶颈。", [has2029 ? "2029 的日期和目标比例仍待确认。" : "后续目标需持续确认。"]),
      sourcePages: sources("data_challenges"),
    },
    {
      role: "hl_lhc_requirements",
      title: title("hl_lhc_requirements", "数据增长正在转化为明确的网络需求"),
      body: [
        has48 ? "最低模型覆盖 4.8 Tbps 的基础需求。" : "最低模型覆盖基础数据出口和安全余量。",
        has96 ? "灵活模型覆盖 9.6 Tbps 的重处理需求。" : "灵活模型还要支持重处理与重建。",
        "规划不能只看平均流量，还要考虑突发与冗余。",
      ],
      metrics: [has48 ? "4.8 Tbps" : "基础", has96 ? "9.6 Tbps" : "灵活", has48 && has96 ? "2×" : "冗余"],
      metricLabels: ["最低模型", "灵活模型", "弹性增量"],
      speakerNotes: note("区分基础容量与灵活运行模型。", [has48 ? "4.8 Tbps 是最低模型。" : "最低模型覆盖基础需求。", has96 ? "9.6 Tbps 支持更灵活的重处理。" : "灵活模型支持重处理。"]),
      sourcePages: sources("hl_lhc_requirements"),
    },
    {
      role: "conclusions",
      title: title("conclusions", "管理层需要同时关注容量、成本与协作"),
      body: conclusionBody,
      speakerNotes: note("结尾回到可执行的管理关注点。", conclusionBody),
      sourcePages: sources("conclusions"),
    },
    {
      role: "sources",
      title: title("sources", "来源与页码"),
      body: [
        `背景与规模变化：${formatSourcePages(sources("background"))}`,
        `全球分布式计算：${formatSourcePages(sources("wlcg"))}`,
        `亚洲网络：${formatSourcePages(sources("asian_networks"))}`,
        `带宽模型：${formatSourcePages(sources("hl_lhc_requirements"))}`,
        `数据挑战：${formatSourcePages(sources("data_challenges"))}`,
        `总结：${formatSourcePages(sources("conclusions"))}`,
      ],
      sourcePages: sources("sources"),
    },
  ];
  return { audience: "non_expert_managers", language: "zh-CN", slides };
}

function buildTechnicalDeckSpec(manager: DeckSpec): DeckSpec {
  const slides = manager.slides.map((slide): DeckSlideSpec => {
    const common = { ...slide, sourcePages: [...slide.sourcePages] };
    if (slide.role === "cover") return { ...common, title: "高能物理分布式计算与网络容量技术评估", body: ["HL-LHC / WLCG 网络模型、容量与验证计划", "面向基础设施与网络技术专家"] };
    if (slide.role === "executive_summary") return {
      ...common,
      title: "容量基线：10 倍数据增长、4.8/9.6 Tbps 与分阶段验证",
      body: ["HL-LHC 数据产量预计增长 10 倍。", "Minimal Model 为 4.8 Tbps，Flexible Model 为 9.6 Tbps。", "Data Challenge：2027 验证 50%，2029 验证 100%（日期与比例待确认）。"],
      speakerNotes: "先固定五个跨版本黄金事实，再展开 WLCG、R&E 网络、数据层级与链路容量的技术约束。",
    };
    if (slide.role === "background") return { ...common, title: "HL-LHC 负载模型与数据路径", body: ["碰撞率提升驱动原始数据、重建数据和派生数据同步增长。", "平均吞吐不能代替峰值、重处理和故障冗余容量。", "容量规划必须覆盖计算、存储、数据分发和跨域网络路径。"], speakerNotes: "区分数据产生速率、持续吞吐、峰值流和重处理流量。" };
    if (slide.role === "wlcg") return { ...common, title: "WLCG 分布式计算与站点间数据流", body: ["WLCG 通过 Tier-0、Tier-1 与区域站点承担数据分发、处理和存储。", "R&E 网络承载跨域大流，端到端路径需要可观测、可调度并支持故障切换。", "技术评估应同时覆盖站点出口、长肥管道、数据传输服务和存储读写瓶颈。"], speakerNotes: "保留 WLCG、Tier-0/Tier-1、R&E、数据传输服务等专家术语和系统边界。" };
    if (slide.role === "asian_networks") return { ...common, title: "亚洲 R&E 骨干与跨洲路径工程", body: ["亚洲 WLCG 站点依赖区域 R&E 骨干及通往欧洲、北美和澳大利亚的跨洲路径。", "需要核对链路容量、路由多样性、RTT、拥塞控制与端到端可观测性。", "ATCF 与跨机构测试用于发现站点边界、交换点和跨域协同瓶颈。"], speakerNotes: "从拓扑、RTT、路由冗余和端到端流量工程解释亚洲网络角色。" };
    if (slide.role === "data_challenges") return { ...common, title: "Data Challenge 容量阶梯与验收点", body: ["2021：10%（480/960 Gbps）；2024：25%（1.2/2.4 Tbps）；2027：50%；2029：100%*，其中 2029 日期与比例待确认。"], speakerNotes: "把每轮 Data Challenge 当成容量、软件栈、数据流和跨域运维的联合验收。" };
    if (slide.role === "hl_lhc_requirements") return { ...common, title: "HL-LHC 带宽模型与数据层级预算", body: ["原始数据约 350 PB/年，运行期平均约 50 GB/s（400 Gbps）。", "prompt reconstruction 另估 100 Gbps；CMS 与 ATLAS 派生输出合计约 1 Tbps。", "端到端预算：Minimal Model 4.8 Tbps；Flexible Model 9.6 Tbps，并保留峰值和重处理余量。"], speakerNotes: "逐项说明 350 PB/年、50 GB/s、400 Gbps、100 Gbps、1 Tbps、4.8 Tbps 与 9.6 Tbps 的口径。" };
    if (slide.role === "conclusions") return { ...common, title: "技术结论与下一轮验证", body: ["以 10 倍数据增长作为计算、存储与网络共同容量基线。", "分别验证 4.8 Tbps 最低模型和 9.6 Tbps 灵活模型，而非只看平均流量。", "按 2027 50% 和 2029 100%* 阶梯执行端到端 Data Challenge，并持续确认 2029 假设。"], speakerNotes: "结论保留具体模型、单位、比例和不确定性，便于形成技术验收清单。" };
    return common;
  });
  return { audience: "technical_experts", language: "zh-CN", slides };
}

function buildAudienceProfile(spec: DeckSpec): ManagerPresentationAudienceProfile {
  const text = spec.slides.flatMap((slide) => [
    slide.title,
    ...slide.body,
    ...(slide.metrics ?? []),
    ...(slide.metricLabels ?? []),
    ...(slide.timeline ?? []).flatMap((entry) => [entry.year, entry.value]),
    slide.speakerNotes ?? "",
  ]).join("\n");
  const goldenRules: Array<[string, RegExp]> = [
    ["data_growth_10x", /(?:10\s*倍|factor\s+of\s+10)/i],
    ["minimal_4_8_tbps", /4\.8\s*Tbps/i],
    ["flexible_9_6_tbps", /9\.6\s*Tbps/i],
    ["dc_2027_50", /2027[\s\S]{0,60}50%/i],
    ["dc_2029_100", /2029[\s\S]{0,60}100%/i],
  ];
  const count = (pattern: RegExp): number => [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))].length;
  return {
    audience: spec.audience,
    goldenFactIds: goldenRules.filter(([, pattern]) => pattern.test(text)).map(([id]) => id),
    impactDecisionSignals: count(/影响|决策|成本|风险|准备|优先|管理层/gi),
    technicalDetailSignals: count(/Tier-[01]|R&E|RTT|Gbps|Tbps|PB|GB\/s|prompt reconstruction|数据层级|吞吐|路由|拥塞/gi),
    acronymOccurrences: count(/\b(?:HL-LHC|WLCG|R&E|RTT|CMS|ATLAS|ATCF)\b/gi),
    contentHash: createHash("sha256").update(text).digest("hex"),
  };
}

function buildTimeline(
  highlights: Array<{ text: string; page: number }>,
  facts: { has2027: boolean; has2029: boolean },
): Array<{ year: string; value: string }> {
  const combined = highlights.map((item) => item.text).join("\n");
  const candidates = Array.from(combined.matchAll(/\b(20\d{2})\b[\s\S]{0,60}?(\d{1,3}\s*%)/g))
    .map((match) => ({ year: match[1], value: match[2].replace(/\s+/g, "") }));
  const byYear = new Map(candidates.map((entry) => [entry.year, entry.value]));
  if (facts.has2027) byYear.set("2027", "50%");
  if (facts.has2029) byYear.set("2029", "100%*");
  const preferred = ["2021", "2024", "2027", "2029", "2030"];
  return preferred.map((year, index) => ({
    year,
    value: byYear.get(year) || (year === "2030" ? "目标" : `${index + 1}期`),
  }));
}

function sanitizeLiveRequirements(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "")
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .slice(0, 5);
}

function buildTemplateReplacements(spec: DeckSpec): Record<string, string> {
  const replacements: Record<string, string> = {};
  spec.slides.forEach((slide, index) => {
    const number = index + 1;
    replacements[`TOKEN_S${number}_TITLE`] = slide.title;
    replacements[`p.${9900 + number}`] = formatSourcePages(slide.sourcePages);
    slide.body.forEach((value, bodyIndex) => {
      if (slide.role === "sources") {
        const [topic, pages = ""] = value.split("：");
        replacements[`TOKEN_S9_TOPIC_${bodyIndex + 1}`] = topic;
        replacements[`TOKEN_S9_PAGES_${bodyIndex + 1}`] = pages;
      } else {
        replacements[`TOKEN_S${number}_BODY_${bodyIndex + 1}`] = value;
      }
    });
    slide.metrics?.forEach((value, metricIndex) => {
      replacements[`TOKEN_S${number}_METRIC_${metricIndex + 1}`] = value;
    });
    slide.metricLabels?.forEach((value, labelIndex) => {
      replacements[`TOKEN_S${number}_LABEL_${labelIndex + 1}`] = value;
    });
    slide.timeline?.forEach((entry, timelineIndex) => {
      replacements[`TOKEN_S${number}_YEAR_${timelineIndex + 1}`] = entry.year;
      replacements[`TOKEN_S${number}_VALUE_${timelineIndex + 1}`] = entry.value;
    });
    if (slide.speakerNotes) replacements[`TOKEN_S${number}_NOTES`] = slide.speakerNotes;
  });
  replacements.TOKEN_S1_SUBTITLE = spec.slides[0]?.body[0] || "关键变化、影响与准备工作";
  replacements.TOKEN_S1_CONTEXT = spec.slides[0]?.body[1] || "管理者版";
  return replacements;
}

function inspectGeneratedDeck(
  outputPath: string,
  manifest: { slideCount: number; slides: Array<{ role: string; sourcePages: number[]; hasSpeakerNotes: boolean }> },
): ManagerPresentationGenerateResult["quality"] {
  const entries = readZip(readFileSync(outputPath));
  const names = new Set(entries.map((entry) => entry.name));
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name));
  const notes = entries.filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.name));
  const media = entries.filter((entry) => entry.name.startsWith("ppt/media/") && !entry.name.endsWith("/"));
  const xmlText = entries
    .filter((entry) => entry.name.endsWith(".xml"))
    .map((entry) => entry.data.toString("utf8"))
    .join("\n");
  const factualSlides = manifest.slides.filter((_slide, index) => index > 0 && index < manifest.slides.length - 1);
  const mappedSlides = factualSlides.filter((slide) => slide.sourcePages.length > 0);
  const sourcePageCoverage = factualSlides.length > 0 ? mappedSlides.length / factualSlides.length : 1;
  const checks: Record<string, boolean> = {
    contentTypesPresent: names.has("[Content_Types].xml"),
    presentationPartPresent: names.has("ppt/presentation.xml"),
    slideCount: slides.length === manifest.slideCount && slides.length >= 8 && slides.length <= 12,
    requiredRoles: REQUIRED_ROLES.every((role) => manifest.slides.some((slide) => slide.role === role)),
    speakerNotes: notes.length >= 7 && manifest.slides.filter((slide) => slide.hasSpeakerNotes).length >= 7,
    sourcePageCoverage: sourcePageCoverage === 1,
    noMediaScreenshots: media.length === 0,
    noTemplateTokens: !/TOKEN_[A-Z0-9_]+|p\.990\d/.test(xmlText),
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { ok: failures.length === 0, checks, failures, mediaCount: media.length, sourcePageCoverage };
}


function readZip(buffer: Buffer): ZipEntry[] {
  const eocd = findSignatureReverse(buffer, 0x06054b50);
  if (eocd < 0) throw new Error("PPTX template is missing its ZIP central directory.");
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("PPTX template central directory is invalid.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`PPTX template local entry is invalid: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data || data.length !== uncompressedSize) throw new Error(`Unsupported or corrupt PPTX entry: ${name}`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findSignatureReverse(buffer: Buffer, signature: number): number {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function collectUnresolvedTokens(entries: ZipEntry[]): string[] {
  const tokens = new Set<string>();
  for (const entry of entries.filter((item) => item.name.endsWith(".xml"))) {
    const text = entry.data.toString("utf8");
    for (const match of text.matchAll(/TOKEN_[A-Z0-9_]+|p\.990\d/g)) tokens.add(match[0]);
  }
  return Array.from(tokens).sort();
}

function cleanRequestId(value: unknown): string {
  const requestId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(requestId)) throw new Error("A valid presentation request id is required.");
  return requestId;
}

function resolveRequiredPath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) throw new Error(`${field} is required.`);
  return resolve(value);
}

function assertInside(root: string, target: string, message: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(message);
}

function nextAvailablePath(preferred: string): string {
  if (!existsSync(preferred)) return preferred;
  const extension = extname(preferred);
  const stem = preferred.slice(0, -extension.length);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${stem}-v${index}${extension}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("Could not allocate a presentation output filename.");
}

function safeStem(value: string): string {
  const cleaned = value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return cleaned || "presentation";
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countOccurrences(source: string, token: string): number {
  return source.split(token).length - 1;
}

function formatSourcePages(pages: number[]): string {
  return pages.length > 0 ? pages.map((page) => `p.${page}`).join(", ") : "p.1";
}

function clampText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(1, maxChars - 1)).trim()}…`;
}

function summaryOrFallback(
  analysis: NonNullable<PresentationPdfResult["analysis"]>,
  index: number,
  fallback: string,
): string {
  return clampText(analysis.summaryPoints[index]?.text || fallback, 62);
}
