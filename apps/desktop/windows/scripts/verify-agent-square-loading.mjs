import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "opendrsai-agent-catalog-"));
globalThis.__agentCatalogSubject = null;
globalThis.__agentCatalogFetches = 0;
globalThis.__agentCatalogRuntimeConnects = 0;
globalThis.__agentCatalogHome = home;
globalThis.__agentCatalogConfigFile = join(home, "config.toml");

mkdirSync(join(home, "configs", "agents"), { recursive: true });
writeFileSync(globalThis.__agentCatalogConfigFile, 'current_agent = "opendrsai"\nagent_config_file = "configs/agents/agent_opendrsai.toml"\n', "utf8");
writeFileSync(join(home, "configs", "agents", "agent_opendrsai.toml"), 'agent_name = "opendrsai"\ndisplay_name = "OpenDrSai"\nenabled = true\n', "utf8");

try {
  const output = await build({
    entryPoints: [resolve(root, "../shared/main/agents.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    plugins: [catalogDependencyStubs()],
  });
  const catalog = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

  const signedOut = await catalog.getAgentCatalogSnapshot({ preferCache: true });
  assert.deepEqual(signedOut.agents.map((agent) => agent.id), ["opendrsai"],
    "signed-out catalog must show only local OpenDrSai");
  assert.equal(signedOut.platformStatus.state, "requires_login");
  assert.equal(globalThis.__agentCatalogFetches, 0, "signed-out catalog attempted to connect to HAI");

  globalThis.__agentCatalogSubject = "subject-a";
  const startedAt = performance.now();
  const cachedFirst = await catalog.getAgentCatalogSnapshot({ preferCache: true });
  assert(performance.now() - startedAt < 200, "cache-first Agent Square snapshot exceeded the 200ms budget");
  assert.deepEqual(cachedFirst.agents.map((agent) => agent.id), ["opendrsai"],
    "cache-first catalog must reconstruct the installed local OpenDrSai without starting Runtime");
  assert.equal(cachedFirst.agents[0].status, "stopped");
  assert.equal(cachedFirst.agents[0].available, true);
  assert.equal(cachedFirst.platformStatus.state, "loading");
  assert.equal(globalThis.__agentCatalogFetches, 0, "cache-first snapshot unexpectedly waited for HAI");
  assert.equal(globalThis.__agentCatalogRuntimeConnects, 0, "opening the Agent Square started the local Runtime");

  const [firstFresh, secondFresh] = await Promise.all([
    catalog.getAgentCatalogSnapshot({ refresh: true }),
    catalog.getAgentCatalogSnapshot({ refresh: true }),
  ]);
  assert.equal(globalThis.__agentCatalogFetches, 1, "concurrent refreshes did not share one HAI request");
  assert(firstFresh.agents.some((agent) => agent.id === "platform:subject-a-agent"));
  assert(firstFresh.agents.some((agent) => agent.id === "opendrsai"));
  assert(secondFresh.agents.some((agent) => agent.id === "platform:subject-a-agent"));
  assert.equal(globalThis.__agentCatalogRuntimeConnects, 0);

  const memoryHit = await catalog.getAgentCatalogSnapshot();
  assert(memoryHit.agents.some((agent) => agent.id === "platform:subject-a-agent"));
  assert.equal(globalThis.__agentCatalogFetches, 1, "fresh in-memory catalog was not reused");

  globalThis.__agentCatalogSubject = "subject-b";
  const subjectBFirst = await catalog.getAgentCatalogSnapshot({ preferCache: true });
  assert(!subjectBFirst.agents.some((agent) => agent.id === "platform:subject-a-agent"), "subject A catalog leaked into subject B cache-first view");
  const subjectBFresh = await catalog.getAgentCatalogSnapshot({ refresh: true });
  assert(subjectBFresh.agents.some((agent) => agent.id === "platform:subject-b-agent"));
  assert.equal(globalThis.__agentCatalogFetches, 2);

  rmSync(globalThis.__agentCatalogConfigFile, { force: true });
  const recoveryCatalog = await catalog.getAgentCatalogSnapshot({ refresh: true });
  assert(recoveryCatalog.agents.some((agent) => agent.id === "opendrsai"),
    "missing local configuration must leave a recoverable OpenDrSai entry visible");

  const cacheFiles = readdirSync(join(home, "cache"));
  assert.equal(cacheFiles.length, 2, "each OIDC subject must receive a distinct cache file");
  assert(cacheFiles.every((name) => !name.includes("subject-a") && !name.includes("subject-b")), "raw OIDC subjects leaked into cache filenames");
  console.log("Agent square loading behavior passed (sub-200ms cache-first, no Runtime start, single-flight, memory reuse and A/B isolation).");
} finally {
  rmSync(home, { recursive: true, force: true });
}

function catalogDependencyStubs() {
  const stubs = new Map([
    ["./auth", `
      export async function getAuthSession(){ const id=globalThis.__agentCatalogSubject; return id ? {authenticated:true,authMode:"oidc",user:{id,email:id+"@ihep.ac.cn"}} : {authenticated:false,authMode:null,user:null}; }
      export async function requireAuthContext(){ return {authMode:"oidc",accessToken:"token",userId:globalThis.__agentCatalogSubject}; }
      export async function refreshAuthContextAfterUnauthorized(){ return {authMode:"oidc",accessToken:"token-2",userId:globalThis.__agentCatalogSubject}; }
      export function invalidateAuthSession(){}
    `],
    ["./gateway", `
      export function getGatewaySnapshot(){ return {ready:false,managed:false,externalReady:false,externalConflict:false,baseUrl:"http://127.0.0.1:14514",pid:null,lastLog:"",portOpen:false}; }
    `],
    ["./paths", `export const DRSAI_HOME=globalThis.__agentCatalogHome; export const DRSAI_CONFIG_FILE=globalThis.__agentCatalogConfigFile;`],
    ["./platformConfig", `export function getActivePlatformConfig(){ return {name:"test",portalUrl:"https://portal.ihep.ac.cn",baseUrl:"https://aiapi.ihep.ac.cn/apiv2"}; }`],
    ["./agentTelemetry", `export function recordAgentTelemetry(){}`],
    ["./runtimeClient", `export class LocalRuntimeClient { static async connect(){ globalThis.__agentCatalogRuntimeConnects += 1; throw new Error("Runtime must not start"); } }`],
    ["./platformAgentClient", `
      export async function fetchPlatformAgents(options){
        globalThis.__agentCatalogFetches += 1;
        await options.auth.getAccessToken();
        await new Promise(resolve => setTimeout(resolve, 30));
        const subject=globalThis.__agentCatalogSubject;
        const id="platform:"+subject+"-agent";
        const agent={id,name:subject+" Agent",description:"Fixture",owner:"HAI",source:"remote",status:"running",available:true,mode:"ddf",capabilities:["chat","streaming"],catalogGroup:"mine"};
        return {agents:[agent],executionDescriptors:[{publicId:id,platformId:subject+"-agent",mode:"ddf",name:agent.name,available:true,capabilities:["chat","streaming"]}],status:{state:"ready",apiVersion:"1",capabilities:["agent-catalog"],message:"ready",lastCheckedAt:new Date().toISOString()}};
      }
      export async function respondPlatformAgentInput(){ return {ok:true,message:"ok"}; }
      export async function respondDdfAgentInput(){ return {ok:true,message:"ok"}; }
      export async function stopPlatformAgentThread(){ return {ok:true,message:"ok"}; }
    `],
  ]);
  return {
    name: "agent-catalog-dependency-stubs",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\// }, (args) => {
        if (!args.importer.endsWith("agents.ts") || !stubs.has(args.path)) return null;
        return { path: args.path, namespace: "agent-catalog-stub" };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "agent-catalog-stub" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}
