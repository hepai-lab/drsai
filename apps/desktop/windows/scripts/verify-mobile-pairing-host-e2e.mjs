import assert from "node:assert/strict";

import { MobilePairingController } from "../../shared/main/mobilePairingController.ts";

/**
 * Stateful, network-free acceptance surrogate for the host-level pairing flow.
 * It deliberately has no Workspace catalog: pairing must bind an Android device
 * to the Runtime host and remain usable before any Workspace exists.
 */
class HostPairingRelay {
  registered = false;
  grants = new Map();
  associations = [];
  workspaceCatalog = [];

  assertHostCall(name, args) {
    assert.equal(args.length, 0, `${name} must not accept a Workspace target`);
    assert.equal(this.workspaceCatalog.length, 0, "acceptance fixture must remain workspace-free");
  }

  async getMobilePairingReadiness(...args) {
    this.assertHostCall("readiness", args);
    return this.registered
      ? { state: "ready", action: "scan", runtime_id: "runtime_host_e2e" }
      : { state: "not_registered", action: "register_runtime" };
  }

  async createMobilePairingGrant(...args) {
    assert.equal(args.length, 1, "create grant accepts only an authorization scope");
    assert.deepEqual(args[0], { workspace_scope: "all", workspace_ids: [] });
    assert.equal("workspace_id" in args[0], false);
    assert.equal(this.workspaceCatalog.length, 0, "acceptance fixture must remain workspace-free");
    assert.equal(this.registered, true, "Runtime must be explicitly enabled first");
    const grant = {
      grant_id: "ag_00000000000000000000000000000001",
      expires_at: new Date(Date.now() + 120_000).toISOString(),
      status: "pending",
      payload: "opendrsai://associate?v=1&grant=host-only-code&runtime=runtime_host_e2e",
    };
    this.grants.set(grant.grant_id, grant);
    return { ...grant };
  }

  async getMobilePairingGrant(grantId) {
    const grant = this.grants.get(grantId);
    assert.ok(grant, "grant must exist");
    return { ...grant };
  }

  async revokeMobilePairingGrant(grantId) {
    const grant = this.grants.get(grantId);
    assert.ok(grant, "grant must exist");
    grant.status = "revoked";
    return { ...grant };
  }

  async listMobileAssociations(...args) {
    this.assertHostCall("association list", args);
    return this.associations.map((item) => ({ ...item }));
  }

  async revokeMobileAssociation(associationId) {
    const item = this.associations.find((candidate) => candidate.association_id === associationId);
    assert.ok(item, "association must exist");
    item.status = "revoked";
    item.access_state = "revoked";
    item.revoked_at = new Date().toISOString();
    return { ...item };
  }

  async revokeMobileRuntimeEnrollment() {
    this.registered = false;
    return { runtime_id: "runtime_host_e2e", status: "revoked", revoked_at: new Date().toISOString() };
  }

  async pauseMobileRemoteAccess() {
    return { runtime_id: "runtime_host_e2e", status: "paused" };
  }

  async resumeMobileRemoteAccess() {
    return { runtime_id: "runtime_host_e2e", status: "active" };
  }

  registerRuntime() {
    this.registered = true;
  }

  consumeFromAndroid(payload) {
    const uri = new URL(payload);
    assert.equal(uri.protocol, "opendrsai:");
    assert.equal(uri.hostname, "associate");
    assert.equal(uri.searchParams.get("runtime"), "runtime_host_e2e");
    assert.equal(uri.searchParams.has("workspace"), false, "QR must not bind to a Workspace");
    const grant = [...this.grants.values()].find((candidate) => candidate.status === "pending");
    assert.ok(grant, "pending one-time grant must exist");
    grant.status = "consumed";
    this.associations.push({
      association_id: "assoc_00000000000000000000000000000001",
      subject_summary: "sub_000000000001",
      device_summary: "dev_000000000001",
      device_name: "Android acceptance device",
      status: "active",
      access_state: "online",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
      device_type: "android",
      workspace_scope: "all",
      permissions: ["read", "send", "approve", "files"],
    });
  }
}

const relay = new HostPairingRelay();
const controller = new MobilePairingController(
  async () => relay,
  async (reason) => {
    assert.equal(reason.state, "not_registered");
    relay.registerRuntime();
    return relay;
  },
);

assert.equal((await controller.readiness()).state, "not_registered");
assert.equal(relay.workspaceCatalog.length, 0);
assert.equal((await controller.enable()).state, "ready");
const grant = await controller.create();
assert.ok(grant.payload, "host pairing must yield a QR payload");
relay.consumeFromAndroid(grant.payload);
assert.equal((await controller.read(grant.grant_id)).status, "consumed");
const devices = await controller.associations();
assert.equal(devices.length, 1);
assert.equal(devices[0].device_name, "Android acceptance device");
assert.equal("workspace_id" in devices[0], false, "device association must remain host-level");
await controller.close();

console.log("Host-level mobile pairing E2E passed: cold start, zero Workspace, enable, QR consume, device list.");
