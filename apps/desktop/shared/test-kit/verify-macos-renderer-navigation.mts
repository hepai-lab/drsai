import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  isAllowedDevelopmentRendererUrl,
  isAllowedRendererNavigation,
} from "../../macos/src/main/rendererNavigationPolicy";

const html = join(process.cwd(), "out", "renderer", "index.html");
assert.equal(isAllowedRendererNavigation(new URL(`file://${html}`).href, html), true);
assert.equal(isAllowedRendererNavigation(`${new URL(`file://${html}`).href}#settings`, html), true);
for (const target of [
  "https://attacker.invalid/",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "http://localhost:5173/",
]) assert.equal(isAllowedRendererNavigation(target, html), false, `production navigation must reject ${target}`);

for (const configured of ["http://localhost:5173/", "http://127.0.0.1:5173/", "http://[::1]:5173/"]) {
  assert.equal(isAllowedDevelopmentRendererUrl(configured, configured), true);
  assert.equal(isAllowedRendererNavigation(new URL("/src/main.ts", configured).href, html, configured), true);
}
assert.equal(isAllowedDevelopmentRendererUrl("https://attacker.invalid/", "https://attacker.invalid/"), false, "configured remote origins are not development renderers");
assert.equal(isAllowedDevelopmentRendererUrl("http://localhost:9999/", "http://localhost:5173/"), false, "development ports are origin-bound");
assert.equal(isAllowedDevelopmentRendererUrl("http://localhost:5173/", undefined), false);
assert.equal(isAllowedRendererNavigation("https://attacker.invalid/", html, "http://localhost:5173/"), false);

console.log("macOS renderer navigation policy passed (packaged file, loopback dev origin, remote/dev URL refusal).");
