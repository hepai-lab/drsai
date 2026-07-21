import type { BrowserBookmark, BrowserHistoryItem, BrowserTab } from "./types";

export const DEFAULT_URL = "http://localhost:3000/";
export const STORAGE_KEY = "opendrsai.previewBrowser.state";
export const MAX_HISTORY = 80;

export function createTab(draftUrl: string, url = ""): BrowserTab {
  return { id: crypto.randomUUID(), title: draftUrl, srcUrl: url, url, draftUrl, loading: false };
}

export function loadState(): {
  tabs: BrowserTab[];
  activeTabId: string;
  history: BrowserHistoryItem[];
  bookmarks: BrowserBookmark[];
} {
  const fallbackTab = createTab(DEFAULT_URL, "");
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Partial<{
      tabs: BrowserTab[];
      activeTabId: string;
      history: BrowserHistoryItem[];
      bookmarks: BrowserBookmark[];
    }>;
    const tabs = Array.isArray(parsed.tabs) && parsed.tabs.length
      ? parsed.tabs.map((tab) => ({
          ...tab,
          draftUrl: tab.draftUrl || tab.url || DEFAULT_URL,
          title: tab.title || tab.draftUrl || tab.url || DEFAULT_URL,
          srcUrl: "",
          url: "",
          loading: false,
        }))
      : [fallbackTab];
    return {
      tabs,
      activeTabId: parsed.activeTabId && tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0].id,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    };
  } catch {
    return { tabs: [fallbackTab], activeTabId: fallbackTab.id, history: [], bookmarks: [] };
  }
}

export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") || trimmed.startsWith("[::1]") || trimmed.startsWith("::1")) return `http://${trimmed}`;
  return `https://${trimmed}`;
}
