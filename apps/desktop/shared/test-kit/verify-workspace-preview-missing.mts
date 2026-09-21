import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, basename, join, relative, resolve } from "node:path";

/**
 * A preview for a file that was deleted, moved or renamed used to reject with
 * the raw filesystem error (`ENOENT ... realpath`). Electron logs *every*
 * rejected `ipcMain.handle` call unconditionally and the renderer cannot
 * suppress that log, so a single deleted artifact left a permanent error trail
 * in the console — doubled by the React.StrictMode double-mount that probes the
 * bubble twice. A stale chat bubble is a normal state, not a failure, so the
 * contract is now:
 *
 *   1. desktopApi.ts         - `WorkspaceFilePreview.missing` names the state,
 *                              additively (no existing caller breaks).
 *   2. workspaceContext.ts   - the placeholder is built from the request alone
 *                              (no filesystem access), so it also covers remote
 *                              workspaces and a deleted workspace root, while
 *                              `previewWorkspaceFile` stays the strict primitive
 *                              the write paths depend on.
 *   3. windows/main/index.ts - only ENOENT/ENOTDIR (local) or a remote 404 are
 *                              turned into a resolved placeholder; anything else
 *                              still rejects. The event survives as an
 *                              info-level diagnostic instead of console noise.
 *   4. workspacePreview.ts   - a single renderer funnel: in-flight
 *                              de-duplication plus a short-lived `missing`
 *                              negative cache, with an explicit opt-out for
 *                              previews the user asked for (the local workspace
 *                              has no fs watcher, so a negative cache can only
 *                              be trusted for automatic rendering).
 *   5. renderer surfaces     - the artifact bubble, the file tree, the knowledge
 *                              base, the citation panel and the fork/compare
 *                              flows render "deleted/moved" instead of an empty
 *                              pane that reads like a 0-byte file.
 */

// Resolve the checkout from the entry path the runner was given rather than
// from `import.meta.url`: the bundled runner executes a copy under a temporary
// directory, so module-relative paths would resolve outside the checkout. Both
// runners pass the entry as argv[2], so this works either way.
const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-workspace-preview-missing.mts");
const testKit = dirname(entryFile);
const shared = resolve(testKit, "..");
const app = resolve(shared, "..");
const rendererRoot = resolve(shared, "renderer/src");

const read = (path: string): string => readFileSync(path, "utf8");
const flatten = (source: string): string => source.replace(/\s+/g, " ");
const count = (source: string, needle: string): number => source.split(needle).length - 1;

function check(source: string, needle: string, label: string): void {
  assert.ok(flatten(source).includes(flatten(needle)), `missing workspace-preview contract: ${label}`);
}

/** Slice from a start marker up to (and including) the end marker that follows it. */
function block(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing block start for ${label}: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to >= 0, `missing block end for ${label}: ${end}`);
  return source.slice(from, to + end.length);
}

const listSources = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listSources(full);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [full] : [];
  });

// ---------------------------------------------------------------------------
// 1. The type contract is additive.
// ---------------------------------------------------------------------------
const desktopApi = read(resolve(shared, "api/desktopApi.ts"));
const previewType = block(desktopApi, "export interface WorkspaceFilePreview {", "\n}", "WorkspaceFilePreview");
check(previewType, "missing?: boolean;", "WorkspaceFilePreview exposes `missing?: boolean`");
check(
  previewType,
  "The requested path no longer exists inside the workspace (deleted, moved or",
  "the missing flag is documented as a deleted/moved path",
);
check(
  previewType,
  "renamed). The preview is a placeholder:",
  "the missing flag is documented as a placeholder, not an empty file",
);
assert.ok(
  previewType.includes("truncated: boolean;"),
  "the missing flag must be added next to the existing required fields, not replace one",
);

// ---------------------------------------------------------------------------
// 2. The placeholder is request-derived; the strict primitive stays strict.
// ---------------------------------------------------------------------------
const context = read(resolve(shared, "main/workspaceContext.ts"));
check(context, 'const MISSING_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);', "missing-path errno set");
check(context, "export function isWorkspaceFileMissingError(error: unknown): boolean {", "missing-path predicate is exported for the IPC boundary");
check(context, "export function buildMissingWorkspacePreview(rawRequest: unknown): WorkspaceFilePreview | null {", "placeholder builder is exported");

