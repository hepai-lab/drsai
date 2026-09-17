import type { CitationPart } from "@shared/structuredConversation";
import { desktopApi } from "./desktopApi";

/**
 * Where a knowledge citation actually lives on disk.
 *
 * A citation names a document by a path relative to its Knowledge Base root,
 * which is not the workspace and is not carried on the citation itself. Without
 * the root the path cannot be opened at all, so the reader is told to trust a
 * source they have no way to reach.
 */
export interface CitationSourceTarget {
  knowledgeBaseId: string;
  /** Knowledge Base root, used as the confinement root when previewing. */
  rootPath: string;
  /** Document path relative to `rootPath`. */
  relativePath: string;
  displayName: string;
}

let rootsPromise: Promise<Map<string, { rootPath: string; displayName: string }>> | null = null;

async function loadRoots(): Promise<Map<string, { rootPath: string; displayName: string }>> {
  const roots = new Map<string, { rootPath: string; displayName: string }>();
  const bases = await desktopApi.listKnowledgeBases();
  for (const base of bases) {
    if (base.type !== "local-files") continue;
    const rootPath = typeof base.config?.root_path === "string" ? base.config.root_path.trim() : "";
    if (!rootPath) continue;
    roots.set(base.knowledge_id, { rootPath, displayName: base.display_name || base.knowledge_id });
  }
  return roots;
}

/**
 * Cached because every citation in an answer resolves against the same list and
 * a Knowledge Base root does not move mid-conversation. Failures are not cached:
 * the gateway may simply not be up yet, and caching that would leave every
 * citation permanently unopenable for the rest of the session.
 */
export function knowledgeRoots(): Promise<Map<string, { rootPath: string; displayName: string }>> {
  if (!rootsPromise) {
    rootsPromise = loadRoots().catch((cause) => {
      rootsPromise = null;
      throw cause;
    });
  }
  return rootsPromise;
}

export function forgetKnowledgeRoots(): void {
  rootsPromise = null;
}

/** Whether this citation points into a Knowledge Base rather than the open web. */
export function isKnowledgeCitation(part: CitationPart): boolean {
  return Boolean(part.knowledgeBaseId && (part.documentPath || part.path));
}

/**
 * Resolve a citation to an openable root and relative path.
 *
 * Returns undefined rather than a guess when the base is unknown or is not
 * local-files: a RAGFlow document has no path on this machine, and presenting
 * one would send the reader to a file that is not the source.
 */
export async function resolveCitationSource(part: CitationPart): Promise<CitationSourceTarget | undefined> {
  const knowledgeBaseId = part.knowledgeBaseId;
  const relativePath = part.documentPath || part.path;
  if (!knowledgeBaseId || !relativePath) return undefined;
  const base = (await knowledgeRoots()).get(knowledgeBaseId);
  if (!base) return undefined;
  return {
    knowledgeBaseId,
    rootPath: base.rootPath,
    relativePath,
    displayName: base.displayName,
  };
}
