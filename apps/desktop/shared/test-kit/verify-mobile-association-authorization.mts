import assert from "node:assert/strict";

import { mobileAssociationScopeEditorState } from "../renderer/src/components/mobileAssociationScopeEditor.ts";

const association = {
  workspace_scope: "all" as const,
  workspace_ids: [] as string[],
  permissions: ["read", "send", "approve", "files"] as Array<"read" | "send" | "approve" | "files">,
};
const workspaces = [
  { id: "workspace-b", name: "Beta" },
  { id: "workspace-a", name: "Alpha" },
] as never[];

const initial = mobileAssociationScopeEditorState(association, workspaces);
assert.deepEqual(initial.workspaces.map((item) => item.id), ["workspace-a", "workspace-b"]);
assert.deepEqual([...initial.selectedPermissions].sort(), ["approve", "files", "read", "send"]);
assert.equal(initial.canSave, true, "all -> selected is an explicit scope reduction");

const permissionOnly = mobileAssociationScopeEditorState(
  association,
  workspaces,
  initial.selectedIds,
  new Set(["read", "approve"] as const),
);
assert.deepEqual([...permissionOnly.selectedPermissions].sort(), ["approve", "read"]);
assert.equal(permissionOnly.canSave, true);

const emptyPermissions = mobileAssociationScopeEditorState(
  association,
  workspaces,
  initial.selectedIds,
  new Set(),
);
assert.equal(emptyPermissions.canSave, false, "at least one permission must remain");
assert.equal(emptyPermissions.selectedPermissions.size, 0);

const selectedAssociation = {
  ...association,
  workspace_scope: "selected" as const,
  workspace_ids: ["workspace-a", "workspace-b"],
};
const unchanged = mobileAssociationScopeEditorState(selectedAssociation, workspaces);
assert.equal(unchanged.canSave, false);
const narrowed = mobileAssociationScopeEditorState(
  selectedAssociation,
  workspaces,
  new Set(["workspace-a"]),
  new Set(["read", "send", "approve", "files"] as const),
);
assert.equal(narrowed.canSave, true);
assert.deepEqual([...narrowed.selectedIds], ["workspace-a"]);

console.log("mobile association authorization verifier passed");
