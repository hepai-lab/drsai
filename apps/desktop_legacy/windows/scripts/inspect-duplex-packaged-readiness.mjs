import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const endpoint = process.argv.slice(2).find((value) => !value.startsWith("--")) ?? "http://127.0.0.1:9333";
const shouldBootstrap = process.argv.includes("--bootstrap");
const browser = await chromium.connectOverCDP(endpoint);
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  assert.equal(pages.length, 1, `Expected one packaged Renderer page, found ${pages.length}.`);
  const page = pages[0];
  await page.waitForLoadState("domcontentloaded");
  if (shouldBootstrap) await page.evaluate(async () => { await globalThis.openDrSai.bootstrapDesktop(); await globalThis.openDrSai.startGateway(); });
  if (shouldBootstrap) await page.waitForTimeout(5_000);
  const observed = await page.evaluate(async () => {
    const api = globalThis.openDrSai;
    if (!api?.getDuplexVoiceReadiness || !api?.getMyDrSaiAgentModelPolicy) throw new Error("Packaged preload omits Duplex readiness APIs.");
    const safeCall = async (label, call, timeoutMs = 20_000) => {
      const started = performance.now();
      let timer;
      try {
        const value = await Promise.race([
          call(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs); }),
        ]);
        return { ok: true, value, elapsedMs: Math.round(performance.now() - started) };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error).slice(0, 500), elapsedMs: Math.round(performance.now() - started) };
      } finally { clearTimeout(timer); }
    };
    const [readinessResult, policyResult, configResult, gatewayResult, healthResult, microphonePermission, devices] = await Promise.all([
      safeCall("duplex_readiness", () => api.getDuplexVoiceReadiness(), 30_000),
      safeCall("agent_model_policy", () => api.getMyDrSaiAgentModelPolicy()),
      safeCall("model_config", () => api.getMyDrSaiConfig(), 30_000),
      safeCall("gateway_status", () => api.getGatewayStatus()),
      safeCall("desktop_health", () => api.getHealth(), 30_000),
      navigator.permissions?.query ? navigator.permissions.query({ name: "microphone" }).then((value) => value.state).catch(() => "unknown") : "unknown",
      navigator.mediaDevices?.enumerateDevices ? navigator.mediaDevices.enumerateDevices().catch(() => []) : [],
    ]);
    const readiness = readinessResult.ok ? readinessResult.value : null;
    const policy = policyResult.ok ? policyResult.value : null;
    const config = configResult.ok ? configResult.value : null;
    return {
      title: document.title,
      url: location.href,
      userAgent: navigator.userAgent,
      microphonePermission,
      deviceKinds: devices.reduce((counts, device) => ({ ...counts, [device.kind]: (counts[device.kind] ?? 0) + 1 }), {}),
      callTimings: {
        duplexReadiness: { ok: readinessResult.ok, elapsedMs: readinessResult.elapsedMs, error: readinessResult.ok ? null : readinessResult.error },
        agentModelPolicy: { ok: policyResult.ok, elapsedMs: policyResult.elapsedMs, error: policyResult.ok ? null : policyResult.error },
        modelConfig: { ok: configResult.ok, elapsedMs: configResult.elapsedMs, error: configResult.ok ? null : configResult.error },
        gatewayStatus: { ok: gatewayResult.ok, elapsedMs: gatewayResult.elapsedMs, error: gatewayResult.ok ? null : gatewayResult.error },
        desktopHealth: { ok: healthResult.ok, elapsedMs: healthResult.elapsedMs, error: healthResult.ok ? null : healthResult.error },
      },
      readiness: {
        available: readiness?.available ?? false,
        reasonCode: readiness?.reasonCode ?? "readiness_call_failed",
        providerId: readiness?.providerId ?? null,
        modelId: readiness?.modelId ?? null,
        checkedAt: readiness?.checkedAt ?? null,
        message: readiness?.message ?? readinessResult.error,
      },
      modelPolicy: {
        agentId: policy?.agent_id ?? null,
        revision: policy?.revision ?? null,
        providerId: policy?.effective_realtime_voice_ref?.provider_id ?? policy?.realtime_voice_model?.ref?.provider_id ?? null,
        modelId: policy?.effective_realtime_voice_ref?.model_id ?? policy?.realtime_voice_model?.ref?.model_id ?? null,
        error: policy ? null : policyResult.error,
      },
      modelCatalog: {
        state: config?.modelCatalog?.state ?? null,
        revision: config?.modelCatalog?.revision ?? null,
        error: config?.error ?? configResult.error ?? null,
        modelCount: config?.models?.length ?? 0,
        providerCount: config?.modelProviders?.length ?? 0,
        providers: (config?.modelProviders ?? []).map((provider) => ({
          providerId: provider.name,
          hasCredential: provider.has_api_key === true,
          modelCount: provider.models?.length ?? 0,
          realtimeModelCount: (provider.models ?? []).filter((model) => /realtime/i.test(model)).length,
        })),
      },
      runtimeRealtimeModels: (config?.models ?? []).filter((model) => /realtime/i.test(model.alias)).map((model) => ({
        providerId: model.provider_id ?? null,
        modelId: model.alias,
        availability: model.availability ?? null,
        inputModalities: model.input_modalities ?? [],
        outputModalities: model.output_modalities ?? [],
        capabilitySource: model.capability_source ?? null,
      })),
      realtimeCandidates: (config?.modelProviders ?? []).flatMap((provider) => (provider.models ?? []).filter((model) => /realtime/i.test(model)).map((model) => ({ providerId: provider.name, modelId: model, hasCredential: provider.has_api_key === true, config: provider.model_configs?.[model] ? { enabled: provider.model_configs[model].enabled, inputModalities: provider.model_configs[model].input_modalities, outputModalities: provider.model_configs[model].output_modalities, apiProtocol: provider.model_configs[model].api_protocol } : null }))),
      gateway: gatewayResult.ok ? { ready: gatewayResult.value.ready, state: gatewayResult.value.state, reason: gatewayResult.value.reason, port: gatewayResult.value.port } : { ready: false, error: gatewayResult.error },
      health: healthResult.ok ? { state: healthResult.value.state, gateway: { ready: healthResult.value.gateway?.ready ?? false, managed: healthResult.value.gateway?.managed ?? false, externalReady: healthResult.value.gateway?.externalReady ?? false, externalConflict: healthResult.value.gateway?.externalConflict ?? false, portOpen: healthResult.value.gateway?.portOpen ?? false, diagnosticCode: healthResult.value.gateway?.diagnosticCode ?? null, diagnosticMessage: healthResult.value.gateway?.diagnosticMessage ?? null, livenessState: healthResult.value.gateway?.liveness?.state ?? null } } : { error: healthResult.error },
    };
  });
  const root = resolve(import.meta.dirname, "..");
  const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
  const archive = resolve(root, "release/win-unpacked/resources/app.asar");
  const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const payload = { schemaVersion: 1, kind: "packaged-readiness", generatedAt: new Date().toISOString(), artifacts: { executable: { sha256: sha256(executable) }, appAsar: { sha256: sha256(archive) } }, observed };
  const output = resolve(root, "release/duplex-voice/packaged-readiness.json");
  mkdirSync(resolve(root, "release/duplex-voice"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...payload }, null, 2));
} finally { await browser.close(); }
