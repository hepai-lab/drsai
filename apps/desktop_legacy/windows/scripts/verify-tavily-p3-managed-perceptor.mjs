import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const client = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/hai_tavily.py");
const router = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/tool.py");
const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const main = read("apps/desktop/shared/main/myDrSaiConfig.ts");
const api = read("apps/desktop/shared/api/desktopApi.ts");
const settings = read("apps/desktop/shared/renderer/src/components/PerceptorSettingsPanel.tsx");
const interaction = read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx");
const policy = read("cores/python/packages/drsai/src/drsai/backend/runtime/web_search/provider_policy.py");
const liveAcceptance = read("apps/desktop/windows/scripts/verify-live-tavily-p3.ps1");

const checks = [
  [client, 'DEFAULT_WORKER_MODEL = "hepai/tavily-web-search-v1"', "frozen managed model"],
  [client, 'frozenset({"search", "extract"})', "function allowlist"],
  [client, '/tools/web-search/{function}', "DDF web-search facade"],
  [client, '"Idempotency-Key"', "DDF idempotency"],
  [client, '"model": self.config.model, "arguments": dict(arguments)', "safe DDF request envelope"],
  [client, '"api_key", "base_url", "worker_url", "project_id"', "client route and credential rejection"],
  [router, 'provider_config.get("adapter") == MANAGED_TAVILY_ADAPTER', "provider-neutral tool routing"],
  [gateway, '"credential_source": "platform_session"', "dynamic managed resource"],
  [gateway, '_managed_tavily_public_resource_with_status', "authoritative capability discovery"],
  [gateway, 'trace.capability.discovery_failed', "pre-disclosure discovery failure evidence"],
  [gateway, 'trace.capability.prefetch_failed', "provider failure Inspector evidence"],
  [gateway, '"request_id": request_id_value[:160] or None', "DDF request correlation evidence"],
  [main, '"/v1/config/perceptors", undefined, await oidcGatewayHeaders()', "OIDC perceptor discovery"],
  [api, '"hai_managed_tavily"', "Desktop managed adapter DTO"],
  [settings, '平台托管凭据，不保存到本机', "managed credential UX"],
  [settings, 'managedStatusLabel', "managed failure states"],
  [interaction, 'data-testid="capability-sign-in-and-continue"', "login and resume"],
  [interaction, 'data-testid="capability-use-byok"', "BYOK retained"],
  [interaction, 'capabilityAction: "answer_without_network"', "explicit no-network path"],
  [policy, 'Literal["auto", "managed", "byok", "none"]', "frozen provider modes"],
  [policy, 'if platform_authenticated:', "managed-first auto policy"],
  [gateway, 'read_provider_mode(config_dir)', "runtime provider-policy resolution"],
  [main, 'updateWebSearchProviderPolicy', "provider-policy IPC client"],
  [settings, 'data-testid="web-search-provider-policy"', "provider selector UI"],
  [liveAcceptance, '[Parameter(Mandatory = $true)][string]$AccessTokenFile', "live acceptance token input"],
  [liveAcceptance, '-and -not $AllowBillableTests', "explicit billable-test consent"],
  [liveAcceptance, 'include_raw_content = $false', "low-cost privacy-safe live search"],
  [liveAcceptance, 'unique_request_ids', "20-run trace identity evidence"],
];

for (const [source, needle, label] of checks) {
  if (!source.includes(needle)) throw new Error(`Missing Tavily P3 contract: ${label}`);
}
if (client.includes("worker/unified_gate")) throw new Error("Desktop must call the DDF web-search facade, not unified_gate directly");
if (/TAVILY_API_KEY|tvly-[A-Za-z0-9]/.test(client + gateway + main + settings)) throw new Error("Managed Tavily secret leaked into Desktop/Core source");
if (/Write-(Host|Output).*token|access_token\s*=/.test(liveAcceptance)) throw new Error("Live acceptance script may expose its OIDC token");
console.log(`Tavily P3 managed Perceptor verification passed (${checks.length} contracts).`);
