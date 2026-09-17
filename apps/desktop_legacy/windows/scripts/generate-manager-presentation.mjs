import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile, layers, shape, table, text } from "@oai/artifact-tool";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, "")] = argv[index + 1];
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.spec || !args.output || !args.evidence || !args.manifest) {
  throw new Error("Usage: --spec <json> --output <pptx> --evidence <dir> --manifest <json>");
}

const spec = JSON.parse(await fs.readFile(args.spec, "utf8"));
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const FONT = "Microsoft YaHei";
const INK = "#111111";
const MUTED = "#60656F";
const PANEL = "#F0F1F3";
const ACCENT = "#3D8DFF";

function textBox(value, position, fontSize, options = {}) {
  return text([value], {
    name: options.name,
    position: { left: position.left, top: position.top },
    width: position.width,
    height: position.height,
    style: {
      fontSize: `${fontSize}px`,
      typeface: FONT,
      color: options.color || INK,
      alignment: options.alignment || "left",
      verticalAlignment: options.verticalAlignment || "top",
      autoFit: options.autoFit || "shrinkText",
      insets: options.insets || { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
}

function sourceFooter(slideSpec, number) {
  const sources = slideSpec.sourcePages.map((page) => `p.${page}`).join(", ");
  return [
    textBox(`来源：${sources}`, { left: 42, top: 668, width: 1070, height: 22 }, 14, { color: MUTED, name: `source-${number}` }),
    textBox(String(number), { left: 1170, top: 668, width: 68, height: 22 }, 14, { alignment: "right", color: MUTED, name: `page-${number}` }),
  ];
}

function setNotes(slide, slideSpec) {
  if (!slideSpec.speakerNotes) return;
  slide.speakerNotes.textFrame.setText(`${slideSpec.speakerNotes}\n\n来源页码：${slideSpec.sourcePages.map((page) => `p.${page}`).join(", ")}`);
  slide.speakerNotes.setVisible(true);
}

function addCover(slideSpec, number) {
  const slide = presentation.slides.add();
  slide.background.fill = "#FFFFFF";
  slide.compose(layers({ name: "manager-cover", width: "fill", height: "fill" }, [
    textBox("IHEP VISIT · 2026", { left: 48, top: 48, width: 420, height: 36 }, 24, { color: ACCENT, name: "eyebrow" }),
    textBox(slideSpec.title, { left: 48, top: 170, width: 1080, height: 190 }, 72, { name: "deck-title", verticalAlignment: "bottom" }),
    textBox(slideSpec.body[0], { left: 48, top: 414, width: 900, height: 64 }, 32, { color: MUTED, name: "subtitle" }),
    textBox(slideSpec.body[1], { left: 48, top: 548, width: 560, height: 42 }, 24, { name: "context" }),
    shape({ name: "accent-rule", geometry: "rect", fill: ACCENT, position: { left: 48, top: 622 }, width: 220, height: 8 }),
    ...sourceFooter(slideSpec, number),
  ]), { frame: { left: 0, top: 0, width: 1280, height: 720 }, baseUnit: 1 });
  return slide;
}

function addMetricSlide(slideSpec, number) {
  const slide = presentation.slides.add();
  const metrics = slideSpec.metrics || [];
  const labels = slideSpec.metricLabels || [];
  const items = [
    textBox(slideSpec.title, { left: 42, top: 36, width: 1196, height: 116 }, 48, { name: `title-${number}` }),
    textBox(slideSpec.body.join("  "), { left: 42, top: 154, width: 1196, height: 100 }, 24, { color: MUTED, name: `lead-${number}` }),
  ];
  const widths = metrics.length === 1 ? [620] : metrics.map(() => 350);
  const startLeft = metrics.length === 1 ? 42 : 42;
  metrics.forEach((metric, index) => {
    const left = metrics.length === 1 ? startLeft : startLeft + index * 399;
    items.push(shape({ name: `metric-panel-${number}-${index}`, geometry: "rect", fill: PANEL, position: { left, top: 304 }, width: widths[index], height: 296 }));
    items.push(textBox(metric, { left: left + 28, top: 350, width: widths[index] - 56, height: 106 }, metrics.length === 1 ? 80 : 58, { color: index === 1 ? ACCENT : INK, name: `metric-${number}-${index}`, verticalAlignment: "bottom" }));
    items.push(textBox(labels[index] || "", { left: left + 28, top: 478, width: widths[index] - 56, height: 72 }, 24, { name: `metric-label-${number}-${index}` }));
  });
  items.push(...sourceFooter(slideSpec, number));
  slide.compose(layers({ name: "manager-metrics", width: "fill", height: "fill" }, items), { frame: { left: 0, top: 0, width: 1280, height: 720 }, baseUnit: 1 });
  setNotes(slide, slideSpec);
  return slide;
}

function addThreePointSlide(slideSpec, number) {
  const slide = presentation.slides.add();
  const items = [textBox(slideSpec.title, { left: 42, top: 36, width: 1196, height: 118 }, 48, { name: `title-${number}` })];
  slideSpec.body.slice(0, 3).forEach((point, index) => {
    const top = 198 + index * 138;
    items.push(textBox(`0${index + 1}`, { left: 42, top, width: 82, height: 48 }, 30, { color: ACCENT, name: `index-${number}-${index}` }));
    items.push(shape({ name: `rule-${number}-${index}`, geometry: "rect", fill: index === 0 ? ACCENT : "#B8BCC4", position: { left: 144, top: top + 17 }, width: 170, height: 3 }));
    items.push(textBox(point, { left: 348, top: top - 8, width: 826, height: 88 }, 30, { name: `point-${number}-${index}`, verticalAlignment: "top" }));
  });
  items.push(...sourceFooter(slideSpec, number));
  slide.compose(layers({ name: "manager-three-points", width: "fill", height: "fill" }, items), { frame: { left: 0, top: 0, width: 1280, height: 720 }, baseUnit: 1 });
  setNotes(slide, slideSpec);
  return slide;
}

function addTimelineSlide(slideSpec, number) {
  const slide = presentation.slides.add();
  const timeline = slideSpec.timeline || [];
  const items = [
    textBox(slideSpec.title, { left: 42, top: 36, width: 1196, height: 118 }, 48, { name: `title-${number}` }),
    shape({ name: `timeline-line-${number}`, geometry: "rect", fill: "#B8BCC4", position: { left: 82, top: 344 }, width: 1090, height: 3 }),
  ];
  timeline.forEach((entry, index) => {
    const left = 82 + index * 268;
    items.push(shape({ name: `timeline-dot-${number}-${index}`, geometry: "ellipse", fill: index >= 2 ? ACCENT : INK, position: { left, top: 333 }, width: 24, height: 24 }));
    items.push(textBox(entry.year, { left: left - 12, top: 260, width: 110, height: 42 }, 24, { color: MUTED, name: `year-${number}-${index}` }));
    items.push(textBox(entry.value, { left: left - 12, top: 386, width: 150, height: 74 }, 36, { name: `value-${number}-${index}` }));
  });
  items.push(textBox(slideSpec.body[0], { left: 42, top: 560, width: 780, height: 40 }, 20, { color: MUTED, name: `uncertainty-${number}` }));
  items.push(...sourceFooter(slideSpec, number));
  slide.compose(layers({ name: "manager-timeline", width: "fill", height: "fill" }, items), { frame: { left: 0, top: 0, width: 1280, height: 720 }, baseUnit: 1 });
  setNotes(slide, slideSpec);
  return slide;
}

function addSourcesSlide(slideSpec, number) {
  const slide = presentation.slides.add();
  const rows = [["主题", "原报告页码"], ...slideSpec.body.map((line) => {
    const [topic, pages] = line.split("：");
    return [topic, pages || ""];
  })];
  slide.compose(layers({ name: "manager-sources", width: "fill", height: "fill" }, [
    textBox(slideSpec.title, { left: 42, top: 36, width: 1196, height: 118 }, 48, { name: `title-${number}` }),
    table({ name: "source-table", rows: rows.length, columns: 2, values: rows, columnWidths: [470, 690], position: { left: 42, top: 170 }, width: 1160, height: 430 }),
    ...sourceFooter(slideSpec, number),
  ]), { frame: { left: 0, top: 0, width: 1280, height: 720 }, baseUnit: 1 });
  return slide;
}

for (const [index, slideSpec] of spec.slides.entries()) {
  const number = index + 1;
  if (slideSpec.role === "cover") addCover(slideSpec, number);
  else if (slideSpec.role === "data_challenges") addTimelineSlide(slideSpec, number);
  else if (slideSpec.role === "sources") addSourcesSlide(slideSpec, number);
  else if (slideSpec.metrics?.length) addMetricSlide(slideSpec, number);
  else addThreePointSlide(slideSpec, number);
}

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.mkdir(args.evidence, { recursive: true });
for (const [index, slide] of presentation.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, "0")}`;
  const png = await presentation.export({ slide, format: "png", scale: 1 });
  await fs.writeFile(path.join(args.evidence, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(args.evidence, `${stem}.layout.json`), await layout.text(), "utf8");
}
const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(args.evidence, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(args.output);

const notesSlides = spec.slides.filter((slide) => slide.speakerNotes).length;
const contentSlides = spec.slides.filter((slide) => !["cover", "sources"].includes(slide.role)).length;
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  output: path.resolve(args.output),
  slideCount: spec.slides.length,
  audience: spec.audience,
  language: spec.language,
  speakerNotesCoverage: contentSlides > 0 ? notesSlides / contentSlides : 1,
  imageCount: 0,
  wholePageScreenshotReuse: false,
  slides: spec.slides.map((slide, index) => ({
    slide: index + 1,
    role: slide.role,
    title: slide.title,
    sourcePages: slide.sourcePages,
    hasSpeakerNotes: Boolean(slide.speakerNotes),
  })),
};
await fs.writeFile(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
