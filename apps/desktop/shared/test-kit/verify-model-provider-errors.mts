/**
 * Reproduces the reported failure: a Gateway 400 "requires an API key" must
 * produce an actionable message instead of the generic
 * "OpenDrSai 未能完成操作。确认安全后重试，或查看脱敏诊断。"
 */
import {
  describeUserFacingError,
} from "../renderer/src/userFacingErrors";
import { userFacingFailureMessage } from "../renderer/src/userFacingLanguage";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`ok   ${name}`);
  else {
    failures.push(name);
    console.log(`FAIL ${name} ${detail}`);
  }
}

const GENERIC_ZH = "未能完成操作";

// The exact error the user hit, as it crosses IPC (Electron prefixes the
// original message; the Gateway detail is kept).
const gatewayError = new Error(
  "Error invoking remote method 'desktop:test-my-drsai-model-draft': " +
  "GatewayHttpError: Model provider 'deepseek' requires an API key",
);
(gatewayError as unknown as Record<string, unknown>).status = 400;

const zh = describeUserFacingError(gatewayError, "zh");
console.log("     zh.title  =", zh.title);
console.log("     zh.action =", zh.action);
check("names the provider", zh.title.includes("deepseek"), zh.title);
check("says the API key is missing", /API Key/i.test(zh.title), zh.title);
check("is not the generic copy", !zh.title.includes(GENERIC_ZH), zh.title);
check("tells the user where to fix it", /模型提供方/.test(zh.action), zh.action);
check("not retryable", zh.retryable === false);

const en = describeUserFacingError(gatewayError, "en");
console.log("     en.title  =", en.title);
check("en names the provider", en.title.includes("deepseek"), en.title);
check("en is not generic", !/did not complete the operation/i.test(en.title), en.title);

// Full user-visible string rendered by the settings panel.
const rendered = userFacingFailureMessage(gatewayError, "zh", "connection");
console.log("     rendered  =", rendered);
check("rendered message is actionable", rendered.includes("deepseek") && /API Key/i.test(rendered), rendered);
check("rendered message is not generic", !rendered.includes(GENERIC_ZH), rendered);

// The stale-credential variant.
const staleCredential = new Error(
  "Model provider 'mythirdparty' has an unavailable saved API credential; enter the API Key again",
);
const stale = describeUserFacingError(staleCredential, "zh");
console.log("     stale     =", stale.title);
check("stale credential is actionable", stale.title.includes("mythirdparty") && /API Key/i.test(stale.title), stale.title);

// Unrelated backend errors keep the previous behaviour (no raw internals leak).
const internalError = new Error("Traceback (most recent call last):\n  at run (agent.py:42)");
const internal = describeUserFacingError(internalError, "zh");
console.log("     internal  =", internal.title);
check("raw traceback is not shown", !internal.title.includes("Traceback"), internal.title);

// A non-credential gateway detail still surfaces its actionable text.
const noModels = new Error("Model 'gpt-6-astra' is not configured for provider 'mythirdparty'");
const configured = describeUserFacingError(noModels, "zh");
console.log("     config    =", configured.title);
check("config rejection surfaces detail", configured.title.includes("gpt-6-astra"), configured.title);

console.log();
if (failures.length) {
  console.log("FAILURES: " + failures.join(", "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
