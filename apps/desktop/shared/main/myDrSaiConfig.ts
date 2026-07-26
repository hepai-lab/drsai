import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { MyDrSaiCliConfig, MyDrSaiConfig, MyDrSaiModelConfig, UpdateMyDrSaiConfigRequest } from "../api/desktopApi";
import { requireAuthContext } from "./auth";
import { getGatewayModels, getGatewayRequestHeaders, getGatewayStatus } from "./gateway";
import { getDefaultModelAlias } from "./modelDefaults";

const WRITABLE_KEYS = ["user_id", "defult_config_name", "plan_mode", "workspace_enabled", "dangerous_allowed"] as const;
const CALIBRATION_FILE = ".drsai/tokenizer-calibration.json";

export async function getMyDrSaiConfig(workspacePath?: string): Promise<MyDrSaiConfig> {
  const gateway = await getGatewayStatus();
  if (!gateway.ready) return { ready: false, baseUrl: gateway.baseUrl, config: {}, models: [], defaultModelAlias: getDefaultModelAlias(), error: "My DrSai is not running. Start it before reading configuration." };
  const availablePromise = loadAvailableModels();
  try {
    const [cli, catalog, available] = await Promise.all([
      gatewayRequest<{ path?: string; config?: Record<string, unknown> }>(gateway.baseUrl, "GET", "/v1/config/cli"),
      gatewayRequest<{ default_alias?: string; models?: unknown }>(gateway.baseUrl, "GET", "/v1/models/config"),
      availablePromise,
    ]);
    const models = await applyCalibration(mergeModels(normalizeModels(catalog.models), available), workspacePath);
    return { ready: true, baseUrl: gateway.baseUrl, ...(typeof cli.path === "string" ? { cliPath: cli.path } : {}), config: normalizeCli(cli.config), models, defaultModelAlias: catalog.default_alias || getDefaultModelAlias() };
  } catch (error) {
    return { ready: false, baseUrl: gateway.baseUrl, config: {}, models: mergeModels([], await availablePromise), defaultModelAlias: getDefaultModelAlias(), error: safeMessage(error) };
  }
}