const builder = block(
  context,
  "export function buildMissingWorkspacePreview(",
  "function missingRelativePath(",
  "buildMissingWorkspacePreview",
);
for (const forbidden of ["realpath", "existsSync", "lstatSync", "statSync", "readFile", "resolveInsideWorkspace"]) {
  assert.ok(
    !builder.includes(forbidden),
    `the placeholder must be derived from the request alone: buildMissingWorkspacePreview must not call ${forbidden}`,
  );
}
check(builder, "missing: true,", "placeholder marks itself missing");
check(builder, "size: 0,", "placeholder reports a zero size rather than stale metadata");
check(builder, "message: \"This file no longer exists in the workspace", "placeholder carries an actionable message");
assert.ok(
  builder.includes("return null;"),
  "an untrusted request must yield null so the handler still rejects instead of inventing a preview",
);

const strictPrimitive = block(
  context,
  "export async function previewWorkspaceFile(",
  "/** errno codes meaning",
  "previewWorkspaceFile",
);
assert.ok(
  !strictPrimitive.includes("missing"),
  "previewWorkspaceFile is shared with the write paths (saveWorkspaceFileAs / writeWorkspaceFile) and must not soften its errors",
);

// ---------------------------------------------------------------------------
// 3. Only "the path is gone" reaches the renderer; everything else rejects.
// ---------------------------------------------------------------------------
const main = read(resolve(app, "windows/src/main/index.ts"));
check(main, 'secureHandle("desktop:workspace-file-preview"', "handler stays on the secure IPC boundary");
check(
  main,
  "if (!isWorkspaceFileMissingError(error) && !isRemoteFileNotFoundError(error)) return null;",
  "only ENOENT/ENOTDIR and a remote 404 are converted",
);
check(main, 'operation: "workspace.preview.missing"', "the converted event is still recorded as a diagnostic");
check(main, 'level: "info"', "the diagnostic is info-level, not an error");
check(main, 'error.name !== "RemoteProtocolError"', "remote 404 detection is bound to the protocol error type");
check(main, "return (error as { status?: unknown }).status === 404;", "remote 404 detection reads the protocol status");

const handler = block(
  main,
  'secureHandle("desktop:workspace-file-preview"',
  "registerConversationResourceReadIpc",
  "workspace-file-preview handler",
);
check(handler, "const missing = resolveWorkspacePreviewFailure(error, request);", "the handler asks for a placeholder on failure");
const returnMissing = handler.indexOf("if (missing) return missing;");
const rethrow = handler.indexOf("throw error;", returnMissing + 1);
assert.ok(returnMissing >= 0, "the missing placeholder must be returned, not thrown");
assert.ok(rethrow >= 0, "every other failure must still reject the handler");
assert.ok(returnMissing < rethrow, "the placeholder must be returned before the fallback rethrow");

// ---------------------------------------------------------------------------
// 4. One renderer funnel, with an explicit opt-out for user-initiated previews.
// ---------------------------------------------------------------------------
const previewWrapper = read(resolve(rendererRoot, "workspacePreview.ts"));
check(previewWrapper, "const MISSING_PREVIEW_TTL_MS = 30_000;", "the negative cache has a bounded TTL");
check(previewWrapper, "cacheMissing?: boolean;", "callers can opt out of negative caching");
check(previewWrapper, "const inFlight = new Map<string, Promise<WorkspaceFilePreview>>();", "in-flight requests are de-duplicated");
check(previewWrapper, "if (pending) return pending;", "a repeated probe reuses the in-flight request");
check(previewWrapper, "if (isMissingWorkspacePreview(preview)) {", "only `missing` answers are negatively cached");
check(previewWrapper, "export function forgetWorkspacePreview(", "a written file can drop its stale negative entry");
check(previewWrapper, "return preview?.missing === true;", "`missing` is read strictly, never truthy-coerced");

