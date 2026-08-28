import assert from "node:assert/strict";
import {
  findNearestTurnId,
  resolveTurnRailNavigationIndex,
} from "../../shared/renderer/src/conversationTurnRail";

const turns = [
  { id: "turn-1", center: 40 },
  { id: "turn-2", center: 640 },
  { id: "turn-3", center: 670 },
];

assert.equal(findNearestTurnId(turns, 30), "turn-1");
assert.equal(findNearestTurnId(turns, 645), "turn-2");
assert.equal(findNearestTurnId(turns, 669), "turn-3");
assert.equal(findNearestTurnId([], 100), null);

assert.equal(resolveTurnRailNavigationIndex(1, 3, "ArrowUp"), 0);
assert.equal(resolveTurnRailNavigationIndex(1, 3, "ArrowDown"), 2);
assert.equal(resolveTurnRailNavigationIndex(0, 3, "ArrowUp"), 0);
assert.equal(resolveTurnRailNavigationIndex(2, 3, "ArrowDown"), 2);
assert.equal(resolveTurnRailNavigationIndex(2, 3, "Home"), 0);
assert.equal(resolveTurnRailNavigationIndex(0, 3, "End"), 2);
assert.equal(resolveTurnRailNavigationIndex(0, 0, "End"), null);

console.log("Conversation turn rail model verification passed (11 checks).");
