import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeApprovedMcpTool, normalizeMcpToolExecutionRequest } from "../main/mcpToolExecution.ts";
import { listMcpToolExecutionAudits, recordAmbiguousMcpToolExecutionAudit } from "../main/mcpLiveBridge.ts";

const root = await mkdtemp(join(tmpdir(), "opendrsai-mcp-approval-"));
try {
  const drsai = join(root, ".drsai"); await mkdir(drsai);
  const server = join(root, "fake-mcp.mjs");
  await writeFile(server, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{for(const line of input.trim().split(/\\r?\\n/)){const m=JSON.parse(line);if(m.id===4)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:4,result:{content:[{type:'text',text:'approved:'+m.params.arguments.value}]}})+'\\n')}});`);
  await writeFile(join(drsai, "mcp-servers.json"), `${JSON.stringify({ servers: { fixture: { command: process.execPath, args: [server], cwd: "." } } }, null, 2)}\n`);
  const request = normalizeMcpToolExecutionRequest({ workspacePath: root, server: "fixture", tool: "echo", input: JSON.stringify({ value: "safe" }) });
  const result = await executeApprovedMcpTool(request, "approval:test");
  assert.equal(result.status, "completed");
  assert.match(result.outputPreview ?? "", /approved:safe/);
  const context = JSON.parse(await readFile(join(drsai, "mcp-context.json"), "utf8"));
  assert.match(context.servers.fixture.tools[0].content, /approved:safe/);
  const audit = JSON.parse(await readFile(join(drsai, "mcp-execution-audit.json"), "utf8"));
  assert.equal(audit[0].approvalId, "approval:test");
  await assert.rejects(async () => normalizeMcpToolExecutionRequest({ workspacePath: root, server: "fixture", tool: "echo", input: "[]" }), /JSON object/);
  await writeFile(join(drsai, "mcp-servers.json"), `${JSON.stringify({ servers: { fixture: { command: process.execPath, args: [server], cwd: ".." } } })}\n`);
  await assert.rejects(() => executeApprovedMcpTool(request), /inside the workspace/);
  const ambiguousRequest = { workspacePath: root, server: "fixture", tool: "external_write", input: '{"value":"may-have-run"}' };
  const ambiguous = recordAmbiguousMcpToolExecutionAudit(ambiguousRequest, "approval:mcp-crash-window"); assert.equal(ambiguous.status, "ambiguous"); assert.match(ambiguous.verification, /At-most-once recovery/);
  const duplicate = recordAmbiguousMcpToolExecutionAudit(ambiguousRequest, "approval:mcp-crash-window"); assert.equal(duplicate.id, ambiguous.id, "repeated recovery must not duplicate ambiguous audit evidence");
  const ambiguousRows = listMcpToolExecutionAudits({ workspacePath: root, limit: 20 }).filter((entry) => entry.approvalId === "approval:mcp-crash-window"); assert.equal(ambiguousRows.length, 1); assert.equal(ambiguousRows[0].status, "ambiguous"); assert.equal(ambiguousRows[0].resultContextName, undefined, "ambiguous calls must not expose a fabricated attachable result");
  console.log("Approved MCP stdio tools/call, reviewed context, audit and path-boundary verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
