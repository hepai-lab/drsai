export const ACCEPTANCE_LEVELS = Object.freeze(["smoke", "regression", "release"]);

const scenarios = [
  ["architecture", "Codex architecture boundaries", "smoke", "verify:codex-dependency-boundaries", true],
  ["desktop-integration", "Codex Desktop integration", "smoke", "verify:codex-desktop-integration", true],
  ["workspace-domain", "Workspace domain and existing-folder registration", "smoke", "verify:workspace-domain", true],
  ["structured-conversation", "Structured streaming conversation", "smoke", "verify:structured-integration", true],
  ["thread-binding", "Multi-turn thread execution binding", "regression", "verify:thread-execution-binding", true],
  ["workspace-routing", "Workspace identity routing", "regression", "verify:workspace-id-routing", true],
  ["runtime-recovery", "Runtime restart recovery", "regression", "verify:runtime-recovery-real", true],
  ["network-recovery", "Network interruption recovery", "regression", "verify:network-recovery", true],
  ["remote-ssh-contract", "Remote SSH and OWOP contract", "regression", "verify:remote-ssh-contract", true],
  ["orca-release", "ORCA-inspired release contract", "release", "verify:orca-inspired-release", true],
  ["packaged-runtime", "Packaged Runtime acceptance", "release", "verify:orca-packaged-runtime", true],
  ["sandbox-host-codex", "Sandbox to host Codex bridge, including live multi-turn Thread reuse", "release", null, true],
];

const rank = { smoke: 0, regression: 1, release: 2 };

export function listAcceptanceScenarios(level = "smoke") {
  if (!ACCEPTANCE_LEVELS.includes(level)) throw new Error(`Unknown acceptance level: ${level}`);
  return scenarios
    .filter(([, , minimum]) => rank[minimum] <= rank[level])
    .map(([id, title, minimumLevel, command, required]) => ({ id, title, minimumLevel, command, required }));
}
