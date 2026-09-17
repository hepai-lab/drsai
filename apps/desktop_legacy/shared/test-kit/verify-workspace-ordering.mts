import assert from "node:assert/strict";
import {
  normalizeWorkspaceSortMode,
  sortWorkspacesForSidebar,
} from "../renderer/src/workspaceOrdering.ts";

const base = {
  path: "C:\\workspace",
  description: "",
  trusted: true,
  pinned: false,
  location: "local" as const,
  instructions: [],
  updatedAt: "2026-08-16T00:00:00Z",
};
const alpha = { ...base, id: "workspace-a", name: "Alpha", createdAt: "2026-08-01T00:00:00Z", lastOpenedAt: "2026-08-16T00:00:00Z" };
const beta = { ...base, id: "workspace-b", name: "Beta", createdAt: "2026-08-02T00:00:00Z", lastOpenedAt: "2026-08-15T00:00:00Z" };

assert.equal(normalizeWorkspaceSortMode("recent"), "created", "legacy recent-use order must migrate to a stable order");
assert.deepEqual(sortWorkspacesForSidebar([alpha, beta], "created").map((item) => item.id), ["workspace-b", "workspace-a"]);
assert.deepEqual(
  sortWorkspacesForSidebar([
    { ...alpha, lastOpenedAt: "2026-08-01T00:00:00Z" },
    { ...beta, lastOpenedAt: "2026-08-20T00:00:00Z" },
  ], "created").map((item) => item.id),
  ["workspace-b", "workspace-a"],
  "changing the active Workspace timestamp must not reorder the sidebar",
);
assert.deepEqual(sortWorkspacesForSidebar([beta, alpha], "name").map((item) => item.id), ["workspace-a", "workspace-b"]);

console.log("Stable Workspace sidebar ordering verified.");
