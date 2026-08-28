/**
 * Rewrite the grounded answering markers into links to the source they name.
 *
 * The model is asked to write `[E1]` after each claim so the per-sentence
 * support check knows which passage a sentence rests on. That marker is
 * plumbing: a reader has no use for the number, only for the document it stands
 * for. Rewriting it in the tree rather than in the answer text keeps the raw
 * markers intact for verification while showing the reader a name they can act
 * on.
 */

export interface InlineCitationLink {
  /** Marker number as written by the model: 1 for `[E1]`. */
  marker: number;
  citationId: string;
  /** Shown inline. The file name, not the number. */
  label: string;
  /** Hover text: the full path and the position within it. */
  title: string;
}

/** Href scheme that tells the link renderer this is a citation, not a URL. */
export const CITATION_HREF_PREFIX = "citation:";

const MARKER = /\[E(\d{1,3})\]/g;

/**
 * Node types whose text must be left alone.
 *
 * Inside code a marker is content, not apparatus, and rewriting it would edit
 * what the answer is quoting. A marker already inside a link cannot become a
 * second link because markdown has no nested anchors.
 */
const OPAQUE = new Set(["code", "inlineCode", "html", "image", "imageReference", "link", "linkReference", "definition"]);

interface TextNode { type: "text"; value: string }
interface LinkNode { type: "link"; url: string; title?: string; children: TextNode[] }
interface ParentNode { type: string; children?: unknown[] }

function isParent(node: unknown): node is ParentNode {
  return Boolean(node) && typeof node === "object" && Array.isArray((node as ParentNode).children);
}

function isTextNode(node: unknown): node is TextNode {
  return Boolean(node) && typeof node === "object"
    && (node as TextNode).type === "text" && typeof (node as TextNode).value === "string";
}

/**
 * Split one text node around the markers it contains.
 *
 * A marker with no matching citation is left as written. The model invented it,
 * and quietly deleting an invented reference would hide exactly the defect the
 * support check exists to surface.
 */
function splitMarkers(node: TextNode, links: Map<number, InlineCitationLink>): Array<TextNode | LinkNode> | null {
  MARKER.lastIndex = 0;
  const pieces: Array<TextNode | LinkNode> = [];
  let cursor = 0;
  let match = MARKER.exec(node.value);
  let replaced = false;
  while (match) {
    const link = links.get(Number.parseInt(match[1] ?? "", 10));
    if (link) {
      if (match.index > cursor) pieces.push({ type: "text", value: node.value.slice(cursor, match.index) });
      pieces.push({
        type: "link",
        url: `${CITATION_HREF_PREFIX}${link.citationId}`,
        title: link.title,
        children: [{ type: "text", value: link.label }],
      });
      cursor = match.index + match[0].length;
      replaced = true;
    }
    match = MARKER.exec(node.value);
  }
  if (!replaced) return null;
  if (cursor < node.value.length) pieces.push({ type: "text", value: node.value.slice(cursor) });
  return pieces;
}

function transform(node: unknown, links: Map<number, InlineCitationLink>): void {
  if (!isParent(node) || OPAQUE.has(node.type)) return;
  const children = node.children as unknown[];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (isTextNode(child)) {
      const pieces = splitMarkers(child, links);
      if (pieces) {
        children.splice(index, 1, ...pieces);
        index += pieces.length - 1;
      }
      continue;
    }
    transform(child, links);
  }
}

/**
 * Build a remark plugin for these citations, or undefined when there is nothing
 * to link. Returning undefined lets callers leave ordinary chat untouched
 * instead of paying for a tree walk on every message.
 */
export function createCitationMarkerPlugin(
  citations: readonly InlineCitationLink[],
): (() => (tree: unknown) => void) | undefined {
  if (!citations.length) return undefined;
  const links = new Map(citations.map((citation) => [citation.marker, citation]));
  return () => (tree: unknown) => transform(tree, links);
}
