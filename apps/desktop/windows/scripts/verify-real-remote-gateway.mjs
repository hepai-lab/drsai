import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const fixture = join(desktop, "tests", "remote-ssh", "fixture.ps1");
const stabilitySeconds = Math.max(0, Number(process.env.OPENDRSAI_REMOTE_STABILITY_SECONDS || 0));
const stabilityIntervalSeconds = Math.max(5, Number(process.env.OPENDRSAI_REMOTE_STABILITY_INTERVAL_SECONDS || 3600));
const stabilityEvidencePath = process.env.OPENDRSAI_REMOTE_STABILITY_EVIDENCE || join(desktop, "release", "product-evidence", "remote-workspace", "remote-stability-1h.json");
const stabilityStatePath = process.env.OPENDRSAI_REMOTE_STABILITY_STATE || join(desktop, "release", "product-evidence", "remote-workspace", "remote-stability-1h.state.json");
const stabilitySamples = [];
if (stabilitySeconds <= 0 && hasActiveStabilityRun()) {
  throw new Error("A formal Remote Workspace stability run is active. The regular real-Gateway E2E cannot reuse its container and SSH port.");
}
let cleanupStarted = false;
process.on("exit", () => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  spawnSync("docker", ["rm", "-f", "opendrsai-real-remote-gateway"], { cwd: repo, windowsHide: true });
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], { cwd: desktop, windowsHide: true });
});
process.on("SIGINT", () => process.exit(130));
run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"], desktop);
const wheelDir=join(desktop,".cache","real-wheel");mkdirSync(wheelDir,{recursive:true});
run(process.env.OPENDRSAI_TEST_PYTHON||"C:\\Python311\\python.exe",["-m","pip","wheel","--no-deps","-w",wheelDir,"cores/python/packages/drsai"],repo);
const wheel=join(wheelDir,readdirSync(wheelDir).filter(name=>name.endsWith(".whl")).sort().at(-1));
const artifactPublisher="opendrsai-temporary-acceptance";const artifactKeys=generateKeyPairSync("ed25519");const trustStore=join(desktop,".cache","temporary-real-runtime-publishers.json");writeFileSync(trustStore,JSON.stringify({[artifactPublisher]:artifactKeys.publicKey.export({type:"spki",format:"pem"})}));process.env.OPENDRSAI_RUNTIME_TRUST_STORE=trustStore;
run("docker", ["build", "-f", "apps/desktop/windows/tests/remote-ssh/Dockerfile.real", "-t", "opendrsai-real-remote-gateway:local", "."], repo);
run("docker", ["rm", "-f", "opendrsai-real-remote-gateway"], repo, true);
run("docker", ["run", "-d", "--name", "opendrsai-real-remote-gateway", "-p", "127.0.0.1:22225:22", "opendrsai-real-remote-gateway:local"], repo);
const config = join(desktop, ".cache", "real-ssh-config");
const identityFile = join(desktop, "tests", "remote-ssh", "fixture_key").replace(/\\/g, "/");
writeFileSync(config, `Host opendrsai-real\n  HostName 127.0.0.1\n  Port 22225\n  User vscode\n  IdentityFile ${identityFile}\n  IdentitiesOnly yes\n  StrictHostKeyChecking no\n  UserKnownHostsFile NUL\n  LogLevel ERROR\n`);
for (let i=0;i<30;i+=1) { const probe=spawnSync("ssh.exe",["-F",config,"-o","BatchMode=yes","opendrsai-real","true"]); if(probe.status===0) break; await new Promise(r=>setTimeout(r,1000)); if(i===29) throw new Error("real SSH fixture not ready"); }
run(process.execPath,["node_modules/esbuild/bin/esbuild","src/main/remoteWorkspace.ts","--bundle","--platform=node","--format=esm","--outfile=.cache/remoteWorkspace-real.mjs"],desktop);
process.env.OPENDRSAI_SSH_CONFIG=config;
const remote=await import(new URL("../.cache/remoteWorkspace-real.mjs",import.meta.url).href+"?t="+Date.now());
const digest=createHash("sha256").update(readFileSync(wheel)).digest("hex");
phase("install release one");
await remote.installRemoteGateway(signedArtifactRequest({hostAlias:"opendrsai-real",action:"install",version:"real-e2e-one",artifactPath:wheel,artifactSha256:digest}));
phase("install release two");
await remote.installRemoteGateway(signedArtifactRequest({hostAlias:"opendrsai-real",action:"upgrade",version:"real-e2e-two",artifactPath:wheel,artifactSha256:digest}));
phase("verify upgrade and rollback");
let release=await remote.preflightRemoteGateway("opendrsai-real");if(release.currentRelease!=="real-e2e-two"||release.previousRelease!=="real-e2e-one")throw new Error("managed upgrade state is invalid: "+JSON.stringify(release));
await remote.installRemoteGateway({hostAlias:"opendrsai-real",action:"rollback"});
release=await remote.preflightRemoteGateway("opendrsai-real");if(release.currentRelease!=="real-e2e-one"||release.previousRelease!=="real-e2e-two")throw new Error("managed rollback state is invalid: "+JSON.stringify(release));
const workspace=await remote.connectRemoteWorkspace({hostAlias:"opendrsai-real",path:"/home/vscode/workspace",trusted:true});
phase("connected first workspace");
const workspaceTwo=await remote.connectRemoteWorkspace({hostAlias:"opendrsai-real",path:"/home/vscode/workspace-two",trusted:true});
phase("connected second workspace");
if(!workspace.id.startsWith("workspace-")||!workspaceTwo.id.startsWith("workspace-")||workspace.id===workspaceTwo.id)throw new Error("Runtime did not generate authoritative workspace IDs");
const status=await remote.getRemoteWorkspaceStatus(workspace.id);
if(!status.connected||status.gatewayVersion==="fixture"||!status.capabilities?.pty) throw new Error("real Gateway handshake/capabilities failed: "+JSON.stringify(status));
const access=remote.getRemoteGatewayAccess(workspace.path);
if(!access) throw new Error("real Gateway access missing");
const runtimeBefore=await requestJson(`${access.baseUrl}/v1/runtime`,access.token);
const capabilities=await requestJson(`${access.baseUrl}/v1/capabilities`,access.token);
const registryBefore=await requestJson(`${access.baseUrl}/v1/workspaces`,access.token);
if(!runtimeBefore.runtime_id||!runtimeBefore.instance_id||capabilities.capability_versions?.["workspace-registry"]!==1)throw new Error("Runtime identity/capability handshake is incomplete");
if(!registryBefore.data?.some(row=>row.workspace_id===workspace.id)||!registryBefore.data?.some(row=>row.workspace_id===workspaceTwo.id))throw new Error("Runtime workspace registry did not persist both workspaces");
const worktree=await remote.prepareRemoteForkWorktree(workspace.path,"remote inheritance");
if(worktree.location!=="remote"||worktree.transport!=="ssh"||!worktree.workspaceId||!worktree.worktreePath.startsWith("/home/vscode/.drsai/"))throw new Error("Remote Worktree did not inherit its parent Runtime location");
const worktreeAccess=remote.getRemoteGatewayAccess(worktree.worktreePath);
if(!worktreeAccess||worktreeAccess.baseUrl!==access.baseUrl||worktreeAccess.workspaceId!==worktree.workspaceId)throw new Error("Remote Worktree did not reuse its parent SSH Runtime connection");
const worktreeFiles=await remote.listRemoteWorkspaceFiles({workspacePath:worktree.worktreePath,maxDepth:2});
if(!worktreeFiles.nodes.some(node=>node.name==="tracked.txt"))throw new Error("Remote Worktree files are not accessible through the parent Runtime");
run("docker",["exec","opendrsai-real-remote-gateway","ln","-sfn","/home/vscode/workspace","/home/vscode/workspace-link"],repo);
const relativeWorkspace=await requestJson(`${access.baseUrl}/v1/workspaces`,access.token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:"."})});
const symlinkWorkspace=await requestJson(`${access.baseUrl}/v1/workspaces`,access.token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:"/home/vscode/workspace-link"})});
if(relativeWorkspace.workspace_id!==workspace.id||symlinkWorkspace.workspace_id!==workspace.id||symlinkWorkspace.path!=="/home/vscode/workspace")throw new Error("Runtime canonical Workspace path normalization failed");
const missingWorkspace=await fetch(`${access.baseUrl}/v1/workspaces`,{method:"POST",headers:{"X-OpenDrSai-Gateway-Token":access.token,"Content-Type":"application/json"},body:JSON.stringify({path:"/home/vscode/missing"})});
if(missingWorkspace.status!==400)throw new Error("Runtime accepted a nonexistent Workspace path");
await verifyFiles(access);
phase("verified files");
await verifyStructuredErrors(access);
await verifyGit(remote,workspace.path,config);
phase("verified git");
await verifyPty(access,workspace.path);
await new Promise(resolveDelay=>setTimeout(resolveDelay,750));
const initialPtyProcessCount=Number(capture("ssh.exe",["-F",config,"opendrsai-real","runtime=$(cat /home/vscode/.local/share/opendrsai/remote/gateway.pid); ps -o comm= --ppid \"$runtime\" | grep -Ec '^(bash|sh|zsh|fish)$' || true"],desktop));
if(initialPtyProcessCount!==0)throw new Error(`real Gateway PTY kill left ${initialPtyProcessCount} child process(es)`);
phase("verified pty");
if(stabilitySeconds>0)await verifyLongStability(remote,workspace,workspaceTwo,config);
const accessTwo=remote.getRemoteGatewayAccess(workspaceTwo.path);if(!accessTwo||accessTwo.baseUrl!==access.baseUrl||accessTwo.token!==access.token||accessTwo.workspaceId===access.workspaceId)throw new Error("host-shared multi-workspace isolation failed");
const secondFiles=await remote.listRemoteWorkspaceFiles({workspacePath:workspaceTwo.path,maxDepth:2});if(!secondFiles.nodes.some(node=>node.name==="second.txt"))throw new Error("second workspace was not registered independently");
phase("install release three");
await remote.installRemoteGateway(signedArtifactRequest({hostAlias:"opendrsai-real",action:"upgrade",version:"real-e2e-three",artifactPath:wheel,artifactSha256:digest}));
phase("inject runtime restart");
run("docker",["exec","opendrsai-real-remote-gateway","sh","-lc","kill $(cat /home/vscode/.local/share/opendrsai/remote/gateway.pid)"],repo);
await waitConnected(remote,workspace.id,30000);
const accessAfterRestart=remote.getRemoteGatewayAccess(workspace.path);if(!accessAfterRestart)throw new Error("Gateway access missing after restart");
const runtimeAfter=await requestJson(`${accessAfterRestart.baseUrl}/v1/runtime`,accessAfterRestart.token);
const registryAfter=await requestJson(`${accessAfterRestart.baseUrl}/v1/workspaces`,accessAfterRestart.token);
if(runtimeAfter.runtime_id!==runtimeBefore.runtime_id||runtimeAfter.instance_id===runtimeBefore.instance_id)throw new Error("Runtime/instance identity restart semantics failed");
if(!registryAfter.data?.some(row=>row.workspace_id===workspace.id)||!registryAfter.data?.some(row=>row.workspace_id===workspaceTwo.id))throw new Error("Workspace registry did not survive Runtime restart");
run("docker",["pause","opendrsai-real-remote-gateway"],repo);await new Promise(r=>setTimeout(r,12000));run("docker",["unpause","opendrsai-real-remote-gateway"],repo);await waitConnected(remote,workspaceTwo.id,45000);
phase("verified network recovery");
await remote.disconnectRemoteWorkspace(worktree.workspaceId);
await remote.disconnectRemoteWorkspace(workspaceTwo.id);
const accessBeforeFinalClose=remote.getRemoteGatewayAccess(workspace.path);if(!accessBeforeFinalClose)throw new Error("Remaining Workspace lost its shared Runtime connection");
const registryWithClosed=await requestJson(`${accessBeforeFinalClose.baseUrl}/v1/workspaces?include_closed=true`,accessBeforeFinalClose.token);
const closedWorkspace=registryWithClosed.data?.find(row=>row.workspace_id===workspaceTwo.id);
if(!closedWorkspace||closedWorkspace.open!==false||!closedWorkspace.closed_at)throw new Error("Runtime Workspace close did not preserve historical registry state");
await remote.disconnectRemoteWorkspace(workspace.id);
await remote.stopAllRemoteWorkspaces();
if(stabilitySeconds>0){const finalTunnelCount=countDesktopTunnels(config);if(finalTunnelCount!==0)throw new Error(`long-stability cleanup left ${finalTunnelCount} SSH tunnel(s)`);writeStabilityEvidence(true,finalTunnelCount);}
console.log("Real OpenDrSai Gateway Docker E2E passed.");

