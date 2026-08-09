export interface WebSearchActivityPresentation {
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  input?: unknown;
  output?: unknown;
}

export function formatWebSearchActivitySummary(
  activity: WebSearchActivityPresentation,
  language: "en" | "zh",
): string {
  if (activity.status === "error") return language === "zh" ? "网络搜索失败" : "Web search failed";
  if (activity.status === "cancelled") return language === "zh" ? "网络搜索已取消" : "Web search cancelled";
  const input = parseStructuredToolPayload(activity.input);
  const query = typeof input?.query === "string" ? input.query.trim().slice(0, 120) : "";
  if (activity.status !== "completed") {
    if (!query) return language === "zh" ? "正在搜索并读取网络来源" : "Searching and reading web sources";
    return language === "zh" ? `正在搜索并读取网络来源：${query}` : `Searching and reading web sources: ${query}`;
  }
  const output = parseStructuredToolPayload(activity.output);
  const results = Array.isArray(output?.results) ? output.results.length : null;
  if (results === null) return language === "zh" ? "网络搜索已完成" : "Web search completed";
  if (results === 0) return language === "zh" ? "未找到可靠结果" : "No reliable results found";
  return language === "zh" ? `已找到 ${results} 个结果` : `Found ${results} results`;
}

function parseStructuredToolPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string" && record.content.trim().startsWith("{")) {
      return parseStructuredToolPayload(record.content);
    }
    return record;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return parseStructuredToolPayload(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}
