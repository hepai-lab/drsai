import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const container = process.env.OPENDRSAI_GATEWAY_OPENAPI_CONTAINER || "opendrsai-real-remote-gateway";
const python = process.env.OPENDRSAI_GATEWAY_OPENAPI_PYTHON;
const code = "import json; from drsai.backend.gateway import app; print(json.dumps(app.openapi(), sort_keys=True))";
const result = python
  ? spawnSync(python, ["-c", code], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: resolve(root, "../../../cores/python/packages/drsai/src"),
      },
    })
  : spawnSync("docker", ["exec", container, "python3", "-c", code], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || `OpenAPI export failed (${result.status})`);
const spec = JSON.parse(result.stdout);
const output = resolve(root, "resources/remote-gateway-openapi.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(spec, null, 2) + "\n");
console.log(`Exported Remote Gateway OpenAPI ${spec.info?.version || "unknown"}.`);
