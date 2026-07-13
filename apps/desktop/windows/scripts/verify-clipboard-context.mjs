import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Clipboard context verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(packageJson.includes('"verify:clipboard-context": "node scripts/verify-clipboard-context.mjs"'), "package script is not registered");

assert(chatWorkspace.includes("ClipboardEvent as ReactClipboardEvent"), "composer does not type paste events");
assert(chatWorkspace.includes("function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>)"), "composer omits paste handler");
assert(chatWorkspace.includes("onPaste={handlePaste}"), "textarea is not wired to paste handler");
assert(chatWorkspace.includes("MAX_CLIPBOARD_IMAGE_BYTES"), "clipboard image byte cap is missing");
assert(chatWorkspace.includes("MAX_CLIPBOARD_IMAGE_COUNT"), "clipboard image count cap is missing");
assert(chatWorkspace.includes("MAX_CLIPBOARD_PATH_MENTIONS"), "clipboard local path mention cap is missing");
assert(chatWorkspace.includes('file.type.startsWith("image/")'), "paste handler does not filter image clipboard files");
assert(chatWorkspace.includes("insertTextAtCursor(pathMentionText || text)"), "paste handler does not preserve pasted text or normalized local path mentions");
assert(chatWorkspace.includes("normalizePastedLocalPathMentions"), "paste handler does not normalize local path mentions");
assert(chatWorkspace.includes("extractPastedLocalPathMentions"), "local path paste extraction is missing");
assert(chatWorkspace.includes('mentions.push(`@${candidate.kind}:"${candidate.path}"`)'), "pasted local paths are not converted to inline @file/@folder mentions");
assert(chatWorkspace.includes("No clipboard polling, filesystem read, network call, or provider send was performed"), "clipboard local path safety boundary copy is missing");
assert(chatWorkspace.includes("createClipboardImageAttachment"), "clipboard image attachment builder is missing");
assert(chatWorkspace.includes('path: `clipboard:image:${crypto.randomUUID()}`'), "clipboard images do not use a non-filesystem attachment path");
assert(chatWorkspace.includes('kind: "selection"'), "clipboard image context is not attached as reviewed selection context");
assert(chatWorkspace.includes("screenshotDataUrl"), "clipboard image data URL is not attached for model-capable visual context");
assert(chatWorkspace.includes("Image data URL was not attached because it exceeds"), "large clipboard image downgrade copy is missing");
assert(chatWorkspace.includes("No OCR, vision model, filesystem write, network call, or provider send was performed"), "clipboard image safety boundary copy is missing");

assert(checklist.includes("clipboard-context-agent"), "checklist omits clipboard context agent record");
assert(checklist.includes("Clipboard Text/Image Paste Context"), "checklist omits clipboard context addendum");
assert(checklist.includes("MAX_CLIPBOARD_IMAGE_BYTES"), "checklist omits clipboard image byte cap evidence");
assert(checklist.includes("explicit textarea paste events"), "checklist omits explicit paste-event boundary evidence");
assert(checklist.includes("Clipboard Local Path Paste Mentions"), "checklist omits clipboard local path mention addendum");
assert(checklist.includes("MAX_CLIPBOARD_PATH_MENTIONS"), "checklist omits clipboard local path mention cap evidence");
assert(roadmap.includes("clipboard text/image paste context"), "roadmap omits clipboard context evidence");
assert(roadmap.includes("clipboard local path paste mentions"), "roadmap omits clipboard local path mention evidence");

console.log("Clipboard context verification passed.");
