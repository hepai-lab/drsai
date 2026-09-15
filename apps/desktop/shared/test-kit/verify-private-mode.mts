import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Private Mode is a per-turn composer switch whose security property is that
 * the *Gateway* — not the client — pins the Run to the private model.  That
 * property only holds if every hop of the chain keeps the contract, so this
 * verification asserts the contract at each hop instead of trusting the
 * surface to stay in sync.
 *
 * Invariants under test:
 *   1.  desktopApi.ts        - ChatRequest carries the per-turn flag.
 *   2.  chat.ts              - the flag survives normalization; while it is on
 *                              the client refuses to resolve the Agent model
 *                              policy and sends no model at all.
 *   3.  runtimeClient.ts     - the flag reaches the Gateway request body.
 *   4.  useDesktopChatAdapter - the composer option reaches ChatRequest.
 *   5.  ChatWorkspace.tsx    - the switch exists, is local-Agent only, is
 *                              cleared when the Agent changes, and is offered
 *                              both as a composer chip and in Task settings.
 *   6.  styles.css           - the chip has an active treatment.
 *   7.  _models.py           - the Gateway accepts the field (extra="forbid"
 *                              would otherwise reject it) with a false default.
 *   8.  runs.py              - the override is alias-only (provider/model_id
 *                              cleared), pins reasoning to "none", is scoped to
 *                              the OpenDrSai backend, and is applied *before*
 *                              the Session/Run input is written so the alias
 *                              actually reaches the Agent.
 */

// Resolve the checkout from the entry path the runner was given rather than
// from `import.meta.url`: the bundled runner executes a copy under a temporary
// directory, so module-relative paths would resolve outside the checkout. Both
// runners pass the entry as argv[2], so this works either way.
const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-private-mode.mts");
const testKit = dirname(entryFile);
const desktop = resolve(testKit, "..");
const repo = resolve(testKit, "..", "..", "..", "..");
const gateway = resolve(repo, "cores/python/packages/drsai/src/drsai/backend/desktop_gateway");
const config = resolve(repo, "cores/python/packages/drsai/src/drsai/config");

const read = (path: string): string => readFileSync(path, "utf8");
const flatten = (source: string): string => source.replace(/\s+/g, " ");
const count = (source: string, needle: string): number => source.split(needle).length - 1;

function check(source: string, needle: string, label: string): void {
  assert.ok(flatten(source).includes(flatten(needle)), `missing private-mode contract: ${label}`);
}

function countOf(source: string, needle: string, expected: number, label: string): void {
  assert.equal(count(flatten(source), flatten(needle)), expected, `unexpected occurrence count: ${label}`);
}

const desktopApi = read(resolve(desktop, "api/desktopApi.ts"));
const chat = read(resolve(desktop, "main/chat.ts"));
const runtimeClient = read(resolve(desktop, "main/runtimeClient.ts"));
const adapter = read(resolve(desktop, "renderer/src/adapters/useDesktopChatAdapter.ts"));
const workspace = read(resolve(desktop, "renderer/src/components/ChatWorkspace.tsx"));
const styles = read(resolve(desktop, "renderer/src/styles.css"));
const gatewayModels = read(resolve(gateway, "_models.py"));
const gatewayRuns = read(resolve(gateway, "routes/runs.py"));
const modelDefaults = read(resolve(config, "model_defaults.py"));

// 1. Contract type.
check(desktopApi, "privateMode?: boolean;", "ChatRequest.privateMode declaration");
check(
  desktopApi,
  "Per-turn Private Mode. The Gateway — not the client — pins the Run to its",
  "ChatRequest.privateMode rationale",
);

// 2. The flag survives normalization, and while on the client resolves no model.
check(
  chat,
  "privateMode: request.privateMode === true ? true : undefined,",
  "normalizeChatRequest passthrough",
);
check(chat, "const privateMode = request.privateMode === true;", "chat.ts private mode read");
check(
  chat,
  'const modelSelection = !privateMode && agentDefinition === "opendrsai@1" && client.location === "local"',
  "chat.ts skips Agent model-policy resolution in Private Mode",
);
check(
  chat,
  "...(modelSelection ? { modelSelection } : privateMode ? {} : { model: request.model }),",
  "chat.ts sends no model in Private Mode",
);
check(
  chat,
  "...(privateMode ? { private_mode: true } : {}),",
  "chat.ts marks the execution metadata as private",
);

// 3. The Gateway request body carries the per-turn flag.
check(
  runtimeClient,
  "...(provenance?.metadata?.private_mode === true ? { private_mode: true } : {}),",
  "executeAgentRun body passthrough",
);

