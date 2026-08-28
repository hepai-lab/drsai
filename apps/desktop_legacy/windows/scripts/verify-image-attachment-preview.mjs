import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const component = await readFile(resolve(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const styles = await readFile(resolve(root, "../shared/renderer/src/styles.css"), "utf8");
const app = await readFile(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
const projection = await readFile(resolve(root, "../shared/main/threadRuntimeProjection.ts"), "utf8");
const main = await readFile(resolve(root, "src/main/index.ts"), "utf8");

assert(component.includes('data-testid="composer-attachment-image"'),
  "the composer must expose a clickable local image thumbnail");
assert(component.includes('data-testid="composer-external-attachment-image"'),
  "the composer must expose a clickable external image thumbnail");
assert(component.includes('data-testid="message-attachment-image"'),
  "sent user messages must expose a clickable image thumbnail");
assert(component.includes("setAttachmentImagePreview({"),
  "composer thumbnails must open the image preview state");
assert(component.includes("function AttachmentImageLightbox") && component.includes("createPortal("),
  "image enlargement must render as an overlay outside the composer layout");
assert(component.includes('event.key !== "Escape"') && component.includes("onClick={onClose}"),
  "the image overlay must close with Escape and the backdrop/close control");
assert(component.includes("previewWorkspaceFile({"),
  "sent local image attachments must lazily recover a preview when only a path was persisted");
assert(styles.includes(".composer-attachment-preview-button") && styles.includes("cursor: zoom-in"),
  "composer thumbnail affordance must be styled as zoomable");
assert(styles.includes("width: 112px") && styles.includes("height: 84px"),
  "sent image attachments must remain compact thumbnails rather than full-size images");
assert(styles.includes("max-height: calc(100vh - 140px)"),
  "the enlarged image must remain bounded by the viewport");
assert(main.includes("createPickedImageThumbnail") && main.includes("nativeImage.createFromPath"),
  "large picked images must still receive a bounded local thumbnail");
assert(projection.includes("persistedPart.reference") && projection.includes("path: workspaceReference"),
  "OAEP history must preserve the staged workspace image reference for thumbnail recovery");
assert(app.includes("normalizeThreadSnapshotMessageOrder(result.snapshot)")
  && app.includes("const displaySnapshot = mergeThreadSnapshotForDisplay(snapshot, storedSnapshot"),
"live and persisted snapshots must preserve user-before-assistant order and local preview data");

console.log("Image attachment thumbnail and enlargement verification passed.");
