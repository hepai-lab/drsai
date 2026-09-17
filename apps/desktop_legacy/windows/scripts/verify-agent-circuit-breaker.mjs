import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(resolve(root, "../shared/main/agentCircuitBreaker.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const circuit = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

circuit.resetAgentCircuitsForTest();
circuit.assertAgentCircuitAvailable("platform:test", 1000);
circuit.recordAgentCircuitFailure("platform:test", 1000);
circuit.recordAgentCircuitFailure("platform:test", 2000);
circuit.assertAgentCircuitAvailable("platform:test", 2500);
circuit.recordAgentCircuitFailure("platform:test", 3000);
assert.throws(() => circuit.assertAgentCircuitAvailable("platform:test", 4000), /temporarily unavailable/);
circuit.assertAgentCircuitAvailable("platform:test", 34_000);
circuit.recordAgentCircuitFailure("platform:test", 35_000);
circuit.recordAgentCircuitSuccess("platform:test");
circuit.assertAgentCircuitAvailable("platform:test", 36_000);

console.log("Agent execution circuit breaker verification passed (threshold, open interval, half-open reset, success reset).");
