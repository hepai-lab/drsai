import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import type {
  DesktopChannelAdapter,
  DesktopChannelAdapterAuthStartRequest,
  DesktopChannelAdapterAuthStartResult,
  DesktopChannelAdapterConfigureRequest,
  DesktopChannelAdapterConfigureResult,
  DesktopChannelAdapterListResult,
  DesktopChannelAdapterProvider,
  DesktopChannelConnection,
  DesktopChannelContextImportRequest,
  DesktopChannelContextImportResult,
  DesktopChannelContextItem,
  DesktopChannelInboundEvent,
  DesktopChannelInboundEventListRequest,
  DesktopChannelInboundEventRouteRequest,
  DesktopChannelInboundEventRouteResult,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDeliveryListRequest,
  DesktopChannelOutboundDraftRequest,
  DesktopChannelSnapshotSyncRequest,
  DesktopChannelSnapshotSyncResult,
  DesktopApprovalProposalRequest,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const MAX_IMPORT_ITEMS = 12;
const MAX_SCAN_ENTRIES = 240;
const MAX_SCAN_DEPTH = 3;
const MAX_TEXT_BYTES = 4096;
const MAX_DOCUMENT_EXTRACT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_METADATA_PREVIEW_BYTES = 512 * 1024;
const MAX_PDF_OBJECT_SUMMARY_ITEMS = 8;
const MAX_EPUB_TEXT_ITEMS = 6;
const MAX_STRUCTURED_DATA_PREVIEW_BYTES = 128 * 1024;
const MAX_CSV_PREVIEW_ROWS = 8;
const MAX_DELIMITED_SCHEMA_COLUMNS = 12;
const MAX_DELIMITED_ENUM_VALUES = 6;
const MAX_JSON_PREVIEW_KEYS = 16;
const MAX_JSONL_PREVIEW_RECORDS = 12;
const MAX_JSONL_FIELD_PREVIEW = 16;
const MAX_COLUMNAR_DATA_PREVIEW_BYTES = 192 * 1024;
const MAX_COLUMNAR_STRING_PREVIEW = 12;
const MAX_SCIENTIFIC_CONTAINER_PREVIEW_BYTES = 256 * 1024;
const MAX_SCIENTIFIC_CONTAINER_ITEM_PREVIEW = 12;
const MAX_HAR_PREVIEW_BYTES = 192 * 1024;
const MAX_HAR_ENTRY_PREVIEW = 8;
const MAX_HAR_HEADER_PREVIEW = 8;
const MAX_DEVTOOLS_TRACE_PREVIEW_BYTES = 192 * 1024;
const MAX_DEVTOOLS_TRACE_EVENT_PREVIEW = 16;
const MAX_DEVTOOLS_TRACE_ARG_PREVIEW = 8;
const MAX_LIGHTHOUSE_REPORT_PREVIEW_BYTES = 192 * 1024;
const MAX_LIGHTHOUSE_AUDIT_PREVIEW = 12;
const MAX_LIGHTHOUSE_CATEGORY_PREVIEW = 8;
const MAX_PCAP_PREVIEW_BYTES = 256 * 1024;
const MAX_PCAP_PACKET_PREVIEW = 8;
const MAX_PCAP_BLOCK_PREVIEW = 12;
const MAX_API_SPEC_PREVIEW_BYTES = 192 * 1024;
const MAX_API_ENDPOINT_PREVIEW = 16;
const MAX_API_SECURITY_PREVIEW = 8;
const MAX_POSTMAN_ENVIRONMENT_PREVIEW_BYTES = 96 * 1024;
const MAX_POSTMAN_ENVIRONMENT_ITEM_PREVIEW = 16;
const MAX_REST_CLIENT_PREVIEW_BYTES = 96 * 1024;
const MAX_REST_CLIENT_REQUEST_PREVIEW = 16;
const MAX_REST_CLIENT_HEADER_PREVIEW = 12;
const MAX_REST_CLIENT_VARIABLE_PREVIEW = 12;
const MAX_BRUNO_COLLECTION_PREVIEW_BYTES = 96 * 1024;
const MAX_BRUNO_COLLECTION_ITEM_PREVIEW = 16;
const MAX_GRAPHQL_PREVIEW_BYTES = 128 * 1024;
const MAX_GRAPHQL_OPERATION_PREVIEW = 12;
const MAX_GRAPHQL_TYPE_PREVIEW = 16;
const MAX_GRAPHQL_DIRECTIVE_PREVIEW = 8;
const MAX_PROTOBUF_PREVIEW_BYTES = 128 * 1024;
const MAX_PROTOBUF_ITEM_PREVIEW = 16;
const MAX_KUBERNETES_PREVIEW_BYTES = 128 * 1024;
const MAX_KUBERNETES_RESOURCE_PREVIEW = 16;
const MAX_KUBERNETES_CONTAINER_PREVIEW = 12;
const MAX_KUBERNETES_REFERENCE_PREVIEW = 12;
const MAX_KUBERNETES_PACKAGE_CONFIG_PREVIEW_BYTES = 96 * 1024;
const MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW = 16;
const MAX_GEOSPATIAL_PREVIEW_BYTES = 192 * 1024;
const MAX_GEOSPATIAL_FEATURE_PREVIEW = 16;
const MAX_GEOSPATIAL_COORDINATE_PREVIEW = 12;
const MAX_FEED_PREVIEW_BYTES = 128 * 1024;
const MAX_FEED_ITEM_PREVIEW = 12;
const MAX_WEB_CRAWL_METADATA_PREVIEW_BYTES = 128 * 1024;
const MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW = 16;
const MAX_ANDROID_MANIFEST_PREVIEW_BYTES = 128 * 1024;
const MAX_ANDROID_MANIFEST_ITEM_PREVIEW = 16;
const MAX_APPLE_INFO_PLIST_PREVIEW_BYTES = 128 * 1024;
const MAX_APPLE_INFO_PLIST_ITEM_PREVIEW = 16;
const MAX_MOBILE_APP_PACKAGE_PREVIEW_BYTES = 512 * 1024;
const MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW = 16;
const MAX_BOOKMARK_PREVIEW_BYTES = 128 * 1024;
const MAX_BOOKMARK_ITEM_PREVIEW = 16;
const MAX_LINK_SHORTCUT_PREVIEW_BYTES = 32 * 1024;
const MAX_WINDOWS_SHORTCUT_PREVIEW_BYTES = 64 * 1024;
const MAX_WINDOWS_SHORTCUT_STRING_PREVIEW = 10;
const MAX_REGISTRY_EXPORT_PREVIEW_BYTES = 96 * 1024;
const MAX_REGISTRY_KEY_PREVIEW = 12;
const MAX_REGISTRY_VALUE_PREVIEW = 16;
const MAX_WINDOWS_EVENT_LOG_PREVIEW_BYTES = 256 * 1024;
const MAX_WINDOWS_EVENT_LOG_CHUNK_PREVIEW = 8;
const MAX_WINDOWS_ETL_TRACE_PREVIEW_BYTES = 256 * 1024;
const MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW = 12;
const MAX_WINDOWS_ETW_MANIFEST_PREVIEW_BYTES = 128 * 1024;
const MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW = 16;
const MAX_WINDOWS_PERF_LOG_PREVIEW_BYTES = 256 * 1024;
const MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW = 12;
const MAX_WINDOWS_WPRP_PREVIEW_BYTES = 128 * 1024;
const MAX_WINDOWS_WPRP_ITEM_PREVIEW = 16;
const MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES = 256 * 1024;
const MAX_WINDOWS_CRASH_DUMP_STREAM_PREVIEW = 12;
const MAX_WINDOWS_ERROR_REPORT_PREVIEW_BYTES = 96 * 1024;
const MAX_WINDOWS_ERROR_REPORT_FIELD_PREVIEW = 16;
const MAX_WINDOWS_INSTALLER_PACKAGE_PREVIEW_BYTES = 512 * 1024;
const MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_WINDOWS_INSTALLER_ITEM_PREVIEW = 12;
const MAX_WINDOWS_TASK_PREVIEW_BYTES = 96 * 1024;
const MAX_WINDOWS_TASK_ITEM_PREVIEW = 12;
const MAX_XLSX_PREVIEW_SHEETS = 3;
const MAX_XLSX_PREVIEW_ROWS = 6;
const MAX_XLSX_PREVIEW_CELLS = 8;
const MAX_XLSX_FORMULA_PREVIEW = 12;
const MAX_NOTEBOOK_PREVIEW_BYTES = 256 * 1024;
const MAX_NOTEBOOK_PREVIEW_CELLS = 8;
const MAX_NOTEBOOK_OUTPUT_PREVIEW = 6;
const MAX_CONFIG_LOG_PREVIEW_BYTES = 64 * 1024;
const MAX_CONFIG_KEYS_PREVIEW = 24;
const MAX_CONFIG_SCHEMA_HINTS = 8;
const MAX_CI_WORKFLOW_PREVIEW_ITEMS = 12;
const MAX_METRICS_SNAPSHOT_PREVIEW_BYTES = 128 * 1024;
const MAX_METRICS_SNAPSHOT_ITEM_PREVIEW = 16;
const MAX_CONTAINER_CONFIG_PREVIEW_BYTES = 96 * 1024;
const MAX_CONTAINER_INSTRUCTION_PREVIEW = 16;
const MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW = 12;
const MAX_BUILD_MANIFEST_PREVIEW_BYTES = 128 * 1024;
const MAX_BUILD_MANIFEST_ITEM_PREVIEW = 16;
const MAX_DOTNET_NUGET_CONFIG_PREVIEW_BYTES = 96 * 1024;
const MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW = 16;
const MAX_CPP_BUILD_MANIFEST_PREVIEW_BYTES = 128 * 1024;
const MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW = 16;
const MAX_IAC_PREVIEW_BYTES = 128 * 1024;
const MAX_IAC_BLOCK_PREVIEW = 16;
const MAX_TERRAFORM_PLAN_PREVIEW_BYTES = 192 * 1024;
const MAX_TERRAFORM_PLAN_ITEM_PREVIEW = 16;
const MAX_CLOUD_IAC_TEMPLATE_PREVIEW_BYTES = 192 * 1024;
const MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW = 16;
const MAX_ANSIBLE_PREVIEW_BYTES = 128 * 1024;
const MAX_ANSIBLE_ITEM_PREVIEW = 16;
const MAX_3D_MODEL_PREVIEW_BYTES = 256 * 1024;
const MAX_3D_MODEL_ITEM_PREVIEW = 12;
const MAX_CAD_DRAWING_PREVIEW_BYTES = 192 * 1024;
const MAX_CAD_DRAWING_ITEM_PREVIEW = 16;
const MAX_DIAGRAM_SOURCE_PREVIEW_BYTES = 128 * 1024;
const MAX_DIAGRAM_SOURCE_ITEM_PREVIEW = 16;
const MAX_LOG_PREVIEW_LINES = 8;
const MAX_LOCKFILE_PREVIEW_BYTES = 128 * 1024;
const MAX_LOCKFILE_PACKAGE_PREVIEW = 12;
const MAX_LOCKFILE_EDGE_PREVIEW = 12;
const MAX_SBOM_PROVENANCE_PREVIEW_BYTES = 192 * 1024;
const MAX_SBOM_PROVENANCE_ITEMS = 12;
const MAX_SARIF_PREVIEW_BYTES = 192 * 1024;
const MAX_SARIF_RUN_PREVIEW = 6;
const MAX_SARIF_RESULT_PREVIEW = 12;
const MAX_SARIF_LOCATION_PREVIEW = 12;
const MAX_SECURITY_SCAN_REPORT_PREVIEW_BYTES = 192 * 1024;
const MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW = 16;
const MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES = 128 * 1024;
const MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW = 12;
const MAX_COVERAGE_REPORT_PREVIEW_BYTES = 128 * 1024;
const MAX_COVERAGE_FILE_PREVIEW = 16;
const MAX_COVERAGE_PACKAGE_PREVIEW = 12;
const MAX_TEST_REPORT_PREVIEW_BYTES = 128 * 1024;
const MAX_TEST_REPORT_CASE_PREVIEW = 16;
const MAX_TEST_REPORT_FAILURE_PREVIEW = 8;
const MAX_PYTHON_DEPENDENCY_PREVIEW_BYTES = 128 * 1024;
const MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW = 16;
const MAX_CARGO_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_CARGO_MANIFEST_ITEM_PREVIEW = 16;
const MAX_DART_PUBSPEC_PREVIEW_BYTES = 96 * 1024;
const MAX_DART_PUBSPEC_ITEM_PREVIEW = 16;
const MAX_APPLE_PACKAGE_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW = 16;
const MAX_PHP_RUBY_PACKAGE_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW = 16;
const MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW = 16;
const MAX_GO_MODULE_MANIFEST_PREVIEW_BYTES = 96 * 1024;
const MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW = 16;
const MAX_NODE_PACKAGE_MANIFEST_PREVIEW_BYTES = 128 * 1024;
const MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW = 16;
const MAX_NODE_PACKAGE_MANAGER_CONFIG_PREVIEW_BYTES = 64 * 1024;
const MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW = 16;
const MAX_JVM_BUILD_CONFIG_PREVIEW_BYTES = 64 * 1024;
const MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW = 16;
const MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES = 256 * 1024;
const MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW = 16;
const MAX_REPOSITORY_GOVERNANCE_PREVIEW_BYTES = 96 * 1024;
const MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW = 16;
const MAX_SECURITY_ARTIFACT_PREVIEW_BYTES = 128 * 1024;
const MAX_SECURITY_ARTIFACT_ITEMS = 10;
const MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES = 128 * 1024;
const MAX_WINDOWS_DRIVER_PACKAGE_ITEMS = 16;
const MAX_BINARY_ARTIFACT_PREVIEW_BYTES = 256 * 1024;
const MAX_VIDEO_HEADER_PREVIEW_BYTES = 512 * 1024;
const MAX_STYLESHEET_PREVIEW_BYTES = 96 * 1024;
const MAX_STYLESHEET_ITEM_PREVIEW = 16;
const MAX_SOURCE_CODE_PREVIEW_BYTES = 96 * 1024;
const MAX_PATCH_PREVIEW_BYTES = 128 * 1024;
const MAX_PATCH_FILE_PREVIEW = 16;
const MAX_PATCH_CONFLICT_TARGET_BYTES = 256 * 1024;
const MAX_PATCH_CONTEXT_LINES = 24;
const MAX_POWERSHELL_SCRIPT_PREVIEW_BYTES = 96 * 1024;
const MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW = 16;
const MAX_BATCH_SCRIPT_PREVIEW_BYTES = 96 * 1024;
const MAX_BATCH_SCRIPT_ITEM_PREVIEW = 16;
const MAX_SQL_SCRIPT_PREVIEW_BYTES = 96 * 1024;
const MAX_SOURCE_CODE_SYMBOLS = 18;
const MAX_SOURCE_CODE_INSIGHT_CUES = 8;
const MAX_SQLITE_SCHEMA_SCAN_BYTES = 256 * 1024;
const MAX_SQLITE_SCHEMA_SNIPPETS = 8;
const MAX_MBOX_PREVIEW_MESSAGES = 4;
const MAX_OUTLOOK_MSG_PREVIEW_BYTES = 256 * 1024;
const MAX_OUTLOOK_MSG_STRING_PREVIEW = 12;
const MAX_VCARD_CONTACTS = 6;
const MAX_VCARD_FIELD_PREVIEW = 18;
const MAX_ICS_EVENT_PREVIEW = 8;
const MAX_FONT_PREVIEW_BYTES = 256 * 1024;
const MAX_FONT_NAME_RECORDS = 8;
const MAX_ARCHIVE_PREVIEW_BYTES = 1024 * 1024;
const MAX_ARCHIVE_HEADER_PREVIEW_BYTES = 4096;
const MAX_COMPRESSED_TAR_PREVIEW_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_COMPRESSED_TAR_PREVIEW_OUTPUT_BYTES = 1024 * 1024;
const MAX_ARCHIVE_PREVIEW_ENTRIES = 18;
const MAX_NESTED_ARCHIVE_PREVIEW_ENTRIES = 4;
const MAX_NESTED_ARCHIVE_PREVIEW_INPUT_BYTES = 384 * 1024;
const MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES = 512 * 1024;
const MAX_NESTED_ARCHIVE_INSPECTION_DEPTH = 2;
const NESTED_ARCHIVE_EXTENSIONS = new Set([
  ".7z",
  ".bz2",
  ".gz",
  ".rar",
  ".tar",
  ".tar.gz",
  ".tbz",
  ".tbz2",
  ".tgz",
  ".txz",
  ".xz",
  ".zip",
]);
const MAX_GITHUB_SNAPSHOT_BYTES = 64 * 1024;
const DEFAULT_GITHUB_SNAPSHOT_RELATIVE_PATH = join(".drsai", "github-context.json");
const MAX_CONNECTOR_SNAPSHOT_BYTES = 64 * 1024;
const DEFAULT_SLACK_SNAPSHOT_RELATIVE_PATH = join(".drsai", "slack-context.json");
const DEFAULT_DOCS_SNAPSHOT_RELATIVE_PATH = join(".drsai", "docs-context.json");
const DEFAULT_CALENDAR_SNAPSHOT_RELATIVE_PATH = join(".drsai", "calendar-context.json");
const DEFAULT_CALENDAR_ICS_RELATIVE_PATH = join(".drsai", "calendar-context.ics");
const DEFAULT_DATABASE_SNAPSHOT_RELATIVE_PATH = join(".drsai", "database-context.json");
const DEFAULT_DATABASE_SQL_SCHEMA_RELATIVE_PATH = join(".drsai", "database-schema.sql");
const DEFAULT_MOBILE_SNAPSHOT_RELATIVE_PATH = join(".drsai", "mobile-context.json");
const DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH = join(".drsai", "voice-context.json");
const DEFAULT_LOG_MONITOR_CONFIG_RELATIVE_PATH = join(".drsai", "log-monitor.json");
const SNAPSHOT_SYNC_ADAPTER_IDS = [
  "mobile-chat",
  "slack-chat",
  "github-connector",
  "docs-connector",
  "calendar-connector",
  "database-connector",
  "logs-monitor",
];
const MAX_MOBILE_CHAT_SNAPSHOT_BYTES = 64 * 1024;
const MAX_VOICE_TRANSCRIPT_BYTES = 32 * 1024;
const MAX_DATABASE_SNAPSHOT_BYTES = 96 * 1024;
const MAX_LOG_MONITOR_CONFIG_BYTES = 32 * 1024;
const MAX_LOG_MONITOR_DELTA_BYTES = 64 * 1024;
const MAX_LOG_MONITOR_LINES = 24;
const MAX_OUTBOUND_TARGET_LENGTH = 240;
const MAX_OUTBOUND_SUBJECT_LENGTH = 160;
const MAX_OUTBOUND_BODY_LENGTH = 4000;
const MAX_CONNECTION_LABEL_LENGTH = 160;
const CONNECTOR_AUTH_EXPIRY_MINUTES = 15;
const CHANNEL_CONNECTIONS_FILE = join(DRSAI_HOME, "desktop", "channel-connections.json");
const CHANNEL_DELIVERIES_FILE = join(DRSAI_HOME, "desktop", "channel-deliveries.json");
const CHANNEL_INBOUND_EVENTS_FILE = join(DRSAI_HOME, "desktop", "channel-inbound-events.json");
const CHANNEL_LOG_CURSORS_FILE = join(DRSAI_HOME, "desktop", "channel-log-cursors.json");
const DEFAULT_CHANNEL_OUTBOX_CONFIG_RELATIVE_PATH = join(".drsai", "channel-outbox.json");
const DEFAULT_CHANNEL_OUTBOX_RELATIVE_PATH = join(".drsai", "channel-outbox-deliveries.jsonl");
const MAX_CHANNEL_OUTBOX_CONFIG_BYTES = 16 * 1024;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_DELIVERIES_PER_WORKSPACE = 80;
const MAX_INBOUND_EVENTS_PER_WORKSPACE = 80;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "release",
  ".pnpm-store",
  "venv",
  "__pycache__",
]);

const IMPORTABLE_EXTENSIONS = new Set([
  ".7z",
  ".ansible-inventory",
  ".aab",
  ".apk",
  ".bat",
  ".bash",
  ".bicep",
  ".bicepparam",
  ".blg",
  ".bru",
  ".c",
  ".cabal",
  ".cat",
  ".cc",
  ".checkstyle.xml",
  ".cjs",
  ".cmd",
  ".cmake",
  ".cmakelists.txt",
  ".codeowners",
  ".cloudformation.json",
  ".cloudformation.yaml",
  ".compile_commands.json",
  ".composer.json",
  ".cpp",
  ".cfg",
  ".cs",
  ".csproj",
  ".css",
  ".csv",
  ".arrow",
  ".dart",
  ".db",
  ".dmp",
  ".dotnet-global.json",
  ".dockerfile",
  ".dockerignore",
  ".doc",
  ".docm",
  ".docx",
  ".dot",
  ".drawio",
  ".dll",
  ".dwg",
  ".dxf",
  ".eml",
  ".epub",
  ".etl",
  ".evtx",
  ".editorconfig",
  ".asc",
  ".androidmanifest.xml",
  ".appx",
  ".appxmanifest",
  ".appxbundle",
  ".arm-template.json",
  ".atom",
  ".attestation",
  ".attestation.json",
  ".cer",
  ".cdx.json",
  ".checksum",
  ".crt",
  ".der",
  ".fsproj",
  ".feather",
  ".flac",
  ".go",
  ".geojson",
  ".gemfile",
  ".gemspec",
  ".gif",
  ".glb",
  ".gltf",
  ".go.mod",
  ".go.work",
  ".gv",
  ".gql",
  ".gpx",
  ".h5",
  ".helm-chart.yaml",
  ".gradle",
  ".gradle.kts",
  ".gradle.properties",
  ".gitattributes",
  ".gitignore",
  ".graphql",
  ".env",
  ".exe",
  ".htm",
  ".html",
  ".h",
  ".hpp",
  ".http",
      ".ini",
  ".inf",
  ".info.plist",
      ".intoto.jsonl",
  ".ipynb",
  ".ipa",
  ".ical",
  ".ics",
      ".ico",
      ".jar",
      ".war",
      ".ear",
      ".class",
      ".java",
  ".junit.xml",
  ".lighthouse.json",
  ".test-results.json",
  ".trace.json",
  ".js",
  ".jsx",
  ".key",
  ".kml",
  ".jpeg",
  ".jvm.config",
  ".jpg",
  ".bmp",
  ".less",
  ".license",
  ".lcov",
  ".log",
  ".lock",
  ".lnk",
  ".lua",
  ".gz",
  ".makefile",
  ".har",
  ".hdf5",
  ".hcl",
  ".hdmp",
  ".mix.exs",
  ".mix.lock",
  ".mjs",
  ".man",
  ".maven.config",
  ".msi",
  ".msix",
  ".msixbundle",
  ".mkv",
  ".mov",
  ".mp4",
  ".mp3",
  ".m4a",
  ".m4v",
  ".mermaid",
  ".json",
  ".jsonl",
  ".kt",
  ".kustomization.yaml",
  ".kts",
  ".markdown",
  ".md",
  ".mmd",
  ".m",
  ".mat",
  ".mm",
  ".mdmp",
  ".mhtml",
  ".mbox",
  ".metrics",
  ".msg",
  ".nc",
  ".ndjson",
  ".notice",
  ".nuget.config",
  ".npmignore",
  ".npmrc",
  ".nuspec",
  ".odp",
  ".ods",
  ".odt",
  ".ogg",
  ".otf",
  ".obj",
  ".openmetrics",
  ".patch",
  ".parquet",
  ".pcap",
  ".pcapng",
  ".pem",
  ".package.yaml",
  ".packages.config",
  ".pipfile",
  ".pdf",
  ".php",
  ".podfile",
  ".podfile.lock",
  ".podspec",
  ".ppt",
  ".pptm",
  ".png",
  ".pptx",
  ".prom",
  ".proto",
  ".ps1",
  ".psd1",
  ".psm1",
  ".pubspec.lock",
  ".pubspec.yaml",
  ".puml",
  ".plantuml",
  ".pnpmfile.cjs",
  ".pmd.xml",
  ".py",
  ".rb",
  ".rar",
  ".rest",
  ".reg",
  ".diff",
  ".rss",
  ".robots.txt",
  ".r",
  ".rs",
  ".rtf",
  ".sass",
  ".sarif",
  ".sarif.json",
  ".scss",
  ".security-audit.json",
  ".sh",
  ".sha1",
  ".sha256",
  ".sha512",
  ".sig",
  ".sln",
  ".sitemap.xml",
  ".sitemap.xml.gz",
  ".sql",
  ".stack.yaml",
  ".scala",
      ".spdx",
      ".spdx.json",
      ".syft.json",
      ".spotbugs.xml",
  ".srt",
  ".stl",
  ".sum",
  ".svg",
  ".swift",
  ".swift-package",
  ".sqlite",
  ".sqlite3",
  ".tap",
  ".tap13",
  ".task",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".props",
  ".tf",
  ".tf.json",
  ".tfplan.json",
  ".tfvars",
  ".toml",
  ".topojson",
  ".trx",
  ".tif",
  ".tiff",
  ".txt",
  ".tsv",
  ".ttf",
  ".targets",
  ".tsx",
  ".ts",
  ".url",
  ".uv.lock",
  ".vcard",
  ".vcf",
  ".vbproj",
  ".vtt",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".webloc",
  ".wer",
  ".woff",
  ".woff2",
  ".wprp",
  ".avi",
  ".xls",
  ".xlsm",
  ".xlsx",
  ".xml",
  ".yaml",
  ".yml",
  ".yarnrc",
  ".yarnrc.yml",
  ".zsh",
  ".zip",
]);

const SOURCE_CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".bat",
  ".bash",
  ".cjs",
  ".cmd",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".m",
  ".mm",
  ".mjs",
  ".php",
  ".ps1",
  ".psd1",
  ".psm1",
  ".py",
  ".rb",
  ".r",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
  ".zsh",
]);

const CHANNEL_ADAPTERS: DesktopChannelAdapter[] = [
  {
    id: "mobile-chat",
    name: "Mobile chat entry",
    provider: "mobile",
    kind: "chat",
    status: "available",
    direction: "bidirectional",
    configured: true,
    requiresApproval: true,
    capabilities: [
      "Import local mobile handoff",
      "Continue desktop threads from phone",
      "Attach mobile context",
    ],
    description: "Mobile entry contract for reviewed phone-originated messages and approval-aware outbound drafts.",
    setupHint: "Local .drsai/mobile-context.json handoff is available now; live device pairing and notification routing remain pending.",
  },
  {
    id: "slack-chat",
    name: "Slack channel adapter",
    provider: "slack",
    kind: "chat",
    status: "config_required",
    direction: "bidirectional",
    configured: false,
    requiresApproval: true,
    capabilities: [
      "Read workspace-local Slack snapshots",
      "Draft replies",
      "Route approvals",
    ],
    description: "Connector contract for Slack conversations, workspace-local message snapshots, and approval-aware outbound drafts.",
    setupHint: "Local .drsai/slack-context.json handoff is available now; live OAuth reads and sends remain pending.",
  },
  {
    id: "github-connector",
    name: "GitHub connector",
    provider: "github",
    kind: "connector",
    status: "config_required",
    direction: "bidirectional",
    configured: false,
    requiresApproval: true,
  capabilities: [
      "Read local Git remote context",
      "Read issue and PR snapshots",
      "Create review context",
      "Open follow-up tasks",
    ],
    description: "Connector contract for repository conversations, PR review, issue triage, read-only local Git remote context, and bounded issue/PR snapshot imports.",
    setupHint: "Use local Git remote now; live OAuth issue/PR sync can hand off a workspace-local .drsai/github-context.json snapshot.",
  },
  {
    id: "docs-connector",
    name: "Docs connector",
    provider: "docs",
    kind: "connector",
    status: "config_required",
    direction: "bidirectional",
    configured: false,
    requiresApproval: true,
    capabilities: [
      "Read selected docs",
      "Read workspace-local doc snapshots",
      "Draft edits",
      "Attach document context",
    ],
    description: "Connector contract for document context, workspace-local doc snapshot imports, and approval-gated edits.",
    setupHint: "Live provider access needs authorization; local handoff can use .drsai/docs-context.json now.",
  },
  {
    id: "calendar-connector",
    name: "Calendar connector",
    provider: "calendar",
    kind: "connector",
    status: "config_required",
    direction: "inbound",
    configured: false,
    requiresApproval: true,
    capabilities: [
      "Summarize agenda",
      "Read workspace-local agenda snapshots",
      "Create task context",
      "Schedule follow-up",
    ],
    description: "Connector contract for meeting context, workspace-local agenda snapshot imports, and scheduled follow-up tasks.",
    setupHint: "Live provider access needs authorization; local handoff can use .drsai/calendar-context.json or .drsai/calendar-context.ics now.",
  },
  {
    id: "database-connector",
    name: "Database snapshot connector",
    provider: "database",
    kind: "connector",
    status: "available",
    direction: "inbound",
    configured: true,
    requiresApproval: false,
    capabilities: [
      "Read workspace-local database snapshots",
      "Attach table and query previews",
      "Review schema context",
    ],
    description: "Connector contract for reviewed database table/query snapshots without live database connections.",
    setupHint: "Local .drsai/database-context.json handoff and heuristic relationship hints are available now; live database connections remain pending.",
  },
  {
    id: "logs-monitor",
    name: "Workspace log monitor",
    provider: "file_upload",
    kind: "connector",
    status: "available",
    direction: "inbound",
    configured: true,
    requiresApproval: false,
    capabilities: [
      "Read workspace-local log monitor config",
      "Import incremental log snapshots",
      "Attach new warning/error context",
    ],
    description: "Connector contract for reviewed workspace-local log deltas using a durable cursor, without starting a live tailing process.",
    setupHint: "Local .drsai/log-monitor.json handoff is available now; live log streaming remains pending.",
  },
  {
    id: "voice-input",
    name: "Voice input",
    provider: "voice",
    kind: "input",
    status: "available",
    direction: "inbound",
    configured: true,
    requiresApproval: false,
    capabilities: [
      "Import local transcript handoff",
      "Transcribe into composer",
      "Attach reviewed transcript",
    ],
    description: "Input adapter contract for local voice prompts and reviewed transcript attachments.",
    setupHint: "Live capture still needs device selection and transcription runtime; local .drsai/voice-context.json handoff is available now.",
  },
  {
    id: "file-input",
    name: "File and image input",
    provider: "file_upload",
    kind: "input",
    status: "available",
    direction: "inbound",
    configured: true,
    requiresApproval: false,
    capabilities: ["Attach files", "Attach folders", "Preview images, audio, video, and documents"],
    description: "Existing visible attachment path for explicit file, folder, image, audio, video, and document context.",
  },
];

interface ChannelConnectionStore {
  workspaces: Record<string, DesktopChannelConnection[]>;
}

interface ChannelDeliveryStore {
  workspaces: Record<string, DesktopChannelOutboundDelivery[]>;
}

interface ChannelInboundEventStore {
  workspaces: Record<string, DesktopChannelInboundEvent[]>;
}

interface ChannelLogCursorEntry {
  path: string;
  relativePath: string;
  offset: number;
  size: number;
  updatedAt: string;
}

interface ChannelLogCursorStore {
  workspaces: Record<string, Record<string, ChannelLogCursorEntry>>;
}

interface LogMonitorTarget {
  path: string;
  label?: string;
}

export function listChannelAdapters(workspacePath?: string): DesktopChannelAdapterListResult {
  const workspaceConnections = workspacePath
    ? listWorkspaceConnections(resolveWorkspacePath(workspacePath))
    : [];
  const adapters = CHANNEL_ADAPTERS.map((adapter) =>
    applyConnectionToAdapter(adapter, workspaceConnections),
  );
  return {
    adapters,
    generatedAt: new Date().toISOString(),
    configuredCount: adapters.filter((adapter) => adapter.configured).length,
    availableCount: adapters.filter((adapter) => adapter.status === "available").length,
  };
}

export function configureChannelAdapter(
  request: DesktopChannelAdapterConfigureRequest,
): DesktopChannelAdapterConfigureResult {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === request.adapterId);
  if (!adapter) {
    throw new Error("Channel adapter was not found.");
  }
  const mode = request.mode || (adapter.id === "github-connector" ? "local_git_remote" : "session_stub");
  if (mode === "session_stub") {
    return configureChannelAdapterSessionStub(adapter, request);
  }
  if (adapter.id !== "github-connector" || adapter.provider !== "github") {
    throw new Error("Only the GitHub connector supports local read-only configuration.");
  }
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const remote = readGitRemote(workspacePath);
  const now = new Date().toISOString();
  const connection: DesktopChannelConnection = {
    adapterId: adapter.id,
    workspacePath,
    provider: adapter.provider,
    mode: "local_git_remote",
    configuredAt: now,
    updatedAt: now,
    accountLabel: remote.owner || "local Git remote",
    scopeLabel: remote.repository || remote.remoteUrl,
    repository: remote.repository,
    remoteUrl: remote.remoteUrl,
    readOnly: true,
  };
  upsertWorkspaceConnection(connection);
  return {
    adapter: applyConnectionToAdapter(adapter, [connection]),
    connection,
    message: remote.repository
      ? `Configured GitHub connector for ${remote.repository} from the local Git remote.`
      : "Configured GitHub connector from the local Git remote.",
    verification:
      "Configuration is workspace-scoped, read-only, and derived from local Git metadata; no network or OAuth call was made.",
  };
}

export function startChannelAdapterAuth(
  request: DesktopChannelAdapterAuthStartRequest,
): DesktopChannelAdapterAuthStartResult {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === request.adapterId);
  if (!adapter) {
    throw new Error("Channel adapter was not found.");
  }
  if (!["mobile", "slack", "github", "docs", "calendar"].includes(adapter.provider)) {
    throw new Error("Channel adapter does not support authorization preparation.");
  }
  if (adapter.id === "file-input" || adapter.id === "voice-input") {
    throw new Error("Input adapters do not use connector authorization.");
  }

  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const now = new Date();
  const preparedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + CONNECTOR_AUTH_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString();
  const scopes = normalizeAuthScopes(adapter, request.scopes);
  const authMode = adapter.provider === "mobile" ? "device_pairing" : "oauth";
  const userCode = buildAuthUserCode(adapter.provider, workspacePath, preparedAt);
  const authTarget = getAuthTarget(adapter.provider);
  const authorizationUrl = `${authTarget.verificationUri}?user_code=${encodeURIComponent(userCode)}`;
  const connection: DesktopChannelConnection = {
    adapterId: adapter.id,
    workspacePath,
    provider: adapter.provider,
    mode: "session_stub",
    configuredAt: preparedAt,
    updatedAt: preparedAt,
    accountLabel: `${adapter.name} authorization pending`,
    scopeLabel: scopes.join(" ") || `${adapter.provider}:workspace`,
    credentialState: "placeholder",
    sessionExpiresAt: expiresAt,
    authPreparedAt: preparedAt,
    readOnly: adapter.direction === "inbound",
  };
  upsertWorkspaceConnection(connection);

  return {
    adapterId: adapter.id,
    provider: adapter.provider,
    workspacePath,
    authMode,
    authorizationUrl,
    userCode,
    verificationUri: authTarget.verificationUri,
    expiresAt,
    intervalSeconds: 5,
    scopes,
    message:
      authMode === "device_pairing"
        ? `Prepared ${adapter.name} device pairing for review.`
        : `Prepared ${adapter.name} OAuth device authorization for review.`,
    verification:
      "Authorization preparation is workspace-scoped metadata only; no browser was opened, no provider network call was made, no token was stored, and connector sends remain approval-gated.",
  };
}

function configureChannelAdapterSessionStub(
  adapter: DesktopChannelAdapter,
  request: DesktopChannelAdapterConfigureRequest,
): DesktopChannelAdapterConfigureResult {
  if (!["slack", "github", "docs", "calendar"].includes(adapter.provider)) {
    throw new Error("Only connector and chat providers support session stub configuration.");
  }
  if (adapter.id === "file-input" || adapter.id === "voice-input") {
    throw new Error("Input adapters do not use provider session configuration.");
  }
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const now = new Date().toISOString();
  const credentialState = normalizeCredentialState(request.credentialState);
  const connection: DesktopChannelConnection = {
    adapterId: adapter.id,
    workspacePath,
    provider: adapter.provider,
    mode: "session_stub",
    configuredAt: now,
    updatedAt: now,
    accountLabel: clampSingleLine(
      request.accountLabel || `${adapter.name} session`,
      MAX_CONNECTION_LABEL_LENGTH,
      "Channel session account label is required.",
    ),
    scopeLabel: clampSingleLine(
      request.scopeLabel || `${adapter.provider}:workspace`,
      MAX_CONNECTION_LABEL_LENGTH,
      "Channel session scope label is required.",
    ),
    credentialState,
    ...(request.sessionExpiresAt
      ? { sessionExpiresAt: clampSingleLine(request.sessionExpiresAt, MAX_CONNECTION_LABEL_LENGTH) }
      : {}),
    readOnly: adapter.direction === "inbound",
  };
  upsertWorkspaceConnection(connection);
  return {
    adapter: applyConnectionToAdapter(adapter, [connection]),
    connection,
    message: `Configured ${adapter.name} session stub for ${connection.scopeLabel}.`,
    verification:
      "Session configuration is workspace-scoped metadata only; no provider OAuth flow, secret storage, network sync, or live send was performed.",
  };
}

export function importChannelContext(
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  if (request.adapterId === "github-connector") {
    return recordChannelContextImport(importGitHubConnectorContext(workspacePath, request));
  }
  if (request.adapterId === "mobile-chat") {
    return recordChannelContextImport(importMobileChatContext(workspacePath, request));
  }
  if (request.adapterId === "slack-chat") {
    return recordChannelContextImport(importSlackChatContext(workspacePath, request));
  }
  if (
    request.adapterId === "docs-connector" ||
    request.adapterId === "calendar-connector" ||
    request.adapterId === "database-connector"
  ) {
    return recordChannelContextImport(importWorkspaceConnectorSnapshotContext(workspacePath, request));
  }
  if (request.adapterId === "voice-input") {
    return recordChannelContextImport(importVoiceTranscriptContext(workspacePath, request));
  }
  if (request.adapterId === "logs-monitor") {
    return recordChannelContextImport(importWorkspaceLogMonitorContext(workspacePath, request));
  }
  if (request.adapterId !== "file-input") {
    throw new Error("Only mobile-chat, slack-chat, file-input, configured GitHub connector, Docs, Calendar, Database, logs-monitor, and voice-input adapters support read-only context import.");
  }
  const limit = clampLimit(request.limit);
  const explicitPaths = normalizeExplicitImportPaths(request.paths);
  const scan = explicitPaths.length > 0
    ? importExplicitFileCandidates(workspacePath, explicitPaths, limit)
    : scanWorkspaceImportCandidates(workspacePath, limit);
  const sourceLabel = explicitPaths.length > 0
    ? "selected file(s)"
    : "the workspace";
  return recordChannelContextImport({
    adapterId: request.adapterId,
    workspacePath,
    importedAt: new Date().toISOString(),
    items: scan.items,
    truncated: scan.truncated,
    message:
      scan.items.length > 0
        ? `Prepared ${scan.items.length} read-only file/image/document context item(s) from ${sourceLabel}.`
        : `No importable file, image, or document context was found in ${sourceLabel}.`,
    verification:
      "Read-only channel import is limited to workspace-local file summaries; send still requires explicit chat context attachment.",
  });
}

export function syncChannelSnapshots(
  request: DesktopChannelSnapshotSyncRequest,
): DesktopChannelSnapshotSyncResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const requestedAdapterIds = normalizeSnapshotSyncAdapterIds(request.adapterIds);
  const limit = clampLimit(request.limit);
  const results: DesktopChannelContextImportResult[] = [];
  const skippedAdapterIds: string[] = [];
  const connections = listWorkspaceConnections(workspacePath);

  for (const adapterId of requestedAdapterIds) {
    try {
      if (
        adapterId === "github-connector" &&
        !connections.some((connection) => connection.adapterId === adapterId)
      ) {
        skippedAdapterIds.push(adapterId);
        continue;
      }
      const importRequest: DesktopChannelContextImportRequest = {
        adapterId,
        workspacePath,
        limit,
      };
      const result =
        adapterId === "github-connector"
          ? importGitHubConnectorContext(workspacePath, importRequest)
          : adapterId === "mobile-chat"
            ? importMobileChatContext(workspacePath, importRequest)
            : adapterId === "slack-chat"
              ? importSlackChatContext(workspacePath, importRequest)
              : adapterId === "logs-monitor"
                ? importWorkspaceLogMonitorContext(workspacePath, importRequest)
                : importWorkspaceConnectorSnapshotContext(workspacePath, importRequest);
      results.push(
        recordChannelContextImport(result, {
          stableEventId: true,
        }),
      );
    } catch {
      skippedAdapterIds.push(adapterId);
    }
  }

  const queuedEventCount = results.filter((result) => result.items.length > 0).length;
  return {
    workspacePath,
    syncedAt: new Date().toISOString(),
    adapterIds: requestedAdapterIds,
    results,
    queuedEventCount,
    skippedAdapterIds,
    message:
      queuedEventCount > 0
        ? `Synced ${queuedEventCount} workspace-local connector snapshot(s) into the inbound channel queue.`
        : "No workspace-local connector snapshot updates were found.",
    verification:
      "Snapshot sync only polls bounded workspace-local handoff files and records reviewed inbound events; no OAuth flow, secret access, provider network call, or outbound send is performed.",
  };
}

export function listChannelInboundEvents(
  request?: DesktopChannelInboundEventListRequest,
): DesktopChannelInboundEvent[] {
  const limit = clampInboundEventLimit(request?.limit);
  const store = readChannelInboundEventStore();
  const events = request?.workspacePath
    ? store.workspaces[workspaceKey(resolveWorkspacePath(request.workspacePath))] ?? []
    : Object.values(store.workspaces)
        .flat()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return events
    .filter((event) => !request?.status || event.status === request.status)
    .slice(0, limit);
}

export function routeChannelInboundEvent(
  request: DesktopChannelInboundEventRouteRequest,
): DesktopChannelInboundEventRouteResult {
  const eventId = clampSingleLine(request.eventId, MAX_CONNECTION_LABEL_LENGTH, "Inbound event id is required.");
  const action = request.action === "dismiss" ? "dismiss" : "route_to_chat";
  const store = readChannelInboundEventStore();
  const workspacePath = request.workspacePath ? resolveWorkspacePath(request.workspacePath) : null;
  for (const [key, events] of Object.entries(store.workspaces)) {
    if (workspacePath && key !== workspaceKey(workspacePath)) continue;
    const index = events.findIndex((event) => event.id === eventId);
    if (index < 0) continue;
    const now = new Date().toISOString();
    const updated: DesktopChannelInboundEvent = {
      ...events[index],
      status: action === "dismiss" ? "dismissed" : "routed",
      updatedAt: now,
    };
    store.workspaces[key] = [
      updated,
      ...events.filter((_, eventIndex) => eventIndex !== index),
    ].slice(0, MAX_INBOUND_EVENTS_PER_WORKSPACE);
    writeChannelInboundEventStore(store);
    return {
      event: updated,
      importResult: inboundEventToImportResult(updated),
      message:
        action === "dismiss"
          ? `${updated.title} was dismissed from the inbound channel queue.`
          : `${updated.title} was routed to the chat context handoff.`,
      verification:
        action === "dismiss"
          ? "Dismiss only updates the local inbound event ledger; no provider action is performed."
          : "Routing reuses the reviewed channel context handoff and does not call external providers.",
    };
  }
  throw new Error("Channel inbound event was not found.");
}

export function createChannelOutboundDraftApproval(
  request: DesktopChannelOutboundDraftRequest,
): DesktopApprovalProposalRequest {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === request.adapterId);
  if (!adapter) {
    throw new Error("Channel adapter was not found.");
  }
  if (adapter.id === "file-input" || adapter.direction === "inbound") {
    throw new Error("Channel adapter does not support outbound drafts.");
  }
  if (!adapter.requiresApproval) {
    throw new Error("Outbound channel drafts must use an approval-gated adapter.");
  }
  const target = clampSingleLine(
    request.target,
    MAX_OUTBOUND_TARGET_LENGTH,
    "Outbound target is required.",
  );
  const body = clampMultiline(
    request.body,
    MAX_OUTBOUND_BODY_LENGTH,
    "Outbound draft body is required.",
  );
  const subject = request.subject
    ? clampSingleLine(request.subject, MAX_OUTBOUND_SUBJECT_LENGTH)
    : undefined;
  return {
    source: "connector",
    actionKind: "external.service",
    title: `Send ${adapter.name} draft`,
    detail: [
      `Adapter: ${adapter.name} (${adapter.provider})`,
      `Target: ${target}`,
      subject ? `Subject: ${subject}` : null,
      "",
      body,
      "",
      "Approval only releases this draft to the connector runtime; live sending still requires configured provider credentials.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    target,
    risk: "high",
    idempotencyKey:
      request.idempotencyKey?.trim() ||
      [
        "channel-outbound",
        adapter.id,
        hashApprovalPart(target),
        hashApprovalPart(body),
      ].join(":"),
  };
}

export function executeChannelOutboundDelivery(
  request: DesktopChannelOutboundDraftRequest,
  approvalId: string,
  approved: boolean,
): DesktopChannelOutboundDelivery {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === request.adapterId);
  if (!adapter) {
    throw new Error("Channel adapter was not found.");
  }
  if (adapter.id === "file-input" || adapter.direction === "inbound") {
    throw new Error("Channel adapter does not support outbound delivery.");
  }
  const target = clampSingleLine(
    request.target,
    MAX_OUTBOUND_TARGET_LENGTH,
    "Outbound target is required.",
  );
  const subject = request.subject
    ? clampSingleLine(request.subject, MAX_OUTBOUND_SUBJECT_LENGTH)
    : undefined;
  const body = clampMultiline(
    request.body,
    MAX_OUTBOUND_BODY_LENGTH,
    "Outbound draft body is required.",
  );
  const workspacePath = request.workspacePath
    ? resolveWorkspacePath(request.workspacePath)
    : undefined;
  const now = new Date().toISOString();
  const baseDelivery: DesktopChannelOutboundDelivery = {
    id: `channel-delivery:${hashApprovalPart(approvalId)}:${hashApprovalPart(target)}`,
    approvalId,
    adapterId: adapter.id,
    provider: adapter.provider,
    ...(workspacePath ? { workspacePath } : {}),
    target,
    ...(subject ? { subject } : {}),
    status: approved ? "blocked" : "rejected",
    runtime: "missing_live_provider",
    createdAt: now,
    updatedAt: now,
    message: approved
      ? `${adapter.name} draft was approved but live provider credentials/runtime are not configured.`
      : `${adapter.name} draft was rejected in Approval Center.`,
    verification: approved
      ? "Approval reached the connector runtime boundary; no network send was performed because live OAuth/session support is not configured yet."
      : "Rejected connector drafts are recorded for audit and are not sent.",
  };
  const delivery =
    approved && workspacePath
      ? executeWorkspaceLocalOutboxDelivery({
          adapter,
          baseDelivery,
          body,
          workspacePath,
        })
      : baseDelivery;
  appendChannelDelivery(delivery);
  return delivery;
}

export function listChannelOutboundDeliveries(
  request?: DesktopChannelOutboundDeliveryListRequest,
): DesktopChannelOutboundDelivery[] {
  const limit = clampDeliveryLimit(request?.limit);
  const store = readChannelDeliveryStore();
  if (request?.workspacePath) {
    const workspacePath = resolveWorkspacePath(request.workspacePath);
    return (store.workspaces[workspaceKey(workspacePath)] ?? []).slice(0, limit);
  }
  return Object.values(store.workspaces)
    .flat()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

interface WorkspaceLocalOutboxConfig {
  enabled: boolean;
  outboxPath: string;
  allowedAdapters?: string[];
}

function executeWorkspaceLocalOutboxDelivery({
  adapter,
  baseDelivery,
  body,
  workspacePath,
}: {
  adapter: DesktopChannelAdapter;
  baseDelivery: DesktopChannelOutboundDelivery;
  body: string;
  workspacePath: string;
}): DesktopChannelOutboundDelivery {
  try {
    const config = readWorkspaceLocalOutboxConfig(workspacePath);
    if (!config?.enabled) return baseDelivery;
    if (
      config.allowedAdapters &&
      config.allowedAdapters.length > 0 &&
      !config.allowedAdapters.includes(adapter.id)
    ) {
      return {
        ...baseDelivery,
        status: "blocked",
        runtime: "workspace_local_outbox",
        message: `${adapter.name} draft was approved but the workspace-local outbox does not allow this adapter.`,
        verification:
          "Approved connector draft was not written because .drsai/channel-outbox.json restricts allowedAdapters; no network send was performed.",
      };
    }
    const outboxPath = resolveWorkspaceLocalOutboxPath(workspacePath, config.outboxPath);
    appendWorkspaceLocalOutboxRecord(outboxPath, {
      id: baseDelivery.id,
      approvalId: baseDelivery.approvalId,
      adapterId: adapter.id,
      provider: adapter.provider,
      workspacePath,
      target: baseDelivery.target,
      ...(baseDelivery.subject ? { subject: baseDelivery.subject } : {}),
      body,
      createdAt: baseDelivery.createdAt,
      verification:
        "Written after Approval Center approval to a workspace-local JSONL outbox; no provider API or network send was performed.",
    });
    return {
      ...baseDelivery,
      status: "sent",
      runtime: "workspace_local_outbox",
      outboxPath,
      message: `${adapter.name} draft was approved and written to the workspace-local channel outbox.`,
      verification:
        "Approved connector draft was appended to the workspace-local outbox JSONL for external review/relay; no OAuth flow, provider API call, or network send was performed.",
    };
  } catch (error) {
    return {
      ...baseDelivery,
      status: "failed",
      runtime: "workspace_local_outbox",
      message:
        error instanceof Error
          ? error.message
          : "Workspace-local channel outbox delivery failed.",
      verification:
        "Approved connector draft reached the local outbox runtime but was not written; no provider API or network send was performed.",
    };
  }
}

function readWorkspaceLocalOutboxConfig(
  workspacePath: string,
): WorkspaceLocalOutboxConfig | null {
  const configPath = resolve(workspacePath, DEFAULT_CHANNEL_OUTBOX_CONFIG_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, configPath) || !existsSync(configPath)) {
    return null;
  }
  const stats = lstatSync(configPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Workspace-local channel outbox config must be a regular workspace file.");
  }
  if (stats.size > MAX_CHANNEL_OUTBOX_CONFIG_BYTES) {
    throw new Error("Workspace-local channel outbox config is too large.");
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
    enabled?: unknown;
    outboxPath?: unknown;
    allowedAdapters?: unknown;
  };
  const allowedAdapters = Array.isArray(parsed.allowedAdapters)
    ? parsed.allowedAdapters
        .filter((adapterId): adapterId is string => typeof adapterId === "string")
        .map((adapterId) => adapterId.trim())
        .filter(Boolean)
        .slice(0, 12)
    : undefined;
  return {
    enabled: parsed.enabled === true,
    outboxPath:
      typeof parsed.outboxPath === "string" && parsed.outboxPath.trim()
        ? parsed.outboxPath.trim()
        : DEFAULT_CHANNEL_OUTBOX_RELATIVE_PATH,
    ...(allowedAdapters && allowedAdapters.length > 0 ? { allowedAdapters } : {}),
  };
}

function resolveWorkspaceLocalOutboxPath(
  workspacePath: string,
  outboxPath: string,
): string {
  const resolved = resolve(workspacePath, outboxPath);
  if (!isInsideWorkspace(workspacePath, resolved)) {
    throw new Error("Workspace-local channel outbox path must stay inside the workspace.");
  }
  if (existsSync(resolved)) {
    const stats = lstatSync(resolved);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Workspace-local channel outbox target must be a regular file.");
    }
  }
  return resolved;
}

function appendWorkspaceLocalOutboxRecord(
  outboxPath: string,
  record: Record<string, unknown>,
): void {
  mkdirSync(dirname(outboxPath), { recursive: true });
  appendFileSync(outboxPath, `${JSON.stringify(record)}\n`, "utf8");
}

function applyConnectionToAdapter(
  adapter: DesktopChannelAdapter,
  connections: DesktopChannelConnection[],
): DesktopChannelAdapter {
  const connection = connections.find((item) => item.adapterId === adapter.id);
  if (!connection) {
    return { ...adapter, authMode: "not_configured" };
  }
  return {
    ...adapter,
    status: "available",
    configured: true,
    authMode: connection.mode,
    accountLabel: connection.accountLabel,
    scopeLabel: connection.scopeLabel,
    configuredAt: connection.configuredAt,
    lastImportAt: connection.lastImportAt,
    credentialState: connection.credentialState,
    sessionExpiresAt: connection.sessionExpiresAt,
    authPreparedAt: connection.authPreparedAt,
  };
}

function importGitHubConnectorContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const connection = listWorkspaceConnections(workspacePath).find(
    (item) => item.adapterId === "github-connector",
  );
  if (!connection) {
    throw new Error("GitHub connector must be configured before read-only context import.");
  }
  const branch = readGitValue(workspacePath, ["branch", "--show-current"]) || "detached";
  const head = readGitValue(workspacePath, ["rev-parse", "--short", "HEAD"]) || "unknown";
  const status = readGitValue(workspacePath, ["status", "--short"]) || "clean";
  const log = readGitValue(workspacePath, [
    "log",
    "--oneline",
    "--decorate=short",
    "-5",
  ]);
  const repository = connection.repository || connection.scopeLabel;
  const summary = [
    `Repository: ${repository}`,
    `Remote: ${connection.remoteUrl || "local Git remote"}`,
    `Branch: ${branch}`,
    `HEAD: ${head}`,
    "",
    "Recent commits:",
    log || "No recent commits were available.",
    "",
    "Workspace status:",
    status,
  ].join("\n");
  const importedAt = new Date().toISOString();
  touchWorkspaceConnectionImport(connection, importedAt);
  const limit = clampLimit(request.limit);
  const snapshot = readGitHubSnapshotContext(workspacePath, request, limit - 1);
  const items: DesktopChannelContextItem[] = [
    {
      id: `github-connector:${hashApprovalPart(workspacePath)}:${hashApprovalPart(repository)}`,
      adapterId: "github-connector",
      provider: "github" as const,
      kind: "file" as const,
      title: repository,
      path: `${workspacePath}${sep}.git`,
      relativePath: repository,
      summary: summary.slice(0, MAX_TEXT_BYTES),
      mime: "text/plain",
      truncated: summary.length > MAX_TEXT_BYTES,
    },
    ...snapshot.items,
  ].slice(0, limit);
  return {
    adapterId: request.adapterId,
    workspacePath,
    importedAt,
    items,
    truncated: snapshot.truncated || items.length >= limit,
    message:
      snapshot.items.length > 0
        ? `Prepared read-only GitHub connector context for ${repository} with ${snapshot.items.length} issue/PR snapshot item(s).`
        : `Prepared read-only GitHub connector context for ${repository}.`,
    verification:
      snapshot.items.length > 0
        ? "GitHub connector import reads local Git metadata plus a bounded workspace-local issue/PR snapshot; no network or provider send was performed."
        : "GitHub connector import reads local Git metadata only; live issue/PR sync remains gated behind future OAuth configuration.",
  };
}

function readGitHubSnapshotContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  if (limit <= 0) return { items: [], truncated: true };
  const snapshotPath = resolveGitHubSnapshotPath(workspacePath, request.githubSnapshotPath);
  if (!snapshotPath) return { items: [], truncated: false };
  let stats;
  try {
    const linkStats = lstatSync(snapshotPath);
    if (linkStats.isSymbolicLink()) return { items: [], truncated: false };
    stats = statSync(snapshotPath);
  } catch {
    return { items: [], truncated: false };
  }
  if (!stats.isFile() || stats.size > MAX_GITHUB_SNAPSHOT_BYTES) {
    return { items: [], truncated: stats.size > MAX_GITHUB_SNAPSHOT_BYTES };
  }
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return normalizeGitHubSnapshotItems(workspacePath, snapshotPath, parsed, limit);
  } catch {
    return { items: [], truncated: false };
  }
}

function resolveGitHubSnapshotPath(
  workspacePath: string,
  requestedPath?: string,
): string | null {
  const candidatePath = requestedPath?.trim()
    ? resolve(workspacePath, requestedPath.trim())
    : resolve(workspacePath, DEFAULT_GITHUB_SNAPSHOT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, candidatePath)) return null;
  if (!existsSync(candidatePath)) return null;
  return candidatePath;
}

function normalizeGitHubSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getGitHubSnapshotRecords(parsed);
  const items = records
    .map((record, index) =>
      createGitHubSnapshotItem(workspacePath, snapshotPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return {
    items,
    truncated: records.length > items.length,
  };
}

function getGitHubSnapshotRecords(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  const combined = [
    ...readSnapshotArray(record.items),
    ...readSnapshotArray(record.issues).map((item) => ({ ...(item as object), type: "issue" })),
    ...readSnapshotArray(record.pullRequests).map((item) => ({
      ...(item as object),
      type: "pull_request",
    })),
    ...readSnapshotArray(record.pull_requests).map((item) => ({
      ...(item as object),
      type: "pull_request",
    })),
    ...readSnapshotArray(record.prs).map((item) => ({ ...(item as object), type: "pull_request" })),
  ];
  return combined;
}

function readSnapshotArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function createGitHubSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const rawType = getSnapshotString(item, "type").toLowerCase();
  const kind =
    rawType === "pull_request" || rawType === "pr"
      ? "pull_request"
      : rawType === "issue"
        ? "issue"
        : null;
  if (!kind) return null;
  const number = getSnapshotNumber(item, "number");
  const title = clampSingleLine(
    getSnapshotString(item, "title") || `${kind === "issue" ? "Issue" : "PR"} ${index + 1}`,
    240,
  );
  const state = getSnapshotString(item, "state") || "unknown";
  const author = getSnapshotString(item, "author") || getSnapshotString(item, "user");
  const labels = getSnapshotLabels(item.labels);
  const url = getSnapshotString(item, "url") || getSnapshotString(item, "html_url");
  const updatedAt = getSnapshotString(item, "updatedAt") || getSnapshotString(item, "updated_at");
  const body = clampMultiline(
    getSnapshotString(item, "body") || getSnapshotString(item, "summary") || "No snapshot body was provided.",
    MAX_TEXT_BYTES,
    "GitHub snapshot body is required.",
  );
  const labelLine = labels.length > 0 ? `Labels: ${labels.join(", ")}` : "";
  const summary = [
    `${kind === "issue" ? "Issue" : "Pull request"}${number ? ` #${number}` : ""}: ${title}`,
    `State: ${state}`,
    author ? `Author: ${author}` : "",
    updatedAt ? `Updated: ${updatedAt}` : "",
    url ? `URL: ${url}` : "",
    labelLine,
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = number ? `${kind}-${number}` : `${kind}-${index + 1}`;
  return {
    id: `github-connector:${suffix}`,
    adapterId: "github-connector",
    provider: "github" as const,
    kind,
    title: `${kind === "issue" ? "Issue" : "PR"}${number ? ` #${number}` : ""}: ${title}`,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: "application/json",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function getSnapshotString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function getSnapshotNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function getSnapshotLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => {
      if (typeof label === "string") return label.trim();
      if (label && typeof label === "object") {
        const named = (label as { name?: unknown }).name;
        return typeof named === "string" ? named.trim() : "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 12);
}

function importWorkspaceConnectorSnapshotContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === request.adapterId);
  if (
    !adapter ||
    (
      adapter.id !== "docs-connector" &&
      adapter.id !== "calendar-connector" &&
      adapter.id !== "database-connector"
    )
  ) {
    throw new Error("Unsupported workspace connector snapshot adapter.");
  }
  const limit = clampLimit(request.limit);
  const snapshot = readWorkspaceConnectorSnapshotContext(workspacePath, request, limit);
  const label =
    adapter.provider === "docs"
      ? "Docs"
      : adapter.provider === "calendar"
        ? "Calendar"
        : "Database";
  return {
    adapterId: request.adapterId,
    workspacePath,
    importedAt: new Date().toISOString(),
    items: snapshot.items,
    truncated: snapshot.truncated,
    message:
      snapshot.items.length > 0
        ? `Prepared ${snapshot.items.length} read-only ${label} snapshot context item(s).`
        : `No workspace-local ${label} snapshot context was found.`,
    verification:
      snapshot.items.length > 0
        ? adapter.id === "database-connector"
          ? "Database connector import reads a bounded workspace-local snapshot and local heuristic schema relationship hints; no database connection, credentials, SQL execution, network call, external schema inference service, or provider send was performed."
          : `${label} connector import reads a bounded workspace-local snapshot; no network or provider send was performed.`
        : adapter.id === "database-connector"
          ? "Live database connections are still pending; local database snapshot handoff and heuristic relationship hints remain optional and read-only."
          : `${label} live OAuth/session sync is still pending; local snapshot handoff remains optional and read-only.`,
  };
}

function readWorkspaceConnectorSnapshotContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const adapterId = request.adapterId;
  const snapshotPath = resolveWorkspaceConnectorSnapshotPath(workspacePath, request);
  if (!snapshotPath) return { items: [], truncated: false };
  let stats;
  try {
    const linkStats = lstatSync(snapshotPath);
    if (linkStats.isSymbolicLink()) return { items: [], truncated: false };
    stats = statSync(snapshotPath);
  } catch {
    return { items: [], truncated: false };
  }
  const maxBytes =
    adapterId === "database-connector"
      ? MAX_DATABASE_SNAPSHOT_BYTES
      : MAX_CONNECTOR_SNAPSHOT_BYTES;
  if (!stats.isFile() || stats.size > maxBytes) {
    return { items: [], truncated: stats.size > maxBytes };
  }
  try {
    if (adapterId === "calendar-connector" && extname(snapshotPath).toLowerCase() === ".ics") {
      return normalizeCalendarIcsSnapshotItems(
        workspacePath,
        snapshotPath,
        readFileSync(snapshotPath, "utf8"),
        limit,
      );
    }
    if (adapterId === "database-connector" && extname(snapshotPath).toLowerCase() === ".sql") {
      return normalizeDatabaseSqlSchemaItems(
        workspacePath,
        snapshotPath,
        readFileSync(snapshotPath, "utf8"),
        limit,
      );
    }
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    if (adapterId === "docs-connector") {
      return normalizeDocsSnapshotItems(workspacePath, snapshotPath, parsed, limit);
    }
    if (adapterId === "calendar-connector") {
      return normalizeCalendarSnapshotItems(workspacePath, snapshotPath, parsed, limit);
    }
    if (adapterId === "database-connector") {
      return normalizeDatabaseSnapshotItems(workspacePath, snapshotPath, parsed, limit);
    }
    return { items: [], truncated: false };
  } catch {
    return { items: [], truncated: false };
  }
}

function resolveWorkspaceConnectorSnapshotPath(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): string | null {
  const defaultRelativePath =
    request.adapterId === "docs-connector"
      ? DEFAULT_DOCS_SNAPSHOT_RELATIVE_PATH
      : request.adapterId === "calendar-connector"
        ? DEFAULT_CALENDAR_SNAPSHOT_RELATIVE_PATH
        : request.adapterId === "database-connector"
          ? DEFAULT_DATABASE_SNAPSHOT_RELATIVE_PATH
          : "";
  if (!defaultRelativePath) return null;
  const requestedPath = request.snapshotPath?.trim();
  const candidatePath = requestedPath
    ? resolve(workspacePath, requestedPath)
    : resolve(workspacePath, defaultRelativePath);
  if (!isInsideWorkspace(workspacePath, candidatePath)) return null;
  if (!existsSync(candidatePath)) {
    if (requestedPath) return null;
    if (request.adapterId === "calendar-connector") {
      const icsPath = resolve(workspacePath, DEFAULT_CALENDAR_ICS_RELATIVE_PATH);
      if (!isInsideWorkspace(workspacePath, icsPath) || !existsSync(icsPath)) return null;
      return icsPath;
    }
    if (request.adapterId === "database-connector") {
      const sqlPath = resolve(workspacePath, DEFAULT_DATABASE_SQL_SCHEMA_RELATIVE_PATH);
      if (!isInsideWorkspace(workspacePath, sqlPath) || !existsSync(sqlPath)) return null;
      return sqlPath;
    }
    return null;
  }
  return candidatePath;
}

function importWorkspaceLogMonitorContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const limit = clampLimit(request.limit);
  const allTargets = resolveLogMonitorTargets(workspacePath, request);
  const targets = allTargets.slice(0, limit);
  const cursorStore = readChannelLogCursorStore();
  const workspaceCursorKey = workspaceKey(workspacePath);
  const cursors = cursorStore.workspaces[workspaceCursorKey] ?? {};
  const now = new Date().toISOString();
  const items: DesktopChannelContextItem[] = [];
  let truncated = allTargets.length > targets.length;

  for (const target of targets) {
    const item = createLogMonitorDeltaItem(workspacePath, target, cursors, now);
    if (item) {
      items.push(item.item);
      cursors[item.cursor.relativePath] = item.cursor;
      truncated = truncated || item.truncated;
    }
  }

  cursorStore.workspaces[workspaceCursorKey] = cursors;
  writeChannelLogCursorStore(cursorStore);

  return {
    adapterId: "logs-monitor",
    workspacePath,
    importedAt: now,
    items,
    truncated,
    message:
      items.length > 0
        ? `Prepared ${items.length} reviewed workspace log delta context item(s).`
        : "No workspace-local log monitor targets were found.",
    verification:
      "Logs monitor import reads bounded workspace-local log deltas with a durable cursor; no tailing process, command execution, credential lookup, network call, external log service, or provider send was performed.",
  };
}

function resolveLogMonitorTargets(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): LogMonitorTarget[] {
  const explicitPaths = normalizeExplicitImportPaths(
    request.paths && request.paths.length > 0
      ? request.paths
      : [
          request.logMonitorPath || "",
          request.snapshotPath || "",
        ].filter(Boolean),
  );
  if (explicitPaths.length > 0) {
    return explicitPaths
      .map((targetPath) => normalizeLogMonitorTarget(workspacePath, targetPath))
      .filter((target): target is LogMonitorTarget => Boolean(target));
  }

  const configPath = resolve(workspacePath, DEFAULT_LOG_MONITOR_CONFIG_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, configPath) || !existsSync(configPath)) return [];
  try {
    const linkStats = lstatSync(configPath);
    const stats = statSync(configPath);
    if (linkStats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_LOG_MONITOR_CONFIG_BYTES) {
      return [];
    }
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parseLogMonitorConfig(workspacePath, parsed);
  } catch {
    return [];
  }
}

function parseLogMonitorConfig(workspacePath: string, parsed: unknown): LogMonitorTarget[] {
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? [
          ...readSnapshotArray((parsed as Record<string, unknown>).logs),
          ...readSnapshotArray((parsed as Record<string, unknown>).files),
        ]
      : [];
  return records
    .map((record) => {
      if (typeof record === "string") {
        return normalizeLogMonitorTarget(workspacePath, resolve(workspacePath, record));
      }
      if (!record || typeof record !== "object") return null;
      const item = record as Record<string, unknown>;
      const rawPath = getSnapshotString(item, "path") || getSnapshotString(item, "file");
      if (!rawPath) return null;
      const target = normalizeLogMonitorTarget(workspacePath, resolve(workspacePath, rawPath));
      if (!target) return null;
      const label = getSnapshotString(item, "label") || getSnapshotString(item, "name");
      return label ? { ...target, label: clampSingleLine(label, 160) } : target;
    })
    .filter((target): target is LogMonitorTarget => Boolean(target));
}

function normalizeLogMonitorTarget(
  workspacePath: string,
  candidatePath: string,
): LogMonitorTarget | null {
  const targetPath = resolve(candidatePath);
  if (!isInsideWorkspace(workspacePath, targetPath)) return null;
  try {
    const linkStats = lstatSync(targetPath);
    const stats = statSync(targetPath);
    if (linkStats.isSymbolicLink() || !stats.isFile()) return null;
  } catch {
    return null;
  }
  return { path: targetPath };
}

function createLogMonitorDeltaItem(
  workspacePath: string,
  target: LogMonitorTarget,
  cursors: Record<string, ChannelLogCursorEntry>,
  now: string,
): { item: DesktopChannelContextItem; cursor: ChannelLogCursorEntry; truncated: boolean } | null {
  let stats;
  try {
    stats = statSync(target.path);
  } catch {
    return null;
  }
  const relativePath = relative(workspacePath, target.path).split(sep).join("/");
  const previous = cursors[relativePath];
  const previousOffset =
    previous && previous.size <= stats.size && previous.offset <= stats.size
      ? Math.max(0, previous.offset)
      : Math.max(0, stats.size - MAX_LOG_MONITOR_DELTA_BYTES);
  const unreadBytes = Math.max(0, stats.size - previousOffset);
  const readStart =
    unreadBytes > MAX_LOG_MONITOR_DELTA_BYTES
      ? Math.max(0, stats.size - MAX_LOG_MONITOR_DELTA_BYTES)
      : previousOffset;
  const delta = readFileSlice(target.path, readStart, Math.min(stats.size - readStart, MAX_LOG_MONITOR_DELTA_BYTES));
  const summary = summarizeLogMonitorDelta(
    delta.toString("utf8"),
    stats.size,
    previous ? previousOffset : null,
    readStart,
    target.label || basename(target.path),
  );
  const cursor: ChannelLogCursorEntry = {
    path: target.path,
    relativePath,
    offset: stats.size,
    size: stats.size,
    updatedAt: now,
  };
  return {
    item: {
      id: `logs-monitor:${relativePath}:${readStart}-${stats.size}`,
      adapterId: "logs-monitor",
      provider: "file_upload",
      kind: "file",
      title: target.label || basename(target.path),
      path: target.path,
      relativePath,
      summary,
      size: stats.size,
      mime: "text/plain",
      truncated: summary.length >= MAX_TEXT_BYTES || unreadBytes > MAX_LOG_MONITOR_DELTA_BYTES,
    },
    cursor,
    truncated: unreadBytes > MAX_LOG_MONITOR_DELTA_BYTES,
  };
}

function readFileSlice(filePath: string, start: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function summarizeLogMonitorDelta(
  raw: string,
  size: number,
  previousOffset: number | null,
  readStart: number,
  label: string,
): string {
  const normalized = normalizeTextPreview(raw);
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  const interesting = lines.filter((line) => /\b(error|fatal|panic|exception|warn|warning|fail|failed)\b/i.test(line));
  const previewLines = (interesting.length > 0 ? interesting : lines)
    .slice(-MAX_LOG_MONITOR_LINES)
    .map(maskPotentialSecretValues);
  const cursorLine =
    previousOffset === null
      ? `Initial cursor snapshot for ${label}; read from byte ${readStart} of ${size}.`
      : `Incremental cursor snapshot for ${label}; previous byte offset ${previousOffset}, read from byte ${readStart} to ${size}.`;
  return [
    `Log monitor delta (${formatBytes(size)}).`,
    cursorLine,
    `Delta lines in bounded window: ${lines.length}; notable warning/error/failure lines: ${interesting.length}.`,
    previewLines.length > 0 ? previewLines.join("\n") : "No new readable log lines were found in this bounded cursor window.",
    "Ready for explicit attachment after visible review; no tailing process, command execution, credential lookup, network call, external log service, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function normalizeDocsSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getWorkspaceConnectorSnapshotRecords(parsed, [
    "items",
    "docs",
    "documents",
  ]);
  const items = records
    .map((record, index) =>
      createDocsSnapshotItem(workspacePath, snapshotPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: records.length > items.length };
}

function normalizeCalendarSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getWorkspaceConnectorSnapshotRecords(parsed, [
    "items",
    "events",
    "meetings",
  ]);
  const items = records
    .map((record, index) =>
      createCalendarSnapshotItem(workspacePath, snapshotPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: records.length > items.length };
}

function normalizeCalendarIcsSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  content: string,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = parseCalendarIcsEvents(content);
  const items = records
    .map((record, index) =>
      createCalendarSnapshotItem(workspacePath, snapshotPath, record, index, "text/calendar"),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: records.length > items.length };
}

function normalizeDatabaseSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getDatabaseSnapshotRecords(parsed);
  const normalizedRecords = records.length > 0 ? records : [parsed];
  const items = normalizedRecords
    .map((record, index) =>
      createDatabaseSnapshotItem(workspacePath, snapshotPath, record, index, normalizedRecords),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: normalizedRecords.length > items.length };
}

function normalizeDatabaseSqlSchemaItems(
  workspacePath: string,
  snapshotPath: string,
  content: string,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = parseDatabaseSqlSchemaDump(content);
  const items = records
    .map((record, index) =>
      createDatabaseSnapshotItem(workspacePath, snapshotPath, record, index, records),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: records.length > items.length };
}

function parseDatabaseSqlSchemaDump(content: string): Record<string, unknown>[] {
  const statements = splitSqlStatements(stripSqlComments(content));
  const tableRecords = statements
    .map((statement) => parseCreateTableStatement(statement))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .slice(0, MAX_IMPORT_ITEMS);
  const indexes = statements
    .map((statement) => parseCreateIndexStatement(statement))
    .filter((index): index is Record<string, unknown> => Boolean(index));
  for (const index of indexes) {
    const targetTable = normalizeDatabaseIdentifier(getSnapshotString(index, "table"));
    const tableRecord = tableRecords.find((record) =>
      normalizeDatabaseIdentifier(getSnapshotString(record, "table")) === targetTable,
    );
    if (!tableRecord) continue;
    const existingIndexes = readSnapshotArray(tableRecord.indexes);
    tableRecord.indexes = [...existingIndexes, index].slice(0, 8);
  }
  return tableRecords;
}

function stripSqlComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/--[^\r\n]*/g, "");
}

function splitSqlStatements(content: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    current += char;
    if (quote) {
      if (char === quote && next === quote) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote && content[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function parseCreateTableStatement(statement: string): Record<string, unknown> | null {
  const match = statement.match(/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+?)\s*\(/i);
  if (!match) return null;
  const tableName = cleanSqlIdentifier(match[1]);
  if (!tableName) return null;
  const body = extractSqlParenthesizedBody(statement, match.index ?? 0);
  if (!body) return null;
  const parts = splitSqlDefinitionList(body);
  const columns: string[] = [];
  const columnTypes: Record<string, string> = {};
  const notNullColumns = new Set<string>();
  const defaultedColumns = new Set<string>();
  const primaryKey = new Set<string>();
  const foreignKeys: Record<string, string>[] = [];
  const uniqueConstraints: Record<string, unknown>[] = [];
  const checkConstraints: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const normalizedConstraint = trimmed.replace(/^CONSTRAINT\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+/i, "");
    const tablePrimaryKey = normalizedConstraint.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (tablePrimaryKey) {
      for (const key of splitSqlIdentifierList(tablePrimaryKey[1])) primaryKey.add(key);
      continue;
    }
    const tableForeignKey = normalizedConstraint.match(/^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([^\s(]+(?:\s*\.\s*[^\s(]+)?)\s*\(([^)]+)\)/i);
    if (tableForeignKey) {
      const localColumns = splitSqlIdentifierList(tableForeignKey[1]);
      const targetTable = cleanSqlIdentifier(tableForeignKey[2]);
      const targetColumns = splitSqlIdentifierList(tableForeignKey[3]);
      localColumns.forEach((column, index) => {
        foreignKeys.push({
          column,
          targetTable,
          targetColumn: targetColumns[index] || targetColumns[0] || "id",
        });
      });
      continue;
    }
    const tableUnique = normalizedConstraint.match(/^UNIQUE\s*(?:KEY|INDEX)?\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)?\s*\(([^)]+)\)/i);
    if (tableUnique) {
      uniqueConstraints.push({
        columns: splitSqlIdentifierList(tableUnique[1]),
        source: "table_unique_constraint",
      });
      continue;
    }
    const tableCheck = normalizedConstraint.match(/^CHECK\s*\(([\s\S]+)\)$/i);
    if (tableCheck) {
      checkConstraints.push(clampSingleLine(tableCheck[1], 240));
      continue;
    }
    if (/^(EXCLUDE|KEY|INDEX)\b/i.test(normalizedConstraint)) continue;
    const columnMatch = trimmed.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+([\s\S]*)$/);
    if (!columnMatch) continue;
    const column = cleanSqlIdentifier(columnMatch[1]);
    if (!column) continue;
    columns.push(column);
    const columnDefinition = columnMatch[2];
    const columnType = extractSqlColumnType(columnDefinition);
    if (columnType) columnTypes[column] = columnType;
    if (/\bPRIMARY\s+KEY\b/i.test(columnDefinition)) primaryKey.add(column);
    if (/\bNOT\s+NULL\b/i.test(columnDefinition)) notNullColumns.add(column);
    if (/\bDEFAULT\b/i.test(columnDefinition)) defaultedColumns.add(column);
    if (/\bUNIQUE\b/i.test(columnDefinition)) {
      uniqueConstraints.push({ columns: [column], source: "column_unique_constraint" });
    }
    const inlineCheck = columnDefinition.match(/\bCHECK\s*\(([\s\S]+)\)/i);
    if (inlineCheck) checkConstraints.push(`${column}: ${clampSingleLine(inlineCheck[1], 220)}`);
    const inlineReference = columnDefinition.match(/\bREFERENCES\s+([^\s(]+(?:\s*\.\s*[^\s(]+)?)\s*(?:\(([^)]+)\))?/i);
    if (inlineReference) {
      foreignKeys.push({
        column,
        targetTable: cleanSqlIdentifier(inlineReference[1]),
        targetColumn: inlineReference[2] ? splitSqlIdentifierList(inlineReference[2])[0] || "id" : "id",
      });
    }
  }
  return {
    table: tableName,
    kind: "sql_schema_table",
    columns,
    columnTypes,
    notNullColumns: Array.from(notNullColumns),
    defaultedColumns: Array.from(defaultedColumns),
    primaryKey: Array.from(primaryKey),
    foreignKeys,
    uniqueConstraints,
    checkConstraints: checkConstraints.slice(0, 8),
    ddl: statement.slice(0, MAX_TEXT_BYTES),
    source: "sql_schema_dump",
  };
}

function parseCreateIndexStatement(statement: string): Record<string, unknown> | null {
  const match = statement.match(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+ON\s+([^\s(]+(?:\s*\.\s*[^\s(]+)?)\s*\(([^)]+)\)/i);
  if (!match) return null;
  const columns = splitSqlIdentifierList(match[4]);
  if (columns.length === 0) return null;
  return {
    name: cleanSqlIdentifier(match[2]),
    table: cleanSqlIdentifier(match[3]),
    columns,
    unique: Boolean(match[1]),
    source: "create_index_statement",
  };
}

function extractSqlColumnType(columnDefinition: string): string {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of columnDefinition.trim()) {
    if (/\s/.test(char) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    current += char;
  }
  if (current) tokens.push(current);
  const stopWords = new Set([
    "PRIMARY",
    "NOT",
    "NULL",
    "DEFAULT",
    "CHECK",
    "REFERENCES",
    "UNIQUE",
    "COLLATE",
    "CONSTRAINT",
    "GENERATED",
    "AS",
  ]);
  const typeTokens: string[] = [];
  for (const token of tokens) {
    if (stopWords.has(token.toUpperCase())) break;
    typeTokens.push(token);
  }
  return clampSingleLine(typeTokens.join(" "), 80);
}

function extractSqlParenthesizedBody(statement: string, startAt: number): string | null {
  const openIndex = statement.indexOf("(", startAt);
  if (openIndex < 0) return null;
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = openIndex; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];
    if (quote) {
      if (char === quote && next === quote) {
        index += 1;
        continue;
      }
      if (char === quote && statement[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(openIndex + 1, index);
    }
  }
  return null;
}

function splitSqlDefinitionList(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (quote) {
      current += char;
      if (char === quote && next === quote) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote && body[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSqlIdentifierList(value: string): string[] {
  return value
    .split(",")
    .map((item) => cleanSqlIdentifier(item))
    .filter((item) => item.length > 0)
    .slice(0, 16);
}

function cleanSqlIdentifier(value: string): string {
  return value
    .split(".")
    .map((part) =>
      part
        .trim()
        .replace(/^["`\[]/, "")
        .replace(/["`\]]$/, ""),
    )
    .filter(Boolean)
    .join(".");
}

function getDatabaseSnapshotRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const schemaTables =
    record.schema && typeof record.schema === "object"
      ? readSnapshotArray((record.schema as Record<string, unknown>).tables)
      : [];
  return [
    ...readSnapshotArray(record.items),
    ...readSnapshotArray(record.tables),
    ...readSnapshotArray(record.views),
    ...readSnapshotArray(record.queries),
    ...readSnapshotArray(record.datasets),
    ...schemaTables,
  ];
}

function createDatabaseSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
  allRecords: unknown[],
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const title = clampSingleLine(
    getSnapshotString(item, "title") ||
      getSnapshotString(item, "table") ||
      getSnapshotString(item, "tableName") ||
      getSnapshotString(item, "name") ||
      getSnapshotString(item, "queryName") ||
      `Database snapshot ${index + 1}`,
    240,
  );
  const databaseName =
    getSnapshotString(item, "database") ||
    getSnapshotString(item, "databaseName") ||
    getSnapshotString(item, "source");
  const kindLabel =
    getSnapshotString(item, "kind") ||
    getSnapshotString(item, "type") ||
    (getSnapshotString(item, "sql") ? "query" : "table");
  const rowCount =
    getSnapshotNumber(item, "rowCount") ||
    getSnapshotNumber(item, "rows") ||
    getSnapshotNumber(item, "estimatedRows");
  const columns = getSnapshotLabels(item.columns).length > 0
    ? getSnapshotLabels(item.columns)
    : getSnapshotLabels(item.fields);
  const primaryKey = getSnapshotLabels(item.primaryKey || item.primary_keys || item.keys);
  const semanticHints = readDatabaseSemanticHints(item);
  const sampleRows = readDatabaseSampleRows(item.sampleRows || item.samples || item.previewRows);
  const schemaHints = inferDatabaseSchemaRelationshipHints(
    item,
    title,
    columns,
    primaryKey,
    allRecords,
  );
  const notes = clampMultiline(
    getSnapshotString(item, "summary") ||
      getSnapshotString(item, "description") ||
      getSnapshotString(item, "schema") ||
      getSnapshotString(item, "ddl") ||
      getSnapshotString(item, "sql") ||
      "No database snapshot notes were provided.",
    MAX_TEXT_BYTES,
    "Database snapshot body is required.",
  );
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = `database-${index + 1}`;
  const summary = [
    `Database snapshot: ${title}`,
    databaseName ? `Database: ${databaseName}` : "",
    kindLabel ? `Type: ${kindLabel}` : "",
    rowCount !== null ? `Rows: ${rowCount}` : "",
    columns.length > 0 ? `Columns: ${columns.join(", ")}` : "",
    primaryKey.length > 0 ? `Primary key: ${primaryKey.join(", ")}` : "",
    "",
    notes,
    sampleRows.length > 0 ? `Sample rows:\n${sampleRows.join("\n")}` : "",
    semanticHints.length > 0
      ? `Local schema semantic hints:\n${semanticHints.join("\n")}`
      : "",
    schemaHints.length > 0
      ? `Local schema relationship hints:\n${schemaHints.join("\n")}`
      : "Local schema relationship hints: none detected from the bounded snapshot.",
    extname(snapshotPath).toLowerCase() === ".sql"
      ? "Read-only SQL schema dump handoff with local DDL parsing and relationship hints; no database connection, credentials, SQL execution, network call, external schema inference service, or provider send was performed."
      : "Read-only database snapshot handoff with local heuristic schema relationship hints; no database connection, credentials, SQL execution, network call, external schema inference service, or provider send was performed.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `database-connector:${suffix}`,
    adapterId: "database-connector",
    provider: "database" as DesktopChannelAdapterProvider,
    kind: "database_table",
    title,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: extname(snapshotPath).toLowerCase() === ".sql" ? "text/sql" : "application/json",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function readDatabaseSemanticHints(item: Record<string, unknown>): string[] {
  const hints: string[] = [];
  const columnTypes = item.columnTypes;
  if (columnTypes && typeof columnTypes === "object") {
    const typedColumns = Object.entries(columnTypes as Record<string, unknown>)
      .filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string" && entry[1].trim().length > 0,
      )
      .slice(0, 8)
      .map(([column, type]) => `${column}: ${type}`);
    if (typedColumns.length > 0) hints.push(`Column types: ${typedColumns.join(", ")}`);
  }
  const notNullColumns = getSnapshotLabels(item.notNullColumns || item.not_null_columns);
  if (notNullColumns.length > 0) {
    hints.push(`Required columns: ${notNullColumns.slice(0, 12).join(", ")}`);
  }
  const defaultedColumns = getSnapshotLabels(item.defaultedColumns || item.defaulted_columns);
  if (defaultedColumns.length > 0) {
    hints.push(`Defaulted columns: ${defaultedColumns.slice(0, 12).join(", ")}`);
  }
  for (const unique of readSnapshotArray(item.uniqueConstraints || item.unique_constraints).slice(0, 4)) {
    const columns = unique && typeof unique === "object"
      ? getSnapshotLabels((unique as Record<string, unknown>).columns)
      : getSnapshotLabels(unique);
    if (columns.length > 0) hints.push(`Unique constraint: ${columns.join(", ")}`);
  }
  for (const index of readSnapshotArray(item.indexes).slice(0, 4)) {
    if (!index || typeof index !== "object") continue;
    const indexRecord = index as Record<string, unknown>;
    const columns = getSnapshotLabels(indexRecord.columns);
    if (columns.length === 0) continue;
    const name = getSnapshotString(indexRecord, "name");
    const unique = indexRecord.unique === true ? "unique " : "";
    hints.push(`Indexed columns: ${unique}${name ? `${name} on ` : ""}${columns.join(", ")}`);
  }
  for (const check of getSnapshotLabels(item.checkConstraints || item.check_constraints).slice(0, 4)) {
    hints.push(`Check constraint: ${check}`);
  }
  return hints.slice(0, 10);
}

function inferDatabaseSchemaRelationshipHints(
  item: Record<string, unknown>,
  title: string,
  columns: string[],
  primaryKey: string[],
  allRecords: unknown[],
): string[] {
  const hints = new Set<string>();
  for (const explicitHint of readExplicitDatabaseRelationshipHints(item)) {
    hints.add(explicitHint);
  }

  const tableSummaries = allRecords
    .filter((record): record is Record<string, unknown> =>
      Boolean(record && typeof record === "object"),
    )
    .map((record) => ({
      title:
        getSnapshotString(record, "title") ||
        getSnapshotString(record, "table") ||
        getSnapshotString(record, "tableName") ||
        getSnapshotString(record, "name") ||
        getSnapshotString(record, "queryName"),
      columns: getSnapshotLabels(record.columns).length > 0
        ? getSnapshotLabels(record.columns)
        : getSnapshotLabels(record.fields),
      primaryKey: getSnapshotLabels(record.primaryKey || record.primary_keys || record.keys),
    }))
    .filter((record) => record.title);

  const primaryKeySet = new Set(primaryKey.map(normalizeDatabaseIdentifier));
  for (const column of columns) {
    const normalizedColumn = normalizeDatabaseIdentifier(column);
    if (!normalizedColumn.endsWith("id") || primaryKeySet.has(normalizedColumn)) continue;
    const stem = normalizedColumn.replace(/id$/, "").replace(/s$/, "");
    if (!stem || stem === normalizeDatabaseIdentifier(title)) continue;
    const target = tableSummaries.find((table) => {
      const targetName = normalizeDatabaseIdentifier(table.title || "").replace(/s$/, "");
      const targetPrimaryKey = table.primaryKey.map(normalizeDatabaseIdentifier);
      return (
        targetName === stem &&
        (targetPrimaryKey.includes("id") ||
          targetPrimaryKey.includes(`${targetName}id`) ||
          table.columns.map(normalizeDatabaseIdentifier).includes("id"))
      );
    });
    if (target?.title) {
      hints.add(`Possible relationship: ${title}.${column} -> ${target.title}.${target.primaryKey[0] || "id"}`);
    }
  }

  return Array.from(hints).slice(0, 8);
}

function readExplicitDatabaseRelationshipHints(item: Record<string, unknown>): string[] {
  const relationships = [
    ...readSnapshotArray(item.foreignKeys),
    ...readSnapshotArray(item.foreign_keys),
    ...readSnapshotArray(item.relationships),
    ...readSnapshotArray(item.relations),
  ];
  return relationships
    .map((relationship) => formatDatabaseRelationshipHint(relationship))
    .filter((hint): hint is string => Boolean(hint))
    .slice(0, 8);
}

function formatDatabaseRelationshipHint(relationship: unknown): string | null {
  if (typeof relationship === "string") {
    const normalized = relationship.replace(/\s+/g, " ").trim();
    return normalized ? `Declared relationship: ${normalized.slice(0, 240)}` : null;
  }
  if (!relationship || typeof relationship !== "object") return null;
  const record = relationship as Record<string, unknown>;
  const column =
    getSnapshotString(record, "column") ||
    getSnapshotString(record, "fromColumn") ||
    getSnapshotString(record, "sourceColumn") ||
    getSnapshotString(record, "localColumn");
  const targetTable =
    getSnapshotString(record, "targetTable") ||
    getSnapshotString(record, "references") ||
    getSnapshotString(record, "table") ||
    getSnapshotString(record, "toTable") ||
    getSnapshotString(record, "foreignTable");
  const targetColumn =
    getSnapshotString(record, "targetColumn") ||
    getSnapshotString(record, "referencesColumn") ||
    getSnapshotString(record, "toColumn") ||
    getSnapshotString(record, "foreignColumn") ||
    "id";
  if (!column && !targetTable) return null;
  return `Declared relationship: ${column || "local column"} -> ${targetTable || "target table"}.${targetColumn}`;
}

function normalizeDatabaseIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readDatabaseSampleRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 4)
    .map((row, index) => {
      const rendered =
        row && typeof row === "object"
          ? JSON.stringify(row)
          : String(row ?? "");
      return `Row ${index + 1}: ${rendered.replace(/\s+/g, " ").slice(0, 360)}`;
    })
    .filter((line) => line.trim().length > 7);
}

function parseCalendarIcsEvents(content: string): Record<string, unknown>[] {
  const unfolded = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
  const events: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  for (const line of unfolded) {
    const trimmed = line.trimEnd();
    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = trimmed.indexOf(":");
    if (separator < 0) continue;
    const rawName = trimmed.slice(0, separator);
    const value = decodeIcsText(trimmed.slice(separator + 1));
    const name = rawName.split(";")[0].toUpperCase();
    if (name === "SUMMARY") current.title = value;
    if (name === "DTSTART") current.startsAt = value;
    if (name === "DTEND") current.endsAt = value;
    if (name === "LOCATION") current.location = value;
    if (name === "DESCRIPTION") current.notes = value;
    if (name === "URL") current.url = value;
    if (name === "ATTENDEE") {
      const attendees = Array.isArray(current.attendees) ? current.attendees : [];
      attendees.push(value.replace(/^mailto:/i, ""));
      current.attendees = attendees.slice(0, 12);
    }
  }
  return events.slice(0, MAX_IMPORT_ITEMS);
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function summarizeCalendarIcsFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 12),
    ).toString("utf8");
    const events = parseCalendarIcsEvents(raw).slice(0, MAX_ICS_EVENT_PREVIEW);
    const status =
      events.length > 0
        ? `${events.length} VEVENT preview(s) from the calendar file.`
        : "No readable VEVENT entries were found.";
    const previews = events.map((event, index) => summarizeCalendarIcsEvent(event, index));
    return [
      `Calendar ICS file preview (${formatBytes(size)}).`,
      status,
      ...previews,
      "Ready for explicit attachment after visible review; no calendar app access, provider API call, schedule mutation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Calendar ICS file ready for explicit attachment (${formatBytes(size)}).`,
      "No calendar app access, provider API call, schedule mutation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeCalendarIcsEvent(record: Record<string, unknown>, index: number): string {
  const fields = [
    getSnapshotString(record, "title") ? `Title: ${getSnapshotString(record, "title")}` : "",
    getSnapshotString(record, "startsAt") ? `Starts: ${getSnapshotString(record, "startsAt")}` : "",
    getSnapshotString(record, "endsAt") ? `Ends: ${getSnapshotString(record, "endsAt")}` : "",
    getSnapshotString(record, "location") ? `Location: ${getSnapshotString(record, "location")}` : "",
    getSnapshotLabels(record.attendees).length > 0
      ? `Attendees: ${getSnapshotLabels(record.attendees).join(", ")}`
      : "",
    getSnapshotString(record, "url") ? `URL: ${getSnapshotString(record, "url")}` : "",
    getSnapshotString(record, "notes") ? `Notes: ${getSnapshotString(record, "notes")}` : "",
  ].filter(Boolean);
  if (fields.length === 0) return `Event ${index + 1}: VEVENT had no recognized preview fields.`;
  return [`Event ${index + 1}`, ...fields]
    .join(" | ")
    .replace(/\s+/g, " ")
    .slice(0, 960);
}

function getWorkspaceConnectorSnapshotRecords(
  parsed: unknown,
  keys: string[],
): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function createDocsSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const title = clampSingleLine(
    getSnapshotString(item, "title") || getSnapshotString(item, "name") || `Document ${index + 1}`,
    240,
  );
  const owner = getSnapshotString(item, "owner") || getSnapshotString(item, "author");
  const updatedAt = getSnapshotString(item, "updatedAt") || getSnapshotString(item, "updated_at");
  const url = getSnapshotString(item, "url") || getSnapshotString(item, "webUrl");
  const body = clampMultiline(
    getSnapshotString(item, "summary") ||
      getSnapshotString(item, "body") ||
      getSnapshotString(item, "content") ||
      "No document snapshot body was provided.",
    MAX_TEXT_BYTES,
    "Document snapshot body is required.",
  );
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = `doc-${index + 1}`;
  const summary = [
    `Document: ${title}`,
    owner ? `Owner: ${owner}` : "",
    updatedAt ? `Updated: ${updatedAt}` : "",
    url ? `URL: ${url}` : "",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `docs-connector:${suffix}`,
    adapterId: "docs-connector",
    provider: "docs" as DesktopChannelAdapterProvider,
    kind: "document",
    title,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: "application/json",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function createCalendarSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
  mime = "application/json",
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const title = clampSingleLine(
    getSnapshotString(item, "title") || getSnapshotString(item, "summary") || `Meeting ${index + 1}`,
    240,
  );
  const startsAt = getSnapshotString(item, "startsAt") || getSnapshotString(item, "start");
  const endsAt = getSnapshotString(item, "endsAt") || getSnapshotString(item, "end");
  const location = getSnapshotString(item, "location");
  const url = getSnapshotString(item, "url") || getSnapshotString(item, "meetingUrl");
  const attendees = getSnapshotLabels(item.attendees);
  const notes = clampMultiline(
    getSnapshotString(item, "notes") ||
      getSnapshotString(item, "body") ||
      getSnapshotString(item, "description") ||
      "No meeting snapshot notes were provided.",
    MAX_TEXT_BYTES,
    "Meeting snapshot notes are required.",
  );
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = `meeting-${index + 1}`;
  const summary = [
    `Meeting: ${title}`,
    startsAt ? `Starts: ${startsAt}` : "",
    endsAt ? `Ends: ${endsAt}` : "",
    location ? `Location: ${location}` : "",
    attendees.length > 0 ? `Attendees: ${attendees.join(", ")}` : "",
    url ? `URL: ${url}` : "",
    "",
    notes,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `calendar-connector:${suffix}`,
    adapterId: "calendar-connector",
    provider: "calendar" as DesktopChannelAdapterProvider,
    kind: "meeting",
    title,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime,
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function importSlackChatContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const limit = clampLimit(request.limit);
  const snapshot = readSlackChatSnapshotContext(workspacePath, request, limit);
  return {
    adapterId: "slack-chat",
    workspacePath,
    importedAt: new Date().toISOString(),
    items: snapshot.items,
    truncated: snapshot.truncated,
    message:
      snapshot.items.length > 0
        ? `Prepared ${snapshot.items.length} read-only Slack snapshot message(s).`
        : "No workspace-local Slack snapshot context was found.",
    verification:
      snapshot.items.length > 0
        ? "Slack import reads a bounded workspace-local message snapshot and records reviewed inbound events; no OAuth flow, Slack API call, network call, or provider send was performed."
        : "Live Slack OAuth/session sync is still pending; local Slack message handoff remains optional and read-only.",
  };
}

function readSlackChatSnapshotContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const snapshotPath = resolveSlackSnapshotPath(workspacePath, request);
  if (!snapshotPath) return { items: [], truncated: false };
  let stats;
  try {
    const linkStats = lstatSync(snapshotPath);
    if (linkStats.isSymbolicLink()) return { items: [], truncated: false };
    stats = statSync(snapshotPath);
  } catch {
    return { items: [], truncated: false };
  }
  if (!stats.isFile() || stats.size > MAX_CONNECTOR_SNAPSHOT_BYTES) {
    return { items: [], truncated: stats.size > MAX_CONNECTOR_SNAPSHOT_BYTES };
  }
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return normalizeSlackSnapshotItems(workspacePath, snapshotPath, parsed, limit);
  } catch {
    return { items: [], truncated: false };
  }
}

function resolveSlackSnapshotPath(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): string | null {
  const requestedPath = request.slackSnapshotPath?.trim() || request.snapshotPath?.trim();
  const candidatePath = requestedPath
    ? resolve(workspacePath, requestedPath)
    : resolve(workspacePath, DEFAULT_SLACK_SNAPSHOT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, candidatePath)) return null;
  if (!existsSync(candidatePath)) return null;
  return candidatePath;
}

function normalizeSlackSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getSlackSnapshotRecords(parsed);
  const items = records
    .map((record, index) =>
      createSlackSnapshotItem(workspacePath, snapshotPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: records.length > items.length };
}

function getSlackSnapshotRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const directRecords = [
    ...readSnapshotArray(record.items),
    ...readSnapshotArray(record.messages),
  ];
  const threadRecords = readSnapshotArray(record.threads).flatMap((thread) => {
    if (!thread || typeof thread !== "object") return [];
    const threadRecord = thread as Record<string, unknown>;
    return readSnapshotArray(threadRecord.messages).map((message) => ({
      ...(message as object),
      channel: getSnapshotString(threadRecord, "channel"),
      threadTs:
        getSnapshotString(threadRecord, "threadTs") ||
        getSnapshotString(threadRecord, "thread_ts") ||
        getSnapshotString(threadRecord, "ts"),
    }));
  });
  return [...directRecords, ...threadRecords];
}

function createSlackSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const channel = getSnapshotString(item, "channel") || getSnapshotString(item, "channelName") || "unknown-channel";
  const sender =
    getSnapshotString(item, "sender") ||
    getSnapshotString(item, "user") ||
    getSnapshotString(item, "author") ||
    "unknown-sender";
  const timestamp =
    getSnapshotString(item, "timestamp") ||
    getSnapshotString(item, "ts") ||
    getSnapshotString(item, "createdAt");
  const threadTs =
    getSnapshotString(item, "threadTs") ||
    getSnapshotString(item, "thread_ts");
  const url = getSnapshotString(item, "url") || getSnapshotString(item, "permalink");
  const text = clampMultiline(
    getSnapshotString(item, "text") ||
      getSnapshotString(item, "body") ||
      getSnapshotString(item, "summary") ||
      "No Slack message text was provided.",
    MAX_TEXT_BYTES,
    "Slack message text is required.",
  );
  const title = clampSingleLine(
    getSnapshotString(item, "title") || `${channel} message from ${sender}`,
    240,
  );
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = `message-${index + 1}`;
  const summary = [
    `Slack message: ${title}`,
    `Channel: ${channel}`,
    `Sender: ${sender}`,
    timestamp ? `Time: ${timestamp}` : "",
    threadTs ? `Thread: ${threadTs}` : "",
    url ? `URL: ${url}` : "",
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `slack-chat:${suffix}`,
    adapterId: "slack-chat",
    provider: "slack" as const,
    kind: "slack_message",
    title,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: "application/json",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function importMobileChatContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const limit = clampLimit(request.limit);
  const snapshot = readMobileChatSnapshotContext(workspacePath, request, limit);
  return {
    adapterId: "mobile-chat",
    workspacePath,
    importedAt: new Date().toISOString(),
    items: snapshot.items,
    truncated: snapshot.truncated,
    message:
      snapshot.items.length > 0
        ? `Prepared ${snapshot.items.length} read-only mobile chat handoff item(s).`
        : "No workspace-local mobile chat handoff was found.",
    verification:
      snapshot.items.length > 0
        ? "Mobile chat import reads a bounded workspace-local handoff and records reviewed inbound events; no device pairing, push notification, network call, or provider send was performed."
        : "Live mobile device pairing and notification routing are still pending; local mobile handoff remains optional and read-only.",
  };
}

function readMobileChatSnapshotContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const snapshotPath = resolveMobileSnapshotPath(workspacePath, request);
  if (!snapshotPath) return { items: [], truncated: false };
  let stats;
  try {
    const linkStats = lstatSync(snapshotPath);
    if (linkStats.isSymbolicLink()) return { items: [], truncated: false };
    stats = statSync(snapshotPath);
  } catch {
    return { items: [], truncated: false };
  }
  if (!stats.isFile() || stats.size > MAX_MOBILE_CHAT_SNAPSHOT_BYTES) {
    return { items: [], truncated: stats.size > MAX_MOBILE_CHAT_SNAPSHOT_BYTES };
  }
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return normalizeMobileSnapshotItems(workspacePath, snapshotPath, parsed, limit);
  } catch {
    return { items: [], truncated: false };
  }
}

function resolveMobileSnapshotPath(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): string | null {
  const requestedPath = (request.mobileSnapshotPath || request.snapshotPath || "").trim();
  const candidatePath = requestedPath
    ? resolve(workspacePath, requestedPath)
    : resolve(workspacePath, DEFAULT_MOBILE_SNAPSHOT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, candidatePath)) return null;
  if (!existsSync(candidatePath)) return null;
  return candidatePath;
}

function normalizeMobileSnapshotItems(
  workspacePath: string,
  snapshotPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getWorkspaceConnectorSnapshotRecords(parsed, [
    "items",
    "messages",
    "threads",
  ]);
  const normalizedRecords = records.length > 0 ? records : [parsed];
  const items = normalizedRecords
    .map((record, index) =>
      createMobileSnapshotItem(workspacePath, snapshotPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: normalizedRecords.length > items.length };
}

function createMobileSnapshotItem(
  workspacePath: string,
  snapshotPath: string,
  record: unknown,
  index: number,
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const title = clampSingleLine(
    getSnapshotString(item, "title") ||
      getSnapshotString(item, "subject") ||
      `Mobile message ${index + 1}`,
    240,
  );
  const sender = getSnapshotString(item, "sender") || getSnapshotString(item, "from");
  const threadId = getSnapshotString(item, "threadId") || getSnapshotString(item, "thread");
  const sentAt =
    getSnapshotString(item, "sentAt") ||
    getSnapshotString(item, "createdAt") ||
    getSnapshotString(item, "timestamp");
  const body = clampMultiline(
    getSnapshotString(item, "message") ||
      getSnapshotString(item, "text") ||
      getSnapshotString(item, "body") ||
      getSnapshotString(item, "content") ||
      "No mobile message body was provided.",
    MAX_TEXT_BYTES,
    "Mobile message body is required.",
  );
  const relativePath = relative(workspacePath, snapshotPath).split(sep).join("/");
  const suffix = `mobile-${index + 1}`;
  const summary = [
    `Mobile message: ${title}`,
    sender ? `Sender: ${sender}` : "",
    threadId ? `Thread: ${threadId}` : "",
    sentAt ? `Sent: ${sentAt}` : "",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `mobile-chat:${suffix}`,
    adapterId: "mobile-chat",
    provider: "mobile" as DesktopChannelAdapterProvider,
    kind: "mobile_message",
    title,
    path: `${snapshotPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: "application/json",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function importVoiceTranscriptContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): DesktopChannelContextImportResult {
  const limit = clampLimit(request.limit);
  const snapshot = readVoiceTranscriptContext(workspacePath, request, limit);
  return {
    adapterId: "voice-input",
    workspacePath,
    importedAt: new Date().toISOString(),
    items: snapshot.items,
    truncated: snapshot.truncated,
    message:
      snapshot.items.length > 0
        ? `Prepared ${snapshot.items.length} read-only voice transcript context item(s).`
        : "No workspace-local voice transcript handoff was found.",
    verification:
      snapshot.items.length > 0
        ? "Voice input import reads a bounded workspace-local transcript handoff; no microphone capture, transcription service, network call, or provider send was performed."
        : "Live microphone capture and transcription runtime are still pending; local transcript handoff remains optional and read-only.",
  };
}

function readVoiceTranscriptContext(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const transcriptPath = resolveVoiceTranscriptPath(workspacePath, request);
  if (!transcriptPath) return { items: [], truncated: false };
  let stats;
  try {
    const linkStats = lstatSync(transcriptPath);
    if (linkStats.isSymbolicLink()) return { items: [], truncated: false };
    stats = statSync(transcriptPath);
  } catch {
    return { items: [], truncated: false };
  }
  if (!stats.isFile() || stats.size > MAX_VOICE_TRANSCRIPT_BYTES) {
    return { items: [], truncated: stats.size > MAX_VOICE_TRANSCRIPT_BYTES };
  }
  const raw = readFileSync(transcriptPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return normalizeVoiceTranscriptItems(workspacePath, transcriptPath, parsed, limit);
  } catch {
    const extension = extname(transcriptPath).toLowerCase();
    const body = isTimedTranscriptExtension(extension)
      ? extractTimedTranscriptPlainText(raw)
      : raw.trim();
    if (!body) return { items: [], truncated: false };
    const item = createVoiceTranscriptItem(
      workspacePath,
      transcriptPath,
      { transcript: body, title: basename(transcriptPath) },
      0,
    );
    return { items: item ? [item] : [], truncated: raw.length > MAX_TEXT_BYTES };
  }
}

function resolveVoiceTranscriptPath(
  workspacePath: string,
  request: DesktopChannelContextImportRequest,
): string | null {
  const requestedPath = (request.voiceTranscriptPath || request.snapshotPath || "").trim();
  const candidatePath = requestedPath
    ? resolve(workspacePath, requestedPath)
    : resolve(workspacePath, DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, candidatePath)) return null;
  if (!existsSync(candidatePath)) return null;
  return candidatePath;
}

function normalizeVoiceTranscriptItems(
  workspacePath: string,
  transcriptPath: string,
  parsed: unknown,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const records = getWorkspaceConnectorSnapshotRecords(parsed, [
    "items",
    "transcripts",
    "utterances",
  ]);
  const normalizedRecords = records.length > 0 ? records : [parsed];
  const items = normalizedRecords
    .map((record, index) =>
      createVoiceTranscriptItem(workspacePath, transcriptPath, record, index),
    )
    .filter((item): item is DesktopChannelContextItem => Boolean(item))
    .slice(0, limit);
  return { items, truncated: normalizedRecords.length > items.length };
}

function createVoiceTranscriptItem(
  workspacePath: string,
  transcriptPath: string,
  record: unknown,
  index: number,
): DesktopChannelContextItem | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const title = clampSingleLine(
    getSnapshotString(item, "title") ||
      getSnapshotString(item, "name") ||
      `Voice transcript ${index + 1}`,
    240,
  );
  const speaker = getSnapshotString(item, "speaker") || getSnapshotString(item, "source");
  const language = getSnapshotString(item, "language") || getSnapshotString(item, "locale");
  const capturedAt =
    getSnapshotString(item, "capturedAt") ||
    getSnapshotString(item, "createdAt") ||
    getSnapshotString(item, "timestamp");
  const durationSeconds =
    getSnapshotNumber(item, "durationSeconds") || getSnapshotNumber(item, "duration");
  const body = clampMultiline(
    getSnapshotString(item, "transcript") ||
      getSnapshotString(item, "text") ||
      getSnapshotString(item, "body") ||
      getSnapshotString(item, "content") ||
      "No transcript text was provided.",
    MAX_TEXT_BYTES,
    "Voice transcript text is required.",
  );
  const relativePath = relative(workspacePath, transcriptPath).split(sep).join("/");
  const suffix = `voice-${index + 1}`;
  const summary = [
    `Voice transcript: ${title}`,
    speaker ? `Speaker: ${speaker}` : "",
    language ? `Language: ${language}` : "",
    capturedAt ? `Captured: ${capturedAt}` : "",
    durationSeconds ? `Duration: ${durationSeconds}s` : "",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_BYTES);
  return {
    id: `voice-input:${suffix}`,
    adapterId: "voice-input",
    provider: "voice" as DesktopChannelAdapterProvider,
    kind: "voice_transcript",
    title,
    path: `${transcriptPath}#${suffix}`,
    relativePath: `${relativePath}#${suffix}`,
    summary,
    mime: extname(transcriptPath).toLowerCase() === ".json" ? "application/json" : "text/plain",
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function listWorkspaceConnections(workspacePath: string): DesktopChannelConnection[] {
  const store = readChannelConnectionStore();
  return (store.workspaces[workspaceKey(workspacePath)] ?? []).filter(isConnection);
}

function upsertWorkspaceConnection(connection: DesktopChannelConnection): void {
  const store = readChannelConnectionStore();
  const key = workspaceKey(connection.workspacePath);
  const existing = store.workspaces[key] ?? [];
  store.workspaces[key] = [
    connection,
    ...existing.filter((item) => item.adapterId !== connection.adapterId),
  ];
  writeChannelConnectionStore(store);
}

function touchWorkspaceConnectionImport(
  connection: DesktopChannelConnection,
  importedAt: string,
): void {
  upsertWorkspaceConnection({
    ...connection,
    updatedAt: importedAt,
    lastImportAt: importedAt,
  });
}

function readChannelConnectionStore(): ChannelConnectionStore {
  try {
    const parsed = JSON.parse(readFileSync(CHANNEL_CONNECTIONS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ChannelConnectionStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ChannelConnectionStore["workspaces"] = {};
    for (const [key, connections] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(connections)) continue;
      const valid = connections.filter(isConnection);
      if (valid.length) workspaces[key] = valid;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

function writeChannelConnectionStore(store: ChannelConnectionStore): void {
  mkdirSync(dirname(CHANNEL_CONNECTIONS_FILE), { recursive: true });
  writeFileSync(CHANNEL_CONNECTIONS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function appendChannelDelivery(delivery: DesktopChannelOutboundDelivery): void {
  const store = readChannelDeliveryStore();
  const key = delivery.workspacePath ? workspaceKey(delivery.workspacePath) : "global";
  const existing = store.workspaces[key] ?? [];
  store.workspaces[key] = [
    delivery,
    ...existing.filter((item) => item.id !== delivery.id),
  ].slice(0, MAX_DELIVERIES_PER_WORKSPACE);
  writeChannelDeliveryStore(store);
}

function recordChannelContextImport(
  result: DesktopChannelContextImportResult,
  options?: { stableEventId?: boolean },
): DesktopChannelContextImportResult {
  if (result.items.length === 0) return result;
  const event = createChannelInboundEvent(result, options);
  const store = readChannelInboundEventStore();
  const key = workspaceKey(result.workspacePath);
  const existing = store.workspaces[key] ?? [];
  const existingEvent = existing.find((item) => item.id === event.id);
  const nextEvent =
    options?.stableEventId && existingEvent
      ? {
          ...event,
          status: existingEvent.status,
          receivedAt: existingEvent.receivedAt,
        }
      : event;
  store.workspaces[key] = [
    nextEvent,
    ...existing.filter((item) => item.id !== nextEvent.id),
  ].slice(0, MAX_INBOUND_EVENTS_PER_WORKSPACE);
  writeChannelInboundEventStore(store);
  return result;
}

function createChannelInboundEvent(
  result: DesktopChannelContextImportResult,
  options?: { stableEventId?: boolean },
): DesktopChannelInboundEvent {
  const adapter = CHANNEL_ADAPTERS.find((item) => item.id === result.adapterId);
  const provider = adapter?.provider ?? result.items[0]?.provider ?? "file_upload";
  const title = `${adapter?.name ?? result.adapterId} inbound context`;
  const summary = result.items
    .slice(0, 3)
    .map((item) => `${item.title}: ${item.summary}`)
    .join("\n");
  const idParts = [
    "channel-inbound",
    result.adapterId,
    hashApprovalPart(result.workspacePath),
    options?.stableEventId ? "snapshot-sync" : hashApprovalPart(result.importedAt),
    hashApprovalPart(result.items.map((item) => item.id).join("|")),
  ];
  return {
    id: idParts.join(":"),
    adapterId: result.adapterId,
    provider,
    workspacePath: result.workspacePath,
    status: "queued",
    title,
    summary,
    receivedAt: result.importedAt,
    updatedAt: result.importedAt,
    itemCount: result.items.length,
    items: result.items,
    verification:
      "Inbound channel event is a local reviewed context handoff; routing to chat still requires an explicit user action.",
  };
}

function inboundEventToImportResult(
  event: DesktopChannelInboundEvent,
): DesktopChannelContextImportResult {
  return {
    adapterId: event.adapterId,
    workspacePath: event.workspacePath,
    importedAt: event.receivedAt,
    items: event.items,
    truncated: false,
    message: `${event.title} contains ${event.itemCount} reviewed context item(s).`,
    verification: event.verification,
  };
}

function readChannelDeliveryStore(): ChannelDeliveryStore {
  try {
    const parsed = JSON.parse(readFileSync(CHANNEL_DELIVERIES_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ChannelDeliveryStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ChannelDeliveryStore["workspaces"] = {};
    for (const [key, deliveries] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(deliveries)) continue;
      const valid = deliveries.filter(isChannelDelivery);
      if (valid.length) workspaces[key] = valid;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

function writeChannelDeliveryStore(store: ChannelDeliveryStore): void {
  mkdirSync(dirname(CHANNEL_DELIVERIES_FILE), { recursive: true });
  writeFileSync(CHANNEL_DELIVERIES_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function readChannelInboundEventStore(): ChannelInboundEventStore {
  try {
    const parsed = JSON.parse(readFileSync(CHANNEL_INBOUND_EVENTS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ChannelInboundEventStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ChannelInboundEventStore["workspaces"] = {};
    for (const [key, events] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(events)) continue;
      const valid = events.filter(isChannelInboundEvent);
      if (valid.length) workspaces[key] = valid;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

function writeChannelInboundEventStore(store: ChannelInboundEventStore): void {
  mkdirSync(dirname(CHANNEL_INBOUND_EVENTS_FILE), { recursive: true });
  writeFileSync(CHANNEL_INBOUND_EVENTS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function readChannelLogCursorStore(): ChannelLogCursorStore {
  try {
    const parsed = JSON.parse(readFileSync(CHANNEL_LOG_CURSORS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ChannelLogCursorStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ChannelLogCursorStore["workspaces"] = {};
    for (const [key, cursorMap] of Object.entries(rawWorkspaces)) {
      if (!cursorMap || typeof cursorMap !== "object" || Array.isArray(cursorMap)) continue;
      const validEntries: Record<string, ChannelLogCursorEntry> = {};
      for (const [relativePath, cursor] of Object.entries(cursorMap)) {
        if (isChannelLogCursorEntry(cursor)) {
          validEntries[relativePath] = cursor;
        }
      }
      if (Object.keys(validEntries).length > 0) {
        workspaces[key] = validEntries;
      }
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

function writeChannelLogCursorStore(store: ChannelLogCursorStore): void {
  mkdirSync(dirname(CHANNEL_LOG_CURSORS_FILE), { recursive: true });
  writeFileSync(CHANNEL_LOG_CURSORS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function readGitRemote(workspacePath: string): {
  remoteUrl: string;
  owner?: string;
  repository?: string;
} {
  const remoteUrl = readGitValue(workspacePath, ["remote", "get-url", "origin"]);
  if (!remoteUrl) {
    throw new Error("GitHub connector needs a local Git repository with an origin remote.");
  }
  return {
    remoteUrl,
    ...parseGitHubRemote(remoteUrl),
  };
}

function readGitValue(workspacePath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", workspacePath, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 256 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

function parseGitHubRemote(remoteUrl: string): { owner?: string; repository?: string } {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/i);
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  const match = httpsMatch || sshMatch;
  if (!match) return {};
  return {
    owner: match[1],
    repository: `${match[1]}/${match[2]}`,
  };
}

function resolveWorkspacePath(workspacePath: string): string {
  const rawPath = sanitizeWorkspacePath(workspacePath);
  if (!rawPath) {
    throw new Error("Workspace path is required for channel context import.");
  }
  const resolved = resolve(rawPath);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("Workspace path does not exist or is not a directory.");
  }
  return resolved;
}

function sanitizeWorkspacePath(workspacePath: string): string {
  if (
    typeof workspacePath !== "string" ||
    !workspacePath.trim() ||
    workspacePath.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(workspacePath)
  ) {
    throw new Error("Channel adapter workspace path is invalid.");
  }
  return workspacePath.trim();
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return MAX_IMPORT_ITEMS;
  return Math.max(1, Math.min(MAX_IMPORT_ITEMS, Math.floor(Number(limit))));
}

function clampDeliveryLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(MAX_DELIVERIES_PER_WORKSPACE, Math.floor(Number(limit))));
}

function clampInboundEventLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(MAX_INBOUND_EVENTS_PER_WORKSPACE, Math.floor(Number(limit))));
}

function normalizeSnapshotSyncAdapterIds(adapterIds?: string[]): string[] {
  const requested = Array.isArray(adapterIds) && adapterIds.length > 0
    ? adapterIds
    : SNAPSHOT_SYNC_ADAPTER_IDS;
  return requested
    .map((adapterId) => clampSingleLine(adapterId, MAX_CONNECTION_LABEL_LENGTH))
    .filter((adapterId, index, all) =>
      SNAPSHOT_SYNC_ADAPTER_IDS.includes(adapterId) && all.indexOf(adapterId) === index,
    );
}

function normalizeCredentialState(
  value: unknown,
): "missing" | "placeholder" | "configured" {
  return value === "configured" || value === "placeholder" ? value : "missing";
}

function normalizeAuthScopes(
  adapter: DesktopChannelAdapter,
  scopes?: string[],
): string[] {
  const requested = Array.isArray(scopes) ? scopes : [];
  const normalized = requested
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (normalized.length > 0) return normalized;
  return {
    mobile: ["mobile:chat", "mobile:notify"],
    slack: ["channels:history", "chat:write"],
    github: ["repo:read", "issues:read", "pull_requests:read"],
    docs: ["documents.readonly", "documents.write.reviewed"],
    calendar: ["calendar.readonly", "calendar.events.reviewed"],
    database: [],
    file_upload: [],
    voice: [],
    telegram: [],
    discord: [],
  }[adapter.provider];
}

function getAuthTarget(provider: DesktopChannelAdapterProvider): {
  verificationUri: string;
} {
  return {
    mobile: { verificationUri: "drsai://mobile-pair" },
    slack: { verificationUri: "https://slack.com/oauth/v2/authorize" },
    github: { verificationUri: "https://github.com/login/device" },
    docs: { verificationUri: "https://accounts.google.com/o/oauth2/v2/auth" },
    calendar: { verificationUri: "https://accounts.google.com/o/oauth2/v2/auth" },
    database: { verificationUri: "drsai://database-snapshot" },
    file_upload: { verificationUri: "drsai://files" },
    voice: { verificationUri: "drsai://voice" },
    telegram: { verificationUri: "https://telegram.org" },
    discord: { verificationUri: "https://discord.com/oauth2/authorize" },
  }[provider];
}

function buildAuthUserCode(
  provider: DesktopChannelAdapterProvider,
  workspacePath: string,
  preparedAt: string,
): string {
  const prefix = provider.slice(0, 3).toUpperCase();
  const hash = hashApprovalPart(`${provider}:${workspacePath}:${preparedAt}`)
    .toUpperCase()
    .padEnd(8, "0")
    .slice(0, 8);
  return `${prefix}-${hash.slice(0, 4)}-${hash.slice(4)}`;
}

function scanWorkspaceImportCandidates(
  workspacePath: string,
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const items: DesktopChannelContextItem[] = [];
  let visited = 0;
  let truncated = false;

  function visit(directoryPath: string, depth: number): void {
    if (items.length >= limit) {
      truncated = true;
      return;
    }
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(directoryPath).sort((left, right) =>
        left.localeCompare(right),
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      if (items.length >= limit) {
        truncated = true;
        return;
      }
      visited += 1;
      if (visited > MAX_SCAN_ENTRIES) {
        truncated = true;
        return;
      }
      const candidatePath = resolve(directoryPath, entry);
      if (!isInsideWorkspace(workspacePath, candidatePath)) continue;
      let stats;
      try {
        const linkStats = lstatSync(candidatePath);
        if (linkStats.isSymbolicLink()) continue;
        stats = statSync(candidatePath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry)) {
          visit(candidatePath, depth + 1);
        }
        continue;
      }
      if (!stats.isFile()) continue;
      const extension = getImportExtension(candidatePath);
      if (!IMPORTABLE_EXTENSIONS.has(extension)) continue;
      items.push(createImportItem(workspacePath, candidatePath, stats.size));
    }
  }

  visit(workspacePath, 0);
  return { items, truncated };
}

function importExplicitFileCandidates(
  workspacePath: string,
  paths: string[],
  limit: number,
): { items: DesktopChannelContextItem[]; truncated: boolean } {
  const items: DesktopChannelContextItem[] = [];
  let truncated = paths.length > limit;
  for (const rawPath of paths) {
    if (items.length >= limit) break;
    const candidatePath = resolve(rawPath);
    if (!isInsideWorkspace(workspacePath, candidatePath)) {
      truncated = true;
      continue;
    }
    let stats;
    try {
      const linkStats = lstatSync(candidatePath);
      if (linkStats.isSymbolicLink()) {
        truncated = true;
        continue;
      }
      stats = statSync(candidatePath);
    } catch {
      truncated = true;
      continue;
    }
    if (!stats.isFile()) {
      truncated = true;
      continue;
    }
    const extension = getImportExtension(candidatePath);
    if (!IMPORTABLE_EXTENSIONS.has(extension)) {
      truncated = true;
      continue;
    }
    items.push(createImportItem(workspacePath, candidatePath, stats.size));
  }
  return { items, truncated };
}

function createImportItem(
  workspacePath: string,
  filePath: string,
  size: number,
): DesktopChannelContextItem {
  const relativePath = relative(workspacePath, filePath).split(sep).join("/");
  const extension = getImportExtension(filePath);
  const kind = getItemKind(extension);
  const summary = summarizeFile(workspacePath, filePath, kind, size);
  return {
    id: `file-input:${relativePath}`,
    adapterId: "file-input",
    provider: "file_upload",
    kind,
    title: basename(filePath),
    path: filePath,
    relativePath,
    summary,
    size,
    mime: getMime(extension),
    truncated: summary.length >= MAX_TEXT_BYTES,
  };
}

function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const relativePath = relative(workspacePath, candidatePath);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !resolve(candidatePath).startsWith(`${resolve(workspacePath)}${sep}..`)
  );
}

function getImportExtension(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  if (name === "codeowners") {
    return ".codeowners";
  }
  if (name === ".editorconfig") {
    return ".editorconfig";
  }
  if (name === ".gitattributes") {
    return ".gitattributes";
  }
  if (name === ".gitignore" || name.endsWith(".gitignore")) {
    return ".gitignore";
  }
  if (
    name === "license" ||
    name === "license.txt" ||
    name === "license.md" ||
    name === "copying" ||
    name === "copying.txt" ||
    name === "copying.md"
  ) {
    return ".license";
  }
  if (name === "notice" || name === "notice.txt" || name === "notice.md") {
    return ".notice";
  }
  if (name === ".npmrc" || name.endsWith(".npmrc")) {
    return ".npmrc";
  }
  if (name === ".yarnrc") {
    return ".yarnrc";
  }
  if (name === ".yarnrc.yml" || name === ".yarnrc.yaml") {
    return ".yarnrc.yml";
  }
  if (name === ".pnpmfile.cjs") {
    return ".pnpmfile.cjs";
  }
  if (name === ".npmignore") {
    return ".npmignore";
  }
  if (name === "composer.json") {
    return ".composer.json";
  }
  if (name === "gemfile") {
    return ".gemfile";
  }
  if (name === "mix.exs") {
    return ".mix.exs";
  }
  if (name === "mix.lock") {
    return ".mix.lock";
  }
  if (name === "stack.yaml" || name === "stack.yml") {
    return ".stack.yaml";
  }
  if (name === "package.yaml" || name === "package.yml") {
    return ".package.yaml";
  }
  if (name === "go.mod") {
    return ".go.mod";
  }
  if (name === "go.work") {
    return ".go.work";
  }
  if (name === "cmakelists.txt") {
    return ".cmakelists.txt";
  }
  if (name === "compile_commands.json") {
    return ".compile_commands.json";
  }
  if (["makefile", "gnumakefile", "bsdmakefile"].includes(name) || name.endsWith(".mk")) {
    return ".makefile";
  }
  if (name === "inventory" || name.endsWith(".inventory")) {
    return ".ansible-inventory";
  }
  if (name === ".env" || name.startsWith(".env.") || name.endsWith(".env.local")) {
    return ".env";
  }
  if (
    name === "dockerfile" ||
    name.startsWith("dockerfile.") ||
    name === "containerfile" ||
    name.startsWith("containerfile.")
  ) {
    return ".dockerfile";
  }
  if (name === ".dockerignore") {
    return ".dockerignore";
  }
  if (name === "pipfile") {
    return ".pipfile";
  }
  if (name === "robots.txt" || name.endsWith(".robots.txt")) {
    return ".robots.txt";
  }
  if (name === "sitemap.xml") {
    return ".sitemap.xml";
  }
  if (name === "sitemap.xml.gz") {
    return ".sitemap.xml.gz";
  }
  if (name.endsWith(".tar.gz")) {
    return ".tar.gz";
  }
  if (name.endsWith(".spdx.json")) {
    return ".spdx.json";
  }
  if (name.endsWith(".sarif.json")) {
    return ".sarif.json";
  }
  if (
    name === "snyk.json" ||
    name === "npm-audit.json" ||
    name === "audit-ci.json" ||
    name === "security-audit.json" ||
    name === "vulnerability-report.json" ||
    name.endsWith(".snyk.json") ||
    name.endsWith(".npm-audit.json") ||
    name.endsWith(".audit-ci.json") ||
    name.endsWith(".security-audit.json") ||
    name.endsWith(".vulnerability-report.json")
  ) {
    return ".security-audit.json";
  }
  if (name === "lcov.info" || name.endsWith(".lcov.info")) {
    return ".lcov";
  }
  if (
    name === "checkstyle.xml" ||
    name.endsWith(".checkstyle.xml") ||
    name.includes("checkstyle-result")
  ) {
    return ".checkstyle.xml";
  }
  if (name === "pmd.xml" || name.endsWith(".pmd.xml") || name.includes("pmd-result")) {
    return ".pmd.xml";
  }
  if (
    name === "spotbugs.xml" ||
    name.endsWith(".spotbugs.xml") ||
    name.includes("spotbugs-result") ||
    name.includes("findbugs-result")
  ) {
    return ".spotbugs.xml";
  }
  if (name.endsWith(".junit.xml")) {
    return ".junit.xml";
  }
  if (
    name.endsWith(".playwright.json") ||
    name.endsWith(".jest.json") ||
    name.endsWith(".vitest.json") ||
    name === "playwright-report.json" ||
    name === "test-results.json" ||
    name === "test-results-jest.json" ||
    name === "test-results-vitest.json"
  ) {
    return ".test-results.json";
  }
  if (
    name === "lhr.json" ||
    name === "lighthouse.json" ||
    name.endsWith(".lhr.json") ||
    name.endsWith(".lighthouse.json") ||
    name.endsWith("-lighthouse.json")
  ) {
    return ".lighthouse.json";
  }
  if (
    name === "trace.json" ||
    name.endsWith(".trace.json") ||
    name.endsWith("-trace.json") ||
    name.endsWith(".devtools.json")
  ) {
    return ".trace.json";
  }
  if (name.endsWith(".cdx.json")) {
    return ".cdx.json";
  }
  if (name.endsWith(".attestation.json")) {
    return ".attestation.json";
  }
  if (name.endsWith(".tf.json")) {
    return ".tf.json";
  }
  if (
    name === "azuredeploy.json" ||
    name === "arm-template.json" ||
    name.endsWith(".arm-template.json") ||
    name.endsWith(".azuredeploy.json")
  ) {
    return ".arm-template.json";
  }
  if (
    name === "cloudformation.json" ||
    name === "cfn-template.json" ||
    name.endsWith(".cloudformation.json") ||
    name.endsWith(".cfn.json")
  ) {
    return ".cloudformation.json";
  }
  if (
    name === "cloudformation.yaml" ||
    name === "cloudformation.yml" ||
    name === "sam-template.yaml" ||
    name === "sam-template.yml" ||
    name === "template.cfn.yaml" ||
    name === "template.cfn.yml" ||
    name.endsWith(".cloudformation.yaml") ||
    name.endsWith(".cloudformation.yml") ||
    name.endsWith(".cfn.yaml") ||
    name.endsWith(".cfn.yml")
  ) {
    return ".cloudformation.yaml";
  }
  if (
    name === "tfplan.json" ||
    name === "terraform-plan.json" ||
    name.endsWith(".tfplan.json") ||
    name.endsWith("-tfplan.json") ||
    name.endsWith(".terraform-plan.json") ||
    name.endsWith("-terraform-plan.json")
  ) {
    return ".tfplan.json";
  }
  if (name.endsWith(".gradle.kts")) {
    return ".gradle.kts";
  }
  if (name === "gradle.properties") {
    return ".gradle.properties";
  }
  if (name === "maven.config") {
    return ".maven.config";
  }
  if (name === "jvm.config") {
    return ".jvm.config";
  }
  if (name === "global.json") {
    return ".dotnet-global.json";
  }
  if (name === "nuget.config") {
    return ".nuget.config";
  }
  if (name === "packages.config") {
    return ".packages.config";
  }
  if (name.endsWith(".intoto.jsonl")) {
    return ".intoto.jsonl";
  }
  if (name === "uv.lock") {
    return ".uv.lock";
  }
  if (name === "pubspec.yaml" || name === "pubspec.yml") {
    return ".pubspec.yaml";
  }
  if (name === "pubspec.lock") {
    return ".pubspec.lock";
  }
  if (name === "chart.yaml" || name === "chart.yml") {
    return ".helm-chart.yaml";
  }
  if (name === "kustomization.yaml" || name === "kustomization.yml" || name === "kustomization") {
    return ".kustomization.yaml";
  }
  if (name === "package.swift") {
    return ".swift-package";
  }
  if (name === "podfile") {
    return ".podfile";
  }
  if (name === "podfile.lock") {
    return ".podfile.lock";
  }
  if (name === "androidmanifest.xml") {
    return ".androidmanifest.xml";
  }
  if (name === "info.plist") {
    return ".info.plist";
  }
  if (name === "sha256sums" || name === "sha512sums" || name === "checksums" || name === "checksums.txt") {
    return ".checksum";
  }
  return extname(filePath).toLowerCase();
}

function getItemKind(extension: string): DesktopChannelContextItem["kind"] {
  if ([".bmp", ".gif", ".ico", ".jpg", ".jpeg", ".png", ".svg", ".tif", ".tiff", ".webp"].includes(extension)) return "image";
  if ([".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extension)) return "audio";
  if ([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"].includes(extension)) return "video";
  if ([".srt", ".vtt"].includes(extension)) return "voice_transcript";
  if (extension === ".ics" || extension === ".ical") return "meeting";
  if ([".db", ".sqlite", ".sqlite3", ".sql"].includes(extension)) return "database_table";
  if (
    [
      ".7z",
      ".aab",
      ".apk",
      ".androidmanifest.xml",
      ".info.plist",
      ".atom",
      ".arrow",
      ".appx",
      ".appxmanifest",
      ".appxbundle",
      ".blg",
      ".cabal",
      ".cat",
      ".cfg",
      ".checkstyle.xml",
      ".cmake",
      ".cmakelists.txt",
      ".codeowners",
      ".compile_commands.json",
      ".csproj",
      ".doc",
      ".docm",
      ".docx",
      ".dotnet-global.json",
      ".dot",
      ".drawio",
      ".dmp",
      ".dwg",
      ".dxf",
      ".eml",
      ".epub",
      ".etl",
      ".evtx",
      ".editorconfig",
      ".feather",
      ".fsproj",
      ".htm",
      ".html",
      ".geojson",
      ".glb",
      ".gltf",
      ".gitattributes",
      ".gitignore",
      ".gradle",
      ".gradle.kts",
      ".gradle.properties",
      ".gv",
      ".gpx",
      ".h5",
      ".hdf5",
      ".helm-chart.yaml",
      ".hdmp",
      ".inf",
      ".jvm.config",
      ".markdown",
      ".man",
      ".maven.config",
      ".mat",
      ".mbox",
      ".md",
      ".mermaid",
      ".mdmp",
      ".mhtml",
      ".metrics",
      ".mmd",
      ".mix.exs",
      ".mix.lock",
      ".msi",
      ".msix",
      ".msixbundle",
      ".msg",
      ".nc",
      ".notice",
      ".nuget.config",
      ".odp",
      ".ods",
      ".odt",
      ".nuspec",
      ".otf",
      ".obj",
      ".openmetrics",
      ".package.yaml",
      ".packages.config",
      ".pipfile",
      ".pdf",
      ".parquet",
      ".podfile",
      ".podfile.lock",
      ".podspec",
      ".pmd.xml",
      ".ppt",
      ".pptm",
      ".pptx",
      ".prom",
      ".proto",
      ".props",
      ".puml",
      ".plantuml",
      ".rar",
      ".reg",
      ".robots.txt",
      ".rss",
      ".rtf",
      ".sarif",
      ".sarif.json",
      ".security-audit.json",
      ".spotbugs.xml",
      ".junit.xml",
      ".kustomization.yaml",
      ".lighthouse.json",
      ".test-results.json",
      ".trace.json",
      ".sln",
      ".sitemap.xml",
      ".sitemap.xml.gz",
      ".ipa",
      ".ipynb",
      ".stack.yaml",
      ".kml",
      ".lcov",
      ".license",
      ".lnk",
      ".makefile",
      ".stl",
      ".gz",
      ".swift-package",
      ".tap",
      ".tap13",
      ".task",
      ".tar",
      ".tar.gz",
      ".targets",
      ".tgz",
      ".topojson",
      ".trx",
      ".ttf",
      ".url",
      ".uv.lock",
      ".vcard",
      ".vcf",
      ".vbproj",
      ".wer",
      ".webloc",
      ".woff",
      ".woff2",
      ".wprp",
      ".xls",
      ".xlsm",
      ".xlsx",
      ".zip",
    ].includes(
      extension,
    )
  ) return "document";
  return "file";
}

function summarizeFile(
  workspacePath: string,
  filePath: string,
  kind: DesktopChannelContextItem["kind"],
  size: number,
): string {
  const extension = getImportExtension(filePath);
  if (isRepositoryGovernanceFile(filePath, extension)) {
    return summarizeRepositoryGovernanceFile(filePath, extension, size);
  }
  if (kind === "image") {
    return summarizeImage(filePath, extension, size);
  }
  if (kind === "audio") {
    return summarizeAudio(filePath, extension, size);
  }
  if (kind === "video") {
    return summarizeVideo(filePath, extension, size);
  }
  if (kind === "voice_transcript") {
    return summarizeTimedTranscript(filePath, extension, size);
  }
  if (extension === ".ics" || extension === ".ical") {
    return summarizeCalendarIcsFile(filePath, size);
  }
  if (extension === ".lnk") {
    return summarizeWindowsShortcutFile(filePath, size);
  }
  if (extension === ".reg") {
    return summarizeRegistryExportFile(filePath, size);
  }
  if (extension === ".evtx") {
    return summarizeWindowsEventLogFile(filePath, size);
  }
  if (extension === ".etl") {
    return summarizeWindowsEtlTraceFile(filePath, size);
  }
  if (extension === ".blg") {
    return summarizeWindowsPerformanceLogFile(filePath, size);
  }
  if (extension === ".wprp") {
    return summarizeWindowsPerformanceRecorderProfile(filePath, size);
  }
  if (extension === ".man" || (extension === ".xml" && looksLikeWindowsEtwProviderManifestXml(filePath))) {
    return summarizeWindowsEtwProviderManifestFile(filePath, extension, size);
  }
  if (isTestReportFile(filePath, extension)) {
    return summarizeTestReportFile(filePath, extension, size);
  }
  if (isStaticAnalysisXmlReportFile(filePath, extension)) {
    return summarizeStaticAnalysisXmlReportFile(filePath, extension, size);
  }
  if (isWindowsCrashDumpExtension(extension)) {
    return summarizeWindowsCrashDumpFile(filePath, extension, size);
  }
  if (extension === ".wer") {
    return summarizeWindowsErrorReportFile(filePath, size);
  }
  if (isWindowsInstallerPackageExtension(extension)) {
    return summarizeWindowsInstallerPackageFile(filePath, extension, size);
  }
  if (isWindowsDriverPackageExtension(extension)) {
    return summarizeWindowsDriverPackageFile(filePath, extension, size);
  }
  if ([".url", ".webloc"].includes(extension)) {
    return summarizeLinkShortcutFile(filePath, extension, size);
  }
  if (isThreeDModelExtension(extension)) {
    return summarizeThreeDModelFile(filePath, extension, size);
  }
  if (isWebCrawlMetadataFile(extension)) {
    return summarizeWebCrawlMetadataFile(filePath, extension, size);
  }
  if (isAndroidManifestFile(filePath, extension)) {
    return summarizeAndroidManifestFile(filePath, size);
  }
  if (isAppleInfoPlistFile(filePath, extension)) {
    return summarizeAppleInfoPlistFile(filePath, size);
  }
  if (isMobileAppPackageExtension(extension)) {
    return summarizeMobileAppPackageFile(filePath, extension, size);
  }
  if ([".xlsx", ".xlsm"].includes(extension)) {
    return summarizeXlsxDataFile(filePath, extension, size);
  }
  if (extension === ".zip") {
    return summarizeZipArchiveFile(filePath, size);
  }
  if (extension === ".tar") {
    return summarizeTarArchiveFile(filePath, size);
  }
  if ([".gz", ".tar.gz", ".tgz"].includes(extension)) {
    return summarizeGzipArchiveFile(filePath, extension, size);
  }
  if (extension === ".7z") {
    return summarizeSevenZipArchiveFile(filePath, size);
  }
  if (extension === ".rar") {
    return summarizeRarArchiveFile(filePath, size);
  }
  if ([".otf", ".ttf", ".woff", ".woff2"].includes(extension)) {
    return summarizeFontFile(filePath, extension, size);
  }
  if (kind === "database_table" && [".db", ".sqlite", ".sqlite3"].includes(extension)) {
    return summarizeSqliteDatabaseFile(filePath, size);
  }
  if (kind === "database_table" && extension === ".sql") {
    return summarizeSqlScriptFile(filePath, size);
  }
  if (isDiagramSourceExtension(extension)) {
    return summarizeDiagramSourceFile(filePath, extension, size);
  }
  if (isDotnetNugetConfigFile(filePath, extension)) {
    return summarizeDotnetNugetConfigFile(filePath, extension, size);
  }
  if (isBuildManifestFile(filePath, extension)) {
    return summarizeBuildManifestFile(filePath, extension, size);
  }
  if (isCppBuildManifestFile(filePath, extension)) {
    return summarizeCppBuildManifestFile(filePath, extension, size);
  }
  if (isCoverageReportFile(filePath, extension)) {
    return summarizeCoverageReportFile(filePath, extension, size);
  }
  if (isWindowsScheduledTaskFile(extension) || (extension === ".xml" && looksLikeWindowsScheduledTaskXml(filePath))) {
    return summarizeWindowsScheduledTaskFile(filePath, extension, size);
  }
  if (extension === ".xml" && looksLikeTestReportXml(filePath)) {
    return summarizeTestReportFile(filePath, extension, size);
  }
  if (isJvmBuildConfigFile(filePath, extension)) {
    return summarizeJvmBuildConfigFile(filePath, extension, size);
  }
  if (isJavaBuildArtifactExtension(extension)) {
    return summarizeJavaBuildArtifactFile(filePath, extension, size);
  }
  if (isScientificContainerExtension(extension)) {
    return summarizeScientificContainerFile(filePath, extension, size);
  }
  if (isNodePackageManagerConfigFile(filePath, extension)) {
    return summarizeNodePackageManagerConfigFile(filePath, extension, size);
  }
  if (isCargoManifestFile(filePath, extension)) {
    return summarizeCargoManifestFile(filePath, size);
  }
  if (isDartPubspecManifestFile(filePath, extension)) {
    return summarizeDartPubspecManifestFile(filePath, extension, size);
  }
  if (isApplePackageManifestFile(filePath, extension)) {
    return summarizeApplePackageManifestFile(filePath, extension, size);
  }
  if (isPhpRubyPackageManifestFile(filePath, extension)) {
    return summarizePhpRubyPackageManifestFile(filePath, extension, size);
  }
  if (isElixirHaskellPackageManifestFile(filePath, extension)) {
    return summarizeElixirHaskellPackageManifestFile(filePath, extension, size);
  }
  if (isPythonDependencyManifestFile(filePath, extension)) {
    return summarizePythonDependencyManifestFile(filePath, extension, size);
  }
  if (isGoModuleManifestFile(filePath, extension)) {
    return summarizeGoModuleManifestFile(filePath, extension, size);
  }
  if (isKubernetesPackageConfigFile(filePath, extension)) {
    return summarizeKubernetesPackageConfigFile(filePath, extension, size);
  }
  if (isDependencyLockfile(filePath, extension)) {
    return summarizeDependencyLockfile(filePath, extension, size);
  }
  if (extension === ".graphql" || extension === ".gql") {
    return summarizeGraphqlFile(filePath, size);
  }
  if (extension === ".http" || extension === ".rest") {
    return summarizeRestClientRequestFile(filePath, size);
  }
  if (isDevtoolsTraceFile(filePath, extension)) {
    return summarizeDevtoolsTraceFile(filePath, size);
  }
  if (isLighthouseReportFile(filePath, extension)) {
    return summarizeLighthouseReportFile(filePath, size);
  }
  if (extension === ".bru") {
    return summarizeBrunoCollectionFile(filePath, size);
  }
  if (extension === ".proto") {
    return summarizeProtobufSchemaFile(filePath, size);
  }
  if (isSarifResultFile(filePath, extension)) {
    return summarizeSarifResultFile(filePath, extension, size);
  }
  if (isSecurityScanReportFile(filePath, extension)) {
    return summarizeSecurityScanReportFile(filePath, extension, size);
  }
  if (isSbomProvenanceArtifact(filePath, extension)) {
    return summarizeSbomProvenanceArtifact(filePath, extension, size);
  }
  if (isSecurityArtifactExtension(extension)) {
    return summarizeSecurityArtifactFile(filePath, extension, size);
  }
  if (isBinaryArtifactExtension(extension)) {
    return summarizeBinaryArtifactFile(filePath, extension, size);
  }
  if (isGeospatialExtension(extension)) {
    return summarizeGeospatialFile(filePath, extension, size);
  }
  if (isCadDrawingExtension(extension)) {
    return summarizeCadDrawingFile(filePath, extension, size);
  }
  if (isIacConfigExtension(extension)) {
    return summarizeIacConfigFile(filePath, extension, size);
  }
  if (isTerraformPlanJsonFile(extension)) {
    return summarizeTerraformPlanJsonFile(filePath, size);
  }
  if (isCloudIacTemplateFile(filePath, extension)) {
    return summarizeCloudIacTemplateFile(filePath, extension, size);
  }
  if ((extension === ".yaml" || extension === ".yml") && detectCiWorkflowKind(filePath)) {
    return summarizeConfigOrLogFile(filePath, extension, size);
  }
  if (isAnsibleAutomationFile(filePath, extension)) {
    return summarizeAnsibleAutomationFile(filePath, extension, size);
  }
  if (isStylesheetFile(extension)) {
    return summarizeStylesheetFile(filePath, extension, size);
  }
  if (isMetricsSnapshotFile(extension)) {
    return summarizeMetricsSnapshotFile(filePath, extension, size);
  }
  if (isColumnarDataExtension(extension)) {
    return summarizeColumnarDataFile(filePath, extension, size);
  }
  if (isFeedDocumentExtension(extension) || (extension === ".xml" && looksLikeFeedXml(filePath))) {
    return summarizeFeedDocumentFile(filePath, extension, size);
  }
  if (extension === ".ipynb") {
    return summarizeNotebook(filePath, size);
  }
  if (extension === ".csv" || extension === ".tsv") {
    return summarizeCsvDataFile(filePath, size, extension);
  }
  if (extension === ".har") {
    return summarizeHarNetworkTraceFile(filePath, size);
  }
  if (extension === ".pcap" || extension === ".pcapng") {
    return summarizePacketCaptureFile(filePath, extension, size);
  }
  if (extension === ".json") {
    if (isSarifResultFile(filePath, extension)) {
      return summarizeSarifResultFile(filePath, extension, size);
    }
    if (isSecurityScanReportFile(filePath, extension)) {
      return summarizeSecurityScanReportFile(filePath, extension, size);
    }
    if (isSbomProvenanceArtifact(filePath, extension)) {
      return summarizeSbomProvenanceArtifact(filePath, extension, size);
    }
    if (isDependencyLockfile(filePath, extension)) {
      return summarizeDependencyLockfile(filePath, extension, size);
    }
    if (isNodePackageManifestFile(filePath, extension)) {
      return summarizeNodePackageManifestFile(filePath, size);
    }
    if (isLighthouseReportFile(filePath, extension)) {
      return summarizeLighthouseReportFile(filePath, size);
    }
    if (isCloudIacTemplateFile(filePath, extension)) {
      return summarizeCloudIacTemplateFile(filePath, extension, size);
    }
    const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size);
    if (apiSpecPreview) return apiSpecPreview;
    const postmanEnvironmentPreview = summarizePostmanEnvironmentFile(filePath, size);
    if (postmanEnvironmentPreview) return postmanEnvironmentPreview;
    const kubernetesPreview = summarizeKubernetesManifestFile(filePath, extension, size);
    if (kubernetesPreview) return kubernetesPreview;
    return summarizeJsonDataFile(filePath, size);
  }
  if (extension === ".jsonl" || extension === ".ndjson") {
    return summarizeJsonLinesDataFile(filePath, extension, size);
  }
  if (extension === ".yaml" || extension === ".yml") {
    if (isContainerComposeFile(filePath, extension)) {
      return summarizeContainerComposeFile(filePath, size);
    }
    if (isCloudIacTemplateFile(filePath, extension)) {
      return summarizeCloudIacTemplateFile(filePath, extension, size);
    }
    const apiSpecPreview = summarizeApiSpecFile(filePath, extension, size);
    if (apiSpecPreview) return apiSpecPreview;
    const kubernetesPreview = summarizeKubernetesManifestFile(filePath, extension, size);
    if (kubernetesPreview) return kubernetesPreview;
    return summarizeConfigOrLogFile(filePath, extension, size);
  }
  if (isPatchDiffExtension(extension)) {
    return summarizePatchDiffFile(workspacePath, filePath, extension, size);
  }
  if (isPowerShellScriptExtension(extension)) {
    return summarizePowerShellScriptFile(filePath, extension, size);
  }
  if (isBatchScriptExtension(extension)) {
    return summarizeBatchScriptFile(filePath, extension, size);
  }
  if (isSourceCodeExtension(extension)) {
    return summarizeSourceCodeFile(filePath, extension, size);
  }
  if (extension === ".dockerfile") {
    return summarizeContainerBuildFile(filePath, size);
  }
  if (extension === ".dockerignore") {
    return summarizeDockerignoreFile(filePath, size);
  }
  if (isConfigOrLogExtension(extension)) {
    return summarizeConfigOrLogFile(filePath, extension, size);
  }
  if (kind === "document" && extension !== ".ipynb") {
    if (extension === ".eml") {
      return summarizeEmailMessage(filePath, size);
    }
    if (extension === ".mbox") {
      return summarizeMailboxArchive(filePath, size);
    }
    if (extension === ".msg") {
      return summarizeOutlookMsgFile(filePath, size);
    }
    if ([".vcf", ".vcard"].includes(extension)) {
      return summarizeVCardFile(filePath, size);
    }
    if ([".html", ".htm"].includes(extension) && looksLikeBrowserBookmarkExport(filePath)) {
      return summarizeBrowserBookmarkExportFile(filePath, size);
    }
    const documentText = summarizeDocumentText(filePath, extension, size);
    if (documentText) {
      return [
        `Document text preview (${formatBytes(size)}).`,
        documentText,
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return `Document file ready for explicit attachment after visible review (${formatBytes(size)}). Basic document text extraction did not find readable text in this read-only importer.`;
  }
  try {
    const buffer = readFileSync(filePath, { encoding: "utf8", flag: "r" }).slice(
      0,
      MAX_TEXT_BYTES,
    );
    return buffer.replace(/\s+/g, " ").trim() || "Text file is empty.";
  } catch {
    return `File ready for explicit attachment (${formatBytes(size)}).`;
  }
}

function isConfigOrLogExtension(extension: string): boolean {
  return [".env", ".ini", ".log", ".toml", ".xml", ".yaml", ".yml"].includes(extension);
}

interface AndroidManifestPreview {
  packageName: string;
  versions: string[];
  sdk: string[];
  application: string[];
  permissions: string[];
  features: string[];
  components: string[];
  intentActions: string[];
  metadata: string[];
}

function isAndroidManifestFile(filePath: string, extension: string): boolean {
  return extension === ".androidmanifest.xml" || basename(filePath).toLowerCase() === "androidmanifest.xml";
}

function summarizeAndroidManifestFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_ANDROID_MANIFEST_PREVIEW_BYTES).toString("utf8");
    const preview = parseAndroidManifestPreview(raw);
    return [
      `Android app manifest preview (${formatBytes(size)}).`,
      `Package: ${preview.packageName || "none detected in the bounded local preview"}.`,
      preview.versions.length > 0 ? `Versions: ${preview.versions.join("; ")}.` : "Versions: none detected in the bounded local preview.",
      preview.sdk.length > 0 ? `SDK: ${preview.sdk.join("; ")}.` : "SDK: none detected in the bounded local preview.",
      preview.application.length > 0 ? `Application: ${preview.application.join("; ")}.` : "Application: none detected in the bounded local preview.",
      preview.permissions.length > 0
        ? `Permissions (${preview.permissions.length}${preview.permissions.length >= MAX_ANDROID_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${preview.permissions.join(", ")}.`
        : "Permissions: none detected in the bounded local preview.",
      preview.features.length > 0 ? `Features: ${preview.features.join(", ")}.` : "Features: none detected in the bounded local preview.",
      preview.components.length > 0
        ? `Components (${preview.components.length}${preview.components.length >= MAX_ANDROID_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${preview.components.join(" | ")}.`
        : "Components: none detected in the bounded local preview.",
      preview.intentActions.length > 0 ? `Intent actions: ${preview.intentActions.join(", ")}.` : "Intent actions: none detected in the bounded local preview.",
      preview.metadata.length > 0 ? `Metadata keys: ${preview.metadata.join(", ")}.` : "Metadata keys: none detected in the bounded local preview.",
      "Ready for explicit attachment after visible review; Android manifest metadata was parsed from bounded workspace-local XML only, manifest meta-data values were not expanded, and no Gradle/Android Studio/ADB/emulator/aapt/apksigner command, package install, device query, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Android app manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Android manifest preview could not parse bounded local XML; no Gradle/Android Studio/ADB/emulator/aapt/apksigner command, package install, device query, credential lookup, network call, or provider send was performed.",
    ].join("\n");
  }
}

function parseAndroidManifestPreview(raw: string): AndroidManifestPreview {
  const xml = raw.replace(/^\uFEFF/, "");
  const manifestAttrs = readXmlAttributes(xml.match(/<manifest\b([^>]*)>/i)?.[1] ?? "");
  const usesSdkAttrs = readXmlAttributes(xml.match(/<uses-sdk\b([^>]*)\/?>/i)?.[1] ?? "");
  const applicationAttrs = readXmlAttributes(xml.match(/<application\b([^>]*)>/i)?.[1] ?? "");
  return {
    packageName: sanitizeAndroidManifestValue(manifestAttrs.get("package") || ""),
    versions: [
      formatAndroidAttribute("versionName", manifestAttrs),
      formatAndroidAttribute("versionCode", manifestAttrs),
    ].filter((value) => value.length > 0),
    sdk: [
      formatAndroidAttribute("minSdkVersion", usesSdkAttrs),
      formatAndroidAttribute("targetSdkVersion", usesSdkAttrs),
      formatAndroidAttribute("maxSdkVersion", usesSdkAttrs),
    ].filter((value) => value.length > 0),
    application: [
      formatAndroidAttribute("label", applicationAttrs),
      formatAndroidAttribute("theme", applicationAttrs),
      formatAndroidAttribute("debuggable", applicationAttrs),
      formatAndroidAttribute("allowBackup", applicationAttrs),
      formatAndroidAttribute("networkSecurityConfig", applicationAttrs),
    ].filter((value) => value.length > 0),
    permissions: collectAndroidElementAttributes(xml, "uses-permission", (attrs) =>
      sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "name")),
    ),
    features: collectAndroidElementAttributes(xml, "uses-feature", (attrs) => {
      const name = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "name"));
      const required = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "required"));
      return name ? `${name}${required ? ` required=${required}` : ""}` : "";
    }),
    components: collectAndroidComponents(xml),
    intentActions: collectAndroidElementAttributes(xml, "action", (attrs) =>
      sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "name")),
    ),
    metadata: collectAndroidElementAttributes(xml, "meta-data", (attrs) =>
      sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "name")),
    ),
  };
}

function collectAndroidComponents(xml: string): string[] {
  const components: string[] = [];
  for (const tagName of ["activity", "activity-alias", "service", "receiver", "provider"]) {
    for (const value of collectAndroidElementAttributes(xml, tagName, (attrs) => {
      const name = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "name"));
      const exported = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "exported"));
      const permission = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, "permission"));
      if (!name) return "";
      return [
        `${tagName}=${name}`,
        exported ? `exported=${exported}` : "",
        permission ? `permission=${permission}` : "",
      ].filter((part) => part.length > 0).join(" ");
    })) {
      if (!components.includes(value)) components.push(value);
      if (components.length >= MAX_ANDROID_MANIFEST_ITEM_PREVIEW) return components;
    }
  }
  return components;
}

function collectAndroidElementAttributes(xml: string, tagName: string, formatter: (attrs: Map<string, string>) => string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<${escapeRegex(tagName)}\\b([^>]*)\\/?>`, "gi");
  for (const match of xml.matchAll(pattern)) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const value = clampSingleLine(formatter(attrs), 180);
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= MAX_ANDROID_MANIFEST_ITEM_PREVIEW) break;
  }
  return values;
}

function formatAndroidAttribute(name: string, attrs: Map<string, string>): string {
  const value = sanitizeAndroidManifestValue(readAndroidAttribute(attrs, name));
  return value ? `${name}=${value}` : "";
}

function readAndroidAttribute(attrs: Map<string, string>, name: string): string {
  return attrs.get(`android:${name}`) || attrs.get(name) || "";
}

function sanitizeAndroidManifestValue(value: string): string {
  return clampSingleLine(maskPotentialSecretValues(value), 140);
}

interface AppleInfoPlistPreview {
  bundle: string[];
  versions: string[];
  platforms: string[];
  urlSchemes: string[];
  capabilities: string[];
  backgroundModes: string[];
  usageKeys: string[];
  metadataKeys: string[];
  truncated: boolean;
}

function isAppleInfoPlistFile(filePath: string, extension: string): boolean {
  return extension === ".info.plist" || basename(filePath).toLowerCase() === "info.plist";
}

function summarizeAppleInfoPlistFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_APPLE_INFO_PLIST_PREVIEW_BYTES).toString("utf8");
    const preview = parseAppleInfoPlistPreview(raw);
    return [
      `Apple Info.plist app manifest preview (${formatBytes(size)}).`,
      preview.bundle.length > 0 ? `Bundle metadata: ${preview.bundle.join("; ")}.` : "Bundle metadata: none detected in the bounded local preview.",
      preview.versions.length > 0 ? `Versions/builds: ${preview.versions.join("; ")}.` : "Versions/builds: none detected in the bounded local preview.",
      preview.platforms.length > 0 ? `Platform hints: ${preview.platforms.join("; ")}.` : "Platform hints: none detected in the bounded local preview.",
      preview.urlSchemes.length > 0
        ? `URL schemes (${preview.urlSchemes.length}${preview.urlSchemes.length >= MAX_APPLE_INFO_PLIST_ITEM_PREVIEW ? "+" : ""}): ${preview.urlSchemes.join(", ")}.`
        : "URL schemes: none detected in the bounded local preview.",
      preview.capabilities.length > 0 ? `Device capabilities: ${preview.capabilities.join(", ")}.` : "Device capabilities: none detected in the bounded local preview.",
      preview.backgroundModes.length > 0 ? `Background modes: ${preview.backgroundModes.join(", ")}.` : "Background modes: none detected in the bounded local preview.",
      preview.usageKeys.length > 0 ? `Privacy usage keys: ${preview.usageKeys.join(", ")}.` : "Privacy usage keys: none detected in the bounded local preview.",
      preview.metadataKeys.length > 0 ? `Metadata keys: ${preview.metadataKeys.join(", ")}.` : "Metadata keys: none detected in the bounded local preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_APPLE_INFO_PLIST_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; Info.plist metadata was parsed from bounded workspace-local XML text only, privacy usage-description values were not expanded, binary plist data was not decoded, and no plutil/xcodebuild/simulator command, package install, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Apple Info.plist app manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Info.plist preview could not parse bounded local XML text; no plutil/xcodebuild/simulator command, package install, credential lookup, network call, or provider send was performed.",
    ].join("\n");
  }
}

function parseAppleInfoPlistPreview(raw: string): AppleInfoPlistPreview {
  const text = normalizeTextPreview(raw.replace(/^\uFEFF/, "")).slice(0, MAX_APPLE_INFO_PLIST_PREVIEW_BYTES);
  if (/^bplist/i.test(text.trim())) {
    return emptyAppleInfoPlistPreview(text.length >= MAX_APPLE_INFO_PLIST_PREVIEW_BYTES);
  }
  const bundle = [
    formatPlistKeyValue(text, "CFBundleIdentifier", "bundleId"),
    formatPlistKeyValue(text, "CFBundleName", "name"),
    formatPlistKeyValue(text, "CFBundleDisplayName", "displayName"),
    formatPlistKeyValue(text, "CFBundleExecutable", "executable"),
    formatPlistKeyValue(text, "CFBundlePackageType", "packageType"),
  ].filter(Boolean);
  const versions = [
    formatPlistKeyValue(text, "CFBundleShortVersionString", "shortVersion"),
    formatPlistKeyValue(text, "CFBundleVersion", "build"),
    formatPlistKeyValue(text, "MinimumOSVersion", "minimumOS"),
    formatPlistKeyValue(text, "DTPlatformVersion", "platformVersion"),
  ].filter(Boolean);
  const platforms = [
    formatPlistKeyValue(text, "DTPlatformName", "platform"),
    formatPlistKeyValue(text, "LSRequiresIPhoneOS", "requiresIPhoneOS"),
    formatPlistKeyValue(text, "UIApplicationSceneManifest", "sceneManifest"),
  ].filter(Boolean);
  return {
    bundle,
    versions,
    platforms,
    urlSchemes: collectApplePlistArrayValues(text, "CFBundleURLSchemes", MAX_APPLE_INFO_PLIST_ITEM_PREVIEW),
    capabilities: collectApplePlistArrayValues(text, "UIRequiredDeviceCapabilities", MAX_APPLE_INFO_PLIST_ITEM_PREVIEW),
    backgroundModes: collectApplePlistArrayValues(text, "UIBackgroundModes", MAX_APPLE_INFO_PLIST_ITEM_PREVIEW),
    usageKeys: collectAppleInfoPlistKeys(text, /^NS[A-Za-z0-9]+UsageDescription$/, MAX_APPLE_INFO_PLIST_ITEM_PREVIEW),
    metadataKeys: collectAppleInfoPlistKeys(text, /^(CFBundle|UIApplication|UIRequired|UIBackground|LSRequires|DTPlatform|MinimumOSVersion)/, MAX_APPLE_INFO_PLIST_ITEM_PREVIEW),
    truncated: text.length >= MAX_APPLE_INFO_PLIST_PREVIEW_BYTES,
  };
}

function emptyAppleInfoPlistPreview(truncated: boolean): AppleInfoPlistPreview {
  return {
    bundle: [],
    versions: [],
    platforms: [],
    urlSchemes: [],
    capabilities: [],
    backgroundModes: [],
    usageKeys: [],
    metadataKeys: [],
    truncated,
  };
}

function formatPlistKeyValue(xml: string, key: string, label: string): string {
  const value = firstApplePlistScalarValue(xml, key);
  return value ? `${label}=${value}` : "";
}

function firstApplePlistScalarValue(xml: string, key: string): string {
  const escapedKey = escapeRegex(key);
  const scalar = xml.match(new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<(string|integer|real|date)>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, "i"));
  if (scalar?.[2]) return sanitizeAppleInfoPlistValue(scalar[2]);
  const bool = xml.match(new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<(true|false)\\s*\\/>`, "i"));
  return bool?.[1] ? bool[1].toLowerCase() : "";
}

function collectApplePlistArrayValues(xml: string, key: string, limit: number): string[] {
  const escapedKey = escapeRegex(key);
  const arrayMatch = xml.match(new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`, "i"));
  if (!arrayMatch?.[1]) return [];
  const values: string[] = [];
  for (const valueMatch of arrayMatch[1].matchAll(/<(string|integer|real|date)>\s*([\s\S]*?)\s*<\/\1>/gi)) {
    const value = sanitizeAppleInfoPlistValue(valueMatch[2] ?? "");
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

function collectAppleInfoPlistKeys(xml: string, pattern: RegExp, limit: number): string[] {
  const keys: string[] = [];
  for (const match of xml.matchAll(/<key>\s*([\s\S]*?)\s*<\/key>/gi)) {
    const key = clampSingleLine(decodeXmlEntities(match[1] ?? "").trim(), 120);
    if (key && pattern.test(key) && !keys.includes(key)) keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

function sanitizeAppleInfoPlistValue(value: string): string {
  return clampSingleLine(maskPotentialSecretValues(decodeXmlEntities(value).trim()), 140);
}

function isMobileAppPackageExtension(extension: string): boolean {
  return [".apk", ".aab", ".ipa"].includes(extension);
}

function summarizeMobileAppPackageFile(filePath: string, extension: string, size: number): string {
  const packageLabel =
    extension === ".apk" ? "Android APK" : extension === ".aab" ? "Android App Bundle" : "iOS IPA";
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_MOBILE_APP_PACKAGE_PREVIEW_BYTES));
    const { entries, truncated } = readZipArchiveMetadata(buffer);
    const preview = buildMobileAppPackagePreview(entries, extension);
    return [
      `Mobile app package preview (${packageLabel}, ${formatBytes(size)}).`,
      `Archive entries in bounded local header scan: ${entries.length}${truncated ? "+" : ""}.`,
      preview.manifests.length > 0
        ? `Manifest candidates: ${preview.manifests.join(", ")}.`
        : "Manifest candidates: none found in the bounded local header scan.",
      preview.code.length > 0
        ? `Code/package artifacts: ${preview.code.join(", ")}.`
        : "Code/package artifacts: none detected in the bounded local header scan.",
      preview.resources.length > 0
        ? `Resource/asset cues: ${preview.resources.join(", ")}.`
        : "Resource/asset cues: none detected in the bounded local header scan.",
      preview.native.length > 0
        ? `Native/library cues: ${preview.native.join(", ")}.`
        : "Native/library cues: none detected in the bounded local header scan.",
      preview.signing.length > 0
        ? `Signing/provisioning cues: ${preview.signing.join(", ")}.`
        : "Signing/provisioning cues: none detected in the bounded local header scan.",
      preview.modules.length > 0
        ? `Module/bundle cues: ${preview.modules.join(", ")}.`
        : "Module/bundle cues: none detected in the bounded local header scan.",
      truncated ? `Preview was capped at ${formatBytes(MAX_MOBILE_APP_PACKAGE_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; mobile app package preview read bounded workspace-local ZIP headers only, did not extract package contents, decode binary manifests, verify signatures, install packages, launch Android/iOS tooling, contact devices/simulators, call networks, or send providers.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Mobile app package ready for explicit attachment (${packageLabel}, ${formatBytes(size)}).`,
      "Mobile app package preview could not parse bounded local ZIP headers; no package extraction, manifest decoding, signature verification, install, Android/iOS tooling, device/simulator access, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function buildMobileAppPackagePreview(
  entries: ChannelZipEntryMetadata[],
  extension: string,
): {
  manifests: string[];
  code: string[];
  resources: string[];
  native: string[];
  signing: string[];
  modules: string[];
} {
  const files = entries.filter((entry) => !entry.directory).map((entry) => entry.name.replace(/\\/g, "/"));
  const lowerFiles = files.map((name) => name.toLowerCase());
  const manifests = uniquePreviewValues(files.filter((name, index) => isMobileAppManifestEntry(name, lowerFiles[index], extension)), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  const code = uniquePreviewValues(files.filter((name, index) => isMobileAppCodeEntry(name, lowerFiles[index], extension)), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  const resources = uniquePreviewValues(files.filter((_, index) => isMobileAppResourceEntry(lowerFiles[index], extension)), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  const native = uniquePreviewValues(files.filter((name, index) => isMobileAppNativeEntry(name, lowerFiles[index], extension)), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  const signing = uniquePreviewValues(files.filter((name, index) => isMobileAppSigningEntry(name, lowerFiles[index], extension)), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  const modules = uniquePreviewValues(collectMobileAppModuleCues(files, extension), MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW);
  return { manifests, code, resources, native, signing, modules };
}

function isMobileAppManifestEntry(name: string, lowerName: string, extension: string): boolean {
  if (extension === ".ipa") return /^payload\/[^/]+\.app\/info\.plist$/i.test(name);
  return lowerName === "androidmanifest.xml" || /\/androidmanifest\.xml$/i.test(lowerName);
}

function isMobileAppCodeEntry(name: string, lowerName: string, extension: string): boolean {
  if (extension === ".ipa") {
    return /^payload\/[^/]+\.app\/[^/.]+$/i.test(name) || /^payload\/[^/]+\.app\/frameworks\/.+\.(?:framework|dylib)/i.test(name);
  }
  return /^classes\d*\.dex$/i.test(name) || lowerName.endsWith(".dex") || lowerName.endsWith(".so");
}

function isMobileAppResourceEntry(lowerName: string, extension: string): boolean {
  if (extension === ".ipa") {
    return lowerName.includes(".app/assets.car") || lowerName.includes(".app/base.lproj/") || lowerName.includes(".app/storyboardc/");
  }
  return (
    lowerName === "resources.arsc" ||
    lowerName.startsWith("res/") ||
    lowerName.startsWith("assets/") ||
    /\/res\//i.test(lowerName) ||
    /\/assets\//i.test(lowerName)
  );
}

function isMobileAppNativeEntry(name: string, lowerName: string, extension: string): boolean {
  if (extension === ".ipa") {
    return /^payload\/[^/]+\.app\/frameworks\//i.test(name) || lowerName.endsWith(".dylib");
  }
  return /^lib\/[^/]+\/.+\.so$/i.test(name) || /\/lib\/[^/]+\/.+\.so$/i.test(name);
}

function isMobileAppSigningEntry(name: string, lowerName: string, extension: string): boolean {
  if (extension === ".ipa") {
    return lowerName.endsWith("embedded.mobileprovision") || lowerName.includes("_codesignature/");
  }
  return /^meta-inf\/[^/]+\.(?:rsa|dsa|ec|sf|mf)$/i.test(name) || lowerName.includes("stamp-cert-sha256");
}

function collectMobileAppModuleCues(files: string[], extension: string): string[] {
  const modules = new Set<string>();
  for (const name of files) {
    const normalized = name.replace(/\\/g, "/");
    if (extension === ".ipa") {
      const appMatch = normalized.match(/^Payload\/([^/]+\.app)\//i);
      const pluginMatch = normalized.match(/^Payload\/[^/]+\.app\/PlugIns\/([^/]+)/i);
      const watchMatch = normalized.match(/^Payload\/[^/]+\.app\/Watch\/([^/]+)/i);
      if (appMatch?.[1]) modules.add(`app=${appMatch[1]}`);
      if (pluginMatch?.[1]) modules.add(`plugin=${pluginMatch[1]}`);
      if (watchMatch?.[1]) modules.add(`watch=${watchMatch[1]}`);
    } else {
      const moduleMatch = normalized.match(/^([^/]+)\/(?:manifest|dex|res|assets|lib)\//i);
      const splitConfigMatch = normalized.match(/^([^/]+)\/.+config\.[^/]+/i);
      if (moduleMatch?.[1] && moduleMatch[1] !== "META-INF") modules.add(moduleMatch[1]);
      if (splitConfigMatch?.[1]) modules.add(`${splitConfigMatch[1]} split-config`);
    }
    if (modules.size >= MAX_MOBILE_APP_PACKAGE_ITEM_PREVIEW) break;
  }
  return [...modules];
}

function isRepositoryGovernanceFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    extension === ".codeowners" ||
    extension === ".editorconfig" ||
    extension === ".gitattributes" ||
    extension === ".gitignore" ||
    extension === ".license" ||
    extension === ".notice" ||
    name === "codeowners" ||
    name === ".editorconfig" ||
    name === ".gitattributes" ||
    name === ".gitignore" ||
    name.endsWith(".gitignore") ||
    name === "license" ||
    name === "license.md" ||
    name === "license.txt" ||
    name === "copying" ||
    name === "copying.md" ||
    name === "copying.txt" ||
    name === "notice" ||
    name === "notice.md" ||
    name === "notice.txt"
  );
}

function summarizeRepositoryGovernanceFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(size, MAX_REPOSITORY_GOVERNANCE_PREVIEW_BYTES),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const lines = normalized.split("\n");
    const format = describeRepositoryGovernanceFile(filePath, extension);
    return [
      `Repository governance file preview (${format}, ${formatBytes(size)}).`,
      summarizeRepositoryOwnershipRules(lines, extension),
      summarizeRepositoryPolicyRules(lines, extension),
      summarizeRepositoryLicenseNotice(lines, extension),
      size > MAX_REPOSITORY_GOVERNANCE_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_REPOSITORY_GOVERNANCE_PREVIEW_BYTES)}.`
        : "",
      "Repository governance preview read bounded workspace-local text only; no git command, CODEOWNERS resolver, license compliance scanner, policy engine, filesystem mutation, network call, credential lookup, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Repository governance file ready for explicit attachment (${formatBytes(size)}).`,
      "No git command, CODEOWNERS resolver, license compliance scanner, policy engine, filesystem mutation, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describeRepositoryGovernanceFile(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".codeowners" || name === "codeowners") return "CODEOWNERS ownership rules";
  if (extension === ".editorconfig" || name === ".editorconfig") return "EditorConfig style policy";
  if (extension === ".gitattributes" || name === ".gitattributes") return "Git attributes policy";
  if (extension === ".gitignore" || name.endsWith(".gitignore")) return "Git ignore patterns";
  if (extension === ".license" || name.startsWith("license") || name.startsWith("copying")) return "license text";
  if (extension === ".notice" || name.startsWith("notice")) return "notice text";
  return "repository governance text";
}

function summarizeRepositoryOwnershipRules(lines: string[], extension: string): string {
  if (extension !== ".codeowners") return "";
  const rules = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return `${clampSingleLine(pattern, 80)} -> ${owners.slice(0, 4).map((owner) => clampSingleLine(owner, 80)).join(", ") || "owner not declared"}`;
    })
    .slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
  return rules.length > 0
    ? `Ownership rules (${rules.length}${rules.length >= MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW ? "+" : ""}): ${rules.join(" | ")}.`
    : "Ownership rules: none detected in the bounded preview.";
}

function summarizeRepositoryPolicyRules(lines: string[], extension: string): string {
  if (extension === ".editorconfig") {
    const sections = extractConfigSections(lines, ".ini").slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
    const keys = extractConfigKeys(lines, ".ini").slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
    return [
      sections.length > 0 ? `EditorConfig sections: ${sections.join(", ")}.` : "EditorConfig sections: none detected.",
      keys.length > 0 ? `EditorConfig properties: ${keys.join(", ")}.` : "EditorConfig properties: none detected.",
    ].join(" ");
  }
  if (extension === ".gitattributes") {
    const rules = lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => clampSingleLine(line, 120))
      .slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
    return rules.length > 0
      ? `Git attribute rules (${rules.length}${rules.length >= MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW ? "+" : ""}): ${rules.join(" | ")}.`
      : "Git attribute rules: none detected in the bounded preview.";
  }
  if (extension === ".gitignore") {
    const patterns = lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => clampSingleLine(line, 100))
      .slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
    return patterns.length > 0
      ? `Git ignore patterns (${patterns.length}${patterns.length >= MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW ? "+" : ""}): ${patterns.join(", ")}.`
      : "Git ignore patterns: none detected in the bounded preview.";
  }
  return "";
}

function summarizeRepositoryLicenseNotice(lines: string[], extension: string): string {
  if (extension !== ".license" && extension !== ".notice") return "";
  const text = lines.join("\n");
  const licenseHints = [
    /MIT License/i.test(text) ? "MIT" : "",
    /Apache License(?:,|\s+)Version 2\.0/i.test(text) ? "Apache-2.0" : "",
    /GNU GENERAL PUBLIC LICENSE/i.test(text) ? "GPL" : "",
    /GNU LESSER GENERAL PUBLIC LICENSE/i.test(text) ? "LGPL" : "",
    /Mozilla Public License/i.test(text) ? "MPL" : "",
    /BSD [23]-Clause/i.test(text) || /Redistribution and use in source and binary forms/i.test(text) ? "BSD-style" : "",
    /ISC License/i.test(text) ? "ISC" : "",
  ].filter(Boolean);
  const noticeLines = lines
    .map((line) => line.trim())
    .filter((line) => /copyright|notice|trademark|license/i.test(line))
    .map((line) => clampSingleLine(line, 140))
    .slice(0, MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW);
  return [
    licenseHints.length > 0 ? `License cues: ${licenseHints.join(", ")}.` : "License cues: none detected by local text matching.",
    noticeLines.length > 0
      ? `Notice/copyright lines (${noticeLines.length}${noticeLines.length >= MAX_REPOSITORY_GOVERNANCE_ITEM_PREVIEW ? "+" : ""}): ${noticeLines.join(" | ")}.`
      : "Notice/copyright lines: none detected in the bounded preview.",
  ].join(" ");
}

function isSourceCodeExtension(extension: string): boolean {
  return SOURCE_CODE_EXTENSIONS.has(extension);
}

function isStylesheetFile(extension: string): boolean {
  return [".css", ".scss", ".sass", ".less"].includes(extension);
}

function isPatchDiffExtension(extension: string): boolean {
  return extension === ".diff" || extension === ".patch";
}

function isFeedDocumentExtension(extension: string): boolean {
  return extension === ".rss" || extension === ".atom";
}

function isWebCrawlMetadataFile(extension: string): boolean {
  return extension === ".robots.txt" || extension === ".sitemap.xml" || extension === ".sitemap.xml.gz";
}

function isGeospatialExtension(extension: string): boolean {
  return extension === ".geojson" || extension === ".topojson" || extension === ".gpx" || extension === ".kml";
}

function isColumnarDataExtension(extension: string): boolean {
  return extension === ".parquet" || extension === ".arrow" || extension === ".feather";
}

function isScientificContainerExtension(extension: string): boolean {
  return extension === ".h5" || extension === ".hdf5" || extension === ".nc" || extension === ".mat";
}

function isIacConfigExtension(extension: string): boolean {
  return extension === ".tf" || extension === ".tf.json" || extension === ".tfvars" || extension === ".hcl";
}

function isTerraformPlanJsonFile(extension: string): boolean {
  return extension === ".tfplan.json";
}

function isCloudIacTemplateFile(filePath: string, extension: string): boolean {
  if ([".bicep", ".bicepparam", ".cloudformation.json", ".cloudformation.yaml", ".arm-template.json"].includes(extension)) {
    return true;
  }
  if (![".json", ".yaml", ".yml"].includes(extension)) return false;
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_CLOUD_IAC_TEMPLATE_PREVIEW_BYTES, 32 * 1024)).toString("utf8");
    return looksLikeCloudFormationTemplate(raw) || looksLikeArmTemplate(raw);
  } catch {
    return false;
  }
}

function isKubernetesPackageConfigFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    extension === ".helm-chart.yaml" ||
    extension === ".kustomization.yaml" ||
    name === "chart.yaml" ||
    name === "chart.yml" ||
    name === "kustomization.yaml" ||
    name === "kustomization.yml" ||
    name === "kustomization"
  );
}

function isAnsibleAutomationFile(filePath: string, extension: string): boolean {
  if (![".yaml", ".yml", ".ini", ".cfg", ".txt", ".ansible-inventory"].includes(extension)) return false;
  const name = basename(filePath).toLowerCase();
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  if (
    extension === ".ansible-inventory" ||
    name === "ansible.cfg" ||
    name.includes("playbook") ||
    normalizedPath.includes("/ansible/") ||
    /\/roles\/[^/]+\/(tasks|handlers|defaults|vars)\//.test(normalizedPath)
  ) {
    return true;
  }
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_ANSIBLE_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return looksLikeAnsiblePlaybook(raw) || looksLikeAnsibleInventory(raw);
  } catch {
    return false;
  }
}

function isThreeDModelExtension(extension: string): boolean {
  return extension === ".stl" || extension === ".obj" || extension === ".gltf" || extension === ".glb";
}

function isCadDrawingExtension(extension: string): boolean {
  return extension === ".dxf" || extension === ".dwg";
}

function isDiagramSourceExtension(extension: string): boolean {
  return [".drawio", ".dot", ".gv", ".mmd", ".mermaid", ".puml", ".plantuml"].includes(extension);
}

function isWindowsScheduledTaskFile(extension: string): boolean {
  return extension === ".task";
}

function isWindowsCrashDumpExtension(extension: string): boolean {
  return extension === ".dmp" || extension === ".mdmp" || extension === ".hdmp";
}

function isWindowsInstallerPackageExtension(extension: string): boolean {
  return (
    extension === ".msi" ||
    extension === ".msix" ||
    extension === ".appx" ||
    extension === ".appxmanifest" ||
    extension === ".msixbundle" ||
    extension === ".appxbundle"
  );
}

function isPythonDependencyManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    name === "pyproject.toml" ||
    name === "setup.py" ||
    name === "setup.cfg" ||
    name === "pipfile" ||
    name === "environment.yml" ||
    name === "environment.yaml" ||
    name === "conda-env.yml" ||
    name === "conda-env.yaml" ||
    name === "uv.lock" ||
    /^requirements(?:[-_.][a-z0-9_.-]+)?\.txt$/i.test(name) ||
    (extension === ".txt" && name.includes("requirements"))
  );
}

function isGoModuleManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return extension === ".go.mod" || extension === ".go.work" || name === "go.mod" || name === "go.work";
}

function isCargoManifestFile(filePath: string, extension: string): boolean {
  return extension === ".toml" && basename(filePath).toLowerCase() === "cargo.toml";
}

function isDartPubspecManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    extension === ".pubspec.yaml" ||
    extension === ".pubspec.lock" ||
    name === "pubspec.yaml" ||
    name === "pubspec.yml" ||
    name === "pubspec.lock"
  );
}

function isApplePackageManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".swift-package", ".podfile", ".podfile.lock", ".podspec"].includes(extension) ||
    name === "package.swift" ||
    name === "podfile" ||
    name === "podfile.lock" ||
    name.endsWith(".podspec")
  );
}

function isPhpRubyPackageManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".composer.json", ".gemfile", ".gemspec"].includes(extension) ||
    name === "composer.json" ||
    name === "gemfile" ||
    name.endsWith(".gemspec")
  );
}

function isElixirHaskellPackageManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".mix.exs", ".mix.lock", ".stack.yaml", ".package.yaml", ".cabal"].includes(extension) ||
    name === "mix.exs" ||
    name === "mix.lock" ||
    name === "stack.yaml" ||
    name === "stack.yml" ||
    name === "package.yaml" ||
    name === "package.yml" ||
    name.endsWith(".cabal")
  );
}

function isNodePackageManifestFile(filePath: string, extension: string): boolean {
  return extension === ".json" && basename(filePath).toLowerCase() === "package.json";
}

function isNodePackageManagerConfigFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".npmignore"].includes(extension) ||
    name === ".npmrc" ||
    name.endsWith(".npmrc") ||
    name === ".yarnrc" ||
    name === ".yarnrc.yml" ||
    name === ".yarnrc.yaml" ||
    name === ".pnpmfile.cjs" ||
    name === ".npmignore"
  );
}

function isJvmBuildConfigFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".gradle.properties", ".maven.config", ".jvm.config"].includes(extension) ||
    name === "gradle.properties" ||
    name === "maven.config" ||
    name === "jvm.config"
  );
}

function isMetricsSnapshotFile(extension: string): boolean {
  return extension === ".prom" || extension === ".metrics" || extension === ".openmetrics";
}

interface MetricsSnapshotPreview {
  format: string;
  metricNames: string[];
  metricTypes: string[];
  helpLines: string[];
  sampleLines: string[];
  labelKeys: string[];
  truncated: boolean;
}

function summarizeMetricsSnapshotFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_METRICS_SNAPSHOT_PREVIEW_BYTES)).toString("utf8");
    const preview = parseMetricsSnapshotPreview(raw, extension);
    return [
      `Metrics snapshot preview (${preview.format}, ${formatBytes(size)}).`,
      preview.metricNames.length > 0
        ? `Metric names (${preview.metricNames.length}${preview.metricNames.length >= MAX_METRICS_SNAPSHOT_ITEM_PREVIEW ? "+" : ""}): ${preview.metricNames.join(", ")}.`
        : "Metric names: none detected in the bounded preview.",
      preview.metricTypes.length > 0
        ? `Metric types: ${preview.metricTypes.join(", ")}.`
        : "Metric types: none declared.",
      preview.labelKeys.length > 0
        ? `Label keys: ${preview.labelKeys.join(", ")}.`
        : "Label keys: none detected.",
      preview.helpLines.length > 0
        ? `HELP metadata: ${preview.helpLines.join(" | ")}.`
        : "HELP metadata: none detected.",
      preview.sampleLines.length > 0
        ? `Sample points: ${preview.sampleLines.join(" | ")}.`
        : "Sample points: none detected in the bounded preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_METRICS_SNAPSHOT_PREVIEW_BYTES)} or item limits.` : "",
      "Metrics snapshot preview read bounded workspace-local text only; no Prometheus/OpenMetrics server query, scrape, remote write, alert evaluation, TSDB access, network call, credential lookup, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Metrics snapshot file ready for explicit attachment (${formatBytes(size)}).`,
      "No Prometheus/OpenMetrics server query, scrape, remote write, alert evaluation, TSDB access, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseMetricsSnapshotPreview(raw: string, extension: string): MetricsSnapshotPreview {
  const lines = normalizeTextPreview(raw).split("\n");
  const metricNames = new Set<string>();
  const metricTypes = new Set<string>();
  const helpLines: string[] = [];
  const sampleLines: string[] = [];
  const labelKeys = new Set<string>();
  let sawEof = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "# EOF") {
      sawEof = true;
      continue;
    }
    const helpMatch = trimmed.match(/^#\s+HELP\s+([A-Za-z_:][A-Za-z0-9_:]*)\s+(.+)$/);
    if (helpMatch) {
      metricNames.add(helpMatch[1]);
      if (helpLines.length < MAX_METRICS_SNAPSHOT_ITEM_PREVIEW) {
        helpLines.push(`${helpMatch[1]}=${clampSingleLine(maskPotentialSecretValues(helpMatch[2]), 140)}`);
      }
      continue;
    }
    const typeMatch = trimmed.match(/^#\s+TYPE\s+([A-Za-z_:][A-Za-z0-9_:]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (typeMatch) {
      metricNames.add(typeMatch[1]);
      metricTypes.add(`${typeMatch[1]}:${typeMatch[2]}`);
      continue;
    }
    if (trimmed.startsWith("#")) continue;

    const sampleMatch = trimmed.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+([-+]?Inf|NaN|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?:\s+[-+]?\d+)?$/);
    if (!sampleMatch) continue;
    metricNames.add(sampleMatch[1]);
    collectMetricsLabelKeys(sampleMatch[2] || "", labelKeys);
    if (sampleLines.length < MAX_METRICS_SNAPSHOT_ITEM_PREVIEW) {
      sampleLines.push(clampSingleLine(maskPotentialSecretValues(trimmed), 220));
    }
  }

  return {
    format: extension === ".openmetrics" || sawEof ? "OpenMetrics/Prometheus text" : "Prometheus text exposition",
    metricNames: [...metricNames].slice(0, MAX_METRICS_SNAPSHOT_ITEM_PREVIEW),
    metricTypes: [...metricTypes].slice(0, MAX_METRICS_SNAPSHOT_ITEM_PREVIEW),
    helpLines,
    sampleLines,
    labelKeys: [...labelKeys].slice(0, MAX_METRICS_SNAPSHOT_ITEM_PREVIEW),
    truncated:
      raw.length >= MAX_METRICS_SNAPSHOT_PREVIEW_BYTES ||
      metricNames.size >= MAX_METRICS_SNAPSHOT_ITEM_PREVIEW ||
      sampleLines.length >= MAX_METRICS_SNAPSHOT_ITEM_PREVIEW,
  };
}

function collectMetricsLabelKeys(labelText: string, labelKeys: Set<string>): void {
  for (const match of labelText.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(?:\\.|[^"\\])*"/g)) {
    if (labelKeys.size >= MAX_METRICS_SNAPSHOT_ITEM_PREVIEW) break;
    labelKeys.add(match[1]);
  }
}

interface PythonDependencyManifestPreview {
  format: string;
  packageNames: string[];
  dependencyGroups: string[];
  pythonVersions: string[];
  indexHints: string[];
  buildBackends: string[];
  truncated: boolean;
}

function summarizePythonDependencyManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_PYTHON_DEPENDENCY_PREVIEW_BYTES)).toString("utf8");
    const preview = parsePythonDependencyManifestPreview(filePath, extension, raw);
    return [
      `Python dependency manifest preview (${preview.format}, ${formatBytes(size)}).`,
      preview.packageNames.length > 0
        ? `Packages (${preview.packageNames.length}${preview.packageNames.length >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW ? "+" : ""}): ${preview.packageNames.join(", ")}.`
        : "Packages: none detected in the bounded local preview.",
      preview.dependencyGroups.length > 0
        ? `Dependency groups: ${preview.dependencyGroups.join(", ")}.`
        : "Dependency groups: none detected.",
      preview.pythonVersions.length > 0
        ? `Python version hints: ${preview.pythonVersions.join(", ")}.`
        : "Python version hints: none detected.",
      preview.buildBackends.length > 0
        ? `Build backends: ${preview.buildBackends.join(", ")}.`
        : "Build backends: none detected.",
      preview.indexHints.length > 0
        ? `Index/constraint hints: ${preview.indexHints.join(", ")}.`
        : "Index/constraint hints: none detected.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_PYTHON_DEPENDENCY_PREVIEW_BYTES)} or item limits.` : "",
      "Python dependency manifest preview read bounded local text only; no Python interpreter, pip, conda, poetry, pipenv, uv, build backend, dependency installation, registry lookup, network call, script execution, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Python dependency manifest ready for explicit attachment (${formatBytes(size)}).`,
      "No Python interpreter, pip, conda, poetry, pipenv, uv, dependency installation, registry lookup, network call, script execution, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parsePythonDependencyManifestPreview(
  filePath: string,
  extension: string,
  raw: string,
): PythonDependencyManifestPreview {
  const name = basename(filePath).toLowerCase();
  const packageNames = new Set<string>();
  const dependencyGroups = new Set<string>();
  const pythonVersions = new Set<string>();
  const indexHints = new Set<string>();
  const buildBackends = new Set<string>();
  const lines = normalizeTextPreview(raw).split("\n");

  if (/^requirements(?:[-_.][a-z0-9_.-]+)?\.txt$/i.test(name) || (extension === ".txt" && name.includes("requirements"))) {
    dependencyGroups.add("requirements");
    collectRequirementLines(lines, packageNames, indexHints);
  } else if (name === "pyproject.toml") {
    dependencyGroups.add("project");
    collectQuotedArrayPackages(raw, /dependencies\s*=\s*\[([\s\S]*?)\]/g, packageNames);
    collectTomlOptionalDependencyPackages(raw, packageNames, dependencyGroups);
    collectTomlSectionNames(raw, "tool.poetry.group", dependencyGroups);
    collectQuotedValues(raw, /requires-python\s*=\s*["']([^"']+)["']/g, pythonVersions);
    collectQuotedValues(raw, /python\s*=\s*["']([^"']+)["']/g, pythonVersions);
    collectQuotedValues(raw, /build-backend\s*=\s*["']([^"']+)["']/g, buildBackends);
  } else if (name === "setup.cfg") {
    dependencyGroups.add("install_requires");
    collectIniMultilinePackages(lines, "install_requires", packageNames);
    collectIniMultilinePackages(lines, "tests_require", packageNames);
    collectSetupCfgExtras(lines, dependencyGroups, packageNames);
    collectLineValues(lines, /^python_requires\s*=\s*(.+)$/i, pythonVersions);
  } else if (name === "setup.py") {
    dependencyGroups.add("setup.py static args");
    collectQuotedArrayPackages(raw, /install_requires\s*=\s*\[([\s\S]*?)\]/g, packageNames);
    collectQuotedArrayPackages(raw, /tests_require\s*=\s*\[([\s\S]*?)\]/g, packageNames);
    collectQuotedValues(raw, /python_requires\s*=\s*["']([^"']+)["']/g, pythonVersions);
  } else if (name === "pipfile") {
    collectTomlSectionNames(raw, "packages", dependencyGroups);
    collectTomlSectionNames(raw, "dev-packages", dependencyGroups);
    collectPipfilePackages(lines, packageNames);
    collectQuotedValues(raw, /python_version\s*=\s*["']([^"']+)["']/g, pythonVersions);
    collectQuotedValues(raw, /url\s*=\s*["']([^"']+)["']/g, indexHints);
  } else if (name === "uv.lock") {
    dependencyGroups.add("uv packages");
    collectTomlLockfilePackages(raw, packageNames);
    collectQuotedValues(raw, /requires-python\s*=\s*["']([^"']+)["']/g, pythonVersions);
  } else if (name === "environment.yml" || name === "environment.yaml" || name === "conda-env.yml" || name === "conda-env.yaml") {
    dependencyGroups.add("conda environment");
    collectCondaEnvironmentPackages(lines, packageNames, pythonVersions, indexHints);
  }

  return {
    format: describePythonDependencyManifestFormat(name),
    packageNames: [...packageNames].slice(0, MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW),
    dependencyGroups: [...dependencyGroups].slice(0, MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW),
    pythonVersions: [...pythonVersions].slice(0, MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW),
    indexHints: [...indexHints].slice(0, MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW),
    buildBackends: [...buildBackends].slice(0, MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW),
    truncated:
      raw.length >= MAX_PYTHON_DEPENDENCY_PREVIEW_BYTES ||
      packageNames.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW ||
      dependencyGroups.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW,
  };
}

function describePythonDependencyManifestFormat(name: string): string {
  if (name === "pyproject.toml") return "pyproject.toml";
  if (name === "setup.cfg") return "setuptools setup.cfg";
  if (name === "setup.py") return "setuptools setup.py";
  if (name === "pipfile") return "Pipfile";
  if (name === "uv.lock") return "uv lock";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "Conda environment YAML";
  if (name.includes("requirements")) return "requirements.txt";
  return "Python dependency manifest";
}

function collectRequirementLines(lines: string[], packages: Set<string>, indexHints: Set<string>): void {
  for (const line of lines) {
    const trimmed = maskPotentialSecretValues(line.trim());
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^(--index-url|--extra-index-url|-i)\b/i.test(trimmed)) {
      indexHints.add(trimmed.replace(/\s+\S+$/, " [redacted-url]"));
      continue;
    }
    if (/^(--constraint|-c|--requirement|-r)\b/i.test(trimmed)) {
      indexHints.add(clampSingleLine(trimmed, 120));
      continue;
    }
    const packageName = normalizePythonRequirementName(trimmed);
    if (packageName) packages.add(packageName);
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) break;
  }
}

function collectQuotedArrayPackages(raw: string, pattern: RegExp, packages: Set<string>): void {
  for (const match of raw.matchAll(pattern)) {
    for (const value of [...(match[1] || "").matchAll(/["']([^"']+)["']/g)]) {
      const packageName = normalizePythonRequirementName(value[1] || "");
      if (packageName) packages.add(packageName);
      if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
    }
  }
}

function collectTomlOptionalDependencyPackages(raw: string, packages: Set<string>, groups: Set<string>): void {
  const section = raw.match(/^\[project\.optional-dependencies\]\s*([\s\S]*?)(?=^\[|\s*$)/m)?.[1] || "";
  for (const match of section.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*\[([\s\S]*?)\]/gm)) {
    if (match[1]) groups.add(clampSingleLine(match[1], 100));
    for (const value of [...(match[2] || "").matchAll(/["']([^"']+)["']/g)]) {
      const packageName = normalizePythonRequirementName(value[1] || "");
      if (packageName) packages.add(packageName);
      if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
    }
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectQuotedValues(raw: string, pattern: RegExp, target: Set<string>): void {
  for (const match of raw.matchAll(pattern)) {
    if (match[1]) target.add(clampSingleLine(maskPotentialSecretValues(match[1]), 120));
    if (target.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectLineValues(lines: string[], pattern: RegExp, target: Set<string>): void {
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match?.[1]) target.add(clampSingleLine(maskPotentialSecretValues(match[1]), 120));
    if (target.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectTomlSectionNames(raw: string, prefix: string, target: Set<string>): void {
  const pattern = new RegExp(`^\\[${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.([^\\]]+))?\\]`, "gm");
  for (const match of raw.matchAll(pattern)) {
    target.add(clampSingleLine(match[1] || prefix, 100));
    if (target.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectIniMultilinePackages(lines: string[], key: string, packages: Set<string>): void {
  let collecting = false;
  for (const line of lines) {
    const keyMatch = line.trim().match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "i"));
    if (keyMatch) {
      collecting = true;
      const packageName = normalizePythonRequirementName(keyMatch[1] || "");
      if (packageName) packages.add(packageName);
      continue;
    }
    if (collecting && /^\S/.test(line) && !line.trim().startsWith("#")) collecting = false;
    if (!collecting) continue;
    const packageName = normalizePythonRequirementName(line.trim());
    if (packageName) packages.add(packageName);
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectSetupCfgExtras(lines: string[], groups: Set<string>, packages: Set<string>): void {
  let inExtras = false;
  let currentExtra = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[options\.extras_require\]$/i.test(trimmed)) {
      inExtras = true;
      continue;
    }
    if (inExtras && /^\[/.test(trimmed)) return;
    if (!inExtras) continue;
    const sectionMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (sectionMatch?.[1]) {
      currentExtra = sectionMatch[1];
      groups.add(currentExtra);
      const packageName = normalizePythonRequirementName(sectionMatch[2] || "");
      if (packageName) packages.add(packageName);
      continue;
    }
    if (currentExtra) {
      const packageName = normalizePythonRequirementName(trimmed);
      if (packageName) packages.add(packageName);
    }
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectPipfilePackages(lines: string[], packages: Set<string>): void {
  let inPackageSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[(packages|dev-packages)\]$/i.test(trimmed)) {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && /^\[/.test(trimmed)) inPackageSection = false;
    if (!inPackageSection || !trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^["']?([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)["']?\s*=/);
    if (match?.[1]) packages.add(clampSingleLine(match[1], 100));
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function collectCondaEnvironmentPackages(
  lines: string[],
  packages: Set<string>,
  pythonVersions: Set<string>,
  indexHints: Set<string>,
): void {
  let inDependencies = false;
  let inChannels = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^channels:\s*$/i.test(trimmed)) {
      inChannels = true;
      inDependencies = false;
      continue;
    }
    if (/^dependencies:\s*$/i.test(trimmed)) {
      inDependencies = true;
      inChannels = false;
      continue;
    }
    if (/^[A-Za-z0-9_.-]+:\s*/.test(trimmed) && !trimmed.startsWith("-")) {
      inChannels = false;
      inDependencies = false;
    }
    if (inChannels && trimmed.startsWith("-")) {
      indexHints.add(`channel:${clampSingleLine(trimmed.replace(/^-\s*/, ""), 80)}`);
      continue;
    }
    if (!inDependencies || !trimmed.startsWith("-")) continue;
    const value = trimmed.replace(/^-\s*/, "");
    if (/^pip:\s*$/i.test(value)) {
      indexHints.add("pip subsection");
      continue;
    }
    const packageName = normalizePythonRequirementName(value);
    if (packageName) {
      packages.add(packageName);
      if (packageName.toLowerCase() === "python") pythonVersions.add(clampSingleLine(value, 120));
    }
    if (packages.size >= MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW) return;
  }
}

function normalizePythonRequirementName(value: string): string {
  const cleaned = value
    .replace(/#.*/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/;\s*python_version.*$/i, "")
    .trim();
  if (!cleaned || /^(-|--|git\+|https?:|file:|[.{/\\])/.test(cleaned)) return "";
  const match = cleaned.match(/^([A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?)/);
  return match?.[1] ? clampSingleLine(match[1], 100) : "";
}

interface CoverageReportPreview {
  format: string;
  files: string[];
  packages: string[];
  lineRate: number | null;
  branchRate: number | null;
  coveredLines: number | null;
  totalLines: number | null;
  coveredBranches: number | null;
  totalBranches: number | null;
  truncated: boolean;
}

function isCoverageReportFile(filePath: string, extension: string): boolean {
  return extension === ".lcov" || (extension === ".xml" && looksLikeCoverageReportXml(filePath));
}

function looksLikeCoverageReportXml(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_COVERAGE_REPORT_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return (
      /<coverage\b/i.test(raw) ||
      /<project\b[\s\S]*?<metrics\b/i.test(raw) ||
      /<report\b[^>]*\bname\s*=\s*["'][^"']*jacoco/i.test(raw) ||
      /<counter\b[^>]*\btype\s*=\s*["'](?:LINE|BRANCH)["']/i.test(raw)
    );
  } catch {
    return false;
  }
}

function summarizeCoverageReportFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_COVERAGE_REPORT_PREVIEW_BYTES)).toString("utf8");
    const preview = extension === ".lcov" ? parseLcovCoverageReport(raw) : parseXmlCoverageReport(raw);
    const lineRate = formatCoverageRate(preview.lineRate, preview.coveredLines, preview.totalLines);
    const branchRate = formatCoverageRate(preview.branchRate, preview.coveredBranches, preview.totalBranches);
    return [
      `Coverage report preview (${preview.format}, ${formatBytes(size)}).`,
      `Line coverage: ${lineRate}. Branch coverage: ${branchRate}.`,
      preview.packages.length > 0
        ? `Packages (${preview.packages.length}${preview.packages.length >= MAX_COVERAGE_PACKAGE_PREVIEW ? "+" : ""}): ${preview.packages.join(", ")}.`
        : "Packages: none detected in the bounded preview.",
      preview.files.length > 0
        ? `File samples (${preview.files.length}${preview.files.length >= MAX_COVERAGE_FILE_PREVIEW ? "+" : ""}): ${preview.files.join(" | ")}.`
        : "File samples: none detected in the bounded preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_COVERAGE_REPORT_PREVIEW_BYTES)} or item limits.` : "",
      "Coverage report preview read bounded local text/XML only; no test runner, coverage tool, build command, CI provider API call, artifact download, source instrumentation, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Coverage report file ready for explicit attachment (${formatBytes(size)}).`,
      "No test runner, coverage tool, build command, CI provider API call, artifact download, source instrumentation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseLcovCoverageReport(raw: string): CoverageReportPreview {
  const files: string[] = [];
  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      if (files.length < MAX_COVERAGE_FILE_PREVIEW) {
        files.push(clampSingleLine(maskPotentialSecretPathSegments(line.slice(3)), 160));
      }
      continue;
    }
    if (line.startsWith("LF:")) totalLines += readCoverageNumber(line.slice(3));
    if (line.startsWith("LH:")) coveredLines += readCoverageNumber(line.slice(3));
    if (line.startsWith("BRF:")) totalBranches += readCoverageNumber(line.slice(4));
    if (line.startsWith("BRH:")) coveredBranches += readCoverageNumber(line.slice(4));
  }
  return {
    format: "LCOV",
    files,
    packages: [],
    lineRate: null,
    branchRate: null,
    coveredLines,
    totalLines,
    coveredBranches,
    totalBranches,
    truncated: raw.length >= MAX_COVERAGE_REPORT_PREVIEW_BYTES || files.length >= MAX_COVERAGE_FILE_PREVIEW,
  };
}

function parseXmlCoverageReport(raw: string): CoverageReportPreview {
  if (looksLikeCloverCoverageXml(raw)) return parseCloverCoverageReport(raw);
  const rootAttrs = readXmlAttributes(raw.match(/<(coverage|report)\b([^>]*)>/i)?.[2] ?? "");
  const packages = [...raw.matchAll(/<package\b([^>]*)>/gi)]
    .map((match) => readXmlAttributes(match[1] ?? "").get("name") || "")
    .filter(Boolean)
    .map((name) => clampSingleLine(maskPotentialSecretValues(name), 120))
    .slice(0, MAX_COVERAGE_PACKAGE_PREVIEW);
  const files = extractCoverageXmlFiles(raw);
  const lineCounter = readCoverageXmlCounter(raw, "LINE");
  const branchCounter = readCoverageXmlCounter(raw, "BRANCH");
  const lineRate = readCoverageRatio(rootAttrs.get("line-rate"));
  const branchRate = readCoverageRatio(rootAttrs.get("branch-rate"));
  return {
    format: /<report\b/i.test(raw) && /<counter\b/i.test(raw) ? "JaCoCo XML" : "Cobertura XML",
    files,
    packages,
    lineRate,
    branchRate,
    coveredLines: lineCounter.covered,
    totalLines: lineCounter.total,
    coveredBranches: branchCounter.covered,
    totalBranches: branchCounter.total,
    truncated:
      raw.length >= MAX_COVERAGE_REPORT_PREVIEW_BYTES ||
      files.length >= MAX_COVERAGE_FILE_PREVIEW ||
    packages.length >= MAX_COVERAGE_PACKAGE_PREVIEW,
  };
}

function looksLikeCloverCoverageXml(raw: string): boolean {
  return /<coverage\b/i.test(raw) && /<project\b/i.test(raw) && /<metrics\b/i.test(raw) && /\bcoveredstatements\s*=/i.test(raw);
}

function parseCloverCoverageReport(raw: string): CoverageReportPreview {
  const projectMatch = raw.match(/<project\b[\s\S]*?<\/project>/i);
  const projectBody = projectMatch?.[0] ?? raw;
  const metricsAttrs = readXmlAttributes(projectBody.match(/<metrics\b([^>]*)\/?>/i)?.[1] ?? "");
  const packages = [...raw.matchAll(/<package\b([^>]*)>/gi)]
    .map((match) => readXmlAttributes(match[1] ?? "").get("name") || "")
    .filter(Boolean)
    .map((name) => clampSingleLine(maskPotentialSecretValues(name), 120))
    .slice(0, MAX_COVERAGE_PACKAGE_PREVIEW);
  const files = extractCoverageXmlFiles(raw);
  const coveredLines = readOptionalCoverageNumber(metricsAttrs.get("coveredstatements"));
  const totalLines = readOptionalCoverageNumber(metricsAttrs.get("statements"));
  const coveredBranches = readOptionalCoverageNumber(metricsAttrs.get("coveredconditionals"));
  const totalBranches = readOptionalCoverageNumber(metricsAttrs.get("conditionals"));
  return {
    format: "Clover XML",
    files,
    packages,
    lineRate: null,
    branchRate: null,
    coveredLines,
    totalLines,
    coveredBranches,
    totalBranches,
    truncated:
      raw.length >= MAX_COVERAGE_REPORT_PREVIEW_BYTES ||
      files.length >= MAX_COVERAGE_FILE_PREVIEW ||
      packages.length >= MAX_COVERAGE_PACKAGE_PREVIEW,
  };
}

function extractCoverageXmlFiles(raw: string): string[] {
  const files = new Set<string>();
  for (const match of raw.matchAll(/<(?:class|sourcefile|file)\b([^>]*)>/gi)) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const filename = attrs.get("filename") || attrs.get("path") || attrs.get("name") || "";
    if (filename) files.add(clampSingleLine(maskPotentialSecretPathSegments(filename), 160));
    if (files.size >= MAX_COVERAGE_FILE_PREVIEW) break;
  }
  return [...files].slice(0, MAX_COVERAGE_FILE_PREVIEW);
}

function readCoverageXmlCounter(raw: string, type: "LINE" | "BRANCH"): { covered: number | null; total: number | null } {
  const counterTag = [...raw.matchAll(/<counter\b([^>]*)>/gi)]
    .map((match) => match[1] ?? "")
    .find((attrs) => readXmlAttributes(attrs).get("type")?.toUpperCase() === type);
  const attrs = readXmlAttributes(counterTag ?? "");
  const covered = readCoverageNumber(attrs.get("covered"));
  const missed = readCoverageNumber(attrs.get("missed"));
  if (covered === 0 && missed === 0 && !attrs.has("covered") && !attrs.has("missed")) {
    return { covered: null, total: null };
  }
  return { covered, total: covered + missed };
}

function readCoverageRatio(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readCoverageNumber(value: string | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readOptionalCoverageNumber(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCoverageRate(rate: number | null, covered: number | null, total: number | null): string {
  if (rate !== null) return `${Math.round(rate * 1000) / 10}%`;
  if (covered !== null && total !== null && total > 0) {
    return `${Math.round((covered / total) * 1000) / 10}% (${covered}/${total})`;
  }
  return "not detected in the bounded preview";
}

function maskPotentialSecretPathSegments(value: string): string {
  return maskPotentialSecretValues(value).replace(
    /(^|[\\/])([^\\/]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)[^\\/]*?)(\.[A-Za-z0-9]+)?(?=$|[\\/])/gi,
    (_match, prefix: string, _segment: string, extension = "") => `${prefix}[redacted]${extension}`,
  );
}

interface TestReportPreview {
  format: string;
  suites: string[];
  cases: number;
  failures: number;
  errors: number;
  skipped: number;
  durationSeconds: number | null;
  failedCases: string[];
  resultSummary: string;
  truncated: boolean;
}

function isTestReportFile(filePath: string, extension: string): boolean {
  return (
    extension === ".trx" ||
    extension === ".junit.xml" ||
    extension === ".tap" ||
    extension === ".tap13" ||
    extension === ".test-results.json" ||
    (extension === ".xml" && looksLikeTestReportXml(filePath)) ||
    (extension === ".json" && looksLikeJsonTestReport(filePath))
  );
}

function looksLikeTestReportXml(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_TEST_REPORT_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return /<(testsuites|testsuite|TestRun)\b/i.test(raw) && /<(testcase|UnitTestResult|ResultSummary|Counters)\b/i.test(raw);
  } catch {
    return false;
  }
}

function looksLikeJsonTestReport(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_TEST_REPORT_PREVIEW_BYTES, 32 * 1024)).toString("utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!isRecord(parsed)) return false;
    if (Array.isArray(parsed.suites) && (isRecord(parsed.stats) || parsed.config !== undefined)) return true;
    if (Array.isArray(parsed.testResults) && hasAnyProperty(parsed, ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"])) return true;
    if (Array.isArray(parsed.testResults) && parsed.testResults.some((entry) => isRecord(entry) && Array.isArray(entry.assertionResults))) return true;
    return false;
  } catch {
    return false;
  }
}

function summarizeTestReportFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_TEST_REPORT_PREVIEW_BYTES)).toString("utf8");
    const preview = extension === ".tap" || extension === ".tap13" || looksLikeTapTestReport(raw)
      ? parseTapTestReport(raw)
      : extension === ".trx" || /<TestRun\b/i.test(raw)
      ? parseTrxTestReport(raw)
      : extension === ".test-results.json" || looksLikeJsonTestReportText(raw)
      ? parseJsonTestReport(raw)
      : parseJunitTestReport(raw);
    return [
      `Test report preview (${preview.format}, ${formatBytes(size)}).`,
      preview.resultSummary,
      preview.suites.length > 0
        ? `Suites (${preview.suites.length}${preview.suites.length >= MAX_TEST_REPORT_CASE_PREVIEW ? "+" : ""}): ${preview.suites.join(", ")}.`
        : "Suites: none named in the bounded preview.",
      preview.durationSeconds !== null ? `Duration: ${preview.durationSeconds.toFixed(3)} seconds.` : "",
      preview.failedCases.length > 0
        ? `Failure/error previews (${preview.failedCases.length}${preview.failedCases.length >= MAX_TEST_REPORT_FAILURE_PREVIEW ? "+" : ""}): ${preview.failedCases.join(" | ")}.`
        : "Failure/error previews: none detected in the bounded preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_TEST_REPORT_PREVIEW_BYTES)} or item limits.` : "",
      "Test report preview read bounded local XML/TAP/JSON only; no test runner, build command, CI provider API call, artifact download, retry, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Test report file ready for explicit attachment (${formatBytes(size)}).`,
      "No test runner, build command, CI provider API call, artifact download, retry, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseJunitTestReport(raw: string): TestReportPreview {
  const suites = [...raw.matchAll(/<testsuite\b([^>]*)>/gi)]
    .map((match) => readXmlAttributes(match[1] ?? ""))
    .map((attrs) => attrs.get("name") || attrs.get("package") || "")
    .filter(Boolean)
    .map((name) => clampSingleLine(name, 120))
    .slice(0, MAX_TEST_REPORT_CASE_PREVIEW);
  const suiteAttrs = [...raw.matchAll(/<testsuite\b([^>]*)>/gi)].map((match) => readXmlAttributes(match[1] ?? ""));
  const caseMatches = [...raw.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi)];
  const failedCases: string[] = [];
  let failures = sumXmlNumericAttributes(suiteAttrs, "failures");
  let errors = sumXmlNumericAttributes(suiteAttrs, "errors");
  let skipped = sumXmlNumericAttributes(suiteAttrs, "skipped");
  let durationSeconds = sumXmlNumericAttributes(suiteAttrs, "time");
  for (const match of caseMatches) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    if (/<skipped\b/i.test(body)) skipped += suiteAttrs.length > 0 ? 0 : 1;
    const hasFailure = /<failure\b/i.test(body);
    const hasError = /<error\b/i.test(body);
    if (hasFailure && suiteAttrs.length === 0) failures += 1;
    if (hasError && suiteAttrs.length === 0) errors += 1;
    if ((hasFailure || hasError) && failedCases.length < MAX_TEST_REPORT_FAILURE_PREVIEW) {
      failedCases.push(formatTestCasePreview(attrs, body));
    }
  }
  const suiteCaseCount = sumXmlNumericAttributes(suiteAttrs, "tests");
  const cases = suiteCaseCount > 0 ? suiteCaseCount : caseMatches.length;
  return {
    format: "JUnit XML",
    suites,
    cases,
    failures,
    errors,
    skipped,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
    failedCases,
    resultSummary: `Cases: ${cases}; failures: ${failures}; errors: ${errors}; skipped: ${skipped}.`,
    truncated: raw.length >= MAX_TEST_REPORT_PREVIEW_BYTES || caseMatches.length > MAX_TEST_REPORT_CASE_PREVIEW,
  };
}

function parseTrxTestReport(raw: string): TestReportPreview {
  const counterAttrs = readXmlAttributes(raw.match(/<Counters\b([^>]*)\/?>/i)?.[1] ?? "");
  const resultMatches = [...raw.matchAll(/<UnitTestResult\b([^>]*?)(?:\/>|>([\s\S]*?)<\/UnitTestResult>)/gi)];
  const failedCases: string[] = [];
  const outcomeCounts = new Map<string, number>();
  for (const match of resultMatches) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const outcome = attrs.get("outcome") || "Unknown";
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
    if (!/^(Passed|Completed)$/i.test(outcome) && failedCases.length < MAX_TEST_REPORT_FAILURE_PREVIEW) {
      failedCases.push(formatTestCasePreview(attrs, match[2] ?? ""));
    }
  }
  const failed = readXmlNumber(counterAttrs, "failed") + readXmlNumber(counterAttrs, "error") + readXmlNumber(counterAttrs, "timeout") + readXmlNumber(counterAttrs, "aborted");
  const skipped = readXmlNumber(counterAttrs, "notExecuted") + readXmlNumber(counterAttrs, "notRunnable");
  const total = readXmlNumber(counterAttrs, "total") || resultMatches.length;
  const summaryOutcome = readXmlAttributes(raw.match(/<ResultSummary\b([^>]*)>/i)?.[1] ?? "").get("outcome") || "";
  return {
    format: "Visual Studio TRX",
    suites: summaryOutcome ? [`ResultSummary outcome: ${clampSingleLine(summaryOutcome, 80)}`] : [],
    cases: total,
    failures: failed || countNonPassingOutcomes(outcomeCounts),
    errors: readXmlNumber(counterAttrs, "error"),
    skipped,
    durationSeconds: null,
    failedCases,
    resultSummary: `Cases: ${total}; passed: ${readXmlNumber(counterAttrs, "passed") || (outcomeCounts.get("Passed") ?? 0)}; non-passing: ${failed || countNonPassingOutcomes(outcomeCounts)}; skipped/not executed: ${skipped}.`,
    truncated: raw.length >= MAX_TEST_REPORT_PREVIEW_BYTES || resultMatches.length > MAX_TEST_REPORT_CASE_PREVIEW,
  };
}

function looksLikeJsonTestReportText(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!isRecord(parsed)) return false;
    if (Array.isArray(parsed.suites) && (isRecord(parsed.stats) || parsed.config !== undefined)) return true;
    if (Array.isArray(parsed.testResults) && hasAnyProperty(parsed, ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"])) return true;
    if (Array.isArray(parsed.testResults) && parsed.testResults.some((entry) => isRecord(entry) && Array.isArray(entry.assertionResults))) return true;
    return false;
  } catch {
    return false;
  }
}

function parseJsonTestReport(raw: string): TestReportPreview {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (!isRecord(parsed)) {
    return emptyJsonTestReportPreview("JSON test report");
  }
  if (Array.isArray(parsed.suites)) {
    return parsePlaywrightJsonTestReport(parsed);
  }
  return parseJestVitestJsonTestReport(parsed);
}

function emptyJsonTestReportPreview(format: string): TestReportPreview {
  return {
    format,
    suites: [],
    cases: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    durationSeconds: null,
    failedCases: [],
    resultSummary: "Cases: 0; passed: 0; non-passing: 0; skipped: 0.",
    truncated: false,
  };
}

function parsePlaywrightJsonTestReport(record: Record<string, unknown>): TestReportPreview {
  const suites: string[] = [];
  const failedCases: string[] = [];
  let cases = 0;
  let passed = 0;
  let failures = 0;
  let skipped = 0;
  let durationMs = readJsonNumber(record.stats, "duration") ?? 0;

  const visitSuite = (suite: unknown): void => {
    if (!isRecord(suite)) return;
    const title = readJsonString(suite, "title");
    if (title && suites.length < MAX_TEST_REPORT_CASE_PREVIEW) suites.push(clampSingleLine(title, 120));
    for (const child of readJsonArray(suite, "suites")) visitSuite(child);
    for (const spec of readJsonArray(suite, "specs")) {
      if (!isRecord(spec)) continue;
      const specTitle = readJsonString(spec, "title") || readJsonString(spec, "file") || "(unnamed spec)";
      for (const test of readJsonArray(spec, "tests")) {
        const testRecord = isRecord(test) ? test : spec;
        const testTitle = readJsonString(testRecord, "title") || specTitle;
        const results = readJsonArray(testRecord, "results");
        if (results.length === 0) {
          cases += 1;
          continue;
        }
        for (const result of results) {
          if (!isRecord(result)) continue;
          cases += 1;
          const status = (readJsonString(result, "status") || readJsonString(testRecord, "status") || "unknown").toLowerCase();
          durationMs += readJsonNumber(result, "duration") ?? 0;
          if (status === "passed") passed += 1;
          else if (status === "skipped" || status === "interrupted") skipped += 1;
          else {
            failures += 1;
            if (failedCases.length < MAX_TEST_REPORT_FAILURE_PREVIEW) {
              const error = readJsonString(result.error, "message") || readJsonString(result, "error") || readJsonString(result, "errors");
              failedCases.push(clampSingleLine(`${testTitle} [${status}]${error ? `: ${maskPotentialSecretValues(error)}` : ""}`, 240));
            }
          }
        }
      }
    }
  };

  for (const suite of readJsonArray(record, "suites")) visitSuite(suite);
  const stats = isRecord(record.stats) ? record.stats : {};
  const expected = readJsonNumber(stats, "expected");
  const unexpected = readJsonNumber(stats, "unexpected");
  const flaky = readJsonNumber(stats, "flaky") ?? 0;
  const skippedStats = readJsonNumber(stats, "skipped");
  if (typeof expected === "number") passed = Math.max(passed, expected);
  if (typeof unexpected === "number") failures = Math.max(failures, unexpected + flaky);
  if (typeof skippedStats === "number") skipped = Math.max(skipped, skippedStats);
  if (cases === 0) cases = passed + failures + skipped;

  return {
    format: "Playwright JSON",
    suites,
    cases,
    failures,
    errors: 0,
    skipped,
    durationSeconds: durationMs > 0 ? durationMs / 1000 : null,
    failedCases,
    resultSummary: `Cases: ${cases}; passed: ${passed}; non-passing: ${failures}; skipped: ${skipped}.`,
    truncated: JSON.stringify(record).length >= MAX_TEST_REPORT_PREVIEW_BYTES || cases > MAX_TEST_REPORT_CASE_PREVIEW,
  };
}

function parseJestVitestJsonTestReport(record: Record<string, unknown>): TestReportPreview {
  const suites: string[] = [];
  const failedCases: string[] = [];
  const hasTopLevelCounts = hasAnyProperty(record, ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"]);
  let cases = readJsonNumber(record, "numTotalTests") ?? 0;
  let passed = readJsonNumber(record, "numPassedTests") ?? 0;
  let failures = readJsonNumber(record, "numFailedTests") ?? 0;
  let skipped = (readJsonNumber(record, "numPendingTests") ?? 0) + (readJsonNumber(record, "numTodoTests") ?? 0);
  let durationMs = 0;

  for (const suite of readJsonArray(record, "testResults")) {
    if (!isRecord(suite)) continue;
    const suiteName = readJsonString(suite, "name") || readJsonString(suite, "file") || readJsonString(suite, "filepath");
    if (suiteName && suites.length < MAX_TEST_REPORT_CASE_PREVIEW) suites.push(clampSingleLine(suiteName, 120));
    durationMs += readJsonNumber(suite, "perfStats.runtime") ?? 0;
    for (const assertion of readJsonArray(suite, "assertionResults")) {
      if (!isRecord(assertion)) continue;
      if (!hasTopLevelCounts) cases += 1;
      const status = (readJsonString(assertion, "status") || "unknown").toLowerCase();
      if (!hasTopLevelCounts && status === "passed") passed += 1;
      if (!hasTopLevelCounts && (status === "pending" || status === "skipped" || status === "todo")) skipped += 1;
      if (!/^(passed|pending|skipped|todo)$/i.test(status) && failedCases.length < MAX_TEST_REPORT_FAILURE_PREVIEW) {
        const messages = readJsonArray(assertion, "failureMessages")
          .map((message) => typeof message === "string" ? maskPotentialSecretValues(message) : "")
          .filter(Boolean)
          .join(" ");
        const title = readJsonString(assertion, "fullName") || readJsonString(assertion, "title") || "(unnamed test)";
        failedCases.push(clampSingleLine(`${title} [${status}]${messages ? `: ${messages}` : ""}`, 240));
      }
    }
  }

  if (cases === 0) cases = passed + failures + skipped;
  if (failures === 0 && failedCases.length > 0) failures = failedCases.length;
  const format = typeof record.numRuntimeErrorTestSuites === "number" ? "Jest/Vitest JSON" : "JSON test report";
  return {
    format,
    suites,
    cases,
    failures,
    errors: readJsonNumber(record, "numRuntimeErrorTestSuites") ?? 0,
    skipped,
    durationSeconds: durationMs > 0 ? durationMs / 1000 : null,
    failedCases,
    resultSummary: `Cases: ${cases}; passed: ${passed}; non-passing: ${failures}; skipped: ${skipped}.`,
    truncated: JSON.stringify(record).length >= MAX_TEST_REPORT_PREVIEW_BYTES || cases > MAX_TEST_REPORT_CASE_PREVIEW,
  };
}

function readJsonArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readJsonString(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const entry = value[key];
  if (typeof entry === "string") return clampSingleLine(entry, 240);
  if (Array.isArray(entry)) return clampSingleLine(entry.filter((item) => typeof item === "string").join(" "), 240);
  return "";
}

function readJsonNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const entry = key.includes(".")
    ? key.split(".").reduce<unknown>((current, part) => isRecord(current) ? current[part] : undefined, value)
    : value[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

function looksLikeTapTestReport(raw: string): boolean {
  return /^\s*TAP version\b/im.test(raw) || /^\s*1\.\.\d+\b/m.test(raw) || /^\s*(?:not\s+)?ok\b/m.test(raw);
}

function parseTapTestReport(raw: string): TestReportPreview {
  const lines = raw.split(/\r?\n/);
  const failedCases: string[] = [];
  const directives = new Map<string, number>();
  let assertions = 0;
  let passed = 0;
  let failed = 0;
  let plan = "";
  let version = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^TAP version\b/i.test(trimmed)) {
      version = clampSingleLine(trimmed, 80);
      continue;
    }
    const planMatch = trimmed.match(/^1\.\.(\d+)\b/);
    if (planMatch) {
      plan = `Plan: 1..${planMatch[1]}`;
      continue;
    }
    const resultMatch = trimmed.match(/^(not\s+)?ok\b(?:\s+(\d+))?(?:\s+([^#]+?))?(?:\s+#\s*(\S+)(?:\s+(.*))?)?$/i);
    if (!resultMatch) continue;

    assertions += 1;
    const isFailure = Boolean(resultMatch[1]);
    const index = resultMatch[2] || String(assertions);
    const name = clampSingleLine(maskPotentialSecretValues((resultMatch[3] || `assertion ${index}`).trim()), 120);
    const directive = (resultMatch[4] || "").toUpperCase();
    const reason = clampSingleLine(maskPotentialSecretValues((resultMatch[5] || "").trim()), 120);

    if (directive) directives.set(directive, (directives.get(directive) ?? 0) + 1);
    if (isFailure) {
      failed += 1;
      if (failedCases.length < MAX_TEST_REPORT_FAILURE_PREVIEW) {
        failedCases.push(`${name} [not ok${directive ? ` ${directive}` : ""}]${reason ? `: ${reason}` : ""}`);
      }
    } else {
      passed += 1;
    }
  }

  const directiveSummary = [...directives.entries()]
    .map(([directive, count]) => `${directive}: ${count}`)
    .join(", ");
  const suites = [version, plan, directiveSummary ? `Directives: ${directiveSummary}` : ""]
    .filter(Boolean)
    .slice(0, MAX_TEST_REPORT_CASE_PREVIEW);
  const skipped = (directives.get("SKIP") ?? 0) + (directives.get("TODO") ?? 0);

  return {
    format: "TAP",
    suites,
    cases: assertions,
    failures: failed,
    errors: 0,
    skipped,
    durationSeconds: null,
    failedCases,
    resultSummary: `Cases: ${assertions}; passed: ${passed}; non-passing: ${failed}; directives: ${directiveSummary || "none"}.`,
    truncated: raw.length >= MAX_TEST_REPORT_PREVIEW_BYTES || assertions > MAX_TEST_REPORT_CASE_PREVIEW,
  };
}

function sumXmlNumericAttributes(attrsList: Map<string, string>[], key: string): number {
  return attrsList.reduce((sum, attrs) => sum + readXmlNumber(attrs, key), 0);
}

function readXmlNumber(attrs: Map<string, string>, key: string): number {
  const value = Number.parseFloat(attrs.get(key) || "0");
  return Number.isFinite(value) ? value : 0;
}

function countNonPassingOutcomes(outcomeCounts: Map<string, number>): number {
  let count = 0;
  for (const [outcome, value] of outcomeCounts.entries()) {
    if (!/^(Passed|Completed)$/i.test(outcome)) count += value;
  }
  return count;
}

function formatTestCasePreview(attrs: Map<string, string>, body: string): string {
  const name = attrs.get("name") || attrs.get("testName") || attrs.get("className") || attrs.get("classname") || "(unnamed test)";
  const className = attrs.get("classname") || attrs.get("className") || "";
  const outcome = attrs.get("outcome") || (/<error\b/i.test(body) ? "error" : /<failure\b/i.test(body) ? "failure" : "non-passing");
  const message = extractXmlFailureMessage(body);
  return clampSingleLine(
    `${className ? `${className}.` : ""}${name} [${outcome}]${message ? `: ${message}` : ""}`,
    240,
  );
}

function extractXmlFailureMessage(body: string): string {
  const attrs = readXmlAttributes(body.match(/<(failure|error|Message)\b([^>]*)>/i)?.[2] ?? "");
  const attrMessage = attrs.get("message");
  if (attrMessage) return clampSingleLine(attrMessage, 160);
  const bodyMatch = body.match(/<(?:failure|error|Message|StdOut|StdErr)\b[^>]*>([\s\S]*?)<\/(?:failure|error|Message|StdOut|StdErr)>/i);
  return bodyMatch?.[1]
    ? clampSingleLine(decodeXmlEntities((bodyMatch[1] ?? "").replace(/<[^>]+>/g, " ")), 160)
    : "";
}

interface WindowsInstallerOlePreview {
  validHeader: boolean;
  byteOrder: string;
  majorVersion: number | null;
  minorVersion: number | null;
  sectorSize: number | null;
  miniSectorSize: number | null;
  directorySectorCount: number | null;
  fatSectorCount: number | null;
  firstDirectorySector: number | null;
  transactionSignature: number | null;
  miniStreamCutoffSize: number | null;
  difatSectorCount: number | null;
  streams: string[];
  strings: string[];
}

interface WindowsAppPackageManifestPreview {
  manifestName: string | null;
  identity: string[];
  properties: string[];
  applications: string[];
  capabilities: string[];
  dependencies: string[];
  manifestText: string;
}

function summarizeWindowsInstallerPackageFile(filePath: string, extension: string, size: number): string {
  if (extension === ".msi") {
    return summarizeWindowsMsiPackageFile(filePath, size);
  }
  if (extension === ".appxmanifest") {
    return summarizeWindowsAppManifestFile(filePath, size);
  }
  return summarizeWindowsAppPackageFile(filePath, extension, size);
}

function summarizeWindowsMsiPackageFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_INSTALLER_PACKAGE_PREVIEW_BYTES));
    const preview = readWindowsMsiOlePreview(buffer);
    const streams =
      preview.streams.length > 0
        ? preview.streams.map((stream, index) => `${index + 1}. ${stream}`).join("\n")
        : "No readable MSI stream names were found in the bounded local preview.";
    const strings =
      preview.strings.length > 0
        ? preview.strings.map((line, index) => `String ${index + 1}: ${line}`).join("\n")
        : "No readable product/property string samples were found in the bounded local preview.";
    return [
      `Windows installer package preview (MSI, ${formatBytes(size)}).`,
      `Compound File header: ${preview.validHeader ? "valid MSI/OLE container signature" : "not recognized in bounded header"}.`,
      `Header version: major ${preview.majorVersion ?? "unknown"}, minor ${preview.minorVersion ?? "unknown"}; byte order ${preview.byteOrder}.`,
      preview.sectorSize ? `Sector size: ${formatBytes(preview.sectorSize)}; mini sector size: ${formatBytes(preview.miniSectorSize || 0)}.` : "",
      `Directory/FAT hints: first directory sector ${preview.firstDirectorySector ?? "unknown"}, directory sectors ${preview.directorySectorCount ?? "unknown"}, FAT sectors ${preview.fatSectorCount ?? "unknown"}, DIFAT sectors ${preview.difatSectorCount ?? "unknown"}.`,
      preview.transactionSignature !== null ? `Transaction signature number: ${preview.transactionSignature}.` : "",
      preview.miniStreamCutoffSize !== null ? `Mini stream cutoff: ${formatBytes(preview.miniStreamCutoffSize)}.` : "",
      `Stream name samples:\n${streams}`,
      `Readable string samples:\n${strings}`,
      "Ready for explicit attachment after visible review; MSI package metadata was parsed from bounded workspace-local bytes only, Windows Installer was not launched, no package install/repair/uninstall/custom action was executed, cabinet payloads were not extracted, signature trust was not decided, and no network call or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows installer package ready for explicit attachment (MSI, ${formatBytes(size)}).`,
      "MSI preview could not parse the bounded local installer header; Windows Installer was not launched, no install/repair/uninstall/custom action was executed, payloads were not extracted, and no network call or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsMsiOlePreview(buffer: Buffer): WindowsInstallerOlePreview {
  const validHeader =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const sectorShift = buffer.length >= 32 ? buffer.readUInt16LE(30) : 0;
  const miniSectorShift = buffer.length >= 34 ? buffer.readUInt16LE(32) : 0;
  const directorySectorStart = buffer.length >= 52 ? buffer.readInt32LE(48) : null;
  const streams = extractMsiDirectoryStreamNames(buffer);
  const strings = extractLegacyOfficeBinaryStrings(buffer)
    .filter((sample) =>
      /\b(Product|Manufacturer|Install|Feature|Component|Property|Shortcut|Registry|Directory|Upgrade|Package|Program)\b/i.test(sample),
    )
    .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW);
  return {
    validHeader,
    byteOrder: buffer.length >= 30 ? `0x${buffer.readUInt16LE(28).toString(16).padStart(4, "0")}` : "unknown",
    minorVersion: buffer.length >= 26 ? buffer.readUInt16LE(24) : null,
    majorVersion: buffer.length >= 28 ? buffer.readUInt16LE(26) : null,
    sectorSize: sectorShift > 0 && sectorShift < 31 ? 2 ** sectorShift : null,
    miniSectorSize: miniSectorShift > 0 && miniSectorShift < 31 ? 2 ** miniSectorShift : null,
    directorySectorCount: buffer.length >= 44 ? buffer.readUInt32LE(40) : null,
    fatSectorCount: buffer.length >= 48 ? buffer.readUInt32LE(44) : null,
    firstDirectorySector: directorySectorStart,
    transactionSignature: buffer.length >= 60 ? buffer.readUInt32LE(56) : null,
    miniStreamCutoffSize: buffer.length >= 64 ? buffer.readUInt32LE(60) : null,
    difatSectorCount: buffer.length >= 76 ? buffer.readUInt32LE(72) : null,
    streams,
    strings,
  };
}

function extractMsiDirectoryStreamNames(buffer: Buffer): string[] {
  const names = new Set<string>();
  for (let offset = 512; offset + 128 <= buffer.length && names.size < MAX_WINDOWS_INSTALLER_ITEM_PREVIEW; offset += 128) {
    const byteLength = buffer.readUInt16LE(offset + 64);
    if (byteLength < 4 || byteLength > 64) continue;
    const rawName = buffer.subarray(offset, offset + Math.min(byteLength - 2, 62)).toString("utf16le");
    const name = rawName.replace(/\0/g, "").replace(/\s+/g, " ").trim();
    if (
      name.length > 0 &&
      name.length <= 80 &&
      /[A-Za-z0-9_\-.$]/.test(name) &&
      !/^[\d .:_-]+$/.test(name)
    ) {
      names.add(name);
    }
  }
  return [...names];
}

function summarizeWindowsAppPackageFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_INSTALLER_PACKAGE_PREVIEW_BYTES));
    const { entries, truncated } = readZipArchiveMetadata(buffer);
    const files = entries.filter((entry) => !entry.directory);
    const manifest = readWindowsAppPackageManifestPreview(buffer);
    const appEntries = files
      .filter((entry) => /(^|\/)(appxmanifest|appxbundlemanifest)\.xml$/i.test(entry.name))
      .map((entry) => entry.name);
    const fileSamples = files
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW)
      .map((entry, index) => {
        const sizeLabel =
          typeof entry.uncompressedSize === "number" && entry.uncompressedSize > 0
            ? `, ${formatBytes(entry.uncompressedSize)}`
            : "";
        return `${index + 1}. ${entry.name} (method ${entry.method}${sizeLabel})`;
      });
    return [
      `Windows app package preview (${extension.toUpperCase().slice(1)}, ${formatBytes(size)}).`,
      `${files.length} file entr${files.length === 1 ? "y" : "ies"} found in the bounded ZIP local-header scan${truncated ? "; preview truncated before all entries were listed" : ""}.`,
      appEntries.length > 0
        ? `Manifest entry candidates: ${appEntries.slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW).join(", ")}.`
        : "Manifest entry candidates: none found in the bounded local header scan.",
      manifest.manifestName ? `Manifest parsed: ${manifest.manifestName}.` : "Manifest parsed: unavailable in bounded local package window.",
      manifest.identity.length > 0 ? `Identity: ${manifest.identity.join("; ")}.` : "Identity: none detected in bounded manifest preview.",
      manifest.properties.length > 0 ? `Properties: ${manifest.properties.join("; ")}.` : "Properties: none detected in bounded manifest preview.",
      manifest.applications.length > 0 ? `Applications: ${manifest.applications.join("; ")}.` : "Applications: none detected in bounded manifest preview.",
      manifest.capabilities.length > 0 ? `Capabilities: ${manifest.capabilities.join(", ")}.` : "Capabilities: none detected in bounded manifest preview.",
      manifest.dependencies.length > 0 ? `Dependencies: ${manifest.dependencies.join("; ")}.` : "Dependencies: none detected in bounded manifest preview.",
      fileSamples.length > 0 ? `File samples:\n${fileSamples.join("\n")}` : "No readable package local-file headers were found.",
      "Ready for explicit attachment after visible review; Windows app package metadata was parsed from bounded workspace-local bytes only, no package install/register/sideload command was executed, package payloads were not extracted to disk, scripts were not executed, signature trust was not decided, and no network call or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows app package ready for explicit attachment (${extension.toUpperCase().slice(1)}, ${formatBytes(size)}).`,
      "Package preview could not parse readable bounded ZIP metadata; no install/register/sideload command was executed, payloads were not extracted to disk, scripts were not executed, and no network call or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsAppPackageManifestPreview(buffer: Buffer): WindowsAppPackageManifestPreview {
  const manifestEntry = extractZipTextEntry(buffer, /(^|\/)(appxmanifest|appxbundlemanifest)\.xml$/i, MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES);
  if (!manifestEntry) {
    return { manifestName: null, identity: [], properties: [], applications: [], capabilities: [], dependencies: [], manifestText: "" };
  }
  const manifestText = manifestEntry.text.slice(0, MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES);
  return parseWindowsAppManifestPreview(manifestText, manifestEntry.name);
}

function summarizeWindowsAppManifestFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES)).toString("utf8");
    const manifest = parseWindowsAppManifestPreview(raw, basename(filePath));
    return [
      `Windows app package manifest preview (APPXMANIFEST, ${formatBytes(size)}).`,
      manifest.identity.length > 0 ? `Identity: ${manifest.identity.join("; ")}.` : "Identity: none detected in bounded manifest preview.",
      manifest.properties.length > 0 ? `Properties: ${manifest.properties.join("; ")}.` : "Properties: none detected in bounded manifest preview.",
      manifest.applications.length > 0 ? `Applications: ${manifest.applications.join("; ")}.` : "Applications: none detected in bounded manifest preview.",
      manifest.capabilities.length > 0 ? `Capabilities: ${manifest.capabilities.join(", ")}.` : "Capabilities: none detected in bounded manifest preview.",
      manifest.dependencies.length > 0 ? `Dependencies: ${manifest.dependencies.join("; ")}.` : "Dependencies: none detected in bounded manifest preview.",
      raw.length >= MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES)}.` : "",
      "Ready for explicit attachment after visible review; loose AppX/MSIX manifest XML was parsed from bounded workspace-local bytes only, no makeappx/signing/package install/register/sideload command was executed, package payloads were not resolved or extracted, scripts were not executed, signature trust was not decided, and no network call or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows app package manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Loose AppX/MSIX manifest preview could not parse bounded local XML; no makeappx/signing/package install/register/sideload command was executed, payloads were not resolved or extracted, and no network call or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseWindowsAppManifestPreview(
  manifestText: string,
  manifestName: string,
): WindowsAppPackageManifestPreview {
  const boundedManifestText = manifestText.slice(0, MAX_WINDOWS_INSTALLER_MANIFEST_PREVIEW_BYTES);
  return {
    manifestName,
    identity: extractXmlElements(boundedManifestText, "Identity")
      .map((attrs) => formatXmlAttributes(attrs, ["Name", "Publisher", "Version", "ProcessorArchitecture"]))
      .filter(Boolean)
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW),
    properties: extractXmlChildTextPairs(boundedManifestText, ["DisplayName", "PublisherDisplayName", "Description", "Logo"])
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW),
    applications: extractXmlElements(boundedManifestText, "Application")
      .map((attrs) => formatXmlAttributes(attrs, ["Id", "Executable", "EntryPoint"]))
      .filter(Boolean)
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW),
    capabilities: extractXmlElements(boundedManifestText, "Capability")
      .concat(extractXmlElements(boundedManifestText, "DeviceCapability"))
      .concat(extractXmlElements(boundedManifestText, "uap:Capability"))
      .concat(extractXmlElements(boundedManifestText, "rescap:Capability"))
      .map((attrs) => formatXmlAttributes(attrs, ["Name"]))
      .filter(Boolean)
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW),
    dependencies: extractXmlElements(boundedManifestText, "PackageDependency")
      .map((attrs) => formatXmlAttributes(attrs, ["Name", "Publisher", "MinVersion"]))
      .filter(Boolean)
      .slice(0, MAX_WINDOWS_INSTALLER_ITEM_PREVIEW),
    manifestText: boundedManifestText,
  };
}

function extractZipTextEntry(
  buffer: Buffer,
  namePattern: RegExp,
  maxOutputLength: number,
): { name: string; text: string } | null {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (nameLength <= 0 || dataStart > buffer.length) break;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8").replace(/\\/g, "/").replace(/\0/g, "");
    if ((flags & 0x08) !== 0 || compressedSize === 0 || dataEnd > buffer.length) {
      offset = Math.max(offset + 4, dataStart);
      continue;
    }
    if (namePattern.test(name) && compressedSize <= MAX_WINDOWS_INSTALLER_PACKAGE_PREVIEW_BYTES) {
      const data = inflateZipEntryMetadataWindow(buffer.subarray(dataStart, dataEnd), method);
      if (!data) return null;
      return { name, text: data.subarray(0, maxOutputLength).toString("utf8") };
    }
    offset = dataEnd;
  }
  return null;
}

function extractXmlElements(xml: string, elementName: string): string[] {
  const escaped = elementName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`<${escaped}\\b([^>]*)>`, "gi");
  return [...xml.matchAll(matcher)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}

function extractXmlChildTextPairs(xml: string, elementNames: string[]): string[] {
  const pairs: string[] = [];
  for (const elementName of elementNames) {
    const escaped = elementName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "gi");
    for (const match of xml.matchAll(matcher)) {
      const value = decodeHtmlEntities(stripHtmlTags(match[1] ?? "")).replace(/\s+/g, " ").trim();
      if (value) pairs.push(`${elementName}=${clampSingleLine(value, 140)}`);
      if (pairs.length >= MAX_WINDOWS_INSTALLER_ITEM_PREVIEW) return pairs;
    }
  }
  return pairs;
}

function formatXmlAttributes(rawAttributes: string, names: string[]): string {
  const values = names
    .map((name) => {
      const value = readInstallerXmlAttribute(rawAttributes, name);
      return value ? `${name}=${value}` : "";
    })
    .filter(Boolean);
  return values.join(", ");
}

function readInstallerXmlAttribute(rawAttributes: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i");
  const value = decodeHtmlEntities(rawAttributes.match(matcher)?.[1] ?? "").replace(/\s+/g, " ").trim();
  return value ? clampSingleLine(value, 160) : "";
}

function summarizeWindowsErrorReportFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_ERROR_REPORT_PREVIEW_BYTES)).toString("utf8");
    const normalized = normalizeTextPreview(stripUtf8Bom(raw));
    const fields = readWindowsErrorReportFields(normalized);
    const signature = summarizeWindowsErrorReportSignature(fields);
    const samples = [...fields.entries()]
      .slice(0, MAX_WINDOWS_ERROR_REPORT_FIELD_PREVIEW)
      .map(([key, value]) => `${key}=${maskPotentialSecretValues(value)}`)
      .join("\n");
    return [
      `Windows Error Reporting preview (${formatBytes(size)}).`,
      fields.get("EventType") ? `Event type: ${fields.get("EventType")}.` : "Event type: not detected in the bounded preview.",
      signature,
      fields.get("AppName") ? `Application: ${fields.get("AppName")}.` : "",
      fields.get("FriendlyEventName") ? `Friendly event: ${fields.get("FriendlyEventName")}.` : "",
      samples || "No WER key/value lines were found in the bounded local preview.",
      raw.length >= MAX_WINDOWS_ERROR_REPORT_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_WINDOWS_ERROR_REPORT_PREVIEW_BYTES)}.` : "",
      "Ready for explicit attachment after visible review; WER text was parsed from bounded workspace-local bytes only, with no Windows Error Reporting directory scan, no dump collection, no debugger/procdump process, no symbol lookup, no credential extraction, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows Error Reporting file ready for explicit attachment (${formatBytes(size)}).`,
      "WER preview read bounded workspace-local bytes only; no Windows Error Reporting directory scan, debugger/procdump process, symbol lookup, credential extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsErrorReportFields(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([^=\r\n]{1,120})=(.*)$/);
    if (!match) continue;
    const key = (match[1] || "").trim();
    const value = (match[2] || "").trim();
    if (!key || fields.has(key)) continue;
    fields.set(key, value.slice(0, 240));
    if (fields.size >= MAX_WINDOWS_ERROR_REPORT_FIELD_PREVIEW * 3) break;
  }
  return fields;
}

function summarizeWindowsErrorReportSignature(fields: Map<string, string>): string {
  const pairs: string[] = [];
  for (let index = 0; index < MAX_WINDOWS_ERROR_REPORT_FIELD_PREVIEW; index += 1) {
    const name = fields.get(`Sig[${index}].Name`);
    const value = fields.get(`Sig[${index}].Value`);
    if (!name && !value) continue;
    pairs.push(`${name || `Signature ${index}`}: ${maskPotentialSecretValues(value || "")}`.slice(0, 180));
  }
  return pairs.length > 0
    ? `Problem signature (${pairs.length}${pairs.length >= MAX_WINDOWS_ERROR_REPORT_FIELD_PREVIEW ? "+" : ""}): ${pairs.join(" | ")}.`
    : "Problem signature: none detected in the bounded preview.";
}

function summarizeRegistryExportFile(filePath: string, size: number): string {
  try {
    const raw = readRegistryExportText(filePath, size);
    const normalized = normalizeTextPreview(stripUtf8Bom(raw));
    const keys = extractRegistryExportKeys(normalized).slice(0, MAX_REGISTRY_KEY_PREVIEW);
    const values = extractRegistryExportValues(normalized).slice(0, MAX_REGISTRY_VALUE_PREVIEW);
    const deletions = summarizeRegistryDeletionMarkers(normalized);
    const sample = normalized
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith(";"))
      .slice(0, 10)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Windows registry export preview (${formatBytes(size)}).`,
      keys.length > 0
        ? `Keys (${keys.length}${keys.length >= MAX_REGISTRY_KEY_PREVIEW ? "+" : ""}): ${keys.join(", ")}`
        : "Keys: none detected in the bounded preview.",
      values.length > 0
        ? `Values (${values.length}${values.length >= MAX_REGISTRY_VALUE_PREVIEW ? "+" : ""}): ${values.join(", ")}`
        : "Values: none detected in the bounded preview.",
      deletions,
      sample || "No readable registry export lines were found.",
      "Ready for explicit attachment after visible review; registry text was parsed from bounded workspace-local bytes only, no registry import/export command was executed, no registry hive was opened, no system setting was changed, and no network call or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows registry export ready for explicit attachment (${formatBytes(size)}).`,
      "No registry import/export command was executed, no registry hive was opened, no system setting was changed, and no network call or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readRegistryExportText(filePath: string, size: number): string {
  const buffer = readFileHeader(filePath, Math.min(size, MAX_REGISTRY_EXPORT_PREVIEW_BYTES));
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.subarray(2).swap16().toString("utf16le");
  }
  const nullOdd = buffer.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  if (buffer.length > 8 && nullOdd / Math.max(1, Math.floor(buffer.length / 2)) > 0.35) {
    return buffer.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function extractRegistryExportKeys(raw: string): string[] {
  const keys = new Set<string>();
  for (const match of raw.matchAll(/^\s*\[(-?)([^\]\r\n]+)\]\s*$/gm)) {
    const prefix = match[1] === "-" ? "delete " : "";
    const key = (match[2] || "").trim();
    if (key) keys.add(`${prefix}${key}`.slice(0, 180));
    if (keys.size >= MAX_REGISTRY_KEY_PREVIEW) break;
  }
  return [...keys];
}

function extractRegistryExportValues(raw: string): string[] {
  const values = new Set<string>();
  for (const match of raw.matchAll(/^\s*(?:@|"([^"\r\n]*)")\s*=/gm)) {
    const name = match[1] && match[1].trim() ? match[1].trim() : "(Default)";
    values.add(maskPotentialSecretValues(name).slice(0, 120));
    if (values.size >= MAX_REGISTRY_VALUE_PREVIEW) break;
  }
  return [...values];
}

function summarizeRegistryDeletionMarkers(raw: string): string {
  const deletedKeys = [...raw.matchAll(/^\s*\[-[^\]\r\n]+\]\s*$/gm)].length;
  const deletedValues = [...raw.matchAll(/^\s*(?:@|"[^"\r\n]*")\s*=-\s*$/gm)].length;
  if (deletedKeys === 0 && deletedValues === 0) {
    return "Deletion markers: none detected in the bounded preview.";
  }
  return `Deletion markers: ${deletedKeys} key deletion marker(s), ${deletedValues} value deletion marker(s) detected for review only.`;
}

function summarizeWindowsEventLogFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_EVENT_LOG_PREVIEW_BYTES));
    const metadata = readWindowsEventLogMetadata(buffer);
    if (!metadata) {
      return [
        `Windows Event Log file ready for explicit attachment (${formatBytes(size)}).`,
        "EVTX file header was not recognized in the bounded local preview.",
        "No Event Viewer/wevtutil process, system event channel access, full event XML parsing, credential lookup, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return [
      `Windows Event Log metadata preview (${formatBytes(size)}).`,
      `Header: EVTX ${metadata.majorVersion}.${metadata.minorVersion}; header size ${metadata.headerSize} B; header block ${metadata.headerBlockSize} B.`,
      `Record range hints: first chunk ${metadata.firstChunkNumber}; last chunk ${metadata.lastChunkNumber}; next record id ${metadata.nextRecordId}.`,
      `Chunk signatures sampled: ${metadata.chunkSignatureOffsets.length}${metadata.chunkSignatureOffsets.length >= MAX_WINDOWS_EVENT_LOG_CHUNK_PREVIEW ? "+" : ""}${metadata.chunkSignatureOffsets.length > 0 ? ` at byte offsets ${metadata.chunkSignatureOffsets.join(", ")}` : ""}.`,
      `Record signature samples in bounded preview: ${metadata.recordSignatureSamples}${buffer.length >= MAX_WINDOWS_EVENT_LOG_PREVIEW_BYTES ? "+" : ""}.`,
      `Flags: ${metadata.flags}; checksum: ${metadata.headerChecksum}.`,
      "Ready for explicit attachment after visible review; EVTX metadata was parsed from bounded workspace-local bytes only, with no Event Viewer/wevtutil process, no system event channel access, no full event XML parsing, no credential lookup, no network call, and no provider send performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows Event Log file ready for explicit attachment (${formatBytes(size)}).`,
      "No Event Viewer/wevtutil process, system event channel access, full event XML parsing, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsEventLogMetadata(buffer: Buffer): {
  firstChunkNumber: string;
  lastChunkNumber: string;
  nextRecordId: string;
  headerSize: number;
  minorVersion: number;
  majorVersion: number;
  headerBlockSize: number;
  flags: string;
  headerChecksum: string;
  chunkSignatureOffsets: number[];
  recordSignatureSamples: number;
} | null {
  if (buffer.length < 128 || buffer.subarray(0, 8).toString("binary") !== "ElfFile\u0000") return null;
  const chunkSignatureOffsets = findBinarySignatureOffsets(
    buffer,
    Buffer.from("ElfChnk\0", "binary"),
    MAX_WINDOWS_EVENT_LOG_CHUNK_PREVIEW,
  );
  return {
    firstChunkNumber: readUInt64LeDecimal(buffer, 8),
    lastChunkNumber: readUInt64LeDecimal(buffer, 16),
    nextRecordId: readUInt64LeDecimal(buffer, 24),
    headerSize: buffer.length >= 36 ? buffer.readUInt32LE(32) : 0,
    minorVersion: buffer.length >= 38 ? buffer.readUInt16LE(36) : 0,
    majorVersion: buffer.length >= 40 ? buffer.readUInt16LE(38) : 0,
    headerBlockSize: buffer.length >= 42 ? buffer.readUInt16LE(40) : 0,
    flags: buffer.length >= 124 ? `0x${buffer.readUInt32LE(120).toString(16)}` : "unknown",
    headerChecksum: buffer.length >= 128 ? `0x${buffer.readUInt32LE(124).toString(16)}` : "unknown",
    chunkSignatureOffsets,
    recordSignatureSamples: countBinarySignature(buffer, Buffer.from([0x2a, 0x2a, 0x00, 0x00])),
  };
}

function summarizeWindowsEtlTraceFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_ETL_TRACE_PREVIEW_BYTES));
    const metadata = readWindowsEtlTraceMetadata(buffer);
    const stringSamples =
      metadata.stringSamples.length > 0
        ? metadata.stringSamples.map((value, index) => `${index + 1}. ${value}`).join(" | ")
        : "No readable provider/session string samples were found in the bounded preview.";
    const signatureSamples =
      metadata.signatureOffsets.length > 0
        ? `MSNT signatures sampled: ${metadata.signatureOffsets.length}${metadata.signatureOffsets.length >= MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW ? "+" : ""} at byte offsets ${metadata.signatureOffsets.join(", ")}.`
        : "MSNT signatures sampled: none detected in the bounded preview.";
    return [
      `Windows ETL trace metadata preview (${formatBytes(size)}).`,
      `Header sample: ${metadata.headerHex}.`,
      signatureSamples,
      `Provider/session GUID text samples: ${metadata.guidSamples.length > 0 ? metadata.guidSamples.join(", ") : "none detected in bounded readable text"}.`,
      `Readable provider/session strings (${metadata.stringSamples.length}${metadata.stringSamples.length >= MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW ? "+" : ""}): ${stringSamples}`,
      metadata.truncated ? `Preview was capped at ${formatBytes(MAX_WINDOWS_ETL_TRACE_PREVIEW_BYTES)} or sample limits.` : "",
      "Ready for explicit attachment after visible review; ETL trace metadata was parsed from bounded workspace-local bytes only, with no Windows Performance Analyzer/tracerpt/logman process, no live ETW session access, no provider manifest lookup, no event payload decoding, no credential lookup, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows ETL trace file ready for explicit attachment (${formatBytes(size)}).`,
      "ETL preview read bounded workspace-local bytes only; no Windows Performance Analyzer/tracerpt/logman process, live ETW session access, provider manifest lookup, event payload decoding, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsEtlTraceMetadata(buffer: Buffer): {
  headerHex: string;
  signatureOffsets: number[];
  guidSamples: string[];
  stringSamples: string[];
  truncated: boolean;
} {
  const strings = [
    ...extractPrintableByteRuns(buffer),
    ...extractUtf16LeByteRuns(buffer),
  ]
    .map((value) => maskPotentialSecretValues(value.replace(/\s+/g, " ").trim()))
    .filter((value, index, values) => {
      return (
        value.length >= 4 &&
        value.length <= 220 &&
        !/^[0-9a-f]{24,}$/i.test(value) &&
        values.indexOf(value) === index
      );
    });
  const readableText = strings.join("\n");
  const guidSamples = [...readableText.matchAll(/[({]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[)}]?/gi)]
    .map((match) => clampSingleLine(match[0], 80))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW);
  const stringSamples = strings
    .filter((value) => /[A-Za-z][A-Za-z0-9 .:_\\/-]{3,}/.test(value) && !guidSamples.includes(value))
    .slice(0, MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW);
  return {
    headerHex: buffer.subarray(0, 32).toString("hex").replace(/(.{2})/g, "$1 ").trim() || "empty",
    signatureOffsets: findBinarySignatureOffsets(buffer, Buffer.from("MSNT", "ascii"), MAX_WINDOWS_ETL_TRACE_SAMPLE_PREVIEW),
    guidSamples,
    stringSamples,
    truncated: buffer.length >= MAX_WINDOWS_ETL_TRACE_PREVIEW_BYTES,
  };
}

function summarizeWindowsPerformanceLogFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_PERF_LOG_PREVIEW_BYTES));
    const metadata = readWindowsPerformanceLogMetadata(buffer);
    const counterSamples =
      metadata.counterPathSamples.length > 0
        ? metadata.counterPathSamples.map((value, index) => `${index + 1}. ${value}`).join(" | ")
        : "No readable performance counter path samples were found in the bounded preview.";
    const stringSamples =
      metadata.stringSamples.length > 0
        ? metadata.stringSamples.map((value, index) => `${index + 1}. ${value}`).join(" | ")
        : "No additional readable performance log strings were found in the bounded preview.";
    return [
      `Windows Performance Monitor log metadata preview (BLG, ${formatBytes(size)}).`,
      `Header sample: ${metadata.headerHex}.`,
      `BLG/Perf signature offsets: ${metadata.signatureOffsets.length > 0 ? metadata.signatureOffsets.join(", ") : "none detected in bounded preview"}.`,
      `Performance counter path samples (${metadata.counterPathSamples.length}${metadata.counterPathSamples.length >= MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW ? "+" : ""}): ${counterSamples}`,
      `Readable log strings (${metadata.stringSamples.length}${metadata.stringSamples.length >= MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW ? "+" : ""}): ${stringSamples}`,
      metadata.truncated ? `Preview was capped at ${formatBytes(MAX_WINDOWS_PERF_LOG_PREVIEW_BYTES)} or sample limits.` : "",
      "Ready for explicit attachment after visible review; BLG metadata was parsed from bounded workspace-local bytes only, with no perfmon/relog/typeperf process, no live performance counter access, no log replay, no credential lookup, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows Performance Monitor BLG file ready for explicit attachment (${formatBytes(size)}).`,
      "BLG preview read bounded workspace-local bytes only; no perfmon/relog/typeperf process, live performance counter access, log replay, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsPerformanceLogMetadata(buffer: Buffer): {
  headerHex: string;
  signatureOffsets: number[];
  counterPathSamples: string[];
  stringSamples: string[];
  truncated: boolean;
} {
  const strings = [
    ...extractPrintableByteRuns(buffer),
    ...extractUtf16LeByteRuns(buffer),
  ]
    .map((value) => maskPotentialSecretValues(value.replace(/\s+/g, " ").trim()))
    .filter((value, index, values) => {
      return (
        value.length >= 4 &&
        value.length <= 220 &&
        !/^[0-9a-f]{24,}$/i.test(value) &&
        values.indexOf(value) === index
      );
    });
  const counterPathSamples = strings
    .filter((value) => /\\[^\\]+\\[^\\]+/.test(value) || /\\(Process|Processor|Memory|LogicalDisk|PhysicalDisk|Network Interface)\b/i.test(value))
    .slice(0, MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW);
  const stringSamples = strings
    .filter((value) => /[A-Za-z][A-Za-z0-9 .:_\\/%()-]{3,}/.test(value) && !counterPathSamples.includes(value))
    .slice(0, MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW);
  return {
    headerHex: buffer.subarray(0, 32).toString("hex").replace(/(.{2})/g, "$1 ").trim() || "empty",
    signatureOffsets: [
      ...findBinarySignatureOffsets(buffer, Buffer.from("BLG", "ascii"), MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW),
      ...findBinarySignatureOffsets(buffer, Buffer.from("Perf", "ascii"), MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW),
      ...findBinarySignatureOffsets(buffer, Buffer.from("System Monitor", "utf16le"), MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW),
    ].filter((offset, index, values) => values.indexOf(offset) === index).slice(0, MAX_WINDOWS_PERF_LOG_SAMPLE_PREVIEW),
    counterPathSamples,
    stringSamples,
    truncated: buffer.length >= MAX_WINDOWS_PERF_LOG_PREVIEW_BYTES,
  };
}

function summarizeWindowsPerformanceRecorderProfile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_WPRP_PREVIEW_BYTES)).toString("utf8");
    const normalized = normalizeTextPreview(stripUtf8Bom(raw));
    const summary = summarizeWindowsPerformanceRecorderProfileXml(normalized);
    return [
      `Windows Performance Recorder profile preview (WPRP, ${formatBytes(size)}).`,
      summary,
      raw.length >= MAX_WINDOWS_WPRP_PREVIEW_BYTES ? `WPRP XML preview was capped at ${formatBytes(MAX_WINDOWS_WPRP_PREVIEW_BYTES)}.` : "",
      "Ready for explicit attachment after visible review; WPRP XML was parsed from bounded workspace-local text only, with no wpr.exe launch, no Windows Performance Analyzer startup, no live ETW session access, no profile execution, no provider manifest lookup, no credential lookup, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows Performance Recorder profile file ready for explicit attachment (${formatBytes(size)}).`,
      "WPRP preview read bounded workspace-local text only; no wpr.exe launch, Windows Performance Analyzer startup, live ETW session access, profile execution, provider manifest lookup, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeWindowsPerformanceRecorderProfileXml(xml: string): string {
  const version = readWindowsTaskXmlAttribute(xml.match(/<(?:[\w-]+:)?WindowsPerformanceRecorder\b([^>]*)>/i)?.[1] || "", "Version");
  const profiles = collectXmlLocalElementAttributeSummaries(xml, "Profile", ["Id", "Name", "Description", "Base"]);
  const collectors = [
    ...collectXmlLocalElementAttributeSummaries(xml, "SystemCollector", ["Id", "Name"]),
    ...collectXmlLocalElementAttributeSummaries(xml, "EventCollector", ["Id", "Name"]),
    ...collectXmlLocalElementAttributeSummaries(xml, "HeapEventCollector", ["Id", "Name"]),
  ].slice(0, MAX_WINDOWS_WPRP_ITEM_PREVIEW);
  const providers = collectXmlLocalElementAttributeSummaries(xml, "EventProvider", ["Id", "Name", "NonPagedMemory", "Stack"]);
  const keywords = readXmlLocalTagValues(xml, "Keyword")
    .map(maskPotentialSecretValues)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .slice(0, MAX_WINDOWS_WPRP_ITEM_PREVIEW);
  const stackSettings = [
    ...collectXmlLocalElementAttributeSummaries(xml, "Stack", ["Value"]),
    ...collectXmlLocalElementAttributeSummaries(xml, "StackCaching", ["Value"]),
  ].slice(0, MAX_WINDOWS_WPRP_ITEM_PREVIEW);
  const bufferSettings = ["BufferSize", "Buffers", "MinimumBuffers", "MaximumBuffers", "FlushTimer"]
    .flatMap((tagName) => readXmlLocalTagValues(xml, tagName).slice(0, 2).map((value) => `${tagName}=${maskPotentialSecretValues(value)}`))
    .slice(0, MAX_WINDOWS_WPRP_ITEM_PREVIEW);
  return [
    version ? `Recorder version: ${version}.` : "Recorder version: not declared in the bounded preview.",
    profiles.length > 0 ? `Profiles (${profiles.length}${profiles.length >= MAX_WINDOWS_WPRP_ITEM_PREVIEW ? "+" : ""}): ${profiles.join(" | ")}.` : "Profiles: none detected in the bounded preview.",
    collectors.length > 0 ? `Collectors (${collectors.length}${collectors.length >= MAX_WINDOWS_WPRP_ITEM_PREVIEW ? "+" : ""}): ${collectors.join(" | ")}.` : "Collectors: none detected in the bounded preview.",
    providers.length > 0 ? `Providers (${providers.length}${providers.length >= MAX_WINDOWS_WPRP_ITEM_PREVIEW ? "+" : ""}): ${providers.join(" | ")}.` : "Providers: none detected in the bounded preview.",
    keywords.length > 0 ? `Keywords: ${keywords.join(", ")}.` : "Keywords: none detected in the bounded preview.",
    stackSettings.length > 0 ? `Stack settings: ${stackSettings.join(", ")}.` : "Stack settings: none detected in the bounded preview.",
    bufferSettings.length > 0 ? `Buffer settings: ${bufferSettings.join(", ")}.` : "Buffer settings: none detected in the bounded preview.",
  ].filter(Boolean).join("\n");
}

function looksLikeWindowsEtwProviderManifestXml(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_WINDOWS_ETW_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    return /<(?:[\w-]+:)?instrumentationManifest\b/i.test(raw) ||
      (/<(?:[\w-]+:)?provider\b/i.test(raw) &&
        /<(?:[\w-]+:)?(?:events|event|channels|tasks|opcodes|keywords|templates)\b/i.test(raw));
  } catch {
    return false;
  }
}

function summarizeWindowsEtwProviderManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_ETW_MANIFEST_PREVIEW_BYTES)).toString("utf8");
    const normalized = normalizeTextPreview(stripUtf8Bom(raw));
    const extensionLabel = extension === ".man" ? "MAN" : "ETW manifest XML";
    return [
      `Windows ETW provider manifest preview (${extensionLabel}, ${formatBytes(size)}).`,
      summarizeWindowsEtwProviderManifestXml(normalized),
      raw.length >= MAX_WINDOWS_ETW_MANIFEST_PREVIEW_BYTES
        ? `ETW provider manifest preview was capped at ${formatBytes(MAX_WINDOWS_ETW_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; ETW provider manifest XML was parsed from bounded workspace-local text only, with no mc.exe/wevtutil command, no provider registration, no manifest compilation, no live ETW session access, no provider lookup, no credential lookup, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows ETW provider manifest file ready for explicit attachment (${formatBytes(size)}).`,
      "ETW manifest preview read bounded workspace-local text only; no mc.exe/wevtutil command, provider registration, manifest compilation, live ETW session access, provider lookup, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeWindowsEtwProviderManifestXml(xml: string): string {
  const manifestAttributes = readWindowsEtwManifestRootAttributes(xml);
  const providers = collectWindowsEtwManifestAttributeSummaries(xml, "provider", ["name", "guid", "symbol", "resourceFileName", "messageFileName"]);
  const channels = collectWindowsEtwManifestAttributeSummaries(xml, "channel", ["name", "chid", "type", "enabled"]);
  const events = collectWindowsEtwManifestEventSummaries(xml);
  const templates = collectWindowsEtwManifestAttributeSummaries(xml, "template", ["tid"]);
  const keywords = collectWindowsEtwManifestAttributeSummaries(xml, "keyword", ["name", "mask", "symbol", "message"]);
  const tasks = collectWindowsEtwManifestAttributeSummaries(xml, "task", ["name", "value", "symbol", "eventGUID"]);
  const opcodes = collectWindowsEtwManifestAttributeSummaries(xml, "opcode", ["name", "value", "symbol"]);
  return [
    manifestAttributes || "Manifest root attributes: none detected in the bounded preview.",
    providers.length > 0 ? `Providers (${providers.length}${providers.length >= MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${providers.join(" | ")}.` : "Providers: none detected in the bounded preview.",
    channels.length > 0 ? `Channels (${channels.length}${channels.length >= MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${channels.join(" | ")}.` : "Channels: none detected in the bounded preview.",
    events.length > 0 ? `Events (${events.length}${events.length >= MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${events.join(" | ")}.` : "Events: none detected in the bounded preview.",
    templates.length > 0 ? `Templates: ${templates.join(" | ")}.` : "Templates: none detected in the bounded preview.",
    keywords.length > 0 ? `Keywords: ${keywords.join(" | ")}.` : "Keywords: none detected in the bounded preview.",
    tasks.length > 0 ? `Tasks: ${tasks.join(" | ")}.` : "Tasks: none detected in the bounded preview.",
    opcodes.length > 0 ? `Opcodes: ${opcodes.join(" | ")}.` : "Opcodes: none detected in the bounded preview.",
  ].join("\n");
}

function readWindowsEtwManifestRootAttributes(xml: string): string {
  const attributes = xml.match(/<(?:[\w-]+:)?instrumentationManifest\b([^>]*)>/i)?.[1] || "";
  const names = ["schemaVersion", "xsi:schemaLocation"];
  const values = names
    .map((name) => {
      const value = readWindowsTaskXmlAttribute(attributes, name);
      return value ? `${name}=${maskPotentialSecretValues(value)}` : "";
    })
    .filter(Boolean);
  return values.length > 0 ? `Manifest root attributes: ${values.join(", ")}.` : "";
}

function collectWindowsEtwManifestAttributeSummaries(xml: string, tagName: string, attributeNames: string[]): string[] {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`<(?:[\\w-]+:)?${escaped}\\b([^>]*)>`, "gi");
  const values: string[] = [];
  for (const match of xml.matchAll(matcher)) {
    const attributes = attributeNames
      .map((name) => {
        const value = readWindowsTaskXmlAttribute(match[1] || "", name);
        return value ? `${name}=${maskPotentialSecretValues(value)}` : "";
      })
      .filter(Boolean);
    if (attributes.length > 0) values.push(clampSingleLine(attributes.join(", "), 240));
    if (values.length >= MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW) break;
  }
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function collectWindowsEtwManifestEventSummaries(xml: string): string[] {
  const events = collectWindowsEtwManifestAttributeSummaries(xml, "event", [
    "symbol",
    "value",
    "version",
    "level",
    "task",
    "opcode",
    "keywords",
    "template",
    "channel",
  ]);
  return events.slice(0, MAX_WINDOWS_ETW_MANIFEST_ITEM_PREVIEW);
}

function collectXmlLocalElementAttributeSummaries(xml: string, tagName: string, attributeNames: string[]): string[] {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`<(?:[\\w-]+:)?${escaped}\\b([^>]*)>`, "gi");
  const values: string[] = [];
  for (const match of xml.matchAll(matcher)) {
    const attributes = attributeNames
      .map((name) => {
        const value = readWindowsTaskXmlAttribute(match[1] || "", name);
        return value ? `${name}=${maskPotentialSecretValues(value)}` : "";
      })
      .filter(Boolean);
    if (attributes.length > 0) {
      values.push(clampSingleLine(attributes.join(", "), 220));
    }
    if (values.length >= MAX_WINDOWS_WPRP_ITEM_PREVIEW) break;
  }
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

interface WindowsCrashDumpStreamPreview {
  type: number;
  name: string;
  size: number;
  rva: number;
}

interface WindowsCrashDumpMetadata {
  format: "minidump" | "kernel-or-full-dump" | "unknown";
  signature: string;
  version?: string;
  streamCount?: number;
  streamDirectoryRva?: number;
  checksum?: string;
  timestamp?: string;
  flags?: string;
  streams: WindowsCrashDumpStreamPreview[];
  truncated: boolean;
}

function summarizeWindowsCrashDumpFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES));
    const metadata = readWindowsCrashDumpMetadata(buffer);
    const extensionLabel = extension.toUpperCase().replace(".", "");
    if (!metadata || metadata.format === "unknown") {
      return [
        `Windows crash dump file ready for explicit attachment (${extensionLabel}, ${formatBytes(size)}).`,
        "Crash dump header was not recognized in the bounded local preview.",
        "Crash dump preview read bounded workspace-local bytes only; no WinDbg/cdb/procdump process, symbol lookup, memory scanning, stack unwinding, minidump stream payload extraction, credential extraction, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }

    if (metadata.format === "kernel-or-full-dump") {
      return [
        `Windows crash dump metadata preview (${extensionLabel}, ${formatBytes(size)}).`,
        `Header signature: ${metadata.signature}; this looks like a Windows kernel/full dump header rather than a minidump stream directory.`,
        "Ready for explicit attachment after visible review; only bounded header bytes were inspected, with no WinDbg/cdb/procdump process, symbol lookup, memory scanning, stack unwinding, credential extraction, network call, or provider send performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }

    const streamSummary =
      metadata.streams.length > 0
        ? metadata.streams
            .slice(0, MAX_WINDOWS_CRASH_DUMP_STREAM_PREVIEW)
            .map((stream, index) => `${index + 1}. ${stream.name} (${stream.size} B @ RVA ${stream.rva})`)
            .join(" | ")
        : "No stream directory entries were readable in the bounded local preview.";
    return [
      `Windows crash dump metadata preview (${extensionLabel} minidump, ${formatBytes(size)}).`,
      `Header: version ${metadata.version ?? "unknown"}; streams ${metadata.streamCount ?? "unknown"}; directory RVA ${metadata.streamDirectoryRva ?? "unknown"}; checksum ${metadata.checksum ?? "unknown"}; timestamp ${metadata.timestamp ?? "unknown"}; flags ${metadata.flags ?? "unknown"}.`,
      `Streams sampled (${metadata.streams.length}${(metadata.streamCount ?? 0) > metadata.streams.length ? "+" : ""}): ${streamSummary}.`,
      metadata.truncated ? `Preview was capped at ${formatBytes(MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES)} or stream directory entries exceeded the bounded sample.` : "",
      "Ready for explicit attachment after visible review; minidump metadata was parsed from bounded workspace-local bytes only, with no WinDbg/cdb/procdump process, no symbol lookup, no memory scanning, no stack unwinding, no minidump stream payload extraction, no credential extraction, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows crash dump file ready for explicit attachment (${formatBytes(size)}).`,
      "Crash dump preview read bounded workspace-local bytes only; no WinDbg/cdb/procdump process, symbol lookup, memory scanning, stack unwinding, credential extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsCrashDumpMetadata(buffer: Buffer): WindowsCrashDumpMetadata | null {
  if (buffer.length < 4) return null;
  const signature = buffer.subarray(0, 4).toString("ascii").replace(/\0/g, "\\0");
  if (signature !== "MDMP") {
    const kernelDumpSignatures = new Set(["PAGE", "DUMP", "DU64"]);
    return {
      format: kernelDumpSignatures.has(signature) ? "kernel-or-full-dump" : "unknown",
      signature,
      streams: [],
      truncated: buffer.length >= MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES,
    };
  }
  if (buffer.length < 32) {
    return {
      format: "minidump",
      signature,
      streams: [],
      truncated: true,
    };
  }
  const streamCount = buffer.readUInt32LE(8);
  const streamDirectoryRva = buffer.readUInt32LE(12);
  const streams: WindowsCrashDumpStreamPreview[] = [];
  let truncated = buffer.length >= MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES;
  for (let index = 0; index < Math.min(streamCount, MAX_WINDOWS_CRASH_DUMP_STREAM_PREVIEW); index += 1) {
    const offset = streamDirectoryRva + index * 12;
    if (offset + 12 > buffer.length) {
      truncated = true;
      break;
    }
    const type = buffer.readUInt32LE(offset);
    const dataSize = buffer.readUInt32LE(offset + 4);
    const rva = buffer.readUInt32LE(offset + 8);
    streams.push({
      type,
      name: describeMinidumpStreamType(type),
      size: dataSize,
      rva,
    });
  }
  return {
    format: "minidump",
    signature,
    version: `0x${buffer.readUInt32LE(4).toString(16)}`,
    streamCount,
    streamDirectoryRva,
    checksum: `0x${buffer.readUInt32LE(16).toString(16)}`,
    timestamp: formatUnixTimestamp(buffer.readUInt32LE(20)),
    flags: readUInt64LeHex(buffer, 24),
    streams,
    truncated: truncated || streamCount > streams.length,
  };
}

function describeMinidumpStreamType(type: number): string {
  return (
    {
      3: "ThreadListStream",
      4: "ModuleListStream",
      5: "MemoryListStream",
      6: "ExceptionStream",
      7: "SystemInfoStream",
      8: "ThreadExListStream",
      9: "Memory64ListStream",
      12: "HandleDataStream",
      13: "FunctionTableStream",
      14: "UnloadedModuleListStream",
      15: "MiscInfoStream",
      16: "MemoryInfoListStream",
      17: "ThreadInfoListStream",
      18: "HandleOperationListStream",
      19: "TokenStream",
      20: "JavaScriptDataStream",
      21: "SystemMemoryInfoStream",
      22: "ProcessVmCountersStream",
      23: "IptTraceStream",
      24: "ThreadNamesStream",
    }[type] ?? `StreamType ${type}`
  );
}

function formatUnixTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  const millis = seconds * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}

function readUInt64LeHex(buffer: Buffer, offset: number): string {
  if (buffer.length < offset + 8) return "unknown";
  return `0x${buffer.readBigUInt64LE(offset).toString(16)}`;
}

function readUInt64LeDecimal(buffer: Buffer, offset: number): string {
  if (buffer.length < offset + 8) return "unknown";
  return buffer.readBigUInt64LE(offset).toString(10);
}

function findBinarySignatureOffsets(buffer: Buffer, signature: Buffer, limit: number): number[] {
  const offsets: number[] = [];
  let index = buffer.indexOf(signature);
  while (index >= 0 && offsets.length < limit) {
    offsets.push(index);
    index = buffer.indexOf(signature, index + signature.length);
  }
  return offsets;
}

function countBinarySignature(buffer: Buffer, signature: Buffer): number {
  let count = 0;
  let index = buffer.indexOf(signature);
  while (index >= 0) {
    count += 1;
    index = buffer.indexOf(signature, index + signature.length);
  }
  return count;
}

function summarizeThreeDModelFile(filePath: string, extension: string, size: number): string {
  try {
    const preview =
      extension === ".stl"
        ? summarizeStlModelPreview(filePath)
        : extension === ".obj"
          ? summarizeObjModelPreview(filePath)
          : extension === ".gltf"
            ? summarizeGltfJsonModelPreview(
              readFileHeader(filePath, Math.min(MAX_3D_MODEL_PREVIEW_BYTES, MAX_TEXT_BYTES * 48)).toString("utf8"),
              "glTF JSON",
            )
            : summarizeGlbModelPreview(filePath);
    return [
      `3D model metadata preview (${formatBytes(size)}).`,
      preview,
      "Ready for explicit attachment after visible review; 3D/CAD model metadata was parsed from bounded workspace-local bytes only, with no model renderer, mesh repair, unit conversion, geometry execution, external tool launch, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `3D model file ready for explicit attachment (${formatBytes(size)}).`,
      "3D/CAD preview read bounded local bytes only; no model renderer, mesh repair, unit conversion, geometry execution, external tool launch, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeStlModelPreview(filePath: string): string {
  const buffer = readFileHeader(filePath, MAX_3D_MODEL_PREVIEW_BYTES);
  const sample = buffer.toString("utf8");
  const looksAscii = /^\s*solid\b/i.test(sample) && /\bfacet\s+normal\b/i.test(sample);
  if (looksAscii) {
    const facets = countRegexMatches(sample, /\bfacet\s+normal\b/gi);
    const vertices = countRegexMatches(sample, /^\s*vertex\s+[-+0-9.eE]+\s+[-+0-9.eE]+\s+[-+0-9.eE]+/gim);
    const solids = uniquePreviewMatches(sample, /^\s*solid\s+(.+)$/gim, (match) => match[1] || "", MAX_3D_MODEL_ITEM_PREVIEW);
    return [
      "Format: STL ASCII.",
      `Facets sampled: ${facets}${buffer.length >= MAX_3D_MODEL_PREVIEW_BYTES ? "+" : ""}; vertices sampled: ${vertices}.`,
      solids.length > 0 ? `Solid names: ${solids.join(" | ")}.` : "Solid names: none detected in the bounded preview.",
      buffer.length >= MAX_3D_MODEL_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_3D_MODEL_PREVIEW_BYTES)}.` : "",
    ].filter(Boolean).join("\n");
  }
  const triangleCount = buffer.length >= 84 ? buffer.readUInt32LE(80) : 0;
  const expectedBytes = triangleCount > 0 ? 84 + triangleCount * 50 : 0;
  return [
    "Format: STL binary/header.",
    triangleCount > 0 ? `Triangle count from header: ${triangleCount}.` : "Triangle count: unavailable in bounded header.",
    expectedBytes > 0 ? `Expected binary payload size from header: ${formatBytes(expectedBytes)}.` : "",
    `Header sample: ${clampSingleLine(buffer.subarray(0, 80).toString("latin1").replace(/[^\x20-\x7E]+/g, " "), 160) || "empty"}.`,
  ].filter(Boolean).join("\n");
}

function summarizeObjModelPreview(filePath: string): string {
  const raw = readFileHeader(filePath, Math.min(MAX_3D_MODEL_PREVIEW_BYTES, MAX_TEXT_BYTES * 48)).toString("utf8");
  const lines = normalizeTextPreview(raw).split("\n");
  const counts: Record<string, number> = {};
  const objectNames = new Set<string>();
  const groupNames = new Set<string>();
  const materials = new Set<string>();
  const materialLibraries = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [keyword, ...rest] = trimmed.split(/\s+/);
    if (!keyword) continue;
    counts[keyword] = (counts[keyword] || 0) + 1;
    const value = clampSingleLine(rest.join(" "), 120);
    if (keyword === "o" && value) objectNames.add(value);
    if (keyword === "g" && value) groupNames.add(value);
    if (keyword === "usemtl" && value) materials.add(value);
    if (keyword === "mtllib" && value) materialLibraries.add(value);
  }
  return [
    "Format: Wavefront OBJ.",
    `Geometry counts: vertices ${counts.v || 0}, texture vertices ${counts.vt || 0}, normals ${counts.vn || 0}, faces ${counts.f || 0}.`,
    objectNames.size > 0 ? `Objects: ${[...objectNames].slice(0, MAX_3D_MODEL_ITEM_PREVIEW).join(" | ")}.` : "Objects: none detected in the bounded preview.",
    groupNames.size > 0 ? `Groups: ${[...groupNames].slice(0, MAX_3D_MODEL_ITEM_PREVIEW).join(" | ")}.` : "Groups: none detected in the bounded preview.",
    materials.size > 0 ? `Materials referenced: ${[...materials].slice(0, MAX_3D_MODEL_ITEM_PREVIEW).join(", ")}.` : "Materials referenced: none detected in the bounded preview.",
    materialLibraries.size > 0 ? `Material libraries: ${[...materialLibraries].slice(0, MAX_3D_MODEL_ITEM_PREVIEW).join(", ")}.` : "Material libraries: none detected in the bounded preview.",
    raw.length >= MAX_3D_MODEL_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_3D_MODEL_PREVIEW_BYTES)}.` : "",
  ].filter(Boolean).join("\n");
}

function summarizeGltfJsonModelPreview(raw: string, label: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${label} parse failed in the bounded preview; no model loader, renderer, network call, or external validator was used.`;
  }
  if (!isRecord(parsed)) {
    return `${label} root was not an object in the bounded preview.`;
  }
  const asset = isRecord(parsed.asset) ? parsed.asset : {};
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const meshes = Array.isArray(parsed.meshes) ? parsed.meshes : [];
  const materials = Array.isArray(parsed.materials) ? parsed.materials : [];
  const accessors = Array.isArray(parsed.accessors) ? parsed.accessors : [];
  const buffers = Array.isArray(parsed.buffers) ? parsed.buffers : [];
  const images = Array.isArray(parsed.images) ? parsed.images : [];
  const animations = Array.isArray(parsed.animations) ? parsed.animations : [];
  const meshNames = meshes
    .map((mesh) => isRecord(mesh) ? readRecordString(mesh, "name") : "")
    .filter(Boolean)
    .slice(0, MAX_3D_MODEL_ITEM_PREVIEW);
  const extensions = Array.isArray(parsed.extensionsUsed)
    ? parsed.extensionsUsed.filter((item): item is string => typeof item === "string").slice(0, MAX_3D_MODEL_ITEM_PREVIEW)
    : [];
  const generator = readRecordString(asset, "generator");
  return [
    `Format: ${label}.`,
    `Asset: version ${readRecordString(asset, "version") || "unknown"}${generator ? `; generator ${clampSingleLine(generator, 120)}` : ""}.`,
    `Scene graph counts: scenes ${scenes.length}, nodes ${nodes.length}, meshes ${meshes.length}, materials ${materials.length}, accessors ${accessors.length}, buffers ${buffers.length}, images ${images.length}, animations ${animations.length}.`,
    meshNames.length > 0 ? `Mesh names: ${meshNames.join(" | ")}.` : "Mesh names: none detected in the bounded preview.",
    extensions.length > 0 ? `Extensions used: ${extensions.join(", ")}.` : "Extensions used: none detected in the bounded preview.",
  ].join("\n");
}

function summarizeGlbModelPreview(filePath: string): string {
  const buffer = readFileHeader(filePath, MAX_3D_MODEL_PREVIEW_BYTES);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    return "Format: GLB header not recognized in the bounded preview.";
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  const firstChunkLength = buffer.readUInt32LE(12);
  const firstChunkType = buffer.toString("ascii", 16, 20);
  const parts = [
    "Format: GLB binary glTF.",
    `Header: version ${version}; declared length ${formatBytes(declaredLength)}; first chunk ${firstChunkType || "unknown"} ${formatBytes(firstChunkLength)}.`,
  ];
  if (firstChunkType === "JSON" && buffer.length >= 20 + firstChunkLength) {
    const json = buffer.subarray(20, 20 + firstChunkLength).toString("utf8").replace(/\0+$/g, "");
    parts.push(summarizeGltfJsonModelPreview(json, "GLB JSON chunk"));
  } else {
    parts.push("GLB JSON chunk was not fully available in the bounded preview.");
  }
  if (buffer.length >= MAX_3D_MODEL_PREVIEW_BYTES && declaredLength > buffer.length) {
    parts.push(`Preview was capped at ${formatBytes(MAX_3D_MODEL_PREVIEW_BYTES)}.`);
  }
  return parts.join("\n");
}

function summarizeCadDrawingFile(filePath: string, extension: string, size: number): string {
  try {
    const preview = extension === ".dxf" ? summarizeDxfDrawingPreview(filePath) : summarizeDwgDrawingPreview(filePath);
    return [
      `CAD drawing metadata preview (${formatBytes(size)}).`,
      preview,
      "Ready for explicit attachment after visible review; CAD drawing metadata was parsed from bounded workspace-local bytes only, with no CAD renderer, geometry computation, unit conversion, external validator/tool launch, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `CAD drawing file ready for explicit attachment (${formatBytes(size)}).`,
      "CAD drawing preview read bounded local bytes only; no CAD renderer, geometry computation, unit conversion, external tool launch, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeDwgDrawingPreview(filePath: string): string {
  const buffer = readFileHeader(filePath, MAX_CAD_DRAWING_PREVIEW_BYTES);
  const version = clampSingleLine(buffer.subarray(0, 6).toString("ascii").replace(/[^\x20-\x7E]+/g, ""), 24);
  const headerSample = clampSingleLine(buffer.subarray(0, 96).toString("latin1").replace(/[^\x20-\x7E]+/g, " "), 160);
  return [
    "Format: DWG binary/header.",
    version ? `Version marker: ${version}.` : "Version marker: none detected in the bounded header.",
    `Header sample: ${headerSample || "empty"}.`,
    buffer.length >= MAX_CAD_DRAWING_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_CAD_DRAWING_PREVIEW_BYTES)}.` : "",
  ].filter(Boolean).join("\n");
}

function summarizeDxfDrawingPreview(filePath: string): string {
  const raw = readFileHeader(filePath, Math.min(MAX_CAD_DRAWING_PREVIEW_BYTES, MAX_TEXT_BYTES * 48)).toString("utf8");
  const lines = normalizeTextPreview(raw).split("\n").map((line) => line.trim());
  const sections = new Set<string>();
  const entities = new Map<string, number>();
  const layers = new Set<string>();
  const blocks = new Set<string>();
  const variables = new Set<string>();
  let inSection = "";
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = lines[index];
    const value = clampSingleLine(lines[index + 1], 120);
    if (!code || !value) continue;
    if (code === "0" && value.toUpperCase() === "SECTION") {
      const sectionName = clampSingleLine(lines[index + 3], 80);
      if (sectionName) {
        inSection = sectionName.toUpperCase();
        sections.add(inSection);
      }
      continue;
    }
    if (code === "0" && value.toUpperCase() === "ENDSEC") {
      inSection = "";
      continue;
    }
    if (inSection === "ENTITIES" && code === "0") {
      const entityType = value.toUpperCase();
      entities.set(entityType, (entities.get(entityType) || 0) + 1);
    }
    if (code === "8" && value && layers.size < MAX_CAD_DRAWING_ITEM_PREVIEW) {
      layers.add(value);
    }
    if (inSection === "BLOCKS" && code === "2" && blocks.size < MAX_CAD_DRAWING_ITEM_PREVIEW) {
      blocks.add(value);
    }
    if (inSection === "HEADER" && code === "9" && variables.size < MAX_CAD_DRAWING_ITEM_PREVIEW) {
      variables.add(value);
    }
  }
  const entitySummary = [...entities.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_CAD_DRAWING_ITEM_PREVIEW)
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");
  return [
    "Format: DXF text drawing.",
    sections.size > 0 ? `Sections: ${[...sections].slice(0, MAX_CAD_DRAWING_ITEM_PREVIEW).join(", ")}.` : "Sections: none detected in the bounded preview.",
    entitySummary ? `Entities sampled: ${entitySummary}.` : "Entities sampled: none detected in the bounded preview.",
    layers.size > 0 ? `Layers: ${[...layers].slice(0, MAX_CAD_DRAWING_ITEM_PREVIEW).join(", ")}.` : "Layers: none detected in the bounded preview.",
    blocks.size > 0 ? `Blocks: ${[...blocks].slice(0, MAX_CAD_DRAWING_ITEM_PREVIEW).join(", ")}.` : "Blocks: none detected in the bounded preview.",
    variables.size > 0 ? `Header variables: ${[...variables].slice(0, MAX_CAD_DRAWING_ITEM_PREVIEW).join(", ")}.` : "Header variables: none detected in the bounded preview.",
    raw.length >= MAX_CAD_DRAWING_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_CAD_DRAWING_PREVIEW_BYTES)}.` : "",
  ].filter(Boolean).join("\n");
}

function countRegexMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function summarizeDiagramSourceFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_DIAGRAM_SOURCE_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const normalized = raw
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u0000/g, "")
      .slice(0, MAX_DIAGRAM_SOURCE_PREVIEW_BYTES);
    const preview =
      extension === ".drawio"
        ? summarizeDrawioDiagramPreview(normalized)
        : extension === ".dot" || extension === ".gv"
          ? summarizeGraphvizDiagramPreview(normalized)
        : extension === ".mmd" || extension === ".mermaid"
          ? summarizeMermaidDiagramPreview(normalized)
          : summarizePlantUmlDiagramPreview(normalized);
    const sample = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("%%") && !line.startsWith("'") && !line.startsWith("//"))
      .slice(0, 10)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Diagram source preview (${formatBytes(size)}).`,
      preview,
      sample ? `Source sample:\n${sample}` : "No readable diagram source lines were found in the bounded preview.",
      raw.length >= MAX_DIAGRAM_SOURCE_PREVIEW_BYTES
        ? `Diagram source preview was capped at ${formatBytes(MAX_DIAGRAM_SOURCE_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; diagram metadata was parsed from bounded workspace-local source only, with no diagram renderer, Graphviz, PlantUML/Java process, browser/webview startup, script execution, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Diagram source file ready for explicit attachment (${formatBytes(size)}).`,
      "No diagram renderer, Graphviz, PlantUML/Java process, browser/webview startup, script execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeDrawioDiagramPreview(raw: string): string {
  const pages = [...raw.matchAll(/<diagram\b[^>]*\bname=["']([^"']+)["']/gi)]
    .map((match) => clampSingleLine(decodeXmlEntities(match[1] ?? ""), 100))
    .filter(Boolean)
    .slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
  const vertexCount = countRegexMatches(raw, /<mxCell\b[^>]*\bvertex=["']1["']/gi);
  const edgeCount = countRegexMatches(raw, /<mxCell\b[^>]*\bedge=["']1["']/gi);
  const labels = [...raw.matchAll(/<mxCell\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/gi)]
    .map((match) => decodeXmlEntities(stripHtmlTags(match[1] ?? "")))
    .map((value) => clampSingleLine(maskPotentialSecretValues(value), 120))
    .filter(Boolean)
    .slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
  const compressedPayloads = countRegexMatches(raw, /<diagram\b[^>]*>[^<]{80,}<\/diagram>/gi);
  return [
    "Format: draw.io XML diagram source.",
    pages.length > 0 ? `Pages: ${pages.join(" | ")}.` : "Pages: none named in the bounded preview.",
    `Cells sampled: vertices ${vertexCount}, edges ${edgeCount}.`,
    labels.length > 0 ? `Labels: ${labels.join(" | ")}.` : "Labels: none detected in uncompressed mxCell values.",
    compressedPayloads > 0
      ? `Compressed diagram payloads detected: ${compressedPayloads}; payloads were not rendered or executed.`
      : "Compressed diagram payloads: none detected in the bounded preview.",
  ].join("\n");
}

function summarizeMermaidDiagramPreview(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  const type = readFirstDiagramType(lines, [
    "flowchart",
    "graph",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gantt",
    "pie",
    "mindmap",
    "timeline",
    "gitGraph",
    "C4Context",
  ]);
  const edgeCount = lines.filter((line) => /-->|---|==>|-.->|--|->>/.test(line)).length;
  const participants = lines
    .map((line) => line.match(/^(?:participant|actor)\s+(.+)$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => clampSingleLine(maskPotentialSecretValues(value), 100))
    .slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
  const nodes = collectMermaidNodeHints(lines);
  return [
    `Format: Mermaid diagram source${type ? ` (${type})` : ""}.`,
    `Edges/relationships sampled: ${edgeCount}.`,
    participants.length > 0 ? `Participants: ${participants.join(" | ")}.` : "Participants: none detected in the bounded preview.",
    nodes.length > 0 ? `Node/class hints: ${nodes.join(" | ")}.` : "Node/class hints: none detected in the bounded preview.",
  ].join("\n");
}

function summarizePlantUmlDiagramPreview(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("'") && !line.startsWith("//"));
  const start = lines.find((line) => /^@start/i.test(line)) || "";
  const type = clampSingleLine(start.replace(/^@start/i, "") || "uml", 40);
  const declarations = lines
    .map((line) =>
      line.match(/^(?:participant|actor|boundary|control|entity|database|collections|queue|class|interface|component|node|package|rectangle|usecase)\s+(.+)$/i)?.[1],
    )
    .filter((value): value is string => Boolean(value))
    .map((value) => clampSingleLine(maskPotentialSecretValues(value.replace(/\s+as\s+\S+$/i, "")), 100))
    .slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
  const relationshipCount = lines.filter((line) => /(?:--|->|<-|\.\.|==|-\[|-\|)/.test(line)).length;
  const includeCount = lines.filter((line) => /^!(?:include|includeurl|includesub)\b/i.test(line)).length;
  return [
    `Format: PlantUML diagram source (${type || "uml"}).`,
    `Relationships sampled: ${relationshipCount}.`,
    declarations.length > 0 ? `Declarations: ${declarations.join(" | ")}.` : "Declarations: none detected in the bounded preview.",
    includeCount > 0
      ? `Include directives: ${includeCount}; include targets were not fetched or expanded.`
      : "Include directives: none detected in the bounded preview.",
  ].join("\n");
}

function summarizeGraphvizDiagramPreview(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));
  const declaration = lines.find((line) => /^(?:strict\s+)?(?:di)?graph\b/i.test(line)) || "";
  const typeMatch = declaration.match(/^(strict\s+)?(di)?graph(?:\s+([A-Za-z0-9_.:-]+))?/i);
  const graphKind = typeMatch?.[2] ? "directed graph" : "undirected graph";
  const graphName = typeMatch?.[3]
    ? ` ${clampSingleLine(maskPotentialSecretValues(typeMatch[3]), 80)}`
    : "";
  const edgeCount = lines.filter((line) => /(?:--|->)/.test(line)).length;
  const subgraphs = lines
    .map((line) => line.match(/^subgraph\s+([A-Za-z0-9_.:-]+)/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => clampSingleLine(maskPotentialSecretValues(value), 80))
    .slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
  const nodeHints = collectGraphvizNodeHints(lines);
  return [
    `Format: Graphviz DOT diagram source (${graphKind}${graphName}).`,
    `Edges sampled: ${edgeCount}.`,
    subgraphs.length > 0 ? `Subgraphs/clusters: ${subgraphs.join(" | ")}.` : "Subgraphs/clusters: none detected in the bounded preview.",
    nodeHints.length > 0 ? `Node hints: ${nodeHints.join(" | ")}.` : "Node hints: none detected in the bounded preview.",
  ].join("\n");
}

function readFirstDiagramType(lines: string[], types: string[]): string {
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\b/);
    if (match?.[1] && types.some((type) => type.toLowerCase() === match[1].toLowerCase())) {
      return match[1];
    }
  }
  return "";
}

function collectMermaidNodeHints(lines: string[]): string[] {
  const nodes = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/(?:^|[\s;])([A-Za-z0-9_.:-]+)\s*(?:\[[^\]]+\]|\([^)]+\)|\{[^}]+\})/g)) {
      if (match[1]) nodes.add(clampSingleLine(maskPotentialSecretValues(match[1]), 80));
      if (nodes.size >= MAX_DIAGRAM_SOURCE_ITEM_PREVIEW) break;
    }
    const classMatch = line.match(/^(?:class|interface|state)\s+([A-Za-z0-9_.:-]+)/i);
    if (classMatch?.[1]) nodes.add(clampSingleLine(maskPotentialSecretValues(classMatch[1]), 80));
    if (nodes.size >= MAX_DIAGRAM_SOURCE_ITEM_PREVIEW) break;
  }
  return [...nodes].slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
}

function collectGraphvizNodeHints(lines: string[]): string[] {
  const nodes = new Set<string>();
  const reserved = new Set(["graph", "digraph", "strict", "node", "edge", "subgraph"]);
  for (const line of lines) {
    const nodeDeclaration = line.match(/^"?([A-Za-z0-9_.:-]+)"?\s*(?:\[|;|$)/);
    if (nodeDeclaration?.[1] && !reserved.has(nodeDeclaration[1].toLowerCase())) {
      nodes.add(clampSingleLine(maskPotentialSecretValues(nodeDeclaration[1]), 80));
    }
    for (const match of line.matchAll(/"?([A-Za-z0-9_.:-]+)"?\s*(?:--|->)\s*"?([A-Za-z0-9_.:-]+)"?/g)) {
      if (match[1] && !reserved.has(match[1].toLowerCase())) {
        nodes.add(clampSingleLine(maskPotentialSecretValues(match[1]), 80));
      }
      if (match[2] && !reserved.has(match[2].toLowerCase())) {
        nodes.add(clampSingleLine(maskPotentialSecretValues(match[2]), 80));
      }
      if (nodes.size >= MAX_DIAGRAM_SOURCE_ITEM_PREVIEW) break;
    }
    if (nodes.size >= MAX_DIAGRAM_SOURCE_ITEM_PREVIEW) break;
  }
  return [...nodes].slice(0, MAX_DIAGRAM_SOURCE_ITEM_PREVIEW);
}

function looksLikeWindowsScheduledTaskXml(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_WINDOWS_TASK_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    return /<(?:[\w-]+:)?Task\b/i.test(raw) &&
      (/schemas\.microsoft\.com\/windows\/2004\/02\/mit\/task/i.test(raw) ||
        /<(?:[\w-]+:)?(?:Triggers|Actions|Principals|Settings)\b/i.test(raw));
  } catch {
    return false;
  }
}

function summarizeWindowsScheduledTaskFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_WINDOWS_TASK_PREVIEW_BYTES)).toString("utf8");
    const normalized = normalizeTextPreview(stripUtf8Bom(raw));
    const taskSummary = summarizeWindowsScheduledTaskXml(normalized);
    const extensionLabel = extension === ".task" ? "TASK" : "Task Scheduler XML";
    return [
      `Windows scheduled task preview (${extensionLabel}, ${formatBytes(size)}).`,
      taskSummary,
      raw.length >= MAX_WINDOWS_TASK_PREVIEW_BYTES ? `Task XML preview was capped at ${formatBytes(MAX_WINDOWS_TASK_PREVIEW_BYTES)}.` : "",
      "Ready for explicit attachment after visible review; Task Scheduler XML was parsed from bounded workspace-local bytes only, with no schtasks.exe launch, no Task Scheduler COM/service access, no task registration/update/delete, no action execution, no credential lookup, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows scheduled task file ready for explicit attachment (${formatBytes(size)}).`,
      "Task preview read bounded workspace-local bytes only; no schtasks.exe launch, Task Scheduler service access, task mutation, action execution, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeWindowsScheduledTaskXml(xml: string): string {
  const version = readWindowsTaskXmlAttribute(xml.match(/<(?:[\w-]+:)?Task\b([^>]*)>/i)?.[1] || "", "version");
  const uri = readFirstXmlLocalTagValue(xml, "URI");
  const author = readFirstXmlLocalTagValue(xml, "Author");
  const description = readFirstXmlLocalTagValue(xml, "Description");
  const triggerTypes = collectWindowsTaskTriggerTypes(xml);
  const triggerBoundaries = readXmlLocalTagValues(xml, "StartBoundary").slice(0, MAX_WINDOWS_TASK_ITEM_PREVIEW);
  const actions = collectWindowsTaskActions(xml);
  const principals = collectWindowsTaskPrincipals(xml);
  const settings = collectWindowsTaskSettings(xml);
  return [
    version ? `Task version: ${version}.` : "Task version: not declared in the bounded preview.",
    uri ? `URI: ${maskPotentialSecretValues(uri)}.` : "URI: none detected in the bounded preview.",
    author ? `Author: ${maskPotentialSecretValues(author)}.` : "Author: none detected in the bounded preview.",
    description ? `Description: ${maskPotentialSecretValues(description)}.` : "",
    triggerTypes.length > 0 ? `Triggers: ${triggerTypes.join(", ")}.` : "Triggers: none detected in the bounded preview.",
    triggerBoundaries.length > 0
      ? `Start boundaries: ${triggerBoundaries.map(maskPotentialSecretValues).join(" | ")}.`
      : "Start boundaries: none detected in the bounded preview.",
    actions.length > 0 ? `Actions: ${actions.join(" | ")}.` : "Actions: none detected in the bounded preview.",
    principals.length > 0 ? `Principals: ${principals.join(", ")}.` : "Principals: none detected in the bounded preview.",
    settings.length > 0 ? `Settings: ${settings.join(", ")}.` : "Settings: none detected in the bounded preview.",
  ].filter(Boolean).join("\n");
}

function collectWindowsTaskTriggerTypes(xml: string): string[] {
  const counts = new Map<string, number>();
  for (const match of xml.matchAll(/<(?:[\w-]+:)?(CalendarTrigger|TimeTrigger|BootTrigger|LogonTrigger|EventTrigger|RegistrationTrigger|IdleTrigger|SessionStateChangeTrigger)\b/gi)) {
    const name = match[1] || "Trigger";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, MAX_WINDOWS_TASK_ITEM_PREVIEW)
    .map(([name, count]) => `${name}${count > 1 ? ` x${count}` : ""}`);
}

function collectWindowsTaskActions(xml: string): string[] {
  const actions: string[] = [];
  for (const match of xml.matchAll(/<(?:[\w-]+:)?Exec\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Exec>/gi)) {
    const body = match[1] || "";
    const command = readFirstXmlLocalTagValue(body, "Command");
    const args = readFirstXmlLocalTagValue(body, "Arguments");
    const cwd = readFirstXmlLocalTagValue(body, "WorkingDirectory");
    const summary = [
      command ? `Exec ${command}` : "Exec command not detected",
      args ? `args=${args}` : "",
      cwd ? `cwd=${cwd}` : "",
    ].filter(Boolean).join(" ");
    actions.push(clampSingleLine(maskPotentialSecretValues(summary), 220));
    if (actions.length >= MAX_WINDOWS_TASK_ITEM_PREVIEW) return actions;
  }
  for (const actionName of ["ComHandler", "SendEmail", "ShowMessage"]) {
    const count = countRegexMatches(xml, new RegExp(`<(?:[\\w-]+:)?${actionName}\\b`, "gi"));
    if (count > 0) actions.push(`${actionName}${count > 1 ? ` x${count}` : ""}`);
    if (actions.length >= MAX_WINDOWS_TASK_ITEM_PREVIEW) break;
  }
  return actions.slice(0, MAX_WINDOWS_TASK_ITEM_PREVIEW);
}

function collectWindowsTaskPrincipals(xml: string): string[] {
  return ["UserId", "GroupId", "LogonType", "RunLevel"]
    .flatMap((tagName) => readXmlLocalTagValues(xml, tagName).slice(0, 2).map((value) => `${tagName}=${maskPotentialSecretValues(value)}`))
    .slice(0, MAX_WINDOWS_TASK_ITEM_PREVIEW);
}

function collectWindowsTaskSettings(xml: string): string[] {
  return [
    "Enabled",
    "Hidden",
    "AllowStartOnDemand",
    "MultipleInstancesPolicy",
    "DisallowStartIfOnBatteries",
    "RunOnlyIfNetworkAvailable",
    "ExecutionTimeLimit",
  ]
    .flatMap((tagName) => readXmlLocalTagValues(xml, tagName).slice(0, 1).map((value) => `${tagName}=${maskPotentialSecretValues(value)}`))
    .slice(0, MAX_WINDOWS_TASK_ITEM_PREVIEW);
}

function readFirstXmlLocalTagValue(xml: string, tagName: string): string | null {
  return readXmlLocalTagValues(xml, tagName)[0] || null;
}

function readWindowsTaskXmlAttribute(rawAttributes: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = rawAttributes.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";
  return value ? clampSingleLine(decodeXmlEntities(value), 120) : "";
}

function summarizeAnsibleAutomationFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_ANSIBLE_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const inventoryLike = extension === ".ansible-inventory" || looksLikeAnsibleInventory(normalized);
    const preview = inventoryLike
      ? summarizeAnsibleInventoryPreview(normalized)
      : summarizeAnsiblePlaybookPreview(normalized);
    const sample = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"))
      .slice(0, 12)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Ansible automation preview (${formatBytes(size)}).`,
      preview,
      sample || "No readable Ansible automation lines were found.",
      raw.length >= MAX_ANSIBLE_PREVIEW_BYTES
        ? `Ansible preview was capped at ${formatBytes(MAX_ANSIBLE_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Ansible playbook/inventory metadata was parsed from bounded workspace-local text only, with no ansible-playbook/ansible-inventory/ansible command, no SSH/WinRM connection, no vault decryption, no inventory plugin execution, no collection or role download, no network call, and no provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Ansible automation file ready for explicit attachment (${formatBytes(size)}).`,
      "No ansible-playbook/ansible-inventory/ansible command, SSH/WinRM connection, vault decryption, inventory plugin execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function looksLikeAnsiblePlaybook(raw: string): boolean {
  return (
    /^\s*-\s+hosts\s*:/im.test(raw) ||
    /^\s*hosts\s*:/im.test(raw) ||
    /^\s*tasks\s*:/im.test(raw) ||
    /^\s*-\s+name\s*:/im.test(raw) ||
    /^\s*roles\s*:/im.test(raw) ||
    /^\s*collections\s*:/im.test(raw)
  );
}

function looksLikeAnsibleInventory(raw: string): boolean {
  return (
    /^\s*\[[A-Za-z0-9_.:-]+\]\s*$/m.test(raw) ||
    /\bansible_(?:host|user|port|connection|ssh_private_key_file|winrm_transport)\s*=/.test(raw)
  );
}

function summarizeAnsiblePlaybookPreview(raw: string): string {
  const lines = raw.split("\n");
  const hosts = collectAnsibleYamlValues(lines, "hosts");
  const taskNames = collectAnsibleYamlValues(lines, "name");
  const roles = collectAnsibleRoles(lines);
  const modules = collectAnsibleModuleHints(lines);
  const collections = collectAnsibleYamlValues(lines, "collections");
  const playCount = countRegexMatches(raw, /^\s*-\s+hosts\s*:/gim);
  return [
    `Format hint: Ansible playbook or role task file; plays detected: ${playCount || "unknown"}.`,
    hosts.length > 0 ? `Hosts patterns: ${hosts.join(", ")}` : "Hosts patterns: none detected in the bounded preview.",
    taskNames.length > 0 ? `Task/play names (${taskNames.length}${taskNames.length >= MAX_ANSIBLE_ITEM_PREVIEW ? "+" : ""}): ${taskNames.join(" | ")}` : "Task/play names: none detected in the bounded preview.",
    roles.length > 0 ? `Roles: ${roles.join(", ")}` : "Roles: none detected in the bounded preview.",
    modules.length > 0 ? `Module/action hints: ${modules.join(", ")}` : "Module/action hints: none detected in the bounded preview.",
    collections.length > 0 ? `Collections: ${collections.join(", ")}` : "Collections: none detected in the bounded preview.",
  ].join("\n");
}

function summarizeAnsibleInventoryPreview(raw: string): string {
  const groups = [...raw.matchAll(/^\s*\[([A-Za-z0-9_.:-]+)\]\s*$/gm)]
    .map((match) => clampSingleLine(match[1] || "", 80))
    .filter(Boolean)
    .slice(0, MAX_ANSIBLE_ITEM_PREVIEW);
  const hosts = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";") && !line.startsWith("["))
    .map((line) => clampSingleLine(maskPotentialSecretValues(line.split(/\s+/)[0] || ""), 80))
    .filter(Boolean)
    .slice(0, MAX_ANSIBLE_ITEM_PREVIEW);
  const variables = [...raw.matchAll(/\b(ansible_[A-Za-z0-9_]+)\s*=/g)]
    .map((match) => clampSingleLine(match[1] || "", 80))
    .filter((value, index, array) => value && array.indexOf(value) === index)
    .slice(0, MAX_ANSIBLE_ITEM_PREVIEW);
  return [
    "Format hint: Ansible inventory.",
    groups.length > 0 ? `Groups (${groups.length}${groups.length >= MAX_ANSIBLE_ITEM_PREVIEW ? "+" : ""}): ${groups.join(", ")}` : "Groups: none detected in the bounded preview.",
    hosts.length > 0 ? `Host samples (${hosts.length}${hosts.length >= MAX_ANSIBLE_ITEM_PREVIEW ? "+" : ""}): ${hosts.join(", ")}` : "Host samples: none detected in the bounded preview.",
    variables.length > 0 ? `Ansible variable hints: ${variables.join(", ")}` : "Ansible variable hints: none detected in the bounded preview.",
  ].join("\n");
}

function collectAnsibleYamlValues(lines: string[], key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*-?\\s*${escaped}\\s*:\\s*(.+)$`, "i");
  const values: string[] = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match?.[1]) continue;
    const value = maskPotentialSecretValues(match[1].replace(/[[\]'",]/g, " ").replace(/\s+/g, " ").trim());
    if (value && !values.includes(value)) values.push(clampSingleLine(value, 120));
    if (values.length >= MAX_ANSIBLE_ITEM_PREVIEW) break;
  }
  return values;
}

function collectAnsibleRoles(lines: string[]): string[] {
  const roles = new Set<string>();
  for (const line of lines) {
    const roleMatch = line.match(/^\s*-\s+(?:role:\s*)?([A-Za-z0-9_.-]+)\s*$/);
    if (roleMatch?.[1]) roles.add(clampSingleLine(roleMatch[1], 80));
    const inlineMatch = line.match(/^\s*roles\s*:\s*\[([^\]]+)\]/i);
    if (inlineMatch?.[1]) {
      for (const value of inlineMatch[1].split(",")) {
        const role = value.replace(/["']/g, "").trim();
        if (role) roles.add(clampSingleLine(role, 80));
        if (roles.size >= MAX_ANSIBLE_ITEM_PREVIEW) break;
      }
    }
    if (roles.size >= MAX_ANSIBLE_ITEM_PREVIEW) break;
  }
  return [...roles].slice(0, MAX_ANSIBLE_ITEM_PREVIEW);
}

function collectAnsibleModuleHints(lines: string[]): string[] {
  const modules = new Set<string>();
  const ignored = new Set([
    "always",
    "become",
    "block",
    "collections",
    "debugger",
    "delegate_to",
    "environment",
    "handlers",
    "hosts",
    "ignore_errors",
    "loop",
    "name",
    "notify",
    "register",
    "rescue",
    "roles",
    "tags",
    "tasks",
    "vars",
    "when",
    "with_items",
  ]);
  for (const line of lines) {
    const match = line.match(/^\s{2,}-?\s*([A-Za-z_][\w.]+)\s*:/);
    if (!match?.[1] || ignored.has(match[1])) continue;
    modules.add(clampSingleLine(match[1], 80));
    if (modules.size >= MAX_ANSIBLE_ITEM_PREVIEW) break;
  }
  return [...modules].slice(0, MAX_ANSIBLE_ITEM_PREVIEW);
}

function summarizeCloudIacTemplateFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CLOUD_IAC_TEMPLATE_PREVIEW_BYTES, MAX_TEXT_BYTES * 48),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const preview =
      extension === ".bicep" || extension === ".bicepparam"
        ? summarizeBicepTemplatePreview(normalized)
        : summarizeCloudTemplatePreview(normalized, extension);
    const sample = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .slice(0, 12)
      .map(maskCloudIacSampleLine)
      .join("\n");
    return [
      `Cloud IaC template preview (${formatBytes(size)}).`,
      preview,
      sample || "No readable CloudFormation/ARM/Bicep template lines were found.",
      raw.length >= MAX_CLOUD_IAC_TEMPLATE_PREVIEW_BYTES
        ? `Cloud IaC template preview was capped at ${formatBytes(MAX_CLOUD_IAC_TEMPLATE_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; CloudFormation/SAM, Azure ARM, or Bicep metadata was parsed from bounded workspace-local text only, parameter/default values were not expanded, and no aws/cloudformation/sam/az/bicep command, cloud credential lookup, deployment, state mutation, registry lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Cloud IaC template ready for explicit attachment (${formatBytes(size)}).`,
      "No aws/cloudformation/sam/az/bicep command, cloud credential lookup, deployment, state mutation, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeCloudTemplatePreview(raw: string, extension: string): string {
  const parsed = tryParseJson(raw);
  if (parsed && isPlainRecord(parsed)) {
    if (looksLikeArmTemplate(raw)) return summarizeArmTemplateJsonPreview(parsed);
    return summarizeCloudFormationJsonPreview(parsed, extension);
  }
  return summarizeCloudFormationYamlPreview(raw);
}

function maskCloudIacSampleLine(line: string): string {
  const masked = maskPotentialSecretValues(line);
  return masked.replace(
    /^(\s*["']?(?:default|defaultValue|value)["']?\s*[:=]\s*).+$/i,
    "$1[redacted]",
  );
}

function summarizeCloudFormationJsonPreview(record: Record<string, unknown>, extension: string): string {
  const resources = collectCloudFormationJsonResourceTypes(record.Resources);
  const parameters = collectRecordKeys(record.Parameters);
  const mappings = collectRecordKeys(record.Mappings);
  const outputs = collectRecordKeys(record.Outputs);
  const transform = collectCloudFormationTransforms(record.Transform);
  const description = readRecordString(record, "Description");
  return [
    `Format hint: ${extension === ".arm-template.json" ? "Azure ARM JSON or CloudFormation JSON" : "CloudFormation/SAM JSON"}.`,
    readRecordString(record, "AWSTemplateFormatVersion") ? `AWSTemplateFormatVersion: ${readRecordString(record, "AWSTemplateFormatVersion")}.` : "AWSTemplateFormatVersion: none detected.",
    transform.length > 0 ? `Transforms: ${transform.join(", ")}.` : "Transforms: none detected.",
    description ? `Description: ${clampSingleLine(description, 160)}.` : "Description: none detected.",
    resources.length > 0 ? `Resource types: ${resources.join(", ")}.` : "Resource types: none detected in the bounded preview.",
    parameters.length > 0 ? `Parameters: ${parameters.join(", ")}.` : "Parameters: none detected.",
    mappings.length > 0 ? `Mappings: ${mappings.join(", ")}.` : "Mappings: none detected.",
    outputs.length > 0 ? `Outputs: ${outputs.join(", ")}.` : "Outputs: none detected.",
  ].join("\n");
}

function summarizeCloudFormationYamlPreview(raw: string): string {
  const lines = raw.split("\n");
  const resourceTypes = collectRegexSamples(lines, /^\s*Type\s*:\s*["']?(AWS::[A-Za-z0-9:._-]+)/i);
  const transforms = collectRegexSamples(lines, /^\s*Transform\s*:\s*["']?([A-Za-z0-9:._-]+)/i);
  const sections = collectYamlTopLevelSections(lines);
  const parameters = collectYamlSectionKeys(lines, "Parameters");
  const outputs = collectYamlSectionKeys(lines, "Outputs");
  const mappings = collectYamlSectionKeys(lines, "Mappings");
  return [
    "Format hint: CloudFormation/SAM YAML.",
    transforms.length > 0 ? `Transforms: ${transforms.join(", ")}.` : "Transforms: none detected.",
    sections.length > 0 ? `Top-level sections: ${sections.join(", ")}.` : "Top-level sections: none detected.",
    resourceTypes.length > 0 ? `Resource types: ${resourceTypes.join(", ")}.` : "Resource types: none detected in the bounded preview.",
    parameters.length > 0 ? `Parameters: ${parameters.join(", ")}.` : "Parameters: none detected.",
    mappings.length > 0 ? `Mappings: ${mappings.join(", ")}.` : "Mappings: none detected.",
    outputs.length > 0 ? `Outputs: ${outputs.join(", ")}.` : "Outputs: none detected.",
  ].join("\n");
}

function summarizeArmTemplateJsonPreview(record: Record<string, unknown>): string {
  const resources = collectArmTemplateResources(record.resources);
  const parameters = collectRecordKeys(record.parameters);
  const variables = collectRecordKeys(record.variables);
  const outputs = collectRecordKeys(record.outputs);
  return [
    "Format hint: Azure ARM deployment template JSON.",
    readRecordString(record, "$schema") ? `Schema: ${clampSingleLine(readRecordString(record, "$schema"), 160)}.` : "Schema: none detected.",
    readRecordString(record, "contentVersion") ? `Content version: ${readRecordString(record, "contentVersion")}.` : "Content version: none detected.",
    resources.length > 0 ? `Resource types: ${resources.join(", ")}.` : "Resource types: none detected in the bounded preview.",
    parameters.length > 0 ? `Parameters: ${parameters.join(", ")}.` : "Parameters: none detected.",
    variables.length > 0 ? `Variables: ${variables.join(", ")}.` : "Variables: none detected.",
    outputs.length > 0 ? `Outputs: ${outputs.join(", ")}.` : "Outputs: none detected.",
  ].join("\n");
}

function summarizeBicepTemplatePreview(raw: string): string {
  const lines = raw.split("\n");
  const targetScopes = collectRegexSamples(lines, /^\s*targetScope\s*=\s*['"]?([A-Za-z0-9_-]+)/);
  const resources = collectRegexSamples(lines, /^\s*resource\s+([A-Za-z_][\w-]*)\s+['"]([^'"]+)['"]/)
    .map((sample) => sample.replace(/^([A-Za-z_][\w-]*)\s+/, "$1: "));
  const modules = collectRegexSamples(lines, /^\s*module\s+([A-Za-z_][\w-]*)\s+['"]([^'"]+)['"]/)
    .map((sample) => sample.replace(/^([A-Za-z_][\w-]*)\s+/, "$1: "));
  const parameters = collectRegexSamples(lines, /^\s*param\s+([A-Za-z_][\w-]*)\b/);
  const variables = collectRegexSamples(lines, /^\s*var\s+([A-Za-z_][\w-]*)\b/);
  const outputs = collectRegexSamples(lines, /^\s*output\s+([A-Za-z_][\w-]*)\b/);
  return [
    "Format hint: Azure Bicep template.",
    targetScopes.length > 0 ? `Target scopes: ${targetScopes.join(", ")}.` : "Target scopes: none detected.",
    resources.length > 0 ? `Resources: ${resources.join(", ")}.` : "Resources: none detected in the bounded preview.",
    modules.length > 0 ? `Modules: ${modules.join(", ")}.` : "Modules: none detected.",
    parameters.length > 0 ? `Parameters: ${parameters.join(", ")}.` : "Parameters: none detected.",
    variables.length > 0 ? `Variables: ${variables.join(", ")}.` : "Variables: none detected.",
    outputs.length > 0 ? `Outputs: ${outputs.join(", ")}.` : "Outputs: none detected.",
  ].join("\n");
}

function looksLikeCloudFormationTemplate(raw: string): boolean {
  return (
    /\bAWSTemplateFormatVersion\b/.test(raw) ||
    /\bTransform\s*:\s*AWS::Serverless/i.test(raw) ||
    /"Transform"\s*:\s*"AWS::Serverless/i.test(raw) ||
    /\bType\s*:\s*AWS::[A-Za-z0-9:._-]+/i.test(raw) ||
    /"Type"\s*:\s*"AWS::[A-Za-z0-9:._-]+"/i.test(raw)
  );
}

function looksLikeArmTemplate(raw: string): boolean {
  return (
    /schema\.management\.azure\.com\/schemas\/[0-9-]+\/deploymentTemplate\.json/i.test(raw) ||
    /"contentVersion"\s*:\s*"[^"]+"/i.test(raw) && /"type"\s*:\s*"Microsoft\.[^"]+"/i.test(raw)
  );
}

function collectCloudFormationJsonResourceTypes(value: unknown): string[] {
  if (!isPlainRecord(value)) return [];
  const resources: string[] = [];
  for (const [logicalId, definition] of Object.entries(value)) {
    if (!isPlainRecord(definition)) continue;
    const type = readRecordString(definition, "Type");
    resources.push(type ? `${logicalId}: ${type}` : logicalId);
    if (resources.length >= MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW) break;
  }
  return resources.map((resource) => clampSingleLine(resource, 140));
}

function collectArmTemplateResources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const resources: string[] = [];
  for (const item of value) {
    if (!isPlainRecord(item)) continue;
    const type = readRecordString(item, "type");
    const name = readRecordString(item, "name");
    if (type || name) resources.push(clampSingleLine(name ? `${name}: ${type || "unknown type"}` : type, 140));
    if (resources.length >= MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW) break;
  }
  return resources;
}

function collectRecordKeys(value: unknown): string[] {
  if (!isPlainRecord(value)) return [];
  return Object.keys(value)
    .slice(0, MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW)
    .map((key) => clampSingleLine(key, 80));
}

function collectCloudFormationTransforms(value: unknown): string[] {
  if (typeof value === "string") return [clampSingleLine(value, 120)];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .slice(0, MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW)
      .map((item) => clampSingleLine(item, 120));
  }
  return [];
}

function collectRegexSamples(lines: string[], pattern: RegExp): string[] {
  const samples: string[] = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const value = match.length > 2 ? `${match[1]} ${match[2]}` : match[1];
    if (value) samples.push(clampSingleLine(value, 140));
    if (samples.length >= MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW) break;
  }
  return [...new Set(samples)].slice(0, MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW);
}

function collectYamlTopLevelSections(lines: string): string[];
function collectYamlTopLevelSections(lines: string[]): string[];
function collectYamlTopLevelSections(lines: string[] | string): string[] {
  const input = Array.isArray(lines) ? lines : lines.split("\n");
  const sections = new Set<string>();
  for (const line of input) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:/);
    if (match?.[1]) sections.add(match[1]);
    if (sections.size >= MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW) break;
  }
  return [...sections];
}

function collectYamlSectionKeys(lines: string[], section: string): string[] {
  const keys: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (new RegExp(`^${section}\\s*:`).test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(line)) break;
    if (!inSection) continue;
    const match = line.match(/^\s{2,}([A-Za-z0-9_.-]+)\s*:/);
    if (match?.[1]) keys.push(clampSingleLine(match[1], 80));
    if (keys.length >= MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW) break;
  }
  return [...new Set(keys)].slice(0, MAX_CLOUD_IAC_TEMPLATE_ITEM_PREVIEW);
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeIacConfigFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_IAC_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const preview =
      extension === ".tf.json"
        ? summarizeTerraformJsonPreview(normalized)
        : summarizeHclPreview(normalized, extension);
    const sample = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .slice(0, 12)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Infrastructure-as-code preview (${formatBytes(size)}).`,
      preview,
      sample || "No readable Terraform/HCL configuration lines were found.",
      raw.length >= MAX_IAC_PREVIEW_BYTES
        ? `IaC preview was capped at ${formatBytes(MAX_IAC_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Terraform/HCL metadata was parsed from bounded workspace-local text only, with no terraform init/plan/apply, cloud credential lookup, state mutation, provider plugin download, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Infrastructure-as-code file ready for explicit attachment (${formatBytes(size)}).`,
      "No terraform init/plan/apply, cloud credential lookup, state mutation, provider plugin download, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeHclPreview(raw: string, extension: string): string {
  const lines = raw.split("\n");
  const blocks = extractHclBlocks(lines);
  const assignments = extractHclAssignments(lines);
  const blockCounts = summarizeCounts(blocks.map((block) => block.type));
  const providers = new Set<string>();
  const resources: string[] = [];
  const modules: string[] = [];
  const variables: string[] = [];
  const outputs: string[] = [];
  let backend = "";
  for (const block of blocks) {
    if (block.type === "provider" && block.labels[0]) providers.add(block.labels[0]);
    if (block.type === "resource" && block.labels[0]) {
      providers.add(block.labels[0].split("_")[0] || block.labels[0]);
      resources.push(block.labels.slice(0, 2).join("."));
    }
    if (block.type === "data" && block.labels[0]) {
      providers.add(block.labels[0].split("_")[0] || block.labels[0]);
    }
    if (block.type === "module" && block.labels[0]) modules.push(block.labels[0]);
    if (block.type === "variable" && block.labels[0]) variables.push(block.labels[0]);
    if (block.type === "output" && block.labels[0]) outputs.push(block.labels[0]);
    if (block.type === "backend" && block.labels[0]) backend = block.labels[0];
  }
  if (extension === ".tfvars") {
    for (const assignment of assignments) {
      if (variables.length >= MAX_IAC_BLOCK_PREVIEW) break;
      variables.push(assignment.key);
    }
  }
  return [
    `Blocks: ${blocks.length}${blocks.length >= MAX_IAC_BLOCK_PREVIEW ? "+" : ""}; counts: ${blockCounts || "none detected"}.`,
    providers.size > 0 ? `Providers hinted: ${[...providers].slice(0, MAX_IAC_BLOCK_PREVIEW).join(", ")}` : "Providers hinted: none detected in the bounded preview.",
    resources.length > 0 ? `Resources: ${resources.slice(0, MAX_IAC_BLOCK_PREVIEW).join(", ")}` : "Resources: none detected in the bounded preview.",
    modules.length > 0 ? `Modules: ${modules.slice(0, MAX_IAC_BLOCK_PREVIEW).join(", ")}` : "Modules: none detected in the bounded preview.",
    variables.length > 0 ? `Variables/inputs: ${variables.slice(0, MAX_IAC_BLOCK_PREVIEW).join(", ")}` : "Variables/inputs: none detected in the bounded preview.",
    outputs.length > 0 ? `Outputs: ${outputs.slice(0, MAX_IAC_BLOCK_PREVIEW).join(", ")}` : "Outputs: none detected in the bounded preview.",
    backend ? `Backend hint: ${backend}` : "Backend hint: none detected in the bounded preview.",
  ].join("\n");
}

function summarizeTerraformJsonPreview(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = isPlainRecord(parsed) ? parsed : {};
    const providers = collectTerraformJsonKeys(record.provider);
    const resources = collectTerraformJsonResources(record.resource);
    const dataSources = collectTerraformJsonResources(record.data);
    const modules = collectTerraformJsonKeys(record.module);
    const variables = collectTerraformJsonKeys(record.variable);
    const outputs = collectTerraformJsonKeys(record.output);
    const terraform = isPlainRecord(record.terraform) ? record.terraform : {};
    const backend = collectTerraformJsonKeys(terraform.backend)[0] || "";
    const counts = [
      providers.length ? `provider: ${providers.length}` : "",
      resources.length ? `resource: ${resources.length}` : "",
      dataSources.length ? `data: ${dataSources.length}` : "",
      modules.length ? `module: ${modules.length}` : "",
      variables.length ? `variable: ${variables.length}` : "",
      outputs.length ? `output: ${outputs.length}` : "",
    ].filter(Boolean).join(", ");
    return [
      `Blocks: JSON form; counts: ${counts || "none detected"}.`,
      providers.length > 0 ? `Providers hinted: ${providers.join(", ")}` : "Providers hinted: none detected in the bounded preview.",
      resources.length > 0 ? `Resources: ${resources.join(", ")}` : "Resources: none detected in the bounded preview.",
      dataSources.length > 0 ? `Data sources: ${dataSources.join(", ")}` : "Data sources: none detected in the bounded preview.",
      modules.length > 0 ? `Modules: ${modules.join(", ")}` : "Modules: none detected in the bounded preview.",
      variables.length > 0 ? `Variables/inputs: ${variables.join(", ")}` : "Variables/inputs: none detected in the bounded preview.",
      outputs.length > 0 ? `Outputs: ${outputs.join(", ")}` : "Outputs: none detected in the bounded preview.",
      backend ? `Backend hint: ${backend}` : "Backend hint: none detected in the bounded preview.",
    ].join("\n");
  } catch {
    return "Terraform JSON parse failed in the bounded preview; no external validation or provider lookup was performed.";
  }
}

function extractHclBlocks(lines: string[]): { type: string; labels: string[] }[] {
  const blocks: { type: string; labels: string[] }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const match = trimmed.match(/^([A-Za-z_][\w-]*)\s*((?:"[^"]+"\s*)*)\{/);
    if (!match?.[1]) continue;
    const labels = [...(match[2] || "").matchAll(/"([^"]+)"/g)]
      .map((label) => clampSingleLine(label[1], 80))
      .filter(Boolean);
    blocks.push({ type: match[1], labels });
    if (blocks.length >= MAX_IAC_BLOCK_PREVIEW) break;
  }
  return blocks;
}

function extractHclAssignments(lines: string[]): { key: string }[] {
  const assignments: { key: string }[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^([A-Za-z_][\w-]*)\s*=/);
    if (match?.[1]) assignments.push({ key: clampSingleLine(match[1], 80) });
    if (assignments.length >= MAX_IAC_BLOCK_PREVIEW) break;
  }
  return assignments;
}

function collectTerraformJsonKeys(value: unknown): string[] {
  if (!isPlainRecord(value)) return [];
  return Object.keys(value).slice(0, MAX_IAC_BLOCK_PREVIEW).map((key) => clampSingleLine(key, 80));
}

function collectTerraformJsonResources(value: unknown): string[] {
  if (!isPlainRecord(value)) return [];
  const resources: string[] = [];
  for (const [type, entries] of Object.entries(value)) {
    if (isPlainRecord(entries)) {
      for (const name of Object.keys(entries)) {
        resources.push(clampSingleLine(`${type}.${name}`, 120));
        if (resources.length >= MAX_IAC_BLOCK_PREVIEW) return resources;
      }
    } else {
      resources.push(clampSingleLine(type, 80));
    }
    if (resources.length >= MAX_IAC_BLOCK_PREVIEW) break;
  }
  return resources;
}

interface TerraformPlanPreview {
  formatVersion: string;
  terraformVersion: string;
  actions: string[];
  resources: string[];
  providers: string[];
  modules: string[];
  outputs: string[];
  plannedResources: string[];
  truncated: boolean;
}

function summarizeTerraformPlanJsonFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_TERRAFORM_PLAN_PREVIEW_BYTES).toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    const preview = parseTerraformPlanJsonPreview(parsed, raw.length >= MAX_TERRAFORM_PLAN_PREVIEW_BYTES);
    return [
      `Terraform plan JSON preview (${formatBytes(size)}).`,
      `Format: ${preview.formatVersion || "unknown"}; Terraform: ${preview.terraformVersion || "unknown"}.`,
      preview.actions.length > 0
        ? `Actions (${preview.actions.length}${preview.actions.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.actions.join(", ")}.`
        : "Actions: none detected in bounded resource_changes.",
      preview.resources.length > 0
        ? `Resource changes (${preview.resources.length}${preview.resources.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.resources.join(" | ")}.`
        : "Resource changes: none detected in bounded resource_changes.",
      preview.providers.length > 0
        ? `Providers (${preview.providers.length}${preview.providers.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.providers.join(", ")}.`
        : "Providers: none detected.",
      preview.modules.length > 0
        ? `Modules (${preview.modules.length}${preview.modules.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.modules.join(", ")}.`
        : "Modules: none detected.",
      preview.outputs.length > 0
        ? `Output changes (${preview.outputs.length}${preview.outputs.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.outputs.join(", ")}.`
        : "Output changes: none detected.",
      preview.plannedResources.length > 0
        ? `Planned resource addresses (${preview.plannedResources.length}${preview.plannedResources.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ? "+" : ""}): ${preview.plannedResources.join(" | ")}.`
        : "Planned resource addresses: none detected in bounded planned_values.",
      preview.truncated ? `Terraform plan preview was capped at ${formatBytes(MAX_TERRAFORM_PLAN_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; Terraform plan metadata was parsed from bounded workspace-local JSON only, before/after values were not expanded, and no terraform init/plan/show/apply, cloud credential lookup, state mutation, provider plugin download, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Terraform plan JSON ready for explicit attachment (${formatBytes(size)}).`,
      "Terraform plan preview could not parse bounded local JSON; no terraform init/plan/show/apply, cloud credential lookup, state mutation, provider plugin download, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseTerraformPlanJsonPreview(value: unknown, byteTruncated: boolean): TerraformPlanPreview {
  const root = isPlainRecord(value) ? value : {};
  const actions = new Map<string, number>();
  const resources: string[] = [];
  const providers = new Set<string>();
  const modules = new Set<string>();
  const resourceChanges = Array.isArray(root.resource_changes) ? root.resource_changes : [];
  for (const item of resourceChanges) {
    if (!isPlainRecord(item)) continue;
    const address = clampSingleLine(readRecordString(item, "address") || readRecordString(item, "name") || "unknown", 120);
    const providerName = readRecordString(item, "provider_name");
    if (providerName) providers.add(clampSingleLine(providerName, 100));
    const moduleAddress = readRecordString(item, "module_address") || parseTerraformModuleAddress(address);
    if (moduleAddress) modules.add(clampSingleLine(moduleAddress, 100));
    const change = isPlainRecord(item.change) ? item.change : {};
    const actionList = Array.isArray(change.actions)
      ? change.actions.map((action) => String(action)).filter(Boolean)
      : [];
    const actionLabel = actionList.length > 0 ? actionList.join("+") : "unknown";
    actions.set(actionLabel, (actions.get(actionLabel) ?? 0) + 1);
    if (resources.length < MAX_TERRAFORM_PLAN_ITEM_PREVIEW) {
      resources.push(`${actionLabel} ${maskPotentialSecretValues(address)}`);
    }
    if (
      resources.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW &&
      providers.size >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW &&
      modules.size >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW
    ) {
      break;
    }
  }
  const outputChanges = isPlainRecord(root.output_changes)
    ? Object.keys(root.output_changes).slice(0, MAX_TERRAFORM_PLAN_ITEM_PREVIEW).map((key) => clampSingleLine(key, 80))
    : [];
  const plannedResources = collectTerraformPlanPlannedResources(root.planned_values);
  return {
    formatVersion: clampSingleLine(readRecordString(root, "format_version"), 40),
    terraformVersion: clampSingleLine(readRecordString(root, "terraform_version"), 40),
    actions: [...actions.entries()]
      .map(([action, count]) => `${action}: ${count}`)
      .slice(0, MAX_TERRAFORM_PLAN_ITEM_PREVIEW),
    resources,
    providers: [...providers].slice(0, MAX_TERRAFORM_PLAN_ITEM_PREVIEW),
    modules: [...modules].slice(0, MAX_TERRAFORM_PLAN_ITEM_PREVIEW),
    outputs: outputChanges,
    plannedResources,
    truncated:
      byteTruncated ||
      resourceChanges.length > resources.length ||
      providers.size >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ||
      modules.size >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ||
      outputChanges.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW ||
      plannedResources.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW,
  };
}

function parseTerraformModuleAddress(address: string): string {
  const match = address.match(/^(module\.[^\[]+?)(?:\.|$)/);
  return match?.[1] || "";
}

function collectTerraformPlanPlannedResources(value: unknown): string[] {
  const output: string[] = [];
  const visit = (moduleValue: unknown): void => {
    if (!isPlainRecord(moduleValue) || output.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW) return;
    const resources = Array.isArray(moduleValue.resources) ? moduleValue.resources : [];
    for (const resource of resources) {
      if (!isPlainRecord(resource)) continue;
      const address = readRecordString(resource, "address");
      const type = readRecordString(resource, "type");
      const name = readRecordString(resource, "name");
      const label = address || [type, name].filter(Boolean).join(".");
      if (label) output.push(clampSingleLine(maskPotentialSecretValues(label), 120));
      if (output.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW) return;
    }
    const childModules = Array.isArray(moduleValue.child_modules) ? moduleValue.child_modules : [];
    for (const child of childModules) {
      visit(child);
      if (output.length >= MAX_TERRAFORM_PLAN_ITEM_PREVIEW) return;
    }
  };
  const planned = isPlainRecord(value) ? value : {};
  visit(planned.root_module);
  return output;
}

function summarizeContainerBuildFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CONTAINER_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const instructions = parseContainerBuildInstructions(normalized);
    const instructionCounts = summarizeCounts(instructions.map((item) => item.name));
    const baseImages = instructions
      .filter((item) => item.name === "FROM")
      .map((item) => maskPotentialSecretValues(item.value.replace(/\s+AS\s+\S+$/i, "").trim()))
      .filter(Boolean)
      .slice(0, MAX_CONTAINER_INSTRUCTION_PREVIEW);
    const buildBoundaries = summarizeContainerBuildBoundaries(instructions);
    const sample = instructions
      .slice(0, MAX_CONTAINER_INSTRUCTION_PREVIEW)
      .map((item) => `${item.name} ${maskPotentialSecretValues(item.value)}`.trim())
      .join("\n");
    return [
      `Container build file preview (${formatBytes(size)}).`,
      `Instructions: ${instructions.length}${instructions.length >= MAX_CONTAINER_INSTRUCTION_PREVIEW ? "+" : ""}; counts: ${instructionCounts || "none detected"}.`,
      baseImages.length > 0 ? `Base images: ${baseImages.join(", ")}` : "Base images: none detected in the bounded preview.",
      buildBoundaries,
      sample || "No readable Dockerfile/Containerfile instructions were found.",
      "Ready for explicit attachment after visible review; no container build, image pull, registry lookup, command execution, network call, secret lookup, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Container build file ready for explicit attachment (${formatBytes(size)}).`,
      "No container build, image pull, registry lookup, command execution, network call, secret lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeDockerignoreFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CONTAINER_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 12),
    ).toString("utf8");
    const lines = normalizeTextPreview(raw)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const negated = lines.filter((line) => line.startsWith("!"));
    const sample = lines
      .slice(0, MAX_CONTAINER_INSTRUCTION_PREVIEW)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Docker ignore file preview (${formatBytes(size)}).`,
      `Patterns: ${lines.length}${lines.length >= MAX_CONTAINER_INSTRUCTION_PREVIEW ? "+" : ""}; negated patterns: ${negated.length}.`,
      sample || "No readable .dockerignore patterns were found.",
      "Ready for explicit attachment after visible review; no Docker context packaging, filesystem mutation, image build, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Docker ignore file ready for explicit attachment (${formatBytes(size)}).`,
      "No Docker context packaging, filesystem mutation, image build, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function isContainerComposeFile(filePath: string, extension: string): boolean {
  if (extension !== ".yaml" && extension !== ".yml") return false;
  const name = basename(filePath).toLowerCase();
  return /^(?:docker-)?compose(?:[.-].*)?\.ya?ml$/.test(name);
}

function summarizeContainerComposeFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CONTAINER_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const preview = parseContainerComposePreview(raw);
    return [
      `Docker Compose file preview (${formatBytes(size)}).`,
      preview.version ? `Version: ${preview.version}.` : "Version: not declared in the bounded preview.",
      preview.services.length > 0
        ? `Services (${preview.services.length}${preview.truncated ? "+" : ""}): ${preview.services.join(", ")}.`
        : "Services: none detected in the bounded preview.",
      preview.images.length > 0 ? `Image hints: ${preview.images.join(", ")}.` : "Image hints: none detected.",
      preview.builds.length > 0 ? `Build context hints: ${preview.builds.join(", ")}.` : "Build context hints: none detected.",
      preview.ports.length > 0 ? `Port mappings: ${preview.ports.join(", ")}.` : "",
      preview.dependsOn.length > 0 ? `Depends-on hints: ${preview.dependsOn.join(", ")}.` : "",
      preview.topLevelResources.length > 0 ? `Top-level resources: ${preview.topLevelResources.join(", ")}.` : "",
      preview.profiles.length > 0 ? `Profiles: ${preview.profiles.join(", ")}.` : "",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_CONTAINER_CONFIG_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; Docker Compose metadata was parsed from bounded local YAML only, and no docker compose command, container build, image pull, registry lookup, env-file expansion, secret material read, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Docker Compose file ready for explicit attachment (${formatBytes(size)}).`,
      "No docker compose command, container build, image pull, registry lookup, env-file expansion, secret material read, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseContainerComposePreview(raw: string): {
  version: string;
  services: string[];
  images: string[];
  builds: string[];
  ports: string[];
  dependsOn: string[];
  profiles: string[];
  topLevelResources: string[];
  truncated: boolean;
} {
  const lines = normalizeTextPreview(raw).split("\n");
  const version = extractYamlScalarValue(lines, "version");
  const services = extractYamlMapKeysUnderSection(lines, "services", MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW);
  const serviceBlocks = services.map((service) => ({
    service,
    block: extractYamlNamedBlock(lines, "services", service),
  }));
  const images = new Set<string>();
  const builds = new Set<string>();
  const ports = new Set<string>();
  const dependsOn = new Set<string>();
  const profiles = new Set<string>();

  for (const { service, block } of serviceBlocks) {
    const image = extractYamlScalarValue(block, "image");
    if (image) images.add(`${service}=${maskPotentialSecretValues(image)}`);
    const build = extractComposeBuildHint(block);
    if (build) builds.add(`${service}=${maskPotentialSecretValues(build)}`);
    for (const port of extractYamlListValues(block, "ports", 3)) {
      ports.add(`${service}:${maskPotentialSecretValues(port)}`);
      if (ports.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW) break;
    }
    for (const dependency of extractComposeDependencyHints(block).slice(0, 3)) {
      dependsOn.add(`${service}->${dependency}`);
      if (dependsOn.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW) break;
    }
    for (const profile of extractYamlListValues(block, "profiles", 3)) {
      profiles.add(profile);
      if (profiles.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW) break;
    }
  }

  const topLevelResources = ["volumes", "networks", "secrets", "configs"]
    .flatMap((section) =>
      extractYamlMapKeysUnderSection(lines, section, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW)
        .map((name) => `${section}.${name}`),
    )
    .slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW);

  return {
    version,
    services,
    images: [...images].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW),
    builds: [...builds].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW),
    ports: [...ports].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW),
    dependsOn: [...dependsOn].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW),
    profiles: [...profiles].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW),
    topLevelResources,
    truncated:
      raw.length >= MAX_CONTAINER_CONFIG_PREVIEW_BYTES ||
      services.length >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW ||
      images.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW ||
      builds.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW ||
      ports.size >= MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW,
  };
}

function extractComposeBuildHint(lines: string[]): string {
  const scalar = extractYamlScalarValue(lines, "build");
  if (scalar) return scalar;
  const buildBlock = extractYamlBlockUnderKey(lines, "build");
  return extractYamlScalarValue(buildBlock, "context") || (buildBlock.length > 0 ? "object" : "");
}

function extractComposeDependencyHints(lines: string[]): string[] {
  const scalar = extractYamlScalarValue(lines, "depends_on");
  if (scalar) return scalar.split(",").map((item) => cleanYamlScalar(item)).filter(Boolean);
  const block = extractYamlBlockUnderKey(lines, "depends_on");
  const listValues = extractInlineYamlListValues(block).concat(
    block
      .map((line) => line.trim().match(/^-\s*(.+)$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(cleanYamlScalar),
  );
  const mapKeys = block
    .map((line) => line.trim().match(/^([A-Za-z0-9_.-]+)\s*:/)?.[1])
    .filter((value): value is string => Boolean(value));
  return [...new Set([...listValues, ...mapKeys])].slice(0, MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW);
}

function extractYamlScalarValue(lines: string[], key: string): string {
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(.+?)\\s*(?:#.*)?$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return cleanYamlScalar(match[1]);
  }
  return "";
}

function extractYamlMapKeysUnderSection(lines: string[], section: string, limit: number): string[] {
  const block = extractYamlBlockUnderKey(lines, section);
  const childIndent = firstContentIndent(block);
  if (childIndent === null) return [];
  const keys: string[] = [];
  for (const line of block) {
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = countLeadingSpaces(line);
    if (indent !== childIndent) continue;
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (match?.[1]) keys.push(clampSingleLine(match[1], 100));
    if (keys.length >= limit) break;
  }
  return keys;
}

function extractYamlNamedBlock(lines: string[], section: string, key: string): string[] {
  const sectionBlock = extractYamlBlockUnderKey(lines, section);
  const childIndent = firstContentIndent(sectionBlock);
  if (childIndent === null) return [];
  const start = sectionBlock.findIndex((line) => {
    if (countLeadingSpaces(line) !== childIndent) return false;
    return new RegExp(`^\\s*${escapeRegex(key)}\\s*:`).test(line);
  });
  if (start < 0) return [];
  const block: string[] = [];
  for (let index = start + 1; index < sectionBlock.length; index += 1) {
    const line = sectionBlock[index] ?? "";
    if (!/^\s*(#|$)/.test(line) && countLeadingSpaces(line) <= childIndent) break;
    block.push(line);
  }
  return block;
}

function extractYamlBlockUnderKey(lines: string[], key: string): string[] {
  const start = lines.findIndex((line) => new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(?:#.*)?$`, "i").test(line));
  if (start < 0) return [];
  const parentIndent = countLeadingSpaces(lines[start] ?? "");
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^\s*(#|$)/.test(line) && countLeadingSpaces(line) <= parentIndent) break;
    block.push(line);
  }
  return block;
}

function extractYamlListValues(lines: string[], key: string, limit: number): string[] {
  const scalar = extractYamlScalarValue(lines, key);
  if (scalar.startsWith("[") && scalar.endsWith("]")) {
    return scalar.slice(1, -1).split(",").map(cleanYamlScalar).filter(Boolean).slice(0, limit);
  }
  const block = extractYamlBlockUnderKey(lines, key);
  return block
    .map((line) => line.trim().match(/^-\s*(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(cleanYamlScalar)
    .filter(Boolean)
    .slice(0, limit);
}

function extractInlineYamlListValues(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") && line.endsWith("]"))
    .flatMap((line) => line.slice(1, -1).split(","))
    .map(cleanYamlScalar)
    .filter(Boolean);
}

function firstContentIndent(lines: string[]): number | null {
  for (const line of lines) {
    if (/^\s*(#|$)/.test(line)) continue;
    return countLeadingSpaces(line);
  }
  return null;
}

function countLeadingSpaces(value: string): number {
  return value.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
}

function isBuildManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    name === "pom.xml" ||
    name === "build.gradle" ||
    name === "settings.gradle" ||
    name === "build.gradle.kts" ||
    name === "settings.gradle.kts" ||
    [
      ".csproj",
      ".fsproj",
      ".gradle",
      ".gradle.kts",
      ".props",
      ".sln",
      ".targets",
      ".vbproj",
    ].includes(extension)
  );
}

function summarizeBuildManifestFile(filePath: string, extension: string, size: number): string {
  const name = basename(filePath);
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_BUILD_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    if (basename(filePath).toLowerCase() === "pom.xml") {
      return summarizeMavenPomManifest(normalized, size);
    }
    if (extension === ".sln") {
      return summarizeSolutionManifest(normalized, size);
    }
    if (extension === ".gradle" || extension === ".gradle.kts") {
      return summarizeGradleManifest(normalized, extension, size);
    }
    if (isMsBuildManifestExtension(extension)) {
      return summarizeMsBuildManifest(normalized, extension, size);
    }
    return [
      `Build manifest ready for explicit attachment (${formatBytes(size)}).`,
      maskPotentialSecretValues(normalized).slice(0, MAX_TEXT_BYTES - 260) || "No readable build manifest text was found.",
      "Build manifest preview read bounded workspace-local text only; no Maven/Gradle/MSBuild/dotnet command, package restore, plugin execution, external schema lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Build manifest ready for explicit attachment (${formatBytes(size)}).`,
      `${name} could not be read as bounded local text.`,
      "No Maven/Gradle/MSBuild/dotnet command, package restore, plugin execution, external schema lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function isDotnetNugetConfigFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".dotnet-global.json", ".nuget.config", ".packages.config", ".nuspec"].includes(extension) ||
    name === "global.json" ||
    name === "nuget.config" ||
    name === "packages.config" ||
    name.endsWith(".nuspec")
  );
}

function summarizeDotnetNugetConfigFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_DOTNET_NUGET_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    if (extension === ".dotnet-global.json") {
      return summarizeDotnetGlobalJson(normalized, size);
    }
    if (extension === ".nuget.config") {
      return summarizeNugetConfigFile(normalized, size);
    }
    if (extension === ".packages.config") {
      return summarizeNugetPackagesConfigFile(normalized, size);
    }
    return summarizeNuspecFile(normalized, size);
  } catch {
    return [
      `.NET/NuGet configuration ready for explicit attachment (${formatBytes(size)}).`,
      `${basename(filePath)} could not be read as bounded workspace-local text.`,
      "No dotnet/NuGet/MSBuild command, package restore, workload install, credential lookup, package source probe, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeDotnetGlobalJson(raw: string, size: number): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const sdk = readRecordValue(parsed, "sdk");
    const sdkVersion = isPlainRecord(sdk) && typeof sdk.version === "string" ? sdk.version : "";
    const rollForward = isPlainRecord(sdk) && typeof sdk.rollForward === "string" ? sdk.rollForward : "";
    const allowPrerelease = isPlainRecord(sdk) && typeof sdk.allowPrerelease === "boolean" ? String(sdk.allowPrerelease) : "";
    const msbuildSdks = readRecordValue(parsed, "msbuild-sdks");
    const msbuildSdkEntries = isPlainRecord(msbuildSdks)
      ? Object.entries(msbuildSdks)
          .map(([name, version]) => `${name}@${typeof version === "string" ? version : "configured"}`)
          .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW)
      : [];
    return [
      `.NET SDK global.json preview (${formatBytes(size)}).`,
      `SDK version: ${sdkVersion || "none detected in the bounded preview"}.`,
      rollForward ? `Roll-forward: ${rollForward}.` : "Roll-forward: none detected.",
      allowPrerelease ? `Allow prerelease SDK: ${allowPrerelease}.` : "Allow prerelease SDK: none detected.",
      msbuildSdkEntries.length > 0 ? `MSBuild SDK pins (${msbuildSdkEntries.length}${msbuildSdkEntries.length >= MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${msbuildSdkEntries.join(", ")}.` : "MSBuild SDK pins: none detected.",
      "Ready for explicit attachment after visible review; .NET SDK metadata was parsed from bounded workspace-local JSON only, and no dotnet command, SDK resolution, workload install, package restore, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `.NET SDK global.json ready for explicit attachment (${formatBytes(size)}).`,
      "global.json could not be parsed from the bounded local JSON preview.",
      "No dotnet command, SDK resolution, workload install, package restore, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeNugetConfigFile(raw: string, size: number): string {
  const sourceEntries = extractNugetConfigAddEntries(raw, "packageSources");
  const disabledSources = extractNugetConfigAddEntries(raw, "disabledPackageSources");
  const configEntries = extractNugetConfigAddEntries(raw, "config");
  const credentialSources = extractNugetCredentialSourceNames(raw);
  return [
    `NuGet config preview (${formatBytes(size)}).`,
    sourceEntries.length > 0 ? `Package sources (${sourceEntries.length}${sourceEntries.length >= MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${sourceEntries.join(" | ")}.` : "Package sources: none detected in the bounded preview.",
    disabledSources.length > 0 ? `Disabled sources: ${disabledSources.join(" | ")}.` : "Disabled sources: none detected.",
    configEntries.length > 0 ? `Config keys: ${configEntries.join(" | ")}.` : "Config keys: none detected.",
    credentialSources.length > 0 ? `Credential sections present for sources: ${credentialSources.join(", ")}; credential values were not expanded.` : "Credential sections: none detected.",
    "Ready for explicit attachment after visible review; NuGet metadata was parsed from bounded workspace-local XML only, packageSourceCredentials values were not expanded, and no dotnet/NuGet command, restore, package source probe, credential lookup, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeNugetPackagesConfigFile(raw: string, size: number): string {
  const packages = [...raw.matchAll(/<package\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = readXmlAttributes(match[1] || "");
      const id = attrs.get("id") || attrs.get("Id") || "";
      const version = attrs.get("version") || attrs.get("Version") || "";
      const targetFramework = attrs.get("targetFramework") || attrs.get("TargetFramework") || "";
      return id ? clampSingleLine(`${id}${version ? ` ${version}` : ""}${targetFramework ? ` (${targetFramework})` : ""}`, 180) : "";
    })
    .filter(Boolean)
    .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW);
  return [
    `NuGet packages.config preview (${formatBytes(size)}).`,
    packages.length > 0 ? `Packages (${packages.length}${packages.length >= MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${packages.join(", ")}.` : "Packages: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; packages.config package metadata was parsed from bounded workspace-local XML only, and no NuGet restore, package install, dependency resolution, registry lookup, credential lookup, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeNuspecFile(raw: string, size: number): string {
  const metadataBlock = raw.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i)?.[1] ?? raw;
  const packageId = firstXmlTagValue(metadataBlock, "id") || "";
  const version = firstXmlTagValue(metadataBlock, "version") || "";
  const authors = firstXmlTagValue(metadataBlock, "authors") || "";
  const license = firstXmlTagValue(metadataBlock, "license") || firstXmlTagValue(metadataBlock, "licenseUrl") || "";
  const dependencies = extractNuspecDependencies(metadataBlock);
  const files = [...raw.matchAll(/<file\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = readXmlAttributes(match[1] || "");
      const src = attrs.get("src") || "";
      const target = attrs.get("target") || "";
      return src ? clampSingleLine(`${src}${target ? ` -> ${target}` : ""}`, 180) : "";
    })
    .filter(Boolean)
    .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW);
  return [
    `NuGet package specification preview (${formatBytes(size)}).`,
    `Package: ${[packageId, version].filter(Boolean).join(" ") || "none detected in the bounded preview"}.`,
    authors ? `Authors: ${clampSingleLine(authors, 160)}.` : "Authors: none detected.",
    license ? `License metadata: ${clampSingleLine(maskPotentialSecretValues(license), 160)}.` : "License metadata: none detected.",
    dependencies.length > 0 ? `Dependencies (${dependencies.length}${dependencies.length >= MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.` : "Dependencies: none detected in the bounded preview.",
    files.length > 0 ? `Files (${files.length}${files.length >= MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${files.join(" | ")}.` : "Files: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; .nuspec metadata was parsed from bounded workspace-local XML only, and no dotnet/NuGet pack, restore, package validation, license compliance scan, registry lookup, credential lookup, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractNugetConfigAddEntries(raw: string, sectionName: string): string[] {
  const section = raw.match(new RegExp(`<${sectionName}\\b[^>]*>([\\s\\S]*?)<\\/${sectionName}>`, "i"))?.[1] ?? "";
  return [...section.matchAll(/<add\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = readXmlAttributes(match[1] || "");
      const key = attrs.get("key") || attrs.get("Key") || "";
      const value = attrs.get("value") || attrs.get("Value") || "";
      return key ? clampSingleLine(`${key}${value ? `=${maskPotentialSecretValues(value)}` : ""}`, 180) : "";
    })
    .filter(Boolean)
    .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW);
}

function extractNugetCredentialSourceNames(raw: string): string[] {
  const block = raw.match(/<packageSourceCredentials\b[^>]*>([\s\S]*?)<\/packageSourceCredentials>/i)?.[1] ?? "";
  return [...block.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>/g)]
    .map((match) => match[1] || "")
    .filter((name) => !["add", "clear", "remove"].includes(name.toLowerCase()))
    .map((name) => clampSingleLine(name, 120))
    .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW);
}

function extractNuspecDependencies(xml: string): string[] {
  return [...xml.matchAll(/<dependency\b([^>]*)\/?>/gi)]
    .map((match) => {
      const attrs = readXmlAttributes(match[1] || "");
      const id = attrs.get("id") || attrs.get("Id") || "";
      const version = attrs.get("version") || attrs.get("Version") || "";
      return id ? clampSingleLine(`${id}${version ? ` ${version}` : ""}`, 160) : "";
    })
    .filter(Boolean)
    .slice(0, MAX_DOTNET_NUGET_CONFIG_ITEM_PREVIEW);
}

function isCppBuildManifestFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [".cmake", ".cmakelists.txt", ".compile_commands.json", ".makefile"].includes(extension) ||
    name === "cmakelists.txt" ||
    name === "compile_commands.json" ||
    ["makefile", "gnumakefile", "bsdmakefile"].includes(name) ||
    name.endsWith(".mk")
  );
}

function summarizeCppBuildManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CPP_BUILD_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    if (extension === ".compile_commands.json") {
      return summarizeCompileCommandsManifest(normalized, size);
    }
    if (extension === ".cmake" || extension === ".cmakelists.txt") {
      return summarizeCmakeBuildManifest(normalized, extension, size);
    }
    return summarizeMakeBuildManifest(normalized, size);
  } catch {
    return [
      `C/C++ build manifest ready for explicit attachment (${formatBytes(size)}).`,
      `${basename(filePath)} could not be read as bounded workspace-local text.`,
      "No cmake/make/ninja/compiler command, package restore, configure step, build target execution, external schema lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeCmakeBuildManifest(raw: string, extension: string, size: number): string {
  const calls = extractCmakeCalls(raw);
  const project = calls.find((call) => call.name === "project")?.args;
  const targets = calls
    .filter((call) => ["add_executable", "add_library"].includes(call.name))
    .map((call) => clampSingleLine(`${call.name} ${call.args}`, 180))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  const packages = calls
    .filter((call) => call.name === "find_package")
    .map((call) => clampSingleLine(call.args, 160))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  const subdirectories = calls
    .filter((call) => call.name === "add_subdirectory")
    .map((call) => clampSingleLine(call.args, 160))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  const options = calls
    .filter((call) => call.name === "option")
    .map((call) => clampSingleLine(call.args, 180))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  const links = calls
    .filter((call) => call.name === "target_link_libraries")
    .map((call) => clampSingleLine(call.args, 180))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  return [
    `C/C++ build manifest preview (${extension === ".cmakelists.txt" ? "CMakeLists.txt" : "CMake module"}, ${formatBytes(size)}).`,
    project ? `Project: ${project}.` : "Project: none detected in the bounded local preview.",
    targets.length > 0 ? `Targets (${targets.length}${targets.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${targets.join(" | ")}.` : "Targets: none detected in the bounded preview.",
    packages.length > 0 ? `Packages (${packages.length}${packages.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${packages.join(" | ")}.` : "Packages: none detected in the bounded preview.",
    links.length > 0 ? `Target links (${links.length}${links.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${links.join(" | ")}.` : "Target links: none detected in the bounded preview.",
    subdirectories.length > 0 ? `Subdirectories (${subdirectories.length}${subdirectories.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${subdirectories.join(" | ")}.` : "Subdirectories: none detected in the bounded preview.",
    options.length > 0 ? `Options (${options.length}${options.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${options.join(" | ")}.` : "Options: none detected in the bounded preview.",
    "CMake project/target/package metadata was parsed from bounded workspace-local text only; no cmake/make/ninja/compiler command, configure step, package discovery, generator invocation, external schema lookup, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractCmakeCalls(raw: string): { name: string; args: string }[] {
  const withoutComments = raw
    .split("\n")
    .map((line) => line.replace(/(^|[^\\])#.*/, "$1"))
    .join("\n");
  const calls: { name: string; args: string }[] = [];
  const pattern = /\b(project|add_executable|add_library|find_package|target_link_libraries|add_subdirectory|option)\s*\(([\s\S]*?)\)/gi;
  for (const match of withoutComments.matchAll(pattern)) {
    const name = (match[1] || "").toLowerCase();
    const args = maskPotentialSecretValues((match[2] || "").replace(/\s+/g, " ").trim());
    if (name && args) calls.push({ name, args: clampSingleLine(args, 220) });
    if (calls.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW * 4) break;
  }
  return calls;
}

function summarizeMakeBuildManifest(raw: string, size: number): string {
  const lines = raw.split("\n");
  const targets = extractMakeTargets(lines);
  const includes = lines
    .map((line) => line.match(/^\s*(?:-?include|sinclude)\s+(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => clampSingleLine(maskPotentialSecretValues(value), 160))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  const variables = lines
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*[:?+]?=)\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1]))
    .map((match) => clampSingleLine(`${match[1]}=${maskPotentialSecretValues(match[2] || "")}`, 180))
    .slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW);
  return [
    `C/C++ build manifest preview (Makefile, ${formatBytes(size)}).`,
    targets.length > 0 ? `Targets (${targets.length}${targets.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${targets.join(", ")}.` : "Targets: none detected in the bounded preview.",
    includes.length > 0 ? `Includes (${includes.length}${includes.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${includes.join(", ")}.` : "Includes: none detected in the bounded preview.",
    variables.length > 0 ? `Variables (${variables.length}${variables.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${variables.join(" | ")}.` : "Variables: none detected in the bounded preview.",
    "Make target/include/variable metadata was parsed from bounded workspace-local text only; no make/nmake/ninja/compiler command, target execution, include expansion beyond the reviewed file, shell recipe execution, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractMakeTargets(lines: string[]): string[] {
  const targets: string[] = [];
  for (const line of lines) {
    if (/^\s*(#|$|\t)/.test(line)) continue;
    if (/^\s*(?:if|ifdef|ifndef|ifeq|ifneq|else|endif|include|sinclude|-include)\b/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_.%/$(){}+-][^:=#]*?)\s*:(?![=])[^=]?.*$/);
    if (!match?.[1]) continue;
    const names = match[1].split(/\s+/).map((value) => value.trim()).filter(Boolean);
    for (const name of names) {
      targets.push(clampSingleLine(name, 120));
      if (targets.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW) return targets;
    }
  }
  return targets;
}

function summarizeCompileCommandsManifest(raw: string, size: number): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed) ? parsed.filter(isPlainRecord) : [];
    const directories = new Set<string>();
    const files: string[] = [];
    const commandHints = new Set<string>();
    for (const entry of entries.slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW)) {
      if (typeof entry.directory === "string" && entry.directory.trim()) {
        directories.add(clampSingleLine(entry.directory, 160));
      }
      if (typeof entry.file === "string" && entry.file.trim()) {
        files.push(clampSingleLine(entry.file, 160));
      }
      const command = typeof entry.command === "string" ? entry.command : Array.isArray(entry.arguments) ? entry.arguments.join(" ") : "";
      const compiler = command.trim().split(/\s+/)[0] || "";
      if (compiler) commandHints.add(clampSingleLine(maskPotentialSecretValues(compiler), 100));
    }
    return [
      `C/C++ build manifest preview (compile_commands.json, ${formatBytes(size)}).`,
      `Compile database entries: ${entries.length}.`,
      directories.size > 0 ? `Directories (${Math.min(directories.size, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW)}${directories.size >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${[...directories].slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW).join(" | ")}.` : "Directories: none detected in the bounded preview.",
      files.length > 0 ? `Files (${files.length}${files.length >= MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${files.slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW).join(" | ")}.` : "Files: none detected in the bounded preview.",
      commandHints.size > 0 ? `Compiler command hints: ${[...commandHints].slice(0, MAX_CPP_BUILD_MANIFEST_ITEM_PREVIEW).join(", ")}.` : "Compiler command hints: none detected in sampled entries.",
      "compile database entries were parsed from bounded workspace-local JSON only; no cmake/make/ninja/compiler command, compile invocation, include probing, file-system graph expansion, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `C/C++ build manifest ready for explicit attachment (${formatBytes(size)}).`,
      "compile_commands.json could not be parsed from the bounded local JSON preview.",
      "No cmake/make/ninja/compiler command, compile invocation, include probing, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeMavenPomManifest(raw: string, size: number): string {
  const projectBlock = raw.match(/<project\b[^>]*>([\s\S]*?)<\/project>/i)?.[1] ?? raw;
  const parentBlock = projectBlock.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/i)?.[1] ?? "";
  const coordinates = [
    firstXmlTagValue(projectBlock, "groupId") || firstXmlTagValue(parentBlock, "groupId"),
    firstXmlTagValue(projectBlock, "artifactId"),
    firstXmlTagValue(projectBlock, "version") || firstXmlTagValue(parentBlock, "version"),
  ].filter(Boolean).join(":");
  const packaging = firstXmlTagValue(projectBlock, "packaging") || "jar/default";
  const modules = readXmlLocalTagValues(projectBlock, "module")
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW)
    .map((value) => clampSingleLine(value, 120));
  const dependencies = extractMavenDependencies(projectBlock);
  const plugins = extractMavenPlugins(projectBlock);
  return [
    `Maven POM build manifest preview (${formatBytes(size)}).`,
    `Coordinates: ${coordinates || "none detected in the bounded local preview"}.`,
    `Packaging: ${packaging}.`,
    modules.length > 0 ? `Modules (${modules.length}${modules.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${modules.join(", ")}.` : "Modules: none detected.",
    dependencies.length > 0 ? `Dependencies (${dependencies.length}${dependencies.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.` : "Dependencies: none detected in the bounded preview.",
    plugins.length > 0 ? `Plugins (${plugins.length}${plugins.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${plugins.join(", ")}.` : "Plugins: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; Maven metadata was parsed from bounded workspace-local XML only, and no mvn command, package restore, plugin execution, external schema lookup, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractMavenDependencies(xml: string): string[] {
  return extractXmlBlocks(xml, "dependency")
    .map((block) => {
      const groupId = firstXmlTagValue(block, "groupId");
      const artifactId = firstXmlTagValue(block, "artifactId");
      const version = firstXmlTagValue(block, "version");
      const scope = firstXmlTagValue(block, "scope");
      return clampSingleLine(
        [groupId, artifactId, version].filter(Boolean).join(":") + (scope ? ` (${scope})` : ""),
        160,
      );
    })
    .filter(Boolean)
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function extractMavenPlugins(xml: string): string[] {
  return extractXmlBlocks(xml, "plugin")
    .map((block) => {
      const groupId = firstXmlTagValue(block, "groupId");
      const artifactId = firstXmlTagValue(block, "artifactId");
      const version = firstXmlTagValue(block, "version");
      return clampSingleLine([groupId, artifactId, version].filter(Boolean).join(":"), 160);
    })
    .filter(Boolean)
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function summarizeGradleManifest(raw: string, extension: string, size: number): string {
  const lines = raw.split("\n");
  const plugins = extractGradlePlugins(lines);
  const dependencies = extractGradleDependencies(lines);
  const repositories = extractGradleRepositories(lines);
  const includes = extractGradleIncludes(lines);
  const rootProject = lines
    .map((line) => line.match(/\brootProject\.name\s*=\s*["']([^"']+)["']/)?.[1])
    .find(Boolean);
  return [
    `Gradle build manifest preview (${extension === ".gradle.kts" ? "Kotlin DSL" : "Groovy DSL"}, ${formatBytes(size)}).`,
    rootProject ? `Root project: ${rootProject}.` : "Root project: none detected in the bounded preview.",
    plugins.length > 0 ? `Plugins (${plugins.length}${plugins.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${plugins.join(", ")}.` : "Plugins: none detected in the bounded preview.",
    repositories.length > 0 ? `Repositories: ${repositories.join(", ")}.` : "Repositories: none detected in the bounded preview.",
    dependencies.length > 0 ? `Dependencies (${dependencies.length}${dependencies.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.` : "Dependencies: none detected in the bounded preview.",
    includes.length > 0 ? `Included projects (${includes.length}${includes.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${includes.join(", ")}.` : "Included projects: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; Gradle metadata was parsed from bounded workspace-local text only, and no gradle command, wrapper launch, package restore, plugin execution, build script execution, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractGradlePlugins(lines: string[]): string[] {
  const plugins = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const idMatch = trimmed.match(/\bid\s*\(?\s*["']([^"']+)["']/);
    const applyMatch = trimmed.match(/\bapply\s+plugin:\s*["']([^"']+)["']/);
    if (idMatch?.[1]) plugins.add(clampSingleLine(idMatch[1], 120));
    if (applyMatch?.[1]) plugins.add(clampSingleLine(applyMatch[1], 120));
    if (plugins.size >= MAX_BUILD_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...plugins].slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function extractGradleDependencies(lines: string[]): string[] {
  const dependencies: string[] = [];
  const pattern = /^\s*([A-Za-z][\w-]*(?:Implementation|Api|CompileOnly|RuntimeOnly|TestImplementation|TestRuntimeOnly|AnnotationProcessor|Kapt|Compile|Runtime)?)\s*\(?\s*["']([^"']+)["']/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    dependencies.push(clampSingleLine(`${match[1]} ${maskPotentialSecretValues(match[2])}`, 180));
    if (dependencies.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW) break;
  }
  return dependencies;
}

function extractGradleRepositories(lines: string[]): string[] {
  const repositories = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(mavenCentral|google|gradlePluginPortal)\s*\(/.test(trimmed)) {
      repositories.add(trimmed.replace(/\s*\{.*$/, "").replace(/\s+/g, " "));
    }
    const url = trimmed.match(/\burl\s*=?\s*(?:uri\()?["']([^"']+)["']/)?.[1];
    if (url) repositories.add(maskPotentialSecretValues(url).slice(0, 160));
    if (repositories.size >= MAX_BUILD_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...repositories].slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function extractGradleIncludes(lines: string[]): string[] {
  const includes: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*include\s*\(?\s*(.+?)\s*\)?\s*$/);
    if (!match?.[1]) continue;
    const projects = [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
    for (const project of projects) {
      includes.push(clampSingleLine(project, 120));
      if (includes.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW) return includes;
    }
  }
  return includes;
}

function summarizeSolutionManifest(raw: string, size: number): string {
  const projects = extractSolutionProjects(raw);
  const globalSections = [...raw.matchAll(/GlobalSection\(([^)]+)\)/g)]
    .map((match) => clampSingleLine(match[1], 120))
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
  const formatVersion = raw.match(/Microsoft Visual Studio Solution File,\s*Format Version\s*([^\r\n]+)/i)?.[1]?.trim();
  return [
    `Visual Studio solution manifest preview (${formatBytes(size)}).`,
    `Format version: ${formatVersion || "none detected in the bounded preview"}.`,
    projects.length > 0 ? `Projects (${projects.length}${projects.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${projects.join(" | ")}.` : "Projects: none detected in the bounded preview.",
    globalSections.length > 0 ? `Global sections: ${globalSections.join(", ")}.` : "Global sections: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; solution metadata was parsed from bounded workspace-local text only, and no Visual Studio/MSBuild/dotnet command, package restore, project load, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractSolutionProjects(raw: string): string[] {
  return [...raw.matchAll(/^Project\("[^"]+"\)\s*=\s*"([^"]+)",\s*"([^"]+)"/gm)]
    .map((match) => clampSingleLine(`${match[1]} -> ${match[2]}`, 180))
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function isMsBuildManifestExtension(extension: string): boolean {
  return [".csproj", ".fsproj", ".vbproj", ".props", ".targets"].includes(extension);
}

function summarizeMsBuildManifest(raw: string, extension: string, size: number): string {
  const root = raw.match(/<([A-Za-z_][\w:.-]*)\b([^>]*)>/)?.[1] || "Project";
  const sdk = raw.match(/<Project\b[^>]*\bSdk\s*=\s*["']([^"']+)["']/i)?.[1];
  const targetFrameworks = [
    ...readXmlLocalTagValues(raw, "TargetFramework"),
    ...readXmlLocalTagValues(raw, "TargetFrameworks"),
  ]
    .flatMap((value) => value.split(";"))
    .map((value) => clampSingleLine(value, 80))
    .filter(Boolean)
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
  const packageRefs = extractMsBuildIncludeItems(raw, "PackageReference");
  const projectRefs = extractMsBuildIncludeItems(raw, "ProjectReference");
  const imports = extractMsBuildIncludeItems(raw, "Import", "Project");
  const outputType = firstXmlTagValue(raw, "OutputType");
  return [
    `MSBuild ${extension.toUpperCase().replace(".", "")} build manifest preview (${formatBytes(size)}).`,
    `Root: ${root}; SDK: ${sdk || "none detected"}.`,
    targetFrameworks.length > 0 ? `Target frameworks: ${targetFrameworks.join(", ")}.` : "Target frameworks: none detected in the bounded preview.",
    outputType ? `Output type: ${outputType}.` : "Output type: none detected in the bounded preview.",
    packageRefs.length > 0 ? `Package references (${packageRefs.length}${packageRefs.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${packageRefs.join(", ")}.` : "Package references: none detected in the bounded preview.",
    projectRefs.length > 0 ? `Project references (${projectRefs.length}${projectRefs.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${projectRefs.join(", ")}.` : "Project references: none detected in the bounded preview.",
    imports.length > 0 ? `Imports (${imports.length}${imports.length >= MAX_BUILD_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${imports.join(", ")}.` : "Imports: none detected in the bounded preview.",
    "Ready for explicit attachment after visible review; MSBuild metadata was parsed from bounded workspace-local XML only, and no MSBuild/dotnet command, NuGet restore, target execution, external schema lookup, network call, credential lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractMsBuildIncludeItems(
  xml: string,
  tagName: string,
  attributeName = "Include",
): string[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  return [...xml.matchAll(pattern)]
    .map((match) => {
      const attrs = match[1] || "";
      const include = attrs.match(new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
      const version = attrs.match(/\bVersion\s*=\s*["']([^"']+)["']/i)?.[1];
      return include ? clampSingleLine(`${include}${version ? ` ${version}` : ""}`, 180) : "";
    })
    .filter(Boolean)
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function extractXmlBlocks(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...xml.matchAll(pattern)]
    .map((match) => match[1] || "")
    .slice(0, MAX_BUILD_MANIFEST_ITEM_PREVIEW);
}

function parseContainerBuildInstructions(raw: string): { name: string; value: string }[] {
  const joinedLines: string[] = [];
  let current = "";
  for (const line of raw.split("\n")) {
    const trimmedRight = line.replace(/\s+$/g, "");
    if (!trimmedRight.trim() || trimmedRight.trim().startsWith("#")) continue;
    if (trimmedRight.endsWith("\\")) {
      current += `${trimmedRight.slice(0, -1)} `;
      continue;
    }
    joinedLines.push(`${current}${trimmedRight}`.trim());
    current = "";
  }
  if (current.trim()) joinedLines.push(current.trim());
  return joinedLines
    .map((line) => {
      const match = line.match(/^([A-Za-z]+)\s+(.*)$/);
      if (!match?.[1]) return null;
      return {
        name: match[1].toUpperCase(),
        value: (match[2] || "").trim(),
      };
    })
    .filter((item): item is { name: string; value: string } => Boolean(item));
}

function summarizeContainerBuildBoundaries(
  instructions: { name: string; value: string }[],
): string {
  const riskInstructions = instructions
    .filter((item) => ["RUN", "ADD", "COPY", "ARG", "ENV", "USER", "EXPOSE", "VOLUME"].includes(item.name))
    .map((item) => item.name);
  if (riskInstructions.length === 0) {
    return "Build boundaries: no RUN/ADD/COPY/ARG/ENV/USER/EXPOSE/VOLUME instructions detected in the bounded preview.";
  }
  return `Build boundaries: ${summarizeCounts(riskInstructions)}. These are static hints only and were not executed.`;
}

function isDependencyLockfile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    extension === ".lock" ||
    extension === ".sum" ||
    name === "package-lock.json" ||
    name === "npm-shrinkwrap.json" ||
    name === "pnpm-lock.yaml" ||
    name === "pnpm-lock.yml"
  );
}

function isSbomProvenanceArtifact(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    [
      ".attestation",
      ".attestation.json",
      ".cdx.json",
      ".intoto.jsonl",
      ".spdx",
      ".spdx.json",
      ".syft.json",
    ].includes(extension) ||
    name === "bom.json" ||
    name === "sbom.json" ||
    name === "cyclonedx.json" ||
    name === "syft.json" ||
    name === "provenance.json" ||
    name === "attestation.json" ||
    name.endsWith(".sbom.json") ||
    name.endsWith(".syft.json") ||
    name.endsWith(".provenance.json")
  );
}

function isSarifResultFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return extension === ".sarif" || extension === ".sarif.json" || name === "sarif.json" || name.endsWith(".sarif.json");
}

function summarizeSarifResultFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_SARIF_PREVIEW_BYTES, MAX_TEXT_BYTES * 48)).toString("utf8");
    const parsed = JSON.parse(raw);
    const preview = readSarifPreview(parsed);
    if (!preview) {
      return [
        `SARIF static analysis result file ready for explicit attachment (${formatBytes(size)}).`,
        "The bounded JSON preview did not contain a SARIF runs array.",
        "No scanner/test runner/code execution, dependency install, SARIF upload, vulnerability lookup, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return [
      `SARIF static analysis result preview (${formatBytes(size)}).`,
      `Format: SARIF ${preview.version || "unknown"}; runs sampled: ${preview.runCount}; results reported: ${preview.resultCount}.`,
      preview.tools.length > 0 ? `Tools: ${preview.tools.join(", ")}.` : "Tools: none detected in the bounded local preview.",
      preview.levels.length > 0 ? `Levels: ${summarizeCounts(preview.levels)}.` : "Levels: none detected in sampled results.",
      preview.rules.length > 0 ? `Rules (${preview.rules.length}${preview.rules.length >= MAX_SARIF_RESULT_PREVIEW ? "+" : ""}): ${preview.rules.join(", ")}.` : "Rules: none detected in the bounded local preview.",
      preview.results.length > 0 ? `Result samples (${preview.results.length}${preview.results.length >= MAX_SARIF_RESULT_PREVIEW ? "+" : ""}): ${preview.results.join(" | ")}.` : "Result samples: none detected in sampled runs.",
      preview.locations.length > 0 ? `Location samples (${preview.locations.length}${preview.locations.length >= MAX_SARIF_LOCATION_PREVIEW ? "+" : ""}): ${preview.locations.join(" | ")}.` : "Location samples: none detected in sampled runs.",
      extension === ".json" ? "Filename-based SARIF detection was used for this JSON file." : "SARIF extension provenance was preserved for this import.",
      "SARIF preview read bounded local JSON only; no scanner/test runner/code execution, dependency install, SARIF upload, vulnerability lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `SARIF static analysis result file ready for explicit attachment (${formatBytes(size)}).`,
      "SARIF preview could not parse bounded local JSON.",
      "No scanner/test runner/code execution, dependency install, SARIF upload, vulnerability lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readSarifPreview(value: unknown): {
  version: string;
  runCount: number;
  resultCount: number;
  tools: string[];
  rules: string[];
  levels: string[];
  results: string[];
  locations: string[];
} | null {
  if (!isPlainRecord(value) || !Array.isArray(value.runs)) return null;
  const runs = value.runs.filter(isPlainRecord).slice(0, MAX_SARIF_RUN_PREVIEW);
  const tools = new Set<string>();
  const rules = new Set<string>();
  const levels: string[] = [];
  const results: string[] = [];
  const locations = new Set<string>();
  let resultCount = 0;

  for (const run of runs) {
    const driver = isPlainRecord(run.tool) && isPlainRecord(run.tool.driver) ? run.tool.driver : null;
    const toolName = driver ? readSarifString(driver, "name") || readSarifString(driver, "fullName") : "";
    if (toolName) tools.add(clampSingleLine(toolName, 80));
    if (driver && Array.isArray(driver.rules)) {
      for (const rule of driver.rules.filter(isPlainRecord)) {
        const ruleId = readSarifString(rule, "id") || readSarifString(rule, "name");
        if (ruleId) rules.add(clampSingleLine(ruleId, 100));
        if (rules.size >= MAX_SARIF_RESULT_PREVIEW) break;
      }
    }

    const runResults = Array.isArray(run.results) ? run.results.filter(isPlainRecord) : [];
    resultCount += runResults.length;
    for (const result of runResults) {
      const ruleId = readSarifString(result, "ruleId");
      const level = readSarifString(result, "level");
      if (level) levels.push(level);
      const message = isPlainRecord(result.message)
        ? readSarifString(result.message, "text") || readSarifString(result.message, "markdown")
        : "";
      if (ruleId) rules.add(clampSingleLine(ruleId, 100));
      if (results.length < MAX_SARIF_RESULT_PREVIEW) {
        results.push(clampSingleLine([level, ruleId, message].filter(Boolean).join(" "), 180));
      }
      collectSarifLocations(result, locations);
      if (results.length >= MAX_SARIF_RESULT_PREVIEW && locations.size >= MAX_SARIF_LOCATION_PREVIEW) break;
    }
  }

  return {
    version: readSarifString(value, "version"),
    runCount: runs.length,
    resultCount,
    tools: [...tools].slice(0, MAX_SARIF_RUN_PREVIEW),
    rules: [...rules].slice(0, MAX_SARIF_RESULT_PREVIEW),
    levels: levels.slice(0, MAX_SARIF_RESULT_PREVIEW),
    results: results.filter(Boolean).slice(0, MAX_SARIF_RESULT_PREVIEW),
    locations: [...locations].slice(0, MAX_SARIF_LOCATION_PREVIEW),
  };
}

function collectSarifLocations(result: Record<string, unknown>, locations: Set<string>): void {
  if (!Array.isArray(result.locations)) return;
  for (const location of result.locations.filter(isPlainRecord)) {
    const physical = isPlainRecord(location.physicalLocation) ? location.physicalLocation : null;
    const artifact = physical && isPlainRecord(physical.artifactLocation) ? physical.artifactLocation : null;
    const region = physical && isPlainRecord(physical.region) ? physical.region : null;
    const uri = artifact ? readSarifString(artifact, "uri") : "";
    const startLine = region && typeof region.startLine === "number" ? `:${region.startLine}` : "";
    if (uri) locations.add(clampSingleLine(`${uri}${startLine}`, 160));
    if (locations.size >= MAX_SARIF_LOCATION_PREVIEW) break;
  }
}

function readSarifString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? maskPotentialSecretValues(value).trim() : "";
}

interface SecurityScanReportPreview {
  format: string;
  vulnerabilityCount: number;
  packages: string[];
  severities: string[];
  ids: string[];
  samples: string[];
  truncated: boolean;
}

function isSecurityScanReportFile(filePath: string, extension: string): boolean {
  const name = basename(filePath).toLowerCase();
  return (
    extension === ".security-audit.json" ||
    name === "snyk.json" ||
    name === "npm-audit.json" ||
    name === "audit-ci.json" ||
    name === "security-audit.json" ||
    name === "vulnerability-report.json" ||
    name.endsWith(".snyk.json") ||
    name.endsWith(".npm-audit.json") ||
    name.endsWith(".audit-ci.json") ||
    name.endsWith(".security-audit.json") ||
    name.endsWith(".vulnerability-report.json")
  );
}

function summarizeSecurityScanReportFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_SECURITY_SCAN_REPORT_PREVIEW_BYTES, MAX_TEXT_BYTES * 48),
    ).toString("utf8");
    const preview = readSecurityScanReportPreview(JSON.parse(raw));
    if (!preview) {
      return [
        `Security scan report file ready for explicit attachment (${formatBytes(size)}).`,
        "The bounded JSON preview did not contain recognized Snyk, npm audit, or audit-ci vulnerability records.",
        "No npm audit/Snyk/audit-ci command, package install, registry lookup, vulnerability database query, credential lookup, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return [
      `Security scan report preview (${preview.format}, ${formatBytes(size)}).`,
      `Vulnerabilities reported in bounded preview: ${preview.vulnerabilityCount}.`,
      preview.severities.length > 0
        ? `Severities: ${summarizeCounts(preview.severities)}.`
        : "Severities: none detected in the bounded local preview.",
      preview.packages.length > 0
        ? `Packages (${preview.packages.length}${preview.packages.length >= MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW ? "+" : ""}): ${preview.packages.join(", ")}.`
        : "Packages: none detected in the bounded local preview.",
      preview.ids.length > 0
        ? `Advisory/CVE/CWE ids (${preview.ids.length}${preview.ids.length >= MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW ? "+" : ""}): ${preview.ids.join(", ")}.`
        : "Advisory/CVE/CWE ids: none detected in the bounded local preview.",
      preview.samples.length > 0
        ? `Vulnerability samples (${preview.samples.length}${preview.samples.length >= MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW ? "+" : ""}): ${preview.samples.join(" | ")}.`
        : "Vulnerability samples: none detected in sampled records.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_SECURITY_SCAN_REPORT_PREVIEW_BYTES)} or item limits.` : "",
      extension === ".security-audit.json"
        ? "Filename-based security scan report detection was used for this JSON file."
        : "Security scan report MIME provenance was preserved for this import.",
      "Security scan report preview read bounded local JSON only; no npm audit/Snyk/audit-ci command, package install, registry lookup, vulnerability database query, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Security scan report file ready for explicit attachment (${formatBytes(size)}).`,
      "Security scan report preview could not parse bounded local JSON.",
      "No npm audit/Snyk/audit-ci command, package install, registry lookup, vulnerability database query, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readSecurityScanReportPreview(value: unknown): SecurityScanReportPreview | null {
  if (!isPlainRecord(value)) return null;
  if (Array.isArray(value.vulnerabilities)) {
    return readSnykSecurityScanPreview(value);
  }
  if (isPlainRecord(value.vulnerabilities)) {
    return readNpmAuditSecurityScanPreview(value);
  }
  if (isPlainRecord(value.advisories)) {
    return readLegacyAdvisorySecurityScanPreview(value);
  }
  return null;
}

function readSnykSecurityScanPreview(record: Record<string, unknown>): SecurityScanReportPreview {
  const vulnerabilities = record.vulnerabilities;
  const items = Array.isArray(vulnerabilities) ? vulnerabilities.filter(isPlainRecord) : [];
  const packages = new Set<string>();
  const ids = new Set<string>();
  const severities: string[] = [];
  const samples: string[] = [];
  for (const item of items.slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW)) {
    const pkg = sanitizeSecurityScanValue(
      readJsonString(item, "packageName") || readJsonString(item, "name") || readJsonString(item, "moduleName"),
    );
    const severity = sanitizeSecurityScanValue(readJsonString(item, "severity"));
    const title = sanitizeSecurityScanValue(readJsonString(item, "title") || readJsonString(item, "description"));
    collectSecurityScanIds(item, ids);
    addLimited(packages, pkg, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW);
    if (severity) severities.push(severity);
    if (samples.length < MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW) {
      samples.push(clampSingleLine([severity ? `[${severity}]` : "", pkg, title].filter(Boolean).join(" "), 220));
    }
  }
  return {
    format: "Snyk JSON",
    vulnerabilityCount: readJsonNumber(record, "uniqueCount") ?? items.length,
    packages: [...packages],
    severities,
    ids: [...ids].slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW),
    samples: samples.filter(Boolean),
    truncated: items.length > MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW,
  };
}

function readNpmAuditSecurityScanPreview(record: Record<string, unknown>): SecurityScanReportPreview {
  const vulnerabilities = isPlainRecord(record.vulnerabilities) ? record.vulnerabilities : {};
  const entries = Object.entries(vulnerabilities).filter(([, item]) => isPlainRecord(item));
  const packages = new Set<string>();
  const ids = new Set<string>();
  const severities: string[] = [];
  const samples: string[] = [];
  for (const [name, rawItem] of entries.slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW)) {
    const item = rawItem as Record<string, unknown>;
    const pkg = sanitizeSecurityScanValue(readJsonString(item, "name") || name);
    const severity = sanitizeSecurityScanValue(readJsonString(item, "severity"));
    const via = Array.isArray(item.via) ? item.via : [];
    const title = sanitizeSecurityScanValue(readFirstSecurityScanTitle(via) || readJsonString(item, "title"));
    collectSecurityScanIds(item, ids);
    for (const viaItem of via) collectSecurityScanIds(viaItem, ids);
    addLimited(packages, pkg, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW);
    if (severity) severities.push(severity);
    if (samples.length < MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW) {
      samples.push(clampSingleLine([severity ? `[${severity}]` : "", pkg, title].filter(Boolean).join(" "), 220));
    }
  }
  return {
    format: "npm audit JSON",
    vulnerabilityCount: readNpmAuditVulnerabilityCount(record) ?? entries.length,
    packages: [...packages],
    severities,
    ids: [...ids].slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW),
    samples: samples.filter(Boolean),
    truncated: entries.length > MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW,
  };
}

function readLegacyAdvisorySecurityScanPreview(record: Record<string, unknown>): SecurityScanReportPreview {
  const advisories = isPlainRecord(record.advisories) ? record.advisories : {};
  const entries = Object.entries(advisories).filter(([, item]) => isPlainRecord(item));
  const packages = new Set<string>();
  const ids = new Set<string>();
  const severities: string[] = [];
  const samples: string[] = [];
  for (const [id, rawItem] of entries.slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW)) {
    const item = rawItem as Record<string, unknown>;
    const pkg = sanitizeSecurityScanValue(readJsonString(item, "module_name") || readJsonString(item, "moduleName"));
    const severity = sanitizeSecurityScanValue(readJsonString(item, "severity"));
    const title = sanitizeSecurityScanValue(readJsonString(item, "title") || readJsonString(item, "overview"));
    addLimited(ids, sanitizeSecurityScanValue(readJsonString(item, "cves") || id), MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW);
    collectSecurityScanIds(item, ids);
    addLimited(packages, pkg, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW);
    if (severity) severities.push(severity);
    if (samples.length < MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW) {
      samples.push(clampSingleLine([severity ? `[${severity}]` : "", pkg, title].filter(Boolean).join(" "), 220));
    }
  }
  return {
    format: "npm audit advisory JSON",
    vulnerabilityCount: entries.length,
    packages: [...packages],
    severities,
    ids: [...ids].slice(0, MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW),
    samples: samples.filter(Boolean),
    truncated: entries.length > MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW,
  };
}

function readFirstSecurityScanTitle(values: unknown[]): string {
  for (const value of values) {
    if (!isPlainRecord(value)) continue;
    const title = readJsonString(value, "title") || readJsonString(value, "name") || readJsonString(value, "source");
    if (title) return title;
  }
  return "";
}

function readNpmAuditVulnerabilityCount(record: Record<string, unknown>): number | null {
  const metadata = isPlainRecord(record.metadata) ? record.metadata : null;
  const counts = metadata && isPlainRecord(metadata.vulnerabilities) ? metadata.vulnerabilities : null;
  if (!counts) return null;
  return ["info", "low", "moderate", "high", "critical"].reduce((total, key) => {
    const value = counts[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function collectSecurityScanIds(value: unknown, ids: Set<string>): void {
  if (ids.size >= MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW) return;
  if (typeof value === "string") {
    for (const match of value.matchAll(/\b(?:CVE-\d{4}-\d{4,}|CWE-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/gi)) {
      addLimited(ids, sanitizeSecurityScanValue(match[0] || ""), MAX_SECURITY_SCAN_VULNERABILITY_PREVIEW);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecurityScanIds(item, ids);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const key of ["id", "source", "url", "cve", "cwe", "cves", "cwes"]) {
    const item = value[key];
    if (typeof item === "string" || Array.isArray(item)) collectSecurityScanIds(item, ids);
  }
  const identifiers = isPlainRecord(value.identifiers) ? value.identifiers : null;
  if (identifiers) {
    for (const item of Object.values(identifiers)) collectSecurityScanIds(item, ids);
  }
}

function sanitizeSecurityScanValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecurityScanValue(item)).filter(Boolean).join(", ");
  }
  if (value === null || value === undefined) return "";
  return clampSingleLine(maskPotentialSecretValues(redactUrlQuerySecrets(String(value))), 180);
}

interface StaticAnalysisXmlPreview {
  format: string;
  files: string[];
  rules: string[];
  severities: string[];
  issues: string[];
  issueCount: number;
  truncated: boolean;
}

function isStaticAnalysisXmlReportFile(filePath: string, extension: string): boolean {
  return (
    [".checkstyle.xml", ".pmd.xml", ".spotbugs.xml"].includes(extension) ||
    (extension === ".xml" && looksLikeStaticAnalysisXmlReport(filePath))
  );
}

function looksLikeStaticAnalysisXmlReport(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return /<checkstyle\b/i.test(raw) || /<pmd\b/i.test(raw) || /<BugCollection\b/i.test(raw);
  } catch {
    return false;
  }
}

function summarizeStaticAnalysisXmlReportFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES)).toString("utf8");
    const preview = parseStaticAnalysisXmlReport(raw, extension);
    return [
      `Static analysis XML report preview (${preview.format}, ${formatBytes(size)}).`,
      `Issues reported in bounded preview: ${preview.issueCount}.`,
      preview.files.length > 0
        ? `Files (${preview.files.length}${preview.files.length >= MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW ? "+" : ""}): ${preview.files.join(" | ")}.`
        : "Files: none detected in the bounded local preview.",
      preview.rules.length > 0
        ? `Rules (${preview.rules.length}${preview.rules.length >= MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW ? "+" : ""}): ${preview.rules.join(", ")}.`
        : "Rules: none detected in the bounded local preview.",
      preview.severities.length > 0
        ? `Severities/priorities: ${summarizeCounts(preview.severities)}.`
        : "Severities/priorities: none detected in the bounded local preview.",
      preview.issues.length > 0
        ? `Issue samples (${preview.issues.length}${preview.issues.length >= MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW ? "+" : ""}): ${preview.issues.join(" | ")}.`
        : "Issue samples: none detected in the bounded local preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES)} or item limits.` : "",
      "Static analysis XML preview read bounded local XML only; no Checkstyle/PMD/SpotBugs scanner, build command, test runner, CI provider API call, SARIF conversion/upload, baseline diff, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Static analysis XML report ready for explicit attachment (${formatBytes(size)}).`,
      "No Checkstyle/PMD/SpotBugs scanner, build command, test runner, CI provider API call, SARIF conversion/upload, baseline diff, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseStaticAnalysisXmlReport(raw: string, extension: string): StaticAnalysisXmlPreview {
  if (extension === ".pmd.xml" || /<pmd\b/i.test(raw)) return parsePmdXmlReport(raw);
  if (extension === ".spotbugs.xml" || /<BugCollection\b/i.test(raw)) return parseSpotbugsXmlReport(raw);
  return parseCheckstyleXmlReport(raw);
}

function parseCheckstyleXmlReport(raw: string): StaticAnalysisXmlPreview {
  const files = new Set<string>();
  const rules = new Set<string>();
  const severities: string[] = [];
  const issues: string[] = [];
  let issueCount = 0;
  const fileBlocks = [...raw.matchAll(/<file\b([^>]*)>([\s\S]*?)<\/file>/gi)];
  for (const fileMatch of fileBlocks) {
    const fileAttrs = readXmlAttributes(fileMatch[1] ?? "");
    const fileName = sanitizeStaticAnalysisValue(fileAttrs.get("name") || "");
    addLimited(files, fileName, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
    for (const errorMatch of (fileMatch[2] ?? "").matchAll(/<error\b([^>]*)\/?>/gi)) {
      issueCount += 1;
      const attrs = readXmlAttributes(errorMatch[1] ?? "");
      const severity = sanitizeStaticAnalysisValue(attrs.get("severity") || "");
      const source = sanitizeStaticAnalysisValue(attrs.get("source") || attrs.get("module") || "");
      const rule = source.split(".").filter(Boolean).pop() || source;
      const line = sanitizeStaticAnalysisValue(attrs.get("line") || "");
      const message = sanitizeStaticAnalysisValue(attrs.get("message") || "");
      if (severity) severities.push(severity);
      addLimited(rules, rule, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
      if (issues.length < MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW) {
        issues.push(clampSingleLine([fileName ? `${fileName}${line ? `:${line}` : ""}` : "", severity ? `[${severity}]` : "", rule, message].filter(Boolean).join(" "), 240));
      }
    }
  }
  return {
    format: "Checkstyle XML",
    files: [...files],
    rules: [...rules],
    severities,
    issues,
    issueCount,
    truncated: raw.length >= MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES || issueCount > issues.length,
  };
}

function parsePmdXmlReport(raw: string): StaticAnalysisXmlPreview {
  const files = new Set<string>();
  const rules = new Set<string>();
  const severities: string[] = [];
  const issues: string[] = [];
  let issueCount = 0;
  const fileBlocks = [...raw.matchAll(/<file\b([^>]*)>([\s\S]*?)<\/file>/gi)];
  for (const fileMatch of fileBlocks) {
    const fileAttrs = readXmlAttributes(fileMatch[1] ?? "");
    const fileName = sanitizeStaticAnalysisValue(fileAttrs.get("name") || "");
    addLimited(files, fileName, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
    for (const violationMatch of (fileMatch[2] ?? "").matchAll(/<violation\b([^>]*)>([\s\S]*?)<\/violation>/gi)) {
      issueCount += 1;
      const attrs = readXmlAttributes(violationMatch[1] ?? "");
      const rule = sanitizeStaticAnalysisValue(attrs.get("rule") || attrs.get("ruleset") || "");
      const priority = sanitizeStaticAnalysisValue(attrs.get("priority") || "");
      const line = sanitizeStaticAnalysisValue(attrs.get("beginline") || attrs.get("line") || "");
      const message = sanitizeStaticAnalysisValue(extractXmlText(violationMatch[2] ?? ""));
      if (priority) severities.push(`priority ${priority}`);
      addLimited(rules, rule, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
      if (issues.length < MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW) {
        issues.push(clampSingleLine([fileName ? `${fileName}${line ? `:${line}` : ""}` : "", priority ? `[priority ${priority}]` : "", rule, message].filter(Boolean).join(" "), 240));
      }
    }
  }
  return {
    format: "PMD XML",
    files: [...files],
    rules: [...rules],
    severities,
    issues,
    issueCount,
    truncated: raw.length >= MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES || issueCount > issues.length,
  };
}

function parseSpotbugsXmlReport(raw: string): StaticAnalysisXmlPreview {
  const files = new Set<string>();
  const rules = new Set<string>();
  const severities: string[] = [];
  const issues: string[] = [];
  const bugMatches = [...raw.matchAll(/<BugInstance\b([^>]*?)(?:\/>|>([\s\S]*?)<\/BugInstance>)/gi)];
  for (const bugMatch of bugMatches) {
    const attrs = readXmlAttributes(bugMatch[1] ?? "");
    const body = bugMatch[2] ?? "";
    const type = sanitizeStaticAnalysisValue(attrs.get("type") || attrs.get("abbrev") || "");
    const category = sanitizeStaticAnalysisValue(attrs.get("category") || "");
    const priority = sanitizeStaticAnalysisValue(attrs.get("priority") || attrs.get("rank") || "");
    const sourceLineAttrs = readXmlAttributes(body.match(/<SourceLine\b([^>]*)\/?>/i)?.[1] ?? "");
    const fileName = sanitizeStaticAnalysisValue(sourceLineAttrs.get("sourcepath") || sourceLineAttrs.get("classname") || "");
    const line = sanitizeStaticAnalysisValue(sourceLineAttrs.get("start") || sourceLineAttrs.get("startLine") || "");
    const message = sanitizeStaticAnalysisValue(extractXmlText(body.match(/<(LongMessage|ShortMessage)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? ""));
    addLimited(files, fileName, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
    addLimited(rules, type || category, MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW);
    if (priority) severities.push(`priority ${priority}`);
    if (issues.length < MAX_STATIC_ANALYSIS_XML_ITEM_PREVIEW) {
      issues.push(clampSingleLine([fileName ? `${fileName}${line ? `:${line}` : ""}` : "", priority ? `[priority ${priority}]` : "", type || category, message].filter(Boolean).join(" "), 240));
    }
  }
  return {
    format: "SpotBugs XML",
    files: [...files],
    rules: [...rules],
    severities,
    issues,
    issueCount: bugMatches.length,
    truncated: raw.length >= MAX_STATIC_ANALYSIS_XML_PREVIEW_BYTES || bugMatches.length > issues.length,
  };
}

function addLimited(target: Set<string>, value: string, limit: number): void {
  if (!value || target.size >= limit) return;
  target.add(value);
}

function sanitizeStaticAnalysisValue(value: string): string {
  return clampSingleLine(maskPotentialSecretValues(decodeXmlEntities(value).replace(/\s+/g, " ").trim()), 180);
}

function summarizeSbomProvenanceArtifact(
  filePath: string,
  extension: string,
  size: number,
): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_SBOM_PROVENANCE_PREVIEW_BYTES, MAX_TEXT_BYTES * 48),
    ).toString("utf8");
    const name = basename(filePath).toLowerCase();
    const masked = maskPotentialSecretValues(raw);
    const normalized = normalizeTextPreview(masked);
    const format = detectSbomProvenanceFormat(name, extension, raw);
    const subjects = extractSbomProvenanceSubjects(raw, format).slice(0, MAX_SBOM_PROVENANCE_ITEMS);
    const packages = extractSbomPackageSamples(raw, format).slice(0, MAX_SBOM_PROVENANCE_ITEMS);
    const relationships = summarizeSbomRelationshipHints(raw, format);
    const preview = normalized.split("\n").slice(0, 8).join("\n");
    return [
      `SBOM/provenance artifact preview (${formatBytes(size)}).`,
      `Format hint: ${format}.`,
      subjects.length > 0 ? `Subjects/components: ${subjects.join(", ")}.` : "Subjects/components: none detected in the bounded local preview.",
      packages.length > 0 ? `Package samples: ${packages.join(", ")}.` : "Package samples: none detected in the bounded local preview.",
      relationships,
      preview ? `Preview:\n${preview}` : "Preview: empty or unreadable text window.",
      "SBOM/provenance preview read bounded local text only; no vulnerability lookup, license compliance decision, signature verification, digest recomputation, package-manager execution, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `SBOM/provenance artifact ready for explicit attachment (${formatBytes(size)}).`,
      "No vulnerability lookup, license compliance decision, signature verification, digest recomputation, package-manager execution, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function detectSbomProvenanceFormat(name: string, extension: string, raw: string): string {
  const lower = raw.slice(0, MAX_TEXT_BYTES).toLowerCase();
  if (extension === ".spdx" || lower.includes("spdxversion:")) return "SPDX tag-value";
  try {
    const parsed = JSON.parse(raw);
    if (isPlainRecord(parsed)) {
      if (typeof parsed.bomFormat === "string" && parsed.bomFormat.toLowerCase() === "cyclonedx") {
        return `CycloneDX ${typeof parsed.specVersion === "string" ? parsed.specVersion : "JSON"}`;
      }
      if (typeof parsed.spdxVersion === "string") return `SPDX JSON ${parsed.spdxVersion}`;
      if (Array.isArray(parsed.artifacts) && isPlainRecord(parsed.source)) return "Syft JSON SBOM";
      if (isPlainRecord(parsed.predicate) && typeof parsed.predicateType === "string") {
        return `in-toto/SLSA provenance ${parsed.predicateType}`;
      }
      if (typeof parsed._type === "string" && parsed._type.includes("in-toto")) return "in-toto attestation";
    }
  } catch {
    // Fall through to filename and text heuristics.
  }
  if (extension === ".intoto.jsonl" || name.includes("intoto")) return "in-toto JSONL attestation";
  if (name.includes("cyclonedx") || extension === ".cdx.json") return "CycloneDX JSON";
  if (name.includes("spdx") || extension === ".spdx.json") return "SPDX JSON";
  if (name.includes("syft") || extension === ".syft.json") return "Syft JSON SBOM";
  if (name.includes("provenance") || name.includes("attestation")) return "provenance attestation";
  return "SBOM/provenance artifact";
}

function extractSbomProvenanceSubjects(raw: string, format: string): string[] {
  const subjects = new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (isPlainRecord(parsed)) {
      collectNameVersionRecord(parsed.metadata, subjects);
      collectNameVersionArray(parsed.components, subjects);
      collectNameVersionArray(parsed.packages, subjects);
      collectNameVersionArray(parsed.artifacts, subjects);
      collectSubjectArray(parsed.subject, subjects);
      if (isPlainRecord(parsed.predicate)) {
        collectNameVersionArray(parsed.predicate.materials, subjects);
        collectNameVersionArray(parsed.predicate.resolvedDependencies, subjects);
      }
    }
  } catch {
    collectTextSbomSubjects(raw, subjects);
  }
  if (subjects.size === 0 && format.includes("SPDX")) collectTextSbomSubjects(raw, subjects);
  return [...subjects].slice(0, MAX_SBOM_PROVENANCE_ITEMS);
}

function extractSbomPackageSamples(raw: string, format: string): string[] {
  const packages = new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    if (isPlainRecord(parsed)) {
      collectNameVersionArray(parsed.components, packages);
      collectNameVersionArray(parsed.packages, packages);
      collectNameVersionArray(parsed.artifacts, packages);
      if (isPlainRecord(parsed.predicate)) {
        collectNameVersionArray(parsed.predicate.materials, packages);
        collectNameVersionArray(parsed.predicate.resolvedDependencies, packages);
      }
    }
  } catch {
    collectTextSbomSubjects(raw, packages);
  }
  if (packages.size === 0 && format.includes("SPDX")) collectTextSbomSubjects(raw, packages);
  return [...packages].slice(0, MAX_SBOM_PROVENANCE_ITEMS);
}

function summarizeSbomRelationshipHints(raw: string, format: string): string {
  const lower = raw.slice(0, MAX_SBOM_PROVENANCE_PREVIEW_BYTES).toLowerCase();
  const hints = [
    lower.includes("depends_on") || lower.includes("dependency") ? "dependency relationships" : "",
    lower.includes("license") ? "license declarations" : "",
    lower.includes("sha256") || lower.includes("digest") ? "digest references" : "",
    lower.includes("builder") || lower.includes("buildtype") ? "build provenance" : "",
    lower.includes("materials") ? "source materials" : "",
    lower.includes("vulnerabilities") ? "embedded vulnerability records" : "",
  ].filter(Boolean);
  const packageCount = estimateSbomPackageCount(raw, format);
  return [
    `Artifact entries: ${packageCount}.`,
    hints.length > 0 ? `Local hints: ${[...new Set(hints)].join(", ")}.` : "Local hints: none detected in the bounded local preview.",
  ].join("\n");
}

function estimateSbomPackageCount(raw: string, format: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (isPlainRecord(parsed)) {
      if (Array.isArray(parsed.components)) return `${parsed.components.length} CycloneDX component entr${parsed.components.length === 1 ? "y" : "ies"}`;
      if (Array.isArray(parsed.packages)) return `${parsed.packages.length} SPDX package entr${parsed.packages.length === 1 ? "y" : "ies"}`;
      if (Array.isArray(parsed.artifacts)) return `${parsed.artifacts.length} Syft artifact entr${parsed.artifacts.length === 1 ? "y" : "ies"}`;
      if (Array.isArray(parsed.subject)) return `${parsed.subject.length} attestation subject entr${parsed.subject.length === 1 ? "y" : "ies"}`;
      if (isPlainRecord(parsed.predicate) && Array.isArray(parsed.predicate.materials)) {
        return `${parsed.predicate.materials.length} provenance material entr${parsed.predicate.materials.length === 1 ? "y" : "ies"}`;
      }
    }
  } catch {
    const packageMatches = raw.match(/^PackageName:\s*/gm);
    if (packageMatches?.length) return `${packageMatches.length} SPDX package entr${packageMatches.length === 1 ? "y" : "ies"} in bounded preview`;
  }
  return format.includes("provenance") || format.includes("attestation") ? "provenance subject count not declared in bounded preview" : "none detected in bounded preview";
}

function collectNameVersionArray(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    collectNameVersionRecord(entry, target);
    if (target.size >= MAX_SBOM_PROVENANCE_ITEMS) break;
  }
}

function collectSubjectArray(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (isPlainRecord(entry)) {
      const name = typeof entry.name === "string" ? entry.name : "";
      const digest = isPlainRecord(entry.digest) && typeof entry.digest.sha256 === "string" ? ` sha256:${entry.digest.sha256.slice(0, 12)}...` : "";
      if (name) target.add(clampSingleLine(`${name}${digest}`, 140));
    }
    if (target.size >= MAX_SBOM_PROVENANCE_ITEMS) break;
  }
}

function collectNameVersionRecord(value: unknown, target: Set<string>): void {
  if (!isPlainRecord(value)) return;
  const component = isPlainRecord(value.component) ? value.component : value;
  const name =
    typeof component.name === "string"
      ? component.name
      : typeof component.purl === "string"
        ? component.purl
        : typeof component.uri === "string"
          ? component.uri
          : "";
  const version = typeof component.version === "string" ? `@${component.version}` : "";
  if (name) target.add(clampSingleLine(`${name}${version}`, 140));
}

function collectTextSbomSubjects(raw: string, target: Set<string>): void {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:PackageName|Name|SPDXID|ExternalRef):\s*(.+)$/i);
    if (match?.[1]) target.add(clampSingleLine(match[1], 140));
    if (target.size >= MAX_SBOM_PROVENANCE_ITEMS) break;
  }
}

function isSecurityArtifactExtension(extension: string): boolean {
  return [
    ".asc",
    ".cer",
    ".checksum",
    ".crt",
    ".der",
    ".key",
    ".pem",
    ".sha1",
    ".sha256",
    ".sha512",
    ".sig",
  ].includes(extension);
}

function isBinaryArtifactExtension(extension: string): boolean {
  return [".dll", ".exe", ".wasm"].includes(extension);
}

function isJavaBuildArtifactExtension(extension: string): boolean {
  return [".jar", ".war", ".ear", ".class"].includes(extension);
}

function summarizeJavaBuildArtifactFile(filePath: string, extension: string, size: number): string {
  if (extension === ".class") {
    return summarizeJavaClassFile(filePath, size);
  }
  return summarizeJavaArchiveArtifactFile(filePath, extension, size);
}

function summarizeJavaArchiveArtifactFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES, MAX_TEXT_BYTES * 64),
    );
    const entries = extractZipEntries(buffer);
    const entryNames = entries
      .map((entry) => entry.name)
      .filter((name) => name && !name.endsWith("/"))
      .slice(0, MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW);
    const manifest = entries.find((entry) => entry.name.toUpperCase() === "META-INF/MANIFEST.MF");
    const manifestLines = manifest
      ? summarizeJavaManifest(manifest.data.toString("utf8"))
      : [];
    const packageHints = summarizeJavaArchivePackageHints(entryNames);
    const classCount = entries.filter((entry) => entry.name.toLowerCase().endsWith(".class")).length;
    const nestedArchives = entryNames.filter((name) => /\.(?:jar|war|ear)$/i.test(name));
    return [
      `Java build artifact preview (${extension.toUpperCase().slice(1)}, ${formatBytes(size)}).`,
      manifestLines.length > 0
        ? `Manifest metadata: ${manifestLines.join(" | ")}.`
        : "Manifest metadata: no META-INF/MANIFEST.MF entry detected in the bounded local preview.",
      entryNames.length > 0
        ? `Entry samples (${entryNames.length}${entryNames.length >= MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW ? "+" : ""}): ${entryNames.join(" | ")}.`
        : "Entry samples: none detected in bounded local ZIP headers.",
      packageHints.length > 0
        ? `Package/class hints: ${packageHints.join(" | ")}.`
        : "Package/class hints: none detected in bounded local entries.",
      classCount > 0
        ? `Class entry count in bounded preview: ${classCount}.`
        : "Class entry count in bounded preview: none detected.",
      nestedArchives.length > 0
        ? `Nested archive cues: ${nestedArchives.slice(0, 6).join(" | ")}.`
        : "Nested archive cues: none detected.",
      buffer.length >= MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES
        ? `Java artifact preview was capped at ${formatBytes(MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES)}.`
        : "",
      "Java artifact preview read bounded workspace-local ZIP metadata only; no JVM, javap, build tool, class loading, dependency resolver, signature verification, nested archive extraction, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Java build artifact ready for explicit attachment (${formatBytes(size)}).`,
      "Java artifact preview could not read bounded local ZIP metadata; no JVM, javap, build tool, class loading, dependency resolver, signature verification, nested archive extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeJavaClassFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES, MAX_TEXT_BYTES * 64),
    );
    const metadata = readJavaClassMetadata(buffer);
    return [
      `Java class file preview (${formatBytes(size)}).`,
      metadata.valid
        ? `Class header: CAFEBABE magic valid, major ${metadata.majorVersion ?? "unknown"}, minor ${metadata.minorVersion ?? "unknown"}.`
        : "Class header: CAFEBABE magic was not recognized in the bounded local preview.",
      typeof metadata.constantPoolCount === "number"
        ? `Constant-pool count: ${metadata.constantPoolCount}.`
        : "Constant-pool count: unavailable.",
      metadata.utf8Hints.length > 0
        ? `UTF-8 constant hints: ${metadata.utf8Hints.join(" | ")}.`
        : "UTF-8 constant hints: none detected.",
      buffer.length >= MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES
        ? `Class preview was capped at ${formatBytes(MAX_JAVA_BUILD_ARTIFACT_PREVIEW_BYTES)}.`
        : "",
      "Java class preview read bounded workspace-local bytes only; no JVM, javap, bytecode verification, class loading, decompilation, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Java class file ready for explicit attachment (${formatBytes(size)}).`,
      "Java class preview could not read bounded local bytes; no JVM, javap, bytecode verification, class loading, decompilation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeJavaManifest(raw: string): string[] {
  const interestingKeys = new Set([
    "manifest-version",
    "main-class",
    "automatic-module-name",
    "implementation-title",
    "implementation-version",
    "bundle-symbolicname",
    "bundle-version",
  ]);
  return raw
    .replace(/\r\n[ \t]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const key = line.split(":")[0]?.trim().toLowerCase() || "";
      return interestingKeys.has(key);
    })
    .map((line) => clampSingleLine(maskPotentialSecretValues(line), 160))
    .slice(0, MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW);
}

function summarizeJavaArchivePackageHints(entryNames: string[]): string[] {
  const hints = new Set<string>();
  for (const name of entryNames) {
    if (!name.toLowerCase().endsWith(".class")) continue;
    const withoutClass = name.replace(/\.class$/i, "");
    const normalized = withoutClass.replace(/\$/g, ".").replace(/\//g, ".");
    const parts = normalized.split(".").filter(Boolean);
    if (parts.length >= 2) {
      hints.add(parts.slice(0, Math.min(parts.length, 5)).join("."));
    } else {
      hints.add(normalized);
    }
    if (hints.size >= MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW) break;
  }
  return [...hints];
}

interface JavaClassMetadata {
  valid: boolean;
  minorVersion?: number;
  majorVersion?: number;
  constantPoolCount?: number;
  utf8Hints: string[];
}

function readJavaClassMetadata(buffer: Buffer): JavaClassMetadata {
  const metadata: JavaClassMetadata = { valid: false, utf8Hints: [] };
  if (buffer.length < 10 || buffer.readUInt32BE(0) !== 0xcafebabe) {
    return metadata;
  }
  metadata.valid = true;
  metadata.minorVersion = buffer.readUInt16BE(4);
  metadata.majorVersion = buffer.readUInt16BE(6);
  metadata.constantPoolCount = buffer.readUInt16BE(8);
  let offset = 10;
  for (let index = 1; index < metadata.constantPoolCount && offset < buffer.length; index += 1) {
    const tag = buffer[offset];
    offset += 1;
    if (tag === 1) {
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      offset += 2;
      if (offset + length > buffer.length) break;
      const value = buffer.subarray(offset, offset + length).toString("utf8");
      offset += length;
      if (/^[\w.$/-]{3,}$/.test(value) && !/^\d+$/.test(value)) {
        metadata.utf8Hints.push(clampSingleLine(value.replace(/\//g, "."), 120));
      }
      if (metadata.utf8Hints.length >= MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW) break;
      continue;
    }
    if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 18) {
      offset += 4;
      continue;
    }
    if (tag === 5 || tag === 6) {
      offset += 8;
      index += 1;
      continue;
    }
    if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      offset += 2;
      continue;
    }
    if (tag === 15) {
      offset += 3;
      continue;
    }
    break;
  }
  metadata.utf8Hints = [...new Set(metadata.utf8Hints)].slice(0, MAX_JAVA_BUILD_ARTIFACT_ITEM_PREVIEW);
  return metadata;
}

function isWindowsDriverPackageExtension(extension: string): boolean {
  return extension === ".inf" || extension === ".cat";
}

function summarizeWindowsDriverPackageFile(filePath: string, extension: string, size: number): string {
  if (extension === ".inf") {
    return summarizeWindowsInfDriverPackage(filePath, size);
  }
  return summarizeWindowsCatalogFile(filePath, size);
}

function summarizeWindowsInfDriverPackage(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const sections = parseInfSections(raw);
    const sectionNames = [...sections.keys()].slice(0, MAX_WINDOWS_DRIVER_PACKAGE_ITEMS);
    const versionLines = summarizeInfSectionLines(sections.get("version"), [
      "signature",
      "class",
      "classguid",
      "provider",
      "driverver",
      "catalogfile",
    ]);
    const manufacturers = summarizeInfSectionLines(sections.get("manufacturer"));
    const models = summarizeInfModelLines(sections);
    const services = summarizeInfServiceLines(sections);
    return [
      `Windows driver package INF preview (${formatBytes(size)}).`,
      sectionNames.length > 0
        ? `Sections (${sectionNames.length}${sectionNames.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS ? "+" : ""}): ${sectionNames.join(", ")}.`
        : "Sections: none detected in the bounded local preview.",
      versionLines.length > 0
        ? `Version metadata: ${versionLines.join(" | ")}.`
        : "Version metadata: no Signature/Class/Provider/DriverVer/CatalogFile lines detected.",
      manufacturers.length > 0
        ? `Manufacturers (${manufacturers.length}${manufacturers.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS ? "+" : ""}): ${manufacturers.join(" | ")}.`
        : "Manufacturers: none detected.",
      models.length > 0
        ? `Model/install samples (${models.length}${models.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS ? "+" : ""}): ${models.join(" | ")}.`
        : "Model/install samples: none detected.",
      services.length > 0
        ? `Service/install directives (${services.length}${services.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS ? "+" : ""}): ${services.join(" | ")}.`
        : "Service/install directives: none detected.",
      raw.length >= MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES
        ? `INF preview was capped at ${formatBytes(MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES)}.`
        : "",
      "INF preview read bounded workspace-local text only; no pnputil/devcon/DISM command, driver install, service creation, catalog verification, registry mutation, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows driver package INF ready for explicit attachment (${formatBytes(size)}).`,
      "INF preview could not read bounded local text; no pnputil/devcon/DISM command, driver install, service creation, catalog verification, registry mutation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeWindowsCatalogFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    );
    const hexHeader = buffer.subarray(0, 16).toString("hex").replace(/(.{2})/g, "$1 ").trim();
    const pkcs7SignedDataOid = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
    const hasSignedDataOid = buffer.indexOf(pkcs7SignedDataOid) >= 0;
    const strings = extractLegacyOfficeBinaryStrings(buffer)
      .filter((value) => /\.(?:inf|sys|dll|exe|cat)\b/i.test(value) || /microsoft|catalog|driver|windows/i.test(value))
      .slice(0, MAX_WINDOWS_DRIVER_PACKAGE_ITEMS);
    return [
      `Windows driver catalog preview (${formatBytes(size)}).`,
      `Header bytes: ${hexHeader || "empty bounded preview"}.`,
      hasSignedDataOid
        ? "PKCS#7 signed-data cue: detected in bounded local bytes."
        : "PKCS#7 signed-data cue: not detected in bounded local bytes.",
      strings.length > 0
        ? `Readable catalog/package string samples (${strings.length}${strings.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS ? "+" : ""}): ${strings.join(" | ")}.`
        : "Readable catalog/package string samples: none detected.",
      buffer.length >= MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES
        ? `Catalog preview was capped at ${formatBytes(MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES)}.`
        : "",
      "Catalog preview read bounded workspace-local bytes only; no signtool/certutil/pnputil command, trust-chain validation, driver install, payload extraction, registry mutation, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows driver catalog ready for explicit attachment (${formatBytes(size)}).`,
      "Catalog preview could not read bounded local bytes; no signtool/certutil/pnputil command, trust-chain validation, driver install, payload extraction, registry mutation, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseInfSections(raw: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const originalLine of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch?.[1]) {
      current = sectionMatch[1].trim().toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue;
    const values = sections.get(current) ?? [];
    if (values.length < MAX_WINDOWS_DRIVER_PACKAGE_ITEMS * 2) {
      values.push(maskPotentialSecretValues(line));
      sections.set(current, values);
    }
  }
  return sections;
}

function summarizeInfSectionLines(lines: string[] | undefined, keys?: string[]): string[] {
  const keySet = keys ? new Set(keys.map((key) => key.toLowerCase())) : null;
  return (lines || [])
    .filter((line) => {
      if (!keySet) return line.includes("=");
      const key = line.split("=")[0]?.trim().toLowerCase() || "";
      return keySet.has(key);
    })
    .map((line) => clampSingleLine(line, 160))
    .slice(0, MAX_WINDOWS_DRIVER_PACKAGE_ITEMS);
}

function summarizeInfModelLines(sections: Map<string, string[]>): string[] {
  const output: string[] = [];
  const ignored = new Set([
    "version",
    "manufacturer",
    "strings",
    "destinationdirs",
    "sourcedisksfiles",
    "sourcedisksnames",
  ]);
  for (const [section, lines] of sections) {
    if (ignored.has(section) || section.endsWith(".services")) continue;
    if (!/\bnt(?:amd64|x86|arm64)?\b/i.test(section) && !lines.some((line) => /%[^%]+%|(?:USB|PCI|HID|ACPI|ROOT)\\/i.test(line))) {
      continue;
    }
    for (const line of lines) {
      if (!line.includes("=")) continue;
      output.push(clampSingleLine(`${section}: ${line}`, 180));
      if (output.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS) return output;
    }
  }
  return output;
}

function summarizeInfServiceLines(sections: Map<string, string[]>): string[] {
  const output: string[] = [];
  for (const [section, lines] of sections) {
    if (!section.endsWith(".services") && !lines.some((line) => /^AddService\s*=/i.test(line))) {
      continue;
    }
    for (const line of lines) {
      if (!/^(AddService|ServiceBinary|StartType|ServiceType|LoadOrderGroup)\s*=/i.test(line)) continue;
      output.push(clampSingleLine(`${section}: ${line}`, 180));
      if (output.length >= MAX_WINDOWS_DRIVER_PACKAGE_ITEMS) return output;
    }
  }
  return output;
}

function summarizeSecurityArtifactFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_SECURITY_ARTIFACT_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    );
    if (isChecksumManifestExtension(extension)) {
      return summarizeChecksumManifest(buffer.toString("utf8"), size);
    }
    if (extension === ".asc" || extension === ".sig") {
      return summarizeSignatureArtifact(buffer, extension, size);
    }
    return summarizeCertificateArtifact(buffer, extension, size);
  } catch {
    return [
      `Security artifact ready for explicit attachment (${formatBytes(size)}).`,
      "Security artifact preview read bounded local bytes only; no key import, private-key decryption, trust-store mutation, signature verification, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

interface WasmBinaryMetadata {
  valid: boolean;
  version?: number;
  sections: string[];
  customSections: string[];
}

interface PeBinaryMetadata {
  valid: boolean;
  machine?: string;
  architecture?: "32-bit" | "64-bit" | "unknown";
  subsystem?: string;
  sectionCount?: number;
  sectionNames: string[];
  importDirectoryRva?: number;
}

function summarizeBinaryArtifactFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_BINARY_ARTIFACT_PREVIEW_BYTES, MAX_TEXT_BYTES * 64),
    );
    if (extension === ".wasm") {
      const metadata = readWasmBinaryMetadata(buffer);
      return [
        `Binary artifact metadata preview (WebAssembly, ${formatBytes(size)}).`,
        metadata.valid
          ? `WASM header: magic valid, version ${metadata.version ?? "unknown"}.`
          : "WASM header: magic/version was not recognized in the bounded local preview.",
        metadata.sections.length > 0
          ? `Section hints: ${metadata.sections.slice(0, 12).join(", ")}.`
          : "Section hints: none detected in the bounded local preview.",
        metadata.customSections.length > 0
          ? `Custom section names: ${metadata.customSections.slice(0, 8).join(", ")}.`
          : "Custom section names: none detected.",
        "WebAssembly artifact preview read bounded local bytes only; no module instantiation, code execution, disassembly, malware scanning, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    const metadata = readPeBinaryMetadata(buffer);
    return [
      `Binary artifact metadata preview (${extension.toUpperCase().slice(1)}, ${formatBytes(size)}).`,
      metadata.valid
        ? `PE header: ${metadata.machine ?? "unknown machine"}, ${metadata.architecture ?? "unknown"}${metadata.subsystem ? `, subsystem ${metadata.subsystem}` : ""}.`
        : "PE header: DOS/PE signature was not recognized in the bounded local preview.",
      typeof metadata.sectionCount === "number"
        ? `Sections: ${metadata.sectionCount}${metadata.sectionNames.length ? ` (${metadata.sectionNames.join(", ")})` : ""}.`
        : "Sections: none detected in the bounded local preview.",
      typeof metadata.importDirectoryRva === "number" && metadata.importDirectoryRva > 0
        ? `Import table cue: directory RVA 0x${metadata.importDirectoryRva.toString(16)}.`
        : "Import table cue: none detected in the bounded local preview.",
      "Windows binary artifact preview read bounded local headers only; no process launch, DLL load, disassembly, signature verification, malware scanning, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Binary artifact ready for explicit attachment (${formatBytes(size)}).`,
      "Binary artifact preview read bounded local bytes only; no process launch, module instantiation, DLL load, disassembly, malware scanning, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWasmBinaryMetadata(buffer: Buffer): WasmBinaryMetadata {
  const valid =
    buffer.length >= 8 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x61 &&
    buffer[2] === 0x73 &&
    buffer[3] === 0x6d;
  const version = valid ? buffer.readUInt32LE(4) : undefined;
  const sections: string[] = [];
  const customSections: string[] = [];
  let offset = 8;
  while (valid && offset < buffer.length && sections.length < 24) {
    const id = buffer[offset];
    offset += 1;
    const sizeValue = readUnsignedLeb128(buffer, offset);
    if (!sizeValue) break;
    offset = sizeValue.nextOffset;
    const sectionEnd = offset + sizeValue.value;
    if (sectionEnd > buffer.length) break;
    const label = describeWasmSection(id);
    sections.push(`${label} (${sizeValue.value} bytes)`);
    if (id === 0) {
      const nameValue = readUnsignedLeb128(buffer, offset);
      if (nameValue && nameValue.nextOffset + nameValue.value <= sectionEnd) {
        const name = buffer
          .subarray(nameValue.nextOffset, nameValue.nextOffset + nameValue.value)
          .toString("utf8")
          .replace(/\s+/g, " ")
          .trim();
        if (name) customSections.push(name.slice(0, 80));
      }
    }
    offset = sectionEnd;
  }
  return { valid, version, sections, customSections };
}

function readUnsignedLeb128(
  buffer: Buffer,
  startOffset: number,
): { value: number; nextOffset: number } | null {
  let result = 0;
  let shift = 0;
  for (let offset = startOffset; offset < buffer.length && offset < startOffset + 5; offset += 1) {
    const byte = buffer[offset];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: offset + 1 };
    }
    shift += 7;
  }
  return null;
}

function describeWasmSection(id: number): string {
  return (
    {
      0: "custom",
      1: "type",
      2: "import",
      3: "function",
      4: "table",
      5: "memory",
      6: "global",
      7: "export",
      8: "start",
      9: "element",
      10: "code",
      11: "data",
      12: "data-count",
    }[id] ?? `unknown-${id}`
  );
}

function readPeBinaryMetadata(buffer: Buffer): PeBinaryMetadata {
  const fallback: PeBinaryMetadata = { valid: false, sectionNames: [] };
  if (buffer.length < 0x40 || buffer.subarray(0, 2).toString("ascii") !== "MZ") return fallback;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset <= 0 || peOffset + 248 > buffer.length) return fallback;
  if (buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\0\0") return fallback;
  const machineCode = buffer.readUInt16LE(peOffset + 4);
  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  const architecture = magic === 0x20b ? "64-bit" : magic === 0x10b ? "32-bit" : "unknown";
  const subsystemOffset = optionalHeaderOffset + (architecture === "64-bit" ? 0x5c : 0x44);
  const dataDirectoryOffset = optionalHeaderOffset + (architecture === "64-bit" ? 0x70 : 0x60);
  const importDirectoryRva =
    dataDirectoryOffset + 8 + 4 <= buffer.length ? buffer.readUInt32LE(dataDirectoryOffset + 8) : undefined;
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sectionNames: string[] = [];
  for (let index = 0; index < sectionCount && sectionNames.length < 8; index += 1) {
    const offset = sectionTableOffset + index * 40;
    if (offset + 8 > buffer.length) break;
    const name = buffer
      .subarray(offset, offset + 8)
      .toString("ascii")
      .replace(/\0+$/g, "")
      .trim();
    if (name) sectionNames.push(name);
  }
  return {
    valid: true,
    machine: describePeMachine(machineCode),
    architecture,
    subsystem:
      subsystemOffset + 2 <= buffer.length
        ? describePeSubsystem(buffer.readUInt16LE(subsystemOffset))
        : undefined,
    sectionCount,
    sectionNames,
    importDirectoryRva,
  };
}

function describePeMachine(code: number): string {
  return (
    {
      0x014c: "x86",
      0x0200: "Intel Itanium",
      0x8664: "x64",
      0xaa64: "ARM64",
      0x01c0: "ARM",
      0x01c4: "ARMv7",
    }[code] ?? `machine 0x${code.toString(16)}`
  );
}

function describePeSubsystem(code: number): string {
  return (
    {
      1: "native",
      2: "Windows GUI",
      3: "Windows console",
      5: "OS/2 console",
      7: "POSIX console",
      9: "Windows CE GUI",
      10: "EFI application",
      11: "EFI boot service driver",
      12: "EFI runtime driver",
      14: "Xbox",
      16: "Windows boot application",
    }[code] ?? `subsystem ${code}`
  );
}

interface PatchDiffFileSummary {
  path: string;
  oldPath?: string;
  hunks: number;
  additions: number;
  deletions: number;
  binary: boolean;
  renamed: boolean;
  modeChanged: boolean;
  newFile: boolean;
  deletedFile: boolean;
  oldContextLines: string[];
}

interface PatchDiffSummary {
  fileCount: number;
  hunkCount: number;
  additions: number;
  deletions: number;
  binaryCount: number;
  renameCount: number;
  modeChangeCount: number;
  files: PatchDiffFileSummary[];
}

function summarizePatchDiffFile(
  workspacePath: string,
  filePath: string,
  extension: string,
  size: number,
): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_PATCH_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const summary = parsePatchDiffSummary(normalized);
    const validationHints = summarizePatchConflictPrediction(workspacePath, summary);
    const sample = normalized
      .split("\n")
      .slice(0, 16)
      .map(maskPotentialSecretValues)
      .join("\n");
    const fileLines = summary.files
      .slice(0, MAX_PATCH_FILE_PREVIEW)
      .map((file) => {
        const flags = [
          file.binary ? "binary" : "",
          file.renamed ? "rename" : "",
          file.modeChanged ? "mode" : "",
        ].filter(Boolean);
        return `- ${file.path}: ${file.hunks} hunk(s), +${file.additions}/-${file.deletions}${flags.length ? ` (${flags.join(", ")})` : ""}`;
      });
    return [
      `Patch/diff preview (${extension.toUpperCase().slice(1)}, ${formatBytes(size)}).`,
      `Patch summary: ${summary.fileCount} file(s), ${summary.hunkCount} hunk(s), +${summary.additions}/-${summary.deletions}, ${summary.binaryCount} binary marker(s), ${summary.renameCount} rename marker(s), ${summary.modeChangeCount} mode change marker(s).`,
      fileLines.length > 0
        ? `Changed files:\n${fileLines.join("\n")}`
        : "Changed files: none detected in the bounded local preview.",
      validationHints,
      sample ? `Preview:\n${sample}` : "Preview: empty or unreadable patch text.",
      "Patch/diff preview parsed bounded local text only; no git apply, patch application, command execution, filesystem mutation, network call, or provider send was performed. Conflict prediction is heuristic and read-only.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Patch/diff file ready for explicit attachment (${formatBytes(size)}).`,
      "Patch/diff preview parsed bounded local text only; no git apply, patch application, command execution, filesystem mutation, network call, or provider send was performed. Conflict prediction is heuristic and read-only.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parsePatchDiffSummary(raw: string): PatchDiffSummary {
  const files = new Map<string, PatchDiffFileSummary>();
  let currentPath = "";
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;
  let binaryCount = 0;
  let renameCount = 0;
  let modeChangeCount = 0;

  function currentFile(pathHint?: string): PatchDiffFileSummary {
    const normalizedPath = cleanPatchPath(pathHint || currentPath || "(unknown patch target)");
    currentPath = normalizedPath;
    const existing = files.get(normalizedPath);
    if (existing) return existing;
    const created: PatchDiffFileSummary = {
      path: normalizedPath,
      hunks: 0,
      additions: 0,
      deletions: 0,
      binary: false,
      renamed: false,
      modeChanged: false,
      newFile: false,
      deletedFile: false,
      oldContextLines: [],
    };
    files.set(normalizedPath, created);
    return created;
  }

  for (const line of raw.split("\n")) {
    const gitDiff = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
    if (gitDiff?.[2]) {
      const file = currentFile(gitDiff[2]);
      if (gitDiff[1]) file.oldPath = cleanPatchPath(gitDiff[1]);
      continue;
    }
    const newFile = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (newFile?.[1] && newFile[1] !== "/dev/null") {
      currentFile(newFile[1]);
      continue;
    }
    const oldFile = line.match(/^---\s+(?:a\/)?(.+)$/);
    if (oldFile?.[1]) {
      if (oldFile[1] === "/dev/null") {
        currentFile().newFile = true;
      } else {
        const file = currentFile(!currentPath ? oldFile[1] : undefined);
        file.oldPath = cleanPatchPath(oldFile[1]);
      }
      continue;
    }
    if (/^@@\s/.test(line)) {
      const file = currentFile();
      file.hunks += 1;
      hunkCount += 1;
      continue;
    }
    if (/^(Binary files|GIT binary patch\b)/.test(line)) {
      const file = currentFile();
      if (!file.binary) {
        file.binary = true;
        binaryCount += 1;
      }
      continue;
    }
    if (/^rename (from|to)\s+/.test(line)) {
      const file = currentFile(line.replace(/^rename (?:from|to)\s+/, ""));
      if (!file.renamed) {
        file.renamed = true;
        renameCount += 1;
      }
      continue;
    }
    if (/^(new file mode|deleted file mode|old mode|new mode)\s+/.test(line)) {
      const file = currentFile();
      if (line.startsWith("new file mode")) file.newFile = true;
      if (line.startsWith("deleted file mode")) file.deletedFile = true;
      if (!file.modeChanged) {
        file.modeChanged = true;
        modeChangeCount += 1;
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const file = currentFile();
      file.additions += 1;
      additions += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const file = currentFile();
      file.deletions += 1;
      collectPatchOldContextLine(file, line.slice(1));
      deletions += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      collectPatchOldContextLine(currentFile(), line.slice(1));
    }
  }

  return {
    fileCount: files.size,
    hunkCount,
    additions,
    deletions,
    binaryCount,
    renameCount,
    modeChangeCount,
    files: [...files.values()],
  };
}

function collectPatchOldContextLine(file: PatchDiffFileSummary, value: string): void {
  if (file.oldContextLines.length >= MAX_PATCH_CONTEXT_LINES) return;
  const normalized = value.replace(/\s+$/g, "");
  if (!normalized.trim()) return;
  file.oldContextLines.push(normalized);
}

function summarizePatchConflictPrediction(
  workspacePath: string,
  summary: PatchDiffSummary,
): string {
  if (summary.files.length === 0) {
    return "Local patch validation hints: no changed files were detected, so no workspace conflict prediction was attempted.";
  }
  const hints = summary.files.slice(0, MAX_PATCH_FILE_PREVIEW).map((file) =>
    summarizePatchFileConflictHint(workspacePath, file),
  );
  return [
    "Local patch validation hints:",
    ...hints.map((hint) => `- ${hint}`),
    "Validation read bounded target-file text only and did not apply the patch, stage files, run git, execute commands, or mutate the filesystem.",
  ].join("\n");
}

function summarizePatchFileConflictHint(
  workspacePath: string,
  file: PatchDiffFileSummary,
): string {
  const targetPath = resolvePatchTargetPath(workspacePath, file.path);
  const oldTargetPath = file.oldPath ? resolvePatchTargetPath(workspacePath, file.oldPath) : null;
  const label = file.path;
  if (!targetPath) {
    return `${label}: skipped because the patch target is outside the workspace or unknown.`;
  }
  const targetExists = existsSync(targetPath);
  const oldTargetExists = oldTargetPath ? existsSync(oldTargetPath) : false;
  if (file.binary) {
    return `${label}: binary patch marker detected; local text context validation was skipped.`;
  }
  if (file.newFile) {
    return targetExists
      ? `${label}: conflict risk, patch declares a new file but the target already exists.`
      : `${label}: likely applies as a new file; no existing target file was found.`;
  }
  if (file.deletedFile) {
    const deleteTargetExists = oldTargetExists || targetExists;
    return deleteTargetExists
      ? `${label}: delete-file patch target exists; review deletion approval before applying.`
      : `${label}: conflict risk, delete-file patch target is missing from the workspace.`;
  }
  if (!targetExists && !oldTargetExists) {
    return `${label}: conflict risk, patch target file is missing from the workspace.`;
  }
  const readablePath = targetExists ? targetPath : oldTargetPath;
  if (!readablePath || file.oldContextLines.length === 0) {
    return `${label}: target exists, but the bounded diff has no old/context lines for validation.`;
  }
  const targetText = readPatchTargetText(readablePath);
  if (!targetText) {
    return `${label}: target exists, but bounded text validation could not read target content.`;
  }
  const contextLines = [...new Set(file.oldContextLines)].slice(0, MAX_PATCH_CONTEXT_LINES);
  const matched = contextLines.filter((line) => targetText.includes(line)).length;
  const missing = contextLines.length - matched;
  if (contextLines.length === 0) {
    return `${label}: target exists, but no non-empty old/context lines were available for validation.`;
  }
  if (matched === contextLines.length) {
    return `${label}: low conflict risk, all ${matched} sampled old/context line(s) are present in the current workspace target.`;
  }
  if (matched > 0) {
    return `${label}: medium conflict risk, ${missing} of ${contextLines.length} sampled old/context line(s) were not found in the current workspace target.`;
  }
  return `${label}: high conflict risk, none of ${contextLines.length} sampled old/context line(s) were found in the current workspace target.`;
}

function resolvePatchTargetPath(workspacePath: string, patchPath: string): string | null {
  if (!patchPath || patchPath === "(unknown patch target)" || patchPath === "/dev/null") return null;
  const resolved = resolve(workspacePath, patchPath);
  return isInsideWorkspace(workspacePath, resolved) ? resolved : null;
}

function readPatchTargetText(filePath: string): string {
  try {
    return readFileHeader(filePath, MAX_PATCH_CONFLICT_TARGET_BYTES).toString("utf8");
  } catch {
    return "";
  }
}

function cleanPatchPath(value: string): string {
  const cleaned = value
    .replace(/\t.*$/, "")
    .replace(/^"|"$/g, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "")
    .trim();
  return clampSingleLine(cleaned || "(unknown patch target)", 160);
}

function isChecksumManifestExtension(extension: string): boolean {
  return [".checksum", ".sha1", ".sha256", ".sha512"].includes(extension);
}

function summarizeChecksumManifest(raw: string, size: number): string {
  const lines = normalizeTextPreview(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = collectChecksumManifestEntries(lines);
  const algorithms = [...new Set(entries.map((entry) => entry.algorithm))];
  const samples = entries
    .slice(0, MAX_SECURITY_ARTIFACT_ITEMS)
    .map((entry) => `${entry.algorithm}:${entry.target || "(no filename)"}`);
  return [
    `Checksum manifest preview (${formatBytes(size)}).`,
    algorithms.length > 0 ? `Algorithms detected: ${algorithms.join(", ")}.` : "Algorithms detected: none in the bounded local preview.",
    `Checksum entries: ${entries.length}${entries.length >= MAX_SECURITY_ARTIFACT_ITEMS ? "+" : ""}.`,
    samples.length > 0 ? `Sample targets: ${samples.join(", ")}.` : "Sample targets: none detected.",
    "Checksum preview parsed bounded local text only; no referenced file hashing, package-manager execution, registry lookup, signature verification, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function collectChecksumManifestEntries(
  lines: string[],
): Array<{ algorithm: string; digest: string; target: string }> {
  const entries: Array<{ algorithm: string; digest: string; target: string }> = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const match = line.match(/\b([a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})\b\s+\*?(.+)?$/i);
    if (!match?.[1]) continue;
    entries.push({
      algorithm: describeDigestAlgorithm(match[1].length),
      digest: `${match[1].slice(0, 12)}...`,
      target: clampSingleLine(match[2] || "", 120),
    });
    if (entries.length >= MAX_SECURITY_ARTIFACT_ITEMS) break;
  }
  return entries;
}

function describeDigestAlgorithm(length: number): string {
  if (length === 32) return "MD5";
  if (length === 40) return "SHA-1";
  if (length === 64) return "SHA-256";
  if (length === 96) return "SHA-384";
  if (length === 128) return "SHA-512";
  return `${length * 4}-bit digest`;
}

function summarizeSignatureArtifact(buffer: Buffer, extension: string, size: number): string {
  const raw = buffer.toString("utf8");
  const normalized = normalizeTextPreview(raw);
  const armorMatch = normalized.match(/-----BEGIN PGP ([A-Z ]+)-----/);
  const armorType = armorMatch?.[1] ? `PGP ${armorMatch[1].toLowerCase()}` : extension === ".asc" ? "ASCII-armored signature/key material" : "detached signature";
  const packetHints = [
    normalized.includes("-----BEGIN PGP SIGNATURE-----") ? "PGP signature armor" : "",
    normalized.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") ? "PGP public key armor" : "",
    normalized.includes("-----BEGIN PGP PRIVATE KEY BLOCK-----") ? "PGP private key armor present; contents were not displayed" : "",
  ].filter(Boolean);
  return [
    `Signature artifact preview (${formatBytes(size)}).`,
    `Format hint: ${armorType}.`,
    packetHints.length > 0 ? `Packet hints: ${packetHints.join(", ")}.` : "Packet hints: binary or unrecognized signature bytes.",
    "Signature preview read bounded local bytes only; no keyserver lookup, key import, private-key decryption, signature verification, trust decision, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeCertificateArtifact(buffer: Buffer, extension: string, size: number): string {
  const raw = buffer.toString("utf8");
  const pemBlocks = extractPemBlocks(raw);
  const certificateBlocks = pemBlocks.filter((block) => block.label === "CERTIFICATE");
  const privateKeyBlocks = pemBlocks.filter((block) => block.label.includes("PRIVATE KEY"));
  const publicKeyBlocks = pemBlocks.filter((block) => block.label.includes("PUBLIC KEY"));
  const certificates = collectCertificateSummaries(buffer, raw, extension);
  return [
    `Certificate/security artifact preview (${formatBytes(size)}).`,
    pemBlocks.length > 0
      ? `PEM blocks: ${summarizePemBlockLabels(pemBlocks.map((block) => block.label))}.`
      : `PEM blocks: none detected; ${extension.toUpperCase().replace(".", "") || "binary"} bytes were inspected locally.`,
    `Certificate blocks: ${certificateBlocks.length}; public-key blocks: ${publicKeyBlocks.length}; private-key blocks: ${privateKeyBlocks.length} (private material not displayed).`,
    certificates.length > 0 ? `Certificate metadata:\n${certificates.join("\n")}` : "Certificate metadata: no parseable X.509 certificate found in the bounded local preview.",
    "Security artifact preview read bounded local bytes only; no key import, private-key decryption, trust-store mutation, certificate validation, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function extractPemBlocks(raw: string): Array<{ label: string; block: string }> {
  const blocks: Array<{ label: string; block: string }> = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;
  for (const match of raw.matchAll(pattern)) {
    if (!match[0] || !match[1]) continue;
    blocks.push({ label: match[1], block: match[0] });
    if (blocks.length >= MAX_SECURITY_ARTIFACT_ITEMS) break;
  }
  return blocks;
}

function summarizePemBlockLabels(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  return [...counts.entries()].map(([label, count]) => `${label} x${count}`).join(", ");
}

function collectCertificateSummaries(buffer: Buffer, raw: string, extension: string): string[] {
  const summaries: string[] = [];
  const blocks = extractPemBlocks(raw).filter((block) => block.label === "CERTIFICATE");
  for (const block of blocks) {
    const summary = summarizeX509Certificate(block.block);
    if (summary) summaries.push(summary);
    if (summaries.length >= 3) return summaries;
  }
  if (summaries.length === 0 && [".cer", ".crt", ".der"].includes(extension)) {
    const summary = summarizeX509Certificate(buffer);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

function summarizeX509Certificate(input: string | Buffer): string | null {
  try {
    const certificate = new X509Certificate(input);
    const fingerprint = certificate.fingerprint256.replace(/:/g, "").toLowerCase();
    return [
      `- Subject: ${clampSingleLine(certificate.subject, 180) || "unknown"}`,
      `Issuer: ${clampSingleLine(certificate.issuer, 180) || "unknown"}`,
      `Valid: ${certificate.validFrom} -> ${certificate.validTo}`,
      `SHA-256 fingerprint: ${fingerprint.slice(0, 24)}...`,
    ].join("; ");
  } catch {
    return null;
  }
}

function summarizeDependencyLockfile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_LOCKFILE_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const masked = maskPotentialSecretValues(raw);
    const name = basename(filePath).toLowerCase();
    const ecosystem = detectDependencyLockfileEcosystem(name, extension);
    const packages = extractDependencyLockfilePackages(name, extension, raw).slice(
      0,
      MAX_LOCKFILE_PACKAGE_PREVIEW,
    );
    const dependencyEdges = extractDependencyLockfileEdges(name, extension, raw);
    const packageCount = estimateDependencyLockfilePackageCount(name, extension, raw, packages.length);
    const preview = normalizeTextPreview(masked).split("\n").slice(0, 8).join("\n");
    return [
      `Dependency lockfile preview (${formatBytes(size)}).`,
      `Ecosystem: ${ecosystem}.`,
      `Dependency entries: ${packageCount}.`,
      packages.length > 0 ? `Sample packages: ${packages.join(", ")}.` : "Sample packages: none detected in the bounded local preview.",
      dependencyEdges.length > 0
        ? `Local dependency edge samples: ${dependencyEdges.join("; ")}.`
        : "Local dependency edge samples: none detected in the bounded local preview.",
      preview ? `Preview:\n${preview}` : "Preview: empty or unreadable text window.",
      "Lockfile preview read bounded local text only; dependency edges are sampled from the lockfile content without package manager execution, dependency installation, registry lookup, vulnerability audit, license analysis, network call, script execution, or provider send.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Dependency lockfile ready for explicit attachment (${formatBytes(size)}).`,
      "No package manager execution, dependency installation, registry lookup, network call, script execution, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeNodePackageManifestFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_NODE_PACKAGE_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 32),
    ).toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return [
        `Node package manifest ready for explicit attachment (${formatBytes(size)}).`,
        "package.json did not parse to a JSON object in the bounded local preview.",
        "No npm, pnpm, Yarn, Bun, node, lifecycle script, package install, registry lookup, network call, credential lookup, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    const packageName = readRecordString(parsed, "name") || "(unnamed package)";
    const version = readRecordString(parsed, "version") || "none";
    const type = readRecordString(parsed, "type") || "commonjs/default";
    const packageManager = readRecordString(parsed, "packageManager") || "none declared";
    const scripts = readObjectKeys(parsed.scripts, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
    const dependencySummaries = summarizeNodePackageDependencyMaps(parsed);
    const workspaces = readNodePackageWorkspaces(parsed.workspaces);
    const entrypoints = summarizeNodePackageEntrypoints(parsed);
    const engines = isRecord(parsed.engines)
      ? readObjectKeys(parsed.engines, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW)
      : [];
    return [
      `Node package manifest preview (${formatBytes(size)}).`,
      `Package: ${clampSingleLine(packageName, 160)}; version: ${clampSingleLine(version, 80)}; type: ${clampSingleLine(type, 80)}; packageManager: ${clampSingleLine(packageManager, 120)}.`,
      scripts.length > 0
        ? `Scripts (${scripts.length}${scripts.length >= MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${scripts.join(", ")}.`
        : "Scripts: none detected in the bounded local preview.",
      dependencySummaries.length > 0
        ? `Dependency maps: ${dependencySummaries.join("; ")}.`
        : "Dependency maps: none detected in the bounded local preview.",
      workspaces.length > 0
        ? `Workspaces (${workspaces.length}${workspaces.length >= MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${workspaces.join(", ")}.`
        : "Workspaces: none detected in the bounded local preview.",
      entrypoints.length > 0
        ? `Entrypoints/exports: ${entrypoints.join("; ")}.`
        : "Entrypoints/exports: none detected in the bounded local preview.",
      engines.length > 0 ? `Engines: ${engines.join(", ")}.` : "Engines: none detected in the bounded local preview.",
      "Ready for explicit attachment after visible review; package.json metadata was parsed from bounded workspace-local JSON only, and no npm, pnpm, Yarn, Bun, node, lifecycle script, package install, registry lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Node package manifest ready for explicit attachment (${formatBytes(size)}).`,
      "package.json could not be parsed within the bounded local preview.",
      "No npm, pnpm, Yarn, Bun, node, lifecycle script, package install, registry lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeNodePackageManagerConfigFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_NODE_PACKAGE_MANAGER_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 16),
    ).toString("utf8");
    const format = describeNodePackageManagerConfigFormat(filePath, extension);
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const settings = collectNodePackageManagerConfigSettings(lines, extension);
    const packageManagerHints = collectNodePackageManagerHints(lines, extension);
    const sampleLines = lines
      .map((line) => maskPotentialSecretValues(line.trim()))
      .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(";"))
      .slice(0, MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW);
    return [
      `Node package-manager config preview (${format}, ${formatBytes(size)}).`,
      settings.length > 0
        ? `registry/cache/package-manager settings (${settings.length}${settings.length >= MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${settings.join(", ")}.`
        : "registry/cache/package-manager settings: none detected in the bounded local preview.",
      packageManagerHints.length > 0
        ? `Package-manager hints: ${packageManagerHints.join(", ")}.`
        : "Package-manager hints: none detected in the bounded local preview.",
      sampleLines.length > 0
        ? `Sanitized line samples:\n${sampleLines.map((line, index) => `${index + 1}. ${clampSingleLine(line, 220)}`).join("\n")}`
        : "Sanitized line samples: none detected in the bounded local preview.",
      raw.length >= MAX_NODE_PACKAGE_MANAGER_CONFIG_PREVIEW_BYTES
        ? `Node package-manager config preview was capped at ${formatBytes(MAX_NODE_PACKAGE_MANAGER_CONFIG_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Node package-manager config metadata was parsed from bounded workspace-local text only, with likely secrets redacted and no npm, pnpm, Yarn, Bun, node command, lifecycle script, package install, registry lookup, registry reachability check, network call, credential validation, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Node package-manager config ready for explicit attachment (${formatBytes(size)}).`,
      "Config preview could not read bounded local text.",
      "No npm, pnpm, Yarn, Bun, node command, lifecycle script, package install, registry lookup, network call, credential validation, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeJvmBuildConfigFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_JVM_BUILD_CONFIG_PREVIEW_BYTES, MAX_TEXT_BYTES * 16),
    ).toString("utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const format = describeJvmBuildConfigFormat(filePath, extension);
    const metadata = extension === ".gradle.properties"
      ? collectJvmPropertySettings(lines)
      : collectJvmConfigOptions(lines);
    const hints = collectJvmBuildConfigHints(lines, extension);
    const samples = collectJvmBuildConfigSamples(lines);
    return [
      `JVM build config preview (${format}, ${formatBytes(size)}).`,
      metadata.length > 0
        ? `Gradle/Maven/JVM property and option metadata (${metadata.length}${metadata.length >= MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${metadata.join(", ")}.`
        : "Gradle/Maven/JVM property and option metadata: none detected in the bounded local preview.",
      hints.length > 0
        ? `Build config hints: ${hints.join(", ")}.`
        : "Build config hints: none detected in the bounded local preview.",
      samples.length > 0
        ? `Sanitized line samples:\n${samples.map((line, index) => `${index + 1}. ${line}`).join("\n")}`
        : "Sanitized line samples: none detected in the bounded local preview.",
      raw.length >= MAX_JVM_BUILD_CONFIG_PREVIEW_BYTES
        ? `JVM build config preview was capped at ${formatBytes(MAX_JVM_BUILD_CONFIG_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Gradle/Maven/JVM property and option metadata was parsed from bounded workspace-local text only, with likely secrets redacted and no Gradle/Maven/JVM command, wrapper launch, package restore, dependency resolution, plugin execution, settings.xml merge, network call, credential validation, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `JVM build config ready for explicit attachment (${formatBytes(size)}).`,
      "Config preview could not read bounded local text.",
      "No Gradle/Maven/JVM command, wrapper launch, package restore, dependency resolution, plugin execution, settings.xml merge, network call, credential validation, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describeJvmBuildConfigFormat(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".gradle.properties" || name === "gradle.properties") return "Gradle properties";
  if (extension === ".maven.config" || name === "maven.config") return "Maven CLI config";
  if (extension === ".jvm.config" || name === "jvm.config") return "Maven JVM config";
  return "JVM build config";
}

function collectJvmPropertySettings(lines: string[]): string[] {
  const settings = new Set<string>();
  for (const line of lines) {
    const trimmed = stripJvmBuildConfigComment(line);
    if (!trimmed) continue;
    const match = trimmed.match(/^([^:=\s][^:=]*?)\s*[:=]\s*(.*)$/);
    if (match?.[1]) settings.add(clampSingleLine(maskPotentialSecretValues(match[1].trim()), 120));
    if (settings.size >= MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW) break;
  }
  return [...settings].slice(0, MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW);
}

function collectJvmConfigOptions(lines: string[]): string[] {
  const options = new Set<string>();
  for (const line of lines) {
    const trimmed = stripJvmBuildConfigComment(line);
    if (!trimmed) continue;
    for (const token of trimmed.split(/\s+/)) {
      if (!token) continue;
      const clean = maskPotentialSecretValues(token);
      if (clean.startsWith("-D")) {
        const key = clean.slice(2).split("=")[0];
        if (key) options.add(`system property ${clampSingleLine(key, 100)}`);
      } else if (clean.startsWith("-P") && clean.length > 2) {
        options.add(`profile ${clampSingleLine(clean.slice(2), 100)}`);
      } else if (clean.startsWith("--")) {
        options.add(clampSingleLine(clean.split("=")[0], 120));
      } else if (/^-X[^=]*/.test(clean) || clean.startsWith("-XX:")) {
        options.add(clampSingleLine(clean.split("=")[0], 120));
      } else if (/^-[A-Za-z]$/.test(clean)) {
        options.add(clean);
      }
      if (options.size >= MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW) return [...options];
    }
  }
  return [...options].slice(0, MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW);
}

function collectJvmBuildConfigHints(lines: string[], extension: string): string[] {
  const hints = new Set<string>();
  const raw = lines.join("\n").toLowerCase();
  if (extension === ".gradle.properties" || raw.includes("org.gradle")) hints.add("Gradle");
  if (extension === ".maven.config" || raw.includes("maven")) hints.add("Maven");
  if (extension === ".jvm.config" || raw.includes("-xmx") || raw.includes("-xx:")) hints.add("JVM options");
  if (raw.includes("repository") || raw.includes("repo") || raw.includes("mirror")) hints.add("repository/mirror");
  if (raw.includes("proxy")) hints.add("proxy");
  if (raw.includes("daemon")) hints.add("daemon");
  if (raw.includes("parallel")) hints.add("parallelism");
  if (raw.includes("offline")) hints.add("offline mode");
  if (raw.includes("password") || raw.includes("token") || raw.includes("secret") || raw.includes("key")) hints.add("credential-shaped value redacted");
  return [...hints].slice(0, MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW);
}

function collectJvmBuildConfigSamples(lines: string[]): string[] {
  return lines
    .map((line) => stripJvmBuildConfigComment(line))
    .filter(Boolean)
    .map((line) => clampSingleLine(maskPotentialSecretValues(line), 220))
    .slice(0, MAX_JVM_BUILD_CONFIG_ITEM_PREVIEW);
}

function stripJvmBuildConfigComment(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) return "";
  return trimmed;
}

function summarizeCargoManifestFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_CARGO_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const metadata = collectCargoPackageWorkspaceMetadata(lines);
    const dependencies = collectCargoManifestSectionEntries(lines, [
      "dependencies",
      "dev-dependencies",
      "build-dependencies",
    ]);
    const targetDependencies = collectCargoTargetDependencyEntries(lines);
    const features = collectCargoManifestSectionEntries(lines, ["features"]);
    const targets = collectCargoTargetHints(lines);
    return [
      `Cargo manifest preview (${formatBytes(size)}).`,
      metadata.length > 0
        ? `package/workspace metadata (${metadata.length}${metadata.length >= MAX_CARGO_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${metadata.join(", ")}.`
        : "package/workspace metadata: none detected in the bounded local preview.",
      dependencies.length > 0
        ? `Dependency entries (${dependencies.length}${dependencies.length >= MAX_CARGO_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.`
        : "Dependency entries: none detected in the bounded local preview.",
      targetDependencies.length > 0
        ? `Target dependency entries (${targetDependencies.length}${targetDependencies.length >= MAX_CARGO_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${targetDependencies.join(", ")}.`
        : "Target dependency entries: none detected in the bounded local preview.",
      features.length > 0
        ? `Feature declarations (${features.length}${features.length >= MAX_CARGO_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${features.join(", ")}.`
        : "Feature declarations: none detected in the bounded local preview.",
      targets.length > 0
        ? `Target/build hints: ${targets.join(", ")}.`
        : "Target/build hints: none detected in the bounded local preview.",
      raw.length >= MAX_CARGO_MANIFEST_PREVIEW_BYTES
        ? `Cargo manifest preview was capped at ${formatBytes(MAX_CARGO_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Cargo.toml metadata was parsed from bounded workspace-local TOML text only, with no cargo, rustc, rustup, build.rs, package install, registry lookup, dependency resolution, build/test execution, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Cargo manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Cargo.toml preview could not read bounded local text.",
      "No cargo, rustc, rustup, build.rs, package install, registry lookup, dependency resolution, build/test execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeDartPubspecManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_DART_PUBSPEC_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const format = extension === ".pubspec.lock" ? "pubspec.lock lockfile" : "pubspec.yaml manifest";
    const metadata = collectDartPubspecMetadata(lines, extension);
    const dependencies = collectDartPubspecDependencies(lines, extension);
    const flutterHints = collectDartPubspecFlutterHints(lines);
    const lockPackages = extension === ".pubspec.lock" ? collectDartPubspecLockPackages(lines) : [];
    return [
      `Dart pubspec manifest preview (${format}, ${formatBytes(size)}).`,
      metadata.length > 0
        ? `package/environment/dependency/flutter metadata (${metadata.length}${metadata.length >= MAX_DART_PUBSPEC_ITEM_PREVIEW ? "+" : ""}): ${metadata.join(", ")}.`
        : "package/environment/dependency/flutter metadata: none detected in the bounded local preview.",
      dependencies.length > 0
        ? `Dependency entries (${dependencies.length}${dependencies.length >= MAX_DART_PUBSPEC_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.`
        : "Dependency entries: none detected in the bounded local preview.",
      lockPackages.length > 0
        ? `Locked package entries (${lockPackages.length}${lockPackages.length >= MAX_DART_PUBSPEC_ITEM_PREVIEW ? "+" : ""}): ${lockPackages.join(", ")}.`
        : extension === ".pubspec.lock"
          ? "Locked package entries: none detected in the bounded local preview."
          : "",
      flutterHints.length > 0
        ? `Flutter hints: ${flutterHints.join(", ")}.`
        : "Flutter hints: none detected in the bounded local preview.",
      raw.length >= MAX_DART_PUBSPEC_PREVIEW_BYTES
        ? `Dart pubspec manifest preview was capped at ${formatBytes(MAX_DART_PUBSPEC_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Dart pubspec metadata was parsed from bounded workspace-local YAML text only, with no dart, flutter, pub command, package get, build_runner, code generation, dependency resolution, registry lookup, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Dart pubspec manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Pubspec preview could not read bounded local text.",
      "No dart, flutter, pub command, package get, build_runner, code generation, dependency resolution, registry lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function collectDartPubspecMetadata(lines: string[], extension: string): string[] {
  const metadata = new Set<string>();
  let section = "";
  for (const line of lines) {
    const trimmed = stripYamlComment(line);
    if (!trimmed) continue;
    const topLevel = readYamlTopLevelKey(line);
    if (topLevel) section = topLevel;
    const entry = readYamlKeyValuePreview(trimmed);
    if (!entry) continue;
    if (
      ["name", "version", "description", "publish_to", "sdk"].includes(entry.key) ||
      section === "environment" ||
      section === "flutter" ||
      (extension === ".pubspec.lock" && ["sdks", "packages"].includes(section))
    ) {
      metadata.add(section && section !== entry.key ? `${section}.${entry.key}=${entry.value}` : `${entry.key}=${entry.value}`);
    }
    if (metadata.size >= MAX_DART_PUBSPEC_ITEM_PREVIEW) break;
  }
  return [...metadata].slice(0, MAX_DART_PUBSPEC_ITEM_PREVIEW);
}

function collectDartPubspecDependencies(lines: string[], extension: string): string[] {
  const dependencies = new Set<string>();
  let section = "";
  let packageName = "";
  for (const line of lines) {
    const trimmed = stripYamlComment(line);
    if (!trimmed) continue;
    const topLevel = readYamlTopLevelKey(line);
    if (topLevel) {
      section = topLevel;
      packageName = "";
    }
    const entry = readYamlKeyValuePreview(trimmed);
    if (!entry) continue;
    if (["dependencies", "dev_dependencies", "dependency_overrides"].includes(section)) {
      if (entry.key !== section) {
        dependencies.add(`${section}.${entry.key}`);
      }
    } else if (extension === ".pubspec.lock" && section === "packages") {
      if (line.match(/^\s{2}[A-Za-z0-9_.-]+:\s*$/)) {
        packageName = entry.key;
        dependencies.add(`packages.${packageName}`);
      } else if (packageName && ["dependency", "source", "version"].includes(entry.key)) {
        dependencies.add(`${packageName}.${entry.key}=${entry.value}`);
      }
    }
    if (dependencies.size >= MAX_DART_PUBSPEC_ITEM_PREVIEW) break;
  }
  return [...dependencies].slice(0, MAX_DART_PUBSPEC_ITEM_PREVIEW);
}

function collectDartPubspecLockPackages(lines: string[]): string[] {
  const packages = new Set<string>();
  let inPackages = false;
  for (const line of lines) {
    const trimmed = stripYamlComment(line);
    if (!trimmed) continue;
    const topLevel = readYamlTopLevelKey(line);
    if (topLevel) inPackages = topLevel === "packages";
    if (!inPackages) continue;
    const match = line.match(/^\s{2}([A-Za-z0-9_.-]+):\s*$/);
    if (match?.[1]) packages.add(match[1]);
    if (packages.size >= MAX_DART_PUBSPEC_ITEM_PREVIEW) break;
  }
  return [...packages].slice(0, MAX_DART_PUBSPEC_ITEM_PREVIEW);
}

function collectDartPubspecFlutterHints(lines: string[]): string[] {
  const hints = new Set<string>();
  let section = "";
  for (const line of lines) {
    const trimmed = stripYamlComment(line);
    if (!trimmed) continue;
    const topLevel = readYamlTopLevelKey(line);
    if (topLevel) section = topLevel;
    if (section === "flutter") {
      const entry = readYamlKeyValuePreview(trimmed);
      if (entry && ["uses-material-design", "assets", "fonts", "plugin", "module"].includes(entry.key)) {
        hints.add(entry.key);
      }
    }
    if (trimmed.includes("flutter:")) hints.add("flutter section");
    if (trimmed.includes("sdk: flutter")) hints.add("Flutter SDK dependency");
    if (trimmed.includes("build_runner")) hints.add("build_runner dependency cue");
    if (hints.size >= MAX_DART_PUBSPEC_ITEM_PREVIEW) break;
  }
  return [...hints].slice(0, MAX_DART_PUBSPEC_ITEM_PREVIEW);
}

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble) return line.slice(0, index).trim();
  }
  return line.trim();
}

function readYamlTopLevelKey(line: string): string | null {
  const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
  return match?.[1]?.toLowerCase() || null;
}

function readYamlKeyValuePreview(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
  if (!match?.[1]) return null;
  const rawValue = match[2]?.trim() || "(map/list)";
  return {
    key: match[1].toLowerCase(),
    value: clampSingleLine(maskPotentialSecretValues(rawValue), 100),
  };
}

function summarizeApplePackageManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_APPLE_PACKAGE_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const format = describeApplePackageManifestFormat(filePath, extension);
    const metadata = collectApplePackageManifestMetadata(lines, extension);
    const dependencies = collectApplePackageManifestDependencies(lines, extension);
    const products = collectApplePackageManifestProducts(lines, extension);
    const targets = collectApplePackageManifestTargets(lines, extension);
    return [
      `Apple package manifest preview (${format}, ${formatBytes(size)}).`,
      metadata.length > 0
        ? `package/platform/dependency/product/target metadata (${metadata.length}${metadata.length >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${metadata.join(", ")}.`
        : "package/platform/dependency/product/target metadata: none detected in the bounded local preview.",
      dependencies.length > 0
        ? `Dependency declarations (${dependencies.length}${dependencies.length >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.`
        : "Dependency declarations: none detected in the bounded local preview.",
      products.length > 0
        ? `Product declarations (${products.length}${products.length >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${products.join(", ")}.`
        : "Product declarations: none detected in the bounded local preview.",
      targets.length > 0
        ? `Target declarations (${targets.length}${targets.length >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${targets.join(", ")}.`
        : "Target declarations: none detected in the bounded local preview.",
      raw.length >= MAX_APPLE_PACKAGE_MANIFEST_PREVIEW_BYTES
        ? `Apple package manifest preview was capped at ${formatBytes(MAX_APPLE_PACKAGE_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Apple package metadata was parsed from bounded workspace-local manifest text only, with no swift, xcodebuild, pod, bundle, ruby command, package resolution, install, build, test, registry lookup, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Apple package manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Apple package manifest preview could not read bounded local text.",
      "No swift, xcodebuild, pod, bundle, ruby command, package resolution, install, build, test, registry lookup, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describeApplePackageManifestFormat(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".swift-package" || name === "package.swift") return "Swift Package manifest";
  if (extension === ".podfile.lock" || name === "podfile.lock") return "CocoaPods Podfile.lock";
  if (extension === ".podfile" || name === "podfile") return "CocoaPods Podfile";
  if (extension === ".podspec" || name.endsWith(".podspec")) return "CocoaPods podspec";
  return "Apple package manifest";
}

function collectApplePackageManifestMetadata(lines: string[], extension: string): string[] {
  const metadata = new Set<string>();
  for (const rawLine of lines) {
    const raw = rawLine.trim();
    const line = stripAppleManifestComment(rawLine);
    if (!raw && !line) continue;
    if (extension === ".swift-package") {
      const toolsVersion = raw.match(/swift-tools-version:\s*([A-Za-z0-9_.-]+)/i)?.[1];
      if (toolsVersion) metadata.add(`swift-tools-version=${toolsVersion}`);
      const name = line.match(/\bname\s*:\s*"([^"]+)"/)?.[1];
      if (name) metadata.add(`name=${clampSingleLine(name, 80)}`);
      for (const platform of [".iOS", ".macOS", ".tvOS", ".watchOS", ".visionOS"]) {
        if (line.includes(platform)) metadata.add(`platform=${platform.slice(1)}`);
      }
      if (line.includes("swiftLanguageVersions")) metadata.add("swiftLanguageVersions");
    } else if (extension === ".podfile" || extension === ".podfile.lock") {
      if (line.match(/^platform\s+:/)) metadata.add(clampSingleLine(line, 120));
      if (line.match(/^source\s+['"]/)) metadata.add("source repository declaration");
      if (line.includes("use_frameworks!")) metadata.add("use_frameworks!");
      if (line.includes("inhibit_all_warnings!")) metadata.add("inhibit_all_warnings!");
      if (extension === ".podfile.lock" && /^[A-Z][A-Z _-]+:\s*$/.test(line)) metadata.add(line.replace(/:\s*$/, "").toLowerCase());
    } else if (extension === ".podspec") {
      const assignment = line.match(/\b(?:s|spec)\.([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (assignment?.[1] && ["name", "version", "summary", "platform", "ios.deployment_target", "osx.deployment_target", "swift_version", "swift_versions"].includes(assignment[1])) {
        metadata.add(`${assignment[1]}=${clampSingleLine(maskPotentialSecretValues(assignment[2] || ""), 100)}`);
      }
    }
    if (metadata.size >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...metadata].slice(0, MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW);
}

function collectApplePackageManifestDependencies(lines: string[], extension: string): string[] {
  const dependencies = new Set<string>();
  let lockSection = "";
  for (const rawLine of lines) {
    const line = stripAppleManifestComment(rawLine);
    if (!line) continue;
    if (extension === ".podfile.lock" && /^[A-Z][A-Z _-]+:\s*$/.test(line)) {
      lockSection = line.replace(/:\s*$/, "");
      continue;
    }
    if (extension === ".swift-package") {
      if (line.includes(".package(")) dependencies.add(clampSingleLine(line, 160));
    } else if (extension === ".podfile") {
      const pod = line.match(/^\s*pod\s+['"]([^'"]+)['"]/)?.[1];
      if (pod) dependencies.add(`pod ${pod}`);
    } else if (extension === ".podspec") {
      const dependency = line.match(/\bdependency\s+['"]([^'"]+)['"]/)?.[1];
      if (dependency) dependencies.add(`dependency ${dependency}`);
    } else if (extension === ".podfile.lock" && ["PODS", "DEPENDENCIES"].includes(lockSection)) {
      const entry = line.match(/^-\s+(.+)$/)?.[1];
      if (entry) dependencies.add(clampSingleLine(entry, 120));
    }
    if (dependencies.size >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...dependencies].slice(0, MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW);
}

function collectApplePackageManifestProducts(lines: string[], extension: string): string[] {
  const products = new Set<string>();
  for (const rawLine of lines) {
    const line = stripAppleManifestComment(rawLine);
    if (!line) continue;
    if (extension === ".swift-package") {
      for (const productKind of [".library", ".executable", ".plugin"]) {
        if (line.includes(`${productKind}(`)) products.add(productKind.slice(1));
      }
    } else if (extension === ".podfile") {
      const target = line.match(/^\s*target\s+['"]([^'"]+)['"]/)?.[1];
      if (target) products.add(`target ${target}`);
    } else if (extension === ".podspec") {
      for (const cue of ["source_files", "resources", "vendored_frameworks", "subspec"]) {
        if (line.includes(`.${cue}`)) products.add(cue);
      }
    }
    if (products.size >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...products].slice(0, MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW);
}

function collectApplePackageManifestTargets(lines: string[], extension: string): string[] {
  const targets = new Set<string>();
  for (const rawLine of lines) {
    const line = stripAppleManifestComment(rawLine);
    if (!line) continue;
    if (extension === ".swift-package") {
      for (const targetKind of [".target", ".testTarget", ".executableTarget", ".plugin"]) {
        if (line.includes(`${targetKind}(`)) targets.add(targetKind.slice(1));
      }
    } else if (extension === ".podfile") {
      const target = line.match(/^\s*(?:abstract_)?target\s+['"]([^'"]+)['"]/)?.[1];
      if (target) targets.add(target);
    } else if (extension === ".podspec") {
      const moduleName = line.match(/\bmodule_name\s*=\s*['"]([^'"]+)['"]/)?.[1];
      if (moduleName) targets.add(`module ${moduleName}`);
      const dependencyTarget = line.match(/\b(?:ios|osx|tvos|watchos)\.deployment_target\s*=\s*(.+)$/)?.[0];
      if (dependencyTarget) targets.add(clampSingleLine(dependencyTarget, 120));
    } else if (extension === ".podfile.lock") {
      const checksum = line.match(/^\s{2}([A-Za-z0-9_.+/-]+):\s+[a-f0-9]{8,}/i)?.[1];
      if (checksum) targets.add(`checksum ${checksum}`);
    }
    if (targets.size >= MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...targets].slice(0, MAX_APPLE_PACKAGE_MANIFEST_ITEM_PREVIEW);
}

function stripAppleManifestComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = index + 1 < line.length ? line[index + 1] : "";
    const previous = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (!inSingle && !inDouble && char === "#") return line.slice(0, index).trim();
    if (!inSingle && !inDouble && char === "/" && next === "/") return line.slice(0, index).trim();
  }
  return line.trim();
}

function summarizePhpRubyPackageManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_PHP_RUBY_PACKAGE_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16),
    ).toString("utf8");
    const format = describePhpRubyPackageManifestFormat(filePath, extension);
    const summary =
      extension === ".composer.json"
        ? summarizeComposerJsonPackageManifest(raw)
        : summarizeRubyPackageManifest(raw, extension);
    return [
      `PHP/Ruby package manifest preview (${format}, ${formatBytes(size)}).`,
      summary.metadata.length > 0
        ? `package/source/dependency/script/platform metadata (${summary.metadata.length}${summary.metadata.length >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${summary.metadata.join(", ")}.`
        : "package/source/dependency/script/platform metadata: none detected in the bounded local preview.",
      summary.dependencies.length > 0
        ? `Dependency declarations (${summary.dependencies.length}${summary.dependencies.length >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${summary.dependencies.join(", ")}.`
        : "Dependency declarations: none detected in the bounded local preview.",
      summary.sources.length > 0
        ? `Source/platform hints: ${summary.sources.join(", ")}.`
        : "Source/platform hints: none detected in the bounded local preview.",
      summary.scripts.length > 0
        ? `Script/executable hints: ${summary.scripts.join(", ")}.`
        : "Script/executable hints: none detected in the bounded local preview.",
      raw.length >= MAX_PHP_RUBY_PACKAGE_MANIFEST_PREVIEW_BYTES
        ? `PHP/Ruby package manifest preview was capped at ${formatBytes(MAX_PHP_RUBY_PACKAGE_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; PHP/Ruby package metadata was parsed from bounded workspace-local manifest text only, with no php, composer, ruby, bundle, gem command, dependency resolution, package install, script/plugin execution, registry lookup, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `PHP/Ruby package manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Package manifest preview could not read bounded local text.",
      "No PHP/Composer/Ruby/Bundler/Gem command, dependency resolution, package install, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describePhpRubyPackageManifestFormat(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".composer.json" || name === "composer.json") return "Composer composer.json";
  if (extension === ".gemfile" || name === "gemfile") return "Bundler Gemfile";
  if (extension === ".gemspec" || name.endsWith(".gemspec")) return "Ruby gemspec";
  return "PHP/Ruby package manifest";
}

function summarizeComposerJsonPackageManifest(raw: string): {
  metadata: string[];
  dependencies: string[];
  sources: string[];
  scripts: string[];
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { metadata: ["composer.json root is not a JSON object"], dependencies: [], sources: [], scripts: [] };
    }
    const metadata = new Set<string>();
    for (const key of ["name", "type", "description", "license", "minimum-stability"]) {
      const value = readRecordString(parsed, key);
      if (value) metadata.add(`${key}=${clampSingleLine(value, 100)}`);
    }
    const preferStable = parsed["prefer-stable"];
    if (typeof preferStable === "boolean") metadata.add(`prefer-stable=${preferStable}`);
    const dependencyMaps = [
      "require",
      "require-dev",
      "conflict",
      "replace",
      "provide",
      "suggest",
    ];
    const dependencies = new Set<string>();
    for (const mapName of dependencyMaps) {
      if (!isRecord(parsed[mapName])) continue;
      for (const key of readObjectKeys(parsed[mapName], MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW)) {
        dependencies.add(`${mapName}.${key}`);
        if (key === "php" || key.startsWith("ext-")) metadata.add(`${mapName}.${key}`);
        if (dependencies.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
      }
      if (dependencies.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
    }
    const sources = new Set<string>();
    if (Array.isArray(parsed.repositories)) {
      for (const repository of parsed.repositories) {
        if (isRecord(repository)) {
          const type = readRecordString(repository, "type") || "repository";
          const url = readRecordString(repository, "url");
          sources.add(url ? `${type}:${clampSingleLine(maskPotentialSecretValues(url), 100)}` : type);
        } else if (typeof repository === "string") {
          sources.add(clampSingleLine(maskPotentialSecretValues(repository), 100));
        }
        if (sources.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
      }
    }
    if (isRecord(parsed.config) && isRecord(parsed.config.platform)) {
      for (const key of readObjectKeys(parsed.config.platform, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW)) {
        sources.add(`platform.${key}`);
        if (sources.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
      }
    }
    if (isRecord(parsed.autoload)) {
      for (const key of readObjectKeys(parsed.autoload, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW)) {
        sources.add(`autoload.${key}`);
        if (sources.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
      }
    }
    const scripts = isRecord(parsed.scripts)
      ? readObjectKeys(parsed.scripts, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW)
      : [];
    return {
      metadata: [...metadata].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
      dependencies: [...dependencies].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
      sources: [...sources].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
      scripts: scripts.slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
    };
  } catch {
    return {
      metadata: ["composer.json could not be parsed as JSON in the bounded preview"],
      dependencies: [],
      sources: [],
      scripts: [],
    };
  }
}

function summarizeRubyPackageManifest(raw: string, extension: string): {
  metadata: string[];
  dependencies: string[];
  sources: string[];
  scripts: string[];
} {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const metadata = new Set<string>();
  const dependencies = new Set<string>();
  const sources = new Set<string>();
  const scripts = new Set<string>();
  for (const rawLine of lines) {
    const line = stripRubyManifestComment(rawLine);
    if (!line) continue;
    const stringCall = readRubyCallStringArgument(line, "source");
    if (stringCall) sources.add(`source=${clampSingleLine(maskPotentialSecretValues(stringCall), 100)}`);
    const rubyVersion = readRubyCallStringArgument(line, "ruby");
    if (rubyVersion) metadata.add(`ruby=${clampSingleLine(rubyVersion, 80)}`);
    const gemName = readRubyCallStringArgument(line, "gem");
    if (gemName) dependencies.add(`gem ${gemName}`);
    const group = line.match(/\bgroup\s+(:[A-Za-z0-9_:-]+(?:\s*,\s*:[A-Za-z0-9_:-]+)*)\s+do\b/);
    if (group?.[1]) sources.add(`group ${clampSingleLine(group[1], 100)}`);
    const platforms = line.match(/\bplatforms?\s+(:[A-Za-z0-9_:-]+(?:\s*,\s*:[A-Za-z0-9_:-]+)*)\s+do\b/);
    if (platforms?.[1]) sources.add(`platform ${clampSingleLine(platforms[1], 100)}`);
    if (line.match(/\bgemspec\b/)) metadata.add("gemspec directive");
    if (extension === ".gemspec") {
      const assignment = line.match(/\b(?:s|spec)\.([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (assignment?.[1] && ["name", "version", "summary", "description", "license", "required_ruby_version"].includes(assignment[1])) {
        metadata.add(`${assignment[1]}=${clampSingleLine(maskPotentialSecretValues(assignment[2] || ""), 100)}`);
      }
      const dependency = line.match(/\badd_(?:runtime_|development_)?dependency\s+['"]([^'"]+)['"]/)?.[1];
      if (dependency) dependencies.add(`dependency ${dependency}`);
      for (const cue of ["executables", "bindir", "files", "require_paths"]) {
        if (line.includes(`.${cue}`)) scripts.add(cue);
      }
    }
    if (
      metadata.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      dependencies.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      sources.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      scripts.size >= MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW
    ) {
      break;
    }
  }
  return {
    metadata: [...metadata].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
    dependencies: [...dependencies].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
    sources: [...sources].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
    scripts: [...scripts].slice(0, MAX_PHP_RUBY_PACKAGE_MANIFEST_ITEM_PREVIEW),
  };
}

function readRubyCallStringArgument(line: string, callName: string): string | null {
  const match = line.match(new RegExp(`\\b${callName}\\s+['"]([^'"]+)['"]`));
  return match?.[1] || null;
}

function stripRubyManifestComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble) return line.slice(0, index).trim();
  }
  return line.trim();
}

function summarizeElixirHaskellPackageManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16),
    ).toString("utf8");
    const format = describeElixirHaskellPackageManifestFormat(filePath, extension);
    const summary = [".mix.exs", ".mix.lock"].includes(extension)
      ? summarizeElixirPackageManifest(raw, extension)
      : summarizeHaskellPackageManifest(raw, extension);
    return [
      `Elixir/Haskell package manifest preview (${format}, ${formatBytes(size)}).`,
      summary.metadata.length > 0
        ? `${summary.metadataLabel} (${summary.metadata.length}${summary.metadata.length >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${summary.metadata.join(", ")}.`
        : `${summary.metadataLabel}: none detected in the bounded local preview.`,
      summary.dependencies.length > 0
        ? `Dependency declarations (${summary.dependencies.length}${summary.dependencies.length >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${summary.dependencies.join(", ")}.`
        : "Dependency declarations: none detected in the bounded local preview.",
      summary.components.length > 0
        ? `Task/component cues (${summary.components.length}${summary.components.length >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${summary.components.join(", ")}.`
        : "Task/component cues: none detected in the bounded local preview.",
      raw.length >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_PREVIEW_BYTES
        ? `Elixir/Haskell package manifest preview was capped at ${formatBytes(MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Elixir/Haskell project metadata was parsed from bounded workspace-local manifest text only, with no Elixir/Mix/Rebar/Hex/Erlang/Stack/Cabal/GHC command, dependency resolution, package install, build, test, registry lookup, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Elixir/Haskell package manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Package manifest preview could not read bounded local text.",
      "No Elixir/Mix/Rebar/Hex/Erlang/Stack/Cabal/GHC command, dependency resolution, package install, build/test execution, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describeElixirHaskellPackageManifestFormat(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".mix.exs" || name === "mix.exs") return "Elixir Mix project";
  if (extension === ".mix.lock" || name === "mix.lock") return "Elixir Mix lockfile";
  if (extension === ".stack.yaml" || name === "stack.yaml" || name === "stack.yml") return "Haskell Stack project";
  if (extension === ".package.yaml" || name === "package.yaml" || name === "package.yml") return "Haskell package.yaml";
  if (extension === ".cabal" || name.endsWith(".cabal")) return "Haskell Cabal package";
  return "Elixir/Haskell package manifest";
}

function summarizeElixirPackageManifest(raw: string, extension: string): {
  metadataLabel: string;
  metadata: string[];
  dependencies: string[];
  components: string[];
} {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const metadata = new Set<string>();
  const dependencies = new Set<string>();
  const components = new Set<string>();
  for (const rawLine of lines) {
    const line = stripElixirManifestComment(rawLine);
    if (!line) continue;
    if (extension === ".mix.lock") {
      const locked = line.match(/["']([^"']+)["']\s*=>\s*\{?:(hex|git|path)\b/) || line.match(/["']([^"']+)["']\s*=>/);
      if (locked?.[1]) dependencies.add(`locked ${clampSingleLine(locked[1], 80)}`);
      if (line.includes(":hex")) metadata.add("Hex lock entries");
      if (line.includes(":git")) metadata.add("Git lock entries");
      if (line.includes(":path")) metadata.add("path lock entries");
    } else {
      const app = line.match(/\bapp:\s*:([A-Za-z0-9_]+)/)?.[1];
      if (app) metadata.add(`app=${app}`);
      const version = line.match(/\bversion:\s*["']([^"']+)["']/)?.[1];
      if (version) metadata.add(`version=${clampSingleLine(version, 80)}`);
      const elixir = line.match(/\belixir:\s*["']([^"']+)["']/)?.[1];
      if (elixir) metadata.add(`elixir=${clampSingleLine(elixir, 80)}`);
      const dep = line.match(/\{\s*:([A-Za-z0-9_]+)\s*,/)?.[1];
      if (dep) dependencies.add(`mix ${dep}`);
      const task = line.match(/\b(?:aliases|preferred_cli_env|deps|project|application)\b/);
      if (task?.[0]) components.add(task[0]);
      const extraApp = line.match(/\bextra_applications:\s*\[([^\]]+)/)?.[1];
      if (extraApp) {
        for (const item of extraApp.split(",")) {
          const clean = item.replace(/[:'"\s]/g, "");
          if (clean) components.add(`extra_app ${clampSingleLine(clean, 60)}`);
          if (components.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
        }
      }
    }
    if (
      metadata.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      dependencies.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      components.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW
    ) break;
  }
  return {
    metadataLabel: "Mix app/version/task/dependency metadata",
    metadata: [...metadata].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
    dependencies: [...dependencies].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
    components: [...components].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
  };
}

function summarizeHaskellPackageManifest(raw: string, extension: string): {
  metadataLabel: string;
  metadata: string[];
  dependencies: string[];
  components: string[];
} {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const metadata = new Set<string>();
  const dependencies = new Set<string>();
  const components = new Set<string>();
  let cabalField = "";
  for (const rawLine of lines) {
    const line = stripHaskellManifestComment(rawLine);
    if (!line) continue;
    if (extension === ".cabal") {
      const section = line.match(/^(library|executable|test-suite|benchmark|flag|source-repository)\s*([A-Za-z0-9_.-]+)?/i);
      if (section?.[1]) components.add(section[2] ? `${section[1].toLowerCase()} ${section[2]}` : section[1].toLowerCase());
      const field = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (field?.[1]) {
        cabalField = field[1].toLowerCase();
        const value = field[2] || "";
        if (["name", "version", "cabal-version", "build-type", "license"].includes(cabalField)) {
          metadata.add(`${cabalField}=${clampSingleLine(value, 100)}`);
        }
        if (cabalField === "build-depends") collectCommaSeparatedPreview(value, dependencies, "build-depends");
        if (["hs-source-dirs", "main-is", "exposed-modules", "default-language"].includes(cabalField)) {
          components.add(`${cabalField}=${clampSingleLine(value, 100)}`);
        }
      } else if (cabalField === "build-depends") {
        collectCommaSeparatedPreview(line, dependencies, "build-depends");
      }
    } else {
      const yaml = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (yaml?.[1]) {
        const key = yaml[1].toLowerCase();
        const value = yaml[2] || "";
        if (["name", "version", "resolver", "snapshot", "compiler", "license"].includes(key)) {
          metadata.add(`${key}=${clampSingleLine(value, 100)}`);
        }
        if (["dependencies", "extra-deps"].includes(key)) {
          if (value.trim()) collectCommaSeparatedPreview(value.replace(/^\[|\]$/g, ""), dependencies, key);
          else components.add(key);
        }
        if (["packages", "library", "executables", "tests", "benchmarks", "flags", "source-dirs"].includes(key)) {
          components.add(key);
        }
      }
      const listItem = line.match(/^-\s*([A-Za-z0-9_.:@/+~-][A-Za-z0-9_.:@/+~<>= -]*)$/)?.[1];
      if (listItem && dependencies.size < MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW) {
        dependencies.add(clampSingleLine(listItem, 100));
      }
    }
    if (
      metadata.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      dependencies.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW &&
      components.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW
    ) break;
  }
  return {
    metadataLabel: "Haskell package/resolver/dependency/component metadata",
    metadata: [...metadata].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
    dependencies: [...dependencies].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
    components: [...components].slice(0, MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW),
  };
}

function collectCommaSeparatedPreview(value: string, target: Set<string>, prefix: string): void {
  for (const item of value.split(",")) {
    const clean = item.trim().replace(/^-\s*/, "");
    if (!clean) continue;
    target.add(`${prefix} ${clampSingleLine(clean, 100)}`);
    if (target.size >= MAX_ELIXIR_HASKELL_PACKAGE_MANIFEST_ITEM_PREVIEW) break;
  }
}

function stripElixirManifestComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble) return line.slice(0, index).trim();
  }
  return line.trim();
}

function stripHaskellManifestComment(line: string): string {
  return line.replace(/--.*$/g, "").replace(/#.*$/g, "").trim();
}

function collectCargoPackageWorkspaceMetadata(lines: string[]): string[] {
  const metadata = new Set<string>();
  let section = "";
  for (const line of lines) {
    const trimmed = stripTomlComment(line);
    if (!trimmed) continue;
    const sectionName = readTomlSectionName(trimmed);
    if (sectionName) {
      section = sectionName;
      continue;
    }
    if (section !== "package" && section !== "workspace" && section !== "workspace.package") continue;
    const entry = readTomlKeyValuePreview(trimmed);
    if (entry && ["name", "version", "edition", "rust-version", "resolver", "members", "default-members", "authors", "license"].includes(entry.key)) {
      metadata.add(`${section}.${entry.key}=${entry.value}`);
    }
    if (metadata.size >= MAX_CARGO_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...metadata].slice(0, MAX_CARGO_MANIFEST_ITEM_PREVIEW);
}

function collectCargoManifestSectionEntries(lines: string[], sections: string[]): string[] {
  const entries = new Set<string>();
  let section = "";
  for (const line of lines) {
    const trimmed = stripTomlComment(line);
    if (!trimmed) continue;
    const sectionName = readTomlSectionName(trimmed);
    if (sectionName) {
      section = sectionName;
      continue;
    }
    if (!sections.includes(section)) continue;
    const entry = readTomlKeyValuePreview(trimmed);
    if (entry) entries.add(`${section}.${entry.key}`);
    if (entries.size >= MAX_CARGO_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...entries].slice(0, MAX_CARGO_MANIFEST_ITEM_PREVIEW);
}

function collectCargoTargetDependencyEntries(lines: string[]): string[] {
  const entries = new Set<string>();
  let section = "";
  for (const line of lines) {
    const trimmed = stripTomlComment(line);
    if (!trimmed) continue;
    const sectionName = readTomlSectionName(trimmed);
    if (sectionName) {
      section = sectionName;
      continue;
    }
    if (!/^target\.[^.]+(?:\.[^.]+)*\.(?:dependencies|dev-dependencies|build-dependencies)$/.test(section)) continue;
    const entry = readTomlKeyValuePreview(trimmed);
    if (entry) entries.add(`${clampSingleLine(section, 80)}.${entry.key}`);
    if (entries.size >= MAX_CARGO_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...entries].slice(0, MAX_CARGO_MANIFEST_ITEM_PREVIEW);
}

function collectCargoTargetHints(lines: string[]): string[] {
  const hints = new Set<string>();
  for (const line of lines) {
    const trimmed = stripTomlComment(line);
    if (!trimmed) continue;
    const sectionName = readTomlSectionName(trimmed);
    if (sectionName) {
      if (["lib", "bin", "example", "test", "bench"].includes(sectionName) || sectionName.startsWith("target.")) {
        hints.add(sectionName);
      }
      continue;
    }
    const entry = readTomlKeyValuePreview(trimmed);
    if (entry?.key === "build") hints.add(`build=${entry.value}`);
    if (hints.size >= MAX_CARGO_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...hints].slice(0, MAX_CARGO_MANIFEST_ITEM_PREVIEW);
}

function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = index > 0 ? line[index - 1] : "";
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble) return line.slice(0, index).trim();
  }
  return line.trim();
}

function readTomlSectionName(line: string): string | null {
  const match = line.match(/^\[\[?([^\]]+)\]?\]$/);
  return match?.[1]?.trim().toLowerCase() || null;
}

function readTomlKeyValuePreview(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
  if (!match?.[1]) return null;
  return {
    key: match[1].toLowerCase(),
    value: clampSingleLine(maskPotentialSecretValues(match[2] || ""), 80),
  };
}

function summarizeGoModuleManifestFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_GO_MODULE_MANIFEST_PREVIEW_BYTES, MAX_TEXT_BYTES * 16)).toString("utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const directives = collectGoModuleDirectives(lines, extension);
    const dependencies = collectGoModuleDependencyDirectives(lines);
    const workspaceUses = collectGoWorkspaceUseDirectives(lines);
    const replacements = collectGoDirectiveValues(lines, "replace");
    const excludes = collectGoDirectiveValues(lines, "exclude");
    return [
      `Go module manifest preview (${extension === ".go.work" ? "go.work workspace" : "go.mod module"}, ${formatBytes(size)}).`,
      directives.length > 0
        ? `module/workspace directives (${directives.length}${directives.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${directives.join(", ")}.`
        : "module/workspace directives: none detected in the bounded local preview.",
      dependencies.length > 0
        ? `Require directives (${dependencies.length}${dependencies.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${dependencies.join(", ")}.`
        : "Require directives: none detected in the bounded local preview.",
      workspaceUses.length > 0
        ? `Workspace use directives (${workspaceUses.length}${workspaceUses.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${workspaceUses.join(", ")}.`
        : "Workspace use directives: none detected in the bounded local preview.",
      replacements.length > 0
        ? `Replace directives (${replacements.length}${replacements.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${replacements.join(", ")}.`
        : "Replace directives: none detected in the bounded local preview.",
      excludes.length > 0
        ? `Exclude directives (${excludes.length}${excludes.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW ? "+" : ""}): ${excludes.join(", ")}.`
        : "Exclude directives: none detected in the bounded local preview.",
      raw.length >= MAX_GO_MODULE_MANIFEST_PREVIEW_BYTES
        ? `Go module manifest preview was capped at ${formatBytes(MAX_GO_MODULE_MANIFEST_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Go module manifest metadata was parsed from bounded workspace-local text only, with no go command, go env, module download, proxy lookup, checksum database lookup, dependency install, build/test execution, credential lookup, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Go module manifest ready for explicit attachment (${formatBytes(size)}).`,
      "Manifest preview could not read bounded local text.",
      "No go command, go env, module download, proxy lookup, checksum database lookup, dependency install, build/test execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function collectGoModuleDirectives(lines: string[], extension: string): string[] {
  const directives = new Set<string>();
  for (const line of lines) {
    const trimmed = stripGoManifestComment(line);
    if (!trimmed) continue;
    for (const key of extension === ".go.work" ? ["go", "toolchain", "use", "replace"] : ["module", "go", "toolchain", "require", "replace", "exclude", "retract"]) {
      if (trimmed === `${key} (` || trimmed.startsWith(`${key} `)) {
        directives.add(clampSingleLine(trimmed, 140));
        break;
      }
    }
    if (directives.size >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW) break;
  }
  return [...directives].slice(0, MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW);
}

function collectGoModuleDependencyDirectives(lines: string[]): string[] {
  return collectGoBlockAwareDirectiveValues(lines, "require").map((value) => clampSingleLine(value, 140));
}

function collectGoWorkspaceUseDirectives(lines: string[]): string[] {
  return collectGoBlockAwareDirectiveValues(lines, "use").map((value) => clampSingleLine(value, 140));
}

function collectGoDirectiveValues(lines: string[], directive: string): string[] {
  return collectGoBlockAwareDirectiveValues(lines, directive).map((value) => clampSingleLine(value, 140));
}

function collectGoBlockAwareDirectiveValues(lines: string[], directive: string): string[] {
  const values: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = stripGoManifestComment(line);
    if (!trimmed) continue;
    if (inBlock) {
      if (trimmed === ")") {
        inBlock = false;
        continue;
      }
      values.push(trimmed);
    } else if (trimmed === `${directive} (`) {
      inBlock = true;
    } else if (trimmed.startsWith(`${directive} `)) {
      values.push(trimmed.slice(directive.length).trim());
    }
    if (values.length >= MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW) break;
  }
  return values.slice(0, MAX_GO_MODULE_MANIFEST_ITEM_PREVIEW);
}

function stripGoManifestComment(line: string): string {
  return line.replace(/\/\/.*$/g, "").trim();
}

function describeNodePackageManagerConfigFormat(filePath: string, extension: string): string {
  const name = basename(filePath).toLowerCase();
  if (extension === ".npmrc" || name.endsWith(".npmrc")) return "npm config";
  if (extension === ".yarnrc") return "Yarn classic config";
  if (extension === ".yarnrc.yml") return "Yarn Berry config";
  if (extension === ".pnpmfile.cjs") return "pnpm hook config";
  if (extension === ".npmignore") return "npm publish ignore file";
  return "Node package-manager config";
}

function collectNodePackageManagerConfigSettings(lines: string[], extension: string): string[] {
  const settings = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (extension === ".npmignore") {
      settings.add(trimmed.startsWith("!") ? "publish include override" : "publish ignore pattern");
    } else if (extension === ".pnpmfile.cjs") {
      for (const cue of ["hooks", "readPackage", "afterAllResolved", "packageExtensions", "peerDependencyRules"]) {
        if (trimmed.includes(cue)) settings.add(cue);
      }
    } else {
      const match = trimmed.match(/^([^:=\s]+)\s*[:=]\s*(.*)$/);
      if (match?.[1]) settings.add(clampSingleLine(match[1], 100));
    }
    if (settings.size >= MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW) break;
  }
  return [...settings].slice(0, MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW);
}

function collectNodePackageManagerHints(lines: string[], extension: string): string[] {
  const hints = new Set<string>();
  const raw = lines.join("\n").toLowerCase();
  if (extension === ".npmrc" || raw.includes("npm")) hints.add("npm");
  if (extension === ".yarnrc" || extension === ".yarnrc.yml" || raw.includes("yarn")) hints.add("Yarn");
  if (extension === ".pnpmfile.cjs" || raw.includes("pnpm")) hints.add("pnpm");
  if (raw.includes("registry")) hints.add("registry");
  if (raw.includes("cache") || raw.includes("store-dir")) hints.add("cache/store");
  if (raw.includes("node-linker")) hints.add("node linker");
  if (raw.includes("ignore") || extension === ".npmignore") hints.add("publish ignore");
  if (raw.includes("_authtoken") || raw.includes("auth-token") || raw.includes("password")) hints.add("credential-shaped key redacted");
  return [...hints].slice(0, MAX_NODE_PACKAGE_MANAGER_CONFIG_ITEM_PREVIEW);
}

function summarizeNodePackageDependencyMaps(record: Record<string, unknown>): string[] {
  return [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "bundledDependencies",
    "bundleDependencies",
  ]
    .map((key) => {
      const names = Array.isArray(record[key])
        ? record[key].filter((item): item is string => typeof item === "string")
        : readObjectKeys(record[key], MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
      if (names.length === 0) return "";
      return `${key} ${names.length}${names.length >= MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW ? "+" : ""} (${names.slice(0, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW).join(", ")})`;
    })
    .filter(Boolean);
}

function readNodePackageWorkspaces(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => clampSingleLine(item, 120))
      .slice(0, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
  }
  if (isRecord(value) && Array.isArray(value.packages)) {
    return value.packages
      .filter((item): item is string => typeof item === "string")
      .map((item) => clampSingleLine(item, 120))
      .slice(0, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
  }
  return [];
}

function summarizeNodePackageEntrypoints(record: Record<string, unknown>): string[] {
  const entrypoints: string[] = [];
  for (const key of ["main", "module", "types", "typings", "browser", "source", "style"]) {
    const value = readRecordString(record, key);
    if (value) entrypoints.push(`${key}: ${clampSingleLine(value, 120)}`);
  }
  if (isRecord(record.bin)) {
    const bins = readObjectKeys(record.bin, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
    if (bins.length > 0) entrypoints.push(`bin: ${bins.join(", ")}`);
  } else if (typeof record.bin === "string") {
    entrypoints.push(`bin: ${clampSingleLine(record.bin, 120)}`);
  }
  if (isRecord(record.exports)) {
    const exportsKeys = readObjectKeys(record.exports, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
    if (exportsKeys.length > 0) entrypoints.push(`exports: ${exportsKeys.join(", ")}`);
  } else if (typeof record.exports === "string") {
    entrypoints.push(`exports: ${clampSingleLine(record.exports, 120)}`);
  }
  if (isRecord(record.imports)) {
    const importsKeys = readObjectKeys(record.imports, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
    if (importsKeys.length > 0) entrypoints.push(`imports: ${importsKeys.join(", ")}`);
  }
  if (Array.isArray(record.files)) {
    const files = record.files
      .filter((item): item is string => typeof item === "string")
      .map((item) => clampSingleLine(item, 120))
      .slice(0, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
    if (files.length > 0) entrypoints.push(`files: ${files.join(", ")}`);
  }
  return entrypoints.slice(0, MAX_NODE_PACKAGE_MANIFEST_ITEM_PREVIEW);
}

function readObjectKeys(value: unknown, limit: number): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter(Boolean)
    .map((key) => clampSingleLine(key, 120))
    .slice(0, limit);
}

function detectDependencyLockfileEcosystem(name: string, extension: string): string {
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") return "npm";
  if (name === "pnpm-lock.yaml" || name === "pnpm-lock.yml") return "pnpm";
  if (name === "yarn.lock") return "Yarn";
  if (name === "cargo.lock") return "Cargo";
  if (name === "poetry.lock") return "Poetry";
  if (name === "pipfile.lock") return "Pipenv";
  if (name === "gemfile.lock") return "Bundler";
  if (name === "composer.lock") return "Composer";
  if (name === "go.sum" || extension === ".sum") return "Go module checksum";
  return "generic dependency lockfile";
}

function extractDependencyLockfilePackages(name: string, extension: string, raw: string): string[] {
  const packages = new Set<string>();
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json" || name === "composer.lock" || name === "pipfile.lock") {
    collectJsonLockfilePackages(raw, packages);
  } else if (name === "pnpm-lock.yaml" || name === "pnpm-lock.yml") {
    collectPnpmLockfilePackages(raw, packages);
  } else if (name === "yarn.lock") {
    collectYarnLockfilePackages(raw, packages);
  } else if (name === "cargo.lock" || name === "poetry.lock") {
    collectTomlLockfilePackages(raw, packages);
  } else if (name === "gemfile.lock") {
    collectGemfileLockPackages(raw, packages);
  } else if (name === "go.sum" || extension === ".sum") {
    collectGoSumPackages(raw, packages);
  } else {
    collectGenericLockfilePackages(raw, packages);
  }
  return [...packages].map((item) => clampSingleLine(item, 100));
}

function extractDependencyLockfileEdges(name: string, extension: string, raw: string): string[] {
  const edges: Array<{ from: string; to: string; kind: string }> = [];
  const seen = new Set<string>();
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
    collectPackageLockDependencyEdges(raw, edges, seen);
  } else if (name === "composer.lock") {
    collectComposerLockDependencyEdges(raw, edges, seen);
  } else if (name === "pipfile.lock") {
    collectPipfileLockDependencyEdges(raw, edges, seen);
  } else if (name === "cargo.lock" || name === "poetry.lock") {
    collectTomlLockDependencyEdges(raw, edges, seen);
  } else if (name === "yarn.lock") {
    collectYarnLockDependencyEdges(raw, edges, seen);
  } else if (name === "pnpm-lock.yaml" || name === "pnpm-lock.yml") {
    collectPnpmLockDependencyEdges(raw, edges, seen);
  } else if (name === "go.sum" || extension === ".sum") {
    collectGoSumDependencyEdges(raw, edges, seen);
  }
  return edges
    .slice(0, MAX_LOCKFILE_EDGE_PREVIEW)
    .map((edge) => `${edge.from} -> ${edge.to}${edge.kind ? ` (${edge.kind})` : ""}`);
}

function collectPackageLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return;
    if (isPlainRecord(parsed.packages)) {
      for (const [path, entry] of Object.entries(parsed.packages)) {
        if (!isPlainRecord(entry)) continue;
        const from = describePackageLockNode(path, entry);
        collectDependencyRecordEdges(edges, seen, from, entry.dependencies, "dependency");
        collectDependencyRecordEdges(edges, seen, from, entry.optionalDependencies, "optional");
        collectDependencyRecordEdges(edges, seen, from, entry.peerDependencies, "peer");
        if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
      }
    }
    if (isPlainRecord(parsed.dependencies)) {
      for (const [name, entry] of Object.entries(parsed.dependencies)) {
        addDependencyEdge(edges, seen, "(root)", name, "root dependency");
        if (isPlainRecord(entry)) collectDependencyRecordEdges(edges, seen, name, entry.dependencies, "dependency");
        if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
      }
    }
  } catch {
    return;
  }
}

function collectComposerLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return;
    const packageLists = [
      ...(Array.isArray(parsed.packages) ? parsed.packages : []),
      ...(Array.isArray(parsed["packages-dev"]) ? parsed["packages-dev"] : []),
    ];
    for (const entry of packageLists) {
      if (!isPlainRecord(entry) || typeof entry.name !== "string") continue;
      collectDependencyRecordEdges(edges, seen, entry.name, entry.require, "require");
      collectDependencyRecordEdges(edges, seen, entry.name, entry["require-dev"], "require-dev");
      if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
    }
  } catch {
    return;
  }
}

function collectPipfileLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return;
    for (const section of ["default", "develop"]) {
      const deps = isPlainRecord(parsed[section]) ? parsed[section] : {};
      for (const key of Object.keys(deps)) {
        addDependencyEdge(edges, seen, "(root)", key, section === "develop" ? "dev dependency" : "dependency");
        if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
      }
    }
  } catch {
    return;
  }
}

function collectTomlLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  for (const body of splitTomlPackageBlocks(raw)) {
    const from = body.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const dependencies = body.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1];
    if (!from || !dependencies) continue;
    for (const depMatch of dependencies.matchAll(/"([^"]+)"/g)) {
      const dep = normalizeLockfileDependencyName(depMatch[1] || "");
      if (dep) addDependencyEdge(edges, seen, from, dep, "dependency");
      if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
    }
  }
}

function collectYarnLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  const lines = raw.split(/\r?\n/);
  let current = "";
  let inDependencies = false;
  for (const line of lines) {
    if (/^[^\s#][^:]+:\s*$/.test(line)) {
      current = normalizeYarnLockPackageName(line.replace(/:\s*$/, "").split(",")[0] || "");
      inDependencies = false;
      continue;
    }
    if (!current) continue;
    if (/^\s{2}dependencies:\s*$/.test(line)) {
      inDependencies = true;
      continue;
    }
    if (inDependencies) {
      const dep = line.match(/^\s{4}"?([^"\s]+)"?\s+/)?.[1];
      if (dep) addDependencyEdge(edges, seen, current, normalizeLockfileDependencyName(dep), "dependency");
      if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
      if (/^\s{2}\S/.test(line) && !/^\s{4}/.test(line)) inDependencies = false;
    }
  }
}

function collectPnpmLockDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  const lines = raw.split(/\r?\n/);
  let current = "";
  let inDeps = false;
  for (const line of lines) {
    const packageMatch = line.match(/^\s{2}\/?((?:@[^/\s]+\/)?[^@\s:/][^@\s:]*)(?:@[^:]*)?:\s*$/);
    if (packageMatch?.[1] && !["dependencies", "devDependencies", "packages", "snapshots", "importers"].includes(packageMatch[1])) {
      current = normalizeLockfileDependencyName(packageMatch[1]);
      inDeps = false;
      continue;
    }
    if (!current) continue;
    if (/^\s{4}(?:dependencies|optionalDependencies|peerDependencies):\s*$/.test(line)) {
      inDeps = true;
      continue;
    }
    if (inDeps) {
      const dep = line.match(/^\s{6}((?:@[^/\s]+\/)?[^:\s]+):/)?.[1];
      if (dep) addDependencyEdge(edges, seen, current, normalizeLockfileDependencyName(dep), "dependency");
      if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
      if (/^\s{4}\S/.test(line) && !/^\s{6}/.test(line)) inDeps = false;
    }
  }
}

function collectGoSumDependencyEdges(
  raw: string,
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
): void {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+v[^\s]+/);
    if (match?.[1]) addDependencyEdge(edges, seen, "(module)", match[1], "checksum entry");
    if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
  }
}

function collectDependencyRecordEdges(
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
  from: string,
  value: unknown,
  kind: string,
): void {
  if (!isPlainRecord(value)) return;
  for (const to of Object.keys(value)) {
    addDependencyEdge(edges, seen, from, to, kind);
    if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
  }
}

function addDependencyEdge(
  edges: Array<{ from: string; to: string; kind: string }>,
  seen: Set<string>,
  from: string,
  to: string,
  kind: string,
): void {
  if (edges.length >= MAX_LOCKFILE_EDGE_PREVIEW) return;
  const normalizedFrom = normalizeLockfileDependencyName(from);
  const normalizedTo = normalizeLockfileDependencyName(to);
  if (!normalizedFrom || !normalizedTo) return;
  const key = `${normalizedFrom}\0${normalizedTo}\0${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from: normalizedFrom, to: normalizedTo, kind });
}

function describePackageLockNode(path: string, entry: Record<string, unknown>): string {
  if (!path) return "(root)";
  if (typeof entry.name === "string" && entry.name.trim()) return normalizeLockfileDependencyName(entry.name);
  const segments = path.split("node_modules/");
  return normalizeLockfileDependencyName(segments[segments.length - 1] || path);
}

function normalizeYarnLockPackageName(specifier: string): string {
  const cleaned = specifier.replace(/^"|"$/g, "").trim();
  const scoped = cleaned.match(/^(@[^/]+\/[^@]+)@/);
  const unscoped = cleaned.match(/^([^@]+)@/);
  return normalizeLockfileDependencyName(scoped?.[1] || unscoped?.[1] || cleaned);
}

function normalizeLockfileDependencyName(value: string): string {
  return clampSingleLine(
    value
      .replace(/^"|"$/g, "")
      .replace(/\s+\(.+\)$/, "")
      .replace(/\s+v?\d[\w.+:-]*.*$/, "")
      .trim(),
    100,
  );
}

function estimateDependencyLockfilePackageCount(
  name: string,
  extension: string,
  raw: string,
  fallbackCount: number,
): string {
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
    try {
      const parsed = JSON.parse(raw);
      if (isPlainRecord(parsed.packages)) return `${Object.keys(parsed.packages).filter(Boolean).length} package path(s) in bounded JSON`;
      if (isPlainRecord(parsed.dependencies)) return `${Object.keys(parsed.dependencies).length} top-level dependency entr${Object.keys(parsed.dependencies).length === 1 ? "y" : "ies"} in bounded JSON`;
    } catch {
      return "JSON parse failed in bounded preview";
    }
  }
  if (name === "composer.lock") {
    try {
      const parsed = JSON.parse(raw);
      const regular = Array.isArray((parsed as { packages?: unknown }).packages) ? (parsed as { packages: unknown[] }).packages.length : 0;
      const dev = Array.isArray((parsed as { ["packages-dev"]?: unknown })["packages-dev"]) ? ((parsed as { ["packages-dev"]: unknown[] })["packages-dev"]).length : 0;
      return `${regular + dev} Composer package entr${regular + dev === 1 ? "y" : "ies"} in bounded JSON`;
    } catch {
      return "JSON parse failed in bounded preview";
    }
  }
  if (name === "pipfile.lock") {
    try {
      const parsed = JSON.parse(raw);
      const record = isPlainRecord(parsed) ? parsed : {};
      const defaultDeps = isPlainRecord(record.default) ? Object.keys(record.default).length : 0;
      const developDeps = isPlainRecord(record.develop) ? Object.keys(record.develop).length : 0;
      return `${defaultDeps + developDeps} Pipenv dependency entr${defaultDeps + developDeps === 1 ? "y" : "ies"} in bounded JSON`;
    } catch {
      return "JSON parse failed in bounded preview";
    }
  }
  const patterns: Record<string, RegExp> = {
    "pnpm-lock.yaml": /^\s{2}(?:\/|[A-Za-z0-9_@/.-]+:)/gm,
    "pnpm-lock.yml": /^\s{2}(?:\/|[A-Za-z0-9_@/.-]+:)/gm,
    "yarn.lock": /^[^#\s][^:]+:\s*$/gm,
    "cargo.lock": /^\[\[package\]\]/gm,
    "poetry.lock": /^\[\[package\]\]/gm,
    "gemfile.lock": /^\s{4}[A-Za-z0-9_.-]+ \([^)]+\)/gm,
    "go.sum": /^[^\s]+\s+v[^\s]+/gm,
  };
  const pattern = patterns[name] || (extension === ".sum" ? patterns["go.sum"] : undefined);
  const matches = pattern ? raw.match(pattern) : null;
  if (matches?.length) return `${matches.length} candidate entr${matches.length === 1 ? "y" : "ies"} in bounded preview`;
  return fallbackCount > 0 ? `${fallbackCount} sample entr${fallbackCount === 1 ? "y" : "ies"} in bounded preview` : "none detected in bounded preview";
}

function collectJsonLockfilePackages(raw: string, packages: Set<string>): void {
  try {
    const parsed = JSON.parse(raw);
    if (isPlainRecord(parsed.packages)) {
      for (const key of Object.keys(parsed.packages)) {
        const cleaned = key.replace(/^node_modules\//, "").trim();
        if (cleaned) packages.add(cleaned);
        if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) return;
      }
    }
    if (isPlainRecord(parsed.dependencies)) {
      for (const key of Object.keys(parsed.dependencies)) {
        packages.add(key);
        if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) return;
      }
    }
    const composerPackages = [
      ...(Array.isArray(parsed.packages) ? parsed.packages : []),
      ...(Array.isArray(parsed["packages-dev"]) ? parsed["packages-dev"] : []),
    ];
    for (const entry of composerPackages) {
      if (isPlainRecord(entry) && typeof entry.name === "string") packages.add(entry.name);
      if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) return;
    }
    for (const section of ["default", "develop"]) {
      const deps = isPlainRecord(parsed[section]) ? parsed[section] : {};
      for (const key of Object.keys(deps)) {
        packages.add(key);
        if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) return;
      }
    }
  } catch {
    collectGenericLockfilePackages(raw, packages);
  }
}

function collectPnpmLockfilePackages(raw: string, packages: Set<string>): void {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s{2}(?:\/)?((?:@[^/\s]+\/)?[^@\s:/][^@\s:]*)(?:@|:)/);
    if (match?.[1] && !["dependencies", "devDependencies", "packages", "snapshots", "importers"].includes(match[1])) {
      packages.add(match[1]);
    }
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function collectYarnLockfilePackages(raw: string, packages: Set<string>): void {
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s|^#|^$/.test(line) || !line.includes("@")) continue;
    const firstSpec = line.split(",")[0]?.replace(/^"|"?:\s*$/g, "").replace(/:$/, "").trim();
    const scoped = firstSpec?.match(/^(@[^/]+\/[^@]+)@/);
    const unscoped = firstSpec?.match(/^([^@]+)@/);
    const name = scoped?.[1] || unscoped?.[1];
    if (name) packages.add(name);
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function collectTomlLockfilePackages(raw: string, packages: Set<string>): void {
  for (const match of raw.matchAll(/^\s*name\s*=\s*"([^"]+)"/gm)) {
    packages.add(match[1]);
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function collectGemfileLockPackages(raw: string, packages: Set<string>): void {
  for (const match of raw.matchAll(/^\s{4}([A-Za-z0-9_.-]+)\s+\([^)]+\)/gm)) {
    packages.add(match[1]);
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function collectGoSumPackages(raw: string, packages: Set<string>): void {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+v[^\s]+/);
    if (match?.[1]) packages.add(match[1]);
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function collectGenericLockfilePackages(raw: string, packages: Set<string>): void {
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:name\s*[:=]\s*|["']?name["']?\s*:\s*["'])([A-Za-z0-9_@/.-]+)/);
    if (match?.[1]) packages.add(match[1].replace(/["',]+$/g, ""));
    if (packages.size >= MAX_LOCKFILE_PACKAGE_PREVIEW) break;
  }
}

function summarizeConfigOrLogFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_CONFIG_LOG_PREVIEW_BYTES, MAX_TEXT_BYTES * 16),
    ).toString("utf8");
    if (extension === ".log") return summarizeLogText(raw, size);
    if (extension === ".xml") return summarizeXmlConfigText(filePath, raw, size);
    return summarizeConfigText(filePath, raw, extension, size);
  } catch {
    return [
      `Configuration/log file ready for explicit attachment (${formatBytes(size)}).`,
      "No command execution, environment loading, secret lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeConfigText(filePath: string, raw: string, extension: string, size: number): string {
  const normalized = normalizeTextPreview(raw);
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  const sections = extractConfigSections(lines, extension);
  const keys = extractConfigKeys(lines, extension).slice(0, MAX_CONFIG_KEYS_PREVIEW);
  const schemaHints = summarizeLocalConfigSchemaHints(filePath, normalized, extension);
  const ciWorkflowHints = summarizeCiWorkflowFileHints(filePath, normalized, extension);
  const sample = lines
    .filter((line) => !/^\s*[#;]/.test(line))
    .slice(0, 10)
    .map(maskPotentialSecretValues)
    .join("\n");
  return [
    `Configuration file preview (${formatBytes(size)}).`,
    sections.length > 0 ? `Sections: ${sections.join(", ")}` : "Sections: none detected in the bounded preview.",
    keys.length > 0 ? `Keys (${keys.length}${keys.length >= MAX_CONFIG_KEYS_PREVIEW ? "+" : ""}): ${keys.join(", ")}` : "Keys: none detected in the bounded preview.",
    schemaHints,
    ciWorkflowHints,
    sample || "No readable configuration lines were found.",
    "Ready for explicit attachment after visible review; no command execution, environment loading, secret lookup, network call, or provider send was performed.",
  ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeXmlConfigText(filePath: string, raw: string, size: number): string {
  const normalized = normalizeTextPreview(raw);
  const root = normalized.match(/<([A-Za-z_][\w:.-]*)\b[^>]*>/)?.[1] || "";
  const elements = [...normalized.matchAll(/<([A-Za-z_][\w:.-]*)\b[^>/]*>/g)]
    .map((match) => match[1] || "")
    .filter((name) => name && !name.startsWith("?") && !name.startsWith("!"));
  const uniqueElements = [...new Set(elements)].slice(0, MAX_CONFIG_KEYS_PREVIEW);
  const text = decodeXmlEntities(normalized.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return [
    `XML configuration preview (${formatBytes(size)}).`,
    root ? `Root element: ${root}` : "Root element: none detected in the bounded preview.",
    uniqueElements.length > 0 ? `Elements: ${uniqueElements.join(", ")}` : "Elements: none detected in the bounded preview.",
    summarizeLocalConfigSchemaHints(filePath, normalized, ".xml"),
    text ? `Text preview: ${maskPotentialSecretValues(text).slice(0, 1200)}` : "No readable XML text nodes were found.",
    "Ready for explicit attachment after visible review; no XML entity expansion, script execution, network call, external schema lookup, or provider send was performed.",
  ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeLogText(raw: string, size: number): string {
  const normalized = normalizeTextPreview(raw);
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  const counts = {
    error: lines.filter((line) => /\b(error|fatal|panic|exception)\b/i.test(line)).length,
    warn: lines.filter((line) => /\b(warn|warning)\b/i.test(line)).length,
  };
  const firstLines = lines.slice(0, Math.ceil(MAX_LOG_PREVIEW_LINES / 2));
  const lastLines = lines.slice(Math.max(firstLines.length, lines.length - Math.floor(MAX_LOG_PREVIEW_LINES / 2)));
  const preview = [...firstLines, ...(lastLines.length > 0 ? ["..."] : []), ...lastLines]
    .map(maskPotentialSecretValues)
    .join("\n");
  return [
    `Log file preview (${formatBytes(size)}).`,
    `Detected lines in bounded preview: ${lines.length}; errors/fatal/exceptions: ${counts.error}; warnings: ${counts.warn}.`,
    preview || "No readable log lines were found.",
    "Ready for explicit attachment after visible review; no log command execution, tailing process, network call, secret lookup, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function summarizeStylesheetFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_STYLESHEET_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const stripped = stripStylesheetComments(normalized);
    const lines = stripped.split("\n").map((line) => line.trim()).filter(Boolean);
    const selectors = collectStylesheetSelectors(lines);
    const atRules = collectStylesheetAtRules(lines);
    const customProperties = collectStylesheetCustomProperties(lines);
    const assetReferences = collectStylesheetAssetReferences(stripped);
    const sample = lines
      .filter((line) => !line.startsWith("@charset"))
      .slice(0, 12)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Stylesheet preview (${describeStylesheetFormat(extension)}, ${formatBytes(size)}).`,
      `Lines in bounded preview: ${normalized.split("\n").length}; non-empty style lines: ${lines.length}.`,
      selectors.length > 0
        ? `Selectors (${selectors.length}${selectors.length >= MAX_STYLESHEET_ITEM_PREVIEW ? "+" : ""}): ${selectors.join(" | ")}.`
        : "Selectors: none detected in the bounded preview.",
      atRules.length > 0
        ? `At-rules (${atRules.length}${atRules.length >= MAX_STYLESHEET_ITEM_PREVIEW ? "+" : ""}): ${atRules.join(" | ")}.`
        : "At-rules: none detected in the bounded preview.",
      customProperties.length > 0
        ? `Custom properties (${customProperties.length}${customProperties.length >= MAX_STYLESHEET_ITEM_PREVIEW ? "+" : ""}): ${customProperties.join(", ")}.`
        : "Custom properties: none detected in the bounded preview.",
      assetReferences.length > 0
        ? `Local asset references (${assetReferences.length}${assetReferences.length >= MAX_STYLESHEET_ITEM_PREVIEW ? "+" : ""}): ${assetReferences.join(", ")}.`
        : "Local asset references: none detected in the bounded preview.",
      normalized.length >= MAX_STYLESHEET_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_STYLESHEET_PREVIEW_BYTES)}.` : "",
      sample || "No readable stylesheet lines were found.",
      "Ready for explicit attachment after visible review; stylesheet metadata was parsed from bounded workspace-local text only, with no Sass/Less/PostCSS compiler, browser renderer, CSSOM construction, asset fetch, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Stylesheet file ready for explicit attachment (${formatBytes(size)}).`,
      "Stylesheet preview read bounded local text only; no Sass/Less/PostCSS compiler, browser renderer, CSSOM construction, asset fetch, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function splitTomlPackageBlocks(raw: string): string[] {
  return raw
    .split(/^\s*\[\[package\]\]\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);
}

function describeStylesheetFormat(extension: string): string {
  return (
    {
      ".css": "CSS",
      ".scss": "SCSS",
      ".sass": "Sass",
      ".less": "Less",
    }[extension] ?? "stylesheet"
  );
}

function stripStylesheetComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collectStylesheetSelectors(lines: string[]): string[] {
  const selectors = new Set<string>();
  for (const line of lines) {
    if (!line.includes("{") || line.trim().startsWith("@")) continue;
    const selector = line.split("{")[0]?.trim();
    if (!selector || selector.startsWith("$") || selector.startsWith("@")) continue;
    selectors.add(clampSingleLine(selector.replace(/\s+/g, " "), 140));
    if (selectors.size >= MAX_STYLESHEET_ITEM_PREVIEW) break;
  }
  return [...selectors].slice(0, MAX_STYLESHEET_ITEM_PREVIEW);
}

function collectStylesheetAtRules(lines: string[]): string[] {
  const atRules = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^@([A-Za-z-]+)\b\s*([^;{]*)/);
    if (!match?.[1]) continue;
    const rule = match[2]?.trim() ? `@${match[1]} ${match[2].trim()}` : `@${match[1]}`;
    atRules.add(clampSingleLine(rule, 140));
    if (atRules.size >= MAX_STYLESHEET_ITEM_PREVIEW) break;
  }
  return [...atRules].slice(0, MAX_STYLESHEET_ITEM_PREVIEW);
}

function collectStylesheetCustomProperties(lines: string[]): string[] {
  const properties = new Set<string>();
  for (const line of lines) {
    const match = line.match(/(--[A-Za-z0-9_-]+)\s*:/);
    if (match?.[1]) properties.add(clampSingleLine(match[1], 100));
    if (properties.size >= MAX_STYLESHEET_ITEM_PREVIEW) break;
  }
  return [...properties].slice(0, MAX_STYLESHEET_ITEM_PREVIEW);
}

function collectStylesheetAssetReferences(raw: string): string[] {
  const references = new Set<string>();
  for (const match of raw.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const value = (match[1] || "").trim();
    if (!value || /^(?:data:|https?:|file:|blob:)/i.test(value)) continue;
    references.add(clampSingleLine(maskPotentialSecretValues(value), 120));
    if (references.size >= MAX_STYLESHEET_ITEM_PREVIEW) break;
  }
  return [...references].slice(0, MAX_STYLESHEET_ITEM_PREVIEW);
}

function summarizeSourceCodeFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_SOURCE_CODE_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const lines = normalized.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const language = describeSourceCodeLanguage(extension);
    const imports = extractSourceCodeImports(nonEmptyLines, extension);
    const symbols = extractSourceCodeSymbols(nonEmptyLines, extension);
    const codeInsights = summarizeSourceCodeInsightHints(nonEmptyLines, extension);
    const reviewHints = summarizeSourceCodeReviewHints(nonEmptyLines);
    const sample = nonEmptyLines
      .slice(0, 14)
      .map(maskPotentialSecretValues)
      .join("\n");
    return [
      `Source code preview (${language}, ${formatBytes(size)}).`,
      `Lines in bounded preview: ${lines.length}; non-empty: ${nonEmptyLines.length}.`,
      imports.length > 0 ? `Imports/includes: ${imports.join(", ")}` : "Imports/includes: none detected in the bounded preview.",
      symbols.length > 0 ? `Symbols: ${symbols.join(", ")}` : "Symbols: none detected in the bounded preview.",
      codeInsights,
      reviewHints,
      sample || "No readable source lines were found.",
      "Ready for explicit attachment after visible review; no code execution, dependency install, build, test run, project configuration loading, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Source code file ready for explicit attachment (${formatBytes(size)}).`,
      "No code execution, dependency install, build, test run, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function describeSourceCodeLanguage(extension: string): string {
  return (
    {
      ".bat": "Windows batch",
      ".bash": "Bash",
      ".c": "C",
      ".cc": "C++",
      ".cjs": "CommonJS",
      ".cpp": "C++",
      ".cs": "C#",
      ".css": "CSS",
      ".dart": "Dart",
      ".go": "Go",
      ".h": "C/C++ header",
      ".hpp": "C++ header",
      ".java": "Java",
      ".js": "JavaScript",
      ".jsx": "React JSX",
      ".kt": "Kotlin",
      ".kts": "Kotlin script",
      ".less": "Less",
      ".lua": "Lua",
      ".m": "Objective-C",
      ".mm": "Objective-C++",
      ".mjs": "JavaScript module",
      ".php": "PHP",
      ".ps1": "PowerShell",
      ".psd1": "PowerShell data",
      ".psm1": "PowerShell module",
      ".py": "Python",
      ".rb": "Ruby",
      ".r": "R",
      ".rs": "Rust",
      ".scala": "Scala",
      ".scss": "SCSS",
      ".sh": "Shell",
      ".swift": "Swift",
      ".ts": "TypeScript",
      ".tsx": "React TSX",
      ".zsh": "Zsh",
    }[extension] ?? "source code"
  );
}

function extractSourceCodeImports(lines: string[], extension: string): string[] {
  const imports = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const candidates = [
      trimmed.match(/^import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/),
      trimmed.match(/^export\s+.+?\s+from\s+["']([^"']+)["']/),
      trimmed.match(/^const\s+\w+\s*=\s*require\(["']([^"']+)["']\)/),
      trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+/),
      trimmed.match(/^import\s+([A-Za-z0-9_.]+)/),
      trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/),
      trimmed.match(/^use\s+([A-Za-z0-9_:]+)::?/),
      trimmed.match(/^using\s+([A-Za-z0-9_.]+);/),
      trimmed.match(/^import\s+([A-Za-z0-9_.*/{}-]+)/),
      trimmed.match(/^library\s+([A-Za-z0-9_.]+)/),
      trimmed.match(/^part\s+["']([^"']+)["']/),
      trimmed.match(/^require(?:_once)?\s*\(?["']([^"']+)["']\)?/),
      trimmed.match(/^require_relative\s+["']([^"']+)["']/),
      trimmed.match(/^require\s+["']([^"']+)["']/),
      trimmed.match(/^include(?:_once)?\s*\(?["']([^"']+)["']\)?/),
      trimmed.match(/^source\(["']([^"']+)["']\)/),
      trimmed.match(/^require\(["']([^"']+)["']\)/),
      trimmed.match(/^use\s+([A-Za-z_\\][A-Za-z0-9_\\]*)/),
      trimmed.match(/^package\s+([A-Za-z0-9_.]+)/),
    ];
    for (const match of candidates) {
      if (match?.[1]) imports.add(clampSingleLine(match[1], 80));
    }
    if (extension === ".css" || extension === ".scss" || extension === ".less") {
      const cssImport = trimmed.match(/^@import\s+(?:url\()?["']?([^"')]+)["']?\)?/);
      if (cssImport?.[1]) imports.add(clampSingleLine(cssImport[1], 80));
    }
    if ([".ps1", ".psm1", ".psd1"].includes(extension)) {
      const moduleMatch = trimmed.match(/^(?:using\s+module|Import-Module)\s+["']?([^"'\s;]+)["']?/i);
      if (moduleMatch?.[1]) imports.add(clampSingleLine(moduleMatch[1], 80));
    }
    if ([".sh", ".bash", ".zsh"].includes(extension)) {
      const sourceMatch = trimmed.match(/^(?:source|\.)\s+["']?([^"'\s;]+)["']?/);
      if (sourceMatch?.[1]) imports.add(clampSingleLine(sourceMatch[1], 80));
    }
    if (extension === ".bat" || extension === ".cmd") {
      const callMatch = trimmed.match(/^(?:call|start)\s+["']?([^"'\s]+(?:\.bat|\.cmd))["']?/i);
      if (callMatch?.[1]) imports.add(clampSingleLine(callMatch[1], 80));
    }
    if (imports.size >= MAX_SOURCE_CODE_SYMBOLS) break;
  }
  return [...imports];
}

function extractSourceCodeSymbols(lines: string[], extension: string): string[] {
  const symbols = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const candidates = [
      trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/),
      trimmed.match(/^(?:export\s+)?(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/),
      trimmed.match(/^def\s+([A-Za-z_][\w]*)\s*\(/),
      trimmed.match(/^class\s+([A-Za-z_][\w]*)\s*[:(]/),
      trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/),
      trimmed.match(/^(?:public|private|protected|internal|static|\s)+\s*(?:class|interface|enum|record)\s+([A-Za-z_][\w]*)/),
      trimmed.match(/^(?:public|private|protected|internal|open|final|sealed|data|abstract|\s)+\s*(?:class|interface|object|enum\s+class|struct|actor|protocol|extension)\s+([A-Za-z_][\w]*)/),
      trimmed.match(/^(?:public|private|protected|internal|static|open|override|suspend|async|\s)*fun\s+([A-Za-z_][\w]*)\s*\(/),
      trimmed.match(/^(?:public|private|fileprivate|internal|open|static|class|mutating|\s)*func\s+([A-Za-z_][\w]*)\s*\(/),
      trimmed.match(/^(?:func|type)\s+([A-Za-z_][\w]*)/),
      trimmed.match(/^class\s+([A-Za-z_][\w]*)\b/),
      trimmed.match(/^module\s+([A-Za-z_][\w:]*)\b/),
      trimmed.match(/^(?:function\s+)?([A-Za-z_][\w]*)\s*<-\s*function\s*\(/),
      trimmed.match(/^function\s+([A-Za-z_][\w]*)\s*\(/),
      trimmed.match(/^([.#]?[A-Za-z0-9_-]+)\s*\{/),
    ];
    for (const match of candidates) {
      if (match?.[1]) symbols.add(clampSingleLine(match[1], 80));
    }
    if (symbols.size >= MAX_SOURCE_CODE_SYMBOLS) break;
  }
  if ([".sh", ".bash", ".zsh", ".ps1", ".psm1"].includes(extension)) {
    for (const line of lines) {
      const shellFunction = line.trim().match(/^(?:function\s+)?([A-Za-z_][\w-]*)\s*(?:\(\))?\s*\{/);
      if (shellFunction?.[1]) symbols.add(clampSingleLine(shellFunction[1], 80));
      if (symbols.size >= MAX_SOURCE_CODE_SYMBOLS) break;
    }
  }
  if (extension === ".bat" || extension === ".cmd") {
    for (const line of lines) {
      const label = line.trim().match(/^:([A-Za-z_][\w.-]*)/);
      if (label?.[1] && label[1].toLowerCase() !== "eof") symbols.add(clampSingleLine(label[1], 80));
      if (symbols.size >= MAX_SOURCE_CODE_SYMBOLS) break;
    }
  }
  return [...symbols];
}

function summarizeSourceCodeInsightHints(lines: string[], extension: string): string {
  const entryPointCount = lines.filter((line) => isSourceCodeEntryPoint(line, extension)).length;
  const testCueCount = lines.filter((line) => isSourceCodeTestCue(line, extension)).length;
  const branchCount = lines.filter((line) =>
    /\b(if|else\s+if|elif|for|foreach|while|switch|case|catch|except|match|try)\b|&&|\|\||\?/.test(line),
  ).length;
  const asyncCount = lines.filter((line) =>
    /\b(async|await|Promise|Task<|Thread|spawn|tokio::|go\s+func|goroutine|channel)\b/.test(line),
  ).length;
  const ioBoundaryCount = lines.filter((line) =>
    /\b(fetch|axios|http|https|readFile|writeFile|createReadStream|openSync|subprocess|exec|spawn|Start-Process|Invoke-Command|Invoke-Expression|Get-Content|Set-Content|File|Path|fs\.|sql|query|connect|request)\b/i.test(line),
  ).length;
  const cues = collectSourceCodeInsightCues(lines, extension);
  const metrics = [
    `entry points: ${entryPointCount}`,
    `test hooks: ${testCueCount}`,
    `branching/control-flow lines: ${branchCount}`,
    `async/concurrency lines: ${asyncCount}`,
    `I/O boundary lines: ${ioBoundaryCount}`,
  ];
  const cueText =
    cues.length > 0
      ? ` Review cues: ${cues.join(", ")}.`
      : " Review cues: none detected in the bounded preview.";
  return `Local static code insights: ${metrics.join("; ")}.${cueText}`;
}

function isSourceCodeEntryPoint(line: string, extension: string): boolean {
  const trimmed = line.trim();
  if (extension === ".py") return /^if\s+__name__\s*==\s*["']__main__["']/.test(trimmed);
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(extension)) {
    return /\b(createRoot|render|listen|main)\s*\(/.test(trimmed) || /^export\s+default\s+/.test(trimmed);
  }
  if ([".go", ".rs", ".c", ".cc", ".cpp", ".cs", ".java"].includes(extension)) {
    return /\b(main|Main)\s*\(/.test(trimmed);
  }
  if ([".kt", ".kts", ".swift", ".scala", ".dart", ".lua", ".php", ".r", ".m", ".mm"].includes(extension)) {
    return /\b(main|UIApplicationMain|NSApplicationMain|runApp)\s*\(/.test(trimmed) ||
      /^if\s+__name__\s*==\s*["']__main__["']/.test(trimmed);
  }
  if ([".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat", ".cmd"].includes(extension)) {
    return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.toLowerCase().startsWith("rem ");
  }
  return false;
}

function isSourceCodeTestCue(line: string, extension: string): boolean {
  const trimmed = line.trim();
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(extension)) {
    return /\b(describe|it|test|expect|beforeEach|afterEach)\s*\(/.test(trimmed);
  }
  if (extension === ".py") return /\b(pytest|unittest|assert|TestCase)\b|^def\s+test_/.test(trimmed);
  if (extension === ".rs") return /#\[test\]|\bassert(_eq|_ne)?!\s*\(/.test(trimmed);
  if (extension === ".go") return /\btesting\.T\b|^func\s+Test[A-Z]/.test(trimmed);
  if (extension === ".java" || extension === ".cs") return /@(Test|Fact|Theory)\b|\bAssert\./.test(trimmed);
  if ([".kt", ".kts", ".scala"].includes(extension)) return /@(Test|ParameterizedTest)\b|\b(assertEquals|assertTrue|shouldBe)\s*\(/.test(trimmed);
  if (extension === ".swift") return /\bXCTestCase\b|\bXCTAssert\w*\s*\(|^func\s+test[A-Z_]/.test(trimmed);
  if (extension === ".dart") return /\b(testWidgets|test|expect)\s*\(/.test(trimmed);
  if (extension === ".php") return /\bPHPUnit\b|\bassert\w*\s*\(|^public\s+function\s+test[A-Z_]/.test(trimmed);
  if (extension === ".rb") return /\b(RSpec|describe|it|expect)\b|^def\s+test_/.test(trimmed);
  if (extension === ".lua") return /\b(assert|describe|it)\s*\(/.test(trimmed);
  if (extension === ".r") return /\b(test_that|expect_)\s*\(/.test(trimmed);
  return /\b(assert|expect)\b/.test(trimmed);
}

function collectSourceCodeInsightCues(lines: string[], extension: string): string[] {
  const cues = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (isSourceCodeEntryPoint(trimmed, extension)) cues.add("entry-point candidate");
    if (isSourceCodeTestCue(trimmed, extension)) cues.add("test-discovery candidate");
    if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) cues.add("maintenance marker");
    if (/\b(fetch|axios|http|https|request)\b/i.test(trimmed)) cues.add("network boundary");
    if (/\b(readFile|writeFile|createReadStream|openSync|File|Path|fs\.|Get-Content|Set-Content|Copy-Item|Move-Item|Remove-Item)\b/i.test(trimmed)) cues.add("filesystem boundary");
    if (/\b(Start-Process|Invoke-Expression|Invoke-Command|cmd\.exe|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash|sh\s+-c)\b/i.test(trimmed)) cues.add("process boundary");
    if (/\b(system|exec|shell_exec|proc_open|Runtime\.getRuntime|ProcessBuilder|NSTask|Process|subprocess)\b/i.test(trimmed)) cues.add("process boundary");
    if (/\b(sql|query|connect)\b/i.test(trimmed)) cues.add("database boundary");
    if (/\b(async|await|Promise|Task<|Thread|spawn|tokio::|go\s+func)\b/.test(trimmed)) cues.add("async/concurrency");
    if (cues.size >= MAX_SOURCE_CODE_INSIGHT_CUES) break;
  }
  return [...cues];
}

function summarizeSourceCodeReviewHints(lines: string[]): string {
  const todoCount = lines.filter((line) => /\b(TODO|FIXME|HACK|XXX)\b/i.test(line)).length;
  const possibleSecretCount = lines.filter((line) =>
    /\b(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)\b/i.test(line),
  ).length;
  const longLineCount = lines.filter((line) => line.length > 160).length;
  const hints = [
    todoCount > 0 ? `${todoCount} TODO/FIXME/HACK marker(s)` : "",
    possibleSecretCount > 0 ? `${possibleSecretCount} likely secret-bearing line(s) masked in preview where key/value patterns are visible` : "",
    longLineCount > 0 ? `${longLineCount} long line(s) over 160 characters` : "",
  ].filter(Boolean);
  return hints.length > 0
    ? `Static review hints: ${hints.join("; ")}.`
    : "Static review hints: no TODO/FIXME markers, obvious secret keys, or very long lines detected in the bounded preview.";
}

function isPowerShellScriptExtension(extension: string): boolean {
  return [".ps1", ".psm1", ".psd1"].includes(extension);
}

function isBatchScriptExtension(extension: string): boolean {
  return [".bat", ".cmd"].includes(extension);
}

function summarizeBatchScriptFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_BATCH_SCRIPT_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const lines = normalized.split("\n");
    const preview = parseBatchScriptPreview(lines);
    const sample = preview.sampleLines.length > 0
      ? `Bounded text sample:\n${preview.sampleLines.join("\n")}`
      : "Bounded text sample: no readable batch script lines were found.";
    return [
      `Windows batch script preview (${describeSourceCodeLanguage(extension)}, ${formatBytes(size)}).`,
      preview.labels.length > 0
        ? `Labels (${preview.labels.length}${preview.labels.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.labels.join(", ")}.`
        : "Labels: none detected in the bounded preview.",
      preview.variables.length > 0
        ? `Environment variable assignments (${preview.variables.length}${preview.variables.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.variables.join(", ")}.`
        : "Environment variable assignments: none detected in the bounded preview.",
      preview.calls.length > 0
        ? `CALL/START targets (${preview.calls.length}${preview.calls.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.calls.join(", ")}.`
        : "CALL/START targets: none detected in the bounded preview.",
      preview.commands.length > 0
        ? `Command hints (${preview.commands.length}${preview.commands.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.commands.join(", ")}.`
        : "Command hints: none detected in the bounded preview.",
      preview.riskCues.length > 0
        ? `Risk cues (${preview.riskCues.length}${preview.riskCues.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.riskCues.join(", ")}.`
        : "Risk cues: none detected in the bounded preview.",
      preview.comments.length > 0
        ? `Comment hints (${preview.comments.length}${preview.comments.length >= MAX_BATCH_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.comments.join(" | ")}.`
        : "Comment hints: none detected in the bounded preview.",
      sample,
      raw.length >= MAX_BATCH_SCRIPT_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_BATCH_SCRIPT_PREVIEW_BYTES)} or item limits.`
        : "",
      "Ready for explicit attachment after visible review; batch metadata was parsed from bounded workspace-local text only, secret-shaped values were masked, and no cmd.exe process, batch script execution, environment expansion, command dispatch, filesystem mutation, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows batch script ready for explicit attachment (${formatBytes(size)}).`,
      "Batch preview could not read bounded local text; no cmd.exe process, batch script execution, environment expansion, command dispatch, filesystem mutation, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseBatchScriptPreview(lines: string[]): {
  labels: string[];
  variables: string[];
  calls: string[];
  commands: string[];
  riskCues: string[];
  comments: string[];
  sampleLines: string[];
} {
  const labels = new Set<string>();
  const variables = new Set<string>();
  const calls = new Set<string>();
  const commands = new Set<string>();
  const riskCues = new Set<string>();
  const comments = new Set<string>();
  const sampleLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const commandLine = trimmed.replace(/^@+/, "").trim();
    const lower = commandLine.toLowerCase();

    if (lower.startsWith("rem ") || commandLine.startsWith("::")) {
      if (comments.size < MAX_BATCH_SCRIPT_ITEM_PREVIEW) {
        comments.add(clampSingleLine(maskPotentialSecretValues(commandLine.replace(/^(?:rem\s+|::)/i, "").trim()), 140));
      }
      continue;
    }

    const labelMatch = commandLine.match(/^:([A-Za-z_][\w.-]*)\b/);
    if (labelMatch?.[1] && labelMatch[1].toLowerCase() !== "eof" && labels.size < MAX_BATCH_SCRIPT_ITEM_PREVIEW) {
      labels.add(clampSingleLine(labelMatch[1], 100));
    }

    if (sampleLines.length < 10) {
      sampleLines.push(clampSingleLine(maskPotentialSecretValues(commandLine), 220));
    }

    const variableMatch = commandLine.match(/^set(?:local)?(?:\s+\/[AP])?\s+["']?([A-Za-z_][\w.-]*)\s*=/i);
    if (variableMatch?.[1] && variables.size < MAX_BATCH_SCRIPT_ITEM_PREVIEW) {
      variables.add(clampSingleLine(variableMatch[1], 100));
    }

    collectBatchCallTarget(commandLine, calls);
    collectBatchCommandHint(commandLine, commands);
    collectBatchRiskCues(commandLine, riskCues);
  }

  return {
    labels: [...labels],
    variables: [...variables],
    calls: [...calls],
    commands: [...commands],
    riskCues: [...riskCues],
    comments: [...comments],
    sampleLines,
  };
}

function collectBatchCallTarget(line: string, calls: Set<string>): void {
  if (calls.size >= MAX_BATCH_SCRIPT_ITEM_PREVIEW) return;
  const callMatch = line.match(/^(?:call|start)\s+(?:"[^"]*"\s+)?["']?([^"'\s&|<>]+)["']?/i);
  const target = callMatch?.[1] || "";
  if (!target || /^(?:\/[a-z]+|cmd|cmd\.exe)$/i.test(target)) return;
  calls.add(clampSingleLine(maskPotentialSecretValues(target), 140));
}

function collectBatchCommandHint(line: string, commands: Set<string>): void {
  if (commands.size >= MAX_BATCH_SCRIPT_ITEM_PREVIEW) return;
  const commandMatch = line.match(/^(?:if|for)\b.*?\b(?:do\s+)?([A-Za-z][\w.-]*)\b/i) || line.match(/^([A-Za-z][\w.-]*)\b/);
  const command = commandMatch?.[1] || "";
  if (!command || ["echo", "else", "not", "exist", "defined"].includes(command.toLowerCase())) return;
  commands.add(clampSingleLine(command, 80));
}

function collectBatchRiskCues(line: string, riskCues: Set<string>): void {
  if (/\b(?:curl|wget|bitsadmin|certutil|Invoke-WebRequest|iwr|irm)\b/i.test(line)) riskCues.add("network download/request");
  if (/\b(?:start|call|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|wscript|cscript|msiexec|rundll32|regsvr32)\b/i.test(line)) riskCues.add("process launch/dispatch");
  if (/\b(?:del|erase|rd|rmdir|move|copy|xcopy|robocopy)\b/i.test(line)) riskCues.add("filesystem mutation");
  if (/\b(?:reg|sc|schtasks|netsh|net\s+use)\b/i.test(line)) riskCues.add("system configuration");
  if (/\b(?:runas|takeown|icacls|attrib)\b/i.test(line)) riskCues.add("permission or attribute change");
  if (/%[A-Za-z_][\w.-]*%|![A-Za-z_][\w.-]*!/.test(line)) riskCues.add("environment-variable expansion");
}

function summarizePowerShellScriptFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_POWERSHELL_SCRIPT_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const normalized = normalizeTextPreview(raw);
    const lines = normalized.split("\n");
    const preview = parsePowerShellScriptPreview(lines, extension);
    const sample = preview.sampleLines.length > 0
      ? `Bounded text sample:\n${preview.sampleLines.join("\n")}`
      : "Bounded text sample: no readable script lines were found.";
    return [
      `PowerShell script preview (${describeSourceCodeLanguage(extension)}, ${formatBytes(size)}).`,
      preview.helpSections.length > 0
        ? `Comment help sections: ${preview.helpSections.join(", ")}.`
        : "Comment help sections: none detected in the bounded preview.",
      preview.functions.length > 0
        ? `Functions (${preview.functions.length}${preview.functions.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.functions.join(", ")}.`
        : "Functions: none detected in the bounded preview.",
      preview.parameters.length > 0
        ? `Parameters (${preview.parameters.length}${preview.parameters.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.parameters.join(", ")}.`
        : "Parameters: none detected in the bounded preview.",
      preview.imports.length > 0
        ? `Module/assembly imports (${preview.imports.length}${preview.imports.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.imports.join(", ")}.`
        : "Module/assembly imports: none detected in the bounded preview.",
      preview.commands.length > 0
        ? `Command hints (${preview.commands.length}${preview.commands.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.commands.join(", ")}.`
        : "Command hints: none detected in the bounded preview.",
      preview.riskCues.length > 0
        ? `Risk cues (${preview.riskCues.length}${preview.riskCues.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.riskCues.join(", ")}.`
        : "Risk cues: none detected in the bounded preview.",
      preview.manifestKeys.length > 0
        ? `Manifest keys (${preview.manifestKeys.length}${preview.manifestKeys.length >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW ? "+" : ""}): ${preview.manifestKeys.join(", ")}.`
        : "",
      sample,
      raw.length >= MAX_POWERSHELL_SCRIPT_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_POWERSHELL_SCRIPT_PREVIEW_BYTES)} or item limits.`
        : "",
      "Ready for explicit attachment after visible review; PowerShell metadata was parsed from bounded workspace-local text only, secret-shaped values were masked, and no PowerShell/pwsh process, script execution, execution-policy change, module import, remote session, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `PowerShell script ready for explicit attachment (${formatBytes(size)}).`,
      "PowerShell preview could not read bounded local text; no PowerShell/pwsh process, script execution, execution-policy change, module import, remote session, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parsePowerShellScriptPreview(lines: string[], extension: string): {
  functions: string[];
  parameters: string[];
  imports: string[];
  commands: string[];
  riskCues: string[];
  helpSections: string[];
  manifestKeys: string[];
  sampleLines: string[];
} {
  const functions = new Set<string>();
  const parameters = new Set<string>();
  const imports = new Set<string>();
  const commands = new Set<string>();
  const riskCues = new Set<string>();
  const helpSections = new Set<string>();
  const manifestKeys = new Set<string>();
  const sampleLines: string[] = [];
  let inBlockComment = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("<#")) inBlockComment = true;
    collectPowerShellHelpSection(trimmed, helpSections);
    if (/^#requires\b/i.test(trimmed)) {
      collectPowerShellImportHints(trimmed, imports);
    }

    if (trimmed.endsWith("#>")) {
      inBlockComment = false;
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || inBlockComment) continue;

    const maskedLine = maskPotentialSecretValues(trimmed);
    if (sampleLines.length < 10) sampleLines.push(clampSingleLine(maskedLine, 220));

    const functionMatch = trimmed.match(/^function\s+(?:global:|script:|local:|private:)?([A-Za-z_][\w-]*)\b/i);
    if (functionMatch?.[1] && functions.size < MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) {
      functions.add(clampSingleLine(functionMatch[1], 100));
    }

    for (const match of trimmed.matchAll(/\$([A-Za-z_][\w-]*)\b/g)) {
      if (parameters.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) break;
      if (looksLikePowerShellParameterDeclaration(trimmed, match[1] || "")) {
        parameters.add(clampSingleLine(match[1], 100));
      }
    }

    collectPowerShellImportHints(trimmed, imports);
    collectPowerShellCommandHints(trimmed, commands);
    collectPowerShellRiskCues(trimmed, riskCues);
    if (extension === ".psd1") collectPowerShellManifestKey(trimmed, manifestKeys);
  }

  return {
    functions: [...functions],
    parameters: [...parameters],
    imports: [...imports],
    commands: [...commands],
    riskCues: [...riskCues],
    helpSections: [...helpSections],
    manifestKeys: [...manifestKeys],
    sampleLines,
  };
}

function collectPowerShellHelpSection(line: string, sections: Set<string>): void {
  if (sections.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  const match = line.match(/^#?\s*\.(SYNOPSIS|DESCRIPTION|PARAMETER|EXAMPLE|INPUTS|OUTPUTS|NOTES|LINK|COMPONENT|ROLE|FUNCTIONALITY)\b/i);
  if (match?.[1]) sections.add(match[1].toUpperCase());
}

function looksLikePowerShellParameterDeclaration(line: string, name: string): boolean {
  if (!name || ["true", "false", "null", "args", "input", "psitem", "_"].includes(name.toLowerCase())) return false;
  return /^\s*(?:\[[^\]]+\]\s*)?\$[A-Za-z_][\w-]*/.test(line) ||
    /\bparam\s*\(/i.test(line) ||
    /\[Parameter(?:\s*\(|\])/i.test(line);
}

function collectPowerShellImportHints(line: string, imports: Set<string>): void {
  if (imports.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  const patterns = [
    /^(?:Import-Module|using\s+module|using\s+namespace|using\s+assembly)\s+["']?([^"'\s;]+)["']?/i,
    /^#requires\s+-Modules?\s+(.+)$/i,
    /^\s*(?:RootModule|NestedModules|RequiredModules|ModuleToProcess)\s*=\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match?.[1]) continue;
    imports.add(clampSingleLine(maskPotentialSecretValues(match[1].replace(/[@()'"]/g, " ").replace(/\s+/g, " ")), 120));
    if (imports.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  }
}

function collectPowerShellCommandHints(line: string, commands: Set<string>): void {
  if (commands.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  for (const match of line.matchAll(/\b([A-Z][A-Za-z0-9]*-[A-Z][A-Za-z0-9]*)\b/g)) {
    const command = match[1] || "";
    if (/^(?:If|For|While|Switch|Where|ForEach)-/i.test(command)) continue;
    commands.add(clampSingleLine(command, 100));
    if (commands.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  }
  const external = line.match(/^\s*&?\s*["']?([^"'\s;]+\.(?:exe|cmd|bat|ps1|psm1))["']?/i);
  if (external?.[1]) commands.add(clampSingleLine(maskPotentialSecretValues(external[1]), 120));
}

function collectPowerShellRiskCues(line: string, riskCues: Set<string>): void {
  if (riskCues.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  const cuePatterns: Array<[RegExp, string]> = [
    [/\bInvoke-Expression\b|\biex\b/i, "dynamic execution"],
    [/\bInvoke-Command\b|\bEnter-PSSession\b|\bNew-PSSession\b/i, "remote session"],
    [/\bInvoke-WebRequest\b|\biwr\b|\bInvoke-RestMethod\b|\birm\b|DownloadString|Net\.WebClient/i, "network download/request"],
    [/\bStart-Process\b|\bStart-Job\b|\bStart-ThreadJob\b|\bpowershell(?:\.exe)?\b|\bpwsh(?:\.exe)?\b/i, "process/job launch"],
    [/\bSet-ExecutionPolicy\b/i, "execution policy change"],
    [/\bRemove-Item\b|\bMove-Item\b|\bSet-Content\b|\bCopy-Item\b|\bNew-Item\b/i, "filesystem mutation"],
    [/\bSet-ItemProperty\b|\bNew-ItemProperty\b|\bRemove-ItemProperty\b|HKLM:|HKCU:/i, "registry mutation"],
    [/\bRegister-ScheduledTask\b|\bNew-ScheduledTask\b/i, "scheduled task mutation"],
    [/\bConvertTo-SecureString\b|\bGet-Credential\b|\bPSCredential\b/i, "credential handling"],
  ];
  for (const [pattern, label] of cuePatterns) {
    if (pattern.test(line)) riskCues.add(label);
    if (riskCues.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  }
}

function collectPowerShellManifestKey(line: string, keys: Set<string>): void {
  if (keys.size >= MAX_POWERSHELL_SCRIPT_ITEM_PREVIEW) return;
  const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=/);
  if (match?.[1]) keys.add(clampSingleLine(match[1], 100));
}

function normalizeTextPreview(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .slice(0, MAX_CONFIG_LOG_PREVIEW_BYTES);
}

function extractConfigSections(lines: string[], extension: string): string[] {
  const sections = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const iniSection = trimmed.match(/^\[([^\]]+)\]$/);
    if (iniSection?.[1]) sections.add(clampSingleLine(iniSection[1], 80));
    if (extension === ".toml") {
      const table = trimmed.match(/^\[\[?([^\]]+)\]?\]$/);
      if (table?.[1]) sections.add(clampSingleLine(table[1], 80));
    }
    if ([".yaml", ".yml"].includes(extension)) {
      const yamlSection = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
      if (yamlSection?.[1]) sections.add(clampSingleLine(yamlSection[1], 80));
    }
    if (sections.size >= 12) break;
  }
  return [...sections];
}

function extractConfigKeys(lines: string[], extension: string): string[] {
  const keys = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed) || /^\[/.test(trimmed)) continue;
    const match =
      extension === ".env"
        ? trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
        : trimmed.match(/^([A-Za-z0-9_.-]+)\s*[:=]/);
    if (match?.[1]) keys.add(clampSingleLine(match[1], 80));
    if (keys.size >= MAX_CONFIG_KEYS_PREVIEW) break;
  }
  return [...keys];
}

function maskPotentialSecretValues(line: string): string {
  return line
    .replace(
      /((?:"[^"\r\n]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)[^"\r\n]*"|[A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*)\s*[:=]\s*)(["']?)[^"',;\r\n]+(\2)/gi,
      "$1$2[redacted]$3",
    )
    .replace(
      /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)[^\s"',;]+(\2)/gi,
      "$1$2[redacted]$3",
    )
    .replace(
      /(--(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential)(?:=|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;\r\n]+)/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .slice(0, 520);
}

type LocalConfigSchemaHintLevel = "ok" | "warning" | "info";

interface LocalConfigSchemaHint {
  level: LocalConfigSchemaHintLevel;
  message: string;
}

function summarizeLocalConfigSchemaHints(
  filePath: string,
  raw: string,
  extension: string,
  parsedJson?: unknown,
): string {
  const hints = collectLocalConfigSchemaHints(filePath, raw, extension, parsedJson).slice(
    0,
    MAX_CONFIG_SCHEMA_HINTS,
  );
  if (hints.length === 0) return "";
  const formatted = hints
    .map((hint) => `${hint.level}: ${clampSingleLine(hint.message, 180)}`)
    .join(" | ");
  return `Local schema hints: ${formatted}`;
}

function collectLocalConfigSchemaHints(
  filePath: string,
  raw: string,
  extension: string,
  parsedJson?: unknown,
): LocalConfigSchemaHint[] {
  const name = basename(filePath || "").toLowerCase();
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const lines = normalizeTextPreview(raw).split("\n");
  const hints: LocalConfigSchemaHint[] = [];

  if (extension === ".json") {
    collectJsonConfigSchemaHints(name, parsedJson, hints);
  }
  if (extension === ".env") {
    collectEnvSchemaHints(lines, hints);
  }
  if (extension === ".toml") {
    collectTomlSchemaHints(name, lines, hints);
  }
  if (extension === ".ini") {
    collectIniSchemaHints(name, lines, hints);
  }
  if (extension === ".xml") {
    collectXmlSchemaHints(name, raw, hints);
  }
  if (extension === ".yaml" || extension === ".yml") {
    collectYamlSchemaHints(name, normalizedPath, lines, hints);
  }

  if (hints.length > 0) {
    hints.push({
      level: "info",
      message:
        "Schema hints are local static checks only; no external schema lookup, configuration execution, or environment loading was performed.",
    });
  }
  return hints;
}

function collectJsonConfigSchemaHints(
  name: string,
  parsedJson: unknown,
  hints: LocalConfigSchemaHint[],
): void {
  const record = isPlainRecord(parsedJson) ? parsedJson : null;
  if (!record) {
    if (name.endsWith(".json")) {
      hints.push({ level: "warning", message: "JSON parse failed before local schema hints could be checked." });
    }
    return;
  }
  if (name === "package.json") {
    pushPropertyHint(hints, record, "name", "string", "package.json package name");
    pushPropertyHint(hints, record, "version", "string", "package.json version");
    pushPropertyHint(hints, record, "scripts", "object", "package.json scripts map");
    if (!isPlainRecord(record.dependencies) && !isPlainRecord(record.devDependencies)) {
      hints.push({ level: "info", message: "package.json has no dependency maps in the bounded preview." });
    }
    return;
  }
  if (name === "tsconfig.json" || name.startsWith("tsconfig.")) {
    pushPropertyHint(hints, record, "compilerOptions", "object", "TypeScript compilerOptions");
    if (!Array.isArray(record.include) && !Array.isArray(record.files) && !Array.isArray(record.references)) {
      hints.push({
        level: "info",
        message: "tsconfig has no include/files/references array in the bounded preview.",
      });
    }
    return;
  }
  if (name === "appsettings.json" || name.startsWith("appsettings.")) {
    if (!hasAnyProperty(record, ["ConnectionStrings", "Logging", "AllowedHosts"])) {
      hints.push({
        level: "info",
        message: "appsettings JSON does not expose common ASP.NET sections in the bounded preview.",
      });
    } else {
      hints.push({ level: "ok", message: "appsettings JSON exposes common ASP.NET configuration sections." });
    }
  }
}

function collectEnvSchemaHints(lines: string[], hints: LocalConfigSchemaHint[]): void {
  const keys = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of lines) {
    const match = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match?.[1]) continue;
    if (keys.has(match[1])) duplicates.add(match[1]);
    keys.add(match[1]);
  }
  if (keys.size === 0) {
    hints.push({ level: "warning", message: ".env file has no KEY=value entries in the bounded preview." });
  } else {
    hints.push({ level: "ok", message: `.env file exposes ${keys.size} KEY=value entr${keys.size === 1 ? "y" : "ies"}.` });
  }
  if (duplicates.size > 0) {
    hints.push({ level: "warning", message: `.env duplicate keys detected: ${[...duplicates].slice(0, 6).join(", ")}.` });
  }
}

function collectTomlSchemaHints(
  name: string,
  lines: string[],
  hints: LocalConfigSchemaHint[],
): void {
  const sections = new Set(
    lines
      .map((line) => line.trim().match(/^\[([^\]]+)\]$/)?.[1])
      .filter((section): section is string => Boolean(section)),
  );
  if (name === "pyproject.toml") {
    if (sections.has("project") || sections.has("tool.poetry")) {
      hints.push({ level: "ok", message: "pyproject.toml exposes a project metadata section." });
    } else {
      hints.push({ level: "warning", message: "pyproject.toml has no [project] or [tool.poetry] section in the bounded preview." });
    }
    if (!sections.has("build-system")) {
      hints.push({ level: "info", message: "pyproject.toml has no [build-system] section in the bounded preview." });
    }
    return;
  }
  if (name === "cargo.toml") {
    if (sections.has("package")) {
      hints.push({ level: "ok", message: "Cargo.toml exposes a [package] section." });
    } else {
      hints.push({ level: "warning", message: "Cargo.toml has no [package] section in the bounded preview." });
    }
  }
}

function collectIniSchemaHints(
  name: string,
  lines: string[],
  hints: LocalConfigSchemaHint[],
): void {
  const sections = new Set(
    lines
      .map((line) => line.trim().match(/^\[([^\]]+)\]$/)?.[1]?.toLowerCase())
      .filter((section): section is string => Boolean(section)),
  );
  if (name === ".editorconfig") {
    if (lines.some((line) => /^root\s*=\s*(true|false)\b/i.test(line.trim()))) {
      hints.push({ level: "ok", message: ".editorconfig declares the root setting." });
    } else {
      hints.push({ level: "info", message: ".editorconfig has no root=true/root=false setting in the bounded preview." });
    }
    if (sections.size === 0) {
      hints.push({ level: "warning", message: ".editorconfig has no glob sections in the bounded preview." });
    }
  }
}

function collectXmlSchemaHints(name: string, raw: string, hints: LocalConfigSchemaHint[]): void {
  const root = raw.match(/<([A-Za-z_][\w:.-]*)\b[^>]*>/)?.[1] || "";
  if (!root) {
    hints.push({ level: "warning", message: "XML root element was not detected in the bounded preview." });
    return;
  }
  if (name === "pom.xml") {
    if (root === "project" && /<(groupId|artifactId|version)\b/i.test(raw)) {
      hints.push({ level: "ok", message: "pom.xml exposes Maven project coordinates in the bounded preview." });
    } else {
      hints.push({ level: "warning", message: "pom.xml does not expose expected Maven project coordinates in the bounded preview." });
    }
    return;
  }
  if (name.endsWith(".csproj")) {
    if (root === "Project" || root.endsWith(":Project")) {
      hints.push({ level: "ok", message: "MSBuild project root was detected." });
    } else {
      hints.push({ level: "warning", message: "MSBuild project root was not detected." });
    }
    if (!/<TargetFrameworks?\b/i.test(raw)) {
      hints.push({ level: "info", message: "No TargetFramework or TargetFrameworks element was found in the bounded preview." });
    }
  }
}

function collectYamlSchemaHints(
  name: string,
  normalizedPath: string,
  lines: string[],
  hints: LocalConfigSchemaHint[],
): void {
  const keySet = extractTopLevelYamlKeys(lines);
  if (lines.some((line) => /^\t+/.test(line))) {
    hints.push({ level: "warning", message: "YAML contains leading tabs, which many parsers reject." });
  }
  if (normalizedPath.includes("/.github/workflows/")) {
    pushKeySetHint(hints, keySet, "on", "GitHub Actions trigger");
    pushKeySetHint(hints, keySet, "jobs", "GitHub Actions jobs map");
    return;
  }
  if (name === ".gitlab-ci.yml" || name === ".gitlab-ci.yaml") {
    pushKeySetHint(hints, keySet, "stages", "GitLab CI stages list");
    hints.push({ level: "info", message: "GitLab CI job keys are summarized locally from script-bearing top-level maps." });
    return;
  }
  if (name === "azure-pipelines.yml" || name === "azure-pipelines.yaml" || name.startsWith("azure-pipelines.")) {
    if (hasAnyKey(keySet, ["trigger", "pr", "schedules"])) {
      hints.push({ level: "ok", message: "Azure Pipelines trigger/pr/schedule keys are visible." });
    } else {
      hints.push({ level: "info", message: "Azure Pipelines trigger/pr/schedule keys are not visible in the bounded preview." });
    }
    if (!hasAnyKey(keySet, ["jobs", "stages", "steps"])) {
      hints.push({ level: "warning", message: "Azure Pipelines jobs/stages/steps keys are missing in the bounded preview." });
    }
    return;
  }
  if (name === "bitbucket-pipelines.yml" || name === "bitbucket-pipelines.yaml") {
    pushKeySetHint(hints, keySet, "pipelines", "Bitbucket Pipelines map");
    return;
  }
  if (name === "docker-compose.yml" || name === "docker-compose.yaml" || name === "compose.yml" || name === "compose.yaml") {
    pushKeySetHint(hints, keySet, "services", "Docker Compose services map");
    return;
  }
  if (name === "electron-builder.yml" || name === "electron-builder.yaml") {
    if (hasAnyKey(keySet, ["appId", "productName"])) {
      hints.push({ level: "ok", message: "Electron Builder identity fields are present." });
    } else {
      hints.push({ level: "info", message: "Electron Builder appId/productName fields are not visible in the bounded preview." });
    }
    if (!hasAnyKey(keySet, ["files", "directories", "win"])) {
      hints.push({ level: "info", message: "Electron Builder packaging fields are not visible in the bounded preview." });
    }
    return;
  }
  if (name === "dependabot.yml" || name === "dependabot.yaml") {
    pushKeySetHint(hints, keySet, "version", "Dependabot schema version");
    pushKeySetHint(hints, keySet, "updates", "Dependabot updates list");
  }
}

function summarizeCiWorkflowFileHints(filePath: string, raw: string, extension: string): string {
  if (extension !== ".yaml" && extension !== ".yml") return "";
  const kind = detectCiWorkflowKind(filePath);
  if (!kind) return "";
  const lines = normalizeTextPreview(raw).split("\n");
  const triggers = extractCiWorkflowTriggers(lines, kind);
  const jobs = extractCiWorkflowJobs(lines, kind);
  const stages = extractCiWorkflowListValues(lines, "stages").slice(0, MAX_CI_WORKFLOW_PREVIEW_ITEMS);
  const runners = extractCiWorkflowValueSamples(lines, ["runs-on", "vmImage", "image"]).slice(
    0,
    MAX_CI_WORKFLOW_PREVIEW_ITEMS,
  );
  const stepCount = lines.filter((line) =>
    /^\s*-\s*(?:name|run|uses|script|task|checkout|pipe)\s*:/i.test(line),
  ).length;
  return [
    `CI/CD workflow preview (${kind.label}).`,
    triggers.length > 0
      ? `Triggers: ${triggers.join(", ")}`
      : "Triggers: none detected in the bounded preview.",
    stages.length > 0 ? `Stages: ${stages.join(", ")}` : "",
    jobs.length > 0
      ? `Jobs/pipelines (${jobs.length}${jobs.length >= MAX_CI_WORKFLOW_PREVIEW_ITEMS ? "+" : ""}): ${jobs.join(", ")}`
      : "Jobs/pipelines: none detected in the bounded preview.",
    runners.length > 0 ? `Runner/image hints: ${runners.join(", ")}` : "Runner/image hints: none detected in the bounded preview.",
    `Step/task cues in bounded preview: ${stepCount}.`,
    "Ready for explicit attachment after visible review; CI workflow metadata was parsed from bounded local YAML only, and no CI runner, shell command, provider API call, secret retrieval, network call, or provider send was performed.",
  ].filter(Boolean).join("\n");
}

function detectCiWorkflowKind(filePath: string): { id: string; label: string } | null {
  const name = basename(filePath || "").toLowerCase();
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalizedPath.includes("/.github/workflows/")) return { id: "github-actions", label: "GitHub Actions" };
  if (name === ".gitlab-ci.yml" || name === ".gitlab-ci.yaml") return { id: "gitlab-ci", label: "GitLab CI" };
  if (name === "azure-pipelines.yml" || name === "azure-pipelines.yaml" || name.startsWith("azure-pipelines.")) {
    return { id: "azure-pipelines", label: "Azure Pipelines" };
  }
  if (name === "bitbucket-pipelines.yml" || name === "bitbucket-pipelines.yaml") {
    return { id: "bitbucket-pipelines", label: "Bitbucket Pipelines" };
  }
  if (normalizedPath.includes("/.circleci/") && name === "config.yml") return { id: "circleci", label: "CircleCI" };
  if (normalizedPath.includes("/.buildkite/") && name.endsWith(".yml")) return { id: "buildkite", label: "Buildkite" };
  return null;
}

function extractCiWorkflowTriggers(
  lines: string[],
  kind: { id: string; label: string },
): string[] {
  if (kind.id === "github-actions") {
    const inline = lines.find((line) => /^on\s*:/i.test(line.trim()))?.split(":").slice(1).join(":").trim();
    if (inline && inline !== "{}") {
      return inline
        .replace(/[\[\]{}"']/g, "")
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, MAX_CI_WORKFLOW_PREVIEW_ITEMS);
    }
    return extractCiWorkflowNestedKeys(lines, "on");
  }
  if (kind.id === "gitlab-ci") {
    return extractCiWorkflowValueSamples(lines, ["only", "except", "rules"]).slice(0, MAX_CI_WORKFLOW_PREVIEW_ITEMS);
  }
  if (kind.id === "azure-pipelines") {
    return extractCiWorkflowValueSamples(lines, ["trigger", "pr", "schedules"]).slice(0, MAX_CI_WORKFLOW_PREVIEW_ITEMS);
  }
  if (kind.id === "bitbucket-pipelines") return extractCiWorkflowNestedKeys(lines, "pipelines");
  if (kind.id === "circleci") return extractCiWorkflowNestedKeys(lines, "workflows");
  return extractCiWorkflowNestedKeys(lines, "steps");
}

function extractCiWorkflowJobs(lines: string[], kind: { id: string; label: string }): string[] {
  if (kind.id === "github-actions") return extractCiWorkflowNestedKeys(lines, "jobs");
  if (kind.id === "azure-pipelines") {
    return [
      ...extractCiWorkflowValueSamples(lines, ["job", "stage"]),
      ...extractCiWorkflowNestedKeys(lines, "jobs"),
      ...extractCiWorkflowNestedKeys(lines, "stages"),
    ].slice(0, MAX_CI_WORKFLOW_PREVIEW_ITEMS);
  }
  if (kind.id === "bitbucket-pipelines") return extractCiWorkflowNestedKeys(lines, "pipelines");
  if (kind.id === "circleci") return extractCiWorkflowNestedKeys(lines, "jobs");
  if (kind.id === "buildkite") return extractCiWorkflowValueSamples(lines, ["label", "command", "plugins"]);
  return extractGitlabCiJobs(lines);
}

function extractCiWorkflowNestedKeys(lines: string[], parent: string): string[] {
  const values = new Set<string>();
  let inParent = false;
  let parentIndent = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inParent) {
      const match = trimmed.match(new RegExp(`^${escapeRegex(parent)}\\s*:\\s*$`, "i"));
      if (match) {
        inParent = true;
        parentIndent = indent;
      }
      continue;
    }
    if (indent <= parentIndent && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) break;
    const key = trimmed.match(/^-?\s*([A-Za-z0-9_.-]+)\s*:/)?.[1];
    if (key && !["name", "run", "uses", "with", "env", "steps"].includes(key)) {
      values.add(clampSingleLine(key, 80));
    }
    if (values.size >= MAX_CI_WORKFLOW_PREVIEW_ITEMS) break;
  }
  return [...values];
}

function extractCiWorkflowListValues(lines: string[], key: string): string[] {
  const values = new Set<string>();
  let inList = false;
  let listIndent = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (!inList) {
      const inline = trimmed.match(new RegExp(`^${escapeRegex(key)}\\s*:\\s*\\[([^\\]]+)\\]`, "i"));
      if (inline?.[1]) {
        inline[1].split(",").forEach((value) => values.add(clampSingleLine(value.replace(/["']/g, "").trim(), 80)));
        break;
      }
      if (trimmed.match(new RegExp(`^${escapeRegex(key)}\\s*:\\s*$`, "i"))) {
        inList = true;
        listIndent = indent;
      }
      continue;
    }
    if (indent <= listIndent && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed)) break;
    const value = trimmed.match(/^-\s*([^#]+)/)?.[1]?.trim();
    if (value) values.add(clampSingleLine(value.replace(/["']/g, ""), 80));
    if (values.size >= MAX_CI_WORKFLOW_PREVIEW_ITEMS) break;
  }
  return [...values].filter(Boolean);
}

function extractCiWorkflowValueSamples(lines: string[], keys: string[]): string[] {
  const values = new Set<string>();
  const keyPattern = keys.map(escapeRegex).join("|");
  const regex = new RegExp(`\\b(?:${keyPattern})\\s*:\\s*([^#\\n]+)`, "i");
  for (const line of lines) {
    const value = line.trim().match(regex)?.[1]?.trim();
    if (!value || value === "|" || value === ">") continue;
    values.add(clampSingleLine(value.replace(/["'[\]{}]/g, "").trim(), 100));
    if (values.size >= MAX_CI_WORKFLOW_PREVIEW_ITEMS) break;
  }
  return [...values];
}

function extractGitlabCiJobs(lines: string[]): string[] {
  const reserved = new Set([
    "stages",
    "workflow",
    "variables",
    "default",
    "include",
    "image",
    "services",
    "cache",
    "before_script",
    "after_script",
  ]);
  const jobs = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (!match?.[1] || reserved.has(match[1])) continue;
    const block = lines.slice(index + 1, index + 16).join("\n");
    if (/\n\s+(script|stage|rules|only|needs)\s*:/i.test(`\n${block}`)) {
      jobs.add(clampSingleLine(match[1], 80));
    }
    if (jobs.size >= MAX_CI_WORKFLOW_PREVIEW_ITEMS) break;
  }
  return [...jobs];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pushPropertyHint(
  hints: LocalConfigSchemaHint[],
  record: Record<string, unknown>,
  key: string,
  expectedType: "string" | "object",
  label: string,
): void {
  const value = record[key];
  const matches =
    expectedType === "object"
      ? isPlainRecord(value)
      : typeof value === expectedType;
  hints.push({
    level: matches ? "ok" : "warning",
    message: matches ? `${label} is present.` : `${label} is missing or not a ${expectedType}.`,
  });
}

function pushKeySetHint(
  hints: LocalConfigSchemaHint[],
  keySet: Set<string>,
  key: string,
  label: string,
): void {
  hints.push({
    level: hasAnyKey(keySet, [key]) ? "ok" : "warning",
    message: hasAnyKey(keySet, [key]) ? `${label} is present.` : `${label} is missing in the bounded preview.`,
  });
}

function extractTopLevelYamlKeys(lines: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of lines) {
    if (/^\s/.test(line) || /^\s*(#|$)/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function hasAnyProperty(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function hasAnyKey(keySet: Set<string>, keys: string[]): boolean {
  return keys.some((key) => keySet.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function summarizeSqliteDatabaseFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, MAX_SQLITE_SCHEMA_SCAN_BYTES);
    const metadata = readSqliteDatabaseMetadata(buffer, size);
    if (!metadata) {
      return [
        `SQLite database file ready for explicit attachment (${formatBytes(size)}).`,
        "SQLite header was not recognized in the bounded local preview.",
        "No database connection, credential access, SQL execution, schema sampling query, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    const snippets = extractSqliteSchemaSnippets(buffer);
    return [
      `SQLite database metadata preview (${formatBytes(size)}).`,
      `Header: SQLite format 3; page size ${metadata.pageSize} B; page count ${metadata.pageCount || "unknown"}; estimated database size ${metadata.estimatedSize || "unknown"}.`,
      `Encoding: ${metadata.encoding}; write version ${metadata.writeVersion}; read version ${metadata.readVersion}.`,
      snippets.length > 0
        ? `Local schema snippets from bounded file scan:\n${snippets.map((snippet) => `- ${snippet}`).join("\n")}`
        : "Local schema snippets: none detected in the bounded file scan.",
      "Ready for explicit attachment after visible review; no database connection, credential access, SQL execution, schema sampling query, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `SQLite database file ready for explicit attachment (${formatBytes(size)}).`,
      "No database connection, credential access, SQL execution, schema sampling query, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeSqlScriptFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_SQL_SCRIPT_PREVIEW_BYTES, MAX_TEXT_BYTES * 24),
    ).toString("utf8");
    const stripped = stripSqlComments(raw);
    const statements = splitSqlStatements(stripped);
    const records = parseDatabaseSqlSchemaDump(raw);
    const statementKinds = summarizeSqlStatementKinds(statements);
    const tableSummaries = records.slice(0, 6).map((record) => {
      const table = getSnapshotString(record, "table") || "unnamed table";
      const columns = getSnapshotLabels(record.columns).slice(0, 12);
      const primaryKey = getSnapshotLabels(record.primaryKey).slice(0, 6);
      const foreignKeys = readSnapshotArray(record.foreignKeys).slice(0, 4).map((value) => {
        if (!isPlainRecord(value)) return "";
        const column = getSnapshotString(value, "column");
        const targetTable = getSnapshotString(value, "targetTable");
        const targetColumn = getSnapshotString(value, "targetColumn");
        return column && targetTable ? `${column} -> ${targetTable}.${targetColumn || "id"}` : "";
      }).filter(Boolean);
      return [
        `- ${table}`,
        columns.length > 0 ? `  Columns: ${columns.join(", ")}` : "",
        primaryKey.length > 0 ? `  Primary key: ${primaryKey.join(", ")}` : "",
        foreignKeys.length > 0 ? `  Foreign keys: ${foreignKeys.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    });
    const schemaHints = records
      .flatMap((record) =>
        inferDatabaseSchemaRelationshipHints(
          record,
          getSnapshotString(record, "table") || "SQL table",
          getSnapshotLabels(record.columns),
          getSnapshotLabels(record.primaryKey),
          records,
        ),
      )
      .slice(0, 8);
    const preview = normalizeTextPreview(stripped)
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(0, 12)
      .join("\n");
    return [
      `SQL script preview (${formatBytes(size)}).`,
      statements.length > 0 ? `Statements detected: ${statements.length}.` : "Statements detected: none in bounded preview.",
      statementKinds.length > 0 ? `Statement types: ${statementKinds.join(", ")}.` : "",
      records.length > 0
        ? `Local DDL tables:\n${tableSummaries.join("\n")}`
        : "Local DDL tables: none detected from CREATE TABLE statements in the bounded preview.",
      schemaHints.length > 0
        ? `Local schema relationship hints:\n${schemaHints.join("\n")}`
        : records.length > 0
          ? "Local schema relationship hints: none detected from the bounded SQL preview."
          : "",
      preview ? `SQL text preview:\n${maskPotentialSecretValues(preview)}` : "",
      "Ready for explicit attachment after visible review; no database connection, credential access, SQL execution, schema sampling query, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `SQL script ready for explicit attachment (${formatBytes(size)}).`,
      "No database connection, credential access, SQL execution, schema sampling query, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeSqlStatementKinds(statements: string[]): string[] {
  const counts = new Map<string, number>();
  for (const statement of statements.slice(0, 80)) {
    const match = statement.match(/^\s*(CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|INSERT|UPDATE|DELETE|SELECT)\b/i);
    const kind = match ? match[1].replace(/\s+/g, " ").toUpperCase() : "OTHER";
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return Array.from(counts.entries()).slice(0, 8).map(([kind, count]) => `${kind} (${count})`);
}

function readSqliteDatabaseMetadata(
  buffer: Buffer,
  size: number,
): {
  pageSize: number;
  pageCount: number;
  estimatedSize: string;
  encoding: string;
  writeVersion: number;
  readVersion: number;
} | null {
  if (buffer.length < 100) return null;
  if (buffer.subarray(0, 16).toString("binary") !== "SQLite format 3\u0000") return null;
  const rawPageSize = buffer.readUInt16BE(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const pageCount = buffer.readUInt32BE(28);
  const encodingCode = buffer.readUInt32BE(56);
  const encoding =
    encodingCode === 1
      ? "UTF-8"
      : encodingCode === 2
        ? "UTF-16le"
        : encodingCode === 3
          ? "UTF-16be"
          : "unknown";
  return {
    pageSize,
    pageCount,
    estimatedSize: pageCount > 0 && pageSize > 0 ? formatBytes(pageCount * pageSize) : formatBytes(size),
    encoding,
    writeVersion: buffer[18] ?? 0,
    readVersion: buffer[19] ?? 0,
  };
}

function extractSqliteSchemaSnippets(buffer: Buffer): string[] {
  const text = buffer
    .toString("utf8")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ");
  const snippets: string[] = [];
  const seen = new Set<string>();
  const pattern = /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && snippets.length < MAX_SQLITE_SCHEMA_SNIPPETS) {
    const start = match.index;
    const nextMatch = text.slice(start + 8).search(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/i);
    const end = nextMatch >= 0 ? start + 8 + nextMatch : Math.min(text.length, start + 720);
    const snippet = clampSingleLine(text.slice(start, end).replace(/;\s*.*$/, ";"), 360);
    const key = snippet.toLowerCase();
    if (snippet.length > 0 && !seen.has(key)) {
      seen.add(key);
      snippets.push(snippet);
    }
  }
  return snippets;
}

function summarizeCsvDataFile(filePath: string, size: number, extension = ".csv"): string {
  const delimiter = extension === ".tsv" ? "\t" : ",";
  const label = extension === ".tsv" ? "TSV" : "CSV";
  const formatName = extension === ".tsv" ? "tab-separated" : "CSV";
  const previewHeading = extension === ".tsv" ? "Structured TSV preview" : "Structured CSV preview";
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_STRUCTURED_DATA_PREVIEW_BYTES, MAX_TEXT_BYTES * 8),
    ).toString("utf8");
    const rows = parseDelimitedPreviewRows(raw, delimiter);
    const header = rows[0] ?? [];
    const samples = rows.slice(1, MAX_CSV_PREVIEW_ROWS + 1);
    const columnPreview =
      header.length > 0
        ? header.map((column, index) => column || `Column ${index + 1}`).slice(0, 16).join(", ")
        : "No header row detected.";
    const samplePreview = samples
      .slice(0, 4)
      .map((row, index) => `Row ${index + 1}: ${row.slice(0, 8).join(" | ")}`)
      .join("\n");
    const schemaHints = summarizeDelimitedSchemaHints(header, samples);
    return [
      `${previewHeading} (${formatBytes(size)}).`,
      `Columns (${header.length}): ${columnPreview}`,
      `Preview rows: ${samples.length}${raw.length >= Math.min(MAX_STRUCTURED_DATA_PREVIEW_BYTES, MAX_TEXT_BYTES * 8) ? " from bounded sample" : ""}.`,
      schemaHints,
      samplePreview || "No readable data rows were found.",
      `Ready for explicit attachment after visible review; ${formatName} data was parsed from a bounded local byte sample with local-only schema hints and no database connection, network call, spreadsheet macro execution, or provider send was performed.`,
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `${label} data file ready for explicit attachment (${formatBytes(size)}).`,
      "No database connection, network call, spreadsheet macro execution, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseDelimitedPreviewRows(raw: string, delimiter = ","): string[][] {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < normalized.length && rows.length <= MAX_CSV_PREVIEW_ROWS; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cleanPreviewCell(cell));
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cleanPreviewCell(cell));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell || row.length > 0) {
    row.push(cleanPreviewCell(cell));
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function summarizeDelimitedSchemaHints(header: string[], samples: string[][]): string {
  if (header.length === 0 || samples.length === 0) {
    return "Local delimited schema hints: unavailable without a header row and readable data rows.";
  }
  const columnCount = Math.min(header.length, MAX_DELIMITED_SCHEMA_COLUMNS);
  const hints: string[] = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const name = cleanDelimitedColumnName(header[columnIndex] || `Column ${columnIndex + 1}`);
    const values = samples.map((row) => row[columnIndex] ?? "");
    const nonEmptyValues = values.filter((value) => value.trim().length > 0);
    const uniqueValues = [...new Set(nonEmptyValues.map((value) => value.toLowerCase()))];
    const type = inferDelimitedColumnType(nonEmptyValues);
    const details = [
      `${name}: ${type}`,
      `${nonEmptyValues.length}/${samples.length} non-empty`,
    ];
    if (nonEmptyValues.length > 0 && uniqueValues.length === nonEmptyValues.length && nonEmptyValues.length >= 3) {
      details.push("mostly unique");
    }
    if (isDelimitedIdentifierCandidate(name, type, uniqueValues.length, nonEmptyValues.length)) {
      details.push("identifier/relationship key candidate");
    }
    if (isDelimitedEnumCandidate(type, uniqueValues.length, nonEmptyValues.length, samples.length)) {
      const examples = [...new Set(nonEmptyValues)].slice(0, MAX_DELIMITED_ENUM_VALUES).join(", ");
      details.push(`enum-like values ${examples}`);
    }
    hints.push(details.join("; "));
  }
  const truncated = header.length > columnCount ? `; ${header.length - columnCount} more column(s) not profiled` : "";
  return `Local delimited schema hints: ${hints.join(" | ")}${truncated}.`;
}

function cleanDelimitedColumnName(value: string): string {
  return clampSingleLine(value.replace(/\s+/g, "_").replace(/[^\w.-]+/g, "_") || "column", 80);
}

function inferDelimitedColumnType(values: string[]): string {
  if (values.length === 0) return "empty";
  const typeCounts = new Map<string, number>();
  for (const value of values) {
    const type = classifyDelimitedValue(value.trim());
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const sortedTypes = [...typeCounts.entries()].sort((left, right) => right[1] - left[1]);
  const [dominantType, dominantCount] = sortedTypes[0] ?? ["text", 0];
  if (dominantCount === values.length) return dominantType;
  if (dominantCount / values.length >= 0.75) return `${dominantType} mostly`;
  return "mixed";
}

function classifyDelimitedValue(value: string): string {
  if (/^(true|false|yes|no|y|n)$/i.test(value)) return "boolean";
  if (/^[+-]?\d+$/.test(value)) return "integer";
  if (/^[+-]?(?:\d+\.\d+|\d+\.\d*|\.\d+)$/.test(value)) return "decimal";
  if (/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return value.length > 10 ? "datetime" : "date";
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value)) {
    return value.includes(":") ? "datetime" : "date";
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
  if (/^https?:\/\/[^\s]+$/i.test(value)) return "url";
  if (/^(?:\{.*\}|\[.*\])$/.test(value)) return "json-like";
  return "text";
}

function isDelimitedIdentifierCandidate(
  name: string,
  type: string,
  uniqueCount: number,
  nonEmptyCount: number,
): boolean {
  const normalized = name.toLowerCase();
  if (!/(^id$|_id$|\.id$|uuid|guid|key$|code$)/.test(normalized)) return false;
  return nonEmptyCount > 0 && (uniqueCount === nonEmptyCount || /integer|text/.test(type));
}

function isDelimitedEnumCandidate(
  type: string,
  uniqueCount: number,
  nonEmptyCount: number,
  sampleCount: number,
): boolean {
  return (
    nonEmptyCount >= 3 &&
    sampleCount >= 3 &&
    uniqueCount > 1 &&
    uniqueCount <= Math.min(MAX_DELIMITED_ENUM_VALUES, Math.ceil(nonEmptyCount / 2)) &&
    /^(text|boolean|integer)/.test(type)
  );
}

function cleanPreviewCell(value: string): string {
  const cleaned = maskPotentialSecretValues(redactUrlQuerySecrets(value.replace(/\s+/g, " ").trim())).slice(0, 120);
  if (/^(?:secret|token|password|passwd|pwd|credential|private[_-]?key|api[_-]?key)[-_:]/i.test(cleaned)) {
    return "[redacted]";
  }
  return cleaned;
}

interface ApiSpecEndpointPreview {
  method: string;
  path: string;
  name?: string;
}

interface ApiSpecPreview {
  format: string;
  title?: string;
  version?: string;
  servers: string[];
  endpoints: ApiSpecEndpointPreview[];
  security: string[];
}

function summarizeApiSpecFile(filePath: string, extension: string, size: number): string | null {
  try {
    const raw = readFileHeader(filePath, MAX_API_SPEC_PREVIEW_BYTES).toString("utf8");
    const preview =
      extension === ".json"
        ? parseJsonApiSpecPreview(raw)
        : parseYamlApiSpecPreview(raw);
    if (!preview) return null;
    const endpointLines = preview.endpoints
      .slice(0, MAX_API_ENDPOINT_PREVIEW)
      .map((endpoint, index) => {
        const name = endpoint.name ? ` (${endpoint.name})` : "";
        return `- ${index + 1}. ${endpoint.method.toUpperCase()} ${redactHarUrl(endpoint.path)}${name}`;
      });
    const serverText =
      preview.servers.length > 0
        ? preview.servers.slice(0, 8).map(redactHarUrl).join(", ")
        : "none detected in the bounded local preview";
    const securityText =
      preview.security.length > 0
        ? preview.security.slice(0, MAX_API_SECURITY_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    return [
      `API spec/collection preview (${formatBytes(size)}).`,
      `Format: ${preview.format}.`,
      preview.title ? `Title: ${preview.title}.` : "",
      preview.version ? `Version: ${preview.version}.` : "",
      `Servers/base URLs: ${serverText}.`,
      `Security/auth hints: ${securityText}.`,
      `Endpoints: ${preview.endpoints.length}${preview.endpoints.length > endpointLines.length ? `; showing first ${endpointLines.length}` : ""}.`,
      endpointLines.length > 0
        ? `Endpoint samples:\n${endpointLines.join("\n")}`
        : "Endpoint samples: none detected in the bounded local preview.",
      "Ready for explicit attachment after visible review; Postman/OpenAPI/Swagger/Insomnia metadata was parsed from bounded local text only, sensitive URL values were redacted, and no request execution, mock server startup, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return null;
  }
}

function parseJsonApiSpecPreview(raw: string): ApiSpecPreview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  if (typeof parsed.openapi === "string" || typeof parsed.swagger === "string") {
    return parseOpenApiRecord(parsed, typeof parsed.openapi === "string" ? "OpenAPI" : "Swagger");
  }
  if (isPlainRecord(parsed.info) && Array.isArray(parsed.item)) {
    const schema = readRecordString(parsed.info, "schema");
    if (schema.includes("postman.com") || readRecordString(parsed.info, "name") || parsed.item.length > 0) {
      return parsePostmanCollectionRecord(parsed);
    }
  }
  if (Array.isArray(parsed.resources) && readRecordString(parsed, "_type").toLowerCase().includes("export")) {
    return parseInsomniaExportRecord(parsed);
  }
  return null;
}

function parseOpenApiRecord(record: Record<string, unknown>, label: string): ApiSpecPreview {
  const info = isPlainRecord(record.info) ? record.info : {};
  const servers = readOpenApiServers(record);
  const endpoints = extractOpenApiEndpoints(record);
  const security = extractOpenApiSecurity(record);
  const declaredVersion =
    typeof record.openapi === "string"
      ? record.openapi
      : typeof record.swagger === "string"
        ? record.swagger
        : "";
  return {
    format: `${label}${declaredVersion ? ` ${declaredVersion}` : ""}`,
    title: readRecordString(info, "title"),
    version: readRecordString(info, "version"),
    servers,
    endpoints,
    security,
  };
}

function readOpenApiServers(record: Record<string, unknown>): string[] {
  const servers = new Set<string>();
  if (Array.isArray(record.servers)) {
    for (const server of record.servers) {
      if (isPlainRecord(server)) {
        const url = readRecordString(server, "url");
        if (url) servers.add(clampSingleLine(url, 180));
      }
    }
  }
  const host = readRecordString(record, "host");
  const basePath = readRecordString(record, "basePath");
  if (host) {
    const schemes = Array.isArray(record.schemes)
      ? record.schemes.filter((scheme): scheme is string => typeof scheme === "string")
      : [];
    const scheme = schemes[0] || "https";
    servers.add(`${scheme}://${host}${basePath || ""}`);
  }
  return [...servers].slice(0, 8);
}

function extractOpenApiEndpoints(record: Record<string, unknown>): ApiSpecEndpointPreview[] {
  const paths = isPlainRecord(record.paths) ? record.paths : {};
  const endpoints: ApiSpecEndpointPreview[] = [];
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
  for (const [path, value] of Object.entries(paths)) {
    if (!isPlainRecord(value)) continue;
    for (const [method, operation] of Object.entries(value)) {
      if (!methods.has(method.toLowerCase())) continue;
      const operationRecord = isPlainRecord(operation) ? operation : {};
      const name =
        readRecordString(operationRecord, "operationId") ||
        readRecordString(operationRecord, "summary");
      endpoints.push({
        method,
        path: clampSingleLine(path, 180),
        name: name ? clampSingleLine(name, 120) : undefined,
      });
      if (endpoints.length >= MAX_API_ENDPOINT_PREVIEW * 2) return endpoints;
    }
  }
  return endpoints;
}

function extractOpenApiSecurity(record: Record<string, unknown>): string[] {
  const security = new Set<string>();
  const components = isPlainRecord(record.components) ? record.components : {};
  const securitySchemes = isPlainRecord(components.securitySchemes)
    ? components.securitySchemes
    : isPlainRecord(record.securityDefinitions)
      ? record.securityDefinitions
      : {};
  for (const [name, value] of Object.entries(securitySchemes)) {
    const type = isPlainRecord(value) ? readRecordString(value, "type") : "";
    security.add(clampSingleLine(type ? `${name} (${type})` : name, 120));
    if (security.size >= MAX_API_SECURITY_PREVIEW) break;
  }
  if (Array.isArray(record.security)) {
    for (const entry of record.security) {
      if (!isPlainRecord(entry)) continue;
      for (const name of Object.keys(entry)) {
        security.add(clampSingleLine(name, 120));
        if (security.size >= MAX_API_SECURITY_PREVIEW) break;
      }
      if (security.size >= MAX_API_SECURITY_PREVIEW) break;
    }
  }
  return [...security];
}

function parsePostmanCollectionRecord(record: Record<string, unknown>): ApiSpecPreview {
  const info = isPlainRecord(record.info) ? record.info : {};
  const endpoints: ApiSpecEndpointPreview[] = [];
  extractPostmanRequests(record.item, endpoints);
  const security = new Set<string>();
  const collectionAuth = readPostmanAuth(record.auth);
  if (collectionAuth) security.add(collectionAuth);
  collectPostmanRequestAuth(record.item, security);
  return {
    format: "Postman collection",
    title: readRecordString(info, "name"),
    version: readPostmanVersion(info.version),
    servers: extractPostmanServers(endpoints),
    endpoints,
    security: [...security].slice(0, MAX_API_SECURITY_PREVIEW),
  };
}

function extractPostmanRequests(value: unknown, endpoints: ApiSpecEndpointPreview[], folderName = ""): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isPlainRecord(item)) continue;
    const name = readRecordString(item, "name") || folderName;
    if (isPlainRecord(item.request)) {
      endpoints.push({
        method: readRecordString(item.request, "method") || "REQUEST",
        path: readPostmanUrl(item.request.url),
        name: name ? clampSingleLine(name, 120) : undefined,
      });
    }
    if (Array.isArray(item.item)) {
      extractPostmanRequests(item.item, endpoints, name);
    }
    if (endpoints.length >= MAX_API_ENDPOINT_PREVIEW * 2) return;
  }
}

function collectPostmanRequestAuth(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isPlainRecord(item)) continue;
    if (isPlainRecord(item.request)) {
      const auth = readPostmanAuth(item.request.auth);
      if (auth) target.add(auth);
    }
    if (Array.isArray(item.item)) collectPostmanRequestAuth(item.item, target);
    if (target.size >= MAX_API_SECURITY_PREVIEW) return;
  }
}

function readPostmanAuth(value: unknown): string {
  if (!isPlainRecord(value)) return "";
  return readRecordString(value, "type") || "";
}

function readPostmanVersion(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isPlainRecord(value)) return "";
  const parts = ["major", "minor", "patch"]
    .map((key) => value[key])
    .filter((part) => typeof part === "number" || typeof part === "string")
    .map(String);
  return parts.length > 0 ? parts.join(".") : "";
}

function readPostmanUrl(value: unknown): string {
  if (typeof value === "string") return clampSingleLine(value, 240);
  if (!isPlainRecord(value)) return "unknown URL";
  const raw = readRecordString(value, "raw");
  if (raw) return clampSingleLine(raw, 240);
  const protocol = readRecordString(value, "protocol") || "https";
  const host = readPostmanStringArray(value.host).join(".");
  const path = readPostmanStringArray(value.path).join("/");
  if (host) return `${protocol}://${host}${path ? `/${path}` : ""}`;
  return path ? `/${path}` : "unknown URL";
}

function readPostmanStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function extractPostmanServers(endpoints: ApiSpecEndpointPreview[]): string[] {
  const servers = new Set<string>();
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint.path.replace(/\{\{([^}]+)\}\}/g, "example.local"));
      servers.add(`${url.protocol}//${url.host}`);
    } catch {
      // Relative Postman request paths do not expose a server.
    }
    if (servers.size >= 8) break;
  }
  return [...servers];
}

interface PostmanEnvironmentPreview {
  scope: string;
  name: string;
  variableCount: number;
  enabledCount: number;
  disabledCount: number;
  variableKeys: string[];
  sensitiveKeys: string[];
}

function summarizePostmanEnvironmentFile(filePath: string, size: number): string | null {
  try {
    const raw = readFileHeader(filePath, MAX_POSTMAN_ENVIRONMENT_PREVIEW_BYTES).toString("utf8");
    const preview = parsePostmanEnvironmentPreview(raw);
    if (!preview) return null;
    const keyText =
      preview.variableKeys.length > 0
        ? preview.variableKeys.slice(0, MAX_POSTMAN_ENVIRONMENT_ITEM_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const sensitiveText =
      preview.sensitiveKeys.length > 0
        ? preview.sensitiveKeys.slice(0, MAX_POSTMAN_ENVIRONMENT_ITEM_PREVIEW).join(", ")
        : "none detected in variable keys";
    return [
      `Postman environment/globals preview (${formatBytes(size)}).`,
      `Scope: ${preview.scope}.`,
      preview.name ? `Name: ${preview.name}.` : "",
      `Variables: ${preview.variableCount}; enabled ${preview.enabledCount}; disabled ${preview.disabledCount}.`,
      `Variable keys: ${keyText}.`,
      `Sensitive-looking variable keys: ${sensitiveText}. Values were not expanded.`,
      raw.length >= MAX_POSTMAN_ENVIRONMENT_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_POSTMAN_ENVIRONMENT_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; Postman environment metadata was parsed from bounded workspace-local JSON only, variable values were not expanded, and no request execution, environment resolution, Postman CLI launch, mock server startup, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return null;
  }
}

function parsePostmanEnvironmentPreview(raw: string): PostmanEnvironmentPreview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  const scope = readRecordString(parsed, "_postman_variable_scope").toLowerCase();
  const values = Array.isArray(parsed.values) ? parsed.values : [];
  const isPostmanEnvironment =
    (scope === "environment" || scope === "globals" || scope === "global") &&
    values.some((entry) => isPlainRecord(entry) && readRecordString(entry, "key"));
  if (!isPostmanEnvironment) return null;
  const variableKeys: string[] = [];
  const sensitiveKeys: string[] = [];
  let enabledCount = 0;
  let disabledCount = 0;
  for (const entry of values) {
    if (!isPlainRecord(entry)) continue;
    const key = clampSingleLine(readRecordString(entry, "key"), 120);
    if (!key) continue;
    if (entry.enabled === false || entry.disabled === true) {
      disabledCount += 1;
    } else {
      enabledCount += 1;
    }
    if (variableKeys.length < MAX_POSTMAN_ENVIRONMENT_ITEM_PREVIEW) {
      variableKeys.push(key);
    }
    if (isSensitiveFieldName(key) && sensitiveKeys.length < MAX_POSTMAN_ENVIRONMENT_ITEM_PREVIEW) {
      sensitiveKeys.push(key);
    }
  }
  return {
    scope: scope === "global" ? "globals" : scope,
    name: clampSingleLine(readRecordString(parsed, "name"), 120),
    variableCount: enabledCount + disabledCount,
    enabledCount,
    disabledCount,
    variableKeys,
    sensitiveKeys,
  };
}

function parseInsomniaExportRecord(record: Record<string, unknown>): ApiSpecPreview {
  const resources = Array.isArray(record.resources) ? record.resources : [];
  const workspace = resources.find((resource) =>
    isPlainRecord(resource) && readRecordString(resource, "_type") === "workspace",
  );
  const endpoints: ApiSpecEndpointPreview[] = [];
  const security = new Set<string>();
  const servers = new Set<string>();
  for (const resource of resources) {
    if (!isPlainRecord(resource) || readRecordString(resource, "_type") !== "request") continue;
    const method = readRecordString(resource, "method") || "REQUEST";
    const url = readRecordString(resource, "url") || readRecordString(resource, "path") || "unknown URL";
    endpoints.push({
      method: method.toUpperCase(),
      path: clampSingleLine(url, 220),
      name: clampSingleLine(readRecordString(resource, "name"), 120) || undefined,
    });
    const authentication = isPlainRecord(resource.authentication) ? resource.authentication : {};
    const authType = readRecordString(authentication, "type") || readRecordString(resource, "authentication");
    if (authType) security.add(clampSingleLine(authType, 120));
    try {
      const parsedUrl = new URL(url.replace(/\{\{([^}]+)\}\}/g, "example.local"));
      servers.add(`${parsedUrl.protocol}//${parsedUrl.host}`);
    } catch {
      // Insomnia requests may use variables or relative paths.
    }
    if (endpoints.length >= MAX_API_ENDPOINT_PREVIEW * 2) break;
  }
  const environments = resources.filter((resource) =>
    isPlainRecord(resource) && readRecordString(resource, "_type") === "environment",
  ).length;
  if (environments > 0) security.add(`${environments} environment record(s), values not expanded`);
  return {
    format: "Insomnia export",
    title: isPlainRecord(workspace) ? readRecordString(workspace, "name") : readRecordString(record, "name"),
    version: readRecordString(record, "__export_format") || readRecordString(record, "__export_date"),
    servers: [...servers].slice(0, 8),
    endpoints,
    security: [...security].slice(0, MAX_API_SECURITY_PREVIEW),
  };
}

function parseYamlApiSpecPreview(raw: string): ApiSpecPreview | null {
  const text = normalizeTextPreview(raw);
  const insomniaPreview = parseYamlInsomniaExportPreview(text);
  if (insomniaPreview) return insomniaPreview;
  if (!/^\s*(openapi|swagger)\s*:/im.test(text)) return null;
  const lines = text.split("\n");
  const formatLine = lines.find((line) => /^\s*(openapi|swagger)\s*:/i.test(line)) || "";
  const version = (formatLine.match(/:\s*["']?([^"'\s#]+)/)?.[1] || "").trim();
  const endpoints: ApiSpecEndpointPreview[] = [];
  const servers = new Set<string>();
  const security = new Set<string>();
  let title = "";
  let infoVersion = "";
  let currentPath = "";
  let inSecuritySchemes = false;
  const methods = /^(get|post|put|patch|delete|options|head|trace)\s*:/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const titleMatch = trimmed.match(/^title\s*:\s*(.+)$/i);
    if (!title && titleMatch?.[1]) title = cleanYamlScalar(titleMatch[1]);
    const versionMatch = trimmed.match(/^version\s*:\s*(.+)$/i);
    if (!infoVersion && versionMatch?.[1]) infoVersion = cleanYamlScalar(versionMatch[1]);
    const serverMatch = trimmed.match(/^url\s*:\s*(.+)$/i);
    if (serverMatch?.[1]) servers.add(clampSingleLine(cleanYamlScalar(serverMatch[1]), 180));
    if (/^securitySchemes\s*:/i.test(trimmed) || /^securityDefinitions\s*:/i.test(trimmed)) {
      inSecuritySchemes = true;
      continue;
    }
    if (inSecuritySchemes) {
      const schemeMatch = line.match(/^\s{2,8}([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (schemeMatch?.[1] && !["type", "scheme", "name", "in"].includes(schemeMatch[1])) {
        security.add(clampSingleLine(schemeMatch[1], 120));
      }
      if (/^\S/.test(line) && !/^securitySchemes|securityDefinitions/i.test(trimmed)) inSecuritySchemes = false;
    }
    const pathMatch = line.match(/^\s{0,6}["']?(\/[^:'"]+)["']?\s*:\s*(?:#.*)?$/);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = trimmed.match(methods);
    if (currentPath && methodMatch?.[1]) {
      endpoints.push({ method: methodMatch[1], path: currentPath });
      if (endpoints.length >= MAX_API_ENDPOINT_PREVIEW * 2) break;
    }
  }

  return {
    format: `OpenAPI/Swagger YAML${version ? ` ${version}` : ""}`,
    title,
    version: infoVersion,
    servers: [...servers].slice(0, 8),
    endpoints,
    security: [...security].slice(0, MAX_API_SECURITY_PREVIEW),
  };
}

function parseYamlInsomniaExportPreview(text: string): ApiSpecPreview | null {
  if (!/^\s*_type\s*:\s*export\b/im.test(text) || !/^\s*resources\s*:/im.test(text)) return null;
  const lines = text.split("\n");
  const endpoints: ApiSpecEndpointPreview[] = [];
  const security = new Set<string>();
  const servers = new Set<string>();
  let title = "";
  let version = "";
  let currentType = "";
  let currentName = "";
  let currentMethod = "";
  let currentUrl = "";

  const flushRequest = () => {
    if (currentType !== "request" || !currentMethod || !currentUrl) return;
    endpoints.push({
      method: currentMethod.toUpperCase(),
      path: clampSingleLine(currentUrl, 220),
      name: currentName ? clampSingleLine(currentName, 120) : undefined,
    });
    try {
      const parsedUrl = new URL(currentUrl.replace(/\{\{([^}]+)\}\}/g, "example.local"));
      servers.add(`${parsedUrl.protocol}//${parsedUrl.host}`);
    } catch {
      // Insomnia requests may use variables or relative paths.
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const exportFormat = trimmed.match(/^__export_format\s*:\s*(.+)$/);
    if (!version && exportFormat?.[1]) version = cleanYamlScalar(exportFormat[1]);
    const resourceStart = trimmed.match(/^-\s*_type\s*:\s*(.+)$/);
    if (resourceStart?.[1]) {
      flushRequest();
      currentType = cleanYamlScalar(resourceStart[1]);
      currentName = "";
      currentMethod = "";
      currentUrl = "";
      continue;
    }
    if (!currentType) continue;
    const nameMatch = trimmed.match(/^name\s*:\s*(.+)$/);
    if (nameMatch?.[1]) {
      const name = cleanYamlScalar(nameMatch[1]);
      if (currentType === "workspace" && !title) title = name;
      currentName = name;
      continue;
    }
    const methodMatch = trimmed.match(/^method\s*:\s*(.+)$/);
    if (methodMatch?.[1]) {
      currentMethod = cleanYamlScalar(methodMatch[1]);
      continue;
    }
    const urlMatch = trimmed.match(/^url\s*:\s*(.+)$/);
    if (urlMatch?.[1]) {
      currentUrl = cleanYamlScalar(urlMatch[1]);
      continue;
    }
    const authTypeMatch = trimmed.match(/^type\s*:\s*(bearer|basic|digest|oauth2?|apikey|ntlm|hawk|aws|none)\b/i);
    if (authTypeMatch?.[1]) security.add(authTypeMatch[1].toLowerCase());
    if (endpoints.length >= MAX_API_ENDPOINT_PREVIEW * 2) break;
  }
  flushRequest();
  if (endpoints.length === 0) return null;
  return {
    format: "Insomnia YAML export",
    title,
    version,
    servers: [...servers].slice(0, 8),
    endpoints,
    security: [...security].slice(0, MAX_API_SECURITY_PREVIEW),
  };
}

function summarizeBrunoCollectionFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_BRUNO_COLLECTION_PREVIEW_BYTES).toString("utf8");
    const preview = parseBrunoCollectionPreview(raw);
    const endpointLines = preview.endpoints
      .slice(0, MAX_BRUNO_COLLECTION_ITEM_PREVIEW)
      .map((endpoint, index) => {
        const name = endpoint.name ? ` (${endpoint.name})` : "";
        return `- ${index + 1}. ${endpoint.method.toUpperCase()} ${redactHarUrl(endpoint.path)}${name}`;
      });
    const securityText =
      preview.security.length > 0
        ? preview.security.slice(0, MAX_API_SECURITY_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    return [
      `Bruno API request file preview (${formatBytes(size)}).`,
      preview.title ? `Name: ${preview.title}.` : "",
      `Security/auth hints: ${securityText}.`,
      `Requests: ${preview.endpoints.length}${preview.endpoints.length > endpointLines.length ? `; showing first ${endpointLines.length}` : ""}.`,
      endpointLines.length > 0
        ? `Request samples:\n${endpointLines.join("\n")}`
        : "Request samples: none detected in the bounded local preview.",
      raw.length >= MAX_BRUNO_COLLECTION_PREVIEW_BYTES ? `Preview was capped at ${formatBytes(MAX_BRUNO_COLLECTION_PREVIEW_BYTES)}.` : "",
      "Ready for explicit attachment after visible review; Bruno metadata was parsed from bounded workspace-local text only, request bodies and secret-shaped values were not expanded, and no HTTP request execution, Bruno CLI launch, environment file loading, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Bruno API request file ready for explicit attachment (${formatBytes(size)}).`,
      "Bruno preview could not read bounded local text; no HTTP request execution, Bruno CLI launch, environment file loading, credential lookup, network call, or provider send was performed.",
    ].join("\n");
  }
}

function parseBrunoCollectionPreview(raw: string): ApiSpecPreview {
  const text = normalizeTextPreview(raw).slice(0, MAX_BRUNO_COLLECTION_PREVIEW_BYTES);
  const lines = text.split("\n");
  const endpoints: ApiSpecEndpointPreview[] = [];
  const security = new Set<string>();
  let title = "";
  let requestName = "";
  let requestMethod = "";
  let requestUrl = "";
  let section = "";

  const flushRequest = () => {
    if (!requestMethod || !requestUrl) return;
    endpoints.push({
      method: requestMethod.toUpperCase(),
      path: clampSingleLine(requestUrl, 220),
      name: requestName ? clampSingleLine(requestName, 120) : undefined,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sectionMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*\{$/);
    if (sectionMatch?.[1]) {
      section = sectionMatch[1].toLowerCase();
      continue;
    }
    if (trimmed === "}") {
      section = "";
      continue;
    }
    const pairMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
    if (!pairMatch?.[1] || !pairMatch[2]) continue;
    const key = pairMatch[1].toLowerCase();
    const value = cleanBrunoScalar(pairMatch[2]);
    if (section === "meta" && key === "name") {
      title = value;
      requestName = value;
    }
    if (section === "http" && key === "method") requestMethod = value;
    if (section === "http" && key === "url") requestUrl = value;
    if (section === "auth" && key === "mode" && value && value.toLowerCase() !== "none") {
      security.add(value.toLowerCase());
    }
    if (endpoints.length >= MAX_BRUNO_COLLECTION_ITEM_PREVIEW) break;
  }
  flushRequest();
  return {
    format: "Bruno request",
    title,
    servers: extractPostmanServers(endpoints),
    endpoints,
    security: [...security].slice(0, MAX_API_SECURITY_PREVIEW),
  };
}

function cleanBrunoScalar(value: string): string {
  return clampSingleLine(value.replace(/^['"]|['"]$/g, ""), 180);
}

function cleanYamlScalar(value: string): string {
  return clampSingleLine(value.replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, ""), 160);
}

interface KubernetesResourcePreview {
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  containers: string[];
  images: string[];
  references: string[];
}

interface KubernetesManifestPreview {
  format: string;
  resources: KubernetesResourcePreview[];
  truncated: boolean;
}

interface KubernetesPackageConfigPreview {
  format: string;
  name: string;
  version: string;
  apiVersion: string;
  appVersion: string;
  chartType: string;
  dependencies: string[];
  resources: string[];
  images: string[];
  patches: string[];
  namespaces: string[];
  truncated: boolean;
}

function summarizeKubernetesPackageConfigFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_KUBERNETES_PACKAGE_CONFIG_PREVIEW_BYTES).toString("utf8");
    const preview = parseKubernetesPackageConfigPreview(filePath, extension, raw);
    return [
      `Kubernetes package config preview (${preview.format}, ${formatBytes(size)}).`,
      preview.name ? `Name: ${preview.name}.` : "Name: none detected in the bounded local preview.",
      preview.version ? `Version: ${preview.version}.` : "",
      preview.apiVersion ? `API version: ${preview.apiVersion}.` : "",
      preview.appVersion ? `App version: ${preview.appVersion}.` : "",
      preview.chartType ? `Chart type: ${preview.chartType}.` : "",
      preview.dependencies.length > 0
        ? `Dependencies (${preview.dependencies.length}${preview.dependencies.length >= MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${preview.dependencies.join(" | ")}.`
        : "Dependencies: none detected in the bounded local preview.",
      preview.resources.length > 0
        ? `Resources (${preview.resources.length}${preview.resources.length >= MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${preview.resources.join(", ")}.`
        : "Resources: none detected in the bounded local preview.",
      preview.images.length > 0
        ? `Images (${preview.images.length}${preview.images.length >= MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${preview.images.join(" | ")}.`
        : "Images: none detected in the bounded local preview.",
      preview.patches.length > 0
        ? `Patches (${preview.patches.length}${preview.patches.length >= MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW ? "+" : ""}): ${preview.patches.join(", ")}.`
        : "Patches: none detected in the bounded local preview.",
      preview.namespaces.length > 0
        ? `Namespaces: ${preview.namespaces.join(", ")}.`
        : "Namespaces: none detected in the bounded local preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_KUBERNETES_PACKAGE_CONFIG_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; Helm/Kustomize metadata was parsed from bounded workspace-local YAML only, secret-looking values were redacted, and no helm/kubectl/kustomize command, chart dependency build, template rendering, cluster connection, registry lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Kubernetes package config file ready for explicit attachment (${formatBytes(size)}).`,
      "No helm/kubectl/kustomize command, chart dependency build, template rendering, cluster connection, registry lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseKubernetesPackageConfigPreview(
  filePath: string,
  extension: string,
  raw: string,
): KubernetesPackageConfigPreview {
  const lines = normalizeTextPreview(raw).split("\n");
  const name = basename(filePath).toLowerCase();
  if (extension === ".helm-chart.yaml" || name === "chart.yaml" || name === "chart.yml") {
    return {
      format: "Helm Chart.yaml",
      name: readTopLevelYamlScalar(lines, "name"),
      version: readTopLevelYamlScalar(lines, "version"),
      apiVersion: readTopLevelYamlScalar(lines, "apiVersion"),
      appVersion: readTopLevelYamlScalar(lines, "appVersion"),
      chartType: readTopLevelYamlScalar(lines, "type"),
      dependencies: collectHelmDependencyPreviews(lines),
      resources: [],
      images: [],
      patches: [],
      namespaces: [],
      truncated: raw.length >= MAX_KUBERNETES_PACKAGE_CONFIG_PREVIEW_BYTES,
    };
  }
  return {
    format: "Kustomize kustomization",
    name: readTopLevelYamlScalar(lines, "namePrefix") || readTopLevelYamlScalar(lines, "nameSuffix"),
    version: "",
    apiVersion: readTopLevelYamlScalar(lines, "apiVersion"),
    appVersion: "",
    chartType: readTopLevelYamlScalar(lines, "kind"),
    dependencies: [],
    resources: collectYamlStringList(lines, ["resources", "bases", "components"], MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW),
    images: collectKustomizeImagePreviews(lines),
    patches: collectYamlStringList(lines, ["patches", "patchesStrategicMerge", "patchesJson6902"], MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW),
    namespaces: [readTopLevelYamlScalar(lines, "namespace")].filter(Boolean),
    truncated: raw.length >= MAX_KUBERNETES_PACKAGE_CONFIG_PREVIEW_BYTES,
  };
}

function readTopLevelYamlScalar(lines: string[], key: string): string {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.+)$`, "i");
  for (const line of lines) {
    if (/^\s/.test(line) || line.trim().startsWith("#")) continue;
    const match = line.match(pattern);
    if (match?.[1]) return sanitizeKubernetesPackageValue(match[1]);
  }
  return "";
}

function collectHelmDependencyPreviews(lines: string[]): string[] {
  const dependencies = collectYamlObjectList(lines, "dependencies", ["name", "version", "repository"], MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW);
  return dependencies.map((dependency) => {
    const parts = [
      dependency.name || "(unnamed)",
      dependency.version ? `version=${dependency.version}` : "",
      dependency.repository ? `repo=${redactHarUrl(dependency.repository)}` : "",
    ].filter(Boolean);
    return parts.join(" ");
  });
}

function collectKustomizeImagePreviews(lines: string[]): string[] {
  return collectYamlObjectList(
    lines,
    "images",
    ["name", "newName", "newTag", "digest"],
    MAX_KUBERNETES_PACKAGE_CONFIG_ITEM_PREVIEW,
  ).map((image) => {
    const target = image.newName || image.name || "(unnamed)";
    const tag = image.newTag ? `:${image.newTag}` : "";
    const digest = image.digest ? `@${image.digest}` : "";
    return image.name && image.name !== target
      ? `${image.name}=>${target}${tag}${digest}`
      : `${target}${tag}${digest}`;
  });
}

function collectYamlStringList(lines: string[], keys: string[], maxItems: number): string[] {
  const values: string[] = [];
  let activeIndent: number | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (activeIndent !== null && indent <= activeIndent && !trimmed.startsWith("-")) {
      activeIndent = null;
    }
    if (activeIndent === null) {
      const keyMatch = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!keyMatch?.[1] || !keys.includes(keyMatch[1])) continue;
      activeIndent = indent;
      if (keyMatch[2]?.trim()) values.push(sanitizeKubernetesPackageValue(keyMatch[2]));
      continue;
    }
    if (indent <= activeIndent) continue;
    const itemMatch = trimmed.match(/^-\s*(.+)$/);
    if (itemMatch?.[1]) {
      const value = itemMatch[1].includes(":")
        ? itemMatch[1].replace(/^([A-Za-z][\w-]*)\s*:\s*/, "")
        : itemMatch[1];
      values.push(sanitizeKubernetesPackageValue(value));
    }
    if (values.length >= maxItems) break;
  }
  return uniquePreviewValues(values.filter(Boolean), maxItems);
}

function collectYamlObjectList(
  lines: string[],
  key: string,
  fields: string[],
  maxItems: number,
): Record<string, string>[] {
  const objects: Record<string, string>[] = [];
  let activeIndent: number | null = null;
  let current: Record<string, string> | null = null;

  const flushCurrent = () => {
    if (current && Object.keys(current).length > 0) objects.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (activeIndent !== null && indent <= activeIndent && !trimmed.startsWith("-")) {
      flushCurrent();
      activeIndent = null;
    }
    if (activeIndent === null) {
      if (trimmed.match(new RegExp(`^${escapeRegExp(key)}\\s*:\\s*$`, "i"))) {
        activeIndent = indent;
      }
      continue;
    }
    if (indent <= activeIndent) continue;
    const listMatch = trimmed.match(/^-\s*(?:(\w[\w-]*)\s*:\s*(.+))?$/);
    if (listMatch) {
      flushCurrent();
      current = {};
      if (listMatch[1] && listMatch[2] && fields.includes(listMatch[1])) {
        current[listMatch[1]] = sanitizeKubernetesPackageValue(listMatch[2]);
      }
      if (objects.length >= maxItems) break;
      continue;
    }
    const pairMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (current && pairMatch?.[1] && pairMatch[2] && fields.includes(pairMatch[1])) {
      current[pairMatch[1]] = sanitizeKubernetesPackageValue(pairMatch[2]);
    }
  }
  flushCurrent();
  return objects.slice(0, maxItems);
}

function sanitizeKubernetesPackageValue(value: string): string {
  return clampSingleLine(maskPotentialSecretValues(redactHarUrl(cleanYamlScalar(value))), 180);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeKubernetesManifestFile(filePath: string, extension: string, size: number): string | null {
  try {
    const raw = readFileHeader(filePath, MAX_KUBERNETES_PREVIEW_BYTES).toString("utf8");
    const preview =
      extension === ".json"
        ? parseJsonKubernetesManifestPreview(raw)
        : parseYamlKubernetesManifestPreview(raw);
    if (!preview) return null;
    const resourceLines = preview.resources
      .slice(0, MAX_KUBERNETES_RESOURCE_PREVIEW)
      .map((resource, index) => {
        const namespace = resource.namespace ? ` namespace=${resource.namespace}` : "";
        const name = resource.name || "(unnamed)";
        return `- ${index + 1}. ${resource.kind}/${name}${namespace} apiVersion=${resource.apiVersion}`;
      });
    const containers = uniqueKubernetesValues(preview.resources.flatMap((resource) => resource.containers))
      .slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW);
    const images = uniqueKubernetesValues(preview.resources.flatMap((resource) => resource.images))
      .slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW);
    const references = uniqueKubernetesValues(preview.resources.flatMap((resource) => resource.references))
      .slice(0, MAX_KUBERNETES_REFERENCE_PREVIEW);
    return [
      `Kubernetes manifest preview (${formatBytes(size)}).`,
      `Format: ${preview.format}.`,
      `Resources: ${preview.resources.length}${preview.resources.length > resourceLines.length ? `; showing first ${resourceLines.length}` : ""}; kinds: ${summarizeCounts(preview.resources.map((resource) => resource.kind)) || "none detected"}.`,
      resourceLines.length > 0
        ? `Resource samples:\n${resourceLines.join("\n")}`
        : "Resource samples: none detected in the bounded local preview.",
      containers.length > 0
        ? `Container names: ${containers.join(", ")}.`
        : "Container names: none detected in the bounded local preview.",
      images.length > 0
        ? `Container images: ${images.join(", ")}.`
        : "Container images: none detected in the bounded local preview.",
      references.length > 0
        ? `Config/secret/storage references: ${references.join(", ")}.`
        : "Config/secret/storage references: none detected in the bounded local preview.",
      preview.truncated ? `Kubernetes preview was capped at ${formatBytes(MAX_KUBERNETES_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; Kubernetes manifest metadata was parsed from bounded local JSON/YAML text only, secret values were not expanded, and no kubectl command, cluster connection, manifest apply, image pull, registry lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return null;
  }
}

function parseJsonKubernetesManifestPreview(raw: string): KubernetesManifestPreview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  const resources = collectJsonKubernetesResources(parsed)
    .map(readJsonKubernetesResourcePreview)
    .filter((resource): resource is KubernetesResourcePreview => Boolean(resource))
    .slice(0, MAX_KUBERNETES_RESOURCE_PREVIEW);
  if (resources.length === 0) return null;
  return {
    format: "Kubernetes JSON manifest",
    resources,
    truncated: raw.length >= MAX_KUBERNETES_PREVIEW_BYTES,
  };
}

function collectJsonKubernetesResources(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonKubernetesResources).slice(0, MAX_KUBERNETES_RESOURCE_PREVIEW);
  }
  if (!isPlainRecord(value)) return [];
  if (
    readRecordString(value, "kind").toLowerCase() === "list" &&
    Array.isArray(value.items)
  ) {
    return value.items.flatMap(collectJsonKubernetesResources).slice(0, MAX_KUBERNETES_RESOURCE_PREVIEW);
  }
  if (readRecordString(value, "apiVersion") && readRecordString(value, "kind")) {
    return [value];
  }
  return [];
}

function readJsonKubernetesResourcePreview(record: Record<string, unknown>): KubernetesResourcePreview | null {
  const apiVersion = readRecordString(record, "apiVersion");
  const kind = readRecordString(record, "kind");
  if (!apiVersion || !kind) return null;
  const metadata = isPlainRecord(record.metadata) ? record.metadata : {};
  const containers = new Set<string>();
  const images = new Set<string>();
  const references = new Set<string>();
  collectJsonKubernetesWorkloadHints(record, containers, images, references, 0);
  return {
    apiVersion: clampSingleLine(apiVersion, 80),
    kind: clampSingleLine(kind, 80),
    name: clampSingleLine(readRecordString(metadata, "name"), 120),
    namespace: clampSingleLine(readRecordString(metadata, "namespace"), 120),
    containers: [...containers].slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW),
    images: [...images].slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW),
    references: [...references].slice(0, MAX_KUBERNETES_REFERENCE_PREVIEW),
  };
}

function collectJsonKubernetesWorkloadHints(
  value: unknown,
  containers: Set<string>,
  images: Set<string>,
  references: Set<string>,
  depth: number,
): void {
  if (depth > 10 || (!isPlainRecord(value) && !Array.isArray(value))) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) {
      collectJsonKubernetesWorkloadHints(item, containers, images, references, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (["containers", "initContainers", "ephemeralContainers"].includes(key) && Array.isArray(child)) {
      for (const item of child.slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW)) {
        if (!isPlainRecord(item)) continue;
        const name = readRecordString(item, "name");
        const image = readRecordString(item, "image");
        if (name) containers.add(clampSingleLine(name, 120));
        if (image) images.add(clampSingleLine(image, 180));
      }
    }
    if (["secretName", "configMapName", "claimName", "serviceAccountName"].includes(key) && typeof child === "string") {
      references.add(`${key}:${clampSingleLine(child, 120)}`);
    }
    if (["secretRef", "configMapRef"].includes(key) && isPlainRecord(child)) {
      const name = readRecordString(child, "name");
      if (name) references.add(`${key}:${clampSingleLine(name, 120)}`);
    }
    collectJsonKubernetesWorkloadHints(child, containers, images, references, depth + 1);
    if (
      containers.size >= MAX_KUBERNETES_CONTAINER_PREVIEW &&
      images.size >= MAX_KUBERNETES_CONTAINER_PREVIEW &&
      references.size >= MAX_KUBERNETES_REFERENCE_PREVIEW
    ) return;
  }
}

function parseYamlKubernetesManifestPreview(raw: string): KubernetesManifestPreview | null {
  const text = normalizeTextPreview(raw);
  if (!/^\s*apiVersion\s*:/im.test(text) || !/^\s*kind\s*:/im.test(text)) return null;
  const docs = text
    .split(/\n---[ \t]*(?:\n|$)/)
    .map((doc) => doc.trim())
    .filter(Boolean);
  const resources = docs
    .map(readYamlKubernetesResourcePreview)
    .filter((resource): resource is KubernetesResourcePreview => Boolean(resource))
    .slice(0, MAX_KUBERNETES_RESOURCE_PREVIEW);
  if (resources.length === 0) return null;
  return {
    format: "Kubernetes YAML manifest",
    resources,
    truncated: raw.length >= MAX_KUBERNETES_PREVIEW_BYTES || docs.length > resources.length,
  };
}

function readYamlKubernetesResourcePreview(doc: string): KubernetesResourcePreview | null {
  const lines = doc.split("\n");
  let apiVersion = "";
  let kind = "";
  let name = "";
  let namespace = "";
  let metadataIndent: number | null = null;
  let containerIndent: number | null = null;
  let referenceContext: { key: string; indent: number } | null = null;
  const containers = new Set<string>();
  const images = new Set<string>();
  const references = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const topApiVersion = line.match(/^apiVersion\s*:\s*(.+)$/);
    const topKind = line.match(/^kind\s*:\s*(.+)$/);
    if (!apiVersion && topApiVersion?.[1]) apiVersion = cleanYamlScalar(topApiVersion[1]);
    if (!kind && topKind?.[1]) kind = cleanYamlScalar(topKind[1]);

    if (/^metadata\s*:\s*(?:#.*)?$/.test(trimmed)) {
      metadataIndent = indent;
      continue;
    }
    if (metadataIndent !== null && indent <= metadataIndent && !/^metadata\s*:/.test(trimmed)) {
      metadataIndent = null;
    }
    if (metadataIndent !== null && indent > metadataIndent) {
      const metadataName = trimmed.match(/^name\s*:\s*(.+)$/);
      const metadataNamespace = trimmed.match(/^namespace\s*:\s*(.+)$/);
      if (!name && metadataName?.[1]) name = cleanYamlScalar(metadataName[1]);
      if (!namespace && metadataNamespace?.[1]) namespace = cleanYamlScalar(metadataNamespace[1]);
    }

    if (/^(containers|initContainers|ephemeralContainers)\s*:\s*(?:#.*)?$/.test(trimmed)) {
      containerIndent = indent;
      continue;
    }
    if (containerIndent !== null && indent <= containerIndent && !/^(containers|initContainers|ephemeralContainers)\s*:/.test(trimmed)) {
      containerIndent = null;
    }
    if (containerIndent !== null && indent > containerIndent) {
      const containerName = trimmed.match(/^-\s*name\s*:\s*(.+)$/);
      const image = trimmed.match(/^image\s*:\s*(.+)$/);
      if (containerName?.[1]) containers.add(cleanYamlScalar(containerName[1]));
      if (image?.[1]) images.add(cleanYamlScalar(image[1]));
    }

    const directReference = trimmed.match(/^(secretName|configMapName|claimName|serviceAccountName)\s*:\s*(.+)$/);
    if (directReference?.[1] && directReference[2]) {
      references.add(`${directReference[1]}:${cleanYamlScalar(directReference[2])}`);
    }
    const nestedReference = trimmed.match(/^(secretRef|configMapRef)\s*:\s*(?:#.*)?$/);
    if (nestedReference?.[1]) {
      referenceContext = { key: nestedReference[1], indent };
      continue;
    }
    if (referenceContext && indent <= referenceContext.indent) {
      referenceContext = null;
    }
    if (referenceContext && indent > referenceContext.indent) {
      const referenceName = trimmed.match(/^name\s*:\s*(.+)$/);
      if (referenceName?.[1]) {
        references.add(`${referenceContext.key}:${cleanYamlScalar(referenceName[1])}`);
      }
    }
  }

  if (!apiVersion || !kind) return null;
  return {
    apiVersion,
    kind,
    name,
    namespace,
    containers: [...containers].slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW),
    images: [...images].slice(0, MAX_KUBERNETES_CONTAINER_PREVIEW),
    references: [...references].slice(0, MAX_KUBERNETES_REFERENCE_PREVIEW),
  };
}

function uniqueKubernetesValues(values: string[]): string[] {
  return [...new Set(values.map((value) => clampSingleLine(value, 180)).filter(Boolean))];
}

interface RestClientRequestPreview {
  name?: string;
  method: string;
  target: string;
}

interface RestClientPreview {
  requests: RestClientRequestPreview[];
  headerNames: string[];
  variables: string[];
  truncated: boolean;
}

function summarizeRestClientRequestFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_REST_CLIENT_PREVIEW_BYTES).toString("utf8");
    const preview = parseRestClientRequestPreview(raw);
    const requestText =
      preview.requests.length > 0
        ? preview.requests
            .slice(0, MAX_REST_CLIENT_REQUEST_PREVIEW)
            .map((request) =>
              `${request.name ? `${request.name}: ` : ""}${request.method} ${redactRestClientTarget(request.target)}`,
            )
            .join(" | ")
        : "none detected in the bounded local preview";
    const headerText =
      preview.headerNames.length > 0
        ? preview.headerNames.slice(0, MAX_REST_CLIENT_HEADER_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const variableText =
      preview.variables.length > 0
        ? preview.variables.slice(0, MAX_REST_CLIENT_VARIABLE_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    return [
      `REST Client request file preview (${formatBytes(size)}).`,
      `Requests (${preview.requests.length}${preview.requests.length >= MAX_REST_CLIENT_REQUEST_PREVIEW ? "+" : ""}): ${requestText}.`,
      `Header names (${preview.headerNames.length}${preview.headerNames.length >= MAX_REST_CLIENT_HEADER_PREVIEW ? "+" : ""}): ${headerText}.`,
      `Variable references (${preview.variables.length}${preview.variables.length >= MAX_REST_CLIENT_VARIABLE_PREVIEW ? "+" : ""}): ${variableText}.`,
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_REST_CLIENT_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; REST Client metadata was parsed from bounded workspace-local text only, request bodies and secret-shaped values were not expanded, and no HTTP request execution, mock server startup, environment file loading, credential lookup, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `REST Client request file ready for explicit attachment (${formatBytes(size)}).`,
      "REST Client preview could not read bounded local text; no HTTP request execution, mock server startup, environment file loading, credential lookup, network call, or provider send was performed.",
    ].join("\n");
  }
}

function parseRestClientRequestPreview(raw: string): RestClientPreview {
  const text = normalizeRestClientPreview(raw);
  const lines = text.split("\n");
  const requests: RestClientRequestPreview[] = [];
  const headerNames = new Set<string>();
  const variables = new Set<string>();
  let pendingName: string | undefined;
  let inHeadersForRequest = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inHeadersForRequest = false;
      continue;
    }

    const nameMatch = trimmed.match(/^#{3,}\s*@?name\s+(.+)$/i) || trimmed.match(/^#\s*@name\s+(.+)$/i);
    if (nameMatch?.[1]) {
      pendingName = clampSingleLine(nameMatch[1], 80);
      continue;
    }

    for (const variableMatch of trimmed.matchAll(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g)) {
      variables.add(clampSingleLine(variableMatch[1], 80));
      if (variables.size >= MAX_REST_CLIENT_VARIABLE_PREVIEW) break;
    }

    const requestMatch = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+([^\s#]+)(?:\s+HTTP\/\d(?:\.\d)?)?/i);
    if (requestMatch?.[1] && requestMatch[2]) {
      requests.push({
        name: pendingName,
        method: requestMatch[1].toUpperCase(),
        target: clampSingleLine(requestMatch[2], 220),
      });
      pendingName = undefined;
      inHeadersForRequest = true;
      if (requests.length >= MAX_REST_CLIENT_REQUEST_PREVIEW) continue;
    } else if (/^#{3,}/.test(trimmed)) {
      inHeadersForRequest = false;
      pendingName = undefined;
      continue;
    }

    if (inHeadersForRequest) {
      const headerMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*)\s*:/);
      if (headerMatch?.[1]) {
        headerNames.add(headerMatch[1]);
        if (headerNames.size >= MAX_REST_CLIENT_HEADER_PREVIEW) continue;
      }
    }
  }

  return {
    requests: requests.slice(0, MAX_REST_CLIENT_REQUEST_PREVIEW),
    headerNames: [...headerNames].slice(0, MAX_REST_CLIENT_HEADER_PREVIEW),
    variables: [...variables].slice(0, MAX_REST_CLIENT_VARIABLE_PREVIEW),
    truncated:
      raw.length >= MAX_REST_CLIENT_PREVIEW_BYTES ||
      requests.length >= MAX_REST_CLIENT_REQUEST_PREVIEW ||
      headerNames.size >= MAX_REST_CLIENT_HEADER_PREVIEW ||
      variables.size >= MAX_REST_CLIENT_VARIABLE_PREVIEW,
  };
}

function normalizeRestClientPreview(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .slice(0, MAX_REST_CLIENT_PREVIEW_BYTES);
}

function redactRestClientTarget(target: string): string {
  return target
    .replace(/([?&][^=&#]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|auth|session|cookie|signature)[^=&#]*=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
}

interface GraphqlPreview {
  operations: string[];
  types: string[];
  directives: string[];
  rootFields: string[];
}

function summarizeGraphqlFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_GRAPHQL_PREVIEW_BYTES).toString("utf8");
    const preview = parseGraphqlPreview(raw);
    const operationText =
      preview.operations.length > 0
        ? preview.operations.slice(0, MAX_GRAPHQL_OPERATION_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const typeText =
      preview.types.length > 0
        ? preview.types.slice(0, MAX_GRAPHQL_TYPE_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const directiveText =
      preview.directives.length > 0
        ? preview.directives.slice(0, MAX_GRAPHQL_DIRECTIVE_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const fieldText =
      preview.rootFields.length > 0
        ? preview.rootFields.slice(0, MAX_GRAPHQL_TYPE_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    return [
      `GraphQL schema/query preview (${formatBytes(size)}).`,
      `Operations: ${operationText}.`,
      `Schema/type hints: ${typeText}.`,
      `Directive hints: ${directiveText}.`,
      `Root field hints: ${fieldText}.`,
      "Ready for explicit attachment after visible review; GraphQL metadata was parsed from bounded local text only, comments were ignored, and no request execution, mock server startup, schema introspection, credential lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `GraphQL file ready for explicit attachment (${formatBytes(size)}).`,
      "GraphQL preview could not read bounded local text; no request execution, mock server startup, schema introspection, credential lookup, network call, or provider send was performed.",
    ].join("\n");
  }
}

function parseGraphqlPreview(raw: string): GraphqlPreview {
  const text = stripGraphqlComments(normalizeTextPreview(raw));
  const operations = uniquePreviewMatches(
    text,
    /\b(query|mutation|subscription)\b(?:\s+([_A-Za-z][_0-9A-Za-z]*))?/g,
    (match) => `${match[1]}${match[2] ? ` ${match[2]}` : " anonymous"}`,
    MAX_GRAPHQL_OPERATION_PREVIEW * 2,
  );
  const types = uniquePreviewMatches(
    text,
    /\b(type|interface|input|enum|union|scalar)\s+([_A-Za-z][_0-9A-Za-z]*)/g,
    (match) => `${match[1]} ${match[2]}`,
    MAX_GRAPHQL_TYPE_PREVIEW * 2,
  );
  const directives = uniquePreviewMatches(
    text,
    /\bdirective\s+@([_A-Za-z][_0-9A-Za-z]*)/g,
    (match) => `@${match[1]}`,
    MAX_GRAPHQL_DIRECTIVE_PREVIEW * 2,
  );
  const rootFields = collectGraphqlRootFields(text);
  return { operations, types, directives, rootFields };
}

function stripGraphqlComments(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/(^|[^"\\])#.*/, "$1"))
    .join("\n");
}

function uniquePreviewMatches(
  text: string,
  pattern: RegExp,
  format: (match: RegExpExecArray) => string,
  limit: number,
): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    values.add(clampSingleLine(format(match), 120));
    if (values.size >= limit) break;
  }
  return [...values];
}

function collectGraphqlRootFields(text: string): string[] {
  const fields = new Set<string>();
  const rootTypePattern = /\btype\s+(Query|Mutation|Subscription)\s*(?:implements\s+[^{]+)?\{([\s\S]*?)\}/g;
  for (const match of text.matchAll(rootTypePattern)) {
    const rootName = match[1];
    const body = match[2] || "";
    for (const fieldMatch of body.matchAll(/^\s*([_A-Za-z][_0-9A-Za-z]*)\s*(?:\([^)]*\))?\s*:/gm)) {
      fields.add(`${rootName}.${fieldMatch[1]}`);
      if (fields.size >= MAX_GRAPHQL_TYPE_PREVIEW * 2) return [...fields];
    }
  }
  return [...fields];
}

interface ProtobufSchemaPreview {
  syntaxVersions: string[];
  packages: string[];
  imports: string[];
  messages: string[];
  enums: string[];
  services: string[];
  rpcs: string[];
  options: string[];
  fields: string[];
  truncated: boolean;
}

function summarizeProtobufSchemaFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_PROTOBUF_PREVIEW_BYTES)).toString("utf8");
    const preview = parseProtobufSchemaPreview(raw);
    const packages = preview.packages.length > 0 ? preview.packages.join(", ") : "none detected";
    const imports = preview.imports.length > 0 ? preview.imports.join(", ") : "none detected";
    const messages = preview.messages.length > 0 ? preview.messages.join(", ") : "none detected";
    const enums = preview.enums.length > 0 ? preview.enums.join(", ") : "none detected";
    const services = preview.services.length > 0 ? preview.services.join(", ") : "none detected";
    const rpcs = preview.rpcs.length > 0 ? preview.rpcs.join(" | ") : "none detected";
    const fields = preview.fields.length > 0 ? preview.fields.join(" | ") : "none detected";
    const options = preview.options.length > 0 ? preview.options.join(", ") : "none detected";
    return [
      `Protobuf/gRPC schema preview (${formatBytes(size)}).`,
      `Syntax: ${preview.syntaxVersions.join(", ") || "none detected"}; packages: ${packages}.`,
      `Imports (${preview.imports.length}${preview.imports.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${imports}.`,
      `Messages (${preview.messages.length}${preview.messages.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${messages}.`,
      `Enums (${preview.enums.length}${preview.enums.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${enums}.`,
      `Services (${preview.services.length}${preview.services.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${services}.`,
      `RPC methods (${preview.rpcs.length}${preview.rpcs.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${rpcs}.`,
      `Field samples (${preview.fields.length}${preview.fields.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${fields}.`,
      `Options (${preview.options.length}${preview.options.length >= MAX_PROTOBUF_ITEM_PREVIEW ? "+" : ""}): ${options}.`,
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_PROTOBUF_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; protobuf metadata was parsed from bounded local text only, comments were ignored, imports were not resolved, and no protoc/buf/grpcurl command, code generation, descriptor compilation, gRPC server/client startup, network call, credential lookup, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Protobuf schema file ready for explicit attachment (${formatBytes(size)}).`,
      "Protobuf preview could not read bounded local text; no protoc/buf/grpcurl command, code generation, descriptor compilation, gRPC server/client startup, network call, credential lookup, or provider send was performed.",
    ].join("\n");
  }
}

function parseProtobufSchemaPreview(raw: string): ProtobufSchemaPreview {
  const text = stripProtobufComments(normalizeTextPreview(raw));
  const syntaxVersions = uniquePreviewMatches(
    text,
    /\bsyntax\s*=\s*"([^"]+)"/g,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const packages = uniquePreviewMatches(
    text,
    /^\s*package\s+([A-Za-z_][\w.]*);/gm,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const imports = uniquePreviewMatches(
    text,
    /^\s*import\s+(?:(public|weak)\s+)?"([^"]+)";/gm,
    (match) => `${match[1] ? `${match[1]} ` : ""}${match[2]}`,
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const messages = uniquePreviewMatches(
    text,
    /^\s*message\s+([A-Za-z_]\w*)\s*\{/gm,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const enums = uniquePreviewMatches(
    text,
    /^\s*enum\s+([A-Za-z_]\w*)\s*\{/gm,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const services = uniquePreviewMatches(
    text,
    /^\s*service\s+([A-Za-z_]\w*)\s*\{/gm,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const rpcs = uniquePreviewMatches(
    text,
    /^\s*rpc\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*returns\s*\(([^)]*)\)/gm,
    (match) => `${match[1]}(${clampSingleLine(match[2], 60)}) returns (${clampSingleLine(match[3], 60)})`,
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const options = uniquePreviewMatches(
    text,
    /^\s*option\s+([A-Za-z_][\w.()]*)\s*=/gm,
    (match) => match[1],
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  const fields = uniquePreviewMatches(
    text,
    /^\s*(?:(optional|required|repeated)\s+)?(map<[^>]+>|[A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*(\d+)/gm,
    (match) => `${match[1] ? `${match[1]} ` : ""}${clampSingleLine(match[2], 60)} ${match[3]} = ${match[4]}`,
    MAX_PROTOBUF_ITEM_PREVIEW,
  );
  return {
    syntaxVersions,
    packages,
    imports,
    messages,
    enums,
    services,
    rpcs,
    options,
    fields,
    truncated:
      raw.length >= MAX_PROTOBUF_PREVIEW_BYTES ||
      imports.length >= MAX_PROTOBUF_ITEM_PREVIEW ||
      messages.length >= MAX_PROTOBUF_ITEM_PREVIEW ||
      services.length >= MAX_PROTOBUF_ITEM_PREVIEW ||
      rpcs.length >= MAX_PROTOBUF_ITEM_PREVIEW ||
      fields.length >= MAX_PROTOBUF_ITEM_PREVIEW,
  };
}

function stripProtobufComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*/, "$1"))
    .join("\n");
}

interface GeospatialPreview {
  format: string;
  featureCount: number;
  geometryTypes: string[];
  names: string[];
  coordinateSamples: string[];
  bounds?: string;
  truncated: boolean;
}

function summarizeGeospatialFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_GEOSPATIAL_PREVIEW_BYTES)).toString("utf8");
    const preview =
      extension === ".geojson" || extension === ".topojson"
        ? parseJsonGeospatialPreview(raw, extension)
        : parseXmlGeospatialPreview(raw, extension);
    if (!preview) {
      return [
        `Geospatial file ready for explicit attachment (${formatBytes(size)}).`,
        "No supported GeoJSON/TopoJSON/GPX/KML structure was recognized in the bounded local preview.",
        "Geospatial preview read bounded workspace-local text only; no map renderer, tile fetch, location service, route optimization, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
    return [
      `Geospatial preview (${preview.format}, ${formatBytes(size)}).`,
      `Features: ${preview.featureCount}${preview.featureCount >= MAX_GEOSPATIAL_FEATURE_PREVIEW ? "+" : ""}.`,
      `Geometry types: ${preview.geometryTypes.join(", ") || "none detected"}.`,
      preview.bounds ? `Bounds: ${preview.bounds}.` : "Bounds: not available in bounded preview.",
      preview.names.length > 0 ? `Names: ${preview.names.join(" | ")}.` : "Names: none detected.",
      preview.coordinateSamples.length > 0
        ? `Coordinate samples: ${preview.coordinateSamples.join(" | ")}.`
        : "Coordinate samples: none detected.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_GEOSPATIAL_PREVIEW_BYTES)} or item limits.` : "",
      "Ready for explicit attachment after visible review; geospatial metadata was parsed from bounded workspace-local text only, with no map renderer, tile fetch, location service, route optimization, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Geospatial file ready for explicit attachment (${formatBytes(size)}).`,
      "Geospatial preview read bounded local bytes only; no map renderer, tile fetch, location service, route optimization, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseJsonGeospatialPreview(raw: string, extension: string): GeospatialPreview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = readRecordString(parsed, "type");
  if (
    extension === ".geojson" &&
    ![
      "FeatureCollection",
      "Feature",
      "Point",
      "LineString",
      "Polygon",
      "MultiPoint",
      "MultiLineString",
      "MultiPolygon",
      "GeometryCollection",
    ].includes(type)
  ) {
    return null;
  }
  if (extension === ".topojson" && type !== "Topology") return null;

  const geometryTypes = new Set<string>();
  const names = new Set<string>();
  const coordinateSamples: string[] = [];
  const bounds = createGeospatialBounds();
  let featureCount = 0;
  let truncated = raw.length >= MAX_GEOSPATIAL_PREVIEW_BYTES;

  if (type === "Topology") {
    const objects = isRecord(parsed.objects) ? Object.entries(parsed.objects) : [];
    featureCount = objects.length;
    for (const [name, object] of objects.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
      names.add(clampSingleLine(name, 120));
      collectGeoJsonGeometryPreview(object, geometryTypes, names, coordinateSamples, bounds);
    }
    collectTopoJsonArcSamples(parsed.arcs, coordinateSamples, bounds);
    truncated = truncated || objects.length > MAX_GEOSPATIAL_FEATURE_PREVIEW;
  } else if (type === "FeatureCollection" && Array.isArray(parsed.features)) {
    featureCount = parsed.features.length;
    for (const feature of parsed.features.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
      collectGeoJsonGeometryPreview(feature, geometryTypes, names, coordinateSamples, bounds);
    }
    truncated = truncated || parsed.features.length > MAX_GEOSPATIAL_FEATURE_PREVIEW;
  } else {
    featureCount = 1;
    collectGeoJsonGeometryPreview(parsed, geometryTypes, names, coordinateSamples, bounds);
  }

  return {
    format: type === "Topology" ? "TopoJSON" : "GeoJSON",
    featureCount,
    geometryTypes: [...geometryTypes].slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW),
    names: [...names].slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW),
    coordinateSamples,
    bounds: formatGeospatialBounds(bounds),
    truncated,
  };
}

function collectGeoJsonGeometryPreview(
  value: unknown,
  geometryTypes: Set<string>,
  names: Set<string>,
  coordinateSamples: string[],
  bounds: GeospatialBounds,
): void {
  if (!isRecord(value)) return;
  const type = readRecordString(value, "type");
  if (type) geometryTypes.add(type);
  const properties = isRecord(value.properties) ? value.properties : {};
  const name = readRecordString(properties, "name") || readRecordString(properties, "title") || readRecordString(value, "name");
  if (name) names.add(clampSingleLine(name, 120));
  if (isRecord(value.geometry)) {
    collectGeoJsonGeometryPreview(value.geometry, geometryTypes, names, coordinateSamples, bounds);
  }
  if (Array.isArray(value.geometries)) {
    for (const geometry of value.geometries.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
      collectGeoJsonGeometryPreview(geometry, geometryTypes, names, coordinateSamples, bounds);
    }
  }
  collectCoordinateArray(value.coordinates, coordinateSamples, bounds);
}

function collectTopoJsonArcSamples(value: unknown, coordinateSamples: string[], bounds: GeospatialBounds): void {
  if (!Array.isArray(value)) return;
  for (const arc of value.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
    collectCoordinateArray(arc, coordinateSamples, bounds);
    if (coordinateSamples.length >= MAX_GEOSPATIAL_COORDINATE_PREVIEW) break;
  }
}

function parseXmlGeospatialPreview(raw: string, extension: string): GeospatialPreview | null {
  const normalized = normalizeTextPreview(raw);
  if (extension === ".gpx" && !/<gpx\b/i.test(raw)) return null;
  if (extension === ".kml" && !/<kml\b/i.test(raw)) return null;
  const isGpx = extension === ".gpx";
  const geometryTypes = new Set<string>();
  const names = new Set<string>();
  const coordinateSamples: string[] = [];
  const bounds = createGeospatialBounds();
  let featureCount = 0;

  if (isGpx) {
    const pointMatches = [...raw.matchAll(/<(wpt|trkpt|rtept)\b([^>]*)>/gi)];
    featureCount = pointMatches.length;
    for (const match of pointMatches.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
      geometryTypes.add((match[1] || "point").toLowerCase());
      const attrs = readXmlAttributes(match[2] ?? "");
      addCoordinateSample(attrs.get("lon"), attrs.get("lat"), coordinateSamples, bounds);
    }
    for (const match of raw.matchAll(/<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/gi)) {
      const name = decodeXmlEntities(match[1] ?? "").replace(/\s+/g, " ").trim();
      if (name) names.add(clampSingleLine(name, 120));
      if (names.size >= MAX_GEOSPATIAL_FEATURE_PREVIEW) break;
    }
  } else {
    const placemarks = [...raw.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)];
    featureCount = placemarks.length;
    for (const placemarkMatch of placemarks.slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW)) {
      const placemark = placemarkMatch[0];
      const typeMatch = placemark.match(/<(Point|LineString|Polygon|MultiGeometry)\b/i);
      if (typeMatch?.[1]) geometryTypes.add(typeMatch[1]);
      const nameMatch = placemark.match(/<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/i);
      const name = decodeXmlEntities(nameMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
      if (name) names.add(clampSingleLine(name, 120));
      collectKmlCoordinateText(placemark, coordinateSamples, bounds);
    }
    if (placemarks.length === 0) {
      collectKmlCoordinateText(raw, coordinateSamples, bounds);
      featureCount = coordinateSamples.length > 0 ? 1 : 0;
    }
  }

  if (featureCount === 0 && coordinateSamples.length === 0 && names.size === 0) return null;
  return {
    format: isGpx ? "GPX" : "KML",
    featureCount,
    geometryTypes: [...geometryTypes].slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW),
    names: [...names].slice(0, MAX_GEOSPATIAL_FEATURE_PREVIEW),
    coordinateSamples,
    bounds: formatGeospatialBounds(bounds),
    truncated:
      raw.length >= MAX_GEOSPATIAL_PREVIEW_BYTES ||
      featureCount > MAX_GEOSPATIAL_FEATURE_PREVIEW ||
      normalized.length >= MAX_GEOSPATIAL_PREVIEW_BYTES,
  };
}

function collectKmlCoordinateText(raw: string, coordinateSamples: string[], bounds: GeospatialBounds): void {
  for (const match of raw.matchAll(/<coordinates(?:\s[^>]*)?>([\s\S]*?)<\/coordinates>/gi)) {
    const values = (match[1] ?? "").trim().split(/\s+/);
    for (const value of values) {
      const [lon, lat] = value.split(",");
      addCoordinateSample(lon, lat, coordinateSamples, bounds);
      if (coordinateSamples.length >= MAX_GEOSPATIAL_COORDINATE_PREVIEW) return;
    }
  }
}

type GeospatialBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

function createGeospatialBounds(): GeospatialBounds {
  return {
    minLon: Number.POSITIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
  };
}

function collectCoordinateArray(value: unknown, coordinateSamples: string[], bounds: GeospatialBounds): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    addCoordinateSample(value[0], value[1], coordinateSamples, bounds);
    return;
  }
  for (const child of value) {
    collectCoordinateArray(child, coordinateSamples, bounds);
    if (coordinateSamples.length >= MAX_GEOSPATIAL_COORDINATE_PREVIEW) break;
  }
}

function addCoordinateSample(
  lonValue: unknown,
  latValue: unknown,
  coordinateSamples: string[],
  bounds: GeospatialBounds,
): void {
  const lon = typeof lonValue === "number" ? lonValue : Number.parseFloat(String(lonValue ?? ""));
  const lat = typeof latValue === "number" ? latValue : Number.parseFloat(String(latValue ?? ""));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  bounds.minLon = Math.min(bounds.minLon, lon);
  bounds.minLat = Math.min(bounds.minLat, lat);
  bounds.maxLon = Math.max(bounds.maxLon, lon);
  bounds.maxLat = Math.max(bounds.maxLat, lat);
  if (coordinateSamples.length < MAX_GEOSPATIAL_COORDINATE_PREVIEW) {
    coordinateSamples.push(`${trimNumber(lon)},${trimNumber(lat)}`);
  }
}

function formatGeospatialBounds(bounds: GeospatialBounds): string | undefined {
  if (!Number.isFinite(bounds.minLon) || !Number.isFinite(bounds.minLat)) return undefined;
  return `${trimNumber(bounds.minLon)},${trimNumber(bounds.minLat)} to ${trimNumber(bounds.maxLon)},${trimNumber(bounds.maxLat)}`;
}

interface FeedDocumentPreview {
  format: "RSS" | "Atom" | "XML feed";
  title: string | null;
  siteUrl: string | null;
  updated: string | null;
  authors: string[];
  items: string[];
}

interface RobotsTxtPreview {
  userAgents: string[];
  allowed: string[];
  disallowed: string[];
  sitemaps: string[];
  crawlDelays: string[];
}

interface SitemapPreview {
  format: "sitemap urlset" | "sitemap index";
  locations: string[];
  lastModified: string[];
  changeFrequencies: string[];
  priorities: string[];
}

function summarizeWebCrawlMetadataFile(filePath: string, extension: string, size: number): string {
  try {
    if (extension === ".robots.txt") {
      const raw = readFileHeader(filePath, MAX_WEB_CRAWL_METADATA_PREVIEW_BYTES).toString("utf8");
      const preview = parseRobotsTxtPreview(raw);
      return [
        `Web crawl metadata preview (robots.txt, ${formatBytes(size)}).`,
        preview.userAgents.length > 0
          ? `User agents: ${preview.userAgents.join(", ")}.`
          : "User agents: none detected in the bounded local preview.",
        preview.disallowed.length > 0
          ? `Disallow rules (${preview.disallowed.length}${preview.disallowed.length >= MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW ? "+" : ""}): ${preview.disallowed.join(", ")}.`
          : "Disallow rules: none detected in the bounded local preview.",
        preview.allowed.length > 0 ? `Allow rules: ${preview.allowed.join(", ")}.` : "Allow rules: none detected in the bounded local preview.",
        preview.crawlDelays.length > 0 ? `Crawl delays: ${preview.crawlDelays.join(", ")}.` : "Crawl delays: none detected in the bounded local preview.",
        preview.sitemaps.length > 0 ? `Sitemaps: ${preview.sitemaps.join(", ")}.` : "Sitemaps: none detected in the bounded local preview.",
        "Ready for explicit attachment after visible review; robots.txt metadata was parsed from bounded workspace-local text only, remote URLs were not fetched, pages were not crawled, JavaScript was not executed, and no browser profile access, SEO scoring, network call, credential lookup, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }

    const raw =
      extension === ".sitemap.xml.gz"
        ? gunzipSync(readFileHeader(filePath, MAX_WEB_CRAWL_METADATA_PREVIEW_BYTES)).toString("utf8")
        : readFileHeader(filePath, MAX_WEB_CRAWL_METADATA_PREVIEW_BYTES).toString("utf8");
    const preview = parseSitemapPreview(raw);
    return [
      `Web crawl metadata preview (${preview.format}, ${formatBytes(size)}).`,
      preview.locations.length > 0
        ? `Locations (${preview.locations.length}${preview.locations.length >= MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW ? "+" : ""}): ${preview.locations.join(" | ")}.`
        : "Locations: none detected in the bounded local preview.",
      preview.lastModified.length > 0 ? `Last modified values: ${preview.lastModified.join(", ")}.` : "Last modified values: none detected in the bounded local preview.",
      preview.changeFrequencies.length > 0 ? `Change frequencies: ${preview.changeFrequencies.join(", ")}.` : "Change frequencies: none detected in the bounded local preview.",
      preview.priorities.length > 0 ? `Priorities: ${preview.priorities.join(", ")}.` : "Priorities: none detected in the bounded local preview.",
      "Ready for explicit attachment after visible review; sitemap metadata was parsed from bounded workspace-local XML only, compressed sitemap input was decompressed only from local bytes, remote URLs were not fetched, pages were not crawled, JavaScript was not executed, and no browser profile access, SEO scoring, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Web crawl metadata ready for explicit attachment (${formatBytes(size)}).`,
      "Preview could not parse bounded local robots/sitemap content; no URL fetch, crawl, JavaScript execution, browser profile access, SEO scoring, network call, credential lookup, or provider send was performed.",
    ].join("\n");
  }
}

function parseRobotsTxtPreview(raw: string): RobotsTxtPreview {
  const userAgents = new Set<string>();
  const allowed = new Set<string>();
  const disallowed = new Set<string>();
  const sitemaps = new Set<string>();
  const crawlDelays = new Set<string>();
  for (const rawLine of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.+)$/);
    if (!match?.[1]) continue;
    const key = match[1].toLowerCase();
    const value = clampSingleLine(match[2], 140);
    if (!value) continue;
    if (key === "user-agent") userAgents.add(value);
    if (key === "allow") allowed.add(value);
    if (key === "disallow") disallowed.add(value);
    if (key === "sitemap") sitemaps.add(redactUrlQuerySecrets(value));
    if (key === "crawl-delay") crawlDelays.add(value);
  }
  return {
    userAgents: [...userAgents].slice(0, MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    allowed: [...allowed].slice(0, MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    disallowed: [...disallowed].slice(0, MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    sitemaps: [...sitemaps].slice(0, MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    crawlDelays: [...crawlDelays].slice(0, MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
  };
}

function parseSitemapPreview(raw: string): SitemapPreview {
  const xml = raw.replace(/^\uFEFF/, "");
  const format = /<sitemapindex\b/i.test(xml) ? "sitemap index" : "sitemap urlset";
  return {
    format,
    locations: collectXmlTagValues(xml, "loc", MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW).map(redactUrlQuerySecrets),
    lastModified: collectXmlTagValues(xml, "lastmod", MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    changeFrequencies: collectXmlTagValues(xml, "changefreq", MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
    priorities: collectXmlTagValues(xml, "priority", MAX_WEB_CRAWL_METADATA_ITEM_PREVIEW),
  };
}

function collectXmlTagValues(xml: string, tagName: string, limit: number): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${escapeRegex(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escapeRegex(tagName)}>`, "gi");
  for (const match of xml.matchAll(pattern)) {
    const value = clampSingleLine(cleanXmlText(match[1] ?? ""), 180);
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

function cleanXmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function redactUrlQuerySecrets(value: string): string {
  return value.replace(/([?&](?:token|access_token|api[_-]?key|key|secret|password|signature|sig)=)[^&#\s]+/gi, "$1REDACTED");
}

function summarizeFeedDocumentFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_FEED_PREVIEW_BYTES).toString("utf8");
    const preview = parseFeedDocumentPreview(raw, extension);
    const authors =
      preview.authors.length > 0
        ? preview.authors.slice(0, MAX_FEED_ITEM_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const items =
      preview.items.length > 0
        ? preview.items.slice(0, MAX_FEED_ITEM_PREVIEW).join(" | ")
        : "none detected in the bounded local preview";
    return [
      `Feed document preview (${preview.format}, ${formatBytes(size)}).`,
      `Feed title: ${preview.title || "none detected in the bounded local preview"}.`,
      `Site/feed link: ${preview.siteUrl || "none detected in the bounded local preview"}.`,
      `Updated/published: ${preview.updated || "none detected in the bounded local preview"}.`,
      `Authors: ${authors}.`,
      `Entries (${preview.items.length}${preview.items.length >= MAX_FEED_ITEM_PREVIEW ? "+" : ""}): ${items}.`,
      "Ready for explicit attachment after visible review; RSS/Atom metadata was parsed from bounded workspace-local XML only, remote feed URLs were not fetched, scripts were not executed, and no browser profile access, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Feed document ready for explicit attachment (${formatBytes(size)}).`,
      "Feed preview could not parse bounded local XML; no remote feed fetch, script execution, browser profile access, network call, credential lookup, or provider send was performed.",
    ].join("\n");
  }
}

function looksLikeFeedXml(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_FEED_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return /<rss\b/i.test(raw) || /<feed\b[^>]*(?:xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["'])?/i.test(raw);
  } catch {
    return false;
  }
}

function parseFeedDocumentPreview(raw: string, extension: string): FeedDocumentPreview {
  const xml = raw.replace(/^\uFEFF/, "");
  const isAtom = extension === ".atom" || /<feed\b/i.test(xml);
  const isRss = extension === ".rss" || /<rss\b/i.test(xml) || /<channel\b/i.test(xml);
  return isAtom
    ? parseAtomFeedPreview(xml)
    : isRss
      ? parseRssFeedPreview(xml)
      : {
          format: "XML feed",
          title: firstXmlTagValue(xml, "title"),
          siteUrl: firstXmlTagValue(xml, "link"),
          updated: firstXmlTagValue(xml, "updated") || firstXmlTagValue(xml, "pubDate"),
          authors: extractFeedAuthors(xml),
          items: extractFeedItems(xml, "item"),
        };
}

function parseRssFeedPreview(xml: string): FeedDocumentPreview {
  const channel = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] ?? xml;
  return {
    format: "RSS",
    title: firstXmlTagValue(channel, "title"),
    siteUrl: firstXmlTagValue(channel, "link"),
    updated: firstXmlTagValue(channel, "lastBuildDate") || firstXmlTagValue(channel, "pubDate"),
    authors: extractFeedAuthors(channel),
    items: extractFeedItems(channel, "item"),
  };
}

function parseAtomFeedPreview(xml: string): FeedDocumentPreview {
  const feed = xml.match(/<feed\b[^>]*>([\s\S]*?)<\/feed>/i)?.[1] ?? xml;
  return {
    format: "Atom",
    title: firstXmlTagValue(feed, "title"),
    siteUrl: firstAtomLink(feed),
    updated: firstXmlTagValue(feed, "updated") || firstXmlTagValue(feed, "published"),
    authors: extractFeedAuthors(feed),
    items: extractFeedItems(feed, "entry"),
  };
}

function extractFeedItems(xml: string, tagName: "entry" | "item"): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...xml.matchAll(pattern)]
    .map((match) => {
      const item = match[1] || "";
      const title = firstXmlTagValue(item, "title") || "Untitled";
      const link = tagName === "entry" ? firstAtomLink(item) : firstXmlTagValue(item, "link");
      const date =
        firstXmlTagValue(item, "updated") ||
        firstXmlTagValue(item, "published") ||
        firstXmlTagValue(item, "pubDate");
      return clampSingleLine([title, link, date].filter(Boolean).join(" - "), 220);
    })
    .filter(Boolean)
    .slice(0, MAX_FEED_ITEM_PREVIEW);
}

function extractFeedAuthors(xml: string): string[] {
  const authors = new Set<string>();
  for (const value of readXmlLocalTagValues(xml, "author")) {
    const name = firstXmlTagValue(value, "name") || value;
    if (name) authors.add(clampSingleLine(name, 120));
    if (authors.size >= MAX_FEED_ITEM_PREVIEW) break;
  }
  for (const value of readXmlLocalTagValues(xml, "dc:creator")) {
    if (value) authors.add(clampSingleLine(value, 120));
    if (authors.size >= MAX_FEED_ITEM_PREVIEW) break;
  }
  return [...authors].slice(0, MAX_FEED_ITEM_PREVIEW);
}

function firstXmlTagValue(xml: string, tagName: string): string | null {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = xml.match(pattern);
  if (!match) return null;
  const value = decodeXmlEntities((match[1] ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return value ? clampSingleLine(value, 220) : null;
}

function firstAtomLink(xml: string): string | null {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)];
  const alternate = links.find((match) => !/\brel\s*=\s*["'](?!alternate\b)[^"']+["']/i.test(match[1] || ""));
  const attrs = alternate?.[1] || links[0]?.[1] || "";
  const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  return href ? clampSingleLine(decodeXmlEntities(href), 220) : firstXmlTagValue(xml, "link");
}

interface DevtoolsTracePreview {
  eventCount: number;
  processes: string[];
  threads: string[];
  categories: string[];
  eventNames: string[];
  longTasks: string[];
  argumentKeys: string[];
  truncated: boolean;
}

function isDevtoolsTraceFile(filePath: string, extension: string): boolean {
  if (extension === ".trace.json") return true;
  if (extension !== ".json") return false;
  const name = basename(filePath).toLowerCase();
  return name === "trace.json" || name.endsWith(".trace.json") || name.endsWith("-trace.json") || name.endsWith(".devtools.json");
}

function summarizeDevtoolsTraceFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_DEVTOOLS_TRACE_PREVIEW_BYTES).toString("utf8");
    const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const preview = parseDevtoolsTracePreview(value, raw.length >= MAX_DEVTOOLS_TRACE_PREVIEW_BYTES);
    return [
      `DevTools performance trace preview (${formatBytes(size)}).`,
      `Events in bounded sample: ${preview.eventCount}${preview.truncated ? "+" : ""}.`,
      preview.processes.length > 0
        ? `Process labels (${preview.processes.length}${preview.processes.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ? "+" : ""}): ${preview.processes.join(", ")}.`
        : "Process labels: none detected in bounded trace metadata.",
      preview.threads.length > 0
        ? `Thread labels (${preview.threads.length}${preview.threads.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ? "+" : ""}): ${preview.threads.join(", ")}.`
        : "Thread labels: none detected in bounded trace metadata.",
      preview.categories.length > 0
        ? `Categories (${preview.categories.length}${preview.categories.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ? "+" : ""}): ${preview.categories.join(", ")}.`
        : "Categories: none detected in bounded trace metadata.",
      preview.eventNames.length > 0
        ? `Event names (${preview.eventNames.length}${preview.eventNames.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ? "+" : ""}): ${preview.eventNames.join(", ")}.`
        : "Event names: none detected in bounded trace metadata.",
      preview.longTasks.length > 0
        ? `Long task/layout hints (${preview.longTasks.length}${preview.longTasks.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ? "+" : ""}): ${preview.longTasks.join(" | ")}.`
        : "Long task/layout hints: none detected in bounded trace metadata.",
      preview.argumentKeys.length > 0
        ? `Argument keys (${preview.argumentKeys.length}${preview.argumentKeys.length >= MAX_DEVTOOLS_TRACE_ARG_PREVIEW ? "+" : ""}): ${preview.argumentKeys.join(", ")}.`
        : "Argument keys: none detected in bounded trace metadata.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_DEVTOOLS_TRACE_PREVIEW_BYTES)} or event/key limits.` : "",
      "Ready for explicit attachment after visible review; DevTools trace metadata was parsed from bounded workspace-local JSON only, argument values were not expanded, token-like values were masked, and no Chrome/Edge/DevTools/Lighthouse launch, trace replay, network call, credential lookup, profiler attach, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `DevTools performance trace file ready for explicit attachment (${formatBytes(size)}).`,
      "Trace preview could not parse bounded local JSON; no Chrome/Edge/DevTools/Lighthouse launch, trace replay, network call, credential lookup, profiler attach, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseDevtoolsTracePreview(value: unknown, byteTruncated: boolean): DevtoolsTracePreview {
  const traceEventsValue = readRecordValue(value, "traceEvents");
  const traceEvents = Array.isArray(traceEventsValue) ? traceEventsValue : [];
  const events = traceEvents.filter((event): event is Record<string, unknown> =>
    Boolean(event) && typeof event === "object" && !Array.isArray(event),
  );
  const processes = new Map<string, string>();
  const threads = new Map<string, string>();
  const categories = new Set<string>();
  const eventNames = new Set<string>();
  const longTasks: string[] = [];
  const argumentKeys = new Set<string>();

  for (const event of events) {
    const pid = readTraceId(event, "pid");
    const tid = readTraceId(event, "tid");
    const name = clampSingleLine(readRecordString(event, "name"), 120);
    const category = clampSingleLine(readRecordString(event, "cat"), 160);
    const duration = readTraceNumber(event, "dur");
    const args = readRecordValue(event, "args");

    if (category) {
      for (const item of category.split(",")) {
        const clean = clampSingleLine(item.trim(), 80);
        if (clean) categories.add(clean);
        if (categories.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW) break;
      }
    }
    if (name) eventNames.add(name);

    if (isRecord(args)) {
      for (const key of Object.keys(args)) {
        const cleanKey = clampSingleLine(key, 100);
        if (cleanKey) argumentKeys.add(cleanKey);
        if (argumentKeys.size >= MAX_DEVTOOLS_TRACE_ARG_PREVIEW) break;
      }
    }

    if (name === "process_name" && pid && isRecord(args)) {
      const processName = clampSingleLine(maskPotentialSecretValues(readRecordString(args, "name")), 120);
      if (processName) processes.set(pid, `${pid}:${processName}`);
    }
    if (name === "thread_name" && pid && tid && isRecord(args)) {
      const threadName = clampSingleLine(maskPotentialSecretValues(readRecordString(args, "name")), 120);
      if (threadName) threads.set(`${pid}:${tid}`, `${pid}/${tid}:${threadName}`);
    }

    if (
      duration >= 50_000 ||
      ["Task", "RunTask", "EvaluateScript", "Layout", "UpdateLayoutTree", "Paint"].includes(name)
    ) {
      const label = [
        name || "unnamed event",
        duration ? `${Math.round(duration / 1000)}ms` : "",
        category ? `cat=${category.split(",").slice(0, 2).join(",")}` : "",
      ].filter(Boolean).join(" ");
      if (longTasks.length < MAX_DEVTOOLS_TRACE_EVENT_PREVIEW) {
        longTasks.push(clampSingleLine(maskPotentialSecretValues(label), 180));
      }
    }

    if (
      processes.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW &&
      threads.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW &&
      categories.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW &&
      eventNames.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW &&
      longTasks.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW &&
      argumentKeys.size >= MAX_DEVTOOLS_TRACE_ARG_PREVIEW
    ) {
      break;
    }
  }

  return {
    eventCount: events.length,
    processes: [...processes.values()].slice(0, MAX_DEVTOOLS_TRACE_EVENT_PREVIEW),
    threads: [...threads.values()].slice(0, MAX_DEVTOOLS_TRACE_EVENT_PREVIEW),
    categories: [...categories].slice(0, MAX_DEVTOOLS_TRACE_EVENT_PREVIEW),
    eventNames: [...eventNames].slice(0, MAX_DEVTOOLS_TRACE_EVENT_PREVIEW),
    longTasks: uniquePreviewValues(longTasks, MAX_DEVTOOLS_TRACE_EVENT_PREVIEW),
    argumentKeys: [...argumentKeys].slice(0, MAX_DEVTOOLS_TRACE_ARG_PREVIEW),
    truncated:
      byteTruncated ||
      events.length >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ||
      processes.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ||
      threads.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ||
      categories.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ||
      eventNames.size >= MAX_DEVTOOLS_TRACE_EVENT_PREVIEW ||
      argumentKeys.size >= MAX_DEVTOOLS_TRACE_ARG_PREVIEW,
  };
}

function readTraceId(record: Record<string, unknown>, key: string): string {
  const value = readRecordValue(record, key);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return clampSingleLine(value, 80);
  return "";
}

function readTraceNumber(record: Record<string, unknown>, key: string): number {
  const value = readRecordValue(record, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function uniquePreviewValues(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

interface LighthouseReportPreview {
  requestedUrl: string;
  finalUrl: string;
  lighthouseVersion: string;
  fetchTime: string;
  formFactor: string;
  userAgent: string;
  categories: string[];
  audits: string[];
  truncated: boolean;
}

function isLighthouseReportFile(filePath: string, extension: string): boolean {
  if (extension === ".lighthouse.json") return true;
  if (extension !== ".json") return false;
  const name = basename(filePath).toLowerCase();
  return (
    name === "lhr.json" ||
    name === "lighthouse.json" ||
    name.endsWith(".lhr.json") ||
    name.endsWith(".lighthouse.json") ||
    name.endsWith("-lighthouse.json")
  );
}

function summarizeLighthouseReportFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_LIGHTHOUSE_REPORT_PREVIEW_BYTES).toString("utf8");
    const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const preview = parseLighthouseReportPreview(value, raw.length >= MAX_LIGHTHOUSE_REPORT_PREVIEW_BYTES);
    return [
      `Lighthouse report preview (${formatBytes(size)}).`,
      `Requested URL: ${preview.requestedUrl || "none detected in the bounded local preview"}.`,
      `Final URL: ${preview.finalUrl || "none detected in the bounded local preview"}.`,
      `Lighthouse version: ${preview.lighthouseVersion || "unknown"}; fetched: ${preview.fetchTime || "unknown"}.`,
      `Run settings: formFactor=${preview.formFactor || "unknown"}; userAgent=${preview.userAgent || "unknown"}.`,
      preview.categories.length > 0
        ? `Category scores (${preview.categories.length}${preview.categories.length >= MAX_LIGHTHOUSE_CATEGORY_PREVIEW ? "+" : ""}): ${preview.categories.join(", ")}.`
        : "Category scores: none detected in the bounded local preview.",
      preview.audits.length > 0
        ? `Audit highlights (${preview.audits.length}${preview.audits.length >= MAX_LIGHTHOUSE_AUDIT_PREVIEW ? "+" : ""}): ${preview.audits.join(" | ")}.`
        : "Audit highlights: none detected in the bounded local preview.",
      preview.truncated ? `Preview was capped at ${formatBytes(MAX_LIGHTHOUSE_REPORT_PREVIEW_BYTES)} or audit/category limits.` : "",
      "Ready for explicit attachment after visible review; Lighthouse report metadata was parsed from bounded workspace-local JSON only, audit details were not expanded, token-like URL values were masked, and no Chrome/Edge/DevTools/Lighthouse launch, page audit, trace replay, network call, credential lookup, profiler attach, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Lighthouse report file ready for explicit attachment (${formatBytes(size)}).`,
      "Lighthouse preview could not parse bounded local JSON; no Chrome/Edge/DevTools/Lighthouse launch, page audit, trace replay, network call, credential lookup, profiler attach, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseLighthouseReportPreview(value: unknown, byteTruncated: boolean): LighthouseReportPreview {
  const root: Record<string, unknown> = isRecord(value) ? value : {};
  const configSettings = readRecordValue(root, "configSettings");
  const environment = readRecordValue(root, "environment");
  const categoriesValue = readRecordValue(root, "categories");
  const auditsValue = readRecordValue(root, "audits");
  const categories = isRecord(categoriesValue)
    ? Object.entries(categoriesValue)
        .slice(0, MAX_LIGHTHOUSE_CATEGORY_PREVIEW)
        .map(([id, category]) => formatLighthouseCategory(id, category))
        .filter(Boolean)
    : [];
  const audits = isRecord(auditsValue)
    ? Object.entries(auditsValue)
        .filter(([, audit]) => shouldPreviewLighthouseAudit(audit))
        .slice(0, MAX_LIGHTHOUSE_AUDIT_PREVIEW)
        .map(([id, audit]) => formatLighthouseAudit(id, audit))
        .filter(Boolean)
    : [];

  return {
    requestedUrl: sanitizeLighthouseUrl(readRecordString(root, "requestedUrl")),
    finalUrl: sanitizeLighthouseUrl(readRecordString(root, "finalDisplayedUrl") || readRecordString(root, "finalUrl")),
    lighthouseVersion: clampSingleLine(readRecordString(root, "lighthouseVersion"), 80),
    fetchTime: clampSingleLine(readRecordString(root, "fetchTime"), 80),
    formFactor: isRecord(configSettings) ? clampSingleLine(readRecordString(configSettings, "formFactor"), 80) : "",
    userAgent: isRecord(environment) ? clampSingleLine(readRecordString(environment, "networkUserAgent"), 160) : "",
    categories,
    audits,
    truncated:
      byteTruncated ||
      categories.length >= MAX_LIGHTHOUSE_CATEGORY_PREVIEW ||
      audits.length >= MAX_LIGHTHOUSE_AUDIT_PREVIEW,
  };
}

function sanitizeLighthouseUrl(value: string): string {
  return clampSingleLine(maskPotentialSecretValues(redactUrlQuerySecrets(value)), 220);
}

function formatLighthouseCategory(id: string, value: unknown): string {
  if (!isRecord(value)) return "";
  const title = clampSingleLine(readRecordString(value, "title") || id, 80);
  const score = formatLighthouseScore(readRecordValue(value, "score"));
  return `${title}=${score}`;
}

function shouldPreviewLighthouseAudit(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const scoreDisplayMode = readRecordString(value, "scoreDisplayMode");
  const score = readRecordValue(value, "score");
  const numericValue = readRecordValue(value, "numericValue");
  if (scoreDisplayMode === "notApplicable" || scoreDisplayMode === "manual") return false;
  if (typeof score === "number" && Number.isFinite(score) && score < 0.9) return true;
  return typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0;
}

function formatLighthouseAudit(id: string, value: unknown): string {
  if (!isRecord(value)) return "";
  const title = clampSingleLine(readRecordString(value, "title") || id, 100);
  const score = formatLighthouseScore(readRecordValue(value, "score"));
  const display = clampSingleLine(maskPotentialSecretValues(readRecordString(value, "displayValue")), 80);
  return [title, `score=${score}`, display].filter(Boolean).join(" ");
}

function formatLighthouseScore(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}`;
}

function summarizeJsonDataFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_STRUCTURED_DATA_PREVIEW_BYTES).toString("utf8");
    const value = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const details = describeJsonPreview(value);
    const schemaHints = summarizeLocalConfigSchemaHints(filePath, raw, ".json", value);
    return [
      `Structured JSON preview (${formatBytes(size)}).`,
      ...details,
      schemaHints,
      "Ready for explicit attachment after visible review; no schema inference service, network call, code execution, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    try {
      const preview = readFileSync(filePath, "utf8")
        .slice(0, MAX_TEXT_BYTES - 260)
        .replace(/\s+/g, " ")
        .trim();
      return [
        `JSON data file ready for explicit attachment (${formatBytes(size)}). Structured preview was unavailable, so a bounded text preview is shown.`,
        preview || "No readable JSON text preview was found.",
        "No schema inference service, network call, code execution, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    } catch {
      return [
        `JSON data file ready for explicit attachment (${formatBytes(size)}).`,
        "No schema inference service, network call, code execution, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
  }
}

function summarizeJsonLinesDataFile(filePath: string, extension: string, size: number): string {
  const label = extension === ".ndjson" ? "NDJSON" : "JSONL";
  const previewHeading = extension === ".ndjson" ? "Structured NDJSON preview" : "Structured JSONL preview";
  try {
    const raw = readFileHeader(filePath, MAX_STRUCTURED_DATA_PREVIEW_BYTES).toString("utf8");
    const lines = raw
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const records: unknown[] = [];
    let invalidRecords = 0;
    for (const line of lines) {
      if (records.length >= MAX_JSONL_PREVIEW_RECORDS) break;
      try {
        records.push(JSON.parse(line));
      } catch {
        invalidRecords += 1;
      }
    }
    const fieldSummary = summarizeJsonLinesFields(records);
    const samples = records
      .slice(0, 4)
      .map((record, index) => {
        const serialized = JSON.stringify(record);
        return `Record ${index + 1}: ${maskPotentialSecretValues(serialized).slice(0, 260)}`;
      })
      .join("\n");
    return [
      `${previewHeading} (${formatBytes(size)}).`,
      `Records in bounded sample: ${lines.length}${raw.length >= MAX_STRUCTURED_DATA_PREVIEW_BYTES ? "; sample byte limit reached" : ""}.`,
      `Parsed preview records: ${records.length}; invalid preview lines skipped: ${invalidRecords}.`,
      fieldSummary,
      samples || "No parseable JSON-lines records were found in the bounded sample.",
      `Ready for explicit attachment after visible review; ${label} records were parsed from bounded workspace-local bytes with likely-secret redaction and no database connection, query execution, schema inference service, network call, code execution, or provider send was performed.`,
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `${label} data file ready for explicit attachment (${formatBytes(size)}).`,
      "No database connection, query execution, schema inference service, network call, code execution, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeJsonLinesFields(records: unknown[]): string {
  const objects = records.filter(
    (record): record is Record<string, unknown> =>
      Boolean(record) && typeof record === "object" && !Array.isArray(record),
  );
  if (objects.length === 0) {
    const types = summarizeCounts(records.map(describeJsonValue));
    return `Record shapes: ${types || "none detected in parsed preview records"}.`;
  }
  const fieldCounts = new Map<string, number>();
  const fieldTypes = new Map<string, Set<string>>();
  for (const record of objects) {
    for (const [key, value] of Object.entries(record)) {
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
      const types = fieldTypes.get(key) ?? new Set<string>();
      types.add(describeJsonValue(value));
      fieldTypes.set(key, types);
    }
  }
  const fields = [...fieldCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_JSONL_FIELD_PREVIEW)
    .map(([key, count]) => {
      const types = [...(fieldTypes.get(key) ?? new Set<string>())].slice(0, 3).join(" | ");
      return `${key}: ${count}/${objects.length}${types ? ` ${types}` : ""}`;
    });
  return fields.length > 0
    ? `Common fields: ${fields.join(", ")}.`
    : "Common fields: none detected in parsed object records.";
}

function summarizeColumnarDataFile(filePath: string, extension: string, size: number): string {
  try {
    const head = readFileHeader(filePath, Math.min(size, MAX_COLUMNAR_DATA_PREVIEW_BYTES));
    const tailLength = Math.min(size, MAX_COLUMNAR_DATA_PREVIEW_BYTES);
    const tail = readFileSlice(filePath, Math.max(0, size - tailLength), tailLength);
    const label =
      extension === ".parquet"
        ? "Parquet columnar data"
        : extension === ".feather"
          ? "Feather/Arrow columnar data"
          : "Arrow IPC columnar data";
    const details =
      extension === ".parquet"
        ? readParquetFilePreview(head, tail, size)
        : readArrowIpcFilePreview(head, tail, size, extension);
    const strings = extractLegacyOfficeBinaryStrings(Buffer.concat([head, tail]))
      .map(maskPotentialSecretValues)
      .filter((value) => !/^(PAR1|ARROW1|FEA1)$/i.test(value))
      .slice(0, MAX_COLUMNAR_STRING_PREVIEW);
    return [
      `${label} preview (${formatBytes(size)}).`,
      ...details,
      strings.length > 0
        ? `Readable metadata string samples (${strings.length}${strings.length >= MAX_COLUMNAR_STRING_PREVIEW ? "+" : ""}): ${strings.join(" | ")}.`
        : "Readable metadata string samples: none detected in bounded header/footer bytes.",
      "Ready for explicit attachment after visible review; columnar data preview read bounded workspace-local header/footer bytes only, did not decode row groups or record batches, and performed no DuckDB/PyArrow/Spark query, schema inference service, decompression scan, network call, code execution, or provider send.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Columnar data file ready for explicit attachment (${formatBytes(size)}).`,
      "Columnar data preview read bounded local bytes only; no DuckDB/PyArrow/Spark query, schema inference service, decompression scan, network call, code execution, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeScientificContainerFile(filePath: string, extension: string, size: number): string {
  try {
    const head = readFileHeader(filePath, Math.min(size, MAX_SCIENTIFIC_CONTAINER_PREVIEW_BYTES));
    const label =
      extension === ".nc"
        ? "NetCDF scientific data container"
        : extension === ".mat"
          ? "MATLAB MAT scientific data container"
          : "HDF5 scientific data container";
    const formatDetails =
      extension === ".nc"
        ? readNetcdfScientificContainerMetadata(head)
        : extension === ".mat"
          ? readMatlabScientificContainerMetadata(head)
          : readHdf5ScientificContainerMetadata(head);
    const stringSamples = extractLegacyOfficeBinaryStrings(head)
      .map(maskPotentialSecretValues)
      .filter((value) => value.length >= 4 && !/^(HDF|CDF)$/i.test(value))
      .slice(0, MAX_SCIENTIFIC_CONTAINER_ITEM_PREVIEW);
    return [
      `Scientific data container preview (${label}, ${formatBytes(size)}).`,
      ...formatDetails,
      stringSamples.length > 0
        ? `Readable header string samples (${stringSamples.length}${stringSamples.length >= MAX_SCIENTIFIC_CONTAINER_ITEM_PREVIEW ? "+" : ""}): ${stringSamples.join(" | ")}.`
        : "Readable header string samples: none detected in bounded local header bytes.",
      head.length >= MAX_SCIENTIFIC_CONTAINER_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_SCIENTIFIC_CONTAINER_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; scientific container metadata was parsed from bounded workspace-local header bytes only, with no HDF5/NetCDF/MATLAB runtime, Python process, dataset decoding, decompression, query execution, network call, or provider send performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Scientific data container ready for explicit attachment (${formatBytes(size)}).`,
      "Scientific container preview attempted bounded local header reads only; no HDF5/NetCDF/MATLAB runtime, Python process, dataset decoding, decompression, query execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readHdf5ScientificContainerMetadata(buffer: Buffer): string[] {
  const signatureOffset = findHdf5SignatureOffset(buffer);
  if (signatureOffset < 0) {
    return [
      "HDF5 signature: not recognized in bounded header bytes.",
      `Header byte window: first ${formatBytes(buffer.length)}.`,
    ];
  }
  const superblockVersion =
    signatureOffset + 8 < buffer.length ? buffer[signatureOffset + 8] : undefined;
  return [
    `HDF5 signature: detected at byte ${signatureOffset}.`,
    typeof superblockVersion === "number"
      ? `HDF5 superblock version hint: ${superblockVersion}.`
      : "HDF5 superblock version hint: unavailable from bounded header bytes.",
    `Header byte window: first ${formatBytes(buffer.length)}.`,
  ];
}

function readNetcdfScientificContainerMetadata(buffer: Buffer): string[] {
  const magic = buffer.subarray(0, Math.min(4, buffer.length)).toString("latin1");
  if (magic.startsWith("CDF")) {
    const variant =
      buffer[3] === 1
        ? "classic"
        : buffer[3] === 2
          ? "64-bit offset"
          : buffer[3] === 5
            ? "CDF-5"
            : `unknown variant byte ${buffer[3] ?? "unavailable"}`;
    return [
      `NetCDF signature: CDF ${variant}.`,
      `Header byte window: first ${formatBytes(buffer.length)}.`,
    ];
  }
  const hdf5 = readHdf5ScientificContainerMetadata(buffer);
  return [
    hdf5[0]?.includes("detected")
      ? "NetCDF signature: NetCDF-4/HDF5 container signature detected."
      : "NetCDF signature: not recognized in bounded header bytes.",
    ...hdf5.slice(1),
  ];
}

function readMatlabScientificContainerMetadata(buffer: Buffer): string[] {
  const description = buffer.subarray(0, Math.min(116, buffer.length)).toString("latin1").replace(/\0/g, "").trim();
  const hdf5Offset = findHdf5SignatureOffset(buffer);
  if (hdf5Offset >= 0) {
    return [
      `MATLAB MAT signature: v7.3 HDF5-compatible container detected at byte ${hdf5Offset}.`,
      `Header description: ${description ? clampSingleLine(description, 180) : "unavailable from bounded header bytes"}.`,
      `Header byte window: first ${formatBytes(buffer.length)}.`,
    ];
  }
  const looksLikeMat =
    /^MATLAB\s+[0-9.]+\s+MAT-file/i.test(description) ||
    description.toLowerCase().includes("matlab") ||
    description.toLowerCase().includes("mat-file");
  const version =
    buffer.length >= 126 ? `0x${buffer.readUInt16LE(124).toString(16).padStart(4, "0")}` : "unavailable";
  const endian = buffer.length >= 128 ? buffer.subarray(126, 128).toString("ascii") : "unavailable";
  return [
    `MATLAB MAT signature: ${looksLikeMat ? "MAT-file header detected" : "not recognized in bounded header bytes"}.`,
    `MATLAB MAT version/endian hints: version ${version}, endian ${endian}.`,
    `Header description: ${description ? clampSingleLine(description, 180) : "unavailable from bounded header bytes"}.`,
    `Header byte window: first ${formatBytes(buffer.length)}.`,
  ];
}

function findHdf5SignatureOffset(buffer: Buffer): number {
  const signature = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  const direct = buffer.subarray(0, signature.length).equals(signature);
  if (direct) return 0;
  for (let offset = 512; offset + signature.length <= buffer.length; offset *= 2) {
    if (buffer.subarray(offset, offset + signature.length).equals(signature)) return offset;
  }
  return -1;
}

function readParquetFilePreview(head: Buffer, tail: Buffer, size: number): string[] {
  const hasHeaderMagic = head.length >= 4 && head.subarray(0, 4).toString("ascii") === "PAR1";
  const hasFooterMagic = tail.length >= 4 && tail.subarray(tail.length - 4).toString("ascii") === "PAR1";
  const footerLength =
    hasFooterMagic && tail.length >= 8 ? tail.readUInt32LE(tail.length - 8) : undefined;
  const footerAvailable = typeof footerLength === "number" && footerLength <= Math.max(0, size - 8);
  return [
    `Parquet magic: header ${hasHeaderMagic ? "PAR1" : "not recognized"}, footer ${hasFooterMagic ? "PAR1" : "not recognized"}.`,
    typeof footerLength === "number"
      ? `Footer metadata length hint: ${footerLength} bytes${footerAvailable ? "" : " (larger than bounded/valid file range)"}.`
      : "Footer metadata length hint: unavailable from bounded footer bytes.",
    `Preview byte windows: first ${formatBytes(head.length)}, last ${formatBytes(tail.length)}.`,
  ];
}

function readArrowIpcFilePreview(
  head: Buffer,
  tail: Buffer,
  size: number,
  extension: string,
): string[] {
  const headerMagic = head.subarray(0, Math.min(8, head.length)).toString("ascii").replace(/\0+$/g, "");
  const trailingMagic = tail.subarray(Math.max(0, tail.length - 8)).toString("ascii").replace(/\0+$/g, "");
  const isFeatherV1 = head.length >= 4 && head.subarray(0, 4).toString("ascii") === "FEA1";
  const hasArrowHeader = headerMagic.startsWith("ARROW1");
  const arrowMagicOffset = findLastAsciiInBuffer(tail, "ARROW1");
  const footerLength =
    arrowMagicOffset >= 4 ? tail.readInt32LE(arrowMagicOffset - 4) : undefined;
  const validFooterLength =
    typeof footerLength === "number" && footerLength >= 0 && footerLength <= Math.max(0, size - 10);
  return [
    isFeatherV1
      ? "Arrow/Feather magic: Feather v1 FEA1 header detected."
      : `Arrow magic: header ${hasArrowHeader ? "ARROW1" : "not recognized"}, trailing ${trailingMagic.includes("ARROW1") ? "ARROW1" : "not recognized"}.`,
    typeof footerLength === "number"
      ? `Arrow footer length hint: ${footerLength} bytes${validFooterLength ? "" : " (outside expected bounded file range)"}.`
      : "Arrow footer length hint: unavailable from bounded footer bytes.",
    extension === ".feather"
      ? "Feather routing treats v2 files as Arrow IPC and v1 files as header-only metadata previews."
      : "Arrow IPC routing treats file-level magic/footer hints as metadata only.",
    `Preview byte windows: first ${formatBytes(head.length)}, last ${formatBytes(tail.length)}.`,
  ];
}

function findLastAsciiInBuffer(buffer: Buffer, needle: string): number {
  return buffer.toString("latin1").lastIndexOf(needle);
}

interface HarPreviewEntry {
  method: string;
  url: string;
  host: string;
  status: string;
  mimeType: string;
  timeMs: string;
  requestHeaders: string[];
  responseHeaders: string[];
}

function summarizeHarNetworkTraceFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_HAR_PREVIEW_BYTES).toString("utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const entries = extractHarEntries(parsed);
    const previewEntries = entries.slice(0, MAX_HAR_ENTRY_PREVIEW).map(readHarPreviewEntry);
    const methods = summarizeCounts(previewEntries.map((entry) => entry.method).filter(Boolean));
    const statuses = summarizeCounts(previewEntries.map((entry) => entry.status).filter(Boolean));
    const hosts = Array.from(new Set(previewEntries.map((entry) => entry.host).filter(Boolean))).slice(0, 8);
    const mimeTypes = Array.from(new Set(previewEntries.map((entry) => entry.mimeType).filter(Boolean))).slice(0, 8);
    const samples = previewEntries.map((entry, index) => summarizeHarPreviewEntry(entry, index));
    return [
      `HAR network trace preview (${formatBytes(size)}).`,
      `Entries: ${entries.length}${entries.length > previewEntries.length ? `; showing first ${previewEntries.length}` : ""}.`,
      `Methods: ${methods || "none detected"}.`,
      `Statuses: ${statuses || "none detected"}.`,
      `Hosts: ${hosts.length > 0 ? hosts.join(", ") : "none detected"}.`,
      `MIME types: ${mimeTypes.length > 0 ? mimeTypes.join(", ") : "none detected"}.`,
      samples.length > 0 ? `Request samples:\n${samples.join("\n")}` : "Request samples: none detected in the bounded HAR preview.",
      "Ready for explicit attachment after visible review; HAR JSON was parsed from a bounded local byte sample, Authorization/Cookie/token header and URL values were redacted, and no browser profile access, request replay, network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    try {
      const preview = readFileHeader(filePath, Math.min(MAX_HAR_PREVIEW_BYTES, MAX_TEXT_BYTES))
        .toString("utf8")
        .replace(/\s+/g, " ")
        .trim();
      return [
        `HAR network trace ready for explicit attachment (${formatBytes(size)}). Structured preview was unavailable from the bounded local byte sample.`,
        maskPotentialSecretValues(preview).slice(0, MAX_TEXT_BYTES - 360) || "No readable HAR text preview was found.",
        "No browser profile access, request replay, network call, credential lookup, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    } catch {
      return [
        `HAR network trace ready for explicit attachment (${formatBytes(size)}).`,
        "No browser profile access, request replay, network call, credential lookup, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }
  }
}

interface PcapPacketPreview {
  capturedLength?: number;
  originalLength?: number;
  timestamp?: string;
}

interface PcapClassicMetadata {
  format: "classic PCAP";
  endian: "BE" | "LE";
  timestampResolution: "microsecond" | "nanosecond";
  version?: string;
  snaplen?: number;
  linkType?: string;
  packets: PcapPacketPreview[];
  truncated: boolean;
}

interface PcapNgMetadata {
  format: "PCAPNG";
  endian: "BE" | "LE";
  linkTypes: string[];
  snaplens: number[];
  blockTypes: string[];
  packets: PcapPacketPreview[];
  truncated: boolean;
}

function summarizePacketCaptureFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_PCAP_PREVIEW_BYTES));
    const metadata = readPacketCaptureMetadata(buffer, extension);
    if (!metadata) {
      return [
        `Packet capture ready for explicit attachment (${formatBytes(size)}).`,
        "PCAP/PCAPNG header was not recognized in the bounded local preview.",
        "Packet capture preview read bounded local headers and record metadata only; no packet payload decoding, traffic replay, credential extraction, network call, or provider send was performed.",
      ].join("\n").slice(0, MAX_TEXT_BYTES);
    }

    const packetSummary =
      metadata.packets.length > 0
        ? metadata.packets
            .slice(0, MAX_PCAP_PACKET_PREVIEW)
            .map((packet, index) => {
              const captured =
                typeof packet.capturedLength === "number" ? `${packet.capturedLength} captured` : "unknown captured";
              const original =
                typeof packet.originalLength === "number" ? `${packet.originalLength} original` : "unknown original";
              return `${index + 1}. ${captured} / ${original}${packet.timestamp ? ` @ ${packet.timestamp}` : ""}`;
            })
            .join(" | ")
        : "No packet records were detected in the bounded local preview.";

    if (metadata.format === "classic PCAP") {
      return [
        `Packet capture preview (${metadata.format}, ${formatBytes(size)}).`,
        `Header: ${metadata.endian} endian, timestamp ${metadata.timestampResolution}, version ${metadata.version ?? "unknown"}, snaplen ${metadata.snaplen ?? "unknown"}, link type ${metadata.linkType ?? "unknown"}.`,
        `Packet records (${metadata.packets.length}${metadata.packets.length >= MAX_PCAP_PACKET_PREVIEW ? "+" : ""}): ${packetSummary}.`,
        metadata.truncated ? `Preview was capped at ${formatBytes(MAX_PCAP_PREVIEW_BYTES)} or stopped at an incomplete packet record.` : "",
        "Packet capture preview read bounded local headers and record metadata only; no packet payload decoding, traffic replay, credential extraction, network call, or provider send was performed.",
      ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
    }

    const blockSummary = metadata.blockTypes.length > 0 ? metadata.blockTypes.join(", ") : "none detected";
    const linkSummary = metadata.linkTypes.length > 0 ? metadata.linkTypes.join(", ") : "unknown";
    const snaplenSummary = metadata.snaplens.length > 0 ? metadata.snaplens.join(", ") : "unknown";
    return [
      `Packet capture preview (${metadata.format}, ${formatBytes(size)}).`,
      `Blocks: ${blockSummary}.`,
      `Interfaces: link types ${linkSummary}; snaplen values ${snaplenSummary}.`,
      `Packet records (${metadata.packets.length}${metadata.packets.length >= MAX_PCAP_PACKET_PREVIEW ? "+" : ""}): ${packetSummary}.`,
      metadata.truncated ? `Preview was capped at ${formatBytes(MAX_PCAP_PREVIEW_BYTES)} or stopped at an incomplete block.` : "",
      "Packet capture preview read bounded local block headers and packet metadata only; no packet payload decoding, traffic replay, credential extraction, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Packet capture ready for explicit attachment (${formatBytes(size)}).`,
      "Packet capture preview read bounded local bytes only; no packet payload decoding, traffic replay, credential extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readPacketCaptureMetadata(
  buffer: Buffer,
  extension: string,
): PcapClassicMetadata | PcapNgMetadata | null {
  if (buffer.length < 4) return null;
  const pcapng = readPcapNgMetadata(buffer);
  if (pcapng) return pcapng;
  const classic = readClassicPcapMetadata(buffer);
  if (classic) return classic;
  return extension === ".pcapng" ? readPcapNgMetadata(buffer) : null;
}

function readClassicPcapMetadata(buffer: Buffer): PcapClassicMetadata | null {
  if (buffer.length < 24) return null;
  const signature = [...buffer.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const settings =
    signature === "a1b2c3d4"
      ? { endian: "BE" as const, resolution: "microsecond" as const }
      : signature === "d4c3b2a1"
        ? { endian: "LE" as const, resolution: "microsecond" as const }
        : signature === "a1b23c4d"
          ? { endian: "BE" as const, resolution: "nanosecond" as const }
          : signature === "4d3cb2a1"
            ? { endian: "LE" as const, resolution: "nanosecond" as const }
            : null;
  if (!settings) return null;
  const read16 = (offset: number) =>
    settings.endian === "LE" ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const read32 = (offset: number) =>
    settings.endian === "LE" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const major = read16(4);
  const minor = read16(6);
  const snaplen = read32(16);
  const network = read32(20);
  const packets: PcapPacketPreview[] = [];
  let offset = 24;
  let truncated = false;
  while (offset + 16 <= buffer.length && packets.length < MAX_PCAP_PACKET_PREVIEW) {
    const seconds = read32(offset);
    const fractional = read32(offset + 4);
    const capturedLength = read32(offset + 8);
    const originalLength = read32(offset + 12);
    packets.push({
      capturedLength,
      originalLength,
      timestamp: formatPcapTimestamp(seconds, fractional, settings.resolution),
    });
    offset += 16;
    if (capturedLength > buffer.length - offset) {
      truncated = true;
      break;
    }
    offset += capturedLength;
  }
  if (offset < buffer.length && packets.length >= MAX_PCAP_PACKET_PREVIEW) truncated = true;
  return {
    format: "classic PCAP",
    endian: settings.endian,
    timestampResolution: settings.resolution,
    version: `${major}.${minor}`,
    snaplen,
    linkType: describePcapLinkType(network),
    packets,
    truncated,
  };
}

function readPcapNgMetadata(buffer: Buffer): PcapNgMetadata | null {
  if (buffer.length < 28 || buffer.readUInt32BE(0) !== 0x0a0d0d0a) return null;
  const bomSignature = [...buffer.subarray(8, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const endian = bomSignature === "1a2b3c4d" ? "BE" : bomSignature === "4d3c2b1a" ? "LE" : null;
  if (!endian) return null;
  const read16 = (offset: number) =>
    endian === "LE" ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const read32 = (offset: number) =>
    endian === "LE" ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const blockTypes: string[] = [];
  const linkTypes = new Set<string>();
  const snaplens = new Set<number>();
  const packets: PcapPacketPreview[] = [];
  let offset = 0;
  let truncated = false;
  while (offset + 12 <= buffer.length && blockTypes.length < MAX_PCAP_BLOCK_PREVIEW) {
    const blockType = read32(offset);
    const blockLength = read32(offset + 4);
    if (blockLength < 12 || offset + blockLength > buffer.length) {
      truncated = true;
      break;
    }
    blockTypes.push(describePcapNgBlockType(blockType));
    if (blockType === 0x00000001 && offset + 16 <= buffer.length) {
      linkTypes.add(describePcapLinkType(read16(offset + 8)));
      snaplens.add(read32(offset + 12));
    } else if (blockType === 0x00000006 && offset + 28 <= buffer.length && packets.length < MAX_PCAP_PACKET_PREVIEW) {
      const timestampHigh = read32(offset + 12);
      const timestampLow = read32(offset + 16);
      const capturedLength = read32(offset + 20);
      const originalLength = read32(offset + 24);
      packets.push({
        capturedLength,
        originalLength,
        timestamp: formatPcapNgTimestamp(timestampHigh, timestampLow),
      });
    } else if (blockType === 0x00000003 && blockLength >= 16 && packets.length < MAX_PCAP_PACKET_PREVIEW) {
      const originalLength = read32(offset + 8);
      packets.push({ capturedLength: Math.min(originalLength, blockLength - 16), originalLength });
    }
    offset += blockLength;
  }
  if (offset < buffer.length && blockTypes.length >= MAX_PCAP_BLOCK_PREVIEW) truncated = true;
  return {
    format: "PCAPNG",
    endian,
    linkTypes: [...linkTypes].slice(0, 6),
    snaplens: [...snaplens].slice(0, 6),
    blockTypes,
    packets,
    truncated,
  };
}

function formatPcapTimestamp(
  seconds: number,
  fractional: number,
  resolution: "microsecond" | "nanosecond",
): string {
  const milliseconds =
    seconds * 1000 + Math.floor(fractional / (resolution === "nanosecond" ? 1_000_000 : 1_000));
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return `${seconds}.${fractional}`;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return `${seconds}.${fractional}`;
  }
}

function formatPcapNgTimestamp(high: number, low: number): string {
  const value = high * 2 ** 32 + low;
  if (!Number.isFinite(value) || value <= 0) return `${high}:${low}`;
  try {
    return new Date(Math.floor(value / 1000)).toISOString();
  } catch {
    return `${high}:${low}`;
  }
}

function describePcapLinkType(code: number): string {
  return (
    {
      0: "NULL/loopback",
      1: "Ethernet",
      6: "IEEE 802.5 Token Ring",
      7: "ARCNET",
      8: "SLIP",
      9: "PPP",
      101: "raw IPv4/IPv6",
      105: "IEEE 802.11",
      113: "Linux cooked capture",
      127: "radiotap",
      147: "user0",
      228: "IPv4",
      229: "IPv6",
      276: "Linux cooked capture v2",
    }[code] ?? `link type ${code}`
  );
}

function describePcapNgBlockType(code: number): string {
  return (
    {
      0x0a0d0d0a: "section-header",
      0x00000001: "interface-description",
      0x00000002: "packet-obsolete",
      0x00000003: "simple-packet",
      0x00000004: "name-resolution",
      0x00000005: "interface-statistics",
      0x00000006: "enhanced-packet",
      0x0000000a: "decryption-secrets",
      0x00000bad: "custom",
      0x40000bad: "custom-copyable",
    }[code] ?? `block 0x${code.toString(16)}`
  );
}

function extractHarEntries(parsed: unknown): Record<string, unknown>[] {
  if (!isRecord(parsed)) return [];
  const log = parsed.log;
  if (!isRecord(log) || !Array.isArray(log.entries)) return [];
  return log.entries.filter(isRecord);
}

function readHarPreviewEntry(entry: Record<string, unknown>): HarPreviewEntry {
  const request = isRecord(entry.request) ? entry.request : {};
  const response = isRecord(entry.response) ? entry.response : {};
  const content = isRecord(response.content) ? response.content : {};
  const rawUrl = readRecordString(request, "url");
  return {
    method: readRecordString(request, "method").toUpperCase() || "REQUEST",
    url: redactHarUrl(rawUrl),
    host: readHarHost(rawUrl),
    status: readHarStatus(response),
    mimeType: readRecordString(content, "mimeType") || "unknown",
    timeMs: readNumberLabel(entry.time, "ms"),
    requestHeaders: summarizeHarHeaders(request.headers),
    responseHeaders: summarizeHarHeaders(response.headers),
  };
}

function summarizeHarPreviewEntry(entry: HarPreviewEntry, index: number): string {
  const requestHeaders =
    entry.requestHeaders.length > 0 ? ` request headers: ${entry.requestHeaders.join(", ")};` : "";
  const responseHeaders =
    entry.responseHeaders.length > 0 ? ` response headers: ${entry.responseHeaders.join(", ")};` : "";
  return [
    `- ${index + 1}. ${entry.method} ${entry.url}`,
    `status ${entry.status}; mime ${entry.mimeType}; time ${entry.timeMs};${requestHeaders}${responseHeaders}`,
  ].join(" ");
}

function summarizeHarHeaders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((header) => readRecordString(header, "name"))
    .filter(Boolean)
    .slice(0, MAX_HAR_HEADER_PREVIEW)
    .map((name) => (isSensitiveHeaderName(name) ? `${name}: [REDACTED]` : name));
}

function redactHarUrl(rawUrl: string): string {
  if (!rawUrl) return "unknown URL";
  try {
    const url = new URL(rawUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveFieldName(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString().slice(0, 240);
  } catch {
    return maskPotentialSecretValues(rawUrl).slice(0, 240);
  }
}

function readHarHost(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    return new URL(rawUrl).host;
  } catch {
    return "";
  }
}

function readHarStatus(response: Record<string, unknown>): string {
  const status = typeof response.status === "number" ? response.status : Number(response.status);
  const text = readRecordString(response, "statusText");
  if (Number.isFinite(status) && text) return `${status} ${text}`;
  if (Number.isFinite(status)) return String(status);
  return text || "unknown";
}

function readNumberLabel(value: unknown, suffix: string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)} ${suffix}` : "unknown";
}

function summarizeCounts(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .slice(0, 8)
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
}

function readRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function readRecordValue(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveHeaderName(name: string): boolean {
  return /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key)$/i.test(name.trim());
}

function isSensitiveFieldName(name: string): boolean {
  return /\b(token|secret|password|passwd|pwd|key|apikey|api_key|auth|session|cookie|signature|credential)\b/i.test(name);
}

function summarizeXlsxDataFile(filePath: string, extension: string, size: number): string {
  const workbookLabel = extension === ".xlsm" ? "XLSM macro-enabled workbook" : "XLSX workbook";
  if (size > MAX_DOCUMENT_EXTRACT_BYTES) {
    return [
      `${workbookLabel} ready for explicit attachment (${formatBytes(size)}).`,
      "Workbook preview was skipped because the file exceeds the bounded local extraction limit.",
      "No spreadsheet runtime, VBA project inspection, macro execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
  try {
    const entries = extractZipEntries(readFileSync(filePath));
    const sharedStrings = parseXlsxSharedStrings(entries);
    const sheetNames = parseXlsxSheetNames(entries);
    const sheetEntries = entries
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .slice(0, MAX_XLSX_PREVIEW_SHEETS);
    const formulaPreviews: string[] = [];
    const previews = sheetEntries.map((entry, index) => {
      const title = sheetNames.get(entry.name) || `Sheet ${index + 1}`;
      for (const formula of parseXlsxWorksheetFormulaPreviews(entry.data.toString("utf8"), sharedStrings)) {
        if (formulaPreviews.length >= MAX_XLSX_FORMULA_PREVIEW) break;
        formulaPreviews.push(`${title}!${formula}`);
      }
      const rows = parseXlsxWorksheetPreview(entry.data.toString("utf8"), sharedStrings);
      const rowPreview = rows
        .map((row, rowIndex) => `Row ${rowIndex + 1}: ${row.join(" | ")}`)
        .join("\n");
      return [
        `${title}: ${rows.length} row preview(s).`,
        rowPreview || "No readable cached cell values were found.",
      ].join("\n");
    });
    return [
      `${workbookLabel} preview (${formatBytes(size)}).`,
      `Sheets previewed: ${sheetEntries.length}${sheetEntries.length >= MAX_XLSX_PREVIEW_SHEETS ? " from bounded sample" : ""}.`,
      ...previews,
      formulaPreviews.length > 0
        ? `Formula previews (${formulaPreviews.length}${formulaPreviews.length >= MAX_XLSX_FORMULA_PREVIEW ? "+" : ""}): ${formulaPreviews.join(" | ")}.`
        : "Formula previews: none detected in bounded worksheet XML.",
      "Ready for explicit attachment after visible review; cached cell values and formula text only were read from Office XML, formulas were not evaluated, external references were not resolved, and no spreadsheet runtime, VBA project inspection, macro execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `${workbookLabel} ready for explicit attachment (${formatBytes(size)}).`,
      "No spreadsheet runtime, VBA project inspection, macro execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseXlsxSharedStrings(entries: ChannelZipEntry[]): string[] {
  const sharedStringsEntry = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  if (!sharedStringsEntry) return [];
  return [...sharedStringsEntry.data.toString("utf8").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
    .slice(0, 4096)
    .map((match) => extractSpreadsheetXmlText(match[1] ?? "").slice(0, 240));
}

function parseXlsxSheetNames(entries: ChannelZipEntry[]): Map<string, string> {
  const workbook = entries.find((entry) => entry.name === "xl/workbook.xml");
  const rels = entries.find((entry) => entry.name === "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return new Map();

  const relationshipTargets = new Map<string, string>();
  for (const match of rels.data.toString("utf8").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    const type = attrs.get("Type") || "";
    if (!id || !target || !type.includes("/worksheet")) continue;
    relationshipTargets.set(id, normalizeXlsxTarget(target));
  }

  const sheetNames = new Map<string, string>();
  for (const match of workbook.data.toString("utf8").matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = readXmlAttributes(match[1] ?? "");
    const name = attrs.get("name");
    const relId = attrs.get("r:id");
    const target = relId ? relationshipTargets.get(relId) : undefined;
    if (name && target) sheetNames.set(target, decodeXmlEntities(name).slice(0, 80));
  }
  return sheetNames;
}

function normalizeXlsxTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`.replace(/\/\.\//g, "/");
}

function parseXlsxWorksheetPreview(xml: string, sharedStrings: string[]): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
    .slice(0, MAX_XLSX_PREVIEW_ROWS)
    .map((rowMatch) =>
      [...(rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
        .slice(0, MAX_XLSX_PREVIEW_CELLS)
        .map((cellMatch, index) => {
          const attrs = readXmlAttributes(cellMatch[1] ?? "");
          const reference = attrs.get("r") || `C${index + 1}`;
          const value = readXlsxCellValue(cellMatch[2] ?? "", attrs.get("t"), sharedStrings);
          return `${reference.replace(/\d+$/, "")}=${value || "-"}`;
        }),
    )
    .filter((row) => row.some((cell) => !cell.endsWith("=-")));
}

function parseXlsxWorksheetFormulaPreviews(xml: string, sharedStrings: string[]): string[] {
  return [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
    .map((cellMatch, index) => {
      const attrs = readXmlAttributes(cellMatch[1] ?? "");
      const reference = attrs.get("r") || `C${index + 1}`;
      const cellXml = cellMatch[2] ?? "";
      const formulaMatch = cellXml.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
      if (!formulaMatch) return "";
      const formula = sanitizeXlsxFormulaPreview(formulaMatch[1] ?? "");
      const cachedValue = readXlsxCellValue(cellXml, attrs.get("t"), sharedStrings);
      return `${reference}=${formula}${cachedValue ? ` cached=${cachedValue}` : ""}`;
    })
    .filter(Boolean)
    .slice(0, MAX_XLSX_FORMULA_PREVIEW);
}

function sanitizeXlsxFormulaPreview(rawFormula: string): string {
  return clampSingleLine(
    maskPotentialSecretValues(redactUrlQuerySecrets(decodeXmlEntities(rawFormula).replace(/\s+/g, " ").trim())),
    180,
  );
}

function readXlsxCellValue(cellXml: string, type: string | undefined, sharedStrings: string[]): string {
  if (type === "inlineStr") {
    return extractSpreadsheetXmlText(cellXml).slice(0, 120);
  }
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  const rawValue = decodeXmlEntities(valueMatch?.[1] ?? "").trim();
  if (type === "s") {
    const index = Number.parseInt(rawValue, 10);
    return Number.isFinite(index) ? (sharedStrings[index] || rawValue).slice(0, 120) : rawValue;
  }
  if (type === "b") return rawValue === "1" ? "TRUE" : rawValue === "0" ? "FALSE" : rawValue;
  return rawValue.slice(0, 120);
}

function readXmlAttributes(rawAttributes: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of rawAttributes.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs.set(match[1] ?? "", decodeXmlEntities(match[2] ?? ""));
  }
  return attrs;
}

function extractSpreadsheetXmlText(xml: string): string {
  const textRuns = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean);
  if (textRuns.length > 0) return textRuns.join(" ").replace(/\s+/g, " ").trim();
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function describeJsonPreview(value: unknown): string[] {
  if (Array.isArray(value)) {
    const first = value[0];
    return [
      `Root type: array with ${value.length} item(s).`,
      `First item: ${describeJsonValue(first)}`,
      ...describeJsonObjectKeys(first, "First item keys"),
    ];
  }
  if (value && typeof value === "object") {
    return [
      "Root type: object.",
      ...describeJsonObjectKeys(value, "Top-level keys"),
    ];
  }
  return [`Root type: ${describeJsonValue(value)}.`];
}

function describeJsonObjectKeys(value: unknown, label: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries = Object.entries(value as Record<string, unknown>);
  const keys = entries.slice(0, MAX_JSON_PREVIEW_KEYS).map(([key]) => key);
  const typePreview = entries
    .slice(0, 8)
    .map(([key, entryValue]) => `${key}: ${describeJsonValue(entryValue)}`)
    .join(", ");
  return [
    `${label} (${entries.length}): ${keys.join(", ") || "none"}`,
    typePreview ? `Value preview: ${typePreview}` : "",
  ].filter(Boolean);
}

function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  if (typeof value === "object") return `object(${Object.keys(value as Record<string, unknown>).length})`;
  if (typeof value === "string") return `string(${value.length})`;
  return typeof value;
}

function summarizeTimedTranscript(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileSync(filePath, "utf8").slice(0, MAX_VOICE_TRANSCRIPT_BYTES);
    const transcript = isTimedTranscriptExtension(extension)
      ? extractTimedTranscriptPlainText(raw)
      : raw.trim();
    const preview = transcript || "No readable subtitle transcript text was found.";
    return [
      `Timed transcript preview (${formatBytes(size)}).`,
      preview.slice(0, MAX_TEXT_BYTES - 220),
      "Ready for explicit attachment after visible review; no microphone capture, transcription service, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Timed transcript file ready for explicit attachment (${formatBytes(size)}).`,
      "No microphone capture, transcription service, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function isTimedTranscriptExtension(extension: string): boolean {
  return extension === ".srt" || extension === ".vtt";
}

function extractTimedTranscriptPlainText(raw: string): string {
  const cues = parseTimedTranscriptCues(raw);
  if (cues.length > 0) return cues.join("\n").slice(0, MAX_TEXT_BYTES);
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripSubtitleMarkup(line))
    .filter((line) => line && !/^(WEBVTT|NOTE|STYLE|REGION)$/i.test(line))
    .join("\n")
    .trim()
    .slice(0, MAX_TEXT_BYTES);
}

function parseTimedTranscriptCues(raw: string): string[] {
  const lines = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const cues: string[] = [];
  for (let index = 0; index < lines.length && cues.length < 16; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.includes("-->")) continue;
    const timeRange = line
      .replace(/\s+/g, " ")
      .replace(/\s+-->\s+/, " -> ")
      .trim();
    const textLines: string[] = [];
    index += 1;
    while (index < lines.length) {
      const textLine = lines[index]?.trim() ?? "";
      if (!textLine) break;
      if (textLine.includes("-->")) {
        index -= 1;
        break;
      }
      if (!/^\d+$/.test(textLine)) {
        const cleaned = stripSubtitleMarkup(textLine);
        if (cleaned) textLines.push(cleaned);
      }
      index += 1;
    }
    const text = textLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) cues.push(`${timeRange}: ${text}`);
  }
  return cues;
}

function stripSubtitleMarkup(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/\{\\[^}]+\}/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

type ChannelImageMetadata = {
  format?: string;
  dimensions?: string;
  detail?: string;
  text?: string;
};

type ChannelAudioMetadata = {
  format: string;
  duration?: string;
  sampleRate?: string;
  channels?: string;
  bitRate?: string;
  bitsPerSample?: string;
  id3?: string;
};

type ChannelVideoMetadata = {
  format: string;
  brands?: string;
  duration?: string;
  dimensions?: string;
  tracks?: string;
};

function summarizeImage(filePath: string, extension: string, size: number): string {
  const metadata: ChannelImageMetadata | null =
    extension === ".svg" ? readSvgImageMetadata(filePath) : readRasterImageMetadata(filePath);
  const details = [
    metadata?.format ? `Format: ${metadata.format}.` : "",
    metadata?.dimensions ? `Dimensions: ${metadata.dimensions}.` : "",
    metadata?.detail ? `Header details: ${metadata.detail}.` : "",
    metadata?.text ? `SVG text preview: ${metadata.text}` : "",
  ].filter(Boolean);
  if (details.length === 0) {
    return `Image file ready for explicit attachment (${formatBytes(size)}). Image metadata preview did not find dimensions in this read-only importer.`;
  }
  return [
    `Image metadata preview (${formatBytes(size)}).`,
    ...details,
    "Ready for explicit attachment after visible review; no OCR, vision model, network call, or provider send was performed. No image renderer startup, pixel decode, animation playback, or color-profile validation was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function readRasterImageMetadata(filePath: string): ChannelImageMetadata | null {
  const header = readFileHeader(filePath, 256 * 1024);
  return (
    readPngDimensions(header) ||
    readJpegDimensions(header) ||
    readGifDimensions(header) ||
    readWebpDimensions(header) ||
    readBmpDimensions(header) ||
    readTiffDimensions(header) ||
    readIcoMetadata(header)
  );
}

function readPngDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { format: "PNG", dimensions: `${width} x ${height} px` };
}

function readJpegDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) {
        return { format: "JPEG", dimensions: `${width} x ${height} px` };
      }
      return null;
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegStartOfFrame(marker: number | undefined): boolean {
  return typeof marker === "number" && (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  );
}

function readGifDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (
    buffer.length < 10 ||
    (buffer.subarray(0, 6).toString("ascii") !== "GIF87a" &&
      buffer.subarray(0, 6).toString("ascii") !== "GIF89a")
  ) {
    return null;
  }
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if (width <= 0 || height <= 0) return null;
  const packed = buffer.length > 10 ? buffer[10] : 0;
  const globalColorTable = Boolean(packed & 0x80);
  const colorCount = globalColorTable ? 2 ** ((packed & 0x07) + 1) : 0;
  return {
    format: buffer.subarray(0, 6).toString("ascii"),
    dimensions: `${width} x ${height} px`,
    detail: globalColorTable ? `global color table ${colorCount} colors` : "no global color table flag",
  };
}

function readWebpDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) break;
    if (chunkType === "VP8X" && chunkSize >= 10) {
      const width = 1 + buffer.readUIntLE(dataOffset + 4, 3);
      const height = 1 + buffer.readUIntLE(dataOffset + 7, 3);
      const flags = buffer[dataOffset];
      return {
        format: "WebP VP8X",
        dimensions: `${width} x ${height} px`,
        detail: summarizeWebpFlags(flags),
      };
    }
    if (chunkType === "VP8 " && chunkSize >= 10) {
      const width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff;
      if (width > 0 && height > 0) {
        return { format: "WebP VP8", dimensions: `${width} x ${height} px` };
      }
    }
    if (chunkType === "VP8L" && chunkSize >= 5) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { format: "WebP VP8L", dimensions: `${width} x ${height} px` };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return { format: "WebP", detail: "RIFF WEBP header found; dimensions unavailable in bounded header" };
}

function summarizeWebpFlags(flags: number): string {
  const values = [
    flags & 0x02 ? "animation" : "",
    flags & 0x10 ? "alpha" : "",
    flags & 0x20 ? "ICC profile" : "",
    flags & 0x08 ? "EXIF" : "",
    flags & 0x04 ? "XMP" : "",
  ].filter(Boolean);
  return values.length > 0 ? values.join(", ") : "no VP8X feature flags";
}

function readBmpDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (buffer.length < 26 || buffer.subarray(0, 2).toString("ascii") !== "BM") {
    return null;
  }
  const dibSize = buffer.readUInt32LE(14);
  if (dibSize === 12 && buffer.length >= 26) {
    const width = buffer.readUInt16LE(18);
    const height = buffer.readUInt16LE(20);
    if (width > 0 && height > 0) {
      return { format: "BMP", dimensions: `${width} x ${height} px`, detail: "BITMAPCOREHEADER" };
    }
  }
  if (dibSize >= 40 && buffer.length >= 34) {
    const width = buffer.readInt32LE(18);
    const height = Math.abs(buffer.readInt32LE(22));
    const bitsPerPixel = buffer.length >= 30 ? buffer.readUInt16LE(28) : 0;
    if (width > 0 && height > 0) {
      return {
        format: "BMP",
        dimensions: `${width} x ${height} px`,
        detail: bitsPerPixel > 0 ? `${bitsPerPixel} bits per pixel` : `DIB header ${dibSize} bytes`,
      };
    }
  }
  return { format: "BMP", detail: `DIB header ${dibSize} bytes; dimensions unavailable` };
}

function readTiffDimensions(buffer: Buffer): ChannelImageMetadata | null {
  if (buffer.length < 8) return null;
  const byteOrder = buffer.subarray(0, 2).toString("ascii");
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return null;
  const marker = littleEndian ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2);
  if (marker !== 42) return null;
  const ifdOffset = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  if (ifdOffset + 2 > buffer.length) {
    return { format: "TIFF", detail: "IFD offset is outside the bounded header preview" };
  }
  const entryCount = readTiffUInt16(buffer, ifdOffset, littleEndian);
  let width: number | undefined;
  let height: number | undefined;
  for (let index = 0; index < Math.min(entryCount, 128); index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > buffer.length) break;
    const tag = readTiffUInt16(buffer, entryOffset, littleEndian);
    const type = readTiffUInt16(buffer, entryOffset + 2, littleEndian);
    const count = readTiffUInt32(buffer, entryOffset + 4, littleEndian);
    if (count < 1) continue;
    if (tag === 256) width = readTiffInlineValue(buffer, entryOffset + 8, type, littleEndian);
    if (tag === 257) height = readTiffInlineValue(buffer, entryOffset + 8, type, littleEndian);
    if (width && height) break;
  }
  return {
    format: "TIFF",
    ...(width && height ? { dimensions: `${width} x ${height} px` } : {}),
    detail: `${byteOrder} byte order, ${entryCount} IFD entries sampled`,
  };
}

function readTiffUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readTiffUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readTiffInlineValue(
  buffer: Buffer,
  offset: number,
  type: number,
  littleEndian: boolean,
): number | undefined {
  if (type === 3 && offset + 2 <= buffer.length) return readTiffUInt16(buffer, offset, littleEndian);
  if (type === 4 && offset + 4 <= buffer.length) return readTiffUInt32(buffer, offset, littleEndian);
  return undefined;
}

function readIcoMetadata(buffer: Buffer): ChannelImageMetadata | null {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    return null;
  }
  const count = buffer.readUInt16LE(4);
  if (count <= 0) return null;
  const dimensions: string[] = [];
  const bitDepths = new Set<number>();
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > buffer.length) break;
    const width = buffer[offset] || 256;
    const height = buffer[offset + 1] || 256;
    const bitsPerPixel = buffer.readUInt16LE(offset + 6);
    dimensions.push(`${width} x ${height} px`);
    if (bitsPerPixel > 0) bitDepths.add(bitsPerPixel);
  }
  return {
    format: "ICO",
    ...(dimensions.length > 0 ? { dimensions: dimensions.join(", ") } : {}),
    detail: `${count} image entr${count === 1 ? "y" : "ies"}${bitDepths.size > 0 ? `, ${[...bitDepths].join("/")} bpp` : ""}`,
  };
}

function readSvgImageMetadata(filePath: string): ChannelImageMetadata | null {
  try {
    const svg = readFileSync(filePath, "utf8").slice(0, MAX_TEXT_BYTES);
    const tag = svg.match(/<svg\b[^>]*>/i)?.[0] || "";
    const dimensions = readSvgDimensions(tag);
    const text = extractSvgTextPreview(svg);
    return dimensions || text ? { format: "SVG", ...(dimensions ? { dimensions } : {}), ...(text ? { text } : {}) } : null;
  } catch {
    return null;
  }
}

function readSvgDimensions(svgTag: string): string | undefined {
  const width = parseSvgDimension(readXmlAttribute(svgTag, "width"));
  const height = parseSvgDimension(readXmlAttribute(svgTag, "height"));
  if (width && height) return `${width} x ${height} px`;
  const viewBox = readXmlAttribute(svgTag, "viewBox");
  const parts = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));
  if (parts && parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
    return `${trimNumber(parts[2])} x ${trimNumber(parts[3])} viewBox`;
  }
  return undefined;
}

function parseSvgDimension(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return trimNumber(Number.parseFloat(match[1]));
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function readXmlAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${attribute}=["']([^"']+)["']`, "i"));
  return match?.[1];
}

function extractSvgTextPreview(svg: string): string {
  return [...svg.matchAll(/<(?:title|desc|text)(?:\s[^>]*)?>([\s\S]*?)<\/(?:title|desc|text)>/gi)]
    .map((match) => decodeXmlEntities((match[1] || "").replace(/<[^>]+>/g, " ")))
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ")
    .slice(0, 480);
}

function readFileHeader(filePath: string, maxBytes: number): Buffer {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    closeSync(fd);
  }
}

function summarizeAudio(filePath: string, extension: string, size: number): string {
  const header = readFileHeader(filePath, 256 * 1024);
  const metadata =
    extension === ".wav"
      ? readWavAudioMetadata(header)
      : extension === ".flac"
        ? readFlacAudioMetadata(header)
        : extension === ".m4a"
          ? readM4aAudioMetadata(header)
          : extension === ".ogg"
            ? readOggAudioMetadata(header)
            : readMp3AudioMetadata(header, size);
  if (!metadata) {
    return [
      `Audio file ready for explicit attachment (${formatBytes(size)}).`,
      "Audio metadata preview did not find a supported WAV/MP3/FLAC/M4A/OGG header in this read-only importer.",
      "No microphone capture, transcription service, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
  const details = [
    `Format: ${metadata.format}.`,
    metadata.duration ? `Duration: ${metadata.duration}.` : "",
    metadata.sampleRate ? `Sample rate: ${metadata.sampleRate}.` : "",
    metadata.channels ? `Channels: ${metadata.channels}.` : "",
    metadata.bitRate ? `Bit rate: ${metadata.bitRate}.` : "",
    metadata.bitsPerSample ? `Bit depth: ${metadata.bitsPerSample}.` : "",
    metadata.id3 ? `ID3: ${metadata.id3}.` : "",
  ].filter(Boolean);
  return [
    `Audio metadata preview (${formatBytes(size)}).`,
    ...details,
    "Ready for explicit attachment after visible review; no microphone capture, transcription service, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function readWavAudioMetadata(buffer: Buffer): ChannelAudioMetadata | null {
  if (
    buffer.length < 44 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > buffer.length) break;
    if (chunkId === "fmt " && chunkSize >= 16) {
      channels = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }
  if (!sampleRate && !channels && !dataBytes) return null;
  const durationSeconds = byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : 0;
  return {
    format: "WAV",
    ...(durationSeconds > 0 ? { duration: formatDuration(durationSeconds) } : {}),
    ...(sampleRate > 0 ? { sampleRate: `${sampleRate} Hz` } : {}),
    ...(channels > 0 ? { channels: formatChannelCount(channels) } : {}),
    ...(bitsPerSample > 0 ? { bitsPerSample: `${bitsPerSample}-bit` } : {}),
  };
}

function readFlacAudioMetadata(buffer: Buffer): ChannelAudioMetadata | null {
  if (buffer.length < 42 || buffer.subarray(0, 4).toString("ascii") !== "fLaC") {
    return null;
  }
  let offset = 4;
  while (offset + 4 <= buffer.length) {
    const header = buffer[offset];
    const blockType = header & 0x7f;
    const blockLength = buffer.readUIntBE(offset + 1, 3);
    const dataOffset = offset + 4;
    if (dataOffset + blockLength > buffer.length) break;
    if (blockType === 0 && blockLength >= 34) {
      const streamInfo = buffer.subarray(dataOffset, dataOffset + blockLength);
      const sampleRate = streamInfo.readUIntBE(10, 3) >> 4;
      const channels = ((streamInfo[12] >> 1) & 0x07) + 1;
      const bitsPerSample = (((streamInfo[12] & 0x01) << 4) | (streamInfo[13] >> 4)) + 1;
      const totalSamples = Number((BigInt(streamInfo[13] & 0x0f) << 32n) | BigInt(streamInfo.readUInt32BE(14)));
      const durationSeconds = sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : 0;
      return {
        format: "FLAC",
        ...(durationSeconds > 0 ? { duration: formatDuration(durationSeconds) } : {}),
        ...(sampleRate > 0 ? { sampleRate: `${sampleRate} Hz` } : {}),
        ...(channels > 0 ? { channels: formatChannelCount(channels) } : {}),
        ...(bitsPerSample > 0 ? { bitsPerSample: `${bitsPerSample}-bit` } : {}),
      };
    }
    offset = dataOffset + blockLength;
    if (header & 0x80) break;
  }
  return { format: "FLAC", id3: "fLaC stream marker found; STREAMINFO unavailable in bounded header" };
}

function readMp3AudioMetadata(buffer: Buffer, size: number): ChannelAudioMetadata | null {
  if (buffer.length < 4) return null;
  const id3 = readId3Summary(buffer);
  let offset = readId3Size(buffer);
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (buffer[offset + 1] >> 3) & 0x03;
    const layerBits = (buffer[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
    const channelMode = (buffer[offset + 3] >> 6) & 0x03;
    const version = versionBits === 0x03 ? "MPEG1" : versionBits === 0x02 ? "MPEG2" : versionBits === 0x00 ? "MPEG2.5" : "";
    if (!version || layerBits !== 0x01 || bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
      offset += 1;
      continue;
    }
    const sampleRate = getMp3SampleRate(version, sampleRateIndex);
    const bitRate = getMp3Layer3BitRate(version, bitrateIndex);
    if (!sampleRate || !bitRate) return id3 ? { format: "MP3", id3 } : null;
    const durationSeconds = size > 0 ? (size * 8) / (bitRate * 1000) : 0;
    return {
      format: "MP3",
      ...(durationSeconds > 0 ? { duration: formatDuration(durationSeconds) } : {}),
      sampleRate: `${sampleRate} Hz`,
      bitRate: `${bitRate} kbps`,
      channels: channelMode === 3 ? "mono" : "stereo",
      ...(id3 ? { id3 } : {}),
    };
  }
  return id3 ? { format: "MP3", id3 } : null;
}

function readM4aAudioMetadata(buffer: Buffer): ChannelAudioMetadata | null {
  if (buffer.length < 12) return null;
  const boxes = readMp4Boxes(buffer, 0, buffer.length, 8);
  const ftyp = boxes.find((box) => box.type === "ftyp");
  if (!ftyp) return null;
  const majorBrand = readAsciiSafe(buffer, ftyp.contentOffset, ftyp.contentOffset + 4);
  const compatibleBrands = readMp4CompatibleBrands(buffer, ftyp.contentOffset + 8, ftyp.end);
  const moovChildren = boxes
    .filter((box) => box.type === "moov")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 8));
  const trakChildren = moovChildren
    .filter((box) => box.type === "trak")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 8));
  const mdiaChildren = trakChildren
    .filter((box) => box.type === "mdia")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 8));
  const mvhd = moovChildren.find((box) => box.type === "mvhd");
  const mdhd = mdiaChildren.find((box) => box.type === "mdhd");
  const hdlr = mdiaChildren.find((box) => box.type === "hdlr");
  const duration = mvhd ? readMp4MovieDuration(buffer, mvhd.contentOffset, mvhd.end) : undefined;
  const timescale = mdhd ? readMp4MediaTimescale(buffer, mdhd.contentOffset, mdhd.end) : undefined;
  const handler = hdlr ? readAsciiSafe(buffer, hdlr.contentOffset + 8, hdlr.contentOffset + 12) : "";
  const brands = [majorBrand, ...compatibleBrands].filter(Boolean).slice(0, 8).join(", ");
  return {
    format: "M4A/MP4 audio",
    ...(duration ? { duration } : {}),
    ...(timescale ? { sampleRate: `${timescale} Hz media timescale` } : {}),
    ...(handler ? { channels: `handler ${handler}` } : {}),
    ...(brands ? { id3: `brands ${brands}` } : {}),
  };
}

function readOggAudioMetadata(buffer: Buffer): ChannelAudioMetadata | null {
  if (buffer.length < 36 || buffer.subarray(0, 4).toString("ascii") !== "OggS") {
    return null;
  }
  const segments = buffer[26];
  const segmentTableEnd = 27 + segments;
  if (segments <= 0 || segmentTableEnd > buffer.length) {
    return { format: "Ogg", id3: "Ogg page marker found; segment table unavailable in bounded header" };
  }
  const firstPacketSize = [...buffer.subarray(27, segmentTableEnd)].reduce((sum, value) => sum + value, 0);
  const packet = buffer.subarray(segmentTableEnd, Math.min(buffer.length, segmentTableEnd + firstPacketSize));
  return (
    readOggVorbisMetadata(packet) ||
    readOggOpusMetadata(packet) ||
    { format: "Ogg", id3: "Ogg page marker found; codec identification packet unavailable in bounded header" }
  );
}

function readOggVorbisMetadata(packet: Buffer): ChannelAudioMetadata | null {
  if (packet.length < 30 || packet[0] !== 1 || packet.subarray(1, 7).toString("ascii") !== "vorbis") {
    return null;
  }
  const channels = packet[11];
  const sampleRate = packet.readUInt32LE(12);
  const nominalBitRate = packet.readInt32LE(20);
  return {
    format: "Ogg Vorbis",
    ...(sampleRate > 0 ? { sampleRate: `${sampleRate} Hz` } : {}),
    ...(channels > 0 ? { channels: formatChannelCount(channels) } : {}),
    ...(nominalBitRate > 0 ? { bitRate: `${Math.round(nominalBitRate / 1000)} kbps nominal` } : {}),
  };
}

function readOggOpusMetadata(packet: Buffer): ChannelAudioMetadata | null {
  if (packet.length < 19 || packet.subarray(0, 8).toString("ascii") !== "OpusHead") {
    return null;
  }
  const channels = packet[9];
  const preSkip = packet.readUInt16LE(10);
  const inputSampleRate = packet.readUInt32LE(12);
  return {
    format: "Ogg Opus",
    sampleRate: inputSampleRate > 0 ? `${inputSampleRate} Hz input` : "48000 Hz playback",
    ...(channels > 0 ? { channels: formatChannelCount(channels) } : {}),
    id3: `pre-skip ${preSkip} samples`,
  };
}

function readId3Size(buffer: Buffer): number {
  if (buffer.length < 10 || buffer.subarray(0, 3).toString("ascii") !== "ID3") return 0;
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);
  return Math.min(buffer.length, size + 10);
}

function readId3Summary(buffer: Buffer): string {
  if (buffer.length < 10 || buffer.subarray(0, 3).toString("ascii") !== "ID3") return "";
  const version = `ID3v2.${buffer[3]}.${buffer[4]}`;
  const tagSize = readId3Size(buffer);
  const frames: string[] = [];
  let offset = 10;
  while (offset + 10 <= tagSize && frames.length < 4) {
    const frameId = buffer.subarray(offset, offset + 4).toString("ascii");
    const frameSize = buffer.readUInt32BE(offset + 4);
    const frameStart = offset + 10;
    const frameEnd = frameStart + frameSize;
    if (!/^[A-Z0-9]{4}$/.test(frameId) || frameSize <= 0 || frameEnd > buffer.length) break;
    if (["TIT2", "TPE1", "TALB", "TDRC", "TYER"].includes(frameId)) {
      const value = decodeId3TextFrame(buffer.subarray(frameStart, frameEnd));
      if (value) frames.push(`${frameId}=${value}`);
    }
    offset = frameEnd;
  }
  return [version, ...frames].join(", ").slice(0, 480);
}

function decodeId3TextFrame(frame: Buffer): string {
  if (frame.length <= 1) return "";
  const encoding = frame[0];
  const body = frame.subarray(1);
  const text =
    encoding === 1 || encoding === 2
      ? body.toString("utf16le")
      : body.toString("latin1");
  return text.replace(/\0/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function getMp3SampleRate(version: string, index: number): number {
  const base = [44100, 48000, 32000][index] ?? 0;
  if (version === "MPEG1") return base;
  if (version === "MPEG2") return Math.round(base / 2);
  if (version === "MPEG2.5") return Math.round(base / 4);
  return 0;
}

function getMp3Layer3BitRate(version: string, index: number): number {
  const mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return (version === "MPEG1" ? mpeg1 : mpeg2)[index] ?? 0;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatChannelCount(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return `${channels} channels`;
}

function summarizeVideo(filePath: string, extension: string, size: number): string {
  const header = readFileHeader(filePath, MAX_VIDEO_HEADER_PREVIEW_BYTES);
  const metadata =
    extension === ".avi"
      ? readAviVideoMetadata(header)
      : [".mkv", ".webm"].includes(extension)
        ? readEbmlVideoMetadata(header, extension)
        : readMp4VideoMetadata(header, extension);
  if (!metadata) {
    return [
      `Video file ready for explicit attachment (${formatBytes(size)}).`,
      "Video metadata preview did not find a supported MP4/MOV/WebM/MKV/AVI header in this read-only importer.",
      "No video player startup, media decoding, frame extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
  const details = [
    `Format: ${metadata.format}.`,
    metadata.brands ? `Brands: ${metadata.brands}.` : "",
    metadata.duration ? `Duration: ${metadata.duration}.` : "",
    metadata.dimensions ? `Dimensions: ${metadata.dimensions}.` : "",
    metadata.tracks ? `Tracks: ${metadata.tracks}.` : "",
  ].filter(Boolean);
  return [
    `Video metadata preview (${formatBytes(size)}).`,
    ...details,
    "Ready for explicit attachment after visible review; no video player startup, media decoding, frame extraction, network call, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

function readMp4VideoMetadata(buffer: Buffer, extension: string): ChannelVideoMetadata | null {
  if (buffer.length < 12) return null;
  const boxes = readMp4Boxes(buffer, 0, buffer.length, 4);
  const ftyp = boxes.find((box) => box.type === "ftyp");
  if (!ftyp) return null;
  const majorBrand = readAsciiSafe(buffer, ftyp.contentOffset, ftyp.contentOffset + 4);
  const compatibleBrands = readMp4CompatibleBrands(buffer, ftyp.contentOffset + 8, ftyp.end);
  const nested = boxes.flatMap((box) =>
    ["moov", "trak", "mdia"].includes(box.type)
      ? readMp4Boxes(buffer, box.contentOffset, box.end, 4)
      : [],
  );
  const moovChildren = boxes
    .filter((box) => box.type === "moov")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 4));
  const trakChildren = moovChildren
    .filter((box) => box.type === "trak")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 4));
  const allBoxes = [...boxes, ...nested, ...moovChildren, ...trakChildren];
  const mvhd = allBoxes.find((box) => box.type === "mvhd");
  const duration = mvhd ? readMp4MovieDuration(buffer, mvhd.contentOffset, mvhd.end) : undefined;
  const dimensions = trakChildren
    .filter((box) => box.type === "tkhd")
    .map((box) => readMp4TrackDimensions(buffer, box.contentOffset, box.end))
    .filter((dimension): dimension is string => Boolean(dimension));
  const handlers = trakChildren
    .filter((box) => box.type === "mdia")
    .flatMap((box) => readMp4Boxes(buffer, box.contentOffset, box.end, 2))
    .filter((box) => box.type === "hdlr")
    .map((box) => readAsciiSafe(buffer, box.contentOffset + 8, box.contentOffset + 12))
    .filter(Boolean);
  return {
    format: extension === ".mov" ? "QuickTime/MOV" : "ISO BMFF video",
    ...(majorBrand ? { brands: [majorBrand, ...compatibleBrands].slice(0, 8).join(", ") } : {}),
    ...(duration ? { duration } : {}),
    ...(dimensions.length > 0 ? { dimensions: dimensions[0] } : {}),
    ...(handlers.length > 0 ? { tracks: [...new Set(handlers)].join(", ") } : {}),
  };
}

type Mp4Box = {
  type: string;
  contentOffset: number;
  end: number;
};

function readMp4Boxes(buffer: Buffer, start: number, end: number, limit: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < limit) {
    const size32 = buffer.readUInt32BE(offset);
    const type = readAsciiSafe(buffer, offset + 4, offset + 8);
    if (!/^[A-Za-z0-9 ]{4}$/.test(type)) break;
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1 && offset + 16 <= end) {
      const size64 = buffer.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) break;
      boxSize = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    }
    if (boxSize < headerSize || offset + boxSize > end) break;
    boxes.push({ type, contentOffset: offset + headerSize, end: offset + boxSize });
    offset += boxSize;
  }
  return boxes;
}

function readMp4CompatibleBrands(buffer: Buffer, start: number, end: number): string[] {
  const brands: string[] = [];
  for (let offset = start; offset + 4 <= end && brands.length < 8; offset += 4) {
    const brand = readAsciiSafe(buffer, offset, offset + 4);
    if (/^[A-Za-z0-9 ]{4}$/.test(brand)) brands.push(brand.trim());
  }
  return brands.filter(Boolean);
}

function readMp4MovieDuration(buffer: Buffer, start: number, end: number): string | undefined {
  if (start + 20 > end) return undefined;
  const version = buffer[start];
  const timescaleOffset = version === 1 ? start + 20 : start + 12;
  const durationOffset = version === 1 ? start + 24 : start + 16;
  if (timescaleOffset + 4 > end || durationOffset + (version === 1 ? 8 : 4) > end) return undefined;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const rawDuration = version === 1
    ? buffer.readBigUInt64BE(durationOffset)
    : BigInt(buffer.readUInt32BE(durationOffset));
  if (timescale <= 0 || rawDuration <= 0n || rawDuration > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return formatDuration(Number(rawDuration) / timescale);
}

function readMp4MediaTimescale(buffer: Buffer, start: number, end: number): number | undefined {
  if (start + 16 > end) return undefined;
  const version = buffer[start];
  const timescaleOffset = version === 1 ? start + 20 : start + 12;
  if (timescaleOffset + 4 > end) return undefined;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  return timescale > 0 ? timescale : undefined;
}

function readMp4TrackDimensions(buffer: Buffer, start: number, end: number): string | undefined {
  if (end - start < 8) return undefined;
  const width = buffer.readUInt32BE(end - 8) / 65536;
  const height = buffer.readUInt32BE(end - 4) / 65536;
  if (width <= 0 || height <= 0 || width > 200000 || height > 200000) return undefined;
  return `${trimNumber(width)} x ${trimNumber(height)} px`;
}

function readAviVideoMetadata(buffer: Buffer): ChannelVideoMetadata | null {
  if (
    buffer.length < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "AVI "
  ) {
    return null;
  }
  const avihOffset = buffer.indexOf("avih", 12, "ascii");
  if (avihOffset < 0 || avihOffset + 64 > buffer.length) {
    return { format: "AVI" };
  }
  const dataOffset = avihOffset + 8;
  const microsecondsPerFrame = buffer.readUInt32LE(dataOffset);
  const totalFrames = buffer.readUInt32LE(dataOffset + 16);
  const streams = buffer.readUInt32LE(dataOffset + 24);
  const width = buffer.readUInt32LE(dataOffset + 32);
  const height = buffer.readUInt32LE(dataOffset + 36);
  const durationSeconds =
    microsecondsPerFrame > 0 && totalFrames > 0
      ? (microsecondsPerFrame * totalFrames) / 1_000_000
      : 0;
  return {
    format: "AVI",
    ...(durationSeconds > 0 ? { duration: formatDuration(durationSeconds) } : {}),
    ...(width > 0 && height > 0 ? { dimensions: `${width} x ${height} px` } : {}),
    ...(streams > 0 ? { tracks: `${streams} stream${streams === 1 ? "" : "s"}` } : {}),
  };
}

function readEbmlVideoMetadata(buffer: Buffer, extension: string): ChannelVideoMetadata | null {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x1a ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0xdf ||
    buffer[3] !== 0xa3
  ) {
    return null;
  }
  const asciiWindow = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  const docType =
    asciiWindow.includes("webm")
      ? "webm"
      : asciiWindow.includes("matroska")
        ? "matroska"
        : extension === ".webm"
          ? "webm"
          : "matroska";
  return {
    format: docType === "webm" ? "WebM" : "Matroska/MKV",
    brands: `EBML DocType=${docType}`,
  };
}

function readAsciiSafe(buffer: Buffer, start: number, end: number): string {
  if (start < 0 || end > buffer.length || start >= end) return "";
  return buffer.subarray(start, end).toString("ascii").replace(/[^\x20-\x7e]/g, "").trim();
}

function summarizeDocumentText(filePath: string, extension: string, size: number): string {
  if (size > MAX_DOCUMENT_EXTRACT_BYTES) return "";
  if (extension === ".pdf") return extractPdfTextSummary(filePath);
  if ([".doc", ".xls"].includes(extension)) return extractLegacyOfficeBinaryTextSummary(filePath, size, extension);
  if ([".docm", ".docx"].includes(extension)) return extractDocxTextSummary(filePath, extension);
  if (extension === ".epub") return extractEpubTextSummary(filePath, size);
  if ([".md", ".markdown"].includes(extension)) return extractMarkdownTextSummary(filePath, size);
  if ([".html", ".htm"].includes(extension)) return extractHtmlTextSummary(filePath);
  if (extension === ".mhtml") return extractMhtmlTextSummary(filePath);
  if ([".odt", ".ods", ".odp"].includes(extension)) return extractOpenDocumentTextSummary(filePath);
  if (extension === ".ppt") return extractLegacyPptTextSummary(filePath, size);
  if ([".pptm", ".pptx"].includes(extension)) return extractPptxTextSummary(filePath, extension);
  if (extension === ".rtf") return extractRtfTextSummary(filePath);
  return "";
}

function summarizeEmailMessage(filePath: string, size: number): string {
  try {
    const raw = readFileSync(filePath, "utf8").slice(0, MAX_TEXT_BYTES);
    const message = parseEmailMessage(raw);
    const headers = [
      message.from ? `From: ${message.from}` : "",
      message.to ? `To: ${message.to}` : "",
      message.cc ? `Cc: ${message.cc}` : "",
      message.subject ? `Subject: ${message.subject}` : "",
      message.date ? `Date: ${message.date}` : "",
    ].filter(Boolean);
    const body = message.body || "No readable plain-text body preview was found.";
    return [
      `Email message preview (${formatBytes(size)}).`,
      ...headers,
      `Body: ${body}`,
      "Ready for explicit attachment after visible review; no IMAP/SMTP login, mailbox sync, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Email message file ready for explicit attachment (${formatBytes(size)}).`,
      "No IMAP/SMTP login, mailbox sync, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeMailboxArchive(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 8),
    ).toString("utf8");
    const messages = parseMailboxArchive(raw);
    const previews = messages.map((message, index) => {
      const parsed = parseEmailMessage(message);
      const headers = [
        parsed.from ? `From: ${parsed.from}` : "",
        parsed.subject ? `Subject: ${parsed.subject}` : "",
        parsed.date ? `Date: ${parsed.date}` : "",
      ].filter(Boolean);
      const body = parsed.body || "No readable plain-text body preview was found.";
      return [`Message ${index + 1}`, ...headers, `Body: ${body}`]
        .join(" | ")
        .slice(0, 880);
    });
    const archiveStatus =
      messages.length > 0
        ? `${messages.length} message preview(s) from the archive.`
        : "No readable mailbox messages were found.";
    return [
      `Mailbox archive preview (${formatBytes(size)}).`,
      archiveStatus,
      ...previews,
      "Ready for explicit attachment after visible review; no IMAP/SMTP login, mailbox sync, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Mailbox archive file ready for explicit attachment (${formatBytes(size)}).`,
      "No IMAP/SMTP login, mailbox sync, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeOutlookMsgFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_OUTLOOK_MSG_PREVIEW_BYTES));
    const isOle =
      buffer.length >= 8 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 &&
      buffer[5] === 0xb1 &&
      buffer[6] === 0x1a &&
      buffer[7] === 0xe1;
    const strings = extractLegacyOfficeBinaryStrings(buffer)
      .map(maskPotentialSecretValues)
      .filter((value) => value.length >= 4)
      .slice(0, MAX_OUTLOOK_MSG_STRING_PREVIEW);
    return [
      `Outlook MSG message preview (${formatBytes(size)}).`,
      `Compound File header: ${isOle ? "valid OLE container signature" : "not recognized in bounded header"}.`,
      strings.length > 0
        ? `Readable string samples (${strings.length}${strings.length >= MAX_OUTLOOK_MSG_STRING_PREVIEW ? "+" : ""}): ${strings.join(" | ")}.`
        : "No readable subject/body/address string samples were found in the bounded local binary preview.",
      buffer.length >= MAX_OUTLOOK_MSG_PREVIEW_BYTES
        ? `Preview was capped at ${formatBytes(MAX_OUTLOOK_MSG_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; no Outlook/MAPI runtime, mailbox sync, attachment extraction, network call, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Outlook MSG message file ready for explicit attachment (${formatBytes(size)}).`,
      "No Outlook/MAPI runtime, mailbox sync, attachment extraction, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeVCardFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(
      filePath,
      Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 8),
    ).toString("utf8");
    const contacts = parseVCardContacts(raw);
    const status =
      contacts.length > 0
        ? `${contacts.length} contact preview(s) from the card file.`
        : "No readable vCard contact fields were found.";
    return [
      `vCard contact preview (${formatBytes(size)}).`,
      status,
      ...contacts,
      "Ready for explicit attachment after visible review; no contacts app access, address book sync, account lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `vCard contact file ready for explicit attachment (${formatBytes(size)}).`,
      "No contacts app access, address book sync, account lookup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseVCardContacts(raw: string): string[] {
  const unfolded = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [unfolded];
  return blocks
    .map((block, index) => summarizeVCardBlock(block, index))
    .filter((summary): summary is string => Boolean(summary))
    .slice(0, MAX_VCARD_CONTACTS);
}

function summarizeVCardBlock(block: string, index: number): string | null {
  const fields = new Map<string, string[]>();
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const rawName = line.slice(0, separator).split(";")[0]?.trim().toUpperCase();
    if (!rawName || rawName === "BEGIN" || rawName === "END" || rawName === "VERSION") continue;
    const value = decodeVCardText(line.slice(separator + 1));
    if (!value) continue;
    const values = fields.get(rawName) || [];
    if (values.length < 4) values.push(value);
    fields.set(rawName, values);
  }
  const preferred = [
    ["FN", "Name"],
    ["N", "Structured name"],
    ["ORG", "Organization"],
    ["TITLE", "Title"],
    ["EMAIL", "Email"],
    ["TEL", "Phone"],
    ["ADR", "Address"],
    ["URL", "URL"],
    ["NOTE", "Note"],
  ];
  const lines: string[] = [];
  for (const [key, label] of preferred) {
    const values = fields.get(key) || [];
    for (const value of values) {
      lines.push(`${label}: ${value}`);
      if (lines.length >= MAX_VCARD_FIELD_PREVIEW) break;
    }
    if (lines.length >= MAX_VCARD_FIELD_PREVIEW) break;
  }
  if (lines.length === 0) return null;
  return [`Contact ${index + 1}`, ...lines]
    .join(" | ")
    .slice(0, 960);
}

function decodeVCardText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);
}

function parseMailboxArchive(raw: string): string[] {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const messages: string[] = [];
  let current: string[] = [];
  for (const line of normalized.split("\n")) {
    if (/^From [^\s]+ .+/.test(line)) {
      if (current.join("\n").trim()) {
        messages.push(current.join("\n").trim());
        if (messages.length >= MAX_MBOX_PREVIEW_MESSAGES) break;
      }
      current = [];
      continue;
    }
    current.push(line);
  }
  if (messages.length < MAX_MBOX_PREVIEW_MESSAGES && current.join("\n").trim()) {
    messages.push(current.join("\n").trim());
  }
  if (messages.length === 0 && normalized.trim()) {
    messages.push(normalized.trim());
  }
  return messages.slice(0, MAX_MBOX_PREVIEW_MESSAGES);
}

function parseEmailMessage(raw: string): {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
  body: string;
} {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const splitAt = normalized.search(/\n\n/);
  const headerBlock = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const bodyBlock = splitAt >= 0 ? normalized.slice(splitAt + 2) : "";
  const headers = readEmailHeaders(headerBlock);
  return {
    from: headers.get("from"),
    to: headers.get("to"),
    cc: headers.get("cc"),
    subject: headers.get("subject"),
    date: headers.get("date"),
    body: extractEmailBodyPreview(bodyBlock, headers.get("content-transfer-encoding")),
  };
}

function readEmailHeaders(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  let currentName = "";
  for (const line of headerBlock.split("\n")) {
    if (/^[ \t]/.test(line) && currentName) {
      headers.set(currentName, `${headers.get(currentName) || ""} ${line.trim()}`.trim());
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    currentName = line.slice(0, separator).trim().toLowerCase();
    const value = decodeEmailHeaderValue(line.slice(separator + 1).trim());
    if (value) headers.set(currentName, value);
  }
  return headers;
}

function extractEmailBodyPreview(bodyBlock: string, transferEncoding?: string): string {
  const decoded =
    transferEncoding?.toLowerCase() === "quoted-printable"
      ? decodeQuotedPrintable(bodyBlock)
      : bodyBlock;
  return decoded
    .replace(/--[A-Za-z0-9_'()+,./:=?-]+(?:--)?/g, "\n")
    .replace(/^Content-[^\n]*(?:\n[ \t][^\n]*)*/gim, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_BYTES - 360);
}

function decodeEmailHeaderValue(value: string): string {
  return value
    .replace(/=\?utf-8\?q\?([^?]+)\?=/gi, (_match, encoded: string) =>
      decodeQuotedPrintable(encoded.replace(/_/g, " ")),
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  const compact = value.replace(/=\r?\n/g, "");
  for (let index = 0; index < compact.length; index += 1) {
    const current = compact[index];
    const hex = compact.slice(index + 1, index + 3);
    if (current === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    bytes.push(compact.charCodeAt(index));
  }
  return Buffer.from(bytes).toString("utf8").replace(/\s+/g, " ").trim();
}

function extractPdfTextSummary(filePath: string): string {
  try {
    const raw = readFileHeader(filePath, MAX_PDF_METADATA_PREVIEW_BYTES).toString("latin1");
    const metadata = readPdfMetadataSummary(raw);
    const structureSecurity = readPdfStructureSecurityHints(raw);
    const objectSummary = readPdfObjectSummaries(raw);
    const text = [...raw.matchAll(/\(([^()]*)\)\s*T[jJ]/g)]
      .map((match) => decodePdfString(match[1] ?? ""))
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_BYTES);
    return [
      metadata ? `PDF metadata preview: ${metadata}` : "",
      structureSecurity ? `PDF structure/security hints: ${structureSecurity}` : "",
      objectSummary ? `PDF annotation/embedded object preview: ${objectSummary}` : "",
      text ? `PDF text preview:\n${text}` : "PDF text preview: no simple text operators were found in the bounded local scan.",
      "PDF preview scanned bounded local bytes only; no PDF renderer, OCR, JavaScript execution, network call, or provider send was performed; annotations are summarized but not rendered, and embedded file bytes are not extracted.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function readPdfMetadataSummary(raw: string): string {
  const hints = [
    raw.match(/^%PDF-([0-9.]+)/)?.[1] ? `version ${raw.match(/^%PDF-([0-9.]+)/)?.[1]}` : "",
    summarizePdfPageCount(raw),
    ...["Title", "Author", "Subject", "Creator", "Producer", "CreationDate", "ModDate"]
      .map((name) => readPdfInfoString(raw, name))
      .filter(Boolean),
  ].filter(Boolean);
  return hints.length > 0 ? hints.slice(0, 10).join("; ") : "";
}

function readPdfStructureSecurityHints(raw: string): string {
  const hints = [
    summarizePdfAnnotationMarkers(raw),
    summarizePdfEmbeddedFileMarkers(raw),
    summarizePdfScriptActionMarkers(raw),
    summarizePdfFormAndEncryptionMarkers(raw),
  ].filter(Boolean);
  return hints.length > 0 ? hints.join("; ") : "";
}

function readPdfObjectSummaries(raw: string): string {
  const hints = [summarizePdfAnnotationObjects(raw), summarizePdfEmbeddedFileObjects(raw)].filter(Boolean);
  return hints.length > 0 ? hints.join("; ") : "";
}

function summarizePdfPageCount(raw: string): string {
  const pageMarkers = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length;
  return pageMarkers > 0 ? `${pageMarkers} page marker${pageMarkers === 1 ? "" : "s"}` : "";
}

function summarizePdfAnnotationMarkers(raw: string): string {
  const annotationObjects = [...raw.matchAll(/\/Type\s*\/Annot\b/g)].length;
  const annotationArrays = [...raw.matchAll(/\/Annots\b/g)].length;
  const linkAnnotations = [...raw.matchAll(/\/Subtype\s*\/Link\b/g)].length;
  const hints = [
    annotationObjects > 0 ? `${annotationObjects} annotation object marker${annotationObjects === 1 ? "" : "s"}` : "",
    annotationArrays > 0 ? `${annotationArrays} annotation array marker${annotationArrays === 1 ? "" : "s"}` : "",
    linkAnnotations > 0 ? `${linkAnnotations} link annotation marker${linkAnnotations === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return hints.length > 0 ? hints.join(", ") : "";
}

function summarizePdfEmbeddedFileMarkers(raw: string): string {
  const embeddedFiles = [...raw.matchAll(/\/Type\s*\/EmbeddedFile\b|\/EmbeddedFile\b/g)].length;
  const fileSpecs = [...raw.matchAll(/\/Type\s*\/Filespec\b/g)].length;
  const embeddedNameTrees = [...raw.matchAll(/\/EmbeddedFiles\b/g)].length;
  const hints = [
    embeddedFiles > 0 ? `${embeddedFiles} embedded-file marker${embeddedFiles === 1 ? "" : "s"}` : "",
    fileSpecs > 0 ? `${fileSpecs} file-spec marker${fileSpecs === 1 ? "" : "s"}` : "",
    embeddedNameTrees > 0 ? `${embeddedNameTrees} embedded-file name-tree marker${embeddedNameTrees === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return hints.length > 0 ? hints.join(", ") : "";
}

function summarizePdfAnnotationObjects(raw: string): string {
  const summaries = extractPdfObjectSnippets(raw)
    .filter((snippet) => /\/Type\s*\/Annot\b|\/Subtype\s*\/(?:Text|Link|FileAttachment|Highlight|Underline|FreeText|Widget)\b/.test(snippet))
    .slice(0, MAX_PDF_OBJECT_SUMMARY_ITEMS)
    .map((snippet) => {
      const subtype = readPdfNameValue(snippet, "Subtype") || "Annot";
      const label = readPdfDictionaryString(snippet, "Contents") || readPdfDictionaryString(snippet, "T") || readPdfDictionaryString(snippet, "NM");
      const uri = readPdfDictionaryString(snippet, "URI");
      const rect = snippet.match(/\/Rect\s*\[([^\]]{1,160})\]/)?.[1]?.replace(/\s+/g, " ").trim();
      return [
        subtype,
        label ? `label "${trimPdfObjectPreview(label, 80)}"` : "",
        uri ? `uri ${trimPdfObjectPreview(redactBookmarkUrl(uri), 100)}` : "",
        rect ? `rect [${trimPdfObjectPreview(rect, 80)}]` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);
  return summaries.length > 0 ? `annotation object summaries (${summaries.length}): ${summaries.join(" | ")}` : "";
}

function summarizePdfEmbeddedFileObjects(raw: string): string {
  const summaries = extractPdfObjectSnippets(raw)
    .filter((snippet) => /\/Type\s*\/Filespec\b|\/EmbeddedFile\b|\/EF\s*<</.test(snippet))
    .slice(0, MAX_PDF_OBJECT_SUMMARY_ITEMS)
    .map((snippet) => {
      const name =
        readPdfDictionaryString(snippet, "UF") ||
        readPdfDictionaryString(snippet, "F") ||
        readPdfDictionaryString(snippet, "Desc") ||
        readPdfNameValue(snippet, "F");
      const relation = /\/Type\s*\/EmbeddedFile\b/.test(snippet)
        ? "embedded stream"
        : /\/Type\s*\/Filespec\b/.test(snippet)
          ? "file spec"
          : "embedded file reference";
      return name ? `${relation} "${trimPdfObjectPreview(name, 100)}"` : relation;
    })
    .filter(Boolean);
  return summaries.length > 0 ? `embedded file object summaries (${summaries.length}): ${summaries.join(" | ")}` : "";
}

function extractPdfObjectSnippets(raw: string): string[] {
  return [...raw.matchAll(/\d+\s+\d+\s+obj[\s\S]*?endobj/g)]
    .map((match) => match[0]?.slice(0, 2400) ?? "")
    .filter(Boolean);
}

function readPdfNameValue(raw: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw.match(new RegExp(`/${escapedName}\\s*/([A-Za-z0-9_.#-]+)`))?.[1]?.replace(/#/g, "") ?? "";
}

function readPdfDictionaryString(raw: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalMatch = raw.match(new RegExp(`/${escapedName}\\s*\\(([^()]*)\\)`));
  const hexMatch = raw.match(new RegExp(`/${escapedName}\\s*<([0-9a-fA-F\\s]+)>`));
  return literalMatch
    ? decodePdfString(literalMatch[1] ?? "")
    : hexMatch
      ? decodePdfHexString(hexMatch[1] ?? "")
      : "";
}

function trimPdfObjectPreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function summarizePdfScriptActionMarkers(raw: string): string {
  const javascriptActions = [...raw.matchAll(/\/S\s*\/JavaScript\b|\/JavaScript\b/g)].length;
  const openActions = [...raw.matchAll(/\/OpenAction\b/g)].length;
  const launchActions = [...raw.matchAll(/\/S\s*\/Launch\b|\/Launch\b/g)].length;
  const uriActions = [...raw.matchAll(/\/S\s*\/URI\b|\/URI\b/g)].length;
  const hints = [
    javascriptActions > 0 ? `${javascriptActions} JavaScript action marker${javascriptActions === 1 ? "" : "s"}` : "",
    openActions > 0 ? `${openActions} open-action marker${openActions === 1 ? "" : "s"}` : "",
    launchActions > 0 ? `${launchActions} launch-action marker${launchActions === 1 ? "" : "s"}` : "",
    uriActions > 0 ? `${uriActions} URI action marker${uriActions === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return hints.length > 0 ? hints.join(", ") : "";
}

function summarizePdfFormAndEncryptionMarkers(raw: string): string {
  const forms = [...raw.matchAll(/\/AcroForm\b/g)].length;
  const encryptions = [...raw.matchAll(/\/Encrypt\b/g)].length;
  const signatures = [...raw.matchAll(/\/Type\s*\/Sig\b|\/Sig\b/g)].length;
  const hints = [
    forms > 0 ? `${forms} form marker${forms === 1 ? "" : "s"}` : "",
    encryptions > 0 ? `${encryptions} encryption dictionary marker${encryptions === 1 ? "" : "s"}` : "",
    signatures > 0 ? `${signatures} signature marker${signatures === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return hints.length > 0 ? hints.join(", ") : "";
}

function readPdfInfoString(raw: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalMatch = raw.match(new RegExp(`/${escapedName}\\s*\\(([^()]*)\\)`));
  const hexMatch = raw.match(new RegExp(`/${escapedName}\\s*<([0-9a-fA-F\\s]+)>`));
  const value = literalMatch
    ? decodePdfString(literalMatch[1] ?? "")
    : hexMatch
      ? decodePdfHexString(hexMatch[1] ?? "")
      : "";
  return value ? `${name}: ${value}` : "";
}

function decodePdfHexString(value: string): string {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 2 !== 0) return "";
  const bytes: number[] = [];
  for (let index = 0; index < compact.length; index += 2) {
    bytes.push(Number.parseInt(compact.slice(index, index + 2), 16));
  }
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const codeUnits: number[] = [];
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      codeUnits.push((buffer[index] << 8) | buffer[index + 1]);
    }
    return String.fromCharCode(...codeUnits).replace(/\s+/g, " ").trim().slice(0, 480);
  }
  return buffer.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 480);
}

function extractDocxTextSummary(filePath: string, extension: string): string {
  try {
    const entries = extractZipEntries(readFileSync(filePath));
    const text = entries
      .filter((entry) =>
        /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(
          entry.name,
        ),
      )
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .map((entry) => extractXmlText(entry.data.toString("utf8")))
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [
      text,
      extension === ".docm"
        ? "Macro-enabled Word preview read Office XML only; VBA project streams were not opened, macros were not executed, and no Word runtime, network call, or provider send was performed."
        : "",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function extractEpubTextSummary(filePath: string, size: number): string {
  try {
    const entries = extractZipEntries(readFileSync(filePath));
    const entryMap = new Map(entries.map((entry) => [entry.name, entry.data]));
    const mimeMarker = entryMap.get("mimetype")?.toString("utf8").trim();
    const containerXml = entryMap.get("META-INF/container.xml")?.toString("utf8") ?? "";
    const packagePath =
      containerXml.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i)?.[1]?.replace(/\\/g, "/") ??
      entries.find((entry) => entry.name.toLowerCase().endsWith(".opf"))?.name;
    const packageXml = packagePath ? entryMap.get(packagePath)?.toString("utf8") ?? "" : "";
    const metadata = packageXml ? readEpubMetadata(packageXml) : [];
    const contentPaths = packageXml
      ? readEpubContentPaths(packageXml, packagePath || "")
      : entries
          .map((entry) => entry.name)
          .filter((name) => /\.(xhtml|html?)$/i.test(name));
    const textPreview = contentPaths
      .map((contentPath) => {
        const raw = entryMap.get(contentPath)?.toString("utf8");
        if (!raw) return "";
        return decodeHtmlEntities(
          raw
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        );
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES - 720);
    return [
      `EPUB ebook preview (${formatBytes(size)}).`,
      mimeMarker === "application/epub+zip"
        ? "MIME marker: application/epub+zip."
        : "MIME marker: not found in the bounded local EPUB package.",
      packagePath ? `Package file: ${packagePath}.` : "Package file: not found in the bounded local EPUB package.",
      metadata.length > 0 ? `Metadata: ${metadata.join(" | ")}` : "Metadata: no title/creator/language metadata found.",
      `Content documents: ${contentPaths.length}${contentPaths.length >= MAX_EPUB_TEXT_ITEMS ? "+" : ""} XHTML/HTML item(s) considered for preview.`,
      textPreview || "No readable EPUB body text was found in the bounded preview.",
      "EPUB preview read local ZIP package metadata and bounded XHTML/HTML text only; no ebook renderer, script execution, DRM handling, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function readEpubMetadata(packageXml: string): string[] {
  const title = readXmlLocalTagValues(packageXml, "title")[0];
  const creators = readXmlLocalTagValues(packageXml, "creator").slice(0, 3);
  const language = readXmlLocalTagValues(packageXml, "language")[0];
  return [
    title ? `Title: ${title}` : "",
    creators.length > 0 ? `Creator: ${creators.join(", ")}` : "",
    language ? `Language: ${language}` : "",
  ].filter(Boolean);
}

function readEpubContentPaths(packageXml: string, packagePath: string): string[] {
  const basePath = packagePath.includes("/") ? packagePath.slice(0, packagePath.lastIndexOf("/") + 1) : "";
  return [...packageXml.matchAll(/<item\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1] ?? "")
    .filter((href) => /\.(xhtml|html?)$/i.test(href))
    .map((href) => normalizeZipPath(`${basePath}${href}`))
    .slice(0, MAX_EPUB_TEXT_ITEMS);
}

function readXmlLocalTagValues(xml: string, tagName: string): string[] {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:[\\w-]+:)?${escapedTagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escapedTagName}>`, "gi");
  return [...xml.matchAll(pattern)]
    .map((match) => decodeXmlEntities((match[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeZipPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function extractMarkdownTextSummary(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 8)).toString("utf8");
    const headings = [...raw.matchAll(/^(#{1,6})\s+(.+)$/gm)]
      .map((match) => `${match[1]} ${stripMarkdownInline(match[2] ?? "")}`)
      .slice(0, 12);
    const text = stripMarkdownInline(raw)
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [
      `Markdown document preview (${formatBytes(size)}).`,
      headings.length > 0 ? `Headings: ${headings.join(" | ")}` : "No Markdown headings were found in the bounded preview.",
      text || "No readable Markdown body text was found.",
      "Markdown preview read local text only; no script execution, network call, renderer navigation, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function stripMarkdownInline(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractHtmlTextSummary(filePath: string): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 8)).toString("utf8");
    return buildHtmlTextSummary(raw, "HTML document preview");
  } catch {
    return "";
  }
}

function extractMhtmlTextSummary(filePath: string): string {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 8)).toString("utf8");
    const htmlParts = [...raw.matchAll(/Content-Type:\s*text\/html[^]*?(?:\r?\n){2}([^]*?)(?=\r?\n--[^\r\n]+|$)/gi)]
      .map((match) => match[1] ?? "")
      .filter(Boolean);
    const textParts = [...raw.matchAll(/Content-Type:\s*text\/plain[^]*?(?:\r?\n){2}([^]*?)(?=\r?\n--[^\r\n]+|$)/gi)]
      .map((match) => match[1] ?? "")
      .filter(Boolean);
    const body = htmlParts[0] || textParts[0] || raw;
    return buildHtmlTextSummary(body, "MHTML web archive preview");
  } catch {
    return "";
  }
}

function buildHtmlTextSummary(raw: string, label: string): string {
  const title = decodeHtmlEntities(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const text = decodeHtmlEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return [
    `${label}.`,
    title ? `Title: ${title}` : "No HTML title was found in the bounded preview.",
    text || "No readable HTML body text was found.",
    "HTML/MHTML preview stripped local markup only; no script execution, network call, renderer navigation, or provider send was performed.",
  ].join("\n").slice(0, MAX_TEXT_BYTES);
}

interface BrowserBookmarkExportPreview {
  title: string | null;
  folders: string[];
  links: Array<{
    title: string;
    url: string;
    host: string;
    addedAt: string | null;
  }>;
}

function looksLikeBrowserBookmarkExport(filePath: string): boolean {
  try {
    const raw = readFileHeader(filePath, Math.min(MAX_BOOKMARK_PREVIEW_BYTES, 16 * 1024)).toString("utf8");
    return (
      /<!DOCTYPE\s+NETSCAPE-Bookmark-file-1/i.test(raw) ||
      (/<META\s+HTTP-EQUIV=["']Content-Type["'][^>]*>/i.test(raw) &&
        /<DL><p>/i.test(raw) &&
        /<DT><A\s/i.test(raw))
    );
  } catch {
    return false;
  }
}

function summarizeBrowserBookmarkExportFile(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_BOOKMARK_PREVIEW_BYTES).toString("utf8");
    const preview = parseBrowserBookmarkExportPreview(raw);
    const folders =
      preview.folders.length > 0
        ? preview.folders.slice(0, MAX_BOOKMARK_ITEM_PREVIEW).join(", ")
        : "none detected in the bounded local preview";
    const hosts = summarizeCounts(preview.links.map((link) => link.host).filter(Boolean));
    const links =
      preview.links.length > 0
        ? preview.links
            .slice(0, MAX_BOOKMARK_ITEM_PREVIEW)
            .map((link, index) => {
              const added = link.addedAt ? `; added ${link.addedAt}` : "";
              return `- ${index + 1}. ${link.title} - ${link.url}${added}`;
            })
            .join("\n")
        : "Bookmark samples: none detected in the bounded local preview.";
    return [
      `Browser bookmark export preview (${formatBytes(size)}).`,
      `Export title: ${preview.title || "none detected in the bounded local preview"}.`,
      `Folders: ${folders}.`,
      `Links: ${preview.links.length}${preview.links.length >= MAX_BOOKMARK_ITEM_PREVIEW ? "+" : ""}; hosts: ${hosts || "none detected"}.`,
      `Bookmark samples:\n${links}`,
      "Ready for explicit attachment after visible review; Netscape bookmark HTML was parsed from a bounded workspace-local export only, browser profiles were not opened, URLs were not fetched, scripts were not executed, and no network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Browser bookmark export ready for explicit attachment (${formatBytes(size)}).`,
      "Bookmark preview could not parse bounded local HTML; browser profiles were not opened, URLs were not fetched, scripts were not executed, and no network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseBrowserBookmarkExportPreview(raw: string): BrowserBookmarkExportPreview {
  const title = decodeHtmlEntities(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null;
  const folders = [...raw.matchAll(/<DT><H3\b[^>]*>([\s\S]*?)<\/H3>/gi)]
    .map((match) => decodeHtmlEntities(stripHtmlTags(match[1] ?? "")))
    .filter(Boolean)
    .map((value) => clampSingleLine(value, 120))
    .slice(0, MAX_BOOKMARK_ITEM_PREVIEW);
  const links = [...raw.matchAll(/<DT><A\b([^>]*)>([\s\S]*?)<\/A>/gi)]
    .map((match) => {
      const attrs = match[1] ?? "";
      const rawHref = attrs.match(/\bHREF\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      const url = redactBookmarkUrl(decodeHtmlEntities(rawHref));
      const titleText = decodeHtmlEntities(stripHtmlTags(match[2] ?? "")) || "Untitled bookmark";
      const addedAt = attrs.match(/\bADD_DATE\s*=\s*["']?(\d+)["']?/i)?.[1] || "";
      return {
        title: clampSingleLine(titleText, 140),
        url: clampSingleLine(url, 220),
        host: readBookmarkHost(rawHref),
        addedAt: formatBookmarkTimestamp(addedAt),
      };
    })
    .filter((link) => link.url)
    .slice(0, MAX_BOOKMARK_ITEM_PREVIEW);
  return { title, folders, links };
}

interface LinkShortcutPreview {
  url: string;
  title: string | null;
  host: string;
}

function summarizeLinkShortcutFile(filePath: string, extension: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, MAX_LINK_SHORTCUT_PREVIEW_BYTES).toString("utf8");
    const preview =
      extension === ".webloc" ? parseWeblocShortcutFile(raw) : parseUrlShortcutFile(raw);
    if (!preview?.url) {
      throw new Error("No URL was found in the bounded local shortcut preview.");
    }
    return [
      `Link shortcut preview (${formatBytes(size)}).`,
      preview.title ? `Title: ${preview.title}` : "Title: none detected in the bounded local preview.",
      `URL: ${preview.url}`,
      `Host: ${preview.host || "none detected"}.`,
      "Ready for explicit attachment after visible review; link shortcut metadata was parsed from a bounded workspace-local file only, browser profiles were not opened, URLs were not fetched, scripts were not executed, and no network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Link shortcut ready for explicit attachment (${formatBytes(size)}).`,
      "Shortcut preview could not parse a URL from bounded local text; browser profiles were not opened, URLs were not fetched, scripts were not executed, and no network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function parseUrlShortcutFile(raw: string): LinkShortcutPreview | null {
  const lines = normalizeTextPreview(raw).split("\n");
  let title: string | null = null;
  let rawUrl = "";
  for (const line of lines) {
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match?.[1]) continue;
    const key = match[1].trim().toLowerCase();
    const value = (match[2] || "").trim();
    if (key === "url") rawUrl = value;
    if (key === "baseshortcut" && !rawUrl) rawUrl = value;
    if ((key === "localizedresourcename" || key === "name") && value) {
      title = clampSingleLine(value, 160);
    }
  }
  if (!rawUrl) {
    rawUrl = raw.match(/\bhttps?:\/\/[^\s<>"']+/i)?.[0] || "";
  }
  return buildLinkShortcutPreview(rawUrl, title);
}

function parseWeblocShortcutFile(raw: string): LinkShortcutPreview | null {
  const url =
    decodeHtmlEntities(raw.match(/<key>\s*URL\s*<\/key>\s*<string>([\s\S]*?)<\/string>/i)?.[1] ?? "") ||
    decodeHtmlEntities(raw.match(/<string>(https?:\/\/[\s\S]*?)<\/string>/i)?.[1] ?? "");
  const title =
    decodeHtmlEntities(raw.match(/<key>\s*title\s*<\/key>\s*<string>([\s\S]*?)<\/string>/i)?.[1] ?? "") ||
    null;
  return buildLinkShortcutPreview(url, title ? clampSingleLine(title, 160) : null);
}

function buildLinkShortcutPreview(rawUrl: string, title: string | null): LinkShortcutPreview | null {
  const url = redactBookmarkUrl(decodeHtmlEntities(rawUrl));
  if (!url) return null;
  return {
    url: clampSingleLine(url, 260),
    title,
    host: readBookmarkHost(url),
  };
}

interface WindowsShortcutHeaderPreview {
  validHeader: boolean;
  flags: string[];
  attributes: string[];
  createdAt: string | null;
  accessedAt: string | null;
  modifiedAt: string | null;
  targetSize: number | null;
  showCommand: string;
  hotkey: string | null;
  strings: string[];
}

function summarizeWindowsShortcutFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, MAX_WINDOWS_SHORTCUT_PREVIEW_BYTES);
    const preview = readWindowsShortcutHeaderPreview(buffer);
    const flags = preview.flags.length > 0 ? preview.flags.join(", ") : "none detected";
    const attributes =
      preview.attributes.length > 0 ? preview.attributes.join(", ") : "none detected";
    const timestamps = [
      preview.createdAt ? `created ${preview.createdAt}` : "",
      preview.modifiedAt ? `modified ${preview.modifiedAt}` : "",
      preview.accessedAt ? `accessed ${preview.accessedAt}` : "",
    ].filter(Boolean);
    const stringSample =
      preview.strings.length > 0
        ? preview.strings.map((line, index) => `String ${index + 1}: ${line}`).join("\n")
        : "No readable target/name/comment string samples were found in the bounded local preview.";
    return [
      `Windows shortcut metadata preview (${formatBytes(size)}).`,
      `Shell Link header: ${preview.validHeader ? "valid" : "not recognized in bounded header"}.`,
      `Link flags: ${flags}.`,
      `File attributes: ${attributes}.`,
      timestamps.length > 0 ? `Timestamps: ${timestamps.join("; ")}.` : "Timestamps: none detected.",
      preview.targetSize !== null ? `Target file size hint: ${formatBytes(preview.targetSize)}.` : "",
      `Show command: ${preview.showCommand}.`,
      preview.hotkey ? `Hotkey: ${preview.hotkey}.` : "Hotkey: none detected.",
      stringSample,
      "Ready for explicit attachment after visible review; Windows shortcut metadata was parsed from bounded workspace-local bytes only, the shortcut target was not resolved or opened, shell execution was not performed, linked files were not read, and no network call, credential lookup, or provider send was performed.",
    ].filter(Boolean).join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Windows shortcut ready for explicit attachment (${formatBytes(size)}).`,
      "Shortcut metadata preview could not parse the bounded local Shell Link header; the shortcut target was not resolved or opened, shell execution was not performed, linked files were not read, and no network call, credential lookup, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readWindowsShortcutHeaderPreview(buffer: Buffer): WindowsShortcutHeaderPreview {
  const validHeader =
    buffer.length >= 76 &&
    buffer.readUInt32LE(0) === 0x4c &&
    buffer.subarray(4, 20).equals(
      Buffer.from([0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]),
    );
  const flags = validHeader ? describeWindowsShortcutFlags(buffer.readUInt32LE(20)) : [];
  const attributes = validHeader ? describeWindowsShortcutAttributes(buffer.readUInt32LE(24)) : [];
  return {
    validHeader,
    flags,
    attributes,
    createdAt: validHeader ? readWindowsFileTime(buffer, 28) : null,
    accessedAt: validHeader ? readWindowsFileTime(buffer, 36) : null,
    modifiedAt: validHeader ? readWindowsFileTime(buffer, 44) : null,
    targetSize: validHeader ? buffer.readUInt32LE(52) || null : null,
    showCommand: validHeader ? describeWindowsShortcutShowCommand(buffer.readUInt32LE(60)) : "unknown",
    hotkey: validHeader ? describeWindowsShortcutHotkey(buffer.readUInt16LE(64)) : null,
    strings: extractWindowsShortcutStringSamples(buffer),
  };
}

function describeWindowsShortcutFlags(flags: number): string[] {
  const knownFlags: Array<[number, string]> = [
    [0x00000001, "target ID list"],
    [0x00000002, "link info"],
    [0x00000004, "name string"],
    [0x00000008, "relative path"],
    [0x00000010, "working directory"],
    [0x00000020, "arguments"],
    [0x00000040, "icon location"],
    [0x00000080, "unicode strings"],
    [0x00000200, "exp string"],
    [0x00002000, "darwin data"],
    [0x00004000, "run as user"],
    [0x00008000, "exp icon"],
    [0x00020000, "known folder"],
  ];
  return knownFlags
    .filter(([bit]) => (flags & bit) !== 0)
    .map(([, label]) => label);
}

function describeWindowsShortcutAttributes(attributes: number): string[] {
  const knownAttributes: Array<[number, string]> = [
    [0x00000001, "read-only"],
    [0x00000002, "hidden"],
    [0x00000004, "system"],
    [0x00000010, "directory"],
    [0x00000020, "archive"],
    [0x00000040, "device"],
    [0x00000080, "normal"],
    [0x00000100, "temporary"],
    [0x00000400, "sparse"],
    [0x00000800, "reparse point"],
    [0x00001000, "compressed"],
    [0x00002000, "offline"],
    [0x00004000, "not indexed"],
    [0x00008000, "encrypted"],
  ];
  return knownAttributes
    .filter(([bit]) => (attributes & bit) !== 0)
    .map(([, label]) => label);
}

function readWindowsFileTime(buffer: Buffer, offset: number): string | null {
  if (offset + 8 > buffer.length) return null;
  const value = buffer.readBigUInt64LE(offset);
  if (value === 0n) return null;
  const epochOffset = 116444736000000000n;
  const milliseconds = Number((value - epochOffset) / 10000n);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function describeWindowsShortcutShowCommand(value: number): string {
  return (
    {
      1: "normal",
      3: "maximized",
      7: "minimized/no-active",
    }[value] ?? `code ${value}`
  );
}

function describeWindowsShortcutHotkey(value: number): string | null {
  if (!value) return null;
  const low = value & 0xff;
  const high = (value >> 8) & 0xff;
  const modifiers = [
    (high & 0x01) !== 0 ? "Shift" : "",
    (high & 0x02) !== 0 ? "Ctrl" : "",
    (high & 0x04) !== 0 ? "Alt" : "",
  ].filter(Boolean);
  const key = low >= 32 && low <= 126 ? String.fromCharCode(low) : `key ${low}`;
  return [...modifiers, key].join("+");
}

function extractWindowsShortcutStringSamples(buffer: Buffer): string[] {
  const seen = new Set<string>();
  return [
    ...extractPrintableByteRuns(buffer),
    ...extractUtf16LeByteRuns(buffer),
  ]
    .map((value) => maskPotentialSecretValues(value.replace(/\s+/g, " ").trim()))
    .filter((value) => {
      if (
        value.length < 4 ||
        value.length > 260 ||
        seen.has(value) ||
        !/[A-Za-z0-9]:?\\|[A-Za-z0-9._-]+\.[A-Za-z0-9]{2,}|https?:\/\//i.test(value) ||
        /^[0-9a-f-]{20,}$/i.test(value)
      ) {
        return false;
      }
      seen.add(value);
      return true;
    })
    .slice(0, MAX_WINDOWS_SHORTCUT_STRING_PREVIEW);
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function redactBookmarkUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveFieldName(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return maskPotentialSecretValues(rawUrl);
  }
}

function readBookmarkHost(rawUrl: string): string {
  try {
    return new URL(decodeHtmlEntities(rawUrl)).host;
  } catch {
    return "";
  }
}

function formatBookmarkTimestamp(value: string): string | null {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractPptxTextSummary(filePath: string, extension: string): string {
  try {
    const entries = extractZipEntries(readFileSync(filePath));
    const text = entries
      .filter((entry) =>
        /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|comments\/comment\d+)\.xml$/.test(
          entry.name,
        ),
      )
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .map((entry) => extractXmlText(entry.data.toString("utf8")))
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [
      text,
      extension === ".pptm"
        ? "Macro-enabled PowerPoint preview read text runs from Office Open XML only; VBA project streams were not opened, macros were not executed, and no PowerPoint runtime, network call, or provider send was performed."
        : "Presentation preview read text runs from Office Open XML only; no PowerPoint runtime, macro execution, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function extractLegacyPptTextSummary(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 32),
    );
    const strings = extractLegacyOfficeBinaryStrings(buffer).slice(0, 18);
    return [
      strings.length > 0
        ? `Legacy PowerPoint text preview (${formatBytes(size)}).`
        : `Legacy PowerPoint file ready for explicit attachment (${formatBytes(size)}).`,
      strings.length > 0
        ? strings.map((line, index) => `Text ${index + 1}: ${line}`).join("\n")
        : "No readable text strings were found in the bounded local binary preview.",
      "Legacy PowerPoint preview scanned bounded local binary strings only; no PowerPoint runtime, macro execution, embedded media extraction, OCR, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function extractLegacyOfficeBinaryTextSummary(filePath: string, size: number, extension: string): string {
  try {
    const buffer = readFileHeader(
      filePath,
      Math.min(MAX_DOCUMENT_EXTRACT_BYTES, MAX_TEXT_BYTES * 32),
    );
    const strings = extractLegacyOfficeBinaryStrings(buffer).slice(0, 18);
    const isWord = extension === ".doc";
    const product = isWord ? "Word" : "Excel";
    const objectLabel = isWord ? "document" : "workbook";
    const safety =
      isWord
        ? "Legacy Word preview scanned bounded local binary strings only; no Word runtime, macro execution, embedded object extraction, OCR, network call, or provider send was performed."
        : "Legacy Excel preview scanned bounded local binary strings only; no Excel runtime, macro execution, formula evaluation, embedded object extraction, OCR, network call, or provider send was performed.";
    return [
      strings.length > 0
        ? `Legacy ${product} ${objectLabel} text preview (${formatBytes(size)}).`
        : `Legacy ${product} ${objectLabel} file ready for explicit attachment (${formatBytes(size)}).`,
      strings.length > 0
        ? strings.map((line, index) => `Text ${index + 1}: ${line}`).join("\n")
        : "No readable text strings were found in the bounded local binary preview.",
      safety,
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function extractLegacyOfficeBinaryStrings(buffer: Buffer): string[] {
  const seen = new Set<string>();
  const candidates = [
    ...extractPrintableByteRuns(buffer),
    ...extractUtf16LeByteRuns(buffer),
  ];
  return candidates.filter((candidate) => {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (
      normalized.length < 4 ||
      normalized.length > 280 ||
      seen.has(normalized) ||
      !/[A-Za-z0-9\u0080-\uffff]/.test(normalized) ||
      /^[\d .:_-]+$/.test(normalized)
    ) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function extractPrintableByteRuns(buffer: Buffer): string[] {
  return buffer
    .toString("latin1")
    .replace(/[^\x20-\x7e\u00a0-\u00ff]+/g, "\n")
    .split("\n")
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4);
}

function extractUtf16LeByteRuns(buffer: Buffer): string[] {
  const runs: string[] = [];
  let current = "";
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    const code = buffer.readUInt16LE(index);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xfffd)) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.trim().length >= 4) runs.push(current.replace(/\s+/g, " ").trim());
    current = "";
  }
  if (current.trim().length >= 4) runs.push(current.replace(/\s+/g, " ").trim());
  return runs;
}

function extractOpenDocumentTextSummary(filePath: string): string {
  try {
    const entries = extractZipEntries(readFileSync(filePath));
    const text = entries
      .filter((entry) => entry.name === "content.xml" || /^Pictures\/.*\.xml$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .map((entry) => extractXmlText(entry.data.toString("utf8")))
      .filter(Boolean)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return [
      text,
      "OpenDocument preview read local content.xml text only; no LibreOffice/OpenOffice runtime, macro execution, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

type ChannelZipEntryMetadata = {
  name: string;
  compressedSize?: number;
  uncompressedSize?: number;
  directory: boolean;
  method: number;
};

type ChannelTarEntryMetadata = {
  name: string;
  size: number;
  directory: boolean;
  typeFlag: string;
};

type ChannelGzipMetadata = {
  originalName?: string;
  method: number;
  flags: number;
  mtime?: string;
  operatingSystem: string;
  uncompressedSize?: number;
};

type ChannelSevenZipMetadata = {
  majorVersion: number;
  minorVersion: number;
  nextHeaderOffset?: bigint;
  nextHeaderSize?: bigint;
  nextHeaderCrc?: number;
};

type ChannelRarMetadata = {
  format: "RAR4" | "RAR5";
  firstHeaderType?: string;
  firstHeaderFlags?: number;
  firstHeaderSize?: number;
};

function summarizeZipArchiveFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_PREVIEW_BYTES));
    const { entries, truncated } = readZipArchiveMetadata(buffer);
    const files = entries.filter((entry) => !entry.directory);
    const directories = entries.filter((entry) => entry.directory);
    const nestedArchiveEntries = entries
      .filter((entry) => !entry.directory && isNestedArchiveEntryName(entry.name))
      .slice(0, 6);
    const nestedArchiveInspection = summarizeNestedArchiveEntriesInZip(filePath, size, nestedArchiveEntries);
    const previews = entries.slice(0, MAX_ARCHIVE_PREVIEW_ENTRIES).map((entry, index) => {
      const sizeLabel =
        typeof entry.uncompressedSize === "number" && entry.uncompressedSize > 0
          ? `, ${formatBytes(entry.uncompressedSize)}`
          : "";
      const kind = entry.directory ? "directory" : "file";
      return `${index + 1}. ${entry.name} (${kind}${sizeLabel}, method ${entry.method})`;
    });
    return [
      `ZIP archive metadata preview (${formatBytes(size)}).`,
      `${files.length} file entr${files.length === 1 ? "y" : "ies"} and ${directories.length} director${directories.length === 1 ? "y" : "ies"} found in the bounded local header scan.`,
      truncated ? "Archive preview was truncated before every entry could be listed." : "",
      nestedArchiveEntries.length > 0
        ? `Nested archive metadata cues: ${nestedArchiveEntries.map((entry) => entry.name).join(", ")}.`
        : "Nested archive metadata cues: none found in the bounded local header scan.",
      ...nestedArchiveInspection,
      previews.length > 0 ? `Entries:\n${previews.join("\n")}` : "No readable ZIP local file headers were found.",
      "ZIP preview read local archive headers and bounded nested archive metadata windows up to depth 2 only; no archive extraction, unbounded recursive deep extraction, file execution, external tool startup, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `ZIP archive ready for explicit attachment (${formatBytes(size)}).`,
      "ZIP preview did not parse readable local headers; no archive extraction, file execution, external tool startup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeNestedArchiveEntriesInZip(
  filePath: string,
  size: number,
  nestedArchiveEntries: ChannelZipEntryMetadata[],
): string[] {
  if (nestedArchiveEntries.length === 0) return [];
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_PREVIEW_BYTES));
    const previews = readNestedArchivePreviewsFromZip(buffer);
    if (previews.length === 0) {
      return [
        "First-level nested archive inspection: nested archive names were detected, but readable nested metadata was unavailable in the bounded local window.",
      ];
    }
    return [
      `First-level nested archive inspection used up to ${formatBytes(MAX_NESTED_ARCHIVE_PREVIEW_INPUT_BYTES)} compressed bytes and ${formatBytes(MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES)} in-memory output per nested entry.`,
      `Second-level nested archive inspection is capped at depth ${MAX_NESTED_ARCHIVE_INSPECTION_DEPTH} and reuses the same in-memory metadata windows without archive extraction.`,
      ...previews,
    ];
  } catch {
    return [
      "First-level nested archive inspection unavailable; visible nested archive filename cues are still shown.",
    ];
  }
}

function readNestedArchivePreviewsFromZip(buffer: Buffer): string[] {
  return readRecursiveNestedArchivePreviewsFromZip(buffer, 1);
}

function readRecursiveNestedArchivePreviewsFromZip(buffer: Buffer, depth: number, parentName = ""): string[] {
  const previews: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && previews.length < MAX_NESTED_ARCHIVE_PREVIEW_ENTRIES) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (nameLength <= 0 || dataStart > buffer.length) break;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8").replace(/\\/g, "/").replace(/\0/g, "").slice(0, 240);
    if ((flags & 0x08) !== 0 || compressedSize === 0 || dataEnd > buffer.length) {
      offset = Math.max(offset + 4, dataStart);
      continue;
    }
    if (isNestedArchiveEntryName(name) && compressedSize <= MAX_NESTED_ARCHIVE_PREVIEW_INPUT_BYTES) {
      const nestedData = inflateZipEntryMetadataWindow(buffer.subarray(dataStart, dataEnd), method);
      const displayName = parentName ? `${parentName} -> ${name}` : name;
      const preview = nestedData ? describeNestedArchiveMetadata(displayName, nestedData, depth) : undefined;
      if (preview) previews.push(preview);
      if (nestedData && depth < MAX_NESTED_ARCHIVE_INSPECTION_DEPTH) {
        const childPreviews = readNestedArchiveChildPreviews(name, nestedData, depth + 1)
          .slice(0, MAX_NESTED_ARCHIVE_PREVIEW_ENTRIES - previews.length);
        previews.push(...childPreviews);
      }
    }
    offset = dataEnd;
  }
  return previews;
}

function readNestedArchiveChildPreviews(name: string, data: Buffer, depth: number): string[] {
  const archiveExtension = getNestedArchiveExtension(name);
  if (archiveExtension === ".zip") {
    return readRecursiveNestedArchivePreviewsFromZip(data, depth, name);
  }
  if (archiveExtension === ".tar") {
    const { entries } = readTarArchiveMetadata(data);
    return describeNestedArchiveCuesAsDepthPreviews(name, entries, depth);
  }
  if (archiveExtension === ".tar.gz" || archiveExtension === ".tgz") {
    try {
      const tarBuffer = gunzipSync(data, {
        maxOutputLength: MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES,
      });
      const { entries } = readTarArchiveMetadata(tarBuffer);
      return describeNestedArchiveCuesAsDepthPreviews(name, entries, depth);
    } catch {
      return [];
    }
  }
  return [];
}

function describeNestedArchiveCuesAsDepthPreviews(
  parentName: string,
  entries: ChannelTarEntryMetadata[],
  depth: number,
): string[] {
  return entries
    .filter((entry) => !entry.directory && isNestedArchiveEntryName(entry.name))
    .slice(0, MAX_NESTED_ARCHIVE_PREVIEW_ENTRIES)
    .map((entry) =>
      `Nested archive ${parentName} -> ${entry.name} (depth ${depth} cue): bounded second-level metadata cue only; no nested file extraction was performed.`,
    );
}

function inflateZipEntryMetadataWindow(data: Buffer, method: number): Buffer | null {
  try {
    if (method === 0) return data.subarray(0, MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES);
    if (method === 8) {
      return inflateRawSync(data, {
        maxOutputLength: MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES,
      });
    }
  } catch {
    return null;
  }
  return null;
}

function describeNestedArchiveMetadata(name: string, data: Buffer, depth = 1): string | undefined {
  const archiveExtension = getNestedArchiveExtension(name);
  if (archiveExtension === ".zip") {
    const { entries, truncated } = readZipArchiveMetadata(data);
    return formatNestedArchivePreview(name, "ZIP", depth, formatZipArchiveEntryPreview(entries, truncated, "nested in-memory metadata window"));
  }
  if (archiveExtension === ".tar") {
    const { entries, truncated } = readTarArchiveMetadata(data);
    return formatNestedArchivePreview(name, "TAR", depth, formatTarArchiveEntryPreview(entries, truncated, "nested in-memory metadata window"));
  }
  if (archiveExtension === ".tar.gz" || archiveExtension === ".tgz") {
    try {
      const tarBuffer = gunzipSync(data, {
        maxOutputLength: MAX_NESTED_ARCHIVE_PREVIEW_OUTPUT_BYTES,
      });
      const { entries, truncated } = readTarArchiveMetadata(tarBuffer);
      return formatNestedArchivePreview(name, "Gzip-compressed TAR", depth, formatTarArchiveEntryPreview(entries, truncated, "nested bounded decompressed metadata window"));
    } catch {
      return undefined;
    }
  }
  if (archiveExtension === ".gz") {
    const metadata = readGzipArchiveMetadata(data, data.length);
    if (!metadata) return undefined;
    return [
      `Nested archive ${name} (Gzip, depth ${depth}):`,
      metadata.originalName ? `Original name: ${metadata.originalName}.` : "Original name: not present.",
      metadata.mtime ? `Header modified time: ${metadata.mtime}.` : "Header modified time: not present.",
      `Header operating system: ${metadata.operatingSystem}.`,
    ].join("\n");
  }
  return undefined;
}

function formatZipArchiveEntryPreview(
  entries: ChannelZipEntryMetadata[],
  truncated: boolean,
  scanDescription: string,
): string[] {
  const files = entries.filter((entry) => !entry.directory);
  const directories = entries.filter((entry) => entry.directory);
  const nestedArchiveEntries = entries
    .filter((entry) => !entry.directory && isNestedArchiveEntryName(entry.name))
    .slice(0, 4);
  return [
    `${files.length} file entr${files.length === 1 ? "y" : "ies"} and ${directories.length} director${directories.length === 1 ? "y" : "ies"} found in the ${scanDescription}.`,
    truncated ? "Nested archive preview was truncated before every entry could be listed." : "",
    nestedArchiveEntries.length > 0
      ? `Nested archive metadata cues inside nested ZIP: ${nestedArchiveEntries.map((entry) => entry.name).join(", ")}.`
      : "",
  ].filter(Boolean);
}

function formatNestedArchivePreview(name: string, kind: string, depth: number, lines: string[]): string | undefined {
  if (lines.length === 0) return undefined;
  return [`Nested archive ${name} (${kind}, depth ${depth}):`, ...lines].join("\n").slice(0, 900);
}

function summarizeTarArchiveFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_PREVIEW_BYTES));
    const { entries, truncated } = readTarArchiveMetadata(buffer);
    return [
      `TAR archive metadata preview (${formatBytes(size)}).`,
      ...formatTarArchiveEntryPreview(entries, truncated, "bounded local header scan"),
      "TAR preview read local archive headers only; no archive extraction, decompression, file execution, external tool startup, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `TAR archive ready for explicit attachment (${formatBytes(size)}).`,
      "TAR preview did not parse readable local headers; no archive extraction, decompression, file execution, external tool startup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeGzipArchiveFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_PREVIEW_BYTES));
    const metadata = readGzipArchiveMetadata(buffer, size);
    if (!metadata) {
      throw new Error("Unreadable gzip header");
    }
    const tarLabel = extension === ".tar.gz" || extension === ".tgz" ? "Gzip-compressed TAR" : "Gzip";
    const compressedTarPreview =
      extension === ".tar.gz" || extension === ".tgz" ? summarizeCompressedTarEntries(filePath, size) : [];
    return [
      `${tarLabel} archive metadata preview (${formatBytes(size)}).`,
      `Compression method: ${metadata.method}; flags: ${metadata.flags}.`,
      metadata.originalName ? `Original name: ${metadata.originalName}.` : "Original name: not present in the bounded local gzip header.",
      metadata.mtime ? `Header modified time: ${metadata.mtime}.` : "Header modified time: not present.",
      `Header operating system: ${metadata.operatingSystem}.`,
      typeof metadata.uncompressedSize === "number"
        ? `Trailer uncompressed size modulo 4 GiB: ${formatBytes(metadata.uncompressedSize)}.`
        : "",
      ...compressedTarPreview,
      compressedTarPreview.length > 0
        ? "Gzip-compressed TAR preview decompressed a bounded in-memory metadata window only; no archive extraction, file execution, external tool startup, network call, or provider send was performed."
        : "Gzip preview read local gzip headers and trailer only; no archive extraction, decompression, file execution, external tool startup, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Gzip archive ready for explicit attachment (${formatBytes(size)}).`,
      "Gzip preview did not parse readable local headers; no archive extraction, decompression, file execution, external tool startup, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeSevenZipArchiveFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_HEADER_PREVIEW_BYTES));
    const metadata = readSevenZipArchiveMetadata(buffer);
    if (!metadata) {
      throw new Error("Unreadable 7z header");
    }
    return [
      `7z archive metadata preview (${formatBytes(size)}).`,
      `Format version: ${metadata.majorVersion}.${metadata.minorVersion}.`,
      typeof metadata.nextHeaderOffset === "bigint"
        ? `Next header offset: ${formatBigIntBytes(metadata.nextHeaderOffset)}.`
        : "Next header offset: not available in the bounded local header.",
      typeof metadata.nextHeaderSize === "bigint"
        ? `Next header size: ${formatBigIntBytes(metadata.nextHeaderSize)}.`
        : "Next header size: not available in the bounded local header.",
      typeof metadata.nextHeaderCrc === "number"
        ? `Next header CRC: 0x${metadata.nextHeaderCrc.toString(16).padStart(8, "0")}.`
        : "",
      "7z preview read local signature and start-header metadata only; no archive extraction, decompression, file execution, external tool startup, malware scanning, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `7z archive ready for explicit attachment (${formatBytes(size)}).`,
      "7z preview did not parse readable local headers; no archive extraction, decompression, file execution, external tool startup, malware scanning, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeRarArchiveFile(filePath: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_ARCHIVE_HEADER_PREVIEW_BYTES));
    const metadata = readRarArchiveMetadata(buffer);
    if (!metadata) {
      throw new Error("Unreadable RAR header");
    }
    return [
      `RAR archive metadata preview (${formatBytes(size)}).`,
      `Format family: ${metadata.format}.`,
      metadata.firstHeaderType ? `First header type: ${metadata.firstHeaderType}.` : "First header type: not available in the bounded local header.",
      typeof metadata.firstHeaderFlags === "number"
        ? `First header flags: 0x${metadata.firstHeaderFlags.toString(16)}.`
        : "",
      typeof metadata.firstHeaderSize === "number" ? `First header size: ${formatBytes(metadata.firstHeaderSize)}.` : "",
      "RAR preview read local signature and first-header metadata only; no archive extraction, decompression, file execution, external tool startup, malware scanning, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `RAR archive ready for explicit attachment (${formatBytes(size)}).`,
      "RAR preview did not parse readable local headers; no archive extraction, decompression, file execution, external tool startup, malware scanning, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function summarizeCompressedTarEntries(filePath: string, size: number): string[] {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_COMPRESSED_TAR_PREVIEW_INPUT_BYTES));
    const tarBuffer = gunzipSync(buffer, {
      maxOutputLength: MAX_COMPRESSED_TAR_PREVIEW_OUTPUT_BYTES,
    });
    const { entries, truncated } = readTarArchiveMetadata(tarBuffer);
    return [
      `Compressed TAR entry preview decompressed up to ${formatBytes(MAX_COMPRESSED_TAR_PREVIEW_OUTPUT_BYTES)} in memory from a ${formatBytes(MAX_COMPRESSED_TAR_PREVIEW_INPUT_BYTES)} input cap.`,
      ...formatTarArchiveEntryPreview(entries, truncated, "bounded decompressed TAR metadata window"),
    ];
  } catch {
    return [
      "Compressed TAR entry preview unavailable from the bounded local metadata window; gzip header/trailer metadata is still shown.",
    ];
  }
}

function readSevenZipArchiveMetadata(buffer: Buffer): ChannelSevenZipMetadata | undefined {
  const signature = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
  if (buffer.length < 32 || !signature.every((byte, index) => buffer[index] === byte)) {
    return undefined;
  }
  return {
    majorVersion: buffer[6],
    minorVersion: buffer[7],
    nextHeaderOffset: buffer.readBigUInt64LE(12),
    nextHeaderSize: buffer.readBigUInt64LE(20),
    nextHeaderCrc: buffer.readUInt32LE(28),
  };
}

function readRarArchiveMetadata(buffer: Buffer): ChannelRarMetadata | undefined {
  const rar4Signature = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const rar5Signature = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
  if (buffer.length >= rar5Signature.length && buffer.subarray(0, rar5Signature.length).equals(rar5Signature)) {
    return {
      format: "RAR5",
      firstHeaderType: readRar5HeaderType(buffer, rar5Signature.length),
    };
  }
  if (buffer.length >= rar4Signature.length && buffer.subarray(0, rar4Signature.length).equals(rar4Signature)) {
    const headerOffset = rar4Signature.length;
    if (buffer.length < headerOffset + 7) {
      return { format: "RAR4" };
    }
    const headerType = buffer[headerOffset + 2];
    return {
      format: "RAR4",
      firstHeaderType: describeRar4HeaderType(headerType),
      firstHeaderFlags: buffer.readUInt16LE(headerOffset + 3),
      firstHeaderSize: buffer.readUInt16LE(headerOffset + 5),
    };
  }
  return undefined;
}

function readRar5HeaderType(buffer: Buffer, offset: number): string | undefined {
  const firstVarInt = readRarVint(buffer, offset + 4);
  if (!firstVarInt) return undefined;
  const secondVarInt = readRarVint(buffer, offset + 4 + firstVarInt.length);
  if (!secondVarInt) return undefined;
  return describeRar5HeaderType(Number(secondVarInt.value));
}

function readRarVint(buffer: Buffer, offset: number): { value: bigint; length: number } | undefined {
  let value = 0n;
  let shift = 0n;
  for (let index = offset; index < buffer.length && index < offset + 10; index += 1) {
    const byte = buffer[index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, length: index - offset + 1 };
    }
    shift += 7n;
  }
  return undefined;
}

function describeRar4HeaderType(type: number): string {
  return (
    {
      0x72: "marker",
      0x73: "archive",
      0x74: "file",
      0x75: "old comment",
      0x76: "old authenticity",
      0x77: "old subblock",
      0x78: "old recovery",
      0x79: "old authenticity",
      0x7a: "subblock",
      0x7b: "end archive",
    }[type] ?? `type 0x${type.toString(16)}`
  );
}

function describeRar5HeaderType(type: number): string {
  return (
    {
      1: "main archive",
      2: "file",
      3: "service",
      4: "archive encryption",
      5: "end archive",
    }[type] ?? `type ${type}`
  );
}

function formatBigIntBytes(size: bigint): string {
  if (size <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return formatBytes(Number(size));
  }
  return `${size.toString()} B`;
}

function summarizeFontFile(filePath: string, extension: string, size: number): string {
  try {
    const buffer = readFileHeader(filePath, Math.min(size, MAX_FONT_PREVIEW_BYTES));
    const metadata = readFontMetadata(buffer, extension);
    if (!metadata) {
      throw new Error("Unreadable font header");
    }
    const nameLines = metadata.names
      .map((record) => `${record.label}: ${record.value}`)
      .slice(0, MAX_FONT_NAME_RECORDS);
    return [
      `Font metadata preview (${formatBytes(size)}).`,
      `Format: ${metadata.format}.`,
      typeof metadata.tableCount === "number" ? `Table count: ${metadata.tableCount}.` : "",
      metadata.version ? `Font version: ${metadata.version}.` : "",
      ...nameLines,
      metadata.notice || "",
      "Ready for explicit attachment after visible review; no font installation, font renderer startup, glyph rasterization, file execution, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Font file ready for explicit attachment (${formatBytes(size)}).`,
      "Font preview read bounded local header bytes only; no font installation, font renderer startup, glyph rasterization, file execution, network call, or provider send was performed.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  }
}

function readFontMetadata(
  buffer: Buffer,
  extension: string,
): { format: string; tableCount?: number; version?: string; names: { label: string; value: string }[]; notice?: string } | undefined {
  if (buffer.length < 4) return undefined;
  const signature = buffer.subarray(0, 4).toString("ascii");
  if (signature === "wOFF") return readWoffFontMetadata(buffer);
  if (signature === "wOF2") return readWoff2FontMetadata(buffer);
  return readSfntFontMetadata(buffer, extension);
}

function readSfntFontMetadata(
  buffer: Buffer,
  extension: string,
): { format: string; tableCount?: number; names: { label: string; value: string }[]; notice?: string } | undefined {
  if (buffer.length < 12) return undefined;
  const tableCount = buffer.readUInt16BE(4);
  if (tableCount <= 0 || tableCount > 512 || 12 + tableCount * 16 > buffer.length) return undefined;
  const format = describeSfntFlavor(buffer.subarray(0, 4), extension);
  const nameTable = readSfntTableDirectory(buffer, tableCount).find((table) => table.tag === "name");
  const names =
    nameTable && nameTable.offset + nameTable.length <= buffer.length
      ? readFontNameTable(buffer.subarray(nameTable.offset, nameTable.offset + nameTable.length))
      : [];
  return {
    format,
    tableCount,
    names,
    ...(names.length === 0 ? { notice: "Name table metadata: none found in the bounded local font header." } : {}),
  };
}

function readWoffFontMetadata(
  buffer: Buffer,
): { format: string; tableCount?: number; names: { label: string; value: string }[]; notice?: string } | undefined {
  if (buffer.length < 44) return undefined;
  const flavor = describeSfntFlavor(buffer.subarray(4, 8), ".woff");
  const tableCount = buffer.readUInt16BE(12);
  if (tableCount <= 0 || tableCount > 512 || 44 + tableCount * 20 > buffer.length) return undefined;
  const nameRecord = readWoffTableDirectory(buffer, tableCount).find((table) => table.tag === "name");
  let names: { label: string; value: string }[] = [];
  let notice = "";
  if (nameRecord && nameRecord.offset + nameRecord.compressedLength <= buffer.length) {
    const raw = buffer.subarray(nameRecord.offset, nameRecord.offset + nameRecord.compressedLength);
    const tableBytes =
      nameRecord.compressedLength === nameRecord.originalLength
        ? raw
        : inflateSync(raw, { maxOutputLength: Math.min(nameRecord.originalLength, MAX_FONT_PREVIEW_BYTES) });
    names = readFontNameTable(tableBytes);
  } else {
    notice = "WOFF name table metadata: none found in the bounded local font header.";
  }
  return {
    format: `WOFF (${flavor})`,
    tableCount,
    names,
    ...(notice || names.length === 0
      ? { notice: notice || "WOFF name table metadata: none readable from the bounded local font header." }
      : {}),
  };
}

function readWoff2FontMetadata(
  buffer: Buffer,
): { format: string; tableCount?: number; version?: string; names: { label: string; value: string }[]; notice?: string } | undefined {
  if (buffer.length < 48) return undefined;
  const flavor = describeSfntFlavor(buffer.subarray(4, 8), ".woff2");
  const tableCount = buffer.readUInt16BE(12);
  const majorVersion = buffer.readUInt16BE(28);
  const minorVersion = buffer.readUInt16BE(30);
  if (tableCount <= 0 || tableCount > 4096) return undefined;
  return {
    format: `WOFF2 (${flavor})`,
    tableCount,
    version: `${majorVersion}.${minorVersion}`,
    names: [],
    notice: "WOFF2 compact table metadata was detected; transformed name-table decoding is intentionally not performed by this header-only importer.",
  };
}

function readSfntTableDirectory(buffer: Buffer, tableCount: number): { tag: string; offset: number; length: number }[] {
  const records: { tag: string; offset: number; length: number }[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    if (offset + 16 > buffer.length) break;
    records.push({
      tag: buffer.subarray(offset, offset + 4).toString("ascii"),
      offset: buffer.readUInt32BE(offset + 8),
      length: buffer.readUInt32BE(offset + 12),
    });
  }
  return records;
}

function readWoffTableDirectory(buffer: Buffer, tableCount: number): { tag: string; offset: number; compressedLength: number; originalLength: number }[] {
  const records: { tag: string; offset: number; compressedLength: number; originalLength: number }[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 44 + index * 20;
    if (offset + 20 > buffer.length) break;
    records.push({
      tag: buffer.subarray(offset, offset + 4).toString("ascii"),
      offset: buffer.readUInt32BE(offset + 4),
      compressedLength: buffer.readUInt32BE(offset + 8),
      originalLength: buffer.readUInt32BE(offset + 12),
    });
  }
  return records;
}

function readFontNameTable(buffer: Buffer): { label: string; value: string }[] {
  if (buffer.length < 6) return [];
  const count = buffer.readUInt16BE(2);
  const stringOffset = buffer.readUInt16BE(4);
  const seen = new Set<string>();
  const records: { label: string; value: string }[] = [];
  for (let index = 0; index < count && records.length < MAX_FONT_NAME_RECORDS * 2; index += 1) {
    const offset = 6 + index * 12;
    if (offset + 12 > buffer.length) break;
    const platformId = buffer.readUInt16BE(offset);
    const nameId = buffer.readUInt16BE(offset + 6);
    const length = buffer.readUInt16BE(offset + 8);
    const nameOffset = buffer.readUInt16BE(offset + 10);
    const label = describeFontNameId(nameId);
    if (!label || length <= 0 || length > 1024) continue;
    const start = stringOffset + nameOffset;
    const end = start + length;
    if (start < 0 || end > buffer.length || start >= end) continue;
    const value = decodeFontNameValue(buffer.subarray(start, end), platformId);
    if (!value) continue;
    const key = `${label}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ label, value });
  }
  return records.slice(0, MAX_FONT_NAME_RECORDS);
}

function decodeFontNameValue(buffer: Buffer, platformId: number): string {
  const decoded =
    platformId === 0 || platformId === 3
      ? decodeUtf16Be(buffer)
      : buffer.toString("latin1");
  return decoded
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function decodeUtf16Be(buffer: Buffer): string {
  const evenLength = buffer.length - (buffer.length % 2);
  const swapped = Buffer.alloc(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString("utf16le");
}

function describeSfntFlavor(flavor: Buffer, extension: string): string {
  const ascii = flavor.toString("ascii");
  if (flavor.length >= 4 && flavor[0] === 0x00 && flavor[1] === 0x01 && flavor[2] === 0x00 && flavor[3] === 0x00) {
    return "TrueType sfnt";
  }
  if (ascii === "OTTO") return "OpenType CFF";
  if (ascii === "true") return "Apple TrueType";
  if (ascii === "typ1") return "Type 1 sfnt";
  return `${extension.toUpperCase().replace(".", "") || "font"} sfnt`;
}

function describeFontNameId(nameId: number): string {
  return (
    {
      1: "Family",
      2: "Subfamily",
      4: "Full name",
      5: "Version",
      6: "PostScript name",
      16: "Typographic family",
      17: "Typographic subfamily",
    }[nameId] || ""
  );
}

function formatTarArchiveEntryPreview(
  entries: ChannelTarEntryMetadata[],
  truncated: boolean,
  scanDescription: string,
): string[] {
  const files = entries.filter((entry) => !entry.directory);
  const directories = entries.filter((entry) => entry.directory);
  const nestedArchiveEntries = entries
    .filter((entry) => !entry.directory && isNestedArchiveEntryName(entry.name))
    .slice(0, 6);
  const previews = entries.slice(0, MAX_ARCHIVE_PREVIEW_ENTRIES).map((entry, index) => {
    const kind = entry.directory ? "directory" : "file";
    const sizeLabel = entry.size > 0 ? `, ${formatBytes(entry.size)}` : "";
    return `${index + 1}. ${entry.name} (${kind}${sizeLabel}, type ${entry.typeFlag || "0"})`;
  });
  return [
    `${files.length} file entr${files.length === 1 ? "y" : "ies"} and ${directories.length} director${directories.length === 1 ? "y" : "ies"} found in the ${scanDescription}.`,
    truncated ? "Archive preview was truncated before every entry could be listed." : "",
    nestedArchiveEntries.length > 0
      ? `Nested archive metadata cues: ${nestedArchiveEntries.map((entry) => entry.name).join(", ")}.`
      : `Nested archive metadata cues: none found in the ${scanDescription}.`,
    previews.length > 0 ? `Entries:\n${previews.join("\n")}` : "No readable TAR headers were found.",
  ].filter(Boolean);
}

function readZipArchiveMetadata(buffer: Buffer): {
  entries: ChannelZipEntryMetadata[];
  truncated: boolean;
} {
  const entries: ChannelZipEntryMetadata[] = [];
  let offset = 0;
  let truncated = false;
  while (offset + 30 <= buffer.length && entries.length < MAX_ARCHIVE_PREVIEW_ENTRIES) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (nameLength <= 0 || dataStart > buffer.length) {
      truncated = true;
      break;
    }
    const rawName = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const name = rawName.replace(/\\/g, "/").replace(/\0/g, "").slice(0, 240);
    if (name) {
      entries.push({
        name,
        compressedSize: (flags & 0x08) === 0 ? compressedSize : undefined,
        uncompressedSize: (flags & 0x08) === 0 ? uncompressedSize : undefined,
        directory: name.endsWith("/"),
        method,
      });
    }
    if ((flags & 0x08) !== 0 || compressedSize === 0) {
      offset = dataStart;
      continue;
    }
    const nextOffset = dataStart + compressedSize;
    if (nextOffset > buffer.length) {
      truncated = true;
      break;
    }
    offset = nextOffset;
  }
  if (entries.length >= MAX_ARCHIVE_PREVIEW_ENTRIES) truncated = true;
  return { entries, truncated };
}

function readTarArchiveMetadata(buffer: Buffer): {
  entries: ChannelTarEntryMetadata[];
  truncated: boolean;
} {
  const entries: ChannelTarEntryMetadata[] = [];
  let offset = 0;
  let truncated = false;
  while (offset + 512 <= buffer.length && entries.length < MAX_ARCHIVE_PREVIEW_ENTRIES) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = [prefix, name].filter(Boolean).join("/").replace(/\\/g, "/").slice(0, 240);
    const sizeValue = readTarOctal(header, 124, 12);
    const typeFlag = readTarString(header, 156, 1) || "0";
    if (!fullName || sizeValue < 0) {
      truncated = true;
      break;
    }
    const directory = typeFlag === "5" || fullName.endsWith("/");
    entries.push({
      name: fullName,
      size: sizeValue,
      directory,
      typeFlag,
    });
    const dataBlocks = Math.ceil(sizeValue / 512);
    const nextOffset = offset + 512 + dataBlocks * 512;
    if (nextOffset > buffer.length && sizeValue > 0) {
      truncated = true;
      break;
    }
    offset = nextOffset;
  }
  if (entries.length >= MAX_ARCHIVE_PREVIEW_ENTRIES) truncated = true;
  return { entries, truncated };
}

function readGzipArchiveMetadata(buffer: Buffer, fileSize: number): ChannelGzipMetadata | undefined {
  if (buffer.length < 10 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
    return undefined;
  }
  const method = buffer[2];
  const flags = buffer[3];
  let offset = 10;
  if ((flags & 0x04) !== 0) {
    if (offset + 2 > buffer.length) return undefined;
    const extraLength = buffer.readUInt16LE(offset);
    offset += 2 + extraLength;
  }
  let originalName: string | undefined;
  if ((flags & 0x08) !== 0) {
    const end = buffer.indexOf(0, offset);
    if (end === -1) return undefined;
    originalName = buffer.subarray(offset, end).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 240);
    offset = end + 1;
  }
  if ((flags & 0x10) !== 0) {
    const end = buffer.indexOf(0, offset);
    if (end === -1) return undefined;
    offset = end + 1;
  }
  if ((flags & 0x02) !== 0) {
    offset += 2;
  }
  if (offset > buffer.length) return undefined;
  const mtimeSeconds = buffer.readUInt32LE(4);
  const operatingSystem = describeGzipOperatingSystem(buffer[9]);
  const trailer = fileSize >= 8 ? readFileTailTrailer(buffer, fileSize) : undefined;
  return {
    originalName,
    method,
    flags,
    mtime: mtimeSeconds > 0 ? new Date(mtimeSeconds * 1000).toISOString() : undefined,
    operatingSystem,
    uncompressedSize: trailer,
  };
}

function readFileTailTrailer(buffer: Buffer, fileSize: number): number | undefined {
  if (buffer.length >= fileSize && buffer.length >= 4) {
    return buffer.readUInt32LE(buffer.length - 4);
  }
  return undefined;
}

function readTarString(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/g, "")
    .trim();
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = buffer
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0/g, "")
    .trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) return -1;
  return Number.parseInt(raw, 8);
}

function describeGzipOperatingSystem(code: number): string {
  return (
    {
      0: "FAT filesystem",
      3: "Unix",
      7: "Macintosh",
      10: "NTFS",
      11: "NTFS",
      13: "Acorn RISCOS",
      255: "unknown",
    }[code] ?? `code ${code}`
  );
}

function isNestedArchiveEntryName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tar.bz2") || normalized.endsWith(".tar.xz")) {
    return true;
  }
  return NESTED_ARCHIVE_EXTENSIONS.has(extname(normalized));
}

function getNestedArchiveExtension(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.endsWith(".tar.gz")) return ".tar.gz";
  if (normalized.endsWith(".tgz")) return ".tgz";
  if (normalized.endsWith(".tar")) return ".tar";
  if (normalized.endsWith(".zip")) return ".zip";
  if (normalized.endsWith(".gz")) return ".gz";
  return extname(normalized);
}

function extractRtfTextSummary(filePath: string): string {
  try {
    const raw = readFileHeader(filePath, MAX_DOCUMENT_EXTRACT_BYTES).toString("latin1");
    const text = decodeRtfPlainText(raw);
    return [
      text,
      "RTF text preview stripped local rich-text controls only; no Word/Office runtime, macro execution, network call, or provider send was performed.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_BYTES);
  } catch {
    return "";
  }
}

function decodeRtfPlainText(raw: string): string {
  const output: string[] = [];
  const ignoredGroups: boolean[] = [];
  let ignoreDepth = 0;
  let unicodeSkip = 1;
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index];
    if (current === "{") {
      ignoredGroups.push(ignoreDepth > 0);
      continue;
    }
    if (current === "}") {
      const groupIgnored = ignoredGroups.pop();
      if (groupIgnored && ignoreDepth > 0) ignoreDepth -= 1;
      continue;
    }
    if (ignoreDepth > 0) continue;
    if (current !== "\\") {
      if (current !== "\r") output.push(current === "\n" ? "\n" : current);
      continue;
    }

    const next = raw[index + 1];
    if (!next) break;
    if (next === "'" && /^[0-9a-f]{2}$/i.test(raw.slice(index + 2, index + 4))) {
      output.push(String.fromCharCode(Number.parseInt(raw.slice(index + 2, index + 4), 16)));
      index += 3;
      continue;
    }
    if (["\\", "{", "}"].includes(next)) {
      output.push(next);
      index += 1;
      continue;
    }
    if (next === "*") {
      ignoreDepth += 1;
      index += 1;
      continue;
    }
    const controlMatch = raw.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!controlMatch) {
      index += 1;
      continue;
    }
    const word = controlMatch[1] || "";
    const argument = controlMatch[2];
    index += controlMatch[0].length;
    if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object"].includes(word)) {
      ignoreDepth += 1;
      continue;
    }
    if (word === "uc" && argument) {
      unicodeSkip = Math.max(0, Number.parseInt(argument, 10) || 0);
      continue;
    }
    if (word === "u" && argument) {
      const codePoint = Number.parseInt(argument, 10);
      output.push(String.fromCharCode(codePoint < 0 ? codePoint + 65536 : codePoint));
      index += unicodeSkip;
      continue;
    }
    if (["par", "line"].includes(word)) output.push("\n");
    if (word === "tab") output.push("\t");
  }
  return output
    .join("")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_BYTES - 220);
}

type ChannelZipEntry = {
  name: string;
  data: Buffer;
};

function extractZipEntries(buffer: Buffer): ChannelZipEntry[] {
  const entries: ChannelZipEntry[] = [];
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if ((flags & 0x08) !== 0 || compressedSize === 0 || dataEnd > buffer.length) {
      offset = Math.max(offset + 4, dataStart);
      continue;
    }

    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressedData = buffer.subarray(dataStart, dataEnd);
    const data = inflateZipEntry(compressedData, method);
    if (data) entries.push({ name, data });
    offset = dataEnd;
  }
  return entries;
}

function inflateZipEntry(data: Buffer, method: number): Buffer | null {
  try {
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
  } catch {
    return null;
  }
  return null;
}

function extractXmlText(xml: string): string {
  const textRuns = [...xml.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean);
  if (textRuns.length > 0) return textRuns.join("\n");
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .trim();
}

type NotebookCellPreview = {
  cell_type?: string;
  source?: string | string[];
  outputs?: Array<{
    output_type?: string;
    ename?: string;
    name?: string;
    text?: string | string[];
    data?: Record<string, unknown>;
  }>;
};

function summarizeNotebook(filePath: string, size: number): string {
  try {
    const raw = readFileHeader(filePath, Math.min(size, MAX_NOTEBOOK_PREVIEW_BYTES)).toString("utf8");
    const parsed = JSON.parse(raw) as {
      cells?: NotebookCellPreview[];
    };
    const cells = Array.isArray(parsed.cells) ? parsed.cells : [];
    const counts = summarizeNotebookCellCounts(cells);
    const outputs = summarizeNotebookOutputs(cells);
    const snippets = cells
      .slice(0, MAX_NOTEBOOK_PREVIEW_CELLS)
      .map((cell, index) => {
        const source = normalizeNotebookText(cell.source);
        return `Cell ${index + 1} (${cell.cell_type || "unknown"}): ${maskPotentialSecretValues(source.replace(/\s+/g, " ").trim())}`;
      })
      .filter((line) => line.length > 0)
      .join("\n");
    return [
      `Notebook document preview (${formatBytes(size)}).`,
      counts,
      outputs,
      snippets || "Notebook has no readable cell source.",
      raw.length >= MAX_NOTEBOOK_PREVIEW_BYTES
        ? `Notebook JSON preview was capped at ${formatBytes(MAX_NOTEBOOK_PREVIEW_BYTES)}.`
        : "",
      "Ready for explicit attachment after visible review; notebook JSON and saved outputs were summarized only, with no kernel startup, code execution, package install, network call, or provider send.",
    ].join("\n").slice(0, MAX_TEXT_BYTES);
  } catch {
    return [
      `Notebook document ready for explicit attachment (${formatBytes(size)}).`,
      "Notebook preview could not parse the bounded JSON sample; no kernel startup, code execution, package install, network call, or provider send was performed.",
    ].join("\n");
  }
}

function summarizeNotebookCellCounts(cells: NotebookCellPreview[]): string {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const type = typeof cell.cell_type === "string" && cell.cell_type.trim() ? cell.cell_type.trim() : "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");
  return `Cells: ${cells.length}${summary ? ` (${summary})` : ""}.`;
}

function summarizeNotebookOutputs(cells: NotebookCellPreview[]): string {
  const outputTypes = new Map<string, number>();
  const mimeTypes = new Set<string>();
  const errors: string[] = [];
  let outputCount = 0;
  for (const cell of cells) {
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    for (const output of outputs) {
      outputCount += 1;
      const type = typeof output.output_type === "string" && output.output_type.trim() ? output.output_type.trim() : "unknown";
      outputTypes.set(type, (outputTypes.get(type) ?? 0) + 1);
      if (type === "error" && typeof output.ename === "string" && output.ename.trim()) {
        errors.push(output.ename.trim());
      }
      if (output.data && typeof output.data === "object") {
        for (const key of Object.keys(output.data)) {
          if (mimeTypes.size >= MAX_NOTEBOOK_OUTPUT_PREVIEW) break;
          mimeTypes.add(key);
        }
      }
    }
  }
  const typeSummary = [...outputTypes.entries()]
    .slice(0, MAX_NOTEBOOK_OUTPUT_PREVIEW)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");
  const mimeSummary = [...mimeTypes].slice(0, MAX_NOTEBOOK_OUTPUT_PREVIEW).join(", ");
  const errorSummary = [...new Set(errors)].slice(0, MAX_NOTEBOOK_OUTPUT_PREVIEW).join(", ");
  return [
    `Saved outputs: ${outputCount}${typeSummary ? ` (${typeSummary})` : ""}.`,
    mimeSummary ? `Output MIME types: ${mimeSummary}.` : "Output MIME types: none detected in saved JSON.",
    errorSummary ? `Saved error names: ${errorSummary}.` : "Saved error names: none detected.",
  ].join("\n");
}

function normalizeNotebookText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").join("");
  }
  if (typeof value === "string") return value;
  return "";
}

function normalizeExplicitImportPaths(paths?: string[]): string[] {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.trim())
    .slice(0, MAX_IMPORT_ITEMS);
}

function getMime(extension: string): string {
  return (
    {
      ".7z": "application/x-7z-compressed",
      ".aab": "application/vnd.android.aab",
      ".ansible-inventory": "text/x-ansible-inventory",
      ".androidmanifest.xml": "application/vnd.android.package-archive.manifest+xml",
      ".apk": "application/vnd.android.package-archive",
      ".appx": "application/vnd.ms-appx",
      ".appxmanifest": "application/vnd.ms-appxmanifest+xml",
      ".appxbundle": "application/vnd.ms-appxBundle",
      ".arm-template.json": "application/vnd.microsoft.azure.arm-template+json",
      ".arrow": "application/vnd.apache.arrow.file",
      ".atom": "application/atom+xml",
      ".attestation": "application/vnd.in-toto+json",
      ".attestation.json": "application/vnd.in-toto+json",
      ".bat": "text/x-msdos-batch",
      ".bash": "text/x-shellscript",
      ".bicep": "text/x-bicep",
      ".bicepparam": "text/x-bicep-params",
      ".blg": "application/vnd.ms-perfmon",
      ".bmp": "image/bmp",
      ".bru": "text/x-bruno",
      ".c": "text/x-c",
      ".cabal": "text/x-cabal",
      ".cat": "application/vnd.ms-pki.seccat",
      ".cc": "text/x-c++",
      ".checkstyle.xml": "application/vnd.checkstyle+xml",
      ".cjs": "text/javascript",
      ".cmd": "text/x-msdos-batch",
      ".cfg": "text/plain",
      ".codeowners": "text/x-codeowners",
      ".cloudformation.json": "application/vnd.aws.cloudformation.template+json",
      ".cloudformation.yaml": "application/vnd.aws.cloudformation.template+yaml",
      ".composer.json": "application/vnd.composer+json",
      ".cpp": "text/x-c++",
      ".cs": "text/x-csharp",
      ".csproj": "application/msbuild+xml",
      ".css": "text/css",
      ".csv": "text/csv",
      ".dart": "text/x-dart",
      ".db": "application/vnd.sqlite3",
      ".dmp": "application/vnd.microsoft.minidump",
      ".dockerfile": "text/x-dockerfile",
      ".dockerignore": "text/plain",
      ".doc": "application/msword",
      ".dll": "application/vnd.microsoft.portable-executable",
      ".docm": "application/vnd.ms-word.document.macroEnabled.12",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".dotnet-global.json": "application/vnd.microsoft.dotnet.global-json+json",
      ".dot": "text/vnd.graphviz",
      ".drawio": "application/vnd.jgraph.mxfile",
      ".dwg": "image/vnd.dwg",
      ".dxf": "image/vnd.dxf",
      ".eml": "message/rfc822",
      ".epub": "application/epub+zip",
      ".etl": "application/vnd.ms-etl",
      ".editorconfig": "text/x-editorconfig",
      ".asc": "application/pgp-signature",
      ".cer": "application/pkix-cert",
      ".cdx.json": "application/vnd.cyclonedx+json",
      ".checksum": "text/plain",
      ".cmake": "text/x-cmake",
      ".cmakelists.txt": "text/x-cmake",
      ".compile_commands.json": "application/json+compile-commands",
      ".crt": "application/x-x509-ca-cert",
      ".der": "application/pkix-cert",
      ".diff": "text/x-diff",
      ".env": "text/plain",
      ".exe": "application/vnd.microsoft.portable-executable",
      ".evtx": "application/vnd.ms-windows-eventlog",
      ".fsproj": "application/msbuild+xml",
      ".feather": "application/vnd.apache.arrow.file",
      ".flac": "audio/flac",
      ".gemfile": "text/x-ruby",
      ".gemspec": "text/x-ruby-gemspec",
      ".gif": "image/gif",
      ".go.mod": "text/x-go-mod",
      ".go.work": "text/x-go-work",
      ".htm": "text/html",
      ".html": "text/html",
      ".gz": "application/gzip",
      ".geojson": "application/geo+json",
      ".glb": "model/gltf-binary",
      ".gltf": "model/gltf+json",
      ".gitattributes": "text/x-gitattributes",
      ".gitignore": "text/x-gitignore",
      ".h5": "application/x-hdf5",
      ".har": "application/har+json",
      ".hcl": "text/x-hcl",
      ".hdf5": "application/x-hdf5",
      ".hdmp": "application/vnd.microsoft.minidump",
      ".helm-chart.yaml": "application/vnd.cncf.helm.chart+yaml",
      ".go": "text/x-go",
      ".gql": "application/graphql",
      ".gradle": "text/x-gradle",
      ".gradle.kts": "text/x-kotlin",
      ".gradle.properties": "text/x-gradle-properties",
      ".gv": "text/vnd.graphviz",
      ".gpx": "application/gpx+xml",
      ".graphql": "application/graphql",
      ".h": "text/x-c",
      ".hpp": "text/x-c++",
      ".http": "message/http",
      ".ini": "text/plain",
      ".inf": "text/x-setup-inf",
      ".info.plist": "application/x-apple-plist+xml",
      ".intoto.jsonl": "application/vnd.in-toto+jsonl",
      ".ipa": "application/octet-stream+ios-app",
      ".ipynb": "application/x-ipynb+json",
      ".ical": "text/calendar",
      ".ics": "text/calendar",
      ".ico": "image/x-icon",
      ".jar": "application/java-archive",
      ".war": "application/java-archive",
      ".ear": "application/java-archive",
      ".class": "application/java-vm",
      ".java": "text/x-java-source",
      ".junit.xml": "application/junit+xml",
      ".lighthouse.json": "application/vnd.lighthouse.report+json",
      ".test-results.json": "application/vnd.drsai.test-results+json",
      ".trace.json": "application/x-chrome-trace+json",
      ".js": "text/javascript",
      ".jsx": "text/jsx",
      ".key": "application/pem-certificate-chain",
      ".kml": "application/vnd.google-earth.kml+xml",
      ".kt": "text/x-kotlin",
      ".kustomization.yaml": "application/vnd.kubernetes.kustomization+yaml",
      ".kts": "text/x-kotlin",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".jvm.config": "text/x-jvm-config",
      ".less": "text/less",
      ".license": "text/plain",
      ".lcov": "text/x-lcov",
      ".lnk": "application/x-ms-shortcut",
      ".log": "text/plain",
      ".lock": "text/plain",
      ".lua": "text/x-lua",
      ".makefile": "text/x-makefile",
      ".m": "text/x-objective-c",
      ".mat": "application/x-matlab-data",
      ".mm": "text/x-objective-c++",
      ".mjs": "text/javascript",
      ".man": "application/vnd.ms-etw-manifest+xml",
      ".maven.config": "text/x-maven-config",
      ".msi": "application/x-msi",
      ".msix": "application/vnd.ms-appx",
      ".msixbundle": "application/vnd.ms-appxBundle",
      ".m4a": "audio/mp4",
      ".m4v": "video/x-m4v",
      ".mermaid": "text/vnd.mermaid",
      ".metrics": "text/plain; version=0.0.4",
      ".mkv": "video/x-matroska",
      ".mov": "video/quicktime",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".mmd": "text/vnd.mermaid",
      ".json": "application/json",
      ".jsonl": "application/x-ndjson",
      ".md": "text/markdown",
      ".mdmp": "application/vnd.microsoft.minidump",
      ".mhtml": "multipart/related",
      ".mbox": "application/mbox",
      ".mix.exs": "text/x-elixir",
      ".mix.lock": "application/vnd.elixir.mix-lock",
      ".msg": "application/vnd.ms-outlook",
      ".nc": "application/x-netcdf",
      ".ndjson": "application/x-ndjson",
      ".notice": "text/plain",
      ".nuget.config": "application/vnd.nuget.config+xml",
      ".npmignore": "text/x-npmignore",
      ".npmrc": "text/x-npmrc",
      ".nuspec": "application/vnd.nuget.nuspec+xml",
      ".odp": "application/vnd.oasis.opendocument.presentation",
      ".ods": "application/vnd.oasis.opendocument.spreadsheet",
      ".odt": "application/vnd.oasis.opendocument.text",
      ".ogg": "audio/ogg",
      ".otf": "font/otf",
      ".obj": "model/obj",
      ".openmetrics": "application/openmetrics-text",
      ".patch": "text/x-diff",
      ".parquet": "application/vnd.apache.parquet",
      ".pcap": "application/vnd.tcpdump.pcap",
      ".pcapng": "application/x-pcapng",
      ".pem": "application/pem-certificate-chain",
      ".package.yaml": "application/vnd.haskell.package-yaml",
      ".packages.config": "application/vnd.nuget.packages-config+xml",
      ".php": "application/x-httpd-php",
      ".pipfile": "application/toml",
      ".pdf": "application/pdf",
      ".podfile": "text/x-cocoapods-podfile",
      ".podfile.lock": "text/x-cocoapods-lockfile",
      ".podspec": "text/x-cocoapods-podspec",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
      ".png": "image/png",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".proto": "text/x-protobuf",
      ".prom": "text/plain; version=0.0.4",
      ".props": "application/msbuild+xml",
      ".ps1": "text/x-powershell",
      ".psd1": "text/x-powershell-data",
      ".psm1": "text/x-powershell",
      ".pubspec.lock": "application/vnd.dart.pubspec.lock",
      ".pubspec.yaml": "application/yaml",
      ".puml": "text/x-plantuml",
      ".plantuml": "text/x-plantuml",
      ".pnpmfile.cjs": "text/javascript",
      ".pmd.xml": "application/vnd.pmd+xml",
      ".py": "text/x-python",
      ".rb": "text/x-ruby",
      ".rar": "application/vnd.rar",
      ".reg": "text/x-windows-registry",
      ".rest": "message/http",
      ".r": "text/x-r-source",
      ".rss": "application/rss+xml",
      ".robots.txt": "text/plain",
      ".rs": "text/rust",
      ".rtf": "application/rtf",
      ".sass": "text/x-sass",
      ".sarif": "application/sarif+json",
      ".sarif.json": "application/sarif+json",
      ".scss": "text/x-scss",
      ".security-audit.json": "application/vnd.drsai.security-scan+json",
      ".sh": "text/x-shellscript",
      ".sha1": "text/plain",
      ".sha256": "text/plain",
      ".sha512": "text/plain",
      ".sig": "application/octet-stream",
      ".sitemap.xml": "application/xml",
      ".sitemap.xml.gz": "application/gzip",
      ".sln": "text/plain",
      ".stack.yaml": "application/vnd.haskell.stack-yaml",
      ".scala": "text/x-scala",
      ".sql": "text/sql",
      ".spdx": "text/spdx",
      ".spdx.json": "application/spdx+json",
      ".syft.json": "application/vnd.syft+json",
      ".spotbugs.xml": "application/vnd.spotbugs+xml",
      ".srt": "application/x-subrip",
      ".stl": "model/stl",
      ".sum": "text/plain",
      ".svg": "image/svg+xml",
      ".swift": "text/x-swift",
      ".swift-package": "text/x-swift-package-manifest",
      ".sqlite": "application/vnd.sqlite3",
      ".sqlite3": "application/vnd.sqlite3",
      ".tap": "text/x-tap",
      ".tap13": "text/x-tap",
      ".task": "application/vnd.ms-task+xml",
      ".tar": "application/x-tar",
      ".tar.gz": "application/gzip",
      ".targets": "application/msbuild+xml",
      ".tgz": "application/gzip",
      ".tf": "text/x-terraform",
      ".tf.json": "application/x-terraform+json",
      ".tfplan.json": "application/vnd.terraform.plan+json",
      ".tfvars": "text/x-terraform-vars",
      ".toml": "application/toml",
      ".topojson": "application/topo+json",
      ".trx": "application/vnd.ms-trx+xml",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
      ".tsv": "text/tab-separated-values",
      ".ttf": "font/ttf",
      ".ts": "text/typescript",
      ".tsx": "text/typescript",
      ".txt": "text/plain",
      ".url": "application/internet-shortcut",
      ".uv.lock": "application/toml",
      ".vcard": "text/vcard",
      ".vcf": "text/vcard",
      ".vbproj": "application/msbuild+xml",
      ".vtt": "text/vtt",
      ".wasm": "application/wasm",
      ".wav": "audio/wav",
      ".webm": "video/webm",
      ".webp": "image/webp",
      ".wer": "text/x-windows-error-report",
      ".webloc": "application/xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".wprp": "application/vnd.ms-wprp+xml",
      ".avi": "video/x-msvideo",
      ".xls": "application/vnd.ms-excel",
      ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xml": "application/xml",
      ".yaml": "application/yaml",
      ".yml": "application/yaml",
      ".yarnrc": "text/x-yarnrc",
      ".yarnrc.yml": "application/yaml",
      ".zsh": "text/x-shellscript",
      ".zip": "application/zip",
    }[extension] ?? "application/octet-stream"
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function clampSingleLine(
  value: string | undefined,
  maxLength: number,
  requiredMessage?: string,
): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized && requiredMessage) {
    throw new Error(requiredMessage);
  }
  return normalized.slice(0, maxLength);
}

function clampMultiline(
  value: string | undefined,
  maxLength: number,
  requiredMessage: string,
): string {
  const normalized = (value || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error(requiredMessage);
  }
  return normalized.slice(0, maxLength);
}

function hashApprovalPart(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function workspaceKey(workspacePath: string): string {
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}

function isConnection(value: unknown): value is DesktopChannelConnection {
  const connection = value as DesktopChannelConnection;
  return Boolean(
    connection &&
      typeof connection.adapterId === "string" &&
      typeof connection.workspacePath === "string" &&
      typeof connection.provider === "string" &&
      (connection.mode === "local_git_remote" || connection.mode === "session_stub") &&
      typeof connection.configuredAt === "string" &&
      typeof connection.updatedAt === "string" &&
      typeof connection.accountLabel === "string" &&
      typeof connection.scopeLabel === "string" &&
      typeof connection.readOnly === "boolean",
  );
}

function isChannelDelivery(value: unknown): value is DesktopChannelOutboundDelivery {
  const delivery = value as DesktopChannelOutboundDelivery;
  return Boolean(
    delivery &&
      typeof delivery.id === "string" &&
      typeof delivery.approvalId === "string" &&
      typeof delivery.adapterId === "string" &&
      typeof delivery.provider === "string" &&
      typeof delivery.target === "string" &&
      ["blocked", "rejected", "sent", "failed"].includes(delivery.status) &&
      typeof delivery.createdAt === "string" &&
      typeof delivery.updatedAt === "string" &&
      typeof delivery.message === "string" &&
      typeof delivery.verification === "string",
  );
}

function isChannelInboundEvent(value: unknown): value is DesktopChannelInboundEvent {
  const event = value as DesktopChannelInboundEvent;
  return Boolean(
    event &&
      typeof event.id === "string" &&
      typeof event.adapterId === "string" &&
      typeof event.provider === "string" &&
      typeof event.workspacePath === "string" &&
      ["queued", "routed", "dismissed"].includes(event.status) &&
      typeof event.title === "string" &&
      typeof event.summary === "string" &&
      typeof event.receivedAt === "string" &&
      typeof event.updatedAt === "string" &&
      typeof event.itemCount === "number" &&
      Array.isArray(event.items) &&
      typeof event.verification === "string",
  );
}

function isChannelLogCursorEntry(value: unknown): value is ChannelLogCursorEntry {
  const cursor = value as ChannelLogCursorEntry;
  return Boolean(
    cursor &&
      typeof cursor.path === "string" &&
      typeof cursor.relativePath === "string" &&
      typeof cursor.offset === "number" &&
      Number.isFinite(cursor.offset) &&
      cursor.offset >= 0 &&
      typeof cursor.size === "number" &&
      Number.isFinite(cursor.size) &&
      cursor.size >= 0 &&
      typeof cursor.updatedAt === "string",
  );
}