const rendererSources = listSources(rendererRoot);
assert.ok(rendererSources.length > 100, `renderer source scan found only ${rendererSources.length} files; the funnel check would be vacuous`);
const directCallers = rendererSources
  // `workspacePreview.ts` is the funnel itself; `mockDesktopApi.ts` is the
  // in-renderer test double.
  .filter((file) => !["workspacePreview.ts", "mockDesktopApi.ts"].includes(basename(file)))
  .filter((file) => read(file).includes("previewWorkspaceFile"));
assert.deepEqual(
  directCallers.map((file) => relative(rendererRoot, file).replace(/\\/g, "/")),
  [],
  "every renderer preview must go through loadWorkspacePreview so de-duplication and the negative cache cannot be bypassed",
);

const userInitiated = [
  ["App.tsx", 6],
  ["components/ChatWorkspace.tsx", 3],
  ["components/files/CitationSourcePanel.tsx", 1],
  ["components/files/FilesContextPanel.tsx", 2],
  ["components/KnowledgeBasePanel.tsx", 1],
] as const;
let bypassTotal = 0;
for (const [file, expected] of userInitiated) {
  const source = read(resolve(rendererRoot, file));
  const occurrences = count(source, "cacheMissing: false");
  assert.ok(
    occurrences >= expected,
    `${file} must not reuse a cached \`missing\` answer for a preview the user asked for (expected >= ${expected}, found ${occurrences})`,
  );
  bypassTotal += occurrences;
}
const bubble = read(resolve(rendererRoot, "components/StructuredMessageParts.tsx"));
assert.ok(
  !bubble.includes("cacheMissing"),
  "the artifact bubble renders on its own (and twice under StrictMode), so it must keep the default negative caching",
);
check(bubble, "const [previewMissing, setPreviewMissing] = useState(false);", "the bubble tracks a missing probe");
check(bubble, "const effectiveResourceState = previewMissing && resourceState !== \"offline\"", "a missing probe drives the bubble state");
check(bubble, "data-resource-state={effectiveResourceState}", "the derived state reaches the styled surface");

// ---------------------------------------------------------------------------
// 5. The missing state is rendered, not silently degraded to metadata.
// ---------------------------------------------------------------------------
const filePreviewer = read(resolve(rendererRoot, "components/files/file_previewer/FilePreviewer.tsx"));
check(filePreviewer, "import { MissingPreviewer } from \"./MissingPreviewer\";", "the previewer dispatches to a dedicated missing view");
check(filePreviewer, "if (preview.missing) return <MissingPreviewer language={language} preview={preview} />;", "a missing preview never reaches the metadata/empty views");
const dispatchAt = filePreviewer.indexOf("if (preview.missing)");
const metadataAt = filePreviewer.indexOf("<MetadataPreviewer");
assert.ok(dispatchAt > filePreviewer.indexOf("if (!preview)"), "the missing check must not shadow the empty preview");
assert.ok(metadataAt > dispatchAt, "the missing check must run before the metadata fallback that shows `0 B`");

const missingView = read(resolve(rendererRoot, "components/files/file_previewer/MissingPreviewer.tsx"));
check(missingView, "className=\"files-preview-missing\" data-resource-state=\"deleted\"", "the missing view declares the deleted resource state");
check(missingView, "describeMissingWorkspacePreview", "the missing view shares one wording with the other surfaces");
check(missingView, "{preview.relativePath || preview.path}", "the missing view still shows which path is gone");

const styles = read(resolve(rendererRoot, "styles.css"));
check(styles, ".files-preview-missing {", "the missing preview pane is styled");
check(styles, '.structured-artifact-card[data-resource-state="deleted"] .structured-artifact strong', "a deleted artifact bubble is de-emphasised");
check(styles, '.structured-artifact-card[data-resource-state="deleted"] .structured-artifact,', "a deleted artifact bubble stops looking clickable");
check(styles, '.structured-citation[data-resource-state="deleted"] .structured-citation-open strong', "a deleted citation is de-emphasised");

console.log(
  `Workspace preview missing-state verification passed (IPC placeholder, renderer funnel, negative cache, ${bypassTotal} user-initiated bypasses).`,
);
