import { randomBytes, createHash } from "node:crypto";

const frontendUrl = (process.env.HAI_OIDC_FRONTEND || "http://localhost:3000").replace(/\/+$/, "");
const issuer = (process.env.HAI_OIDC_ISSUER || "https://aitest.ihep.ac.cn/api").replace(/\/+$/, "");
const clientId = process.env.OPENDRSAI_OIDC_CLIENT_ID || "opendrsai-desktop";
const redirectPort = Number(process.env.OPENDRSAI_OIDC_DEV_CALLBACK_PORT || "18777");
const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;

const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`, "OIDC discovery");
assert(discovery.issuer === issuer, `discovery issuer mismatch: ${discovery.issuer}`);
assert(discovery.authorization_endpoint === `${issuer}/oauth2/authorize`, "authorization endpoint must live under /api issuer");
assert(discovery.token_endpoint === `${issuer}/oauth2/token`, "token endpoint must live under /api issuer");
assert(discovery.jwks_uri === `${issuer}/.well-known/jwks.json`, "JWKS endpoint must live under /api issuer");
assert(discovery.revocation_endpoint === `${issuer}/oauth2/revoke`, "revocation endpoint must live under /api issuer");

const jwks = await fetchJson(discovery.jwks_uri, "OIDC JWKS");
assert(Array.isArray(jwks.keys) && jwks.keys.length > 0, "JWKS must expose at least one signing key");

const frontend = await fetch(frontendUrl, { redirect: "manual" });
assert(frontend.ok, `frontend ${frontendUrl} must return 2xx; got ${frontend.status}`);

const state = `dev-env-${randomBytes(8).toString("hex")}`;
const nonce = `nonce-${randomBytes(8).toString("hex")}`;
const verifier = `${randomBytes(32).toString("base64url")}Aa0`;
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorize = new URL(discovery.authorization_endpoint);
authorize.searchParams.set("response_type", "code");
authorize.searchParams.set("client_id", clientId);
authorize.searchParams.set("redirect_uri", redirectUri);
authorize.searchParams.set("scope", "openid email profile roles groups hai_api offline_access");
authorize.searchParams.set("state", state);
authorize.searchParams.set("nonce", nonce);
authorize.searchParams.set("code_challenge", challenge);
authorize.searchParams.set("code_challenge_method", "S256");

const authorizeResponse = await fetch(authorize, { redirect: "manual" });
assert(
  authorizeResponse.status >= 300 && authorizeResponse.status < 400,
  `authorize endpoint must redirect; got ${authorizeResponse.status}`,
);
const location = authorizeResponse.headers.get("location");
assert(location, "authorize redirect must include Location");
const callback = new URL(location);
if (callback.origin === `http://127.0.0.1:${redirectPort}`) {
  assert(callback.pathname === "/callback", `authorize redirect path must be /callback; got ${callback.pathname}`);
  assert(callback.searchParams.get("state") === state, "authorize redirect must preserve state");
  assert(callback.searchParams.get("code"), "authorize redirect must include an authorization code");
} else {
  assert(callback.origin === new URL(issuer).origin, `authorize redirect must stay on issuer host before upstream login; got ${location}`);
  assert(callback.pathname.includes("/oauth2/upstream/ihep/login"), `authorize redirect must target upstream IHEP login; got ${callback.pathname}`);
  assert(callback.searchParams.get("request_id"), "upstream login redirect must include request_id");
}

console.log(
  [
    "OIDC dev environment verification passed.",
    `frontend=${frontendUrl}`,
    `issuer=${issuer}`,
    `callback=${redirectUri}`,
  ].join("\n"),
);

async function fetchJson(url, label) {
  const response = await fetch(url);
  assert(response.ok, `${label} ${url} must return 2xx; got ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
