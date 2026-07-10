import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Channel adapter route-order verification failed: ${message}`);
    process.exit(1);
  }
}

function extractFunctionBody(source, functionName) {
  const signature = `function ${functionName}(`;
  const start = source.indexOf(signature);
  assert(start >= 0, `${functionName} is missing`);
  const open = source.indexOf("{", start);
  assert(open >= 0, `${functionName} body is missing`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert(false, `${functionName} body is not closed`);
}

function indexOfNeedle(source, needle) {
  const index = source.indexOf(needle);
  assert(index >= 0, `missing route marker: ${needle}`);
  return index;
}

function assertBefore(source, before, after, reason) {
  const beforeIndex = indexOfNeedle(source, before);
  const afterIndex = indexOfNeedle(source, after);
  assert(beforeIndex < afterIndex, reason);
}

function sliceFromMarker(source, marker) {
  const start = indexOfNeedle(source, marker);
  return source.slice(start);
}

const packageJson = read("package.json");
const adapters = read("src/main/channelAdapters.ts");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");
const summarizeFileBody = extractFunctionBody(adapters, "summarizeFile");

assert(
  packageJson.includes('"verify:channel-adapter-route-order": "node scripts/verify-channel-adapter-route-order.mjs"'),
  "package script is not registered",
);

const routeFixtures = [
  {
    file: "CODEOWNERS",
    route: "isRepositoryGovernanceFile(filePath, extension)",
    before: "kind === \"image\"",
    reason: "repository governance files must route before generic media/document/raw fallbacks",
  },
  {
    file: "coverage.xml",
    route: "summarizeCoverageReportFile(filePath, extension, size)",
    before: "summarizeWindowsScheduledTaskFile(filePath, extension, size)",
    reason: "coverage-shaped XML must route before scheduled-task XML and generic document/config fallbacks",
  },
  {
    file: "junit.xml",
    route: "looksLikeTestReportXml(filePath)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "JUnit XML must route before generic document text extraction",
  },
  {
    file: "checkstyle.xml",
    route: "summarizeStaticAnalysisXmlReportFile(filePath, extension, size)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Checkstyle/PMD/SpotBugs XML reports must route before generic XML document/config fallbacks",
  },
  {
    file: "sarif.json",
    route: "summarizeSarifResultFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "SARIF JSON must route before generic JSON summaries",
  },
  {
    file: "syft.json",
    route: "summarizeSbomProvenanceArtifact(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Syft SBOM JSON snapshots must route before generic JSON summaries",
  },
  {
    file: "npm-audit.json",
    route: "summarizeSecurityScanReportFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Snyk/npm audit/audit-ci JSON reports must route before generic JSON summaries",
  },
  {
    file: "package.json",
    route: "summarizeNodePackageManifestFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Node package manifests must route before generic JSON summaries",
  },
  {
    file: "pnpm-lock.yaml",
    route: "summarizeDependencyLockfile(filePath, extension, size)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "dependency lockfiles such as pnpm-lock.yaml must route before generic YAML summaries",
  },
  {
    file: "runtime.postman_environment.json",
    route: "summarizePostmanEnvironmentFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Postman environment JSON must route before generic JSON summaries",
  },
  {
    file: "docker-compose.yaml",
    route: "summarizeContainerComposeFile(filePath, size)",
    before: "const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size)",
    reason: "Docker Compose YAML must route before API/Kubernetes/generic YAML fallbacks",
    scope: "if (extension === \".yaml\" || extension === \".yml\")",
  },
  {
    file: "Chart.yaml",
    route: "isKubernetesPackageConfigFile(filePath, extension)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "Helm and Kustomize package configs must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: "style.css",
    route: "summarizeStylesheetFile(filePath, extension, size)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "stylesheets must route before generic source-code summaries",
  },
  {
    file: "runtime.prom",
    route: "summarizeMetricsSnapshotFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Prometheus/OpenMetrics snapshots must route before final raw text fallback",
  },
  {
    file: "calendar.ical",
    route: "summarizeCalendarIcsFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "iCalendar .ical snapshots must route before final raw text fallback",
  },
  {
    file: "schema.sql",
    route: "summarizeSqlScriptFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "SQL script and DDL snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.tap",
    route: "isTestReportFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "TAP test report snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.bru",
    route: "extension === \".bru\"",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Bruno API request files must route before final raw text fallback",
  },
  {
    file: "runtime.rest",
    route: "summarizeRestClientRequestFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "REST Client .rest request files must route before final raw text fallback",
  },
  {
    file: "robots.txt",
    route: "isWebCrawlMetadataFile(extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "robots.txt crawl metadata must route before final raw text fallback",
  },
  {
    file: "AndroidManifest.xml",
    route: "isAndroidManifestFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Android manifests must route before generic XML document/config fallbacks",
  },
  {
    file: "Info.plist",
    route: "isAppleInfoPlistFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Apple Info.plist manifests must route before generic XML document/config fallbacks",
  },
  {
    file: "runtime.apk",
    route: "isMobileAppPackageExtension(extension)",
    before: "if (extension === \".zip\")",
    reason: "APK/AAB/IPA mobile app packages must route before generic ZIP archive summaries",
  },
  {
    file: "sitemap.xml.gz",
    route: "isWebCrawlMetadataFile(extension)",
    before: "summarizeGzipArchiveFile(filePath, extension, size)",
    reason: "gzipped sitemap metadata must route before generic gzip archive summaries",
  },
  {
    file: "runtime.playwright.json",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Playwright/Jest/Vitest JSON test reports must route before generic JSON summaries",
  },
  {
    file: "runtime.trace.json",
    route: "isDevtoolsTraceFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "DevTools trace JSON must route before generic JSON summaries",
  },
  {
    file: "runtime.lighthouse.json",
    route: "isLighthouseReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Lighthouse report JSON must route before generic JSON summaries",
  },
  {
    file: "runtime.geojson",
    route: "summarizeGeospatialFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "GeoJSON files must route before generic JSON summaries",
  },
  {
    file: "runtime.tfplan.json",
    route: "summarizeTerraformPlanJsonFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Terraform plan JSON snapshots must route before generic JSON summaries",
  },
  {
    file: "runtime.cloudformation.yaml",
    route: "summarizeCloudIacTemplateFile(filePath, extension, size)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "CloudFormation/SAM YAML templates must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: "runtime.arm-template.json",
    route: "summarizeCloudIacTemplateFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Azure ARM template JSON snapshots must route before generic JSON summaries",
  },
  {
    file: "runtime.bicep",
    route: "summarizeCloudIacTemplateFile(filePath, extension, size)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "Azure Bicep templates must route before generic source-code summaries",
  },
  {
    file: "runtime-playbook.yaml",
    route: "summarizeAnsibleAutomationFile(filePath, extension, size)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "Ansible playbook YAML must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: ".github/workflows/runtime.yml",
    route: "detectCiWorkflowKind(filePath)",
    before: "summarizeAnsibleAutomationFile(filePath, extension, size)",
    reason: "CI/CD workflow YAML must route before broad Ansible YAML heuristics",
  },
  {
    file: "change.patch",
    route: "summarizePatchDiffFile(workspacePath, filePath, extension, size)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "patch/diff files must route before generic source-code summaries",
  },
  {
    file: "runtime.ps1",
    route: "isPowerShellScriptExtension(extension)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "PowerShell scripts must route through specialized script metadata previews before generic source-code summaries",
  },
  {
    file: "runtime.cmd",
    route: "isBatchScriptExtension(extension)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "Windows batch scripts must route through specialized script metadata previews before generic source-code summaries",
  },
  {
    file: "settings.toml",
    route: "summarizeConfigOrLogFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "known config/log files must route before final raw text fallback",
  },
];

for (const fixture of routeFixtures) {
  const routeSource = fixture.scope ? sliceFromMarker(summarizeFileBody, fixture.scope) : summarizeFileBody;
  assert(
    routeSource.includes(fixture.route),
    `${fixture.file} fixture route marker is missing`,
  );
  assertBefore(routeSource, fixture.route, fixture.before, fixture.reason);
}

assertBefore(
  summarizeFileBody,
  "isWindowsScheduledTaskFile(extension) || (extension === \".xml\" && looksLikeWindowsScheduledTaskXml(filePath))",
  "kind === \"document\" && extension !== \".ipynb\"",
  "scheduled-task XML must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isScientificContainerExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "scientific containers must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isScientificContainerExtension(extension)",
  "isBinaryArtifactExtension(extension)",
  "scientific containers must route before generic binary artifact summaries",
);
assertBefore(
  summarizeFileBody,
  "isColumnarDataExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Parquet/Arrow/Feather columnar data must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "if (extension === \".yaml\" || extension === \".yml\")",
  "kind === \"document\" && extension !== \".ipynb\"",
  "YAML config/workflow/API/Kubernetes files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isConfigOrLogExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "known config/log files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isNodePackageManagerConfigFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "package-manager config files must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isPythonDependencyManifestFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "Python dependency manifests must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isGoModuleManifestFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "Go module manifests must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isApplePackageManifestFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Apple package manifests such as Package.swift must route before generic document extraction",
);
assertBefore(
  summarizeFileBody,
  "isPhpRubyPackageManifestFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "PHP/Ruby package manifests such as composer.json and Gemfile must route before generic document extraction",
);
assertBefore(
  summarizeFileBody,
  "isElixirHaskellPackageManifestFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Elixir/Haskell package manifests must route before generic document extraction",
);
assertBefore(
  summarizeFileBody,
  "isDartPubspecManifestFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Dart pubspec manifests must route before generic document extraction",
);
assertBefore(
  summarizeFileBody,
  "isCargoManifestFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "Cargo manifests must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isDependencyLockfile(filePath, extension)",
  "if (extension === \".yaml\" || extension === \".yml\")",
  "dependency lockfiles must route before generic YAML fallbacks",
);
assertBefore(
  summarizeFileBody,
  "isDependencyLockfile(filePath, extension)",
  "if (extension === \".json\")",
  "dependency lockfiles must route before generic JSON fallbacks",
);
assertBefore(
  summarizeFileBody,
  "isDotnetNugetConfigFile(filePath, extension)",
  "isBuildManifestFile(filePath, extension)",
  ".NET/NuGet config files must route before generic build manifest summaries",
);
assertBefore(
  summarizeFileBody,
  "isDotnetNugetConfigFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  ".NET/NuGet config files must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isDotnetNugetConfigFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  ".NET/NuGet config files must route before generic document extraction",
);
assertBefore(
  summarizeFileBody,
  "extension === \".proto\"",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Protobuf schemas must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isSarifResultFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "SARIF result files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isSbomProvenanceArtifact(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "SBOM/provenance artifacts must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isSecurityArtifactExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "security artifacts must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isJavaBuildArtifactExtension(extension)",
  "isBinaryArtifactExtension(extension)",
  "Java build artifacts must route before generic binary artifact summaries",
);
assertBefore(
  summarizeFileBody,
  "isJavaBuildArtifactExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Java build artifacts must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isBinaryArtifactExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "binary artifacts must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isGeospatialExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "geospatial files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isCadDrawingExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "CAD drawing files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isDiagramSourceExtension(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "diagram source files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isIacConfigExtension(extension)",
  "isSourceCodeExtension(extension)",
  "IaC files must route before generic source-code summaries",
);
assertBefore(
  summarizeFileBody,
  "isAnsibleAutomationFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "Ansible files must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isFeedDocumentExtension(extension) || (extension === \".xml\" && looksLikeFeedXml(filePath))",
  "kind === \"document\" && extension !== \".ipynb\"",
  "RSS/Atom feed documents must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isWebCrawlMetadataFile(extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "web crawl metadata files must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "isWebCrawlMetadataFile(extension)",
  "summarizeGzipArchiveFile(filePath, extension, size)",
  "web crawl metadata files must route before generic gzip archive summaries",
);

assert(adapters.includes("getImportExtension(filePath)"), "route-order verifier depends on normalized import extensions");
assert(adapters.includes('".cmakelists.txt"'), "normalized fixture coverage omits CMakeLists.txt");
assert(adapters.includes('".compile_commands.json"'), "normalized fixture coverage omits compile_commands.json");
assert(adapters.includes('".gradle.properties"'), "normalized fixture coverage omits gradle.properties");
assert(adapters.includes('".maven.config"'), "normalized fixture coverage omits .mvn/maven.config");
assert(adapters.includes('".jvm.config"'), "normalized fixture coverage omits .mvn/jvm.config");
assert(adapters.includes('".dotnet-global.json"') && adapters.includes('".nuget.config"') && adapters.includes('".packages.config"') && adapters.includes('".nuspec"'), "normalized fixture coverage omits .NET/NuGet config files");
assert(adapters.includes('".swift-package"'), "normalized fixture coverage omits Package.swift");
assert(adapters.includes('".composer.json"') && adapters.includes('".gemfile"'), "normalized fixture coverage omits PHP/Ruby package manifests");
assert(adapters.includes('".syft.json"'), "normalized fixture coverage omits Syft SBOM files");
assert(adapters.includes('".test-results.json"'), "normalized fixture coverage omits JSON test report manifests");
assert(adapters.includes('".trace.json"'), "normalized fixture coverage omits DevTools trace manifests");
assert(adapters.includes('".lighthouse.json"'), "normalized fixture coverage omits Lighthouse report manifests");
assert(adapters.includes('".robots.txt"') && adapters.includes('".sitemap.xml"') && adapters.includes('".sitemap.xml.gz"'), "normalized fixture coverage omits web crawl metadata files");
assert(adapters.includes('".helm-chart.yaml"') && adapters.includes('".kustomization.yaml"'), "normalized fixture coverage omits Helm/Kustomize package configs");
assert(adapters.includes('".androidmanifest.xml"'), "normalized fixture coverage omits AndroidManifest.xml");
assert(adapters.includes('".info.plist"'), "normalized fixture coverage omits Info.plist");
assert(adapters.includes('".apk"') && adapters.includes('".aab"') && adapters.includes('".ipa"'), "normalized fixture coverage omits mobile app package files");
assert(adapters.includes('".checkstyle.xml"') && adapters.includes('".pmd.xml"') && adapters.includes('".spotbugs.xml"'), "normalized fixture coverage omits static analysis XML reports");
assert(adapters.includes('".tfplan.json"'), "normalized fixture coverage omits Terraform plan JSON snapshots");
assert(adapters.includes('".cloudformation.yaml"') && adapters.includes('".cloudformation.json"') && adapters.includes('".arm-template.json"') && adapters.includes('".bicep"'), "normalized fixture coverage omits CloudFormation/ARM/Bicep template files");
assert(adapters.includes('".ical"'), "normalized fixture coverage omits iCalendar .ical files");

assert(checklist.includes("route-order-verification-agent"), "checklist omits route-order verification agent record");
assert(checklist.includes("Channel Adapter Route-Order Verification"), "checklist omits route-order verification addendum");
assert(checklist.includes("npm run verify:channel-adapter-route-order"), "checklist omits route-order verification command");
assert(roadmap.includes("channel adapter route-order verification"), "roadmap omits route-order verification evidence");
assert(roadmap.includes("npm run verify:channel-adapter-route-order"), "roadmap omits route-order verification command");

console.log("Channel adapter route-order verification passed.");
