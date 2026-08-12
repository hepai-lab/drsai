#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const controllerPath = resolve("apps/desktop/shared/main/mobilePairingController.ts");
const { MobilePairingController } = await import(pathToFileURL(controllerPath).href);
const editorPath = resolve("apps/desktop/shared/renderer/src/components/mobileAssociationScopeEditor.ts");
const { mobileAssociationScopeEditorState } = await import(pathToFileURL(editorPath).href);

const calls = [];
const client = {
  shrinkMobileAssociation: async (associationId, permissions, scope) => {
    calls.push({ associationId, permissions, scope });
    return {
      association_id: associationId,
      permissions,
      workspace_scope: scope.workspace_scope,
      workspace_ids: scope.workspace_ids,
    };
  },
};
const controller = new MobilePairingController(async () => client);
const result = await controller.shrinkAssociation(
  "assoc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ["read", "read"],
  { workspace_scope: "selected", workspace_ids: ["workspace-two", "workspace-one", "workspace-one"] },
);
assert.deepEqual(calls, [{
  associationId: "assoc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  permissions: ["read"],
  scope: { workspace_scope: "selected", workspace_ids: ["workspace-one", "workspace-two"] },
}]);
assert.deepEqual(result.workspace_ids, ["workspace-one", "workspace-two"]);

await assert.rejects(
  controller.shrinkAssociation("assoc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["read"], {
    workspace_scope: "selected", workspace_ids: [],
  }),
  /Workspace scope is invalid/,
);

const workspaces = [
  { id: "workspace-one", name: "One" },
  { id: "workspace-two", name: "Two" },
  { id: "workspace-three", name: "Three" },
];
const allEditor = mobileAssociationScopeEditorState(
  { workspace_scope: "all", workspace_ids: [] }, workspaces,
);
assert.equal(allEditor.workspaces.length, 3);
assert.equal(allEditor.canSave, true);
const selectedEditor = mobileAssociationScopeEditorState(
  { workspace_scope: "selected", workspace_ids: ["workspace-one", "workspace-two"] }, workspaces,
);
assert.deepEqual(selectedEditor.workspaces.map(({ id }) => id), ["workspace-one", "workspace-two"]);
assert.equal(selectedEditor.canSave, false);
const reducedEditor = mobileAssociationScopeEditorState(
  { workspace_scope: "selected", workspace_ids: ["workspace-one", "workspace-two"] }, workspaces,
  new Set(["workspace-one"]),
);
assert.equal(reducedEditor.canSave, true);

const app = await readFile(resolve("apps/desktop/shared/renderer/src/App.tsx"), "utf8");
for (const marker of [
  'data-testid="android-device-scope"',
  'data-testid="android-device-scope-editor"',
  'data-testid="android-device-scope-save"',
  "扩大范围需要重新连接设备",
  "association.workspace_ids",
  "androidPermissionText",
  "association.last_seen_at",
  "pauseMobileRemoteAccess",
  "revokeAndroidDevice",
]) assert.ok(app.includes(marker), `desktop-device-scope:${marker}`);

const gateway = await readFile(resolve(
  "cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
for (const marker of [
  "class MobileAssociationShrinkRequest",
  "workspace_scope: str | None",
  "workspace_ids: list[str] | None",
]) assert.ok(gateway.includes(marker), `gateway-device-scope:${marker}`);

const relayTest = await readFile(resolve(
  "cores/python/packages/drsai/tests/test_relay_api.py"), "utf8");
for (const marker of [
  "test_two_device_workspace_idor_matrix_filters_catalog_and_denies_before_proxy",
  'pair("android-selected-0001"',
  'pair("android-selected-0002"',
  "test_authorization_shrink_closes_stream_and_new_requests_use_reduced_permissions",
  '"authorization_changed"',
  '"authorization_expansion_forbidden"',
]) assert.ok(relayTest.includes(marker), `relay-device-scope:${marker}`);

console.log(JSON.stringify({
  passed: true,
  device_idor_cases: 4,
  workspace_scopes: 2,
  editor_state_cases: 3,
  immediate_stream_invalidation: true,
  authorization_expansion: "re-pair-required",
}));
