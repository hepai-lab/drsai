import assert from "node:assert/strict";
import { MobilePairingController } from "../../shared/main/mobilePairingController.ts";

let creates = 0;
let reads = 0;
let revokes = 0;
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
      status: "active",
      created_at: new Date().toISOString(),
      revoked_at: null,
    }];
  },
  async revokeMobileAssociation(associationId) {
    return {
      association_id: associationId,
      subject_summary: "sub_000000000000",
      status: "revoked",
      created_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
    };
  },
  async revokeMobileRuntimeEnrollment() {
    return { runtime_id: "runtime_test", status: "revoked", revoked_at: new Date().toISOString() };
  },
};

const controller = new MobilePairingController(async () => client);
assert.equal((await controller.readiness()).state, "ready");
const association = (await controller.associations()).at(0);
assert.equal(association.subject_summary, "sub_000000000000");
assert.equal((await controller.revokeAssociation(association.association_id)).status, "revoked");
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
assert.equal((await recoveredController.readiness()).state, "ready", "missing Runtime route must be retried after recovery");
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
assert.equal((await registrationController.readiness()).state, "ready",
  "an unregistered Runtime must be retried after OIDC enrollment");
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

console.log("Mobile pairing controller verification passed, including create/close race cleanup.");
