import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const workspace = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const css = read("../shared/renderer/src/styles.css");

assert(workspace.includes("gridTemplateRows: `repeat(${turnRailMarkers.length}, minmax(0, 1fr))`"));
assert(workspace.includes('() => visibleMessages') && workspace.includes('.filter((message) => message.role === "user")'));
assert(!workspace.includes("(center / scrollHeight) * 100"));
assert(!workspace.includes("style={{ top: `${marker.top}%` }}"));
assert(workspace.includes('data-turn-id={marker.id}'));
assert(workspace.includes("handleTurnRailKeyDown(event, index)"));
assert(workspace.includes('tabIndex={marker.id === activeTurnRailId'));
assert(workspace.includes('observer.observe(message)'));
assert(workspace.includes('chatPane?.style.setProperty("--chat-composer-height", height)'));
assert(css.includes('.conversation-turn-rail button::after'));
assert(css.includes('top: 68px') && css.includes('bottom: calc(var(--chat-composer-height, 112px) + 14px)'));
assert(css.includes('height: 100%'));
assert(css.includes('display: grid'));
assert(css.includes('.conversation-turn-rail button:hover::after'));

console.log("Conversation turn rail UI verification passed (14 checks).");
