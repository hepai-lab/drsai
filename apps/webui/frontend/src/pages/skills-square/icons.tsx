import {
  BookOpen,
  Bot,
  Camera,
  Code,
  Database,
  FileText,
  Globe,
  Image,
  MessageSquare,
  Music,
  Package,
  Palette,
  Search,
  Settings,
  Shield,
  Sparkles,
  Video,
  Wrench,
  Zap,
} from "lucide-react";
import React from "react";

export const SKILL_ICON_OPTIONS: {
  value: string;
  label: string;
  Icon: React.ElementType;
}[] = [
  { value: "package", label: "Package", Icon: Package },
  { value: "wrench", label: "Wrench", Icon: Wrench },
  { value: "code", label: "Code", Icon: Code },
  { value: "sparkles", label: "Sparkles", Icon: Sparkles },
  { value: "bot", label: "Agent", Icon: Bot },
  { value: "file-text", label: "Document", Icon: FileText },
  { value: "search", label: "Search", Icon: Search },
  { value: "database", label: "Database", Icon: Database },
  { value: "globe", label: "Globe", Icon: Globe },
  { value: "palette", label: "Palette", Icon: Palette },
  { value: "camera", label: "Camera", Icon: Camera },
  { value: "music", label: "Music", Icon: Music },
  { value: "video", label: "Video", Icon: Video },
  { value: "book-open", label: "Book", Icon: BookOpen },
  { value: "message-square", label: "Chat", Icon: MessageSquare },
  { value: "settings", label: "Settings", Icon: Settings },
  { value: "shield", label: "Shield", Icon: Shield },
  { value: "zap", label: "Zap", Icon: Zap },
];

export const ICON_LABEL_KEY_MAP: Record<string, string> = {
  package: "skillSquare.iconPackage",
  wrench: "skillSquare.iconWrench",
  code: "skillSquare.iconCode",
  sparkles: "skillSquare.iconSparkles",
  bot: "skillSquare.iconBot",
  "file-text": "skillSquare.iconFileText",
  search: "skillSquare.iconSearch",
  database: "skillSquare.iconDatabase",
  globe: "skillSquare.iconGlobe",
  palette: "skillSquare.iconPalette",
  camera: "skillSquare.iconCamera",
  music: "skillSquare.iconMusic",
  video: "skillSquare.iconVideo",
  "book-open": "skillSquare.iconBookOpen",
  "message-square": "skillSquare.iconMessageSquare",
  settings: "skillSquare.iconSettings",
  shield: "skillSquare.iconShield",
  zap: "skillSquare.iconZap",
};

/** Resolve icon to a React node: URL → <img>, "__profile__" → Image, otherwise → Lucide icon component. */
export function renderSkillIcon(
  icon: string | undefined,
  sizeClass: string,
  iconSize: string,
) {
  if (icon && /^https?:\/\//.test(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className={`${sizeClass} rounded-[5.4px] object-cover shrink-0`}
      />
    );
  }
  if (icon === "__profile__") {
    return (
      <div
        className={`${sizeClass} shrink-0 flex items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.08] text-accent dark:border-accent/20 dark:bg-accent/[0.12]`}
      >
        <Image className={iconSize} strokeWidth={2} aria-hidden />
      </div>
    );
  }
  if (icon && /[^\x00-\x7F]/.test(icon) && icon.length <= 8) {
    return (
      <div
        className={`${sizeClass} shrink-0 flex items-center justify-center rounded-xl bg-accent/10 text-lg leading-none dark:bg-accent/16`}
      >
        {icon}
      </div>
    );
  }
  const IconComponent =
    SKILL_ICON_OPTIONS.find((o) => o.value === icon)?.Icon ?? Package;
  return (
    <div
      className={`${sizeClass} shrink-0 flex items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.08] text-accent dark:border-accent/20 dark:bg-accent/[0.12]`}
    >
      <IconComponent className={iconSize} strokeWidth={2} aria-hidden />
    </div>
  );
}
