import type { ChatAttachment } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export interface PreviewBrowserPanelProps {
  initialUrl?: string;
  language: AppLanguage;
  onAttachContext: (attachment: ChatAttachment) => void;
  onClose: () => void;
}

export interface BrowserTab {
  id: string;
  title: string;
  srcUrl: string;
  url: string;
  draftUrl: string;
  loading: boolean;
}

export interface BrowserHistoryItem {
  url: string;
  title: string;
  visitedAt: string;
}

export interface BrowserBookmark {
  url: string;
  title: string;
  createdAt: string;
}

export interface PageSnapshot {
  title: string;
  url: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  visibleText: string;
  structure: {
    headings: string[];
    buttons: string[];
    links: string[];
    inputs: string[];
    elements: Array<{
      selector: string;
      tag: string;
      role: string;
      text: string;
      rect: { x: number; y: number; width: number; height: number };
      styles: {
        display: string;
        visibility: string;
        color: string;
        backgroundColor: string;
        fontSize: string;
      };
    }>;
  };
  resources: Array<{ name: string; type: string; duration: number }>;
}

export type BrowserActionMode =
  | "click"
  | "type"
  | "select"
  | "key_press"
  | "wait_for"
  | "assert_text";
