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
    file: ".gitmodules",
    route: "isRepositoryGovernanceFile(filePath, extension)",
    before: "kind === \"image\"",
    reason: ".gitmodules must route through repository governance before generic config fallbacks",
  },
  {
    file: ".mailmap",
    route: "isRepositoryGovernanceFile(filePath, extension)",
    before: "kind === \"image\"",
    reason: ".mailmap must route through repository governance before generic raw fallbacks",
  },
  {
    file: "coverage.xml",
    route: "summarizeCoverageReportFile(filePath, extension, size)",
    before: "summarizeWindowsScheduledTaskFile(filePath, extension, size)",
    reason: "coverage-shaped XML must route before scheduled-task XML and generic document/config fallbacks",
  },
  {
    file: "jacoco.xml",
    route: "summarizeCoverageReportFile(filePath, extension, size)",
    before: "summarizeWindowsScheduledTaskFile(filePath, extension, size)",
    reason: "JaCoCo coverage XML must route before scheduled-task XML and generic document/config fallbacks",
  },
  {
    file: "junit.xml",
    route: "looksLikeTestReportXml(filePath)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "JUnit XML must route before generic document text extraction",
  },
  {
    file: "runtime.jmeter.xml",
    route: "isTestReportFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "JMeter XML must route before generic XML document/config fallbacks",
  },
  {
    file: "runtime.jmx",
    route: "summarizeJmeterTestPlanFile(filePath, size)",
    before: "isKeePassDatabaseExtension(extension)",
    reason: "JMeter JMX plans must route through bounded test plan previews before generic XML/document fallbacks",
  },
  {
    file: "runtime.jmeter.csv",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "JMeter CSV must route before generic CSV summaries",
  },
  {
    file: "runtime.nunit.xml",
    route: "isTestReportFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "NUnit XML must route before generic document text extraction",
  },
  {
    file: "runtime.xunit.xml",
    route: "isTestReportFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "xUnit XML must route before generic document text extraction",
  },
  {
    file: "checkstyle.xml",
    route: "summarizeStaticAnalysisXmlReportFile(filePath, extension, size)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Checkstyle/PMD/SpotBugs XML reports must route before generic XML document/config fallbacks",
  },
  {
    file: "runtime.jfr",
    route: "summarizeJavaFlightRecorderFile(filePath, size)",
    before: "isBinaryArtifactExtension(extension)",
    reason: "JFR snapshots must route through bounded flight-recorder previews before generic binary fallbacks",
  },
  {
    file: "web.config",
    route: "summarizeIisWebConfigFile(filePath, size)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "IIS web.config files must route before generic XML document/config fallbacks",
  },
  {
    file: "applicationHost.config",
    route: "summarizeIisWebConfigFile(filePath, size)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "IIS applicationHost.config files must route before generic XML document/config fallbacks",
  },
  {
    file: "nginx.conf",
    route: "summarizeWebServerConfigFile(filePath, size)",
    before: "isSourceCodeExtension(extension)",
    reason: "Nginx/Apache web server configs must route before generic source/config fallbacks",
  },
  {
    file: "runtime.kdbx",
    route: "summarizeKeePassDatabaseFile(filePath, size)",
    before: "isScientificContainerExtension(extension)",
    reason: "KeePass KDBX databases must route through safe header-only previews before generic binary/document fallbacks",
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
    file: "coverage-final.json",
    route: "summarizeCoverageReportFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Istanbul/nyc JSON coverage reports must route before generic JSON summaries",
  },
  {
    file: "coverage-summary.json",
    route: "summarizeCoverageReportFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Istanbul/nyc summary coverage reports must route before generic JSON summaries",
  },
  {
    file: "runtime.otlp.json",
    route: "isOtelJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "OpenTelemetry/OTLP JSON snapshots must route before generic JSON summaries",
  },
  {
    file: ".drsai/mcp-servers.json",
    route: "isMcpServerConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "MCP server configuration JSON must route before generic JSON summaries",
  },
  {
    file: ".vscode/settings.json",
    route: "isVsCodeWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "VS Code workspace settings must route before generic JSON summaries",
  },
  {
    file: ".vscode/tasks.json",
    route: "isVsCodeWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "VS Code workspace tasks must route before generic JSON summaries",
  },
  {
    file: ".vscode/launch.json",
    route: "isVsCodeWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "VS Code launch configs must route before generic JSON summaries",
  },
  {
    file: ".vscode/extensions.json",
    route: "isVsCodeWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "VS Code extension recommendations must route before generic JSON summaries",
  },
  {
    file: "pnpm-workspace.yaml",
    route: "isJsWorkspaceConfigFile(filePath, extension)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "pnpm workspace config must route before generic YAML/config summaries",
  },
  {
    file: "turbo.json",
    route: "isJsWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Turborepo config must route before generic JSON summaries",
  },
  {
    file: "nx.json",
    route: "isJsWorkspaceConfigFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Nx workspace config must route before generic JSON summaries",
  },
  {
    file: "slack-export.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Slack chat export JSON must route before generic JSON summaries",
  },
  {
    file: "teams-export.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Microsoft Teams chat export JSON must route before generic JSON summaries",
  },
  {
    file: "discord-export.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Discord chat export JSON must route before generic JSON summaries",
  },
  {
    file: "chatgpt-conversations.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "ChatGPT conversations export JSON must route before generic JSON summaries",
  },
  {
    file: "claude-conversations.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Claude conversations export JSON must route before generic JSON summaries",
  },
  {
    file: "telegram-export.json",
    route: "isChatExportJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Telegram chat export JSON must route before generic JSON summaries",
  },
  {
    file: "slack-export.csv",
    route: "extension === \".chat-export.csv\"",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Slack/Teams/Discord chat export CSV must route before generic structured CSV summaries",
  },
  {
    file: "chrome-passwords.csv",
    route: "extension === \".browser-passwords.csv\"",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "browser password CSV exports must route before generic structured CSV summaries",
  },
  {
    file: "runtime.rdp",
    route: "extension === \".rdp\"",
    before: "if (extension === \".reg\")",
    reason: "Remote Desktop .rdp files must route before adjacent Windows/native and raw-text fallbacks",
  },
  {
    file: "whatsapp-chat.txt",
    route: "extension === \".chat-export.txt\"",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "WhatsApp chat text exports must route before final raw text fallback",
  },
  {
    file: "zoom-transcript.txt",
    route: "extension === \".meeting-transcript.txt\"",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "meeting transcript text exports must route before final raw text fallback",
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
    file: "runtime.schema.json",
    route: "isJsonSchemaFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "JSON Schema documents must route before generic JSON summaries",
  },
  {
    file: "animation.json",
    route: "isLottieAnimationJsonFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Lottie/Bodymovin animation JSON must route before generic JSON summaries",
  },
  {
    file: "manifest.json",
    route: "isPwaWebManifestFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "PWA-shaped manifest.json files must route before generic JSON summaries",
    scope: "if (extension === \".json\")",
  },
  {
    file: "runtime-extension.vsix",
    route: "isExtensionPackageExtension(extension)",
    before: "extension === \".zip\"",
    reason: "VSIX extension packages must route through extension package metadata before generic ZIP fallback",
  },
  {
    file: "runtime-extension.crx",
    route: "isExtensionPackageExtension(extension)",
    before: "isPwaWebManifestFile(filePath, extension)",
    reason: "CRX extension packages must route through extension package metadata before adjacent web-app fallbacks",
  },
  {
    file: "openapi.json",
    route: "const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "OpenAPI/Swagger JSON specs must route through API spec preview before generic JSON summaries",
    scope: "if (extension === \".json\")",
  },
  {
    file: "asyncapi.json",
    route: "const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "AsyncAPI JSON specs must route through API spec preview before generic JSON summaries",
    scope: "if (extension === \".json\")",
  },
  {
    file: "schema-introspection.json",
    route: "summarizeGraphqlIntrospectionFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "GraphQL introspection JSON must route through schema metadata preview before generic JSON summaries",
  },
  {
    file: "runtime.pact.json",
    route: "summarizePactContractFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Pact contract JSON must route through consumer contract preview before generic JSON summaries",
  },
  {
    file: ".drsai/tokenizer-calibration.json",
    route: "summarizeTokenizerCalibrationFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "workspace tokenizer calibration JSON must route before generic JSON summaries",
  },
  {
    file: "netlog.json",
    route: "summarizeNetlogNetworkTraceFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Chrome NetLog JSON must route before generic JSON summaries",
  },
  {
    file: ".devcontainer/devcontainer.json",
    route: "summarizeDevContainerConfigFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Dev Container config JSON must route before generic JSON summaries",
  },
  {
    file: ".github/dependabot.yml",
    route: "summarizeDependabotConfigFile(filePath, size)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "Dependabot config YAML must route before generic YAML/config summaries",
  },
  {
    file: ".github/ISSUE_TEMPLATE/bug_report.yml",
    route: "summarizeGithubTemplateFile(filePath, size)",
    before: "if (isDependabotConfigFile(filePath, extension))",
    reason: "GitHub issue forms must route through template preview before generic YAML/config summaries",
  },
  {
    file: ".github/pull_request_template.md",
    route: "summarizeGithubTemplateFile(filePath, size)",
    before: "if (isDependabotConfigFile(filePath, extension))",
    reason: "GitHub PR templates must route through template preview before generic Markdown summaries",
  },
  {
    file: ".pre-commit-config.yaml",
    route: "summarizePreCommitConfigFile(filePath, size)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "pre-commit hook configs must route through bounded hook previews before generic YAML/config summaries",
  },
  {
    file: "renovate.json",
    route: "summarizeRenovateConfigFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Renovate config JSON must route before generic JSON summaries",
  },
  {
    file: "docker-compose.yaml",
    route: "summarizeContainerComposeFile(filePath, size)",
    before: "const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size)",
    reason: "Docker Compose YAML must route before API/Kubernetes/generic YAML fallbacks",
    scope: "if (extension === \".yaml\" || extension === \".yml\")",
  },
  {
    file: "asyncapi.yaml",
    route: "const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size)",
    before: "return summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "AsyncAPI YAML must route through API spec preview before generic YAML summaries",
    scope: "if (extension === \".yaml\" || extension === \".yml\")",
  },
  {
    file: "Chart.yaml",
    route: "isKubernetesPackageConfigFile(filePath, extension)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "Helm and Kustomize package configs must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: "values.yaml",
    route: "isHelmValuesFile(filePath, extension)",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "Helm values files must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: ".kube/config",
    route: "isKubeconfigFile(filePath, extension)",
    before: "if (isDependencyLockfile(filePath, extension))",
    reason: "Kubernetes kubeconfig files must route before generic YAML/config and manifest fallbacks",
  },
  {
    file: "release/winget/HepAI.OpenDrSai/1.4.2/HepAI.OpenDrSai.installer.yaml",
    route: "extension === \".winget-manifest.yaml\"",
    before: "if (extension === \".yaml\" || extension === \".yml\")",
    reason: "winget manifests must route before generic YAML/API/Kubernetes fallbacks",
  },
  {
    file: "style.css",
    route: "summarizeStylesheetFile(filePath, extension, size)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "stylesheets must route before generic source-code summaries",
  },
  {
    file: ".envrc",
    route: "summarizeDirenvConfigFile(filePath, size)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "direnv .envrc files must route through the specialized safe preview before generic source/raw fallbacks",
  },
  {
    file: ".env.runtime",
    route: "summarizeDotenvEnvironmentFile(filePath, size)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "dotenv environment files must route through specialized value-hidden previews before generic config summaries",
    scope: "if (isDirenvConfigFile(extension))",
  },
  {
    file: "runtime.prom",
    route: "summarizeMetricsSnapshotFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Prometheus/OpenMetrics snapshots must route before final raw text fallback",
  },
  {
    file: "GITHUB_STEP_SUMMARY.md",
    route: "summarizeGithubActionsJobSummaryFile(filePath, size)",
    before: "summarizeDocumentText(filePath, extension, size)",
    reason: "GitHub Actions job summaries must route through CI-summary previews before generic Markdown document summaries",
  },
  {
    file: "security.txt",
    route: "summarizeSecurityTxtFile(filePath, size)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "security.txt vulnerability disclosure policies must route through the specialized safe preview before generic text/config fallbacks",
  },
  {
    file: "assetlinks.json",
    route: "summarizeWebAppAssociationFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Android Digital Asset Links must route through the specialized safe preview before generic JSON summaries",
  },
  {
    file: "apple-app-site-association",
    route: "summarizeWebAppAssociationFile(filePath, size)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Apple App Site Association files must route through the specialized safe preview before generic JSON summaries",
  },
  {
    file: "calendar.ical",
    route: "summarizeCalendarIcsFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "iCalendar .ical snapshots must route before final raw text fallback",
  },
  {
    file: "calendar.vcs",
    route: "summarizeCalendarIcsFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "vCalendar .vcs snapshots must route before final raw text fallback",
  },
  {
    file: "calendar-agenda.csv",
    route: "summarizeCalendarCsvFile(filePath, size)",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Calendar CSV agenda exports must route before generic structured CSV summaries",
  },
  {
    file: "contacts.csv",
    route: "summarizeContactCsvFile(filePath, size)",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Contact CSV exports must route before generic structured CSV summaries",
  },
  {
    file: "runtime.logcat",
    route: "extension === \".logcat\"",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Android logcat exports must route before final raw text fallback",
  },
  {
    file: "message.emlx",
    route: "[\".eml\", \".emlx\"].includes(extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Apple Mail EMLX message snapshots must route before final raw text fallback",
  },
  {
    file: "schema.sql",
    route: "summarizeSqlScriptFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "SQL script and DDL snapshots must route before final raw text fallback",
  },
  {
    file: "schema.prisma",
    route: "summarizeDatabaseSchemaDslFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Prisma and DBML schema DSL snapshots must route before final raw text fallback",
  },
  {
    file: "dump.rdb",
    route: "summarizeRedisPersistenceFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Redis RDB snapshots must route before final raw text fallback",
  },
  {
    file: "appendonly.aof",
    route: "summarizeRedisPersistenceFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Redis AOF command logs must route before final raw text fallback",
  },
  {
    file: "runtime.service",
    route: "isOpsScheduleFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: "systemd unit files must route before generic config/log summaries",
  },
  {
    file: "runtime.crontab",
    route: "isOpsScheduleFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "crontab files must route before final raw text fallback",
  },
  {
    file: "runtime.desktop",
    route: "extension === \".desktop\"",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "FreeDesktop .desktop launchers must route before generic document text extraction",
  },
  {
    file: "runtime.supervisord.conf",
    route: "isSupervisorConfigFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: "Supervisor config files must route before generic config/log summaries",
  },
  {
    file: ".htaccess",
    route: "isWebServerConfigFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: ".htaccess must route before generic config/log summaries",
  },
  {
    file: "runtime.vhost.conf",
    route: "isWebServerConfigFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: "Apache vhost config files must route before generic config/log summaries",
  },
  {
    file: "runtime.hosts",
    route: "isHostsFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: "hosts files must route before generic config/log summaries",
  },
  {
    file: "wg0.conf",
    route: "isVpnConfigFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: "WireGuard client configs must route before generic config/log summaries",
  },
  {
    file: "client.ovpn",
    route: "isVpnConfigFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "OpenVPN client profiles must route before final raw text fallback",
  },
  {
    file: "hosts.txt",
    route: "isHostsFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "hosts.txt snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.tap",
    route: "isTestReportFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "TAP test report snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.jtl",
    route: "isTestReportFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "JMeter JTL snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.cast",
    route: "summarizeTerminalRecordingFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Asciinema terminal recording snapshots must route before final raw text fallback",
  },
  {
    file: "runtime.powershell-transcript.txt",
    route: "summarizePowerShellTranscriptFile(filePath, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "PowerShell transcript logs must route before final raw text fallback",
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
    file: "constraints-runtime.txt",
    route: "isPythonDependencyManifestFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "pip constraints text files must route before final raw text fallback",
  },
  {
    file: ".pypirc",
    route: "isPythonPackageIndexConfigFile(filePath, extension)",
    before: "isConfigOrLogExtension(extension)",
    reason: ".pypirc package index configs must route before generic config/log summaries",
  },
  {
    file: ".ruff.toml",
    route: "isRuffConfigFile(filePath, extension)",
    before: "isPythonDependencyManifestFile(filePath, extension)",
    reason: "Ruff configs must route through bounded tooling previews before Python dependency or generic TOML summaries",
  },
  {
    file: "pyproject.toml",
    route: "isRuffConfigFile(filePath, extension)",
    before: "isPythonDependencyManifestFile(filePath, extension)",
    reason: "pyproject.toml files with [tool.ruff] must route through Ruff previews before Python dependency summaries",
  },
  {
    file: "robots.txt",
    route: "isWebCrawlMetadataFile(extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "robots.txt crawl metadata must route before final raw text fallback",
  },
  {
    file: "llms.txt",
    route: "isLlmsMetadataFile(extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "llms.txt website metadata must route before final raw text fallback",
  },
  {
    file: "site.webmanifest",
    route: "isPwaWebManifestFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "PWA web manifests must route before final raw text fallback",
  },
  {
    file: "extension-manifest.json",
    route: "isBrowserExtensionManifestFile(filePath, extension)",
    before: "isPwaWebManifestFile(filePath, extension)",
    reason: "Browser extension manifests must route before PWA/generic JSON manifest fallbacks",
  },
  {
    file: "browser-extensions.json",
    route: "isBrowserExtensionInventoryFile(filePath, extension)",
    before: "isPwaWebManifestFile(filePath, extension)",
    reason: "Browser extension inventory JSON exports must route before PWA/generic JSON fallbacks",
  },
  {
    file: "service-worker.js",
    route: "isPwaServiceWorkerScriptFile(filePath, extension)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "PWA service worker scripts must route through specialized safe preview before generic JavaScript source summaries",
  },
  {
    file: "cookies.txt",
    route: "extension === \".browser-cookies.txt\"",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Netscape cookies.txt exports must route before final raw text fallback",
  },
  {
    file: "autofill.csv",
    route: "extension === \".browser-autofill.csv\" || extension === \".browser-autofill.json\"",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Browser autofill CSV exports must route before generic CSV summaries",
  },
  {
    file: "autofill.json",
    route: "extension === \".browser-autofill.csv\" || extension === \".browser-autofill.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser autofill JSON exports must route before generic JSON summaries",
  },
  {
    file: "bookmarks.json",
    route: "extension === \".browser-bookmarks.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser bookmark JSON exports must route before generic JSON summaries",
  },
  {
    file: "history.csv",
    route: "extension === \".browser-history.csv\" || extension === \".browser-history.json\"",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Browser history CSV exports must route before generic CSV summaries",
  },
  {
    file: "history.json",
    route: "extension === \".browser-history.csv\" || extension === \".browser-history.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser history JSON exports must route before generic JSON summaries",
  },
  {
    file: "History",
    route: "extension === \".browser-history.sqlite\"",
    before: "summarizeSqliteDatabaseFile(filePath, size)",
    reason: "Browser History SQLite snapshots must route before generic SQLite summaries",
  },
  {
    file: "downloads.csv",
    route: "extension === \".browser-downloads.csv\" || extension === \".browser-downloads.json\"",
    before: "summarizeCsvDataFile(filePath, size, extension)",
    reason: "Browser downloads CSV exports must route before generic CSV summaries",
  },
  {
    file: "downloads.json",
    route: "extension === \".browser-downloads.csv\" || extension === \".browser-downloads.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser downloads JSON exports must route before generic JSON summaries",
  },
  {
    file: "Downloads",
    route: "extension === \".browser-downloads.sqlite\"",
    before: "summarizeSqliteDatabaseFile(filePath, size)",
    reason: "Browser Downloads SQLite snapshots must route before generic SQLite summaries",
  },
  {
    file: "preferences.json",
    route: "extension === \".browser-preferences.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser preferences JSON exports must route before generic JSON summaries",
  },
  {
    file: "feed.json",
    route: "isJsonFeedDocumentFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "JSON Feed snapshots must route before generic JSON summaries",
  },
  {
    file: "runtime.js.map",
    route: "isSourceMapFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "source map JSON files must route before generic JSON summaries",
  },
  {
    file: "local-storage.json",
    route: "extension === \".browser-storage.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser local storage JSON exports must route before generic JSON summaries",
  },
  {
    file: "tabs.json",
    route: "extension === \".browser-session.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser session tab JSON exports must route before generic JSON summaries",
  },
  {
    file: "session-storage.json",
    route: "extension === \".browser-storage.json\"",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Browser session storage JSON exports must route before generic JSON summaries",
  },
  {
    file: "AndroidManifest.xml",
    route: "isAndroidManifestFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Android manifests must route before generic XML document/config fallbacks",
  },
  {
    file: "strings.xml",
    route: "isAndroidResourceXmlFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Android resource XML files must route before generic XML document/config fallbacks",
  },
  {
    file: "Info.plist",
    route: "isAppleInfoPlistFile(filePath, extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Apple Info.plist manifests must route before generic XML document/config fallbacks",
  },
  {
    file: "runtime.crash",
    route: "isAppleCrashReportExtension(extension)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Apple .crash reports must route before generic document text extraction",
  },
  {
    file: "runtime.ips",
    route: "isAppleCrashReportExtension(extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Apple IPS crash JSON reports must route before generic JSON summaries",
  },
  {
    file: "project.pbxproj",
    route: "isApplePackageManifestFile(filePath, extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "Xcode project files must route before final raw text fallback",
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
    file: "runtime.warc.gz",
    route: "isWarcArchiveFile(extension)",
    before: "summarizeGzipArchiveFile(filePath, extension, size)",
    reason: "gzipped WARC snapshots must route before generic gzip archive summaries",
  },
  {
    file: "runtime.playwright.json",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Playwright/Jest/Vitest JSON test reports must route before generic JSON summaries",
  },
  {
    file: "runtime.cypress-results.json",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Cypress JSON test reports must route before generic JSON summaries",
  },
  {
    file: "runtime.mocha.json",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Mocha JSON test reports must route before generic JSON summaries",
  },
  {
    file: "runtime.allure-result.json",
    route: "isTestReportFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "Allure JSON test reports must route before generic JSON summaries",
  },
  {
    file: "runtime.trace.json",
    route: "isDevtoolsTraceFile(filePath, extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "DevTools trace JSON must route before generic JSON summaries",
  },
  {
    file: "runtime.cpuprofile",
    route: "isDevtoolsProfileFile(extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "DevTools CPU profiles must route before generic JSON summaries",
  },
  {
    file: "runtime.heapsnapshot",
    route: "isDevtoolsProfileFile(extension)",
    before: "summarizeJsonDataFile(filePath, size)",
    reason: "DevTools heap snapshots must route before generic JSON summaries",
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
    file: "paper.tex",
    route: "isLatexContextFile(extension)",
    before: "summarizeSourceCodeFile(filePath, extension, size)",
    reason: "LaTeX documents must route through specialized metadata previews before generic source-code summaries",
  },
  {
    file: "references.bib",
    route: "isLatexContextFile(extension)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "BibTeX files must route through specialized metadata previews before raw text fallback",
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
    file: "trace.zip",
    route: "summarizePlaywrightTraceZipFile(filePath, size)",
    before: "kind === \"document\" && extension !== \".ipynb\"",
    reason: "Playwright trace ZIP archives must route through specialized trace metadata previews before generic document fallbacks",
  },
  {
    file: "settings.toml",
    route: "summarizeConfigOrLogFile(filePath, extension, size)",
    before: "readFileSync(filePath, { encoding: \"utf8\", flag: \"r\" })",
    reason: "known config/log files must route before final raw text fallback",
  },
  {
    file: "libs.versions.toml",
    route: "isGradleVersionCatalogFile(filePath, extension)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "Gradle version catalogs must route through catalog previews before generic TOML/config summaries",
  },
  {
    file: ".ssh/config",
    route: "isSshConfigFile(filePath, extension)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "SSH config files must route through specialized safe preview before generic config summaries",
  },
  {
    file: "system.log",
    route: "summarizeAppleUnifiedLogFile(filePath, size)",
    before: "summarizeConfigOrLogFile(filePath, extension, size)",
    reason: "Apple unified/syslog exports must route before generic config/log summaries",
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
  "isJsToolingConfigFile(filePath, extension)",
  "if (extension === \".yaml\" || extension === \".yml\")",
  "JS/TS tooling configs must route before generic YAML handling",
);
assertBefore(
  summarizeFileBody,
  "isJsToolingConfigFile(filePath, extension)",
  "if (extension === \".yaml\" || extension === \".yml\" || extension === \".json\")",
  "JS/TS tooling configs must route before generic YAML/JSON handling",
);
assertBefore(
  summarizeFileBody,
  "isJsToolingConfigFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "JS/TS tooling configs must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isJsToolingConfigFile(filePath, extension)",
  "isSourceCodeExtension(extension)",
  "JS/TS tooling configs must route before generic source-code summaries",
);
assertBefore(
  summarizeFileBody,
  "isPythonDependencyManifestFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  "Python dependency manifests must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isPythonPackageIndexConfigFile(filePath, extension)",
  "isConfigOrLogExtension(extension)",
  ".pypirc package index configs must route before generic config/log summaries",
);
assertBefore(
  summarizeFileBody,
  "isRuffConfigFile(filePath, extension)",
  "isPythonDependencyManifestFile(filePath, extension)",
  "Ruff configs must route before Python dependency manifests and generic TOML handling",
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
  "isTokenizerCalibrationFile(filePath, extension)",
  "if (extension === \".json\")",
  "workspace tokenizer calibration JSON must route before generic JSON fallbacks",
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
  "isBazelBuildFile(filePath, extension)",
  "isCppBuildManifestFile(filePath, extension)",
  "Bazel/Starlark build files must route before generic C/C++ build manifest fallback",
);
assertBefore(
  summarizeFileBody,
  "isBazelBuildFile(filePath, extension)",
  "kind === \"document\" && extension !== \".ipynb\"",
  "Bazel/Starlark build files must route before generic document extraction",
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
  "isJsonFeedDocumentFile(filePath, extension)",
  "summarizeJsonDataFile(filePath, size)",
  "JSON Feed snapshots must route before generic JSON summaries",
);
assertBefore(
  summarizeFileBody,
  "isFeedDocumentExtension(extension) || (extension === \".xml\" && looksLikeFeedXml(filePath))",
  "kind === \"document\" && extension !== \".ipynb\"",
  "RSS/Atom feed documents must route before generic document text extraction",
);
assertBefore(
  summarizeFileBody,
  "extension === \".opml\"",
  "kind === \"document\" && extension !== \".ipynb\"",
  "OPML subscription exports must route before generic document text extraction",
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
assert(adapters.includes('".gitmodules"'), "normalized fixture coverage omits .gitmodules");
assert(adapters.includes('".mailmap"'), "normalized fixture coverage omits .mailmap");
assert(adapters.includes('".cmakelists.txt"'), "normalized fixture coverage omits CMakeLists.txt");
assert(adapters.includes('".compile_commands.json"'), "normalized fixture coverage omits compile_commands.json");
assert(adapters.includes('".gradle.properties"'), "normalized fixture coverage omits gradle.properties");
assert(adapters.includes('".gradle-version-catalog.toml"') && adapters.includes("summarizeGradleVersionCatalogFile"), "normalized fixture coverage omits Gradle version catalog files");
assert(adapters.includes('".maven.config"'), "normalized fixture coverage omits .mvn/maven.config");
assert(adapters.includes('".jvm.config"'), "normalized fixture coverage omits .mvn/jvm.config");
assert(adapters.includes('".maven-settings.xml"'), "normalized fixture coverage omits Maven settings.xml files");
assert(adapters.includes('".gha-job-summary.md"') && adapters.includes("summarizeGithubActionsJobSummaryFile"), "normalized fixture coverage omits GitHub Actions job summary Markdown");
assert(adapters.includes('".github-template"') && adapters.includes("summarizeGithubTemplateFile"), "normalized fixture coverage omits GitHub issue/PR templates");
assert(adapters.includes('".pre-commit-config.yaml"') && adapters.includes("summarizePreCommitConfigFile"), "normalized fixture coverage omits pre-commit config files");
assert(adapters.includes('".ruff.toml"') && adapters.includes("summarizeRuffConfigFile"), "normalized fixture coverage omits Ruff config files");
assert(adapters.includes('".dependabot.yaml"') && adapters.includes("summarizeDependabotConfigFile"), "normalized fixture coverage omits Dependabot config files");
assert(adapters.includes('".renovate.json"') && adapters.includes("summarizeRenovateConfigFile"), "normalized fixture coverage omits Renovate config files");
assert(adapters.includes('".dotnet-global.json"') && adapters.includes('".nuget.config"') && adapters.includes('".packages.config"') && adapters.includes('".nuspec"'), "normalized fixture coverage omits .NET/NuGet config files");
assert(adapters.includes('".swift-package"'), "normalized fixture coverage omits Package.swift");
assert(adapters.includes('".pbxproj"'), "normalized fixture coverage omits project.pbxproj");
assert(adapters.includes('".composer.json"') && adapters.includes('".gemfile"'), "normalized fixture coverage omits PHP/Ruby package manifests");
assert(adapters.includes('".syft.json"'), "normalized fixture coverage omits Syft SBOM files");
assert(adapters.includes('".istanbul-coverage.json"'), "normalized fixture coverage omits Istanbul JSON coverage files");
assert(adapters.includes('".chat-export.json"'), "normalized fixture coverage omits chat export JSON files");
assert(adapters.includes('".chat-export.csv"'), "normalized fixture coverage omits chat export CSV files");
assert(adapters.includes('".chat-export.txt"'), "normalized fixture coverage omits chat text export files");
assert(adapters.includes('".browser-passwords.csv"'), "normalized fixture coverage omits browser password CSV files");
assert(adapters.includes('".otel.json"') && adapters.includes('".otlp.json"'), "normalized fixture coverage omits OpenTelemetry/OTLP JSON files");
assert(adapters.includes('".mcp-servers.json"'), "normalized fixture coverage omits MCP server config JSON files");
assert(adapters.includes('".iis-web.config"'), "normalized fixture coverage omits IIS web.config files");
assert(adapters.includes('".web-server.conf"'), "normalized fixture coverage omits Nginx/Apache web server config files");
assert(adapters.includes('".vscode-settings.json"') && adapters.includes('".vscode-tasks.json"') && adapters.includes('".vscode-launch.json"') && adapters.includes('".vscode-extensions.json"'), "normalized fixture coverage omits VS Code workspace config JSON files");
assert(adapters.includes('".docker-compose.yaml"') && adapters.includes("summarizeContainerComposeFile"), "normalized fixture coverage omits Docker Compose config files");
assert(adapters.includes('".js-tooling-config"'), "normalized fixture coverage omits JS/TS tooling config files");
assert(adapters.includes('"commitlint.config.js"') && adapters.includes('".lintstagedrc"'), "normalized fixture coverage omits Commitlint/lint-staged tooling config files");
assert(adapters.includes('"knip.json"') && adapters.includes('"knip.config.ts"'), "normalized fixture coverage omits Knip tooling config files");
assert(adapters.includes('"vite.config.ts"') && adapters.includes('"rollup.config.mjs"') && adapters.includes('"tsup.config.ts"'), "normalized fixture coverage omits Vite/Rollup/Tsup tooling config files");
assert(adapters.includes('".test-results.json"'), "normalized fixture coverage omits JSON test report manifests");
assert(adapters.includes('".playwright-trace.zip"'), "normalized fixture coverage omits Playwright trace ZIP files");
assert(adapters.includes('".jmeter.xml"') && adapters.includes('".jmeter.csv"') && adapters.includes('".jtl"'), "normalized fixture coverage omits JMeter test report files");
assert(adapters.includes('".jmx"'), "normalized fixture coverage omits JMeter JMX test plan files");
assert(adapters.includes('".cypress-results.json"'), "normalized fixture coverage omits Cypress JSON test report files");
assert(adapters.includes('".mocha.json"'), "normalized fixture coverage omits Mocha JSON test report files");
assert(adapters.includes('".allure-result.json"'), "normalized fixture coverage omits Allure JSON test report files");
assert(adapters.includes('".nunit.xml"') && adapters.includes('".xunit.xml"'), "normalized fixture coverage omits NUnit/xUnit XML test report files");
assert(adapters.includes('".trace.json"'), "normalized fixture coverage omits DevTools trace manifests");
assert(adapters.includes('".cpuprofile"') && adapters.includes('".heapsnapshot"'), "normalized fixture coverage omits DevTools/V8 profile snapshots");
assert(adapters.includes('".lighthouse.json"'), "normalized fixture coverage omits Lighthouse report manifests");
assert(adapters.includes('".rdb"') && adapters.includes('".aof"'), "normalized fixture coverage omits Redis persistence files");
assert(adapters.includes('".prisma"') && adapters.includes('".dbml"'), "normalized fixture coverage omits database schema DSL files");
assert(adapters.includes('".service"') && adapters.includes('".timer"') && adapters.includes('".crontab"'), "normalized fixture coverage omits systemd/cron schedule files");
assert(adapters.includes('".supervisord.conf"'), "normalized fixture coverage omits Supervisor config files");
assert(adapters.includes('".web-server.conf"') && adapters.includes('name === ".htaccess"') && adapters.includes('name.endsWith(".vhost.conf")'), "normalized fixture coverage omits Apache .htaccess/vhost web server config files");
assert(adapters.includes('".graphml"') && adapters.includes("summarizeGraphmlDiagramPreview"), "normalized fixture coverage omits GraphML diagram source files");
assert(adapters.includes('".hosts"'), "normalized fixture coverage omits hosts files");
assert(adapters.includes('".vpn-config"') && adapters.includes("summarizeVpnConfigFile"), "normalized fixture coverage omits VPN config files");
assert(adapters.includes('".robots.txt"') && adapters.includes('".sitemap.xml"') && adapters.includes('".sitemap.xml.gz"'), "normalized fixture coverage omits web crawl metadata files");
assert(adapters.includes('".llms.txt"') && adapters.includes('".llms-full.txt"') && adapters.includes("summarizeLlmsMetadataFile"), "normalized fixture coverage omits llms.txt metadata files");
assert(adapters.includes('".warc"') && adapters.includes('".warc.gz"'), "normalized fixture coverage omits WARC archive files");
assert(adapters.includes('".webmanifest"'), "normalized fixture coverage omits PWA web manifest files");
assert(adapters.includes('".browser-extension-manifest.json"'), "normalized fixture coverage omits browser extension manifest files");
assert(adapters.includes('".browser-extension-inventory.json"'), "normalized fixture coverage omits browser extension inventory files");
assert(adapters.includes('".vsix"') && adapters.includes('".crx"') && adapters.includes("summarizeExtensionPackageFile"), "normalized fixture coverage omits VSIX/CRX extension package files");
assert(adapters.includes("isPwaServiceWorkerScriptFile"), "route-order coverage omits PWA service worker detection");
assert(adapters.includes('".browser-cookies.txt"'), "normalized fixture coverage omits browser cookies.txt files");
assert(adapters.includes('".browser-autofill.csv"') && adapters.includes('".browser-autofill.json"'), "normalized fixture coverage omits browser autofill export files");
assert(adapters.includes('".browser-bookmarks.json"'), "normalized fixture coverage omits browser bookmark JSON files");
assert(adapters.includes('".browser-history.csv"') && adapters.includes('".browser-history.json"') && adapters.includes('".browser-history.sqlite"'), "normalized fixture coverage omits browser history export files");
assert(adapters.includes('".browser-downloads.csv"') && adapters.includes('".browser-downloads.json"') && adapters.includes('".browser-downloads.sqlite"'), "normalized fixture coverage omits browser downloads export files");
assert(adapters.includes('".browser-preferences.json"'), "normalized fixture coverage omits browser preferences export files");
assert(adapters.includes('".browser-storage.json"'), "normalized fixture coverage omits browser storage export files");
assert(adapters.includes('".browser-session.json"'), "normalized fixture coverage omits browser session tab export files");
assert(adapters.includes('".helm-chart.yaml"') && adapters.includes('".helm-values.yaml"') && adapters.includes('".kustomization.yaml"'), "normalized fixture coverage omits Helm values or Kubernetes package configs");
assert(adapters.includes('".winget-manifest.yaml"') && adapters.includes("summarizeWingetManifestFile"), "normalized fixture coverage omits winget manifest files");
assert(adapters.includes('".androidmanifest.xml"'), "normalized fixture coverage omits AndroidManifest.xml");
assert(adapters.includes('".info.plist"'), "normalized fixture coverage omits Info.plist");
assert(adapters.includes('".jfr"') && adapters.includes("summarizeJavaFlightRecorderFile"), "normalized fixture coverage omits Java Flight Recorder files");
assert(adapters.includes('".oslog"') && adapters.includes("system.log") && adapters.includes('".syslog"'), "normalized fixture coverage omits Apple unified/syslog files");
assert(adapters.includes('".crash"') && adapters.includes('".ips"'), "normalized fixture coverage omits Apple crash report files");
assert(adapters.includes('".kdbx"') && adapters.includes('"application/x-keepass2"'), "normalized fixture coverage omits KeePass KDBX database files");
assert(adapters.includes('".apk"') && adapters.includes('".aab"') && adapters.includes('".ipa"'), "normalized fixture coverage omits mobile app package files");
assert(adapters.includes('".checkstyle.xml"') && adapters.includes('".pmd.xml"') && adapters.includes('".spotbugs.xml"'), "normalized fixture coverage omits static analysis XML reports");
assert(adapters.includes('".tfplan.json"'), "normalized fixture coverage omits Terraform plan JSON snapshots");
assert(adapters.includes('".cloudformation.yaml"') && adapters.includes('".cloudformation.json"') && adapters.includes('".arm-template.json"') && adapters.includes('".bicep"'), "normalized fixture coverage omits CloudFormation/ARM/Bicep template files");
assert(adapters.includes('".ical"'), "normalized fixture coverage omits iCalendar .ical files");
assert(adapters.includes('".vcs"'), "normalized fixture coverage omits vCalendar .vcs files");
assert(adapters.includes('".calendar.csv"'), "normalized fixture coverage omits calendar CSV agenda files");
assert(adapters.includes('".contacts.csv"'), "normalized fixture coverage omits contact CSV export files");
assert(adapters.includes('".meeting-transcript.txt"'), "normalized fixture coverage omits meeting transcript text files");
assert(adapters.includes('".tex"') && adapters.includes('".bib"') && adapters.includes('".latexmkrc"'), "normalized fixture coverage omits LaTeX/BibTeX files");
assert(adapters.includes('".powershell-transcript.txt"'), "normalized fixture coverage omits PowerShell transcript logs");
assert(adapters.includes('".desktop"') && adapters.includes("summarizeDesktopEntryFile"), "normalized fixture coverage omits FreeDesktop .desktop files");
assert(adapters.includes('".avsc"') && adapters.includes("summarizeAvroSchemaFile"), "normalized fixture coverage omits Avro schema files");

assert(checklist.includes("route-order-verification-agent"), "checklist omits route-order verification agent record");
assert(checklist.includes("Channel Adapter Route-Order Verification"), "checklist omits route-order verification addendum");
assert(checklist.includes("npm run verify:channel-adapter-route-order"), "checklist omits route-order verification command");
assert(checklist.includes("LaTeX/BibTeX Context Input"), "checklist omits LaTeX context route-order evidence");
assert(checklist.includes("PWA Web App Manifest Input"), "checklist omits PWA web manifest route-order evidence");
assert(checklist.includes("PWA Service Worker Script Input"), "checklist omits PWA service worker route-order evidence");
assert(checklist.includes("Browser Extension Inventory Input"), "checklist omits browser extension inventory route-order evidence");
assert(checklist.includes("Chat Export CSV Input"), "checklist omits chat export CSV route-order evidence");
assert(checklist.includes("Browser Autofill Export Input"), "checklist omits browser autofill route-order evidence");
assert(checklist.includes("Browser History Export Input"), "checklist omits browser history route-order evidence");
assert(checklist.includes("Browser Bookmark JSON Input"), "checklist omits browser bookmark JSON route-order evidence");
assert(checklist.includes("Browser Preferences JSON Input"), "checklist omits browser preferences route-order evidence");
assert(checklist.includes("Browser Storage Export Input"), "checklist omits browser storage route-order evidence");
assert(checklist.includes("Browser Session Tabs JSON Input"), "checklist omits browser session tabs route-order evidence");
assert(checklist.includes("Browser Password CSV Export Input"), "checklist omits browser password CSV route-order evidence");
assert(checklist.includes("Meeting Transcript Text Input"), "checklist omits meeting transcript route-order evidence");
assert(checklist.includes("KeePass KDBX Database Input"), "checklist omits KeePass KDBX route-order evidence");
assert(checklist.includes("Avro Schema File Input"), "checklist omits Avro schema route-order evidence");
assert(checklist.includes("Windows Package Manager Manifest Input"), "checklist omits winget manifest route-order evidence");
assert(checklist.includes("LLM Website Metadata Input"), "checklist omits llms.txt route-order evidence");
assert(checklist.includes("GitHub Issue/PR Template Input"), "checklist omits GitHub template route-order evidence");
assert(checklist.includes("Dependabot Config Input"), "checklist omits Dependabot config route-order evidence");
assert(checklist.includes("Renovate Config Input"), "checklist omits Renovate config route-order evidence");
assert(checklist.includes("Browser Downloads SQLite Snapshot Input"), "checklist omits browser downloads SQLite route-order evidence");
assert(checklist.includes("Runtime GraphML Diagram Source Fixture"), "checklist omits GraphML diagram route-order evidence");
assert(roadmap.includes("channel adapter route-order verification"), "roadmap omits route-order verification evidence");
assert(roadmap.includes("npm run verify:channel-adapter-route-order"), "roadmap omits route-order verification command");
assert(roadmap.includes("LaTeX/BibTeX context input"), "roadmap omits LaTeX context route-order evidence");
assert(roadmap.includes("PWA web app manifest input"), "roadmap omits PWA web manifest route-order evidence");
assert(roadmap.includes("PWA service worker script input"), "roadmap omits PWA service worker route-order evidence");
assert(roadmap.includes("Browser extension inventory input"), "roadmap omits browser extension inventory route-order evidence");
assert(roadmap.includes("chat export CSV input"), "roadmap omits chat export CSV route-order evidence");
assert(roadmap.includes("Apple crash report input"), "roadmap omits Apple crash report route-order evidence");
assert(roadmap.includes("KeePass KDBX database input"), "roadmap omits KeePass KDBX route-order evidence");
assert(roadmap.includes("Browser autofill export input"), "roadmap omits browser autofill route-order evidence");
assert(roadmap.includes("Browser session tabs JSON input"), "roadmap omits browser session tabs route-order evidence");
assert(roadmap.includes("Browser history export input"), "roadmap omits browser history route-order evidence");
assert(roadmap.includes("Browser bookmark JSON input"), "roadmap omits browser bookmark JSON route-order evidence");
assert(roadmap.includes("Browser preferences JSON input"), "roadmap omits browser preferences route-order evidence");
assert(roadmap.includes("Browser storage export input"), "roadmap omits browser storage route-order evidence");
assert(roadmap.includes("runtime GraphML diagram source fixture"), "roadmap omits GraphML diagram route-order evidence");

assert(roadmap.includes("browser password CSV export input"), "roadmap omits browser password CSV route-order evidence");
assert(roadmap.includes("meeting transcript text input"), "roadmap omits meeting transcript route-order evidence");
assert(roadmap.includes("Avro schema file input"), "roadmap omits Avro schema route-order evidence");
assert(roadmap.includes("Windows Package Manager manifest input"), "roadmap omits winget manifest route-order evidence");
assert(roadmap.includes("LLM website metadata input"), "roadmap omits llms.txt route-order evidence");
assert(roadmap.includes("GitHub issue/PR template input"), "roadmap omits GitHub template route-order evidence");
assert(roadmap.includes("Dependabot config input"), "roadmap omits Dependabot config route-order evidence");
assert(roadmap.includes("Renovate config input"), "roadmap omits Renovate config route-order evidence");
assert(roadmap.includes("Browser downloads SQLite snapshot input"), "roadmap omits browser downloads SQLite route-order evidence");

console.log("Channel adapter route-order verification passed.");
