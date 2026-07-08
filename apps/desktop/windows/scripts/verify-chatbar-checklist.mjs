import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const checklist = readFileSync(join(root, "docs", "chatbar-capability-checklist.md"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`Chatbar checklist verification failed: ${message}`);
    process.exit(1);
  }
}

const requiredCapabilities = [
  "Capability 1: Natural Language Task Entry",
  "Capability 2: Slash Command Command System",
  "Capability 3: Context Injection",
  "Capability 4: Execution Control",
  "Capability 5: Task Mode Switching",
  "Capability 6: Multi-Agent And Subtask Collaboration",
  "Capability 7: Memory, Skills, And Reusable Workflows",
  "Capability 8: Cross-Channel Chat",
];

const requiredFeaturePoints = [
  "Normal natural-language input",
  "`/` command menu",
  "`/plan`, `/review`, `/fix`, `/test`",
  "`/commit`",
  "`/goal`, `/compact`",
  "`/memory`, `/skills`",
  "`/fork`, `/status`",
  "`@file`",
  "`@folder`",
  "`@selection`",
  "Permission confirmation",
  "Approval Center",
  "Rollback checkpoint",
  "Q&A, plan, execute, review, fix, test, commit, goal, fork modes",
  "Multi-agent queue",
  "Subtask handoff",
  "Project memory",
  "Workflow marketplace",
  "Task postmortem skill capture",
  "Mobile chat entry",
  "Slack connector",
  "GitHub connector",
  "Docs connector",
  "Calendar connector",
  "Voice, image, and file channel inputs",
];

const requiredVerificationCommands = [
  "npm run verify:chatbar-checklist",
  "npm run verify:chat-commands",
  "npm run verify:context-assembler",
  "npm run verify:execution-policy",
  "npm run verify:runtime-mode",
  "npm run verify:fork-worktree",
  "npm run verify:project-memory",
  "npm run verify:workflow-marketplace",
  "npm run verify:channel-adapters",
];

assert(
  packageJson.includes('"verify:chatbar-checklist": "node scripts/verify-chatbar-checklist.mjs"'),
  "package script is not registered",
);

for (const heading of requiredCapabilities) {
  assert(checklist.includes(heading), `missing capability heading: ${heading}`);
}

for (const feature of requiredFeaturePoints) {
  assert(checklist.includes(feature), `missing feature point: ${feature}`);
}

for (const command of requiredVerificationCommands) {
  assert(checklist.includes(command), `missing verification command: ${command}`);
}

