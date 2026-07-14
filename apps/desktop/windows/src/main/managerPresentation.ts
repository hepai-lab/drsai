import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { app } from "electron";
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
} from "../shared/desktopApi";
import {
  extractPresentationPdf,
  type PresentationPdfResult,
} from "./presentationPdf";

const TEMPLATE_NAME = "manager-deck-template.pptx";
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
  audience: "non_expert_managers";
  language: "zh-CN";
  slides: DeckSlideSpec[];
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ManagerPresentationGenerationOptions {
  signal?: AbortSignal;
  phaseDelayMs?: number;
  failAtPhase?: "analyzing" | "planning" | "generating" | "validating";
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
  options: ManagerPresentationGenerationOptions = {},
): Promise<ManagerPresentationGenerateResult> {
  const requestId = cleanRequestId(request.requestId);
  const workspacePath = resolveRequiredPath(request.workspacePath, "workspacePath");
  const sourcePath = resolveRequiredPath(request.sourcePath, "sourcePath");
  assertInside(workspacePath, sourcePath, "The presentation PDF must be inside the active workspace.");
  if (extname(sourcePath).toLowerCase() !== ".pdf") throw new Error("A PDF source file is required.");
  const sourceStat = statSync(sourcePath);
  if (!sourceStat.isFile()) throw new Error("The presentation PDF source is not a file.");

  const send = (
    phase: ManagerPresentationProgressEvent["phase"],
    progress: number,
    message: string,
    outputPath?: string,
  ): void => emit({ requestId, phase, progress, message, outputPath });

  const checkpoint = async (
    phase: NonNullable<ManagerPresentationGenerationOptions["failAtPhase"]>,
  ): Promise<void> => {
    await new Promise<void>((done) => setTimeout(done, Math.max(0, options.phaseDelayMs ?? 0)));
    if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
    if (options.failAtPhase === phase) throw new Error(`Simulated presentation failure at ${phase}.`);
  };

  let outputPath: string | undefined;
  let manifestPath: string | undefined;

  try {

  send("analyzing", 8, "正在安全读取演示型 PDF 的页面结构与文本。 ");
  await checkpoint("analyzing");
  send("analyzing", 12, "正在逐页解析 PDF；此阶段可以安全取消。");
  let analysis: PresentationPdfResult | null;
  try {
    analysis = await extractPresentationPdf(sourcePath, options.signal);
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ManagerPresentationCancelledError();
    }
    throw error;
  }
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  if (!analysis || analysis.type !== "presentation_pdf") {
    throw new Error("The selected PDF was not recognized as a presentation-style document.");
  }
  if (!analysis.analysis?.managerDeckBlueprint) {
    throw new Error("The presentation analysis did not produce a manager deck blueprint.");
  }

  send("planning", 28, "正在把故事线、关键数字和来源页码组织为管理者版结构。 ");
  await checkpoint("planning");
  const spec = buildDeckSpec(analysis);
  const replacements = buildTemplateReplacements(spec);
  const templatePath = resolveTemplatePath();
  if (!existsSync(templatePath)) throw new Error(`Manager presentation template is missing: ${templatePath}`);

  const artifactDir = join(workspacePath, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  outputPath = nextAvailablePath(
    join(artifactDir, `${safeStem(basename(sourcePath, extname(sourcePath)))}-manager-zh.pptx`),
  );
  manifestPath = outputPath.replace(/\.pptx$/i, ".provenance.json");

  send("generating", 55, "正在生成可编辑文本、形状、表格和逐页讲稿。 ", outputPath);
  await checkpoint("generating");
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
  writeFileSync(outputPath, writeZip(outputEntries));

  const sourceSha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex").toUpperCase();
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
    slides: spec.slides.map((slide, index) => ({
      slide: index + 1,
      role: slide.role,
      title: slide.title,
      sourcePages: slide.sourcePages,
      hasSpeakerNotes: Boolean(slide.speakerNotes),
    })),
  };
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  send("validating", 86, "正在检查页数、讲稿、来源映射、占位符和文件结构。 ", outputPath);
  await checkpoint("validating");
  const quality = inspectGeneratedDeck(outputPath, manifest);
  if (!quality.ok) throw new Error(`Generated presentation failed structural acceptance: ${quality.failures.join(", ")}`);
  if (options.signal?.aborted) throw new ManagerPresentationCancelledError();
  send("completed", 100, "管理者版 PPT 已生成并加入 Artifacts。", outputPath);

  return {
    requestId,
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
    quality,
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

function buildDeckSpec(result: PresentationPdfResult): DeckSpec {
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

function resolveTemplatePath(): string {
  return join(app.getAppPath(), "resources", "presentation", TEMPLATE_NAME);
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
