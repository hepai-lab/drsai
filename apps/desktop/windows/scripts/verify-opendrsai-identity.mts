import assert from "node:assert/strict";
import {
  LOCAL_OPENDRSAI_AGENT_ID,
  LOCAL_OPENDRSAI_AGENT_NAME,
  type DesktopThread,
} from "../../shared/api/desktopApi";
import { validateMyDrSaiConfigUpdate } from "../../shared/main/myDrSaiConfig";
import { migrateLocalAgentDisplayName } from "../../shared/main/threads";

assert.equal(LOCAL_OPENDRSAI_AGENT_ID, "my-drsai", "the persisted local agent ID must remain stable");
assert.equal(LOCAL_OPENDRSAI_AGENT_NAME, "OpenDrSai", "the product display name must be OpenDrSai");

const legacy: DesktopThread = {
  id: "thread-identity-migration",
  kind: "chat",
  title: "Existing conversation",
  boundAgentId: LOCAL_OPENDRSAI_AGENT_ID,
  boundAgentName: "My DrSai",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};
assert.equal(migrateLocalAgentDisplayName(legacy).boundAgentName, LOCAL_OPENDRSAI_AGENT_NAME);
assert.equal(
  migrateLocalAgentDisplayName({ ...legacy, boundAgentId: "platform:my-drsai" }).boundAgentName,
  "My DrSai",
  "platform and user content must not be renamed by the local compatibility migration",
);
assert.equal(
  migrateLocalAgentDisplayName({ ...legacy, boundAgentName: "Custom local label" }).boundAgentName,
  "Custom local label",
  "custom local labels must be preserved",
);

assert.throws(
  () => validateMyDrSaiConfigUpdate({ user_id: "forged-principal" }),
  /non-writable/i,
  "Desktop configuration must never be able to write the authenticated principal",
);
assert.deepEqual(
  validateMyDrSaiConfigUpdate({ plan_mode: true, workspace_enabled: false }),
  { plan_mode: true, workspace_enabled: false },
);

process.stdout.write("OpenDrSai naming, stable-ID migration, and read-only identity contract passed.\n");