async function requestJson(url,token,init={}){const response=await fetch(url,{...init,headers:{"X-OpenDrSai-Gateway-Token":token,...init.headers}});if(!response.ok)throw new Error(`Runtime request failed (${response.status}): ${url}`);return response.json();}

function run(command,args,cwd,allowFailure=false){const result=spawnSync(command,args,{cwd,stdio:"inherit",windowsHide:true});if(result.error)throw result.error;if(result.status!==0&&!allowFailure)throw new Error(`${command} failed (${result.status})`);}
function hasActiveStabilityRun(){if(!existsSync(stabilityStatePath))return false;try{const state=JSON.parse(readFileSync(stabilityStatePath,"utf8"));const pid=Number(state.pid);if(!Number.isInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}catch{return false;}}
function phase(message){console.log(`[real-gateway-e2e] ${new Date().toISOString()} ${message}`);}
function capture(command,args,cwd){const result=spawnSync(command,args,{cwd,encoding:"utf8",windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status}): ${result.stderr||result.stdout||""}`);return String(result.stdout||"").trim();}
function countDesktopTunnels(config){const escaped=config.replace(/'/g,"''");const command=`@((Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'ssh*' -and $_.CommandLine -like '*${escaped}*' -and $_.CommandLine -like '*-N*' })).Count`;return Number(capture("powershell",["-NoProfile","-Command",command],desktop));}
function writeStabilityEvidence(completed,finalTunnelCount){mkdirSync(join(stabilityEvidencePath,".."),{recursive:true});writeFileSync(stabilityEvidencePath,`${JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),temporaryCredential:true,mode:stabilitySeconds>=3600?"1h":"preflight",durationSeconds:stabilitySeconds,intervalSeconds:stabilityIntervalSeconds,completed,samples:stabilitySamples,finalTunnelCount},null,2)}\n`);}
async function verifyLongStability(remote, workspace, workspaceTwo, config) {
  const started = Date.now(); const deadline = started + stabilitySeconds * 1000;
  while (Date.now() < deadline) {
    const first = await remote.getRemoteWorkspaceStatus(workspace.id); const second = await remote.getRemoteWorkspaceStatus(workspaceTwo.id);
    if (!first.connected || !second.connected) throw new Error("long-stability Workspace connection was lost");
    const current = remote.getRemoteGatewayAccess(workspace.id); if (!current) throw new Error("long-stability Runtime access is missing");
    const runtime = await requestJson(`${current.baseUrl}/v1/runtime`, current.token); const registry = await requestJson(`${current.baseUrl}/v1/workspaces`, current.token);
    if (!registry.data?.some(row => row.workspace_id === workspace.id) || !registry.data?.some(row => row.workspace_id === workspaceTwo.id)) throw new Error("long-stability Workspace Registry drifted");
    await remote.listRemoteWorkspaceFiles({ workspacePath: workspace.path, workspaceId: workspace.id, maxDepth: 2 });
    await remote.listRemoteWorkspaceFiles({ workspacePath: workspaceTwo.path, workspaceId: workspaceTwo.id, maxDepth: 2 });
    await verifyPty(current, workspace.path); await new Promise(resolveDelay => setTimeout(resolveDelay, 750));
    const tunnelCount = countDesktopTunnels(config);
    const runtimeProcessCount = Number(capture("ssh.exe", ["-F", config, "opendrsai-real", "pgrep -u vscode -f '[d]rsai.backend.gateway' | wc -l"], desktop));
    const ptyProcessCount = Number(capture("ssh.exe", ["-F", config, "opendrsai-real", "runtime=$(cat /home/vscode/.local/share/opendrsai/remote/gateway.pid); ps -o comm= --ppid \"$runtime\" | grep -Ec '^(bash|sh|zsh|fish)$' || true"], desktop));
    if (tunnelCount !== 1 || runtimeProcessCount !== 1 || ptyProcessCount !== 0) throw new Error(`long-stability process count drift: tunnels=${tunnelCount}, runtimes=${runtimeProcessCount}, ptys=${ptyProcessCount}`);
    stabilitySamples.push({ at: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - started) / 1000), runtimeId: runtime.runtime_id, instanceId: runtime.instance_id, tunnelCount, runtimeProcessCount, ptyProcessCount });
    writeStabilityEvidence(false, null);
    const remaining = deadline - Date.now(); if (remaining > 0) await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(remaining, stabilityIntervalSeconds * 1000)));
  }
  phase(`verified ${stabilitySeconds}s long stability with ${stabilitySamples.length} samples`);
}
function signedArtifactRequest(request){const artifact=readFileSync(request.artifactPath);const sha256=createHash("sha256").update(artifact).digest("hex");const payload=Buffer.from(`opendrsai-runtime-artifact-v1\n${request.version}\n${sha256}\n`,"utf8");return {...request,artifactPublisher,artifactSignature:sign(null,payload,artifactKeys.privateKey).toString("base64")};}
async function waitConnected(remote,id,timeout){const started=Date.now();let sawDisconnected=false;while(Date.now()-started<timeout){const status=await remote.getRemoteWorkspaceStatus(id);if(!status.connected)sawDisconnected=true;if(status.connected&&sawDisconnected)return;await new Promise(r=>setTimeout(r,1000));}throw new Error("workspace did not disconnect and recover within the deadline");}
async function verifyStructuredErrors(access){const correlation="real-e2e-correlation";const response=await fetch(`${access.baseUrl}/v1/workspaces/missing/files`,{headers:{"X-OpenDrSai-Gateway-Token":access.token,"X-Correlation-ID":correlation}});const body=await response.json();if(response.status!==404||body.error?.code!=="http_404"||body.error?.correlation_id!==correlation||response.headers.get("x-correlation-id")!==correlation)throw new Error("structured Remote Gateway errors/correlation IDs failed");}
async function verifyGit(remote,workspacePath,config){run("ssh.exe",["-F",config,"opendrsai-real",`printf changed\\n > ${workspacePath}/tracked.txt`],desktop);const tree=await remote.listRemoteWorkspaceFiles({workspacePath,maxDepth:2});const file=tree.nodes.find(node=>node.name==="tracked.txt");if(file?.gitStatus!=="modified")throw new Error("file-level Git status was not returned");const diff=await remote.getRemoteWorkspaceGitDiff({workspacePath,path:`${workspacePath}/tracked.txt`});if(!diff.diff.includes("changed"))throw new Error("remote Git diff failed");await remote.executeRemoteWorkspaceMutation("stage-file",{workspacePath,path:`${workspacePath}/tracked.txt`,expectedDiffHash:diff.diffHash});const staged=await remote.getRemoteWorkspaceGitDiff({workspacePath,path:`${workspacePath}/tracked.txt`,staged:true});if(!staged.diff.includes("changed"))throw new Error("remote Git stage failed");}
async function verifyFiles(access){const headers={"X-OpenDrSai-Gateway-Token":access.token,"Content-Type":"application/json"};const base=`${access.baseUrl}/v1/workspaces/${encodeURIComponent(access.workspaceId)}`;const emptyHash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";const write=await fetch(`${base}/file`,{method:"PUT",headers,body:JSON.stringify({path:"e2e-large.txt",content_base64:Buffer.from("REMOTE_FILE_STREAM_OK").toString("base64"),expected_sha256:emptyHash})});if(!write.ok)throw new Error(`remote atomic file write failed (${write.status})`);const written=await write.json();const conflict=await fetch(`${base}/file`,{method:"PUT",headers,body:JSON.stringify({path:"e2e-large.txt",content_base64:Buffer.from("bad overwrite").toString("base64"),expected_sha256:emptyHash})});if(conflict.status!==409)throw new Error(`remote file conflict was not rejected (${conflict.status})`);const stream=await fetch(`${base}/file/stream?path=e2e-large.txt&offset=0&length=6`,{headers});if(!stream.ok||await stream.text()!=="REMOTE"||stream.headers.get("x-file-sha256")!==written.sha256)throw new Error("remote file streaming failed");const search=await fetch(`${base}/files?depth=3&query=e2e-large&max_entries=1`,{headers});const result=await search.json();if(!search.ok||result.total!==1||result.data[0]?.path!=="e2e-large.txt")throw new Error("remote paginated file search failed");await verifyFileWatch(base,headers,access.token);}
function verifyFileWatch(base,headers,token){return new Promise((resolve,reject)=>{const socket=new WebSocket(`${base.replace(/^http/,"ws")}/watch`);const timer=setTimeout(()=>{socket.close();reject(new Error("remote file watch timeout"));},10000);socket.onopen=async()=>{socket.send(JSON.stringify({type:"auth",token}));await new Promise(r=>setTimeout(r,1200));await fetch(`${base}/file`,{method:"PUT",headers,body:JSON.stringify({path:"e2e-watch.txt",content_base64:Buffer.from("watch").toString("base64")})});};socket.onmessage=(event)=>{const message=JSON.parse(String(event.data));if(message.type==="changes"&&message.changes.some(change=>change.path==="e2e-watch.txt")){clearTimeout(timer);socket.close();resolve();}};socket.onerror=()=>{clearTimeout(timer);reject(new Error("remote file watch socket failed"));};});}
function verifyPty(access,cwd){return new Promise((resolve,reject)=>{const url=`${access.baseUrl.replace(/^http/,"ws")}/v1/pty`;let id;let reconnected=false;let killSent=false;let socket=new WebSocket(url);const timer=setTimeout(()=>{socket.close();reject(new Error("real Gateway PTY reconnect timeout"));},20000);const attach=(next)=>{socket=next;socket.onopen=()=>{socket.send(JSON.stringify({type:"auth",token:access.token}));socket.send(JSON.stringify({type:"attach",id}));};socket.onmessage=(event)=>{const message=JSON.parse(String(event.data));if(message.type==="attached"){if(!String(message.buffer).includes("REAL_PTY_OK"))return reject(new Error("PTY reconnect did not replay its buffer"));socket.send(JSON.stringify({type:"write",id,data:"printf REAL_PTY_REATTACHED\\n"}));}if(!killSent&&message.type==="data"&&String(message.data).includes("REAL_PTY_REATTACHED")){killSent=true;socket.send(JSON.stringify({type:"kill",id}));}if(message.type==="killed"&&message.id===id){clearTimeout(timer);socket.close();resolve();}};socket.onerror=()=>{clearTimeout(timer);reject(new Error("real Gateway PTY reconnect socket failed"));};};socket.onopen=()=>{socket.send(JSON.stringify({type:"auth",token:access.token}));socket.send(JSON.stringify({type:"create",workspaceId:access.workspaceId,cwd,cols:80,rows:24}));};socket.onmessage=(event)=>{const message=JSON.parse(String(event.data));if(message.type==="created"){id=message.id;socket.send(JSON.stringify({type:"write",id,data:"printf REAL_PTY_OK\\n"}));}if(!reconnected&&message.type==="data"&&String(message.data).includes("REAL_PTY_OK")){reconnected=true;socket.onclose=()=>attach(new WebSocket(url));socket.close();}};socket.onerror=()=>{clearTimeout(timer);reject(new Error("real Gateway PTY socket failed"));};});}
