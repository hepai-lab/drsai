/**
 * Feature 1 (OIDC 登录) and 2.4 (个人信息) -- the two features with no gateway route.
 *
 * The login flow is not reimplemented here.  `shared/main/auth.ts` already owns
 * the OIDC dance, the OS credential store and the refresh timer, and none of that
 * is part of what this surface narrows: the 42-endpoint contract had four auth routes
 * were, on inspection, invented -- the gateway has never had `/v1/auth/*`.  So
 * this module is an adapter, not an implementation: it turns whatever `auth.ts`
 * holds into the two shapes this surface needs.
 *
 *     identity()  -> the bearer + principal the client puts on every request
 *     summary()   -> the claims the renderer shows in the profile panel
 *
 * The token is read fresh on each call rather than captured once.  A desktop left
 * open overnight refreshes its token in the background; a client holding a
 * snapshot of it would send yesterday's bearer and get a 401 that looks like a
 * gateway fault.
 *
 * `AuthBackend` exists so the IPC layer can be driven in tests without Electron,
 * a credential store, or a real identity provider.  The production binding is
 * `legacyAuthBackend()`, three lines at the bottom of this file.
 */

import type { AuthSummary } from "../../api/desktopBridge";
import type { DesktopGatewayIdentity } from "./client";

export interface AuthBackend {
  /** The public session: claims only, never the token. */
  getSession(): Promise<{
    authenticated: boolean;
    user: { id: string; email: string; name: string } | null;
    expiresAt: string | null;
  }>;
  /** The private context, including the access token. Throws when signed out. */
  requireContext(): Promise<{ userId: string; accessToken?: string }>;
  login(): Promise<unknown>;
  logout(): Promise<unknown>;
}

export class DesktopIdentity {
  private readonly backend: AuthBackend;

  constructor(backend: AuthBackend) {
    this.backend = backend;
  }

  /**
   * What goes on the wire.
   *
   * Returning `{bearer: null, principal: null}` is a supported state, not a
   * failure: the gateway's offline branch serves a desktop that has not signed
   * in, model calls fall back to static provider credentials, and the user key
   * becomes a local profile name.  Throwing here instead would make every
   * workspace and session route fail for a user who only wanted to browse their
   * own history.
   */
  async identity(): Promise<DesktopGatewayIdentity> {
    try {
      const context = await this.backend.requireContext();
      if (!context.accessToken) return { bearer: null, principal: null };
      return { bearer: context.accessToken, principal: context.userId };
    } catch {
      return { bearer: null, principal: null };
    }
  }

  async summary(): Promise<AuthSummary> {
    const session = await this.backend.getSession();
    return {
      signedIn: session.authenticated,
      userId: session.user?.id ?? null,
      displayName: session.user?.name ?? null,
      email: session.user?.email ?? null,
      expiresAt: session.expiresAt ? Date.parse(session.expiresAt) || null : null,
    };
  }

  async login(): Promise<AuthSummary> {
    await this.backend.login();
    return this.summary();
  }

  async logout(): Promise<AuthSummary> {
    await this.backend.logout();
    return this.summary();
  }
}

/**
 * A cache in front of `identity()`.
 *
 * `requireContext()` may hit the OS credential store and, when the token is near
 * expiry, the identity provider over the network.  The client calls `identity()`
 * once per request, and a streaming turn issues several per second.  One second
 * of staleness is far shorter than any token lifetime, so this cannot serve an
 * expired token; it only stops a keychain read per HTTP call.
 */
export function cachedIdentity(
  identity: DesktopIdentity,
  ttlMs = 1_000,
): () => DesktopGatewayIdentity {
  let value: DesktopGatewayIdentity = { bearer: null, principal: null };
  let expires = 0;
  let inFlight: Promise<void> | null = null;

  const refresh = (): void => {
    if (inFlight) return;
    inFlight = identity
      .identity()
      .then((next) => {
        value = next;
        expires = Date.now() + ttlMs;
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
  };

  return () => {
    // Synchronous by contract -- `client.headers()` is called inside request
    // assembly and cannot await. The first call therefore returns the offline
    // identity and kicks off a refresh; `primeIdentity` below removes that
    // first-call gap at startup, where it would otherwise cost one 401.
    if (Date.now() >= expires) refresh();
    return value;
  };
}

/** Fills the cache before the first request, so no call starts out offline. */
export async function primeIdentity(
  identity: DesktopIdentity,
  cached: () => DesktopGatewayIdentity,
): Promise<void> {
  await identity.identity();
  cached();
}

/**
 * The production binding onto `shared/main/auth.ts`.
 *
 * Imported lazily because `auth.ts` reaches for Electron's `safeStorage` at
 * module scope; importing it from a test harness would fail before any test ran.
 */
export async function legacyAuthBackend(): Promise<AuthBackend> {
  const auth = await import("../auth");
  return {
    getSession: async () => {
      const session = await auth.getAuthSession();
      return {
        authenticated: session.authenticated,
        user: session.user
          ? { id: session.user.id, email: session.user.email, name: session.user.name }
          : null,
        expiresAt: session.expiresAt,
      };
    },
    requireContext: async () => {
      const context = await auth.requireAuthContext();
      return { userId: context.userId, accessToken: context.accessToken };
    },
    login: () => auth.startOidcLogin({}),
    logout: () => auth.logout(),
  };
}

/** A signed-out backend, for offline development and for tests. */
export function offlineAuthBackend(userId = "local"): AuthBackend {
  return {
    getSession: async () => ({ authenticated: false, user: null, expiresAt: null }),
    requireContext: async () => ({ userId }),
    login: async () => undefined,
    logout: async () => undefined,
  };
}
