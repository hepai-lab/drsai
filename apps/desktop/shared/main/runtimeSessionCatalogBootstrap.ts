import type { LocalRuntimeClient, RuntimeSession } from "./runtimeClient";

/**
 * Load a bounded recent Runtime Session catalog after the SSE stream opens.
 * Opening the stream first closes the list/subscribe race; older Sessions are
 * reached through explicit pagination instead of delaying Desktop startup.
 */
export async function bootstrapRuntimeSessionCatalog(
  client: Pick<LocalRuntimeClient, "listSessions">,
  workspaceId: string,
  apply: (session: RuntimeSession) => Promise<void>,
  maximum = 50,
): Promise<number> {
  const pageSize = Math.max(1, Math.min(200, Math.trunc(maximum)));
  const page = await client.listSessions(workspaceId, 0, pageSize);
  let applied = 0;
  for (const session of page.data.slice(0, pageSize)) {
    await apply(session);
    applied += 1;
  }
  return applied;
}
