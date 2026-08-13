import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-auth-test-"));
process.env.DRSAI_HOME = root;
process.env.OPENDRSAI_AUTH_BASE_URL = "https://auth.test";
process.env.NODE_ENV = "development";
const secrets = new Map<string, string>();
const removed: string[] = [];
let sequence = 0;
const credentialService = {
  available: () => true,
  protect(secret: string) { const reference = `keychain:test-${++sequence}`; secrets.set(reference, secret); return reference; },
  unprotect(reference: string | undefined) { return reference ? secrets.get(reference) : undefined; },
  remove(reference: string | undefined) { if (!reference) return false; removed.push(reference); return secrets.delete(reference); },
};
const jwt = (label: string) => `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, label })).toString("base64url")}.sig`;
let refreshCalls = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith("/api/desktop-auth/refresh")) { refreshCalls += 1; return Response.json({ status: true, data: { user_id: "user-1", access_token: jwt("access-2"), refresh_token: "refresh-2" } }); }
  throw new Error(`Unexpected auth request: ${url}`);
}) as typeof fetch;

try {
  const auth = await import("../main/auth.ts");
  auth.configureAuthPlatform({ credentials: credentialService, openExternal: async () => undefined });
  const passwordDenied = await auth.login({ email: "user@example.test", password: "not-a-real-password", rememberMe: true });
  assert.equal(passwordDenied.ok, false);
  assert.equal(passwordDenied.session, null);
  assert.match(passwordDenied.message, /(?:no password verification service|only supports HepAI OIDC)/i);
  await assert.rejects(access(join(root, "auth", "auth.json")), /ENOENT/, "Unverified passwords must never create an authenticated session.");
  const legacyPath = join(root, "auth", "session.json");
  const sessionPath = join(root, "auth", "auth.json");
  await mkdir(join(root, "auth"), { recursive: true });
  await writeFile(legacyPath, JSON.stringify({ authenticated: true, authMode: "sso", authProvider: "ihep", sessionId: "legacy", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), accessToken: jwt("legacy"), refreshToken: "legacy-refresh", user: { id: "legacy-user", email: "legacy@example.test", role: "member" } }));
  assert.equal((await auth.getAuthSession()).authenticated, true);
  await assert.rejects(access(legacyPath), /ENOENT/, "Legacy session file must be removed after migration.");
  const migrated = await readFile(sessionPath, "utf8");
  assert.ok(migrated.includes("encryptedAccessToken") && migrated.includes("encryptedRefreshToken"));
  assert.ok(!migrated.includes("legacy-refresh") && !migrated.includes(jwt("legacy")), "Auth JSON must never contain plaintext tokens.");
  const refreshed = await auth.refreshAuthSession();
  assert.equal(refreshed.authenticated, true);
  assert.ok(refreshCalls >= 1 && refreshCalls <= 5, `Credential refresh must remain bounded during migration and identity synchronization; observed ${refreshCalls} requests.`);
  assert.ok(removed.length >= 2, "Credential rotation must remove superseded Keychain items.");
  const logout = await auth.logout();
  assert.equal(logout.ok, true); assert.equal(secrets.size, 0, "Logout must remove every Keychain item.");
  assert.equal((await auth.getAuthSession()).authenticated, false);

  auth.configureAuthPlatform({ credentials: { available: () => true, protect: () => undefined, unprotect: () => undefined }, openExternal: async () => undefined });
  await mkdir(join(root, "auth"), { recursive: true });
  await writeFile(legacyPath, JSON.stringify({ authenticated: true, authMode: "sso", sessionId: "denied", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), accessToken: jwt("denied"), refreshToken: "denied-refresh", user: { id: "denied-user", role: "member" } }));
  assert.equal((await auth.getAuthSession()).authenticated, false, "Locked credential storage must reject legacy migration.");
  await assert.rejects(access(sessionPath), /ENOENT/, "Credential-store denial must not leave plaintext session data.");
  console.log("Desktop auth session lifecycle verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
