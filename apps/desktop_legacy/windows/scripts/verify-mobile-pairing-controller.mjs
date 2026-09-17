import assert from "node:assert/strict";
import { MobilePairingController } from "../../shared/main/mobilePairingController.ts";

let creates = 0;
let reads = 0;
let revokes = 0;
let pauses = 0;
let resumes = 0;
let shrinks = 0;
const expiry = () => new Date(Date.now() + 120_000).toISOString();
const client = {
  async getMobilePairingReadiness() {
    return { state: "ready", action: "scan", runtime_id: "runtime_test", environment: "development" };
  },
  async createMobilePairingGrant() {
    creates += 1;
    await Promise.resolve();
    return { grant_id: `ag_${String(creates).padStart(32, "0")}`, expires_at: expiry(), status: "pending", payload: "opendrsai://associate?v=1" };
  },
  async getMobilePairingGrant(grantId) {
    reads += 1;
    return { grant_id: grantId, expires_at: expiry(), status: reads > 1 ? "consumed" : "pending" };
  },
  async revokeMobilePairingGrant(grantId) {
    revokes += 1;
    return { grant_id: grantId, expires_at: expiry(), status: "revoked" };
  },
  async listMobileAssociations() {
    return [{
      association_id: "assoc_00000000000000000000000000000000",
      subject_summary: "sub_000000000000",
      device_summary: "dev_000000000000",
      device_name: "Samsung SM-X936C",
      status: "active",
      access_state: "online",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
      device_type: "android",
      workspace_scope: "all",
      permissions: ["read", "send", "approve", "files"],
    }];
  },
  async revokeMobileAssociation(associationId) {
    return {
      association_id: associationId,
      subject_summary: "sub_000000000000",
      device_summary: "dev_000000000000",
      device_name: "Samsung SM-X936C",
      status: "revoked",
      access_state: "revoked",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
      device_type: "android",
      workspace_scope: "all",
      permissions: ["read", "send", "approve", "files"],
    };
  },
  async revokeMobileRuntimeEnrollment() {
    return { runtime_id: "runtime_test", status: "revoked", revoked_at: new Date().toISOString() };
  },
  async shrinkMobileAssociation(associationId, permissions) {
    shrinks += 1;
    return {
      ...(await this.listMobileAssociations())[0],
      association_id: associationId,
      permissions,
    };
  },
  async pauseMobileRemoteAccess() {
    pauses += 1;
    return { runtime_id: "runtime_test", status: "paused" };
  },
  async resumeMobileRemoteAccess() {
    resumes += 1;
    return { runtime_id: "runtime_test", status: "active" };
  },
};

const controller = new MobilePairingController(async () => client);
assert.equal((await controller.readiness()).state, "ready");
const association = (await controller.associations()).at(0);
assert.equal(association.subject_summary, "sub_000000000000");
assert.equal((await controller.revokeAssociation(association.association_id)).status, "revoked");
assert.deepEqual(
  (await controller.shrinkAssociation(association.association_id, ["read", "read"])).permissions,
  ["read"],
  "permission shrink must normalize duplicates before invoking the Runtime",
);
assert.equal(shrinks, 1);
await assert.rejects(() => controller.shrinkAssociation(association.association_id, []), /permissions are invalid/i);
await assert.rejects(() => controller.shrinkAssociation(association.association_id, ["admin"]), /permissions are invalid/i);
assert.equal((await controller.pauseAccess()).status, "paused");
assert.equal((await controller.associations()).length, 1, "pause must preserve associations");
assert.equal((await controller.resumeAccess()).status, "active");
assert.deepEqual({ pauses, resumes }, { pauses: 1, resumes: 1 });
const [first, duplicate] = await Promise.all([controller.create(), controller.create()]);
assert.equal(creates, 1, "concurrent creation must be coalesced");
assert.equal(first.grant_id, duplicate.grant_id);
assert.equal((await controller.create()).grant_id, first.grant_id, "pending grant must be reused");
assert.equal(creates, 1);
await assert.rejects(() => controller.read("ag_ffffffffffffffffffffffffffffffff"), /not active/);
assert.equal((await controller.read(first.grant_id)).status, "pending");
assert.equal((await controller.read(first.grant_id)).status, "consumed");
await assert.rejects(() => controller.read(first.grant_id), /not active/);
const second = await controller.create();
assert.equal(creates, 2);
await controller.close();
assert.equal(revokes, 1, "window close must revoke the active grant");
await controller.close();
assert.equal(revokes, 1, "close must be idempotent");
assert.throws(() => controller.create(), /closed/);

