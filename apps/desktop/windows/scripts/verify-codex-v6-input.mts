import assert from "node:assert/strict";
import { selectCurrentUserInput } from "../../shared/main/chatInput";

assert.equal(selectCurrentUserInput([
  { role: "user", content: "first" },
  { role: "assistant", content: "answer" },
  { role: "user", content: "hello" },
]), "hello", "Codex must receive only the current user input");

assert.equal(selectCurrentUserInput([
  { role: "user", content: "keep exact whitespace\n" },
]), "keep exact whitespace\n", "the selected input must not be rewritten with role prefixes");

assert.equal(selectCurrentUserInput([
  { role: "assistant", content: "fallback" },
]), "fallback", "a malformed legacy request retains a bounded compatibility fallback");

console.log("Codex V6 current-input verification passed.");
