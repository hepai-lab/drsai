import {
  Bot,
  Code,
  FileText,
  Image,
  Package,
  Sparkles,
  Wrench,
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
];

export const ICON_LABEL_KEY_MAP: Record<
  string,
  | "skillSquare.iconPackage"
  | "skillSquare.iconWrench"
  | "skillSquare.iconCode"
  | "skillSquare.iconSparkles"
  | "skillSquare.iconBot"
  | "skillSquare.iconFileText"
> = {
  package: "skillSquare.iconPackage",
  wrench: "skillSquare.iconWrench",
  code: "skillSquare.iconCode",
  sparkles: "skillSquare.iconSparkles",
  bot: "skillSquare.iconBot",
  "file-text": "skillSquare.iconFileText",
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