let recoveryCalls = 0;
const missingRoute = Object.assign(new Error("Not Found"), { status: 404, code: "http_404" });
const staleClient = {
  ...client,
  async getMobilePairingReadiness() { throw missingRoute; },
};
const recoveredController = new MobilePairingController(
  async () => staleClient,
  async (reason) => {
    assert.equal(reason, missingRoute);
    recoveryCalls += 1;
    return client;
  },
);
await assert.rejects(() => recoveredController.readiness(), /Not Found/,
  "passive readiness must not repair or enroll the Runtime");
assert.equal(recoveryCalls, 0, "passive readiness must not trigger recovery");
assert.equal((await recoveredController.enable()).state, "ready", "explicit enable must retry after Runtime recovery");
assert.equal(recoveryCalls, 1, "one failed operation must trigger exactly one recovery");
await recoveredController.close();

let registrationRecoveries = 0;
const unregisteredClient = {
  ...client,
  async getMobilePairingReadiness() {
    return { state: "not_registered", action: "register_runtime" };
  },
};
const registrationController = new MobilePairingController(
  async () => unregisteredClient,
  async (reason) => {
    assert.equal(reason.state, "not_registered");
    registrationRecoveries += 1;
    return client;
  },
);
assert.equal((await registrationController.readiness()).state, "not_registered",
  "passive readiness must preserve the disabled enrollment state");
assert.equal(registrationRecoveries, 0);
assert.equal((await registrationController.enable()).state, "ready",
  "explicit enable must retry after OIDC enrollment");
assert.equal(registrationRecoveries, 1);
await registrationController.close();

let releaseLateCreate;
let lateRevokes = 0;
const lateClient = {
  ...client,
  createMobilePairingGrant: () => new Promise((resolve) => { releaseLateCreate = resolve; }),
  async revokeMobilePairingGrant(grantId) { lateRevokes += 1; return { grant_id: grantId, expires_at: expiry(), status: "revoked" }; },
};
const closingController = new MobilePairingController(async () => lateClient);
const lateCreate = closingController.create();
await Promise.resolve();
const closing = closingController.close();
releaseLateCreate({ grant_id: "ag_late0000000000000000000000000000", expires_at: expiry(), status: "pending", payload: "opendrsai://associate?v=1" });
await assert.rejects(lateCreate, /closed/);
await closing;
assert.equal(lateRevokes, 1, "a grant returned after window close must be revoked immediately");

let scopeCreates = 0;
let scopeRevokes = 0;
const observedScopes = [];
const scopeClient = {
  ...client,
  async createMobilePairingGrant(scope) {
    observedScopes.push(scope);
    scopeCreates += 1;
    return { grant_id: `ag_scope${String(scopeCreates).padStart(24, "0")}`, expires_at: expiry(), status: "pending", payload: "opendrsai://associate?v=1" };
  },
  async revokeMobilePairingGrant(grantId) {
    scopeRevokes += 1;
    return { grant_id: grantId, expires_at: expiry(), status: "revoked" };
  },
};
const scopeController = new MobilePairingController(async () => scopeClient);
await scopeController.create();
await scopeController.create({ workspace_scope: "selected", workspace_ids: ["workspace-b", "workspace-a", "workspace-a"] });
assert.deepEqual(observedScopes, [
  { workspace_scope: "all", workspace_ids: [] },
  { workspace_scope: "selected", workspace_ids: ["workspace-a", "workspace-b"] },
]);
assert.equal(scopeRevokes, 1, "changing Workspace scope must revoke the previous pending grant");
assert.throws(() => scopeController.create({ workspace_scope: "selected", workspace_ids: [] }), /scope is invalid/i);
await scopeController.close();

console.log("Mobile pairing controller verification passed, including scope binding, permission shrink, and create/close race cleanup.");
