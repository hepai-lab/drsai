/** Remove a source appendix when the structured source cards already render
 * the same URLs. Explanatory/non-URL footnotes remain part of the answer. */
export function stripTrailingSourceList(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^\s*(?:sources?|来源)\s*[:：]\s*$/i.test(lines[index])) continue;
    const trailing = lines.slice(index + 1).filter((line) => line.trim());
    if (trailing.length > 0 && trailing.every((line) => /^\s*(?:[-*+]\s*)?(?:\[[^\]]+\]\()?https:\/\//i.test(line))) {
      return lines.slice(0, index).join("\n").trimEnd();
    }
  }

  const firstDefinition = lines.findIndex((line) => /^\s*\[\^([^\]]+)\]:\s*https:\/\//i.test(line));
  if (firstDefinition < 0) return markdown;
  const footnoteIds: string[] = [];
  let activeDefinition = false;
  for (const line of lines.slice(firstDefinition)) {
    const definition = line.match(/^\s*\[\^([^\]]+)\]:\s*https:\/\//i);
    if (definition) { footnoteIds.push(definition[1]!); activeDefinition = true; continue; }
    if (!line.trim()) { activeDefinition = false; continue; }
    if (activeDefinition && /^\s{2,}\S/.test(line)) continue;
    return markdown;
  }
  if (!footnoteIds.length) return markdown;
  const escapedIds = footnoteIds.map(escapeRegExp).join("|");
  return lines.slice(0, firstDefinition).join("\n")
    .replace(new RegExp(`\\[\\^(?:${escapedIds})\\]`, "g"), "")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
