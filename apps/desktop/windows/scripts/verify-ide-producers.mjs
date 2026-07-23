import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`IDE producer verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const desktopApi = read("../shared/api/desktopApi.ts");
const ideContext = read("src/main/ideContext.ts");
const vsCodeReadme = read("editor-integrations/vscode/README.md");
const packagingManifest = JSON.parse(read("editor-integrations/packaging-manifest.json"));
const jetBrainsReadme = read("editor-integrations/jetbrains/README.md");
const jetBrainsPlugin = read("editor-integrations/jetbrains/plugin.xml");
const jetBrainsSource = read("editor-integrations/jetbrains/src/main/kotlin/org/opendrsai/idecontext/OpenDrSaiIdeContextListener.kt");
const visualStudioReadme = read("editor-integrations/visual-studio/README.md");
const visualStudioManifest = read("editor-integrations/visual-studio/source.extension.vsixmanifest");
const visualStudioSource = read("editor-integrations/visual-studio/source/OpenDrSaiIdeContextPackage.cs");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes('"verify:ide-producers": "node scripts/verify-ide-producers.mjs"'),
  "package script is not registered",
);
assert(
  desktopApi.includes('| "vscode"') &&
    desktopApi.includes('| "jetbrains"') &&
    desktopApi.includes('| "visual_studio"'),
  "shared API does not declare all IDE context source types",
);
assert(
  ideContext.includes('value === "vscode"') &&
    ideContext.includes('value === "jetbrains"') &&
    ideContext.includes('value === "visual_studio"'),
  "main-process IDE context reader does not accept all producer source tags",
);

assert(vsCodeReadme.includes(".drsai/ide-context.json"), "VS Code README no longer documents the handoff schema");

assert(packagingManifest.schemaVersion === 1, "packaging manifest schema version changed unexpectedly");
assert(packagingManifest.contextFile === ".drsai/ide-context.json", "packaging manifest context path is wrong");
assert(packagingManifest.selectionLimitChars === 12000, "packaging manifest selection limit is wrong");
assert(Array.isArray(packagingManifest.producers), "packaging manifest producers are missing");

const jetBrainsPackage = packagingManifest.producers.find((producer) => producer.id === "jetbrains");
const visualStudioPackage = packagingManifest.producers.find((producer) => producer.id === "visual-studio");
assert(jetBrainsPackage, "packaging manifest omits JetBrains producer");
assert(visualStudioPackage, "packaging manifest omits Visual Studio producer");

assert(jetBrainsPackage.sourceTag === "jetbrains", "JetBrains package source tag is wrong");
assert(jetBrainsPackage.descriptor === "jetbrains/plugin.xml", "JetBrains package descriptor is wrong");
assert(
  jetBrainsPackage.sourceFiles.includes("jetbrains/src/main/kotlin/org/opendrsai/idecontext/OpenDrSaiIdeContextListener.kt"),
  "JetBrains package source file is missing",
);
assert(
  jetBrainsPackage.packagePreflight.some((step) => step.includes("Build the plugin ZIP")),
  "JetBrains package preflight does not include ZIP build",
);
assert(
  jetBrainsPackage.manualValidation.some((step) => step.includes('source: "jetbrains"')),
  "JetBrains package manual validation does not check source tag",
);

assert(visualStudioPackage.sourceTag === "visual_studio", "Visual Studio package source tag is wrong");
assert(
  visualStudioPackage.descriptor === "visual-studio/source.extension.vsixmanifest",
  "Visual Studio package descriptor is wrong",
);
assert(
  visualStudioPackage.sourceFiles.includes("visual-studio/source/OpenDrSaiIdeContextPackage.cs"),
  "Visual Studio package source file is missing",
);
assert(
  visualStudioPackage.packagePreflight.some((step) => step.includes("Build the VSIX")),
  "Visual Studio package preflight does not include VSIX build",
);
assert(
  visualStudioPackage.manualValidation.some((step) => step.includes('source: "visual_studio"')),
  "Visual Studio package manual validation does not check source tag",
);

assert(jetBrainsReadme.includes(".drsai/ide-context.json"), "JetBrains README does not document the handoff path");
assert(jetBrainsReadme.includes('source: "jetbrains"'), "JetBrains README does not document manual verification source");
assert(jetBrainsReadme.includes("12,000 characters"), "JetBrains README does not document the selection limit");
assert(jetBrainsReadme.includes("Packaging Preflight"), "JetBrains README does not document packaging preflight");
assert(jetBrainsReadme.includes("npm run verify:ide-producers"), "JetBrains README does not reference the producer verification");
assert(jetBrainsReadme.includes("Build the plugin ZIP"), "JetBrains README does not document packaged ZIP validation");
assert(jetBrainsPlugin.includes("FileEditorManagerListener"), "JetBrains plugin.xml does not register an editor listener");
assert(jetBrainsSource.includes('CONTEXT_RELATIVE_PATH = ".drsai/ide-context.json"'), "JetBrains producer writes the wrong handoff path");
assert(jetBrainsSource.includes("MAX_SELECTION_CHARS = 12000"), "JetBrains selection bound is missing");
assert(jetBrainsSource.includes('"source": "jetbrains"'), "JetBrains payload source is not marked");
assert(jetBrainsSource.includes("currentFile"), "JetBrains payload omits currentFile");
assert(jetBrainsSource.includes("currentSelection"), "JetBrains payload omits currentSelection");
assert(jetBrainsSource.includes("isInsidePath(workspaceRoot, filePath)"), "JetBrains producer does not check file workspace boundary");
assert(jetBrainsSource.includes("Files.createDirectories(contextPath.parent)"), "JetBrains producer does not create .drsai folder");
assert(jetBrainsSource.includes("StandardCopyOption.ATOMIC_MOVE"), "JetBrains producer does not use atomic replace semantics");

assert(visualStudioReadme.includes(".drsai/ide-context.json"), "Visual Studio README does not document the handoff path");
assert(visualStudioReadme.includes('source: "visual_studio"'), "Visual Studio README does not document manual verification source");
assert(visualStudioReadme.includes("12,000 characters"), "Visual Studio README does not document the selection limit");
assert(visualStudioReadme.includes("Packaging Preflight"), "Visual Studio README does not document packaging preflight");
assert(visualStudioReadme.includes("npm run verify:ide-producers"), "Visual Studio README does not reference the producer verification");
assert(visualStudioReadme.includes("Build the VSIX"), "Visual Studio README does not document packaged VSIX validation");
assert(visualStudioManifest.includes("Microsoft.VisualStudio.VsPackage"), "Visual Studio VSIX manifest does not declare a package asset");
assert(visualStudioSource.includes('ContextRelativePath = ".drsai\\\\ide-context.json"'), "Visual Studio producer writes the wrong handoff path");
assert(visualStudioSource.includes("MaxSelectionChars = 12000"), "Visual Studio selection bound is missing");
assert(visualStudioSource.includes('Source = "visual_studio"'), "Visual Studio payload source is not marked");
assert(visualStudioSource.includes("CurrentFile"), "Visual Studio payload omits current file");
assert(visualStudioSource.includes("CurrentSelection"), "Visual Studio payload omits current selection");
assert(visualStudioSource.includes("IsInsidePath(workspaceRoot, filePath)"), "Visual Studio producer does not check file workspace boundary");
assert(visualStudioSource.includes("Directory.CreateDirectory"), "Visual Studio producer does not create .drsai folder");
assert(visualStudioSource.includes("File.Move(tempPath, contextPath, true)"), "Visual Studio producer does not replace via temp file");

assert(roadmap.includes("JetBrains/Visual Studio producer skeletons"), "roadmap does not record JetBrains/Visual Studio producer progress");
assert(roadmap.includes("packaged/manual install validation preflight"), "roadmap does not record packaged/manual IDE validation progress");
assert(roadmap.includes("npm run verify:ide-producers"), "roadmap does not record IDE producer verification");

console.log("IDE producer verification passed.");
