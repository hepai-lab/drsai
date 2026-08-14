import type { AuthContext } from "./auth";

type AuthContextProvider = () => Promise<AuthContext>;
type GatewayIdentitySynchronizer = (explicitUserId?: string) => Promise<string | null>;

let authContextProvider: AuthContextProvider | null = null;
let gatewayIdentitySynchronizer: GatewayIdentitySynchronizer | null = null;

/**
 * Break the auth <-> gateway module cycle without hiding it behind dynamic
 * imports. Each side registers its capability after module initialization;
 * callers retain the previous offline-safe fallback semantics.
 */
export function registerAuthContextProvider(provider: AuthContextProvider): void {
  authContextProvider = provider;
}

export function registerGatewayIdentitySynchronizer(synchronizer: GatewayIdentitySynchronizer): void {
  gatewayIdentitySynchronizer = synchronizer;
}

export async function requireCoordinatedAuthContext(): Promise<AuthContext> {
  if (!authContextProvider) throw new Error("Desktop auth context provider is not initialized.");
  return authContextProvider();
}

export async function syncCoordinatedGatewayIdentity(explicitUserId?: string): Promise<string | null> {
  if (!gatewayIdentitySynchronizer) return null;
  return gatewayIdentitySynchronizer(explicitUserId);
}
