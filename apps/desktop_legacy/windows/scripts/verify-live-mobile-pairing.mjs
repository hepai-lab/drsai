import { app, safeStorage } from "electron";
import { readFileSync } from "node:fs";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const drsaiHome = process.env.DRSAI_HOME || join(homedir(), ".drsai");
const requestTimeout = () => AbortSignal.timeout(20_000);
if (process.env.APPDATA) {
  app.setPath("userData", join(process.env.APPDATA, "opendrsai-windows-desktop"));
}

function fail(stage, status) {
  throw new Error(`${stage}_failed${status ? `:${status}` : ""}`);
}

async function json(response, stage) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && body.detail && typeof body.detail === "object"
      ? body.detail
      : body;
    const code = detail && typeof detail === "object" && typeof detail.code === "string"
      ? detail.code
      : null;
    throw new Error(`${stage}_failed:${response.status}${code ? `:${code}` : ""}`);
  }
  return body;
}

async function run() {
try {
  if (!safeStorage.isEncryptionAvailable()) fail("safe_storage_unavailable");
  const auth = JSON.parse(readFileSync(join(drsaiHome, "auth", "auth.json"), "utf8"));
  if (auth.authMode !== "oidc" || !auth.encryptedAccessToken) fail("oidc_session_missing");
  const accessToken = safeStorage.decryptString(Buffer.from(auth.encryptedAccessToken, "base64"));
  const issuer = new URL(String(auth.issuer || ""));
  if (issuer.protocol !== "https:" || !["ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"].includes(issuer.hostname)) {
    fail("oidc_issuer_not_trusted");
  }
  const relay = `${issuer.origin}/api/runtime-relay`;
  const gatewayToken = readFileSync(join(drsaiHome, "runtime", "instance-token"), "utf8").trim();
  const localHeaders = {
    "X-OpenDrSai-Gateway-Token": gatewayToken,
    "Content-Type": "application/json",
  };
  const readiness = await json(await fetch("http://127.0.0.1:18642/v1/mobile-pairing/status", {
    headers: localHeaders,
    signal: requestTimeout(),
  }), "runtime_readiness");
  let runtimeId = typeof readiness.runtime_id === "string" ? readiness.runtime_id : "";
  if (readiness.state !== "ready") {
    const registration = await json(await fetch(`${relay}/v1/registration-codes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "error",
      signal: requestTimeout(),
    }), "registration_code");
    if (typeof registration.registration_code !== "string") fail("registration_code_invalid");
    const enrolled = await json(await fetch("http://127.0.0.1:18642/v1/mobile-pairing/register", {
      method: "POST",
      headers: localHeaders,
      body: JSON.stringify({
        registration_code: registration.registration_code,
        relay_https_url: relay,
        display_name: `OpenDrSai Desktop (${hostname().slice(0, 64) || "Windows"})`,
      }),
      signal: requestTimeout(),
    }), "runtime_registration");
    runtimeId = typeof enrolled.runtime_id === "string" ? enrolled.runtime_id : "";
  }
  if (!runtimeId) fail("runtime_id_invalid");

  const grant = await json(await fetch("http://127.0.0.1:18642/v1/mobile-pairing/grants", {
    method: "POST",
    headers: localHeaders,
    signal: requestTimeout(),
  }), "grant_create");
  if (!/^ag_[0-9a-f]{32}$/.test(String(grant.grant_id || ""))) fail("grant_id_invalid");
  const payload = new URL(String(grant.payload || ""));
  const code = payload.searchParams.get("code");
  if (payload.protocol !== "opendrsai:" || payload.hostname !== "associate" || !code) fail("grant_payload_invalid");

  const association = await json(await fetch(`${relay}/v1/associations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    redirect: "error",
    body: JSON.stringify({ request_id: randomUUID(), correlation_id: randomUUID(), code }),
    signal: requestTimeout(),
  }), "association");
  if (association.runtime_id !== runtimeId) {
    fail("association_response_invalid");
  }

  const status = await json(await fetch(
    `http://127.0.0.1:18642/v1/mobile-pairing/grants/${encodeURIComponent(grant.grant_id)}`,
    { headers: localHeaders, signal: requestTimeout() },
  ), "grant_status");
  if (status.status !== "consumed") fail("grant_not_consumed");
  process.stdout.write("Live mobile pairing verification passed (OIDC -> Runtime registration -> grant -> association).\n");
} finally {
  app.quit();
}
}

app.whenReady().then(run).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});