export async function updateMyDrSaiConfig(raw: unknown): Promise<MyDrSaiConfig> {
  const request = validateMyDrSaiConfigUpdate(raw); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("My DrSai is not running. Configuration cannot be saved.");
  for (const key of WRITABLE_KEYS) if (request[key] !== undefined) await gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/cli/${key}`, { value: request[key] });
  return getMyDrSaiConfig();
}

export function validateMyDrSaiConfigUpdate(raw: unknown): UpdateMyDrSaiConfigRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("My DrSai configuration update is invalid."); const value = raw as Record<string, unknown>; const allowed = new Set<string>(WRITABLE_KEYS);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("My DrSai configuration contains a non-writable key.");
  for (const key of ["user_id", "defult_config_name"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 200 || /[\r\n\0]/.test(value[key]))) throw new Error(`My DrSai ${key} is invalid.`);
  for (const key of ["plan_mode", "workspace_enabled", "dangerous_allowed"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`My DrSai ${key} is invalid.`);
  if (!Object.keys(value).length) throw new Error("My DrSai configuration update is empty."); return value as UpdateMyDrSaiConfigRequest;
}

async function loadAvailableModels(): Promise<Array<{ id: string; name: string }>> { try { const auth = await requireAuthContext(); return auth.accessToken ? getGatewayModels(auth.accessToken) : []; } catch { return []; } }
function normalizeCli(value: Record<string, unknown> | undefined): MyDrSaiCliConfig { return value && typeof value === "object" ? { ...value } : {}; }
function normalizeModels(value: unknown): MyDrSaiModelConfig[] { return Array.isArray(value) ? value.flatMap((item) => { if (!item || typeof item !== "object") return []; const row = item as Record<string, unknown>; if (typeof row.alias !== "string" || !row.alias.trim()) return []; return [{ alias: row.alias.slice(0, 200), ...(typeof row.display_name === "string" ? { display_name: row.display_name.slice(0, 240) } : {}), ...(typeof row.client_type === "string" ? { client_type: row.client_type.slice(0, 120) } : {}), ...(typeof row.model === "string" ? { model: row.model.slice(0, 240) } : {}), ...(typeof row.token_limit === "number" && Number.isFinite(row.token_limit) ? { token_limit: row.token_limit } : {}), ...(typeof row.max_tokens === "number" && Number.isFinite(row.max_tokens) ? { max_tokens: row.max_tokens } : {}), ...(typeof row.vision === "boolean" ? { vision: row.vision } : {}), ...(row.reasoning && typeof row.reasoning === "object" ? { reasoning: row.reasoning as MyDrSaiModelConfig["reasoning"] } : {}), ...(samples(row.tokenizer_calibration) ? { tokenizer_calibration: samples(row.tokenizer_calibration) } : {}) }]; }).slice(0, 500) : []; }
function mergeModels(configured: MyDrSaiModelConfig[], available: Array<{ id: string; name: string }>): MyDrSaiModelConfig[] { const result = [...configured]; const ids = new Set(configured.flatMap((item) => [item.alias, item.model].filter(Boolean).map((id) => String(id).toLowerCase()))); for (const item of available.slice(0, 500)) { const id = item.id?.trim(); if (!id || ids.has(id.toLowerCase())) continue; result.push({ alias: id, display_name: item.name?.trim() || id, client_type: "hepai", model: id }); ids.add(id.toLowerCase()); } return result; }
function samples(value: unknown): NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]> | undefined { if (!Array.isArray(value)) return undefined; const result = value.flatMap((item) => { if (!item || typeof item !== "object") return []; const row = item as Record<string, unknown>; return typeof row.sample === "string" && row.sample.trim() && typeof row.tokens === "number" && Number.isFinite(row.tokens) && row.tokens > 0 ? [{ sample: row.sample.slice(0, 4000), tokens: Math.floor(row.tokens) }] : []; }).slice(0, 12); return result.length ? result : undefined; }
async function applyCalibration(models: MyDrSaiModelConfig[], workspacePath?: string): Promise<MyDrSaiModelConfig[]> { const calibration = await readCalibration(workspacePath); if (!calibration.size) return models; return models.map((model) => { const extra = [model.alias, model.model, model.display_name].filter(Boolean).flatMap((id) => calibration.get(String(id).toLowerCase()) ?? []); const merged = samples([...(model.tokenizer_calibration ?? []), ...extra]); return merged ? { ...model, tokenizer_calibration: merged } : model; }); }
async function readCalibration(workspacePath?: string): Promise<Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>> { const result = new Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>(); if (!workspacePath || /[\r\n\0]/.test(workspacePath)) return result; try { const root = await realpath(resolve(workspacePath)); const file = await realpath(join(root, CALIBRATION_FILE)); const rel = relative(root, file); if (rel.startsWith("..") || isAbsolute(rel) || (await stat(file)).size > 1_048_576) return result; const parsed = JSON.parse(await readFile(file, "utf8")) as { models?: unknown }; if (!Array.isArray(parsed.models)) return result; for (const item of parsed.models.slice(0, 500)) { if (!item || typeof item !== "object") continue; const row = item as Record<string, unknown>; const normalized = samples(row.samples ?? row.tokenizer_calibration); if (!normalized) continue; for (const id of [row.alias, row.model, row.display_name]) if (typeof id === "string" && id.trim()) result.set(id.trim().toLowerCase(), normalized); } } catch { /* Missing or invalid workspace calibration is optional. */ } return result; }
async function gatewayRequest<T>(baseUrl: string, method: "GET" | "PUT", path: string, body?: unknown): Promise<T> { if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost):\d+$/.test(baseUrl)) throw new Error("My DrSai configuration endpoint must be loopback."); const payload = body === undefined ? undefined : JSON.stringify(body); const response = await fetch(new URL(path, baseUrl), { method, headers: { ...getGatewayRequestHeaders(), ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload, signal: AbortSignal.timeout(5_000) }); const text = await response.text(); if (!response.ok) throw new Error(readError(text)); if (!text) return {} as T; if (text.length > 2 * 1024 * 1024) throw new Error("My DrSai configuration response is too large."); return JSON.parse(text) as T; }
function readError(text: string): string { try { const value = JSON.parse(text) as { detail?: unknown; message?: unknown }; if (typeof value.detail === "string") return value.detail.slice(0, 1000); if (typeof value.message === "string") return value.message.slice(0, 1000); } catch { /* Use bounded generic message. */ } return "My DrSai configuration request failed."; }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000); }
