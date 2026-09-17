/** Render a structured Artifact at the place where the answer already names it. */

export const ARTIFACT_HREF_PREFIX = "opendrsai-artifact:";

export interface InlineArtifactLink {
  id: string;
  label: string;
  title: string;
  targets: readonly string[];
  state?: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported";
}

export interface SelectedInlineArtifactLink extends InlineArtifactLink {
  match: string;
}

interface TextNode { type: "text"; value: string }
interface InlineCodeNode { type: "inlineCode"; value: string }
interface LinkNode { type: "link"; url: string; title?: string; children: unknown[] }
interface ParentNode { type: string; children?: unknown[] }

const OPAQUE = new Set(["code", "html", "image", "imageReference", "link", "linkReference", "definition"]);

function isParent(node: unknown): node is ParentNode {
  return Boolean(node) && typeof node === "object" && Array.isArray((node as ParentNode).children);
}

function isText(node: unknown): node is TextNode {
  return Boolean(node) && typeof node === "object" && (node as TextNode).type === "text" && typeof (node as TextNode).value === "string";
}

function isInlineCode(node: unknown): node is InlineCodeNode {
  return Boolean(node) && typeof node === "object" && (node as InlineCodeNode).type === "inlineCode" && typeof (node as InlineCodeNode).value === "string";
}

function normalizedTarget(value: string): string {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep the original invalid escape as a non-match. */ }
  return decoded.replace(/\\/g, "/").replace(/^\.\//, "");
}

function targetMatches(value: string, link: InlineArtifactLink): boolean {
  const normalized = normalizedTarget(value);
  return link.targets.some((target) => normalizedTarget(target) === normalized);
}

/**
 * Choose only Artifacts the answer actually names. The structured Artifact is
 * the authority; matching merely selects its presentation and never creates a
 * resource identity from arbitrary path-looking text.
 */
export function selectInlineArtifactLinks(
  markdown: string,
  links: readonly InlineArtifactLink[],
): SelectedInlineArtifactLink[] {
  return links.flatMap((link) => {
    const candidates = [link.label, ...link.targets]
      .map((candidate) => candidate.trim())
      .filter((candidate, index, values) => Boolean(candidate) && values.indexOf(candidate) === index)
      .sort((left, right) => {
        if (left === link.label) return -1;
        if (right === link.label) return 1;
        return right.length - left.length;
      });
    const match = candidates.find((candidate) => markdown.includes(candidate));
    return match ? [{ ...link, match }] : [];
  });
}

function artifactNode(link: InlineArtifactLink, label: string): LinkNode {
  return {
    type: "link",
    url: `${ARTIFACT_HREF_PREFIX}${encodeURIComponent(link.id)}`,
    title: link.title,
    children: [{ type: "text", value: label } satisfies TextNode],
  };
}

function linkExistingMarkdownLinks(node: unknown, links: readonly SelectedInlineArtifactLink[], used: Set<string>): void {
  if (!isParent(node)) return;
  for (const child of node.children as unknown[]) {
    if (child && typeof child === "object" && (child as { type?: unknown }).type === "link") {
      const linkNode = child as LinkNode;
      const match = links.find((link) => !used.has(link.id) && targetMatches(linkNode.url, link));
      if (match) {
        linkNode.url = `${ARTIFACT_HREF_PREFIX}${encodeURIComponent(match.id)}`;
        linkNode.title = match.title;
        used.add(match.id);
      }
      continue;
    }
    linkExistingMarkdownLinks(child, links, used);
  }
}

function linkNamedArtifacts(node: unknown, links: readonly SelectedInlineArtifactLink[], used: Set<string>): void {
  if (!isParent(node) || OPAQUE.has(node.type)) return;
  const children = node.children as unknown[];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const link = links.find((candidate) => !used.has(candidate.id)
      && (isInlineCode(child) ? child.value === candidate.match : isText(child) && child.value.includes(candidate.match)));
    if (link && isInlineCode(child)) {
      children.splice(index, 1, artifactNode(link, child.value));
      used.add(link.id);
      continue;
    }
    if (link && isText(child)) {
      const offset = child.value.indexOf(link.match);
      const pieces: unknown[] = [];
      if (offset > 0) pieces.push({ type: "text", value: child.value.slice(0, offset) } satisfies TextNode);
      pieces.push(artifactNode(link, link.match));
      if (offset + link.match.length < child.value.length) pieces.push({ type: "text", value: child.value.slice(offset + link.match.length) } satisfies TextNode);
      children.splice(index, 1, ...pieces);
      used.add(link.id);
      index += pieces.length - 1;
      continue;
    }
    linkNamedArtifacts(child, links, used);
  }
}

export function createArtifactLinkPlugin(
  links: readonly SelectedInlineArtifactLink[],
): (() => (tree: unknown) => void) | undefined {
  if (!links.length) return undefined;
  return () => (tree: unknown) => {
    const used = new Set<string>();
    // Honour an explicit Markdown link before considering a plain-text or
    // inline-code mention elsewhere in the answer.
    linkExistingMarkdownLinks(tree, links, used);
    linkNamedArtifacts(tree, links, used);
  };
}