// 4. Composer option -> ChatRequest.
check(
  adapter,
  "privateMode: options?.privateMode === true ? true : undefined,",
  "useDesktopChatAdapter ChatRequest passthrough",
);
check(
  adapter,
  "private_mode: options?.privateMode === true,",
  "useDesktopChatAdapter metadata passthrough",
);

// 5. Renderer surface.
check(workspace, "privateMode?: boolean;", "ChatSubmitOptions.privateMode declaration");
check(workspace, "const [privateMode, setPrivateMode] = useState(false);", "composer state");
check(workspace, "function togglePrivateMode(): void {", "chip toggle handler");
check(workspace, "function selectPrivateMode(enabled: boolean): void {", "Task settings handler");
countOf(workspace, "privateMode: isLocalOpenDrSaiAgent && privateMode,", 2, "both submit paths send the flag");
check(
  workspace,
  "data-testid=\"composer-private-mode\"",
  "composer chip test hook",
);
check(workspace, "composer-private-mode${privateMode ? \" active\" : \"\"}", "chip active state");
check(workspace, "data-testid=\"composer-private-mode-row\"", "Task settings row test hook");
check(workspace, "data-testid={`composer-private-mode-${state}`}", "Task settings option test hooks");
check(
  workspace,
  "disabled={!isLocalOpenDrSaiAgent || showStop}",
  "Private Mode stays local-Agent only",
);
check(
  workspace,
  "if (!agentOptions.some((agent) => agent.id === selectedAgentId && agent.source === \"local\" && agent.id !== \"my-codex\")) {",
  "stale toggle is cleared when the Agent changes",
);
countOf(workspace, "setPrivateMode(false);", 2, "Private Mode resets on Agent/conversation change");
check(
  workspace,
  "...(privateMode ? [zh ? \"私密模式\" : \"Private mode\"] : []),",
  "collapsed composer summary names Private Mode instead of the ignored model",
);

// 6. Styling.
check(styles, ".composer-private-mode {", "chip base style");
check(styles, ".composer-private-mode.active {", "chip active style");

// 7. Gateway request model: fail-closed shape must declare the field.
check(
  gatewayModels,
  "class RunExecuteRequest(BaseModel):",
  "RunExecuteRequest declaration",
);
check(
  gatewayModels,
  'model_config = ConfigDict(extra="forbid")',
  "RunExecuteRequest stays fail-closed",
);
check(gatewayModels, "private_mode: bool = False", "private_mode declaration and default");

// 8. Gateway authority: the override is alias-only, non-reasoning, backend-scoped.
check(
  gatewayRuns,
  "from drsai.config.model_defaults import PRIVATE_MODEL_NAME",
  "runs.py imports the private model alias",
);
check(
  gatewayRuns,
  'if request.private_mode and str(run.get("backend_id") or "") == "opendrsai":',
  "override is backend-scoped",
);
check(gatewayRuns, "model_provider = None", "structured provider is cleared");
check(gatewayRuns, "model_id = None", "structured model id is cleared");
check(gatewayRuns, "model_alias = PRIVATE_MODEL_NAME", "alias-only override");
check(gatewayRuns, 'requested_reasoning_effort = "none"', "reasoning is pinned off");
check(
  gatewayRuns,
  "model_override=None if model_provider and model_id else model_alias,",
  "alias path reaches the Agent as a model override",
);

// Ordering: the override must precede the Session/Run writes, otherwise the
// Client-selected alias would be persisted and handed to the Agent.
const flatRuns = flatten(gatewayRuns);
const overrideAt = flatRuns.indexOf("model_alias = PRIVATE_MODEL_NAME");
assert.ok(overrideAt > 0, "private-mode override block is missing");
assert.ok(
  overrideAt < flatRuns.indexOf("model=model_alias"),
  "private-mode override must be applied before the Session model is written",
);
assert.ok(
  overrideAt < flatRuns.indexOf("model=model_alias, reasoning_effort=requested_reasoning_effort"),
  "private-mode override must be applied before the Run input model is written",
);
assert.ok(
  flatRuns.indexOf("requested_reasoning_effort = \"none\"") <
    flatRuns.indexOf("model=model_alias, reasoning_effort=requested_reasoning_effort"),
  "pinned reasoning effort must be written, not only logged",
);

// The private model must stay a catalog alias: resolving it as a structured
// provider/model pair fails closed, which is exactly why the override above
// clears those two fields.
assert.match(modelDefaults, /^PRIVATE_MODEL_NAME = "hepai\/deepseek-flash"$/m, "PRIVATE_MODEL_NAME");
assert.ok(
  modelDefaults.includes(`"${"hepai/deepseek-flash"}": ModelEntry(`),
  "PRIVATE_MODEL_NAME must be a catalog alias entry",
);

console.log("Private Mode verification passed (client contract, renderer surface, Gateway authority).");
