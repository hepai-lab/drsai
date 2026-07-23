import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = await mkdtemp(join(tmpdir(), "drsai-channel-adapters-")); process.env.DRSAI_HOME = root;
try {
  const [channels, readiness] = await Promise.all([import("../main/channelAdapters.ts"), import("../main/externalConnectionReadiness.ts")]);
  const workspace = join(root, "workspace"); const drsai = join(workspace, ".drsai"); await mkdir(drsai, { recursive: true });
  const connectionStorePath = join(root, "desktop", "channel-connections.json"); await mkdir(dirname(connectionStorePath), { recursive: true });
  const workspaceStoreKey = createHash("sha256").update(workspace.trim().toLowerCase()).digest("hex"); const preparedAt = new Date(Date.now() - 60_000).toISOString(); const futureExpiry = new Date(Date.now() + 600_000).toISOString(); const expiredAt = new Date(Date.now() - 1_000).toISOString();
  await writeFile(connectionStorePath, JSON.stringify({ workspaces: { [workspaceStoreKey]: [
    { adapterId: "docs-connector", workspacePath: workspace, provider: "docs", mode: "session_stub", configuredAt: preparedAt, updatedAt: preparedAt, accountLabel: "Legacy Docs session", scopeLabel: "documents.readonly", credentialState: "placeholder", readOnly: false },
    { adapterId: "github-connector", workspacePath: workspace, provider: "github", mode: "session_stub", configuredAt: preparedAt, updatedAt: preparedAt, accountLabel: "GitHub authorization pending", scopeLabel: "repo:read", credentialState: "placeholder", authPreparedAt: preparedAt, sessionExpiresAt: expiredAt, authOperationId: "channel-auth:11111111-1111-4111-8111-111111111111", readOnly: false },
    { adapterId: "github-connector", workspacePath: workspace, provider: "github", mode: "session_stub", configuredAt: preparedAt, updatedAt: preparedAt, accountLabel: "GitHub authorization pending", scopeLabel: "repo:read", credentialState: "placeholder", authPreparedAt: preparedAt, sessionExpiresAt: futureExpiry, authOperationId: "channel-auth:22222222-2222-4222-8222-222222222222", readOnly: false },
  ] } }));
  const initial = channels.listChannelAdapters(workspace); assert.equal(initial.adapters.length, 9); assert(initial.availableCount >= 4);
  const resumedGitHub = initial.adapters.find((adapter: { id: string }) => adapter.id === "github-connector"); assert.equal(resumedGitHub?.authOperationId, "channel-auth:22222222-2222-4222-8222-222222222222"); assert.equal(resumedGitHub?.configured, false);
  const migratedConnections = JSON.parse(await readFile(connectionStorePath, "utf8")).workspaces[workspaceStoreKey]; assert.equal(migratedConnections.length, 1, "legacy and expired placeholders must be removed atomically"); assert.equal(migratedConnections[0].adapterId, "github-connector");
  await assert.rejects(async () => channels.configureChannelAdapter({ adapterId: "docs-connector", workspacePath: workspace, mode: "session_stub" } as never), /placeholders cannot be configured/i);
  await assert.rejects(async () => channels.configureChannelAdapter({ adapterId: "slack-chat", workspacePath: workspace } as never), /only the GitHub connector/i);
  assert.equal(channels.listChannelAdapters(workspace).configuredCount, initial.configuredCount, "rejected placeholder sessions must not change the configured count");
  await assert.rejects(async () => channels.startChannelAdapterAuth({ adapterId: "slack-chat", workspacePath: workspace, scopes: ["channels:read", "chat:write"] }), /real provider-token/i);
  await assert.rejects(async () => channels.startChannelAdapterAuth({ adapterId: "docs-connector", workspacePath: workspace }), /real provider-token/i);
  await assert.rejects(async () => channels.startChannelAdapterAuth({ adapterId: "calendar-connector", workspacePath: workspace }), /real provider-token/i);
  await assert.rejects(async () => channels.startChannelAdapterAuth({ adapterId: "mobile-chat", workspacePath: workspace }), /dedicated pairing flow/i);
  const unpreparedSlack = channels.listChannelAdapters(workspace).adapters.find((adapter: { id: string }) => adapter.id === "slack-chat"); assert.equal(unpreparedSlack?.configured, false); assert.equal(unpreparedSlack?.authPreparedAt, undefined);
  const slackReadiness = readiness.listExternalConnectionReadiness(workspace).connections.find((connection: { id: string }) => connection.id === "slack"); assert.equal(slackReadiness?.configured, false); assert.equal(slackReadiness?.status, "partial");
  await assert.rejects(async () => channels.startChannelAdapterAuth({ adapterId: "file-input", workspacePath: workspace }), /does not support|do not use/i);

  await writeFile(join(drsai, "docs-context.json"), JSON.stringify({ documents: [{ title: "Architecture", owner: "Team", updatedAt: "2026-07-22", body: "Reviewed design context" }] }));
  const imported = channels.importChannelContext({ adapterId: "docs-connector", workspacePath: workspace }); assert.equal(imported.items.length, 1); assert.equal(imported.items[0].kind, "document"); assert.match(imported.verification, /no network/i);
  const events = channels.listChannelInboundEvents({ workspacePath: workspace, status: "queued" }); assert.equal(events.length, 1); const routed = channels.routeChannelInboundEvent({ eventId: events[0].id, workspacePath: workspace, action: "route_to_chat" }); assert.equal(routed.event.status, "routed"); assert.equal(routed.importResult.items[0].title, "Architecture");
  const sync1 = channels.syncChannelSnapshots({ workspacePath: workspace, adapterIds: ["docs-connector", "github-connector"] }); assert.equal(sync1.queuedEventCount, 1); assert.deepEqual(sync1.skippedAdapterIds, ["github-connector"]); const syncEvent = channels.listChannelInboundEvents({ workspacePath: workspace }).find((item: { id: string }) => item.id.includes("snapshot-sync")); assert(syncEvent); channels.routeChannelInboundEvent({ eventId: syncEvent.id, action: "dismiss" }); const sync2 = channels.syncChannelSnapshots({ workspacePath: workspace, adapterIds: ["docs-connector"] }); assert.equal(sync2.queuedEventCount, 1); assert.equal(channels.listChannelInboundEvents({ workspacePath: workspace }).find((item: { id: string }) => item.id === syncEvent.id)?.status, "dismissed", "stable sync must preserve reviewed status");

  const formats = channels.listChannelImportFormats();
  assert.equal(formats.length, 416, "the declared file-input format surface must change only with an explicit contract update");
  assert.equal(new Set(formats).size, formats.length); assert(formats.includes(".info.plist") && formats.includes(".sarif") && formats.includes(".xlsx"));
  const adapterSource = await readFile(resolve(process.cwd(), "../shared/main/channelAdapters.ts"), "utf8");
  const readinessSource = await readFile(resolve(process.cwd(), "../shared/main/externalConnectionReadiness.ts"), "utf8");
  const mockSource = await readFile(resolve(process.cwd(), "../shared/renderer/src/mockDesktopApi.ts"), "utf8");
  for (const staleCatalogCopy of ["Use local Git remote now; live OAuth", "Live Slack OAuth/session sync is still pending", "live OAuth/session sync is still pending", "Live mobile device pairing and notification routing are still pending", "Live microphone capture and transcription runtime are still pending", "Live capture still needs device selection"]) {
    assert(!adapterSource.includes(staleCatalogCopy) && !mockSource.includes(staleCatalogCopy), `channel catalog retains superseded capability copy: ${staleCatalogCopy}`);
  }
  for (const implementedCapability of ["Sync live issues and pull requests with Device OAuth", "Send approved messages through chat.postMessage", "Append approved revision-bound edits", "Read bounded live Google Calendar events", "Use dedicated Mobile Pairing for device authorization"]) {
    assert(adapterSource.includes(implementedCapability) && mockSource.includes(implementedCapability), `production/mock catalog omits implemented capability: ${implementedCapability}`);
  }
  assert(adapterSource.includes("Live database connections are still pending") && adapterSource.includes("live log streaming remains pending"), "catalog must preserve honest database/log runtime boundaries");
  for (const staleGap of ["Live GitHub OAuth/API sync", "Live Slack OAuth/session sync", "Live Docs provider authorization", "Live Calendar OAuth/API sync"]) assert(!readinessSource.includes(staleGap), `readiness must not report implemented capability as pending: ${staleGap}`);
  assert.match(readinessSource, /fake-provider Device OAuth[\s\S]+conversations\.history[\s\S]+revision-bound batchUpdate[\s\S]+bounded events\.list/, "readiness must cite the four implemented live provider paths");
  assert(!mockSource.includes("live OAuth reads and sends remain pending"), "mock Slack setup must not contradict the implemented live provider path");
  for (const staleGap of ["Live GitHub OAuth/API sync", "Live Slack OAuth/session sync", "Live Docs provider authorization", "Live Calendar OAuth/API sync", "Mock local snapshot or session stub is configured"]) assert(!mockSource.includes(staleGap), `mock readiness must not retain superseded provider copy: ${staleGap}`);
  assert(mockSource.includes("function buildMockExternalConnectionReadiness") && mockSource.includes('adapter?.authMode === "oauth"') && mockSource.includes('adapter?.authMode === "provider_token"') && mockSource.includes('base.id !== "calendar"'), "mock readiness must derive writable live-provider state from the current adapter");
  assert.match(mockSource, /readyCount: connections\.filter[\s\S]+partialCount: connections\.filter[\s\S]+plannedCount: connections\.filter/, "mock readiness summary counts must be derived after provider state changes");
  assert(!mockSource.includes('request.mode === "session_stub"'), "mock must not retain a typed placeholder configuration path");
  assert(mockSource.includes('(request as { mode?: string }).mode === "session_stub"'), "mock must detect untyped legacy placeholder requests at runtime");
  assert(mockSource.includes("Mock channel session placeholders cannot be configured"), "mock must reject legacy placeholder configuration");
  assert(!adapterSource.includes("function configureChannelAdapterSessionStub"), "production must not retain a session-placeholder configuration implementation");
  assert.match(mockSource, /\["github-connector", "slack-chat", "docs-connector", "calendar-connector"\]\.includes\(request\.adapterId\)/, "mock revoke must cover every production provider authorization");
  assert.match(mockSource, /adapter\.id !== "github-connector"[^\n]+real provider-token or dedicated pairing flow/, "mock authorization preparation must fail closed like production");
  const formatLiteral = adapterSource.match(/const IMPORTABLE_EXTENSIONS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  const declaredFormats = [...formatLiteral.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(declaredFormats).size, declaredFormats.length, "source format declarations must not contain duplicates");
  assert.deepEqual([...declaredFormats].sort((a, b) => a.localeCompare(b)), formats, "runtime and source format inventories must match");

  const fixtures: Array<[string, string | Buffer]> = [
    [".env", "PUBLIC_MODE=review\nAPI_TOKEN=must-not-leak\n"],
    ["src/sample.py", "def greet(name: str) -> str:\n    return f'hello {name}'\n"],
    ["data.csv", "name,value\nalpha,1\nbeta,2\n"],
    ["events.jsonl", '{"event":"start","ok":true}\n{"event":"finish","ok":true}\n'],
    ["calendar.ics", "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Review\nDTSTART:20260722T010000Z\nEND:VEVENT\nEND:VCALENDAR\n"],
    ["contacts.vcf", "BEGIN:VCARD\nVERSION:3.0\nFN:Example User\nEMAIL:user@example.invalid\nEND:VCARD\n"],
    ["schema.sql", "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n"],
    ["Info.plist", '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.drsai.test</string></dict></plist>'],
    [".github/workflows/ci.yml", "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n"],
    ["Dockerfile", "FROM node:22-alpine\nWORKDIR /app\nCOPY . .\n"],
    ["README.md", "# Fixture\n\nA representative document.\n"],
    ["trace.har", '{"log":{"version":"1.2","creator":{"name":"test","version":"1"},"entries":[]}}'],
    ["report.sarif", '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"test"}},"results":[]}]}'],
    ["schema.graphql", "type Query { health: String! }\n"],
    ["message.proto", 'syntax = "proto3"; message Event { string id = 1; }\n'],
    ["style.css", ":root { --accent: #3366ff; }\n.card { color: var(--accent); }\n"],
    ["script.sh", "#!/bin/sh\nset -eu\nprintf '%s\\n' ready\n"],
    ["Cargo.toml", '[package]\nname = "fixture"\nversion = "0.1.0"\n'],
    ["go.mod", "module example.invalid/fixture\n\ngo 1.24\n"],
    ["pubspec.yaml", "name: fixture\nversion: 1.0.0\nenvironment:\n  sdk: '>=3.0.0'\n"],
    ["composer.json", '{"name":"example/fixture","require":{"php":">=8.2"}}'],
    ["Gemfile", "source 'https://rubygems.org'\ngem 'rake'\n"],
    ["pom.xml", '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>fixture</artifactId><version>1</version></project>'],
    ["build.gradle", "plugins { id 'java' }\nrepositories { mavenCentral() }\n"],
    ["CMakeLists.txt", "cmake_minimum_required(VERSION 3.20)\nproject(fixture)\nadd_executable(fixture main.cpp)\n"],
    ["main.tf", 'resource "local_file" "fixture" { filename = "fixture.txt" content = "ok" }\n'],
    ["openapi.json", '{"openapi":"3.1.0","info":{"title":"Fixture","version":"1"},"paths":{}}'],
    ["feed.rss", '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><title>Entry</title></item></channel></rss>'],
    ["chat.chat-export.json", '{"messages":[{"sender":"user","text":"hello","timestamp":"2026-07-22T00:00:00Z"}]}'],
    ["notebook.ipynb", '{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[{"cell_type":"markdown","metadata":{},"source":["# Fixture"]}]}'],
    ["requests.http", "GET https://example.invalid/health\nAccept: application/json\n"],
    ["manifest.webmanifest", '{"name":"Fixture","short_name":"Fixture","start_url":"/","display":"standalone"}'],
    [".npmrc", "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=npm-secret-value\n"],
    [".pypirc", "[pypi]\nrepository=https://upload.pypi.org/legacy/\nusername=fixture\npassword=pypi-secret-value\n"],
    ["kubeconfig.yaml", "apiVersion: v1\nkind: Config\nusers:\n- name: fixture\n  user:\n    token: kube-secret-value\n"],
    ["mcp-servers.json", '{"mcpServers":{"fixture":{"command":"node","env":{"API_TOKEN":"mcp-secret-value"}}}}'],
    ["export.browser-passwords.csv", "name,url,username,password\nFixture,https://example.invalid,user,browser-secret-value\n"],
    ["archive.zip", makeStoredZip([["hello.txt", Buffer.from("hello archive")]])],
    ["unsafe.zip", makeStoredZip([["../escape.txt", Buffer.from("must remain inside archive metadata")]])],
    ["document.docx", makeStoredZip([["[Content_Types].xml", Buffer.from("<Types/>")], ["word/document.xml", Buffer.from('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Document fixture</w:t></w:r></w:p></w:body></w:document>')]])],
    ["slides.pptx", makeStoredZip([["[Content_Types].xml", Buffer.from("<Types/>")], ["ppt/slides/slide1.xml", Buffer.from('<p:sld xmlns:p="p" xmlns:a="a"><a:t>Slide fixture</a:t></p:sld>')]])],
    ["workbook.xlsx", makeStoredZip([["[Content_Types].xml", Buffer.from("<Types/>")], ["xl/workbook.xml", Buffer.from('<workbook><sheets><sheet name="Data" sheetId="1"/></sheets></workbook>')], ["xl/worksheets/sheet1.xml", Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row></sheetData></worksheet>')]])],
    ["document.pdf", Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")],
    ["pixel.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64")],
    ["tone.wav", makeWaveHeader()],
    ["clip.mp4", Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex")],
    ["database.sqlite", makeSqliteHeader()],
  ];
  const fixturePaths: string[] = [];
  assert(fixtures.length >= 45, "channel parser contract must retain broad cross-ecosystem representative coverage");
  for (const [relativePath, content] of fixtures) { const path = join(workspace, relativePath); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); fixturePaths.push(path); }
  const fileImport = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: fixturePaths, limit: 50 });
  assert.equal(fileImport.items.length, fixtures.length); assert.equal(fileImport.truncated, false);
  assert(fileImport.items.every((item: { summary: string; relativePath: string; mime: string }) => item.summary.length > 0 && item.summary.length <= 4096 && item.relativePath && item.mime));
  const combinedSummaries = fileImport.items.map((item: { summary: string }) => item.summary).join("\n");
  assert.doesNotMatch(combinedSummaries, /must-not-leak|npm-secret-value|pypi-secret-value|kube-secret-value|mcp-secret-value|browser-secret-value/); assert.match(combinedSummaries, /API_TOKEN/); assert.match(combinedSummaries, /CREATE TABLE|tasks/i); assert.match(combinedSummaries, /CFBundleIdentifier|ai\.drsai\.test/i);
  const summaryOf = (title: string) => fileImport.items.find((item: { title: string }) => item.title === title)?.summary ?? "";
  assert.match(summaryOf("archive.zip"), /hello\.txt/); assert.match(summaryOf("document.docx"), /Document fixture/); assert.match(summaryOf("slides.pptx"), /Slide fixture/); assert.match(summaryOf("workbook.xlsx"), /Data|Value/); assert.match(summaryOf("pixel.png"), /1\s*[×x]\s*1|width.?1/i); assert.match(summaryOf("database.sqlite"), /SQLite/i);
  await assert.rejects(() => access(join(root, "escape.txt")), /ENOENT/, "archive summaries must never extract path-traversal entries");
  const limitedImport = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: fixturePaths, limit: 3 });
  assert.equal(limitedImport.items.length, 3); assert.equal(limitedImport.truncated, true);
  const reachabilityRoot = join(workspace, "format-reachability"); await mkdir(reachabilityRoot, { recursive: true });
  const reachabilityFiles: Array<{ format: string; path: string }> = [];
  const canonicalFormatPaths: Record<string, string> = {
    ".android-resource.xml": join("res", "values", "strings.xml"),
    ".dotnet-global.json": "global.json",
    ".gha-job-summary.md": "job-summary.md",
    ".gradle-version-catalog.toml": "libs.versions.toml",
    ".helm-chart.yaml": "Chart.yaml",
    ".iis-web.config": "web.config",
    ".jetbrains-ide.xml": join(".idea", "workspace.xml"),
    ".json-schema.json": "fixture.schema.json",
    ".syft.json": "syft.json",
    ".syslog": "fixture.syslog",
    ".vscode-extensions.json": join(".vscode", "extensions.json"),
    ".vscode-launch.json": join(".vscode", "launch.json"),
    ".vscode-settings.json": join(".vscode", "settings.json"),
    ".vscode-tasks.json": join(".vscode", "tasks.json"),
    ".web-app-association.json": "apple-app-site-association",
    ".web-server.conf": "nginx.conf",
    ".winget-manifest.yaml": join("winget", "fixture.yaml"),
  };
  const unclassifiedFormats: string[] = [];
  for (const [index, format] of formats.entries()) {
    const directory = join(reachabilityRoot, String(index).padStart(3, "0")); await mkdir(directory);
    const candidates = [canonicalFormatPaths[format], `fixture${format}`, format.slice(1), format].filter((candidate): candidate is string => Boolean(candidate));
    const name = candidates.find((candidate) => channels.classifyChannelImportFormat(join(directory, candidate)) === format);
    if (!name) { unclassifiedFormats.push(format); continue; }
    const path = join(directory, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.alloc(0)); assert.equal(channels.classifyChannelImportFormat(path), format); reachabilityFiles.push({ format, path });
  }
  assert.deepEqual(unclassifiedFormats, [], "every inventory format must have a canonical classifier path");
  for (let offset = 0; offset < reachabilityFiles.length; offset += 40) {
    const batch = reachabilityFiles.slice(offset, offset + 40);
    let result;
    try { result = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: batch.map((item) => item.path), limit: 50 }); }
    catch (error) { throw new Error(`Format reachability batch failed at ${batch.map((item) => item.format).join(", ")}: ${error instanceof Error ? error.message : String(error)}`); }
    assert.equal(result.items.length, batch.length, `empty/truncated formats must remain independently importable: ${batch.map((item) => item.format).join(", ")}`);
    assert.equal(result.truncated, false); assert(result.items.every((item: { summary: string }) => item.summary.length > 0 && item.summary.length <= 4096));
  }
  const malformedPaths: string[] = [];
  for (const [name, content] of [["broken.json", "{"], ["broken.har", "not-json"], ["broken.sarif", "[]"], ["broken.ipynb", "null"], ["broken.rss", "<rss><channel>"], ["oversized.csv", `column\n${"x".repeat(200_000)}\n`]]) { const path = join(workspace, name); await writeFile(path, content); malformedPaths.push(path); }
  const malformedImport = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: malformedPaths });
  assert.equal(malformedImport.items.length, malformedPaths.length); assert(malformedImport.items.every((item: { summary: string }) => item.summary.length > 0 && item.summary.length <= 4096));
  const resourceFixtures: Array<[string, Buffer]> = [
    ["oversized.zip", makeStoredZip([["large.bin", Buffer.alloc(1_200_000, 0x61)]])],
    ["forged.zip", forgeZipSizes(makeStoredZip([["small.txt", Buffer.from("small")]]))],
    ["nested.zip", makeStoredZip([["level-1.zip", makeStoredZip([["level-2.zip", makeStoredZip([["level-3.txt", Buffer.from("bounded")]])]])]])],
    ["expansion.tar.gz", gzipSync(Buffer.alloc(2_000_000, 0x61))],
    ["forged.7z", makeSevenZipHugeHeader()],
    ["forged.rar", Buffer.from("526172211a0701000000000000000000", "hex")],
  ];
  const resourcePaths: string[] = [];
  for (const [name, bytes] of resourceFixtures) { const path = join(workspace, name); await writeFile(path, bytes); resourcePaths.push(path); }
  const resourceImport = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: resourcePaths });
  assert.equal(resourceImport.items.length, resourceFixtures.length); assert(resourceImport.items.every((item: { summary: string }) => item.summary.length > 0 && item.summary.length <= 4096));
  assert.match(resourceImport.items.find((item: { title: string }) => item.title === "expansion.tar.gz")?.summary ?? "", /bounded|unavailable|metadata/i);
  await assert.rejects(() => access(join(root, "large.bin")), /ENOENT/); await assert.rejects(() => access(join(root, "level-3.txt")), /ENOENT/);
  const rejectedPaths = channels.importChannelContext({ adapterId: "file-input", workspacePath: workspace, paths: [join(root, "outside.txt"), join(workspace, "missing.json"), workspace] });
  assert.equal(rejectedPaths.items.length, 0); assert.equal(rejectedPaths.truncated, true);

  const draft = { adapterId: "slack-chat", workspacePath: workspace, target: "#release", subject: "Review", body: "Please review the release notes.", idempotencyKey: "channel:release:review" }; const approval = channels.createChannelOutboundDraftApproval(draft); assert.equal(approval.actionKind, "external.service"); assert.equal(approval.risk, "high");
  const rejected = channels.executeChannelOutboundDelivery(draft, "approval-rejected", false); assert.equal(rejected.status, "rejected"); const blocked = channels.executeChannelOutboundDelivery(draft, "approval-approved-no-runtime", true); assert.equal(blocked.status, "blocked"); assert.equal(blocked.runtime, "missing_live_provider");
  await writeFile(join(drsai, "channel-outbox.json"), JSON.stringify({ enabled: true, outboxPath: ".drsai/outbox.jsonl", allowedAdapters: ["slack-chat"] })); const delivered = channels.executeChannelOutboundDelivery(draft, "approval-approved-outbox", true); assert.equal(delivered.status, "sent"); assert.equal(delivered.runtime, "workspace_local_outbox"); const outbox = await readFile(join(drsai, "outbox.jsonl"), "utf8"); assert.match(outbox, /#release/); const deliveries = channels.listChannelOutboundDeliveries({ workspacePath: workspace }); assert(deliveries.length >= 2 && deliveries.some((item: { status: string }) => item.status === "sent") && deliveries.some((item: { status: string }) => item.status === "rejected" || item.status === "blocked"));

  const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "docs.json"), JSON.stringify({ documents: [{ title: "Outside", body: "must not import" }] })); const linked = join(workspace, "linked-outside"); await symlink(outside, linked, "junction"); const escaped = channels.importChannelContext({ adapterId: "docs-connector", workspacePath: workspace, snapshotPath: "linked-outside/docs.json" }); assert.equal(escaped.items.length, 0, "realpath boundary must reject junction escape");
  const status = readiness.listExternalConnectionReadiness(workspace); assert(status.connections.some((item: { id: string; configured: boolean; status: string }) => item.id === "docs" && !item.configured && item.status === "partial"));
  const finalConnections = JSON.parse(await readFile(connectionStorePath, "utf8")).workspaces[workspaceStoreKey]; assert.equal(finalConnections.length, 1, "rejected placeholder configuration must not add connection records");
  for (const name of ["channel-deliveries.json", "channel-inbound-events.json"]) { const path = join(root, "desktop", name); await access(path); if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o077, 0); }
  console.log(`Channel adapter contract passed (formats=${formats.length}, emptyOrTruncatedReachability=${reachabilityFiles.length}, representative=${fixtures.length}, malformedOrOversized=${malformedPaths.length}, resourceAttackFixtures=${resourceFixtures.length}, secretFixtures=6, plus catalog/auth/sync/routing/outbox/realpath).`);
} finally { await rm(root, { recursive: true, force: true }); }

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries: Array<[string, Buffer]>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name); const checksum = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes); offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function makeWaveHeader(): Buffer {
  const value = Buffer.alloc(44); value.write("RIFF", 0); value.writeUInt32LE(36, 4); value.write("WAVEfmt ", 8); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(8_000, 24); value.writeUInt32LE(16_000, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write("data", 36); return value;
}

function makeSqliteHeader(): Buffer {
  const value = Buffer.alloc(100); value.write("SQLite format 3\0", 0, "binary"); value.writeUInt16BE(4096, 16); value[18] = 1; value[19] = 1; value[20] = 0; value[21] = 64; value[22] = 32; value[23] = 32; return value;
}

function forgeZipSizes(value: Buffer): Buffer {
  const result = Buffer.from(value); const central = result.indexOf(Buffer.from("504b0102", "hex")); assert(central >= 0); result.writeUInt32LE(0xffffffff, central + 20); result.writeUInt32LE(0xffffffff, central + 24); return result;
}

function makeSevenZipHugeHeader(): Buffer {
  const value = Buffer.alloc(32); Buffer.from("377abcaf271c", "hex").copy(value); value[6] = 0; value[7] = 4; value.writeBigUInt64LE(0xffffffffffffffffn, 12); value.writeBigUInt64LE(0xffffffffffffffffn, 20); value.writeUInt32LE(0xffffffff, 28); return value;
}