assert(checklist.includes("[x]"), "checklist has no completed status marker");
assert(checklist.includes("[~]"), "checklist has no partial status marker");
assert(checklist.includes("[ ]"), "checklist has no not-started status marker");
assert(checklist.includes("Test commitment"), "checklist omits test commitment column");
assert(checklist.includes("Prioritized Remaining Work"), "checklist omits prioritized remaining work");
assert(checklist.includes("Agent Workflow For This Run"), "checklist omits agent workflow record");
assert(checklist.includes("Manual verification"), "checklist omits manual verification commitments");
assert(checklist.includes("database-ddl-semantics-agent"), "checklist omits SQL DDL semantic hints agent record");
assert(checklist.includes("SQL DDL Semantic Hints"), "checklist omits SQL DDL semantic hints addendum");
assert(checklist.includes("sqlite-database-file-agent"), "checklist omits SQLite database file agent record");
assert(checklist.includes("SQLite Database File Metadata"), "checklist omits SQLite database file metadata addendum");
assert(checklist.includes("selected `.db` / `.sqlite` / `.sqlite3`"), "checklist omits SQLite selected file support evidence");
assert(checklist.includes("config-log-input-agent"), "checklist omits configuration/log input agent record");
assert(checklist.includes("Configuration And Log File Input"), "checklist omits configuration/log input addendum");
assert(checklist.includes("selected `.yaml` / `.yml` / `.toml` / `.ini` / `.env` / `.log` / `.xml`"), "checklist omits configuration/log selected file support evidence");
assert(checklist.includes("likely-secret redaction"), "checklist omits configuration/log redaction evidence");
assert(checklist.includes("zip-archive-input-agent"), "checklist omits ZIP archive input agent record");
assert(checklist.includes("ZIP Archive Metadata Input"), "checklist omits ZIP archive metadata addendum");
assert(checklist.includes("selected `.zip`"), "checklist omits ZIP selected file support evidence");
assert(checklist.includes("nested-archive-cue-agent"), "checklist omits nested archive cue agent record");
assert(checklist.includes("nested archive metadata cues"), "checklist omits nested archive cue evidence");
assert(checklist.includes("tar-gzip-archive-input-agent"), "checklist omits TAR/Gzip archive input agent record");
assert(checklist.includes("TAR/Gzip Archive Metadata Input"), "checklist omits TAR/Gzip archive metadata addendum");
assert(checklist.includes("selected `.tar` / `.tar.gz` / `.tgz` / `.gz`"), "checklist omits TAR/Gzip selected file support evidence");
assert(checklist.includes("no archive extraction, decompression, file execution"), "checklist omits TAR/Gzip no-decompression safety evidence");
assert(checklist.includes("sevenzip-rar-archive-agent"), "checklist omits 7z/RAR archive agent record");
assert(checklist.includes("7z/RAR Archive Header Metadata Input"), "checklist omits 7z/RAR archive metadata addendum");
assert(checklist.includes("selected `.7z` / `.rar`"), "checklist omits 7z/RAR selected file support evidence");
assert(checklist.includes("local signature/start-header and first-header metadata"), "checklist omits 7z/RAR header-only evidence");
assert(checklist.includes("source-code-input-agent"), "checklist omits source code input agent record");
assert(checklist.includes("Source Code File Input"), "checklist omits source code file input addendum");
assert(checklist.includes("selected `.py` / `.js` / `.ts` / `.tsx`"), "checklist omits source code selected file support evidence");
assert(checklist.includes("no code execution, dependency install, build, test run"), "checklist omits source code no-execution safety evidence");
assert(checklist.includes("extended-source-language-agent"), "checklist omits expanded source language agent record");
assert(checklist.includes("Expanded Source Language File Input"), "checklist omits expanded source language addendum");
assert(checklist.includes("selected `.swift` / `.kt` / `.kts` / `.rb` / `.php` / `.lua` / `.m` / `.mm` / `.scala` / `.dart` / `.r`"), "checklist omits expanded source language selected file support evidence");
assert(checklist.includes("no Swift/Kotlin/Ruby/PHP/Lua/Objective-C/Scala/Dart/R compiler or interpreter"), "checklist omits expanded source no-runtime safety evidence");
assert(checklist.includes("compiler-backed semantic analysis, package-manager resolution, mobile simulator/runtime launch"), "checklist omits expanded source remaining gap evidence");
assert(checklist.includes("script-file-input-agent"), "checklist omits script file input agent record");
assert(checklist.includes("Script File Inputs"), "checklist omits script file input addendum");
assert(checklist.includes("`.ps1`, `.psm1`, `.psd1`, `.bat`, `.cmd`, `.sh`, `.bash`, and `.zsh`"), "checklist omits script selected file support evidence");
assert(checklist.includes("no PowerShell/cmd/bash process is launched"), "checklist omits script no-shell safety evidence");
assert(checklist.includes("source-code-insight-agent"), "checklist omits source code insight agent record");
assert(checklist.includes("Source Code Static Insight Hints"), "checklist omits source code static insight addendum");
assert(checklist.includes("branching/control-flow"), "checklist omits source code complexity cue evidence");
assert(checklist.includes("test-discovery"), "checklist omits source code test-discovery cue evidence");
assert(checklist.includes("extended-image-metadata-agent"), "checklist omits extended image metadata agent record");
assert(checklist.includes("Extended Image Metadata Input"), "checklist omits extended image metadata addendum");
assert(checklist.includes("selected `.gif` / `.webp` / `.bmp` / `.tif` / `.tiff` / `.ico`"), "checklist omits extended image selected file support evidence");
assert(checklist.includes("image renderer startup, pixel decode, animation playback"), "checklist omits extended image no-render/no-decode safety evidence");
assert(checklist.includes("patch-diff-input-agent"), "checklist omits patch/diff input agent record");
assert(checklist.includes("Patch/Diff File Input"), "checklist omits patch/diff file input addendum");
assert(checklist.includes("workspace-local `.patch` and `.diff`"), "checklist omits patch/diff selected file support evidence");
assert(checklist.includes("hunk/addition/deletion"), "checklist omits patch/diff summary evidence");
assert(checklist.includes("no `git apply`, patch application, command execution, filesystem mutation"), "checklist omits patch/diff no-apply/no-mutation safety evidence");
assert(checklist.includes("full three-way merge prediction, real apply-check integration"), "checklist omits patch/diff remaining gap evidence");
assert(checklist.includes("patch-conflict-preview-agent"), "checklist omits patch conflict prediction agent record");
assert(checklist.includes("Patch Conflict Prediction Hints"), "checklist omits patch conflict prediction addendum");
assert(checklist.includes("sampled old/context lines"), "checklist omits patch conflict context sample evidence");
assert(checklist.includes("MAX_PATCH_CONFLICT_TARGET_BYTES"), "checklist omits patch conflict target byte bound evidence");
assert(checklist.includes("low/medium/high context-match conflict risk"), "checklist omits patch conflict risk label evidence");
assert(checklist.includes("no `git apply --check`, no staging"), "checklist omits patch conflict no-apply-check/no-staging safety evidence");
assert(checklist.includes("full three-way merge prediction, real apply-check integration"), "checklist omits patch conflict remaining gap evidence");
assert(checklist.includes("video-metadata-agent"), "checklist omits video metadata agent record");
assert(checklist.includes("Video Metadata Input"), "checklist omits video metadata addendum");
assert(checklist.includes("selected `.mp4` / `.mov` / `.webm` / `.mkv` / `.avi`"), "checklist omits video selected file support evidence");
assert(checklist.includes("no video player startup, media decoding, frame extraction"), "checklist omits video no-player/no-decode safety evidence");
assert(checklist.includes("nested-archive-inspection-agent"), "checklist omits first-level nested archive inspection agent record");
assert(checklist.includes("First-Level Nested Archive Inspection"), "checklist omits first-level nested archive inspection addendum");
assert(checklist.includes("recursive-nested-archive-agent"), "checklist omits recursive nested archive inspection agent record");
assert(checklist.includes("Second-Level Nested Archive Inspection"), "checklist omits second-level nested archive inspection addendum");
assert(checklist.includes("selected `.zip` containing nested `.zip` / `.tar` / `.tar.gz` / `.tgz` / `.gz`"), "checklist omits nested ZIP manual verification evidence");
assert(checklist.includes("unbounded recursive deep extraction"), "checklist omits nested archive recursion boundary evidence");
assert(checklist.includes("font-metadata-agent"), "checklist omits font metadata input agent record");
assert(checklist.includes("Font Metadata Input"), "checklist omits font metadata input addendum");
assert(checklist.includes("selected `.ttf` / `.otf` / `.woff` / `.woff2`"), "checklist omits font selected file support evidence");
assert(checklist.includes("no font installation, font renderer startup, glyph rasterization"), "checklist omits font no-install/no-renderer safety evidence");
assert(checklist.includes("notebook-input-agent"), "checklist omits notebook input agent record");
assert(checklist.includes("Notebook Input"), "checklist omits notebook input addendum");
assert(checklist.includes("selected `.ipynb`"), "checklist omits notebook selected file support evidence");
assert(checklist.includes("cell/output/error/MIME previews"), "checklist omits notebook preview evidence");
assert(checklist.includes("no notebook kernel startup, code execution, dependency installation"), "checklist omits notebook no-execution safety evidence");
assert(checklist.includes("dependency-lockfile-agent"), "checklist omits dependency lockfile agent record");
assert(checklist.includes("Dependency Lockfile Input"), "checklist omits dependency lockfile input addendum");
assert(checklist.includes("selected dependency lockfiles such as `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `Cargo.lock` / `go.sum`"), "checklist omits dependency lockfile selected file support evidence");
assert(checklist.includes("bounded ecosystem/package previews"), "checklist omits dependency lockfile preview evidence");
assert(checklist.includes("no package manager execution, dependency installation, registry lookup"), "checklist omits dependency lockfile no-install/no-registry safety evidence");
assert(checklist.includes("lockfile-dependency-edge-agent"), "checklist omits lockfile dependency edge agent record");
assert(checklist.includes("Lockfile Dependency Edge Samples"), "checklist omits lockfile dependency edge addendum");
assert(checklist.includes("local dependency edge samples"), "checklist omits dependency edge sample evidence");
assert(checklist.includes("MAX_LOCKFILE_EDGE_PREVIEW"), "checklist omits dependency edge count limit evidence");
assert(checklist.includes("full resolver parity, vulnerability/license registry analysis, and transitive graph validation"), "checklist omits dependency edge remaining gap evidence");
assert(checklist.includes("python-dependency-manifest-agent"), "checklist omits Python dependency manifest agent record");
assert(checklist.includes("Python Dependency Manifest Input"), "checklist omits Python dependency manifest addendum");
assert(checklist.includes("`requirements*.txt`, `pyproject.toml`, `setup.cfg`, `setup.py`, `Pipfile`, `environment.yml` / `environment.yaml`, and `uv.lock`"), "checklist omits Python dependency manifest selected file support evidence");
assert(checklist.includes("MAX_PYTHON_DEPENDENCY_PREVIEW_BYTES"), "checklist omits Python dependency manifest byte limit evidence");
assert(checklist.includes("MAX_PYTHON_DEPENDENCY_ITEM_PREVIEW"), "checklist omits Python dependency manifest item limit evidence");
assert(checklist.includes("no Python interpreter startup, pip/conda/poetry/pipenv/uv command"), "checklist omits Python dependency manifest no-runtime safety evidence");
assert(checklist.includes("package resolver parity, environment solve, lock/update planning"), "checklist omits Python dependency manifest remaining gap evidence");
assert(checklist.includes("node-package-manifest-agent"), "checklist omits Node package manifest agent record");
assert(checklist.includes("Node Package Manifest Input"), "checklist omits Node package manifest input addendum");
assert(checklist.includes("workspace-local `package.json`"), "checklist omits Node package manifest selected file support evidence");
assert(checklist.includes("bounded script/dependency/workspace/entrypoint previews"), "checklist omits Node package manifest bounded preview evidence");
assert(checklist.includes("MAX_NODE_PACKAGE_MANIFEST_PREVIEW_BYTES"), "checklist omits Node package manifest byte limit evidence");
assert(checklist.includes("no npm/pnpm/Yarn/Bun/node command"), "checklist omits Node package manifest no-runtime safety evidence");
assert(checklist.includes("full package-manager resolver parity, lifecycle-script safety analysis"), "checklist omits Node package manifest remaining gap evidence");
assert(checklist.includes("repository-governance-file-agent"), "checklist omits repository governance file agent record");
assert(checklist.includes("Repository Governance File Input"), "checklist omits repository governance file input addendum");
assert(checklist.includes("workspace-local `CODEOWNERS`, `.editorconfig`, `.gitattributes`, `.gitignore`, `LICENSE` / `COPYING`, and `NOTICE`"), "checklist omits repository governance selected file support evidence");
assert(checklist.includes("bounded owner/style/attribute/ignore/license/notice previews"), "checklist omits repository governance bounded preview evidence");
assert(checklist.includes("MAX_REPOSITORY_GOVERNANCE_PREVIEW_BYTES"), "checklist omits repository governance byte limit evidence");
assert(checklist.includes("no git command, CODEOWNERS resolver, license compliance scanner"), "checklist omits repository governance no-runtime safety evidence");
assert(checklist.includes("live CODEOWNERS resolution, license compliance decisions"), "checklist omits repository governance remaining gap evidence");
assert(checklist.includes("security-artifact-input-agent"), "checklist omits security artifact input agent record");
assert(checklist.includes("Security Artifact Input"), "checklist omits security artifact input addendum");
assert(checklist.includes("selected `.pem` / `.crt` / `.cer` / `.der` / `.key` / `.asc` / `.sig` / `.sha256`"), "checklist omits security artifact selected file support evidence");
assert(checklist.includes("bounded X.509/checksum/signature metadata"), "checklist omits security artifact preview evidence");
assert(checklist.includes("no key import, private-key decryption, trust-store mutation"), "checklist omits security artifact no-key-import safety evidence");
assert(checklist.includes("signature verification, keyserver lookup"), "checklist omits security artifact verification/keyserver gap evidence");
assert(checklist.includes("sbom-provenance-input-agent"), "checklist omits SBOM/provenance input agent record");
assert(checklist.includes("SBOM Provenance Artifact Input"), "checklist omits SBOM/provenance input addendum");
assert(checklist.includes("selected `.spdx` / `.spdx.json` / `.cdx.json` / `.intoto.jsonl` / `.attestation`"), "checklist omits SBOM/provenance selected file support evidence");
assert(checklist.includes("bounded SPDX/CycloneDX/in-toto metadata"), "checklist omits SBOM/provenance preview evidence");
assert(checklist.includes("no vulnerability lookup, license compliance decision, signature verification, digest recomputation"), "checklist omits SBOM/provenance local-only safety evidence");
assert(checklist.includes("registry-backed vulnerability/license analysis, trust decisions, and cryptographic attestation verification"), "checklist omits SBOM/provenance remaining gap evidence");
assert(checklist.includes("sarif-result-input-agent"), "checklist omits SARIF result input agent record");
assert(checklist.includes("SARIF Static Analysis Result Input"), "checklist omits SARIF result input addendum");
assert(checklist.includes("workspace-local `.sarif` / `.sarif.json`"), "checklist omits SARIF selected file support evidence");
assert(checklist.includes("bounded SARIF run/result/rule/location previews"), "checklist omits SARIF bounded preview evidence");
assert(checklist.includes("no scanner/test runner/code execution, dependency install, SARIF upload"), "checklist omits SARIF no-scan/no-upload safety evidence");
assert(checklist.includes("live scanner execution, code scanning upload, baseline diffing"), "checklist omits SARIF remaining gap evidence");
assert(checklist.includes("coverage-report-file-agent"), "checklist omits coverage report file input agent record");
assert(checklist.includes("Coverage Report File Input"), "checklist omits coverage report file input addendum");
assert(checklist.includes("workspace-local `.lcov` / `lcov.info` and Cobertura/JaCoCo-shaped `.xml`"), "checklist omits coverage report selected file support evidence");
assert(checklist.includes("bounded coverage file/package/rate previews"), "checklist omits coverage report bounded preview evidence");
assert(checklist.includes("MAX_COVERAGE_REPORT_PREVIEW_BYTES"), "checklist omits coverage report byte limit evidence");
assert(checklist.includes("no test runner, coverage tool, build command, CI provider API call, artifact download"), "checklist omits coverage report no-runner/no-CI safety evidence");
assert(checklist.includes("live coverage artifact download, trend diffing"), "checklist omits coverage report remaining gap evidence");
assert(checklist.includes("test-report-file-agent"), "checklist omits test report file input agent record");
assert(checklist.includes("Test Report File Input"), "checklist omits test report file input addendum");
assert(checklist.includes("workspace-local `.trx` / `.junit.xml`"), "checklist omits test report selected file support evidence");
assert(checklist.includes("bounded JUnit/TRX suite/case/failure previews"), "checklist omits test report bounded preview evidence");
assert(checklist.includes("MAX_TEST_REPORT_PREVIEW_BYTES"), "checklist omits test report byte limit evidence");
assert(checklist.includes("no test runner, build command, CI provider API call, artifact download"), "checklist omits test report no-runner/no-CI safety evidence");
assert(checklist.includes("live CI artifact download, flaky-test trend aggregation"), "checklist omits test report remaining gap evidence");
assert(checklist.includes("macro-office-input-agent"), "checklist omits macro-enabled Office input agent record");
assert(checklist.includes("Macro-Enabled Office Input"), "checklist omits macro-enabled Office input addendum");
assert(checklist.includes("selected `.docm` / `.xlsm` / `.pptm`"), "checklist omits macro-enabled Office selected file support evidence");
assert(checklist.includes("Office XML/cached-value previews"), "checklist omits macro-enabled Office preview evidence");
assert(checklist.includes("VBA project streams were not opened, macros were not executed"), "checklist omits no-VBA/no-macro safety evidence");
assert(checklist.includes("macro/security analysis and full Office layout/media extraction"), "checklist omits macro-enabled Office remaining gap evidence");
assert(checklist.includes("legacy-office-binary-agent"), "checklist omits legacy DOC/XLS binary Office input agent record");
assert(checklist.includes("Legacy DOC/XLS Binary Office Input"), "checklist omits legacy DOC/XLS binary Office addendum");
assert(checklist.includes("selected `.doc` / `.xls`"), "checklist omits legacy DOC/XLS selected file support evidence");
assert(checklist.includes("bounded local binary string previews"), "checklist omits legacy DOC/XLS bounded preview evidence");
assert(checklist.includes("no Word/Excel runtime, macro execution, formula evaluation"), "checklist omits legacy DOC/XLS no-runtime safety evidence");
assert(checklist.includes("contact-file-input-agent"), "checklist omits vCard contact input agent record");
assert(checklist.includes("vCard Contact Input"), "checklist omits vCard contact input addendum");
assert(checklist.includes("workspace-local `.vcf` / `.vcard`"), "checklist omits vCard selected file support evidence");
assert(checklist.includes("bounded vCard contact/field previews"), "checklist omits vCard bounded preview evidence");
assert(checklist.includes("no contacts app access, address book sync, account lookup"), "checklist omits vCard no-address-book safety evidence");
assert(checklist.includes("live contacts provider sync, address book writes"), "checklist omits vCard remaining gap evidence");
assert(checklist.includes("outlook-msg-file-input-agent"), "checklist omits Outlook MSG file input agent record");
assert(checklist.includes("Outlook MSG File Input"), "checklist omits Outlook MSG file input addendum");
assert(checklist.includes("workspace-local `.msg`"), "checklist omits MSG selected file support evidence");
assert(checklist.includes("bounded OLE/string previews"), "checklist omits MSG bounded preview evidence");
assert(checklist.includes("no Outlook/MAPI runtime, mailbox sync, attachment extraction"), "checklist omits MSG no-Outlook/no-mailbox safety evidence");
assert(checklist.includes("live mailbox sync, provider email sends, full MSG attachment extraction"), "checklist omits MSG remaining gap evidence");
assert(checklist.includes("calendar-ics-file-input-agent"), "checklist omits ICS calendar file input agent record");
assert(checklist.includes("Calendar ICS File Input"), "checklist omits ICS calendar file input addendum");
assert(checklist.includes("workspace-local `.ics`"), "checklist omits ICS selected file support evidence");
assert(checklist.includes("bounded VEVENT previews"), "checklist omits ICS bounded event preview evidence");
assert(checklist.includes("no calendar app access, provider API call, schedule mutation"), "checklist omits ICS no-calendar-provider/no-mutation safety evidence");
assert(checklist.includes("live calendar provider sync and schedule writes"), "checklist omits ICS remaining gap evidence");
assert(checklist.includes("pdf-metadata-agent"), "checklist omits PDF metadata input agent record");
assert(checklist.includes("PDF Metadata Input"), "checklist omits PDF metadata input addendum");
assert(checklist.includes("selected `.pdf` metadata/text previews"), "checklist omits PDF selected file support evidence");
assert(checklist.includes("bounded PDF metadata previews"), "checklist omits PDF bounded metadata evidence");
assert(checklist.includes("no PDF renderer, OCR, JavaScript execution"), "checklist omits PDF no-renderer/no-OCR safety evidence");
assert(checklist.includes("full PDF layout extraction, OCR, annotations"), "checklist omits PDF remaining gap evidence");
assert(checklist.includes("pdf-structure-security-agent"), "checklist omits PDF structure/security input agent record");
assert(checklist.includes("PDF Structure Security Hints"), "checklist omits PDF structure/security addendum");
assert(checklist.includes("annotation/link, embedded-file/file-spec"), "checklist omits PDF structure/security marker evidence");
assert(checklist.includes("JavaScript/open/launch/URI action"), "checklist omits PDF action marker evidence");
assert(checklist.includes("no PDF renderer startup, OCR, annotation rendering, embedded-file extraction"), "checklist omits PDF no-render/no-extract safety evidence");
assert(checklist.includes("PDF trust/security decisions"), "checklist omits PDF trust/security remaining gap evidence");
assert(checklist.includes("pdf-object-summary-agent"), "checklist omits PDF object summary agent record");
assert(checklist.includes("PDF Annotation Embedded Object Summaries"), "checklist omits PDF object summary addendum");
assert(checklist.includes("bounded annotation object summaries"), "checklist omits PDF annotation object summary evidence");
assert(checklist.includes("embedded file object summaries"), "checklist omits PDF embedded object summary evidence");
assert(checklist.includes("embedded file bytes are not extracted"), "checklist omits PDF embedded-byte extraction safety evidence");
assert(checklist.includes("har-network-trace-agent"), "checklist omits HAR network trace agent record");
assert(checklist.includes("HAR Network Trace Input"), "checklist omits HAR network trace addendum");
assert(checklist.includes("workspace-local `.har` HTTP Archive"), "checklist omits HAR selected file support evidence");
assert(checklist.includes("bounded HAR entry previews"), "checklist omits HAR bounded entry preview evidence");
assert(checklist.includes("Authorization/Cookie/token redaction"), "checklist omits HAR secret redaction evidence");
assert(checklist.includes("no browser profile access, request replay, network call"), "checklist omits HAR no-replay/no-network safety evidence");
assert(checklist.includes("live browser capture, replay, external network diagnostics"), "checklist omits HAR remaining gap evidence");
assert(checklist.includes("packet-capture-file-agent"), "checklist omits packet capture file input agent record");
assert(checklist.includes("PCAP Packet Capture Input"), "checklist omits packet capture input addendum");
assert(checklist.includes("workspace-local `.pcap` / `.pcapng`"), "checklist omits packet capture selected file support evidence");
assert(checklist.includes("bounded PCAP/PCAPNG header and packet-record previews"), "checklist omits packet capture bounded preview evidence");
assert(checklist.includes("MAX_PCAP_PREVIEW_BYTES"), "checklist omits packet capture byte limit evidence");
assert(checklist.includes("no packet payload decoding, traffic replay, credential extraction"), "checklist omits packet capture no-decode/no-replay safety evidence");
assert(checklist.includes("protocol decoding, stream reconstruction, live capture"), "checklist omits packet capture remaining gap evidence");
assert(checklist.includes("api-spec-file-input-agent"), "checklist omits API spec file input agent record");
assert(checklist.includes("API Spec And Collection Input"), "checklist omits API spec collection addendum");
assert(checklist.includes("Postman collection plus OpenAPI/Swagger JSON/YAML"), "checklist omits API spec selected file support evidence");
assert(checklist.includes("bounded endpoint/server/security extraction"), "checklist omits API spec bounded preview evidence");
assert(checklist.includes("MAX_API_SPEC_PREVIEW_BYTES"), "checklist omits API spec byte limit evidence");
assert(checklist.includes("no request execution, mock server startup, credential lookup, network call"), "checklist omits API spec no-request/no-network safety evidence");
assert(checklist.includes("live API execution, mock-server startup, contract testing"), "checklist omits API spec remaining gap evidence");
assert(checklist.includes("graphql-file-input-agent"), "checklist omits GraphQL file input agent record");
assert(checklist.includes("GraphQL Schema And Query Input"), "checklist omits GraphQL schema/query addendum");
assert(checklist.includes("workspace-local `.graphql` / `.gql`"), "checklist omits GraphQL selected file support evidence");
assert(checklist.includes("bounded operation/type/directive/root-field extraction"), "checklist omits GraphQL bounded preview evidence");
assert(checklist.includes("MAX_GRAPHQL_PREVIEW_BYTES"), "checklist omits GraphQL byte limit evidence");
assert(checklist.includes("no GraphQL request execution, mock server startup, schema introspection"), "checklist omits GraphQL no-request/no-introspection safety evidence");
assert(checklist.includes("live GraphQL execution, schema introspection, contract testing"), "checklist omits GraphQL remaining gap evidence");
assert(checklist.includes("protobuf-schema-file-agent"), "checklist omits Protobuf schema file input agent record");
assert(checklist.includes("Protobuf/gRPC Schema Input"), "checklist omits Protobuf/gRPC schema addendum");
assert(checklist.includes("workspace-local `.proto`"), "checklist omits Protobuf selected file support evidence");
assert(checklist.includes("bounded package/import/message/enum/service/rpc/field previews"), "checklist omits Protobuf bounded preview evidence");
assert(checklist.includes("MAX_PROTOBUF_PREVIEW_BYTES"), "checklist omits Protobuf byte limit evidence");
assert(checklist.includes("no protoc/buf/grpcurl command, code generation, descriptor compilation"), "checklist omits Protobuf no-compiler/no-runtime safety evidence");
assert(checklist.includes("live descriptor compilation, code generation, buf lint/breaking checks"), "checklist omits Protobuf remaining gap evidence");
assert(checklist.includes("kubernetes-manifest-agent"), "checklist omits Kubernetes manifest input agent record");
assert(checklist.includes("Kubernetes Manifest File Input"), "checklist omits Kubernetes manifest input addendum");
assert(checklist.includes("workspace-local Kubernetes JSON/YAML manifests"), "checklist omits Kubernetes selected file support evidence");
assert(checklist.includes("bounded resource/kind/container/image/reference previews"), "checklist omits Kubernetes bounded preview evidence");
assert(checklist.includes("MAX_KUBERNETES_PREVIEW_BYTES"), "checklist omits Kubernetes byte limit evidence");
assert(checklist.includes("no kubectl command, cluster connection, manifest apply"), "checklist omits Kubernetes no-kubectl/no-cluster safety evidence");
assert(checklist.includes("live cluster sync, manifest dry-run validation, policy admission checks"), "checklist omits Kubernetes remaining gap evidence");
assert(checklist.includes("container-build-file-agent"), "checklist omits container build file agent record");
assert(checklist.includes("Container Build File Input"), "checklist omits container build file addendum");
assert(checklist.includes("selected `Dockerfile` / `Containerfile` / `.dockerignore`"), "checklist omits container build selected file support evidence");
assert(checklist.includes("bounded Dockerfile/Containerfile instruction counts"), "checklist omits container instruction preview evidence");
assert(checklist.includes("MAX_CONTAINER_CONFIG_PREVIEW_BYTES"), "checklist omits container config byte limit evidence");
assert(checklist.includes("no container build, image pull, registry lookup, command execution"), "checklist omits container no-build/no-registry safety evidence");
assert(checklist.includes("live container builds, image provenance"), "checklist omits container build remaining gap evidence");
assert(checklist.includes("container-compose-file-agent"), "checklist omits Docker Compose file agent record");
assert(checklist.includes("Docker Compose File Input"), "checklist omits Docker Compose file input addendum");
assert(checklist.includes("workspace-local `docker-compose*.yml` / `docker-compose*.yaml` / `compose*.yml` / `compose*.yaml`"), "checklist omits Docker Compose selected file support evidence");
assert(checklist.includes("MAX_CONTAINER_COMPOSE_SERVICE_PREVIEW"), "checklist omits Docker Compose service preview limit evidence");
assert(checklist.includes("no docker compose command, container build, image pull, registry lookup"), "checklist omits Docker Compose no-runtime safety evidence");
assert(checklist.includes("live Docker Compose validation, image provenance, secret/env resolution"), "checklist omits Docker Compose remaining gap evidence");
assert(checklist.includes("build-manifest-file-agent"), "checklist omits build manifest file agent record");
assert(checklist.includes("Build Manifest File Input"), "checklist omits build manifest file input addendum");
assert(checklist.includes("Maven POM, Gradle, Visual Studio solution, and MSBuild project"), "checklist omits build manifest ecosystem evidence");
assert(checklist.includes("MAX_BUILD_MANIFEST_PREVIEW_BYTES"), "checklist omits build manifest byte limit evidence");
assert(checklist.includes("no Maven/Gradle/MSBuild/dotnet command"), "checklist omits build manifest no-build-tool safety evidence");
assert(checklist.includes("live build graph resolution, package restore, test discovery from build tools"), "checklist omits build manifest remaining gap evidence");
assert(checklist.includes("browser-bookmark-export-agent"), "checklist omits browser bookmark export agent record");
assert(checklist.includes("Browser Bookmark Export Input"), "checklist omits browser bookmark export addendum");
assert(checklist.includes("Netscape bookmark HTML"), "checklist omits browser bookmark export format evidence");
assert(checklist.includes("MAX_BOOKMARK_PREVIEW_BYTES"), "checklist omits browser bookmark byte limit evidence");
assert(checklist.includes("no browser profile access, URL fetch, script execution"), "checklist omits browser bookmark no-profile/no-fetch safety evidence");
assert(checklist.includes("live browser capture and remote page sync"), "checklist omits browser bookmark remaining gap evidence");
assert(checklist.includes("link-shortcut-handoff-agent"), "checklist omits link shortcut handoff agent record");
assert(checklist.includes("Link Shortcut Handoff Input"), "checklist omits link shortcut handoff addendum");
assert(checklist.includes("workspace-local `.url` and `.webloc`"), "checklist omits link shortcut selected file support evidence");
assert(checklist.includes("MAX_LINK_SHORTCUT_PREVIEW_BYTES"), "checklist omits link shortcut byte limit evidence");
assert(checklist.includes("URL/title/host metadata"), "checklist omits link shortcut metadata evidence");
assert(checklist.includes("no browser profile access, URL fetch, script execution"), "checklist omits link shortcut no-profile/no-fetch safety evidence");
assert(checklist.includes("live browser capture, remote page sync"), "checklist omits link shortcut remaining gap evidence");
assert(checklist.includes("windows-shortcut-input-agent"), "checklist omits Windows shortcut input agent record");
assert(checklist.includes("Windows Shortcut Metadata Input"), "checklist omits Windows shortcut metadata addendum");
assert(checklist.includes("workspace-local `.lnk`"), "checklist omits Windows shortcut selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_SHORTCUT_PREVIEW_BYTES"), "checklist omits Windows shortcut byte limit evidence");
assert(checklist.includes("Shell Link header/flag/attribute/timestamp"), "checklist omits Windows shortcut metadata evidence");
assert(checklist.includes("shortcut target was not resolved or opened"), "checklist omits Windows shortcut no-follow safety evidence");
assert(checklist.includes("live shortcut resolution, target validation, icon extraction"), "checklist omits Windows shortcut remaining gap evidence");
assert(checklist.includes("registry-export-input-agent"), "checklist omits registry export input agent record");
assert(checklist.includes("Windows Registry Export Input"), "checklist omits registry export input addendum");
assert(checklist.includes("workspace-local `.reg`"), "checklist omits registry export selected file support evidence");
assert(checklist.includes("MAX_REGISTRY_EXPORT_PREVIEW_BYTES"), "checklist omits registry export byte limit evidence");
assert(checklist.includes("registry key/value/deletion-marker previews"), "checklist omits registry export preview evidence");
assert(checklist.includes("no registry import/export command was executed"), "checklist omits registry export no-mutation safety evidence");
assert(checklist.includes("live registry hive inspection, import/apply validation"), "checklist omits registry export remaining gap evidence");
assert(checklist.includes("windows-event-log-input-agent"), "checklist omits Windows Event Log input agent record");
assert(checklist.includes("Windows Event Log File Input"), "checklist omits Windows Event Log file input addendum");
assert(checklist.includes("workspace-local `.evtx`"), "checklist omits Windows Event Log selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_EVENT_LOG_PREVIEW_BYTES"), "checklist omits Windows Event Log byte limit evidence");
assert(checklist.includes("bounded EVTX header/chunk/record-signature metadata"), "checklist omits Windows Event Log bounded metadata evidence");
assert(checklist.includes("no Event Viewer/wevtutil process"), "checklist omits Windows Event Log no-runtime safety evidence");
assert(checklist.includes("live event log channel access and full event XML parsing"), "checklist omits Windows Event Log remaining gap evidence");
assert(checklist.includes("windows-etl-trace-input-agent"), "checklist omits Windows ETL trace input agent record");
assert(checklist.includes("Windows ETL Trace File Input"), "checklist omits Windows ETL trace file input addendum");
assert(checklist.includes("workspace-local `.etl`"), "checklist omits Windows ETL trace selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_ETL_TRACE_PREVIEW_BYTES"), "checklist omits Windows ETL trace byte limit evidence");
assert(checklist.includes("bounded ETL header/signature/string metadata"), "checklist omits Windows ETL trace bounded metadata evidence");
assert(checklist.includes("no Windows Performance Analyzer/tracerpt/logman process"), "checklist omits Windows ETL trace no-runtime safety evidence");
assert(checklist.includes("live ETW session access, provider manifest lookup, and event payload decoding"), "checklist omits Windows ETL trace remaining gap evidence");
assert(checklist.includes("windows-wprp-profile-input-agent"), "checklist omits Windows WPRP profile input agent record");
assert(checklist.includes("Windows Performance Recorder Profile File Input"), "checklist omits Windows WPRP profile file input addendum");
assert(checklist.includes("workspace-local `.wprp`"), "checklist omits Windows WPRP selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_WPRP_PREVIEW_BYTES"), "checklist omits Windows WPRP byte limit evidence");
assert(checklist.includes("bounded WPRP profile/collector/provider metadata"), "checklist omits Windows WPRP bounded metadata evidence");
assert(checklist.includes("no wpr.exe launch"), "checklist omits Windows WPRP no-runtime safety evidence");
assert(checklist.includes("live WPR profile execution, ETW session access, provider manifest lookup"), "checklist omits Windows WPRP remaining gap evidence");
assert(checklist.includes("windows-crash-dump-input-agent"), "checklist omits Windows crash dump input agent record");
assert(checklist.includes("Windows Crash Dump File Input"), "checklist omits Windows crash dump file input addendum");
assert(checklist.includes("workspace-local `.dmp` / `.mdmp` / `.hdmp`"), "checklist omits Windows crash dump selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_CRASH_DUMP_PREVIEW_BYTES"), "checklist omits Windows crash dump byte limit evidence");
assert(checklist.includes("bounded minidump header and stream-directory metadata"), "checklist omits Windows crash dump bounded metadata evidence");
assert(checklist.includes("no WinDbg/cdb/procdump process"), "checklist omits Windows crash dump no-debugger safety evidence");
assert(checklist.includes("symbol lookup, stack unwinding, memory scanning"), "checklist omits Windows crash dump remaining gap evidence");
assert(checklist.includes("windows-error-report-input-agent"), "checklist omits Windows Error Reporting input agent record");
assert(checklist.includes("Windows Error Reporting Report Input"), "checklist omits Windows Error Reporting report input addendum");
assert(checklist.includes("workspace-local `.wer`"), "checklist omits Windows Error Reporting selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_ERROR_REPORT_PREVIEW_BYTES"), "checklist omits Windows Error Reporting byte limit evidence");
assert(checklist.includes("bounded WER key/value and problem-signature previews"), "checklist omits Windows Error Reporting bounded preview evidence");
assert(checklist.includes("no Windows Error Reporting directory scan"), "checklist omits Windows Error Reporting no-system-scan safety evidence");
assert(checklist.includes("live WER folder collection, dump correlation"), "checklist omits Windows Error Reporting remaining gap evidence");
assert(checklist.includes("windows-installer-package-agent"), "checklist omits Windows installer package input agent record");
assert(checklist.includes("Windows Installer Package File Input"), "checklist omits Windows installer package input addendum");
assert(checklist.includes("workspace-local `.msi` / `.msix` / `.appx` / `.msixbundle` / `.appxbundle`"), "checklist omits Windows installer selected file support evidence");
assert(checklist.includes("bounded MSI OLE header and MSIX/APPX manifest previews"), "checklist omits Windows installer bounded preview evidence");
assert(checklist.includes("MAX_WINDOWS_INSTALLER_PACKAGE_PREVIEW_BYTES"), "checklist omits Windows installer byte limit evidence");
assert(checklist.includes("no package install/register/sideload command"), "checklist omits Windows installer no-install safety evidence");
assert(checklist.includes("live package install validation, signature trust decisions, payload extraction"), "checklist omits Windows installer remaining gap evidence");
assert(checklist.includes("windows-driver-package-agent"), "checklist omits Windows driver package input agent record");
assert(checklist.includes("Windows Driver Package File Input"), "checklist omits Windows driver package input addendum");
assert(checklist.includes("workspace-local `.inf` Windows driver setup files and `.cat` security catalog files"), "checklist omits Windows driver package selected file support evidence");
assert(checklist.includes("MAX_WINDOWS_DRIVER_PACKAGE_PREVIEW_BYTES"), "checklist omits Windows driver package byte limit evidence");
assert(checklist.includes("INF section/version/manufacturer/model/service previews"), "checklist omits Windows driver INF metadata evidence");
assert(checklist.includes("catalog header/PKCS#7 cue/readable string samples"), "checklist omits Windows driver catalog metadata evidence");
assert(checklist.includes("no pnputil/devcon/DISM/signtool/certutil command"), "checklist omits Windows driver no-runtime safety evidence");
assert(checklist.includes("live driver install validation, trust-chain verification, catalog member hashing"), "checklist omits Windows driver remaining gap evidence");
assert(checklist.includes("geospatial-file-agent"), "checklist omits geospatial file input agent record");
assert(checklist.includes("Geospatial File Input"), "checklist omits geospatial file input addendum");
assert(checklist.includes("workspace-local `.geojson` / `.topojson` / `.gpx` / `.kml`"), "checklist omits geospatial selected file support evidence");
assert(checklist.includes("bounded feature/type/bounds/coordinate previews"), "checklist omits geospatial bounded preview evidence");
assert(checklist.includes("MAX_GEOSPATIAL_PREVIEW_BYTES"), "checklist omits geospatial byte limit evidence");
assert(checklist.includes("no map renderer, tile fetch, location service, route optimization"), "checklist omits geospatial no-render/no-location safety evidence");
assert(checklist.includes("live map rendering, tile/provider sync, geocoding, route optimization"), "checklist omits geospatial remaining gap evidence");
assert(checklist.includes("iac-file-input-agent"), "checklist omits IaC Terraform/HCL file input agent record");
assert(checklist.includes("IaC Terraform/HCL File Input"), "checklist omits IaC Terraform/HCL file input addendum");
assert(checklist.includes("workspace-local `.tf` / `.tf.json` / `.tfvars` / `.hcl`"), "checklist omits IaC selected file support evidence");
assert(checklist.includes("bounded Terraform/HCL block counts"), "checklist omits IaC bounded block preview evidence");
assert(checklist.includes("MAX_IAC_PREVIEW_BYTES"), "checklist omits IaC byte limit evidence");
assert(checklist.includes("no `terraform init`, `terraform plan`, `terraform apply`, cloud credential lookup"), "checklist omits IaC no-terraform/no-cloud safety evidence");
assert(checklist.includes("live Terraform validation, cloud inventory sync, policy-as-code evaluation"), "checklist omits IaC remaining gap evidence");
assert(checklist.includes("ansible-automation-file-agent"), "checklist omits Ansible automation file input agent record");
assert(checklist.includes("Ansible Playbook/Inventory File Input"), "checklist omits Ansible playbook/inventory input addendum");
assert(checklist.includes("workspace-local Ansible playbook/task YAML and inventory files"), "checklist omits Ansible selected file support evidence");
assert(checklist.includes("MAX_ANSIBLE_PREVIEW_BYTES"), "checklist omits Ansible byte limit evidence");
assert(checklist.includes("MAX_ANSIBLE_ITEM_PREVIEW"), "checklist omits Ansible item limit evidence");
assert(checklist.includes("no `ansible-playbook`, `ansible-inventory`, or `ansible` command"), "checklist omits Ansible no-runtime safety evidence");
assert(checklist.includes("live Ansible syntax-check, inventory plugin execution, vault decryption"), "checklist omits Ansible remaining gap evidence");
assert(checklist.includes("3d-model-file-agent"), "checklist omits 3D model file input agent record");
assert(checklist.includes("3D Model File Input"), "checklist omits 3D model file input addendum");
assert(checklist.includes("workspace-local `.stl`, `.obj`, `.gltf`, and `.glb`"), "checklist omits 3D model selected file support evidence");
assert(checklist.includes("bounded STL ASCII facet or binary triangle hints"), "checklist omits 3D model bounded preview evidence");
assert(checklist.includes("MAX_3D_MODEL_PREVIEW_BYTES"), "checklist omits 3D model byte limit evidence");
assert(checklist.includes("no model renderer startup, GPU rendering, mesh repair"), "checklist omits 3D model no-render/no-repair safety evidence");
assert(checklist.includes("live 3D rendering, geometry validation/repair, unit conversion"), "checklist omits 3D model remaining gap evidence");
assert(checklist.includes("cad-drawing-file-agent"), "checklist omits CAD drawing file input agent record");
assert(checklist.includes("CAD Drawing File Input"), "checklist omits CAD drawing file input addendum");
assert(checklist.includes("workspace-local `.dxf` and `.dwg`"), "checklist omits CAD drawing selected file support evidence");
assert(checklist.includes("bounded DXF section/entity/layer previews"), "checklist omits CAD drawing bounded preview evidence");
assert(checklist.includes("MAX_CAD_DRAWING_PREVIEW_BYTES"), "checklist omits CAD drawing byte limit evidence");
assert(checklist.includes("no CAD renderer, geometry computation, unit conversion"), "checklist omits CAD drawing no-render/no-geometry safety evidence");
assert(checklist.includes("live CAD rendering, geometric validation, unit conversion"), "checklist omits CAD drawing remaining gap evidence");
assert(checklist.includes("diagram-source-input-agent"), "checklist omits diagram source file input agent record");
assert(checklist.includes("Diagram Source File Input"), "checklist omits diagram source input addendum");
assert(checklist.includes("workspace-local `.drawio` / `.mmd` / `.mermaid` / `.puml` / `.plantuml`"), "checklist omits diagram source selected file support evidence");
assert(checklist.includes("bounded draw.io/Mermaid/PlantUML previews"), "checklist omits diagram source bounded preview evidence");
assert(checklist.includes("MAX_DIAGRAM_SOURCE_PREVIEW_BYTES"), "checklist omits diagram source byte limit evidence");
assert(checklist.includes("no diagram renderer, Graphviz, PlantUML/Java process"), "checklist omits diagram source no-render/no-runtime safety evidence");
assert(checklist.includes("live diagram rendering, layout validation, include expansion"), "checklist omits diagram source remaining gap evidence");
assert(checklist.includes("tsv-structured-data-agent"), "checklist omits TSV structured data agent record");
assert(checklist.includes("TSV Structured Data Input"), "checklist omits TSV structured data input addendum");
assert(checklist.includes("selected `.tsv`"), "checklist omits TSV selected file support evidence");
assert(checklist.includes("tab-separated column and sample-row previews"), "checklist omits TSV preview evidence");
assert(checklist.includes("no database connection, spreadsheet macro execution, schema inference service"), "checklist omits TSV no-database/no-macro safety evidence");
assert(checklist.includes("jsonl-structured-data-agent"), "checklist omits JSONL structured data agent record");
assert(checklist.includes("JSONL/NDJSON Structured Data Input"), "checklist omits JSONL/NDJSON structured data input addendum");
assert(checklist.includes("workspace-local `.jsonl` / `.ndjson`"), "checklist omits JSONL/NDJSON selected file support evidence");
assert(checklist.includes("bounded JSON-lines record and field/type previews"), "checklist omits JSONL/NDJSON bounded preview evidence");
assert(checklist.includes("MAX_JSONL_PREVIEW_RECORDS"), "checklist omits JSONL preview record bound evidence");
assert(checklist.includes("no database connection, query execution, schema inference service"), "checklist omits JSONL no-query safety evidence");
assert(checklist.includes("cross-file/provider-backed event stream inference"), "checklist omits JSONL remaining gap evidence");
assert(checklist.includes("columnar-data-file-agent"), "checklist omits columnar data file input agent record");
assert(checklist.includes("Parquet/Arrow/Feather Columnar Data Input"), "checklist omits columnar data input addendum");
assert(checklist.includes("workspace-local `.parquet` / `.arrow` / `.feather`"), "checklist omits columnar data selected file support evidence");
assert(checklist.includes("bounded header/footer metadata previews"), "checklist omits columnar data bounded preview evidence");
assert(checklist.includes("MAX_COLUMNAR_DATA_PREVIEW_BYTES"), "checklist omits columnar data byte limit evidence");
assert(checklist.includes("no DuckDB/PyArrow/Spark query"), "checklist omits columnar data no-query safety evidence");
assert(checklist.includes("row-group decoding, record-batch decoding, provider-backed schema inference"), "checklist omits columnar data remaining gap evidence");
assert(checklist.includes("delimited-schema-agent"), "checklist omits delimited schema hints agent record");
assert(checklist.includes("Delimited Schema Hints"), "checklist omits delimited schema hints addendum");
assert(checklist.includes("local delimited schema hints"), "checklist omits local delimited schema hint evidence");
assert(checklist.includes("column type, non-empty counts, mostly-unique values, enum-like value sets"), "checklist omits delimited schema profile evidence");
assert(checklist.includes("external schema inference service"), "checklist omits delimited schema local-only safety evidence");
assert(checklist.includes("cross-file joins, provider-backed inference"), "checklist omits delimited schema remaining gap evidence");
assert(checklist.includes("ci-workflow-file-agent"), "checklist omits CI/CD workflow file agent record");
assert(checklist.includes("CI/CD Workflow File Input"), "checklist omits CI/CD workflow file addendum");
assert(checklist.includes("GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines, CircleCI, and Buildkite"), "checklist omits CI/CD workflow provider coverage evidence");
assert(checklist.includes("MAX_CI_WORKFLOW_PREVIEW_ITEMS"), "checklist omits CI/CD workflow item bound evidence");
assert(checklist.includes("no CI runner, shell command, provider API call, secret retrieval"), "checklist omits CI/CD workflow no-runner/no-secret safety evidence");
assert(checklist.includes("live CI provider sync, runner log streaming, and secret-aware validation"), "checklist omits CI/CD workflow remaining gap evidence");

console.log("Chatbar checklist verification passed.");
