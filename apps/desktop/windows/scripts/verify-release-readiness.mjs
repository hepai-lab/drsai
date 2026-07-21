import { spawnSync } from "node:child_process";

const strict = process.env.REQUIRE_RELEASE_READY === "1";
const requireSigned = process.env.REQUIRE_SIGNED_WINDOWS_ARTIFACTS === "1";
const skipPublicRelease = process.env.SKIP_PUBLIC_RELEASE_CHECK === "1";
const steps = [
  ["Project invariants", npmScript("verify"), true, {}],
  ["Renderer UI invariants", npmScript("verify:ui"), true, {}],
  ["Renderer mojibake guard", npmScript("verify:mojibake"), true, {}],
  ["Renderer thread context menu", npmScript("verify:thread-menu"), true, {}],
  ["Gateway fake protocol smoke", npmScript("verify:gateway-smoke"), true, {}],
  ["Renderer visual interactions", npmScript("verify:visual"), true, {}],
  ["Packaged app IPC smoke", npmScript("verify:packaged"), true, {}],
  ["Runtime updater helper", npmScript("verify:update-helper"), true, {}],
  ["Packaged runtime update protocol", npmScript("verify:e2e-update"), true, {}],
  ["Packaged app E2E chat", npmScript("verify:e2e-chat"), true, {}],
  ["Packaged app E2E chat failures", npmScript("verify:e2e-chat-failures"), true, {}],
  ["Packaged app E2E agent run", npmScript("verify:e2e-agent-run"), true, {}],
  ["Packaged app E2E agent run failures", npmScript("verify:e2e-agent-run-failures"), true, {}],
  ["Packaged app E2E threads", npmScript("verify:e2e-threads"), true, {}],
  ["Packaged app E2E OIDC login", npmScript("verify:e2e-oidc-login"), true, {}],
  ["Backend installer check-only", npmScript("verify:install-check"), true, {}],
  ["Runtime direct-update policy", npmScript("verify:update-policy"), true, {}],
  ["Runtime update manifest", npmScript("verify:update-manifest"), true, {}],
  ["Release summary", npmScript("summary:win"), true, {}],
  ["Release artifacts", npmScript("verify:artifacts"), true, {}],
  ["Remote Workspace acceptance-status regressions", npmScript("verify:remote-workspace-progress-regressions"), true, {}],
  ["Remote PTY lifecycle", npmScript("verify:remote-pty-lifecycle"), true, {}],
  ["Windows signing contract", npmScript("verify:signing-contract"), true, {}],
  ["Windows signing evidence regressions", npmScript("verify:signing-evidence-regressions"), true, {}],
  ["Windows signing evidence", npmScript("verify:signing-evidence"), requireSigned, {}, /Windows signing evidence/i],
  [
    "Windows signatures",
    npmScript("verify:signatures"),
    requireSigned,
    { REQUIRE_SIGNED_WINDOWS_ARTIFACTS: requireSigned ? "1" : "0" },
    /Windows signature verification did not pass/i,
  ],
  ["Test temporary-directory cleanup", npmScript("verify:test-temp-cleanup"), true, {}],
];

const results = [];
for (const [name, command, required, env, warningPattern] of steps) {
  results.push(runStep(name, command, required, env, warningPattern));
}

if (skipPublicRelease) {
  results.push({
    name: "Public release assets",
    status: "skipped",
    detail: "Skipped by SKIP_PUBLIC_RELEASE_CHECK=1.",
  });
} else if (process.env.OPENDRSAI_RELEASE_BASE_URL) {
  results.push(
    runStep(
      "Public release assets",
      npmScript("verify:public-release"),
      strict,
      {},
    ),
  );
} else {
  results.push({
    name: "Public release assets",
    status: strict ? "failed" : "skipped",
    detail: "Set OPENDRSAI_RELEASE_BASE_URL after publishing the GitHub Release.",
  });
}

printSummary(results);

const failed = results.filter((result) => result.status === "failed");
if (failed.length) {
  process.exit(1);
}

function runStep(name, command, required, env, warningPattern) {
  const result = spawnSync(command[0], command.slice(1), {
    env: { ...process.env, ...env },
    stdio: "pipe",
    encoding: "utf8",
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status === 0) {
    if (warningPattern?.test(output)) {
      return { name, status: "warning", detail: firstUsefulLine(output) || "Optional gate reported a warning." };
    }
    return { name, status: "passed", detail: "" };
  }
  return {
    name,
    status: required ? "failed" : "warning",
    detail: firstUsefulLine(output) || `Exit code ${result.status ?? 1}`,
  };
}

function firstUsefulLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith(">")) ?? "";
}

function printSummary(results) {
  console.log("Windows release readiness:");
  for (const result of results) {
    const marker = result.status === "passed" ? "PASS" : result.status.toUpperCase();
    console.log(`- ${marker}: ${result.name}${result.detail ? ` - ${result.detail}` : ""}`);
  }
}

function npmScript(name) {
  return process.platform === "win32"
    ? ["cmd.exe", "/d", "/s", "/c", "npm", "run", name]
    : ["npm", "run", name];
}
