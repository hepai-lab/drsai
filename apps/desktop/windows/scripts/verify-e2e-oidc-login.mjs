import { spawn, spawnSync } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const electronCmd = process.platform === "win32"
  ? join(root, "node_modules", "electron", "dist", "electron.exe")
  : join(root, "node_modules", ".bin", "electron");
const builtMain = join(root, "out", "main", "index.js");
const port = Number(process.env.OPENDRSAI_E2E_OIDC_PORT || "18649");
const issuer = `http://127.0.0.1:${port}/backend`;
const signingKid = "e2e-oidc-rs256-1";
const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...signingKey.publicKey.export({ format: "jwk" }),
  kid: signingKid,
  alg: "RS256",
  use: "sig",
};
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E OIDC login smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath) && !existsSync(electronCmd)) {
  throw new Error("Build the unpacked Windows app or install Electron before running verify:e2e-oidc-login.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-oidc-"));
const drsaiHome = join(tempDir, "drsai-home");
const userDataDir = join(tempDir, "electron-user-data");
const resultPath = join(tempDir, "result.json");
const sessionPath = join(drsaiHome, "auth", "session.json");
mkdirSync(drsaiHome, { recursive: true });
mkdirSync(userDataDir, { recursive: true });

try {
  const fakeIssuer = await startFakeOidcIssuer();
  await runPackagedApp();
  if (!existsSync(resultPath)) {
    throw new Error("E2E OIDC login did not write a smoke result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(`E2E OIDC login failed:\n${JSON.stringify(result, null, 2)}`);
  }
  assertOidcDiagnostics(result);
  assertIssuerHits();
  assertSessionClearedByLogout();
  console.log("E2E OIDC login passed with Electron main process + fake OIDC issuer.");
  await new Promise((resolve) => fakeIssuer.close(resolve));
} finally {
  if (globalThis.__opendrsaiFakeOidcIssuer) {
    await new Promise((resolve) => globalThis.__opendrsaiFakeOidcIssuer.close(resolve));
  }
  rmSync(tempDir, { recursive: true, force: true });
}

function startFakeOidcIssuer() {
  const codes = new Map();
  let refreshCount = 0;
  const hits = {
    discovery: 0,
    jwks: 0,
    authorize: 0,
    token: 0,
    refresh: 0,
    revoke: 0,
  };
  globalThis.__opendrsaiFakeOidcHits = hits;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", issuer);
    if (url.pathname === "/backend/oauth2/authorize") {
      hits.authorize += 1;
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const nonce = url.searchParams.get("nonce");
      const codeChallenge = url.searchParams.get("code_challenge");
      const scope = url.searchParams.get("scope") || "";
      if (!redirectUri || !state || !nonce || !codeChallenge || !scope.includes("openid")) {
        writeJson(res, 400, { error: "invalid_request" });
        return;
      }
      const code = `code-${codes.size + 1}`;
      codes.set(code, { nonce, scope, codeChallenge });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", state);
      res.writeHead(302, { Location: callback.toString() });
      res.end();
      return;
    }

    if (url.pathname === "/backend/oauth2/token" && req.method === "POST") {
      hits.token += 1;
      const body = new URLSearchParams(await readBody(req));
      const grantType = body.get("grant_type");
      if (grantType === "authorization_code") {
        const code = body.get("code") || "";
        const codeRow = codes.get(code);
        if (!codeRow || !body.get("code_verifier")) {
          writeJson(res, 400, { detail: { error: "invalid_grant", error_description: "Invalid code" } });
          return;
        }
        codes.delete(code);
        writeJson(res, 200, tokenResponse(codeRow.nonce, "refresh-e2e-1"));
        return;
      }
      if (grantType === "refresh_token") {
        hits.refresh += 1;
        if (body.get("refresh_token") !== "refresh-e2e-1") {
          writeJson(res, 400, { detail: { error: "invalid_grant", error_description: "Invalid refresh token" } });
          return;
        }
        refreshCount += 1;
        writeJson(res, 200, tokenResponse(null, "refresh-e2e-1", refreshCount));
        return;
      }
      writeJson(res, 400, { error: "unsupported_grant_type" });
      return;
    }

    if (url.pathname === "/backend/.well-known/openid-configuration") {
      hits.discovery += 1;
      writeJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        revocation_endpoint: `${issuer}/oauth2/revoke`,
      });
      return;
    }

    if (url.pathname === "/backend/oauth2/revoke" && req.method === "POST") {
      hits.revoke += 1;
      writeJson(res, 200, { status: true });
      return;
    }

    if (url.pathname === "/backend/.well-known/jwks.json") {
      hits.jwks += 1;
      writeJson(res, 200, { keys: [publicJwk] });
      return;
    }

    writeJson(res, 404, { error: "not_found" });
  });

  globalThis.__opendrsaiFakeOidcIssuer = server;
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      reject(new Error(`Could not start fake OIDC issuer on ${issuer}: ${error.message}`));
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function tokenResponse(nonce, refreshToken, sequence = 0) {
  return {
    access_token: jwt({
      iss: issuer,
      sub: "e2e-hai-user",
      aud: "hai-api",
      exp: Math.floor(Date.now() / 1000) + 3600,
      roles: ["user"],
      groups: ["desktop-e2e"],
      scope: "openid email profile roles groups hai_api offline_access",
      typ: "access_token",
      sequence,
    }),
    id_token: jwt({
      iss: issuer,
      sub: "e2e-hai-user",
      aud: "opendrsai-desktop",
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: nonce || undefined,
      email: "e2e-hai-user@ihep.ac.cn",
      name: "E2E HAI User",
      picture: "/user.png",
    }),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid email profile roles groups hai_api offline_access",
  };
}

