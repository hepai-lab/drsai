import { BookmarkPlus, Globe, Upload, Wrench } from "lucide-react";
import React from "react";
import { NAV_BTN_ACTIVE, NAV_BTN_BASE, NAV_BTN_IDLE } from "./constants";

export type SkillSquareTab = "public" | "private";
export type PrivateFilter = "created" | "collected";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: any, ...args: any[]) => string;

interface SkillSquareNavProps {
  activeTab: SkillSquareTab;
  privateFilter: PrivateFilter;
  skillUploadOpen: boolean;
  t: TFn;
  onAllSkills: () => void;
  onMyCreations: () => void;
  onMyCollections: () => void;
  onPublish: () => void;
}

const SkillSquareNav: React.FC<SkillSquareNavProps> = ({
  activeTab,
  privateFilter,
  skillUploadOpen,
  t,
  onAllSkills,
  onMyCreations,
  onMyCollections,
  onPublish,
}) => (
  <nav className="w-40 shrink-0 space-y-0.5 pt-1">
    <button
      type="button"
      onClick={onAllSkills}
      className={[
        NAV_BTN_BASE,
        activeTab === "public" && !skillUploadOpen
          ? NAV_BTN_ACTIVE
          : NAV_BTN_IDLE,
      ].join(" ")}
    >
      <Globe className="h-4 w-4 shrink-0" aria-hidden />
      {t("skillSquare.allSkills")}
    </button>
    <button
      type="button"
      onClick={onMyCreations}
      className={[
        NAV_BTN_BASE,
        activeTab === "private" &&
        privateFilter === "created" &&
        !skillUploadOpen
          ? NAV_BTN_ACTIVE
          : NAV_BTN_IDLE,
      ].join(" ")}
    >
      <Wrench className="h-4 w-4 shrink-0" aria-hidden />
      {t("skillSquare.myCreations")}
    </button>
    <button
      type="button"
      onClick={onMyCollections}
      className={[
        NAV_BTN_BASE,
        activeTab === "private" &&
        privateFilter === "collected" &&
        !skillUploadOpen
          ? NAV_BTN_ACTIVE
          : NAV_BTN_IDLE,
      ].join(" ")}
    >
      <BookmarkPlus className="h-4 w-4 shrink-0" aria-hidden />
      {t("skillSquare.myCollections")}
    </button>
    <button
      type="button"
      onClick={onPublish}
      className={[
        NAV_BTN_BASE,
        skillUploadOpen ? NAV_BTN_ACTIVE : NAV_BTN_IDLE,
      ].join(" ")}
    >
      <Upload className="h-4 w-4 shrink-0" aria-hidden />
      {t("skillSquare.publishSkill")}
    </button>
  </nav>
);

export default SkillSquareNav;
