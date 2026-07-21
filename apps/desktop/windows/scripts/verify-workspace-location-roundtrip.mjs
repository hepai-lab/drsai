import { migrateWorkspaceLocation } from "../../shared/api/workspaceLocation.ts";

const records = [
  { id: "local-new", location: "local", type: "local" },
  { id: "remote-new", location: "remote", transport: "ssh", type: "remote-ssh" },
  { id: "local-legacy", type: "local" },
  { id: "remote-legacy", type: "remote-ssh" },
];
const roundTripped = JSON.parse(JSON.stringify(records)).map(migrateWorkspaceLocation);

assert(roundTripped[0].location === "local" && roundTripped[0].transport === undefined, "New local location changed during persistence round trip");
assert(roundTripped[1].location === "remote" && roundTripped[1].transport === "ssh", "New remote location changed during persistence round trip");
assert(roundTripped[2].location === "local", "Legacy local workspace did not migrate");
assert(roundTripped[3].location === "remote" && roundTripped[3].transport === "ssh", "Legacy remote workspace did not migrate");

console.log("Workspace location persistence round-trip verification passed.");

function assert(value, message) {
  if (!value) throw new Error(message);
}