function jwt(payload) {
  const encodedHeader = base64url({ alg: "RS256", typ: "JWT", kid: signingKid });
  const encodedPayload = base64url(payload);
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(signingKey.privateKey).toString("base64url");
  return [encodedHeader, encodedPayload, signature].join(".");
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function writeJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function runPackagedApp() {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const runtime = resolveElectronRuntime();
    const child = spawn(runtime.command, runtime.args, {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: systemPath,
        DRSAI_HOME: drsaiHome,
        OPENDRSAI_OIDC_ISSUER: issuer,
        OPENDRSAI_E2E_OIDC: "1",
        OPENDRSAI_E2E_OIDC_AUTO_CALLBACK: "1",
        OPENDRSAI_E2E_OIDC_HEADLESS: "1",
        OPENDRSAI_E2E_DISABLE_GPU: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`E2E OIDC login timed out.\n${stdout}\n${stderr}`));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const result = existsSync(resultPath)
        ? `\n${readFileSync(resultPath, "utf8")}`
        : "";
      reject(new Error(`Packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function resolveElectronRuntime() {
  const usePackaged =
    existsSync(exePath) &&
    (!existsSync(builtMain) || statSync(exePath).mtimeMs >= statSync(builtMain).mtimeMs);
  if (usePackaged) {
    return { command: exePath, args: electronArgs([]) };
  }
  if (!existsSync(electronCmd)) {
    throw new Error("Current build is newer than win-unpacked, and Electron runtime is unavailable.");
  }
  return { command: electronCmd, args: electronArgs(["."]) };
}

function electronArgs(appArgs) {
  return [
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-sandbox",
    "--disable-software-rasterizer",
    "--disable-features=VizDisplayCompositor",
    "--single-process",
    ...appArgs,
  ];
}

function assertOidcDiagnostics(result) {
  const login = result?.details?.login;
  if (!login?.ok || login?.session?.authMode !== "oidc" || login?.session?.authProvider !== "hai") {
    throw new Error(`OIDC login did not return a HAI public session:\n${JSON.stringify(result, null, 2)}`);
  }
  if ("accessToken" in login.session || "refreshToken" in login.session || "idToken" in login.session) {
    throw new Error(`OIDC public session leaked raw tokens:\n${JSON.stringify(login.session, null, 2)}`);
  }
  if (!result?.checks?.restoredSession || !result?.checks?.refreshSession || !result?.checks?.afterLogoutAnonymous) {
    throw new Error(`OIDC smoke did not prove restore, refresh, and logout:\n${JSON.stringify(result?.checks, null, 2)}`);
  }
}

function assertIssuerHits() {
  const hits = globalThis.__opendrsaiFakeOidcHits;
  if (
    !hits ||
    hits.discovery < 1 ||
    hits.jwks < 1 ||
    hits.authorize !== 1 ||
    hits.token < 2 ||
    hits.refresh < 1 ||
    hits.revoke !== 1
  ) {
    throw new Error(`OIDC issuer did not receive the expected discovery/auth/token traffic:\n${JSON.stringify(hits, null, 2)}`);
  }
}

function assertSessionClearedByLogout() {
  if (existsSync(sessionPath)) {
    const content = readFileSync(sessionPath, "utf8");
    throw new Error(`OIDC logout left a session file behind:\n${content}`);
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
