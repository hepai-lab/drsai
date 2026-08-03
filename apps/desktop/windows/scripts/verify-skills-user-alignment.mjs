/**
 * Verify skills user_id alignment: chat auth user vs OS fallback.
 * Static checks on skills.ts / gateway migration / assistant cache update.
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "..");
const skillsTs = readFileSync(join(root, "src/main/skills.ts"), "utf8");
const gatewayPy = readFileSync(
  join(root, "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"),
  "utf8",
);
const assistantPy = readFileSync(
  join(
    root,
    "../../../cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py",
  ),
  "utf8",
);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

assert(skillsTs.includes("resolveSkillsUserId"), "skills.ts resolves auth user id");
assert(skillsTs.includes("getAuthSession"), "skills.ts reads auth session");
assert(
  skillsTs.includes("session.user?.id || session.user?.email"),
  "skills.ts prefers auth user id/email",
);
assert(
  gatewayPy.includes("_migrate_legacy_os_user_skills"),
  "gateway migrates OS-username skills into auth user tree",
);
assert(
  assistantPy.includes("self._cached_skills_loader = skills_loader"),
  "update_user_skills refreshes _cached_skills_loader",
);
assert(
  assistantPy.includes("_skills_dir_changed"),
  "assistant detects nested skill file mtime changes",
);
